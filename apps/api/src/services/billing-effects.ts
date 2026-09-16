import { prisma } from "@baolu/db";
import { Prisma } from "@baolu/db";
import { PLANS, CREDIT_PACKS, PROJECT_PACKAGES, type PlanDefinition } from "@baolu/shared";
import { applyRechargeInTx } from "./sitong-wallet.js";
import { buildRechargeNotice, notifyOps } from "./ops-alert.js";
import { readWallet } from "./sitong-wallet.js";

export async function applyPaidOrder(orderId: string) {
  /**
   * 2026-09-16 用户：「用户付费了我咋样才能知道呢？也给我推送到企业微信吧」。
   * 先记下支付前的状态，事务提交后再判断「这一单是不是刚刚从 pending 变成 paid」——
   * 支付回调可能被重放，只有真正完成那一次才推送，避免老板收到重复通知。
   */
  const statusBefore = await prisma.billingOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  const paidOrder = await prisma.$transaction(async (tx: any) => {
    const order = await tx.billingOrder.findUnique({
      where: { id: orderId },
      include: { offer: { include: { agents: true } } }
    });
    if (!order) {
      throw new Error("order_not_found");
    }
    if (order.status === "paid") {
      return order;
    }
    if (order.status !== "pending") {
      throw new Error(`order_not_payable:${order.status}`);
    }
    if (order.type !== "credit_pack") {
      // New orders are credits-only. Keep legacy orders in the ledger for
      // auditability, but do not accidentally renew a subscription or sell an
      // expiring agent entitlement after the pricing model changed.
      throw new Error("legacy_billing_order_disabled");
    }

    const claimedPaid = await tx.billingOrder.updateMany({
      where: { id: order.id, status: "pending" },
      data: {
        status: "paid",
        paidAt: new Date()
      }
    });
    if (claimedPaid.count !== 1) {
      const existing = await tx.billingOrder.findUnique({ where: { id: order.id } });
      if (!existing) throw new Error("order_not_found");
      return existing;
    }
    const paidOrder = await tx.billingOrder.findUniqueOrThrow({ where: { id: order.id } });

    const creditAccount =
      (await tx.creditAccount.findUnique({ where: { tenantId: order.tenantId } })) ??
      (await tx.creditAccount.create({
        data: {
          tenantId: order.tenantId,
          balance: 0
        }
      }));

    if (order.type === "subscription" && order.planCode) {
      const plan = (PLANS as Record<string, PlanDefinition>)[order.planCode];
      const startDate = new Date();
      const endDate = new Date(startDate);
      if (order.billingPeriod === "yearly") {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      await tx.subscription.updateMany({
        where: {
          tenantId: order.tenantId,
          status: {
            in: ["trialing", "active"]
          }
        },
        data: {
          status: "expired"
        }
      });

      await tx.subscription.create({
        data: {
          tenantId: order.tenantId,
          planCode: order.planCode,
          status: "active",
          startDate,
          endDate
        }
      });

      await tx.creditAccount.update({
        where: { id: creditAccount.id },
        data: {
          balance: {
            increment: plan.monthlyCredits
          }
        }
      });

      await tx.creditTransaction.create({
        data: {
          creditAccountId: creditAccount.id,
          tenantId: order.tenantId,
          userId: order.userId,
          direction: "grant",
          amount: plan.monthlyCredits,
          reason: `subscription:${order.planCode}`,
          refType: "billing_order",
          refId: order.id
        }
      });
    }

    if (order.type === "credit_pack" && order.creditPackCode) {
      const pack = CREDIT_PACKS[order.creditPackCode as keyof typeof CREDIT_PACKS];
      if (!order.userId) throw new Error("credit_pack_order_missing_user");
      await applyRechargeInTx(tx, {
        userId: order.userId,
        planId: order.creditPackCode,
        amountCny: order.amountCny,
        basePts: pack.baseCredits,
        bonusPts: pack.bonusCredits,
        method: order.provider ?? "wechat",
        idempotencyKey: `billing:${order.id}`,
        priceVersion: 1,
        source: "web"
      });
    }

    if (order.type === "project_package" && order.projectPackageCode) {
      const pack = PROJECT_PACKAGES[order.projectPackageCode as keyof typeof PROJECT_PACKAGES];
      if (!pack) {
        throw new Error("project_package_not_found");
      }

      const existingGrant = await tx.creditTransaction.findFirst({
        where: {
          tenantId: order.tenantId,
          refType: "billing_order",
          refId: order.id,
          reason: `project_package:${order.projectPackageCode}`
        }
      });

      if (!existingGrant && pack.includedCredits > 0) {
        await tx.creditAccount.update({
          where: { id: creditAccount.id },
          data: {
            balance: {
              increment: pack.includedCredits
            }
          }
        });

        await tx.creditTransaction.create({
          data: {
            creditAccountId: creditAccount.id,
            tenantId: order.tenantId,
            userId: order.userId,
            direction: "grant",
            amount: pack.includedCredits,
            reason: `project_package:${order.projectPackageCode}`,
            refType: "billing_order",
            refId: order.id
          }
        });
      }

      const dates = buildProjectDates(pack);
      const cohort = await ensureGrowthCohort(tx, {
        tenantId: order.tenantId,
        eventId: order.eventId,
        packageCode: order.projectPackageCode,
        packageName: pack.name,
        seatLimit: pack.defaultSeatLimit,
        dates
      });

      const project = await tx.growthProject.upsert({
        where: { orderId: order.id },
        update: {},
        create: {
          tenantId: order.tenantId,
          userId: order.userId,
          cohortId: cohort?.id,
          orderId: order.id,
          packageCode: order.projectPackageCode,
          status: "active",
          startDate: dates.startDate,
          intensiveEndDate: dates.intensiveEndDate,
          accessEndDate: dates.accessEndDate,
          bufferEndDate: dates.bufferEndDate,
          progressPercent: 0
        }
      });

      await ensureDefaultProjectTasks(tx, {
        tenantId: order.tenantId,
        projectId: project.id,
        cohortId: cohort?.id,
        packageCode: order.projectPackageCode
      });

      if (order.channelId) {
        await ensureChannelCommission(tx, order);
      }
    }

    if (order.type === "agent_offer" && order.offer) {
      const expiresAt = order.offer.durationDays
        ? addDays(new Date(), order.offer.durationDays)
        : null;
      for (const item of order.offer.agents) {
        await tx.tenantAgentEntitlement.upsert({
          where: {
            tenantId_agentId: {
              tenantId: order.tenantId,
              agentId: item.agentId
            }
          },
          update: {
            status: "active",
            source: "agent_offer",
            startsAt: new Date(),
            expiresAt,
            orderId: order.id
          },
          create: {
            tenantId: order.tenantId,
            agentId: item.agentId,
            status: "active",
            source: "agent_offer",
            startsAt: new Date(),
            expiresAt,
            orderId: order.id
          }
        });
      }

      if (order.userId) {
        const membership = await tx.membership.findFirst({
          where: { tenantId: order.tenantId, userId: order.userId, isActive: true }
        });
        if (membership) {
          for (const item of order.offer.agents) {
            await tx.memberAgentAccess.upsert({
              where: {
                membershipId_agentId: {
                  membershipId: membership.id,
                  agentId: item.agentId
                }
              },
              update: {},
              create: { membershipId: membership.id, agentId: item.agentId }
            });
          }
        }
      }

      if (order.offer.credits > 0) {
        await tx.creditAccount.update({
          where: { id: creditAccount.id },
          data: { balance: { increment: order.offer.credits } }
        });
        await tx.creditTransaction.create({
          data: {
            creditAccountId: creditAccount.id,
            tenantId: order.tenantId,
            userId: order.userId,
            direction: "grant",
            amount: order.offer.credits,
            reason: `agent_offer:${order.offer.code}`,
            refType: "billing_order",
            refId: order.id
          }
        });
      }
    }

    return paidOrder;
  });

  if (statusBefore?.status === "pending" && paidOrder?.status === "paid" && paidOrder.type === "credit_pack") {
    // 通知失败只写日志，绝不把「已入账」的订单搞成失败（见 ops-alert.ts 的失败关闭原则）。
    void notifyRechargePaid(paidOrder).catch(() => undefined);
  }
  return paidOrder;
}

/** 充值到账通知（企业微信）：客户名 / 金额 / 到账积分 / 该客户当前余额 / 订单号。 */
async function notifyRechargePaid(order: {
  id: string;
  tenantId: string;
  userId: string | null;
  amountCny: number;
  creditPackCode: string | null;
  provider: string | null;
}): Promise<void> {
  const pack = order.creditPackCode ? CREDIT_PACKS[order.creditPackCode as keyof typeof CREDIT_PACKS] : undefined;
  const [tenant, user, wallet] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: order.tenantId }, select: { name: true } }),
    order.userId ? prisma.user.findUnique({ where: { id: order.userId }, select: { nickname: true, phone: true } }) : Promise.resolve(null),
    order.userId ? readWallet(order.userId) : Promise.resolve(null)
  ]);
  await notifyOps(
    buildRechargeNotice({
      tenantName: tenant?.name ?? "（未命名工作区）",
      userName: user?.nickname ?? user?.phone ?? null,
      amountCny: order.amountCny,
      basePts: pack?.baseCredits ?? 0,
      bonusPts: pack?.bonusCredits ?? 0,
      balance: wallet?.balance ?? 0,
      method: order.provider,
      orderId: order.id
    })
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildProjectDates(pack: { intensiveDays: number; accessDays: number; bufferDays: number }) {
  const startDate = new Date();
  return {
    startDate,
    intensiveEndDate: addDays(startDate, pack.intensiveDays),
    accessEndDate: addDays(startDate, pack.accessDays),
    bufferEndDate: addDays(startDate, pack.bufferDays)
  };
}

async function ensureGrowthCohort(
  tx: any,
  params: {
    tenantId: string;
    eventId?: string | null;
    packageCode: string;
    packageName: string;
    seatLimit: number;
    dates: ReturnType<typeof buildProjectDates>;
  }
) {
  if (!["local_growth_30", "local_growth_90"].includes(params.packageCode)) {
    return null;
  }

  const existing = await tx.growthProjectCohort.findFirst({
    where: {
      tenantId: params.tenantId,
      eventId: params.eventId ?? undefined,
      packageCode: params.packageCode,
      status: {
        in: ["planned", "active"]
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (existing) return existing;

  const event = params.eventId
    ? await tx.offlineEvent.findUnique({
        where: { id: params.eventId },
        select: { title: true }
      })
    : null;

  return tx.growthProjectCohort.create({
    data: {
      tenantId: params.tenantId,
      eventId: params.eventId,
      packageCode: params.packageCode,
      name: `${event?.title ?? "AI增长项目"}-${params.packageName}`,
      status: "active",
      startDate: params.dates.startDate,
      intensiveEndDate: params.dates.intensiveEndDate,
      accessEndDate: params.dates.accessEndDate,
      bufferEndDate: params.dates.bufferEndDate,
      seatLimit: params.seatLimit
    }
  });
}

async function ensureDefaultProjectTasks(
  tx: any,
  params: {
    tenantId: string;
    projectId: string;
    cohortId?: string | null;
    packageCode: string;
  }
) {
  const existing = await tx.growthProjectTask.findFirst({
    where: {
      projectId: params.projectId
    }
  });
  if (existing) return;

  const tasks =
    params.packageCode === "ai_health_express"
      ? [
          ["上传/补充诊断资料", "补齐门店、获客、成交和当前卡点信息，方便加急解读。", 1],
          ["完成体检解读", "围绕报告确认优先问题、排序依据和30天行动建议。", 3],
          ["确认是否进入陪跑", "根据解读结果决定是否抵扣升级30天增长陪跑包。", 7]
        ]
      : [
          ["确认30天主目标", "在获客、内容、私域成交或直播转化中选定一个优先场景。", 1],
          ["完成第一周行动清单", "根据系统任务完成账号/门店资料、客户画像和内容入口梳理。", 7],
          ["提交阶段成果", "提交内容、话术、跟进动作或直播复盘，等待统一点评。", 14],
          ["完成成交/获客复盘", "复盘30天执行结果，沉淀下一轮继续优化的动作。", 30]
        ];

  await tx.growthProjectTask.createMany({
    data: tasks.map(([title, description, dueDay]) => ({
      tenantId: params.tenantId,
      projectId: params.projectId,
      cohortId: params.cohortId,
      title,
      description,
      dueDay
    }))
  });
}

async function ensureChannelCommission(tx: any, order: any) {
  const existing = await tx.distroOrder.findFirst({
    where: {
      orderId: order.id
    }
  });
  if (existing) return;

  const tenant = await tx.tenant.findUnique({
    where: { id: order.tenantId },
    select: { name: true }
  });
  const customerId = order.userId ?? order.tenantId;
  const customer = await tx.distroCustomer.upsert({
    where: {
      distributorId_customerId_customerType: {
        distributorId: order.channelId,
        customerId,
        customerType: order.userId ? "user" : "tenant"
      }
    },
    update: {
      totalOrders: { increment: 1 },
      totalAmount: { increment: new Prisma.Decimal(order.amountCny) }
    },
    create: {
      distributorId: order.channelId,
      customerId,
      customerType: order.userId ? "user" : "tenant",
      name: tenant?.name ?? "活动客户",
      totalOrders: 1,
      totalAmount: new Prisma.Decimal(order.amountCny),
      source: order.eventId ? `offline_event:${order.eventId}` : "offline_event"
    }
  });

  const rate = new Prisma.Decimal(order.commissionRate ?? 0.2);
  const amount = new Prisma.Decimal(order.amountCny).mul(rate);
  const distroOrder = await tx.distroOrder.create({
    data: {
      distributorId: order.channelId,
      distroCustomerId: customer.id,
      orderId: order.id,
      orderType: order.type,
      amount: new Prisma.Decimal(order.amountCny),
      status: "completed",
      settledAt: new Date()
    }
  });

  const unfrozenAt = new Date();
  unfrozenAt.setDate(unfrozenAt.getDate() + 7);
  await tx.distroCommissionLog.create({
    data: {
      distributorId: order.channelId,
      distroOrderId: distroOrder.id,
      amount,
      rate,
      level: 1,
      type: "offline_event_direct",
      status: "pending",
      description: "AI增长项目渠道结算",
      unfrozenAt
    }
  });

  await tx.distributor.update({
    where: { id: order.channelId },
    data: {
      totalEarnings: { increment: amount },
      frozenAmount: { increment: amount }
    }
  });

  if (order.eventId) {
    await tx.offlineEventRegistration.updateMany({
      where: {
        eventId: order.eventId,
        OR: [
          order.userId ? { userId: order.userId } : undefined,
          { tenantId: order.tenantId }
        ].filter(Boolean)
      },
      data: {
        status: "purchased",
        purchasedAt: new Date()
      }
    });
  }
}

