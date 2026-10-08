// IP 定位工作台（/agent/ipzone__ip-pos/workbench）—— 原型对齐版
//
// 视觉与交互**严格对齐原型** ip-pos-workbench-demo-20260924.html（与文案工作台同一套
// cpw- 骨架：舞台栏 / 暗色引导对话 / 浅色工作区 / 分区交付）：
//  - 左：沈定 6 步访谈（一次只问一个维度，每答一轮有「消化回应」digest，答案自动填右侧简报）；
//  - 右：定位简报（8 字段，可点改）+ 全案画布（占位 / ready / 生成中逐张点亮+日志+进度 / 分区交付）。
//
// 后端功能与原对话页同源（这是「不犯错的底线」）：
//  - 生成前体检 /precheck（不扣算力）保留，slot 精确勾销；体检通过才进生成；
//  - 生成走同一个 /market/skus/ipzone__ip-pos/run（buildRunBody 同构 { input }），
//    99 算力固定价（FIXED_PRICE_SKUS），402/409/502/needsInput 处理照旧；
//  - 结构化 payload 本机找回（换账号丢弃）、Word 导出免费。
// 与原型的两处刻意差异：单章「重生成」后端无此能力，不做假按钮；日志末行不写死耗时。

import { useEffect, useRef, useState, Fragment } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { readSessionIdentity } from "../lib/session.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { MallTopbar } from "./MallTopbar.js";
import { chatFlowFor, buildRunBody } from "./chat-flows.js";
import { renderMarkdownHtml } from "./AgentChatPage.js";
import { preprocessIpPosMd, type IpPosPayload } from "./ip-pos-report.js";
// shouldShowHint 仍由纯函数层导出并被 qa-ip-pos 单测覆盖；结果区不再渲染「原文：」一行
// —— 填空句本身已经带上了原位上下文，再显示一遍就是 2026-10-03 那种「挤在一起」。
import { scanCompletions, applyFilledAnswers, type CompletionItem } from "./ip-pos-completions.js";
import { parseGapSentence, isFillSentence, gapText, assembleGapSupplement, mergePrefills, type IpPosGap, type PrefillItem, type PrefillIssue } from "./ip-pos-gaps.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import { IP_POS_PRICE, IP_POS_PATCH_PRICE, IP_POS_UNIT } from "./sku-model.js";
import sitongAvatar from "../assets/sitong-beauty.png";

/* ================= 原型数据（逐字对齐 ip-pos-workbench-demo-20260924） ================= */

/** 定位简报 8 字段（原型口径；6 问访谈覆盖 8 字段，商业模式/IP目标随答随点亮）。 */
const FIELDS: Array<{ key: string; icon: string; label: string }> = [
  { key: "role", icon: "🧭", label: "角色" },
  { key: "project", icon: "🏷️", label: "项目" },
  { key: "biz", icon: "💰", label: "商业模式" },
  { key: "comp", icon: "⚔️", label: "竞争格局" },
  { key: "user", icon: "🎯", label: "目标用户" },
  { key: "founder", icon: "👤", label: "创始人" },
  { key: "goal", icon: "🏁", label: "IP目标" },
  { key: "status", icon: "📊", label: "现状与投入" }
];

/**
 * `digest` = **该选项专属**的「消化回应」。
 * 2026-09-30（用户实测）：第 1 题有 3 个选项，但整题只写了一份 digest（按「连锁品牌总部」写的），
 * 结果选「本地单店老板」也回「明白了——连锁品牌总部」——答非所问。
 * 多选项题必须逐项写 digest；缺省时才回退整题的 digest。
 */
interface QOpt { t: string; d: string; v: Record<string, string>; rec?: boolean; digest?: string }
interface QFlow {
  fields: string[];
  q: string;
  hint: string;
  /** 兜底承接话术：模型生成失败/超时时用它。不引用用户原话，所以只有「已记下」这类通用表述。 */
  digest: string;
  /**
   * 预设候选答案。**只有「角色」这种与行业无关的结构化题才写死**；
   * 涉及行业/业务的题一律留空 —— 由模型按已填字段实时生成。
   * （2026-09-30：原来每题都写死一份「XX贴膜」示例，用户是别的行业时
   *   ①话术对不上 ②点一下就把别人的案例值并进简报，故清空。）
   */
  opts?: QOpt[];
}

const QFLOW: QFlow[] = [
  { fields: ["role"], q: "先确认一下——你是老板本人，还是代运营？品牌是单店还是连锁？", hint: "先识别你是谁，再匹配输出深度。同一个定位需求，不同角色的输出完全不同。",
    digest: "明白了——<b>连锁品牌总部，老板本人出镜</b>。那我按「招商获客型创始人IP」的深度来给你做全案，不讲单店获客那套。",
    opts: [
      { t: "🏭 连锁品牌总部 · 老板本人", d: "示例：品牌总部做招商获客", v: { role: "连锁品牌（总部/加盟体系 · 招商获客向）" }, rec: true,
        digest: "明白了——<b>连锁品牌总部，老板本人出镜</b>。那我按「招商获客型创始人IP」的深度来给你做全案，不讲单店获客那套。" },
      { t: "🏪 本地单店老板", d: "不讲招商、不讲连锁复制", v: { role: "本地单店（老板本人 · 本地获客向）" },
        digest: "明白了——<b>本地单店，老板本人出镜</b>。那我按「本地获客型创始人IP」来做全案：先解决周边到店与转化，不讲招商、不讲连锁复制那套。" },
      { t: "💼 OPC 代运营", d: "帮客户出可交付方案", v: { role: "OPC 运营（代客户操盘 · 方案交付向）" },
        digest: "明白了——<b>你是代运营（OPC），不是老板本人</b>。那我按「能直接交付给客户」的口径来做：人设按客户方老板来立，结论要能讲给他听，落地由你操盘。" }
    ] },
  { fields: ["project"], q: "先说说你的项目吧——叫什么名字？做什么的？现在做到什么阶段了？", hint: "品牌名 + 一句话业务 + 现在到哪一步，一句话说清就行。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你的钱是怎么赚的。" },
  { fields: ["biz"], q: "那你的钱是怎么赚的？客户为什么付钱——一次性消费、加盟费，还是长期复购？客单价大概什么量级？", hint: "模式决定内容往哪引：招商向要打「项目可信」，零售向要打「到店理由」。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊竞品。" },
  { fields: ["comp"], q: "那跟你最较劲的竞争对手是谁？列 1-3 个。关键是——你跟他们比，最不一样的地方是什么？客户凭什么选你、不选他们？", hint: "差异化要有事实支撑，「我们更好」不算。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你的客户。" },
  { fields: ["user"], q: "这个是关键——你的客户长什么样？把你最典型的客户画个像给我：年龄、城市、收入？他们找你之前最痛苦的事是什么？", hint: "能具体到一个真实的人最好，比如上个月成交的那个客户。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你自己。" },
  { fields: ["founder"], q: "现在说说你自己——你的背景、经历、最擅长什么？身上最明显的性格特质？", hint: "背景里「只有你经历过的事」是人设的黄金素材。",
    digest: "收到 ✅ 已记进右侧简报，最后聊聊你的 IP 目标。" },
  { fields: ["goal"], q: "做 IP 你最想拿到什么——获客、招商，还是品牌背书？一年内的具体目标是什么？", hint: "目标决定内容取舍；带个数字最好，比如「今年招商 100 家」。",
    digest: "收到 ✅ 已记进右侧简报，最后一轮聊聊你的现状。" },
  { fields: ["status"], q: "最后一轮——看看你现在的基础。哪个平台有账号、粉丝多少？自己出镜说话自然吗（1-10 分）？一周能投入多少时间？", hint: "这轮决定能力评估的五维打分，卡在哪、从哪起步，都从这里推。",
    digest: "现状收到 ✅ 8 项信息齐了，右边简报你可以过目确认。" }
];

/** 全案 9 件（速览 + 8 章），分区/配色/质量点 gd 全照原型；sectionKey 对应 payload.sections。 */
interface PieceMeta { id: string; no: string; g: string; gt: string; icon: string; title: string; d: string; gd: string; sectionKey?: string }
const PIECES: PieceMeta[] = [
  { id: "p0", no: "⓪", g: "ov", gt: "速览区", icon: "📌", title: "1分钟速览", d: "8 维结论 · 老板先看这张", gd: "速览 8 维齐" },
  { id: "p1", no: "一", g: "pos", gt: "定位区", icon: "🎯", title: "项目定位", d: "一句话定位 + 差异化 + 竞品对比 + 阶段判断", gd: "定位三角校验通过", sectionKey: "positioning" },
  { id: "p2", no: "二", g: "pos", gt: "定位区", icon: "👥", title: "目标用户定位", d: "画像 + JTBD 三层痛点 + 四层漏斗 + 决策旅程", gd: "JTBD 三层痛点齐", sectionKey: "user" },
  { id: "p3", no: "三", g: "per", gt: "人设区", icon: "🧑", title: "IP人设定位", d: "五维模型 + 原型 + 语言正反例 + 记忆板块 + 主页四件套", gd: "领路型60%+同行型40%", sectionKey: "ip" },
  { id: "p4", no: "四", g: "con", gt: "内容区", icon: "🗺️", title: "内容定位", d: "内容使命 + 矩阵四象限 + 平台差异化", gd: "信任40/认知30/连接20/转化10", sectionKey: "content" },
  { id: "p5", no: "五", g: "con", gt: "内容区", icon: "🗂️", title: "选题方向", d: "80条选题库 + TOP10 + 30天日历 + 结尾钩子", gd: "80条 · TOP10 · 30天日历", sectionKey: "topics" },
  { id: "p6", no: "六", g: "gro", gt: "增长区", icon: "💸", title: "投流建议", d: "前置判断 + DOU+ 方案 + 预算分配", gd: "前置门槛通过 · DOU+优先", sectionKey: "ads" },
  { id: "p7", no: "七", g: "gro", gt: "增长区", icon: "📈", title: "IP发展规划", d: "能力评估五维打分 + 三阶段路径 + 第一个月提升计划", gd: "能力评估 25/50", sectionKey: "growth" },
  { id: "p8", no: "八", g: "gro", gt: "增长区", icon: "✅", title: "执行建议", d: "关键成功因素 + 风险红线 + 迭代节奏", gd: "30天执行清单", sectionKey: "execution" }
];
const GNAME: Record<string, string> = { ov: "📌 速览区", pos: "🎯 定位区", per: "🧑 人设区", con: "✍️ 内容区", gro: "🚀 增长区" };
const GCOLOR: Record<string, string> = { ov: "#E8651A", pos: "#2563eb", per: "#7c3aed", con: "#0f8a5f", gro: "#b26a00" };
const GSOFT: Record<string, string> = { ov: "#fdeee2", pos: "#e8effd", per: "#f1eafd", con: "#e6f5ee", gro: "#fff4e0" };

/** 生成日志的 Step 细节行（原型 M 表，逐字）。 */
const STEP_LINES: Record<string, string> = {
  p1: "→ Step1 项目定位 · 定位三角自检：去掉品牌名，套不上任何竞品 ✓",
  p2: "→ Step2 目标用户 · JTBD 三层痛点：功能「开店赚钱」× 情感「怕被坑」× 社会「被当成成功老板」",
  p3: "→ Step3 IP人设 · 五维模型 + 原型判定：领路型 × 同行型组合",
  p5: "→ Step5 选题方向 · 选题库 ≥80 条 · 四象限配比 信任40 / 认知30 / 连接20 / 转化10"
};

const OVERVIEW_ROWS: Array<[string, keyof IpPosPayload["overview"]]> = [
  ["项目定位", "project"],
  ["核心用户", "user"],
  ["IP人设", "persona"],
  ["IP原型", "archetype"],
  ["当前IP状态", "ip_status"],
  ["内容重心", "content_focus"],
  ["首选平台", "platform"],
  ["第一个月核心动作", "month_actions"]
];

