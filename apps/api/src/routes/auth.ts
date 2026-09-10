import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FastifyReply } from "fastify";
import { prisma } from "@baolu/db";
import {
  PLANS,
  PRODUCT_LOGIN_CODES,
  PRODUCT_LOGIN_DEFINITIONS,
  type PlanCode,
  type ProductLoginCode,
} from "@baolu/shared";
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
import { resolveRequestContext } from "../services/request-context.js";
import {
  InviteRedemptionError,
  redeemInviteCode,
  validateInviteCode
} from "../services/invite-codes.js";
import { claimLanqiReferral } from "../services/lanqi-referrals.js";
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

const productLoginCodeSchema = z.enum(PRODUCT_LOGIN_CODES);

const devLoginSchema = z.object({
  tenantRole: z.enum(["personal_ip", "local_business", "chain_brand"]).default("local_business"),
  tenantName: z.string().trim().min(1).max(80).default("演示商家"),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).optional(),
  industry: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  productCode: productLoginCodeSchema.optional(),
});

const betaLoginSchema = z.object({
  tenantRole: z.enum(["personal_ip", "local_business", "chain_brand"]).default("local_business"),
  tenantName: z.string().trim().min(1).max(80).default("演示商家"),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).optional(),
  industry: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  // 平台主入口开放注册（INVITE_REQUIRED=false）后不再强制邀请码，schema 必须允许缺省；
  // 缺省时由 validateInviteCode 按服务端开关判定：开放注册放行，邀请制返回
  // 403 invite_code_required（与产品入口同一套错误语义），不再在 schema 层抛 400。
  inviteCode: z.string().trim().max(200).optional(),
  productCode: productLoginCodeSchema.optional(),
});

const productInviteValidationSchema = z.object({
  productCode: productLoginCodeSchema,
  inviteCode: z.string().trim().min(1).max(200),
});

const wechatLoginSchema = z.object({
  code: z.string().min(1),
  tenantHostname: z.string().trim().max(253).optional(),
  productCode: productLoginCodeSchema.optional(),
});

const bindPhoneSchema = z.object({
  phone: z.string().min(6).max(32),
  code: z.string().optional()
});

const diagnosisReportSchema = z.object({
  summary: z.string(),
  recommendedPlan: z.string(),
  roadmap: z.array(z.object({ step: z.string(), content: z.string(), priority: z.number() }))
});

