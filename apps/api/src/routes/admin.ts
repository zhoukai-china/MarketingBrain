import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, prisma } from "@baolu/db";
import { PLANS, PRODUCT_LOGIN_DEFINITIONS, PRODUCT_LOGIN_CODES, type PlanDefinition, type PlanCode } from "@baolu/shared";
import { env } from "../config/env.js";
import { requireAdminToken } from "../services/access-guards.js";
import { createInviteCode } from "../services/invite-codes.js";
import {
  AdminLoginNotConfiguredError,
  adminLoginConfigured,
  createAdminSessionToken,
  verifyAdminCredentials,
  verifyAdminSessionToken
} from "../services/admin-session.js";

/**
 * 后台登录限流（PLAT-39）：同一 IP 15 分钟内最多 10 次尝试。
 * 只是给「账号密码」这条入口加一道粗暴但有效的防爆破，不引入新依赖。
 */
const adminLoginWindows = new Map<string, { startedAt: number; count: number }>();
function consumeAdminLoginAllowance(ip: string): boolean {
  const now = Date.now();
  const current = adminLoginWindows.get(ip);
  if (!current || now - current.startedAt >= 15 * 60 * 1000) {
    adminLoginWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200)
});

/**
 * 积分汇总（PLAT-39，用户 2026-09-15「后台看不到积分/消耗/余额」）。
 *
 * 取数口径（2026-09-15 用生产数据校准过，避免把噪声当钱看）：
 * - **客户可用积分** = 统一钱包 `Wallet.paidBalance + bonusBalance`（客户真正在用的那个钱包，实测 9,320）；
 * - **累计按次消耗** = `MarketplaceLedgerEntry.type='ppu_consume'` 的积分合计（实测 720 / 6 次）；
 * - 遗留的 `CreditAccount.balance` 单独给一个字段（实测 20 亿，是历史/测试遗留，**不与钱包混算**，
 *   否则老板会看到 20 亿积分的假数字）。
 */
async function readCreditSummary(): Promise<{
  consumedCreditsTotal: number;
  walletPaidBalanceTotal: number;
  walletBonusBalanceTotal: number;
  balanceTotal: number;
  legacyAccountBalanceTotal: number;
}> {
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const [consumed, wallets, legacy] = await Promise.all([
    safe(
      () => prisma.marketplaceLedgerEntry.aggregate({ where: { type: "ppu_consume", status: "completed" }, _sum: { amountCredits: true } }),
      { _sum: { amountCredits: 0 } } as any
    ),
    safe(() => prisma.wallet.aggregate({ _sum: { paidBalance: true, bonusBalance: true } }), { _sum: { paidBalance: 0, bonusBalance: 0 } } as any),
    safe(() => prisma.creditAccount.aggregate({ _sum: { balance: true } }), { _sum: { balance: 0 } } as any)
  ]);
  const walletPaid = wallets?._sum?.paidBalance ?? 0;
  const walletBonus = wallets?._sum?.bonusBalance ?? 0;
  return {
    consumedCreditsTotal: Math.abs(consumed?._sum?.amountCredits ?? 0),
    walletPaidBalanceTotal: walletPaid,
    walletBonusBalanceTotal: walletBonus,
    balanceTotal: walletPaid + walletBonus,
    legacyAccountBalanceTotal: legacy?._sum?.balance ?? 0
  };
}

const createInviteSchema = z.object({
  code: z.string().min(4).max(80),
  label: z.string().max(120).optional(),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).optional(),
  productCode: z.enum(PRODUCT_LOGIN_CODES).optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
  endDate: z.string().datetime().optional(),
  createdBy: z.string().max(120).optional()
});

