// 输出参考案例（静态示范，不调模型、不消耗积分）
// 内容来源：WorkBuddy 原型 BENCH_HTML，均已脱敏（客户代号 / 模糊化数据）。
// 契约（方案②，用户 2026-09-10 拍板）：
// 1. `REFERENCE_CASES` 是「通用样例」，会被通用行业专区和各行业专区共用，
//    所以一律不得出现行业词（美业 / 美容 / 护理 / 耗卡 / 床位…）。
// 2. 行业专属样例只放 `INDUSTRY_REFERENCE_CASES`，并且**只能按完整 SKU 代码命中**
//    （例如 `meiye__copy`）。通用专区（`ipzone__copy`）永远取第 1 类中性样例。
// 3. 取样例统一走 `referenceCaseForSku(skuCode)`：先看行业专属，再回落到通用。
// 守护回归：pnpm.cmd marketplace:reference-case-neutral-smoke
import { IP_POS_FULL_CASE_HTML } from "./ip-pos-full-case.js";
import { CONTENT_TEN_FULL_CASE_HTML } from "./content-ten-full-case.js";
import { VIDREV_FULL_CASE_HTML } from "./vidrev-full-case.js";
import {
  ipPosCateringSample,
  ipPosBeautySample,
  copyCateringSample,
  copyBeautySample,
  vidrevCateringSample,
  vidrevBeautySample,
  livescriptCateringSample,
  livescriptBeautySample
} from "./industry-samples.js";
export interface ReferenceCaseRow {
  k: string;
  v: string;
}
export interface ReferenceCase {
  title: string;
  input: string;
  rows?: ReferenceCaseRow[];
  html?: string;
}
export const REFERENCE_CASES: Record<string, ReferenceCase> = {
  "ip-pos": {
    title: "IP 定位全案 · 1 分钟速览",
    input: "输入：某手机后市场连锁创始人 · 目标=招商加盟 · 有仓库与数百家门店",
    html: IP_POS_FULL_CASE_HTML
  },
  topic: {
    title: "3 条选题 · 带三关筛选标签",
    input: "输入：本地连锁门店 · 增长期 · 想招加盟商",
    rows: [
      { k: "选题一 · 通过", v: "「开了 8 年店，我为什么劝你别急着开第二家」— 一票否决：老板想看 ✓ 共识层：高 客户精准度：B 端加盟 高 阶段占比：变现期 40%" },
      { k: "选题二 · 通过", v: "「一家店一个月接待 300 组客人，是怎么排班的」— 共识层：中高 精准度：B 端 高 起号期 30%" },
      { k: "选题三 · 否决", v: "「今天带大家看看我们新买的设备」— 否决原因：目标人群（想加盟的人）不关心设备参数，属于自嗨。" }
    ]
  },
  copy: {
    title: "内容十件套 · 完整交付样例（十栏全部展开）",
    input: "输入（5 项）：产品/卖点=到店体验 · 目标人群=怕踩坑、想省心的本地客人 · 平台=抖音+视频号+小红书 · 口播时长=60 秒 · 内容类型=获客型",
    html: CONTENT_TEN_FULL_CASE_HTML
  },
  vidrev: {
    title: "深度复盘 · 完整报告样例（第零章 + 十章全文）",
    input: "输入（4 项）：模式=深度复盘 · 平台=抖音 · 统计周期=2026-08-01～2026-09-07 · 粘贴后台数据表（6 条，列头含标题/时长/播放/点赞/评论/分享/收藏/完播率/咨询量/是否投流/投流金额）",
    html: VIDREV_FULL_CASE_HTML
  },
  livescript: {
    title: "直播话术 · 2 小时完整逐字稿样例（九段 + 双块 + 四附属件）",
    input: "输入：本地连锁品牌（有直营，开放招商） · 招商目标=想开店但没经验的小老板 · 平台=抖音 · 时长=2 小时",
    rows: [
      { k: "① 开场暖场", v: "【口播】两步式自介：先量化入脑（做多久、服务多少人），再共情入心（说你怕踩坑）。【节奏】不卖货，多笑，抛一个钩子。" },
      { k: "② 痛点共鸣", v: "【口播】说出目标人群的苦：没方向、怕被割、怕投进去没回响。【节奏】抛「扣 1」互动，念两条评论。" },
      { k: "③ 首轮塑品", v: "【口播】实力背书 + 单店经营测算（不承诺收益）。【节奏】举卡 / 贴片，数据说话。" },
      { k: "④ 第一轮逼单留资", v: "【口播】领测算表 / 留资的钩子。【节奏】弹小风车 / 置顶关键词，不虚构稀缺。" },
      { k: "⑤ 互动答疑", v: "【口播】念两条评论作答，托举不说教。【节奏】只答合规、正向的问题。" },
      { k: "⑥ 循环塑品（第二轮）", v: "【口播】换角度、换案例再讲一轮，骨架不变。【节奏】每 20 分钟一轮。" },
      { k: "⑦ 案例背书", v: "【口播】讲真实客户体验，只说他怎么说。【节奏】不承诺「你也能这样」。" },
      { k: "⑧ 异议处理", v: "【口播】算账 + 降门槛 + 给路径三连。【节奏】语气像朋友劝你，不急不躁。" },
      { k: "⑨ 锁客收尾", v: "【口播】留资升级 + 口播「投资有风险，加盟需谨慎」。【节奏】收尾不拖，提醒关注。" },
      { k: "四附属件", v: "2 小时节奏表 / 控场执行清单 / 高频应答 5 问 / 开播前检查清单（人货场）。" }
    ]
  },
  liverev: {
    title: "一场直播复盘 · 定量 + 定性",
    input: "输入：2 小时带货直播数据 + 录音",
    rows: [
      { k: "定量", v: "场观 3,200　峰值在线 87　平均停留 1′42″　成交 12 单　转化率 0.38%" },
      { k: "定性 · 话术节奏", v: "主推段语速偏快（每分钟 320 字），价格抛出后未留 3 秒沉默窗口，逼单过急。" },
      { k: "定性 · 冷场点", v: "第 47-53 分钟答疑段出现 6 分钟无互动，需准备 3 个兜底话题。" },
      { k: "迭代带", v: "① 价格后固定沉默 3 秒　② 每轮播加一次「扣关键词」互动　③ 答疑段限 3 分钟。" }
    ]
  },
  sales: {
    title: "1 个场景成交话术 + 异议处理",
    input: "输入：高客单招商 · 客户卡在「再考虑一下」",
    rows: [
      { k: "判断", v: "客户不是不信项目，是怕自己开不出来店 → 卡点是风险预期，不是价格。" },
      { k: "话术", v: "「你担心的不是这 20 万，是这 20 万花完店还没开起来。那我们就先把这个风险拆开：选址谁定、装修谁盯、第一个月客流从哪来…」" },
      { k: "异议处理", v: "「再想想」→ 不追单，改为给出一份同体量门店的首月数据，约定 3 天后复盘。" },
      { k: "合规", v: "全程不承诺收益、不出现「月入 X 万」表述。" }
    ]
  },
  moments: {
    title: "1 条朋友圈 · 可直发",
    input: "输入：本地门店老板 · 想立「懂经营」人设 · 目标=约见",
    rows: [
      { k: "正文", v: "下午在店里看排班表，发现一个规律：周一到周三的预约档期空着大半，周末却怎么排都不够。不是客人少，是节奏没设计好。这周试着把老客的回访节奏往前挪两天，看看能不能把周中的空档填上。做门店就是这样，很多问题不是努力不够，是结构没调对。" },
      { k: "配图建议", v: "一张排班表局部（隐去客人信息）比精修门店图更可信。" },
      { k: "发布时间", v: "周二 20:30-21:30，老板刷手机高峰。" }
    ]
  },
  "ip-pack": {
    title: "IP 增长全链路 · 7 大能力",
    input: "输入：连锁品牌创始人 · 目标=招商",
    rows: [
      { k: "① 定位", v: "经营派 · B 端加盟商 · 记忆板块＝「开过 8 年店、踩过 5 个坑」。" },
      { k: "② 选题 ③ 文案", v: "每月 30 条选题（三关筛选）+ 每条配套可直发文案。" },
      { k: "④ 视频复盘 ⑤ 直播话术 ⑥ 直播复盘", v: "数据归因 → 话术迭代 → 下一场优化，形成闭环。" },
      { k: "⑦ 销售话术", v: "从评论/私信进来的线索，按招商场景走标准跟单脚本。" }
    ]
  }
};
export function referenceCaseFor(coreSkillId: string): ReferenceCase | undefined {
  return REFERENCE_CASES[coreSkillId];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** 只覆盖样例实际用到的 Markdown：标题、粗体、列表、引用、表格和分隔线。 */
function renderSimpleMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let listTag = "";
  let tableLines: string[] = [];

  const flushList = () => {
    if (listTag) {
      html += `</${listTag}>`;
      listTag = "";
    }
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    const cells = tableLines
      .map((line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()))
      .filter((row) => !row.every((cell) => /^-{3,}$/.test(cell)));
    if (cells.length > 0) {
      const head = cells[0];
      const body = cells.slice(1);
      html += `<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:14px">`;
      html += `<thead><tr>${head.map((cell) => `<th style="text-align:left;padding:7px 9px;border:1px solid var(--line);background:var(--glass)">${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
      html += `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td style="padding:7px 9px;border:1px solid var(--line);vertical-align:top;line-height:1.6">${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    tableLines = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const isTableLine = /^\s*\|/.test(line);
    if (!isTableLine) flushTable();

    if (trimmed === "") {
      flushList();
      continue;
    }

    if (isTableLine) {
      flushList();
      tableLines.push(line);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html += `<h${level} style="margin:16px 0 8px;line-height:1.4">${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushList();
      html += `<hr style="border:none;border-top:1px solid var(--line);margin:14px 0" />`;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushList();
      html += `<blockquote style="margin:10px 0;padding:8px 12px;border-left:3px solid var(--accent2);background:var(--glass);line-height:1.6">${inlineMarkdown(trimmed.slice(2))}</blockquote>`;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      if (listTag !== "ul") {
        flushList();
        html += "<ul style=\"margin:8px 0 8px 20px;padding:0\">";
        listTag = "ul";
      }
      html += `<li style="margin:4px 0;line-height:1.6">${inlineMarkdown(unordered[1])}</li>`;
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      if (listTag !== "ol") {
        flushList();
        html += "<ol style=\"margin:8px 0 8px 20px;padding:0\">";
        listTag = "ol";
      }
      html += `<li style="margin:4px 0;line-height:1.6">${inlineMarkdown(ordered[1])}</li>`;
      continue;
    }

    flushList();
    html += `<p style="margin:8px 0;line-height:1.65">${inlineMarkdown(trimmed)}</p>`;
  }

  flushTable();
  flushList();
  return html;
}

/** 把行业校准样例渲染成可直接阅读的轻量 HTML。 */
function markdownReference(title: string, input: string, markdown: string): ReferenceCase {
  return {
    title,
    input,
    html: renderSimpleMarkdown(markdown)
  };
}

/**
 * 行业专区专属样例（方案②的另一半）：行业词只能出现在这里，且只对完整 SKU 生效。
 *
 * 内容来源与通用样例相同（WorkBuddy 原型 BENCH_HTML，已脱敏）。这些正是 2026-09-10
 * 之前被通用内核「借用」、导致通用行业专区看到美业样例的那几条，现在归还给美业专区。
 */
export const INDUSTRY_REFERENCE_CASES: Record<string, ReferenceCase> = {
  "meiye__topic": {
    title: "3 条选题 · 带三关筛选标签",
    input: "输入：美业连锁 · 增长期 · 想招加盟商",
    rows: [
      { k: "选题一 · 通过", v: "「开了 8 年店，我为什么劝你别急着开第二家」— 一票否决：老板想看 ✓ 共识层：高 客户精准度：B 端加盟 高 阶段占比：变现期 40%" },
      { k: "选题二 · 通过", v: "「一家店月耗卡 300 次，是怎么排班的」— 共识层：中高 精准度：B 端 高 起号期 30%" },
      { k: "选题三 · 否决", v: "「今天带大家看看我们的新仪器」— 否决原因：目标人群（想加盟的人）不关心设备参数，属于自嗨。" }
    ]
  },
  "meiye__ip-pos": markdownReference("IP定位智能体 · 美业行业样例", "输入：美业连锁 · 招商加盟", ipPosBeautySample),
  "meiye__copy": markdownReference("文案智能体 · 美业行业样例", "输入：美业门店 · 卖点=不破皮项目 · 目标=引流到店", copyBeautySample),
  "meiye__vidrev": markdownReference("视频复盘智能体 · 美业行业样例", "输入：美业视频后台数据 · 近30天", vidrevBeautySample),
  "meiye__livescript": markdownReference("直播话术智能体 · 美业行业样例", "输入：美业门店 · 带货 · 客单 398", livescriptBeautySample),
  "meiye__moments": {
    title: "1 条朋友圈 · 可直发",
    input: "输入：美业老板 · 想立「懂经营」人设 · 目标=约见",
    rows: [
      { k: "正文", v: "下午在店里看排班表，发现一个规律：周一到周三的床位利用率不到 40%，周末却排不上。不是客人少，是预约节奏没设计好。这周试着把老客的复购周期往前挪两天，看看能不能把周中的空档填上。做门店就是这样，很多问题不是努力不够，是结构没调对。" },
      { k: "配图建议", v: "一张排班表局部（隐去客人信息）比精修门店图更可信。" },
      { k: "发布时间", v: "周二 20:30-21:30，老板刷手机高峰。" }
    ]
  },
  "canyin__topic": {
    title: "3 条选题 · 带三关筛选标签",
    input: "输入：餐饮连锁 · 增长期 · 想招加盟商",
    rows: [
      { k: "选题一 · 通过", v: "「开了 8 年店，我为什么劝你别急着开第二家」— 一票否决：老板想看 ✓ 共识层：高 客户精准度：B 端加盟 高 阶段占比：变现期 40%" },
      { k: "选题二 · 通过", v: "「一家店月翻台 300 次，是怎么排班的」— 共识层：中高 精准度：B 端 高 起号期 30%" },
      { k: "选题三 · 否决", v: "「今天带大家看看我们的新菜单」— 否决原因：目标人群（想加盟的人）不关心菜单样式，属于自嗨。" }
    ]
  },
  "canyin__ip-pos": markdownReference("IP定位智能体 · 餐饮行业样例", "输入：中式快餐连锁 · 招商加盟", ipPosCateringSample),
  "canyin__copy": markdownReference("文案智能体 · 餐饮行业样例", "输入：餐饮门店 · 卖点=现炒快餐 · 目标=本地获客", copyCateringSample),
  "canyin__vidrev": markdownReference("视频复盘智能体 · 餐饮行业样例", "输入：餐饮视频后台数据 · 近30天", vidrevCateringSample),
  "canyin__livescript": markdownReference("直播话术智能体 · 餐饮行业样例", "输入：中式快餐连锁 · 本地生活带货", livescriptCateringSample),
  "canyin__moments": {
    title: "1 条朋友圈 · 可直发",
    input: "输入：餐饮老板 · 想立「懂经营」人设 · 目标=约见",
    rows: [
      { k: "正文", v: "下午在后厨看备料表，发现一个规律：周一到周三的堂食订单空着大半，周末却排不上。不是客人少，是节奏没设计好。这周试着把老客的复购提醒往前挪两天，看看能不能把周中的空档填上。做餐饮就是这样，很多问题不是努力不够，是结构没调对。" },
      { k: "配图建议", v: "一张后厨备料表局部（隐去供应商信息）比精修门头照更可信。" },
      { k: "发布时间", v: "周二 20:30-21:30，老板刷手机高峰。" }
    ]
  }
};

/**
 * 按**完整 SKU 代码**取参考案例：`meiye__copy` 取美业专属样例，
 * `ipzone__copy` 没有专属样例、回落到通用中性的 `copy`。
 */
export function referenceCaseForSku(skuCode: string): ReferenceCase | undefined {
  const scoped = INDUSTRY_REFERENCE_CASES[skuCode];
  if (scoped) return scoped;
  const separator = skuCode.indexOf("__");
  return REFERENCE_CASES[separator < 0 ? skuCode : skuCode.slice(separator + 2)];
}
