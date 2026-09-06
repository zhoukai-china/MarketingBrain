import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { env } from "../config/env.js";
import { assertAgentAccess, listRuntimeAgents, type RuntimeAgent } from "../services/agent-runtime.js";
import { classifyGetNoteFailure, pullGetNoteTranscripts, testGetNoteConnection, type GetNoteCredentials } from "../services/getnote-connector.js";
import { decryptKnowledgeCredentials, encryptKnowledgeCredentials } from "../services/knowledge-credentials.js";
import { platformSyncErrorMessage, pullFeishuKnowledge, pullWecomKnowledge, verifyFeishuKnowledgeAccess, type PlatformKnowledgeSyncResult } from "../services/platform-knowledge-connectors.js";
import { crawlPublicIndustryKnowledge } from "../services/trend-intelligence.js";
import { buildIpVoiceStyleContext } from "../services/ip-voice-style.js";
import {
  buildKnowledgeSubjectContext,
  buildPlatformIndustryContext,
  defaultKnowledgeLayer,
  listPlatformIndustryPacks,
  subjectTypeLabel,
  type KnowledgeSubjectSummary
} from "../services/knowledge-taxonomy.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { storeMultipartFile, summarizeStoredFile } from "../services/file-storage.js";

const connectSchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
  clientId: z.string().trim().min(3).max(300).optional(),
  label: z.string().trim().min(1).max(80).default("得到大脑")
});

const analysisSchema = z.object({
  documentIds: z.array(z.string().min(1)).max(100).default([]),
  subjectId: z.string().min(1).max(120).optional(),
  agentIds: z.union([z.literal("all"), z.array(z.string().min(1)).min(1).max(8)]),
  instruction: z.string().trim().max(2_000).optional(),
  identityContext: z.string().trim().max(1_000).optional(),
  businessGoal: z.string().trim().max(1_000).optional(),
  factCorrections: z.string().trim().max(1_500).optional()
});

const documentQuerySchema = z.object({
  type: z.enum(["transcript", "note", "web_page", "all"]).default("all"),
  q: z.string().trim().max(120).optional(),
  dateFrom: z.string().trim().max(30).optional(),
  dateTo: z.string().trim().max(30).optional(),
  subjectId: z.string().trim().max(120).optional(),
  layer: z.enum(["raw_private", "confirmed_ip", "brand_asset", "project_private", "enterprise_experience", "enterprise_industry", "all"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const subjectSchema = z.object({
  subjectType: z.enum(["enterprise", "ip", "brand", "client_project"]),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1_000).optional(),
  industry: z.string().trim().max(100).optional(),
  isDefault: z.boolean().optional()
});

const industryResearchSchema = z.object({
  subjectId: z.string().trim().min(1).max(120),
  mode: z.enum(["base", "expanded"]).default("base"),
  keywords: z.array(z.string().trim().min(2).max(80)).max(12).default([])
});

const documentClassificationSchema = z.object({
  subjectIds: z.array(z.string().min(1).max(120)).max(12),
  knowledgeLayer: z.enum(["raw_private", "confirmed_ip", "brand_asset", "project_private", "enterprise_experience", "enterprise_industry"]),
  usagePolicy: z.enum(["auto", "recommend", "manual"]),
  sensitivity: z.enum(["normal", "internal", "sensitive"]),
  confirmed: z.boolean(),
  industry: z.string().trim().max(100).optional()
});

const manualDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(200_000),
  documentType: z.enum(["transcript", "note", "web_page"]).default("note"),
  subjectId: z.string().trim().max(120).optional(),
  occurredAt: z.string().datetime().optional(),
  sourceLabel: z.string().trim().max(80).optional()
});

const externalConnectionSchema = z.object({
  provider: z.enum(["wecom", "feishu"]),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(8).max(500),
  clientId: z.string().trim().max(300).optional(),
  apiBaseUrl: z.string().url().max(500).optional()
});

// Customer-facing connectors use each company's own app credentials.  This is
// deliberately separate from the developer's local Feishu CLI credentials.
const platformConnectionSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("feishu"),
    appId: z.string().trim().regex(/^cli_[A-Za-z0-9_-]+$/, "飞书 App ID 格式不正确").max(128),
    appSecret: z.string().trim().min(8).max(500),
    resourceUrl: z.string().trim().url().max(1_000).optional(),
    label: z.string().trim().min(1).max(80).default("飞书企业资料")
  }),
  z.object({
    provider: z.literal("wecom"),
    corpId: z.string().trim().min(6).max(128),
    agentId: z.string().trim().max(64).optional(),
    corpSecret: z.string().trim().min(8).max(500),
    resourceUrl: z.string().trim().url().max(1_000).optional(),
    label: z.string().trim().min(1).max(80).default("企业微信资料")
  })
]);

type AnalysisContext = Pick<z.infer<typeof analysisSchema>, "instruction" | "identityContext" | "businessGoal" | "factCorrections"> & {
  subject?: KnowledgeSubjectSummary | null;
};

