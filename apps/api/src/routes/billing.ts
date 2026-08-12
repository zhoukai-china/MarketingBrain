import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "@baolu/db";
import {
  CREDIT_PACKS,
  CREDIT_PRICING,
  type CreditPackCode,
} from "@baolu/shared";
import { env } from "../config/env.js";
import {
  createDemoBillingOrder,
  listDemoBillingOrders,
  payDemoBillingOrder
} from "../services/demo-billing.js";
import { applyPaidOrder } from "../services/billing-effects.js";
import { resolveRequestContext } from "../services/request-context.js";
import {
  createWechatJsapiPrepay,
  createWechatNativePrepay,
  decryptWechatPayResource,
  verifyWechatPaySignature,
  WechatPayNotConfiguredError,
  type WechatPayNotificationBody
} from "../services/wechat-pay.js";

const createOrderSchema = z.object({
  type: z.literal("credit_pack"),
  creditPackCode: z.enum(["starter_500", "growth_1500", "scale_5000"]),
  eventId: z.string().min(1).optional(),
  eventCode: z.string().min(3).max(80).optional(),
  registrationId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  commissionRate: z.number().min(0).max(0.5).optional()
});

const prepaySchema = z.object({
  tradeType: z.enum(["native", "jsapi"]).default("native")
});

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/billing/catalog", async () => ({
    pricingMode: "credits_only",
    creditPricing: CREDIT_PRICING,
    creditPacks: Object.values(CREDIT_PACKS),
    projectPackages: [],
    agentOffers: []
  }));

  app.get("/billing/orders", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        orders: listDemoBillingOrders(context.tenantId)
      };
    }

    const orders = await prisma.billingOrder.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return {
      dataMode: "database",
      orders
    };
  });

  app.get<{ Params: { orderId: string } }>("/billing/orders/:orderId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const order = listDemoBillingOrders(context.tenantId).find(
        (item) => item.id === request.params.orderId
      );
      if (!order) {
        return reply.code(404).send({ error: "order_not_found" });
      }
      return {
        dataMode: "demo",
        order
      };
    }

    const order = await prisma.billingOrder.findFirst({
      where: {
        id: request.params.orderId,
        tenantId: context.tenantId
      }
    });
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }

    const [creditTransactions, subscriptions] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: {
          tenantId: context.tenantId,
          refType: "billing_order",
          refId: order.id
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      prisma.subscription.findMany({
        where: {
          tenantId: context.tenantId,
          planCode: order.planCode ?? undefined
        },
        orderBy: {
          endDate: "desc"
        },
        take: 1
      })
    ]);

    return {
      dataMode: "database",
      order,
      fulfillment: {
        creditTransactions,
        latestSubscription: subscriptions[0] ?? null
      }
    };
  });

  app.get<{ Params: { orderId: string } }>("/billing/orders/:orderId/wechat-qr.svg", async (request, reply) => {
    let codeUrl: string | null | undefined;

    if (env.DATA_MODE === "demo") {
      codeUrl = `weixin://wxpay/mock/${request.params.orderId}`;
    } else {
      const order = await prisma.billingOrder.findUnique({
        where: {
          id: request.params.orderId
        },
        select: {
          codeUrl: true
        }
      });
      codeUrl = order?.codeUrl;
    }

    if (!codeUrl) {
      return reply.code(404).send({ error: "wechat_qr_not_found" });
    }

    const svg = await QRCode.toString(codeUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260
    });

    return reply
      .header("content-type", "image/svg+xml; charset=utf-8")
      .header("cache-control", "no-store")
      .send(svg);
  });

  app.post("/billing/orders", async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const orderInput = await buildOrderInput(parsed.data);
    if (!orderInput.ok) {
      return reply.code(400).send({
        error: orderInput.error
      });
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);
    const attribution = await resolveOrderAttribution(parsed.data, context.tenantId);

    if (env.DATA_MODE === "demo") {
      const order = createDemoBillingOrder({
        tenantId: context.tenantId,
        userId: context.userId,
        type: parsed.data.type,
        amountCny: orderInput.amountCny,
        planCode: undefined,
        billingPeriod: undefined,
        creditPackCode: orderInput.creditPackCode,
        projectPackageCode: undefined,
        offerId: undefined,
        channelId: attribution.channelId,
        eventId: attribution.eventId,
        commissionRate: attribution.commissionRate,
        credits: orderInput.credits,
        expiresAt: expiresAt.toISOString()
      });
      return {
        dataMode: "demo",
        order
      };
    }

    const order = await prisma.billingOrder.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        type: parsed.data.type,
        amountCny: orderInput.amountCny,
        planCode: null,
        billingPeriod: null,
        creditPackCode: orderInput.creditPackCode,
        projectPackageCode: null,
        offerId: null,
        channelId: attribution.channelId,
        eventId: attribution.eventId,
        commissionRate: attribution.commissionRate,
        credits: orderInput.credits,
        provider: "wechat_pay",
        codeUrl: `weixin://wxpay/pending/${Date.now()}`,
        expiresAt,
        metadata: {
          source: "api",
          eventCode: parsed.data.eventCode,
          registrationId: parsed.data.registrationId,
          note: "WeChat Pay prepay integration pending"
        }
      }
    });

    return {
      dataMode: "database",
      order
    };
  });

  app.post<{ Params: { orderId: string } }>("/billing/orders/:orderId/mock-pay", async (request, reply) => {
    if (env.NODE_ENV === "production") {
      return reply.code(404).send({ error: "not_found" });
    }

    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const order = payDemoBillingOrder(request.params.orderId, context.tenantId);
      if (!order) {
        return reply.code(404).send({ error: "order_not_found" });
      }
      return {
        dataMode: "demo",
        order,
        applied: true
      };
    }

    const order = await prisma.billingOrder.findFirst({
      where: {
        id: request.params.orderId,
        tenantId: context.tenantId
      }
    });
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }

    const paidOrder = await applyPaidOrder(order.id);
    return {
      dataMode: "database",
      order: paidOrder,
      applied: true
    };
  });

  app.post<{ Params: { orderId: string } }>("/billing/orders/:orderId/wechat-prepay", async (request, reply) => {
    const parsed = prepaySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const context = await resolveRequestContext(request.headers);

    if (env.DATA_MODE === "demo") {
      const order = listDemoBillingOrders(context.tenantId).find(
        (item) => item.id === request.params.orderId
      );
      if (!order) {
        return reply.code(404).send({ error: "order_not_found" });
      }
      return {
        dataMode: "demo",
        orderId: order.id,
        codeUrl: order.codeUrl,
        provider: order.provider,
        tradeType: parsed.data.tradeType
      };
    }

    const order = await prisma.billingOrder.findFirst({
      where: {
        id: request.params.orderId,
        tenantId: context.tenantId
      },
      include: {
        user: true,
        offer: true
      }
    });
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }
    if (order.type !== "credit_pack") {
      return reply.code(409).send({ error: "legacy_billing_order_disabled", message: "系统现已改为仅积分充值，历史套餐订单不能继续支付。" });
    }
    if (order.status !== "pending") {
      return reply.code(409).send({ error: `order_not_pending:${order.status}` });
    }

    try {
      if (parsed.data.tradeType === "jsapi") {
        const openid = order.user?.wechatOpenid;
        if (!openid) {
          return reply.code(409).send({
            error: "wechat_openid_required",
            message: "当前账号没有微信登录身份，请在微信内完成登录后再拉起微信支付"
          });
        }

        const prepay = await createWechatJsapiPrepay({
          orderId: order.id,
          description: buildOrderDescription({
            creditPackCode: order.creditPackCode
          }),
          amountCny: order.amountCny,
          expiresAt: order.expiresAt,
          openid
        });

        const updated = await prisma.billingOrder.update({
          where: { id: order.id },
          data: {
            providerOrderId: prepay.outTradeNo,
            metadata: {
              wechatTradeType: "jsapi",
              wechatPrepayId: prepay.prepayId
            }
          }
        });

        return {
          dataMode: "database",
          orderId: updated.id,
          provider: updated.provider,
          tradeType: "jsapi",
          payParams: prepay.payParams
        };
      }

      const prepay = await createWechatNativePrepay({
        orderId: order.id,
        description: buildOrderDescription({
          creditPackCode: order.creditPackCode
        }),
        amountCny: order.amountCny,
        expiresAt: order.expiresAt
      });

      const updated = await prisma.billingOrder.update({
        where: { id: order.id },
        data: {
          codeUrl: prepay.codeUrl,
          providerOrderId: prepay.outTradeNo,
          metadata: {
            wechatTradeType: "native"
          }
        }
      });

      return {
        dataMode: "database",
        orderId: updated.id,
        codeUrl: updated.codeUrl,
        provider: updated.provider,
        tradeType: "native"
      };
    } catch (error) {
      if (error instanceof WechatPayNotConfiguredError) {
        return reply.code(503).send({
          error: "wechat_pay_not_configured",
          issues: error.issues
        });
      }
      request.log.error(
        {
          err: error,
          errorMessage: error instanceof Error ? error.message : String(error),
          orderId: order.id,
          amountCny: order.amountCny,
          planCode: order.planCode,
          creditPackCode: order.creditPackCode
        },
        "wechat_pay_prepay_failed"
      );
      return reply.code(502).send({
        error: "wechat_pay_prepay_failed",
        message: "微信支付暂时不可用，请稍后重试"
      });
    }
  });

  await registerWechatNotifyRoute(app);
}

