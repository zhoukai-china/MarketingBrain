// 兰琪美业门店 AI 经营大脑 · 私域营销 · 无积分直连配图（wan2.7-image / 百炼）
// 复用平台媒体 Provider 的提交/轮询（submitLanqiMedia/getLanqiMediaTask，本身不含积分），
// 结果下载后落租户本地资产，经鉴权接口读取；不创建积分/计费流水。

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@baolu/db";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../../config/env.js";
import { assertOutboundUrlAllowed } from "../../services/outbound-policy.js";
import { getLanqiMediaTask, submitLanqiMedia } from "../../services/lanqi-media-generation.js";

// 落盘根目录沿用平台 UPLOAD_DIR（dev=uploads；生产/测试=绝对路径），避免写入 dist。
const UPLOADS_ROOT = path.resolve(env.UPLOAD_DIR || "uploads");
const IMAGE_MAX_POLL_MS = 90_000;
const IMAGE_POLL_INTERVAL_MS = 4_000;

export interface MomentImageAsset {
  assetId: string;
  url: string;
}

/**
 * 资产 URL 必须跟随**注册作用域**，不能写死。
 *
 * 同一份 handler 在两个作用域下各注册一次：兰琪 `/lanqi`、美业单品 `/beauty-industry`。
 * 取图接口受 `apps/api/src/server.ts` 的产品 entitlement 门禁保护，兰琪租户没有
 * `beauty-industry` 授权，若返回 `/beauty-industry/...` 就是 403 —— 前端再把它当图片
 * 塞进 `<img>`，用户看到破图（QA-20260910-017）。
 */
const DEFAULT_ASSET_BASE_PATH = "/beauty-industry";

function normalizeAssetBasePath(value?: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return DEFAULT_ASSET_BASE_PATH;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function safeImagePrompt(caption: string): string {
  const base = caption.trim().slice(0, 120) || "美业门店温暖氛围场景";
  return `${base}；门店氛围感画面，柔和自然光，质感真实，适合发朋友圈的配图；画面不出现可辨识真人面孔与肖像、不出现文字、商标或 Logo；如表现护理过程只用手部与场景特写。`;
}

const NEGATIVE = "真实人物面孔、肖像、文字、水印、商标、logo、图形标识、低清、模糊、变形、色情、血腥";

function idempotencyKeyOf(tenantId: string, storeId: string, caption: string, external?: string): string {
  if (external) return `moments-image:${tenantId}:${external}`;
  const digest = createHash("sha256").update(`${tenantId}:${storeId}:${caption}`).digest("hex").slice(0, 32);
  return `moments-image:${tenantId}:${digest}`;
}

export async function generateMomentImage(params: {
  tenantId: string;
  userId?: string;
  storeId: string;
  caption: string;
  requestKey?: string;
  /** 注册作用域前缀（`/lanqi` 或 `/beauty-industry`）；缺省保持历史兼容值。 */
  assetBasePath?: string;
}): Promise<MomentImageAsset> {
  const { tenantId, storeId, caption } = params;
  const assetBasePath = normalizeAssetBasePath(params.assetBasePath);
  const assetUrl = (id: string): string => `${assetBasePath}/moments/assets/${id}`;
  const requestKey = idempotencyKeyOf(tenantId, storeId, caption, params.requestKey);
  const existing = await prisma.lanqiMomentAsset.findUnique({ where: { tenantId_requestKey: { tenantId, requestKey } } });
  if (existing) return { assetId: existing.id, url: assetUrl(existing.id) };

  // 用户可见文案不含模型/厂商名（LQ-18 验收条件 3）。
  if (!(env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY)) throw new Error("配图能力暂未开通，请联系服务团队。");
  const input = {
    kind: "image" as const,
    prompt: safeImagePrompt(caption),
    negativePrompt: NEGATIVE,
    ratio: "1:1" as const,
    watermark: false,
    promptVersion: "moments-caption-v1"
  };
  const providerTaskId = await submitLanqiMedia(input as unknown as Parameters<typeof submitLanqiMedia>[0], requestKey);
  const deadline = Date.now() + IMAGE_MAX_POLL_MS;
  let outputUrl: string | undefined;
  while (Date.now() < deadline) {
    const task = await getLanqiMediaTask(providerTaskId);
    if (task.status === "SUCCEEDED" || task.status === "succeeded") {
      outputUrl = task.outputUrl;
      break;
    }
    if (task.status === "FAILED" || task.status === "failed" || task.errorMessage) {
      throw new Error(task.errorMessage ?? "图片生成失败");
    }
    await new Promise((resolve) => setTimeout(resolve, IMAGE_POLL_INTERVAL_MS));
  }
  if (!outputUrl) throw new Error("图片生成超时，请稍后重试");

  const assetId = randomUUID();
  const dir = path.join(UPLOADS_ROOT, "moments", tenantId);
  const file = path.join(dir, `${assetId}.png`);
  const bytes = await downloadProviderFile(outputUrl);
  await mkdir(dir, { recursive: true });
  await writeFile(file, bytes);
  await prisma.lanqiMomentAsset.upsert({
    where: { tenantId_requestKey: { tenantId, requestKey } },
    create: {
      id: assetId,
      tenantId,
      userId: params.userId ?? null,
      storeId,
      requestKey,
      kind: "image",
      name: caption.slice(0, 80),
      url: assetUrl(assetId),
      status: "succeeded"
    },
    update: {}
  });
  return { assetId, url: assetUrl(assetId) };
}

async function downloadProviderFile(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("provider_asset_url_rejected");
  assertOutboundUrlAllowed("Moments image asset download", url, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败 http_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function readMomentAsset(assetId: string, tenantId: string): Promise<Buffer> {
  const asset = await prisma.lanqiMomentAsset.findFirst({
    where: { id: assetId, tenantId },
    select: { id: true }
  });
  if (!asset) throw new Error("asset_not_found");
  const file = path.join(UPLOADS_ROOT, "moments", tenantId, `${assetId}.png`);
  return readFile(file);
}