interface DemoConnection {
  id: string;
  tenantId: string;
  ownerUserId: string;
  provider: string;
  ownership: string;
  label: string;
  encryptedCredentials: string;
  status: string;
  capabilities: string[];
  syncCursor?: string;
  lastSyncedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DemoDocument {
  id: string;
  tenantId: string;
  connectionId: string;
  externalId: string;
  documentType: string;
  sourceClass: string;
  knowledgeLayer?: string;
  usagePolicy?: string;
  sensitivity?: string;
  confirmedAt?: Date;
  industry?: string;
  subjectIds?: string[];
  title: string;
  content: string;
  occurredAt?: Date;
  externalUpdatedAt?: Date;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface DemoSubject extends KnowledgeSubjectSummary {
  tenantId: string;
  subjectType: "enterprise" | "ip" | "brand" | "client_project";
  description?: string;
  industry?: string;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DemoSyncJob {
  id: string;
  tenantId: string;
  connectionId: string;
  requestedByUserId?: string;
  subjectId?: string;
  clientRequestId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "interrupted";
  stage: string;
  retryable: boolean;
  scanned: number;
  processed: number;
  total?: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  failedCount: number;
  assignedCount: number;
  listRequests: number;
  detailRequests: number;
  retryCount: number;
  throttleMs: number;
  backoffMs: number;
  phaseDurations?: Record<string, number>;
  importedByType?: Record<string, number>;
  errorCode?: string;
  errorMessage?: string;
  heartbeatAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastSuccessfulAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeContextDocument {
  id: string;
  title: string;
  content: string;
  documentType: string;
  occurredAt?: Date | null;
  knowledgeLayer?: string;
  usagePolicy?: string;
  sensitivity?: string;
  confirmedAt?: Date | null;
  industry?: string | null;
  subjectIds?: string[];
}

const demoConnections = new Map<string, DemoConnection>();
const demoDocuments = new Map<string, DemoDocument>();
const demoSubjects = new Map<string, DemoSubject>();
const demoBatches = new Map<string, Record<string, any>>();
const demoSyncJobs = new Map<string, DemoSyncJob>();
const scheduledSyncJobs = new Set<string>();
let demoStoreLoaded = false;

export async function registerKnowledgeBaseRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  await restoreDemoKnowledgeStore();
  app.get("/knowledge-base/subjects", async (request) => {
    const context = await resolveRequestContext(request.headers);
    await ensureDefaultKnowledgeSubject(context);
    const subjects = await listKnowledgeSubjects(context);
    return { subjects: await Promise.all(subjects.map((subject) => publicSubjectWithCounts(context, subject))) };
});

const connectionSyncSchema = z.object({
  subjectId: z.string().trim().min(1).max(120).optional(),
  clientRequestId: z.string().trim().min(8).max(120).optional(),
  clientStartedAt: z.coerce.number().int().positive().optional()
});

  app.post("/knowledge-base/subjects", async (request, reply) => {
    const parsed = subjectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const now = new Date();
    if (parsed.data.isDefault) await clearDefaultKnowledgeSubject(context);
    if (context.source === "demo") {
      const duplicate = [...demoSubjects.values()].find((item) => item.tenantId === context.tenantId && item.subjectType === parsed.data.subjectType && item.name === parsed.data.name);
      if (duplicate) return reply.code(409).send({ error: "knowledge_subject_exists", message: "同类型下已经有同名主体。" });
      const subject: DemoSubject = {
        id: randomUUID(), tenantId: context.tenantId, subjectType: parsed.data.subjectType, name: parsed.data.name,
        description: parsed.data.description, industry: parsed.data.industry, isDefault: parsed.data.isDefault ?? false,
        status: "active", createdAt: now, updatedAt: now
      };
      demoSubjects.set(subject.id, subject);
      await persistDemoKnowledgeStore();
      return { subject: await publicSubjectWithCounts(context, subject) };
    }
    const subject = await prisma.knowledgeSubject.create({ data: {
      tenantId: context.tenantId,
      subjectType: parsed.data.subjectType,
      name: parsed.data.name,
      description: parsed.data.description,
      industry: parsed.data.industry,
      isDefault: parsed.data.isDefault ?? false
    } });
    return { subject: await publicSubjectWithCounts(context, subject) };
  });

  app.patch<{ Params: { id: string } }>("/knowledge-base/subjects/:id", async (request, reply) => {
    const parsed = subjectSchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const current = await findKnowledgeSubject(context, request.params.id);
    if (!current) return reply.code(404).send({ error: "knowledge_subject_not_found", message: "知识主体不存在。" });
    if (parsed.data.isDefault) await clearDefaultKnowledgeSubject(context);
    if (context.source === "demo") {
      const subject = current as DemoSubject;
      Object.assign(subject, parsed.data, { updatedAt: new Date() });
      demoSubjects.set(subject.id, subject);
      await persistDemoKnowledgeStore();
      return { subject: await publicSubjectWithCounts(context, subject) };
    }
    const subject = await prisma.knowledgeSubject.update({ where: { id: current.id }, data: parsed.data });
    return { subject: await publicSubjectWithCounts(context, subject) };
  });

  app.post("/knowledge-base/industry-research", async (request, reply) => {
    const parsed = industryResearchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const subject = await findKnowledgeSubject(context, parsed.data.subjectId);
    if (!subject) return reply.code(404).send({ error: "knowledge_subject_not_found" });
    const industry = subject.industry?.trim();
    if (!industry) return reply.code(400).send({ error: "industry_required", message: "请先填写当前主体所属行业，再开始公开资料抓取。" });

    requireKnowledgeAdmin(context);
    const result = await importPublicIndustryKnowledge(context, subject, industry, parsed.data);
    return { industry, ...result };
  });

  app.delete<{ Params: { id: string } }>("/knowledge-base/subjects/:id", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const current = await findKnowledgeSubject(context, request.params.id);
    if (!current) return reply.code(404).send({ error: "knowledge_subject_not_found" });
    if (context.source === "demo") {
      demoSubjects.delete(current.id);
      for (const document of demoDocuments.values()) document.subjectIds = (document.subjectIds ?? []).filter((id) => id !== current.id);
      await persistDemoKnowledgeStore();
    } else {
      await prisma.knowledgeSubject.delete({ where: { id: current.id } });
    }
    await ensureDefaultKnowledgeSubject(context);
    return { ok: true };
  });

  app.get<{ Querystring: { subjectId?: string } }>("/knowledge-base/industry-packs", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const subject = request.query?.subjectId ? await findKnowledgeSubject(context, request.query.subjectId) : null;
    if (request.query?.subjectId && !subject) return reply.code(404).send({ error: "knowledge_subject_not_found" });
    const industry = subject?.industry ?? context.profile.industry;
    const supplementCount = await countIndustrySupplements(context, subject?.id);
    return { industry: industry ?? null, platformPacks: listPlatformIndustryPacks(industry), enterpriseSupplementCount: supplementCount };
  });

  app.patch<{ Params: { id: string } }>("/knowledge-base/documents/:id/classification", async (request, reply) => {
    const parsed = documentClassificationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const document = await findKnowledgeDocument(context, request.params.id);
    if (!document) return reply.code(404).send({ error: "knowledge_document_not_found" });
    const subjects = await Promise.all(parsed.data.subjectIds.map((id) => findKnowledgeSubject(context, id)));
    if (subjects.some((subject) => !subject)) return reply.code(400).send({ error: "knowledge_subject_not_found", message: "部分知识主体不存在或不属于当前企业。" });
    const safeUsagePolicy = parsed.data.sensitivity === "sensitive" && parsed.data.usagePolicy === "auto" ? "recommend" : parsed.data.usagePolicy;
    const now = new Date();
    if (context.source === "demo") {
      const record = document as DemoDocument;
      record.subjectIds = parsed.data.subjectIds;
      record.knowledgeLayer = parsed.data.knowledgeLayer;
      record.usagePolicy = safeUsagePolicy;
      record.sensitivity = parsed.data.sensitivity;
      record.confirmedAt = parsed.data.confirmed ? (record.confirmedAt ?? now) : undefined;
      record.industry = parsed.data.industry;
      record.updatedAt = now;
      demoDocuments.set(record.id, record);
      await persistDemoKnowledgeStore();
      return { document: publicDocument(record, subjects.filter(Boolean)) };
    }
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeDocument.update({ where: { id: document.id }, data: {
        knowledgeLayer: parsed.data.knowledgeLayer,
        usagePolicy: safeUsagePolicy,
        sensitivity: parsed.data.sensitivity,
        confirmedAt: parsed.data.confirmed ? (document.confirmedAt ?? now) : null,
        industry: parsed.data.industry
      } });
      await tx.knowledgeDocumentSubject.deleteMany({ where: { documentId: document.id } });
      if (parsed.data.subjectIds.length) await tx.knowledgeDocumentSubject.createMany({ data: parsed.data.subjectIds.map((subjectId) => ({ documentId: document.id, subjectId })) });
    });
    const updated = await prisma.knowledgeDocument.findUnique({ where: { id: document.id }, include: { subjects: { include: { subject: true } } } });
    return { document: publicDocument(updated, updated?.subjects.map((item) => item.subject) ?? []) };
  });

  // Files and free-form notes use a tenant-owned manual source.  The original
  // file is retained by the upload service; only extractable text is promoted
  // into the knowledge base so agents never treat an unread binary as a fact.
  app.post("/knowledge-base/documents/manual", async (request, reply) => {
    const parsed = manualDocumentSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    if (parsed.data.subjectId && !await findKnowledgeSubject(context, parsed.data.subjectId)) {
      return reply.code(400).send({ error: "knowledge_subject_not_found", message: "知识主体不存在或不属于当前企业。" });
    }
    const document = await createManualKnowledgeDocument(context, parsed.data);
    return { document };
  });

  app.post("/knowledge-base/documents/upload", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "file_required", message: "请至少选择一个文件。" });
    const fields = file.fields as Record<string, { value?: unknown }>;
    const subjectId = typeof fields.subjectId?.value === "string" ? fields.subjectId.value : undefined;
    const sourceLabel = typeof fields.sourceLabel?.value === "string" ? fields.sourceLabel.value : "文件上传";
    if (subjectId && !await findKnowledgeSubject(context, subjectId)) {
      return reply.code(400).send({ error: "knowledge_subject_not_found", message: "知识主体不存在或不属于当前企业。" });
    }
    const stored = await storeMultipartFile({ tenantId: context.tenantId, file });
    const content = await summarizeStoredFile({ filename: stored.filename, mimeType: stored.mimeType, storagePath: stored.storagePath });
    if (!isExtractableKnowledgeFile(stored.filename, stored.mimeType)) {
      return reply.code(422).send({
        error: "knowledge_file_not_extractable",
        message: "当前仅可把 TXT、MD、CSV、TSV、JSON、LOG 等可读取文本直接沉淀为知识。PDF、Word、Excel 请先导出为文本或 CSV 后再上传，系统不会把未读取的文件当作知识事实。"
      });
    }
    const document = await createManualKnowledgeDocument(context, {
      title: stored.filename,
      content,
      documentType: "note",
      subjectId,
      sourceLabel
    });
    return { document, upload: { id: stored.id, filename: stored.filename, byteSize: stored.byteSize } };
  });

  // Platform credentials are saved separately from documents. A configured
  // connector stays visibly pending until its OAuth and field mapping exist.
  app.post("/knowledge-base/connections/external", async (request, reply) => {
    const parsed = externalConnectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const now = new Date();
    const credentials = encryptKnowledgeCredentials({ apiKey: parsed.data.apiKey, clientId: parsed.data.clientId, apiBaseUrl: parsed.data.apiBaseUrl });
    if (context.source === "demo") {
      const existing = [...demoConnections.values()].find((item) => item.tenantId === context.tenantId && item.provider === parsed.data.provider);
      const connection: DemoConnection = {
        id: existing?.id ?? randomUUID(), tenantId: context.tenantId, ownerUserId: context.userId,
        provider: parsed.data.provider, ownership: "tenant", label: parsed.data.label, encryptedCredentials: credentials,
        status: "pending_authorization", capabilities: ["api_configuration"], createdAt: existing?.createdAt ?? now, updatedAt: now
      };
      demoConnections.set(connection.id, connection);
      await persistDemoKnowledgeStore();
      return { connection: publicConnection(connection), message: "API 凭证已加密保存。该平台需要完成 OAuth 授权和字段映射后才会开始同步。" };
    }
    const connection = await prisma.knowledgeConnection.upsert({
      where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: parsed.data.provider, ownership: "tenant" } },
      create: { tenantId: context.tenantId, ownerUserId: context.userId, provider: parsed.data.provider, ownership: "tenant", label: parsed.data.label, encryptedCredentials: credentials, status: "pending_authorization", capabilities: ["api_configuration"] },
      update: { ownerUserId: context.userId, label: parsed.data.label, encryptedCredentials: credentials, status: "pending_authorization", lastError: null }
    });
    return { connection: publicConnection(connection), message: "API 凭证已加密保存。该平台需要完成 OAuth 授权和字段映射后才会开始同步。" };
  });

  // Feishu and WeCom are real, tenant-owned platform connections.  We test the
  // credentials before saving them so the UI never reports a fake connection.
  // The application only receives the documents/spaces explicitly granted to
  // it; chat archives are a separate compliance product and are not requested.
  app.post("/knowledge-base/connections/platform", async (request, reply) => {
    const parsed = platformConnectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    let verification: { capabilities: string[]; credentials: Record<string, string | undefined> };
    try {
      verification = await verifyPlatformConnection(parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "platform_connection_failed";
      return reply.code(400).send({
        error: "platform_connection_failed",
        message: parsed.data.provider === "feishu"
          ? `飞书连接校验失败：${platformConnectionErrorMessage(message, "feishu")}`
          : `企业微信连接校验失败：${platformConnectionErrorMessage(message, "wecom")}`
      });
    }
    const now = new Date();
    const encryptedCredentials = encryptKnowledgeCredentials(verification.credentials);
    if (context.source === "demo") {
      const existing = [...demoConnections.values()].find((item) => item.tenantId === context.tenantId && item.provider === parsed.data.provider);
      const connection: DemoConnection = {
        id: existing?.id ?? randomUUID(), tenantId: context.tenantId, ownerUserId: context.userId,
        provider: parsed.data.provider, ownership: "tenant", label: parsed.data.label,
        encryptedCredentials, status: "active", capabilities: verification.capabilities,
        createdAt: existing?.createdAt ?? now, updatedAt: now, lastError: undefined
      };
      demoConnections.set(connection.id, connection);
      await persistDemoKnowledgeStore();
      return { connection: publicConnection(connection), message: "已验证并保存。请选择或授权具体文档、知识空间后再同步，系统不会读取聊天记录。" };
    }
    const connection = await prisma.knowledgeConnection.upsert({
      where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: parsed.data.provider, ownership: "tenant" } },
      create: { tenantId: context.tenantId, ownerUserId: context.userId, provider: parsed.data.provider, ownership: "tenant", label: parsed.data.label, encryptedCredentials, status: "active", capabilities: verification.capabilities },
      update: { ownerUserId: context.userId, label: parsed.data.label, encryptedCredentials, status: "active", capabilities: verification.capabilities, lastError: null }
    });
    return { connection: publicConnection(connection), message: "已验证并保存。请选择或授权具体文档、知识空间后再同步，系统不会读取聊天记录。" };
  });

  app.get("/knowledge-base/connectors", async () => ({
    connectors: [
      {
        provider: "getnote",
        name: "得到大脑",
        status: "available",
        sourceTypes: ["录音转写", "笔记"],
        requiredFields: ["apiKey", "clientId"]
      },
      { provider: "feishu", name: "飞书", status: "available", sourceTypes: ["已授权知识空间", "云文档", "知识库"], requiredFields: ["appId", "appSecret"] },
      { provider: "wecom", name: "企业微信", status: "available", sourceTypes: ["已授权通讯录"], requiredFields: ["corpId", "corpSecret"] },
      { provider: "dingtalk", name: "钉钉", status: "planned", sourceTypes: ["录音转写", "文档"] },
      { provider: "wechat_reading", name: "微信读书", status: "planned", sourceTypes: ["书摘", "笔记"] }
    ]
  }));

  app.get("/knowledge-base/connections", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source === "demo") {
      return { connections: [...demoConnections.values()].filter((item) => item.tenantId === context.tenantId).map(publicConnection) };
    }
    const records = await prisma.knowledgeConnection.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" }
    });
    return { connections: records.map(publicConnection) };
  });

  app.post("/knowledge-base/connections/getnote", async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const existingConnection = context.source === "demo"
      ? [...demoConnections.values()].find((item) => item.tenantId === context.tenantId && item.provider === "getnote")
      : await prisma.knowledgeConnection.findUnique({
          where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: "getnote", ownership: "tenant" } }
        });
    let storedClientId = "";
    if (!parsed.data.clientId && existingConnection) {
      try {
        storedClientId = decryptKnowledgeCredentials<GetNoteCredentials>(existingConnection.encryptedCredentials).clientId;
      } catch {
        return reply.code(400).send({
          error: "getnote_client_id_required",
          message: "已保存的 Client ID 无法读取，请同时重新填写 Client ID 后再连接。"
        });
      }
    }
    const clientId = parsed.data.clientId ?? storedClientId;
    if (!clientId) {
      return reply.code(400).send({
        error: "getnote_client_id_required",
        message: "首次连接得到大脑需要同时填写 API Key 和 Client ID。"
      });
    }
    const credentials: GetNoteCredentials = { apiKey: parsed.data.apiKey, clientId };
    try {
      await testGetNoteConnection(credentials);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "getnote_connection_failed";
      const failureKind = classifyGetNoteFailure(reason);
      if (failureKind === "authorization") {
        return reply.code(400).send({
          error: "getnote_connection_failed",
          message: "得到大脑授权验证失败，请检查 API Key、Client ID 以及 note.content.read 权限。"
        });
      }
      return reply.code(503).send({
        error: "getnote_connection_unavailable",
        message: failureKind === "rate_limit"
          ? "得到大脑当前触发限流，请稍后重试；原来已保存的凭证不会被清除。"
          : "得到大脑服务暂时不可用，请稍后重试；原来已保存的凭证不会被清除。"
      });
    }
    const now = new Date();
    const encryptedCredentials = encryptKnowledgeCredentials(credentials);
    if (context.source === "demo") {
      const existing = existingConnection as DemoConnection | undefined;
      const connection: DemoConnection = {
        id: existing?.id ?? randomUUID(),
        tenantId: context.tenantId,
        ownerUserId: context.userId,
        provider: "getnote",
        ownership: "tenant",
        label: parsed.data.label,
        encryptedCredentials,
        status: "active",
        capabilities: ["note.content.read"],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      demoConnections.set(connection.id, connection);
      await persistDemoKnowledgeStore();
      return { connection: publicConnection(connection) };
    }
    const connection = await prisma.knowledgeConnection.upsert({
      where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: "getnote", ownership: "tenant" } },
      create: {
        tenantId: context.tenantId,
        ownerUserId: context.userId,
        provider: "getnote",
        ownership: "tenant",
        label: parsed.data.label,
        encryptedCredentials,
        capabilities: ["note.content.read"],
        status: "active"
      },
      update: {
        ownerUserId: context.userId,
        label: parsed.data.label,
        encryptedCredentials,
        status: "active",
        lastError: null
      }
    });
    return { connection: publicConnection(connection) };
  });

  app.post<{ Params: { id: string } }>("/knowledge-base/connections/:id/sync", async (request, reply) => {
    const parsed = connectionSyncSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const connection = await findConnection(context, request.params.id);
    if (!connection) return reply.code(404).send({ error: "connection_not_found" });
    const subject = parsed.data.subjectId ? await findKnowledgeSubject(context, parsed.data.subjectId) : await findDefaultKnowledgeSubject(context);
    if (parsed.data.subjectId && !subject) return reply.code(400).send({ error: "knowledge_subject_not_found", message: "当前知识主体不存在或不属于本企业。" });
    if (connection.provider === "getnote") {
      const acceptedAt = Date.now();
      const requestFingerprint = parsed.data.clientRequestId
        ? createHash("sha256").update(parsed.data.clientRequestId).digest("hex").slice(0, 16)
        : undefined;
      const clientToApiMs = parsed.data.clientStartedAt
        ? Math.max(0, Math.min(60_000, acceptedAt - parsed.data.clientStartedAt))
        : undefined;
      const { job, reused } = await createOrReuseKnowledgeSyncJob(context, connection.id, {
        subjectId: subject?.id,
        clientRequestId: requestFingerprint
      });
      scheduleKnowledgeSyncJob(app, context, connection.id, job.id);
      request.log.info({
        event: "knowledge_sync_accepted",
        tenantId: context.tenantId,
        connectionId: connection.id,
        syncJobId: job.id,
        reused,
        requestFingerprint,
        clientToApiMs,
        queueAcceptMs: Date.now() - acceptedAt
      }, "knowledge sync accepted");
      return reply.code(202).send({ sync: publicSyncJob(job), reused });
    }
    try {
      const pulled: PlatformKnowledgeSyncResult & { nextCursor?: string } = connection.provider === "getnote"
        ? await pullGetNoteTranscripts(decryptKnowledgeCredentials<GetNoteCredentials>(connection.encryptedCredentials), { cursor: connection.syncCursor ?? undefined, maxPages: 5 })
        : connection.provider === "feishu"
          ? await pullFeishuKnowledge(decryptKnowledgeCredentials<{ appId: string; appSecret: string; resourceUrl?: string }>(connection.encryptedCredentials))
          : connection.provider === "wecom"
            ? await pullWecomKnowledge(decryptKnowledgeCredentials<{ corpId: string; corpSecret: string; agentId?: string; resourceUrl?: string }>(connection.encryptedCredentials))
            : (() => { throw new Error("unsupported_knowledge_provider"); })();
      let created = 0;
      let updated = 0;
      for (const document of pulled.documents) {
        if (context.source === "demo") {
          const existing = [...demoDocuments.values()].find((item) => item.connectionId === connection.id && item.externalId === document.externalId);
          const now = new Date();
          const record: DemoDocument = {
            id: existing?.id ?? randomUUID(),
            tenantId: context.tenantId,
            connectionId: connection.id,
            externalId: document.externalId,
            documentType: document.documentType,
            sourceClass: "first_party",
            knowledgeLayer: existing?.knowledgeLayer ?? "raw_private",
            usagePolicy: existing?.usagePolicy ?? "recommend",
            sensitivity: existing?.sensitivity ?? "normal",
            confirmedAt: existing?.confirmedAt,
            industry: existing?.industry,
            subjectIds: subject ? Array.from(new Set([...(existing?.subjectIds ?? []), subject.id])) : existing?.subjectIds ?? [],
            title: document.title,
            content: document.content,
            occurredAt: document.occurredAt,
            externalUpdatedAt: document.externalUpdatedAt,
            contentHash: document.contentHash,
            metadata: document.metadata,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
          };
          demoDocuments.set(record.id, record);
          existing ? updated += 1 : created += 1;
        } else {
          const existing = await prisma.knowledgeDocument.findUnique({
            where: { connectionId_externalId: { connectionId: connection.id, externalId: document.externalId } },
            select: { contentHash: true }
          });
          const saved = await prisma.knowledgeDocument.upsert({
            where: { connectionId_externalId: { connectionId: connection.id, externalId: document.externalId } },
            create: { ...document, metadata: document.metadata as any, tenantId: context.tenantId, connectionId: connection.id, sourceClass: "first_party", ...(subject ? { subjects: { create: { subjectId: subject.id } } } : {}) },
            update: { ...document, metadata: document.metadata as any }
          });
          if (subject && existing) {
            await prisma.knowledgeDocumentSubject.upsert({
              where: { documentId_subjectId: { documentId: saved.id, subjectId: subject.id } },
              create: { documentId: saved.id, subjectId: subject.id },
              update: {}
            });
          }
          if (!existing) created += 1;
          else if (existing.contentHash !== document.contentHash) updated += 1;
        }
      }
      // Earlier syncs may have created documents before subject assignment was
      // introduced. Their cursor then advances, so they never reappear in the
      // incremental pull. Backfill only this tenant's selected connection.
      const assignedToSubject = subject
        ? await assignConnectionDocumentsToSubject(context, connection.id, subject.id)
        : 0;
      const syncedAt = new Date();
      if (context.source === "demo") {
        const record = connection as DemoConnection;
        record.syncCursor = pulled.nextCursor;
        record.lastSyncedAt = syncedAt;
        record.lastError = undefined;
        record.updatedAt = syncedAt;
        demoConnections.set(record.id, record);
        await persistDemoKnowledgeStore();
      } else {
        await prisma.knowledgeConnection.update({
          where: { id: connection.id },
          data: { syncCursor: pulled.nextCursor, lastSyncedAt: syncedAt, lastError: null, status: "active" }
        });
      }
      return {
        sync: {
          created,
          updated,
          scanned: pulled.scanned,
          skipped: pulled.skipped,
          failed: pulled.failed,
          assignedToSubject,
          importedByType: pulled.importedByType,
          syncedAt
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync_failed";
      const failureKind = connection.provider === "getnote" ? classifyGetNoteFailure(message) : "unknown";
      const publicMessage = connection.provider === "getnote"
        ? getNoteSyncErrorMessage(message)
        : connection.provider === "feishu" || connection.provider === "wecom"
          ? platformSyncErrorMessage(connection.provider, message)
          : "该知识来源暂不支持同步。";
      const nextStatus = connection.provider === "getnote" && failureKind === "authorization" ? "error" : "active";
      request.log.warn({ connectionId: connection.id, provider: connection.provider, reason: message, failureKind }, "knowledge source sync failed");
      if (context.source === "demo") {
        const record = connection as DemoConnection;
        record.lastError = publicMessage;
        record.status = nextStatus;
        await persistDemoKnowledgeStore();
      } else {
        await prisma.knowledgeConnection.update({ where: { id: connection.id }, data: { lastError: publicMessage, status: nextStatus } });
      }
      return reply.code(502).send({ error: `${connection.provider}_sync_failed`, message: publicMessage, failureKind });
    }
  });

  app.get<{ Params: { id: string } }>("/knowledge-base/connections/:id/sync", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const connection = await findConnection(context, request.params.id);
    if (!connection) return reply.code(404).send({ error: "connection_not_found" });
    const job = await latestKnowledgeSyncJob(context, connection.id);
    if (!job) return reply.code(404).send({ error: "sync_job_not_found", message: "该连接还没有同步任务。" });
    const recovered = await failStaleKnowledgeSyncJob(context, job);
    if (recovered.status === "queued") scheduleKnowledgeSyncJob(app, context, connection.id, recovered.id);
    return { sync: publicSyncJob(recovered) };
  });

  app.get<{ Params: { id: string } }>("/knowledge-base/sync-jobs/:id", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const job = await findKnowledgeSyncJob(context, request.params.id);
    if (!job) return reply.code(404).send({ error: "sync_job_not_found" });
    const recovered = await failStaleKnowledgeSyncJob(context, job);
    if (recovered.status === "queued") scheduleKnowledgeSyncJob(app, context, recovered.connectionId, recovered.id);
    return { sync: publicSyncJob(recovered) };
  });

  app.delete<{ Params: { id: string } }>("/knowledge-base/connections/:id", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    requireKnowledgeAdmin(context);
    const connection = await findConnection(context, request.params.id);
    if (!connection) return reply.code(404).send({ error: "connection_not_found" });
    if (context.source === "demo") {
      demoConnections.delete(connection.id);
      for (const document of demoDocuments.values()) if (document.connectionId === connection.id) demoDocuments.delete(document.id);
      await persistDemoKnowledgeStore();
    } else {
      await prisma.knowledgeConnection.delete({ where: { id: connection.id } });
    }
    return { ok: true };
  });

  app.get<{ Querystring: Record<string, unknown> }>("/knowledge-base/documents", async (request, reply) => {
    const parsed = documentQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const dateFrom = parseKnowledgeDate(parsed.data.dateFrom, false);
    const dateTo = parseKnowledgeDate(parsed.data.dateTo, true);
    if (parsed.data.dateFrom && !dateFrom || parsed.data.dateTo && !dateTo) {
      return reply.code(400).send({ error: "invalid_date_filter", message: "日期筛选格式不正确。" });
    }
    const offset = (parsed.data.page - 1) * parsed.data.limit;
    if (context.source === "demo") {
      const filtered = [...demoDocuments.values()]
        .filter((item) => item.tenantId === context.tenantId)
        .filter((item) => !parsed.data.subjectId || (item.subjectIds ?? []).includes(parsed.data.subjectId))
        .filter((item) => parsed.data.layer === "all" || (item.knowledgeLayer ?? "raw_private") === parsed.data.layer)
        .filter((item) => matchesKnowledgeDocumentType(item, parsed.data.type))
        .filter((item) => !parsed.data.q || `${item.title}\n${item.content}`.toLocaleLowerCase("zh-CN").includes(parsed.data.q.toLocaleLowerCase("zh-CN")))
        .filter((item) => !dateFrom || Boolean(item.occurredAt && item.occurredAt >= dateFrom))
        .filter((item) => !dateTo || Boolean(item.occurredAt && item.occurredAt <= dateTo))
        .sort((a, b) => (b.occurredAt ?? b.updatedAt).getTime() - (a.occurredAt ?? a.updatedAt).getTime());
      return {
        documents: filtered.slice(offset, offset + parsed.data.limit).map((document) => publicDocument(document, (document.subjectIds ?? []).map((id) => demoSubjects.get(id)).filter(Boolean))),
        pagination: { page: parsed.data.page, limit: parsed.data.limit, total: filtered.length, hasMore: offset + parsed.data.limit < filtered.length }
      };
    }
    const filters: Array<Record<string, unknown>> = [];
    if (parsed.data.type === "transcript") {
      filters.push({ OR: [
        { documentType: "transcript" },
        { title: { contains: "录音", mode: "insensitive" as const } },
        { content: { contains: "录音信息", mode: "insensitive" as const } },
        { content: { contains: "录音总结", mode: "insensitive" as const } },
        { content: { contains: "录音转写", mode: "insensitive" as const } },
        { content: { contains: "录音时间", mode: "insensitive" as const } },
        { content: { contains: "录制时间", mode: "insensitive" as const } },
        { content: { contains: "音频时长", mode: "insensitive" as const } },
        { content: { contains: "参与人数", mode: "insensitive" as const } }
      ] });
    } else if (parsed.data.type !== "all") {
      filters.push({ documentType: parsed.data.type });
    }
    if (parsed.data.q) filters.push({ OR: [{ title: { contains: parsed.data.q, mode: "insensitive" as const } }, { content: { contains: parsed.data.q, mode: "insensitive" as const } }] });
    if (parsed.data.subjectId) filters.push({ subjects: { some: { subjectId: parsed.data.subjectId } } });
    if (parsed.data.layer !== "all") filters.push({ knowledgeLayer: parsed.data.layer });
    if (dateFrom || dateTo) filters.push({ occurredAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } });
    const where = { tenantId: context.tenantId, ...(filters.length ? { AND: filters } : {}) };
    const [records, total] = await Promise.all([
      prisma.knowledgeDocument.findMany({ where, include: { subjects: { include: { subject: true } } }, orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }], skip: offset, take: parsed.data.limit }),
      prisma.knowledgeDocument.count({ where })
    ]);
    return { documents: records.map((record) => publicDocument(record, record.subjects.map((item) => item.subject))), pagination: { page: parsed.data.page, limit: parsed.data.limit, total, hasMore: offset + parsed.data.limit < total } };
  });

  app.get("/knowledge-base/agents", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const agents = await accessibleAgents(context);
    return { agents: agents.map((agent) => ({ id: agent.id, slug: agent.slug, name: customerFacingAgentName(agent), description: customerFacingAgentDescription(agent), icon: agent.icon })) };
  });

  app.post("/knowledge-base/analyses", async (request, reply) => {
    const parsed = analysisSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const allAgents = await accessibleAgents(context);
    const selectedAgents = parsed.data.agentIds === "all"
      ? allAgents
      : allAgents.filter((agent) => parsed.data.agentIds.includes(agent.id));
    if (selectedAgents.length === 0) return reply.code(400).send({ error: "no_accessible_agents", message: "请选择至少一个已开通的智能体。" });
    const subject = parsed.data.subjectId ? await findKnowledgeSubject(context, parsed.data.subjectId) : await findDefaultKnowledgeSubject(context);
    if (parsed.data.subjectId && !subject) return reply.code(400).send({ error: "knowledge_subject_not_found", message: "请选择当前企业中的IP、品牌或客户项目。" });
    const explicitDocuments = await loadKnowledgeDocuments(context, parsed.data.documentIds);
    if (explicitDocuments.length !== new Set(parsed.data.documentIds).size) return reply.code(400).send({ error: "knowledge_document_not_found" });
    // 资料夹只负责组织、默认推荐和自动调用范围；同一企业中由用户明确勾选的
    // 资料可以跨资料夹作为本次会诊参考。loadKnowledgeDocuments 已限制 tenantId，
    // 因而不会降低企业之间的数据隔离。
    const automaticDocuments = subject ? await loadAutomaticKnowledgeDocuments(context, subject.id, parsed.data.documentIds, 20 - explicitDocuments.length) : [];
    const documents = [...explicitDocuments, ...automaticDocuments];
    if (documents.length === 0) return reply.code(400).send({ error: "no_knowledge_documents", message: "当前主体还没有已确认自动调用的知识，请先选择资料或完成资料确认。" });
    const plannedCreditCost = selectedAgents.reduce((total, agent) => total + knowledgeAgentCreditCost(agent), 0);
    if (!await hasKnowledgeCredits(context, plannedCreditCost)) {
      return reply.code(402).send({ error: "insufficient_credits", message: "企业积分不足，请充值或减少本次调用的智能体。" });
    }

    const analysisContext: AnalysisContext = {
      instruction: parsed.data.instruction,
      identityContext: parsed.data.identityContext || tenantIdentityContext(context),
      businessGoal: parsed.data.businessGoal,
      factCorrections: parsed.data.factCorrections,
      subject
    };

    const batchId = randomUUID();
    const title = `${new Date().toLocaleDateString("zh-CN")} ${selectedAgents.length > 1 ? "企业经营联合会诊" : `${customerFacingAgentName(selectedAgents[0])}分析`}`;
    const batchBase = {
      id: batchId,
      tenantId: context.tenantId,
      userId: context.userId,
      title,
      instruction: serializeAnalysisContext(analysisContext),
      documentIds: documents.map((document) => document.id),
      agentIds: selectedAgents.map((agent) => agent.id),
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    if (context.source === "demo") {
      demoBatches.set(batchId, { ...batchBase, analyses: [], synthesis: null });
      await persistDemoKnowledgeStore();
    }
    else await prisma.knowledgeAnalysisBatch.create({ data: batchBase });

    const results: Array<Record<string, any>> = await Promise.all(selectedAgents.map(async (agent) => {
      try {
        const knowledgeText = [
          buildKnowledgeSubjectContext(subject),
          buildPlatformIndustryContext(subject?.industry ?? context.profile.industry),
          buildKnowledgeEvidencePack(documents, agent.slug)
        ].filter(Boolean).join("\n\n");
        const output = await provider.complete([
          { role: "system", content: buildKnowledgeAgentSystemPrompt(agent) },
          { role: "user", content: buildAnalysisPrompt(agent, knowledgeText, analysisContext) }
        ]);
        if (!output.trim()) throw new Error("knowledge_analysis_empty");
        return { agentId: agent.id, agentName: customerFacingAgentName(agent), skillId: "knowledge_business_analysis", status: "success", output, creditCost: knowledgeAgentCreditCost(agent) };
      } catch (error) {
        request.log.warn({ batchId, agentId: agent.id, reason: error instanceof Error ? error.message : String(error) }, "knowledge agent analysis failed");
        return { agentId: agent.id, agentName: customerFacingAgentName(agent), skillId: "knowledge_business_analysis", status: "failed", output: null, creditCost: 0, errorMessage: safeAnalysisError(error) };
      }
    }));

    const successful = results.filter((item) => item.status === "success");
    await consumeKnowledgeCredits(context, batchId, successful.map((item) => ({ agentId: String(item.agentId), amount: Number(item.creditCost) || 0 })));
    let synthesis: Record<string, any> | null = null;
    if (successful.length === 1) {
      synthesis = { status: "success", content: successful[0].output, creditCost: 0 };
    } else if (successful.length > 1) {
      try {
        const content = await provider.complete([
          {
            role: "system",
            content: "你是企业经营联合会诊的主报告编辑。综合多个智能体结论，去重、标明共识与分歧、排定行动优先级。只使用输入中有依据的事实，不得虚构。输出中文 Markdown。"
          },
          { role: "user", content: buildSynthesisPrompt(successful, analysisContext) }
        ]);
        if (!content.trim()) throw new Error("knowledge_synthesis_empty");
        synthesis = { status: "success", content, creditCost: 0 };
      } catch (error) {
        request.log.warn({ batchId, reason: error instanceof Error ? error.message : String(error) }, "knowledge synthesis failed");
        synthesis = { status: "failed", content: null, creditCost: 0, errorMessage: safeAnalysisError(error) };
      }
    }

    const finalStatus = successful.length === selectedAgents.length && synthesis?.status === "success" ? "completed" : successful.length > 0 ? "partial" : "failed";
    if (context.source === "demo") {
      demoBatches.set(batchId, { ...batchBase, status: finalStatus, completedAt: new Date(), analyses: results, synthesis });
      await persistDemoKnowledgeStore();
    } else {
      await prisma.$transaction([
        ...results.map((item) => prisma.knowledgeAgentAnalysis.create({ data: {
          batchId,
          agentId: String(item.agentId),
          agentName: String(item.agentName),
          skillId: String(item.skillId),
          status: String(item.status),
          output: typeof item.output === "string" ? item.output : null,
          creditCost: Number(item.creditCost) || 0,
          errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null
        } })),
        ...(synthesis ? [prisma.knowledgeSynthesisReport.create({ data: { batchId, ...synthesis } })] : []),
        prisma.knowledgeAnalysisBatch.update({ where: { id: batchId }, data: { status: finalStatus, completedAt: new Date() } })
      ]);
    }
    const batch = await loadBatch(context, batchId);
    return { batch };
  });

  app.get("/knowledge-base/analyses", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source === "demo") {
      return { batches: [...demoBatches.values()].filter((item) => item.tenantId === context.tenantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) };
    }
    const batches = await prisma.knowledgeAnalysisBatch.findMany({
      where: { tenantId: context.tenantId },
      include: { analyses: true, synthesis: true },
      orderBy: { createdAt: "desc" },
      take: 30
    });
    return { batches };
  });

  app.get<{ Params: { id: string } }>("/knowledge-base/analyses/:id", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const batch = await loadBatch(context, request.params.id);
    return batch ? { batch } : reply.code(404).send({ error: "analysis_not_found" });
  });
}