const updateInviteSchema = z.object({
  isActive: z.boolean()
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 平台管理后台登录（PLAT-39，用户 2026-09-15）：账号 + 密码换一枚有期限的会话令牌。
   * 普通用户没有管理员账号密码，进不了后台；脚本/运维仍可用旧的 `ADMIN_TOKEN`。
   */
  app.post("/admin/login", async (request, reply) => {
    if (!consumeAdminLoginAllowance(request.ip)) {
      return reply.code(429).send({ error: "admin_login_rate_limited", message: "尝试次数过多，请 15 分钟后再试。" });
    }
    const parsed = adminLoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: "请输入账号和密码。" });
    }
    if (!adminLoginConfigured()) {
      return reply.code(503).send({
        error: "admin_login_not_configured",
        message: "后台账号密码尚未配置，请先在服务器环境变量里设置 ADMIN_LOGIN_USERNAME 与 ADMIN_LOGIN_PASSWORD_HASH。"
      });
    }
    try {
      if (!verifyAdminCredentials(parsed.data.username, parsed.data.password)) {
        // 不区分「账号不对」和「密码不对」，避免被用来枚举账号。
        return reply.code(401).send({ error: "admin_credentials_invalid", message: "账号或密码不正确。" });
      }
      const session = createAdminSessionToken({ username: parsed.data.username.trim() });
      request.log.info({ event: "admin_login.succeeded" }, "admin console login");
      return { ok: true, username: parsed.data.username.trim(), token: session.token, expiresAt: session.expiresAt };
    } catch (error) {
      if (error instanceof AdminLoginNotConfiguredError) {
        return reply.code(503).send({ error: "admin_login_not_configured", message: "后台登录尚未配置，请联系技术。" });
      }
      throw error;
    }
  });

  /** 会话自检：页面用它判断「当前这枚令牌还有效吗」，失效就回到登录表单。 */
  app.get("/admin/session", async (request, reply) => {
    const token = request.headers["x-sitong-admin-token"];
    const value = Array.isArray(token) ? token[0] : token;
    const payload = verifyAdminSessionToken(value);
    if (payload) return { ok: true, mode: "session", username: payload.username, expiresAt: new Date(payload.exp * 1000).toISOString() };
    if (env.ADMIN_TOKEN && value === env.ADMIN_TOKEN) return { ok: true, mode: "legacy_token", username: null, expiresAt: null };
    return reply.code(401).send({ error: "admin_token_required", message: "请先用管理员账号登录后台。" });
  });

  app.get("/admin/invites", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        invites: [],
        note: "Set DATA_MODE=database to manage real beta invite codes."
      };
    }

    const invites = await prisma.inviteCode.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 100,
      include: {
        redemptions: {
          orderBy: {
            usedAt: "desc"
          },
          take: 10
        }
      }
    });

    return {
      dataMode: "database",
      invites: invites.map((invite: any) => ({
        id: invite.id,
        codePreview: invite.codePreview,
        label: invite.label,
        planCode: invite.planCode,
        productCode: invite.productCode,
        planName: invite.planCode ? (PLANS as Record<string, PlanDefinition>)[invite.planCode].name : null,
        maxUses: invite.maxUses,
        usedCount: invite.usedCount,
        remainingUses: Math.max(invite.maxUses - invite.usedCount, 0),
        isActive: invite.isActive,
        endDate: invite.expiresAt?.toISOString() ?? null,
        lastUsedAt: invite.lastUsedAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
        redemptions: invite.redemptions.map((redemption: any) => ({
          tenantId: redemption.tenantId,
          userId: redemption.userId,
          planCode: redemption.planCode,
          usedAt: redemption.usedAt.toISOString()
        }))
      }))
    };
  });

  app.post("/admin/invites", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE === "demo") {
      return reply.code(409).send({
        error: "database_mode_required",
        message: "邀请码管理需要 DATA_MODE=database"
      });
    }

    const parsed = createInviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    try {
      const product = parsed.data.productCode ? PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode] : undefined;
      if (product && parsed.data.planCode && parsed.data.planCode !== product.planCode) {
        return reply.code(400).send({ error: "product_plan_mismatch", message: "产品与套餐不匹配" });
      }
      const invite = await createInviteCode({
        code: parsed.data.code,
        label: parsed.data.label,
        planCode: product?.planCode ?? parsed.data.planCode,
        productCode: parsed.data.productCode,
        maxUses: parsed.data.maxUses,
        expiresAt: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        createdBy: parsed.data.createdBy
      });

      return {
        dataMode: "database",
        invite: {
          id: invite.id,
          codePreview: invite.codePreview,
          label: invite.label,
          planCode: invite.planCode,
          productCode: invite.productCode,
          maxUses: invite.maxUses,
          usedCount: invite.usedCount,
          isActive: invite.isActive,
          endDate: invite.expiresAt?.toISOString() ?? null,
          createdAt: invite.createdAt.toISOString()
        }
      };
    } catch (error) {
      if ((error as any)?.code === "P2002") {
        return reply.code(409).send({
          error: "invite_code_exists",
          message: "邀请码已存在，请换一个"
        });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/invites/:id",
    { preHandler: requireAdminToken },
    async (request, reply) => {
      if (env.DATA_MODE === "demo") {
        return reply.code(409).send({
          error: "database_mode_required",
          message: "邀请码管理需要 DATA_MODE=database"
        });
      }

      const parsed = updateInviteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      try {
        const invite = await prisma.inviteCode.update({
          where: {
            id: request.params.id
          },
          data: {
            isActive: parsed.data.isActive
          }
        });
        return {
          dataMode: "database",
          invite: {
            id: invite.id,
            codePreview: invite.codePreview,
            label: invite.label,
            planCode: invite.planCode,
            maxUses: invite.maxUses,
            usedCount: invite.usedCount,
            isActive: invite.isActive,
            endDate: invite.expiresAt?.toISOString() ?? null,
            updatedAt: invite.updatedAt.toISOString()
          }
        };
      } catch (error) {
        if ((error as any)?.code === "P2025") {
          return reply.code(404).send({
            error: "invite_code_not_found",
            message: "邀请码不存在"
          });
        }
        throw error;
      }
    }
  );

  app.get("/admin/customers", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        customers: [
          {
            id: "demo-tenant",
            name: "演示本地商家",
            type: "local_business",
            industry: "美容美业",
            city: "杭州",
            planName: "本地商家高级版",
            creditBalance: 1280,
            memberCount: 1,
            agentRunCount: 0,
            createdAt: new Date().toISOString()
          }
        ],
        note: "Set DATA_MODE=database to inspect real beta customers."
      };
    }

    const tenants = await prisma.tenant.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 100,
      include: {
        profile: true,
        creditAccount: true,
        subscriptions: {
          where: {
            status: {
              in: ["trialing", "active"]
            }
          },
          orderBy: { endDate: "desc"
          },
          take: 1
        },
        memberships: {
          where: {
            isActive: true
          },
          include: {
            user: true
          },
          take: 5
        },
        _count: {
          select: {
            memberships: true,
            agentRuns: true,
            conversations: true,
            files: true,
            billingOrders: true
          }
        }
      }
    });

    return {
      dataMode: "database",
      customers: tenants.map((tenant: any) => {
        const subscription = tenant.subscriptions[0];
        return {
          id: tenant.id,
          name: tenant.name,
          type: tenant.type,
          industry: tenant.industry,
          city: tenant.city,
          planCode: subscription?.planCode ?? null,
          planName: subscription ? (PLANS as Record<string, PlanDefinition>)[subscription.planCode].name : null,
          subscriptionStatus: subscription?.status ?? null,
          subscriptionExpiresAt: subscription?.endDate.toISOString() ?? null,
          creditBalance: tenant.creditAccount?.balance ?? 0,
          memberCount: tenant._count.memberships,
          agentRunCount: tenant._count.agentRuns,
          conversationCount: tenant._count.conversations,
          fileCount: tenant._count.files,
          billingOrderCount: tenant._count.billingOrders,
          ownerPreview: tenant.memberships[0]?.user.nickname ?? tenant.memberships[0]?.user.phone ?? null,
          profileUpdatedAt: tenant.profile?.version ? String(tenant.profile.version) : null,
          createdAt: tenant.createdAt.toISOString(),
          updatedAt: tenant.updatedAt.toISOString()
        };
      })
    };
  });

  app.get<{ Params: { tenantId: string } }>(
    "/admin/customers/:tenantId",
    { preHandler: requireAdminToken },
    async (request, reply) => {
      if (env.DATA_MODE === "demo") {
        return {
          dataMode: "demo",
          customer: {
            id: request.params.tenantId,
            name: "演示本地商家",
            type: "local_business",
            profile: {
              industry: "美容美业",
              city: "杭州"
            }
          },
          recentAgentRuns: [],
          recentOrders: [],
          recentFiles: [],
          recentAutomationTasks: []
        };
      }

      const tenant = await prisma.tenant.findUnique({
        where: {
          id: request.params.tenantId
        },
        include: {
          profile: true,
          creditAccount: true,
          memberships: {
            include: {
              user: true,
              store: true
            }
          },
          subscriptions: {
            orderBy: {
              createdAt: "desc"
            },
            take: 10
          },
          agentRuns: {
            orderBy: {
              createdAt: "desc"
            },
            take: 20
          },
          billingOrders: {
            orderBy: {
              createdAt: "desc"
            },
            take: 20
          },
          files: {
            orderBy: {
              createdAt: "desc"
            },
            take: 10
          },
          automationTasks: {
            orderBy: {
              createdAt: "desc"
            },
            take: 10
          },
          conversations: {
            orderBy: {
              updatedAt: "desc"
            },
            take: 10,
            include: {
              _count: {
                select: {
                  messages: true
                }
              }
            }
          }
        }
      });

      if (!tenant) {
        return reply.code(404).send({ error: "customer_not_found" });
      }

      return {
        dataMode: "database",
        customer: {
          id: tenant.id,
          name: tenant.name,
          type: tenant.type,
          industry: tenant.industry,
          city: tenant.city,
          profile: tenant.profile,
          creditBalance: tenant.creditAccount?.balance ?? 0,
          createdAt: tenant.createdAt.toISOString(),
          updatedAt: tenant.updatedAt.toISOString()
        },
        memberships: tenant.memberships.map((membership: any) => ({
          id: membership.id,
          role: membership.role,
          isActive: membership.isActive,
          storeName: membership.store?.name ?? null,
          user: {
            id: membership.user.id,
            nickname: membership.user.nickname,
            phone: membership.user.phone,
            wechatOpenid: membership.user.wechatOpenid ? "configured" : null,
            createdAt: membership.user.createdAt.toISOString()
          }
        })),
        subscriptions: tenant.subscriptions.map((subscription: any) => ({
          id: subscription.id,
          planCode: subscription.planCode,
          planName: (PLANS as Record<string, PlanDefinition>)[subscription.planCode].name,
          status: subscription.status,
          startDate: subscription.startDate.toISOString(),
          endDate: subscription.endDate.toISOString()
        })),
        recentAgentRuns: tenant.agentRuns.map((run: any) => ({
          id: run.id,
          skillId: run.skillId,
          status: run.status,
          creditCost: run.creditCost,
          qualityFlags: run.qualityFlags,
          inputPreview: run.input.slice(0, 180),
          outputPreview: run.output?.slice(0, 240),
          createdAt: run.createdAt.toISOString()
        })),
        recentOrders: tenant.billingOrders.map((order: any) => ({
          id: order.id,
          type: order.type,
          status: order.status,
          amountCny: order.amountCny,
          planCode: order.planCode,
          creditPackCode: order.creditPackCode,
          credits: order.credits,
          paidAt: order.paidAt?.toISOString() ?? null,
          createdAt: order.createdAt.toISOString()
        })),
        recentFiles: tenant.files.map((file: any) => ({
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          createdAt: file.createdAt.toISOString()
        })),
        recentAutomationTasks: tenant.automationTasks.map((task: any) => ({
          id: task.id,
          type: task.type,
          status: task.status,
          runAt: task.runAt.toISOString(),
          createdAt: task.createdAt.toISOString(),
          updatedAt: task.updatedAt.toISOString()
        })),
        recentConversations: tenant.conversations.map((conversation: any) => ({
          id: conversation.id,
          title: conversation.title,
          channel: conversation.channel,
          messageCount: conversation._count.messages,
          updatedAt: conversation.updatedAt.toISOString()
        }))
      };
    }
  );

  app.get("/admin/security/isolation-audit", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        ok: true,
        checked: {
          messages: 0,
          agentRuns: 0,
          fileAnalyses: 0,
          automationTasks: 0,
          creditTransactions: 0
        },
        issues: [],
        note: "Set DATA_MODE=database to run real tenant isolation audit."
      };
    }

    const [messages, agentRuns, fileAnalyses, automationTasks, creditTransactions] =
      await Promise.all([
        prisma.message.findMany({
          orderBy: {
            createdAt: "desc"
          },
          take: 500,
          include: {
            conversation: true
          }
        }),
        prisma.agentRun.findMany({
          where: {
            conversationId: {
              not: null
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 500,
          include: {
            conversation: true
          }
        }),
        prisma.fileAnalysis.findMany({
          orderBy: {
            createdAt: "desc"
          },
          take: 500,
          include: {
            file: true
          }
        }),
        prisma.automationTask.findMany({
          where: {
            deviceId: {
              not: null
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 500,
          include: {
            device: true
          }
        }),
        prisma.creditTransaction.findMany({
          orderBy: {
            createdAt: "desc"
          },
          take: 500,
          include: {
            creditAccount: true
          }
        })
      ]);

    const issues: Array<{
      severity: "critical";
      type: string;
      recordId: string;
      expectedTenantId?: string;
      actualTenantId?: string;
      message: string;
    }> = [];

    for (const message of messages) {
      if (message.tenantId !== message.conversation.tenantId) {
        issues.push({
          severity: "critical",
          type: "message_conversation_tenant_mismatch",
          recordId: message.id,
          expectedTenantId: message.conversation.tenantId,
          actualTenantId: message.tenantId,
          message: "消息 tenantId 与所属会诊 tenantId 不一致"
        });
      }
    }

    for (const run of agentRuns) {
      if (run.conversation && run.tenantId !== run.conversation.tenantId) {
        issues.push({
          severity: "critical",
          type: "agent_run_conversation_tenant_mismatch",
          recordId: run.id,
          expectedTenantId: run.conversation.tenantId,
          actualTenantId: run.tenantId,
          message: "AgentRun tenantId 与所属会诊 tenantId 不一致"
        });
      }
    }

    for (const analysis of fileAnalyses) {
      if (analysis.tenantId !== analysis.file.tenantId) {
        issues.push({
          severity: "critical",
          type: "file_analysis_file_tenant_mismatch",
          recordId: analysis.id,
          expectedTenantId: analysis.file.tenantId,
          actualTenantId: analysis.tenantId,
          message: "文件分析 tenantId 与文件 tenantId 不一致"
        });
      }
    }

    for (const task of automationTasks) {
      if (task.device && task.tenantId !== task.device.tenantId) {
        issues.push({
          severity: "critical",
          type: "automation_task_device_tenant_mismatch",
          recordId: task.id,
          expectedTenantId: task.device.tenantId,
          actualTenantId: task.tenantId,
          message: "自动化任务 tenantId 与桌面设备 tenantId 不一致"
        });
      }
    }

    for (const transaction of creditTransactions) {
      if (transaction.tenantId !== transaction.creditAccount.tenantId) {
        issues.push({
          severity: "critical",
          type: "credit_transaction_account_tenant_mismatch",
          recordId: transaction.id,
          expectedTenantId: transaction.creditAccount.tenantId,
          actualTenantId: transaction.tenantId,
          message: "积分流水 tenantId 与积分账户 tenantId 不一致"
        });
      }
    }

    return {
      dataMode: "database",
      ok: issues.length === 0,
      checked: {
        messages: messages.length,
        agentRuns: agentRuns.length,
        fileAnalyses: fileAnalyses.length,
        automationTasks: automationTasks.length,
        creditTransactions: creditTransactions.length
      },
      issues
    };
  });

  app.get("/admin/billing/audit", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        ok: true,
        checkedPaidOrders: 0,
        expiredPendingOrders: 0,
        issues: []
      };
    }

    const now = new Date();
    const paidOrders = await prisma.billingOrder.findMany({
      where: {
        status: "paid"
      },
      orderBy: {
        paidAt: "desc"
      },
      take: 200
    });
    const expiredPendingOrders = await prisma.billingOrder.findMany({
      where: {
        status: "pending",
        },
      orderBy: {
      },
      take: 100
    });

    const issues: Array<{
      severity: "warning" | "critical";
      orderId: string;
      type: string;
      message: string;
    }> = [];

    for (const order of paidOrders) {
      const creditTx = await prisma.creditTransaction.findFirst({
        where: {
          tenantId: order.tenantId,
          refType: "billing_order",
          refId: order.id
        }
      });
      if (!creditTx) {
        issues.push({
          severity: "critical",
          orderId: order.id,
          type: "missing_credit_transaction",
          message: "已支付订单没有对应积分发放流水"
        });
      }

      if (order.type === "subscription") {
        const subscription = await prisma.subscription.findFirst({
          where: {
            tenantId: order.tenantId,
            planCode: order.planCode ?? undefined,
            status: "active",
            startDate: {
              gte: order.paidAt ?? order.createdAt
            }
          },
          orderBy: {
            startDate: "desc"
          }
        });
        if (!subscription) {
          issues.push({
            severity: "critical",
            orderId: order.id,
            type: "missing_active_subscription",
            message: "已支付套餐订单没有找到对应有效订阅"
          });
        }
      }
    }

    for (const order of expiredPendingOrders) {
      issues.push({
        severity: "warning",
        orderId: order.id,
        type: "expired_pending_order",
        message: "订单已过期但仍处于 pending 状态"
      });
    }

    return {
      dataMode: "database",
      ok: issues.every((issue) => issue.severity !== "critical"),
      checkedPaidOrders: paidOrders.length,
      expiredPendingOrders: expiredPendingOrders.length,
      issues
    };
  });

  app.get("/admin/ops/summary", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        tenants: {
          total: 1,
          createdToday: 0
        },
        users: {
          total: 1,
          createdToday: 0
        },
        subscriptions: {
          activeOrTrialing: 1
        },
        billing: {
          paidOrders: 0,
          pendingOrders: 0,
          paidAmountCny: 0
        },
        usage: {
          agentRuns: 0,
          agentRunsToday: 0,
          fileAnalyses: 0,
          audioCardsAnalyzed: 0,
          automationTasks: 0
        },
        quality: {
          feedbackCount: 0,
          flaggedRuns: 0
        },
        topSkills: []
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalTenants,
      tenantsToday,
      totalUsers,
      usersToday,
      activeSubscriptions,
      paidOrders,
      pendingOrders,
      paidOrderRows,
      agentRuns,
      agentRunsToday,
      fileAnalyses,
      audioCardsAnalyzed,
      automationTasks,
      feedbackCount,
      flaggedRuns,
      topSkills
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({
        where: {
          createdAt: {
            gte: today
          }
        }
      }),
      prisma.user.count(),
      prisma.user.count({
        where: {
          createdAt: {
            gte: today
          }
        }
      }),
      prisma.subscription.count({
        where: {
          status: {
            in: ["trialing", "active"]
          }
        }
      }),
      prisma.billingOrder.count({
        where: {
          status: "paid"
        }
      }),
      prisma.billingOrder.count({
        where: {
          status: "pending"
        }
      }),
      prisma.billingOrder.findMany({
        where: {
          status: "paid"
        },
        select: {
          amountCny: true
        }
      }),
      prisma.agentRun.count(),
      prisma.agentRun.count({
        where: {
          createdAt: {
            gte: today
          }
        }
      }),
      prisma.fileAnalysis.count(),
      prisma.automationTask.count({
        where: {
          type: "audio_card_analysis",
          status: "analyzed"
        }
      }),
      prisma.automationTask.count(),
      prisma.qualityFeedback.count(),
      prisma.agentRun.count({
        where: {
          qualityFlags: {
            not: Prisma.DbNull
          }
        }
      }),
      prisma.agentRun.groupBy({
        by: ["skillId"],
        _count: {
          skillId: true
        },
        orderBy: {
          _count: {
            skillId: "desc"
          }
        },
        take: 8
      })
    ]);

    return {
      dataMode: "database",
      tenants: {
        total: totalTenants,
        createdToday: tenantsToday
      },
      users: {
        total: totalUsers,
        createdToday: usersToday
      },
      subscriptions: {
        activeOrTrialing: activeSubscriptions
      },
      billing: {
        paidOrders,
        pendingOrders,
        paidAmountCny: paidOrderRows.reduce((sum: number, order: any) => sum + order.amountCny, 0)
      },
      usage: {
        agentRuns,
        agentRunsToday,
        fileAnalyses,
        audioCardsAnalyzed,
        automationTasks
      },
      quality: {
        feedbackCount,
        flaggedRuns
      },
      /**
       * 积分侧汇总（PLAT-39，用户 2026-09-15「后台看不到积分/消耗/余额」）。
       * 只做只读聚合，不参与任何扣费逻辑；余额是「全平台客户剩余积分合计」。
       */
      credit: await readCreditSummary(),
      topSkills: topSkills.map((skill: any) => ({
        skillId: skill.skillId,
        count: skill._count.skillId
      }))
    };
  });

  app.get("/admin/quality/summary", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        pendingReviews: 0,
        totalRuns: 0,
        topIssueTypes: [],
        recentFeedback: [],
        note: "Set DATA_MODE=database to read agent_runs and quality_feedbacks."
      };
    }

    const [totalRuns, flaggedRuns, feedbackCount, topIssueTypes, recentFeedback] = await Promise.all([
      prisma.agentRun.count(),
      prisma.agentRun.count({
        where: {
          qualityFlags: {
            not: Prisma.DbNull
          }
        }
      }),
      prisma.qualityFeedback.count(),
      prisma.qualityFeedback.groupBy({
        by: ["issueType"],
        where: {
          issueType: {
            not: null
          }
        },
        _count: {
          issueType: true
        },
        orderBy: {
          _count: {
            issueType: "desc"
          }
        },
        take: 8
      }),
      prisma.qualityFeedback.findMany({
        orderBy: {
          createdAt: "desc"
        },
        take: 20,
        include: {
          agentRun: {
            select: {
              tenantId: true,
              skillId: true,
              input: true,
              output: true,
              createdAt: true
            }
          }
        }
      })
    ]);

    return {
      dataMode: "database",
      totalRuns,
      flaggedRuns,
      feedbackCount,
      topIssueTypes: topIssueTypes.map((item: any) => ({
        issueType: item.issueType,
        count: item._count.issueType
      })),
      recentFeedback: recentFeedback.map((feedback: any) => ({
        id: feedback.id,
        rating: feedback.rating,
        issueType: feedback.issueType,
        note: feedback.note,
        createdAt: feedback.createdAt.toISOString(),
        agentRun: {
          tenantId: feedback.agentRun.tenantId,
          skillId: feedback.agentRun.skillId,
          inputPreview: feedback.agentRun.input.slice(0, 160),
          outputPreview: feedback.agentRun.output?.slice(0, 240),
          createdAt: feedback.agentRun.createdAt.toISOString()
        }
      }))
    };
  });
}
