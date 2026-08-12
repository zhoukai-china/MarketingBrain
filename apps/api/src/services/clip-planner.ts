import type { LlmProvider } from "@baolu/agent";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { transcribeSourceWithWordTimestamps } from "./clip-asr.js";
import { probeClip } from "./clip-renderer.js";
import { analyzeSelectedClipVisuals } from "./clip-visual-analyzer.js";

export type ClipStoryTemplate = "evidence_conversion" | "experience_recommendation" | "audience_fit" | "question_answer";
export type ClipCropMode = "wide" | "speaker" | "product" | "evidence";

export interface TranscriptSegment {
  segmentId: string;
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
  suggestedRole: string;
  words?: Array<{ startSeconds: number; endSeconds: number; text: string }>;
}

export interface SelectedClipSegment extends TranscriptSegment {
  role: string;
  subtitle: string;
  cropMode: ClipCropMode;
  reason: string;
  /**
   * A conservative editorial signal, not a promise of conversion. It helps
   * the cutter understand why a moment was selected and makes the opening
   * favor a real product line that also has emotion, demonstration, contrast,
   * or a strong buyer-facing point.
   */
  highlightScore?: number;
  highlightTags?: string[];
  /** Cutter-safe trim window. Export requests are clamped to this range. */
  editableStartSeconds?: number;
  editableEndSeconds?: number;
  visual?: {
    summary: string;
    ocrText: string;
    matchScore: number;
    matched: boolean;
    focusX: number;
    focusY: number;
    reviewReason: string;
  };
}

export interface ClipCandidateGroup {
  role: string;
  label: string;
  candidates: SelectedClipSegment[];
}

export interface ClipProductRange {
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ClipAssetNeed {
  id: string;
  role: "usage" | "product" | "evidence" | "transition";
  queryZh: string;
  queryEn: string;
  sourcePolicy: "enterprise" | "stock";
  insertAfterSegmentId: string;
  durationSeconds: number;
  reason: string;
}

export interface ClipClaimFlag {
  segmentId: string;
  claim: string;
  requiresConfirmation: boolean;
  reason: string;
}

export interface ClipRoughCutPlan {
  planId: string;
  skillId: "commerce-clip-editor";
  skillVersion: string;
  title: string;
  summary: string;
  template: ClipStoryTemplate;
  targetDurationSeconds: number;
  estimatedDurationSeconds: number;
  selected: SelectedClipSegment[];
  candidateGroups: ClipCandidateGroup[];
  product?: { productId: string; name: string; ranges: ClipProductRange[] };
  /**
   * Visually useful, semantically duplicated beats that must not be heard
   * twice. The renderer may use them as silent product coverage.
   */
  visualDonors?: SelectedClipSegment[];
  assetNeeds: ClipAssetNeed[];
  claimFlags: ClipClaimFlag[];
  humanChecklist: string[];
  transcriptSegmentCount: number;
  sourceCount: number;
  asrCalls: number;
  asrMode: "word_timestamp";
  storyStages: Array<{ role: string; label: string; count: number; complete: boolean }>;
  qualityFlags: string[];
  analyzeMs: number;
}

interface LlmPlanShape {
  title?: string;
  summary?: string;
  selected?: Array<{
    segmentId?: string;
    role?: string;
    subtitle?: string;
    cropMode?: ClipCropMode;
    reason?: string;
  }>;
  assetNeeds?: Partial<ClipAssetNeed>[];
  claimFlags?: Partial<ClipClaimFlag>[];
  humanChecklist?: string[];
}

interface HighlightCandidate {
  segmentId: string;
  score: number;
  tags: string[];
  rationale: string;
}

// A product catalog may be built from a full livestream. The final product
// planner filters the cached word-timestamp transcript down to the confirmed
// product ranges before asking the model to compose a short cut.
const MAX_SOURCE_SECONDS = 4 * 60 * 60;
const DIRECT_PRICE_PATTERN = /(?:¥|￥)?\d+(?:\.\d+)?\s*(?:元|块)|(?:卖|售价|到手价|价格)[^，。！？]{0,8}\d|(?:六十九|六十?九)(?:元|块)|优惠价|券后价/;
const STRONG_CLAIM_PATTERN = /(￥|¥|\d+(?:\.\d+)?\s*(?:元|块|万|斤|升|桶)|价格|赔偿|赔付|保险|PICC|人保|销量|卖了|售出|全网|第一|唯一|最好|最香|安全|健康|认证|保障|产地|东北|零添加|无添加)/i;
const TEMPLATE_STAGES: Record<ClipStoryTemplate, Array<{ role: string; label: string; required: boolean; max: number }>> = {
  evidence_conversion: [
    { role: "hook", label: "开头钩子", required: true, max: 1 },
    { role: "evidence", label: "产品证据", required: true, max: 2 },
    { role: "specification", label: "规格信息", required: true, max: 2 },
    { role: "social_proof", label: "销量口碑", required: false, max: 1 },
    { role: "price", label: "价格权益", required: true, max: 1 },
    { role: "benefit", label: "产品功能与好处", required: false, max: 2 },
    { role: "usage", label: "使用场景", required: true, max: 2 },
    { role: "experience", label: "真实体验与口感", required: false, max: 1 },
    { role: "usage_advice", label: "使用建议", required: false, max: 1 },
    { role: "objection", label: "异议消除", required: false, max: 1 },
    { role: "action", label: "行动提示", required: true, max: 1 }
  ],
  experience_recommendation: [
    { role: "hook", label: "体验钩子", required: true, max: 1 },
    { role: "experience", label: "真实体验", required: true, max: 2 },
    { role: "benefit", label: "产品好处", required: true, max: 2 },
    { role: "usage", label: "使用场景", required: false, max: 2 },
    { role: "evidence", label: "可信证据", required: true, max: 2 },
    { role: "price", label: "价格权益", required: false, max: 1 },
    { role: "action", label: "行动提示", required: true, max: 2 }
  ],
  audience_fit: [
    { role: "hook", label: "人群问题", required: true, max: 1 },
    { role: "answer", label: "适合人群", required: true, max: 2 },
    { role: "benefit", label: "产品价值", required: true, max: 2 },
    { role: "specification", label: "规格信息", required: false, max: 1 },
    { role: "evidence", label: "可信证据", required: true, max: 2 },
    { role: "usage", label: "使用场景", required: false, max: 2 },
    { role: "price", label: "价格权益", required: false, max: 1 },
    { role: "action", label: "行动提示", required: true, max: 2 }
  ],
  question_answer: [
    { role: "hook", label: "顾客问题", required: true, max: 1 },
    { role: "answer", label: "直接回答", required: true, max: 2 },
    { role: "evidence", label: "回答证据", required: true, max: 2 },
    { role: "benefit", label: "产品价值", required: false, max: 2 },
    { role: "objection", label: "限制与异议", required: false, max: 1 },
    { role: "price", label: "价格权益", required: false, max: 1 },
    { role: "action", label: "行动提示", required: true, max: 2 }
  ]
};

export async function buildClipRoughCutPlan(params: {
  sources: Array<{ sourceId: string; sourcePath: string }>;
  targetDurationSeconds: number;
  template: ClipStoryTemplate;
  confirmedFacts: string;
  personalAngle: string;
  provider: LlmProvider;
  product?: { productId: string; name: string; ranges: ClipProductRange[] };
}): Promise<ClipRoughCutPlan> {
  const startedAt = Date.now();
  const asrContext = `${params.confirmedFacts}\n${params.personalAngle}`.trim();
  const transcripts = await mapWithConcurrency(params.sources, 2, async (source) => transcribeCommerceSource(source, asrContext));
  const allTranscriptSegments = transcripts.flatMap((item) => item.segments);
  const allSegments = params.product?.ranges?.length
    ? allTranscriptSegments.filter((segment) => params.product!.ranges.some((range) =>
        range.sourceId === segment.sourceId
        && segment.endSeconds > range.startSeconds
        && segment.startSeconds < range.endSeconds))
    : allTranscriptSegments;
  if (allSegments.length === 0) throw new Error("没有识别到可用于粗剪的清晰口播");
  // Before asking the planner to build a story, explicitly surface the best
  // buyer-facing moments from the complete source. This prevents the model
  // from treating every ASR sentence as equally useful and makes a strong,
  // emotional product moment available for the opening.
  const highlightCandidates = rankHighlightCandidates(allSegments);
  const skillPrompt = await loadCommerceClipSkill();
  let llmPlan: LlmPlanShape;
  try {
    const raw = await params.provider.complete([
      { role: "system", content: skillPrompt },
      {
        role: "user",
        content: JSON.stringify({
          task: "按语义理解把5到10分钟讲品口播浓缩成一份可人工审核的高密度成交短视频粗剪计划。不是只删停顿：第一句最好在1秒内用有力量的完整原话直接说出产品；随后优先使用同期画面能看见的标签、保险或赔付等信任证据，再给规格、真实销量或口碑、价格，然后给功能、使用场景、口感体验，最后用完整行动提示收束。强声明允许进入审核方案，但必须保留claimFlags并由人工确认后才能渲染。通常每2到4秒推进一个新信息，35到45秒的完整高密度成片优于用低价值口播填满60秒；长篇回忆、泛泛解释和重复卖点应先删除。只能选择下面提供的segmentId；不能补造台词、数字或事实。字幕只能摘录原口播并调整标点，不能增加音频里没有说出的词；结尾不能用半句话突然结束。商品身份、标签证据、规格、销量或价格使用直接切入的静态特写；使用场景优先请求全屏补充画面并保留原口播；结尾回到人物带商品或清楚的商品画面。画面也必须推进信息：开头优先采用商品全貌建立镜头、凭证或标签细节、人物带商品或规格说明的景别递进；同一源时间段不能在相邻两段重复播放，也不能为了覆盖第一句而提前透支下一段将要使用的同一凭证镜头。",
          template: params.template,
          targetDurationSeconds: params.targetDurationSeconds,
          highlightSelectionRule: "高光不是虚构的高转化预测。开头优先级依次是：有力量地直接说出产品并同时展示商品；产品名加可见信任证据；产品名加明确利益点。怀旧、泛情绪和不指向产品的热闹不能排在这些内容前面。其余片段优先现场演示、具体规格数字、价格、销量口碑、使用场景和口感表达。",
          highlightCandidates,
          confirmedFacts: params.confirmedFacts || "未提供已确认商品事实",
          personalAngle: params.personalAngle || "未提供个人表达角度",
          transcriptSegments: allSegments
        })
      }
    ]);
    llmPlan = parseJsonObject(raw);
  } catch {
    llmPlan = buildDeterministicPlan(allSegments, params.template, params.targetDurationSeconds);
  }

  // The semantic planner returns full, safe spoken units. A pace target must
  // never split one of those units into comma-level fragments: it damages both
  // the spoken thought and the visual continuity. Pacing comes from selecting
  // whole sales points, not from cutting inside a seller's sentence.
  let selected = validateSelectedSegments(llmPlan.selected, allSegments, params.template, params.targetDurationSeconds);
  selected = repairCommerceClosingAction(selected, allSegments, params.template);
  selected = repairUnsafeCutBoundaries(ensureProductIdentificationFirst(selected, allSegments), allSegments)
    .filter((segment) => isSafeVideoCutBoundary(segment.transcript));
  const beforeFactDeduplication = ensureDedicatedEvidenceBeat(selected, allSegments, params.template);
  selected = removeRedundantCommerceBeats(beforeFactDeduplication);
  const retainedIds = new Set(selected.map((segment) => segment.segmentId));
  let visualDonorCandidates = beforeFactDeduplication.filter((segment) => !retainedIds.has(segment.segmentId));
  const sourcePaths = Object.fromEntries(params.sources.map((source) => [source.sourceId, source.sourcePath]));
  let visualizedSelected = selected;
  try {
    const visualTargets = [...selected, ...visualDonorCandidates]
      .filter((segment, index, all) => all.findIndex((item) => item.segmentId === segment.segmentId) === index);
    const visuals = await analyzeSelectedClipVisuals({ segments: visualTargets, sourcePaths });
    visualizedSelected = selected.map((segment) => {
      const visual = visuals.get(segment.segmentId);
      if (!visual) return segment;
      return {
        ...segment,
        cropMode: segment.cropMode === "evidence" && !visual.matched ? "wide" as const : segment.cropMode,
        visual
      };
    });
    visualizedSelected = await replaceMismatchedEvidence({
      selected: visualizedSelected,
      allSegments,
      sourcePaths
    });
    visualizedSelected = await replaceMismatchedHook({ selected: visualizedSelected, allSegments, sourcePaths });
    visualDonorCandidates = visualDonorCandidates.map((segment) => {
      const visual = visuals.get(segment.segmentId);
      return visual ? { ...segment, visual } : segment;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "画面识别失败";
    visualizedSelected = selected.map((segment) => ({
      ...segment,
      cropMode: segment.cropMode === "evidence" ? "wide" as const : segment.cropMode,
      visual: { summary: "待人工查看同期画面", ocrText: "", matchScore: 0, matched: false, focusX: 500, focusY: 500, reviewReason: reason.slice(0, 100) }
    }));
    visualDonorCandidates = [];
  }
  // Visual replacement is allowed to improve the picture, never to bypass the
  // core audio-edit rules. Re-check the finished timeline because a visual
  // replacement may otherwise reintroduce an unsafe ASR fragment.
  visualizedSelected = enforceFinalTimelineIntegrity(visualizedSelected, allSegments, params.template, params.targetDurationSeconds);
  // Required-stage restoration can re-label a generic proof line as the hook.
  // Re-apply the hard opening contract at the very end so the exported plan
  // still begins with a direct product declaration, while reusing any visual
  // analysis already attached to the same source segment.
  visualizedSelected = removeRedundantCommerceBeats(repairUnsafeCutBoundaries(
    ensureProductIdentificationFirst(visualizedSelected, allSegments),
    allSegments
  ).filter((segment) => isSafeVideoCutBoundary(segment.transcript)));
  visualizedSelected = calibrateCommerceVisualRhythm(visualizedSelected, params.template);
  const highlightedSelected = visualizedSelected.map((segment) => ({
    ...segment,
    editableStartSeconds: Math.max(0, round(segment.startSeconds - 1.2)),
    editableEndSeconds: round(segment.endSeconds + 1.2),
    ...describeHighlight(segment, segment.role)
  }));
  const candidateGroups = buildCandidateGroups(allSegments, highlightedSelected, params.template);
  const visualDonors = visualDonorCandidates
    .filter((segment) => segment.visual?.matched === true && hasVisibleProductTarget(segment))
    .sort((left, right) => (right.visual?.matchScore ?? 0) - (left.visual?.matchScore ?? 0)
      || (right.endSeconds - right.startSeconds) - (left.endSeconds - left.startSeconds))
    .slice(0, 3);
  const estimatedDurationSeconds = round(highlightedSelected.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0));
  const storyStages = buildStoryStageStatus(highlightedSelected, params.template);
  const qualityFlags = [
    ...storyStages.filter((stage) => !stage.complete).map((stage) => `成交结构缺少“${stage.label}”阶段`),
    ...(estimatedDurationSeconds < minimumUsefulDuration(params.targetDurationSeconds)
      ? [`可用的非重复完整口播只有约 ${estimatedDurationSeconds} 秒，未达到当前目标的有效内容下限；请补充更多讲品内容或手动放宽去重。`]
      : []),
    ...highlightedSelected.filter((segment) => isVisualClaimSensitive(segment) && !segment.visual?.matched).map((segment) => `强声明口播与同期画面未确认匹配：${segment.subtitle}`)
  ];
  const allCandidateSegments = candidateGroups.flatMap((group) => group.candidates);
  const claimFlags = buildClaimFlags(
    [...highlightedSelected, ...allCandidateSegments].filter((segment, index, all) =>
      all.findIndex((item) => item.segmentId === segment.segmentId) === index),
    params.confirmedFacts,
    llmPlan.claimFlags
  );
  const assetNeeds = mergeVisualAssetNeeds(validateAssetNeeds(llmPlan.assetNeeds, highlightedSelected), highlightedSelected);
  const planId = randomUUID();
  const skillVersion = createHash("sha256").update(skillPrompt).digest("hex").slice(0, 12);
  const plan: ClipRoughCutPlan = {
    planId,
    skillId: "commerce-clip-editor",
    skillVersion,
    title: shortText(llmPlan.title, 60) || templateLabel(params.template),
    summary: shortText(llmPlan.summary, 180) || "从多条真实素材中选句，按带货结构重组为可人工审核的粗剪时间线。",
    template: params.template,
    targetDurationSeconds: params.targetDurationSeconds,
    estimatedDurationSeconds,
    selected: highlightedSelected,
    candidateGroups,
    product: params.product,
    visualDonors,
    assetNeeds,
    claimFlags,
    humanChecklist: normalizeChecklist(llmPlan.humanChecklist),
    transcriptSegmentCount: allSegments.length,
    sourceCount: params.sources.length,
    asrCalls: transcripts.reduce((sum, item) => sum + item.asrCalls, 0),
    asrMode: "word_timestamp",
    storyStages,
    qualityFlags,
    analyzeMs: Date.now() - startedAt
  };
  const planRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "plans");
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, `${planId}.json`), JSON.stringify(plan, null, 2), "utf8");
  return plan;
}