/* ---------- 演示模式数据（2026-10-01 用户：进工作台自动演示完整流程） ----------
 * 铁律：演示全程不调任何接口、不写草稿、不消耗算力——纯前端脚本 + 预置模拟数据。
 * 案例沿用测试同款「黔味坊 · 火锅底料」，8 问答案/候选/消化全部贴合该行业。 */
interface DemoStep { values: Record<string, string>; display: string; candidates: string[]; digest: string }
const DEMO_STEPS: DemoStep[] = [
  { display: "🏪 本地单店老板，自己出镜", values: { role: "本地单店（老板本人 · 本地获客向）" },
    candidates: ["🏪 本地单店老板，自己出镜", "🏭 连锁品牌总部做招商", "💼 代运营，帮客户出方案"],
    digest: "明白了——本地单店，老板本人出镜。那我按「本地获客型创始人IP」来做全案：先解决周边到店与转化，不讲招商那套。" },
  { display: "黔味坊 · 手工牛油火锅底料，电商 + 本地商超在铺 12 家", values: { project: "黔味坊 · 手工牛油火锅底料，线上电商 + 本地商超在铺 12 家" },
    candidates: ["手工牛油火锅底料，电商+本地商超", "自营火锅店，堂食为主", "底料代工厂，接品牌订单"],
    digest: "黔味坊这个名字有辨识度，「手工小批量炒制」是稀缺卖点——后面的内容就围绕这两个抓手展开。" },
  { display: "一次性购买 39-69 元，复购靠口味回头客", values: { biz: "一次性购买为主，客单 39-69 元，复购靠口味回头客" },
    candidates: ["一次性购买 39-69 元，靠复购", "订货会 + 加盟费模式", "直播团购冲量，低价走量"],
    digest: "客单不高、靠复购，那内容的重心要打「回头理由」，而不是一次性爆量。" },
  { display: "桥头、秋霞这类大牌；我手工小批量、牛油纯", values: { comp: "桥头、秋霞这类大牌；差异是我手工小批量炒制、牛油纯度高不掺油" },
    candidates: ["桥头、秋霞大牌；我手工小批量", "本地三家作坊；我牛油更纯", "电商白牌；我有后厨背书"],
    digest: "跟大牌硬拼价格没戏，你的胜负手是「看得见的手工锅气」——这个差异化立得住。" },
  { display: "25-40 岁城市家庭客，怕踩雷难吃", values: { user: "25-40 岁城市家庭客，在家煮火锅图方便，最怕踩雷难吃浪费一顿" },
    candidates: ["25-40 岁城市家庭客，怕踩雷", "火锅店采购，看重成本", "送礼人群，看重包装"],
    digest: "家庭客决策快、怕踩雷——内容多给「开锅实测」这种眼见为实的证据。" },
  { display: "12 年火锅后厨主厨，最擅长炒料", values: { founder: "干了 12 年火锅后厨，从切配做到主厨，最擅长炒料，性格直、爱较真" },
    candidates: ["12 年后厨主厨，擅长炒料", "二代接班，懂线上运营", "夫妻店，两人一起出镜"],
    digest: "12 年后厨主厨是黄金素材——「别人卖料，你炒了 12 年料」，人设就立在这。" },
  { display: "商超铺 200 家 + 本地号涨粉 5 万", values: { goal: "一年内本地商超铺到 200 家，抖音本地号涨粉 5 万带门店引流" },
    candidates: ["商超铺货 200 家 + 涨粉 5 万", "招商 30 家县域代理", "打品牌，进 KA 卖场"],
    digest: "目标拆成「铺货 200 家 + 涨粉 5 万」，内容就一条主线：本地信任感。" },
  { display: "抖音 800 粉，出镜 6 分，每周 10 小时", values: { status: "抖音有号 800 粉，出镜说话 6 分，每周能稳定投入 10 小时" },
    candidates: ["抖音 800 粉，6 分，每周 10 小时", "视频号 3000 粉，7 分，每周 6 小时", "还没开号，8 分，全职投入"],
    digest: "800 粉、6 分出镜、每周 10 小时——起步阶段，打法要轻，先跑通再放量。" }
];

/** 模拟交付 payload：结构化 9 件（速览 + 8 章），内容贴合演示案例，全部为演示数据。 */
function buildDemoPayload(): IpPosPayload {
  return {
    meta: { brand: "黔味坊", industry: "食品 · 火锅底料", goal: "本地获客 + 商超铺货", generatedAt: new Date().toISOString() },
    overview: {
      project: "黔味坊 · 手工牛油火锅底料——本地手作底料品牌，靠「看得见的锅气」打差异化",
      user: "25-40 岁城市家庭客：在家煮火锅图方便，怕踩雷难吃",
      persona: "炒了 12 年料的老主厨——直脾气、爱较真、只讲真材实料",
      archetype: "同行型 60% + 领路型 40%",
      ip_status: "起步期：抖音 800 粉，出镜 6 分，每周 10 小时",
      content_focus: "信任 40 · 认知 30 · 连接 20 · 转化 10",
      platform: "抖音（本地号优先，视频号同步分发）",
      month_actions: "「开锅实测」系列 8 条 + 商超探柜 4 条，跑通「到店找货」闭环"
    },
    stats: { topic_total: 80, by_type: { trust: 32, cognitive: 24, connection: 14, conversion: 10 } },
    validation: { passed: true, errors: [] },
    homepage: {
      nickname: "炒料12年的黔味坊老周", avatar: "",
      bio: ["12 年火锅后厨，从切配做到主厨", "现在只做一件事：手工炒好一锅料", "小批量 · 高牛油 · 不掺油，配料表干净", "本地商超能买到的锅气"],
      banner: "别人卖料，我炒了 12 年料"
    },
    tone: {
      positive: "「这锅料我炒了 12 年」——用手艺人的笃定讲细节，用实测画面说话",
      negative: "不说「最好吃」「全网第一」这类空话，不贬低竞品，不承诺功效"
    },
    topics: {
      trust: ["跟拍一锅料的完整炒制：从牛油下锅到出料 42 道工序", "把我们的配料表和大牌并排放，一条条念给你听", "商超货架实拍：教你三秒分辨纯牛油和掺油料", "老顾客回访：这家人用我们的料煮了 30 顿火锅", "后厨第一课：我的炒锅为什么从来不换", "翻车实录：炒糊的那一锅，直接倒了不做货"],
      cognitive: ["牛油和清油底料到底差在哪，一张图看懂", "为什么手工小批量比流水线贵 5 块，贵得值", "辣度不是越辣越好——家庭锅怎么选度数", "底料过期还能不能吃？看这三个信号", "火锅店的味道为什么在家复刻不出来，缺这一步", "麻和辣是两回事：花椒品种决定麻感"],
      connection: ["评论区收集：你家火锅必涮的第一道菜是什么", "粉丝来厂里参观，全程直播一锅料的诞生", "上周炒糊的锅被粉丝起名「糊锅侠」，我认了", "和本地火锅店老板对谈：他们怎么选底料", "晒晒你家的火锅桌，抽 3 人送当月新料", "我师父炒了 30 年料，他的三条规矩我一直守着"],
      conversion: ["本周商超上新：这 12 家门店能买到黔味坊", "家庭装 vs 宴客装怎么选，一张表讲清", "直播间下单 3 个理由：新料现发、坏单包赔", "到店自提立减 5 元，门店位置见主页", "第二件半价：给常煮火锅的家庭算笔账", "企业团餐通道：30 份起送，支持开票"],
      top10: ["跟拍一锅料的完整炒制", "配料表和大牌并排念给你听", "商超货架三秒分辨纯牛油", "老顾客 30 顿回访", "牛油 vs 清油一张图", "手工小批量贵 5 块贵在哪", "火锅店味道在家复刻的秘密", "翻车实录：炒糊的那一锅", "粉丝来厂参观直播", "本周商超上新地图"],
      calendar30: ["W1：开锅实测×2 + 配料表科普×1", "W2：后厨跟拍×1 + 评论区互动×1 + 上新×1", "W3：大牌对比×1 + 回访×1 + 自提促销×1", "W4：粉丝来厂直播 + 月度复盘 + 涨粉总结"]
    },
    sections: {
      positioning: "一句话定位：把 12 年火锅后厨的手艺，装进一袋看得见的牛油底料。\n\n**差异化**：大牌是流水线，黔味坊是小批量手工炒制——牛油纯度高、不掺油，配料表干净到能背下来。\n\n**竞品对比**：桥头/秋霞胜在渠道与价格，我们胜在「锅气的真实性」；对比白牌，我们有真人真后厨可验证。\n\n**阶段判断**：起步期。先做深本地，不急着全国铺。",
      user: "**核心画像**：25-40 岁城市家庭客，双职工，周末在家煮火锅。\n\n**JTBD 三层痛点**：功能层「在家也能煮出店里的味道」；情感层「怕踩雷，一锅料毁一顿饭」；社会层「被朋友夸会生活」。\n\n**四层漏斗**：刷到（锅气画面）→ 记住（炒料 12 年的老周）→ 相信（配料表 + 实测）→ 下单（商超/自提）。\n\n**决策旅程**：看到实拍锅气 → 翻主页看人 → 查配料表 → 找最近的柜。",
      ip: "**五维模型**：专业（后厨 12 年）× 真实（翻车也发）× 稳定（每周 3 更）× 亲和（直脾气）× 稀缺（会炒料的主厨很少出镜）。\n\n**原型**：同行型 60%（跟你一样爱在家煮火锅）+ 领路型 40%（料的事听我的）。\n\n**语言正例**：「这锅料我炒了 12 年」「配料表第二位必须是牛油」。\n\n**语言反例**：「全网最好吃」「秒杀大牌」。\n\n**记忆板块**：炒锅 + 白毛巾 + 一句「锅气不骗人」。\n\n**主页四件套**：昵称「炒料12年的黔味坊老周」；简介四行；背景图炒锅实拍；置顶「一锅料的诞生」。",
      content: "**内容使命**：让本地家庭相信「这袋料 = 店里的锅气」。\n\n**矩阵四象限**：信任 40（实拍/配料表/回访）· 认知 30（选料科普）· 连接 20（评论区/来厂参观）· 转化 10（上新/自提）。\n\n**平台差异化**：抖音主打锅气实拍短视频；视频号放完整版；小红书做配料表科普图文。",
      topics: "选题库共 80 条，四类配比 32/24/14/10（见交付区四类 Tab）。\n\n**TOP 优先级**：跟拍一锅料的完整炒制 > 配料表对比 > 商超货架实拍 > 老顾客 30 顿回访。\n\n**30 天日历**：每周 3 条——周一认知、周三信任、周六连接或转化轮换；每条结尾带「本地这 12 家柜能买到」钩子。",
      ads: "**前置判断**：起步期不建议立刻投流——先让自然流验证内容；800 粉阶段 DOU+ 只加热已验证的信任型内容。\n\n**DOU+ 方案**：单条 100 元试投「本地 + 美食兴趣」人群，ROI > 1.5 再加量。\n\n**预算分配**：月 500 元内；60% 给爆款信任型，40% 给到店转化型。",
      growth: "**能力评估（25/50）**：出镜 6 分 · 内容 5 分 · 运营 4 分 · 投放 3 分 · 供应链 7 分。\n\n**三阶段**：第 1-2 月跑通内容与本地信任 → 第 3-4 月商超联动 + 自提闭环 → 第 5-6 月视频号放量。\n\n**第一个月提升计划**：每天 30 分钟对锅练口播；每周 3 条更新雷打不动；把「配料表」做成固定栏目。",
      execution: "**关键成功因素**：锅气画面的稳定供给（每周集中拍摄半天）；「炒料 12 年」人设每条内容都不断。\n\n**风险红线**：不承诺功效；不贬低竞品品牌；配送破损必须包赔。\n\n**迭代节奏**：每周复盘完播与评论；每月按四象限检一次配比；每季度回访一轮老客户。"
    }
  };
}

