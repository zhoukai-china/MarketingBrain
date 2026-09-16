// 2026-09-16 用户口径的离线契约回归：
//   ①「常用智能体」是**独立列表页**（一级导航 → `/my-agents`），不再是「我的」页的锚点；
//   ②「我的」页的**历史交付物（产物）段落始终渲染**，并写明「保存 7 天」——以前是 length>0 才渲染，
//     客户没有产物时看不到这个功能，等于藏起来了。
// 纯源码契约，毫秒级；涉及真实数据与渲染的部分由真机验收覆盖（见 docs/CURRENT_DEPLOYMENT_STATUS.md）。
import { readFileSync } from "node:fs";

const shell = readFileSync("apps/web/src/marketplace/shell.tsx", "utf8");
const main = readFileSync("apps/web/src/main.tsx", "utf8");
const myAgents = readFileSync("apps/web/src/marketplace/MyAgentsPage.tsx", "utf8");
const mine = readFileSync("apps/web/src/marketplace/MinePage.tsx", "utf8");
const api = readFileSync("apps/api/src/routes/marketplace.ts", "utf8");

let failed = 0;
function check(ok, label) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

// ① 一级导航：顺序固定为 货架 → 常用智能体 → 积分充值 → 我的，且「常用智能体」指向独立页
// 只认「同一个元素上 onClick(onNavigate(路径)) 紧跟着文字」的导航项；
// 品牌位那种 `onNavigate(...)>` 后面先换行再 `<span>` 的写法，文字是空的，过滤掉。
const navOrder = [...shell.matchAll(/onNavigate\("(\/agents|\/my-agents|\/recharge|\/mine)"\)\}>([^<\s][^<]*)</g)]
  .map((m) => ({ href: m[1], label: m[2].trim() }))
  .filter((item) => item.label.length > 0 && !item.label.includes("{"));
check(
  JSON.stringify(navOrder.map((item) => item.label)) === JSON.stringify(["货架", "常用智能体", "积分充值", "我的"]),
  `一级导航顺序 = 货架 / 常用智能体 / 积分充值 / 我的（实际：${navOrder.map((item) => item.label).join(" / ")}）`
);
check(navOrder[1]?.href === "/my-agents", "「常用智能体」指向独立页 /my-agents（不再指 /mine 锚点）");
check(navOrder[3]?.href === "/mine", "「我的」指向 /mine");
check(!shell.includes('onNavigate("/mine#recent")'), "旧的 /mine#recent 锚点入口已移除");

// ② 路由与页面
check(/path === "\/my-agents"/.test(main), "main.tsx 注册了 /my-agents 路由");
check(/MarketplaceMyAgentsPage = lazy\(/.test(main), "/my-agents 走懒加载（不拖慢首屏）");
check(/apiPath\("\/market\/me\/agents"\)/.test(myAgents), "页面读的是 /market/me/agents（聚合接口）");
check(/继续使用/.test(myAgents) && /\/agent\/\$\{encodeURIComponent\(agent\.skuCode\)\}\/chat/.test(myAgents), "每张卡有「继续使用」直达该智能体对话页");
check(/去货架逛逛/.test(myAgents), "空态有明确去处（去货架逛逛），不是白屏");

// ③ API：聚合口径 + 租户隔离 + 未登录显式 401
check(/market\.get\("\/me\/agents"/.test(api), "注册 GET /market/me/agents");
check(/type: "ppu_consume"/.test(api) && /by: \["skuId"\]/.test(api), "按 SKU 聚合真实扣费流水（ppu_consume）");
check(/tenantId: context\.tenantId/.test(api.split("async function listFrequentAgents")[1] ?? ""), "聚合按租户隔离（tenantId）");
check(/code\(401\)\.send\(\{ error: "login_required"/.test(api.split('"/me/agents"')[1] ?? ""), "未登录返回 401 login_required");

// ④ 「我的」页：产物段落始终渲染 + 7 天口径 + 空态
check(/<h3>历史交付物 · 保存 7 天，请及时下载<\/h3>/.test(mine), "「我的」页有产物段落标题（含 7 天口径）");
check(!/deliverables\.length > 0 && \(/.test(mine), "产物段落不再被「有产物才渲染」藏起来");
check(/还没有交付物/.test(mine), "没有产物时有空态说明（客户知道生成后会出现在这里）");
check(/下载 Word/.test(mine), "产物卡片有「下载 Word」");
check(/\/my-agents/.test(mine), "「我的」页给出「常用智能体」入口（不再重复列使用记录）");

if (failed > 0) {
  console.error(`marketplace_my_agents_contract_smoke: FAIL (${failed} failed)`);
  process.exit(1);
}
console.log("marketplace_my_agents_contract_smoke: PASS");
