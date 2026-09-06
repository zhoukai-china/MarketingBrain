import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, login, auth, invites, schema, shared, webApi, beautyWorkspace] = await Promise.all([
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/LoginPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/invite-codes.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/db/prisma/schema.prisma", import.meta.url), "utf8"),
  readFile(new URL("../packages/shared/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8"),
]);
const [server, guards] = await Promise.all([
  readFile(new URL("../apps/api/src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/access-guards.ts", import.meta.url), "utf8"),
]);
const devSchemaSection = auth.slice(auth.indexOf("const devLoginSchema"), auth.indexOf("const betaLoginSchema"));
const devRouteSection = auth.slice(auth.indexOf('app.post("/auth/dev-login"'), auth.indexOf("// Check whether WeChat auth"));
const demoQuickLoginSection = login.slice(login.indexOf("async function handleDemoQuickLogin"), login.indexOf('if (!isCustomDomain && entry === "generic")'));

for (const route of ["/login/founder-ip", "/login/takeaway", "/login/lanqi", "/internal/onboarding"]) {
  assert.ok(main.includes(route), `缺少产品或内部登录路由：${route}`);
}

for (const product of ["founder-ip", "takeaway", "lanqi", "beauty-industry"]) {
  assert.ok(shared.includes(`\"${product}\"`), `共享产品登录契约缺少：${product}`);
}

assert.match(login, /entry:\s*LoginEntry/, "登录页必须显式接收入口类型，不能继续用经营类型代替产品");
assert.match(login, /\/auth\/product-invite\/validate/, "产品入口必须先验证邀请码再采集开通资料");
assert.match(login, /mode === "dev" && product && !isCustomDomain/, "产品登录页缺少仅开发环境可见的本机直接体验入口");
assert.match(login, /const demoLoginRole = product\?\.tenantRole/, "本机直接体验入口必须继承当前产品的租户身份");
assert.match(login, /const demoLoginPlanCode = product\?\.planCode/, "本机直接体验入口必须继承当前产品的套餐，不能回落到默认门店套餐");
assert.match(login, /isRedirectForProduct\(existingRedirect, product\.code\)/, "产品登录页必须保留当前产品的安全深链，不能无条件覆盖成产品首页");
assert.match(login, /path === prefix \|\| path\.startsWith\(`\$\{prefix\}\/`\)/, "登录回跳必须限制在当前产品路由范围内");
assert.match(main, /takePostLoginRedirect\(\)/, "登录完成后必须消费一次性安全回跳地址");
assert.match(beautyWorkspace, /reason instanceof ApiRequestError && reason\.status === 401/, "美业工作台必须识别失效会话的401，不能停在泛化加载失败");
assert.match(beautyWorkspace, /localStorage\.removeItem\("store_os_token"\)/, "401恢复前必须清理失效会话");
assert.match(beautyWorkspace, /window\.location\.replace\(getAppPath\("\/login\/beauty-industry"\)\)/, "401必须回到美业产品登录链");
assert.match(demoQuickLoginSection, /productCode:\s*product\?\.code/, "本机直接体验入口必须把当前产品代码交给后端授权链");
assert.match(auth, /productLoginCodeSchema/, "后端必须校验产品代码");
assert.match(devSchemaSection, /productCode:\s*productLoginCodeSchema\.optional\(\)/, "本机产品登录必须校验可选产品代码");
assert.match(devRouteSection, /grantBetaAgentEntitlements\(tx, nextWorkspace\.tenant\.id, product\?\.code\)/, "本机产品登录必须在同一事务内创建产品授权");
assert.equal(
  auth.match(/restrictWorkspaceToProductAgents\(tx, nextWorkspace\.tenant\.id, nextWorkspace\.user\.id, product\?\.code\)/g)?.length,
  2,
  "正式产品登录和本机产品登录都必须收窄到已购买产品的 Agent 集合",
);
assert.match(invites, /productCode/, "邀请码必须绑定产品");
assert.match(schema, /productCode\s+String\?/, "数据库邀请码缺少产品归属字段");
assert.match(schema, /model TenantProductEntitlement/, "无独立智能体的产品也必须有产品级授权记录");
assert.match(main, /stale generic[\s\S]*diagnosis state/, "产品登录页必须隔离旧通用诊断状态");
assert.match(main, /PRODUCT_LOGIN_DEFINITIONS\[loginEntry\]\.defaultPath/, "产品登录完成后必须回到对应产品默认页面");
assert.match(main, /function LanqiLocalAccessPage\(\)/, "必须提供兰琪本机专用直达入口");
assert.match(main, /!import\.meta\.env\.DEV \|\| !isLocalMachine/, "本机直达入口不得在正式环境或非本机地址启用");
assert.match(main, /getAppPath\("\/lanqi\/content-studio"\)/, "本机直达入口必须进入兰琪内容工作台");
assert.match(
  webApi,
  /return `\$\{appPath\}\$\{separator\}apiBase=\$\{encodeURIComponent\(queryApiBase\)\}`/,
  "本机产品入口跳转必须保留已校验的 apiBase，否则登录后会误连默认 API",
);
assert.match(auth, /productEntitlements/, "微信产品登录必须按产品授权筛选租户");
assert.match(guards, /requireProductEntitlement/, "产品 API 缺少统一授权守卫");
assert.match(server, /requireProductEntitlement\("lanqi"\)/, "兰琪 API 必须拒绝未授权租户");
assert.doesNotMatch(
  auth,
  /for \(const agentId of \[\"agent_acquisition\", \"agent_takeaway_growth\", \"agent_restaurant_growth\"\]\)/,
  "产品开通不能再一次性授予多个产品智能体",
);

console.log("产品独立登录入口回归通过：4 个产品入口、内部开通页、产品邀请码与按产品授权均已建立。");