export async function readClipPlan(planId: string): Promise<ClipRoughCutPlan> {
  if (!/^[a-f0-9-]{36}$/i.test(planId)) throw new Error("invalid_plan_id");
  const filePath = path.resolve(env.UPLOAD_DIR, "clip-lab", "plans", `${planId}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as ClipRoughCutPlan;
}

export async function saveClipPlan(plan: ClipRoughCutPlan): Promise<void> {
  const planRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "plans");
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, `${plan.planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

export async function transcribeCommerceSource(source: { sourceId: string; sourcePath: string }, contextText: string): Promise<{ segments: TranscriptSegment[]; asrCalls: number }> {
  const sourceStat = await stat(source.sourcePath);
  const probe = await probeClip(source.sourcePath);
  const duration = Math.min(probe.durationSeconds, MAX_SOURCE_SECONDS);
  const cacheKey = createHash("sha256")
    .update(`${source.sourcePath}|${sourceStat.size}|${sourceStat.mtimeMs}|${env.ALIYUN_ASR_FILETRANS_MODEL}|word-timestamp-v3|${contextText}`)
    .digest("hex");
  const cacheRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "analysis");
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { segments: TranscriptSegment[]; asrCalls: number };
    return {
      segments: cached.segments.map((segment) => ({ ...segment, suggestedRole: classifyRole(segment.transcript) })),
      asrCalls: 0
    };
  } catch {
    // Analyze and populate cache.
  }
  const precise = await transcribeSourceWithWordTimestamps({
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
    durationSeconds: duration,
    contextText
  });
  const payload = {
    segments: precise.map((segment) => ({ ...segment, suggestedRole: classifyRole(segment.transcript) })),
    asrCalls: 1
  };
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload), "utf8");
  return payload;
}

function validateSelectedSegments(
  selectedInput: LlmPlanShape["selected"],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate,
  targetDurationSeconds: number
): SelectedClipSegment[] {
  const byId = new Map(allSegments.map((segment) => [segment.segmentId, segment]));
  const seen = new Set<string>();
  const selected: SelectedClipSegment[] = [];
  for (const item of selectedInput ?? []) {
    const source = item.segmentId ? byId.get(item.segmentId) : undefined;
    if (!source || seen.has(source.segmentId) || selected.length >= 16) continue;
    const requestedSubtitle = shortText(item.subtitle, 44) || source.transcript;
    const requestedRole = normalizeRole(item.role || source.suggestedRole);
    const classifiedRole = classifyRole(source.transcript);
    const supportedRole = scoreForRole(source.transcript, requestedRole) >= minimumRoleScore(requestedRole) ? requestedRole : classifiedRole;
    const subtitle = buildFaithfulSubtitle(supportedRole, source.transcript, requestedSubtitle);
    // LLMs occasionally select two differently worded clips that convey the
    // same selling point. Keep the first one once the plan has enough shape,
    // so the finished cut spends its limited seconds on new information.
    if (selected.length >= 5 && selected.some((existing) => isNearDuplicate(existing.subtitle, subtitle))) continue;
    seen.add(source.segmentId);
    selected.push({
      ...source,
      role: supportedRole,
      subtitle,
      cropMode: normalizeCrop(item.cropMode),
      reason: shortText(item.reason, 100) || "符合当前带货结构"
    });
  }
  if (selected.length < 5) {
    const fallback = buildDeterministicPlan(allSegments, template, targetDurationSeconds);
    return validateSelectedSegments(fallback.selected, allSegments, template, targetDurationSeconds);
  }
  const ordered = enforceTemplateOrder(selected, allSegments, template, targetDurationSeconds);
  // ASR sentence chunks are deliberately short enough for retrieval, but a
  // comma-delimited chunk is not automatically a safe video-cut boundary. Join
  // its directly adjacent continuation before the EDL reaches the renderer.
  // This keeps phrases such as "一桶就五升，九斤…" and "炸东西呀，炒菜呀，
  // 真的是…" in one continuous shot and audio unit.
  const productFirst = ensureProductIdentificationFirst(ordered, allSegments);
  // An incomplete ASR chunk may be selected only as an input to this repair
  // step. If no adjacent continuation completes it, reject it rather than
  // letting the renderer cut speech at its comma.
  const repaired = repairUnsafeCutBoundaries(productFirst, allSegments)
    .filter((segment) => isSafeVideoCutBoundary(segment.transcript));
  // A semantic merge can turn a specification block into a complete price
  // statement. Do not then retain a later block that repeats the same offer.
  const deduplicated = removeCoveredPriceSegments(repaired);
  // Repair and de-duplication must never leave a customer with a structurally
  // incomplete conversion story. Restore only genuinely missing required
  // stages from non-overlapping source speech.
  const completed = restoreRequiredStages(deduplicated, allSegments, template)
    .filter((segment) => isSafeVideoCutBoundary(segment.transcript));
  const enriched = extendToTargetDuration(completed, allSegments, template, targetDurationSeconds);
  return trimToTarget(enriched, targetDurationSeconds);
}

