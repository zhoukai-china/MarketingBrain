import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FastifyBaseLogger, FastifyReply } from "fastify";
import QRCode from "qrcode";
import { prisma } from "@baolu/db";
import {
  PLANS,
  PRODUCT_LOGIN_DEFINITIONS,
  type PlanCode,
  type ProductLoginCode,
} from "@baolu/shared";

import { betaLoginSchema, bindPhoneSchema, devLoginSchema, diagnosisReportSchema, onboardingWorkspaceSchema, productInviteValidationSchema, productLoginCodeSchema, wechatLoginSchema } from "./auth-schemas.js";
import { grantBetaAgentEntitlements, maskPhone, restrictWorkspaceToProductAgents, translateInviteError } from "./auth-helpers.js";

import { env, inviteRequired } from "../config/env.js";
import {
  createOnboardingToken,
  createSessionToken,
  verifyOnboardingToken
} from "../services/auth-token.js";
import { createTenantWorkspace } from "../services/database-bootstrap.js";
import { getDemoContext } from "../services/demo-context.js";
import {
  exchangeWechatOAuthCode,
  WechatOAuthExchangeError,
  WechatAuthNotConfiguredError
} from "../services/wechat-auth.js";
import {
  WECHAT_BRIDGE_TTL_MS,
  completeWechatLoginBridge,
  createWechatLoginBridge,
  readWechatLoginBridge
} from "../services/wechat-login-bridge.js";
import { resolveRequestContext } from "../services/request-context.js";
import {
  InviteRedemptionError,
  redeemInviteCode,
  validateInviteCode
} from "../services/invite-codes.js";
import { claimLanqiReferral } from "../services/lanqi-referrals.js";
import { bindReferralForNewUser } from "../services/referral-attribution.js";
import { maybeGrantReferralReward } from "../services/referral-rewards.js";
import { normalizeTenantHostname } from "./tenant.js";
import {
  assignBeautyIndustryBrandToTenant,
  assertNoBeautyIndustryBrandOverride,
  resolveBeautyIndustryBrandContext,
  toBeautyIndustryPublicBrand
} from "../products/beauty-industry/brand-config.js";

function defaultPlanForRole(role: string): PlanCode {
  if (role === "chain_brand") return "chain_standard";
  if (role === "personal_ip") return "ip_standard";
  return "local_standard";
}

