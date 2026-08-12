import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db"
import { runAgent, type LlmProvider } from "@baolu/agent";
import { domesticNetworkOnly, domesticOutboundAllowlist, env } from "../config/env.js";
import { toAgentRequest } from "../services/demo-context.js";
import { InsufficientCreditsError, persistChatResult } from "../services/chat-persistence.js";
import { assertOutboundUrlAllowed } from "../services/outbound-policy.js";
import { toPrismaJson } from "../services/prisma-json.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";

const createAudioCardSchema = z.object({
  source: z.enum(["manual", "api", "upload", "pull"]).default("manual"),
  staffName: z.string().optional(),
  storeName: z.string().optional(),
  workDate: z.string().optional(),
  transcript: z.string().min(1),
  summary: z.string().optional(),
  metrics: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({})
});

const createAudioCardBindingSchema = z.object({
  provider: z.string().min(1).max(60).default("recording_card"),
  label: z.string().min(1).max(80).default("默认录音卡"),
  description: z.string().max(200).optional(),
  mode: z.enum(["pull"]).default("pull"),
  pullConfig: z
    .object({
      endpoint: z.string().url().optional(),
      method: z.enum(["GET", "POST"]).default("GET"),
      authType: z.enum(["none", "bearer", "header", "query", "api_key"]).default("none"),
      authToken: z.string().optional(),
      authHeaderName: z.string().max(80).optional(),
      authQueryName: z.string().max(80).optional(),
      headers: z.record(z.string()).default({}),
      body: z.record(z.unknown()).optional(),
      itemsPath: z.string().optional(),
      transcriptPath: z.string().optional(),
      summaryPath: z.string().optional(),
      staffNamePath: z.string().optional(),
      storeNamePath: z.string().optional(),
      workDatePath: z.string().optional(),
      metricsPath: z.string().optional()
    })
    .optional()
});

type AudioCardPayload = z.infer<typeof createAudioCardSchema>;
type AudioCardBindingInput = z.infer<typeof createAudioCardBindingSchema>;

interface AudioCardBindingPayload extends AudioCardBindingInput {
  kind: "audio_card_binding";
  bindingId: string;
  tokenHash: string;
  tenantId: string;
  userId: string;
  role: RequestContext["role"];
  planCode: RequestContext["planCode"];
  profile: RequestContext["profile"];
  createdAt: string;
}

interface DemoAudioCard {
  id: string;
  tenantId: string;
  userId: string;
  status: "created" | "analyzed";
  payload: AudioCardPayload;
  analysis?: {
    answer: string;
    skillId: string;
    creditCost: number;
  };
  createdAt: string;
  updatedAt: string;
}

const demoAudioCards = new Map<string, DemoAudioCard>();
const demoAudioCardBindings = new Map<string, AudioCardBindingPayload>();

