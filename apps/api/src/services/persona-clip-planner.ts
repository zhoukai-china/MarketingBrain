import type { LlmProvider } from "@baolu/agent";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { transcribeSourceWithWordTimestamps, type PreciseTranscriptSegment } from "./clip-asr.js";
import { probeClip } from "./clip-renderer.js";
import type { ClipCandidateGroup, SelectedClipSegment, TranscriptSegment } from "./clip-planner.js";

export type PersonaStoryRole = "hook" | "context" | "story" | "reasoning" | "insight" | "takeaway";

export interface PersonaClipTopic {
  topicId: string;
  title: string;
  summary: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  sourceDurationSeconds: number;
  estimatedDurationSeconds: number;
  selected: SelectedClipSegment[];
  candidateGroups: ClipCandidateGroup[];
  structure: Array<{ role: PersonaStoryRole; label: string; count: number; complete: boolean }>;
  qualityFlags: string[];
}

export interface PersonaClipBatchPlan {
  batchPlanId: string;
  skillId: "persona-clip-editor";
  skillVersion: string;
  sourceId: string;
  sourceDurationSeconds: number;
  transcriptUnitCount: number;
  topicCount: number;
  targetDurationSeconds: number;
  topics: PersonaClipTopic[];
  asrCalls: number;
  asrMode: "full_source_word_timestamp";
  analyzeMs: number;
  qualityFlags: string[];
}

interface TopicDiscoveryShape {
  topics?: Array<{
    title?: string;
    summary?: string;
    startUnitId?: string;
    endUnitId?: string;
    hookUnitId?: string;
    whyIndependent?: string;
    startWindowId?: string;
    endWindowId?: string;
  }>;
}

interface TopicEditShape {
  title?: string;
  summary?: string;
  selected?: Array<{
    unitId?: string;
    role?: PersonaStoryRole;
    reason?: string;
    cropMode?: "wide" | "speaker";
  }>;
}

interface DiscoveredTopic {
  title: string;
  summary: string;
  startIndex: number;
  endIndex: number;
  hookUnitId?: string;
}

interface TopicWindow {
  windowId: string;
  startIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
}

const MAX_PERSONA_SOURCE_SECONDS = 4 * 60 * 60;
const MIN_TOPIC_SOURCE_SECONDS = 25;
const MAX_TOPICS = 12;
const ROLES: Array<{ role: PersonaStoryRole; label: string; required: boolean }> = [
  { role: "hook", label: "有吸引力的开头", required: true },
  { role: "context", label: "必要背景", required: false },
  { role: "story", label: "故事或事实发展", required: false },
  { role: "reasoning", label: "观点与论证", required: false },
  { role: "insight", label: "核心洞察", required: true },
  { role: "takeaway", label: "完整收束", required: true }
];

