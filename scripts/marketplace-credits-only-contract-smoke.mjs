#!/usr/bin/env node
/**
 * PLAT-19「客户界面只显示积分、不显示人民币折算」契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 为什么要有这个契约：用户 2026-09-12 明确要求「每次生成提示用户消耗多少积分就可以了，
 * 不要告诉花了多少钱，比如『约扣 60 积分 · ≈ ¥3』去掉 ≈ ¥3；平台每个智能体页面都只显示
 * 消耗多少积分，不显示消耗多少元」。这类要求最容易被下一次改 UI 时顺手改回去，
 * 所以把口径写死成源码契约，改回去 `qa:fast` 直接红。
 *
 * 三条口径：
 *  ① 缺席：`apps/web/src` 客户界面不得再渲染 `≈ ¥` 折算，也不得引用
 *     `yuanLabelForCredits` / `creditsToYuan` / `formatYuanText`；
 *  ② 保留：**交付完成之后**必须告诉用户这次消耗了多少积分（聊天页「本次消耗 N 积分」），
 *     以及导出这种单独动作需要多少积分；**使用前不再反复提示要扣多少积分**
 *     （2026-09-13 用户口径：「每次使用都要告诉扣多少积分，感受不好」——前置金额一律去掉）；
 *  ③ 例外：`/recharge` 是**真实支付**页面，`¥` 是用户实际要付的钱，不属于「积分折算」，
 *     必须保留（本契约用白名单显式豁免，并要求它继续展示真实价格）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function requireContains(source, needle, name) {
  const hit = source.includes(needle);
  record(name, hit, hit ? `命中 ${needle}` : `缺少 ${needle}`);
}

function forbidContains(source, needle, name) {
  const hit = source.includes(needle);
  record(name, !hit, hit ? `仍存在 ${needle}` : "未出现");
}

/** 递归列出 `apps/web/src` 下的源码文件（只看 .ts / .tsx，跳过测试与样式）。 */
function listWebSources(dir = path.join(repoRoot, "apps/web/src"), collected = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      listWebSources(full, collected);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    collected.push(path.relative(repoRoot, full).split(path.sep).join("/"));
  }
  return collected;
}

/**
 * 白名单：`/recharge` 是真实支付页，`¥` 是用户实际付款金额（不是积分折算），
 * 按用户口径必须保留。新增豁免必须在这里显式登记，避免「顺手」把折算留在别处。
 */
const REAL_PAYMENT_WHITELIST = new Set(["apps/web/src/pages/RechargePage.tsx"]);

const webSources = listWebSources();

/* ------------------------------------------------------------------ *
 * ① 缺席：客户界面不得再出现人民币折算，也不得引用折算函数
 * ------------------------------------------------------------------ */

const YUAN_CONVERSION = /≈\s*¥/;
/** 「积分」后面 14 个字符内跟着 ¥ 视为折算写法（例如「60 积分 · ≈¥3」「60 积分（¥3）」）。 */
const CREDITS_WITH_YUAN = /积分[^。\n]{0,14}¥|积分[^。\n]{0,14}≈/;

const conversionHits = [];
const creditsYuanHits = [];
const helperHits = [];
for (const file of webSources) {
  const source = read(file);
  if (YUAN_CONVERSION.test(source)) conversionHits.push(file);
  if (CREDITS_WITH_YUAN.test(source) && !REAL_PAYMENT_WHITELIST.has(file)) creditsYuanHits.push(file);
  if (/yuanLabelForCredits|creditsToYuan|formatYuanText/.test(source)) helperHits.push(file);
}

record(
  "客户界面不再出现「≈ ¥」人民币折算",
  conversionHits.length === 0,
  conversionHits.length === 0 ? `扫描 ${webSources.length} 个前端源码文件` : `仍存在：${conversionHits.join("、")}`
);
record(
  "积分标价后面不再跟人民币金额（真实支付页除外）",
  creditsYuanHits.length === 0,
  creditsYuanHits.length === 0
    ? `扫描 ${webSources.length} 个前端源码文件，豁免 ${[...REAL_PAYMENT_WHITELIST].join("、")}`
    : `仍存在：${creditsYuanHits.join("、")}`
);
record(
  "前端不再引用积分→人民币折算函数",
  helperHits.length === 0,
  helperHits.length === 0 ? "未引用 yuanLabelForCredits / creditsToYuan / formatYuanText" : `仍引用：${helperHits.join("、")}`
);