function isNearDuplicate(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()\-]/g, "")
    .replace(/这个|就是|真的|大家|你们|我们/g, "")
    .toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  if (a.length < 5 || b.length < 5) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const pairs = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
  const aPairs = pairs(a);
  const bPairs = pairs(b);
  const overlap = [...aPairs].filter((pair) => bPairs.has(pair)).length;
  return overlap / Math.min(aPairs.size, bPairs.size) >= 0.68;
}

function removeCoveredPriceSegments(selected: SelectedClipSegment[]): SelectedClipSegment[] {
  const kept: SelectedClipSegment[] = [];
  for (const segment of selected) {
    if (segment.role !== "price") {
      kept.push(segment);
      continue;
    }
    const currentPrices = extractPriceTokens(segment.transcript);
    const alreadyCovered = currentPrices.length > 0 && kept.some((previous) => {
      if (previous.role === "price") return false;
      const previousPrices = extractPriceTokens(previous.transcript);
      return currentPrices.some((price) => previousPrices.includes(price));
    });
    if (!alreadyCovered) kept.push(segment);
  }
  return kept;
}

function extractPriceTokens(text: string): string[] {
  const normalized = text.replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:'"“”‘’（）()\-]/g, "");
  const numeric = normalized.match(/(?:¥|￥)?\d+(?:\.\d+)?(?:元|块)(?:[零一二三四五六七八九十])?/g) ?? [];
  const chinese = normalized.match(/(?:一|二|三|四|五|六|七|八|九|十){2,}(?:元|块)(?:[零一二三四五六七八九十])?/g) ?? [];
  return [...new Set([...numeric, ...chinese])];
}

function restoreRequiredStages(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate
): SelectedClipSegment[] {
  const restored = [...selected];
  const bySource = new Map<string, TranscriptSegment[]>();
  for (const segment of allSegments) {
    const bucket = bySource.get(segment.sourceId) ?? [];
    bucket.push(segment);
    bySource.set(segment.sourceId, bucket);
  }
  for (const bucket of bySource.values()) bucket.sort((left, right) => left.startSeconds - right.startSeconds);
  for (const stage of TEMPLATE_STAGES[template]) {
    if (!stage.required || restored.some((segment) => segmentCoversStage(segment, stage.role))) continue;
    // A visually supported line can fulfil more than one editorial role. For
    // example, a close-up that says "看这油的颜色" is a better product-proof
    // module than dropping it and then forcing an unrelated proof claim in.
    const reusableIndex = restored.findIndex((segment) => scoreForRole(segment.transcript, stage.role) >= minimumRoleScore(stage.role));
    if (reusableIndex >= 0) {
      const reusable = restored[reusableIndex];
      restored[reusableIndex] = {
        ...reusable,
        role: stage.role,
        subtitle: buildFaithfulSubtitle(stage.role, reusable.transcript, reusable.transcript),
        cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : reusable.cropMode,
        reason: `复用同期可见内容补齐成交结构中的“${stage.label}”`
      };
      continue;
    }
    const candidate = allSegments
      .filter((segment) => isCompleteSemanticUnit(segment.transcript)
        && scoreForRole(segment.transcript, stage.role) >= minimumRoleScore(stage.role))
      .map((segment) => mergeUntilSafeCutBoundary({
        ...segment,
        role: stage.role,
        subtitle: buildFaithfulSubtitle(stage.role, segment.transcript, segment.transcript),
        cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : "speaker",
        reason: `去重后补齐成交结构中的“${stage.label}”`
      }, bySource.get(segment.sourceId) ?? []))
      .filter((segment) => isSafeVideoCutBoundary(segment.transcript)
        && !restored.some((existing) => existing.sourceId === segment.sourceId
          && existing.startSeconds < segment.endSeconds - 0.04
          && segment.startSeconds < existing.endSeconds - 0.04)
        && !restored.some((existing) => isNearDuplicate(existing.subtitle, segment.transcript)))
      .map((segment) => ({ segment, score: scoreForRole(segment.transcript, stage.role) }))
      .sort((left, right) => right.score - left.score)[0]?.segment;
    if (!candidate) continue;
    restored.push({
      ...candidate,
      role: stage.role,
      subtitle: buildFaithfulSubtitle(stage.role, candidate.transcript, candidate.transcript),
      cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : "speaker"
    });
  }
  const rank = new Map(TEMPLATE_STAGES[template].map((stage, index) => [stage.role, index]));
  return restored.sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99));
}

function enforceTemplateOrder(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate,
  targetDurationSeconds: number
): SelectedClipSegment[] {
  const used = new Set<string>();
  const buckets = new Map<string, SelectedClipSegment[]>();
  for (const stage of TEMPLATE_STAGES[template]) {
    const candidates = selected
      .filter((segment) => !used.has(segment.segmentId)
        && segment.role === stage.role
        && isCompleteSemanticUnit(segment.transcript))
      .sort((a, b) => selectionScore(b, stage.role) - selectionScore(a, stage.role));
    if (candidates.length === 0 && stage.required) {
      const fallback = allSegments
        .filter((segment) => !used.has(segment.segmentId)
          && isCompleteSemanticUnit(segment.transcript))
        .map((segment) => ({ segment, score: selectionScore(segment, stage.role) }))
        .filter((item) => item.score >= minimumRoleScore(stage.role))
        .sort((a, b) => b.score - a.score)[0]?.segment;
      if (fallback) {
        candidates.push({
          ...fallback,
          role: stage.role,
          subtitle: buildFaithfulSubtitle(stage.role, fallback.transcript, fallback.transcript),
          cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : "speaker",
          reason: `补齐成交结构中的“${stage.label}”`
        });
      }
    }
    const bucket: SelectedClipSegment[] = [];
    for (const candidate of candidates.slice(0, stage.max)) {
      if ([...buckets.values()].flat().some((existing) => isNearDuplicate(existing.subtitle, candidate.subtitle))) continue;
      used.add(candidate.segmentId);
      bucket.push({ ...candidate, role: stage.role });
    }
    buckets.set(stage.role, bucket);
  }

  // The first pass guarantees the required conversion stages. If the useful
  // material is still much shorter than the requested video, add one strong,
  // non-duplicate semantic block at a time without changing template order.
  const duration = () => [...buckets.values()].flat().reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0);
  let expanded = true;
  while (duration() < targetDurationSeconds * 0.82 && expanded) {
    expanded = false;
    for (const stage of TEMPLATE_STAGES[template]) {
      const bucket = buckets.get(stage.role) ?? [];
      if (bucket.length >= stage.max) continue;
      const candidate = allSegments
        .filter((segment) => !used.has(segment.segmentId)
          && isCompleteSemanticUnit(segment.transcript))
        .map((segment) => ({ segment, score: selectionScore(segment, stage.role) }))
        .filter((item) => item.score >= minimumRoleScore(stage.role))
        .sort((a, b) => b.score - a.score)
        .find((item) => ![...buckets.values()].flat().some((existing) => isNearDuplicate(existing.subtitle, item.segment.transcript)));
      if (!candidate) continue;
      const segment: SelectedClipSegment = {
        ...candidate.segment,
        role: stage.role,
        subtitle: buildFaithfulSubtitle(stage.role, candidate.segment.transcript, candidate.segment.transcript),
        cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : "speaker",
        reason: `补充“${stage.label}”的有效信息`
      };
      used.add(segment.segmentId);
      bucket.push(segment);
      buckets.set(stage.role, bucket);
      expanded = true;
      if (duration() >= targetDurationSeconds * 0.82) break;
    }
  }
  if ((buckets.get("price")?.length ?? 0) === 0) {
    const directPrice = allSegments
      .filter((segment) => isCompleteSemanticUnit(segment.transcript))
      .map((segment) => ({ segment, score: selectionScore(segment, "price") }))
      .filter((item) => item.score >= minimumRoleScore("price"))
      .sort((a, b) => Number(used.has(a.segment.segmentId)) - Number(used.has(b.segment.segmentId)) || b.score - a.score)[0]?.segment;
    if (directPrice) {
      for (const [role, bucket] of buckets) {
        if (role !== "price") buckets.set(role, bucket.filter((segment) => segment.segmentId !== directPrice.segmentId));
      }
      buckets.set("price", [{
        ...directPrice,
        role: "price",
        subtitle: buildFaithfulSubtitle("price", directPrice.transcript, directPrice.transcript),
        cropMode: "product",
        reason: "明确说明商品售价或优惠"
      }]);
    }
  }
  const ordered = TEMPLATE_STAGES[template].flatMap((stage) => buckets.get(stage.role) ?? []);
  // Never fall back to the raw LLM selection here: that list can contain an
  // ASR fragment ending at a comma. A shorter safe timeline is preferable to
  // outputting audio that is cut mid-thought.
  return ordered.length > 0
    ? ordered.slice(0, 16)
    : selected.filter((segment) => isCompleteSemanticUnit(segment.transcript)).slice(0, 16);
}

function isCompleteSemanticUnit(text: string): boolean {
  const clean = text.replace(/\s+/g, "").trim();
  if (clean.length < 6) return false;
  if (/^(这个|那个|然后|就是|所以说|对吧|哎|啊|嗯|来)[，。！？!?]*$/.test(clean)) return false;
  if (/^(?:因为|由于)/.test(clean)
    && !/(?:所以|因此|导致|造成|才会|才有|就会|就是|可以|能够)/.test(clean.slice(2))) return false;
  if (/(但是|而且|因为|所以|然后|不像别|不像|这个|那个|就是)[，。！？!?]*$/.test(clean)) return false;
  // Some ASR chunks receive an artificial full stop even though their final
  // words are grammatically a lead-in (for example, "突然他接触。").
  if (/(?:突然|然后|所以|但是|因为|如果|或者|包括|这个|那个)[^。！？!?]{0,5}(?:接触|开始|继续|出现|知道|觉得|认为|说|看|吃|用)[。！？!?]$/.test(clean)) return false;
  // Contradictory repeated phrases are characteristic of a bad dialect/ASR
  // merge. Extending these clips cannot make the sentence trustworthy, so the
  // safe edit is to omit the optional beat instead of presenting broken speech.
  if (/接受不了.{0,18}没(?:有)?接受不了/.test(clean)
    || /([\u4e00-\u9fa5]{2,4})不了.{0,18}没(?:有)?\1不了/.test(clean)) return false;
  return /[\u4e00-\u9fa5A-Za-z0-9]{5,}/.test(clean);
}