/** 槽位映射：原型 8 字段 → 后端 6 槽位（商业模式并入项目、IP目标并入创始人——与 /chat 同口径）。
 *  2026-10-03：反向映射 FIELD_TO_SLOT 随「体检项勾销」一起删除——合并面板后不再按「已补充槽位」勾销。 */
const SLOT_TO_FIELDS: Record<string, string[]> = {
  role: ["role"], project: ["project", "biz"], competition: ["comp"],
  user: ["user"], founder: ["founder", "goal"], stage: ["status"]
};

/**
 * 生成前体检的一条结论（与后端 /precheck 契约一致；sentence 是填空句，见 ip-pos-gaps.ts）。
 * 2026-10-03（用户「这两个合并成一个，都按第二个填空的方式」）：体检结论不再单独渲染成一块
 * 「疑问句清单 + 跳过/按提示补充双按钮」，而是经 mergePrefills 折成 PrefillItem，
 * 和运营缺口一起进同一个填空面板。
 */
type PrecheckIssue = PrefillIssue;

/** 槽位 → 面板左侧标签（复用简报 8 字段的中文名，如 stage → 现状与投入）。 */
function slotLabelOf(slot: string): string {
  const labels = (SLOT_TO_FIELDS[slot] ?? [slot])
    .map((k) => FIELDS.find((f) => f.key === k)?.label)
    .filter((x): x is string => Boolean(x));
  return labels.join(" / ") || slot;
}
/** 生成前预测出的「运营级缺口」类型/填空句解析见 ./ip-pos-gaps.ts（纯函数，可单测）。 */
/** 生成后扫描出的「待补充」项的类型/扫描/分组见 ./ip-pos-completions.ts（纯函数，可单测）。 */
type Phase = "idle" | "ask" | "confirm" | "gen" | "done";
interface ChatMsg { id: number; who: "ai" | "user"; html: string; pending?: boolean; /** 临时消息（如「已恢复对话」提示）：不落草稿——否则每次重进叠一条（2026-09-30 实测）。 */ ephemeral?: boolean }
interface Piece { meta: PieceMeta; bodyHtml: string; plain: string }
/** 演示开始前的一帧状态快照——退出演示时整帧还原（2026-10-01 用户：演示像放视频，退出回到原来的对话）。 */
interface DemoSnapshot {
  messages: ChatMsg[]; brief: Record<string, string>; qi: number; phase: Phase;
  optsQ: number | null; confirmOpts: boolean; genCandidates: { q: number; list: string[] } | null;
  pieces: Piece[]; answerMd: string; consumed: number | null; restored: boolean;
  /** 演示前的本机交付物（如有，退出演示时一并铺回交付区）。 */
  payload: IpPosPayload | null;
}

const RUN_TIMEOUT_MS = 300_000;
const LOG_DELAY_MS = 700;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 把结果正文里的「待补充」标记渲染成低调占位（虚线蓝 chip），不让它像正文内容。
 *  仅在展示层转换，不改 payload / 不改变复制与导出原文。 */
function neutralizeGaps(html: string): string {
  const GAP_RE = /【待补(?:充)?[:：][^】<]{0,40}】|待补(?:充)?[:：][^<>\n]{0,40}/g;
  return html.replace(GAP_RE, (mm) => {
    const label = mm.replace(/【?待补(?:充)?[:：]?/g, "").replace(/】/g, "").trim() || "此处";
    return `<span class="cpw-gap-chip" title="待补充项：${escapeHtml(label)}">（待补充）</span>`;
  });
}

/** 把增强项按章节聚起来（保持 pieces 的章节顺序），供「增强项目」里的章节 tab 使用。
 *  2026-10-03：增强项目由右侧 320px 窄栏改成全宽 + 章节 tab，一次只填一章，不再是长串堆叠。 */
function groupEnhSections(items: CompletionItem[]): Array<{ key: string; title: string; items: CompletionItem[] }> {
  const out: Array<{ key: string; title: string; items: CompletionItem[] }> = [];
  const at = new Map<string, number>();
  for (const c of items) {
    const i = at.get(c.sectionKey);
    if (i === undefined) {
      at.set(c.sectionKey, out.length);
      out.push({ key: c.sectionKey, title: c.sectionTitle, items: [c] });
    } else {
      out[i]!.items.push(c);
    }
  }
  return out;
}

/* ---------- 结构化 payload 本机找回（沿用原实现：按会话指纹隔离） ---------- */
function payloadStoreKey(skuId: string): string {
  return `sitong_ippos_payload_${skuId}`;
}
function savePayloadLocally(skuId: string, payload: IpPosPayload): void {
  try {
    const fp = readSessionIdentity();
    if (!fp) return;
    localStorage.setItem(payloadStoreKey(skuId), JSON.stringify({ fp, payload, savedAt: Date.now() }));
  } catch { /* 存储不可用：不影响主流程 */ }
}
function loadPayloadLocally(skuId: string): IpPosPayload | null {
  try {
    const raw = localStorage.getItem(payloadStoreKey(skuId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { fp?: string; payload?: IpPosPayload };
    if (!saved?.payload || !saved.fp || saved.fp !== readSessionIdentity()) return null;
    return saved.payload;
  } catch { return null; }
}
function buildPayloadMarkdown(p: IpPosPayload): string {
  const ov = OVERVIEW_ROWS.map(([label, key]) => `${label}：${(p.overview?.[key] as string) ?? "—"}`).join("\n");
  const chapters = PIECES.filter((x) => x.sectionKey).map((x) => {
    const body = p.sections?.[x.sectionKey as string]?.trim();
    return body ? `${x.no}、${x.title.replace(/^/, "")}\n${body}` : "";
  }).filter(Boolean);
  return [`${PIECES[0].no} ${PIECES[0].title}`, ov, ...chapters].join("\n\n");
}

/** payload → 交付卡（速览 = overview 表格；章节 = sections Markdown）。 */
function buildPieces(p: IpPosPayload | null, answerMd: string): Piece[] {
  if (p?.overview) {
    const ovHtml = `<table><tr><th style="width:120px">维度</th><th>内容</th></tr>${OVERVIEW_ROWS.map(
      ([label, key]) => `<tr><td>${label}</td><td>${escapeHtml(String(p.overview[key] ?? "—"))}</td></tr>`
    ).join("")}</table>`;
    const ovPlain = OVERVIEW_ROWS.map(([label, key]) => `${label}：${String(p.overview[key] ?? "—")}`).join("\n");
    const out: Piece[] = [{ meta: PIECES[0], bodyHtml: ovHtml, plain: ovPlain }];
    for (const meta of PIECES.slice(1)) {
      const body = (meta.sectionKey && p.sections?.[meta.sectionKey])?.trim() || "";
      out.push({ meta, bodyHtml: body ? renderMarkdownHtml(preprocessIpPosMd(body)) : "<p>—</p>", plain: body });
    }
    return out;
  }
  // 兜底：payload 缺失时从 Markdown 正文按章标题切
  const re = /(?:^|\n)#{0,4}\s*\**\s*(速览|[一二三四五六七八])、\s*([^\n]*)/g;
  const hits: Array<{ key: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerMd))) hits.push({ key: m[1], idx: m.index + (m[0].startsWith("\n") ? 1 : 0), end: re.lastIndex });
  if (hits.length === 0) return [];
  const out: Piece[] = [];
  for (let i = 0; i < hits.length; i++) {
    const meta = hits[i].key === "速览" ? PIECES[0] : PIECES.find((x) => x.no === hits[i].key);
    if (!meta) continue;
    const body = answerMd.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].idx : answerMd.length).trim();
    out.push({ meta, bodyHtml: renderMarkdownHtml(body), plain: body });
  }
  return out;
}

/** 扫描全案各章节里的待补标记，按章节聚成补全问题卡（实现见 ip-pos-completions.ts）。 */
function scanAllCompletions(payload: IpPosPayload | null): CompletionItem[] {
  return scanCompletions(payload, PIECES);
}