type BuiltOrderInput =
  | {
      ok: true;
      amountCny: number;
      creditPackCode: CreditPackCode;
      credits: number;
    }
  | { ok: false; error: string };

async function buildOrderInput(input: z.infer<typeof createOrderSchema>): Promise<BuiltOrderInput> {
  const pack = CREDIT_PACKS[input.creditPackCode];
  return {
    ok: true,
    amountCny: pack.priceCny,
    creditPackCode: input.creditPackCode,
    credits: pack.credits
  };
}

function buildOrderDescription(order: {
  creditPackCode?: string | null;
}): string {
  if (order.creditPackCode) {
    const pack = CREDIT_PACKS[order.creditPackCode as CreditPackCode];
    return `思潼 企业AI增长飞轮-${pack?.name ?? "积分包"}`;
  }
  return "思潼 企业AI增长飞轮积分充值";
}

async function resolveOrderAttribution(
  input: z.infer<typeof createOrderSchema>,
  tenantId: string
): Promise<{
  eventId?: string;
  channelId?: string;
  commissionRate?: number;
}> {
  if (env.DATA_MODE === "demo") {
    return {
      eventId: input.eventId ?? input.eventCode,
      channelId: input.channelId,
      commissionRate: input.commissionRate
    };
  }

  const event = input.eventId
    ? await prisma.offlineEvent.findFirst({
        where: {
          id: input.eventId,
          tenantId
        }
      })
    : input.eventCode
      ? await prisma.offlineEvent.findFirst({
          where: {
            code: input.eventCode,
            tenantId
          }
        })
      : null;

  return {
    eventId: event?.id ?? input.eventId,
    channelId: event?.channelId ?? input.channelId,
    commissionRate: input.commissionRate ?? (event ? Number(event.commissionRate) : undefined)
  };
}

