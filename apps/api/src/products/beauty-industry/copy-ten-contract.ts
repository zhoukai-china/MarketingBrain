// 「内容十件套 V5」正式合同 —— **唯一出处**。
//
// 这份合同同时服务两处，避免出现「两份提示词、逐渐漂移」：
//   ① 货架「文案智能体」（`apps/api/src/routes/marketplace.ts`，core=copy）；
//   ② 兰琪「公域获客 · 美业文案十件套」新卡（LQ-33，`apps/api/src/products/lanqi/copy-kit-service.ts`）。
//
// 用户 2026-09-15 口径：兰琪新增一张卡、独立计费，但**不得复制第二份提示词**。
// 因此提示词与结构校验（十节标题 / 口播六段与字数 / 3 行标题 / 三层话题 / EDL≥4 段 / 违禁词）
// 都收敛到这里，两侧只允许「加一层提问壳」，不允许各自改结构。

/** 十件套的十个章节（顺序即输出顺序）。 */
export const COPY_TEN_SECTIONS = [
  "一、选题策划",
  "二、口播逐字稿",
  "三、访谈话术",
  "四、拍摄脚本",
  "五、拍摄注意事项",
  "六、剪辑EDL",
  "七、发布标题与话题",
  "八、最佳发布时间",
  "九、评论区引导",
  "十、投流建议"
] as const;

export const COPY_TEN_SYSTEM_PROMPT = [
  "你是思潼AI行业智能体平台的「文案智能体」。按「内容十件套 V5」完整交付一套：一、选题策划；二、口播逐字稿；三、访谈话术；四、拍摄脚本；五、拍摄注意事项；六、剪辑EDL；七、发布标题与话题；八、最佳发布时间；九、评论区引导；十、投流建议。",
  "整体交付一份 Markdown，每章用『一、』…『十、』作为章节标题（独占一行，可用加粗如 **一、选题策划** 或 Markdown 标题），顺序与字段名严格按本约定。不要把所有章节塞进同一个表格；章节内部可使用小表格 / 列表 / 代码块：",
  "一、选题策划（选题角度/爆款元素/脚本类型/漏斗层级/内容类型：获客型/人设型/流量型）；",
  "二、口播逐字稿（默认60秒，按 0-3/3-15/15-30/30-45/45-55/55-60 六段，含【动作/情绪】与 >B-roll 切换点，每句≤40字）；",
  "三、访谈话术（招商/获客型：必须给出 5-6 组问答，每组单独一行，开头写【问·情境式/情感式/转折式/引导式/回顾式】+ 问题，下一行【答】+ 答复；人设/流量型可显式标 不适用）；",
  "四、拍摄脚本（固定场景+移动场景+B-roll清单，按场景段落不逐字卡秒）；",
  "五、拍摄注意事项（着装/场景/收音/灯光/状态/禁忌六类清单）；禁忌 用描述性语言（如避免医疗承诺、绝对化用语、诱导私信），不要逐字写出被禁止的词；",
  "六、剪辑EDL（段落/画面/配乐/字幕特效/备注，不写秒区间，≥4段，含 BGM 与字幕规范）；",
  "七、发布标题与话题（必须 3 行标题：『📌 主标题：…』『🔁 备选1：…』『🔁 备选2：…』；三层话题：大流量1-2/精准2-3/行业1-2）；",
  "八、最佳发布时间（推荐+备选+策略）；",
  "九、评论区引导（置顶评论+前10条回复风格+意向转化话术）；",
  "十、投流建议（按内容类型定主渠道：获客型→本地推；流量型→DOU+；人设型→DOU+测爆款+私域。给前置指标/设置/日预算公式）。",
  "严禁在 口播/标题/话题/置顶评论/意向转化话术 中出现：私信、加微信、电话、联系我、找我、留个、扫码领、加我；以及 唯一/保证/100%/根治/彻底/永久；包回本/稳赚/月入过万/零风险/躺赚。",
  "先判断信息是否够用：若「行业/产品卖点」或「目标人群」缺失、敷衍（如乱码、随意字符、与业务无关，或只写了『无/没有/随便/测试/111』之类），或明显无法理解，则不要猜测、不要编造、也不要输出十件套；只输出如下固定格式（第一行必须是「【需补充信息】」，最多 3 条）：\n【需补充信息】\n- 需要补充：…\n- 需要补充：…\n只有关键信息够用时，才输出十件套。",
  "十件套里的客户名、门店名、案例、数据、资质、价格等，凡用户未明确提供的，一律写「待补充」，严禁编造或套用任何真实品牌/客户名称。",
  "输出必须一、…十、十节齐全、每节独立成段；标题必须正好 3 行（主标题 + 2 备选）；若为获客/招商型，访谈话术必须 5-6 组【问·…】，且第十节主投本地推。只输出这套十件套 Markdown，不要输出任何说明、推导或内部评估。"
].join("\n");

/** 结构校验结果：`failures` 为空才算通过（失败即不扣积分，见两侧调用方）。 */
export interface CopyTenParseResult {
  failures: string[];
}

