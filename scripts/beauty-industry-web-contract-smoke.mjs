import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function main() {
  const [page, styles, workbuddyPage, loginPage, profile, route, execution, outputContract, routeReceipt, workflows, adapter, mcpRoute, mainEntry, server, account, sharedSource, sharedRuntime, productRegister] = await Promise.all([
    read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"),
    read("apps/web/src/styles/beauty-industry.css"),
    read("apps/web/src/pages/BeautyIndustryWorkBuddyPage.tsx"),
    read("apps/web/src/pages/LoginPage.tsx"),
    read("apps/api/src/products/beauty-industry/profile.ts"),
    read("apps/api/src/routes/beauty-industry.ts"),
    read("apps/api/src/products/beauty-industry/execution.ts"),
    read("apps/api/src/products/beauty-industry/output-contract.ts"),
    read("apps/api/src/products/beauty-industry/route-receipt.ts"),
    read("apps/api/src/products/beauty-industry/workflows.ts"),
    read("apps/api/src/products/beauty-industry/mcp-adapter.ts"),
    read("apps/api/src/routes/workbuddy-mcp.ts"),
    read("apps/web/src/main.tsx"),
    read("apps/api/src/server.ts"),
    read("apps/web/src/pages/AgentProductsApp.tsx"),
    read("packages/shared/src/index.ts"),
    read("packages/shared/dist/index.js"),
    // PLAT-32 之后美业路由挂在 products/register.ts（server.ts 只做产品注册装配）。
    read("apps/api/src/products/register.ts")
  ]);

  assert.match(page, /美业经营工作台/);
  assert.match(page, /美业经营档案/);
  assert.match(page, /快速模式/);
  assert.match(page, /专业模式/);
  assert.match(page, /本次可以使用的真实信息（选填）/);
  assert.match(page, /美业AI改造日报/);
  assert.match(page, /美业知识问题/);
  assert.match(page, /美业专属经营诊断/);
  assert.match(page, /删除档案/);
  assert.match(page, /beauty-industry.profile/);
  assert.match(page, /图文获客/);
  assert.match(page, /视频获客/);
  assert.match(page, /直播获客/);
  assert.match(page, /小红书图文/);
  assert.match(page, /\/beauty-industry\/acquisition\/runs/);
  assert.doesNotMatch(page, /兰琪|蓝旗|验收A店|验收B店|tenantKey/);
  assert.match(page, /文生视频（数字人方向 · 规划中）/);
  assert.match(page, /图生视频（数字人方向 · 规划中）/);
  assert.match(page, /内容系统/);
  assert.match(page, /正式 V5 十件结构/);
  assert.doesNotMatch(page, /内容四件套/);
  assert.match(page, /准备发布\/经营的渠道（可多选）/);
  assert.match(page, /纹绣/);
  assert.match(page, /身体护理/);
  assert.match(page, /其他\/自定义/);
  assert.doesNotMatch(page, /品牌中立|显式选择的模块|模块已锁定|自由文本不会|不需要跳转页面|不会自动抓取企微|今日经营动作/);
  assert.match(page, /setNotice\("文件解析失败；已禁止复盘，不会调用模型或扣积分。"\)/);
  assert.match(page, /系统未生成有效结果，未保存且预留积分已释放；无需重复点击/);
  assert.match(page, /本次请求已失败；未保存结果，预留积分已释放，可修改后重试/);
  assert.match(page, /网络连接中断；未自动重试，可使用同一请求恢复状态/);
  assert.match(styles, /\.beautyIndustryMarkdown\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.beautyIndustryMarkdown table\s*\{[^}]*display:\s*block[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);

  for (const label of ["美业选题生成", "内容系统", "小红书图文生成", "直播话术生成", "视频数据复盘", "直播复盘", "美业销售建议"]) assert.match(workbuddyPage, new RegExp(label));
  assert.doesNotMatch(workbuddyPage, /<strong>\{tool\.name\}<\/strong>/);
  assert.match(loginPage, /product\?\.code === "beauty-industry"/);
  assert.match(loginPage, /门店\/品牌名称/);
  assert.match(loginPage, /XX皮肤管理中心/);
  assert.doesNotMatch(loginPage, /枕水江南/);
  assert.match(profile, /customSegment/);
  assert.match(profile, /beauty_segment_custom_required/);

  assert.match(route, /executeBeautyIndustryProductTool/);
  assert.match(route, /saveBeautyIndustryProfile/);
  assert.match(route, /deleteBeautyIndustryProfile/);
  assert.match(route, /profileVersion/);
  assert.match(route, /buildBeautyTodayActions/);
  assert.match(route, /slice\(0, 3\)/);
  assert.match(route, /channel: "web"/);
  assert.match(route, /beauty-industry\/acquisition\/history/);
  assert.match(execution, /reserveCreditsBeforeProvider/);
  assert.match(execution, /persistChatResult/);
  assert.match(execution, /assertBeautyWorkflowRuntimeResult/);
  assert.match(execution, /conversationId: undefined/);
  assert.match(outputContract, /unverified_runtime_fallback/);
  assert.match(outputContract, /runtime_skill_mismatch/);
  assert.match(routeReceipt, /beauty-route-receipt-v1/);
  assert.match(workflows, /video-content-review|shooting_editing/);
  assert.match(execution, /buildBeautyIndustryRunInput/);
  assert.match(execution, /readBeautyIndustryProfileFromTenantData/);
  assert.match(mcpRoute, /executeBeautyIndustryProductTool/);
  assert.match(mcpRoute, /routeReceipt/);
  assert.doesNotMatch(adapter, /beauty\.compliance_check|beauty\.paid_traffic_preview/);
  assert.match(adapter, /beauty\.sales_advice/);
  assert.match(mainEntry, /BeautyIndustryAcquisitionPage/);
  assert.match(mainEntry, /path\.startsWith\("\/login\/beauty-industry"\) \? "beauty-industry"/);
// PLAT-32（commit 0e7053a）把产品路由从 server.ts 拆到 products/register.ts，
// 这里不能再断言 server.ts 里直接出现 `registerBeautyIndustryRoutes`（断言过期会让整条
// `beauty-industry:web-contract-smoke` 一直红）。口径不变：server 装配产品路由，美业路由真被注册。
assert.match(server, /registerProductRoutes/, "server 必须通过 products/register.ts 装配产品路由（PLAT-32 拆分后）");
assert.match(productRegister, /registerBeautyIndustryRoutes/, "美业路由必须真被注册（现在挂在 products/register.ts）");
  assert.match(account, /productCode: "beauty-industry"/);
  for (const shared of [sharedSource, sharedRuntime]) {
    assert.match(shared, /name: "美业智能体"/);
    assert.match(shared, /shortName: "美业智能体"/);
    assert.match(shared, /headline: "进入美业智能体"/);
    assert.doesNotMatch(shared, /美业行业通用智能体|通用美业智能体/);
    assert.doesNotMatch(shared.match(/"beauty-industry"[\s\S]*?agent_beauty_acquisition/)?.[0] ?? "", /品牌中立|投流预览/);
  }

  console.log("Beauty industry web/MCP shared execution contract smoke passed.");
}

void main();