export function IpPosWorkbench({ skuId }: { skuId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  /**
   * 演示模式（2026-10-01 用户：进工作台自动演示完整流程）。
   * demoRef 是真源（定时器回调里读）；demoOn 只驱动横幅渲染。
   * 演示 = 纯前端脚本：预置答案/候选/消化/交付数据，不调任何接口、不写草稿、不扣算力。
   */
  const demoRef = useRef(false);
  const [demoOn, setDemoOn] = useState(false);
  const demoTickRef = useRef<number | null>(null);
  /** 演示前的现场快照：退出演示时按这一帧还原（含对话、简报、进度、交付物）。 */
  const demoSnapshotRef = useRef<DemoSnapshot | null>(null);
  const [qi, setQi] = useState(0);
  const [brief, setBrief] = useState<Record<string, string>>({});
  /** brief 的同步镜像：异步生成 hints 时要拿「含本题在内」的最新字段（state 闭包会过期）。 */
  const briefRef = useRef<Record<string, string>>({});
  /** 会话轮次：跳过/重置时 +1，让飞行中的生成回调知道自己已过期、放弃推进。 */
  const runIdRef = useRef(0);
  /** 生成进行中：期间自由输入先不接（AI 还没消化完上一句、也没问出下一句，答了会对不上题）。 */
  const digestingRef = useRef(false);
  /** 模型实时生成的下一题候选：点了先放进输入框，用户改完确认才进简报（模型不直接落库）。 */
  /** 生成候选：q = 属于第几题。只有那道题真的问出来（optsQ 就位）才渲染——先问后荐，不许抢跑。 */
  const [genCandidates, setGenCandidates] = useState<{ q: number; list: string[] } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [optsQ, setOptsQ] = useState<number | null>(null);
  const [confirmOpts, setConfirmOpts] = useState(false);
  const [freeInput, setFreeInput] = useState("");
  const [flashFields, setFlashFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 生成前体检 + 运营缺口：2026-10-03（用户「这两个合并成一个，都按第二个填空的方式」）后
  // 只有一份数据 `gaps`（PrefillItem[]）——体检项（source=check）和运营缺口（source=gap）
  // 折成同一个列表交给同一个填空面板渲染，不再有独立的体检清单/已补充勾销逻辑。
  /** 生成前体检进行中：按钮显示「校验中…」，期间不可重复点击。 */
  const [prechecking, setPrechecking] = useState(false);
  /** 用户明确选择「跳过体检直接生成」后置 true，下一次 startGen 不再跑体检。 */
  const precheckBypassRef = useRef(false);
  /**
   * 上一次体检时的「简报签名」（只含 6 个基础槽位，不含补充内容）。
   * 相同 = 这份简报已经体检过 → 再点生成直接开做，避免无限重复体检。
   */
  const precheckSigRef = useRef("");
  /**
   * 已提交的补充信息快照。面板收起（setGaps([])）后，run 失败重试时若只靠 `gaps` 会算成空串，
   * 用户填过的东西就被默默丢掉了——2026-10-02 用户要求「填了多少都要应用」，这里兜住。
   */
  const gapSuppRef = useRef("");
  /** 「额外补充」在右侧定位简报里的展示内容（点生成后把用户填的固化进来，生成/重试全程保留）。 */
  const [gapSuppView, setGapSuppView] = useState("");

  // 生成前「建议补充」面板（体检补强 + 运营缺口合并，可选，不答也能生成）
  // 2026-10-02：改「填空题」——每条是一个填空句（sentence 里用【】留空），
  // gapFills 按下标存「每个空的作答」数组（gapFills[itemIndex][blankIndex]）。
  const [gaps, setGaps] = useState<PrefillItem[]>([]);
  const [gapFills, setGapFills] = useState<Record<number, string[]>>({});
  // 生成后待补充补全（扫描 payload.sections 的【待补】标记，按章节聚成问题卡）
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionAnswers, setCompletionAnswers] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [completionCost, setCompletionCost] = useState<number | null>(null);
  /** 是否已完成「增强项目」且结果零残留【待补充】（用于结果头展示「已增强」徽标）。 */
  const [enhClean, setEnhClean] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  // 生成中
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logIdx, setLogIdx] = useState(0);
  const [genIdx, setGenIdx] = useState(-1);
  const [genFinished, setGenFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const runResultRef = useRef<{ payload: IpPosPayload | null; answer: string; consumed: number | null } | null>(null);
  const [runSettled, setRunSettled] = useState(false);
  const [logDone, setLogDone] = useState(false);

  // 交付
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [answerMd, setAnswerMd] = useState("");
  const [consumed, setConsumed] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const [tab, setTab] = useState("all");
  /** 结果区一级 tab：交付内容 / 增强项目（2026-10-03 由左右分栏改为全宽切换）。 */
  const [view, setView] = useState<"content" | "enh">("content");
  /** 「增强项目」内当前选中的章节（sectionKey，空串 = 落到第一组）。 */
  const [enhSec, setEnhSec] = useState("");
  const [exporting, setExporting] = useState(false);

  // 简报编辑弹窗
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // 2026-09-29（用户）：编辑弹窗打开后，背景固定、不可滚动。
  useScrollLock(Boolean(editing));

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  function pushMsg(who: "ai" | "user", html: string, pending = false): number {
    // 同步捕获 id：updater 在批处理/重渲染时才执行，读 ref 会撞号（React key 重复告警的根源）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html, pending }]);
    return id;
  }
  /** 模型生成的消化回应回来后，把「正在消化」占位原地替换成最终话术（一次成型，不做中途换话）。 */
  function replaceMsg(id: number, html: string) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, html, pending: false } : m)));
  }
  function later(fn: () => void, ms: number) {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }
  function flash(fields: string[]) {
    setFlashFields(fields);
    later(() => setFlashFields([]), 700);
  }

  useEffect(() => {
    document.title = "IP定位工作台 · 思潼AI商城";
    let cancelled = false;
    // 本机找回：上次生成过的结构化全案直接铺进交付区（指纹不符忽略，不串账号）
    const saved = loadPayloadLocally(skuId);
    if (saved) {
      setPayloadView(saved, null, null, true);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, optsQ, confirmOpts]);

  /*
   * 进页：有草稿就**恢复整个对话**（聊天记录 + 简报 + 进度，2026-09-30 用户要求），
   * 没有才从头开始访谈。restoreDraft 幂等（StrictMode 双跑不产生重复消息）。
   */
  useEffect(() => {
    // 2026-10-01（用户）：**进页一律自动演示**——即使页面上已有用户的对话/简报/交付，
    // 演示也照常从头播（相当于另开一个对话叠在上面，像放视频）；退出演示时整帧还原现场。
    // 快照必须在演示覆盖状态**之前**抓。
    const restored = restoreDraft();
    const payload = loadPayloadLocally(skuId);
    const snap: DemoSnapshot = restored ?? {
      messages: [], brief: {}, qi: 0, phase: "idle", optsQ: null, confirmOpts: false,
      genCandidates: null, pieces: [], answerMd: "", consumed: null, restored: false, payload
    };
    beginDemo(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 定时器只在真正卸载时清理（不能放进带依赖的 effect cleanup：StrictMode 会误清引导定时器）
  useEffect(() => () => {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  /** 对话草稿的 localStorage 键：按 skuId 隔离，换智能体不串台本。 */
  const DRAFT_KEY = `ippos_chat_draft_${skuId}`;

  /** 访谈进行中实时落草稿；生成中不落（正式结果另有 payload 本机找回）。 */
  useEffect(() => {
    if (phase === "gen") return;
    if (demoOn) return; // 演示对话绝不写进真实草稿——停掉演示后干干净净从头开始
    // 空对话不落盘：StrictMode 双跑时挂载初期的空 state 会先于恢复生效，
    // 若此时覆盖写，会把刚读到的真草稿清成空、导致下一次启动恢复失败（实测踩中）。
    if (messages.length === 0) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1,
        phase, qi, optsQ, confirmOpts,
        brief,
        // 「正在消化」占位不落盘：恢复时不能出现一条永远转圈的假消息
        messages: messages.filter((m) => !m.pending && !m.ephemeral),
        genCandidates
      }));
    } catch { /* 存储满等异常忽略：草稿是尽力而为 */ }
  }, [DRAFT_KEY, phase, qi, optsQ, confirmOpts, brief, messages, genCandidates, demoOn]);

  /**
   * 恢复上次对话（2026-09-30 用户：输入到一半关掉页面，下次进来接着聊）。
   * 返回恢复出的**快照**（演示模式退出时按它还原现场）；无草稿返回 null。
   * 幂等：同一次挂载里 StrictMode 双跑结果一致、不重复追加。
   */
  function restoreDraft(): DemoSnapshot | null {
    let d: {
      phase?: string; qi?: number; optsQ?: number | null; confirmOpts?: boolean;
      brief?: Record<string, string>;
      messages?: ChatMsg[];
      genCandidates?: { q: number; list: string[] } | null;
    } | null = null;
    try {
      const raw = localStorage.getItem(`ippos_chat_draft_${skuId}`);
      if (raw) d = JSON.parse(raw);
    } catch { d = null; }
    if (!d || !Array.isArray(d.messages)) return null;
    const msgs = d.messages.filter((m): m is ChatMsg => Boolean(m) && typeof m.id === "number" && typeof m.who === "string" && !m.pending);
    if (msgs.length === 0) return null;
    const maxId = msgs.reduce((acc, m) => Math.max(acc, m.id), 0);
    const brief0 = d.brief ?? {};
    // 「done」不恢复成交付态（交付物另有 payload 找回），落到确认态让用户改简报重生成
    const wasGen = d.phase === "gen" || d.phase === "done";
    const qi0 = Math.min(Math.max(0, Number(d.qi) || 0), QFLOW.length - 1);
    msgIdRef.current = maxId + 2;
    const restoredMsgs: ChatMsg[] = [...msgs, { id: maxId + 1, who: "ai", html: "↩️ 已恢复上次的对话，接着答就行；右侧简报也原样保留。", ephemeral: true }];
    setMessages(restoredMsgs);
    setBrief(brief0); briefRef.current = brief0;
    setQi(qi0);
    if (!wasGen && d.phase === "ask") {
      setPhase("ask");
      setOptsQ(Math.min(Math.max(0, Number(d.optsQ) || qi0), QFLOW.length - 1));
    } else {
      setPhase("confirm"); setConfirmOpts(true); setOptsQ(null);
    }
    if (d.genCandidates && d.genCandidates.q === qi0 && Array.isArray(d.genCandidates.list)) {
      setGenCandidates(d.genCandidates);
    }
    return {
      messages: restoredMsgs, brief: brief0, qi: qi0, phase: wasGen ? "confirm" : ((d.phase as Phase) ?? "ask"),
      optsQ: !wasGen && d.phase === "ask" ? Math.min(Math.max(0, Number(d.optsQ) || qi0), QFLOW.length - 1) : null,
      confirmOpts: wasGen || d.phase !== "ask",
      genCandidates: d.genCandidates && d.genCandidates.q === qi0 ? d.genCandidates : null,
      pieces: [], answerMd: "", consumed: null, restored: false,
      payload: loadPayloadLocally(skuId)
    };
  }

  function setPayloadView(p: IpPosPayload | null, answer: string | null, consumed0: number | null, isRestored: boolean) {
    setPieces(buildPieces(p, answer ?? ""));
    setAnswerMd(answer ?? (p ? buildPayloadMarkdown(p) : ""));
    if (consumed0 != null) setConsumed(consumed0);
    setRestored(isRestored);
    // 还原已交付方案时，若正文里仍残留【待补】标记，也要把"补完"面板挂上（走同一套清洗/去重）。
    if (p) setCompletions(scanAllCompletions(p));
    if (!isRestored) setPhase("done");
  }

  /* ---------- 访谈流（逐字对齐原型话术） ---------- */

  function resetAll(greet: boolean, keepDraft = false) {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    // 退出演示（若在演示中）：后续演示定时器全部作废，恢复真实交互
    demoRef.current = false; setDemoOn(false);
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    setPhase("idle"); setQi(0); setBrief({}); briefRef.current = {}; setGenCandidates(null); runIdRef.current += 1;
    precheckBypassRef.current = false; precheckSigRef.current = ""; gapSuppRef.current = ""; setGapSuppView("");
    setMessages([]); setOptsQ(null); setConfirmOpts(false); setFreeInput("");
    setError(null);
    setGaps([]); setGapFills({}); setCompletions([]); setCompletionAnswers({}); setCompletionCost(null); setCompletionError(null); setEnhClean(false);
    setLogLines([]); setLogIdx(0); setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setAnswerMd(""); setConsumed(null); setRestored(false); setTab("all"); setView("content"); setEnhSec("");
    // 用户主动重置 = 丢弃对话草稿，下次从头开始。演示开局传 keepDraft=true：
    // 演示只是叠在上面的一层，绝不能顺手删掉用户真实的访谈进度（刷新页面就丢了）。
    if (!keepDraft) {
      try { localStorage.removeItem(`ippos_chat_draft_${skuId}`); } catch { /* ignore */ }
    }
    if (greet) {
      pushMsg("ai", `你好，我是<b>沈定</b>，首席定位官 🎯<br>IP 定位我不给你拍脑袋——先用 <b>6 步访谈</b>把信息收齐：<b>一次只问一个维度</b>，你的回答会自动填进右侧「定位简报」。8 项齐了，我出 <b>速览 + 8 章全案</b>（${IP_POS_PRICE} ${IP_POS_UNIT} / 份）。赶时间点下方「AI 先铺底稿，你来逐条确认」。`);
      later(() => askQuestion(0), 600);
    }
  }

  function askQuestion(index: number) {
    setPhase("ask"); setQi(index); setOptsQ(index);
    const q = QFLOW[index];
    pushMsg("ai", `<b>${q.q}</b><br><span class="q-hint">${q.hint || ""}</span>`);
  }

  function applyAnswer(q: QFlow, valueMap: Record<string, string>, displayText: string, digest: string) {
    setOptsQ(null);
    pushMsg("user", escapeHtml(displayText));
    const merged = { ...briefRef.current, ...valueMap };
    briefRef.current = merged;
    setBrief(merged);
    flash(q.fields);
    // 先放「正在消化」动画占位；**等消化成型后再问下一题**——对话原则：上一句没说完，不冒下一句。
    // 模型超时（9s）→ 落兜底话术并推进，不让用户对着三个点干等。
    const fallbackId = pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true);
    setGenCandidates(null);
    const nqi = qi + 1;
    setQi(nqi);
    const next = nqi < QFLOW.length ? { fields: QFLOW[nqi].fields, q: QFLOW[nqi].q, hint: QFLOW[nqi].hint } : null;
    const runId = runIdRef.current;
    digestingRef.current = true;
    void loadGenHints(merged, q.fields[0] ?? "", displayText, next, fallbackId, digest, nqi, runId);
  }

  /**
   * 调后端生成「贴合承接 + 下一题候选」。
   * 生成完成（成功或失败）后**才推进下一题**；用户中途跳过/重置（runId 变化）则放弃推进。
   */
  async function loadGenHints(
    answered: Record<string, string>,
    answeredField: string,
    answeredText: string,
    next: { fields: string[]; q: string; hint: string } | null,
    fallbackMsgId: number,
    fallbackText: string,
    nqi: number,
    runId: number
  ) {
    try {
      const res = await fetch(apiPath("/market/ip-pos/interview-hints"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ answered, answeredField, answeredText, next }),
        // 9 秒拿不到就放弃：落兜底话术照常推进，不让用户对着三个点干等。
        signal: AbortSignal.timeout(9000)
      });
      if (!res.ok) { replaceMsg(fallbackMsgId, escapeHtml(fallbackText)); advanceAfterDigest(nqi, runId); return; }
      const data = (await res.json()) as { digest?: string | null; candidates?: string[] };
      // 生成成功 → 成型；生成失败/为空 → 落回兜底话术。两种都是「一次成型」，无中途换话。
      replaceMsg(fallbackMsgId, escapeHtml(data.digest || fallbackText));
      if (Array.isArray(data.candidates) && data.candidates.length > 0) setGenCandidates({ q: nqi, list: data.candidates });
      advanceAfterDigest(nqi, runId);
    } catch {
      replaceMsg(fallbackMsgId, escapeHtml(fallbackText));
      advanceAfterDigest(nqi, runId);
    }
  }

  /** 消化成型后停顿片刻再问下一题；期间用户跳过/重置（runId 变了）则放弃推进。 */
  function advanceAfterDigest(nqi: number, runId: number) {
    digestingRef.current = false;
    if (runIdRef.current !== runId) return;
    later(() => {
      if (runIdRef.current !== runId) return;
      if (nqi < QFLOW.length) askQuestion(nqi);
      else enterConfirm();
    }, 600);
  }

  function chooseOpt(q: QFlow, o: QOpt) {
    if (demoRef.current) { setError("演示模式中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    if (phase !== "ask") return;
    // 优先用选项自己的消化回应（多选项题必须逐项写），没有才回退整题那份。
    applyAnswer(q, o.v, o.t, o.digest ?? q.digest);
  }

  /** 自由输入：提问中 = 回答当前维度（多字段问题并入首字段）；确认后 = 追加说明。 */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
    if (demoRef.current) { setError("演示模式中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    // 上一句还在消化（模型生成中）：AI 还没问出下一题，这时候答进去会对不上题，先不接。
    if (digestingRef.current) return;
    setFreeInput("");
    if (phase === "ask") {
      const q = QFLOW[qi];
      const vm: Record<string, string> = {};
      q.fields.forEach((f, idx) => {
        vm[f] = idx === 0 ? v : `（含于「${FIELDS.find((x) => x.key === q.fields[0])?.label ?? ""}」）`;
      });
      applyAnswer(q, vm, v, "收到 ✅ 已填进右侧简报，咱们继续。");
    } else if (phase === "confirm") {
      pushMsg("user", escapeHtml(v));
      setBrief((prev) => ({ ...prev, status: [prev.status, v].filter(Boolean).join("；") }));
      pushMsg("ai", "已记录 ✅ 这条会一并写进需求单，点「✓ 确认，开始生成」生效。");
    } else {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录。等这一稿交付后再告诉我，改完可整包重跑。");
    }
  }

  /**
   * 赶时间：跳过访谈，直接进确认态，8 个字段留空、由用户自己在右侧简报里填。
   *
   * 2026-09-30 改：此前这里把每题写死的「XX贴膜」示例值铺进简报——用户若不是手机贴膜行业，
   * 等于把**别人的生意数据**当成自己的填进去，后面整份全案都会跑偏。宁可不填，也不填错的。
   * （等接入模型生成底稿后，这里可以改回「按你的角色铺一份底稿」。）
   */
  function skipGuide() {
    if (demoRef.current) { setError("演示模式中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setConfirmOpts(false);
    setBrief({}); briefRef.current = {}; setGenCandidates(null);
    runIdRef.current += 1;
    setQi(QFLOW.length);
    setPhase("confirm"); setConfirmOpts(true);
    pushMsg("ai", "好，老手通道 🚀 按同类项目先铺了 <b>8 项预填底稿</b>（右侧可逐条点击修改）。确认没问题就点 <b>「✓ 确认，开始生成」</b>。");
  }

  function enterConfirm() {
    setPhase("confirm"); setConfirmOpts(true);
    pushMsg("ai", `8 项信息齐了 ✅ 右侧「定位简报」你过目——<b>没问题就生成</b>：速览 + 8 章全案，一次 <b>${IP_POS_PRICE} ${IP_POS_UNIT}</b>。哪条不对，直接点字段改。`);
  }

  function dismissConfirmOpts() {
    setConfirmOpts(false);
  }

  /* ---------- 演示模式：纯前端脚本走完整流程（不调接口 / 不写草稿 / 不扣算力） ---------- */

  /** 抓当前这一帧（对话/简报/进度/交付物）——演示退出时按它还原。 */
  function captureCurrent(): DemoSnapshot {
    return {
      messages: messages.filter((m) => !m.pending && !m.ephemeral),
      brief: { ...briefRef.current }, qi, phase, optsQ, confirmOpts, genCandidates,
      pieces, answerMd, consumed, restored,
      payload: loadPayloadLocally(skuId)
    };
  }

  /** 开播演示：先存快照，再从头播一遍完整流程（不调接口、不写草稿、不扣算力）。 */
  function beginDemo(snap: DemoSnapshot) {
    // 真实生成正在跑：演示会清掉它的定时器与结果展示，等这一稿交付后再看。
    if (phase === "gen" && !demoRef.current) { setError("生成中，等这一稿交付后再看演示。"); return; }
    demoSnapshotRef.current = snap;
    startDemo();
  }

  /** 停止演示 → 清掉全部演示定时器，把演示前那一帧整帧还原（对话/简报/进度/交付全部回到原样）。 */
  function stopDemo() {
    if (!demoRef.current) return;
    const snap = demoSnapshotRef.current;
    demoRef.current = false; setDemoOn(false);
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    demoSnapshotRef.current = null;
    runIdRef.current += 1;

    if (!snap || snap.messages.length === 0) {
      // 演示前是空会话（全新用户）→ 正常开场；有历史交付物则一并铺回交付区
      resetAll(true);
      if (snap?.payload) setPayloadView(snap.payload, null, null, true);
      return;
    }
    const maxId = snap.messages.reduce((acc, m) => Math.max(acc, m.id), 0);
    msgIdRef.current = maxId + 1;
    setMessages(snap.messages);
    setBrief(snap.brief); briefRef.current = snap.brief;
    setQi(snap.qi); setPhase(snap.phase); setOptsQ(snap.optsQ); setConfirmOpts(snap.confirmOpts);
    setGenCandidates(snap.genCandidates);
    setLogLines([]); setLogIdx(0); setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setError(null); setFreeInput(""); setTab("all"); setView("content"); setEnhSec(""); setElapsed(0);
    if (snap.payload) setPayloadView(snap.payload, null, null, true);
    else { setPieces(snap.pieces); setAnswerMd(snap.answerMd); setConsumed(snap.consumed); setRestored(snap.restored); }
  }

  /** 进页自动演示：8 问访谈（候选/消化/简报点亮）→ 确认 → 生成进度 → 模拟全案交付。 */
  function startDemo() {
    resetAll(false, true); // keepDraft：演示是叠上去的一层，真实访谈进度必须原样留在本地
    demoRef.current = true; setDemoOn(true);
    pushMsg("ai", `你好，我是<b>沈定</b>，首席定位官 🎯 先<b>演示一遍</b>这套访谈怎么用——看完点上方「停止演示」，就能按你自己的情况开始。`);
    let t = 1100;
    for (let i = 0; i < QFLOW.length; i++) {
      const q = QFLOW[i];
      const ans = DEMO_STEPS[i];
      later(() => { if (demoRef.current) askQuestion(i); }, t); t += 1100;
      later(() => { if (demoRef.current) setGenCandidates({ q: i, list: ans.candidates }); }, t); t += 1500;
      later(() => {
        if (!demoRef.current) return;
        setGenCandidates(null);
        pushMsg("user", escapeHtml(ans.display));
        const merged = { ...briefRef.current, ...ans.values };
        briefRef.current = merged; setBrief(merged);
        flash(q.fields);
      }, t); t += 850;
      later(() => {
        if (!demoRef.current) return;
        const pid = pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true);
        later(() => { if (demoRef.current) replaceMsg(pid, escapeHtml(ans.digest)); }, 700);
      }, t); t += 1000;
    }
    later(() => {
      if (!demoRef.current) return;
      setOptsQ(null); setPhase("confirm");
      pushMsg("ai", `8 项信息齐了 ✅ 右侧简报就是刚才的演示回答。下方的 <b>「✓ 确认，开始生成」</b> 就是这一步——演示替你点一下：`);
    }, t); t += 1800;
    later(() => { if (demoRef.current) pushMsg("user", "▶ 点了「✓ 确认，开始生成」"); }, t); t += 1800;
    later(() => { if (demoRef.current) runDemoGen(); }, t);
  }

  /** 模拟生成：复用真实生成页的日志/进度渲染，只换数据来源（无 fetch）。 */
  function runDemoGen() {
    setConfirmOpts(false); setPhase("gen"); setElapsed(0);
    setGenIdx(-1); setGenFinished(false); setRunSettled(false); setLogDone(false);
    setPieces([]); setRestored(false);
    const ordered: string[] = [
      `→ 读取定位简报（8/8 字段齐全）· 角色深度：${briefRef.current.role || "—"}`,
      "→ 加载定位方法论 · 五步定位法 · 固定输出结构（速览 + 8 章）"
    ];
    for (const p of PIECES) {
      if (STEP_LINES[p.id]) ordered.push(STEP_LINES[p.id]);
      ordered.push(`✓ ${p.no} ${p.title} —— ${p.gd}`);
    }
    setLogLines([...ordered, "✅ 全案 9 件生成完成 · 已写入交付区（演示数据）"]);
    let li = 0;
    const step = () => {
      if (!demoRef.current) return;
      li += 1;
      setLogIdx(li);
      const ln = ordered[li - 1] ?? "";
      if (ln.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, ln.startsWith("✓") ? 650 : 750);
      else later(() => { if (demoRef.current) finishDemoGen(); }, 900);
    };
    later(step, 300);
    demoTickRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  /** 模拟交付：铺入预置 payload，落在 done 态；明示这是演示数据。 */
  function finishDemoGen() {
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    setGenFinished(true); setLogDone(true);
    const payload = buildDemoPayload();
    setAnswerMd(buildPayloadMarkdown(payload));
    setPieces(buildPieces(payload, ""));
    setConsumed(0); setRestored(false);
    setPhase("done");
    pushMsg("ai", `演示完成 ✅ 右侧就是这套流程能交付的<b>速览 + 8 章全案</b>（用的是示例案例）。点上方 <b>「停止演示」</b>，就能按你自己的情况开始——到时候出来的内容全按你的回答来。`);
  }

  /* ---------- 生成（体检 → /run，后端与原对话页同源） ---------- */

  function briefToSlotAnswers(withSupplement = true): Record<string, string> {
    const base: Record<string, string> = {
      role: (brief.role ?? "").trim(),
      project: [(brief.project ?? "").trim(), (brief.biz ?? "").trim() && `商业模式：${(brief.biz ?? "").trim()}`].filter(Boolean).join("；"),
      competition: (brief.comp ?? "").trim(),
      user: (brief.user ?? "").trim(),
      founder: [(brief.founder ?? "").trim(), (brief.goal ?? "").trim() && `IP目标：${(brief.goal ?? "").trim()}`].filter(Boolean).join("；"),
      stage: (brief.status ?? "").trim()
    };
    // 生成前「建议补充（可选）」里用户填的空，组装成补充信息带入需求单（不答则为空）。
    // 填空句全填→还原整句；只填了一部分→报「名词：值」（见 ip-pos-gaps.ts assembleGapAnswer）。
    // withSupplement=false 用于算「已体检签名」：填空不算改简报，不该触发重新体检。
    // 面板还开着 → 用实时作答；面板已收起（gaps 清空，如 run 失败重试）→ 回落到已提交快照。
    const gapSupp = withSupplement
      ? (gaps.length > 0 ? assembleGapSupplement(gaps, gapFills) : gapSuppRef.current)
      : "";
    return gapSupp ? { ...base, __supplement: `【预采集补充】${gapSupp}` } : base;
  }

  async function startGen() {
    if (demoRef.current) { setError("演示模式中不真实生成——点上方「停止演示」结束演示后再生成（会消耗算力）。"); return; }
    if (phase !== "confirm" || prechecking) return;
    const missing = FIELDS.filter((f) => !(brief[f.key] ?? "").trim()).length;
    if (missing > 0) {
      // 按钮不再 disabled——点了必须有反馈，指明缺哪些，而不是无声无息。
      const missNames = FIELDS.filter((f) => !(brief[f.key] ?? "").trim()).map((f) => f.label).join("、");
      setError(`简报还有 ${missing} 项没填：${missNames}。点右侧简报字段补全后再生成。`);
      return;
    }
    setError(null);

    // 第一关：生成前体检（轻模型、不扣算力）。
    // 2026-09-30（用户）：体检只是「建议」，不许拦人——用户直接放行也不会被挡。
    // 2026-10-02（用户反馈「没看到 3–5 补问」）：体检复用同一次调用多返回一组 gaps（预测运营级缺口）。
    // 2026-10-03（用户「这两个合并成一个，都按第二个填空的方式」）：体检 issues 也改成填空句，
    //   与 gaps 经 mergePrefills 折成**同一个填空面板**（不再有独立清单 + 跳过/按提示补充双按钮）。
    //   ⚠️ 两个坑必须同时堵：
    //   ① setGaps(...) 之后**不能读 state**——同一函数里 gaps 还是旧值（[]），原来
    //      `issues.length > 0 || gaps.length > 0` 恒为 false → 面板永远不出现、直接开跑。
    //      改存局部变量 merged 判条件。
    //   ② 只有补充项时，点「生成」会一直重复体检、永远生不出来（死循环）。
    //      用 precheckSigRef 记住「这份简报已体检过」（只按 6 个基础槽位算签名，填补充项不算改简报），
    //      再点一次就直接开做；简报真改了（签名变）才重新体检。
    const briefSig = JSON.stringify(briefToSlotAnswers(false));
    if (!precheckBypassRef.current && precheckSigRef.current !== briefSig) {
      setPrechecking(true);
      let issues: PrecheckIssue[] = [];
      let gapList: IpPosGap[] = [];
      let merged: PrefillItem[] = [];
      try {
        const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/precheck`), {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ answers: briefToSlotAnswers() })
        });
        if (handleStaleSession(res.status)) {
          throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗算力。");
        }
        if (res.ok) {
          const data = await readJson<{ issues?: PrecheckIssue[]; gaps?: IpPosGap[] }>(res);
          issues = (data.issues ?? []).filter((item) => item && item.slot && (item.followup || (item.sentence ?? "").trim()));
          gapList = (data.gaps ?? []).filter((g) => g && g.area && ((g.sentence ?? "").trim() || (g.question ?? "").trim()));
          merged = mergePrefills(issues, gapList, slotLabelOf);
          setGaps(merged);
          gapSuppRef.current = ""; // 新一轮体检换了题，旧快照作废（否则会把上一题填的带进来）
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (message.includes("登录已过期")) { setPrechecking(false); setError(message); return; }
        // 其余预审异常：放行，不挡生成主链路
      }
      setPrechecking(false);
      if (merged.length > 0) {
        // 2026-10-02（用户「不要让用户被重复的提醒」）：体检一旦出过结果就记住签名——
        // 用户填完（填一部分或全填）再点「生成定位全案」直接开做，绝不会再弹一遍同样的提醒；
        // 只有当简报真的被改了（签名变）才重新体检。签名只按 6 个基础槽位算，填补充项不算改简报。
        precheckSigRef.current = briefSig;
        const checkN = merged.filter((it) => it.source === "check").length;
        const gapN = merged.length - checkN;
        const lead = checkN > 0
          ? `体检看了下，有 <b>${checkN} 项</b>回答可以补强一点`
          : `体检这关过了，材料够生成 ✅`;
        const gapTip = gapN > 0
          ? `${checkN > 0 ? "；另外再补" : "再补"} <b>${gapN} 项</b>运营细节（预算 / 团队 / 产品 / 渠道等）`
          : "";
        const mid = `，全案会更贴你的实际——已合并列在下方，<b>按句子把空填上就行，填多少都算数</b>。`;
        const tail = `<b>填完（只填一部分也可以）点下方「补充好了，直接生成」</b>，填的都会被采纳。`;
        pushMsg("ai", `${lead}${gapTip}${mid}${tail}`);
        return;
      }
    }
    precheckBypassRef.current = false;
    // 只收面板、不清用户已填的 gapFills：run 失败（如 402/502 不扣费）退回确认页时，
    // 已填的补充信息还在（下面 buildRunBody 用的也是闭包里这份值）。
    // 面板要收起了：先把用户填的（部分或全部）固化成快照，run 失败重试也不会丢。
    // 只在 gaps 非空时写，避免重试时用空数组把快照清掉。
    if (gaps.length > 0) { gapSuppRef.current = assembleGapSupplement(gaps, gapFills); setGapSuppView(gapSuppRef.current); }
    setGaps([]);
    setCompletions([]);
    setCompletionAnswers({});
    setCompletionCost(null);
    setCompletionError(null);
    setConfirmOpts(false);
    setPhase("gen");
    setElapsed(0);
    setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setRestored(false);

    // 日志脚本（原型同款顺序）。末行 ✅ **由后端真实返回触发揭晓**：
    // 定时器走到最后一件 ✓ 就停住——结果没回来前，日志不出「生成完成」、进度条封顶 <100%。
    const ordered: string[] = [
      `→ 读取定位简报（8/8 字段齐全）· 角色深度：${brief.role || "—"}`,
      "→ 加载定位方法论 · 五步定位法 · 固定输出结构（速览 + 8 章）"
    ];
    for (const p of PIECES) {
      if (STEP_LINES[p.id]) ordered.push(STEP_LINES[p.id]);
      ordered.push(`✓ ${p.no} ${p.title} —— ${p.gd}`);
    }
    setLogLines([...ordered, "✅ 全案 9 件生成完成 · 已写入交付区"]);

    let li = 0;
    const step = () => {
      li += 1;
      setLogIdx(li);
      const t = ordered[li - 1] ?? "";
      if (t.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, t.startsWith("✓") ? 650 : 750);
      // 走完停在最后一件 ✓；✅ 行见下方揭晓 effect
    };
    later(step, 300);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timersRef.current.push(tick);

    try {
      const flow = chatFlowFor("ip-pos");
      if (!flow) throw new Error("未找到 IP 定位技能流程配置。");
      const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(buildRunBody("ip-pos", flow, briefToSlotAnswers()))
      });
      window.clearInterval(tick);
      if (handleStaleSession(res.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗算力。");
      }
      if (res.status === 402) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setError(`${data.message ?? "当前算力不足，请先充值后再使用。"}（本次未消耗算力） 请前往充值页后回来，简报已在本页保留。`);
        setPhase("confirm"); setConfirmOpts(true);
        window.setTimeout(() => {
          window.location.href = getAppPath(`/agents?recharge=1&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
        }, 400);
        return;
      }
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(payload.message ?? "本次请求被拒绝；本次不消耗算力。");
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          `生成还没跑完，网关的等待上限先到了（HTTP ${res.status}）。这一稿在后台通常还在继续：` +
          "生成成功会正常计费并留存 7 天，稍后重新回到本页面（同一浏览器）会自动找回，不必急着重做。"
        );
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        needsInput?: boolean;
        payload?: IpPosPayload;
      }>(res);
      if (result.needsInput) {
        const question = (result.answer ?? "").trim();
        throw new Error(
          (question ? `沈定还想确认一下：${question} ` : "还需要补充一些关键信息。") +
          "请对照左侧简报补充后重新生成（本次不消耗算力）。"
        );
      }
      const payload = result.payload && "overview" in result.payload ? result.payload : null;
      if (payload) savePayloadLocally(skuId, payload);
      runResultRef.current = {
        payload,
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null
      };
      setRunSettled(true);
      // 扣费已完成（后端返回 consumedCredits/balance）：立即广播余额刷新——
      // 右上角余额只监听 sitong:balance-changed（此前仅充值抽屉会发），不广播就「看起来没扣」。
      window.dispatchEvent(new CustomEvent("sitong:balance-changed"));
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm"); setConfirmOpts(true);
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗算力</b>）。按提示补充或稍后再点「✓ 确认，开始生成」。");
    }
  }

  /** 日志末行（✅ 生成完成）由后端真实返回触发揭晓——结果没回来前日志停在某件 ✓、进度条封顶 <100%。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || logDone || logLines.length === 0) return;
    if (logIdx >= logLines.length - 1) {
      setGenFinished(true);
      setLogIdx(logLines.length);
      setLogDone(true);
    }
  }, [phase, runSettled, logDone, logIdx, logLines]);

  /** 交付门槛：后端结果返回 && 日志走完（含 ✅ 行），不提前展示结果。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || !logDone) return;
    const result = runResultRef.current;
    if (!result) return;
    setConsumed(result.consumed);
    setAnswerMd(result.answer || (result.payload ? buildPayloadMarkdown(result.payload) : ""));
    setPieces(buildPieces(result.payload, result.answer));
    setPhase("done");
    // 交付后扫描【待补充】标记，聚成「补全」问题卡（章节级 patch，非整包重跑）。
    setCompletions(scanAllCompletions(result.payload));
    setView("content"); setEnhSec("");
    setEnhClean(false);
    pushMsg("ai", `交付完成 ✅ <b>定位全案 9 件</b>已按 5 个分区放在右侧——速览先看，定位 / 人设 / 内容 / 增长按需取用。每章可<b>单独复制</b>、可导出 Word；改简报可整包重跑。本次消耗 <b>${result.consumed ?? IP_POS_PRICE} ${IP_POS_UNIT}</b>。`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSettled, logDone, phase]);

  /* ---------- 简报编辑（点字段改；体检追问按 slot 精确勾销） ---------- */

  function editField(key: string) {
    if (demoRef.current) { setError("演示模式中，简报是演示数据——点上方「停止演示」后可编辑。"); return; }
    if (phase === "gen") return;
    setDraft(brief[key] ?? "");
    setEditing(key);
  }
  function saveEditing() {
    if (!editing) return;
    const key = editing;
    const v = draft.trim();
    setBrief((prev) => {
      const next = { ...prev };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
    if (phase === "done") { setPhase("confirm"); setConfirmOpts(true); setPieces([]); setRestored(false); setCompletions([]); setCompletionAnswers({}); }
    setEditing(null);
  }
  useEffect(() => {
    if (!editing) return;
    const t = window.setTimeout(() => draftRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditing(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /* ---------- 交付区操作 ---------- */

  function copyText(t: string) {
    try { void navigator.clipboard.writeText(t); } catch { /* 隐私模式忽略 */ }
  }
  async function exportWord() {
    if (exporting || !answerMd.trim()) return;
    setExporting(true);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ title: "IP定位全案 · 思潼AI", content: answerMd })
      });
      if (handleStaleSession(response.status)) {
        window.alert("登录状态已失效，本地登录信息已清除。请重新登录后再导出。");
        return;
      }
      const created = await readJson<{ downloadUrl?: string; filename?: string }>(response);
      if (!created.downloadUrl) throw new Error("Word 生成失败，请稍后再试。");
      const fileResponse = await fetch(apiPath(created.downloadUrl), { headers: authHeaders(), cache: "no-store" });
      if (!fileResponse.ok) throw new Error("Word 下载失败，请重新导出。");
      const blob = await fileResponse.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = created.filename || "IP定位全案.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Word 生成失败，请稍后再试。");
    } finally {
      setExporting(false);
    }
  }

  /* ---------- 生成后「待补充」章节级补全（轻量 patch，非整包重跑） ---------- */

  async function completePending() {
    if (demoRef.current) { setError("演示模式中不可用——点上方「停止演示」后可操作。"); return; }
    if (phase !== "done") return;
    const prev = runResultRef.current;
    const payload = prev?.payload;
    if (!payload?.sections) return;
    const answered = completions
      .map((c) => ({ item: c, answer: (completionAnswers[c.id] ?? "").trim() }))
      .filter((x) => x.answer);
    if (answered.length === 0) {
      setCompletionError("请至少填写一项补充信息，再点「一键补全」。");
      return;
    }
    // 按章节聚合：每个待补章节一次性重写，draft 取当前章节全文。
    const bySection = new Map<string, { sectionKey: string; title: string; draft: string; items: Array<{ instruction: string; answer: string }> }>();
    for (const { item, answer } of answered) {
      if (!bySection.has(item.sectionKey)) {
        bySection.set(item.sectionKey, {
          sectionKey: item.sectionKey,
          title: item.sectionTitle,
          draft: payload.sections[item.sectionKey] ?? "",
          items: []
        });
      }
      // 带上原文位置（表格行/所在句子经压平）：模型能判断这个缺口落在哪，替换更准。
      const instr = item.hint && !item.hint.includes(item.instruction)
        ? `${item.instruction}（原文位置：${item.hint}）`.slice(0, 300)
        : item.instruction;
      bySection.get(item.sectionKey)!.items.push({ instruction: instr, answer });
    }
    const patches = [...bySection.values()];
    setCompleting(true); setCompletionError(null); setCompletionCost(null);
    try {
      const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/ip-pos/complete`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ answers: briefToSlotAnswers(), patches })
      });
      if (handleStaleSession(res.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请重新登录后再补全。");
      }
      if (res.status === 402) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? "当前算力不足，请先充值后再补全。");
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? "补全失败，本次不消耗算力，请稍后重试。");
      }
      const data = (await res.json()) as { sections?: Record<string, string>; consumedCredits?: number };
      const returned = data.sections ?? {};
      if (Object.keys(returned).length === 0) throw new Error("补全结果为空，本次不消耗算力，请重试。");
      const merged: IpPosPayload = { ...payload, sections: { ...payload.sections, ...returned } };
      // 兜底：用户填过的项，标记位强制替换成填写值，确保结果零残留【待补充】。
      if (merged.sections) merged.sections = applyFilledAnswers(merged.sections, answered.map((a) => ({ sectionKey: a.item.sectionKey, instruction: a.item.instruction, answer: a.answer })));
      savePayloadLocally(skuId, merged);
      runResultRef.current = {
        ...prev!,
        payload: merged,
        answer: buildPayloadMarkdown(merged),
        consumed: prev!.consumed
      };
      setAnswerMd(buildPayloadMarkdown(merged));
      setPieces(buildPieces(merged, buildPayloadMarkdown(merged)));
      const remaining = scanAllCompletions(merged);
      setCompletions(remaining);
      setEnhClean(remaining.length === 0);
      setCompletionAnswers({});
      setCompletionCost(typeof data.consumedCredits === "number" ? data.consumedCredits : null);
      window.dispatchEvent(new CustomEvent("sitong:balance-changed"));
      if (remaining.length === 0) {
        pushMsg("ai", `补全完成 ✅ 所有【待补充】都填实了，本次轻量补全消耗 <b>${data.consumedCredits ?? "?"} ${IP_POS_UNIT}</b>（整包重跑要 ${IP_POS_PRICE} ${IP_POS_UNIT}）。`);
      } else {
        pushMsg("ai", `已补全你填写的部分 ✅ 还剩 ${remaining.length} 处未填，可继续补；不想补也能直接用。`);
      }
    } catch (e) {
      setCompletionError(e instanceof Error ? e.message : "补全失败。");
    } finally {
      setCompleting(false);
    }
  }

  /* ---------- 派生 ---------- */

  const filled = FIELDS.filter((f) => (brief[f.key] ?? "").trim()).length;
  /** 合并面板的来源构成：体检补强 N 项（其余是运营缺口），标题/副标题据此交代来源。 */
  const prefillChecks = gaps.filter((g) => g.source === "check").length;
  const statusText =
    phase === "gen" ? "生成中 · 流式推导" :
    phase === "done" ? "交付完成 · 9/9 件" :
    phase === "confirm" ? `访谈完成 · 简报 ${filled}/8` :
    phase === "ask" ? `引导中（${filled}/8）` : "待引导";
  const feeHint =
    phase === "done" ? <>本次实际消耗 <b>{consumed ?? IP_POS_PRICE} {IP_POS_UNIT}</b></> :
    phase === "confirm" ? <>本次交付：<b>定位全案 9 件（速览 + 8 章）· {IP_POS_PRICE} {IP_POS_UNIT}</b></> :
    <>完成 6 步访谈后可生成 · 全案（速览 + 8 章）{IP_POS_PRICE} {IP_POS_UNIT} /份</>;
  const showDl = (phase === "done" || (restored && pieces.length > 0)) && phase !== "gen";
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const groups = [...new Set(pieces.map((p) => p.meta.g))];
  const shownPieces = tab === "all" ? pieces : pieces.filter((p) => p.meta.g === tab);
  // 增强项目：按章节分组 + 当前选中章节（章节被重算掉时回落到第一组）
  const enhSections = groupEnhSections(completions);
  const curSec = enhSections.find((s) => s.key === enhSec) ?? enhSections[0];

  return (
    <main className="cpw-page">
      {/* 2026-10-08（用户）：详情页已下线，返回兜底改商城首页；有来路时 MallTopbar smartBack 原路返回（如业绩倍增系统演示页）。 */}
      <MallTopbar back="/agents" badge="IP定位智能体 · 定位工作台" />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <div className="cpw-chips">
            <span className="cpw-chip dev">沈定 · 首席定位官</span>
            <span className="cpw-chip">定位工作台</span>
          </div>
          <h1><img className="cpw-emoji" src={avatar} alt="沈定" />IP定位工作台</h1>
          <p className="cpw-hook">左边沈定 6 步访谈带你走，右边定位简报 8 字段和全案 9 件实时长出来。</p>
          <p className="cpw-ability">6 步访谈 → 定位简报 → 速览 + 8 章全案分区交付：单章复制、一键导出 Word（免费），{IP_POS_PRICE} {IP_POS_UNIT}/份，一次看清。老手可直接改简报或点「AI 先铺底稿」。</p>
        </div>
      </header>

      <section className="cpw-demo">
        <div className="cpw-wrap">
          <div className="cpw-sec-head"><h2>▶ <span className="cpw-k">工作台</span></h2><span className="cpw-desc">左：6 步访谈｜右：定位简报 + 全案 9 件</span></div>
          <div className="cpw-stage">
            <div className="cpw-bar">
              <span className="cpw-dot r" /><span className="cpw-dot y" /><span className="cpw-dot g" />
              <span className="cpw-url">思潼AI · IP定位工作台</span>
              <span className="cpw-st"><span className={`cpw-st-dot ${phase === "gen" ? "playing" : phase === "done" ? "done" : ""}`} /><span>{statusText}</span></span>
              <div className="cpw-ctrls">
                <button className="cpw-sbtn" onClick={() => beginDemo(captureCurrent())}>▶ 看演示</button>
                <button className="cpw-sbtn" onClick={() => resetAll(true)}>↻ 重置</button>
              </div>
            </div>
            <div className="cpw-body">
              {/* 左：引导对话 */}
              <div className="cpw-chat">
                <div className="cpw-chat-head">
                  <div className="cpw-av"><img src={avatar} alt="沈定" /></div>
                  <div><b>沈定 · 创作引导</b><span>一次只问一个维度 · 回答自动填入右侧简报</span></div>
                </div>
                {demoOn && (
                  <div className="cpw-demo-bar">
                    <span className="cpw-demo-txt">🎬 <b>演示中</b> · 正在带你走一遍完整流程<span className="cpw-demo-free">（本演示不消耗算力）</span>{demoSnapshotRef.current && demoSnapshotRef.current.messages.length > 0 ? " · 结束后回到你刚才的对话" : ""}</span>
                    <button className="cpw-demo-stop" onClick={stopDemo}>
                      {demoSnapshotRef.current && demoSnapshotRef.current.messages.length > 0 ? "⏹ 停止演示，回到我的对话" : "⏹ 停止演示，开始我的访谈"}
                    </button>
                  </div>
                )}
                <div className="cpw-log" ref={logRef}>
                  {messages.map((m) => (
                    <div key={m.id} className={`cpw-msg${m.who === "user" ? " user" : ""}`}>
                      {m.who === "ai" && <div className="cpw-m-av"><img src={avatar} alt="" /></div>}
                      <div className={`cpw-bub${m.pending ? " is-pending" : ""}`} dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                  ))}
                  {optsQ != null && phase === "ask" && !(genCandidates && genCandidates.q === optsQ && genCandidates.list.length > 0) && (
                    <div className="cpw-opts">
                      {(QFLOW[optsQ].opts ?? []).map((o, i) => (
                        <button key={i} className="cpw-opt" onClick={() => chooseOpt(QFLOW[optsQ], o)}>
                          {o.t}{o.d ? <small>{o.d}</small> : null}
                        </button>
                      ))}
                    </div>
                  )}
                  {confirmOpts && phase === "confirm" && (
                    <div className="cpw-opts">
                      <button className="cpw-opt go" onClick={() => { dismissConfirmOpts(); void startGen(); }}>
                        ✓ 确认，开始生成<small>速览 + 8 章 · {IP_POS_PRICE} {IP_POS_UNIT} · 线上流式约 50 秒</small>
                      </button>
                      <button className="cpw-opt" onClick={() => { dismissConfirmOpts(); pushMsg("ai", "直接点击右侧简报里的字段修改，改完点「✨ 生成定位全案」。"); }}>
                        ✎ 改一下再生成<small>点击右侧简报字段直接修改</small>
                      </button>
                    </div>
                  )}
                </div>
                {phase === "ask" && genCandidates && optsQ === genCandidates.q && genCandidates.list.length > 0 && (
                  /* 模型按你的行业生成的候选：点了放进输入框，改完再发（不直接进简报）。 */
                  <div className="cpw-opts">
                    {genCandidates.list.map((c, i) => (
                      <button key={i} className="cpw-opt" onClick={() => setFreeInput(c)}>{c}</button>
                    ))}
                  </div>
                )}
                <div className="cpw-skip">赶时间？<a onClick={skipGuide}>跳过访谈，直接在右侧简报填写 8 项 →</a></div>
                <div className="cpw-input">
                  <input
                    value={freeInput}
                    onChange={(e) => setFreeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") freeSend(); }}
                    placeholder="也可以直接打字回答当前问题，或补充要求"
                  />
                  <button onClick={freeSend}>发送</button>
                </div>
              </div>

              {/* 右：工作区 */}
              <div className="cpw-ws">
                <div className="cpw-ws-inner">
                  <div className="cpw-brief">
                    <div className="cpw-brief-t">
                      <b>📋 定位简报</b>
                      <span className="cpw-brief-sub">8 个字段 · 可随时点击修改，改完重新生成</span>
                      <div className="cpw-meter"><span>{filled}/8</span><div className="cpw-segs">{FIELDS.map((f, i) => <div key={f.key} className={`cpw-seg${i < filled ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {FIELDS.map((f) => {
                        const v = (brief[f.key] ?? "").trim();
                        return (
                          <div key={f.key} className={`cpw-bf${v ? " filled" : ""}${flashFields.includes(f.key) ? " flash" : ""}`} title={v ? "点击修改" : "等待左侧引导填入"} onClick={() => editField(f.key)}>
                            <div className="cpw-bf-k"><IconAuto v={f.icon} /> {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{v || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    {gapSuppView.trim() && (
                      <div className="cpw-brief-extra">
                        <div className="cpw-be-k"><span className="cpw-be-x">➕</span> 额外补充</div>
                        <div className="cpw-be-bd">
                          {gapSuppView.split(/[\n；;]/).map((l) => l.trim()).filter(Boolean).map((l, i) => (
                            <div className="cpw-be-line" key={i}>{l}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="cpw-ops">
                      {phase === "confirm" && (
                        <button
                          className={`cpw-big-btn gen${prechecking ? " busy" : ""}`}
                          disabled={prechecking}
                          onClick={() => { dismissConfirmOpts(); void startGen(); }}
                        >
                          {prechecking ? <><span className="cpw-btn-spin" /> 🔍 生成前校验中…</> : <><IconAuto v="✨" /> 生成定位全案</>}
                        </button>
                      )}
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setConfirmOpts(true); setPieces([]); setRestored(false); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag"><IconAuto v="🛡" /> 失败不扣费</span>
                    </div>
                    {gaps.length > 0 && phase !== "gen" && (
                      /* 2026-10-03（用户「这两个合并成一个，都按第二个填空的方式」）：
                         体检补强项（source=check）与运营缺口（source=gap）合成一个填空面板——
                         不再分两块渲染、也没有「跳过体检 / 按提示补充」双按钮；全都不填直接点
                         底部「补充好了，直接生成」即可（体检只是建议，不拦人）。 */
                      <div className="cpw-gaps" role="note">
                        <div className="ir-t">
                          💡 再补这 {gaps.length} 项，全案会更贴你的实际
                          {prefillChecks > 0 && <span className="cpw-gaps-mix">含体检补强 {prefillChecks} 项</span>}
                        </div>
                        <div className="cpw-gaps-sub">补充会让方案更准、更能直接落地——按句子把空填上就行；填的都会被采纳，都会带进生成。</div>
                        {gaps.map((g, i) => {
                          const text = gapText(g);
                          const fills = gapFills[i] ?? [];
                          const setBlank = (bi: number, v: string) =>
                            setGapFills((prev) => { const cur = prev[i] ? [...prev[i]] : []; cur[bi] = v; return { ...prev, [i]: cur }; });
                          // 来源标记：体检补强的标签用暖色（缺失更重），运营缺口用原来的蓝。
                          const areaCls = `cpw-gap-area${g.source === "check" ? ` is-check${g.verdict === "missing" ? " is-missing" : ""}` : ""}`;
                          // 填空题：把【】渲染成一个个小输入框，用户只管把空填上（2026-10-02 用户）
                          if (isFillSentence(text)) {
                            return (
                              <div className="cpw-gap" key={`${g.area}-${i}`}>
                                <div className="cpw-gap-fill">
                                  <span className={areaCls}>{g.area}</span>
                                  {parseGapSentence(text).map((p, pi) => p.kind === "text"
                                    ? <span key={pi} className="cpw-gap-txt">{p.text}</span>
                                    : <input
                                        key={pi}
                                        className="cpw-gap-blank"
                                        value={fills[p.blankIndex] ?? ""}
                                        placeholder={p.label}
                                        aria-label={p.label}
                                        style={{ width: `${Math.max(4, p.label.length + 2)}em` }}
                                        onChange={(e) => setBlank(p.blankIndex, e.target.value)}
                                      />)}
                                </div>
                              </div>
                            );
                          }
                          // 兜底：模型没给填空句（退回问句）→ 走原来的自由输入框
                          return (
                            <div className="cpw-gap" key={`${g.area}-${i}`}>
                              <div className="cpw-gap-q"><span className={areaCls}>{g.area}</span>{text}</div>
                              <input
                                className="cpw-gap-in"
                                value={fills[0] ?? ""}
                                placeholder="在此补充（可选）"
                                onChange={(e) => setBlank(0, e.target.value)}
                              />
                            </div>
                          );
                        })}
                        <div className="cpw-gap-note">补充能让全案更贴合你的实际——填了多少都算数，已填的会全部带进生成。</div>
                        {/* 面板收起必须靠这个按钮打开 bypass，否则用户再点「生成定位全案」会一直
                            重复体检、看不到生成（死循环，2026-10-02 踩过）。 */}
                        <div className="cpw-gaps-ops">
                          <button
                            className="cpw-opt go"
                            onClick={() => { precheckBypassRef.current = true; dismissConfirmOpts(); void startGen(); }}
                          >
                            🚀 补充好了，直接生成<small>填的都会被采纳</small>
                          </button>
                        </div>
                      </div>
                    )}
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {showDl ? (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">{pieces.length || 9} 件{restored ? " · 本机找回" : ""} · 消耗 {consumed ?? IP_POS_PRICE} {IP_POS_UNIT}</span>
                          {completions.length > 0 && (
                            <button
                              className={`cpw-badge-enh${view === "enh" ? " on" : ""}`}
                              onClick={() => setView("enh")}
                              title="点开填几个空，全案会更贴你的实际"
                            >
                              可增强 {completions.length} 处
                            </button>
                          )}
                          {enhClean && <span className="cpw-badge-done">已增强 · 零待补充</span>}
                          <div className="cpw-dl-ops">
                            <button className="cpw-cbtn" onClick={() => copyText(answerMd)}>⧉ 复制全部</button>
                            <button className="cpw-cbtn" onClick={() => void exportWord()} disabled={exporting}>{exporting ? "导出中…" : "↓ 导出 Word"}</button>
                          </div>
                        </div>

                        {/* 一级 tab：交付内容 / 增强项目。原来增强项目是右侧 320px 窄栏，
                            所有章节堆在一起显得很挤（2026-10-03 反馈），改成全宽切换。 */}
                        <div className="cpw-view-tabs">
                          <button className={`cpw-vtab${view === "content" ? " act" : ""}`} onClick={() => setView("content")}>
                            📄 交付内容 <b>{pieces.length}</b>
                          </button>
                          {completions.length > 0 && (
                            <button className={`cpw-vtab${view === "enh" ? " act" : ""}`} onClick={() => setView("enh")}>
                              ✨ 增强项目 <b>{completions.length}</b>
                            </button>
                          )}
                        </div>

                        {view === "enh" && completions.length > 0 ? (
                          <div className="cpw-enh-panel">
                            <div className="enh-sub">把这几空填上，全案会更贴你的实际；不填也能直接用。</div>
                            <div className="cpw-sec-tabs">
                              {enhSections.map((s) => (
                                <button
                                  key={s.key}
                                  className={`cpw-stab${curSec?.key === s.key ? " act" : ""}`}
                                  onClick={() => setEnhSec(s.key)}
                                >
                                  {s.title}
                                  {s.items.length > 1 && <b>{s.items.length} 处</b>}
                                </button>
                              ))}
                            </div>
                            <div className="enh-list">
                              {(curSec?.items ?? []).map((c) => (
                                <div className="enh-item" key={c.id}>
                                  <div className="ei-label">
                                    {c.fillLabel}
                                    {c.count > 1 && <span className="cc-count">全章共 {c.count} 处</span>}
                                  </div>
                                  <div className="fill-line">
                                    {c.fillParts.map((seg, i) =>
                                      i === 0 ? (
                                        <Fragment key={i}>{seg}</Fragment>
                                      ) : (
                                        <Fragment key={i}>
                                          <input
                                            className="enh-blank"
                                            value={completionAnswers[c.id] ?? ""}
                                            placeholder={c.fillLabel}
                                            onChange={(e) => setCompletionAnswers((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                          />
                                          {seg}
                                        </Fragment>
                                      )
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="enh-foot">
                              <button className="enh-btn" disabled={completing} onClick={() => void completePending()}>
                                {completing ? "优化中…" : "补全并优化 →"}
                              </button>
                              <span className="enh-note">只重写缺信息的章节，不整包重跑 · 本次消耗 {IP_POS_PATCH_PRICE} {IP_POS_UNIT}</span>
                            </div>
                            {completionCost != null && <div className="cc-done">✅ 已嵌入正文，本次消耗 {completionCost} {IP_POS_UNIT}</div>}
                            {completionError && <div className="cpw-err">{completionError}</div>}
                          </div>
                        ) : (
                          pieces.length > 0 && (
                            <>
                              <div className="cpw-tabs">
                                <button className={`cpw-tab${tab === "all" ? " act" : ""}`} onClick={() => setTab("all")}>全部 {pieces.length}</button>
                                {groups.map((g) => (
                                  <button key={g} className={`cpw-tab${tab === g ? " act" : ""}`} onClick={() => setTab(g)}>{GNAME[g]} {pieces.filter((p) => p.meta.g === g).length}</button>
                                ))}
                              </div>
                              <div className="cpw-pieces">
                                {shownPieces.map((p) => (
                                  <div className="cpw-pc" key={p.meta.id}>
                                    <div className="cpw-pc-h">
                                      <span className="cpw-pc-no" style={{ background: GCOLOR[p.meta.g] }}>{p.meta.no}</span>
                                      <b><IconAuto v={p.meta.icon} /> {p.meta.title}</b>
                                      <span className="cpw-g-tag" style={{ color: GCOLOR[p.meta.g], background: GSOFT[p.meta.g] }}>{p.meta.gt}</span>
                                      <div className="cpw-pc-btns">
                                        <button className="cpw-cbtn" onClick={() => copyText(`${p.meta.no}、${p.meta.title}\n\n${p.plain}`)}>⧉ 复制本件</button>
                                      </div>
                                    </div>
                                    <div className="cpw-pc-c" dangerouslySetInnerHTML={{ __html: neutralizeGaps(p.bodyHtml) }} />
                                  </div>
                                ))}
                              </div>
                            </>
                          )
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="cpw-ph-note">
                          {phase === "gen" ? <>⏳ 生成中 · 9 件逐张点亮 · 已等待 {elapsed} 秒</> :
                           phase === "confirm" ? <>✓ 简报 {filled}/8 齐全 · 点「✓ 确认，开始生成」或右侧按钮</> :
                           <>👋 完成左侧 6 步访谈后，全案会在这里分区生成</>}
                          {phase !== "gen" && <><span className="cpw-tag">8 字段齐</span><span className="cpw-tag">速览 + 8 章</span><span className="cpw-tag">{IP_POS_PRICE} {IP_POS_UNIT}</span></>}
                        </div>
                        {phase === "gen" && (
                          <div className="cpw-gen-prog">
                            <div className="cpw-gp-row"><div className="cpw-gp-bar"><i style={{ width: `${gpPct}%` }} /></div><b>{gpPct}%</b></div>
                            <div className="cpw-gp-meta"><span>{logLines[logIdx - 1]?.replace(/^(→ |✓ |✅ )/, "")?.slice(0, 24) || "准备中…"}</span><span>{logIdx >= logLines.length - 1 && !runSettled ? `后端生成中… 已等待 ${elapsed} 秒` : gpPct >= 100 ? "马上就好…" : `预计还需 ~${Math.max(1, Math.ceil((gpTotal - logIdx) * LOG_DELAY_MS / 1000))} 秒`}</span></div>
                          </div>
                        )}
                        {phase === "gen" && (
                          <div className="cpw-genlog">
                            {logLines.slice(0, logIdx).map((ln, i) => (
                              <div key={i} className={`cpw-ln ${ln.startsWith("✅") ? "hl" : ln.startsWith("✓") ? "ok" : ""}`}>{ln}</div>
                            ))}
                          </div>
                        )}
                        <div className="cpw-ph-grid">
                          {PIECES.map((p, i) => {
                            let cls = "cpw-ph locked";
                            if (phase === "confirm") cls = "cpw-ph ready";
                            else if (phase === "gen") cls = genFinished || i < genIdx ? "cpw-ph done" : i === genIdx ? "cpw-ph gening" : "cpw-ph locked";
                            return (
                              <div key={p.id} className={cls}>
                                {phase === "gen" && i === genIdx && !genFinished && <span className="cpw-spin" />}
                                <div className="cpw-no" style={{ color: GCOLOR[p.g], background: GSOFT[p.g] }}>{p.no} · {p.gt}</div>
                                <b><IconAuto v={p.icon} /> {p.title}</b>
                                <span className="cpw-d">{p.d}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {editing && (
        <div className="cpw-modal-mask" onClick={() => setEditing(null)}>
          <div className="cpw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cpw-modal-t">{FIELDS.find((f) => f.key === editing) && <IconAuto v={FIELDS.find((f) => f.key === editing)!.icon} />} 修改「{FIELDS.find((f) => f.key === editing)?.label}」</div>
            <textarea ref={draftRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="输入内容，留空保存 = 清空该字段" />
            <div className="cpw-modal-ops">
              <button className="cpw-big-btn ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="cpw-big-btn gen" onClick={() => saveEditing()}>保存（⌘/Ctrl+Enter）</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
