// IP 定位工作台「生成前补问」的填空句解析 + 作答组装（纯函数，可用 tsx 直接单测，
// 见 qa-ip-pos/ippos-gap-fill-check.ts）。
//
// 2026-10-02 用户：「这些最好是填空题」——原来 gaps 是一条疑问句（「招商获客每月能投多少预算，
// 重点投哪些城市？」）配一个空白输入框，用户不知道按什么口径答。改成**填空句**：
//   后端 precheck 的 gaps[].sentence 形如「我希望在【目标城市】投放，每月投入【月预算】用于获客」，
//   前端把【】渲染成一个个小输入框，用户只管把空填上，像填表一样。
// 兜底：模型没给填空句（或退回旧问句）时，parseGapSentence 退化成单段纯文本，UI 走原来的自由输入框。

/** 与后端 IpPosGap 对应。sentence 是填空句（首选）；question 是旧版问句（兜底）。 */
export interface IpPosGap {
  area: string;
  sentence?: string;
  question?: string;
}

/** 答案解析后的片段：纯文本 / 一个待填的空。 */
export type GapPart =
  | { kind: "text"; text: string }
  | { kind: "blank"; label: string; blankIndex: number };

/** 取一句话来展示：优先填空句，退回问句。 */
export function gapText(g: IpPosGap | null | undefined): string {
  return ((g?.sentence ?? "").trim()) || ((g?.question ?? "").trim());
}

/**
 * 把填空句切成「文本 / 空」片段。`【xx】` 视为一个空；没有 `【】` 时退化为单段纯文本
 * （UI 据此判定走填空还是走自由输入）。blankIndex 是空在句中出现的序号（0 起），
 * 与用户作答数组按下标对齐。
 */
export function parseGapSentence(sentence: string): GapPart[] {
  const src = (sentence ?? "").trim();
  if (!src) return [];
  const parts: GapPart[] = [];
  const re = /【([^】]{1,24})】/g;
  let last = 0;
  let blankIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push({ kind: "text", text: src.slice(last, m.index) });
    parts.push({ kind: "blank", label: m[1].trim(), blankIndex: ++blankIndex });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ kind: "text", text: src.slice(last) });
  // 全是空格（且确实解析出空）才返回；否则视为纯文本
  return parts.length ? parts : [{ kind: "text", text: src }];
}

/** 一句话里有多少个空。0 = 不是填空句（走自由输入）。 */
export function blankCount(sentence: string): number {
  return parseGapSentence(sentence).filter((p) => p.kind === "blank").length;
}

/** 该句是否是填空句（有 ≥1 个空）。 */
export function isFillSentence(sentence: string): boolean {
  return blankCount(sentence) > 0;
}

/**
 * 组装一条 gap 的作答，供 `【预采集补充】` 用：
 * - 全空 → ""（不贡献）；
 * - 填空句且全填 → 还原成整句（读起来最自然）；
 * - 填空句只填了一部分 → 只报「名词：值」（避免拼出「我希望在投放」这种病句）；
 * - 非填空句（旧问句）→ 取第一个自由输入值。
 */
export function assembleGapAnswer(g: IpPosGap | null | undefined, fills: string[] | undefined): string {
  const parts = parseGapSentence(gapText(g));
  const blanks = parts.filter((p): p is Extract<GapPart, { kind: "blank" }> => p.kind === "blank");
  if (blanks.length === 0) {
    return ((fills?.[0] ?? "").trim()) || "";
  }
  const vals = blanks.map((b) => (fills?.[b.blankIndex] ?? "").trim());
  if (vals.every((v) => !v)) return "";
  if (vals.every((v) => v)) {
    return parts.map((p) => (p.kind === "text" ? p.text : vals[p.blankIndex])).join("");
  }
  return blanks
    .map((b, i) => (vals[i] ? `${b.label}：${vals[i]}` : ""))
    .filter(Boolean)
    .join("、");
}

/** 一次性把全部 gaps 的作答拼成补充串（分号连接，供 briefToSlotAnswers 用）。 */
export function assembleGapSupplement(gaps: IpPosGap[], fills: Record<number, string[]>): string {
  return gaps
    .map((g, i) => {
      const ans = assembleGapAnswer(g, fills[i]);
      return ans ? `${g.area}：${ans}` : "";
    })
    .filter(Boolean)
    .join("；");
}

/* ------------------------------------------------------------------ *
 * 2026-10-03 合并面板（用户：「这两个合并成一个，都按第二个填空的方式」）
 * 原来「生成前体检的问题」和「预测的运营缺口」是两块独立面板，前者是疑问句、后者是填空句。
 * 现在后端让 issues 也产出填空句，前端用一个纯函数把两者拼成同一个列表，交给同一个
 * 填空面板渲染——体检项排在前面（先把基础信息补扎实），运营缺口排后面。
 * ------------------------------------------------------------------ */

/** 后端 /precheck issues[] 的前端投影（只取渲染需要的字段）。 */
export interface PrefillIssue {
  slot: string;
  verdict: "weak" | "missing";
  /** 填空句（优先）；模型没给或不合规时为空 → 该条退回自由输入。 */
  sentence?: string;
  /** 兜底追问文案。 */
  followup: string;
}

/** 合并面板里的一条：source=check 是体检补强，source=gap 是预测的运营缺口。 */
export interface PrefillItem extends IpPosGap {
  source: "check" | "gap";
  verdict?: "weak" | "missing";
  slot?: string;
}

/**
 * 把体检 issues 与运营缺口 gaps 合并成同一个填空面板的数据。
 * - 体检项 area 用槽位中文名（slotLabel 回调提供），sentence 必须是含【】的填空句，
 *   否则置空让 UI 退回自由输入（question 兜底成 followup）；
 * - 同 area 只保留第一条（体检优先），避免面板里出现两条一样的。
 */
export function mergePrefills(
  issues: PrefillIssue[],
  gaps: IpPosGap[],
  slotLabel?: (slot: string) => string
): PrefillItem[] {
  const out: PrefillItem[] = [];
  const seen = new Set<string>();
  const push = (item: PrefillItem) => {
    const area = item.area.trim();
    const text = gapText(item);
    if (!area || !text) return;
    if (seen.has(area)) return;
    seen.add(area);
    out.push({ ...item, area });
  };
  for (const it of issues) {
    const sentence = isFillSentence(it.sentence ?? "") ? it.sentence!.trim() : "";
    push({
      area: (slotLabel?.(it.slot) ?? it.slot) || it.slot,
      sentence,
      question: it.followup,
      source: "check",
      verdict: it.verdict,
      slot: it.slot
    });
  }
  for (const g of gaps) {
    push({ area: g.area, sentence: g.sentence, question: g.question, source: "gap" });
  }
  return out;
}