export async function buildPersonaClipBatchPlan(params: {
  source: { sourceId: string; sourcePath: string };
  targetDurationSeconds: number;
  topicHint: string;
  provider: LlmProvider;
}): Promise<PersonaClipBatchPlan> {
  const startedAt = Date.now();
  const probe = await probeClip(params.source.sourcePath);
  const sourceDurationSeconds = Math.min(probe.durationSeconds, MAX_PERSONA_SOURCE_SECONDS);
  const transcription = await transcribePersonaSource(params.source, sourceDurationSeconds, params.topicHint);
  const units = buildSemanticUnits(transcription.segments);
  if (units.length < 3) throw new Error("没有识别到足够的完整口述内容，暂时无法拆分话题");

  const skillPrompt = await loadPersonaClipSkill();
  const topicWindows = buildTopicWindows(units);
  let discoveryFallback = false;
  let discovered: DiscoveredTopic[];
  const discoveryPayload = {
    sourceDurationSeconds,
    topicHint: params.topicHint || "未提供额外提示",
    windows: topicWindows.map((window) => ({
      windowId: window.windowId,
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      transcript: window.transcript
    }))
  };
  let firstDiscoveryRaw = "";
  try {
    firstDiscoveryRaw = await params.provider.complete([
      { role: "system", content: skillPrompt },
      {
        role: "user",
        content: JSON.stringify({
          task: "从头到尾阅读这些连续小窗，识别其中所有适合独立成片的话题或故事。只返回JSON对象，字段为 topics；每个话题必须返回 title、summary、startWindowId、endWindowId、whyIndependent。相邻窗口仍在讲同一件事就合并；人物、事件、核心问题或结论变化时才开启新话题。忽略开场操作闲聊、重复互动和没有独立观点的内容。不要做带货成交分类。",
          ...discoveryPayload
        })
      }
    ]);
    discovered = validateDiscoveredTopics(parseJsonObject<TopicDiscoveryShape>(firstDiscoveryRaw).topics, units, topicWindows);
    if (discovered.length === 0) throw new Error("topic_discovery_empty");
  } catch (firstError) {
    try {
      const repairedRaw = await params.provider.complete([
        {
          role: "system",
          content: "你是视频话题边界校验器。只输出合法JSON，不输出Markdown。根对象必须只有topics数组；每项必须有title、summary、startWindowId、endWindowId、whyIndependent。窗口ID必须从输入原样复制。"
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "重新识别完整话题边界。不要按固定时长切分；同一故事跨多个窗口时必须合并；忽略无独立内容的操作和闲聊。",
            previousInvalidResponse: firstDiscoveryRaw.slice(0, 12000),
            ...discoveryPayload
          })
        }
      ]);
      discovered = validateDiscoveredTopics(parseJsonObject<TopicDiscoveryShape>(repairedRaw).topics, units, topicWindows);
      if (discovered.length === 0) throw new Error("topic_discovery_repair_empty");
    } catch (repairError) {
      discoveryFallback = true;
      discovered = buildFallbackTopics(units);
      await writePersonaDiscoveryFailure({
        firstRaw: firstDiscoveryRaw,
        firstError: errorText(firstError),
        repairError: errorText(repairError),
        windowCount: topicWindows.length
      });
    }
  }

  const topics = await mapWithConcurrency(discovered, 2, async (topic, index) => {
    const topicUnits = units.slice(topic.startIndex, topic.endIndex + 1);
    let edit: TopicEditShape;
    try {
      const raw = await params.provider.complete([
        { role: "system", content: skillPrompt },
        {
          role: "user",
          content: JSON.stringify({
            task: "把这个单一话题压缩成一条可独立观看的人设/观点短视频。选择原话语义单元，保留强开头、必要背景、故事或论证、核心洞察和完整收束。不要字幕文案，不要改写原话。",
            targetDurationSeconds: params.targetDurationSeconds,
            allowedDurationSeconds: { min: 30, max: 120 },
            discoveredTopic: { title: topic.title, summary: topic.summary },
            units: topicUnits.map(compactUnit)
          })
        }
      ]);
      edit = parseJsonObject<TopicEditShape>(raw);
    } catch {
      edit = buildFallbackEdit(topicUnits, params.targetDurationSeconds);
    }
    return buildTopicPlan({
      index,
      topic,
      topicUnits,
      edit,
      targetDurationSeconds: params.targetDurationSeconds
    });
  });

  const usefulTopics = topics.filter((topic) => topic.selected.length >= 2 && topic.estimatedDurationSeconds >= 12);
  const batchPlanId = randomUUID();
  const plan: PersonaClipBatchPlan = {
    batchPlanId,
    skillId: "persona-clip-editor",
    skillVersion: createHash("sha256").update(skillPrompt).digest("hex").slice(0, 12),
    sourceId: params.source.sourceId,
    sourceDurationSeconds: round(sourceDurationSeconds),
    transcriptUnitCount: units.length,
    topicCount: usefulTopics.length,
    targetDurationSeconds: params.targetDurationSeconds,
    topics: usefulTopics,
    asrCalls: transcription.asrCalls,
    asrMode: "full_source_word_timestamp",
    analyzeMs: Date.now() - startedAt,
    qualityFlags: [
      ...(probe.durationSeconds > MAX_PERSONA_SOURCE_SECONDS ? ["素材超过4小时，本次只分析前4小时"] : []),
      ...(discoveryFallback ? ["话题模型本次未返回有效边界，已使用连续内容保底分段；建议人工复核话题边界"] : []),
      ...(usefulTopics.length === 0 ? ["没有找到可独立成片的完整话题"] : [])
    ]
  };
  const planRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "persona-plans");
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, `${batchPlanId}.json`), JSON.stringify(plan, null, 2), "utf8");
  return plan;
}