async function registerWechatNotifyRoute(app: FastifyInstance): Promise<void> {
  await app.register(async (notifyApp) => {
    notifyApp.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });

    notifyApp.post("/billing/wechat/notify", async (request, reply) => {
      const bodyText = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
      const signatureOk = verifyWechatPaySignature({
        timestamp: request.headers["wechatpay-timestamp"],
        nonce: request.headers["wechatpay-nonce"],
        signature: request.headers["wechatpay-signature"],
        bodyText
      });
      if (!signatureOk) {
        return reply.code(401).send({
          code: "SIGN_ERROR",
          message: "signature verification failed"
        });
      }

      let body: WechatPayNotificationBody;
      try {
        body = JSON.parse(bodyText) as WechatPayNotificationBody;
      } catch {
        return reply.code(400).send({
          code: "BAD_REQUEST",
          message: "invalid json body"
        });
      }

      try {
        const resource = decryptWechatPayResource(body);
        if (resource.trade_state !== "SUCCESS") {
          return reply.code(200).send({ code: "SUCCESS", message: "ignored" });
        }
        if (!resource.out_trade_no) {
          return reply.code(400).send({ code: "BAD_REQUEST", message: "out_trade_no missing" });
        }

        const order = await prisma.billingOrder.findUnique({
          where: {
            id: resource.out_trade_no
          }
        });
        if (!order) {
          return reply.code(404).send({ code: "ORDER_NOT_FOUND", message: "order not found" });
        }

        await prisma.billingOrder.update({
          where: { id: order.id },
          data: {
            providerOrderId: resource.transaction_id ?? order.providerOrderId,
            metadata: {
              wechatTradeState: resource.trade_state,
              wechatSuccessTime: resource.success_time
            }
          }
        });
        await applyPaidOrder(order.id);

        return reply.code(200).send({
          code: "SUCCESS",
          message: "成功"
        });
      } catch (error) {
        if (error instanceof WechatPayNotConfiguredError) {
          return reply.code(503).send({
            code: "WECHAT_PAY_NOT_CONFIGURED",
            message: error.issues.join("; ")
          });
        }
        request.log.error(error);
        return reply.code(500).send({
          code: "FAIL",
          message: error instanceof Error ? error.message : "unknown error"
        });
      }
    });
  });
}
