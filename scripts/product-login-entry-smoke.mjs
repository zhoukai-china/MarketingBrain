import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, login, auth, invites, schema, shared, webApi, beautyWorkspace, wechatCallback, marketplaceApp, referralNotice, rechargePage] = await Promise.all([
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/LoginPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/invite-codes.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/db/prisma/schema.prisma", import.meta.url), "utf8"),
  readFile(new URL("../packages/shared/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/WeChatCallback.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/MarketplaceApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/lib/referral-notice.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/RechargePage.tsx", import.meta.url), "utf8"),
]);
const [server, guards, register] = await Promise.all([
  readFile(new URL("../apps/api/src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/access-guards.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/products/register.ts", import.meta.url), "utf8"),
]);
const lanqiRoutes = await readFile(new URL("../apps/web/src/routes/lanqi.tsx", import.meta.url), "utf8");
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
assert.match(lanqiRoutes, /function LanqiLocalAccessPage\(\)/, "必须提供兰琪本机专用直达入口");
assert.match(lanqiRoutes, /!import\.meta\.env\.DEV \|\| !isLocalMachine/, "本机直达入口不得在正式环境或非本机地址启用");
assert.match(lanqiRoutes, /getAppPath\("\/lanqi\/content-studio"\)/, "本机直达入口必须进入兰琪内容工作台");
assert.match(
  webApi,
  /return `\$\{appPath\}\$\{separator\}apiBase=\$\{encodeURIComponent\(queryApiBase\)\}`/,
  "本机产品入口跳转必须保留已校验的 apiBase，否则登录后会误连默认 API",
);
assert.match(auth, /productEntitlements/, "微信产品登录必须按产品授权筛选租户");
assert.match(guards, /requireProductEntitlement/, "产品 API 缺少统一授权守卫");
assert.match(register, /requireProductEntitlement\("lanqi"\)/, "兰琪 API 必须拒绝未授权租户");
assert.match(server, /registerProductRoutes\(app, provider\)/, "产品路由必须统一由 registerProductRoutes 挂载");
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
  // 2026-09-12 起回跳 URL 同时带 invite 与 ref（推荐码），所以断言改成「query 里必须包含 invite 参数」，
  // 意图不变：授权回来补资料时，产品邀请码必须还在 URL 上。
  /invite=\$\{encodeURIComponent\(pendingInvite\)\}/,
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

// QA-20260912-017（用户 2026-09-12 真机截图报障）：手机上残留一个**过期的**
// `store_os_onboarding_token` 时，登录页会把自己渲染成「完成注册，开通你的工作区」，
// 把「微信一键登录 / 注册」入口藏起来；提交只会一直撞 401 `invalid_onboarding_token`，
// 连点 7 次都失败，页面上还直接把错误码当文案显示。这里把修复锁成契约：
//   ① 存在性之外必须校验 exp，过期/损坏当场清掉，登录入口必须回到首屏；
//   ② 服务端拒绝死令牌时，前端要清本地 + 恢复登录入口，并给「重新授权」的人话；
//   ③ 401 响应必须带可读中文 message，不能只回错误码。
assert.match(login, /function readUsableOnboardingToken\(\)/, "登录页必须识别过期的 onboarding token");
assert.match(login, /expiry \* 1000 <= Date\.now\(\)/, "过期判断必须真的比较 exp，不能只判断有没有值");
assert.match(login, /localStorage\.removeItem\(onboardingTokenKey\)/, "过期 token 必须当场清掉，不能继续伪装成「完成注册」页");
assert.match(
  login,
  /data\.error === "invalid_onboarding_token"[\s\S]{0,240}clearOnboardingToken\(\)/,
  "服务端拒绝死令牌时必须清本地并恢复登录入口",
);
assert.match(login, /onboardingExpired &&/, "过期后必须在登录页给出「上次授权已过期」的提示");
assert.match(
  login,
  /onboardingExpiredNoticeKey/,
  "过期提示必须用独立标记（React StrictMode 双调用初始化函数，写在 useState 里会丢）",
);
assert.match(
  auth,
  /error:\s*"invalid_onboarding_token",\s*message:/,
  "401 invalid_onboarding_token 必须带可读中文 message（不能把错误码当文案显示给用户）",
);
console.log("过期授权不得锁死登录入口的回归通过（QA-20260912-017）。");

