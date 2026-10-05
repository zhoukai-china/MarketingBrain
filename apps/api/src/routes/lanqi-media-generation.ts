import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { discardLanqiMediaAsset, lanqiMediaAssetUrl, listLanqiShotFrames, markLanqiMediaAsset, persistLanqiMockImage, persistLanqiMockVideo, persistLanqiProviderImage, persistLanqiProviderVideo, readLanqiMediaAsset } from "../services/lanqi-media-assets.js";
import { generateLanqiShotFrameImage, LANQI_VIDEO_MAX_SECONDS, LANQI_VIDEO_MIN_SECONDS, cancelLanqiMediaTask, getLanqiMediaExecutionReadiness, getLanqiMediaTask, isSameLanqiMediaRequest, quoteLanqiMedia, submitLanqiMedia, validateLanqiMediaRequest, type LanqiMediaRequest } from "../services/lanqi-media-generation.js";
import { createRuntimeLlmProvider } from "../services/llm-provider-factory.js";
import { LANQI_TTS_PREVIEW_TEXT, LANQI_TTS_VOICES, synthesizeLanqiShotVoiceover } from "../services/lanqi-tts.js";
import { resolveLanqiFirstFrameInput, stageLanqiFirstFrame, readLanqiFirstFrame, lanqiFirstFrameRequestFingerprint, lanqiFirstFramePublicUrl, lanqiFirstFrameReferenceUrl, putOssStagedBytes, ossShotFrameKey, ossStagedUrl } from "../services/lanqi-media-staging.js";
import { LANQI_COMPOSE_MAX_SHOTS, LanqiComposeError, composeLanqiShots } from "../services/lanqi-media-compose.js";
import { resolveRequestContext } from "../services/request-context.js";
import { chargeLanqiWallet, readLanqiWalletBalance, refundLanqiWallet } from "../services/lanqi-wallet.js";
import { loadLanqiImagePreview, registerLanqiImageStudioRoutes } from "./lanqi-image-studio.js";

const firstFrameIdPattern = /^lanqi-ff-[A-Za-z0-9]{16,64}$/;
/**
 * 视频侧「首帧图」的两种传法：
 *  · firstFrameId —— 之前已经暂存好的图（第 3 步上传过，第 4 步直接生成）；
 *  · firstFrame —— 本次现传的内容，服务端先落本平台自己的存储再签外链。
 */
type FirstFrameUpload = { contentType: string; dataBase64: string };
type MediaRequestInput = LanqiMediaRequest & { firstFrameId?: string; firstFrame?: FirstFrameUpload };
const mediaRequest = z.object({
  kind: z.enum(["image", "text_to_video", "image_to_video"]), prompt: z.string().trim().min(1).max(5000),
  negativePrompt: z.string().trim().max(5000).optional(), previewId: z.string().trim().regex(/^lanqi-image-[A-Za-z0-9_-]{12,160}$/).optional(),
  promptVersion: z.string().trim().min(1).max(80).optional(),
  resolution: z.enum(["720P", "1080P"]).optional(), ratio: z.enum(["1:1", "3:4", "16:9", "9:16"]).optional(),
  durationSeconds: z.number().int().min(LANQI_VIDEO_MIN_SECONDS).max(LANQI_VIDEO_MAX_SECONDS).optional(), imageUrl: z.string().url().optional(), requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/).optional(),
  firstFrameId: z.string().trim().regex(firstFrameIdPattern).optional(),
  /** 已生成的 AI 首帧（方案④）：用它当图生视频的起幅，不必再传原图。 */
  frameId: z.string().trim().regex(/^lanqi-sf-[A-Za-z0-9]{8,40}$/).optional(),
  firstFrame: z.object({ contentType: z.string().trim().min(3).max(80), dataBase64: z.string().min(16).max(12_000_000) }).optional(),
  /** 台词配音（2026-10-05）：voice = 音色，dialogueText = 该镜口播原句（TTS 合成后 audio_url 对口型）。 */
  voice: z.string().trim().max(40).optional(),
  dialogueText: z.string().trim().max(2000).optional(),
});
const confirmationRequest = mediaRequest.extend({ confirmed: z.literal(true) });
const callback = z.object({ taskId: z.string().min(1), status: z.string().min(1), outputUrl: z.string().url().optional(), errorMessage: z.string().max(500).optional() });
/**
 * LQ-32 合成成片：把已出片的镜次按顺序拼成一条并混入音轨。
 * 音轨只认门店自己上传的文件（音频或带声音的视频），必须先确认使用权。
 */
const composeRequest = z.object({
  shotJobIds: z.array(z.string().trim().min(8).max(120)).min(2).max(LANQI_COMPOSE_MAX_SHOTS),
  audioFileId: z.string().trim().min(8).max(120).optional(),
  audioRightsConfirmed: z.boolean().optional(),
  requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/),
});

type PublicJob = { id: string; previewId?: string; kind: string; status: string; progress: number; creditCost: number; billingStatus: string; assetStatus: string; outputUrl?: string; errorMessage?: string; canCancel: boolean; canRetry: boolean; selectedAt?: string; savedAt?: string; createdAt: string; updatedAt: string; executionMode: "mock" | "real" };
type MockJob = PublicJob & { tenantId: string; requestKey: string; prompt: string; negativePrompt?: string; promptVersion?: string; ratio?: string; refreshCount: number };
const mockJobs = new Map<string, MockJob[]>();

/**
 * 单镜 AI 首帧（2026-10-05 方案④）：按"本镜提示词 + 人物/场景参考图"画出这一镜的起幅，
 * 先出预览给用户看，确认后再拿它当图生视频的 img_url。
 * 参考图走 OSS 签名链接（模型必须能公网抓取）；mock 模式返回占位预览、不调模型、不扣费。
 */
const shotFrameRequest = z.object({
  prompt: z.string().trim().min(1).max(5000),
  negativePrompt: z.string().trim().max(5000).optional(),
  ratio: z.enum(["1:1", "3:4", "16:9", "9:16"]).optional(),
  shotNo: z.number().int().min(1).max(60).optional(),
  scriptKey: z.string().trim().min(4).max(64).optional(),
  personReferenceCount: z.number().int().min(0).max(9).optional(),
  propReferenceCount: z.number().int().min(0).max(9).optional(),
  /**
   * 参考图优先传**已暂存的 ID**（OSS 地址由服务端现签）——请求体几十字节，多镜复用同一份素材不用重传。
   * 只有首次暂存时才走 references 传字节（或直接先调 /lanqi/media/reference 拿 ID）。
   */
  referenceIds: z.array(z.string().trim().regex(firstFrameIdPattern)).max(9).optional(),
  references: z
    .array(z.object({ contentType: z.string().trim().min(3).max(80), dataBase64: z.string().min(16).max(12_000_000) }))
    .max(9)
    .optional(),
  requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/).optional(),
});

export async function registerLanqiMediaGenerationRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  await registerLanqiImageStudioRoutes(app, provider);

  function frameExtensionFor(contentType: string): string {
    const map: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    return map[contentType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? ".png";
  }

  /** 单镜首帧：生成 → 本地留存（供预览） → 推 OSS（供模型抓图） → 返回预览地址。 */
  /** 参考素材暂存一次（大字节只传这一回）→ 拿到 ID，之后每镜只传 ID。 */
  app.post("/lanqi/media/reference", { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = z
      .object({ contentType: z.string().trim().min(3).max(80), dataBase64: z.string().min(16).max(12_000_000) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const staged = await stageLanqiFirstFrame({ tenantId: context.tenantId, contentType: parsed.data.contentType, dataBase64: parsed.data.dataBase64 });
      return { referenceId: staged.firstFrameId, bytes: staged.bytes, contentType: staged.contentType };
    } catch (error) {
      const failure = error as { statusCode?: number; publicMessage?: string; message?: string };
      return reply.code(failure.statusCode && failure.statusCode >= 400 ? failure.statusCode : 500).send({
        error: failure.message ?? "reference_staging_failed",
        message: failure.publicMessage ?? "素材暂存失败，请重新选择。"
      });
    }
  });

  app.post<{ Body: z.infer<typeof shotFrameRequest> }>("/lanqi/media/shot-frame", { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = shotFrameRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (context.source === "demo") return reply.code(409).send({ error: "demo_execution_disabled", message: "当前体验环境不会创建生成任务。" });
    const input = parsed.data;
    const frameId = `lanqi-sf-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const requestKey = input.requestKey ?? `sf-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`.replace(/[^A-Za-z0-9_-]/g, "");
    const readiness = getLanqiMediaExecutionReadiness({ kind: "image" });
    try {
      // 参考图：优先用已暂存的 ID（OSS 地址现签，请求体极小）；没有 ID 才现场暂存字节。
      const referenceImages: string[] = [];
      for (const id of input.referenceIds ?? []) {
        const asset = await readLanqiFirstFrame({ tenantId: context.tenantId, firstFrameId: id });
        if (!asset) return reply.code(422).send({ error: "reference_not_found", message: "有一张参考素材不属于当前门店或已过期，请重新选择素材。" });
        referenceImages.push(await lanqiFirstFrameReferenceUrl({ tenantId: context.tenantId, firstFrameId: id, contentType: asset.metadata.contentType, bytes: asset.bytes }));
      }
      if (!referenceImages.length) {
        for (const ref of input.references ?? []) {
          const staged = await stageLanqiFirstFrame({ tenantId: context.tenantId, contentType: ref.contentType, dataBase64: ref.dataBase64 });
          referenceImages.push(await lanqiFirstFramePublicUrl({ tenantId: context.tenantId, firstFrameId: staged.firstFrameId, contentType: staged.contentType }));
        }
      }
      if (readiness.mode !== "real" || !readiness.canConfirm || !readiness.billable) {
        // mock / 未放行：落占位预览，页面照样能看到"每镜一张首帧"的流程，不调模型、不扣费。
        await persistLanqiMockImage({ tenantId: context.tenantId, jobId: frameId, prompt: input.prompt, ratio: input.ratio, label: "AI 首帧（模拟预览）", shotNo: input.shotNo, scriptKey: input.scriptKey });
        request.log.info({ event: "lanqi_shot_frame.mock", tenantId: context.tenantId, frameId, shotNo: input.shotNo ?? null });
        return { frameId, previewUrl: lanqiMediaAssetUrl(frameId), status: "succeeded", executionMode: readiness.mode, simulated: true };
      }
      // 身份锁定 + 场景指定：wan2.7 带图输入是「参考/编辑」语义，必须显式告诉模型每张参考图的角色——
      // 人物图保持长相、场景图定背景，否则要么人物跑偏、要么门店场景用不上（2026-10-05 用户实测两者）。
      // 参考图顺序（前端保证）：场景照（底图/画布）→ 道具照（0–1 张）→ 人物照。
      // 底图语义 = 背景像素级就是场景照本身；传了图的部分，镜头描述里的对应文字一律无效（不允许模型自由发挥）。
      const personCount = Math.max(0, Math.min(input.personReferenceCount ?? 0, referenceImages.length));
      const propCount = Math.max(0, Math.min(input.propReferenceCount ?? 0, Math.max(0, referenceImages.length - personCount - 1)));
      const sceneCount = Math.max(0, referenceImages.length - personCount - propCount);
      // 传了场景底图：镜头描述里的背景/环境文字会让模型偏离场景照（用户实测"人物还是在前台背景下"）。
      // 用一次轻量 LLM 调用把背景/环境/陈设描写剥干净——最终提示词里不存在背景文字，模型无从发挥。
      let effectiveShotPrompt = input.prompt;
      if (sceneCount > 0) {
        try {
          effectiveShotPrompt = await stripBackgroundFromShotPrompt(input.prompt);
        } catch {
          /* 剥离失败就用原文，编辑指令仍然兜底 */
        }
      }
      // 提示词格式实测（2026-10-05 A/B）：角色标注式会让背景跟人物照走；只有【编辑指令式】
      //（"编辑第一张图：保持背景不变，把第X张的人物放进场景"）才能让背景像素级贴合场景照。
      let shotFramePrompt = input.prompt;
      if (sceneCount > 0) {
        shotFramePrompt = `编辑第一张图（门店场景照片）：保持第一张图中的一切背景元素（门头招牌、建筑、陈设、装饰、光线）完全不变，把${propCount > 0 ? "第2张照片中的道具和" : ""}第${sceneCount + propCount + 1}张照片中的人物放进这个场景。${effectiveShotPrompt} 人物的长相、发型、性别年龄与人物照片完全一致，不要换脸、不要替换成其他人、不要美颜变形。`;
      } else if (personCount > 0 || propCount > 0) {
        shotFramePrompt = `${propCount > 0 ? "道具必须与道具照片一致（外观、颜色、材质），忽略镜头描述中的道具文字。" : ""}${personCount > 0 ? "人物必须与人物照片完全一致（长相、脸型、发型、性别年龄），不要换脸。" : ""}按下面的镜头描述出图：\n${input.prompt}`;
      }
      const imageUrl = await generateLanqiShotFrameImage({
        input: { kind: "image", prompt: shotFramePrompt, negativePrompt: input.negativePrompt, ratio: input.ratio, referenceImages, watermark: false },
        requestKey
      });
      const metadata = await persistLanqiProviderImage({ tenantId: context.tenantId, jobId: frameId, sourceUrl: imageUrl, shotNo: input.shotNo, scriptKey: input.scriptKey });
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: frameId });
      const extension = frameExtensionFor(metadata.contentType);
      // 推 OSS：视频模型要能公网抓取这张首帧。失败不阻断预览（出片时会再试一次）。
      let ossUrl: string | undefined;
      try {
        await putOssStagedBytes({ key: ossShotFrameKey(context.tenantId, frameId, extension), contentType: metadata.contentType, bytes: asset.bytes });
        ossUrl = await ossStagedUrl({ key: ossShotFrameKey(context.tenantId, frameId, extension) });
      } catch {
        ossUrl = undefined;
      }
      request.log.info({ event: "lanqi_shot_frame.generated", tenantId: context.tenantId, frameId, shotNo: input.shotNo ?? null, refs: referenceImages.length, oss: Boolean(ossUrl) });
      return { frameId, previewUrl: lanqiMediaAssetUrl(frameId), status: "succeeded", executionMode: "real", ossReady: Boolean(ossUrl) };
    } catch (error) {
      request.log.error({ event: "lanqi_shot_frame.failed", tenantId: context.tenantId, frameId, message: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      return reply.code(502).send({ error: "shot_frame_generation_failed", message: "这一镜的 AI 首帧没生成出来；本次没有扣算力，可以重试一次。" });
    }
  });

  /** 首帧预览：带登录态读取本租户自己那张（不外链、不可遍历）。 */
  app.get<{ Params: { frameId: string } }>("/lanqi/media/shot-frame/:frameId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.frameId });
      return reply.header("Content-Type", asset.metadata.contentType).header("Cache-Control", "private, no-store").send(asset.bytes);
    } catch {
      return reply.code(404).send({ error: "shot_frame_not_found" });
    }
  });

  /** 门店确认首帧（2026-10-05）：确认状态记在服务端（selectedAt），重建分镜/换浏览器都能恢复。 */
  app.post<{ Params: { frameId: string } }>("/lanqi/media/shot-frame/:frameId/confirm", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    try {
      const metadata = await markLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.frameId, action: "select" });
      return { selectedAt: metadata.selectedAt };
    } catch {
      return reply.code(404).send({ error: "shot_frame_not_found" });
    }
  });

  /** TTS 音色列表（前端渲染选择器用）。 */
  app.get("/lanqi/media/tts-voices", async (_request, reply) => {
    return reply.send({ voices: LANQI_TTS_VOICES });
  });

  /** 台词试听 / 合成：文本 → qwen-tts 语音（base64 供试听；正式出片时同样走这个合成再转 OSS）。 */
  app.post("/lanqi/media/tts", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = z.object({ text: z.string().trim().min(1).max(2000), voice: z.string().trim().max(40).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const { audioUrl, size, base64 } = await synthesizeLanqiShotVoiceover({ tenantId: context.tenantId, text: parsed.data.text || LANQI_TTS_PREVIEW_TEXT, voice: parsed.data.voice ?? "Cherry" });
      return reply.send({ audioBase64: base64, audioUrl, size });
    } catch (error) {
      request.log.warn({ event: "lanqi_tts.failed", message: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      return reply.code(502).send({ error: "tts_failed", message: "这句台词没合成出来，请稍后再试或换一个音色。" });
    }
  });

  /** 本租户最近生成的单镜首帧列表：页面挂载时据此找回首帧（服务端记账，浏览器丢状态也能恢复）。 */
  app.get("/lanqi/media/shot-frames", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const frames = await listLanqiShotFrames({ tenantId: context.tenantId, limit: 120 });
    return reply.send({ frames });
  });

  app.post<{ Body: z.infer<typeof mediaRequest> }>("/lanqi/media/quote", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = mediaRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const bound = await bindTrustedImagePreview(context, parsed.data);
    if (!bound.ok) return reply.code(bound.statusCode).send({ error: bound.error, message: bound.message });
    const frame = await bindLanqiFirstFrame(context, bound.input);
    if (!frame.ok) return reply.code(frame.statusCode).send({ error: frame.error, message: frame.message });
    const input = frame.input;
    const issue = validateLanqiMediaRequest(input);
    if (issue) return reply.code(400).send({ error: "invalid_media_request", message: issue });
    const readiness = getLanqiMediaExecutionReadiness(input);
    const quote = quoteLanqiMedia(input);
    const authorization = await resolveLanqiMediaAuthorization(context, readiness, quote.creditCost, input.kind);
    request.log.info({ event: "lanqi_image_generation.quoted", tenantId: context.tenantId, previewId: input.previewId, promptVersion: input.promptVersion, mode: readiness.mode, canConfirm: authorization.canConfirm, blockCode: authorization.blockCode });
    // 用户 2026-09-16 口径：**不显示人民币消耗**，报价只回算力（不再回 customerPriceYuan）。
    return { creditCost: quote.creditCost, canConfirm: authorization.canConfirm, billable: authorization.canConfirm && readiness.billable, executionMode: readiness.mode,
      blockCode: authorization.blockCode,
      message: authorization.canConfirm ? readiness.mode === "mock" ? "受控模拟生成已就绪；不会调用外部模型或扣算力。" : "费用已锁定；再次确认后才创建任务并预留算力。" : authorization.message,
      externalAction: "confirmation_required", aiWatermark: true, storage: readiness.mode === "mock" ? "controlled_mock" : readiness.storage };
  });

  app.post<{ Body: z.infer<typeof confirmationRequest> }>("/lanqi/media/confirm", async (request, reply) => {
    const parsed = confirmationRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "explicit_confirmation_required", message: "请在费用预览后明确确认本次生成。" });
    const context = await resolveRequestContext(request.headers);
    const bound = await bindTrustedImagePreview(context, parsed.data);
    if (!bound.ok) return reply.code(bound.statusCode).send({ error: bound.error, message: bound.message });
    const frame = await bindLanqiFirstFrame(context, bound.input);
    if (!frame.ok) return reply.code(frame.statusCode).send({ error: frame.error, message: frame.message });
    const input = frame.input;
    const issue = validateLanqiMediaRequest(input);
    if (issue) return reply.code(400).send({ error: "invalid_media_request", message: issue });
    const readiness = getLanqiMediaExecutionReadiness(input);
    const requestKey = input.requestKey ?? String(request.headers["x-idempotency-key"] ?? randomUUID());
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestKey)) return reply.code(400).send({ error: "invalid_request_key" });
    // 指纹取「稳定暂存 ID」优先；只有外部直传 imageUrl 时才退化成原始 URL（绝不是签名外链）。
    const firstFrameFingerprint = lanqiFirstFrameRequestFingerprint({ kind: input.kind, firstFrameId: frame.firstFrameId, imageUrl: input.imageUrl });
    if (readiness.mode === "mock") {
      if (!readiness.canConfirm) return reply.code(409).send({ error: "media_execution_blocked", message: readiness.blockedReason });
      try {
        const result = createMockJob(context.tenantId, requestKey, input);
        request.log.info({ event: "lanqi_image_generation.requested", tenantId: context.tenantId, previewId: input.previewId, jobId: result.job.id, mode: "mock", idempotent: result.idempotent });
        return reply.code(result.idempotent ? 200 : 202).send(result);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) return reply.code(409).send({ error: "request_key_conflict", message: "本次输入已经变化，请重新发起生成。" });
        throw error;
      }
    }
    if (context.source === "demo") return reply.code(409).send({ error: "demo_execution_disabled", message: "当前体验环境不会创建付费生成任务，也不会扣算力。" });
    const existing = await prisma.lanqiMediaJob.findFirst({ where: { tenantId: context.tenantId, requestKey } });
    if (existing) {
      if (!sameRequest(existing, input, firstFrameFingerprint)) return reply.code(409).send({ error: "request_key_conflict", message: "本次输入已经变化，请重新发起生成。" });
      return { job: serialize(existing), idempotent: true };
    }
    const quote = quoteLanqiMedia(input);
    const authorization = await resolveLanqiMediaAuthorization(context, readiness, quote.creditCost, input.kind);
    if (!authorization.canConfirm) return reply.code(authorization.blockCode === "quota_exhausted" ? 429 : 409).send({ error: authorization.blockCode ?? "media_execution_blocked", message: authorization.message });
    let job: any;
    /**
     * LQ-34（用户 2026-09-16）：扣**通用钱包**（本店老板）而不是租户算力账户。
     *
     * 钱包扣费/退款各自带事务，不能塞进建任务那个事务里，所以顺序是：
     *   ① 先扣钱包（同 requestKey 幂等）→ ② 再建任务；③ 建任务若不是「同键并发」而是别的错，
     *   立刻补偿退款（幂等键相同，不会重复退）。
     */
    const walletCharge = await chargeLanqiWallet({
      tenantId: context.tenantId,
      operatorUserId: context.userId,
      requestId: requestKey,
      credits: quote.creditCost,
      skillId: "lanqi_media_generation"
    });
    if (walletCharge.status === "owner_missing") {
      return reply.code(409).send({ error: "lanqi_wallet_owner_missing", message: "本店还没有可扣费的老板账号，本次没有创建任务或扣费。" });
    }
    if (walletCharge.status === "insufficient") {
      return reply.code(402).send({ error: "insufficient_credits", message: "算力不足，本次没有创建任务或扣费。", balance: walletCharge.wallet.balance, required: quote.creditCost, rechargeUrl: "/recharge" });
    }
    if (walletCharge.status === "refunded") {
      // 同一个 requestKey 之前已经退过款：不能再放行（钱包扣费本身同键幂等，放行就等于白送一次付费任务）。
      return reply.code(409).send({ error: "request_already_refunded", message: "这次请求之前已经退款处理过了，同一个单号不能重复使用，请重新发起（会重新计费）。" });
    }
    try {
      job = await prisma.lanqiMediaJob.create({ data: { tenantId: context.tenantId, userId: context.userId, requestKey, kind: input.kind, provider: quote.provider, model: quote.model,
          previewId: input.previewId, promptVersion: input.promptVersion ?? "unknown", prompt: input.prompt, negativePrompt: input.negativePrompt,
          parameters: { ratio: input.ratio, resolution: input.resolution, durationSeconds: input.durationSeconds, watermark: false, firstFrameId: firstFrameFingerprint } as Prisma.InputJsonValue,
          imageUrl: input.imageUrl, resolution: input.resolution, ratio: input.ratio, durationSeconds: input.durationSeconds, creditCost: quote.creditCost } });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 402) return reply.code(402).send({ error: "insufficient_credits", message: "算力不足，本次没有创建任务或扣费。" });
      if ((error as { code?: string }).code === "P2002") {
        const concurrent = await prisma.lanqiMediaJob.findFirst({ where: { tenantId: context.tenantId, requestKey } });
        if (concurrent && sameRequest(concurrent, input, firstFrameFingerprint)) return { job: serialize(concurrent), idempotent: true };
      }
      throw error;
    }
    // 台词配音（2026-10-05）：该镜有口播原句且选了音色 → TTS 合成并转 OSS，模型按音频对口型。
    if (input.kind === "image_to_video" && input.dialogueText && input.voice) {
      try {
        const voiceover = await synthesizeLanqiShotVoiceover({ tenantId: context.tenantId, text: input.dialogueText, voice: input.voice });
        input.audioUrl = voiceover.audioUrl;
        request.log.info({ event: "lanqi_tts.shot_voiceover", tenantId: context.tenantId, size: voiceover.size });
      } catch (error) {
        // 配音失败不阻塞出片：继续生成（模型自动配音兜底）。
        request.log.warn({ event: "lanqi_tts.shot_voiceover_failed", message: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      }
    }
    // 背景一致性（2026-10-05 用户实测：i2v 第 2 秒背景漂走）：图生视频 = 第一帧的连续动画，
    // 提示词里的背景/环境描写会把场景拉向泛化布景——先剥离，再显式声明全程锁首帧场景。
    if (input.kind === "image_to_video" && (input.frameId || input.imageUrl)) {
      try {
        const stripped = await stripBackgroundFromShotPrompt(input.prompt);
        // 固定机位（2026-10-05 用户拍板）：全部镜头不带运镜，镜头锁死，只有人物动作/表情/说话。
        input.prompt = `单镜头连续实拍：固定机位，镜头全程固定不动（三脚架锁定，不要推拉摇移、不要运镜、不要变焦），只有人物的动作、表情和说话。全程停留在首帧图片的同一场景内，背景、陈设、光线绝不切换到其他地点，不要转场、不要换布景；镜头描述里若有任何运镜/推近拉远的文字一律忽略。${stripped}`;
      } catch {
        /* 剥离失败保留原文 */
      }
    }
    try {
      const providerTaskId = await submitLanqiMedia(input, requestKey);
      job = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: "submitted", providerTaskId, providerStatus: "PENDING" } });
      request.log.info({ event: "lanqi_image_generation.submitted", tenantId: context.tenantId, previewId: input.previewId, jobId: job.id });
      return reply.code(202).send({ job: serialize(job), idempotent: false });
    } catch (error) {
      job = await refund(job, "failed", error instanceof Error ? error.message : "provider_failed");
      request.log.error({ event: "lanqi_image_generation.failed", tenantId: context.tenantId, previewId: input.previewId, jobId: job.id, stage: "submit" });
      return reply.code(502).send({ error: "provider_submission_failed", message: "图片任务提交失败，预留算力已自动退回。", job: serialize(job) });
    }
  });

  app.get<{ Querystring: { kind?: string } }>("/lanqi/media/jobs", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const kinds = parseLanqiMediaJobKinds(request.query?.kind);
    if (!kinds) return reply.code(400).send({ error: "invalid_kind_filter", message: "任务类型筛选不合法。" });
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") return { jobs: (mockJobs.get(context.tenantId) ?? []).map(toPublicMock) };
    if (context.source === "demo") return { jobs: [] };
    const jobs = await prisma.lanqiMediaJob.findMany({ where: { tenantId: context.tenantId, kind: { in: kinds } }, orderBy: { createdAt: "desc" }, take: 30 });
    return { jobs: jobs.map(serialize) };
  });

  app.post<{ Params: { jobId: string } }>("/lanqi/media/jobs/:jobId/refresh", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = await refreshMockJob(context.tenantId, request.params.jobId);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (isTimedOut(job)) {
      if (job.providerTaskId) await cancelLanqiMediaTask(job.providerTaskId).catch(() => undefined);
      const timedOut = await refund(job, "failed", "media_task_timeout");
      return reply.code(504).send({ error: "media_task_timeout", message: "生成超时，本次预留算力已自动退回，可以重新生成。", job: serialize(timedOut) });
    }
    if (!job.providerTaskId || terminal(job.status)) return { job: serialize(job) };
    try {
      const provider = await getLanqiMediaTask(job.providerTaskId);
      const status = provider.status.toLowerCase();
      if (["succeeded", "success"].includes(status)) {
        if (!provider.outputUrl) throw new Error("provider_output_missing");
        await persistLanqiProviderOutput(job, provider.outputUrl);
        const finalized = await finalizeSuccess(job, provider.status);
        if (!finalized.accepted) await discardLanqiMediaAsset({ tenantId: job.tenantId, jobId: job.id });
        const updated = finalized.job;
        request.log.info({ event: "lanqi_image_generation.succeeded", tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
        return { job: serialize(updated) };
      }
      if (["failed", "error", "canceled"].includes(status)) return { job: serialize(await refund(job, status === "canceled" ? "canceled" : "failed", provider.errorMessage ?? "provider_failed")) };
      const updated = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: status === "pending" ? "submitted" : "processing", providerStatus: provider.status } });
      return { job: serialize(updated) };
    } catch (error) {
      if (error instanceof Error && isAssetPersistenceFailure(error.message)) {
        const failed = await refund(job, "failed", error.message);
        return reply.code(502).send({ error: "media_asset_persistence_failed", message: "生成完成但保存失败，预留算力已自动退回。", job: serialize(failed) });
      }
      return reply.code(502).send({ error: "media_refresh_failed", message: "生成状态暂时无法刷新，请稍后再试。" });
    }
  });

  app.post<{ Params: { jobId: string } }>("/lanqi/media/jobs/:jobId/cancel", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const existing = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!existing) return reply.code(404).send({ error: "job_not_found" });
      if (terminal(existing.status)) return reply.code(409).send({ error: "job_not_cancelable", message: "任务已结束，不能取消。" });
      const job = cancelMockJob(context.tenantId, request.params.jobId)!;
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (terminal(job.status)) return reply.code(409).send({ error: "job_not_cancelable", message: "任务已结束，不能取消。" });
    if (!job.providerTaskId || job.providerStatus?.toLowerCase() === "pending") {
      if (job.providerTaskId) {
        try { await cancelLanqiMediaTask(job.providerTaskId); }
        catch { return reply.code(409).send({ error: "provider_cancel_rejected", message: "任务已开始处理，供应商不再允许取消；可继续查看结果。" }); }
      }
      const canceled = await refund(job, "canceled", "user_canceled");
      request.log.info({ event: "lanqi_image_generation.canceled", tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
      return { job: serialize(canceled) };
    }
    return reply.code(409).send({ error: "job_not_cancelable", message: "任务已开始处理，当前不能取消。" });
  });

  app.post<{ Params: { jobId: string; action: string } }>("/lanqi/media/jobs/:jobId/assets/:action", async (request, reply) => {
    if (!(["select", "save"] as string[]).includes(request.params.action)) return reply.code(404).send({ error: "unknown_media_action" });
    const action = request.params.action as "select" | "save";
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = await markMockJob(context.tenantId, request.params.jobId, action);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      if (job.status !== "succeeded") return reply.code(409).send({ error: "asset_not_ready", message: "图片尚未生成成功。" });
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (job.status !== "succeeded" || job.assetStatus !== "persisted") return reply.code(409).send({ error: "asset_not_ready", message: "图片尚未保存完成。" });
    const metadata = await markLanqiMediaAsset({ tenantId: context.tenantId, jobId: job.id, action });
    const updated = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: action === "select" ? { selectedAt: new Date(metadata.selectedAt!) } : { selectedAt: new Date(metadata.selectedAt!), savedAt: new Date(metadata.savedAt!) } });
    request.log.info({ event: `lanqi_image_generation.${action === "select" ? "selected" : "saved"}`, tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
    return { job: serialize(updated) };
  });

  app.get<{ Params: { jobId: string } }>("/lanqi/media/assets/:jobId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!job || job.status !== "succeeded") return reply.code(404).send({ error: "media_asset_not_found" });
    } else {
      const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId, status: "succeeded", assetStatus: "persisted" } });
      if (!job) return reply.code(404).send({ error: "media_asset_not_found" });
    }
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.jobId });
      return reply.header("Content-Type", asset.metadata.contentType).header("Cache-Control", "private, max-age=3600").send(asset.bytes);
    } catch (error) {
      request.log.warn({
        event: "lanqi_media_asset.read_failed",
        jobFingerprint: request.params.jobId.slice(0, 8),
        errorCode: error instanceof Error ? error.message : "unknown_asset_read_error",
      });
      return reply.code(404).send({ error: "media_asset_not_found" });
    }
  });

  app.get<{ Params: { jobId: string } }>("/lanqi/media/assets/:jobId/download", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!job || job.status !== "succeeded") return reply.code(404).send({ error: "media_asset_not_found" });
    } else {
      const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId, status: "succeeded", assetStatus: "persisted" } });
      if (!job) return reply.code(404).send({ error: "media_asset_not_found" });
    }
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.jobId });
      const isVideo = asset.metadata.contentType === "video/mp4";
      const extension = isVideo ? "mp4" : asset.metadata.contentType === "image/jpeg" ? "jpg" : asset.metadata.contentType === "image/webp" ? "webp" : "png";
      const fileName = `${isVideo ? "lanqi-video" : "lanqi-xhs"}-${request.params.jobId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}.${extension}`;
      request.log.info({ event: isVideo ? "lanqi_video.downloaded" : "lanqi_xhs_package.downloaded", tenantId: context.tenantId, jobFingerprint: request.params.jobId.slice(0, 8) });
      return reply
        .header("Content-Type", asset.metadata.contentType)
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .header("Cache-Control", "private, no-store")
        .send(asset.bytes);
    } catch {
      return reply.code(404).send({ error: "media_asset_not_found" });
    }
  });

  /**
   * LQ-32：合成成片。逐镜出片是**无声**的（视频模型不下发 audio），所以「一键成片」
   * 真正能交付一条完整片子，必须支持把逐镜画面拼起来并混入门店自己的音轨。
   * 合片与混音全部走本机 ffmpeg，不调用外部付费接口，因此不额外扣算力。
   */
  app.post<{ Body: z.infer<typeof composeRequest> }>("/lanqi/media/compose", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = composeRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_compose_request", message: "合成参数不完整，请刷新页面后重试。" });
    try {
      const compose = await composeLanqiShots({
        tenantId: context.tenantId,
        shotJobIds: parsed.data.shotJobIds,
        audioFileId: parsed.data.audioFileId,
        audioRightsConfirmed: parsed.data.audioRightsConfirmed,
        requestKey: parsed.data.requestKey,
      });
      if (!compose.idempotent) {
        request.log.info({
          event: "lanqi_media.composed",
          tenantId: context.tenantId,
          composeFingerprint: compose.composeId.slice(0, 8),
          shotCount: compose.shotCount,
          audioIncluded: compose.audioIncluded,
          audioSource: compose.audioSource ?? "none",
          durationSeconds: compose.durationSeconds,
          bytes: compose.bytes,
        });
      }
      return { compose };
    } catch (error) {
      if (error instanceof LanqiComposeError) {
        request.log.warn({ event: "lanqi_media.compose_rejected", tenantId: context.tenantId, errorCode: error.code });
        return reply.code(error.status).send({ error: error.code, message: error.message });
      }
      request.log.error({ event: "lanqi_media.compose_error", tenantId: context.tenantId, errorCode: error instanceof Error ? error.message : "unknown" });
      return reply.code(502).send({ error: "compose_failed", message: "合成失败，本次没有产出成片，请重试。" });
    }
  });

  app.get<{ Params: { composeId: string } }>("/lanqi/media/compose/:composeId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (!/^cmp-[A-Za-z0-9]{8,64}$/.test(request.params.composeId)) return reply.code(404).send({ error: "compose_not_found" });
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.composeId });
      return reply.header("Content-Type", asset.metadata.contentType).header("Cache-Control", "private, max-age=3600").send(asset.bytes);
    } catch (error) {
      request.log.warn({
        event: "lanqi_media.compose_read_failed",
        tenantId: context.tenantId,
        composeFingerprint: request.params.composeId.slice(0, 8),
        errorCode: error instanceof Error ? error.message : "unknown_compose_read_error",
      });
      return reply.code(404).send({ error: "compose_not_found" });
    }
  });

  app.get<{ Params: { composeId: string } }>("/lanqi/media/compose/:composeId/download", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (!/^cmp-[A-Za-z0-9]{8,64}$/.test(request.params.composeId)) return reply.code(404).send({ error: "compose_not_found" });
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.composeId });
      const fileName = `lanqi-composed-${request.params.composeId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}.mp4`;
      request.log.info({ event: "lanqi_media.composed_downloaded", tenantId: context.tenantId, composeFingerprint: request.params.composeId.slice(0, 8) });
      return reply
        .header("Content-Type", asset.metadata.contentType)
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .header("Cache-Control", "private, no-store")
        .send(asset.bytes);
    } catch {
      return reply.code(404).send({ error: "compose_not_found" });
    }
  });

  app.post<{ Body: z.infer<typeof callback> }>("/lanqi/media/callbacks/aliyun", async (request, reply) => {
    const token = String(request.headers["x-aliyun-media-token"] ?? "");
    if (!safe(token, env.ALIYUN_MEDIA_GENERATION_CALLBACK_TOKEN)) return reply.code(401).send({ error: "unauthorized_callback" });
    const parsed = callback.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_callback" });
    const job = await prisma.lanqiMediaJob.findUnique({ where: { providerTaskId: parsed.data.taskId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    const status = parsed.data.status.toLowerCase();
    if (["succeeded", "success"].includes(status) && parsed.data.outputUrl) {
      try {
        await persistLanqiProviderOutput(job, parsed.data.outputUrl);
        const finalized = await finalizeSuccess(job, parsed.data.status);
        if (!finalized.accepted) await discardLanqiMediaAsset({ tenantId: job.tenantId, jobId: job.id });
      } catch (error) { await refund(job, "failed", error instanceof Error ? error.message : "asset_persistence_failed"); }
    } else if (["failed", "error", "canceled"].includes(status)) await refund(job, status === "canceled" ? "canceled" : "failed", parsed.data.errorMessage ?? "provider_failed");
    else await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: "processing", providerStatus: parsed.data.status } });
    return { ok: true };
  });
}

/** 图片与成片共用同一条租户隔离落盘链路，按任务类型选择对应的格式校验规则。 */
/**
 * 镜头描述背景剥离（2026-10-05）：传了场景底图后，提示词里残留的背景/环境/陈设描写
 * 会拉着模型偏离场景照。这里用一次轻量 LLM 调用把它们删掉，只留人物动作/表情/景别/构图。
 * 失败由调用方兜底（用原文 + 覆盖规则）。
 */
async function stripBackgroundFromShotPrompt(prompt: string): Promise<string> {
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) return prompt;
  const raw = await provider.complete([
    {
      role: "system",
      content: [
        "你是生图提示词清洗器。把镜头描述里所有关于背景、环境、场景、陈设、地点的描写删掉",
        "（例如「站在门店前台」「背景是产品货架」「店内氛围安静」这类），",
        "只保留：人物动作、表情、景别、构图、光影质感词；运镜相关的词一并删掉（成片统一固定机位）。",
        "直接输出清洗后的描述正文；不要解释、不要 Markdown、不要加引号；不要自己新增内容。"
      ].join("\n")
    },
    { role: "user", content: prompt }
  ], { maxTokens: 800, reasoningProfile: "standard", thinkingMode: "disabled" });
  const cleaned = raw.trim().replace(/^["'「『]+/, "").replace(/["'」』]+$/, "").trim();
  return cleaned || prompt;
}

async function persistLanqiProviderOutput(job: { id: string; tenantId: string; kind: string }, sourceUrl: string) {
  return job.kind === "image"
    ? persistLanqiProviderImage({ tenantId: job.tenantId, jobId: job.id, sourceUrl })
    : persistLanqiProviderVideo({ tenantId: job.tenantId, jobId: job.id, sourceUrl });
}

/** 只有「供应商已出结果、但结果不能安全落盘」才退款；网络抖动仍按可重试处理。 */
function isAssetPersistenceFailure(message: string): boolean {
  return /^(provider_output_missing|media_asset_(storage_not_ready|invalid_content_type|invalid_size|invalid_container|too_large)|media_asset_download_\d{3})$/.test(message);
}

const LANQI_MEDIA_JOB_KINDS = ["image", "text_to_video", "image_to_video"] as const;

/** 媒体任务列表默认只回图片（旧工作台行为不变）；视频页显式传 kind=image_to_video。 */
function parseLanqiMediaJobKinds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return ["image"];
  if (typeof value !== "string") return undefined;
  const requested = [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
  if (!requested.length || requested.length > LANQI_MEDIA_JOB_KINDS.length) return undefined;
  return requested.every(kind => (LANQI_MEDIA_JOB_KINDS as readonly string[]).includes(kind)) ? requested : undefined;
}

async function refund(job: any, finalStatus: "failed" | "canceled", message: string) {
  /**
   * LQ-34 两阶段退款（用户 2026-09-16：兰琪扣通用钱包）：
   *   ① 用条件更新「抢占」退款权（`reserved` → `refund_processing`），只有拿到的那次继续；
   *   ② **退出事务后**再退钱包（`refundLanqiWallet` 自己开事务，按原扣费流水回退到原桶）；
   *   ③ 最后置 `refunded`。若 ② 之后崩了，任务停在 `refund_processing`，重试会走同一条幂等退款，不会重复退。
   */
  const claimed = await prisma.lanqiMediaJob.updateMany({ where: { id: job.id, billingStatus: "reserved" }, data: { billingStatus: "refund_processing" } });
  const current = await prisma.lanqiMediaJob.findUnique({ where: { id: job.id } });
  if (!current) return job;
  if (claimed.count === 0) return current;
  await refundLanqiWallet({
    tenantId: current.tenantId,
    requestId: current.requestKey,
    skillId: "lanqi_media_generation",
    reason: "lanqi_media_generation_refund"
  });
  return prisma.lanqiMediaJob.update({ where: { id: current.id }, data: { status: finalStatus, billingStatus: "refunded", assetStatus: "unavailable", errorMessage: message.slice(0, 500), completedAt: new Date(), ...(finalStatus === "canceled" ? { canceledAt: new Date() } : {}) } });
}

async function finalizeSuccess(job: any, providerStatus: string): Promise<{ job: any; accepted: boolean }> {
  return prisma.$transaction(async tx => {
    const claimed = await tx.lanqiMediaJob.updateMany({
      where: { id: job.id, billingStatus: "reserved", status: { notIn: ["failed", "canceled", "succeeded"] } },
      data: { status: "succeeded", billingStatus: "charged", assetStatus: "persisted", outputUrl: lanqiMediaAssetUrl(job.id), providerStatus, completedAt: new Date() },
    });
    const current = await tx.lanqiMediaJob.findUnique({ where: { id: job.id } });
    if (!current) return { job, accepted: false };
    return { job: current, accepted: claimed.count === 1 || (current.status === "succeeded" && current.billingStatus === "charged") };
  });
}

function createMockJob(tenantId: string, requestKey: string, input: LanqiMediaRequest): { job: PublicJob; idempotent: boolean } {
  const items = mockJobs.get(tenantId) ?? [];
  const existing = items.find(item => item.requestKey === requestKey);
  if (existing) {
    if (existing.prompt !== input.prompt || existing.negativePrompt !== input.negativePrompt || existing.previewId !== input.previewId || existing.promptVersion !== input.promptVersion) throw Object.assign(new Error("request_key_conflict"), { statusCode: 409 });
    return { job: toPublicMock(existing), idempotent: true };
  }
  const now = new Date().toISOString();
  const quote = quoteLanqiMedia(input);
  const job: MockJob = { id: `mock-${randomUUID()}`, tenantId, requestKey, previewId: input.previewId, kind: input.kind, prompt: input.prompt, negativePrompt: input.negativePrompt, promptVersion: input.promptVersion, ratio: input.ratio,
    status: "queued", progress: 10, creditCost: quote.creditCost, billingStatus: "not_billed", assetStatus: "pending", canCancel: true, canRetry: false, createdAt: now, updatedAt: now, executionMode: "mock", refreshCount: 0 };
  mockJobs.set(tenantId, [job, ...items].slice(0, 30));
  return { job: toPublicMock(job), idempotent: false };
}

async function refreshMockJob(tenantId: string, jobId: string): Promise<MockJob | undefined> {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || terminal(job.status)) return job;
  job.refreshCount += 1; job.updatedAt = new Date().toISOString();
  if (job.refreshCount === 1) { job.status = "processing"; job.progress = 55; }
  else if (job.prompt.includes("[模拟失败]")) { job.status = "failed"; job.progress = 0; job.assetStatus = "unavailable"; job.errorMessage = "受控模拟失败；未调用外部模型、未扣算力。"; job.canCancel = false; job.canRetry = true; }
  else {
    // 视频类 mock 回放真实 MP4（原 SVG 占位图 `<video>` 播不了 → 黑屏 0:00，2026-10-04 用户实测）；
    // 回放文件不可用时回退占位图，流程不断。
    let persisted = false;
    if (job.kind !== "image" && env.BEAUTY_VIDEO_REPLICATION_MOCK_VIDEO) {
      try {
        const bytes = await readFile(env.BEAUTY_VIDEO_REPLICATION_MOCK_VIDEO);
        await persistLanqiMockVideo({ tenantId, jobId: job.id, bytes });
        persisted = true;
      } catch { /* 回退占位图 */ }
    }
    if (!persisted) await persistLanqiMockImage({ tenantId, jobId, prompt: job.prompt, ratio: job.ratio, label: job.kind === "image" ? "受控模拟成图" : "受控模拟成片" });
    job.status = "succeeded"; job.progress = 100; job.assetStatus = "persisted"; job.outputUrl = lanqiMediaAssetUrl(job.id); job.canCancel = false;
  }
  return job;
}

function cancelMockJob(tenantId: string, jobId: string): MockJob | undefined {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || terminal(job.status)) return job;
  job.status = "canceled"; job.progress = 0; job.billingStatus = "not_billed"; job.assetStatus = "unavailable"; job.errorMessage = "任务已取消；模拟验收未产生费用。"; job.canCancel = false; job.canRetry = true; job.updatedAt = new Date().toISOString();
  return job;
}

async function markMockJob(tenantId: string, jobId: string, action: "select" | "save"): Promise<MockJob | undefined> {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || job.status !== "succeeded") return job;
  const metadata = await markLanqiMediaAsset({ tenantId, jobId, action });
  job.selectedAt = metadata.selectedAt; job.savedAt = metadata.savedAt; job.updatedAt = new Date().toISOString();
  return job;
}

function toPublicMock(job: MockJob): PublicJob {
  const { tenantId: _tenantId, requestKey: _requestKey, prompt: _prompt, negativePrompt: _negativePrompt, promptVersion: _promptVersion, ratio: _ratio, refreshCount: _refreshCount, ...result } = job;
  return result;
}

function serialize(job: any): PublicJob {
  const status = String(job.status);
  return { id: job.id, previewId: job.previewId ?? undefined, kind: job.kind, status, progress: status === "succeeded" ? 100 : status === "processing" ? 60 : status === "submitted" ? 25 : 0,
    creditCost: job.creditCost, billingStatus: job.billingStatus, assetStatus: job.assetStatus ?? (job.outputUrl ? "persisted" : "pending"), outputUrl: job.outputUrl ?? undefined,
    errorMessage: job.errorMessage ? "生成失败或已取消；未交付结果不会重复扣费，已预留算力会自动退回。" : undefined,
    canCancel: ["queued", "submitted"].includes(status), canRetry: ["failed", "canceled"].includes(status), selectedAt: toIso(job.selectedAt), savedAt: toIso(job.savedAt), createdAt: toIso(job.createdAt)!, updatedAt: toIso(job.updatedAt)!, executionMode: "real" };
}

/** 幂等比较口径集中在 services/lanqi-media-generation.ts，便于离线回归（见 isSameLanqiMediaRequest）。 */
function sameRequest(job: any, input: LanqiMediaRequest, firstFrameFingerprint?: string): boolean {
  return isSameLanqiMediaRequest(job, input, firstFrameFingerprint);
}

export async function resolveLanqiMediaAuthorization(
  context: Awaited<ReturnType<typeof resolveRequestContext>>,
  readiness: ReturnType<typeof getLanqiMediaExecutionReadiness>,
  creditCost: number,
  kind: LanqiMediaRequest["kind"] = "image",
): Promise<{ canConfirm: boolean; message: string; blockCode?: "media_execution_blocked" | "quota_exhausted" }> {
  if (!readiness.canConfirm) return { canConfirm: false, message: readiness.blockedReason ?? "当前媒体生成能力未放行，本次不会创建任务或扣算力。", blockCode: "media_execution_blocked" };
  if (readiness.mode !== "real" || context.source !== "database") return { canConfirm: true, message: "" };
  // 「本次验收最多 3 张」是首轮真实生图预算上限；成片按秒计价，不受该图片上限约束。
  if (kind !== "image") {
    // LQ-34：可确认性判断（能不能点「确认并生成」）也必须看**同一本钱包**，否则会出现「许可说可以、扣费说没钱」。
    const account = await readLanqiWalletBalance(context.tenantId);
    if (!account || account.balance < creditCost) return { canConfirm: false, blockCode: "quota_exhausted", message: "当前可用算力不足，本次不会创建任务或扣算力；继续生成需要新的明确授权。" };
    return { canConfirm: true, message: "" };
  }
  const [account, completedJobs] = await Promise.all([
    readLanqiWalletBalance(context.tenantId),
    prisma.lanqiMediaJob.count({ where: { tenantId: context.tenantId, kind: "image", providerTaskId: { not: null } } }),
  ]);
  if (!account || account.balance < creditCost) {
    return {
      canConfirm: false,
      blockCode: "quota_exhausted",
      message: completedJobs >= 3
        ? "本次验收生图额度已用完，现有 3 张可继续查看；继续生图需要新的明确授权。"
        : "当前可用生图额度不足，本次不会创建任务或扣算力；继续生图需要新的明确授权。",
    };
  }
  return { canConfirm: true, message: "" };
}

/**
 * 视频侧「首帧图」入口：把请求里的 firstFrameId / firstFrame / imageUrl 归一成
 * 一条本平台自有的限时签名外链（方案 B：素材只进自己的存储，不依赖第三方桶）。
 */
async function bindLanqiFirstFrame(
  context: Awaited<ReturnType<typeof resolveRequestContext>>,
  input: MediaRequestInput,
): Promise<
  | { ok: true; input: LanqiMediaRequest; firstFrameId?: string }
  | { ok: false; statusCode: number; error: string; message: string }
> {
  const resolved = await resolveLanqiFirstFrameInput({ tenantId: context.tenantId, kind: input.kind, firstFrameId: input.firstFrameId, firstFrame: input.firstFrame, imageUrl: input.imageUrl, frameId: input.frameId });
  if (!resolved.ok) return resolved;
  return { ok: true, input: { ...input, imageUrl: resolved.imageUrl }, firstFrameId: resolved.firstFrameId };
}

async function bindTrustedImagePreview(context: Awaited<ReturnType<typeof resolveRequestContext>>, input: MediaRequestInput): Promise<
  | { ok: true; input: MediaRequestInput }
  | { ok: false; statusCode: 404 | 409 | 422; error: string; message: string }
> {
  if (input.kind !== "image") return { ok: true, input };
  if (!input.previewId) return { ok: false, statusCode: 422, error: "image_preview_required", message: "请先生成并选择一版专业提示词。" };
  const preview = await loadLanqiImagePreview(context, input.previewId);
  if (!preview) return { ok: false, statusCode: 404, error: "image_preview_not_found", message: "这版提示词不存在或不属于当前门店，请重新生成。" };
  const selected = preview.directions.find(item => item.id === preview.selectedDirectionId) ?? preview.directions[0];
  if (!selected) return { ok: false, statusCode: 409, error: "image_preview_invalid", message: "这版提示词缺少可用视觉方向，请重新生成。" };
  const expectedVersion = preview.enhancer.version;
  if (input.prompt !== selected.positivePrompt || input.negativePrompt !== selected.negativePrompt || input.ratio !== preview.ratio || input.promptVersion !== expectedVersion) {
    return { ok: false, statusCode: 409, error: "image_preview_stale", message: "提示词或参数已经变化，请刷新预览后重新确认。" };
  }
  return { ok: true, input: { ...input, prompt: selected.positivePrompt, negativePrompt: selected.negativePrompt, ratio: preview.ratio, promptVersion: expectedVersion } };
}
function isTimedOut(job: { status: string; createdAt: Date }): boolean { return !terminal(job.status) && Date.now() - job.createdAt.getTime() > env.LANQI_MEDIA_TASK_TIMEOUT_MINUTES * 60_000; }
function terminal(status: string): boolean { return ["succeeded", "failed", "canceled"].includes(status); }
function toIso(value?: Date | string | null): string | undefined { return value instanceof Date ? value.toISOString() : value ?? undefined; }
function safe(a: string, b?: string) { return Boolean(b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))); }