const onboardingWorkspaceSchema = z.object({
  onboardingToken: z.string().min(1),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).default("local_standard"),
  tenantName: z.string().min(1).max(80),
  industry: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  inviteCode: z.string().optional(),
  productCode: productLoginCodeSchema.optional(),
  diagnosisReport: diagnosisReportSchema.optional()
});

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
        const nextRedeemed = await redeemInviteCode({
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
        }, tx);
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
        if (product?.code === "beauty-industry") {
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
      }
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

  app.post("/auth/wechat-login", async (request, reply) => {
    const parsed = wechatLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    if (env.DATA_MODE === "demo") {
      const auth = getDemoContext({ "x-sitong-plan": "local_standard" });
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
        needsTenant: false,
        diagnosisRequired: true
      };
    }

    try {
      const tenantHostname = parsed.data.tenantHostname
        ? normalizeTenantHostname(parsed.data.tenantHostname)
        : undefined;
      if (parsed.data.tenantHostname && !tenantHostname) {
        return reply.code(400).send({ error: "invalid_tenant_domain", message: "登录域名格式无效。" });
      }
      const tenantDomain = tenantHostname
        ? await prisma.tenantDomain.findFirst({ where: { hostname: tenantHostname, status: "verified" } })
        : null;
      if (tenantHostname && !tenantDomain) {
        return reply.code(403).send({ error: "tenant_domain_not_verified", message: "该品牌域名尚未完成验证，请联系企业管理员。" });
      }
      const identity = await exchangeWechatOAuthCode(parsed.data.code);
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
          ...(parsed.data.productCode ? {
            tenant: {
              productEntitlements: {
                some: {
                  productCode: parsed.data.productCode,
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
          return reply.code(403).send({
            error: "tenant_membership_required",
            message: "该微信账号还不是此企业成员，请联系企业管理员添加后再登录。"
          });
        }
        if (parsed.data.productCode) {
          const hasOtherMembership = await prisma.membership.count({ where: { userId: user.id, isActive: true } });
          if (hasOtherMembership > 0) {
            return reply.code(403).send({
              error: "product_membership_required",
              message: "当前账号尚未开通这个产品，请使用产品邀请码或联系服务团队。",
            });
          }
        }
        return {
          dataMode: "database",
          userId: user.id,
          needsTenant: true,
          diagnosisRequired: true,
          onboardingToken: createOnboardingToken({ userId: user.id }),
          wechat: { openid: identity.openid, hasUnionid: Boolean(identity.unionid) }
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
        dataMode: "database",
        token,
        tenantId: membership.tenantId,
        userId: user.id,
        plan: PLANS[planCode],
        needsTenant: false,
        diagnosisRequired: false,
        productCode: parsed.data.productCode,
      };
    } catch (error) {
      if (error instanceof WechatAuthNotConfiguredError) {
        return reply.code(503).send({ error: "wechat_auth_not_configured", issues: error.issues });
      }
      // 微信换取授权码的可预期失败不能落到 server.ts 的 500 兜底：
      // 授权码失效是用户重新授权就能恢复的业务失败（401），
      // 上游/配置异常是需要运维介入的依赖故障（502）。
      // 上游原始 errmsg 只写服务端日志，回给前端的是可读中文文案。
      if (error instanceof WechatOAuthExchangeError) {
        request.log.warn({ wechatOAuthError: error.kind, detail: error.detail }, "wechat oauth exchange failed");
        if (error.kind === "invalid_code") {
          return reply.code(401).send({
            error: "wechat_code_invalid",
            message: "微信授权已失效，请返回登录页重新授权。"
          });
        }
        return reply.code(502).send({
          error: "wechat_upstream_unavailable",
          message: "微信授权服务暂时不可用，请稍后重试或联系服务团队。"
        });
      }
      throw error;
    }
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
      return reply.code(401).send({ error: "invalid_onboarding_token" });
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
        const nextRedeemed = await redeemInviteCode({
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
        }, tx);
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
        if (product?.code === "beauty-industry") {
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

function maskPhone(phone: string): string {
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function translateInviteError(error: string | undefined): string {
  if (error === "invite_code_expired") return "邀请码已过期，请联系服务团队重新发放";
  if (error === "invite_code_exhausted") return "邀请码使用次数已用完，请联系服务团队";
  if (error === "invite_code_product_mismatch") return "该邀请码不属于当前产品，请使用邀请消息中的正确入口";
  return "当前体验名额需要邀请码，请填写有效邀请码";
}

async function grantBetaAgentEntitlements(
  transactionClient: any,
  tenantId: string,
  productCode?: ProductLoginCode,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);
  if (productCode) {
    await transactionClient.tenantProductEntitlement.upsert({
      where: { tenantId_productCode: { tenantId, productCode } },
      update: { status: "active", startsAt: now, expiresAt, source: "product_invite" },
      create: { tenantId, productCode, status: "active", startsAt: now, expiresAt, source: "product_invite" },
    });
  }
  const agentIds = productCode
    ? PRODUCT_LOGIN_DEFINITIONS[productCode].agentIds
    : ["agent_acquisition", "agent_takeaway_growth", "agent_restaurant_growth"];
  for (const agentId of agentIds) {
    await transactionClient.tenantAgentEntitlement.upsert({
      where: {
        tenantId_agentId: {
          tenantId,
          agentId
        }
      },
      update: {
        status: "active",
        startsAt: now,
        expiresAt,
        source: "beta_invite"
      },
      create: {
        tenantId,
        agentId,
        status: "active",
        startsAt: now,
        expiresAt,
        source: "beta_invite"
      }
    });
  }
}

async function restrictWorkspaceToProductAgents(
  transactionClient: any,
  tenantId: string,
  userId: string,
  productCode?: ProductLoginCode,
): Promise<void> {
  if (!productCode) return;
  const allowedAgentIds = [...PRODUCT_LOGIN_DEFINITIONS[productCode].agentIds];
  const memberships = await transactionClient.membership.findMany({
    where: { tenantId, userId },
    select: { id: true },
  });
  await transactionClient.memberAgentAccess.deleteMany({
    where: {
      membershipId: { in: memberships.map((membership: { id: string }) => membership.id) },
      ...(allowedAgentIds.length > 0 ? { agentId: { notIn: allowedAgentIds } } : {}),
    },
  });
  await transactionClient.tenantAgentEntitlement.deleteMany({
    where: {
      tenantId,
      ...(allowedAgentIds.length > 0 ? { agentId: { notIn: allowedAgentIds } } : {}),
    },
  });
}