function buildStoryStageStatus(selected: SelectedClipSegment[], template: ClipStoryTemplate): Array<{ role: string; label: string; count: number; complete: boolean }> {
  return TEMPLATE_STAGES[template].map((stage) => {
    // A repaired semantic unit can legitimately cover two adjacent stages.
    // For example, “一桶五升，九斤…69块九” is both specification and
    // price, even though its primary timeline role remains specification.
    const count = selected.filter((segment) => segmentCoversStage(segment, stage.role)).length;
    return { role: stage.role, label: stage.label, count, complete: !stage.required || count > 0 };
  });
}

function buildCandidateGroups(
  allSegments: TranscriptSegment[],
  selected: SelectedClipSegment[],
  template: ClipStoryTemplate
): ClipCandidateGroup[] {
  const selectedByRole = new Map<string, SelectedClipSegment[]>();
  for (const segment of selected) {
    for (const stage of TEMPLATE_STAGES[template]) {
      if (!segmentCoversStage(segment, stage.role)) continue;
      selectedByRole.set(stage.role, [...(selectedByRole.get(stage.role) ?? []), segment]);
    }
  }
  const roles = [
    ...TEMPLATE_STAGES[template],
    ...["hook", "evidence", "social_proof", "specification", "price", "benefit", "usage", "experience", "usage_advice", "objection", "answer", "action"]
      .filter((role) => !TEMPLATE_STAGES[template].some((stage) => stage.role === role))
      .map((role) => ({ role, label: roleLabel(role), required: false, max: 1 }))
  ];
  return roles.map((stage) => {
    const preferred = selectedByRole.get(stage.role) ?? [];
    const alternatives = allSegments
      .filter((segment) => !preferred.some((item) => item.segmentId === segment.segmentId))
      .filter((segment) => isCompleteSemanticUnit(segment.transcript) && isSafeVideoCutBoundary(segment.transcript))
      .map((segment) => ({ segment, score: selectionScore(segment, stage.role) }))
      .filter((item) => item.score >= minimumRoleScore(stage.role))
      .sort((left, right) => right.score - left.score || left.segment.startSeconds - right.segment.startSeconds)
      .slice(0, 5)
      .map(({ segment }) => candidateFromTranscript(segment, stage.role));
    const candidates = [...preferred.map((segment) => ({
      ...segment,
      segmentId: `${segment.segmentId}::${stage.role}`,
      role: stage.role,
      cropMode: cropForConversionBeat(stage.role, segment.cropMode),
      reason: `可替换的${roleLabel(stage.role)}片段`,
      editableStartSeconds: segment.editableStartSeconds ?? Math.max(0, round(segment.startSeconds - 1.2)),
      editableEndSeconds: segment.editableEndSeconds ?? round(segment.endSeconds + 1.2)
    })), ...alternatives]
      .filter((segment, index, list) => list.findIndex((item) => item.segmentId === segment.segmentId) === index)
      .slice(0, 6);
    return { role: stage.role, label: stage.label || roleLabel(stage.role), candidates };
  }).filter((group) => group.candidates.length > 0);
}

function candidateFromTranscript(segment: TranscriptSegment, role: string): SelectedClipSegment {
  return {
    ...segment,
    segmentId: `${segment.segmentId}::${role}`,
    role,
    subtitle: segment.transcript,
    cropMode: cropForConversionBeat(role, "wide"),
    reason: `可替换的${roleLabel(role)}片段`,
    editableStartSeconds: Math.max(0, round(segment.startSeconds - 1.2)),
    editableEndSeconds: round(segment.endSeconds + 1.2),
    ...describeHighlight(segment, role)
  };
}

function roleLabel(role: string): string {
  return ({
    hook: "情绪开头", evidence: "信任证据", social_proof: "销量口碑", specification: "规格信息",
    price: "价格权益", benefit: "产品好处", usage: "使用场景", experience: "口感体验",
    usage_advice: "使用建议", objection: "异议处理", answer: "直接回答", action: "行动收尾"
  } as Record<string, string>)[role] ?? "可用片段";
}

function segmentCoversStage(segment: Pick<SelectedClipSegment, "role" | "transcript">, stageRole: string): boolean {
  if (segment.role === stageRole) return true;
  // The approved reference returns to a clear action at the end. A proof or
  // specification sentence that happens to contain “拍” cannot silently stand
  // in for that final beat, otherwise the timeline may end on an objection.
  return (stageRole === "specification" || stageRole === "price")
    && scoreForRole(segment.transcript, stageRole) >= minimumRoleScore(stageRole);
}

function trimToTarget(selected: SelectedClipSegment[], target: number): SelectedClipSegment[] {
  const result: SelectedClipSegment[] = [];
  let duration = 0;
  for (const segment of selected) {
    if (!isSafeVideoCutBoundary(segment.transcript)) continue;
    const segmentDuration = segment.endSeconds - segment.startSeconds;
    if (duration >= target * 1.12 && result.length >= 5) break;
    // A duration target is a selection constraint, never permission to cut a
    // spoken sentence at an arbitrary second boundary.
    result.push(segment);
    duration += segmentDuration;
  }
  return result;
}

function extendToTargetDuration(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate,
  target: number
): SelectedClipSegment[] {
  const requiredUsefulDuration = minimumUsefulDuration(target);
  const result = [...selected];
  const stages = TEMPLATE_STAGES[template];
  const rank = new Map(stages.map((stage, index) => [stage.role, index]));
  const duration = () => result.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0);

  while (duration() < requiredUsefulDuration) {
    let added = false;
    for (const stage of stages) {
      const count = result.filter((segment) => segment.role === stage.role).length;
      if (count >= stage.max) continue;
      const candidate = allSegments
        .filter((segment) => isCompleteSemanticUnit(segment.transcript)
          && isSafeVideoCutBoundary(segment.transcript)
          && isRhythmicallyUsefulDuration(segment, stage.role)
          && scoreForRole(segment.transcript, stage.role) >= minimumRoleScore(stage.role)
          && !result.some((existing) => existing.sourceId === segment.sourceId
            && existing.startSeconds < segment.endSeconds - 0.04
            && segment.startSeconds < existing.endSeconds - 0.04)
          && !result.some((existing) => isNearDuplicate(existing.subtitle, segment.transcript)))
        .map((segment) => ({ segment, score: scoreForRole(segment.transcript, stage.role) }))
        .sort((left, right) => right.score - left.score
          || (right.segment.endSeconds - right.segment.startSeconds) - (left.segment.endSeconds - left.segment.startSeconds))[0]?.segment;
      if (!candidate) continue;
      result.push({
        ...candidate,
        role: stage.role,
        subtitle: buildFaithfulSubtitle(stage.role, candidate.transcript, candidate.transcript),
        cropMode: stage.role === "evidence" ? "evidence" : stage.role === "specification" || stage.role === "price" ? "product" : "speaker",
        reason: `补充完整成交内容中的“${stage.label}”，避免为压缩时长删掉有效表达`
      });
      added = true;
      if (duration() >= requiredUsefulDuration) break;
    }
    if (!added) break;
  }

  return result.sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99));
}

function enforceFinalTimelineIntegrity(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate,
  target: number
): SelectedClipSegment[] {
  const tightened = selected.map((segment) => trimRoleLeadIn(segment));
  // Strong claims stay visible in the review plan. The render route blocks
  // export until the cutter confirms every retained claim; silently removing
  // insurance, compensation, sales or origin here made the edit structurally
  // unlike the authorized human reference and hid the decision from the user.
  const safe = tightened.filter((segment) => isCompleteSemanticUnit(segment.transcript)
    && isSafeVideoCutBoundary(segment.transcript));
  const rhythmicSafe = safe.filter(isRhythmicallyUsefulBeat);
  const restored = restoreRequiredStages(rhythmicSafe, allSegments, template)
    .filter((segment) => isCompleteSemanticUnit(segment.transcript)
      && isSafeVideoCutBoundary(segment.transcript));
  return trimToTarget(extendToTargetDuration(restored, allSegments, template, target), target)
    .filter(isRhythmicallyUsefulBeat);
}

function isRhythmicallyUsefulBeat(segment: SelectedClipSegment): boolean {
  return isRhythmicallyUsefulDuration(segment, segment.role);
}

function isRhythmicallyUsefulDuration(
  segment: Pick<TranscriptSegment, "startSeconds" | "endSeconds">,
  role: string
): boolean {
  const duration = segment.endSeconds - segment.startSeconds;
  // A sub-second optional aside becomes a visible/audio flash cut. Required
  // facts can still be concise, but optional beats must earn a stable shot.
  return !["social_proof", "objection"].includes(role) || duration >= 1.15;
}

function calibrateCommerceVisualRhythm(
  selected: SelectedClipSegment[],
  template: ClipStoryTemplate
): SelectedClipSegment[] {
  if (template !== "evidence_conversion") return selected;
  return selected.map((segment, index) => {
    let cropMode = segment.cropMode;
    if (index === 0) cropMode = "product";
    else if (segment.role === "evidence") cropMode = hasVisibleEvidenceTarget(segment) ? "evidence" : "wide";
    else if (["specification", "social_proof", "price"].includes(segment.role)) cropMode = "product";
    else if (segment.role === "usage") cropMode = "wide";
    else if (segment.role === "action") cropMode = "speaker";
    else if (["benefit", "experience", "objection"].includes(segment.role)) cropMode = "speaker";
    return {
      ...segment,
      cropMode,
      reason: `${segment.reason}；按人工参考片的商品特写—人物—场景节奏分配构图`
    };
  });
}

function hasVisibleEvidenceTarget(segment: Pick<SelectedClipSegment, "visual">): boolean {
  if (segment.visual?.matched) return true;
  const visibleText = `${segment.visual?.summary ?? ""}${segment.visual?.ocrText ?? ""}`;
  return /标签|瓶身|包装|条形码|PICC|人保|保险|赔偿|赔付|认证|文字/.test(visibleText);
}

function hasVisibleProductTarget(segment: Pick<SelectedClipSegment, "visual">): boolean {
  const visibleText = `${segment.visual?.summary ?? ""}${segment.visual?.ocrText ?? ""}`;
  return /商品|产品|油桶|油瓶|瓶身|包装|标签|大豆油|豆油|净含量|5L/i.test(visibleText);
}

function trimRoleLeadIn(segment: SelectedClipSegment): SelectedClipSegment {
  if (segment.role !== "usage") return segment;
  const words = segment.words ?? [];
  if (words.length < 4) return segment;
  const startIndex = words.findIndex((_, index) => /^(?:你是)?(?:炸东西|炒菜|油炸|包饺子|烹饪|凉拌)/.test(
    words.slice(index).map((word) => word.text).join("").replace(/\s+/g, "")
  ));
  if (startIndex <= 0) return segment;
  const trimmedWords = words.slice(startIndex);
  const transcript = trimmedWords.map((word) => word.text).join("").replace(/\s+/g, "").trim();
  if (transcript.length < 6 || !isSafeVideoCutBoundary(transcript)) return segment;
  return {
    ...segment,
    startSeconds: round(trimmedWords[0].startSeconds),
    transcript,
    words: trimmedWords,
    subtitle: buildFaithfulSubtitle(segment.role, transcript, transcript),
    reason: `${segment.reason}；去除不依赖前文的承接语，从明确使用场景开始`
  };
}

