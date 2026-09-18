#!/usr/bin/env node
/**
 * PLAT-48 市场合伙人（第①批：归因打通）源码契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 本契约锁「专属链接 → 注册绑定」这条链路的接线，不替代需要真实 PostgreSQL 的服务级
 * 归因 smoke（`market-partner:attribution-smoke`）。这里只保证：
 *   1. 后端 schema / 路由 / 归因钩子三处都接上了 `partnerCode`；
 *   2. 管理员入口 `POST/GET /admin/market-partners` 存在且带管理员令牌守卫；
 *   3. 前端 `?partner=` 的暂存、OAuth state 往返、提交都有接线；
 *   4. 对外文案不出现「分销商」（沿用平台路由契约，这里再兜一层）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

let failures = 0;
function record(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function contains(source, needle) {
  return source.includes(needle);
}

const authSchemas = read("apps/api/src/routes/auth-schemas.ts");
const authRoutes = read("apps/api/src/routes/auth.ts");
const adminRoutes = read("apps/api/src/routes/admin.ts");
const partnerService = read("apps/api/src/services/market-partner.ts");
const main = read("apps/web/src/main.tsx");
const loginPage = read("apps/web/src/pages/LoginPage.tsx");
const wechatCallback = read("apps/web/src/pages/WeChatCallback.tsx");
const pendingPartner = read("apps/web/src/lib/pending-partner.ts");
const partnerShare = read("apps/api/src/services/billing-cost-model.ts");
const marketplaceRoutes = read("apps/api/src/routes/marketplace.ts");
const selfService = read("apps/api/src/services/market-partner-self-service.ts");
const minePage = read("apps/web/src/marketplace/MinePage.tsx");
const partnerConsole = read("apps/web/src/marketplace/PartnerConsolePage.tsx");
const prismaSchema = read("packages/db/prisma/schema.prisma");
const commissionService = read("apps/api/src/services/market-partner-commission.ts");
const lanqiWallet = read("apps/api/src/services/lanqi-wallet.ts");
const dashboardService = read("apps/api/src/services/market-partner-dashboard.ts");
const adminConsole = read("apps/web/src/marketplace/AdminConsolePage.tsx");

// 后端 schema 三处都允许 partnerCode。
const schemaCount = (authSchemas.match(/partnerCode:/g) ?? []).length;
record("auth-schemas 三个 schema 都接收 partnerCode", schemaCount >= 3, `命中 ${schemaCount} 处`);

// auth.ts 接入归因服务并调用三次。
record("auth.ts 引入 bindMarketPartnerForNewUser", contains(authRoutes, "bindMarketPartnerForNewUser"));
record("auth.ts 有三处市场合伙人归因钩子", (authRoutes.match(/bindMarketPartnerForNewUser\(\{/g) ?? []).length >= 3);
record("auth.ts 三处返回 partner.state", (authRoutes.match(/partner: \{ state: partner.state \}/g) ?? []).length >= 3);

// 管理员入口存在且守卫。
record("admin.ts 有 POST /admin/market-partners", contains(adminRoutes, 'app.post("/admin/market-partners"'));
record("admin.ts 有 GET /admin/market-partners", contains(adminRoutes, 'app.get("/admin/market-partners"'));
record("admin.ts 两个市场合伙人路由都带 requireAdminToken", contains(adminRoutes, '"/admin/market-partners", { preHandler: requireAdminToken }'));

// 归因服务核心契约。
record("归因 source 标记为 market_partner_link", contains(partnerService, "market_partner_link"));
record("自荐（合伙人自己用自己链接）被拒绝", contains(partnerService, "distributor.userId === params.referredUserId"));
record("归因失败不阻断注册（best-effort）", contains(partnerService, "注册不受影响"));

// 前端 ?partner= 接线。
record("main.tsx 读取 ?partner= 并暂存", contains(main, 'params.get("partner")') && contains(main, "rememberPendingPartner"));
record("LoginPage 读取 ?partner=", contains(loginPage, 'get("partner")'));
record("LoginPage 提交 partnerCode", contains(loginPage, "partnerCode: readPendingPartner() || undefined"));
record("LoginPage 把合伙人码塞进微信 state", contains(loginPage, "pendingPartnerForState"));
record("WeChatCallback 解析并保留合伙人码", contains(wechatCallback, "partnerFromState") && contains(wechatCallback, "rememberPendingPartner"));
record("pending-partner 有 24 小时跨 webview 暂存", contains(pendingPartner, "PENDING_PARTNER_TTL_MS"));

// 本批不提前发佣金：PARTNER_SHARE_PERCENT 仍全为 null（第②批才填比例）。
const shareAllNull = ["text: null", "image: null", "video: null", "speech: null", "vision: null"]
  .every((needle) => contains(partnerShare, needle));
record("第①批不提前发佣金：PARTNER_SHARE_PERCENT 仍全为 null", shareAllNull);

// ---------------------------------------------------------------------------
// PLAT-49：市场合伙人自助生成专属链接（管理员授予资格，fail-closed）。
// ---------------------------------------------------------------------------
record("self-service 有资格开关 hasMarketPartnerGrant", contains(selfService, "hasMarketPartnerGrant"));
record("self-service 未授予资格 fail-closed（forbidden）", contains(selfService, 'state: "forbidden"'));
record("self-service 复用同一链接（regenerate 才发新码）", contains(selfService, "params.regenerate"));
record("marketplace 有 GET /me/partner-link", contains(marketplaceRoutes, 'market.get("/me/partner-link"'));
record("marketplace 有 POST /me/partner-link", contains(marketplaceRoutes, 'market.post("/me/partner-link"'));
record("未授予资格时返回 partner_self_service_forbidden", contains(marketplaceRoutes, "partner_self_service_forbidden"));
record("admin 有资格授予接口", contains(adminRoutes, 'app.post("/admin/market-partner-grants"'));
record("admin 有资格撤销接口", contains(adminRoutes, 'app.delete<{ Params: { userId: string } }>("/admin/market-partner-grants/:userId"'));
record("admin 有资格列表接口", contains(adminRoutes, 'app.get("/admin/market-partner-grants"'));
// 资格授予的最后一公里：后台要能「按人挑」，否则老板手上没有 userId，界面等于走不通。
record("admin 有资格候选人接口", contains(adminRoutes, '"/admin/market-partner-candidates"'));
record("候选人查询走可测服务函数", contains(adminRoutes, "listMarketPartnerCandidates"));
record("self-service 有候选人查询实现", contains(selfService, "listMarketPartnerCandidates"));
record("候选人接口在管理员令牌守卫后", contains(adminRoutes, 'app.get("/admin/market-partner-candidates", { preHandler: requireAdminToken }'));
record("AdminConsole 有授予资格接线", contains(adminConsole, 'apiPath("/admin/market-partner-grants")'));
record("AdminConsole 有撤销资格接线", contains(adminConsole, "/admin/market-partner-grants/${encodeURIComponent(target)}"));
record("AdminConsole 有资格候选人取数", contains(adminConsole, "/admin/market-partner-candidates?limit=20&q="));
record("Prisma 有 MarketPartnerGrant 模型", contains(prismaSchema, "model MarketPartnerGrant"));
record("迁移文件存在", existsSync(path.join(repoRoot, "packages/db/prisma/migrations/202609180001_market_partner_grant/migration.sql")));
// 2026-09-18（老板验收）：「就是个单独的后台，由我单独找市场合伙人发放，不应该在用户端。」
// 所以这里锁两件事：① 用户端「我的」页不能再出现任何合伙人入口；② 入口独立成 `/partner` 且仍 fail-closed。
// 断的是「页面不再取合伙人数据、不再渲染合伙人卡片」，不是断注释里的字样——
// 用户端页面上会留一条说明为什么这块被移走，那是给人看的，不是入口。
record(
  "用户端「我的」页不再取合伙人数据、不再渲染合伙人卡片",
  !contains(minePage, "/market/me/partner-link") &&
    !contains(minePage, "/market/me/partner-dashboard") &&
    !contains(minePage, "data-partner-card") &&
    !contains(minePage, "PartnerLinkCard")
);
record("合伙人入口独立成页并注册路由 /partner", contains(main, '"/partner"') && contains(main, "MarketPartnerConsolePage"));
record("合伙人页渲染专属链接卡片", contains(partnerConsole, "市场合伙人专属链接"));
record("合伙人页读取 /market/me/partner-link", contains(partnerConsole, 'apiPath("/market/me/partner-link")'));
record("合伙人页未授予资格时整卡不渲染", contains(partnerConsole, "setForbidden(true)"));

// ---------------------------------------------------------------------------
// PLAT-48 第②批：结算任务（spent.paid × 20%，冻结 7 天，幂等 / 可冲正）。
// ---------------------------------------------------------------------------
record("佣金服务按 spent.paid 计算（20%）", contains(commissionService, "spentPaid"));
record("佣金换算 1 paid 积分 = ¥0.05、20% = ¥0.01", contains(commissionService, "credits / 100"));
record("冻结期 7 天", contains(commissionService, "PARTNER_COMMISSION_FREEZE_DAYS = 7"));
record("有幂等结算 settleMarketPartnerCommission", contains(commissionService, "settleMarketPartnerCommission"));
record("有退款冲正 reverseMarketPartnerCommission", contains(commissionService, "reverseMarketPartnerCommission"));
record("有到期解冻 unfreezeDuePartnerCommissions", contains(commissionService, "unfreezeDuePartnerCommissions"));
record("DistroCommissionLog 有唯一 idempotencyKey", contains(prismaSchema, "idempotencyKey      String?   @unique"));
record("结算幂等迁移存在", existsSync(path.join(repoRoot, "packages/db/prisma/migrations/202609180002_distro_commission_idempotency/migration.sql")));
record("货架 run 成功扣费后结算佣金", contains(marketplaceRoutes, "settleMarketPartnerCommission"));
record("货架订阅 charge 后结算佣金", contains(marketplaceRoutes, "market-partner:subscription:"));
record("兰琪扣费后结算佣金", contains(lanqiWallet, "settleMarketPartnerCommission"));

// ---------------------------------------------------------------------------
// PLAT-48 第③批：只读分销后台（合伙人自看 + 平台汇总）。
// ---------------------------------------------------------------------------
record("分销后台服务有 readPartnerDashboard", contains(dashboardService, "readPartnerDashboard"));
record("分销后台服务有 readAdminMarketPartnerDashboard", contains(dashboardService, "readAdminMarketPartnerDashboard"));
record("佣金日志新增 tenantId 以便按客户对账", contains(prismaSchema, "tenantId            String?"));
record("佣金 tenantId 迁移存在", existsSync(path.join(repoRoot, "packages/db/prisma/migrations/202609180003_distro_commission_tenant/migration.sql")));
record("marketplace 有 GET /me/partner-dashboard", contains(marketplaceRoutes, 'market.get("/me/partner-dashboard"'));
record("admin 有 GET /admin/market-partner-dashboard", contains(adminRoutes, 'app.get("/admin/market-partner-dashboard"'));
record("合伙人页渲染分销数据", contains(partnerConsole, "市场合伙人后台"));
record("合伙人页读取 /market/me/partner-dashboard", contains(partnerConsole, 'apiPath("/market/me/partner-dashboard")'));
record("管理后台给出合伙人入口地址", contains(adminConsole, 'getAppPath("/partner")'));
record("AdminConsole 有市场合伙人板块", contains(adminConsole, "市场合伙人"));
record("AdminConsole 读取 /admin/market-partner-dashboard", contains(adminConsole, '"/admin/market-partner-dashboard"'));

if (failures > 0) {
  console.error(`market_partner_contract_smoke: FAIL (${failures} failed)`);
  process.exit(1);
}
console.log("market_partner_contract_smoke: PASS");