function requireKnowledgeAdmin(context: RequestContext): void {
  if (context.role !== "owner" && context.role !== "admin") {
    const error = new Error("仅企业所有者或管理员可以管理知识来源") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
}

async function accessibleAgents(context: RequestContext): Promise<RuntimeAgent[]> {
  const agents = (await listRuntimeAgents()).filter((agent) => agent.status === "active");
  if (context.source === "demo") return agents;
  const checked = await Promise.all(agents.map(async (agent) => {
    try { await assertAgentAccess(context, agent); return agent; } catch { return null; }
  }));
  return checked.filter((agent): agent is RuntimeAgent => Boolean(agent));
}

async function ensureDefaultKnowledgeSubject(context: RequestContext): Promise<void> {
  const existing = await listKnowledgeSubjects(context);
  if (existing.length > 0) return;
  const now = new Date();
  if (context.source === "demo") {
    const subject: DemoSubject = {
      id: randomUUID(), tenantId: context.tenantId, subjectType: context.profile.tenantType === "personal_ip" ? "ip" : "enterprise",
      name: context.profile.tenantName || "本企业", description: "系统自动建立的默认知识主体",
      industry: context.profile.industry, isDefault: true, status: "active", createdAt: now, updatedAt: now
    };
    demoSubjects.set(subject.id, subject);
    await persistDemoKnowledgeStore();
    return;
  }
  await prisma.knowledgeSubject.create({ data: {
    tenantId: context.tenantId,
    subjectType: context.profile.tenantType === "personal_ip" ? "ip" : "enterprise",
    name: context.profile.tenantName || "本企业",
    description: "系统自动建立的默认知识主体",
    industry: context.profile.industry,
    isDefault: true
  } });
}

async function listKnowledgeSubjects(context: RequestContext): Promise<any[]> {
  if (context.source === "demo") return [...demoSubjects.values()].filter((item) => item.tenantId === context.tenantId && item.status === "active").sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime());
  return prisma.knowledgeSubject.findMany({ where: { tenantId: context.tenantId, status: "active" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
}

export async function findKnowledgeSubject(context: RequestContext, id: string): Promise<any | null> {
  if (context.source === "demo") return demoSubjects.get(id)?.tenantId === context.tenantId ? demoSubjects.get(id)! : null;
  return prisma.knowledgeSubject.findFirst({ where: { id, tenantId: context.tenantId, status: "active" } });
}

export async function findDefaultKnowledgeSubject(context: RequestContext): Promise<any | null> {
  await ensureDefaultKnowledgeSubject(context);
  const subjects = await listKnowledgeSubjects(context);
  return subjects.find((item) => item.isDefault) ?? (subjects.length === 1 ? subjects[0] : null);
}

export async function resolveKnowledgeSubjectForRun(context: RequestContext, subjectId: string | undefined, input: string): Promise<any | null> {
  await ensureDefaultKnowledgeSubject(context);
  if (subjectId) return findKnowledgeSubject(context, subjectId);
  const subjects = await listKnowledgeSubjects(context);
  const normalized = input.replace(/\s+/g, "");
  const mentioned = subjects.filter((subject) => normalized.includes(String(subject.name).replace(/\s+/g, "")));
  if (mentioned.length === 1) return mentioned[0];
  return subjects.find((item) => item.isDefault) ?? (subjects.length === 1 ? subjects[0] : null);
}

async function clearDefaultKnowledgeSubject(context: RequestContext): Promise<void> {
  if (context.source === "demo") {
    for (const subject of demoSubjects.values()) if (subject.tenantId === context.tenantId) subject.isDefault = false;
    return;
  }
  await prisma.knowledgeSubject.updateMany({ where: { tenantId: context.tenantId, isDefault: true }, data: { isDefault: false } });
}

async function publicSubjectWithCounts(context: RequestContext, subject: any): Promise<Record<string, unknown>> {
  let documentCount = 0;
  let autoDocumentCount = 0;
  let recommendedDocumentCount = 0;
  if (context.source === "demo") {
    const documents = [...demoDocuments.values()].filter((item) => item.tenantId === context.tenantId && (item.subjectIds ?? []).includes(subject.id));
    documentCount = documents.length;
    autoDocumentCount = documents.filter((item) => item.usagePolicy === "auto" && Boolean(item.confirmedAt) && item.sensitivity !== "sensitive").length;
    recommendedDocumentCount = documents.filter((item) => item.usagePolicy === "recommend" || !item.confirmedAt).length;
  } else {
    [documentCount, autoDocumentCount, recommendedDocumentCount] = await Promise.all([
      prisma.knowledgeDocumentSubject.count({ where: { subjectId: subject.id } }),
      prisma.knowledgeDocument.count({ where: { tenantId: context.tenantId, subjects: { some: { subjectId: subject.id } }, usagePolicy: "auto", confirmedAt: { not: null }, sensitivity: { not: "sensitive" } } }),
      prisma.knowledgeDocument.count({ where: { tenantId: context.tenantId, subjects: { some: { subjectId: subject.id } }, OR: [{ usagePolicy: "recommend" }, { confirmedAt: null }] } })
    ]);
  }
  return {
    id: subject.id,
    subjectType: subject.subjectType,
    typeLabel: subjectTypeLabel(subject.subjectType),
    name: subject.name,
    description: subject.description,
    industry: subject.industry,
    isDefault: subject.isDefault,
    documentCount,
    autoDocumentCount,
    recommendedDocumentCount,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt
  };
}

async function findKnowledgeDocument(context: RequestContext, id: string): Promise<any | null> {
  if (context.source === "demo") return demoDocuments.get(id)?.tenantId === context.tenantId ? demoDocuments.get(id)! : null;
  return prisma.knowledgeDocument.findFirst({ where: { id, tenantId: context.tenantId } });
}

export async function loadAutomaticKnowledgeDocuments(context: RequestContext, subjectId: string, excludeIds: string[] = [], limit = 20): Promise<KnowledgeContextDocument[]> {
  const safeLimit = Math.max(0, Math.min(limit, 20));
  if (safeLimit === 0) return [];
  if (context.source === "demo") {
    return [...demoDocuments.values()]
      .filter((item) => item.tenantId === context.tenantId && (item.subjectIds ?? []).includes(subjectId))
      .filter((item) => item.usagePolicy === "auto" && Boolean(item.confirmedAt) && item.sensitivity !== "sensitive" && !excludeIds.includes(item.id))
      .sort((a, b) => (b.occurredAt ?? b.updatedAt).getTime() - (a.occurredAt ?? a.updatedAt).getTime())
      .slice(0, safeLimit);
  }
  const records = await prisma.knowledgeDocument.findMany({
    where: {
      tenantId: context.tenantId,
      id: { notIn: excludeIds },
      subjects: { some: { subjectId } },
      usagePolicy: "auto",
      confirmedAt: { not: null },
      sensitivity: { not: "sensitive" }
    },
    orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
    take: safeLimit
  });
  return records;
}

async function countIndustrySupplements(context: RequestContext, subjectId?: string): Promise<number> {
  if (context.source === "demo") return [...demoDocuments.values()].filter((item) => item.tenantId === context.tenantId && item.knowledgeLayer === "enterprise_industry" && (!subjectId || (item.subjectIds ?? []).includes(subjectId))).length;
  return prisma.knowledgeDocument.count({ where: { tenantId: context.tenantId, knowledgeLayer: "enterprise_industry", ...(subjectId ? { subjects: { some: { subjectId } } } : {}) } });
}

const INDUSTRY_KNOWLEDGE_CAP = 200;
const INDUSTRY_KNOWLEDGE_BATCH_SIZE = 25;

async function importPublicIndustryKnowledge(
  context: RequestContext,
  subject: any,
  industry: string,
  options: { mode: "base" | "expanded"; keywords: string[] }
): Promise<Record<string, unknown>> {
  const ownership = `subject:${subject.id}`;
  const now = new Date();
  const keywords = Array.from(new Set(options.keywords.map((item) => item.trim()).filter(Boolean))).slice(0, 12);
  const researchKey = JSON.stringify({ industry, mode: options.mode, keywords });
  let connection: any;
  let existingCount = 0;
  let offset = 0;
  if (context.source === "demo") {
    connection = [...demoConnections.values()].find((item) => item.tenantId === context.tenantId && item.provider === "industry_public" && item.ownership === ownership);
    if (!connection) {
      connection = {
        id: randomUUID(), tenantId: context.tenantId, ownerUserId: context.userId, provider: "industry_public", ownership,
        label: `${industry}公开行业知识库`, encryptedCredentials: encryptKnowledgeCredentials({ provider: "industry_public" }),
        status: "active", capabilities: ["public_industry_crawl", "incremental_sync"], createdAt: now, updatedAt: now
      } satisfies DemoConnection;
      demoConnections.set(connection.id, connection);
    }
    const cursor = parseIndustryCursor(connection.syncCursor, industry, researchKey);
    existingCount = [...demoDocuments.values()].filter((item) => item.tenantId === context.tenantId && item.connectionId === connection.id).length;
    offset = cursor.offset;
  } else {
    connection = await prisma.knowledgeConnection.upsert({
      where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: "industry_public", ownership } },
      create: { tenantId: context.tenantId, ownerUserId: context.userId, provider: "industry_public", ownership, label: `${industry}公开行业知识库`, encryptedCredentials: encryptKnowledgeCredentials({ provider: "industry_public" }), capabilities: ["public_industry_crawl", "incremental_sync"], status: "active" },
      update: { label: `${industry}公开行业知识库`, status: "active", lastError: null }
    });
    const cursor = parseIndustryCursor(connection.syncCursor, industry, researchKey);
    existingCount = await prisma.knowledgeDocument.count({ where: { tenantId: context.tenantId, connectionId: connection.id } });
    offset = cursor.offset;
  }
  if (existingCount >= INDUSTRY_KNOWLEDGE_CAP) return { created: 0, updated: 0, stored: existingCount, cap: INDUSTRY_KNOWLEDGE_CAP, hasMore: false, message: "已达到本行业首轮 200 篇公开资料上限" };

  const batch = await crawlPublicIndustryKnowledge(industry, {
    offset,
    limit: Math.min(INDUSTRY_KNOWLEDGE_BATCH_SIZE, INDUSTRY_KNOWLEDGE_CAP - existingCount),
    expanded: options.mode === "expanded",
    keywords
  });
  let created = 0;
  let updated = 0;
  for (const item of batch.documents) {
    const metadata = { source: "industry_public", sourceLabel: item.source, url: item.url, sourceTrust: item.sourceTrust, eventType: item.eventType, query: item.query, crawledAt: now.toISOString() };
    const contentHash = createHash("sha256").update(item.content).digest("hex");
    if (context.source === "demo") {
      const existing = [...demoDocuments.values()].find((document) => document.connectionId === connection.id && document.externalId === item.externalId);
      if (existing) {
        Object.assign(existing, { title: item.title, content: item.content, contentHash, metadata, occurredAt: item.publishedAt ? new Date(item.publishedAt) : undefined, externalUpdatedAt: now, updatedAt: now });
        demoDocuments.set(existing.id, existing); updated += 1;
      } else {
        const id = randomUUID();
        demoDocuments.set(id, { id, tenantId: context.tenantId, connectionId: connection.id, externalId: item.externalId, documentType: "web_page", sourceClass: "public_industry", knowledgeLayer: "enterprise_industry", usagePolicy: "recommend", sensitivity: "normal", industry, subjectIds: [subject.id], title: item.title, content: item.content, occurredAt: item.publishedAt ? new Date(item.publishedAt) : undefined, externalUpdatedAt: now, contentHash, metadata, createdAt: now, updatedAt: now });
        created += 1;
      }
    } else {
      const existing = await prisma.knowledgeDocument.findUnique({ where: { connectionId_externalId: { connectionId: connection.id, externalId: item.externalId } }, select: { id: true } });
      await prisma.knowledgeDocument.upsert({ where: { connectionId_externalId: { connectionId: connection.id, externalId: item.externalId } }, create: { tenantId: context.tenantId, connectionId: connection.id, externalId: item.externalId, documentType: "web_page", sourceClass: "public_industry", knowledgeLayer: "enterprise_industry", usagePolicy: "recommend", sensitivity: "normal", industry, title: item.title, content: item.content, occurredAt: item.publishedAt ? new Date(item.publishedAt) : undefined, externalUpdatedAt: now, contentHash, metadata, subjects: { create: { subjectId: subject.id } } }, update: { title: item.title, content: item.content, contentHash, metadata, occurredAt: item.publishedAt ? new Date(item.publishedAt) : undefined, externalUpdatedAt: now, industry } });
      if (existing) updated += 1; else created += 1;
    }
  }
  const nextOffset = offset + batch.consumed;
  const syncCursor = JSON.stringify({ industry, researchKey, offset: nextOffset, target: INDUSTRY_KNOWLEDGE_CAP, discovered: batch.discovered });
  if (context.source === "demo") { Object.assign(connection, { syncCursor, lastSyncedAt: now, updatedAt: now }); demoConnections.set(connection.id, connection); await persistDemoKnowledgeStore(); }
  else await prisma.knowledgeConnection.update({ where: { id: connection.id }, data: { syncCursor, lastSyncedAt: now, lastError: null } });
  return { created, updated, stored: existingCount + created, cap: INDUSTRY_KNOWLEDGE_CAP, discovered: batch.discovered, hasMore: batch.hasMore && existingCount + created < INDUSTRY_KNOWLEDGE_CAP, mode: options.mode, keywords };
}

function parseIndustryCursor(value: string | undefined, industry: string, researchKey: string): { offset: number } {
  try {
    const parsed = JSON.parse(value ?? "{}") as { industry?: string; researchKey?: string; offset?: number };
    return parsed.industry === industry && parsed.researchKey === researchKey && Number.isInteger(parsed.offset) && parsed.offset! >= 0 ? { offset: parsed.offset! } : { offset: 0 };
  } catch { return { offset: 0 }; }
}

async function createManualKnowledgeDocument(
  context: RequestContext,
  input: z.infer<typeof manualDocumentSchema>
): Promise<Record<string, unknown>> {
  const subject = input.subjectId ? await findKnowledgeSubject(context, input.subjectId) : null;
  if (input.subjectId && !subject) throw new Error("knowledge_subject_not_found");
  const now = new Date();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const externalId = `manual:${randomUUID()}`;
  const metadata = { source: "manual", sourceLabel: input.sourceLabel ?? "手动录入", importedAt: now.toISOString() };

  if (context.source === "demo") {
    let connection = [...demoConnections.values()].find((item) => item.tenantId === context.tenantId && item.provider === "manual");
    if (!connection) {
      connection = {
        id: randomUUID(), tenantId: context.tenantId, ownerUserId: context.userId,
        provider: "manual", ownership: "tenant", label: "手动录入与文件上传",
        encryptedCredentials: encryptKnowledgeCredentials({ provider: "manual" }), status: "active", capabilities: ["manual_write"],
        createdAt: now, updatedAt: now
      };
      demoConnections.set(connection.id, connection);
    }
    const record: DemoDocument = {
      id: randomUUID(), tenantId: context.tenantId, connectionId: connection.id, externalId,
      documentType: input.documentType, sourceClass: "first_party", knowledgeLayer: "raw_private", usagePolicy: "recommend", sensitivity: "normal",
      subjectIds: subject ? [subject.id] : [], title: input.title, content: input.content, occurredAt, externalUpdatedAt: now,
      contentHash, metadata, createdAt: now, updatedAt: now
    };
    demoDocuments.set(record.id, record);
    await persistDemoKnowledgeStore();
    return publicDocument(record, subject ? [subject] : []);
  }

  const connection = await prisma.knowledgeConnection.upsert({
    where: { tenantId_provider_ownership: { tenantId: context.tenantId, provider: "manual", ownership: "tenant" } },
    create: {
      tenantId: context.tenantId, ownerUserId: context.userId, provider: "manual", ownership: "tenant", label: "手动录入与文件上传",
      encryptedCredentials: encryptKnowledgeCredentials({ provider: "manual" }), capabilities: ["manual_write"], status: "active"
    },
    update: { updatedAt: now }
  });
  const record = await prisma.knowledgeDocument.create({
    data: {
      tenantId: context.tenantId, connectionId: connection.id, externalId, documentType: input.documentType, sourceClass: "first_party",
      knowledgeLayer: "raw_private", usagePolicy: "recommend", sensitivity: "normal", title: input.title, content: input.content,
      occurredAt, externalUpdatedAt: now, contentHash, metadata,
      ...(subject ? { subjects: { create: { subjectId: subject.id } } } : {})
    },
    include: { subjects: { include: { subject: true } } }
  });
  return publicDocument(record, record.subjects.map((item) => item.subject));
}

function isExtractableKnowledgeFile(filename: string, mimeType: string): boolean {
  return mimeType.startsWith("text/") || /\.(txt|md|csv|tsv|json|log)$/i.test(filename);
}

const KNOWLEDGE_SYNC_STALE_MS = 90_000;

async function createOrReuseKnowledgeSyncJob(
  context: RequestContext,
  connectionId: string,
  input: { subjectId?: string; clientRequestId?: string }
): Promise<{ job: any; reused: boolean }> {
  const active = await activeKnowledgeSyncJob(context, connectionId);
  if (active) {
    const recovered = await failStaleKnowledgeSyncJob(context, active);
    if (recovered.status === "queued" || recovered.status === "running") return { job: recovered, reused: true };
  }
  const now = new Date();
  if (context.source === "demo") {
    const existing = [...demoSyncJobs.values()].find((item) => item.tenantId === context.tenantId && item.connectionId === connectionId && ["queued", "running"].includes(item.status));
    if (existing) return { job: existing, reused: true };
    const job: DemoSyncJob = {
      id: randomUUID(), tenantId: context.tenantId, connectionId, requestedByUserId: context.userId,
      subjectId: input.subjectId, clientRequestId: input.clientRequestId, status: "queued", stage: "queued", retryable: false,
      scanned: 0, processed: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, skippedCount: 0,
      failedCount: 0, assignedCount: 0, listRequests: 0, detailRequests: 0, retryCount: 0,
      throttleMs: 0, backoffMs: 0, createdAt: now, updatedAt: now
    };
    demoSyncJobs.set(job.id, job);
    await persistDemoKnowledgeStore();
    return { job, reused: false };
  }
  try {
    const job = await prisma.knowledgeSyncJob.create({ data: {
      tenantId: context.tenantId, connectionId, requestedByUserId: context.userId,
      subjectId: input.subjectId, clientRequestId: input.clientRequestId
    } });
    return { job, reused: false };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await activeKnowledgeSyncJob(context, connectionId);
    if (!raced) throw error;
    return { job: raced, reused: true };
  }
}

async function activeKnowledgeSyncJob(context: RequestContext, connectionId: string): Promise<any | null> {
  if (context.source === "demo") {
    return [...demoSyncJobs.values()]
      .filter((item) => item.tenantId === context.tenantId && item.connectionId === connectionId && ["queued", "running"].includes(item.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  return prisma.knowledgeSyncJob.findFirst({
    where: { tenantId: context.tenantId, connectionId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" }
  });
}

async function latestKnowledgeSyncJob(context: RequestContext, connectionId: string): Promise<any | null> {
  if (context.source === "demo") {
    return [...demoSyncJobs.values()]
      .filter((item) => item.tenantId === context.tenantId && item.connectionId === connectionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  return prisma.knowledgeSyncJob.findFirst({ where: { tenantId: context.tenantId, connectionId }, orderBy: { createdAt: "desc" } });
}

async function findKnowledgeSyncJob(context: RequestContext, id: string): Promise<any | null> {
  if (context.source === "demo") return demoSyncJobs.get(id)?.tenantId === context.tenantId ? demoSyncJobs.get(id)! : null;
  return prisma.knowledgeSyncJob.findFirst({ where: { id, tenantId: context.tenantId } });
}

async function updateKnowledgeSyncJob(context: RequestContext, id: string, data: Record<string, unknown>): Promise<any> {
  if (context.source === "demo") {
    const current = demoSyncJobs.get(id);
    if (!current || current.tenantId !== context.tenantId) throw new Error("sync_job_not_found");
    const updated = { ...current, ...data, updatedAt: new Date() } as DemoSyncJob;
    demoSyncJobs.set(id, updated);
    await persistDemoKnowledgeStore();
    return updated;
  }
  return prisma.knowledgeSyncJob.update({ where: { id }, data: data as any });
}

async function failStaleKnowledgeSyncJob(context: RequestContext, job: any): Promise<any> {
  if (job.status !== "running") return job;
  const heartbeatAt = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : new Date(job.startedAt ?? job.createdAt).getTime();
  if (Date.now() - heartbeatAt <= KNOWLEDGE_SYNC_STALE_MS) return job;
  return updateKnowledgeSyncJob(context, job.id, {
    status: "interrupted", stage: "interrupted", retryable: true, completedAt: new Date(),
    errorCode: "sync_process_interrupted", errorMessage: "同步进程已中断，可从上次成功水位重新发起。"
  });
}

function scheduleKnowledgeSyncJob(app: FastifyInstance, context: RequestContext, connectionId: string, jobId: string): void {
  if (scheduledSyncJobs.has(jobId)) return;
  scheduledSyncJobs.add(jobId);
  setTimeout(() => {
    void runKnowledgeSyncJob(app, context, connectionId, jobId)
      .catch((error) => app.log.error({ event: "knowledge_sync_runner_crashed", syncJobId: jobId, reason: error instanceof Error ? error.message : "unknown" }, "knowledge sync runner crashed"))
      .finally(() => scheduledSyncJobs.delete(jobId));
  }, 0);
}

async function runKnowledgeSyncJob(app: FastifyInstance, context: RequestContext, connectionId: string, jobId: string): Promise<void> {
  const job = await findKnowledgeSyncJob(context, jobId);
  if (!job || job.status !== "queued") return;
  const connection = await findConnection(context, connectionId);
  if (!connection || connection.provider !== "getnote") {
    await updateKnowledgeSyncJob(context, jobId, { status: "failed", stage: "failed", retryable: false, completedAt: new Date(), errorCode: "connection_not_found", errorMessage: "同步连接不存在或类型不匹配。" });
    return;
  }
  const startedAt = new Date();
  const phaseStartedAt = new Map<string, number>();
  const phaseDurations: Record<string, number> = {};
  let lastStage = "queued";
  const markStage = async (stage: string, data: Record<string, unknown> = {}): Promise<void> => {
    const now = Date.now();
    const previousStart = phaseStartedAt.get(lastStage);
    if (previousStart !== undefined) phaseDurations[lastStage] = (phaseDurations[lastStage] ?? 0) + Math.max(0, now - previousStart);
    phaseStartedAt.set(stage, now);
    lastStage = stage;
    await updateKnowledgeSyncJob(context, jobId, { stage, heartbeatAt: new Date(now), phaseDurations, ...data });
    app.log.info({ event: "knowledge_sync_stage", tenantId: context.tenantId, connectionId, syncJobId: jobId, stage, ...data }, "knowledge sync stage");
  };
  await updateKnowledgeSyncJob(context, jobId, { status: "running", stage: "listing", startedAt, heartbeatAt: startedAt, errorCode: null, errorMessage: null });
  phaseStartedAt.set("listing", startedAt.getTime());
  try {
    const knownRows = context.source === "demo"
      ? [...demoDocuments.values()].filter((item) => item.tenantId === context.tenantId && item.connectionId === connectionId)
      : await prisma.knowledgeDocument.findMany({ where: { tenantId: context.tenantId, connectionId }, select: { externalId: true, externalUpdatedAt: true, contentHash: true } });
    const knownDocuments = new Map(knownRows.map((item) => [item.externalId, { externalUpdatedAt: item.externalUpdatedAt, contentHash: item.contentHash }]));
    const pulled = await pullGetNoteTranscripts(
      decryptKnowledgeCredentials<GetNoteCredentials>(connection.encryptedCredentials),
      {
        cursor: connection.syncCursor ?? undefined,
        maxPages: 5,
        knownDocuments,
        onObservation: async (observation) => {
          await markStage(observation.stage, {
            scanned: observation.scanned, processed: observation.processed, total: observation.scanned,
            unchangedCount: observation.unchanged, failedCount: observation.failed,
            listRequests: observation.listRequests, detailRequests: observation.detailRequests,
            retryCount: observation.retryCount, throttleMs: observation.throttleMs, backoffMs: observation.backoffMs
          });
        }
      }
    );
    await markStage("persisting", { scanned: pulled.scanned, total: pulled.scanned, processed: pulled.unchanged + pulled.skipped + pulled.failed });
    let created = 0;
    let updated = 0;
    let unchanged = pulled.unchanged;
    for (const document of pulled.documents) {
      if (context.source === "demo") {
        const existing = [...demoDocuments.values()].find((item) => item.tenantId === context.tenantId && item.connectionId === connection.id && item.externalId === document.externalId);
        if (existing?.contentHash === document.contentHash) {
          unchanged += 1;
        } else {
          const now = new Date();
          const record: DemoDocument = {
            id: existing?.id ?? randomUUID(), tenantId: context.tenantId, connectionId: connection.id,
            externalId: document.externalId, documentType: document.documentType, sourceClass: "first_party",
            knowledgeLayer: existing?.knowledgeLayer ?? "raw_private", usagePolicy: existing?.usagePolicy ?? "recommend",
            sensitivity: existing?.sensitivity ?? "normal", confirmedAt: existing?.confirmedAt, industry: existing?.industry,
            subjectIds: job.subjectId ? Array.from(new Set([...(existing?.subjectIds ?? []), job.subjectId])) : existing?.subjectIds ?? [],
            title: document.title, content: document.content, occurredAt: document.occurredAt,
            externalUpdatedAt: document.externalUpdatedAt, contentHash: document.contentHash, metadata: document.metadata,
            createdAt: existing?.createdAt ?? now, updatedAt: now
          };
          demoDocuments.set(record.id, record);
          existing ? updated += 1 : created += 1;
        }
      } else {
        const existing = await prisma.knowledgeDocument.findUnique({ where: { connectionId_externalId: { connectionId, externalId: document.externalId } }, select: { id: true, contentHash: true } });
        if (existing?.contentHash === document.contentHash) {
          unchanged += 1;
          if (job.subjectId) await prisma.knowledgeDocumentSubject.upsert({ where: { documentId_subjectId: { documentId: existing.id, subjectId: job.subjectId } }, create: { documentId: existing.id, subjectId: job.subjectId }, update: {} });
        } else {
          const saved = await prisma.knowledgeDocument.upsert({
            where: { connectionId_externalId: { connectionId, externalId: document.externalId } },
            create: { ...document, metadata: document.metadata as any, tenantId: context.tenantId, connectionId, sourceClass: "first_party", ...(job.subjectId ? { subjects: { create: { subjectId: job.subjectId } } } : {}) },
            update: { ...document, metadata: document.metadata as any }
          });
          if (job.subjectId && existing) await prisma.knowledgeDocumentSubject.upsert({ where: { documentId_subjectId: { documentId: saved.id, subjectId: job.subjectId } }, create: { documentId: saved.id, subjectId: job.subjectId }, update: {} });
          existing ? updated += 1 : created += 1;
        }
      }
      await updateKnowledgeSyncJob(context, jobId, { createdCount: created, updatedCount: updated, unchangedCount: unchanged, processed: Math.min(pulled.scanned, pulled.unchanged + pulled.skipped + pulled.failed + created + updated + (unchanged - pulled.unchanged)), heartbeatAt: new Date() });
    }
    await markStage("binding", { createdCount: created, updatedCount: updated, unchangedCount: unchanged });
    const assigned = job.subjectId ? await assignConnectionDocumentsToSubject(context, connectionId, job.subjectId) : 0;
    const completedAt = new Date();
    const partial = pulled.failed > 0;
    if (!partial) {
      if (context.source === "demo") {
        const record = connection as DemoConnection;
        Object.assign(record, { syncCursor: pulled.nextCursor, lastSyncedAt: completedAt, lastError: undefined, status: "active", updatedAt: completedAt });
        demoConnections.set(record.id, record);
      } else {
        await prisma.knowledgeConnection.update({ where: { id: connectionId }, data: { syncCursor: pulled.nextCursor, lastSyncedAt: completedAt, lastError: null, status: "active" } });
      }
    }
    const terminal = await updateKnowledgeSyncJob(context, jobId, {
      status: partial ? "failed" : "succeeded", stage: partial ? "partial_failure" : "completed", retryable: partial,
      scanned: pulled.scanned, processed: pulled.scanned, total: pulled.scanned,
      createdCount: created, updatedCount: updated, unchangedCount: unchanged, skippedCount: pulled.skipped,
      failedCount: pulled.failed, assignedCount: assigned, listRequests: pulled.listRequests, detailRequests: pulled.detailRequests,
      retryCount: pulled.retryCount, throttleMs: pulled.throttleMs, backoffMs: pulled.backoffMs,
      importedByType: pulled.importedByType, phaseDurations, completedAt, heartbeatAt: completedAt,
      lastSuccessfulAt: partial ? connection.lastSyncedAt ?? null : completedAt,
      errorCode: partial ? "getnote_partial_detail_failure" : null,
      errorMessage: partial ? "部分资料读取失败；已保存成功条目，未推进同步水位，可安全重试。" : null
    });
    await persistDemoKnowledgeStore();
    app.log.info({ event: partial ? "knowledge_sync_failed" : "knowledge_sync_completed", tenantId: context.tenantId, connectionId, syncJobId: jobId, status: terminal.status, scanned: pulled.scanned, created, updated, unchanged, skipped: pulled.skipped, failed: pulled.failed, listRequests: pulled.listRequests, detailRequests: pulled.detailRequests, retryCount: pulled.retryCount, throttleMs: pulled.throttleMs, backoffMs: pulled.backoffMs, durationMs: completedAt.getTime() - startedAt.getTime() }, "knowledge sync terminal");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "sync_failed";
    const failureKind = classifyGetNoteFailure(reason);
    const completedAt = new Date();
    const publicMessage = getNoteSyncErrorMessage(reason);
    await updateKnowledgeSyncJob(context, jobId, {
      status: "failed", stage: "failed", retryable: failureKind !== "authorization", completedAt, heartbeatAt: completedAt,
      errorCode: `getnote_${failureKind}_failure`, errorMessage: publicMessage, phaseDurations
    });
    if (context.source === "demo") {
      const record = connection as DemoConnection;
      record.lastError = publicMessage;
      record.status = failureKind === "authorization" ? "error" : "active";
      demoConnections.set(record.id, record);
      await persistDemoKnowledgeStore();
    } else {
      await prisma.knowledgeConnection.update({ where: { id: connectionId }, data: { lastError: publicMessage, status: failureKind === "authorization" ? "error" : "active" } });
    }
    app.log.warn({ event: "knowledge_sync_failed", tenantId: context.tenantId, connectionId, syncJobId: jobId, failureKind, stage: lastStage, durationMs: completedAt.getTime() - startedAt.getTime() }, "knowledge sync failed");
  }
}

function publicSyncJob(job: any): Record<string, unknown> {
  return {
    id: job.id, connectionId: job.connectionId, status: job.status, stage: job.stage, retryable: Boolean(job.retryable),
    scanned: job.scanned ?? 0, processed: job.processed ?? 0, total: job.total ?? null,
    created: job.createdCount ?? 0, updated: job.updatedCount ?? 0, unchanged: job.unchangedCount ?? 0,
    skipped: job.skippedCount ?? 0, failed: job.failedCount ?? 0, assignedToSubject: job.assignedCount ?? 0,
    listRequests: job.listRequests ?? 0, detailRequests: job.detailRequests ?? 0, retryCount: job.retryCount ?? 0,
    throttleMs: job.throttleMs ?? 0, backoffMs: job.backoffMs ?? 0, phaseDurations: job.phaseDurations ?? {},
    importedByType: job.importedByType ?? { transcripts: 0, notes: 0, webPages: 0 },
    errorCode: job.errorCode ?? null, message: job.errorMessage ?? null,
    startedAt: job.startedAt ?? null, completedAt: job.completedAt ?? null,
    lastSuccessfulAt: job.lastSuccessfulAt ?? null, createdAt: job.createdAt, updatedAt: job.updatedAt
  };
}

async function findConnection(context: RequestContext, id: string): Promise<any | null> {
  if (context.source === "demo") return demoConnections.get(id)?.tenantId === context.tenantId ? demoConnections.get(id)! : null;
  return prisma.knowledgeConnection.findFirst({ where: { id, tenantId: context.tenantId } });
}

async function assignConnectionDocumentsToSubject(context: RequestContext, connectionId: string, subjectId: string): Promise<number> {
  if (context.source === "demo") {
    let assigned = 0;
    for (const document of demoDocuments.values()) {
      if (document.tenantId !== context.tenantId || document.connectionId !== connectionId || (document.subjectIds ?? []).includes(subjectId)) continue;
      document.subjectIds = [...(document.subjectIds ?? []), subjectId];
      document.updatedAt = new Date();
      demoDocuments.set(document.id, document);
      assigned += 1;
    }
    return assigned;
  }
  const documents = await prisma.knowledgeDocument.findMany({ where: { tenantId: context.tenantId, connectionId }, select: { id: true } });
  if (!documents.length) return 0;
  const existing = await prisma.knowledgeDocumentSubject.findMany({ where: { subjectId, documentId: { in: documents.map((document) => document.id) } }, select: { documentId: true } });
  const existingIds = new Set(existing.map((item) => item.documentId));
  const missing = documents.filter((document) => !existingIds.has(document.id));
  if (missing.length) await prisma.knowledgeDocumentSubject.createMany({ data: missing.map((document) => ({ documentId: document.id, subjectId })), skipDuplicates: true });
  return missing.length;
}

export async function loadKnowledgeDocuments(context: RequestContext, ids: string[]): Promise<KnowledgeContextDocument[]> {
  const uniqueIds = Array.from(new Set(ids));
  if (context.source === "demo") {
    return uniqueIds.map((id) => demoDocuments.get(id)).filter((item): item is DemoDocument => Boolean(item && item.tenantId === context.tenantId));
  }
  const records = await prisma.knowledgeDocument.findMany({
    where: { id: { in: uniqueIds }, tenantId: context.tenantId },
    select: {
      id: true, title: true, content: true, documentType: true, occurredAt: true,
      knowledgeLayer: true, usagePolicy: true, sensitivity: true, confirmedAt: true, industry: true,
      subjects: { select: { subjectId: true } }
    }
  });
  return records.map(({ subjects, ...record }) => ({ ...record, subjectIds: subjects.map((item) => item.subjectId) }));
}

async function loadBatch(context: RequestContext, id: string): Promise<any | null> {
  if (context.source === "demo") return demoBatches.get(id)?.tenantId === context.tenantId ? demoBatches.get(id)! : null;
  return prisma.knowledgeAnalysisBatch.findFirst({ where: { id, tenantId: context.tenantId }, include: { analyses: true, synthesis: true } });
}

function publicConnection(connection: any): Record<string, unknown> {
  return {
    id: connection.id,
    provider: connection.provider,
    ownership: connection.ownership,
    label: connection.label,
    status: connection.status,
    capabilities: connection.capabilities ?? [],
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    createdAt: connection.createdAt,
    credentialHint: "已安全保存"
  };
}

function publicDocument(document: any, subjects: any[] = []): Record<string, unknown> {
  return {
    id: document.id,
    connectionId: document.connectionId,
    title: document.title,
    documentType: effectiveKnowledgeDocumentType(document),
    sourceClass: document.sourceClass,
    knowledgeLayer: document.knowledgeLayer ?? "raw_private",
    usagePolicy: document.usagePolicy ?? "recommend",
    sensitivity: document.sensitivity ?? "normal",
    confirmed: Boolean(document.confirmedAt),
    confirmedAt: document.confirmedAt,
    industry: document.industry,
    subjectIds: subjects.map((subject) => subject.id),
    subjects: subjects.map((subject) => ({ id: subject.id, subjectType: subject.subjectType, name: subject.name })),
    occurredAt: document.occurredAt,
    updatedAt: document.updatedAt,
    preview: document.content.slice(0, 320),
    characterCount: document.content.length,
    metadata: document.metadata
  };
}

function matchesKnowledgeDocumentType(document: Pick<DemoDocument, "documentType" | "title" | "content">, type: "transcript" | "note" | "web_page" | "all"): boolean {
  if (type === "all") return true;
  return effectiveKnowledgeDocumentType(document) === type;
}

function effectiveKnowledgeDocumentType(document: { documentType?: string; title?: string; content?: string }): string {
  if (document.documentType === "transcript") return "transcript";
  const sample = `${document.title ?? ""}\n${document.content?.slice(0, 2_500) ?? ""}`;
  if (/录音(?:信息|总结|转写|时间)|录制时间|音频时长|参与人数/.test(sample)) return "transcript";
  return document.documentType ?? "note";
}

export function isAcquisitionKnowledgePackageRequest(input: string): boolean {
  return /选择一个选题继续写文案|用这个选题生成完整内容执行包|完整内容执行包|可直接发布的内容执行包|(?:选择|基于|用).{0,24}选题.{0,16}(?:九件套|完整执行包)/.test(input);
}

export function buildKnowledgeAgentSystemPrompt(agent: RuntimeAgent, requestedInput = ""): string {
  const capabilities = agent.capabilities.map((item) => item.title).join("、") || "企业经营分析";
  const shared = [
    `你是企业的“${agent.name}”，职责说明：${agent.description}`,
    `你的专业能力包括：${capabilities}。`,
    "必须区分事实、判断和建议；引用事实时标注【资料序号】；证据不足时写“待核实”。",
    "必须先判断本轮任务主体。企业画像只是系统使用方的背景；用户当前输入里明确指定的客户、品牌、项目、发布账号、目标受众和转化目的，优先级更高。",
    "如果用户在替客户或品牌项目创作，输出必须服务该客户项目的目标，不得自动改成宣传系统使用方自己的主营业务；客户事实不足时标待补，不得拿使用方资料补位。",
    "知识优先级固定为：本轮用户明确要求与事实纠正 > 当前主体已确认私有知识 > 企业补充的行业经验 > 平台审核行业基础包 > 公开网络资料 > 模型通用知识。不同层必须区分来源，不得混成同一种事实。",
    "如果证据包包含【IP语言声纹】，它只用于约束IP本人可直接说/发内容的表达方式，不是事实来源。只自然借用稳定句式、语气和少量口头禅，不能照搬旧录音主题，不能模仿客户或第三方。",
    "分类常识：手机贴膜、手机维修、手机配件属于手机后市场；除非资料明确谈论汽车，否则不得归类为汽车后市场。",
    "输出中文 Markdown。"
  ];

  if (agent.slug === "acquisition") {
    const packageRequest = isAcquisitionKnowledgePackageRequest(requestedInput);
    const franchiseTask = /招商|加盟|加盟商|代理/.test(requestedInput);
    return [
      ...shared,
      packageRequest
        ? "用户已经选定选题并要求继续创作。本次必须输出一份可直接执行的“完整内容执行包”，不得只写选题、标题或口播文案。"
        : "本次任务只输出获客选题方案，不写完整文案，不输出泛化的账号运营建议。",
      packageRequest
        ? "完整内容执行包必须覆盖九项：选题策划、60至90秒口播逐字稿、拍摄脚本、拍摄注意事项、剪辑EDL、发布标题与话题、发布时间、评论区引导话术、投流建议。面向用户只称“完整内容执行包”，不要出现“九件套”等内部结构名。"
        : "用户确认某个选题后，才进入完整内容执行包生成。",
      franchiseTask
        ? "本轮是为指定客户/品牌项目做招商加盟内容：内容主体是该品牌项目，目标受众是潜在加盟商，承接目标是加盟留资、领取真实资料或预约考察；不得改成推广系统使用方自己的IP或AI服务。未知门店数、投资额、回本周期、扶持政策和经营结果必须标待补，禁止承诺稳赚、保本或固定回报。"
        : "本轮内容目的以用户当前输入为准，不从企业默认画像擅自添加另一套转化目标。",
      "必须从录音资料中的真实经历、客户问题、项目过程、反常识观点和现场冲突里提炼选题，并说明它为何能吸引用户想承接的业务。",
      "用户可能经营 IP 与 AI、招商加盟、连锁门店或其他业务。只能依据该用户填写的身份与业务目标定制，绝不能默认所有用户都做 IP 与 AI。",
      "必须严格保留事件状态：资料里写的是计划、准备、意向、建议、尝试或待确认，就不能在标题或正文中改写成已经同意、已经合作、已经成交或已经产生效果。",
      "选题标题可以有吸引力，但不能为了制造冲突虚构一句话、结果、数字、客户态度或因果关系。仅作为创作方向的表达要明确写成“建议角度”，不能伪装成录音事实。",
      "不得把资料中的概念换成更夸张的新场景。例如“已签保险理赔车辆”不能改写成“仓库里已有待修车辆”。数字、对象、地点、关系和业务阶段都必须保持原意；无法确认就标注待核实。",
      "没有资料证据的选题不要编造；同质选题要合并，宁可少而强。"
    ].join("\n");
  }

  if (agent.slug === "sales") {
    return [
      ...shared,
      "本次任务是基于真实录音做销售复盘：找出用户在客户沟通或团队讨论中没有聊到位、做错、漏做或时机不对的销售动作，并说明这些问题为什么会阻碍合作与成交。",
      "必须把“当时怎么聊的”和“下次应该怎么聊”做清晰对照，建议要落到可以直接说出口的提问、回应、推进句、成交确认和下一步动作，不要只写抽象原则。",
      "客户对话要诊断需求、决策人、预算、时间、价值、异议和成交推进；团队讨论要诊断会前准备、分工、报价口径、客户信息同步和跟进责任。不要把团队成员误当成销售对象。",
      "不能仅凭结果倒推用户做错了。没有足够对话证据时必须写“证据不足，待核实”，不得虚构原话。"
    ].join("\n");
  }

  return [
    ...shared,
    "这次只做企业经营会诊，不要套用短视频文案模板，不要输出与资料无关的通用套话。"
  ].join("\n");
}

function buildAnalysisPrompt(agent: RuntimeAgent, knowledgeText: string, context: AnalysisContext): string {
  const contextBlock = [
    context.subject ? `本轮服务主体：${subjectTypeLabel(context.subject.subjectType)}｜${context.subject.name}${context.subject.industry ? `｜行业：${context.subject.industry}` : ""}` : "本轮服务主体：未指定，只能使用资料中明确指向的同一主体，不能跨IP或跨项目拼接。",
    context.identityContext ? `用户身份与专业定位：${context.identityContext}` : "用户身份与专业定位：未填写，请仅根据资料判断并标注待核实。",
    context.businessGoal ? `本次业务目标：${context.businessGoal}` : "本次业务目标：未填写，请不要擅自假设具体成交目标。",
    context.factCorrections ? `用户已确认的事实纠正（优先级高于资料中的自动摘要或模型推测）：${context.factCorrections}` : undefined,
    context.instruction ? `本次特别要求：${context.instruction}` : undefined
  ].filter(Boolean).join("\n");

  const introduction = [
    `请完全站在“${agent.name}”的职责边界内独立分析，不要代替其他智能体。`,
    "以下是从企业授权私有知识库提取的证据包。它保留了各资料的摘要、关键事实和行动线索，不是全文。",
    "本次特别要求中明确的内容主体、客户项目、目标受众和转化目的，优先于用户身份与企业默认画像。用户可能用自己的专业能力服务另一家企业，不得混淆使用方身份与内容主体。",
    contextBlock
  ];

  if (agent.slug === "acquisition") {
    return [
      ...introduction,
      "请挑选 8—12 个最值得发布的选题，按推荐优先级排序。每个选题必须包含：选题标题、来源证据、可讲的真实故事或核心观点、目标受众、与用户身份的连接、为什么有助于承接目标业务、视频切入角度或一句开头钩子、自然的业务承接动作。",
      "最后只列出真正影响选题质量的“需要补充的信息”。不要写成完整口播稿或长文案。",
      knowledgeText
    ].join("\n\n");
  }

  if (agent.slug === "sales") {
    return [
      ...introduction,
      "先给出“最影响成交的 3 个问题”，再找出资料中最关键的客户沟通或合作场景逐一复盘。",
      "每个场景必须包含：①沟通对象与当时目标；②当时实际说了什么或做了什么（引用或准确转述并标注资料）；③做得好的地方；④没有聊到位、做错或漏做的销售动作；⑤为什么会影响信任、合作或成交；⑥当时更合理的销售动作；⑦下次遇到同类客户时可直接使用的完整沟通示例，包括提问、承接、价值表达、异议回应和推进下一步；⑧针对当前客户还能怎样补救和跟进。",
      "如果资料是团队内部讨论，要从中发现销售准备、信息判断、分工、报价口径和跟进机制的问题，并给出团队下次应如何讨论与打板；不要写成向团队成员推销。",
      "最后沉淀一份可复用的“同类客户销售打板”：会前准备、关键诊断问题、成交信号、危险信号、价值呈现、异议处理、下一步确认、跟进节奏和团队分工。需要补充的信息单独放在末尾。",
      knowledgeText
    ].join("\n\n");
  }

  return [
    ...introduction,
    "请按以下结构输出：1. 关键事实；2. 专业判断；3. 机会与风险；4. 按优先级排序的行动建议；5. 需要补充的信息。引用事实时注明【资料序号】。",
    knowledgeText
  ].join("\n\n");
}

export function buildKnowledgeEvidencePack(documents: Array<{ id: string; title: string; content: string }>, agentSlug?: string): string {
  const totalBudget = 16_000;
  const perDocumentBudget = Math.max(520, Math.min(2_200, Math.floor(totalBudget / Math.max(documents.length, 1)) - 70));
  return documents.map((document, index) => [
    `【资料 ${index + 1}｜${document.title}】`,
    compactKnowledgeContent(document.content, perDocumentBudget, agentSlug)
  ].join("\n")).join("\n\n").slice(0, totalBudget + documents.length * 70);
}

export function buildAgentKnowledgeRunContext(
  agent: RuntimeAgent,
  documents: KnowledgeContextDocument[],
  options: { subject?: KnowledgeSubjectSummary | null; fallbackIndustry?: string | null } = {}
): string {
  const evidence = buildKnowledgeEvidencePack(documents, agent.slug);
  const voiceStyle = buildIpVoiceStyleContext(documents);
  const subjectContext = buildKnowledgeSubjectContext(options.subject);
  const industryContext = buildPlatformIndustryContext(options.subject?.industry ?? options.fallbackIndustry);
  const shared = [
    "下面是用户本次主动选择的企业私有知识资料。只能使用这些资料中有依据的事实；引用事实时标注【资料序号】，证据不足时写“待核实”，不得虚构原话。",
    "手机贴膜、手机维修和手机配件属于手机后市场；除非资料明确谈论汽车，否则不得归为汽车后市场。",
    agent.marketing?.knowledgeAction?.defaultInstruction
  ];
  if (agent.slug === "acquisition") {
    shared.push("先判断本轮任务主体：如果用户为自己的企业创作，再使用当前企业的身份、产品和目标；如果用户明确在替客户、品牌方或项目方创作，则以该客户项目、目标受众和本次转化目的为准。企业默认画像仅作为服务方背景，不得覆盖当前任务。IP与AI只是部分用户的业务，绝不能套用给所有内容主体。只输出选题方案，不写完整文案，除非用户后续明确要求写文案。");
    shared.push("如果用户后续选择某个选题并要求继续创作或生成完整内容执行包，必须交付：选题策划、60至90秒口播逐字稿、拍摄脚本、拍摄注意事项、剪辑EDL、发布标题与话题、发布时间、评论区引导话术、投流建议；不得只写逐字稿。面向用户统一称为“完整内容执行包”。");
    shared.push("如果用户明确只要完整文案、可直接发布的文案或逐字稿，才只输出60至90秒可直接照读的完整短视频口播逐字稿，口播正文约300至500个汉字。正文必须包含3秒钩子、真实故事或事实展开、核心观点、业务价值、自然承接和收尾；标题、提纲、资料标注和拍摄说明不计入正文，绝不能用标题或三五句话冒充完整文案。");
    shared.push("每个选题都要先判断资料事实属于“已发生”“计划/意向”还是“待核实”。计划、准备、意向、尝试和建议不能写成已经同意、已经成交或已经取得效果；不得为标题虚构一句话、结果、数字、客户态度或因果关系。");
    shared.push("建议切入角度也必须保持资料原意，不能把概念替换成更夸张的新场景。例如“已签保险理赔车辆”不能写成“仓库里已有待修车辆”。AI如何应用若是你的建议，必须明确写成建议，不能写成录音里已经执行的事实。");
  } else if (agent.slug === "sales") {
    shared.push("复盘真实客户对话或团队讨论，按“当时做法—存在问题—影响成交的原因—下次具体说法—当前补救动作”指出问题。团队讨论用于诊断准备、分工、报价口径和跟进机制，不要把团队成员当作销售对象。");
  }
  return [subjectContext, shared.join("\n"), voiceStyle, industryContext, evidence].filter(Boolean).join("\n\n");
}

function parseKnowledgeDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setHours(23, 59, 59, 999);
  return date;
}

function compactKnowledgeContent(content: string, budget: number, agentSlug?: string): string {
  const normalized = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= budget) return normalized;
  const sharedSignals = "结论|总结|机会|风险|问题|建议|下一步|行动|待办|合作|客户|收入|成本|成交|获客|招商|产品|项目";
  const specializedSignals = agentSlug === "sales"
    ? "沟通|对话|提问|回答|报价|预算|决策|异议|需求|意向|跟进|约定|承诺|签约|分工|负责人"
    : agentSlug === "acquisition"
      ? "经历|故事|观点|痛点|冲突|案例|教训|反思|方法|变化|内容|选题"
      : "";
  const signalPattern = new RegExp(`${sharedSignals}${specializedSignals ? `|${specializedSignals}` : ""}`);
  const signals = normalized.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 10 && signalPattern.test(line))
    .filter((line, index, array) => array.indexOf(line) === index)
    .slice(0, 12)
    .join("\n");
  const headBudget = Math.max(280, Math.floor(budget * 0.62));
  const signalBudget = budget - headBudget - 20;
  return `${normalized.slice(0, headBudget)}\n关键线索：\n${signals.slice(0, signalBudget)}`.slice(0, budget);
}

function buildSynthesisPrompt(results: Array<Record<string, any>>, context: AnalysisContext): string {
  return [
    "你是企业经营联合会诊的主报告编辑。下面是多个智能体基于同一批企业私有资料独立给出的分析。",
    context.subject ? `本轮服务主体：${subjectTypeLabel(context.subject.subjectType)}｜${context.subject.name}` : undefined,
    context.identityContext ? `用户身份与专业定位：${context.identityContext}` : undefined,
    context.businessGoal ? `本次业务目标：${context.businessGoal}` : undefined,
    context.factCorrections ? `用户已确认的事实纠正：${context.factCorrections}` : undefined,
    "请综合而不是粗暴压缩：去重、指出共识和分歧、判断优先级，并形成一份可执行的《企业经营联合会诊报告》。不得增加原分析中没有依据的事实。",
    "必须保留各专业智能体的核心交付：获客智能体的具体选题不能被改写成泛化建议；销售智能体的客户话术、团队话术和促成动作不能被省略。",
    "销售复盘不得把明确指出的沟通失误弱化成客套建议，必须保留“当时做法—存在问题—影响成交的原因—下次具体说法—当前补救动作”的对照关系。",
    "报告结构：一、管理层摘要；二、已确认经营事实与用户纠正；三、获客选题方案；四、销售复盘、促成话术与销售打板；五、其他智能体核心判断；六、共识与分歧；七、未来7天行动清单；八、需要用户补充的信息。没有对应智能体结果的章节可省略。",
    ...results.map((item, index) => `【智能体结论 ${index + 1}｜${item.agentName}】\n${item.output}`)
  ].filter(Boolean).join("\n\n");
}

function customerFacingAgentName(agent: Pick<RuntimeAgent, "slug" | "name">): string {
  if (agent.slug === "acquisition") return "获客智能体";
  if (agent.slug === "sales") return "销售智能体";
  return agent.name.replace(/agent/gi, "智能体").replace(/智能体智能体/g, "智能体");
}

function customerFacingAgentDescription(agent: Pick<RuntimeAgent, "slug" | "description">): string {
  if (agent.slug === "acquisition") return "从录音里的真实经历、客户问题和观点中提炼获客选题，只出选题方案，不写整篇文案。";
  if (agent.slug === "sales") return "复盘当时怎么聊，给出更好的提问、推进、促成成交与团队协同话术。";
  return agent.description;
}

function tenantIdentityContext(context: RequestContext): string | undefined {
  const data = context.profile.data ?? {};
  const offer = typeof data.offer === "string" ? data.offer.trim() : "";
  const customer = typeof data.customer === "string" ? data.customer.trim() : "";
  const parts = [
    context.profile.industry ? `行业：${context.profile.industry}` : "",
    context.profile.city ? `所在城市：${context.profile.city}` : "",
    offer ? `核心产品或服务：${offer}` : "",
    customer ? `目标客户：${customer}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join("；") : undefined;
}

function serializeAnalysisContext(context: AnalysisContext): string | undefined {
  const parts = [
    context.subject ? `服务主体：${subjectTypeLabel(context.subject.subjectType)}｜${context.subject.name}` : "",
    context.identityContext ? `身份定位：${context.identityContext}` : "",
    context.businessGoal ? `业务目标：${context.businessGoal}` : "",
    context.factCorrections ? `事实纠正：${context.factCorrections}` : "",
    context.instruction ? `特别要求：${context.instruction}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function knowledgeAgentCreditCost(agent: RuntimeAgent): number {
  const defaultSkill = agent.allowedSkills.find((item) => item.isDefault) ?? agent.allowedSkills[0];
  if (!defaultSkill) return 0;
  return SKILL_MANIFESTS[defaultSkill.skillId as keyof typeof SKILL_MANIFESTS]?.baseCreditCost ?? 0;
}

async function hasKnowledgeCredits(context: RequestContext, amount: number): Promise<boolean> {
  if (context.source === "demo" || amount <= 0) return true;
  const account = await prisma.creditAccount.findUnique({ where: { tenantId: context.tenantId }, select: { balance: true } });
  return Boolean(account && account.balance >= amount);
}

async function consumeKnowledgeCredits(context: RequestContext, batchId: string, charges: Array<{ agentId: string; amount: number }>): Promise<void> {
  const billable = charges.filter((item) => item.amount > 0);
  const total = billable.reduce((sum, item) => sum + item.amount, 0);
  if (context.source === "demo" || total <= 0) return;
  await prisma.$transaction(async (tx: any) => {
    const account = await tx.creditAccount.findUnique({ where: { tenantId: context.tenantId } });
    if (!account || account.balance < total) {
      const error = new Error("企业积分不足，请充值或减少本次调用的智能体。") as Error & { statusCode: number };
      error.statusCode = 402;
      throw error;
    }
    await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { decrement: total } } });
    await tx.creditTransaction.createMany({
      data: billable.map((item) => ({
        creditAccountId: account.id,
        tenantId: context.tenantId,
        userId: context.userId,
        direction: "consume",
        amount: item.amount,
        reason: `knowledge_agent:${item.agentId}`,
        refType: "knowledge_analysis",
        refId: batchId
      }))
    });
  });
}

function safeAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : "analysis_failed";
  if (message === "insufficient_credits") return "积分不足";
  if (message.includes("entitled") || message.includes("access")) return "当前账号无权使用该智能体";
  return "智能体分析暂时失败，请稍后重试";
}

async function verifyPlatformConnection(input: z.infer<typeof platformConnectionSchema>): Promise<{ capabilities: string[]; credentials: Record<string, string | undefined> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    if (input.provider === "feishu") {
      const verified = await verifyFeishuKnowledgeAccess({ appId: input.appId, appSecret: input.appSecret, resourceUrl: input.resourceUrl });
      return {
        capabilities: verified.capabilities,
        credentials: { appId: input.appId, appSecret: input.appSecret, resourceUrl: input.resourceUrl }
      };
    }
    const query = new URLSearchParams({ corpid: input.corpId, corpsecret: input.corpSecret });
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${query.toString()}`, { signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string; access_token?: string };
    if (!response.ok || payload.errcode !== 0 || !payload.access_token) throw new Error(`wecom_${payload.errcode ?? response.status}_${payload.errmsg ?? "invalid_credentials"}`);
    return {
      capabilities: ["credential_verified", "authorised_directory", "no_chat_archive"],
      credentials: { corpId: input.corpId, agentId: input.agentId, corpSecret: input.corpSecret, resourceUrl: input.resourceUrl }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function platformConnectionErrorMessage(reason: string, providerName: "feishu" | "wecom"): string {
  if (/AbortError|fetch failed|ECONNRESET|ETIMEDOUT/i.test(reason)) return "网络超时，请稍后重试。";
  if (providerName === "feishu") return platformSyncErrorMessage("feishu", reason);
  return "请检查企业 ID、应用 Secret，并确认该 Secret 属于已启用的企业自建应用。";
}

function getNoteSyncErrorMessage(reason: string): string {
  if (/getnote_(?:api_)?(?:10001)|http_401|http_403/.test(reason)) {
    return "得到大脑授权已失效，请重新连接并确认 note.content.read 权限。";
  }
  if (/getnote_(?:api_)?(?:10201)/.test(reason)) {
    return "当前得到大脑账号暂不支持该读取接口，请检查会员或开放平台权限。";
  }
  if (/getnote_(?:api_)?(?:10202|42900)|http_429/.test(reason)) {
    return "得到大脑接口当前触发限流，系统已自动重试，请稍后再同步。";
  }
  if (/AbortError|fetch failed|getnote_http_5|getnote_api_(?:30000|50000)/i.test(reason)) {
    return "得到大脑服务暂时不可用或网络超时，请稍后重试。";
  }
  return "得到大脑同步失败，请稍后重试；如果持续失败，请重新检查授权。";
}

function demoKnowledgeStorePath(): string {
  return path.resolve(process.cwd(), env.UPLOAD_DIR, ".demo-knowledge-base.json");
}

async function restoreDemoKnowledgeStore(): Promise<void> {
  if (demoStoreLoaded || env.DATA_MODE !== "demo") return;
  demoStoreLoaded = true;
  try {
    const raw = JSON.parse(await readFile(demoKnowledgeStorePath(), "utf8")) as {
      connections?: DemoConnection[];
      documents?: DemoDocument[];
      subjects?: DemoSubject[];
      batches?: Array<Record<string, any>>;
      syncJobs?: DemoSyncJob[];
    };
    for (const item of raw.connections ?? []) {
      demoConnections.set(item.id, {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        lastSyncedAt: item.lastSyncedAt ? new Date(item.lastSyncedAt) : undefined
      });
    }
    for (const item of raw.documents ?? []) {
      demoDocuments.set(item.id, {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        occurredAt: item.occurredAt ? new Date(item.occurredAt) : undefined,
        externalUpdatedAt: item.externalUpdatedAt ? new Date(item.externalUpdatedAt) : undefined,
        confirmedAt: item.confirmedAt ? new Date(item.confirmedAt) : undefined,
        knowledgeLayer: item.knowledgeLayer ?? "raw_private",
        usagePolicy: item.usagePolicy ?? "recommend",
        sensitivity: item.sensitivity ?? "normal",
        subjectIds: Array.isArray(item.subjectIds) ? item.subjectIds : []
      });
    }
    for (const item of raw.subjects ?? []) {
      demoSubjects.set(item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) });
    }
    for (const item of raw.batches ?? []) {
      demoBatches.set(String(item.id), {
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        completedAt: item.completedAt ? new Date(item.completedAt) : undefined
      });
    }
    for (const item of raw.syncJobs ?? []) {
      demoSyncJobs.set(item.id, {
        ...item,
        createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt),
        heartbeatAt: item.heartbeatAt ? new Date(item.heartbeatAt) : undefined,
        startedAt: item.startedAt ? new Date(item.startedAt) : undefined,
        completedAt: item.completedAt ? new Date(item.completedAt) : undefined,
        lastSuccessfulAt: item.lastSuccessfulAt ? new Date(item.lastSuccessfulAt) : undefined
      });
    }
  } catch {
    // The demo store is optional and is created after the first mutation.
  }
}

async function persistDemoKnowledgeStore(): Promise<void> {
  if (env.DATA_MODE !== "demo") return;
  try {
    const target = demoKnowledgeStorePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({
      connections: [...demoConnections.values()],
      documents: [...demoDocuments.values()],
      subjects: [...demoSubjects.values()],
      batches: [...demoBatches.values()],
      syncJobs: [...demoSyncJobs.values()]
    }), "utf8");
  } catch {
    // Persistence must not break an otherwise successful demo request.
  }
}