function rejectAuthBrandOverride(value: unknown, reply: FastifyReply): boolean {
  try {
    assertNoBeautyIndustryBrandOverride(value);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "beauty_brand_override_forbidden") throw error;
    void reply.code(400).send({
      error: "beauty_brand_override_forbidden",
      message: "品牌由产品邀请码和当前租户授权决定，登录请求不能覆盖。"
    });
    return true;
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/product-invite/validate", async (request, reply) => {
    const parsed = productInviteValidationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const product = PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode];
    const invite = await validateInviteCode(parsed.data.inviteCode, product.planCode, product.code);
    if (!invite.ok) {
      return reply.code(403).send({
        error: invite.error ?? "invite_code_required",
        message: translateInviteError(invite.error),
      });
    }
    return {
      valid: true,
      productCode: product.code,
      productName: product.name,
      ...(product.code === "beauty-industry" ? {
        brand: toBeautyIndustryPublicBrand(resolveBeautyIndustryBrandContext({
          beautyIndustryBrand: { brandCode: invite.brandCode }
        }))
      } : {}),
    };
  });

  app.post("/auth/beta-login", async (request, reply) => {
    if (rejectAuthBrandOverride(request.body, reply)) return;
    const parsed = betaLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const product = parsed.data.productCode ? PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode] : undefined;
    if (product && parsed.data.planCode && parsed.data.planCode !== product.planCode) {
      return reply.code(400).send({ error: "product_plan_mismatch", message: "产品与套餐不匹配" });
    }
    const tenantRole = product?.tenantRole ?? parsed.data.tenantRole;
    const requestedPlanCode = product?.planCode ?? parsed.data.planCode;
    const invite = await validateInviteCode(parsed.data.inviteCode, requestedPlanCode, product?.code);
    if (!invite.ok) {
      return reply.code(403).send({
        error: invite.error ?? "invite_code_required",
        message: translateInviteError(invite.error)
      });
    }

    const planCode = requestedPlanCode ?? invite.planCode ?? defaultPlanForRole(tenantRole);

    if (env.DATA_MODE === "demo") {
      const auth = getDemoContext({ "x-sitong-plan": planCode, "x-sitong-role": tenantRole });
      const token = createSessionToken({
        tenantId: auth.tenantId,
        userId: auth.userId,
        planCode: auth.planCode
      });
      return {
        dataMode: "demo",
        token,
        tenantId: auth.tenantId,
        userId: auth.userId,
        plan: PLANS[auth.planCode],
        creditBalance: auth.creditBalance,
        diagnosisRequired: true,
        tenantRole,
        productCode: product?.code,
      };
    }

    let workspace;
    let redeemed = false;
    try {
      const created = await prisma.$transaction(async (tx: any) => {
        const nextWorkspace = await createTenantWorkspace({
          planCode,
          tenantName: parsed.data.tenantName,
          industry: parsed.data.industry,
          city: parsed.data.city,
          phone: parsed.data.phone,
          nickname: parsed.data.nickname
        }, tx);
        const nextRedeemed = invite.inviteCodeId ? await redeemInviteCode({
          inviteCodeId: invite.inviteCodeId,
          tenantId: nextWorkspace.tenant.id,
          userId: nextWorkspace.user.id,
          planCode,
          metadata: {
            tenantName: parsed.data.tenantName,
            industry: parsed.data.industry,
            city: parsed.data.city,
            source: invite.source,
            channel: product ? "product_web_login" : "beta_web_login",
            productCode: product?.code,
          }
        }, tx) : false;
        if (invite.inviteCodeId && !nextRedeemed) {
          throw new InviteRedemptionError();
        }
        const referralClaim = await claimLanqiReferral({
          inviteCodeId: invite.inviteCodeId,
          referredTenantId: nextWorkspace.tenant.id,
        }, tx);
        if (referralClaim === "already_claimed" || referralClaim === "self_referral") {
          throw new InviteRedemptionError();
        }
        await restrictWorkspaceToProductAgents(tx, nextWorkspace.tenant.id, nextWorkspace.user.id, product?.code);
        await grantBetaAgentEntitlements(tx, nextWorkspace.tenant.id, product?.code);
        if (product?.code === "beauty-industry" && invite.brandCode) {
          await assignBeautyIndustryBrandToTenant({
            transactionClient: tx,
            tenantId: nextWorkspace.tenant.id,
            brandCode: invite.brandCode,
            source: "product_invite"
          });
        }
        return { workspace: nextWorkspace, redeemed: nextRedeemed };
      });
      workspace = created.workspace;
      redeemed = created.redeemed;
    } catch (error) {
      if (error instanceof InviteRedemptionError) {
        return reply.code(403).send({
          error: "invite_code_exhausted",
          message: translateInviteError("invite_code_exhausted")
        });
      }
      throw error;
    }
    const token = createSessionToken({
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      planCode
    });

    // PLAT-28：推荐归因在注册事务**提交之后**执行。
    // 顺序是刻意的：归因失败（无效码 / 重复绑定 / 同微信自荐 / 并发抢同一被推荐人）
    // 一律不得把已经创建好的工作区回滚掉——链接过期不该把新用户挡在门外。
    const referral = await bindReferralForNewUser({
      referralCode: parsed.data.referralCode,
      referredUserId: workspace.user.id,
      tenantId: workspace.tenant.id,
      source: product ? "product_web_login" : "beta_web_login"
    });


    // PLAT-28 第②批：新客奖励（best-effort，失败不影响注册/开通）
    if (referral.state === "bound") {
      void maybeGrantReferralReward({ referredUserId: workspace.user.id, kind: "new_user" }).catch((error: unknown) => {
        request.log.warn({ err: error }, "referral reward(new_user) failed");
      });
    }

    return {
      dataMode: "database",
      token,
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
      needsTenant: false,
      diagnosisRequired: true,
      tenantRole,
      productCode: product?.code,
      invite: {
        source: invite.source,
        redeemed,
        brandCode: product?.code === "beauty-industry" ? invite.brandCode ?? "default" : undefined
      },
      referral: { state: referral.state }
    };
  });

  app.post("/auth/dev-login", async (request, reply) => {
    if (rejectAuthBrandOverride(request.body, reply)) return;
    if (env.NODE_ENV === "production" && env.DIRECT_TEST_LOGIN !== "true") {
      return reply.code(404).send({
        error: "not_found",
        message: "dev login is disabled in production"
      });
    }

    const parsed = devLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const product = parsed.data.productCode ? PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode] : undefined;
    if (product && parsed.data.planCode && parsed.data.planCode !== product.planCode) {
      return reply.code(400).send({ error: "product_plan_mismatch", message: "产品与套餐不匹配" });
    }
    const tenantRole = product?.tenantRole ?? parsed.data.tenantRole;
    const planCode = product?.planCode ?? parsed.data.planCode ?? defaultPlanForRole(tenantRole);

    if (env.DATA_MODE === "demo") {
      const auth = getDemoContext({ "x-sitong-plan": planCode, "x-sitong-role": tenantRole });
      const token = createSessionToken({
        tenantId: auth.tenantId,
        userId: auth.userId,
        planCode: auth.planCode
      });
      return {
        dataMode: "demo",
        token,
        tenantId: auth.tenantId,
        userId: auth.userId,
        plan: PLANS[auth.planCode],
        diagnosisRequired: true,
        tenantRole,
        productCode: product?.code,
      };
    }

    const workspace = await prisma.$transaction(async (tx: any) => {
      const nextWorkspace = await createTenantWorkspace({
        planCode,
        tenantName: parsed.data.tenantName,
        industry: parsed.data.industry,
        city: parsed.data.city,
        phone: parsed.data.phone,
        nickname: parsed.data.nickname,
      }, tx);
      await restrictWorkspaceToProductAgents(tx, nextWorkspace.tenant.id, nextWorkspace.user.id, product?.code);
      await grantBetaAgentEntitlements(tx, nextWorkspace.tenant.id, product?.code);
      return nextWorkspace;
    });
    const token = createSessionToken({
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      planCode
    });
    const referral = await bindReferralForNewUser({
      referralCode: parsed.data.referralCode,
      referredUserId: workspace.user.id,
      tenantId: workspace.tenant.id,
      source: "dev_login"
    });


    // PLAT-28 第②批：新客奖励（best-effort，失败不影响注册/开通）
    if (referral.state === "bound") {
      void maybeGrantReferralReward({ referredUserId: workspace.user.id, kind: "new_user" }).catch((error: unknown) => {
        request.log.warn({ err: error }, "referral reward(new_user) failed");
      });
    }

    return {
      dataMode: "database",
      token,
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
      diagnosisRequired: true,
      tenantRole,
      productCode: product?.code,
      referral: { state: referral.state },
    };
  });

  
  // Check whether WeChat auth is configured on the server.
  // `inviteRequired` 一并返回：登录页据此决定微信首次注册要不要填邀请码，
  // 这样「开放注册 / 邀请制」是服务端的一个开关，不需要改前端代码重新构建。
  app.get("/auth/wechat-config", async (_request, reply) => {
    const appid = env.WECHAT_AUTH_APPID;
    const secret = env.WECHAT_AUTH_SECRET;
    if (!appid || !secret) {
      if (env.DATA_MODE === "demo") {
        return reply.code(503).send({ configured: false, reason: "demo_mode", inviteRequired });
      }
      return reply.code(503).send({ configured: false, reason: "missing_credentials", inviteRequired });
    }
    return { configured: true, appid, inviteRequired };
  });

  /**
   * 微信授权码换登录结果。两个入口必须走同一段业务逻辑，否则会各自漂移：
   * - 手机端（微信内置浏览器）`POST /auth/wechat-login`；
   * - 电脑端扫码中转（PLAT-13）`POST /auth/wechat-bridge/complete`。
   * 这里只负责「算出结果」，不直接写 reply，调用方自己决定怎么回。
   */
  async function resolveWechatLogin(
    input: { code: string; tenantHostname?: string; productCode?: ProductLoginCode },
    log: FastifyBaseLogger
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    if (env.DATA_MODE === "demo") {
      const auth = getDemoContext({ "x-sitong-plan": "local_standard" });
      const token = createSessionToken({
        tenantId: auth.tenantId,
        userId: auth.userId,
        planCode: auth.planCode
      });
      return {
        statusCode: 200,
        body: {
          dataMode: "demo",
          token,
          tenantId: auth.tenantId,
          userId: auth.userId,
          plan: PLANS[auth.planCode],
          needsTenant: false,
          diagnosisRequired: true
        }
      };
    }

    try {
      const tenantHostname = input.tenantHostname
        ? normalizeTenantHostname(input.tenantHostname)
        : undefined;
      if (input.tenantHostname && !tenantHostname) {
        return { statusCode: 400, body: { error: "invalid_tenant_domain", message: "登录域名格式无效。" } };
      }
      const tenantDomain = tenantHostname
        ? await prisma.tenantDomain.findFirst({ where: { hostname: tenantHostname, status: "verified" } })
        : null;
      if (tenantHostname && !tenantDomain) {
        return { statusCode: 403, body: { error: "tenant_domain_not_verified", message: "该品牌域名尚未完成验证，请联系企业管理员。" } };
      }
      const identity = await exchangeWechatOAuthCode(input.code);
      const user = await prisma.user.upsert({
        where: { wechatOpenid: identity.openid },
        update: { wechatUnionid: identity.unionid },
        create: { wechatOpenid: identity.openid, wechatUnionid: identity.unionid }
      });

      const membership = await prisma.membership.findFirst({
        where: {
          userId: user.id,
          isActive: true,
          ...(tenantDomain ? { tenantId: tenantDomain.tenantId } : {}),
          ...(input.productCode ? {
            tenant: {
              productEntitlements: {
                some: {
                  productCode: input.productCode,
                  status: "active",
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              },
            },
          } : {}),
        },
        include: {
          tenant: {
            include: {
              subscriptions: {
                where: { status: { in: ["trialing", "active"] } },
                orderBy: { endDate: "desc" },
                take: 1
              }
            }
          }
        },
        orderBy: { createdAt: "asc" }
      });

      if (!membership) {
        if (tenantDomain) {
          return {
            statusCode: 403,
            body: {
              error: "tenant_membership_required",
              message: "该微信账号还不是此企业成员，请联系企业管理员添加后再登录。"
            }
          };
        }
        if (input.productCode) {
          // 口径（用户 2026-09-12 拍板）：**一个账号可以使用全平台的智能体**。
          // 以前这里在「该微信号已有其他产品的租户、但没有本产品的租户」时直接 403
          // `product_membership_required`，等于把「一号多产品」堵死——老板已开通外卖，
          // 再想进兰琪就只能看到「请使用产品邀请码」却无处输入。
          // 现在改为与全新用户同路：回 `needsTenant` 让他去补资料、用产品邀请码开通
          // **第二个租户**（仍绑同一个微信账号）。受控产品（兰琪）的开通闸门不变——
          // 补资料那条 `onboarding/create-workspace` 仍强制校验产品邀请码
          // （`validateInviteCode(code, plan, productCode)`，无码即 403 `invite_code_required`），
          // 所以「兰琪只给加盟商用」这条业务边界没有被放宽。
        }
        return {
          statusCode: 200,
          body: {
            dataMode: "database",
            userId: user.id,
            needsTenant: true,
            diagnosisRequired: true,
            onboardingToken: createOnboardingToken({ userId: user.id }),
            wechat: { openid: identity.openid, hasUnionid: Boolean(identity.unionid) }
          }
        };
      }

      const subscription = membership.tenant.subscriptions[0];
      const planCode = (subscription?.planCode as PlanCode | undefined)
        ?? defaultPlanForRole(membership.tenant.type);

      const token = createSessionToken({
        tenantId: membership.tenantId,
        userId: user.id,
        planCode
      });

      return {
        statusCode: 200,
        body: {
          dataMode: "database",
          token,
          tenantId: membership.tenantId,
          userId: user.id,
          plan: PLANS[planCode],
          needsTenant: false,
          diagnosisRequired: false,
          productCode: input.productCode,
        }
      };
    } catch (error) {
      if (error instanceof WechatAuthNotConfiguredError) {
        return { statusCode: 503, body: { error: "wechat_auth_not_configured", issues: error.issues } };
      }
      // 微信换取授权码的可预期失败不能落到 server.ts 的 500 兜底：
      // 授权码失效是用户重新授权就能恢复的业务失败（401），
      // 上游/配置异常是需要运维介入的依赖故障（502）。
      // 上游原始 errmsg 只写服务端日志，回给前端的是可读中文文案。
      if (error instanceof WechatOAuthExchangeError) {
        log.warn({ wechatOAuthError: error.kind, detail: error.detail }, "wechat oauth exchange failed");
        if (error.kind === "invalid_code") {
          return {
            statusCode: 401,
            body: {
              error: "wechat_code_invalid",
              message: "微信授权已失效，请返回登录页重新授权。"
            }
          };
        }
        return {
          statusCode: 502,
          body: {
            error: "wechat_upstream_unavailable",
            message: "微信授权服务暂时不可用，请稍后重试或联系服务团队。"
          }
        };
      }
      throw error;
    }
  }

  app.post("/auth/wechat-login", async (request, reply) => {
    const parsed = wechatLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const outcome = await resolveWechatLogin(parsed.data, request.log);
    return reply.code(outcome.statusCode).send(outcome.body);
  });

  // ---------------------------------------------------------------------------
  // PLAT-13 电脑端微信扫码登录（中转会话）
  //
  // 现象（2026-09-11 生产实测）：电脑浏览器点「微信一键登录 / 注册」会跳到微信的
  // 「请在微信客户端打开链接」死页——公众号网页授权页只认微信内置浏览器。
  // 修法不是改授权地址（微信不支持电脑端起授权页），而是加一次中转：
  //   电脑 --创建会话--> 服务端发一次性 id + secret，二维码指向 <本站>/wechat-bridge?b=&s=
  //   手机（微信内）扫二维码 -> 微信授权 -> /wechat-callback -> 回填登录结果
  //   电脑 --轮询 status--> 取走登录结果（一次性，取走即焚）
  // 会话存内存（见 services/wechat-login-bridge.ts），API 重启会让在途二维码作废，
  // 用户刷新二维码即可；这条已知限制登记在任务卡 PLAT-13。
  // ---------------------------------------------------------------------------
  const wechatBridgeCreateSchema = z.object({
    tenantHostname: z.string().trim().max(253).optional(),
    productCode: productLoginCodeSchema.optional(),
  });
  const wechatBridgeCompleteSchema = wechatBridgeCreateSchema.extend({
    id: z.string().min(1).max(128),
    secret: z.string().min(1).max(256),
    code: z.string().min(1).max(512),
  });
  const wechatBridgeStatusSchema = z.object({
    id: z.string().min(1).max(128),
    secret: z.string().min(1).max(256),
  });

  /** 会话不存在 / 过期统一话术：不区分「id 不存在」和「secret 不对」，避免被拿来探测。 */
  function wechatBridgeGone(reply: FastifyReply, state: "not_found" | "expired") {
    return reply.code(state === "expired" ? 410 : 404).send({
      error: state === "expired" ? "wechat_bridge_expired" : "wechat_bridge_not_found",
      message: "登录二维码已失效，请回到电脑刷新二维码后重新扫码。",
    });
  }

  app.post("/auth/wechat-bridge/session", async (request, reply) => {
    const parsed = wechatBridgeCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const tenantHostname = parsed.data.tenantHostname
      ? normalizeTenantHostname(parsed.data.tenantHostname)
      : undefined;
    if (parsed.data.tenantHostname && !tenantHostname) {
      return reply.code(400).send({ error: "invalid_tenant_domain", message: "登录域名格式无效。" });
    }
    const session = createWechatLoginBridge({
      productCode: parsed.data.productCode,
      tenantHostname,
    });
    return {
      id: session.id,
      // secret 只在此刻返回一次，服务端只留哈希；二维码里的 s 就是它。
      secret: session.secret,
      expiresAt: session.expiresAt,
      ttlSeconds: Math.round(WECHAT_BRIDGE_TTL_MS / 1000),
    };
  });

  app.get("/auth/wechat-bridge/status", async (request, reply) => {
    const parsed = wechatBridgeStatusSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    // consume: 只有「登录成功」的结果会被取走，失败结果留着让用户重新授权一次。
    const read = readWechatLoginBridge({
      id: parsed.data.id,
      secret: parsed.data.secret,
      consume: true,
    });
    if (read.state === "not_found" || read.state === "expired") return wechatBridgeGone(reply, read.state);
    if (read.state === "pending") {
      return { state: "pending", expiresAt: read.context.expiresAt };
    }
    return {
      state: "completed",
      ok: read.result.statusCode === 200,
      statusCode: read.result.statusCode,
      login: read.result.body,
      expiresAt: read.context.expiresAt,
    };
  });

  /**
   * 二维码图片。内容由前端按自己的站点拼（同一份代码要同时服务 `/os-v2/` 与测试实例
   * `/lanqi-test/`），服务端只负责画图并顺手校验：目标必须是本站扫码中转页，
   * 且 b/s 对应的会话仍然有效——避免这个接口被当成免费二维码生成器。
   */
  app.get("/auth/wechat-bridge/qrcode", async (request, reply) => {
    const parsed = z.object({ u: z.string().min(1).max(2048) }).safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    let target: URL;
    try {
      target = new URL(parsed.data.u);
    } catch {
      return reply.code(400).send({ error: "invalid_qrcode_target", message: "二维码地址无效。" });
    }
    // 只允许画「本站自己的」扫码中转页：生产 Web 与 API 同域（api.lcppch.top），
    // 开发态 Web 在 localhost:517x、API 在 localhost:301x，故对回环地址放行。
    const apiHost = String(request.headers.host ?? "");
    const targetIsLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(target.host);
    const hostAllowed = targetIsLocal || (Boolean(apiHost) && target.host === apiHost);
    if (!/^https?:$/.test(target.protocol) || !target.pathname.endsWith("/wechat-bridge") || !hostAllowed) {
      return reply.code(400).send({ error: "invalid_qrcode_target", message: "二维码地址无效。" });
    }
    const read = readWechatLoginBridge({
      id: target.searchParams.get("b") ?? "",
      secret: target.searchParams.get("s") ?? "",
    });
    if (read.state === "not_found" || read.state === "expired") return wechatBridgeGone(reply, read.state);
    const svg = await QRCode.toString(target.toString(), { type: "svg", margin: 1, width: 320 });
    return reply
      .header("Content-Type", "image/svg+xml; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(svg);
  });

  app.post("/auth/wechat-bridge/complete", async (request, reply) => {
    const parsed = wechatBridgeCompleteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const found = readWechatLoginBridge({ id: parsed.data.id, secret: parsed.data.secret });
    if (found.state === "not_found" || found.state === "expired") return wechatBridgeGone(reply, found.state);
    // 只有「已经成功过」才拒绝二次提交（不允许换人）；上一次失败仍应允许重新授权。
    if (found.state === "completed" && found.result.statusCode === 200) {
      return {
        state: "completed",
        ok: true,
        needsTenant: found.result.body.needsTenant === true,
      };
    }
    // 产品与品牌域名一律取会话创建时（电脑端）的值，不采信手机端回传，防止中途换租户。
    const outcome = await resolveWechatLogin(
      {
        code: parsed.data.code,
        productCode: found.context.productCode as ProductLoginCode | undefined,
        tenantHostname: found.context.tenantHostname,
      },
      request.log
    );
    completeWechatLoginBridge({
      id: parsed.data.id,
      secret: parsed.data.secret,
      result: outcome,
    });
    return {
      state: "completed",
      ok: outcome.statusCode === 200,
      needsTenant: outcome.body.needsTenant === true,
      statusCode: outcome.statusCode,
      message: typeof outcome.body.message === "string" ? outcome.body.message : undefined,
    };
  });

  app.post("/auth/onboarding/create-workspace", async (request, reply) => {
    if (rejectAuthBrandOverride(request.body, reply)) return;
    const parsed = onboardingWorkspaceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const product = parsed.data.productCode ? PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode] : undefined;
    if (product && parsed.data.planCode !== product.planCode) {
      return reply.code(400).send({ error: "product_plan_mismatch", message: "产品与套餐不匹配" });
    }
    const planCode = product?.planCode ?? (parsed.data.planCode as PlanCode);

    if (env.DATA_MODE === "demo") {
      const auth = getDemoContext({ "x-sitong-plan": planCode });
      const token = createSessionToken({
        tenantId: auth.tenantId,
        userId: auth.userId,
        planCode: auth.planCode
      });
      return {
        dataMode: "demo",
        token,
        tenantId: auth.tenantId,
        userId: auth.userId,
        plan: PLANS[auth.planCode],
        creditBalance: auth.creditBalance,
        diagnosisReport: parsed.data.diagnosisReport ?? null
      };
    }

    const onboarding = verifyOnboardingToken(parsed.data.onboardingToken);
    if (!onboarding) {
      // 只回错误码会让前端把 `invalid_onboarding_token` 原样显示给老板（2026-09-12 生产真机实测）。
      // 业务语义是「授权过期、重新授权即可」，所以必须带可读中文。
      return reply.code(401).send({
        error: "invalid_onboarding_token",
        message: "微信授权已过期（30 分钟有效），请重新点击「微信一键登录 / 注册」。"
      });
    }

    // Check if user already has a membership
    const existingMembership = await prisma.membership.findFirst({
      where: {
        userId: onboarding.userId,
        isActive: true,
        ...(product ? {
          tenant: {
            productEntitlements: {
              some: {
                productCode: product.code,
                status: "active",
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          },
        } : {}),
      },
      include: {
        tenant: {
          include: {
            subscriptions: {
              where: { status: { in: ["trialing", "active"] } },
              orderBy: { endDate: "desc" },
              take: 1
            }
          }
        }
      }
    });

    if (existingMembership) {
      const subscription = existingMembership.tenant.subscriptions[0];
      const planCode = (subscription?.planCode as PlanCode | undefined)
        ?? defaultPlanForRole(existingMembership.tenant.type);
      const token = createSessionToken({
        tenantId: existingMembership.tenantId,
        userId: onboarding.userId,
        planCode
      });
      return {
        dataMode: "database",
        token,
        tenantId: existingMembership.tenantId,
        userId: onboarding.userId,
        plan: PLANS[planCode],
        needsTenant: false
      };
    }

    const invite = await validateInviteCode(parsed.data.inviteCode, planCode, product?.code);
    if (!invite.ok) {
      return reply.code(403).send({
        error: invite.error ?? "invite_code_required",
        message: translateInviteError(invite.error)
      });
    }

    let workspace;
    let redeemed = false;
    try {
      const created = await prisma.$transaction(async (tx: any) => {
        const nextWorkspace = await createTenantWorkspace({
          planCode,
          tenantName: parsed.data.tenantName,
          userId: onboarding.userId,
          industry: parsed.data.industry,
          city: parsed.data.city,
          phone: parsed.data.phone,
          nickname: parsed.data.nickname
        }, tx);
        const nextRedeemed = invite.inviteCodeId ? await redeemInviteCode({
          inviteCodeId: invite.inviteCodeId,
          tenantId: nextWorkspace.tenant.id,
          userId: nextWorkspace.user.id,
          planCode,
          metadata: {
            tenantName: parsed.data.tenantName,
            industry: parsed.data.industry,
            city: parsed.data.city,
            source: invite.source,
            productCode: product?.code,
          }
        }, tx) : false;
        if (invite.inviteCodeId && !nextRedeemed) {
          throw new InviteRedemptionError();
        }
        const referralClaim = await claimLanqiReferral({
          inviteCodeId: invite.inviteCodeId,
          referredTenantId: nextWorkspace.tenant.id,
        }, tx);
        if (referralClaim === "already_claimed" || referralClaim === "self_referral") {
          throw new InviteRedemptionError();
        }
        await grantBetaAgentEntitlements(tx, nextWorkspace.tenant.id, product?.code);
        if (product?.code === "beauty-industry" && invite.brandCode) {
          await assignBeautyIndustryBrandToTenant({
            transactionClient: tx,
            tenantId: nextWorkspace.tenant.id,
            brandCode: invite.brandCode,
            source: "product_invite"
          });
        }
        return { workspace: nextWorkspace, redeemed: nextRedeemed };
      });
      workspace = created.workspace;
      redeemed = created.redeemed;
    } catch (error) {
      if (error instanceof InviteRedemptionError) {
        return reply.code(403).send({
          error: "invite_code_exhausted",
          message: translateInviteError("invite_code_exhausted")
        });
      }
      throw error;
    }
    const token = createSessionToken({
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      planCode
    });

    // PLAT-28：微信授权 → 补资料 → 开通工作区这条路上的推荐归因（同样在事务提交后执行，
    // 归因失败不影响开通）。只对**本次真正新建工作区**的路径执行；已有会员的老用户
    // 在上面 `existingMembership` 分支就返回了，不会把老账号补登成被推荐人。
    const referral = await bindReferralForNewUser({
      referralCode: parsed.data.referralCode,
      referredUserId: workspace.user.id,
      tenantId: workspace.tenant.id,
      source: product ? "product_onboarding" : "platform_onboarding"
    });


    // PLAT-28 第②批：新客奖励（best-effort，失败不影响注册/开通）
    if (referral.state === "bound") {
      void maybeGrantReferralReward({ referredUserId: workspace.user.id, kind: "new_user" }).catch((error: unknown) => {
        request.log.warn({ err: error }, "referral reward(new_user) failed");
      });
    }

    // Save diagnosis report if provided
    if (parsed.data.diagnosisReport) {
      try {
        // TODO: save diagnosis report to DB once DiagnosisReport model is available
        void workspace;
      } catch {
        // non-critical: diagnosis report storage failure should not block login
      }
    }

    return {
      dataMode: "database",
      token,
      tenantId: workspace.tenant.id,
      userId: workspace.user.id,
      plan: workspace.plan,
      creditBalance: workspace.creditBalance,
      needsTenant: false,
      invite: {
        source: invite.source,
        redeemed,
        brandCode: product?.code === "beauty-industry" ? invite.brandCode ?? "default" : undefined
      },
      productCode: product?.code,
      tenantRole: product?.tenantRole ?? PLANS[planCode].tenantType,
      referral: { state: referral.state },
    };
  });

  app.post("/auth/phone/bind", async (request, reply) => {
    const parsed = bindPhoneSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        bound: true,
        phone: maskPhone(parsed.data.phone)
      };
    }

    await prisma.user.update({
      where: { id: context.userId },
      data: { phone: parsed.data.phone }
    });

    return {
      dataMode: "database",
      bound: true,
      phone: maskPhone(parsed.data.phone)
    };
  });
}