const agentDetail = read("apps/web/src/marketplace/AgentDetailPage.tsx");
const agentChat = read("apps/web/src/marketplace/AgentChatPage.tsx");
const homePage = read("apps/web/src/marketplace/HomePage.tsx");
const marketplacePages = agentDetail + homePage + agentChat;
forbidContains(marketplacePages, "≈ ¥", "货架与智能体页面不再拼「≈ ¥」文案");

/* ------------------------------------------------------------------ *
 * ② 保留：扣费提示必须仍然明确说出「多少积分」
 * ------------------------------------------------------------------ */

const chatMessages = read("apps/web/src/components/chat/ChatMessages.tsx");

// 用户 2026-09-16：使用前给「预估」、使用后给「实际」——所以这里改成精确匹配「本次实际消耗」。
requireContains(agentChat, "本次实际消耗 {cost} 积分", "聊天页顶部仍显示本次实际消耗积分");
requireContains(agentChat, "本次导出需 ${required} 积分", "积分不足的导出提示仍说明所需积分");
requireContains(agentChat, "${docxPrice} 积分", "Word 导出按钮仍显示所需积分");
// 2026-09-13 用户口径：使用前不再出现任何「要扣多少积分」的前置提示（只在交付后告知消耗）。
forbidContains(marketplacePages, "约扣 {runSku?.ppu ?? 0} 积分", "生成确认气泡不得再前置报价");
forbidContains(marketplacePages, "扣 ${steps[0]?.ppu ?? 0} 积分", "分步链路按钮不得再前置报价");
forbidContains(marketplacePages, "${sku.ppu} 积分/次", "单品详情不得再显示「N 积分/次」");
forbidContains(marketplacePages, "会按次扣 {runSku?.ppu ?? 0} 积分", "重做提示不得再前置报价");
forbidContains(marketplacePages, "每生成一次扣", "登录引导不得再前置报价");
// 2026-09-13 用户口径：对话框必须支持把文件直接拖进来（文本类附件要真的被读进需求）。
requireContains(agentChat, "onDragOver=", "对话框必须支持拖拽（onDragOver）");
requireContains(agentChat, "onDrop=", "对话框必须支持拖拽（onDrop）");
requireContains(agentChat, "async function addFiles(", "拖拽/上传必须走统一的附件入口");
requireContains(agentChat, "【附件：${item.name}】", "文本类附件内容必须真的拼进需求单");
requireContains(chatMessages, "${docxPrice} 积分", "工作台聊天页 Word 导出按钮仍显示所需积分");

/* ------------------------------------------------------------------ *
 * ③ 例外与内部口径：真实支付页保留人民币；内部折算函数必须标明用途
 * ------------------------------------------------------------------ */

const recharge = read("apps/web/src/pages/RechargePage.tsx");
requireContains(recharge, "¥${currentPlan.priceCny}", "充值页仍显示真实付款金额（真实支付，不是积分折算）");
requireContains(recharge, "基准 1 元 = 20 积分", "充值页仍说明积分与真实金额的换算基准");
requireContains(recharge, "请帮我在 WorkBuddy 中接入", "充值页必须给出可直接复制给 WorkBuddy 的 MCP 安装指令");
requireContains(recharge, "/integrations/workbuddy/mcp", "充值页安装指令必须指向 WorkBuddy MCP 地址");

const shared = read("packages/shared/src/index.ts");
requireContains(shared, "export function yuanLabelForCredits", "shared 仍保留折算函数供内部/管理端使用");
requireContains(shared, "仅供内部", "折算函数已标注「仅供内部/管理端使用」");
requireContains(shared, "marketplace:credits-only-contract-smoke", "折算函数注释指向本契约，防止被搬回客户界面");

/* ------------------------------------------------------------------ *
 * ④ 契约自身必须挂在 qa:fast 上，否则形同虚设
 * ------------------------------------------------------------------ */

const packageJson = read("package.json");
requireContains(packageJson, '"marketplace:credits-only-contract-smoke"', "package.json 已注册 marketplace:credits-only-contract-smoke");
requireContains(packageJson, "pnpm marketplace:credits-only-contract-smoke", "marketplace:credits-only-contract-smoke 已挂进 qa:fast");

const passed = results.length - failures;
console.log(`\nmarketplace_credits_only_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${passed} passed / ${failures} failed)`);
if (failures > 0) process.exit(1);