function applyConversionRhythm(selected: SelectedClipSegment[], template: ClipStoryTemplate): SelectedClipSegment[] {
  const paced = selected.flatMap((segment) => splitIntoConversionBeats(segment));
  const acceptsAnswerBeat = template === "audience_fit" || template === "question_answer";
  const useful = paced
    .filter((segment) => acceptsAnswerBeat || segment.role !== "answer")
    .filter((segment, index, all) => !all.slice(0, index).some((existing) => existing.role === segment.role
      && isNearDuplicate(existing.subtitle, segment.subtitle)));
  const rank = new Map(TEMPLATE_STAGES[template].map((stage, index) => [stage.role, index]));
  // Keep the conversion order explicit: a later price clause must not stay in
  // the middle of a specification sentence after that sentence is safely split.
  // V8's stable sort preserves the original order of beats within one stage.
  const ordered = useful.sort((left, right) => (rank.get(left.role) ?? 99) - (rank.get(right.role) ?? 99));
  const stageLimits = new Map(TEMPLATE_STAGES[template].map((stage) => [stage.role, stage.max]));
  const stageCounts = new Map<string, number>();
  return ordered.filter((segment) => {
    const limit = stageLimits.get(segment.role);
    if (limit === undefined) return true;
    const count = stageCounts.get(segment.role) ?? 0;
    if (count >= limit) return false;
    stageCounts.set(segment.role, count + 1);
    return true;
  });
}

function splitIntoConversionBeats(segment: SelectedClipSegment): SelectedClipSegment[] {
  const words = segment.words ?? [];
  if (words.length < 2 || segment.role === "objection" || segment.role === "action" || segment.endSeconds - segment.startSeconds <= 3.6) return [segment];

  const groups: Array<Array<{ startSeconds: number; endSeconds: number; text: string }>> = [];
  let current: Array<{ startSeconds: number; endSeconds: number; text: string }> = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };
  for (const word of words) {
    current.push(word);
    const text = joinWords(current);
    if (isNaturalConversionBoundary(text)) flush();
  }
  flush();
  if (groups.length < 2) return [segment];

  const meaningful = groups.filter((group) => {
    const text = joinWords(group);
    const duration = group[group.length - 1].endSeconds - group[0].startSeconds;
    return text.length >= 4 && duration >= 0.5;
  });
  if (meaningful.length < 2) return [segment];

  return meaningful.map((group, index) => {
    const transcript = joinWords(group);
    const classified = classifyRole(transcript);
    const role = index === 0 && segment.role === "hook" ? "hook" : classified;
    return {
      ...segment,
      segmentId: `${segment.segmentId}:beat:${index + 1}`,
      startSeconds: round(group[0].startSeconds),
      endSeconds: round(group[group.length - 1].endSeconds),
      transcript,
      words: group,
      role,
      subtitle: buildFaithfulSubtitle(role, transcript, transcript),
      cropMode: cropForConversionBeat(role, segment.cropMode),
      reason: `${segment.reason}；按完整口播分句拆为成交节奏节点`
    };
  });
}

function joinWords(words: Array<{ text: string }>): string {
  return words.map((word) => word.text).join("").replace(/\s+/g, "").trim();
}

function isNaturalConversionBoundary(text: string): boolean {
  const clean = text.replace(/\s+/g, "").trim();
  if (!/[,\uFF0C.\u3002!\uFF01?\uFF1F;\uFF1B]$/.test(clean)) return false;
  if (!/[\uFF0C,]$/.test(clean)) return true;
  // A comma can be a safe visual beat only for a complete, independent short
  // statement. Do not cut after a connector such as "because" or "therefore".
  if (clean.length < 5) return false;
  return !/(\u56E0\u4E3A|\u6240\u4EE5|\u4F46\u662F|\u800C\u4E14|\u7136\u540E|\u5C31\u662F|\u5982\u679C|\u8FD9\u4E2A|\u90A3\u4E2A)[,\uFF0C]$/.test(clean);
}

function cropForConversionBeat(role: string, original: ClipCropMode): ClipCropMode {
  if (role === "evidence") return "evidence";
  if (role === "hook" || role === "specification" || role === "price") return "product";
  if (role === "usage") return "wide";
  return original === "evidence" || original === "product" ? "speaker" : original;
}

const MAX_CONTINUITY_MERGE_SECONDS = 9.6;
const MAX_CONTINUITY_GAP_SECONDS = 0.42;
const MAX_ASR_BOUNDARY_OVERLAP_SECONDS = 0.32;

/**
 * ASR returns retrieval-friendly fragments and commonly ends them after a
 * comma. A comma is a valid transcription boundary but an unsafe edit point:
 * the following thought is still being spoken. Merge only the immediately
 * adjacent ASR fragments until a terminal sentence boundary is reached.
 */
function repairUnsafeCutBoundaries(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[]
): SelectedClipSegment[] {
  const bySource = new Map<string, TranscriptSegment[]>();
  for (const segment of allSegments) {
    const bucket = bySource.get(segment.sourceId) ?? [];
    bucket.push(segment);
    bySource.set(segment.sourceId, bucket);
  }
  for (const bucket of bySource.values()) bucket.sort((left, right) => left.startSeconds - right.startSeconds);

  const repaired: SelectedClipSegment[] = [];
  for (const original of selected) {
    // A previous repaired segment already owns this exact source interval.
    if (repaired.some((existing) => existing.sourceId === original.sourceId
      && existing.startSeconds < original.endSeconds - 0.04
      && original.startSeconds < existing.endSeconds - 0.04)) continue;

    const merged = mergeUntilSafeCutBoundary(original, bySource.get(original.sourceId) ?? []);
    // The continuation may already have been selected earlier under another
    // sales role. Keep the newly completed thought and remove that overlapping
    // duplicate instead of making the viewer hear its tail twice.
    for (let index = repaired.length - 1; index >= 0; index -= 1) {
      const existing = repaired[index];
      if (existing.sourceId !== merged.sourceId) continue;
      const overlaps = existing.startSeconds < merged.endSeconds - 0.04
        && merged.startSeconds < existing.endSeconds - 0.04;
      if (overlaps) repaired.splice(index, 1);
    }
    repaired.push(merged);
  }
  return repaired;
}

function mergeUntilSafeCutBoundary(
  original: SelectedClipSegment,
  sourceSegments: TranscriptSegment[]
): SelectedClipSegment {
  if (isSafeVideoCutBoundary(original.transcript)) return original;

  let endSeconds = original.endSeconds;
  let transcript = original.transcript;
  let words = [...(original.words ?? [])];
  const usedIds = new Set([original.segmentId]);

  while (!isSafeVideoCutBoundary(transcript)) {
    const next = sourceSegments.find((candidate) => !usedIds.has(candidate.segmentId)
      // File-transcription sentence padding can overlap two neighbouring
      // chunks by ~0.2s. Treat that as the same spoken boundary, not as an
      // unrelated earlier sentence.
      && candidate.startSeconds >= endSeconds - MAX_ASR_BOUNDARY_OVERLAP_SECONDS
      && candidate.startSeconds <= endSeconds + MAX_CONTINUITY_GAP_SECONDS
      && candidate.endSeconds > endSeconds + 0.03
      && candidate.endSeconds - original.startSeconds <= MAX_CONTINUITY_MERGE_SECONDS);
    if (!next) break;
    usedIds.add(next.segmentId);
    endSeconds = Math.max(endSeconds, next.endSeconds);
    transcript = joinTranscript(transcript, next.transcript);
    words = mergeWords(words, next.words ?? []);
  }

  if (endSeconds <= original.endSeconds + 0.03) return original;
  return {
    ...original,
    endSeconds: round(endSeconds),
    transcript,
    words,
    subtitle: buildFaithfulSubtitle(original.role, transcript, transcript),
    reason: `${original.reason}；已合并相邻口播，确保句子说完后再切画面`
  };
}

function isSafeVideoCutBoundary(text: string): boolean {
  const clean = text.replace(/\s+/g, "").trim();
  if (!clean) return false;
  if (/[，,]$/.test(clean)) {
    // File ASR often writes a comma after a self-contained offer even though
    // the seller has completed the capacity, weight and price statement. This
    // exact kind of offer is a safe beat; dependent comma clauses remain unsafe.
    const completeOffer = /(?:五升|\d+升|九斤|\d+斤|一桶)/.test(clean)
      && DIRECT_PRICE_PATTERN.test(clean)
      && !/(?:因为|所以|但是|然后|如果|而且|就是|这个|那个)[，,]$/.test(clean);
    const completeAction = isProductIdentifyingSpeech(clean)
      && /(?:抓紧|放心|能拍|赶紧|直接).{0,12}拍|拍吧/.test(clean)
      && !/(?:因为|所以|但是|然后|如果|而且|就是|这个|那个)[，,]$/.test(clean);
    return completeOffer || completeAction;
  }
  if (/[、；;：:]$/.test(clean)) return false;
  return /[。！？!?]$/.test(clean);
}

function joinTranscript(left: string, right: string): string {
  const first = left.replace(/\s+/g, "").trim();
  const second = right.replace(/\s+/g, "").trim();
  if (!first) return second;
  if (!second) return first;
  return `${first}${second}`;
}