// 用户 2026-09-12 第二轮口径：老账号带着推荐码登录时，页面要说清「已有工作区不产生推荐关系」，
// 不能每次都靠后台日志解释。锁三件事：① 登录页静态说明；② 老账号登录时打标；③ 落地页展示并带关闭。
assert.match(
  login,
  /只有首次开通工作区的新账号/,
  "登录页必须静态说明「只有首次开通工作区的新账号才登记推荐关系」",
);
assert.match(login, /markExistingUserReferralNotice\(\)/, "老账号带推荐码登录时必须打标提示");
assert.match(wechatCallback, /markExistingUserReferralNotice\(\)/, "微信回调成功登录的老账号同样要打标");
assert.match(referralNotice, /store_os_referral_existing_notice/, "提示标记必须落在独立 key 上，便于一次性消费");
assert.match(marketplaceApp, /推荐关系只在/, "货架落地页必须显示「已有工作区不产生推荐关系」的提示");
assert.match(marketplaceApp, /clearExistingUserReferralNotice\(\)/, "提示必须可关闭（一次性消费）");
console.log("老账号带推荐码的提示回归通过（PLAT-28 第①批补充）。");

// 2026-09-12 用户真机：平台登录页「完成注册」表单里，品牌名字体太浅看不清。
// 实测根因：亮色主题下 --text 是深蓝 #12203A，而输入框底是固定近黑 rgba(9,13,20,.8) → 对比度 1.23:1。
assert.match(
  styles,
  /\.loginPage:not\(\.productLoginPage\) \.loginForm input[\s\S]{0,320}?color:\s*#f2f2f4/i,
  "平台登录页输入框必须固定深底浅字（亮色主题下不能用 --text 的深蓝）",
);
assert.match(
  styles,
  /-webkit-text-fill-color:\s*#f2f2f4/i,
  "必须用 -webkit-text-fill-color 防止微信/安卓强制深色模式再改色",
);
assert.match(
  styles,
  /\.loginPage:not\(\.productLoginPage\) \.loginForm label span\s*\{\s*color:\s*#c9d2e0/i,
  "平台登录页表单标签的颜色要提到可读对比度",
);
console.log("平台登录页输入框对比度回归通过（QA-20260912-021）。");

// 2026-09-12 真机：老板带推荐码注册成功但归因没落 —— 前端把码弄丢了。
// 契约：推荐码必须双保险（sessionStorage + localStorage 24h），并且回调回跳 URL 继续带 ?ref=。
assert.match(referralNotice, /store_os_referral_existing_notice/, "老账号提示标记仍在");
assert.match(
  login,
  /from "\.\.\/lib\/pending-referral\.js"/,
  "登录页必须使用双保险的推荐码暂存（pending-referral），不能只用 sessionStorage",
);
assert.match(
  wechatCallback,
  /ref=\$\{encodeURIComponent\(pendingReferral\)\}/,
  "微信回调回跳到补资料页时必须在 URL 上继续带 ref=",
);
assert.match(
  login,
  /ref=\$\{encodeURIComponent\(pendingReferral\)\}/,
  "扫码中转回跳到补资料页时同样要带 ref=",
);
console.log("推荐码跨授权往返不丢的回归通过（QA-20260912-022）。");

// 2026-09-13 真机取证（nginx 日志）：用户从推荐链接进登录页后，在货架点「登录」跳到不带 query 的
// `/login`，微信回调的 state 也不带码 → 补资料提交时码没了。加固：① 码进微信 state；② 所有「去登录」跳转带码。
assert.match(login, /pendingReferralForState/, "微信授权必须把推荐码塞进 state（微信原样回传）");
assert.match(wechatCallback, /referralFromState/, "回调页必须能从 state 里把推荐码还原");
assert.match(marketplaceApp, /loginPathWithPendingReferral/, "货架等「去登录」跳转必须自动带上暂存的推荐码");
assert.match(referralNotice, /store_os_referral_existing_notice/, "老账号提示标记仍在（防止被覆盖）");
console.log("推荐码在站内跳转/微信回调两处断点的回归通过（QA-20260913-002）。");

// 2026-09-13 用户真机：手机微信里打开充值页只出 Native 二维码，用户无法扫自己屏幕、
// 长按识别又被微信拒绝（“该商户暂时不支持通过长按识别二维码完成支付”）。
// 契约：微信内必须走 JSAPI 收银台；其它环境仍保留二维码；两者都不能被写死成单一方式。
assert.match(rechargePage, /function isWechatInAppBrowser\(\)/, "充值页必须能识别微信内置浏览器");
assert.match(rechargePage, /tradeType: "jsapi"/, "微信内必须请求 JSAPI 收银台");
assert.match(rechargePage, /invokeWechatJsapiPay|WeixinJSBridge/, "微信内必须真的调起 WeixinJSBridge 收银台");
assert.match(rechargePage, /tradeType: "native"/, "非微信环境（电脑/普通浏览器）仍须保留扫码方式");
console.log("手机微信内支付的回归通过（QA-20260913-003）。");
