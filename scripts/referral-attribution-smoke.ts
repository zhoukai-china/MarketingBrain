// PLAT-28 第①批（推荐有礼：关闭人工发放 + 推荐归因 + 配置位后台可读写）HTTP/服务级回归。
//
// 与 `scripts/marketplace-trial-grant-admin-smoke.ts`（PLAT-11 人工发放契约）的分工：
//   - PLAT-11 锁「放行时人工发放自己的鉴权/幂等/资金落点」；
//   - 本脚本锁「第①批新增的三件事」：
//       1. 人工发放入口**默认停用**：403 `trial_grant_disabled`、零写入、历史流水仍可读；
//          并且它必须是一个真正的开关（后台打开后还能发，不是把接口删了）；
//       2. 推荐归因：带码注册落唯一归因（推荐人 + 被推荐人 + 绑定时间），
//          重复绑定 / 同微信第二账号 / 自荐 / 无效码**只拒绝归因、不阻断注册**，无码注册照常；
//       3. 配置位后台可读写：10 个开关 + 严格校验 + 冻结口径（text-only 锁死 true）。
//     同时锁「不应发生」：第①批**不发任何奖励**（钱包/流水不得出现推荐奖励）。
//
// 环境：需要 DATABASE_URL（本地/测试库）。仓库 .env 为 DATA_MODE=database。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { registerAuthRoutes } from "../apps/api/src/routes/auth.js";
import { env } from "../apps/api/src/config/env.js";
import {
  bindReferralForNewUser,
  generateReferralCode,
  hashReferralCode,
  previewReferralCode
} from "../apps/api/src/services/referral-attribution.js";
import { isWithinReferralCampaignWindow } from "../apps/api/src/services/referral-config.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

let pass = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail = ""): void {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];
const createdInviteCodeIds: string[] = [];
const touchedSettingKeys = new Set<string>();