export async function registerAudioCardRoutes(
  app: FastifyInstance,
  provider: LlmProvider
): Promise<void> {
  app.get("/audio-card-bindings", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const bindings =
      env.DATA_MODE === "demo"
        ? [...demoAudioCardBindings.values()].filter((binding) => binding.tenantId === context.tenantId)
        : await listDatabaseBindings(context.tenantId);

    return {
      dataMode: context.source,
      bindings: bindings.map((binding) => publicBinding(binding, request.headers))
    };
  });

  app.post("/audio-card-bindings", async (request, reply) => {
    const parsed = createAudioCardBindingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const bindingId = `acb_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    const webhookToken = randomBytes(24).toString("hex");
    if (!parsed.data.pullConfig) {
      return reply.code(400).send({
        error: "missing_pull_config",
        message: "pull 模式必须提供 pullConfig"
      });
    }
    const pullConfig = normalizeAudioCardPullConfig(parsed.data.provider, parsed.data.pullConfig);
    if (pullConfig.endpoint) {
      assertAudioCardPullEndpointAllowed(pullConfig.endpoint);
    }
    const payload: AudioCardBindingPayload = {
      kind: "audio_card_binding",
      bindingId,
      tokenHash: hashToken(webhookToken),
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      planCode: context.planCode,
      profile: context.profile,
      provider: parsed.data.provider,
      label: parsed.data.label,
      description: parsed.data.description,
      mode: parsed.data.mode,
      pullConfig,
      createdAt: new Date().toISOString()
    };

    if (env.DATA_MODE === "demo") {
      demoAudioCardBindings.set(bindingId, payload);
    } else {
      await prisma.automationTask.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          type: "audio_card_analysis",
          payload: toPrismaJson(payload),
          runAt: new Date(),
          status: "binding_active",
          logs: {
            create: {
              message: "录音卡绑定已创建",
              metadata: toPrismaJson({
                bindingId,
                provider: parsed.data.provider,
                label: parsed.data.label
              })
            }
          }
        }
      });
    }

    return {
      dataMode: context.source,
      binding: publicBinding(payload, request.headers),
      usage: {
        method: "POST /os-v2/api/audio-card-bindings/:bindingId/pull",
        body: {
          transcript: "录音转写全文，必填",
          staffName: "员工姓名，可选",
          storeName: "门店名称，可选",
          workDate: "2026-06-29，可选",
          summary: "录音摘要，可选",
          metrics: {},
          metadata: {}
        }
      }
    };
  });

  app.post<{ Params: { bindingId: string } }>("/audio-card-bindings/:bindingId/pull", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const binding =
      env.DATA_MODE === "demo"
        ? demoAudioCardBindings.get(request.params.bindingId)
        : await findDatabaseBinding(request.params.bindingId);
    if (!binding || binding.tenantId !== context.tenantId) {
      return reply.code(404).send({ error: "audio_card_binding_not_found" });
    }
    if (binding.mode !== "pull" || !binding.pullConfig) {
      return reply.code(400).send({
        error: "binding_not_pull_mode",
        message: "这个录音卡绑定不是主动抓取模式"
      });
    }

    try {
      const pulledPayloads = await pullAudioCards(binding);
      const results: Array<Record<string, unknown>> = [];
      for (const payload of pulledPayloads.slice(0, 5)) {
        results.push(await createAndAnalyzeAudioCard({ context, payload, binding, provider }));
      }
      return {
        dataMode: context.source,
        bindingId: binding.bindingId,
        pulledCount: pulledPayloads.length,
        analyzedCount: results.length,
        results
      };
    } catch (error) {
      request.log.error(error);
      if (error instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          error: "insufficient_credits",
          message: "积分不足，请充值积分后继续使用"
        });
      }
      if (error instanceof Error && error.message === "audio_card_pull_endpoint_missing") {
        return reply.code(400).send({
          error: "audio_card_pull_endpoint_missing",
          message: "录音卡绑定已保存，但服务器还没有配置该厂商的录音查询 API 地址。请把厂商接口文档或 API 地址发给我们后再拉取。"
        });
      }
      throw error;
    }
  });

  app.post<{ Params: { bindingId: string } }>("/audio-card-webhooks/:bindingId", async (request, reply) => {
    const parsed = createAudioCardSchema.safeParse({
      source: "api",
      ...(request.body ?? {})
    });
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const token = String(readHeader(request.headers, "x-sitong-webhook-token") ?? "");
    if (!token) {
      return reply.code(401).send({
        error: "missing_webhook_token",
        message: "请在 x-Sitong-webhook-token 请求头中传入录音卡绑定 token"
      });
    }

    const binding =
      env.DATA_MODE === "demo"
        ? demoAudioCardBindings.get(request.params.bindingId)
        : await findDatabaseBinding(request.params.bindingId);
    if (!binding) {
      return reply.code(404).send({ error: "audio_card_binding_not_found" });
    }
    if (binding.tokenHash !== hashToken(token)) {
      return reply.code(401).send({ error: "invalid_webhook_token" });
    }

    const context = buildContextFromBinding(binding);
    const payload = {
      ...parsed.data,
      source: "api" as const,
      metadata: {
        ...parsed.data.metadata,
        bindingId: binding.bindingId,
        provider: binding.provider,
        receivedAt: new Date().toISOString()
      }
    };

    const task =
      env.DATA_MODE === "demo"
        ? null
        : await prisma.automationTask.create({
            data: {
              tenantId: binding.tenantId,
              userId: binding.userId,
              type: "audio_card_analysis",
              payload: toPrismaJson(payload),
              runAt: new Date(),
              status: "created",
              logs: {
                create: {
                  message: "录音卡 webhook 已接收，开始自动分析",
                  metadata: toPrismaJson({
                    bindingId: binding.bindingId,
                    provider: binding.provider,
                    staffName: payload.staffName,
                    storeName: payload.storeName
                  })
                }
              }
            }
          });

    try {
      const input = buildAudioCardAgentInput(payload);
      const result = await runAgent(
        toAgentRequest({
          auth: context,
          input,
          requestedSkillId: "sales_growth_advisor",
          channel: "automation"
        }),
        provider
      );
      const persistence = await persistChatResult({
        context,
        input,
        result,
        provider
      });

      if (task) {
        await prisma.automationTask.update({
          where: { id: task.id },
          data: {
            status: "analyzed",
            payload: toPrismaJson({
              ...payload,
              analysis: {
                skillId: result.skillId,
                skillVersion: result.skillVersion,
                answer: result.answer,
                qualityFlags: result.qualityFlags,
                creditCost: result.creditCost,
                agentRunId: persistence.agentRunId
              }
            }),
            logs: {
              create: {
                message: "录音卡 webhook 自动分析已完成",
                metadata: toPrismaJson({
                  skillId: result.skillId,
                  creditCost: result.creditCost,
                  agentRunId: persistence.agentRunId
                })
              }
            }
          }
        });
      }

      return {
        dataMode: context.source,
        audioCardId: task?.id,
        ...persistence,
        ...result
      };
    } catch (error) {
      request.log.error(error);
      if (task) {
        await prisma.automationTask.update({
          where: { id: task.id },
          data: {
            status: "failed",
            logs: {
              create: {
                level: "error",
                message: "录音卡 webhook 自动分析失败",
                metadata: toPrismaJson({
                  error: error instanceof Error ? error.message : "unknown_error"
                })
              }
            }
          }
        });
      }
      if (error instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          error: "insufficient_credits",
          message: "积分不足，请充值积分后继续使用"
        });
      }
      throw error;
    }
  });

  app.post("/audio-cards", async (request, reply) => {
    const parsed = createAudioCardSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const now = new Date().toISOString();
      const card: DemoAudioCard = {
        id: randomUUID(),
        tenantId: context.tenantId,
        userId: context.userId,
        status: "created",
        payload: parsed.data,
        createdAt: now,
        updatedAt: now
      };
      demoAudioCards.set(card.id, card);
      return {
        dataMode: "demo",
        audioCard: card
      };
    }

    const task = await prisma.automationTask.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        type: "audio_card_analysis",
        payload: toPrismaJson(parsed.data),
        runAt: new Date(),
        status: "created",
        logs: {
          create: {
            message: "录音卡已接收，等待分析",
            metadata: toPrismaJson({
              source: parsed.data.source,
              staffName: parsed.data.staffName,
              storeName: parsed.data.storeName
            })
          }
        }
      },
      include: {
        logs: true
      }
    });

    return {
      dataMode: "database",
      audioCard: task
    };
  });

  app.post<{ Params: { id: string } }>("/audio-cards/:id/analyze", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    try {
      const card =
        env.DATA_MODE === "demo"
          ? getDemoAudioCard(request.params.id, context.tenantId)
          : await getDatabaseAudioCard(request.params.id, context.tenantId);

      if (!card) {
        return reply.code(404).send({
          error: "audio_card_not_found"
        });
      }

      const input = buildAudioCardAgentInput(card.payload);
      const result = await runAgent(
        toAgentRequest({
          auth: context,
          input,
          requestedSkillId: "sales_growth_advisor",
          channel: "automation"
        }),
        provider
      );
      const persistence = await persistChatResult({
        context,
        input,
        result,
        provider
      });

      if (env.DATA_MODE === "demo") {
        const demoCard = demoAudioCards.get(request.params.id);
        if (demoCard) {
          demoCard.status = "analyzed";
          demoCard.analysis = {
            answer: result.answer,
            skillId: result.skillId,
            creditCost: result.creditCost
          };
          demoCard.updatedAt = new Date().toISOString();
        }
      } else {
        await prisma.automationTask.update({
          where: {
            id: request.params.id
          },
          data: {
            status: "analyzed",
            payload: toPrismaJson({
              ...card.payload,
              analysis: {
                skillId: result.skillId,
                skillVersion: result.skillVersion,
                answer: result.answer,
                qualityFlags: result.qualityFlags,
                creditCost: result.creditCost,
                agentRunId: persistence.agentRunId
              }
            }),
            logs: {
              create: {
                message: "录音卡分析已完成",
                metadata: toPrismaJson({
                  skillId: result.skillId,
                  creditCost: result.creditCost,
                  agentRunId: persistence.agentRunId
                })
              }
            }
          }
        });
      }

      return {
        dataMode: context.source,
        audioCardId: request.params.id,
        ...persistence,
        ...result
      };
    } catch (error) {
      request.log.error(error);
      if (error instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          error: "insufficient_credits",
          message: "积分不足，请充值积分后继续使用"
        });
      }
      throw error;
    }
  });
}

async function listDatabaseBindings(tenantId: string): Promise<AudioCardBindingPayload[]> {
  const tasks = await prisma.automationTask.findMany({
    where: {
      tenantId,
      type: "audio_card_analysis",
      status: "binding_active"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 100
  });
  return tasks.map((task: any) => parseBindingPayload(task.payload)).filter((binding: any): binding is AudioCardBindingPayload => Boolean(binding));
}

async function findDatabaseBinding(bindingId: string): Promise<AudioCardBindingPayload | null> {
  const tasks = await prisma.automationTask.findMany({
    where: {
      type: "audio_card_analysis",
      status: "binding_active"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 500
  });
  return (
    tasks
      .map((task: any) => parseBindingPayload(task.payload))
      .find((binding: any) => binding?.bindingId === bindingId) ?? null
  );
}

function parseBindingPayload(payload: unknown): AudioCardBindingPayload | null {
  const candidate = parseJsonRecord(payload) as Partial<AudioCardBindingPayload> | null;
  if (!candidate) return null;
  if (
    candidate.kind !== "audio_card_binding" ||
    typeof candidate.bindingId !== "string" ||
    typeof candidate.tokenHash !== "string" ||
    typeof candidate.tenantId !== "string" ||
    typeof candidate.userId !== "string" ||
    !candidate.profile
  ) {
    return null;
  }
  return candidate as AudioCardBindingPayload;
}

function buildContextFromBinding(binding: AudioCardBindingPayload): RequestContext {
  return {
    tenantId: binding.tenantId,
    userId: binding.userId,
    role: binding.role,
    planCode: binding.planCode,
    source: env.DATA_MODE === "demo" ? "demo" : "database",
    profile: binding.profile
  };
}

async function createAndAnalyzeAudioCard({
  context,
  payload,
  binding,
  provider
}: {
  context: RequestContext;
  payload: AudioCardPayload;
  binding?: AudioCardBindingPayload;
  provider: LlmProvider;
}): Promise<Record<string, unknown>> {
  const enrichedPayload: AudioCardPayload = {
    ...payload,
    metadata: {
      ...payload.metadata,
      bindingId: binding?.bindingId,
      provider: binding?.provider ?? payload.metadata.provider,
      receivedAt: new Date().toISOString()
    }
  };

  const task =
    env.DATA_MODE === "demo"
      ? null
      : await prisma.automationTask.create({
          data: {
            tenantId: context.tenantId,
            userId: context.userId,
            type: "audio_card_analysis",
            payload: toPrismaJson(enrichedPayload),
            runAt: new Date(),
            status: "created",
            logs: {
              create: {
                message: "录音卡已接收，开始自动生成经营建议",
                metadata: toPrismaJson({
                  bindingId: binding?.bindingId ?? "",
                  provider: binding?.provider ?? toOptionalString(enrichedPayload.metadata.provider) ?? "unknown",
                  staffName: enrichedPayload.staffName,
                  storeName: enrichedPayload.storeName,
                  source: enrichedPayload.source
                })
              }
            }
          }
        });

  try {
    const input = buildAudioCardAgentInput(enrichedPayload);
    const result = await runAgent(
      toAgentRequest({
        auth: context,
        input,
        requestedSkillId: "sales_growth_advisor",
        channel: "automation"
      }),
      provider
    );
    const persistence = await persistChatResult({
      context,
      input,
      result,
      provider
    });

    if (task) {
      await prisma.automationTask.update({
        where: { id: task.id },
        data: {
          status: "analyzed",
          payload: toPrismaJson({
            ...enrichedPayload,
            analysis: {
              skillId: result.skillId,
              skillVersion: result.skillVersion,
              answer: result.answer,
              qualityFlags: result.qualityFlags,
              creditCost: result.creditCost,
              agentRunId: persistence.agentRunId
            }
          }),
          logs: {
            create: {
              message: "录音卡经营建议已生成",
              metadata: toPrismaJson({
                skillId: result.skillId,
                creditCost: result.creditCost,
                agentRunId: persistence.agentRunId
              })
            }
          }
        }
      });
    }

    return {
      audioCardId: task?.id,
      ...persistence,
      ...result
    };
  } catch (error) {
    if (task) {
      await prisma.automationTask.update({
        where: { id: task.id },
        data: {
          status: "failed",
          logs: {
            create: {
              level: "error",
              message: "录音卡经营建议生成失败",
              metadata: toPrismaJson({
                error: error instanceof Error ? error.message : "unknown_error"
              })
            }
          }
        }
      });
    }
    throw error;
  }
}

async function pullAudioCards(binding: AudioCardBindingPayload): Promise<AudioCardPayload[]> {
  if (!binding.pullConfig) return [];
  if (!binding.pullConfig.endpoint) {
    throw new Error("audio_card_pull_endpoint_missing");
  }
  assertAudioCardPullEndpointAllowed(binding.pullConfig.endpoint);

  const url = new URL(binding.pullConfig.endpoint);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...binding.pullConfig.headers
  };
  const init: RequestInit = {
    method: binding.pullConfig.method,
    headers
  };

  if (binding.pullConfig.authType === "bearer" && binding.pullConfig.authToken) {
    headers.authorization = `Bearer ${binding.pullConfig.authToken}`;
  }
  if (binding.pullConfig.authType === "api_key" && binding.pullConfig.authToken) {
    headers.authorization = `Bearer ${binding.pullConfig.authToken}`;
    headers["x-api-key"] = binding.pullConfig.authToken;
  }
  if (binding.pullConfig.authType === "header" && binding.pullConfig.authHeaderName && binding.pullConfig.authToken) {
    headers[binding.pullConfig.authHeaderName] = binding.pullConfig.authToken;
  }
  if (binding.pullConfig.authType === "query" && binding.pullConfig.authQueryName && binding.pullConfig.authToken) {
    url.searchParams.set(binding.pullConfig.authQueryName, binding.pullConfig.authToken);
  }
  if (binding.pullConfig.method === "POST") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(binding.pullConfig.body ?? {});
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`audio_card_pull_failed_${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const items = normalizePulledItems(json, binding.pullConfig.itemsPath);
  return items
    .map((item) => mapPulledAudioCard(item, binding))
    .filter((payload): payload is AudioCardPayload => Boolean(payload));
}

function mapPulledAudioCard(item: unknown, binding: AudioCardBindingPayload): AudioCardPayload | null {
  if (!binding.pullConfig) return null;
  const transcript = firstTextValue(item, [
    binding.pullConfig.transcriptPath,
    "transcript",
    "text",
    "content",
    "recordText",
    "record_text",
    "asrText",
    "asr_text",
    "recognizedText",
    "recognized_text",
    "conversation",
    "dialogue",
    "summary.text"
  ]);
  if (!transcript) return null;

  const parsed = createAudioCardSchema.safeParse({
    source: "pull",
    transcript,
    summary: firstTextValue(item, [binding.pullConfig.summaryPath, "summary", "abstract", "digest"]),
    staffName: firstTextValue(item, [binding.pullConfig.staffNamePath, "staffName", "staff", "employeeName", "userName", "ownerName"]),
    storeName: firstTextValue(item, [binding.pullConfig.storeNamePath, "storeName", "shopName", "merchantName", "brandName"]),
    workDate: firstTextValue(item, [binding.pullConfig.workDatePath, "workDate", "date", "createdAt", "startTime", "recordTime"]),
    metrics: toRecord(
      binding.pullConfig.metricsPath ? getPathValue(item, binding.pullConfig.metricsPath) : undefined
    ),
    metadata: {
      provider: binding.provider,
      label: binding.label,
      raw: item
    }
  });
  return parsed.success ? parsed.data : null;
}

function normalizePulledItems(json: unknown, configuredPath?: string): unknown[] {
  if (configuredPath) {
    const configured = getPathValue(json, configuredPath);
    return Array.isArray(configured) ? configured : [configured];
  }

  if (Array.isArray(json)) return json;
  const commonPaths = [
    "data.list",
    "data.records",
    "data.items",
    "data",
    "list",
    "records",
    "items",
    "result.list",
    "result.records",
    "result.items",
    "result"
  ];
  for (const path of commonPaths) {
    const value = getPathValue(json, path);
    if (Array.isArray(value)) return value;
  }
  return [json];
}

function firstTextValue(source: unknown, paths: Array<string | undefined>): string | undefined {
  if (typeof source === "string") return source.trim() || undefined;
  for (const path of paths) {
    if (!path) continue;
    const value = toOptionalString(getPathValue(source, path));
    if (value) return value;
  }
  return findDeepTextValue(source, new Set(["transcript", "text", "content", "recordText", "asrText", "recognizedText"]));
}

function findDeepTextValue(source: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (!source || depth > 4) return undefined;
  if (Array.isArray(source)) {
    for (const item of source) {
      const value = findDeepTextValue(item, keys, depth + 1);
      if (value) return value;
    }
    return undefined;
  }
  if (typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      const text = toOptionalString(value);
      if (text) return text;
    }
  }
  for (const value of Object.values(record)) {
    const text = findDeepTextValue(value, keys, depth + 1);
    if (text) return text;
  }
  return undefined;
}

function getPathValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeAudioCardPullConfig(
  provider: string,
  pullConfig: NonNullable<AudioCardBindingInput["pullConfig"]>
): NonNullable<AudioCardBindingInput["pullConfig"]> {
  const providerKey = provider.trim().toLowerCase();
  if (!pullConfig.endpoint && ["dedao_brain", "dedao", "getgetai", "dedao_recorder"].includes(providerKey)) {
    return {
      ...pullConfig,
      endpoint: env.DEDAO_BRAIN_RECORDS_URL
    };
  }
  return pullConfig;
}

function assertAudioCardPullEndpointAllowed(endpoint: string): void {
  assertOutboundUrlAllowed("Audio card pull API", endpoint, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
}

function publicBinding(binding: AudioCardBindingPayload, headers: Record<string, unknown>) {
  const path = `/os-v2/api/audio-card-webhooks/${binding.bindingId}`;
  const pullPath = `/os-v2/api/audio-card-bindings/${binding.bindingId}/pull`;
  return {
    bindingId: binding.bindingId,
    provider: binding.provider,
    label: binding.label,
    description: binding.description,
    mode: binding.mode,
    createdAt: binding.createdAt,
    pullReady: Boolean(binding.pullConfig?.endpoint),
    webhookPath: path,
    webhookUrl: `${getRequestOrigin(headers)}${path}`,
    pullPath,
    pullUrl: `${getRequestOrigin(headers)}${pullPath}`,
    tokenHeader: "x-Sitong-webhook-token"
  };
}

function getRequestOrigin(headers: Record<string, unknown>): string {
  const proto = String(headers["x-forwarded-proto"] ?? "https").split(",")[0].trim() || "https";
  const host = String(headers["x-forwarded-host"] ?? headers.host ?? "api.lcppch.top").split(",")[0].trim();
  return `${proto}://${host}`;
}

function readHeader(headers: Record<string, unknown>, name: string): unknown {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getDemoAudioCard(id: string, tenantId: string): { payload: AudioCardPayload } | null {
  const card = demoAudioCards.get(id);
  if (!card || card.tenantId !== tenantId) return null;
  return {
    payload: card.payload
  };
}

async function getDatabaseAudioCard(
  id: string,
  tenantId: string
): Promise<{ payload: AudioCardPayload } | null> {
  const task = await prisma.automationTask.findFirst({
    where: {
      id,
      tenantId,
      type: "audio_card_analysis"
    }
  });
  if (!task) return null;

  const parsed = createAudioCardSchema.safeParse(parseJsonRecord(task.payload) ?? task.payload);
  if (!parsed.success) {
    throw new Error("audio_card_payload_invalid");
  }
  return {
    payload: parsed.data
  };
}

function buildAudioCardAgentInput(payload: AudioCardPayload): string {
  const header = [
    "请根据下面的录音卡/工作记录，输出一份给老板看的、可执行的经营增长建议。",
    payload.workDate ? `工作日期：${payload.workDate}` : null,
    payload.storeName ? `门店/区域：${payload.storeName}` : null,
    payload.staffName ? `提交人：${payload.staffName}` : null,
    payload.summary ? `提交摘要：${payload.summary}` : null
  ].filter(Boolean);

  return `${header.join("\n")}

录音卡文字记录：
${payload.transcript}

请按以下结构输出：
1. 老板先看：先肯定有证据的亮点，再概括最关键的问题
2. 优势放大：提炼录音中做得好的沟通或经营动作；每项写亮点证据、有效原因、复制/强化/团队推广方案和验证指标
3. 问题优化：指出销售、获客、交付、管理等短板；每项写问题证据、影响和改进动作
4. 明天最该做的三件事
5. 拓客与销售跟进建议
6. 管理/交付提醒
7. 需要老板追问员工补充的信息

建议的数量与篇幅默认按“约一半问题优化 + 约一半优势放大”分配。禁止只挑毛病，也禁止用空泛表扬凑数；如果录音中没有足够正向证据，明确说明证据不足，不得编造亮点。`;
}
