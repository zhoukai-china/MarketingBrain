export interface VoiceStyleDocument {
  id: string;
  title: string;
  content: string;
  documentType: string;
}

export interface IpVoiceStyleProfile {
  confidence: "high" | "medium" | "low";
  sourceCount: number;
  habits: string[];
  excerpts: string[];
}

const CATCHPHRASE_CANDIDATES = [
  "我跟你说",
  "我觉得",
  "你看",
  "你想",
  "对吧",
  "是吧",
  "说白了",
  "其实",
  "就是说",
  "所以说",
  "然后呢",
  "这个事",
  "咱们",
  "我就说一点"
];

const STRUCTURE_CANDIDATES = [
  { label: "常用“不是……而是……”做观点转折", pattern: /不是[^。！？\n]{2,36}而是/g },
  { label: "常用“先……再……”推进动作", pattern: /先[^。！？\n]{2,40}再/g },
  { label: "常用“第一/第二”分层说明", pattern: /第一[^。！？\n]{2,80}第二/g }
];

export function buildIpVoiceStyleProfile(documents: VoiceStyleDocument[]): IpVoiceStyleProfile | undefined {
  const recordings = documents.filter(isRecordingDocument);
  if (recordings.length === 0) return undefined;

  const directSpeechByRecording = recordings.map((document) => extractDirectSpeech(document.content));
  const normalizedRecordings = directSpeechByRecording.map((excerpts) => excerpts.join("\n"));
  const phraseHabits = CATCHPHRASE_CANDIDATES
    .map((phrase) => ({
      label: phrase,
      total: normalizedRecordings.reduce((sum, content) => sum + countOccurrences(content, phrase), 0),
      documentCount: normalizedRecordings.filter((content) => content.includes(phrase)).length,
      matches: (value: string) => value.includes(phrase)
    }))
    .filter(({ total, documentCount }) => total >= 2 && documentCount >= 2);
  const structureHabits = STRUCTURE_CANDIDATES
    .map(({ label, pattern }) => ({
      label,
      total: normalizedRecordings.reduce((sum, content) => sum + countPattern(content, pattern), 0),
      documentCount: normalizedRecordings.filter((content) => countPattern(content, pattern) > 0).length,
      matches: (value: string) => countPattern(value, pattern) > 0
    }))
    .filter(({ total, documentCount }) => total >= 2 && documentCount >= 2);
  const stableHabits = [...phraseHabits, ...structureHabits]
    .sort((a, b) => b.documentCount - a.documentCount || b.total - a.total)
    .slice(0, 6);
  const habits = stableHabits.map(({ label }) => label);
  const excerpts = unique(directSpeechByRecording.flat())
    .filter((excerpt) => stableHabits.some((habit) => habit.matches(excerpt)))
    .slice(0, 8);

  if (habits.length === 0) return undefined;

  const directSpeechCharacters = excerpts.join("").replace(/\s/g, "").length;
  const confidence = recordings.length >= 3 && habits.length >= 3 && directSpeechCharacters >= 220 && excerpts.length >= 4
    ? "high"
    : habits.length >= 2 && (directSpeechCharacters >= 100 || excerpts.length >= 2)
      ? "medium"
      : "low";

  return {
    confidence,
    sourceCount: recordings.length,
    habits,
    excerpts
  };
}

export function buildIpVoiceStyleContext(documents: VoiceStyleDocument[]): string | undefined {
  const profile = buildIpVoiceStyleProfile(documents);
  if (!profile) return undefined;

  const confidenceLabel = profile.confidence === "high" ? "高" : profile.confidence === "medium" ? "中" : "低";
  const habits = profile.habits.length ? profile.habits.map((item) => `“${item}”`).join("、") : "尚未识别到稳定口头禅";
  const sampleLines = profile.excerpts.length
    ? profile.excerpts.map((item, index) => `${index + 1}. “${item}”`).join("\n")
    : "暂无可确认的本人原话样本。";

  return [
    "【IP语言声纹｜只约束表达，不提供事实】",
    `可信度：${confidenceLabel}；录音资料：${profile.sourceCount} 条。`,
    `重复表达：${habits}。`,
    "可参考的候选原话片段（只采用与跨录音稳定习惯一致的部分）：",
    sampleLines,
    "使用规则：",
    "1. 仅在替IP本人写第一人称短视频逐字稿、直播话术、朋友圈、私聊回复等可直接说/发的内容时参考；分析报告、经营建议和证据判断保持专业清晰。",
    "2. 模仿句子长短、转折方式、语气和少量口头禅，不照抄样本主题，不把旧录音里的客户、行业、经历和结论带进当前任务。",
    "3. 本轮用户明确的内容主体、目标受众、平台和转化目的优先。用户替客户创作时，只借用IP表达方式，不把IP自己的业务写成客户业务。",
    "4. 多人录音中不得模仿客户或第三方；无法确认说话人时采用自然口语，不声称已经完整复刻。",
    "5. 口头禅每段最多自然出现1次，删除无意义的嗯、啊、重复词和病句，保留个人感但不能降低可读性。",
    "6. 不得根据语言样本虚构IP的身份、案例、数据、立场或承诺。"
  ].join("\n");
}

function isRecordingDocument(document: VoiceStyleDocument): boolean {
  if (document.documentType === "transcript") return true;
  const sample = `${document.title}\n${document.content.slice(0, 1_500)}`;
  return /录音(?:信息|总结|转写)|录制时间|音频时长|参与人数/.test(sample);
}

function extractDirectSpeech(content: string): string[] {
  const normalized = normalizeText(content);
  const candidates: string[] = [];
  for (const match of normalized.matchAll(/[“"]([^“”"\n]{8,120})[”"]/g)) {
    const value = cleanExcerpt(match[1] ?? "");
    if (isUsableExcerpt(value)) candidates.push(value);
  }
  for (const line of normalized.split("\n")) {
    const value = cleanExcerpt(line.replace(/^[-*]\s*/, ""));
    if (/^(?:我|你看|咱们|说白了|其实|所以说|然后呢)/.test(value) && isUsableExcerpt(value)) {
      candidates.push(value);
    }
  }
  return unique(candidates).slice(0, 12);
}

function isUsableExcerpt(value: string): boolean {
  if (value.length < 8 || value.length > 120) return false;
  if (/^(?:录音|内容|核心|本次|用户|主讲人|参与人|总结|结论|待办|建议|问题|项目|时间|时长)/.test(value)) return false;
  if (/https?:\/\/|getnotes\.seek|\*\*|###|\|/.test(value)) return false;
  return /[我你咱这那是要能会不怎为]/.test(value);
}

function cleanExcerpt(value: string): string {
  return value
    .replace(/\([^)]{0,24}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/^[:：\-—\s]+|[:：\-—\s]+$/g, "")
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function countOccurrences(source: string, phrase: string): number {
  return source.split(phrase).length - 1;
}

function countPattern(source: string, pattern: RegExp): number {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
