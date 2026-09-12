import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, login, auth, invites, schema, shared, webApi, beautyWorkspace, wechatCallback] = await Promise.all([
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/LoginPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/invite-codes.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/db/prisma/schema.prisma", import.meta.url), "utf8"),
  readFile(new URL("../packages/shared/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/WeChatCallback.tsx", import.meta.url), "utf8"),
]);
const [server, guards] = await Promise.all([
  readFile(new URL("../apps/api/src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/access-guards.ts", import.meta.url), "utf8"),
]);
const styles = await readFile(new URL("../apps/web/src/styles/store-growth.css", import.meta.url), "utf8");
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
assert.match(login, /const directTestLogin = import\.meta\.env\.VITE_DIRECT_TEST_LOGIN === "true"/, "本机直接体验入口必须由构建期开关控制，生产包不得默认开启");
assert.match(login, /\(mode === "dev" \|\| directTestLogin\) && product && !isCustomDomain/, "产品登录页缺少仅本地可见的本机直接体验入口");
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
assert.match(main, /if \(path === "\/" \|\| path === ""\) \{[\s\S]{0,200}getAppPath\("\/agents"\)/, "平台根路径必须直接落到平台首页（/agents），不能落进旧的单品落地页");
// 平台首页更名（2026-09-11，产品对外叫「智能体平台」，入口不再用 market）：
// 老链接 `/market*` 必须按同后缀 1:1 跳到 `/agents*`，不许 404，也不许笼统塞回首页。
assert.match(
  main,
  /path === "\/market" \|\| path\.startsWith\("\/market\/"\)[\s\S]{0,160}getAppPath\(`\/agents\$\{path\.slice\("\/market"\.length\)\}`\)/,
  "旧地址 /market* 必须按同后缀跳到 /agents*",
);
assert.match(
  main,
  /path === "\/agents" \|\| path === "\/agents\/"\) \{[\s\S]{0,80}<MarketplaceHomePage \/>/,
  "平台首页必须由 /agents 精确匹配渲染（不得吞掉 /agents/:slug 单品页）",
);
// 登录死循环修复（QA-20260910-018）：以前只看 localStorage 有没有 token 就把
// `/login` 弹回货架，token 失效后用户会在登录页和货架之间来回跳。现在必须在
// 服务端探针确认会话仍有效时才回货架，失效会话要清掉本地 token 再渲染登录页。
// 断言随之改为锁「探针语义」，并显式禁掉「只看本地 token」的旧写法回归。
assert.match(
  main,
  /const isLoginRoute = path === "\/login" \|\| path === "\/login\/"/,
  "平台登录页门禁必须同时覆盖 /login 与 /login/",
);
assert.match(
  main,
  /!DIRECT_TEST_LOGIN_ENABLED && isLoginRoute && Boolean\(readSessionToken\(\)\)/,
  "已有会话访问平台登录页必须先做服务端会话探针，不能只看本地 token",
);
assert.match(
  main,
  /result === "valid"[\s\S]{0,120}window\.location\.replace\(takePostLoginRedirect\("\/agents"\)\)/,
  "会话探针确认有效时，访问平台登录页必须回平台首页（保留一次性安全回跳）",
);
assert.match(
  main,
  /result === "invalid"[\s\S]{0,60}clearStoredSession\(\)/,
  "会话探针确认失效时必须清掉本地会话再渲染登录页，避免登录死循环",
);
const localTokenOnlyLoginBounce =
  /\(path === "\/login" \|\| path === "\/login\/"\)[\s\S]{0,80}localStorage\.getItem\("store_os_token"\)/;
assert.doesNotMatch(
  main,
  localTokenOnlyLoginBounce,
  "平台登录页不得只凭本地 token 就把用户弹回货架（QA-20260910-018 登录死循环）",
);
assert.match(
  '!DIRECT_TEST_LOGIN_ENABLED && (path === "/login" || path === "/login/") && localStorage.getItem("store_os_token")',
  localTokenOnlyLoginBounce,
  "登录死循环守护自检失败：修复前的旧写法必须仍被判命中，否则本条断言已失效",
);
assert.match(login, /"登录 \/ 注册"/, "平台登录页必须同时承载登录与注册入口，不能只提供登录");
assert.match(login, /"微信一键登录 \/ 注册"/, "平台登录页必须提供微信一键登录 / 注册");
// 开放注册（服务端 INVITE_REQUIRED=false，用户 2026-09-10 拍板「去掉邀请码，只留微信一键登录/注册」）：
// 平台主入口不得再渲染邀请码入口；产品入口（美业 / 兰琪等）仍按产品邀请码校验。
const betaSchemaSection = auth.slice(auth.indexOf("const betaLoginSchema"), auth.indexOf("const productInviteValidationSchema"));
const productInviteSchemaSection = auth.slice(auth.indexOf("const productInviteValidationSchema"), auth.indexOf("const wechatLoginSchema"));
assert.match(
  betaSchemaSection,
  /inviteCode:\s*z\.string\(\)\.trim\(\)\.max\(200\)\.optional\(\)/,
  "开放注册下 /auth/beta-login 必须允许缺省邀请码，否则空邀请码会先被 schema 拦成 400，走不到服务端开放注册分支",
);
assert.match(
  productInviteSchemaSection,
  /inviteCode:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/,
  "产品入口的邀请码必须保持必填，去掉邀请码只针对平台主入口",
);
assert.match(
  invites,
  /if \(!inviteRequired && !normalized && !productCode\) \{\s*return \{ ok: true, source: "disabled" \};/,
  "开放注册只能放开无产品归属的平台主入口；缺省邀请码时是否放行由 INVITE_REQUIRED 决定，且产品入口必须始终校验产品邀请码",
);
assert.match(
  invites,
  /if \(!normalized\) \{\s*return \{ ok: false, error: "invite_code_required" \};/,
  "产品入口或邀请制下缺省邀请码必须返回 invite_code_required（403），不能被开放注册放行",
);
assert.doesNotMatch(
  login,
  /有邀请码？用邀请码开通/,
  "开放注册下平台主入口不得再出现邀请码入口，只保留微信一键登录 / 注册",
);
assert.doesNotMatch(
  login,
  /选填：用于记录邀请渠道/,
  "开放注册下不得再渲染可选的邀请码输入框",
);
assert.match(
  login,
  /const showInviteForm = invitesNeeded \? \(inviteFallbackOpen \|\| wechatReady === false\) : wechatReady === false;/,
  "邀请码表单必须只在邀请制下出现；开放注册只保留微信通道（微信不可用时才回落到人工开通表单）",
);
assert.match(
  login,
  /\{invitesNeeded && <label><span className="loginFieldLabel">邀请码/,
  "邀请码输入框必须只在邀请制下渲染",
);
assert.match(login, /完成注册，开通你的工作区/, "微信首次授权回来后必须进入完成注册步骤");
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

// QA-20260912-013（2026-09-12）：兰琪入口「先填邀请码再扫码」时，邀请码必须在
// 微信授权 + 「新用户补资料」这一跳里留住，否则老板扫码成功后仍被要求再填一次邀请码，
// 现场表现就是「已扫码，但还是登入不了」。
assert.match(login, /const pendingInviteKey = "store_os_pending_invite"/, "扫码开通必须把产品邀请码暂存在 sessionStorage");
assert.match(login, /rememberPendingInvite\(inviteCode\)/, "开始微信授权前必须记住产品邀请码");
assert.match(
  login,
  /\?invite=\$\{encodeURIComponent\(pendingInvite\)\}/,
  "授权回来补资料时必须把邀请码带回产品登录页",
);
assert.match(
  login,
  /submitProductInviteCode\(fromQuery\)/,
  "带 invite 参数回到产品入口时必须自动核验一次，不能再让老板手填第二遍",
);
assert.match(
  wechatCallback,
  /sessionStorage\.getItem\("store_os_pending_invite"\)/,
  "手机微信内授权回跳补资料时同样要带上邀请码",
);
console.log("扫码开通邀请码留存回归通过（QA-20260912-013）。");

// QA-20260912-014（用户 2026-09-12 口径）：「一个账号可以使用全平台」。
// 受控产品（兰琪）的开通闸门是**产品邀请码**，不是「一人只能一个产品」——
// 已开通外卖/美业的微信号再进兰琪入口，必须走 needsTenant 补资料开第二个租户，
// 不能再被 403 product_membership_required 挡死。
assert.doesNotMatch(
  auth,
  /error:\s*"product_membership_required"/,
  "不得再以「一号一产品」为由拦断第二个产品的开通",
);
assert.match(auth, /一个账号可以使用全平台的智能体/, "「一号多产品」的口径必须留痕，避免被无声改回");
assert.match(
  main,
  /splashTimer/,
  "登录过渡页必须有兜底超时（用户 2026-09-12：不能无限停在「正在确认登录状态」）",
);
assert.match(main, /setTimeout\(\(\) => \{\s*\n?\s*if \(!cancelled\) setState\("resolved"\)/, "兜底超时必须真正把页面切到已解状态");
assert.match(
  auth,
  /validateInviteCode\(code, plan, productCode\)|validateInviteCode\(parsed\.data\.inviteCode, planCode, product\?\.code\)/,
  "受控产品的开通仍必须强制校验产品邀请码（闸门没有被放宽）",
);
console.log("一号多产品口径回归通过（QA-20260912-014）。");

// QA-20260912-015（用户 2026-09-12 报障）：产品入口的门店资料表单是浅色卡片，
// 输入框不能沿用平台深色主题的底色——否则深字配深底，老板看不清自己填的内容
// （实测输入文字 rgb(18,32,58) 落在 rgba(9,13,20,.8) 上，对比度约 1.05:1）。
assert.match(
  styles,
  /\.productLoginPage \.loginForm input[\s\S]{0,220}?background:\s*#fff/i,
  "产品入口的门店资料输入框必须是浅底（深字配深底属不可读）",
);
console.log("产品入口表单可读性回归通过（QA-20260912-015）。");
