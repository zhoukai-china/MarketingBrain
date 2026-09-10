import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma } from "@baolu/db";
import { PLANS, type PlanDefinition, type TenantBrandingConfig, type TenantDomainView } from "@baolu/shared";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";

const profilePatchSchema = z.object({
  industry: z.string().optional(),
  city: z.string().optional(),
  profile: z.record(z.unknown()).default({})
});

const inferencePatchSchema = z.object({ profile: z.record(z.unknown()).default({}) });

const brandingPatchSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  systemName: z.string().trim().min(2).max(80),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  loginHeadline: z.string().trim().min(2).max(120),
  loginDescription: z.string().trim().min(2).max(300),
  exportFooter: z.string().trim().min(2).max(160)
});

const domainPatchSchema = z.object({ hostname: z.string().trim().min(3).max(253) });

const DEFAULT_BRANDING: TenantBrandingConfig = {
  brandName: "思潼",
  systemName: "思潼AI 行业智能体平台",
  primaryColor: "#1f6a57",
  loginHeadline: "进入思潼AI 行业智能体平台",
  loginDescription: "进入企业专属的智能体工作台，用知识、数据与专业能力持续推动业务增长。",
  exportFooter: "由思潼AI 行业智能体平台生成",
  isCustomized: false
};

const LEGACY_DEFAULT_BRANDING = {
  brandName: "枕水江南",
  systemName: "枕水江南外卖增长智能体",
  loginHeadline: "让 AI 成为枕水江南外卖增长的工作台",
  loginDescription: "导入美团和淘宝闪购经营数据，定位增长瓶颈，生成待审批、可复盘的行动方案。",
  exportFooter: "由枕水江南外卖增长智能体生成 · 供总部审批与门店执行"
} as const;

