// 视频复盘智能体（vidrev）输出契约回归：离线校验解析、加权口径、四象限、自适应分桶与 V1–V12。
// 不需要模型和数据库，毫秒级可重复；用同一份数据重算，防止「正确输出被判失败」和「错误输出被放行」。
//
// 契约来源：C:/Users/book/WorkBuddy/2026-09-06-17-01-26/sitong-ai-agent-platform/CODEX-视频复盘智能体-样例输出.md
import {
  computeVidrevMetrics,
  parseVidrevRowsFromText,
  validateVidrevReport,
  type VidrevRawRow
} from "../apps/api/src/services/video-review-engine.js";
import { readFileSync } from "node:fs";

function readSource(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

/**
 * 工单 2026-09-13（视频复盘智能体修改工单）验收：
 * ① 未上传前必须有视频号/抖音导出指南（含真实网址）；② 不得再有快速诊断模式；
 * ③ 视频号后台字段（发表时间 / 转发量 / 平均播放进度）必须能解析；
 * ④ 后端必须有 `POST /vidrev/parse-preview` 预检接口证明文件真的到了。
 */
function checkWorkOrder20260913(): void {
  const shipinhao = [
    "标题,发表时间,播放量,点赞量,评论量,转发量,收藏量,平均播放进度",
    "示例一,2026-08-12,124000,3200,286,410,520,31%",
    "示例二,2026-08-18,32000,900,60,120,200,38%"
  ].join("\n");
  const parsed = parseVidrevRowsFromText(shipinhao);
  assert(parsed.rows.length === 2, `视频号后台表头应解析出 2 条，实际 ${parsed.rows.length}`);
  assert(parsed.rows[0]?.plays === 124000, "视频号「播放量」应映射到 plays");
  assert(parsed.rows[0]?.shares === 410, "视频号「转发量」应映射到 shares");
  assert(typeof parsed.rows[0]?.published_at === "string", "视频号「发表时间」应映射到 published_at");
  near(parsed.rows[0]?.completion_rate, 0.31, 1e-9, "视频号「平均播放进度」应映射到 completion_rate");

  // 2026-09-15 用户口径：视频复盘只做抖音 / 视频号——小红书、B站等平台的导出字段一律**不再**兼容。
  const xhs = parseVidrevRowsFromText([
    "笔记标题,发布时间,观看量,点赞数,收藏数,评论数,分享数",
    "小红书示例,2026-08-12,56000,2100,800,120,60"
  ].join("\n"));
  assert(xhs.rows.every((row) => row.plays === null || row.plays === undefined), "小红书「观看量」不得再被当成播放量");
  assert(xhs.rows.every((row) => !row.title), "小红书「笔记标题」不得再被当成标题");

  const bilibili = parseVidrevRowsFromText([
    "标题,发布时间,播放量,点赞数,评论数,分享数,收藏数,弹幕数",
    "B站示例,2026-08-12,88000,4300,210,90,600,320"
  ].join("\n"));
  const engineSrc = readSource("apps/api/src/services/video-review-engine.ts");
  // 只看代码行（注释里说明「不再兼容小红书」是合法的）。
  const engineCode = engineSrc
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert(!/小红书|bilibili|笔记标题|观看量/.test(engineCode), "解析器不得再兼容小红书/B站的导出字段");
  const routeSrc = readSource("apps/api/src/routes/marketplace.ts");
  assert(/vidrev_platform_not_supported/.test(routeSrc), "非抖音/视频号的平台必须在服务端 fail closed");
  assert(/笔记标题|观看量|弹幕/.test(routeSrc), "平台识别必须能把小红书/B站数据判成「其他平台」");
  void bilibili;

  const flows = readSource("apps/web/src/marketplace/chat-flows.ts");
  const vidrevBlock = flows.slice(flows.indexOf("vidrev: {"), flows.indexOf("livescript: {"));
  assert(!/快速诊断/.test(vidrevBlock), "vidrev 交互定义不得再出现「快速诊断」");
  assert(!/key: "mode"/.test(vidrevBlock), "vidrev 不得再有「复盘模式」选择步骤");
  assert(/数据导出指南/.test(vidrevBlock), "vidrev 欢迎语必须指向「视频数据导出指南」");
  // 2026-09-15 用户口径：去掉「统计周期」这一步、欢迎语不再标 60 积分/次（要按成本计费、不给单个智能体标价）。
  assert(!/key: "period"/.test(vidrevBlock), "vidrev 不得再有「统计周期」步骤");
  assert(!/60 积分\/次/.test(vidrevBlock), "vidrev 欢迎语不得再出现「60 积分/次」");
  assert(/看上方/.test(vidrevBlock), "vidrev 欢迎语必须说「看上方」导出指南");
  // 2026-09-15 用户口径：视频复盘只做抖音 + 视频号，选项里不得再出现小红书/快手/B站。
  assert(/choices: \["抖音", "视频号"\]/.test(vidrevBlock), "vidrev 平台选项只保留抖音与视频号");
  assert(!/小红书|快手|B站/.test(vidrevBlock), "vidrev 不得再出现小红书/快手/B站选项");

  const chat = readSource("apps/web/src/marketplace/AgentChatPage.tsx");
  assert(/channels\.weixin\.qq\.com\/login\.html/.test(chat), "导出指南必须含视频号助手网址");
  assert(/creator\.douyin\.com/.test(chat), "导出指南必须含抖音创作者中心网址");
  assert(/一键填充标准请求/.test(chat), "「增强提示词」必须改成「一键填充标准请求」");

  const route = readSource("apps/api/src/routes/marketplace.ts");
  assert(/app\.post\("\/vidrev\/parse-preview"/.test(route), "必须提供 POST /vidrev/parse-preview 预检接口");
  assert(!/VIDREV_QUICK_SYSTEM_PROMPT/.test(route), "快速诊断的 system prompt 必须删除");
  assert(!/"quick"/.test(route), "路由层不得再有 quick 模式分支");

  // 全仓口径：货架数据（含美业专区欢迎语）与后端 agent 定义都不得再提「快速诊断」。
  assert(!/快速诊断/.test(readSource("apps/api/src/data/marketplace-v3.json")), "货架数据（含美业专区欢迎语）不得再出现「快速诊断」");
  assert(!/快速诊断/.test(readSource("apps/api/src/services/agent-definitions.ts")), "后端 agent 定义不得再出现「快速诊断」");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function near(actual: number | null | undefined, expected: number, tolerance: number, message: string): void {
  assert(typeof actual === "number" && Number.isFinite(actual), `${message}（实际 ${String(actual)}）`);
  assert(Math.abs((actual as number) - expected) <= tolerance, `${message}（实际 ${actual}，期望 ${expected}±${tolerance}）`);
}

function hasRule(failures: string[], rule: string): boolean {
  return failures.some((item) => item.startsWith(rule));
}

/** 6 条脱敏合成数据：覆盖 4 个象限、含 1 条投流、缺 1 条 5 秒完播率。 */
const ROWS: VidrevRawRow[] = [
  { video_id: "v1", title: "示例标题一", duration_sec: 68, published_at: "2026-08-12", plays: 124000, likes: 3200, comments: 286, shares: 410, saves: 520, completion_rate: 0.31, completion_5s: 0.62, conversions: 23, is_paid: false, ad_spend: 0, content_type: "人设型" },
  { video_id: "v2", title: "示例标题二", duration_sec: 55, published_at: "2026-08-18", plays: 32000, likes: 900, comments: 60, shares: 120, saves: 200, completion_rate: 0.38, completion_5s: 0.6, conversions: 6, is_paid: false, ad_spend: 0, content_type: "干货教学" },
  { video_id: "v3", title: "示例标题三", duration_sec: 90, published_at: "2026-08-25", plays: 11000, likes: 300, comments: 40, shares: 30, saves: 90, completion_rate: 0.26, completion_5s: 0.44, conversions: 9, is_paid: false, ad_spend: 0, content_type: "招商/引流" },
  { video_id: "v4", title: "示例标题四", duration_sec: 22, published_at: "2026-09-01", plays: 8600, likes: 190, comments: 12, shares: 8, saves: 40, completion_rate: 0.22, completion_5s: null, conversions: 2, is_paid: false, ad_spend: 0, content_type: "入企案例" },
  { video_id: "v5", title: "示例标题五", duration_sec: 75, published_at: "2026-09-03", plays: 268000, likes: 7100, comments: 320, shares: 1900, saves: 2600, completion_rate: 0.41, completion_5s: 0.71, conversions: 4, is_paid: false, ad_spend: 0, content_type: "干货教学" },
  { video_id: "v6", title: "示例标题六", duration_sec: 41, published_at: "2026-09-07", plays: 6400, likes: 150, comments: 9, shares: 4, saves: 30, completion_rate: 0.24, completion_5s: 0.5, conversions: 3, is_paid: true, ad_spend: 1200, content_type: "案例拆解" }
];

const METRICS = computeVidrevMetrics(ROWS);

/** 对齐附件样例深度与结构的「应该通过」报告（数字用 METRICS 重算后写入）。 */
function buildValidDoc(): string {
  return [
    "# 短视频复盘报告 · 2026-08-12 ~ 2026-09-07（近30天 · 抖音）",
    "",
    "## 零、数据质量审计",
    "",
    "| 检查项 | 结果 |",
    "|---|---|",
    "| 总记录数 | 6 条 |",
    "| 完播率覆盖 | 6/6 = 100% 🟢 |",
    "| 5秒完播率覆盖 | 5/6 = 83% 🟡 |",
    "| 评论数据 | 正常 |",
    "| 发布时段 | 精确到小时 |",
    "| 投流标记 | 已区分（1 条，合计 ¥1,200） |",
    "| 数据时效 | T+1，无滞后 |",
    "",
    "受限维度：",
    "1. 5秒完播率缺 1 条（v4）——该条不做钩子强度归因，改按整体完播率与评论内容推断",
    "2. 无成交金额字段——不出 ROI，只给留资成本口径",
    "",
    "## 一、数据总览",
    "",
    "| 指标 | 数值 |",
    "|---|---|",
    "| 视频总数 | 6 条 |",
    "| 总播放 | 450,000 |",
    "| 总互动 | 15,039（互动率 3.34%，加权） |",
    "| 总转化 | 47 条咨询 |",
    "| 投流金额 | ¥1,200（1 条） |",
    "| ROI | 数据缺失（无成交金额字段） |",
    "| 趋势 | 下降（连续 2 周） |",
    "| 账号基线 | 单条播放中位数 21,500；互动率中位数 3.25% |",
    "",
    "⚠️ 本周期均播被 v5 一条爆款拉高，判断账号健康度一律看中位数。",
    "",
    "## 二、视频分层",
    "",
    "分层口径：播放中位数 21,500、转化中位数 5；高播放 ≥32,250、高转化 ≥7.5。v2 落在中间带，按播放是否达基线二分。",
    "",
    "| 象限 | # | 标题 | 播放 | 咨询 | 完播 |",
    "|---|---|---|---|---|---|",
    "| 又爆又赚 | v1 | 示例标题一 | 124,000 | 23 | 31% |",
    "| 有量无转 | v2 | 示例标题二 | 32,000 | 6 | 38% |",
    "| 有转无量 | v3 | 示例标题三 | 11,000 | 9 | 26% |",
    "| 没量没转 | v4 | 示例标题四 | 8,600 | 2 | 22% |",
    "| 有量无转 | v5 | 示例标题五 | 268,000 | 4 | 41% |",
    "| 没量没转 | v6 | 示例标题六 | 6,400 | 3 | 24% |",
    "",
    "结论：流量和转化是两条线，目前各走各的。",
    "",
    "## 三、内容结构健康度",
    "",
    "| 类型 | 条数 | 占比 | 均播 | 互动率 | 完播率 | 判定 |",
    "|---|---|---|---|---|---|---|",
    "| 案例拆解（爆款型） | 1 | 17% | 6,400 | 2.55% | 24.0% | 🔴 太少 |",
    "| 人设型 | 1 | 17% | 124,000 | 3.14% | 31.0% | 🔴 太少 |",
    "| 干货教学（专业型） | 2 | 33% | 150,000 | 3.47% | 40.7% | 🟡 略超 |",
    "| 入企案例（证据型） | 1 | 17% | 8,600 | 2.44% | 22.0% | 🔴 偏少 |",
    "| 招商/引流（变现型） | 1 | 17% | 11,000 | 3.36% | 26.0% | 🟢 合理 |",
    "",
    "健康度评分 =（1 爆款型 + 1 人设型）/ 6 = 33.3% → 🟡 中等。",
    "",
    "核心矛盾：",
    "1. 太少——案例拆解只占 17%",
    "2. 太多——无",
    "3. 错配——干货占比最高，转化集中在人设型",
    "",
    "调整建议：",
    "- 增：案例拆解 2 条",
    "- 减：无",
    "- 改：v4 从参观式改成问题导向",
    "",
    "## 四、单条深拆（TOP3 + BOTTOM3）",
    "",
    "1. v1「示例标题一」｜又爆又赚",
    "",
    "播放 124,000 ｜ 赞 3,200 ｜ 评 286 ｜ 分享 410 ｜ 收藏 520 ｜ 完播 31% ｜ 5秒完播 62% ｜ 咨询 23 ｜ 自然流",
    "",
    "为什么好：",
    "1. 钩子是自我暴露型，5 秒完播 62% 全账号第 2",
    "2. 全篇只讲一个担心，不插第二话题",
    "3. 评论区提问人群精准，评论即线索",
    "",
    "可复用：「我怕…」句式可以换话题复用",
    "改进：自然流跑到 12.4w，下次同类内容补小额测放大",
    "",
    "2. v5「示例标题五」｜有量无转",
    "",
    "播放 268,000 ｜ 赞 7,100 ｜ 评 320 ｜ 分享 1,900 ｜ 收藏 2,600 ｜ 完播 41% ｜ 5秒完播 71% ｜ 咨询 4 ｜ 自然流",
    "",
    "为什么流量好但转化差：",
    "1. 5 秒完播与分享都是全账号最高，泛人群爆款",
    "2. 选题是通用知识，看完能学到但不产生动作",
    "3. 完播 41% 说明内容没问题，问题在人群错配",
    "",
    "可复用：编号结构 + 反常识钩子",
    "改进：加个人经历把泛人群往精准拉",
    "",
    "3. v6「示例标题六」｜没量没转",
    "",
    "播放 6,400 ｜ 赞 150 ｜ 评 9 ｜ 分享 4 ｜ 收藏 30 ｜ 完播 24% ｜ 咨询 3 ｜ 投流 ¥1,200",
    "",
    "为什么不行：",
    "1. 展示的是「我们有什么」，不是「你能得到什么」",
    "2. 分享只有 4 条，没有传播价值",
    "3. 投流 ¥1,200 只换来 3 条咨询，效率低于自然流",
    "",
    "可复用：题材本身有信息量",
    "改进：改成检查清单结构重发一次",
    "",
    "4. v4「示例标题四」｜没量没转",
    "",
    "播放 8,600 ｜ 赞 190 ｜ 评 12 ｜ 分享 8 ｜ 完播 22% ｜ 咨询 2",
    "",
    "为什么不行：",
    "1. 参观式内容没有冲突，缺少看下去的理由",
    "2. 没有给出用户能带走的信息",
    "3. 分享只有 8 条，没人愿意转给伙伴",
    "",
    "可复用：实拍素材可以二次剪辑",
    "改进：标题改成检查清单式",
    "",
    "5. v2「示例标题二」｜有量无转",
    "",
    "播放 32,000 ｜ 赞 900 ｜ 评 60 ｜ 分享 120 ｜ 完播 38% ｜ 咨询 6",
    "",
    "为什么不行：",
    "1. 干货密度高但缺个人视角，观众记住了知识点没记住人",
    "2. 结尾没有承接动作",
    "3. 咨询 6 条但集中在评论区追问，承接链路断了",
    "",
    "可复用：结构清晰，适合系列化",
    "改进：片尾留一个具体问题承接咨询",
    "",
    "6. v3「示例标题三」｜有转无量",
    "",
    "播放 11,000 ｜ 赞 300 ｜ 评 40 ｜ 分享 30 ｜ 完播 26% ｜ 咨询 9",
    "",
    "为什么不行：",
    "1. 播放没跑起来，触达人群太少",
    "2. 完播 26% 偏低，中段掉线",
    "3. 转化效率高但被播放量限制",
    "",
    "可复用：钱数类选题转化效率高",
    "改进：前 3 秒直接报数字，配小额投流放大",
    "",
    "## 五、完播率深层归因",
    "",
    "按时长分桶（自适应 4 桶）：",
    "",
    "| 时长区间 | 条数 | 均播 | 完播率 |",
    "|---|---|---|---|",
    "| <30s | 1 | 8,600 | 22.0% |",
    "| 30-45s | 1 | 6,400 | 24.0% |",
    "| 45-60s | 1 | 32,000 | 38.0% |",
    "| >60s | 3 | 134,333 | 37.5% |",
    "",
    "按类型分桶：干货教学 40.7% ｜ 人设型 31.0% ｜ 招商/引流 26.0% ｜ 案例拆解 24.0% ｜ 入企案例 22.0%",
    "",
    "核心判断：>60 秒完播 37.5% 反超 <30 秒的 22.0%，优势在完整叙事。",
    "",
    "最佳配方：干货教学 × 60-90 秒。次优：人设型 × 60-75 秒。明确避坑：入企案例（22.0%）。",
    "",
    "## 六、互动深度分析",
    "",
    "| 指标 | 数值 | 判定 |",
    "|---|---|---|",
    "| 浅层互动（赞） | 11,840，浅层互动率 2.63% | — |",
    "| 深层互动（评论+分享） | 3,199，深层互动率 0.71% | — |",
    "| 赞/分享比 | 4.79 : 1 | 🔴 好看但不值得转 |",
    "| 分享率 | 0.55% | 🔴 远低于 2% 投流放大线 |",
    "",
    "分享王者 TOP3（按分享率）：",
    "",
    "| # | 标题 | 分享 | 分享率 | 归因 |",
    "|---|---|---|---|---|",
    "| v5 | 示例标题五 | 1,900 | 0.71% | 编号 + 实用清单 |",
    "| v1 | 示例标题一 | 410 | 0.33% | 情绪共鸣 |",
    "| v2 | 示例标题二 | 120 | 0.38% | 干货总结 |",
    "",
    "结论：内容能让人点赞，但还没有必须转给别人的结构。在赞/分享比降到 4:1 之前，不建议加大投流预算。",
    "",
    "## 七、趋势预警",
    "",
    "账号基线（本周期中位数）：",
    "",
    "| 指标 | 中位数 | 警戒线 | 优秀线 |",
    "|---|---|---|---|",
    "| 单条播放 | 21,500 | <12,900 | >32,250 |",
    "| 互动率 | 3.25% | <1.95% | >4.88% |",
    "",
    "4 周趋势：",
    "",
    "| 周次 | 条数 | 均播 | 播放中位数 |",
    "|---|---|---|---|",
    "| W33（8/10-8/16） | 1 | 124,000 | 124,000 |",
    "| W34（8/17-8/23） | 1 | 32,000 | 32,000 |",
    "| W35（8/24-8/30） | 1 | 11,000 | 11,000 |",
    "| W36（8/31-9/6） | 2 | 137,200 | 137,200 |",
    "| W37（9/7-9/13） | 1 | 6,400 | 6,400 |",
    "",
    "⚠️ W36 均播是被爆款拉出来的，中位数同样受影响。",
    "",
    "当前预警：",
    "",
    "| 级别 | 异常 | 触发条件 | 立即行动 |",
    "|---|---|---|---|",
    "| 🔴 | 播放连续 2 周下滑 | 中位 32,000 → 11,000 | 停杂项，下周押案例拆解 + 人设 |",
    "| 🟡 | 互动率连降 3 条 | 3.64% → 3.39% → 3.05% | 换内容类型而不是换话题 |",
    "",
    "积极信号：",
    "1. 人设型自然跑到 12.4w，平台认可这个方向",
    "2. 干货类完播 40.7% 稳居第一",
    "",
    "## 八、规律总结",
    "",
    "| 维度 | 规律 | 支撑视频 |",
    "|---|---|---|",
    "| 钩子 | 自我暴露型钩子转化最高 | v1、v5 |",
    "| 选题 | 讲具体钱数的转化最好，通用知识流量最好 | v1、v2 |",
    "| 形式 | 口播 + 现场画面混合的完播更高 | v1、v4 |",
    "| 时间 | 60 秒以上完播与播放双高 | 全部 6 条 |",
    "| 转化 | 咨询最高的都不含硬引导 | v1、v3 |",
    "",
    "## 九、方法论沉淀",
    "",
    "1. 类型：选题",
    "   规律：具体钱数类选题的咨询转化高于通用知识类。",
    "   证据：v1（23 咨询 / 12.4w 播放）vs v5（4 咨询 / 26.8w 播放）",
    "   置信度：疑似规律（单周期样本少，需下周期验证）",
    "   相关选题：把成本明细做成系列",
    "",
    "2. 类型：形式",
    "   规律：账号不受「短视频要短」约束，60 秒以上完播反超。",
    "   证据：>60s 完播 37.5%（3 条）vs <30s 22.0%（1 条）",
    "   置信度：已确认",
    "   相关选题：停止生产 30 秒以内内容",
    "",
    "## 十、下个周期选题建议",
    "",
    "主力复制（又爆又赚池）",
    "- 基于 v1，换角度重做 3 条，结构复用：自我暴露钩子 → 只讲一个担心 → 结尾抛问题",
    "",
    "优化重拍（有量无转池）",
    "- 基于 v5，保留编号结构，片尾加承接问题",
    "",
    "投流放量（有转无量池）",
    "- 基于 v3，前 3 秒直接报数字，先小预算测试分享率再加投",
    "",
    "放弃方向",
    "- 参观式展示类（v4）：完播 22%、咨询 2，不做",
    "",
    "候选选题（直接进选题池，来源：数据复盘）",
    "1. 一个月的成本我一条条念给你听——基于 v1 复制，目标：转化",
    "2. 检查清单式选题，把参观变检查——基于 v4 优化，目标：流量 + 转化双修"
  ].join("\n");
}

function checkRowsParsing(): void {
  const csv = [
    "video_id,title,duration_sec,published_at,plays,likes,comments,shares,saves,completion_rate,completion_5s,conversions,is_paid,ad_spend,content_type",
    "v1,示例标题一,68,2026-08-12,124000,3200,286,410,520,31%,62%,23,否,0,人设型",
    "v2,示例标题二,55,2026-08-18,32000,900,60,120,200,38%,60%,6,否,0,干货教学",
    "v3,示例标题三,90,2026-08-25,11000,300,40,30,90,26%,,9,,,招商/引流"
  ].join("\n");
  const parsed = parseVidrevRowsFromText(csv);
  assert(parsed.rows.length === 3, `CSV 应解析出 3 条，实际 ${parsed.rows.length}`);
  assert(parsed.rows[0]?.plays === 124000, "CSV 播放量应解析为数字");
  near(parsed.rows[0]?.completion_rate, 0.31, 1e-9, "31% 应归一化为 0.31");
  assert(parsed.rows[2]?.completion_5s === null, "空字段必须传 null，禁止补 0");
  assert(parsed.rows[2]?.ad_spend === null, "空投流金额必须为 null，禁止补 0");
  assert(parsed.rows[2]?.is_paid === null, "空投流标记必须为 null，禁止按 false 处理");

  const cnCsv = [
    "序号,标题,时长,播放量,点赞,评论,分享,收藏,完播率,咨询量,是否投流,投流金额,内容类型",
    "1,示例标题一,68,124000,3200,286,410,520,31%,23,否,0,人设型",
    "2,示例标题二,55,32000,900,60,120,200,38%,6,否,0,干货教学"
  ].join("\n");
  const cn = parseVidrevRowsFromText(cnCsv);
  assert(cn.rows.length === 2, `中文表头 CSV 应解析出 2 条，实际 ${cn.rows.length}`);
  assert(cn.rows[0]?.plays === 124000 && cn.rows[0]?.conversions === 23, "中文表头应映射正确");

  const markdown = [
    "| 序号 | 标题 | 时长 | 播放 | 点赞 | 评论 | 分享 | 完播率 | 咨询 | 是否投流 | 投流金额 | 内容类型 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    "| 1 | 示例标题一 | 68 | 124000 | 3200 | 286 | 410 | 31% | 23 | 否 | 0 | 人设型 |",
    "| 2 | 示例标题二 | 55 | 32000 | 900 | 60 | 120 | 38% | 6 | 否 | 0 | 干货教学 |"
  ].join("\n");
  const md = parseVidrevRowsFromText(markdown);
  assert(md.rows.length === 2, `Markdown 表格应解析出 2 条，实际 ${md.rows.length}`);

  const none = parseVidrevRowsFromText("这条视频感觉没推起来，帮忙看看");
  assert(none.rows.length === 0, "无数据文本不应编造数据行");
  assert(none.notes.length > 0, "无数据文本必须给出说明");
}

function checkMetrics(): void {
  assert(METRICS.count === 6, `总条数应为 6，实际 ${METRICS.count}`);
  assert(METRICS.totalPlays === 450000, `总播放应为 450000，实际 ${METRICS.totalPlays}`);
  assert(METRICS.totalEngagement === 15039, `总互动应为 15039（赞+评+分享），实际 ${METRICS.totalEngagement}`);
  near(METRICS.engagementRate, 15039 / 450000, 1e-9, "互动率必须是加权（Σ互动/Σ播放）");
  const simpleAverage =
    ROWS.map((row) => (row.likes! + row.comments! + row.shares!) / row.plays!).reduce((a, b) => a + b, 0) / ROWS.length;
  assert(
    Math.abs(simpleAverage - METRICS.engagementRate) > 0.0005,
    "数据集必须能区分加权与简单平均（否则守护无效）"
  );
  assert(METRICS.medianPlays === 21500, `播放中位数应为 21500，实际 ${METRICS.medianPlays}`);
  assert(METRICS.medianConversions === 5, `转化中位数应为 5，实际 ${METRICS.medianConversions}`);

  const quadrant = METRICS.quadrant;
  const sum =
    quadrant.both.length + quadrant.plays_no_conv.length + quadrant.conv_no_plays.length + quadrant.neither.length;
  assert(sum === METRICS.count, `四象限条数之和必须 = 总条数（${sum} ≠ ${METRICS.count}）`);
  assert(quadrant.both.join(",") === "v1", `又爆又赚应为 v1，实际 ${quadrant.both.join(",")}`);
  assert(quadrant.plays_no_conv.join(",") === "v2,v5", `有量无转应为 v2,v5，实际 ${quadrant.plays_no_conv.join(",")}`);
  assert(quadrant.conv_no_plays.join(",") === "v3", `有转无量应为 v3，实际 ${quadrant.conv_no_plays.join(",")}`);
  assert(quadrant.neither.join(",") === "v4,v6", `没量没转应为 v4,v6，实际 ${quadrant.neither.join(",")}`);
  assert(
    [...quadrant.both, ...quadrant.plays_no_conv, ...quadrant.conv_no_plays, ...quadrant.neither].length ===
      new Set([...quadrant.both, ...quadrant.plays_no_conv, ...quadrant.conv_no_plays, ...quadrant.neither]).size,
    "每条视频只能归入一个象限"
  );

  assert(METRICS.buckets.length >= 3 && METRICS.buckets.length <= 5, `时长分桶必须是 3–5 桶，实际 ${METRICS.buckets.length}`);
  assert(
    METRICS.buckets.every((bucket) => bucket.count >= 1 || bucket.note),
    "每桶至少 1 条，空桶必须注明无法评估"
  );
  assert(METRICS.buckets.map((bucket) => bucket.bucket).join("|") === "<30s|30-45s|45-60s|>60s", "默认分桶口径应为 <30s / 30-45s / 45-60s / >60s");
  assert(!METRICS.buckets.some((bucket) => /<10s|10-20s|20-40s/.test(bucket.bucket)), "禁止写死 SKILL.md 的 <10s/10-20s/20-40s");

  const sparse = computeVidrevMetrics([
    { video_id: "a", duration_sec: 22, plays: 100 },
    { video_id: "b", duration_sec: 25, plays: 200 },
    { video_id: "c", duration_sec: 68, plays: 300 },
    { video_id: "d", duration_sec: 75, plays: 400 }
  ]);
  assert(sparse.buckets.length >= 3 && sparse.buckets.length <= 5, `空桶合并后仍须 3–5 桶，实际 ${sparse.buckets.length}`);
  assert(
    sparse.buckets.some((bucket) => bucket.count === 0 && bucket.note) ||
      sparse.buckets.every((bucket) => bucket.count >= 1),
    "空桶必须合并或注明「该桶本周期无内容，无法评估」"
  );

  near(METRICS.healthScore, 2 / 6, 1e-9, "健康度=（爆款型+人设型）/总数");
  assert(METRICS.healthVerdict === "🟡", `33.3% 应判 🟡，实际 ${METRICS.healthVerdict}`);
  near(METRICS.likeShareRatio, 11840 / 2472, 1e-6, "赞/分享比应为总量相除");
  assert(METRICS.engagementDepth.verdict === "🔴", `赞/分享比 4.79 应判 🔴，实际 ${METRICS.engagementDepth.verdict}`);
  assert(METRICS.paidCount === 1, `投流条数应为 1，实际 ${METRICS.paidCount}`);
  assert(!METRICS.softWarnings.some((item) => item.includes("样本")), "6 条不应误报样本偏少（阈值 <5）");
  assert(sparse.softWarnings.some((item) => item.includes("样本")), "总条数 <5 需提示样本偏少");
  assert(METRICS.softWarnings.some((item) => item.includes("中位数")), "单条播放 >50% 需提示均值被极值污染");
  const noPaid = computeVidrevMetrics(ROWS.map((row) => ({ ...row, is_paid: false, ad_spend: null })));
  assert(noPaid.softWarnings.some((item) => item.includes("无付费数据")), "投流条数=0 需提示无付费数据");
}

function checkValidReport(): void {
  const result = validateVidrevReport({
    markdown: buildValidDoc(),
    metrics: METRICS,
    mode: "deep",
    hasRevenueData: false
  });
  assert(result.failures.length === 0, `契约样例不应判失败，实际：\n${result.failures.join("\n")}`);
  assert(result.payload, "通过校验必须产出结构化 payload");
  const payload = result.payload!;
  assert(payload.kind === "vidrev", "payload 必须带 kind=vidrev 供前端分发渲染");
  assert(payload.data_quality.total_records === 6, "payload.data_quality.total_records 应来自同一份数据");
  assert(payload.data_quality.limited_dimensions.length >= 2, "受限维度必须逐条列出");
  assert(payload.quadrant.both.join(",") === "v1", "payload 四象限必须用确定性函数结果，不是模型自由发挥");
  assert(payload.overview.roi === null, "无成交数据时 payload.overview.roi 必须是 null，不能是 0");
  near(payload.overview.engagement_rate, 15039 / 450000, 1e-9, "payload 互动率必须是加权口径");
  assert(payload.content_health.health_score === METRICS.healthScore, "payload 健康度必须来自重算");
  // 明细 videos[]：条数一致、5 秒完播空值仍为 null（禁止补 0）、四象限 id 全部可回溯到明细。
  assert(payload.videos.length === ROWS.length, `payload.videos 条数应为 ${ROWS.length}，实际 ${payload.videos.length}`);
  const videosById = new Map(payload.videos.map((video) => [video.video_id, video]));
  assert(videosById.get("v4")?.completion_5s === null, "缺 5 秒完播的明细必须保持 null，禁止补 0");
  assert(videosById.get("v6")?.is_paid === true && videosById.get("v6")?.ad_spend === 1200, "投流明细必须保留金额与标记");
  for (const id of [...payload.quadrant.both, ...payload.quadrant.plays_no_conv, ...payload.quadrant.conv_no_plays, ...payload.quadrant.neither]) {
    assert(videosById.has(id), `四象限 id ${id} 必须能在 payload.videos 找到明细`);
  }
  assert(payload.deep_dive.length === 6, `总条数 ≥6 时深拆应为 TOP3+BOTTOM3=6，实际 ${payload.deep_dive.length}`);
  assert(
    payload.deep_dive.every((item) => item.reasons.length >= 3 && item.reusable.length >= 1 && item.improve.length >= 1),
    "深拆每条都要 reasons≥3 / reusable≥1 / improve≥1"
  );
  assert(payload.completion_attrib.by_duration.length >= 3, "时长分桶 ≥3");
  assert(payload.patterns.hook.length > 0 && payload.patterns.conversion.length > 0, "规律总结五维不能为空");
  assert(payload.methodology.length >= 2, "方法论 ≥2 条");
  assert(payload.next_topics.candidates.length >= 2, "候选选题 ≥2 条");
  assert(
    payload.next_topics.candidates.every((item) => item.source === "数据复盘"),
    "候选选题来源必须标「数据复盘」"
  );
  assert(payload.report_markdown.includes("## 十、"), "payload 必须带完整 Markdown 原文");
}

function mutate(build: (doc: string) => string): string {
  return build(buildValidDoc());
}

function checkFailureRules(): void {
  const run = (markdown: string): string[] =>
    validateVidrevReport({ markdown, metrics: METRICS, mode: "deep", hasRevenueData: false }).failures;

  const base = run(buildValidDoc());
  assert(base.length === 0, "红灯基线：契约样例必须通过");

  const v1 = run(mutate((doc) => doc.replace(/## 零、数据质量审计[\s\S]*?(?=\n## 一、)/, "")));
  assert(hasRule(v1, "V1"), `缺少数据质量审计应判 V1，实际 ${v1.join(" | ")}`);

  const v1b = run(
    mutate((doc) =>
      doc.replace(/(\n受限维度：\n)1\.[\s\S]*?(?=\n## 一、)/, "$1")
    )
  );
  assert(hasRule(v1b, "V1"), `有受限维度但未逐条列出应判 V1，实际 ${v1b.join(" | ")}`);

  const v2 = run(mutate((doc) => doc.replace(/## 七、趋势预警[\s\S]*?(?=\n## 八、)/, "")));
  assert(hasRule(v2, "V2"), `缺一章应判 V2，实际 ${v2.join(" | ")}`);

  const v3 = run(
    mutate((doc) => doc.replace("| 又爆又赚 | v1 |", "| 没量没转 | v1 |"))
  );
  assert(hasRule(v3, "V3"), `四象限与重算结果不一致应判 V3，实际 ${v3.join(" | ")}`);

  /**
   * 回归（2026-09-14 生产验收实测）：模型在空象限写「无」时，引擎曾把「无」当成视频 ID，
   * 于是同一份报告同时踩两条 V3（“视频 无 被归入多个象限”“四象限条数之和 ≠ 总条数”），
   * 只要有一个象限为空用户就拿不到报告。空象限占位符必须被忽略。
   */
  const placeholderFailures = run(
    mutate((doc) =>
      doc
        .replace("| 又爆又赚 | v1 | 示例标题一", "| 又爆又赚 | 无 | -")
        .replace("| 有量无转 | v5 | 示例标题五", "| 有转无量 | 无 | -")
    )
  );
  assert(
    !placeholderFailures.some((item) => /无[\s\S]{0,12}被归入多个象限/.test(item)),
    `空象限的「无」不能被当成视频 ID（实际 ${placeholderFailures.join(" | ")}）`
  );
  const placeholderQuadrantOnly = run(
    mutate((doc) => doc.replace("| 有转无量 | v3 | 示例标题三", "| 有转无量 | 无 | -"))
  );
  assert(
    !placeholderQuadrantOnly.some((item) => /无[\s\S]{0,12}被归入多个象限/.test(item)),
    `单个空象限写「无」也不能判成重复象限（实际 ${placeholderQuadrantOnly.join(" | ")}）`
  );

  const v4 = run(mutate((doc) => doc.replace(/\n6\. v3「示例标题三」[\s\S]*?(?=\n## 五、)/, "\n")));
  assert(hasRule(v4, "V4"), `深拆条数不足应判 V4，实际 ${v4.join(" | ")}`);

  const v5 = run(
    mutate((doc) =>
      doc.replace(
        "为什么好：\n1. 钩子是自我暴露型，5 秒完播 62% 全账号第 2\n2. 全篇只讲一个担心，不插第二话题\n3. 评论区提问人群精准，评论即线索",
        "为什么好：\n1. 钩子强\n2. 无其他"
      )
    )
  );
  assert(hasRule(v5, "V5"), `reasons <3 应判 V5，实际 ${v5.join(" | ")}`);

  const v6 = run(mutate((doc) => doc.replace("33.3% → 🟡 中等", "33.3% → 🟢 健康")));
  assert(hasRule(v6, "V6"), `判定档位与分数不一致应判 V6，实际 ${v6.join(" | ")}`);

  const v7 = run(mutate((doc) => doc.replace("互动率 3.34%，加权", "互动率 4.41%，加权")));
  assert(hasRule(v7, "V7"), `比率与加权重算偏差 >0.5pp 应判 V7，实际 ${v7.join(" | ")}`);

  const v8 = run(mutate((doc) => doc.replace("| ROI | 数据缺失（无成交金额字段） |", "| ROI | 0 |")));
  assert(hasRule(v8, "V8"), `无成交数据填 0 应判 V8，实际 ${v8.join(" | ")}`);
  assert(hasRule(v8, "V12"), `无成交金额却给 ROI 数值应判 V12，实际 ${v8.join(" | ")}`);

  const v9 = run(mutate((doc) => doc.replace("| 转化 | 咨询最高的都不含硬引导 | v1、v3 |\n", "")));
  assert(hasRule(v9, "V9"), `规律总结缺维度应判 V9，实际 ${v9.join(" | ")}`);

  const v9b = run(mutate((doc) => doc.replace("| 钩子 | 自我暴露型钩子转化最高 | v1、v5 |", "| 钩子 | 自我暴露型钩子转化最高 | — |")));
  assert(hasRule(v9b, "V9"), `规律未指名支撑视频应判 V9，实际 ${v9b.join(" | ")}`);

  const v10 = run(mutate((doc) => doc.replace(/\n2\. 类型：形式[\s\S]*?(?=\n## 十、)/, "\n")));
  assert(hasRule(v10, "V10"), `方法论 <2 条应判 V10，实际 ${v10.join(" | ")}`);

  const v11 = run(mutate((doc) => doc.replace("\n投流放量（有转无量池）\n- 基于 v3，前 3 秒直接报数字，先小预算测试分享率再加投\n", "\n")));
  assert(hasRule(v11, "V11"), `选题建议缺方向应判 V11，实际 ${v11.join(" | ")}`);

  const v11b = run(mutate((doc) => doc.replace(/\n候选选题（直接进选题池，来源：数据复盘）[\s\S]*$/, "\n")));
  assert(hasRule(v11b, "V11"), `候选选题 <2 条应判 V11，实际 ${v11b.join(" | ")}`);

  const v12 = run(mutate((doc) => doc.replace("投流 ¥1,200 只换来 3 条咨询，效率低于自然流", "投流效果好，ROI 达 3.2")));
  assert(hasRule(v12, "V12"), `无成交金额却给 ROI 数值应判 V12，实际 ${v12.join(" | ")}`);

  const banned = run(mutate((doc) => doc.replace("1. 一个月的成本我一条条念给你听——基于 v1 复制，目标：转化", "1. 想要成本明细的私信我")));
  assert(hasRule(banned, "V13"), `第十章候选选题命中违禁词应判失败，实际 ${banned.join(" | ")}`);

  // 违禁词扫描范围只限第十章候选选题：正文里的后台字段名不得误判。
  const bodyOnly = run(mutate((doc) => doc.replace("总转化 | 47 条咨询", "总转化 | 47 条私信咨询")));
  assert(!hasRule(bodyOnly, "V13"), `正文里的后台统计字段名不得触发违禁词失败，实际 ${bodyOnly.join(" | ")}`);

  const shortSample = computeVidrevMetrics(ROWS.slice(0, 2));
  const shortDoc = buildValidDoc().replace(/## 七、趋势预警[\s\S]*?(?=\n## 八、)/, "");
  const shortFail = validateVidrevReport({ markdown: shortDoc, metrics: shortSample, mode: "deep", hasRevenueData: false }).failures;
  assert(hasRule(shortFail, "V2"), `样本 <3 条且未说明第七章缺失应判 V2，实际 ${shortFail.join(" | ")}`);
  const shortDocWithNote = buildValidDoc().replace(
    /## 七、趋势预警[\s\S]*?(?=\n## 八、)/,
    "## 七、趋势预警（样本不足 3 条，本周期不输出趋势结论）\n\n样本不足 3 条，本周期不输出趋势预警。\n"
  );
  const shortPass = validateVidrevReport({
    markdown: buildValidDoc().replace(/## 七、趋势预警[\s\S]*?(?=\n## 八、)/, "## 七、趋势预警\n\n样本不足 3 条，本周期不输出趋势预警。\n"),
    metrics: shortSample,
    mode: "deep",
    hasRevenueData: false
  }).failures;
  assert(!hasRule(shortPass, "V2"), `样本 <3 条但已显式说明时可缺第七章，实际 ${shortPass.join(" | ")}`);
  assert(shortDocWithNote.includes("样本不足"), "样本不足必须显式标注");
}

/**
 * 真实模型「排版漂移」回归（2026-09-11 实测取证）。
 * 证据：`scripts/tmp/vidrev-debug/vidrev-first-2026-09-11T00-16-03-556Z.md`（真实模型原文）——
 * 第九章写成了「类型：… / 规律：… / 证据：… / 置信度：… / 相关选题：…」单行串联（system prompt
 * 字面就是这种写法），旧解析器按「编号 + 类型」切条目 → 得 0/1 条 → 误判 V10 并拒付；同时因注入给
 * 模型的明细表没有「发布时间」列，模型在第八章时间维度只能写「数据缺失 / 无」→ 误判 V9。
 * 两类都是「排版/数据供给」问题，不是交付内容不合格，不该把一次合格交付判失败。
 */
function checkModelFormatDrift(): void {
  const canon = /## 九、方法论沉淀[\s\S]*?(?=\n## 十、)/;
  const runDeep = (markdown: string, metrics = METRICS): string[] =>
    validateVidrevReport({ markdown, metrics, mode: "deep", hasRevenueData: false }).failures;
  const methodologyOf = (markdown: string): number =>
    validateVidrevReport({ markdown, metrics: METRICS, mode: "deep", hasRevenueData: false }).payload?.methodology.length ?? 0;

  // 变体 1：行内「/」串联（实测原文格式）。
  const inline = buildValidDoc().replace(
    canon,
    [
      "## 九、方法论沉淀",
      "",
      "类型：钩子 / 规律：5秒完播率高于 60% 的内容播放量高于账号中位数 / 证据：v1 5秒完播 62.00% 对应播放 124000，v5 5秒完播 71.00% 对应播放 268000 / 置信度：已确认 / 相关选题：人设型开场选题。",
      "",
      "类型：转化 / 规律：播放量级与咨询量不成正比，转化密度取决于内容与人群匹配度 / 证据：v3 播放 11000 咨询 9，v5 播放 268000 咨询 4 / 置信度：疑似规律（样本仅 1 条）/ 相关选题：引流转化型选题。",
      ""
    ].join("\n")
  );
  const inlineFailures = runDeep(inline);
  assert(!hasRule(inlineFailures, "V10"), `行内「/」串联的方法论必须被解析成 ≥2 条，实际：${inlineFailures.join(" | ")}`);
  assert(methodologyOf(inline) === 2, `行内串联应解析出 2 条方法论，实际 ${methodologyOf(inline)}`);

  // 变体 2：加粗字段名 + 缩进续行。
  const bolded = buildValidDoc().replace(
    canon,
    [
      "## 九、方法论沉淀",
      "",
      "1. **类型**：钩子",
      "   **规律**：5秒完播率高于 60% 的内容播放量高于账号中位数",
      "   **证据**：v1（62.00% / 124000）、v5（71.00% / 268000）",
      "   **置信度**：已确认",
      "   **相关选题**：人设型开场选题",
      "",
      "2. **类型**：形式",
      "   **规律**：60 秒以上内容完播反超短视频",
      "   **证据**：>60s 完播 37.5% vs <30s 22.0%",
      "   **置信度**：疑似规律",
      "   **相关选题**：停止生产 30 秒以内内容",
      ""
    ].join("\n")
  );
  const boldedFailures = runDeep(bolded);
  assert(!hasRule(boldedFailures, "V10"), `加粗字段名的方法论必须被解析成 ≥2 条，实际：${boldedFailures.join(" | ")}`);
  assert(methodologyOf(bolded) === 2, `加粗写法应解析出 2 条方法论，实际 ${methodologyOf(bolded)}`);

  // 变体 3：整章用表格列出。
  const tabled = buildValidDoc().replace(
    canon,
    [
      "## 九、方法论沉淀",
      "",
      "| 类型 | 规律 | 证据 | 置信度 | 相关选题 |",
      "|---|---|---|---|---|",
      "| 钩子 | 5秒完播率高于 60% 的播放高于中位数 | v1（62.00%）、v5（71.00%） | 已确认 | 人设型开场选题 |",
      "| 转化 | 播放量与咨询量不成正比 | v3（11000 播放 / 9 咨询）vs v5（268000 播放 / 4 咨询） | 疑似规律 | 引流转化型选题 |",
      ""
    ].join("\n")
  );
  const tabledFailures = runDeep(tabled);
  assert(!hasRule(tabledFailures, "V10"), `表格形式的方法论必须被解析成 ≥2 条，实际：${tabledFailures.join(" | ")}`);
  assert(methodologyOf(tabled) === 2, `表格写法应解析出 2 条方法论，实际 ${methodologyOf(tabled)}`);

  // 红灯守护：兼容排版不等于放宽业务要求——真的只有 1 条时仍必须判 V10。
  const single = buildValidDoc().replace(
    canon,
    [
      "## 九、方法论沉淀",
      "",
      "1. 类型：选题",
      "   规律：具体钱数类选题转化更高",
      "   证据：v1（23 咨询 / 124000 播放）",
      "   置信度：疑似规律",
      "   相关选题：成本明细系列",
      ""
    ].join("\n")
  );
  const singleFailures = runDeep(single);
  assert(hasRule(singleFailures, "V10"), `只有 1 条方法论仍须判 V10，实际：${singleFailures.join(" | ")}`);

  // 缺证据 / 缺置信度的条目仍须判 V10（不得因排版兼容而放松字段）。
  const noEvidence = buildValidDoc().replace(
    canon,
    [
      "## 九、方法论沉淀",
      "",
      "类型：钩子 / 规律：5秒完播高则播放高 / 置信度：已确认",
      "",
      "类型：形式 / 规律：长视频完播反超 / 证据：v5 / 置信度：已确认",
      ""
    ].join("\n")
  );
  assert(hasRule(runDeep(noEvidence), "V10"), "行内串联缺「证据」仍须判 V10");

  // 无发布时间数据：时间维度如实写「数据缺失」不得判 V9；数据里有发布时间却写「无」仍判 V9。
  const noPublishMetrics = computeVidrevMetrics(ROWS.map((row) => ({ ...row, published_at: null })));
  const noPublishDoc = buildValidDoc().replace(
    "| 时间 | 60 秒以上完播与播放双高 | 全部 6 条 |",
    "| 时间 | 发布时间字段缺失，本周期不做时间归因 | 无 |"
  );
  const noPublishFailures = runDeep(noPublishDoc, noPublishMetrics);
  assert(!hasRule(noPublishFailures, "V9"), `无发布时间数据时不得因时间维度判 V9，实际：${noPublishFailures.join(" | ")}`);
  assert(hasRule(runDeep(noPublishDoc), "V9"), "数据里有发布时间却写「无」仍须判 V9");
}

function checkRouteSchemaShape(): void {
  // 结构化入参必须支持附件 §六 的 rows / mode / platform / period / has_revenue_data，且缺字段为 null。
  const structured: VidrevRawRow[] = [
    { video_id: "v1", plays: 1000, likes: 10, comments: 1, shares: 1, conversions: null, completion_rate: null, is_paid: null, ad_spend: null }
  ];
  const metrics = computeVidrevMetrics(structured);
  assert(metrics.count === 1, "结构化入参必须可计算");
  assert(metrics.totalConversions === 0, "缺失转化计 0 条，但不得编造");
  assert(metrics.completionCoverage === 0, "缺完播率必须体现覆盖率 0，不能当 0% 完播率");
  assert(metrics.paidCount === 0, "投流标记缺失时按未区分处理");
  assert(metrics.paidFlagStatus.includes("未"), `投流标记缺失时审计应写「未区分」，实际 ${metrics.paidFlagStatus}`);
}

function main(): void {
  checkRowsParsing();
  checkMetrics();
  checkValidReport();
  checkFailureRules();
  checkModelFormatDrift();
  checkWorkOrder20260913();
  checkRouteSchemaShape();
  console.log("marketplace vidrev contract smoke: PASS（解析 / 加权口径 / 四象限 / 自适应分桶 / V1–V12 / 工单 2026-09-13 修改项 / 模型排版漂移兼容）");
}

main();