/**
 * 十件套结构校验（货架与兰琪共用）。
 *
 * 它只做「确定性、可复算」的检查，不评价文笔；评分与质量分由 Skill Eval 负责。
 */
export function parseCopyTenContract(text: string): CopyTenParseResult {
  const failures: string[] = [];
  const sections = ["一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、"];
  sections.forEach((s: string) => {
    if (!new RegExp(`(?:^|\\n)(?:#{0,3}\\s*)?(?:[*_]{1,2}\\s*)?(?:\\s*\\|\\s*\\*\\*?\\s*)?${s}`).test(text)) {
      failures.push(`缺少「${s}」章节`);
    }
  });

  // 词数量：口播逐字稿（去动作标记）
  const scriptMatch = /二、[\s\S]*?(?=(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|)?\s*三、|$)/.exec(text);
  const scriptText = scriptMatch ? scriptMatch[0] : "";
  const cleanScript = scriptText.replace(/【[^】]*】/g, "").replace(/>B-roll[^\n]*/g, "").replace(/```/g, "");
  const words = (cleanScript.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) ?? []).length;
  if (words < 150) failures.push(`口播稿过短（${words} 字 < 150）`);
  const longSentence = cleanScript.split(/[。！？；\n]/).map((s) => s.trim()).find((s) => s.length > 40 && !/^[0-9]+[-\s]*[0-9]*\s*秒/.test(s) && !/^【/.test(s) && !/^>/.test(s) && !/^\|/.test(s) && !/^[#-]/.test(s) && !/[|].*[|]/.test(s));
  if (longSentence) failures.push(`口播存在 >40 字单句（${longSentence.slice(0, 24)}…）`);

  // 标题数量
  const titleCount = (text.match(/^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:📌\s*)?主标题|^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:🔁\s*)?备选/gm) ?? []).length;
  if (titleCount < 3) failures.push(`标题不足（${titleCount} < 3，需主标题+2备选）`);

  // 话题三层
  ["大流量", "精准", "行业"].forEach((layer) => {
    if (!new RegExp(layer).test(text)) failures.push(`话题缺少「${layer}」层级`);
  });

  // EDL 段落数（表格行）
  const edlRowCount = countTableRows(text, "段落");
  if (edlRowCount < 4) failures.push(`剪辑EDL 段落不足（${edlRowCount} < 4）`);

  // 访谈问答（招商/获客型需 ≥5 组）
  const contentType = (/(内容类型|content_type)[\s\S]{0,12}?[：:][\s\S]{0,6}?((?:获客型|人设型|流量型))/.exec(text)?.[1]) ?? "";
  if (contentType === "获客型") {
    const qaCount = (text.match(/(?:【问·?|问·)/g) ?? []).length;
    if (qaCount < 5) failures.push(`访谈话术问答不足（${qaCount} < 5）`);
  }

  // 投流渠道错配
  if (contentType === "获客型" && !/本地推/.test(text)) failures.push("获客型应主投本地推，缺失本地推建议");
  if (contentType === "流量型" && !/DOU\+/.test(text)) failures.push("流量型应主投 DOU+，缺失 DOU+ 建议");

  // 违禁词（仅扫 二/七/九，去掉「十、投流」涉及的私信留资设置项）
  // 先剔除模型在“禁忌/严禁/违禁/医疗承诺”等合规说明里复述被禁止词的句子，避免自我命中。
  const scanText = text
    .replace(/十、[\s\S]*$/m, "")
    .split(/\r?\n/)
    .filter((line) => !/严禁|禁忌|违禁|医疗承诺|避免[^，。]{0,12}承诺|绝对化用语|合规提示/.test(line))
    .join("\n");
  if (/私信|加微信|电话|联系我|找我|留个|扫码领|加我/.test(scanText)) failures.push("文案区含违规引导词（私信/加微信/电话/联系我/找我/留个/扫码领/加我）");
  if (/唯一|保证|100%|根治|彻底|永久/.test(scanText)) failures.push("文案区含绝对化用语（唯一/保证/100%/根治/彻底/永久）");
  if (/包回本|稳赚|月入过万|零风险|躺赚/.test(scanText)) failures.push("文案区含承诺类表述（包回本/稳赚/月入过万/零风险/躺赚）");
  return { failures };
}

function countTableRows(text: string, headerCell: string): number {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.trim());
    if (cells.some((c) => c === headerCell)) {
      for (let j = i + 1; j < lines.length; j++) {
        const c2 = splitRow(lines[j]).map((x) => x.trim());
        if (!lines[j].trim().startsWith("|")) break;
        if (c2.every((x) => /^:?-{2,}:?$/.test(x))) continue;
        count++;
      }
      break;
    }
  }
  return count;
}

function splitRow(line: string): string[] {
  const l = line.trim();
  if (!l.startsWith("|") || !l.endsWith("|")) return [];
  return l.slice(1, -1).split("|");
}