const demoBrandingByTenant = new Map<string, TenantBrandingConfig>();
interface DemoTenantDomain {
  tenantId: string;
  hostname: string;
  status: "pending" | "verified" | "failed";
  verificationToken: string;
  verifiedAt?: Date;
  lastCheckedAt?: Date;
}
const demoDomainsByTenant = new Map<string, DemoTenantDomain>();
const BRAND_LOGO_MAX_BYTES = 512 * 1024;

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tenant/current", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const branding = context.source === "demo"
      ? demoBrandingByTenant.get(context.tenantId) ?? resolveTenantBranding(context.profile.data)
      : resolveTenantBranding(context.profile.data);
    const domain = context.source === "demo"
      ? demoDomainsByTenant.get(context.tenantId)
      : await prisma.tenantDomain.findUnique({ where: { tenantId: context.tenantId } });
    return {
      dataMode: context.source,
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      plan: (PLANS as Record<string, PlanDefinition>)[context.planCode],
      profile: context.profile,
      branding,
      domain: domain ? buildTenantDomainView(domain) : null,
      profileLayers: context.source === "database"
        ? await prisma.tenantProfile.findUnique({
            where: { tenantId: context.tenantId },
            select: { confirmedData: true, inferredData: true, version: true }
          })
        : { confirmedData: context.profile.data ?? {}, inferredData: {}, version: 1 },
      creditBalance: context.creditBalance
    };
  });

  app.get<{ Querystring: { hostname?: string } }>("/public/tenant-branding", async (request) => {
    const requestedHostname = request.query?.hostname ?? request.headers["x-forwarded-host"] ?? request.headers.host ?? "";
    const hostname = normalizeTenantHostname(Array.isArray(requestedHostname) ? requestedHostname[0] : requestedHostname);
    if (!hostname) return { matched: false, branding: DEFAULT_BRANDING };
    if (env.DATA_MODE === "demo") {
      const domain = [...demoDomainsByTenant.values()].find((item) => item.hostname === hostname && item.status === "verified");
      const branding = domain ? demoBrandingByTenant.get(domain.tenantId) : undefined;
      return { matched: Boolean(domain), hostname, branding: branding ?? DEFAULT_BRANDING };
    }
    const domain = await prisma.tenantDomain.findFirst({
      where: { hostname, status: "verified" },
      include: { tenant: { include: { profile: true } } }
    });
    return {
      matched: Boolean(domain),
      hostname,
      branding: domain ? resolveTenantBranding(domain.tenant.profile?.confirmedData ?? domain.tenant.profile?.data) : DEFAULT_BRANDING
    };
  });

  app.put("/tenant/current/domain", async (request, reply) => {
    const parsed = domainPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_domain", message: "请输入有效的完整域名，例如 ai.example.com。" });
    const hostname = normalizeTenantHostname(parsed.data.hostname);
    if (!hostname) return reply.code(400).send({ error: "invalid_domain", message: "域名不能包含协议、端口或路径。" });
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "domain_admin_required", message: "只有企业老板或管理员可以绑定域名。" });
    }
    if (context.source === "demo") {
      const conflict = [...demoDomainsByTenant.values()].some((item) => item.hostname === hostname && item.tenantId !== context.tenantId);
      if (conflict) return reply.code(409).send({ error: "domain_already_bound", message: "该域名已被其他企业绑定。" });
      const domain: DemoTenantDomain = { tenantId: context.tenantId, hostname, status: "pending", verificationToken: randomUUID().replace(/-/g, "") };
      demoDomainsByTenant.set(context.tenantId, domain);
      return { dataMode: "demo", domain: buildTenantDomainView(domain) };
    }
    const conflict = await prisma.tenantDomain.findUnique({ where: { hostname } });
    if (conflict && conflict.tenantId !== context.tenantId) {
      return reply.code(409).send({ error: "domain_already_bound", message: "该域名已被其他企业绑定。" });
    }
    const domain = await prisma.tenantDomain.upsert({
      where: { tenantId: context.tenantId },
      update: { hostname, status: "pending", verificationToken: randomUUID().replace(/-/g, ""), verifiedAt: null, lastCheckedAt: null },
      create: { tenantId: context.tenantId, hostname, verificationToken: randomUUID().replace(/-/g, "") }
    });
    return { dataMode: "database", domain: buildTenantDomainView(domain) };
  });

  app.post("/tenant/current/domain/verify", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "domain_admin_required", message: "只有企业老板或管理员可以验证域名。" });
    }
    const domain = context.source === "demo"
      ? demoDomainsByTenant.get(context.tenantId)
      : await prisma.tenantDomain.findUnique({ where: { tenantId: context.tenantId } });
    if (!domain) return reply.code(404).send({ error: "domain_not_bound", message: "请先绑定域名。" });
    const verified = await verifyTenantDomainDns(domain.hostname, domain.verificationToken);
    const checkedAt = new Date();
    const status = verified ? "verified" as const : "failed" as const;
    const updated = { ...domain, status, lastCheckedAt: checkedAt, verifiedAt: verified ? checkedAt : undefined };
    if (context.source === "demo") demoDomainsByTenant.set(context.tenantId, updated as DemoTenantDomain);
    else {
      await prisma.tenantDomain.update({
        where: { tenantId: context.tenantId },
        data: { status, lastCheckedAt: checkedAt, verifiedAt: verified ? checkedAt : null }
      });
    }
    return { dataMode: context.source, verified, domain: buildTenantDomainView(updated) };
  });

  app.delete("/tenant/current/domain", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "domain_admin_required", message: "只有企业老板或管理员可以解绑域名。" });
    }
    if (context.source === "demo") demoDomainsByTenant.delete(context.tenantId);
    else await prisma.tenantDomain.deleteMany({ where: { tenantId: context.tenantId } });
    return { dataMode: context.source, removed: true };
  });

  app.patch("/tenant/current/branding", async (request, reply) => {
    const parsed = brandingPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_branding", details: parsed.error.flatten() });
    }
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "branding_admin_required", message: "只有企业老板或管理员可以修改品牌外观。" });
    }
    const current = context.source === "demo"
      ? demoBrandingByTenant.get(context.tenantId) ?? resolveTenantBranding(context.profile.data)
      : resolveTenantBranding(context.profile.data);
    const branding: TenantBrandingConfig = {
      ...current,
      ...parsed.data,
      isCustomized: true
    };
    if (context.source === "demo") {
      demoBrandingByTenant.set(context.tenantId, branding);
      return { dataMode: "demo", updated: true, branding };
    }
    await persistBranding(context.tenantId, branding);
    return { dataMode: "database", updated: true, branding };
  });

  app.post("/tenant/current/branding/logo", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "branding_admin_required", message: "只有企业老板或管理员可以修改品牌 Logo。" });
    }
    const file = await request.file({ limits: { fileSize: BRAND_LOGO_MAX_BYTES, files: 1 } });
    if (!file) return reply.code(400).send({ error: "logo_required" });
    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > BRAND_LOGO_MAX_BYTES) {
      return reply.code(400).send({ error: "invalid_logo_size", message: "Logo 文件需小于 512KB。" });
    }
    const imageType = detectBrandImageType(buffer);
    if (!imageType) {
      return reply.code(400).send({ error: "invalid_logo_type", message: "Logo 仅支持 PNG、JPG 或 WebP。" });
    }
    const tenantSegment = safePathSegment(context.tenantId);
    if (!tenantSegment) return reply.code(400).send({ error: "invalid_tenant_path" });
    const filename = `${randomUUID()}.${imageType.extension}`;
    const brandingRoot = path.resolve(env.UPLOAD_DIR, "branding");
    const tenantDir = path.resolve(brandingRoot, tenantSegment);
    if (!tenantDir.startsWith(`${brandingRoot}${path.sep}`)) {
      return reply.code(400).send({ error: "invalid_tenant_path" });
    }
    await mkdir(tenantDir, { recursive: true });
    await writeFile(path.join(tenantDir, filename), buffer);
    const logoUrl = `/tenant-brand-assets/${encodeURIComponent(tenantSegment)}/${encodeURIComponent(filename)}`;
    const current = context.source === "demo"
      ? demoBrandingByTenant.get(context.tenantId) ?? resolveTenantBranding(context.profile.data)
      : resolveTenantBranding(context.profile.data);
    const branding: TenantBrandingConfig = { ...current, logoUrl, isCustomized: true };
    if (context.source === "demo") demoBrandingByTenant.set(context.tenantId, branding);
    else await persistBranding(context.tenantId, branding);
    return { dataMode: context.source, updated: true, branding };
  });

  app.delete("/tenant/current/branding", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "branding_admin_required", message: "只有企业老板或管理员可以恢复默认品牌。" });
    }
    if (context.source === "demo") demoBrandingByTenant.delete(context.tenantId);
    else await persistBranding(context.tenantId, DEFAULT_BRANDING, true);
    return { dataMode: context.source, updated: true, branding: DEFAULT_BRANDING };
  });

  app.get<{ Params: { tenantId: string; filename: string } }>("/tenant-brand-assets/:tenantId/:filename", async (request, reply) => {
    const tenantId = safePathSegment(request.params.tenantId);
    const filename = safeAssetFilename(request.params.filename);
    if (!tenantId || !filename) return reply.code(404).send({ error: "brand_asset_not_found" });
    const brandingRoot = path.resolve(env.UPLOAD_DIR, "branding");
    const assetPath = path.resolve(brandingRoot, tenantId, filename);
    if (!assetPath.startsWith(`${brandingRoot}${path.sep}`)) return reply.code(404).send({ error: "brand_asset_not_found" });
    try {
      const content = await readFile(assetPath);
      return reply.type(brandAssetMimeType(filename)).header("Cache-Control", "public, max-age=31536000, immutable").send(content);
    } catch {
      return reply.code(404).send({ error: "brand_asset_not_found" });
    }
  });

  app.patch("/tenant/current/profile", async (request, reply) => {
    const parsed = profilePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        updated: true,
        profile: {
          ...context.profile,
          industry: parsed.data.industry ?? context.profile.industry,
          city: parsed.data.city ?? context.profile.city,
          data: {
            ...(context.profile.data ?? {}),
            ...parsed.data.profile
          }
        }
      };
    }

    const { tenant, profile } = await prisma.$transaction(async (tx: any) => {
      const existingProfile = await tx.tenantProfile.findUnique({
        where: {
          tenantId: context.tenantId
        }
      });
      const baseConfirmed = existingProfile?.confirmedData ?? existingProfile?.data;
      const mergedProfileData = {
        ...(typeof baseConfirmed === "string" ? JSON.parse(baseConfirmed) : (isRecord(baseConfirmed) ? baseConfirmed : {})),
        ...parsed.data.profile
      };

      const tenant = await tx.tenant.update({
        where: { id: context.tenantId },
        data: {
          industry: parsed.data.industry,
          city: parsed.data.city
        }
      });
      const profile = await tx.tenantProfile.upsert({
        where: { tenantId: context.tenantId },
        update: {
          data: mergedProfileData,
          confirmedData: mergedProfileData,
          version: { increment: 1 }
        },
        create: {
          tenantId: context.tenantId,
          data: mergedProfileData,
          confirmedData: mergedProfileData,
          inferredData: {}
        }
      });

      return { tenant, profile };
    });

    return {
      dataMode: "database",
      updated: true,
      tenant,
      profile
    };
  });

  app.patch("/tenant/current/profile/inferences", async (request, reply) => {
    const parsed = inferencePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") return { updated: false, dataMode: "demo", inferredData: parsed.data.profile };
    const existing = await prisma.tenantProfile.findUnique({ where: { tenantId: context.tenantId } });
    const inferredData = {
      ...(isRecord(existing?.inferredData) ? existing.inferredData : {}),
      ...parsed.data.profile
    };
    const profile = await prisma.tenantProfile.upsert({
      where: { tenantId: context.tenantId },
      update: { inferredData: inferredData as Prisma.InputJsonValue, version: { increment: 1 } },
      create: {
        tenantId: context.tenantId,
        data: {} as Prisma.InputJsonValue,
        confirmedData: {} as Prisma.InputJsonValue,
        inferredData: inferredData as Prisma.InputJsonValue
      }
    });
    return { updated: true, dataMode: "database", inferredData: profile.inferredData };
  });

  app.post("/tenant/current/profile/confirm-inferences", async (request, reply) => {
    const parsed = inferencePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") return { confirmed: false, dataMode: "demo" };
    const existing = await prisma.tenantProfile.findUnique({ where: { tenantId: context.tenantId } });
    const confirmedData = {
      ...(isRecord(existing?.confirmedData ?? existing?.data) ? (existing?.confirmedData ?? existing?.data) as Record<string, unknown> : {}),
      ...parsed.data.profile
    };
    const remainingInferences = { ...(isRecord(existing?.inferredData) ? existing.inferredData : {}) };
    for (const key of Object.keys(parsed.data.profile)) delete remainingInferences[key];
    const profile = await prisma.tenantProfile.upsert({
      where: { tenantId: context.tenantId },
      update: {
        data: confirmedData as Prisma.InputJsonValue,
        confirmedData: confirmedData as Prisma.InputJsonValue,
        inferredData: remainingInferences as Prisma.InputJsonValue,
        version: { increment: 1 }
      },
      create: {
        tenantId: context.tenantId,
        data: confirmedData as Prisma.InputJsonValue,
        confirmedData: confirmedData as Prisma.InputJsonValue,
        inferredData: remainingInferences as Prisma.InputJsonValue
      }
    });
    return { confirmed: true, dataMode: "database", confirmedData: profile.confirmedData, inferredData: profile.inferredData };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolveTenantBranding(profileData: unknown): TenantBrandingConfig {
  const data = normalizeRecord(profileData);
  const raw = isRecord(data.branding) ? data.branding : {};
  if (isLegacyDefaultBranding(raw)) return DEFAULT_BRANDING;
  const primaryColor = typeof raw.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.primaryColor)
    ? raw.primaryColor
    : DEFAULT_BRANDING.primaryColor;
  return {
    brandName: typeof raw.brandName === "string" && raw.brandName.trim() ? raw.brandName.trim().slice(0, 60) : DEFAULT_BRANDING.brandName,
    systemName: typeof raw.systemName === "string" && raw.systemName.trim() ? raw.systemName.trim().slice(0, 80) : DEFAULT_BRANDING.systemName,
    ...(typeof raw.logoUrl === "string" && raw.logoUrl.startsWith("/tenant-brand-assets/") ? { logoUrl: raw.logoUrl } : {}),
    primaryColor,
    loginHeadline: typeof raw.loginHeadline === "string" && raw.loginHeadline.trim() ? raw.loginHeadline.trim().slice(0, 120) : DEFAULT_BRANDING.loginHeadline,
    loginDescription: typeof raw.loginDescription === "string" && raw.loginDescription.trim() ? raw.loginDescription.trim().slice(0, 300) : DEFAULT_BRANDING.loginDescription,
    exportFooter: typeof raw.exportFooter === "string" && raw.exportFooter.trim() ? raw.exportFooter.trim().slice(0, 160) : DEFAULT_BRANDING.exportFooter,
    isCustomized: raw.isCustomized === true
  };
}

function isLegacyDefaultBranding(raw: Record<string, unknown>): boolean {
  return Object.entries(LEGACY_DEFAULT_BRANDING).every(([key, value]) => raw[key] === value)
    && (!raw.logoUrl || typeof raw.logoUrl !== "string");
}

export function normalizeTenantHostname(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.includes("://") || hostname.includes(":" ) || hostname.includes("/") || hostname === "localhost") return undefined;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return undefined;
  if (hostname.length > 253 || !hostname.includes(".")) return undefined;
  const labels = hostname.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return undefined;
  return hostname;
}