async function cleanup(): Promise<void> {
  try {
    if (createdUserIds.length > 0) {
      await prisma.referralBinding.deleteMany({
        where: {
          OR: [{ referredUserId: { in: createdUserIds } }, { referrerUserId: { in: createdUserIds } }]
        }
      });
      await prisma.referralCode.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
      await prisma.walletLedger.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    for (const tenantId of createdTenantIds) {
      await prisma.membership.deleteMany({ where: { tenantId } });
      await prisma.store.deleteMany({ where: { tenantId } });
      await prisma.tenantProfile.deleteMany({ where: { tenantId } });
      await prisma.tenantAgentEntitlement.deleteMany({ where: { tenantId } });
      await prisma.marketplaceSkuEntitlement.deleteMany({ where: { tenantId } });
      await prisma.creditTransaction.deleteMany({ where: { tenantId } });
      await prisma.creditAccount.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (createdInviteCodeIds.length > 0) {
      await prisma.inviteCodeRedemption.deleteMany({ where: { inviteCodeId: { in: createdInviteCodeIds } } });
      await prisma.inviteCode.deleteMany({ where: { id: { in: createdInviteCodeIds } } });
    }
    if (touchedSettingKeys.size > 0) {
      await prisma.platformSetting.deleteMany({ where: { key: { in: [...touchedSettingKeys] } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

/** 复刻 apps/api/src/server.ts 的错误映射，避免把「未登录」误报成 500。 */
function applyProductionErrorMapping(app: ReturnType<typeof Fastify>): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error.message === "missing_tenant_or_user" || error.message === "membership_not_found") {
      return reply.code(401).send({ error: "login_required", message: "请先完成微信登录和账号绑定。" });
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalid_request", message: error.message });
    }
    return reply.code(500).send({ error: "internal_server_error", message: "服务暂时不可用，请稍后重试" });
  });
}

function adminToken(): string {
  if (process.env.MARKETPLACE_ADMIN_SMOKE_TOKEN) return process.env.MARKETPLACE_ADMIN_SMOKE_TOKEN;
  try {
    const lines = readFileSync(".env", "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*(?:export\s+)?ADMIN_TOKEN\s*=\s*(.*)$/.exec(line);
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env：走开发环境「未配置即放行」的既有语义 */
  }
  return env.ADMIN_TOKEN ?? "";
}

async function createSyntheticUser(label: string, extra: {
  unionid?: string;
  openid?: string;
  role?: string;
} = {}) {
  const suffix = randomUUID().slice(0, 8);
  const userId = `mp-ref-${label}-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      nickname: `Referral ${label}`,
      phone: `137${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
      ...(extra.unionid ? { wechatUnionid: extra.unionid } : {}),
      ...(extra.openid ? { wechatOpenid: extra.openid } : {})
    }
  });
  createdUserIds.push(userId);
  return { userId };
}

async function createReferrerWithCode(label: string) {
  const unionid = `unionid-${label}-${randomUUID().slice(0, 10)}`;
  const openid = `openid-${label}-${randomUUID().slice(0, 10)}`;
  const { userId } = await createSyntheticUser(label, { unionid, openid });
  const code = generateReferralCode();
  const row = await prisma.referralCode.create({
    data: {
      ownerUserId: userId,
      ownerUnionid: unionid,
      ownerOpenid: openid,
      codeHash: hashReferralCode(code),
      codePreview: previewReferralCode(code),
      label,
      createdBy: "referral-attribution-smoke"
    }
  });
  return { userId, unionid, openid, code, codeId: row.id, codePreview: row.codePreview };
}

async function createInviteCode(maxUses: number) {
  const code = `refsmoke-${randomUUID().slice(0, 12)}`;
  const row = await prisma.inviteCode.create({
    data: {
      codeHash: hashReferralCode(code),
      codePreview: previewReferralCode(code),
      label: "referral-attribution-smoke",
      maxUses,
      createdBy: "referral-attribution-smoke"
    }
  });
  createdInviteCodeIds.push(row.id);
  return code;
}

async function referralLedgerCount(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  return await prisma.walletLedger.count({
    where: { userId: { in: userIds }, source: { contains: "referral" } }
  });
}

async function main(): Promise<void> {
  assertEnv();
  const token = adminToken();
  check(
    "回归前置：.env 必须配置 ADMIN_TOKEN（生产本就强制）",
    token.length > 0,
    "未配置时平台守卫按既有约定放行，这条用例会失去守护意义"
  );

  const app = Fastify();
  applyProductionErrorMapping(app);
  await registerMarketplaceRoutes(app);
  await registerAuthRoutes(app);

  const referrer = await createReferrerWithCode("owner");
  const lowRole = await createSyntheticUser("lowrole");
  const lowTenant = await prisma.tenant.create({
    data: { id: `mp-ref-low-${randomUUID().slice(0, 8)}`, name: "Referral low role", type: "local_business" }
  });
  createdTenantIds.push(lowTenant.id);
  await prisma.membership.create({
    data: {
      id: `mp-ref-lowm-${randomUUID().slice(0, 8)}`,
      tenantId: lowTenant.id,
      userId: lowRole.userId,
      role: "staff",
      isActive: true
    }
  });
  // 管理员会话夹：sessionHeaders 里的身份必须真有一条 owner 会员，否则角色守卫先 403。
  await ensureAdminSessionFixture(referrer.userId);
  const headersWithAdmin = {
    ...sessionHeaders(adminSessionTenantId, referrer.userId),
    ...(token ? { "x-sitong-admin-token": token } : {}),
    "content-type": "application/json"
  };
  const lowHeaders = {
    ...sessionHeaders(lowTenant.id, lowRole.userId),
    "content-type": "application/json"
  };

  try {
    // ---------------------------------------------------------------------
    // 1. 人工发放入口：默认停用
    // ---------------------------------------------------------------------
    const grantPayload = {
      identity: { userId: referrer.userId },
      amount: 400,
      grantId: `refsmoke-${randomUUID().slice(0, 10)}`
    };
    const disabledGrant = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: headersWithAdmin,
      payload: grantPayload
    });
    check(
      "停用后人工发放返回 403（不是 500、不是 200）",
      disabledGrant.statusCode === 403,
      `status=${disabledGrant.statusCode} body=${disabledGrant.body.slice(0, 200)}`
    );
    check(
      "停用错误码是 trial_grant_disabled 且文案说明「已停用」",
      (disabledGrant.json() as { error?: string }).error === "trial_grant_disabled"
        && String((disabledGrant.json() as { message?: string }).message ?? "").includes("已停用"),
      disabledGrant.body.slice(0, 200)
    );
    check(
      "停用后零写入：无钱包、无 trial_grant 流水",
      (await prisma.wallet.findUnique({ where: { userId: referrer.userId } })) === null
        && (await prisma.walletLedger.count({
          where: { userId: referrer.userId, source: { startsWith: "trial_grant:" } }
        })) === 0
    );
    const grantList = await app.inject({ method: "GET", url: "/market/admin/trial-grants?limit=5", headers: headersWithAdmin });
    check("停用后历史发放列表仍可只读查看", grantList.statusCode === 200, `status=${grantList.statusCode}`);

    // ---------------------------------------------------------------------
    // 2. 配置位：鉴权 + 读写 + 校验
    // ---------------------------------------------------------------------
    const anonConfigGet = await app.inject({ method: "GET", url: "/market/admin/referral-config" });
    check("匿名读配置位被拒（401）", anonConfigGet.statusCode === 401, `status=${anonConfigGet.statusCode}`);
    const anonConfigPatch = await app.inject({
      method: "PATCH",
      url: "/market/admin/referral-config",
      headers: { "content-type": "application/json" },
      payload: { updates: { REFERRAL_NEW_USER_CREDITS: 1 } }
    });
    check("匿名写配置位被拒（401）", anonConfigPatch.statusCode === 401, `status=${anonConfigPatch.statusCode}`);
    const lowConfigGet = await app.inject({ method: "GET", url: "/market/admin/referral-config", headers: lowHeaders });
    check(
      "租户内低权限角色读配置位被拒（403 marketplace_admin_required）",
      lowConfigGet.statusCode === 403 && (lowConfigGet.json() as { error?: string }).error === "marketplace_admin_required",
      `status=${lowConfigGet.statusCode} body=${lowConfigGet.body.slice(0, 160)}`
    );

    const configGet = await app.inject({ method: "GET", url: "/market/admin/referral-config", headers: headersWithAdmin });
    check("管理员读配置位 200", configGet.statusCode === 200, `status=${configGet.statusCode}`);
    // 旧版本没有这条路由（404）：字段缺失时按「空配置」继续，让脚本把失败列全，而不是崩在 undefined 上。
    const configRaw = configGet.json() as {
      settings?: Array<{ key: string; type: string; value: unknown; envValue: unknown; source: string; lockedValue?: boolean }>;
      trialGrantEnabled?: boolean;
      referralTextOnly?: boolean;
    };
    const configBody = {
      settings: configRaw.settings ?? [],
      trialGrantEnabled: configRaw.trialGrantEnabled === true,
      referralTextOnly: configRaw.referralTextOnly === true
    };
    const keys = configBody.settings.map((item) => item.key);
    check(
      "配置位包含 9 个推荐有礼开关 + 人工发放总开关（共 10 项）",
      configBody.settings.length === 10
        && keys.includes("REFERRAL_REWARD_ENABLED")
        && keys.includes("REFERRAL_CAMPAIGN_STARTS_AT")
        && keys.includes("REFERRAL_CAMPAIGN_ENDS_AT")
        && keys.includes("REFERRAL_REWARD_TEXT_ONLY")
        && keys.includes("MARKETPLACE_TRIAL_GRANT_ENABLED"),
      `count=${configBody.settings.length}`
    );
    check(
      "冻结口径：text-only 默认 true 且标记为锁定值",
      configBody.referralTextOnly === true
        && configBody.settings.find((item) => item.key === "REFERRAL_REWARD_TEXT_ONLY")?.lockedValue === true
    );
    check("默认停用：trialGrantEnabled=false", configBody.trialGrantEnabled === false);

    const patchConfig = await app.inject({
      method: "PATCH",
      url: "/market/admin/referral-config",
      headers: headersWithAdmin,
      payload: {
        updates: {
          REFERRAL_REWARD_ENABLED: false,
          REFERRAL_CAMPAIGN_STARTS_AT: "2026-09-12T20:00:00+08:00",
          REFERRAL_CAMPAIGN_ENDS_AT: "2026-10-01T00:00:00+08:00",
          REFERRAL_NEW_USER_CREDITS: 100,
          REFERRAL_REFERRER_FIRST_USE_CREDITS: 100,
          REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS: 200,
          REFERRAL_REWARD_VALID_DAYS: 90,
          REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS: 20000
        },
        operator: "referral-smoke"
      }
    });
    check("管理员批量写配置位 200", patchConfig.statusCode === 200, `status=${patchConfig.statusCode} body=${patchConfig.body.slice(0, 200)}`);
    const patchedBody = {
      settings: (patchConfig.json() as { settings?: typeof configBody.settings }).settings ?? []
    };
    for (const key of [
      "REFERRAL_CAMPAIGN_STARTS_AT",
      "REFERRAL_CAMPAIGN_ENDS_AT",
      "REFERRAL_NEW_USER_CREDITS",
      "REFERRAL_REWARD_VALID_DAYS"
    ]) touchedSettingKeys.add(key);
    check(
      "写入后回读一致：结束时间归一为 UTC ISO，金额/天数按值保存",
      patchedBody.settings.find((item) => item.key === "REFERRAL_CAMPAIGN_ENDS_AT")?.value === "2026-09-30T16:00:00.000Z"
        && patchedBody.settings.find((item) => item.key === "REFERRAL_NEW_USER_CREDITS")?.value === 100
        && patchedBody.settings.find((item) => item.key === "REFERRAL_REWARD_VALID_DAYS")?.value === 90,
      JSON.stringify(patchedBody.settings.filter((item) => item.source === "database").map((item) => [item.key, item.value]))
    );
    check(
      "写入来源被标记为 database（区别于 env 默认值）",
      patchedBody.settings.find((item) => item.key === "REFERRAL_CAMPAIGN_ENDS_AT")?.source === "database"
    );
    const operatorRecorded = await prisma.platformSetting.findUnique({
      where: { key: "REFERRAL_NEW_USER_CREDITS" },
      select: { updatedBy: true }
    });
    check("写入记录操作人", operatorRecorded?.updatedBy === "referral-smoke", `updatedBy=${operatorRecorded?.updatedBy ?? "null"}`);

    const invalidUpdates: Array<[string, Record<string, unknown>]> = [
      ["未知键", { NOT_A_REFERRAL_KEY: 1 }],
      ["负积分", { REFERRAL_NEW_USER_CREDITS: -1 }],
      ["超范围积分", { REFERRAL_NEW_USER_CREDITS: 100001 }],
      ["小数天数", { REFERRAL_REWARD_VALID_DAYS: 1.5 }],
      ["非布尔开关", { REFERRAL_REWARD_ENABLED: "yes" }],
      ["非法时间", { REFERRAL_CAMPAIGN_ENDS_AT: "2026-09-30" }],
      ["活动窗倒挂", { REFERRAL_CAMPAIGN_STARTS_AT: "2026-10-02T00:00:00+08:00" }],
      ["冻结口径 text-only 改 false", { REFERRAL_REWARD_TEXT_ONLY: false }]
    ];
    for (const [label, updates] of invalidUpdates) {
      const response = await app.inject({
        method: "PATCH",
        url: "/market/admin/referral-config",
        headers: headersWithAdmin,
        payload: { updates }
      });
      check(`非法配置被拒 400：${label}`, response.statusCode === 400, `status=${response.statusCode} body=${response.body.slice(0, 160)}`);
    }
    const enableWithoutWindow = await app.inject({
      method: "PATCH",
      url: "/market/admin/referral-config",
      headers: headersWithAdmin,
      payload: { updates: { REFERRAL_CAMPAIGN_ENDS_AT: "", REFERRAL_REWARD_ENABLED: true } }
    });
    check(
      "总开关打开但活动窗不完整被拒（fail closed）",
      enableWithoutWindow.statusCode === 400,
      `status=${enableWithoutWindow.statusCode} body=${enableWithoutWindow.body.slice(0, 160)}`
    );
    // 上一条既然被拒，就不能留下「窗口被清空」的副作用。
    const windowAfterReject = await prisma.platformSetting.findUnique({ where: { key: "REFERRAL_CAMPAIGN_ENDS_AT" } });
    check(
      "被拒的批量写入不留半截副作用",
      windowAfterReject === null || (windowAfterReject.value as string) === "2026-09-30T16:00:00.000Z",
      `value=${JSON.stringify(windowAfterReject?.value ?? null)}`
    );

    // ---------------------------------------------------------------------
    // 3. 人工发放开关是真的开关（打开后能发、关掉后恢复拒绝）
    // ---------------------------------------------------------------------
    touchedSettingKeys.add("MARKETPLACE_TRIAL_GRANT_ENABLED");
    const enableGrant = await app.inject({
      method: "PATCH",
      url: "/market/admin/referral-config",
      headers: headersWithAdmin,
      payload: { updates: { MARKETPLACE_TRIAL_GRANT_ENABLED: true }, operator: "referral-smoke" }
    });
    check("后台可以打开人工发放开关", enableGrant.statusCode === 200 && (enableGrant.json() as { trialGrantEnabled: boolean }).trialGrantEnabled === true);
    const enabledGrant = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: headersWithAdmin,
      payload: { ...grantPayload, amount: 100, grantId: `${grantPayload.grantId}-on` }
    });
    check(
      "开关打开后人工发放恢复可用（说明不是删接口）",
      enabledGrant.statusCode === 200 && (enabledGrant.json() as { grant: { state: string } }).grant.state === "created",
      `status=${enabledGrant.statusCode} body=${enabledGrant.body.slice(0, 200)}`
    );
    const disableGrantAgain = await app.inject({
      method: "PATCH",
      url: "/market/admin/referral-config",
      headers: headersWithAdmin,
      payload: { updates: { MARKETPLACE_TRIAL_GRANT_ENABLED: false }, operator: "referral-smoke" }
    });
    check("后台可以再次关掉人工发放", disableGrantAgain.statusCode === 200 && (disableGrantAgain.json() as { trialGrantEnabled: boolean }).trialGrantEnabled === false);
    const disabledAgain = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: headersWithAdmin,
      payload: { ...grantPayload, amount: 100, grantId: `${grantPayload.grantId}-off` }
    });
    check("关掉后立刻恢复 403 trial_grant_disabled", disabledAgain.statusCode === 403 && (disabledAgain.json() as { error?: string }).error === "trial_grant_disabled");
    await prisma.walletLedger.deleteMany({ where: { userId: referrer.userId } });
    await prisma.wallet.deleteMany({ where: { userId: referrer.userId } });

    // ---------------------------------------------------------------------
    // 4. 推荐码下发
    // ---------------------------------------------------------------------
    const issueNoIdentity = await app.inject({
      method: "POST",
      url: "/market/admin/referral-codes",
      headers: headersWithAdmin,
      payload: { identity: {} }
    });
    check("下发推荐码：身份为空 400", issueNoIdentity.statusCode === 400, `status=${issueNoIdentity.statusCode}`);
    const issueTwoIdentities = await app.inject({
      method: "POST",
      url: "/market/admin/referral-codes",
      headers: headersWithAdmin,
      payload: { identity: { userId: referrer.userId, wechatUnionid: referrer.unionid } }
    });
    check("下发推荐码：身份双填 400", issueTwoIdentities.statusCode === 400, `status=${issueTwoIdentities.statusCode}`);
    const issueUnknown = await app.inject({
      method: "POST",
      url: "/market/admin/referral-codes",
      headers: headersWithAdmin,
      payload: { identity: { phone: "13900000000" } }
    });
    check("下发推荐码：推荐人不存在 404", issueUnknown.statusCode === 404, `status=${issueUnknown.statusCode}`);
    const issueOk = await app.inject({
      method: "POST",
      url: "/market/admin/referral-codes",
      headers: headersWithAdmin,
      payload: { identity: { userId: referrer.userId }, label: "验收推荐码", operator: "referral-smoke" }
    });
    check("下发推荐码：正常 200", issueOk.statusCode === 200, `status=${issueOk.statusCode} body=${issueOk.body.slice(0, 200)}`);
    // 旧版本（修复前）没有这条接口：这里必须给出明确的 FAIL，而不是让整个脚本崩在 undefined 上。
    const issued = (issueOk.json() as { referralCode?: { code: string; codePreview: string; owner: { hasUnionid: boolean } } })
      .referralCode ?? null;
    const issuedRow = issued
      ? await prisma.referralCode.findUnique({
        where: { codeHash: hashReferralCode(issued.code) },
        select: { id: true, ownerUserId: true, usedCount: true }
      })
      : null;
    check(
      "下发的码带 ref- 前缀、长度合理、明文与预览都在",
      Boolean(issued)
        && issued!.code.startsWith("ref-")
        && issued!.code.length >= 12
        && issued!.codePreview.includes("****")
        && issued!.owner.hasUnionid === true,
      `code=${issued?.code.slice(0, 8) ?? "-"}… preview=${issued?.codePreview ?? "-"}`
    );
    // 分享链接可用性（2026-09-12 生产实测）：base64url 会生成 `_` / `-` 结尾，
    // 分享到聊天工具或手抄时容易被截断，所以推荐码只允许小写字母 + 数字。
    check(
      "推荐码只含小写字母+数字（分享链接不会被 _ / - 截断）",
      Boolean(issued) && /^ref-[a-z0-9]{12}$/.test(issued!.code),
      `code=${issued?.code ?? "-"}`
    );
    const listedCodes = await app.inject({
      method: "GET",
      url: `/market/admin/referral-codes?ownerUserId=${encodeURIComponent(referrer.userId)}`,
      headers: headersWithAdmin
    });
    check(
      "推荐码清单按推荐人可查（只给预览，不给明文）",
      listedCodes.statusCode === 200
        && (listedCodes.json() as { codes: Array<{ codePreview: string }> }).codes.some((row) => row.codePreview === issued?.codePreview)
        && Boolean(issued) && !listedCodes.body.includes(issued!.code.slice(4)),
      `status=${listedCodes.statusCode}`
    );

    // ---------------------------------------------------------------------
    // 5. 带码注册 → 归因（HTTP 全链路）
    // ---------------------------------------------------------------------
    let registeredUserId: string | undefined;
    if (!issued) {
      check(
        "带码注册落唯一归因（需要 POST /market/admin/referral-codes）",
        false,
        `接口不可用：status=${issueOk.statusCode} body=${issueOk.body.slice(0, 160)}`
      );
    } else {
    const invite = await createInviteCode(10);
    const registerWithCode = await app.inject({
      method: "POST",
      url: "/auth/beta-login",
      headers: { "content-type": "application/json" },
      payload: {
        tenantName: `推荐归因验收-${randomUUID().slice(0, 6)}`,
        tenantRole: "local_business",
        inviteCode: invite,
        referralCode: issued.code,
        nickname: "被推荐人"
      }
    });
    check(
      "带码注册 200（注册本身不被归因逻辑影响）",
      registerWithCode.statusCode === 200,
      `status=${registerWithCode.statusCode} body=${registerWithCode.body.slice(0, 240)}`
    );
    const registered = registerWithCode.json() as { token?: string; userId?: string; tenantId?: string; referral?: { state?: string } };
    registeredUserId = registered.userId;
    if (registered.tenantId) createdTenantIds.push(registered.tenantId);
    if (registered.userId) createdUserIds.push(registered.userId);
    check("带码注册返回 referral.state=bound", registered.referral?.state === "bound", `state=${registered.referral?.state ?? "missing"}`);
    const binding = registered.userId
      ? await prisma.referralBinding.findUnique({ where: { referredUserId: registered.userId } })
      : null;
    check(
      "归因落库：推荐人 + 被推荐人 + 绑定时间 + 来源 + 工作区",
      Boolean(binding)
        && binding?.referrerUserId === referrer.userId
        && binding?.referrerUnionid === referrer.unionid
        && binding?.tenantId === registered.tenantId
        && binding?.source === "beta_web_login"
        && Boolean(binding?.boundAt)
        && binding?.referralCodeId === issuedRow?.id,
      JSON.stringify({
        referrer: binding?.referrerUserId,
        codeId: binding?.referralCodeId,
        tenant: binding?.tenantId,
        source: binding?.source,
        boundAt: binding?.boundAt?.toISOString() ?? null
      })
    );
    const usedCode = await prisma.referralCode.findUnique({ where: { id: issuedRow?.id ?? "" }, select: { usedCount: true } });
    check("推荐码使用计数 +1（用于第③批统计与限次）", usedCode?.usedCount === 1, `usedCount=${usedCode?.usedCount}`);
    const referredWallet = registered.userId
      ? await prisma.wallet.findUnique({ where: { userId: registered.userId } })
      : null;
    check(
      "第①批不发奖励：被推荐人与推荐人钱包都没有推荐奖励流水、余额为 0",
      (await referralLedgerCount([referrer.userId, registered.userId ?? ""])) === 0
        && (referredWallet?.bonusBalance ?? 0) === 0
        && (referredWallet?.paidBalance ?? 0) === 0
    );

    const duplicateAttempt = await app.inject({
      method: "POST",
      url: "/auth/beta-login",
      headers: { "content-type": "application/json" },
      payload: {
        tenantName: `重复绑定验收-${randomUUID().slice(0, 6)}`,
        tenantRole: "local_business",
        inviteCode: invite,
        referralCode: issued.code,
        nickname: "重复绑定"
      }
    });
    const duplicateBody = duplicateAttempt.json() as { userId?: string; tenantId?: string; referral?: { state?: string } };
    if (duplicateBody.tenantId) createdTenantIds.push(duplicateBody.tenantId);
    if (duplicateBody.userId) createdUserIds.push(duplicateBody.userId);
    check(
      "第二个新用户带同一推荐码：注册成功且各自独立归因（推荐码可复用）",
      duplicateAttempt.statusCode === 200 && duplicateBody.referral?.state === "bound",
      `status=${duplicateAttempt.statusCode} state=${duplicateBody.referral?.state}`
    );
    check(
      "两个不同被推荐人各自一条归因（推荐码可复用）",
      (await prisma.referralBinding.count({ where: { referralCodeId: issuedRow?.id ?? "" } })) === 2
    );
    const duplicateWalletOk = (await referralLedgerCount([duplicateBody.userId ?? ""])) === 0;
    check("第①批不发奖励（第二个被推荐人同样无奖励流水）", duplicateWalletOk);

    const noCodeRegister = await app.inject({
      method: "POST",
      url: "/auth/beta-login",
      headers: { "content-type": "application/json" },
      payload: {
        tenantName: `无码注册验收-${randomUUID().slice(0, 6)}`,
        tenantRole: "local_business",
        inviteCode: invite,
        nickname: "无码注册"
      }
    });
    const noCodeBody = noCodeRegister.json() as { userId?: string; tenantId?: string; referral?: { state?: string } };
    if (noCodeBody.tenantId) createdTenantIds.push(noCodeBody.tenantId);
    if (noCodeBody.userId) createdUserIds.push(noCodeBody.userId);
    check(
      "无码注册不受影响：注册成功 + referral.state=none + 不产生归因",
      noCodeRegister.statusCode === 200
        && noCodeBody.referral?.state === "none"
        && (noCodeBody.userId ? (await prisma.referralBinding.findUnique({ where: { referredUserId: noCodeBody.userId } })) === null : false),
      `status=${noCodeRegister.statusCode} state=${noCodeBody.referral?.state}`
    );

    const badCodeRegister = await app.inject({
      method: "POST",
      url: "/auth/beta-login",
      headers: { "content-type": "application/json" },
      payload: {
        tenantName: `无效码验收-${randomUUID().slice(0, 6)}`,
        tenantRole: "local_business",
        inviteCode: invite,
        referralCode: "ref-not-a-real-code",
        nickname: "无效码"
      }
    });
    const badCodeBody = badCodeRegister.json() as { userId?: string; tenantId?: string; referral?: { state?: string } };
    if (badCodeBody.tenantId) createdTenantIds.push(badCodeBody.tenantId);
    if (badCodeBody.userId) createdUserIds.push(badCodeBody.userId);
    check(
      "无效推荐码：注册照常成功、只拒绝归因（不是 500、不阻断）",
      badCodeRegister.statusCode === 200 && badCodeBody.referral?.state === "invalid_code",
      `status=${badCodeRegister.statusCode} state=${badCodeBody.referral?.state}`
    );
    }

    // ---------------------------------------------------------------------
    // 6. 风控规则矩阵（服务级，直接打生产同一函数）
    // ---------------------------------------------------------------------
    // HTTP 注册出来的用户没有微信身份，这里用合成用户补「同一微信第二账号」的等价场景：
    // 两个不同 userId、同一个 unionid（现实中不同 appid 或不同公众号关注产生的重复账号）。
    const twinA = await createSyntheticUser("twin-a", { unionid: `unionid-twin-${randomUUID().slice(0, 8)}`, openid: `openid-twin-a-${randomUUID().slice(0, 8)}` });
    const twinUnionid = (await prisma.user.findUnique({ where: { id: twinA.userId }, select: { wechatUnionid: true } }))?.wechatUnionid ?? "";
    const twinB = await createSyntheticUser("twin-b", { unionid: twinUnionid, openid: `openid-twin-b-${randomUUID().slice(0, 8)}` });
    const firstBind = await bindReferralForNewUser({ referralCode: referrer.code, referredUserId: twinA.userId, source: "smoke" });
    const secondBind = await bindReferralForNewUser({ referralCode: referrer.code, referredUserId: twinB.userId, source: "smoke" });
    check("同 unionid 第二个账号被拒为 already_bound", secondBind.state === "already_bound", `state=${secondBind.state}`);
    check(
      "同 unionid 第二个账号没有新增归因行",
      (await prisma.referralBinding.count({ where: { referredUnionid: twinUnionid } })) === 1
        && (await prisma.referralBinding.findUnique({ where: { referredUserId: twinB.userId } })) === null,
      `first=${firstBind.state}`
    );
    const repeatSameUser = await bindReferralForNewUser({ referralCode: referrer.code, referredUserId: twinA.userId, source: "smoke" });
    check("同一被推荐人重复绑定被拒为 already_bound", repeatSameUser.state === "already_bound", `state=${repeatSameUser.state}`);

    const selfUser = await createSyntheticUser("self", { unionid: referrer.unionid, openid: `openid-self-${randomUUID().slice(0, 8)}` });
    const selfBind = await bindReferralForNewUser({ referralCode: referrer.code, referredUserId: selfUser.userId, source: "smoke" });
    check("推荐人自己的微信（同 unionid）被拒为 self_referral", selfBind.state === "self_referral", `state=${selfBind.state}`);
    check(
      "自荐不落归因行",
      (await prisma.referralBinding.findUnique({ where: { referredUserId: selfUser.userId } })) === null
    );

    const expiredCode = generateReferralCode();
    await prisma.referralCode.create({
      data: {
        ownerUserId: referrer.userId,
        ownerUnionid: referrer.unionid,
        ownerOpenid: referrer.openid,
        codeHash: hashReferralCode(expiredCode),
        codePreview: previewReferralCode(expiredCode),
        expiresAt: new Date(Date.now() - 60_000)
      }
    });
    const expiredUser = await createSyntheticUser("expired", { unionid: `unionid-exp-${randomUUID().slice(0, 8)}` });
    const expiredOutcome = await bindReferralForNewUser({ referralCode: expiredCode, referredUserId: expiredUser.userId });
    check("过期推荐码被拒为 expired", expiredOutcome.state === "expired", `state=${expiredOutcome.state}`);

    const inactiveCode = generateReferralCode();
    await prisma.referralCode.create({
      data: {
        ownerUserId: referrer.userId,
        codeHash: hashReferralCode(inactiveCode),
        codePreview: previewReferralCode(inactiveCode),
        isActive: false
      }
    });
    const inactiveUser = await createSyntheticUser("inactive", { unionid: `unionid-ina-${randomUUID().slice(0, 8)}` });
    const inactiveOutcome = await bindReferralForNewUser({ referralCode: inactiveCode, referredUserId: inactiveUser.userId });
    check("停用推荐码被拒为 invalid_code", inactiveOutcome.state === "invalid_code", `state=${inactiveOutcome.state}`);

    const exhaustedCode = generateReferralCode();
    await prisma.referralCode.create({
      data: {
        ownerUserId: referrer.userId,
        codeHash: hashReferralCode(exhaustedCode),
        codePreview: previewReferralCode(exhaustedCode),
        maxUses: 1,
        usedCount: 1
      }
    });
    const exhaustedUser = await createSyntheticUser("exhausted", { unionid: `unionid-exh-${randomUUID().slice(0, 8)}` });
    const exhaustedOutcome = await bindReferralForNewUser({ referralCode: exhaustedCode, referredUserId: exhaustedUser.userId });
    check("用尽次数的推荐码被拒为 exhausted", exhaustedOutcome.state === "exhausted", `state=${exhaustedOutcome.state}`);

    // ---------------------------------------------------------------------
    // 7. 活动窗：左闭右开（第②批发奖时的硬门禁，这里先锁死纯函数语义）
    // ---------------------------------------------------------------------
    const window = { campaignStartsAt: "2026-09-12T12:00:00.000Z", campaignEndsAt: "2026-09-30T16:00:00.000Z" };
    check(
      "活动窗左闭右开：开始前 1ms=false / 开始时刻=true / 结束前 1ms=true / 结束时刻=false",
      isWithinReferralCampaignWindow(new Date("2026-09-12T11:59:59.999Z"), window) === false
        && isWithinReferralCampaignWindow(new Date("2026-09-12T12:00:00.000Z"), window) === true
        && isWithinReferralCampaignWindow(new Date("2026-09-30T15:59:59.999Z"), window) === true
        && isWithinReferralCampaignWindow(new Date("2026-09-30T16:00:00.000Z"), window) === false
    );
    check(
      "活动窗未配置完整时一律视为窗外（不会误发）",
      isWithinReferralCampaignWindow(new Date(), { campaignStartsAt: null, campaignEndsAt: null }) === false
        && isWithinReferralCampaignWindow(new Date(), { campaignStartsAt: "2026-09-12T12:00:00.000Z", campaignEndsAt: null }) === false
    );

    // ---------------------------------------------------------------------
    // 8. 归因查询接口（第③批明细后台的基础）
    // ---------------------------------------------------------------------
    const anonReferrals = await app.inject({ method: "GET", url: "/market/admin/referrals" });
    check("匿名读归因清单 401", anonReferrals.statusCode === 401, `status=${anonReferrals.statusCode}`);
    const referrals = await app.inject({ method: "GET", url: "/market/admin/referrals?limit=10", headers: headersWithAdmin });
    check("管理员读归因清单 200", referrals.statusCode === 200, `status=${referrals.statusCode} body=${referrals.body.slice(0, 160)}`);
    const referralRows = (referrals.json() as { bindings?: Array<{ referrer: { userId: string }; referred: { userId: string } }> })
      .bindings ?? [];
    check(
      "归因清单包含本轮绑定",
      registeredUserId !== undefined && referralRows.some((row) => row.referred.userId === registeredUserId && row.referrer.userId === referrer.userId),
      `rows=${referralRows.length}`
    );

    console.log(`\nreferral-attribution-smoke: ${pass} passed / ${failures.length} failed`);
  } finally {
    await app.close();
    await cleanup();
  }

  if (failures.length > 0) {
    console.error(`\n失败用例 ${failures.length} 条：`);
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  }
}

function assertEnv(): void {
  if (env.DATA_MODE !== "database") {
    throw new Error(`本回归需要 DATA_MODE=database（当前 ${env.DATA_MODE}）：它要验证唯一索引与事务后的归因落库`);
  }
  if (!process.env.DATABASE_URL) throw new Error("需要 DATABASE_URL");
}

let adminSessionTenantId = "";

async function ensureAdminSessionFixture(userId: string): Promise<void> {
  const tenant = await prisma.tenant.create({
    data: { id: `mp-ref-admin-${randomUUID().slice(0, 8)}`, name: "Referral admin fixture", type: "local_business" }
  });
  createdTenantIds.push(tenant.id);
  await prisma.membership.create({
    data: { id: `mp-ref-adminm-${randomUUID().slice(0, 8)}`, tenantId: tenant.id, userId, role: "owner", isActive: true }
  });
  adminSessionTenantId = tenant.id;
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await cleanup();
  process.exit(1);
});