function mergeWords(
  left: Array<{ startSeconds: number; endSeconds: number; text: string }>,
  right: Array<{ startSeconds: number; endSeconds: number; text: string }>
): Array<{ startSeconds: number; endSeconds: number; text: string }> {
  const seen = new Set<string>();
  return [...left, ...right]
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
    .filter((word) => {
      const key = `${word.startSeconds}:${word.endSeconds}:${word.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function ensureProductIdentificationFirst(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[]
): SelectedClipSegment[] {
  if (selected.length === 0) return selected;
  const selectedIds = new Set(selected.map((segment) => segment.segmentId));
  const pool = [...selected, ...allSegments.filter((segment) => !selectedIds.has(segment.segmentId))];
  const candidateWithScore = pool
    .filter((segment) => isCompleteSemanticUnit(segment.transcript)
      && isProductIdentifyingSpeech(segment.transcript))
    .map((segment) => ({
      segment,
      score: productIdentificationScore(segment)
        + describeHighlight(segment, "hook").highlightScore * 0.55
        + (isStrongProductDeclaration(segment.transcript) ? 36 : 0)
    }))
    .sort((a, b) => b.score - a.score)[0];
  const current = selected[0];
  const currentScore = isProductIdentifyingSpeech(current.transcript)
    ? productIdentificationScore(current)
      + describeHighlight(current, "hook").highlightScore * 0.55
      + (isStrongProductDeclaration(current.transcript) ? 36 : 0)
    : Number.NEGATIVE_INFINITY;
  // Product mention alone is insufficient. The first shot must be a concise,
  // direct product statement, not a ten-second explanation that happens to
  // contain the product name somewhere inside it.
  if (!candidateWithScore || (isStrongProductDeclaration(current.transcript)
    && currentScore >= candidateWithScore.score - 5
    && current.endSeconds - current.startSeconds <= 6.5)) return selected;
  const candidate = trimHookLeadIn(candidateWithScore.segment);
  const productHook: SelectedClipSegment = {
    ...candidate,
    role: "hook",
    subtitle: buildFaithfulSubtitle("hook", candidate.transcript, candidate.transcript),
    cropMode: "product",
    reason: "第一句直接说明产品，让观众立即知道在卖什么"
  };
  return [
    productHook,
    ...selected.filter((segment) => segment.segmentId !== candidate.segmentId && segment.role !== "hook")
  ].slice(0, 16);
}

function isProductIdentifyingSpeech(text: string): boolean {
  const clean = text.replace(/\s+/g, "");
  return /(?:东北)?(?:笨榨)?(?:大)?豆油|小豆油|食用油|这(?:一)?(?:款|瓶|桶|袋|盒|件)(?:货|产品|商品)?|这(?:个|是)(?:产品|商品)/.test(clean);
}

function isStrongProductDeclaration(text: string): boolean {
  const clean = text.replace(/\s+/g, "").replace(/^(?:来|看|你看|大家看|所以说)[，,]*/, "");
  return /^(?:(?:咱|我们|这是|这个|这桶|这一桶))?(?:东北)?笨榨大豆油/.test(clean)
    || /^(?:(?:咱|我们|这是|这个|这桶|这一桶))?(?:大豆油|豆油|食用油)[，,。！？!?]/.test(clean);
}

function repairCommerceClosingAction(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate
): SelectedClipSegment[] {
  if (template !== "evidence_conversion" || selected.length === 0) return selected;
  const candidate = allSegments
    .filter((segment) => isCompleteSemanticUnit(segment.transcript)
      && isSafeVideoCutBoundary(segment.transcript)
      && isProductIdentifyingSpeech(segment.transcript)
      && scoreForRole(segment.transcript, "action") >= minimumRoleScore("action"))
    .map((segment) => {
      const text = segment.transcript.replace(/\s+/g, "");
      const proofPenalty = /赔偿|赔付|保险|PICC|人保|保障/.test(text) ? 32 : 0;
      const closingBonus = /(?:抓紧|放心|能拍|赶紧|直接).{0,12}拍.{0,10}(?:豆油|大豆油)|拍吧这豆油/.test(text) ? 34 : 0;
      const duration = segment.endSeconds - segment.startSeconds;
      return { segment, score: scoreForRole(text, "action") + closingBonus - proofPenalty + (duration <= 6.5 ? 8 : 0) };
    })
    .sort((left, right) => right.score - left.score)[0]?.segment;
  if (!candidate) return selected;
  const current = selected.find((segment) => segment.role === "action");
  if (current?.segmentId === candidate.segmentId) return selected;
  const action: SelectedClipSegment = {
    ...candidate,
    role: "action",
    subtitle: buildFaithfulSubtitle("action", candidate.transcript, candidate.transcript),
    cropMode: "speaker",
    reason: "参考人工成片，在最后回到人物带商品的完整行动提示"
  };
  return [
    ...selected.filter((segment) => segment.role !== "action" && segment.segmentId !== candidate.segmentId),
    action
  ].filter((segment, index, all) => all.findIndex((item) => item.segmentId === segment.segmentId) === index)
    .slice(0, 16);
}

function ensureDedicatedEvidenceBeat(
  selected: SelectedClipSegment[],
  allSegments: TranscriptSegment[],
  template: ClipStoryTemplate
): SelectedClipSegment[] {
  if (template !== "evidence_conversion" || selected.some((segment) => segment.role === "evidence")) return selected;
  const candidate = allSegments
    .filter((segment) => isCompleteSemanticUnit(segment.transcript)
      && isSafeVideoCutBoundary(segment.transcript)
      && scoreForRole(segment.transcript, "evidence") >= minimumRoleScore("evidence")
      && /中国人民保险|PICC|人保|赔偿|赔付|标签|保障/.test(segment.transcript)
      && segment.endSeconds - segment.startSeconds <= 6.5
      && !selected.some((existing) => existing.sourceId === segment.sourceId
        && existing.startSeconds < segment.endSeconds - 0.04
        && segment.startSeconds < existing.endSeconds - 0.04)
      && !selected.some((existing) => isNearDuplicate(existing.subtitle, segment.transcript)))
    .map((segment) => {
      const text = segment.transcript.replace(/\s+/g, "");
      const conciseProofBonus = /中国人民保险|PICC|人保/.test(text) ? 28 : 0;
      const visibleCueBonus = /看到没有|看着没有|标签|这几个字值钱/.test(text) ? 14 : 0;
      return { segment, score: scoreForRole(text, "evidence") + conciseProofBonus + visibleCueBonus };
    })
    .sort((left, right) => right.score - left.score)[0]?.segment;
  if (!candidate) return selected;
  const evidence: SelectedClipSegment = {
    ...candidate,
    role: "evidence",
    subtitle: buildFaithfulSubtitle("evidence", candidate.transcript, candidate.transcript),
    cropMode: "evidence",
    reason: "参考人工成片，在产品强开头后单独展示可信标签或保障证据"
  };
  const hookIndex = selected.findIndex((segment) => segment.role === "hook");
  if (hookIndex < 0) return [evidence, ...selected].slice(0, 16);
  return [
    ...selected.slice(0, hookIndex + 1),
    evidence,
    ...selected.slice(hookIndex + 1)
  ].slice(0, 16);
}

/**
 * Different wording does not necessarily mean a new trust proof. For example,
 * “PICC 人保” followed by “中国人民保险，这值钱” repeats the same insurance
 * facet and spends the most valuable opening seconds twice. Keep at most one
 * beat per proof facet while still allowing genuinely different evidence such
 * as compensation, certification, origin, or a test result.
 */
function removeRedundantCommerceBeats(selected: SelectedClipSegment[]): SelectedClipSegment[] {
  const seenFacets = new Set<string>();
  const seenOfferFacts = new Set<string>();
  const kept: SelectedClipSegment[] = [];
  for (const segment of selected) {
    const facets = evidenceFacets(segment.transcript);
    if (segment.role === "evidence" && facets.length > 0 && facets.every((facet) => seenFacets.has(facet))) continue;
    const offerFacts = extractOfferFactTokens(segment.transcript);
    if (["specification", "price"].includes(segment.role)
      && offerFacts.length > 0
      && offerFacts.every((fact) => seenOfferFacts.has(fact))) continue;
    kept.push(segment);
    for (const facet of facets) seenFacets.add(facet);
    for (const fact of offerFacts) seenOfferFacts.add(fact);
  }
  return kept;
}

function evidenceFacets(text: string): string[] {
  const facets: string[] = [];
  if (/PICC|人保|中国人民保险|保险/.test(text)) facets.push("insurance");
  if (/赔偿|赔付|赔款/.test(text)) facets.push("compensation");
  if (/认证|证书|检测|检验|质检/.test(text)) facets.push("certification");
  if (/产地|原产|东北|本地/.test(text)) facets.push("origin");
  if (/销量|卖了|卖出|万桶|万单|回购/.test(text)) facets.push("social-proof");
  return facets;
}

function extractOfferFactTokens(text: string): string[] {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  const number = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千半]+)";
  const patterns = [
    new RegExp(`${number}(?:毫升|ml|升|l)`, "gi"),
    new RegExp(`${number}(?:千克|公斤|kg|斤|两|克|g)`, "gi"),
    new RegExp(`(?:¥|￥)?${number}(?:元|块)(?:[零〇一二两三四五六七八九])?`, "gi")
  ];
  return [...new Set(patterns.flatMap((pattern) => compact.match(pattern) ?? []))];
}

function trimHookLeadIn(segment: TranscriptSegment): TranscriptSegment {
  const words = segment.words ?? [];
  if (words.length < 4) return segment;

  const productIndex = words.findIndex((word) => /(?:豆|油|食用)/.test(word.text));
  if (productIndex < 0) return segment;

  let startIndex = -1;
  for (let index = 0; index < productIndex; index += 1) {
    if (/[，,；;。！？!?]$/.test(words[index].text.trim())) startIndex = index + 1;
  }
  if (startIndex <= 0 || startIndex >= productIndex) return segment;

  const trimmedWords = words.slice(startIndex);
  const trimmedTranscript = trimmedWords.map((word) => word.text).join("").replace(/\s+/g, "").trim();
  if (trimmedTranscript.length < 6 || !isSafeVideoCutBoundary(trimmedTranscript)) return segment;

  return {
    ...segment,
    startSeconds: round(trimmedWords[0].startSeconds),
    transcript: trimmedTranscript,
    words: trimmedWords
  };
}

function productIdentificationScore(segment: TranscriptSegment): number {
  const text = segment.transcript.replace(/\s+/g, "");
  const duration = segment.endSeconds - segment.startSeconds;
  let score = 0;
  if (/(?:东北)?笨榨大豆油/.test(text)) score += 40;
  else if (/大豆油|豆油|食用油/.test(text)) score += 30;
  if (/这|我们|咱|坤哥/.test(text)) score += 5;
  if (duration >= 1.2 && duration <= 6.5) score += 12;
  if (/抓紧|拍|看|不是/.test(text)) score += 5;
  if (/赔偿|赔付|保险|PICC|人保|保障/.test(text)) score += 16;
  if (/看到没有|看着没有|全网|这几个字值钱/.test(text)) score += 8;
  if (/[。！？!?]$/.test(text)) score += 22;
  if (/[，,]$/.test(text) || /(?:我告诉你|你看着|你看看|你把这)$/.test(text)) score -= 28;
  return score;
}

function buildDeterministicPlan(
  segments: TranscriptSegment[],
  template: ClipStoryTemplate,
  targetDurationSeconds: number
): LlmPlanShape {
  const desiredRoles = template === "experience_recommendation"
    ? ["experience", "specification", "usage", "evidence", "price", "action"]
    : template === "audience_fit"
      ? ["hook", "answer", "specification", "evidence", "usage", "action"]
      : template === "question_answer"
        ? ["hook", "answer", "evidence", "experience", "action"]
        : ["hook", "benefit", "experience", "usage", "evidence", "social_proof", "objection", "specification", "price", "action"];
  const used = new Set<string>();
  const selected: NonNullable<LlmPlanShape["selected"]> = [];
  for (const role of desiredRoles) {
    const candidate = segments
      .filter((segment) => !used.has(segment.segmentId))
      .map((segment) => ({ segment, score: selectionScore(segment, role) }))
      .sort((a, b) => b.score - a.score)[0]?.segment;
    if (!candidate) continue;
    used.add(candidate.segmentId);
    selected.push({
      segmentId: candidate.segmentId,
      role,
      subtitle: shortenSubtitle(candidate.transcript),
      cropMode: role === "evidence" ? "evidence" : role === "specification" || role === "price" ? "product" : "speaker",
      reason: `素材内容符合“${role}”段落`
    });
    const duration = selected.reduce((sum, item) => {
      const segment = segments.find((source) => source.segmentId === item.segmentId);
      return sum + (segment ? segment.endSeconds - segment.startSeconds : 0);
    }, 0);
    if (duration >= targetDurationSeconds) break;
  }
  return {
    title: templateLabel(template),
    summary: "按真实口播中的钩子、证据、规格、使用场景和行动提示生成初版时间线。",
    selected,
    assetNeeds: buildFallbackAssetNeeds(selected),
    humanChecklist: []
  };
}

function validateAssetNeeds(input: LlmPlanShape["assetNeeds"], selected: SelectedClipSegment[]): ClipAssetNeed[] {
  const validIds = new Set(selected.map((segment) => segment.segmentId));
  const normalized: ClipAssetNeed[] = (input ?? []).slice(0, 6).map((item, index) => {
    const role: ClipAssetNeed["role"] = item.role === "product" || item.role === "evidence" || item.role === "transition" ? item.role : "usage";
    const requestedSegment = item.insertAfterSegmentId && validIds.has(item.insertAfterSegmentId)
      ? selected.find((segment) => segment.segmentId === item.insertAfterSegmentId)
      : undefined;
    const expectedTimelineRole = role === "usage" ? "usage" : role === "evidence" ? "evidence" : undefined;
    const preferredSegment = expectedTimelineRole ? selected.find((segment) => segment.role === expectedTimelineRole) : undefined;
    const insertAfterSegmentId = requestedSegment && (!expectedTimelineRole || requestedSegment.role === expectedTimelineRole)
      ? requestedSegment.segmentId
      : preferredSegment?.segmentId ?? selected[Math.max(0, selected.length - 2)]?.segmentId ?? "";
    return {
      id: shortText(item.id, 40) || `asset-${index + 1}`,
      role,
      queryZh: shortText(item.queryZh, 60),
      queryEn: shortText(item.queryEn, 80),
      sourcePolicy: item.sourcePolicy === "enterprise" ? "enterprise" as const : "stock" as const,
      insertAfterSegmentId,
      durationSeconds: Math.min(5, Math.max(1.5, Number(item.durationSeconds) || 2.5)),
      reason: shortText(item.reason, 100) || "补充可视化证据或使用场景"
    };
  }).filter((item) => item.queryZh || item.queryEn);
  return normalized.length > 0 ? normalized : buildFallbackAssetNeeds(selected) as ClipAssetNeed[];
}

function mergeVisualAssetNeeds(assetNeeds: ClipAssetNeed[], selected: SelectedClipSegment[]): ClipAssetNeed[] {
  const additions: ClipAssetNeed[] = selected
    .filter((segment) => segment.role === "evidence" && segment.visual && !segment.visual.matched)
    .map((segment, index) => ({
      id: `asset-visual-proof-${index + 1}`,
      role: "evidence" as const,
      queryZh: `与口播对应的真实证据画面：${shortText(segment.transcript, 38)}`,
      queryEn: "",
      sourcePolicy: "enterprise" as const,
      insertAfterSegmentId: segment.segmentId,
      durationSeconds: Math.min(3.5, Math.max(1.8, segment.endSeconds - segment.startSeconds)),
      reason: segment.visual?.reviewReason || "同期画面不能证明口播内容，必须补充匹配画面"
    }));
  const merged = [...additions, ...assetNeeds];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.role}|${item.insertAfterSegmentId}|${item.queryZh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

async function replaceMismatchedEvidence(params: {
  selected: SelectedClipSegment[];
  allSegments: TranscriptSegment[];
  sourcePaths: Record<string, string>;
}): Promise<SelectedClipSegment[]> {
  const mismatchedIndexes = params.selected
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.role === "evidence" && segment.visual && !segment.visual.matched)
    .map(({ index }) => index);
  if (mismatchedIndexes.length === 0) return params.selected;

  const selectedIds = new Set(params.selected.map((segment) => segment.segmentId));
  const candidates = params.allSegments
    .filter((segment) => !selectedIds.has(segment.segmentId)
      && isCompleteSemanticUnit(segment.transcript)
      && isSafeVideoCutBoundary(segment.transcript))
    .map((segment) => ({ segment, score: scoreForRole(segment.transcript, "evidence") }))
    .filter((item) => item.score >= minimumRoleScore("evidence"))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ segment }) => ({
      ...segment,
      role: "evidence",
      subtitle: buildFaithfulSubtitle("evidence", segment.transcript, segment.transcript),
      cropMode: "evidence" as const,
      reason: "口播和同期画面共同提供商品证据"
    }));
  if (candidates.length === 0) return params.selected;

  try {
    const visuals = await analyzeSelectedClipVisuals({ segments: candidates, sourcePaths: params.sourcePaths });
    const replacements: Array<SelectedClipSegment & { visual: NonNullable<SelectedClipSegment["visual"]> }> = candidates
      .flatMap((segment) => {
        const visual = visuals.get(segment.segmentId);
        return visual?.matched ? [{ ...segment, visual }] : [];
      })
      .sort((a, b) => b.visual.matchScore - a.visual.matchScore);
    if (replacements.length === 0) return params.selected;
    let result = [...params.selected];
    for (const index of mismatchedIndexes) {
      const replacement = replacements.shift();
      if (!replacement) break;
      result[index] = replacement;
    }
    if (result.some((segment) => segment.role === "evidence" && segment.visual?.matched)) {
      result = result.filter((segment) => segment.role !== "evidence" || segment.visual?.matched);
    }
    return result;
  } catch {
    return params.selected;
  }
}

async function replaceMismatchedHook(params: {
  selected: SelectedClipSegment[];
  allSegments: TranscriptSegment[];
  sourcePaths: Record<string, string>;
}): Promise<SelectedClipSegment[]> {
  const hookIndex = params.selected.findIndex((segment) => segment.role === "hook" && isVisualClaimSensitive(segment) && !segment.visual?.matched);
  if (hookIndex < 0) return params.selected;
  // Naming the product in the first sentence is a hard story requirement.
  // If its concurrent picture is weak, request a product insert instead of
  // replacing the sentence with a visually stronger but incomplete hook.
  if (isProductIdentifyingSpeech(params.selected[hookIndex].transcript)) return params.selected;
  const selectedIds = new Set(params.selected.map((segment) => segment.segmentId));
  const candidates = params.allSegments
    .filter((segment) => !selectedIds.has(segment.segmentId)
      && isCompleteSemanticUnit(segment.transcript)
      && isSafeVideoCutBoundary(segment.transcript))
    .map((segment) => ({ segment, score: scoreForRole(segment.transcript, "hook") }))
    .filter((item) => item.score >= minimumRoleScore("hook"))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ segment }) => ({
      ...segment,
      role: "hook",
      subtitle: buildFaithfulSubtitle("hook", segment.transcript, segment.transcript),
      cropMode: isProductIdentifyingSpeech(segment.transcript) ? "product" as const : "speaker" as const,
      reason: "开头提出清晰卖点并由同期画面承接"
    }));
  if (candidates.length === 0) return params.selected;
  try {
    const visuals = await analyzeSelectedClipVisuals({ segments: candidates, sourcePaths: params.sourcePaths });
    const replacement = candidates
      .flatMap((segment) => {
        const visual = visuals.get(segment.segmentId);
        return visual?.matched ? [{ ...segment, visual }] : [];
      })
      .sort((a, b) => b.visual.matchScore - a.visual.matchScore)[0];
    if (!replacement) return params.selected;
    const result = [...params.selected];
    result[hookIndex] = replacement;
    return result;
  } catch {
    return params.selected;
  }
}

function isVisualClaimSensitive(segment: Pick<SelectedClipSegment, "role" | "transcript">): boolean {
  // Ordinary visual proof such as pouring, colour, or texture does not need a
  // strong-claim warning. Reserve it for proof statements that need documents.
  return /PICC|人保|人民保险|保险|赔偿|赔付|认证|证书|标签/i.test(segment.transcript);
}

function buildFallbackAssetNeeds(selected: Array<{ segmentId?: string }>): ClipAssetNeed[] {
  const insertAfter = selected[Math.max(0, selected.length - 2)]?.segmentId ?? "";
  return [
    {
      id: "asset-cooking",
      role: "usage",
      queryZh: "家庭厨房 炒菜 食用油 竖屏",
      queryEn: "vertical home cooking with vegetable oil",
      sourcePolicy: "stock",
      insertAfterSegmentId: insertAfter,
      durationSeconds: 2.5,
      reason: "把口播中的烹饪用途变成可见场景"
    },
    {
      id: "asset-product-evidence",
      role: "evidence",
      queryZh: "本商品包装标签与证明特写",
      queryEn: "",
      sourcePolicy: "enterprise",
      insertAfterSegmentId: selected[0]?.segmentId ?? "",
      durationSeconds: 2.5,
      reason: "商品、保险、赔付或标签必须使用企业确认的真实素材"
    }
  ];
}

function buildClaimFlags(selected: SelectedClipSegment[], confirmedFacts: string, llmFlags: LlmPlanShape["claimFlags"]): ClipClaimFlag[] {
  const flagsBySegment = new Map<string, ClipClaimFlag>();
  for (const segment of selected) {
    if (!STRONG_CLAIM_PATTERN.test(segment.transcript)) continue;
    const confirmed = isClaimConfirmed(segment.transcript, confirmedFacts);
    flagsBySegment.set(segment.segmentId, {
      segmentId: segment.segmentId,
      claim: segment.transcript,
      requiresConfirmation: !confirmed,
      reason: confirmed ? "已确认资料中存在对应信息，发布前仍需复核" : "包含价格、销量、保险、赔付、产地或其他强声明"
    });
  }
  for (const item of llmFlags ?? []) {
    if (!item.segmentId || !selected.some((segment) => segment.segmentId === item.segmentId)) continue;
    if (flagsBySegment.has(item.segmentId)) continue;
    flagsBySegment.set(item.segmentId, {
      segmentId: item.segmentId,
      claim: shortText(item.claim, 160),
      requiresConfirmation: item.requiresConfirmation !== false,
      reason: shortText(item.reason, 100) || "模型标记为需要复核的声明"
    });
  }
  return [...flagsBySegment.values()];
}

function isClaimConfirmed(claim: string, facts: string): boolean {
  if (!facts.trim()) return false;
  const tokens = claim.match(/PICC|人保|保险|赔偿|赔付|东北|\d+(?:\.\d+)?/gi) ?? [];
  return tokens.length > 0 && tokens.every((token) => facts.toLowerCase().includes(token.toLowerCase()));
}

function normalizeChecklist(input?: string[]): string[] {
  const defaults = [
    "逐条确认价格、规格、销量、保险、赔付、认证和产地等强声明",
    "校正品牌名、数字、方言和字幕断句",
    "检查每个局部特写没有裁掉人物表情、商品主体或标签",
    "确认补充素材来源和商业使用授权",
    "完整观看一遍音画、节奏和最终行动提示后再导出"
  ];
  const clean = (input ?? []).map((item) => shortText(item, 100)).filter(Boolean);
  return [...new Set([...clean, ...defaults])].slice(0, 8);
}

async function loadCommerceClipSkill(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "mcp-skills", "skills", "commerce-clip-editor"),
    path.resolve(process.cwd(), "..", "..", "mcp-skills", "skills", "commerce-clip-editor")
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
      // Try next root.
    }
  }
  throw new Error("commerce_clip_editor_skill_not_found");
}

function parseJsonObject(raw: string): LlmPlanShape {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("clip_plan_json_missing");
  return JSON.parse(raw.slice(start, end + 1)) as LlmPlanShape;
}

function classifyRole(text: string): string {
  const roles = ["evidence", "benefit", "specification", "usage", "usage_advice", "social_proof", "price", "objection", "experience", "action", "hook", "answer"];
  const best = roles.map((role) => ({ role, score: scoreForRole(text, role) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= minimumRoleScore(best.role) ? best.role : "answer";
}

function scoreForRole(text: string, role: string): number {
  const clean = text.replace(/\s+/g, "");
  const lengthBonus = Math.min(clean.length, 30) / 30;
  if (role === "price") {
    // “退款拿到手”含有“到手”，但不是商品售价。价格段必须出现
    // 明确数字+货币单位，或明确的优惠/到手价表达。
    return DIRECT_PRICE_PATTERN.test(clean) ? 30 + lengthBonus : 0;
  }
  if (role === "benefit") {
    const strongBenefit = /焦黄透亮|嘎嘎香|不糊|省油|少油烟|不腻|更香|方便|省事|口感好|颜色好|质量好/;
    if (!strongBenefit.test(clean)) return 0;
    const contextPenalty = /那时候|小时候|以前|得多香/.test(clean) ? 18 : 0;
    const tangibleBonus = /焦黄透亮|嘎嘎香|不糊|省油|少油烟|不腻|更香|口感好|颜色好/.test(clean) ? 14 : 0;
    return 24 + tangibleBonus + lengthBonus - contextPenalty;
  }
  if (role === "objection") {
    const strongObjection = /南北差异|接受不了|客服|立马.{0,4}解决|退货|不满意|售后|什么问题|有问题/;
    return strongObjection.test(clean) ? 30 + lengthBonus : 0;
  }
  const patterns: Record<string, RegExp> = {
    hook: /看到没有|看着没有|记住|告诉你|你怕啥|抓紧.*拍|不是.*赔偿|这几个字值钱/,
    evidence: /中国人民保险|PICC|人保|赔偿|标签|保障|认证|证明|(?:油|颜色).{0,16}(?:金黄|焦黄|透亮|颜色)|(?:金黄|焦黄|透亮).{0,16}(?:油|颜色)|倒在.{0,8}(?:桶|杯|碗)/,
    specification: /五升|\d+\s*升|\d+\s*斤|九斤|规格|一桶|配料|容量/,
    social_proof: /卖了|卖到|全网|万桶|回头客|一直卖|销量/,
    usage: /炒菜|油炸|炸东西|包饺子|烹饪|凉拌/,
    usage_advice: /建议.{0,8}(?:用|保存|炒|炸)|适合.{0,8}(?:炒|炸|凉拌|烹饪)|怎么用|用来(?:炒|炸|凉拌|烹饪)|保存|开封|注意(?:油|温|火)|不要(?:高温|反复加热|暴晒)/,
    experience: /嘎嘎香|真香|味道|口感|焦黄透亮|颜色|小时候/,
    action: /抓紧.*拍|赶紧.*拍|能拍.*拍|放心.{0,2}拍|下单|拿走|点.*链接|拍下|直接拍/,
    answer: /为什么|因为|问题|适合|解决|所以/,
    objection: /南北差异|接受不了|客服|立马.{0,4}解决|退货|不满意|售后|什么问题|有问题/
  };
  const match = patterns[role]?.test(clean) ?? false;
  if (!match) return 0;
  // A single complete offer often contains both the capacity/weight and the
  // price (for example “5 升、9 斤，69.9”). Keep it eligible for the
  // specification stage instead of incorrectly treating it as price only.
  if (role === "specification" && DIRECT_PRICE_PATTERN.test(clean)) {
    return /五升|\d+\s*升|\d+\s*斤|九斤|规格|一桶|配料|容量/.test(clean)
      ? 20 + lengthBonus
      : 8 + lengthBonus;
  }
  return 20 + lengthBonus;
}

function selectionScore(segment: TranscriptSegment, role: string): number {
  const roleScore = scoreForRole(segment.transcript, role);
  const highlight = describeHighlight(segment, role).highlightScore;
  // The opening benefits most from energy and a tangible on-camera moment.
  // Other stages still prefer good material, but must retain the conversion
  // structure rather than becoming a collection of unrelated exciting clips.
  const referenceAdjustment = role === "experience" && /小时候/.test(segment.transcript)
    ? -16
    : role === "experience" && /嘎嘎香|真香|喷喷香|豆油味|焦黄透亮/.test(segment.transcript)
      ? 12
      : 0;
  return roleScore + (role === "hook" ? highlight * 0.7 : highlight * 0.18) + referenceAdjustment;
}

function minimumUsefulDuration(target: number): number {
  // A 45-second request is a ceiling/rhythm preference, not permission to
  // reinsert repeated facts.  The learned human-reference range is 35–45s.
  // Keep a stronger floor for an explicit 35s cut, but accept a dense 34s+
  // story for the recommended 45s mode.
  if (target <= 35) return target * 0.86;
  if (target <= 45) return target * 0.7;
  return target * 0.75;
}

function rankHighlightCandidates(segments: TranscriptSegment[]): HighlightCandidate[] {
  return segments
    .filter((segment) => isCompleteSemanticUnit(segment.transcript) && isSafeVideoCutBoundary(segment.transcript))
    .map((segment) => {
      const signal = describeHighlight(segment, segment.suggestedRole);
      return {
        segmentId: segment.segmentId,
        score: signal.highlightScore,
        tags: signal.highlightTags,
        rationale: `真实口播中的${signal.highlightTags.join("、") || "完整表达"}`
      };
    })
    .filter((candidate) => candidate.score >= 30)
    .sort((left, right) => right.score - left.score || left.segmentId.localeCompare(right.segmentId))
    .slice(0, 18);
}

function describeHighlight(segment: Pick<TranscriptSegment, "transcript" | "startSeconds" | "endSeconds">, role?: string): { highlightScore: number; highlightTags: string[] } {
  const text = segment.transcript.replace(/\s+/g, "");
  const duration = segment.endSeconds - segment.startSeconds;
  const tags: string[] = [];
  let score = 0;
  if (isCompleteSemanticUnit(text) && isSafeVideoCutBoundary(text)) {
    score += 12;
    tags.push("完整表达");
  }
  if (duration >= 1.1 && duration <= 7.5) score += 8;
  if (/嘎嘎香|真香|太香|好吃|绝了|小时候|喜欢|惊喜|好喝|好用|不腻|焦黄透亮|省油|少油烟/.test(text)) {
    score += 24;
    tags.push("情绪与体验");
  }
  if (/看(?:看|着|到)|来[，,。！!]?$|倒(?:在|出来)|炒菜|炸东西|油炸|演示|实拍|颜色|特写|对比/.test(text)) {
    score += 18;
    tags.push("可视化看点");
  }
  if (/为什么|你怕啥|不是|但是|南北差异|问题|不满意|反而|居然|原来/.test(text)) {
    score += 14;
    tags.push("反差或问题");
  }
  if (/赔偿|赔付|中国人民保险|PICC|人保|保障|标签/.test(text)) {
    score += 18;
    tags.push("可信证据");
  }
  if (/看到没有|看着没有|记住|抓紧|放心.*拍|嘎嘎/.test(text)) {
    score += 12;
    tags.push("表达有力量");
  }
  if (/\d+(?:\.\d+)?\s*(?:元|块|升|斤)|五升|九斤|一桶|到手价|优惠/.test(text)) {
    score += 15;
    tags.push("具体利益点");
  }
  if (/(?:大豆油|豆油|食用油|这(?:款|一桶|个)(?:油|产品|商品)?)/.test(text)) {
    score += 14;
    tags.push("产品直指");
  }
  if (role && ["benefit", "experience", "usage", "evidence", "price", "objection", "hook"].includes(role) && scoreForRole(text, role) >= minimumRoleScore(role)) {
    score += 10;
    tags.push("带货信息");
  }
  if (/^(?:嗯|啊|呃|那个|然后|就是|所以说|对吧)[，,。！!]?/.test(text)) score -= 16;
  if (/小时候/.test(text) && !/(?:豆油|大豆油|食用油)/.test(text)) score -= 18;
  if (text.length < 7 || text.length > 82) score -= 12;
  return {
    highlightScore: Math.max(0, Math.min(100, Math.round(score))),
    highlightTags: [...new Set(tags)].slice(0, 3)
  };
}

function minimumRoleScore(role: string): number {
  return role === "benefit" || role === "price" ? 20 : 18;
}

function normalizeRole(value: string): string {
  const allowed = new Set(["hook", "evidence", "benefit", "specification", "social_proof", "price", "usage", "usage_advice", "experience", "answer", "objection", "action"]);
  return allowed.has(value) ? value : "answer";
}

function normalizeCrop(value?: ClipCropMode): ClipCropMode {
  return value === "speaker" || value === "product" || value === "evidence" ? value : "wide";
}

function shortenSubtitle(value: string): string {
  const clean = value.replace(/[。！？!?；;]/g, "").trim();
  return clean.length <= 36 ? clean : `${clean.slice(0, 35)}…`;
}

function buildFaithfulSubtitle(role: string, transcript: string, requested: string): string {
  const clean = transcript
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/([。！？])[，。！？]+/g, "$1")
    .trim();
  // The subtitle is a transcript display, not ad-copy generation. Keeping it
  // grounded prevents visible words that the viewer never hears. Do not turn
  // a long, valid merged sentence into an ellipsis: the renderer will split
  // it into timed short phrases, while the full text remains reviewable.
  void role;
  void requested;
  return clean.slice(0, 160);
}

function templateLabel(template: ClipStoryTemplate): string {
  if (template === "experience_recommendation") return "体验推荐型粗剪";
  if (template === "audience_fit") return "适合人群型粗剪";
  if (template === "question_answer") return "问题解答型粗剪";
  return "证据成交型粗剪";
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
