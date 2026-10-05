// IP 定位全案「待补」扫描（纯函数 · 可用 node/tsx 直接单测，见 qa-ip-pos/ippos-completion-scan-check.ts）。
//
// 为什么必须归一/截断（2026-10-02 用户反馈：「需用户确认月预算 | 40% | 根本看不出来什么意思」）：
// 提示词让模型在缺信息处写「待补充：需用户确认月预算」这类标记（见 marketplace.ts 的投放红线），
// 真实输出里标记后面常粘着两类垃圾——
//   ① 提示词尾句：`」，不要编造。`（模型把提示词原文连着标记一起写了出来）；
//   ② Markdown 表格竖线：`| 60% |`（标记落在表格单元格里，同一列多行重复同一标记）。
// 原来 `待补充[：:]\s*([^\n]{1,120})` 一路吃到行尾，标签就成了「需用户确认月预算 | 40% |」。
// 现在只取标记后**紧邻的一小段**，遇表格竖线 / 引号 / 句读 / 换行立即截断；再归一掉
// 「需用户确认 / 需要用户提供」这类前缀；同一章节里同一缺口去重并计数（表格多行只出一张卡）。

export interface IpPosPieceMeta {
  no: string;
  title: string;
  sectionKey?: string;
}

/** 只要能拿到 sections 即可（与 IpPosPayload 结构兼容）。 */
export interface IpPosSectionsLike {
  sections?: Record<string, string>;
}

export interface CompletionItem {
  /** 稳定 id：章节 + 去重序号（作为回答的表单 key）。 */
  id: string;
  sectionKey: string;
  sectionTitle: string;
  /** 归一后的「缺什么」：如「月预算」「目标城市」；读不出内容时为兜底文案。 */
  instruction: string;
  /** 标记所在原文片段（表格竖线压成 ·），让用户看懂上下文。 */
  hint: string;
  /** 标记来自 Markdown 表格行——标签往往过短，UI 应把 hint 显示出来。 */
  fromTable: boolean;
  /** 同一章节内同一缺口出现的次数（表格多行重复标记时 > 1）。 */
  count: number;
  /** 填空句：源句把标记位换成哨兵 `__B__` 后切成文本段；长度恒 ≥ 2，空位在段与段之间。 */
  fillParts: string[];
  /** 填空标签（缺什么），用作输入框 placeholder。 */
  fillLabel: string;
}

/** 待补标记：`【待补】` / `【待补：xxx】` / `（待补充）` / `待补充：` */
const MARKER_RE = /【待补(?:充)?】|【待补(?:充)?\s*[:：]\s*([^】]{1,80})】|[（(]\s*待补充\s*[)）]|待补(?:充)?\s*[:：]\s*/g;