export function buildTenantDomainView(domain: {
  hostname: string;
  status: string;
  verificationToken: string;
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
}): TenantDomainView {
  return {
    hostname: domain.hostname,
    status: domain.status === "verified" ? "verified" : domain.status === "failed" ? "failed" : "pending",
    verificationName: `_sitong-verify.${domain.hostname}`,
    verificationValue: `sitong-domain-verification=${domain.verificationToken}`,
    cnameTarget: env.TENANT_CNAME_TARGET,
    ...(domain.verifiedAt ? { verifiedAt: domain.verifiedAt.toISOString() } : {}),
    ...(domain.lastCheckedAt ? { lastCheckedAt: domain.lastCheckedAt.toISOString() } : {})
  };
}

async function verifyTenantDomainDns(hostname: string, verificationToken: string): Promise<boolean> {
  const expectedTxt = `sitong-domain-verification=${verificationToken}`;
  const verificationName = `_sitong-verify.${hostname}`;
  const [txtResult, cnameResult] = await Promise.allSettled([resolveTxt(verificationName), resolveCname(hostname)]);
  const txtVerified = txtResult.status === "fulfilled" && txtResult.value.some((segments) => segments.join("") === expectedTxt);
  const expectedCname = env.TENANT_CNAME_TARGET.toLowerCase().replace(/\.$/, "");
  const cnameVerified = cnameResult.status === "fulfilled" && cnameResult.value.some((value) => value.toLowerCase().replace(/\.$/, "") === expectedCname);
  return txtVerified || cnameVerified;
}

async function persistBranding(tenantId: string, branding: TenantBrandingConfig, reset = false): Promise<void> {
  const existing = await prisma.tenantProfile.findUnique({ where: { tenantId } });
  const confirmedData = normalizeRecord(existing?.confirmedData ?? existing?.data);
  const mergedData = reset
    ? Object.fromEntries(Object.entries(confirmedData).filter(([key]) => key !== "branding"))
    : { ...confirmedData, branding };
  await prisma.tenantProfile.upsert({
    where: { tenantId },
    update: {
      data: mergedData as Prisma.InputJsonValue,
      confirmedData: mergedData as Prisma.InputJsonValue,
      version: { increment: 1 }
    },
    create: {
      tenantId,
      data: mergedData as Prisma.InputJsonValue,
      confirmedData: mergedData as Prisma.InputJsonValue,
      inferredData: {} as Prisma.InputJsonValue
    }
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function detectBrandImageType(buffer: Buffer): { extension: "png" | "jpg" | "webp" } | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: "jpg" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { extension: "webp" };
  return undefined;
}

function safePathSegment(value: string): string {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "";
}

function safeAssetFilename(value: string): string {
  return /^[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(value) ? value : "";
}

function brandAssetMimeType(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