export async function readPersonaClipBatchPlan(batchPlanId: string): Promise<PersonaClipBatchPlan> {
  if (!/^[a-f0-9-]{36}$/i.test(batchPlanId)) throw new Error("invalid_persona_plan_id");
  const filePath = path.resolve(env.UPLOAD_DIR, "clip-lab", "persona-plans", `${batchPlanId}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as PersonaClipBatchPlan;
}

async function transcribePersonaSource(
  source: { sourceId: string; sourcePath: string },
  durationSeconds: number,
  topicHint: string
): Promise<{ segments: PreciseTranscriptSegment[]; asrCalls: number }> {
  const sourceStat = await stat(source.sourcePath);
  const cacheKey = createHash("sha256")
    .update(`${source.sourcePath}|${sourceStat.size}|${sourceStat.mtimeMs}|${env.ALIYUN_ASR_FILETRANS_MODEL}|persona-full-v1|${topicHint}`)
    .digest("hex");
  const cacheRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "analysis");
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { segments: PreciseTranscriptSegment[] };
    if (cached.segments.length > 0) return { segments: cached.segments, asrCalls: 0 };
  } catch {
    // Populate cache below.
  }
  const segments = await transcribeSourceWithWordTimestamps({
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
    durationSeconds,
    contextText: topicHint,
    domain: "persona"
  });
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath, JSON.stringify({ segments }, null, 2), "utf8");
  return { segments, asrCalls: 1 };
}

function buildSemanticUnits(segments: PreciseTranscriptSegment[]): TranscriptSegment[] {
  const units: TranscriptSegment[] = [];
  let pending: PreciseTranscriptSegment[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const first = pending[0];
    const last = pending[pending.length - 1];
    const transcript = pending.map((item) => item.transcript.trim()).join("").replace(/\s+/g, "");
    units.push({
      segmentId: `${first.sourceId}:persona-unit:${units.length}`,
      sourceId: first.sourceId,
      startSeconds: first.startSeconds,
      endSeconds: last.endSeconds,
      transcript,
      suggestedRole: classifyPersonaRole(transcript),
      words: mergeWords(pending.flatMap((item) => item.words))
    });
    pending = [];
  };
  for (const segment of segments) {
    if (pending.length > 0
      && segment.startSeconds - pending[pending.length - 1].endSeconds > 2.8
      && /[。！？!?]$/.test(pending[pending.length - 1].transcript.trim())) flush();
    pending.push(segment);
    const complete = /[。！？!?]$/.test(segment.transcript.trim());
    if (complete) flush();
  }
  flush();
  return units.filter((unit) => unit.transcript.length >= 5 && unit.endSeconds - unit.startSeconds >= 0.8);
}

function buildTopicWindows(units: TranscriptSegment[]): TopicWindow[] {
  const windows: TopicWindow[] = [];
  let startIndex = 0;
  while (startIndex < units.length) {
    let endIndex = startIndex;
    while (endIndex + 1 < units.length
      && units[endIndex].endSeconds - units[startIndex].startSeconds < 45
      && endIndex - startIndex < 9) endIndex += 1;
    const selected = units.slice(startIndex, endIndex + 1);
    windows.push({
      windowId: `window-${windows.length + 1}`,
      startIndex,
      endIndex,
      startSeconds: selected[0].startSeconds,
      endSeconds: selected[selected.length - 1].endSeconds,
      transcript: selected.map((unit) => unit.transcript).join("").slice(0, 1500)
    });
    startIndex = endIndex + 1;
  }
  return windows;
}

function validateDiscoveredTopics(
  input: TopicDiscoveryShape["topics"],
  units: TranscriptSegment[],
  windows: TopicWindow[]
): DiscoveredTopic[] {
  const byId = new Map(units.map((unit, index) => [unit.segmentId, index]));
  const windowById = new Map(windows.map((window) => [window.windowId, window]));
  const candidates: DiscoveredTopic[] = [];
  for (const item of input ?? []) {
    const startWindow = item.startWindowId ? windowById.get(item.startWindowId) : undefined;
    const endWindow = item.endWindowId ? windowById.get(item.endWindowId) : undefined;
    const startIndex = startWindow?.startIndex ?? (item.startUnitId ? byId.get(item.startUnitId) : undefined);
    const endIndex = endWindow?.endIndex ?? (item.endUnitId ? byId.get(item.endUnitId) : undefined);
    if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) continue;
    const duration = units[endIndex].endSeconds - units[startIndex].startSeconds;
    if (duration < MIN_TOPIC_SOURCE_SECONDS) continue;
    candidates.push({
      title: shortText(item.title, 36) || `话题 ${candidates.length + 1}`,
      summary: shortText(item.summary, 120) || shortText(item.whyIndependent, 120),
      startIndex,
      endIndex,
      hookUnitId: item.hookUnitId && byId.has(item.hookUnitId) ? item.hookUnitId : undefined
    });
  }
  candidates.sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex);
  const result: DiscoveredTopic[] = [];
  let lastEnd = -1;
  for (const topic of candidates) {
    const startIndex = Math.max(topic.startIndex, lastEnd + 1);
    if (topic.endIndex < startIndex) continue;
    if (units[topic.endIndex].endSeconds - units[startIndex].startSeconds < MIN_TOPIC_SOURCE_SECONDS) continue;
    result.push({ ...topic, startIndex });
    lastEnd = topic.endIndex;
    if (result.length >= MAX_TOPICS) break;
  }
  return result;
}

function buildFallbackTopics(units: TranscriptSegment[]): DiscoveredTopic[] {
  const topics: DiscoveredTopic[] = [];
  let start = 0;
  while (start < units.length && topics.length < MAX_TOPICS) {
    let end = start;
    while (end + 1 < units.length && units[end].endSeconds - units[start].startSeconds < 4 * 60) end += 1;
    topics.push({
      title: `待复核话题 ${topics.length + 1}`,
      summary: "模型未能可靠返回语义边界，先按连续内容生成可人工复核的候选。",
      startIndex: start,
      endIndex: end
    });
    start = end + 1;
  }
  return topics;
}

function buildTopicPlan(params: {
  index: number;
  topic: DiscoveredTopic;
  topicUnits: TranscriptSegment[];
  edit: TopicEditShape;
  targetDurationSeconds: number;
}): PersonaClipTopic {
  const byId = new Map(params.topicUnits.map((unit) => [unit.segmentId, unit]));
  const seen = new Set<string>();
  const selected: SelectedClipSegment[] = [];
  for (const item of params.edit.selected ?? []) {
    const unit = item.unitId ? byId.get(item.unitId) : undefined;
    if (!unit || seen.has(unit.segmentId) || !isSafeSpokenUnit(unit.transcript)) continue;
    seen.add(unit.segmentId);
    const signal = highlightSignal(unit.transcript);
    selected.push({
      ...unit,
      role: normalizeRole(item.role),
      subtitle: unit.transcript,
      cropMode: item.cropMode === "speaker" ? "speaker" : "wide",
      reason: shortText(item.reason, 100) || "保留完整原话，支撑当前话题",
      ...signal
    });
  }

  const fallback = selected.length >= 2 ? selected : buildFallbackSelected(params.topicUnits, params.targetDurationSeconds);
  const durationFloor = Math.min(30, totalDuration(params.topicUnits));
  const expanded = extendSelection(fallback, params.topicUnits, durationFloor, Math.min(120, Math.max(30, params.targetDurationSeconds)));
  const ordered = repairPersonaOpeningAndEnding(orderPersonaTimeline(expanded));
  const editableOrdered = ordered.map((segment) => ({
    ...segment,
    editableStartSeconds: Math.max(params.topicUnits[0].startSeconds, round(segment.startSeconds - 1.2)),
    editableEndSeconds: Math.min(params.topicUnits[params.topicUnits.length - 1].endSeconds, round(segment.endSeconds + 1.2))
  }));
  const duration = round(totalDuration(editableOrdered));
  const structure = ROLES.map((item) => ({
    role: item.role,
    label: item.label,
    count: editableOrdered.filter((segment) => segment.role === item.role).length,
    complete: !item.required || editableOrdered.some((segment) => segment.role === item.role)
  }));
  const qualityFlags = [
    ...(duration < 30 ? [`该话题可用完整口述约 ${duration} 秒，低于建议的30秒，请人工决定是否保留`] : []),
    ...(duration > 120 ? ["成片超过2分钟，请继续删减重复表达"] : []),
    ...structure.filter((item) => !item.complete).map((item) => `缺少${item.label}`),
    ...(!/[。！？!?]$/.test(editableOrdered[editableOrdered.length - 1]?.transcript ?? "") ? ["结尾不是完整语句"] : [])
  ];
  const first = params.topicUnits[0];
  const last = params.topicUnits[params.topicUnits.length - 1];
  return {
    topicId: `topic-${params.index + 1}`,
    title: shortText(params.edit.title, 36) || params.topic.title,
    summary: shortText(params.edit.summary, 140) || params.topic.summary,
    sourceStartSeconds: round(first.startSeconds),
    sourceEndSeconds: round(last.endSeconds),
    sourceDurationSeconds: round(last.endSeconds - first.startSeconds),
    estimatedDurationSeconds: duration,
    selected: editableOrdered,
    candidateGroups: buildPersonaCandidateGroups(params.topicUnits, editableOrdered),
    structure,
    qualityFlags
  };
}

function buildPersonaCandidateGroups(topicUnits: TranscriptSegment[], selected: SelectedClipSegment[]): ClipCandidateGroup[] {
  return ROLES.map((roleInfo) => {
    const selectedForRole = selected.filter((item) => item.role === roleInfo.role);
    const alternatives = topicUnits
      .filter((unit) => !selected.some((item) => item.segmentId === unit.segmentId) && isSafeSpokenUnit(unit.transcript))
      .map((unit) => ({ unit, role: classifyPersonaRole(unit.transcript) as PersonaStoryRole, score: personaUnitScore(unit) }))
      .filter((item) => item.role === roleInfo.role || (roleInfo.role === "hook" && item.score >= 34))
      .sort((a, b) => b.score - a.score || a.unit.startSeconds - b.unit.startSeconds)
      .slice(0, 5)
      .map(({ unit, role }) => ({
        ...unit,
        role: roleInfo.role === "hook" ? "hook" : role,
        subtitle: unit.transcript,
        cropMode: roleInfo.role === "hook" || roleInfo.role === "insight" ? "speaker" as const : "wide" as const,
        reason: `可替换的${roleInfo.label}片段`,
        editableStartSeconds: Math.max(topicUnits[0].startSeconds, round(unit.startSeconds - 1.2)),
        editableEndSeconds: Math.min(topicUnits[topicUnits.length - 1].endSeconds, round(unit.endSeconds + 1.2)),
        ...highlightSignal(unit.transcript)
      }));
    return {
      role: roleInfo.role,
      label: roleInfo.label,
      candidates: [...selectedForRole, ...alternatives]
        .filter((item, index, list) => list.findIndex((candidate) => candidate.segmentId === item.segmentId) === index)
        .slice(0, 6)
    };
  }).filter((group) => group.candidates.length > 0);
}

function extendSelection(
  selected: SelectedClipSegment[],
  topicUnits: TranscriptSegment[],
  minimumSeconds: number,
  targetSeconds: number
): SelectedClipSegment[] {
  const result = [...selected];
  const selectedIds = new Set(result.map((item) => item.segmentId));
  const ranked = topicUnits
    .filter((unit) => !selectedIds.has(unit.segmentId) && isSafeSpokenUnit(unit.transcript))
    .map((unit) => ({ unit, score: personaUnitScore(unit) }))
    .sort((left, right) => right.score - left.score || left.unit.startSeconds - right.unit.startSeconds);
  while (totalDuration(result) < minimumSeconds && ranked.length > 0) {
    const next = ranked.shift()!.unit;
    if (totalDuration(result) + durationOf(next) > Math.max(120, targetSeconds + 18)) continue;
    const role = classifyPersonaRole(next.transcript) as PersonaStoryRole;
    result.push({
      ...next,
      role,
      subtitle: next.transcript,
      cropMode: role === "hook" || role === "insight" ? "speaker" : "wide",
      reason: "补足话题理解所需的完整原话",
      ...highlightSignal(next.transcript)
    });
  }
  return result.slice(0, 16);
}

function orderPersonaTimeline(selected: SelectedClipSegment[]): SelectedClipSegment[] {
  if (selected.length <= 1) return selected;
  const explicitHook = selected.find((item) => item.role === "hook");
  const chronological = selected
    .filter((item) => item.segmentId !== explicitHook?.segmentId)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  return explicitHook ? [explicitHook, ...chronological] : chronological;
}

function repairPersonaOpeningAndEnding(selected: SelectedClipSegment[]): SelectedClipSegment[] {
  if (selected.length < 2) return selected;
  let repaired = [...selected];
  const first = repaired[0];
  if (!isStandalonePersonaHook(first)) {
    const replacement = repaired
      .slice(1)
      .filter((segment) => isStandalonePersonaHook(segment))
      .sort((left, right) => (right.highlightScore ?? 0) - (left.highlightScore ?? 0))[0];
    if (replacement) {
      repaired = [
        { ...replacement, role: "hook", cropMode: "speaker", reason: `${replacement.reason}；替换脱离上下文的弱开头` },
        ...repaired.filter((segment) => segment.segmentId !== replacement.segmentId && segment.segmentId !== first.segmentId)
      ];
    }
  }
  const last = repaired[repaired.length - 1];
  if (isOffTopicPersonaEnding(last.transcript)) {
    const replacementIndex = [...repaired].reverse().findIndex((segment, reverseIndex) => {
      const actualIndex = repaired.length - 1 - reverseIndex;
      return actualIndex > 0
        && segment.segmentId !== last.segmentId
        && !isOffTopicPersonaEnding(segment.transcript)
        && ["insight", "takeaway", "reasoning"].includes(segment.role);
    });
    if (replacementIndex >= 0) {
      const actualIndex = repaired.length - 1 - replacementIndex;
      const replacement = repaired[actualIndex];
      repaired = [
        ...repaired.slice(0, actualIndex),
        ...repaired.slice(actualIndex + 1, -1),
        { ...replacement, role: "takeaway", reason: `${replacement.reason}；用与本话题一致的完整观点收束` }
      ];
    }
  }
  return repaired;
}

function isStandalonePersonaHook(segment: SelectedClipSegment): boolean {
  const text = segment.transcript.replace(/\s+/g, "");
  if ((segment.highlightScore ?? 0) < 30 || text.length < 8) return false;
  if (/^(这个|那个|这玩意|那玩意|这事|那事|他|她|它|整点|对对|是吧|然后|所以说)[，,]?/.test(text)) return false;
  if (/先避开|放袋|掉了|挂那|拉倒吧|别扯|直播间.*取关/.test(text)) return false;
  return /[。！？!?]$/.test(text);
}

function isOffTopicPersonaEnding(text: string): boolean {
  const clean = text.replace(/\s+/g, "");
  return /(?:主播不主播|镜头里|手机里|面对面|就是聊天|唠嗑呗|感谢礼物|点关注|取关|直播间.*播)/.test(clean);
}

function buildFallbackEdit(units: TranscriptSegment[], targetDurationSeconds: number): TopicEditShape {
  return { selected: buildFallbackSelected(units, targetDurationSeconds).map((item) => ({
    unitId: item.segmentId,
    role: item.role as PersonaStoryRole,
    reason: item.reason,
    cropMode: item.cropMode === "speaker" ? "speaker" : "wide"
  })) };
}

function buildFallbackSelected(units: TranscriptSegment[], targetDurationSeconds: number): SelectedClipSegment[] {
  const target = Math.min(120, Math.max(30, targetDurationSeconds));
  const ranked = units.filter((unit) => isSafeSpokenUnit(unit.transcript)).map((unit) => ({ unit, score: personaUnitScore(unit) })).sort((a, b) => b.score - a.score);
  const chosen: TranscriptSegment[] = [];
  let duration = 0;
  for (const { unit } of ranked) {
    if (chosen.length >= 14 || duration >= target * 0.9) break;
    if (duration + durationOf(unit) > target + 15) continue;
    chosen.push(unit);
    duration += durationOf(unit);
  }
  return chosen.sort((a, b) => a.startSeconds - b.startSeconds).map((unit, index, all) => {
    const role: PersonaStoryRole = index === 0 ? "hook" : index === all.length - 1 ? "takeaway" : classifyPersonaRole(unit.transcript) as PersonaStoryRole;
    return {
      ...unit,
      role,
      subtitle: unit.transcript,
      cropMode: role === "hook" || role === "insight" ? "speaker" : "wide",
      reason: "按信息密度、情绪和完整表达选出的保底片段",
      ...highlightSignal(unit.transcript)
    };
  });
}

function personaUnitScore(unit: TranscriptSegment): number {
  const text = unit.transcript;
  const duration = durationOf(unit);
  let score = highlightSignal(text).highlightScore ?? 0;
  if (duration >= 2 && duration <= 12) score += 12;
  if (/因为|所以|但是|后来|结果|其实|我认为|我觉得|说明|明白|懂得/.test(text)) score += 8;
  if (/^(嗯|啊|那个|然后|就是|对吧)[，,。]?/.test(text)) score -= 12;
  return score;
}

function highlightSignal(text: string): { highlightScore: number; highlightTags: string[] } {
  const tags: string[] = [];
  let score = 12;
  if (/没想到|竟然|原来|但是|后来|结果|最|千万|一定|记住|你知道吗|为什么/.test(text)) { score += 22; tags.push("反差或悬念"); }
  if (/哭|笑|难受|开心|感动|遗憾|幸福|痛苦|害怕|生气|珍惜|知足|爱|恨/.test(text)) { score += 24; tags.push("情绪感染"); }
  if (/我认为|我觉得|其实|说明|道理|人生|明白|懂得|所以/.test(text)) { score += 18; tags.push("观点洞察"); }
  if (/那年|当时|后来|有一次|我遇到|他说|她说|我们/.test(text)) { score += 14; tags.push("具体故事"); }
  if (/[。！？!?]$/.test(text.trim())) { score += 8; tags.push("完整表达"); }
  return { highlightScore: Math.min(100, score), highlightTags: [...new Set(tags)].slice(0, 3) };
}

function classifyPersonaRole(text: string): PersonaStoryRole {
  if (/总结|所以|这就是|到最后|说到底|记住|人生|道理|知足|珍惜/.test(text)) return "takeaway";
  if (/我认为|我觉得|其实|说明|明白|懂得|不是.*而是/.test(text)) return "insight";
  if (/为什么|因为|但是|如果|只有|才能|意味着/.test(text)) return "reasoning";
  if (/那年|当时|后来|有一次|他说|她说|结果/.test(text)) return "story";
  if (/没想到|竟然|千万|一定|记住|你知道吗|为什么/.test(text)) return "hook";
  return "context";
}

function isSafeSpokenUnit(text: string): boolean {
  const clean = text.replace(/\s+/g, "").trim();
  return clean.length >= 5 && /[。！？!?]$/.test(clean) && !/[，,、；;：:]$/.test(clean);
}

function normalizeRole(value?: PersonaStoryRole): PersonaStoryRole {
  return value && ROLES.some((item) => item.role === value) ? value : "story";
}

function compactUnit(unit: TranscriptSegment) {
  return {
    unitId: unit.segmentId,
    startSeconds: unit.startSeconds,
    endSeconds: unit.endSeconds,
    transcript: unit.transcript,
    signal: classifyPersonaRole(unit.transcript)
  };
}

function mergeWords(words: Array<{ startSeconds: number; endSeconds: number; text: string }>) {
  const seen = new Set<string>();
  return words.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds).filter((word) => {
    const key = `${word.startSeconds}:${word.endSeconds}:${word.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadPersonaClipSkill(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "mcp-skills", "skills", "persona-clip-editor"),
    path.resolve(process.cwd(), "..", "..", "mcp-skills", "skills", "persona-clip-editor")
  ];
  for (const root of candidates) {
    try {
      await access(path.join(root, "SKILL.md"));
      const [skill, schema] = await Promise.all([
        readFile(path.join(root, "SKILL.md"), "utf8"),
        readFile(path.join(root, "references", "plan-schema.md"), "utf8")
      ]);
      return `${skill}\n\n${schema}`;
    } catch {
      // Try next workspace layout.
    }
  }
  throw new Error("persona_clip_editor_skill_not_found");
}

async function writePersonaDiscoveryFailure(payload: Record<string, unknown>): Promise<void> {
  if (env.NODE_ENV === "production") return;
  const debugRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "debug");
  await mkdir(debugRoot, { recursive: true });
  await writeFile(path.join(debugRoot, `persona-discovery-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("persona_plan_json_missing");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

function durationOf(segment: Pick<TranscriptSegment, "startSeconds" | "endSeconds">): number {
  return Math.max(0, segment.endSeconds - segment.startSeconds);
}

function totalDuration(segments: Array<Pick<TranscriptSegment, "startSeconds" | "endSeconds">>): number {
  return segments.reduce((sum, segment) => sum + durationOf(segment), 0);
}

function shortText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