/** 标签截断符：表格竖线、引号、句读、括号、换行、强调符…… 遇到即停。 */
const LABEL_STOP = /[\n\r|｜】」』”"'`，,。；;：:！!？?（）()【\[\]…·*]/;

/** 「需用户确认月预算」→「月预算」；「需要用户提供」→ 空（走兜底 + 露原文）。 */
const LABEL_PREFIX_RE = /^(?:需|需要|请)?(?:由)?(?:用户|你|您)?(?:来)?(?:确认|补充|提供|填写|完善|给出|明确|告知)/;

const LEAD_JUNK_RE = /^[\s:：,，、。;；\-–—•·*#>|｜]+/;
const TAIL_JUNK_RE = /[\s:：,，、。;；\-–—•·*#>|｜]+$/;

/** 原文片段里把整个标记段抹成省略号，只留上下文（表格行 → 「· DOU+ · … · 60% ·」）。 */
const MARKER_SEG_RE = /【待补(?:充)?(?:[:：][^】]{0,80})?】|[（(]\s*待补充\s*[)）]|待补(?:充)?\s*[:：]?\s*[^|｜】」』”"'`，,。；;：:！!？?（）()\n\r*·]{0,24}/;

/** 同上但全局：一行里出现第二个标记时也要一起抹掉，否则填空句会露出裸「待补充：xxx」。 */
const MARKER_SEG_ALL_RE = new RegExp(MARKER_SEG_RE.source, "g");

/** 锚定版：量出当前位置「标记 + 紧邻标签」的整段长度，作为填空空位要吃掉的范围。 */
const MARKER_SEG_AT_RE = new RegExp(`^(?:${MARKER_SEG_RE.source})`);

export const GENERIC_INSTRUCTION = "此处需补充具体信息";

function cleanLabel(raw: string): string {
  const flat = raw.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const trimmed = flat.replace(LEAD_JUNK_RE, "").replace(TAIL_JUNK_RE, "");
  const stripped = trimmed.replace(LABEL_PREFIX_RE, "").replace(LEAD_JUNK_RE, "").replace(TAIL_JUNK_RE, "");
  // 归一后不足 2 字 → 原句是「需要用户提供」这类空壳，读不出缺什么：返回空串，
  // 由调用方退成通用话术并展示原文片段（比「需要用户提供」有用得多）。
  return stripped.length >= 2 ? stripped.slice(0, 24) : "";
}

function readLabelAfter(draft: string, from: number): string {
  const rest = draft.slice(from, from + 90);
  const stop = rest.search(LABEL_STOP);
  return cleanLabel(stop >= 0 ? rest.slice(0, stop) : rest);
}

function lineOf(draft: string, index: number): string {
  const start = draft.lastIndexOf("\n", index) + 1;
  let end = draft.indexOf("\n", index);
  if (end < 0) end = draft.length;
  return draft.slice(start, end);
}

/** 扫描全案各章节的待补标记 → 按章节聚成补全问题卡（同章节同缺口已去重计数）。 */
export function scanCompletions(
  payload: IpPosSectionsLike | null | undefined,
  pieces: readonly IpPosPieceMeta[]
): CompletionItem[] {
  const sections = payload?.sections;
  if (!sections) return [];
  const out: CompletionItem[] = [];
  const seen = new Map<string, CompletionItem>();
  for (const meta of pieces) {
    const sectionKey = meta.sectionKey;
    if (!sectionKey) continue;
    const draft = sections[sectionKey];
    if (!draft) continue;
    const sectionTitle = `${meta.no}、${meta.title}`;
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(draft))) {
      const inline = (m[1] ?? "").trim();
      const instruction = inline ? cleanLabel(inline) : readLabelAfter(draft, m.index + m[0].length);
      const lineStart = draft.lastIndexOf("\n", m.index) + 1;
      let lineEnd = draft.indexOf("\n", m.index);
      if (lineEnd < 0) lineEnd = draft.length;
      const line = draft.slice(lineStart, lineEnd);
      const relStart = m.index - lineStart;
      // 空位要连标记后面的标签文字一起吃掉（「待补充：竞品真实成本结构」整段 → 一个空位）。
      // 只吃「待补充：」的话，空位后面会跟着同名标签，和 placeholder 重一次——
      // 2026-10-03 用户截图里右侧栏「挤在一起」的观感主要来自这里。
      const segAt = MARKER_SEG_AT_RE.exec(line.slice(relStart));
      const markerEnd = segAt ? relStart + segAt[0].length : relStart + m[0].length;
      const hint = line
        .replace(/[|｜]/g, " · ")
        .replace(MARKER_SEG_ALL_RE, "…")
        // 清掉提示词泄漏到尾部的零碎（原文成了「…」，跟着的引号/「不要编造。」都不该给用户看）
        .replace(/[」』”"]?\s*[，,]?\s*不要编造[。.！!]?/g, "")
        .replace(/…\s*[」』”"]+/g, "…")
        .replace(/…\s*[。，,.；;]+/g, "…")
        .replace(/(?:…[\s·]*)+…/g, "…")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 72);
      // 填空句：把标记位换成哨兵，再走同样的清洗，切成文本段（段间即空位）。
      let fl = (line.slice(0, relStart) + "__B__" + line.slice(markerEnd))
        .replace(/[|｜]/g, " · ")
        .replace(MARKER_SEG_ALL_RE, "…")
        .replace(/[」』”"]?\s*[，,]?\s*不要编造[。.！!]?/g, "")
        .replace(/…\s*[」』”"]+/g, "…")
        .replace(/…\s*[。，,.；;]+/g, "…")
        .replace(/(?:…[\s·]*)+…/g, "…")
        // 抹除后的粘连整理：「· …·」→「· … ·」；连续分隔符去重；空位两侧留空格。
        .replace(/\s*·\s*…\s*·\s*/g, " · … · ")
        .replace(/(?:\s*·){2,}/g, " · ")
        .replace(/__B__\s*·/g, "__B__ ·")
        .replace(/·\s*__B__/g, "· __B__")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
      const fillParts = fl.split("__B__");
      const key = `${sectionKey}::${(instruction || hint).toLowerCase()}`;
      const exist = seen.get(key);
      if (exist) {
        exist.count += 1;
        continue;
      }
      const item: CompletionItem = {
        id: `${sectionKey}-${out.length}`,
        sectionKey,
        sectionTitle,
        instruction: instruction || GENERIC_INSTRUCTION,
        hint,
        fromTable: /[|｜]/.test(line),
        count: 1,
        fillParts,
        fillLabel: instruction || GENERIC_INSTRUCTION
      };
      seen.set(key, item);
      out.push(item);
    }
  }
  return out;
}

export function groupBySection(items: CompletionItem[]): Record<string, CompletionItem[]> {
  const out: Record<string, CompletionItem[]> = {};
  for (const it of items) (out[it.sectionKey] ??= []).push(it);
  return out;
}

/** UI 是否该把原文片段露出来（表格行 / 标签读不出内容时）。 */
export function shouldShowHint(item: CompletionItem): boolean {
  if (!item.hint) return false;
  return item.fromTable || item.instruction === GENERIC_INSTRUCTION;
}

/** 用户填过的增强项：把对应标记位替换成填写值，保证结果零残留【待补充】。
 *  纯函数（见 qa-ip-pos/ippos-enhance-check.ts）。返回新的 sections，不修改入参。 */
export interface FilledAnswer {
  sectionKey: string;
  /** 归一后的「缺什么」（与 CompletionItem.instruction 一致）。 */
  instruction: string;
  answer: string;
}
export function applyFilledAnswers(
  sections: Record<string, string> | undefined,
  answered: FilledAnswer[]
): Record<string, string> {
  const out: Record<string, string> = { ...(sections ?? {}) };
  for (const { sectionKey, instruction, answer } of answered) {
    if (!out[sectionKey] || !answer.trim()) continue;
    const label = (instruction || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!label) continue;
    // 标记可能带「需用户确认」前缀、引号与「，不要编造。」尾句泄漏，需整段吃掉：
    //   ① 【待补：月预算】        ② 待补充：需用户确认月预算   ③ 待补充：需用户确认目标城市」，不要编造。
    const re = new RegExp(
      `【待补(?:充)?[:：]?\\s*${label}】|待补(?:充)?[:：][^<>\n|｜，。；：」』]{0,40}?${label}(?:，不要编造[。.]?)?`,
      "g"
    );
    out[sectionKey] = out[sectionKey].replace(re, answer);
  }
  return out;
}
