import type { FastifyInstance, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { Prisma, prisma } from "@baolu/db";
import { PROJECT_PACKAGES } from "@baolu/shared";
import { env } from "../config/env.js";
import { requireAdminToken } from "../services/access-guards.js";
import { resolveRequestContext } from "../services/request-context.js";

const createEventSchema = z.object({
  tenantId: z.string().min(1),
  channelId: z.string().min(1).optional(),
  channelCode: z.string().min(1).optional(),
  code: z.string().min(3).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(2).max(120).default("本地商家AI增长公开课"),
  topic: z.string().min(2).max(160).default("本地商家如何用AI把获客、内容和成交跑起来"),
  city: z.string().max(80).optional(),
  venue: z.string().max(160).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  targetAttendees: z.number().int().min(1).max(500).default(30),
  minAttendees: z.number().int().min(1).max(200).default(15),
  commissionRate: z.number().min(0).max(0.5).default(0.2)
});

const registrationSchema = z.object({
  name: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  businessName: z.string().max(120).optional(),
  industry: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  source: z.string().max(80).default("offline_event")
});

const diagnosisCompletedSchema = z.object({
  registrationId: z.string().min(1).optional(),
  phone: z.string().max(40).optional(),
  conversationId: z.string().max(120).optional(),
  report: z.record(z.unknown()).optional()
});

export async function registerOfflineEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/offline-events", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE === "demo") {
      return reply.code(409).send({
        error: "database_mode_required",
        message: "线下活动管理需要 DATA_MODE=database"
      });
    }

    const parsed = createEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const channel = parsed.data.channelId
      ? await prisma.distributor.findFirst({
          where: {
            id: parsed.data.channelId,
            tenantId: parsed.data.tenantId
          }
        })
      : parsed.data.channelCode
        ? await prisma.distributor.findFirst({
            where: {
              code: parsed.data.channelCode,
              tenantId: parsed.data.tenantId
            }
          })
        : null;

    const event = await prisma.offlineEvent.create({
      data: {
        tenantId: parsed.data.tenantId,
        channelId: channel?.id,
        code: parsed.data.code,
        title: parsed.data.title,
        topic: parsed.data.topic,
        city: parsed.data.city,
        venue: parsed.data.venue,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
        targetAttendees: parsed.data.targetAttendees,
        minAttendees: parsed.data.minAttendees,
        commissionRate: parsed.data.commissionRate
      }
    });

    return {
      dataMode: "database",
      event: serializeEvent(event, request)
    };
  });

  app.get<{ Params: { code: string } }>("/offline-events/:code", async (request, reply) => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        event: buildDemoEvent(request.params.code, request)
      };
    }

    const event = await prisma.offlineEvent.findUnique({
      where: { code: request.params.code },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        _count: {
          select: {
            registrations: true,
            billingOrders: true
          }
        }
      }
    });
    if (!event) {
      return reply.code(404).send({ error: "event_not_found" });
    }

    return {
      dataMode: "database",
      event: serializeEvent(event, request)
    };
  });

  app.get<{ Params: { code: string } }>("/offline-events/:code/qr.svg", async (request, reply) => {
    const url = buildEventEntryUrl(request.params.code, request);
    const svg = await QRCode.toString(url, {
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

  app.post<{ Params: { code: string } }>("/offline-events/:code/register", async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers).catch(() => null);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        registration: {
          id: `demo_registration_${Date.now()}`,
          eventCode: request.params.code,
          status: "registered",
          ...parsed.data
        }
      };
    }

    const event = await prisma.offlineEvent.findUnique({ where: { code: request.params.code } });
    if (!event) {
      return reply.code(404).send({ error: "event_not_found" });
    }

    const registration = await prisma.offlineEventRegistration.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        userId: context?.userId,
        name: parsed.data.name,
        phone: parsed.data.phone,
        businessName: parsed.data.businessName,
        industry: parsed.data.industry,
        city: parsed.data.city,
        source: parsed.data.source
      }
    });

    return {
      dataMode: "database",
      registration
    };
  });

  app.post<{ Params: { code: string } }>("/offline-events/:code/check-in", async (request, reply) => {
    const parsed = registrationSchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers).catch(() => null);
    if (env.DATA_MODE === "demo") {
      return { dataMode: "demo", checkedIn: true };
    }

    const event = await prisma.offlineEvent.findUnique({ where: { code: request.params.code } });
    if (!event) return reply.code(404).send({ error: "event_not_found" });

    const registration = await findOrCreateRegistration(event, {
      userId: context?.userId,
      ...parsed.data
    });

    const checkedIn = await prisma.offlineEventRegistration.update({
      where: { id: registration.id },
      data: {
        status: "checked_in",
        checkedInAt: new Date()
      }
    });

    return {
      dataMode: "database",
      registration: checkedIn
    };
  });

  app.post<{ Params: { code: string } }>("/offline-events/:code/diagnosis-completed", async (request, reply) => {
    const parsed = diagnosisCompletedSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers).catch(() => null);
    if (env.DATA_MODE === "demo") {
      return { dataMode: "demo", diagnosisCompleted: true };
    }

    const event = await prisma.offlineEvent.findUnique({ where: { code: request.params.code } });
    if (!event) return reply.code(404).send({ error: "event_not_found" });

    const registration = parsed.data.registrationId
      ? await prisma.offlineEventRegistration.findFirst({
          where: {
            id: parsed.data.registrationId,
            eventId: event.id
          }
        })
      : await findOrCreateRegistration(event, {
          userId: context?.userId,
          phone: parsed.data.phone
        });

    if (!registration) return reply.code(404).send({ error: "registration_not_found" });

    const updated = await prisma.offlineEventRegistration.update({
      where: { id: registration.id },
      data: {
        status: "diagnosis_completed",
        diagnosisConversationId: parsed.data.conversationId,
        diagnosisReportJson: parsed.data.report as Prisma.InputJsonValue | undefined,
        diagnosisCompletedAt: new Date()
      }
    });

    return {
      dataMode: "database",
      registration: updated
    };
  });

  app.get<{ Params: { channelCode: string } }>("/offline-events/channel/:channelCode/summary", async (request, reply) => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        channel: { code: request.params.channelCode, name: "演示渠道" },
        events: []
      };
    }

    const channel = await prisma.distributor.findUnique({
      where: { code: request.params.channelCode }
    });
    if (!channel) return reply.code(404).send({ error: "channel_not_found" });

    const events = await prisma.offlineEvent.findMany({
      where: { channelId: channel.id },
      orderBy: { startsAt: "desc" },
      take: 30,
      include: {
        registrations: true,
        billingOrders: true,
        cohorts: {
          include: {
            _count: {
              select: { projects: true }
            }
          }
        }
      }
    });

    return {
      dataMode: "database",
      channel: {
        id: channel.id,
        name: channel.name,
        code: channel.code,
        totalEarnings: Number(channel.totalEarnings),
        frozenAmount: Number(channel.frozenAmount),
        availableAmount: Number(channel.availableAmount)
      },
      events: events.map((event: any) => {
        const paidOrders = event.billingOrders.filter((order: any) => order.status === "paid");
        const paidAmountCny = paidOrders.reduce((sum: number, order: any) => sum + order.amountCny, 0);
        const commissionRate = Number(event.commissionRate);
        return {
          id: event.id,
          code: event.code,
          title: event.title,
          topic: event.topic,
          startsAt: event.startsAt.toISOString(),
          registered: event.registrations.length,
          checkedIn: event.registrations.filter((item: any) => item.status === "checked_in").length,
          diagnosisCompleted: event.registrations.filter((item: any) => item.status === "diagnosis_completed").length,
          purchased: event.registrations.filter((item: any) => item.status === "purchased").length,
          paidOrders: paidOrders.length,
          paidAmountCny,
          estimatedCommissionCny: Math.round(paidAmountCny * commissionRate),
          cohorts: event.cohorts.map((cohort: any) => ({
            id: cohort.id,
            name: cohort.name,
            packageCode: cohort.packageCode,
            status: cohort.status,
            projectCount: cohort._count.projects
          })),
          entryUrl: buildEventEntryUrl(event.code, request),
          qrSvgUrl: buildApiUrl(`/offline-events/${event.code}/qr.svg`, request)
        };
      })
    };
  });
}

function buildEventEntryUrl(code: string, request: FastifyRequest): string {
  return `${buildOrigin(request)}/diagnosis?event=${encodeURIComponent(code)}`;
}

function buildApiUrl(path: string, request: FastifyRequest): string {
  const configuredBase = process.env.VITE_API_BASE_URL?.replace(/\/$/, "");
  return configuredBase ? `${configuredBase}${path}` : `${buildOrigin(request)}/os-v2/api${path}`;
}

function buildOrigin(request: FastifyRequest): string {
  const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost:3010").split(",")[0];
  return `${proto}://${host}`;
}

function serializeEvent(event: any, request: FastifyRequest) {
  return {
    id: event.id,
    code: event.code,
    title: event.title,
    topic: event.topic,
    city: event.city,
    venue: event.venue,
    startsAt: event.startsAt instanceof Date ? event.startsAt.toISOString() : event.startsAt,
    endsAt: event.endsAt instanceof Date ? event.endsAt.toISOString() : event.endsAt,
    targetAttendees: event.targetAttendees,
    minAttendees: event.minAttendees,
    commissionRate: Number(event.commissionRate),
    status: event.status,
    channel: event.channel ?? null,
    products: {
      express: PROJECT_PACKAGES.ai_health_express,
      main: PROJECT_PACKAGES.local_growth_30,
      premium: PROJECT_PACKAGES.local_growth_90
    },
    counts: event._count ?? undefined,
    entryUrl: buildEventEntryUrl(event.code, request),
    qrSvgUrl: buildApiUrl(`/offline-events/${event.code}/qr.svg`, request)
  };
}

function buildDemoEvent(code: string, request: FastifyRequest) {
  return serializeEvent(
    {
      id: "demo_event",
      code,
      title: "本地商家AI增长公开课",
      topic: "本地商家如何用AI把获客、内容和成交跑起来",
      city: "杭州",
      venue: "线下会场",
      startsAt: new Date().toISOString(),
      endsAt: null,
      targetAttendees: 30,
      minAttendees: 15,
      commissionRate: 0.2,
      status: "planned",
      channel: { name: "演示渠道", code: "demo_channel" },
      _count: { registrations: 0, billingOrders: 0 }
    },
    request
  );
}

async function findOrCreateRegistration(
  event: { id: string; tenantId: string },
  input: {
    userId?: string;
    phone?: string;
    name?: string;
    businessName?: string;
    industry?: string;
    city?: string;
  }
) {
  const existing = await prisma.offlineEventRegistration.findFirst({
    where: {
      eventId: event.id,
      OR: [
        input.userId ? { userId: input.userId } : undefined,
        input.phone ? { phone: input.phone } : undefined
      ].filter(Boolean) as any
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  if (existing) return existing;

  return prisma.offlineEventRegistration.create({
    data: {
      tenantId: event.tenantId,
      eventId: event.id,
      userId: input.userId,
      phone: input.phone,
      name: input.name,
      businessName: input.businessName,
      industry: input.industry,
      city: input.city
    }
  });
}
