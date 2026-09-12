import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LlmProvider } from "@baolu/agent";
import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import {
  createClipThumbnail,
  probeClip,
  renderClip,
  renderRoughCutPlan,
  type ClipTone,
  type ClipVisualTemplate
} from "../services/clip-renderer.js";
import {
  buildClipRoughCutPlan,
  readClipPlan,
  type ClipCropMode,
  type ClipStoryTemplate,
  type ClipProductRange,
  type SelectedClipSegment
} from "../services/clip-planner.js";
import { buildClipProductCatalog, readClipProductCatalog } from "../services/clip-product-catalog.js";
import { buildPersonaClipBatchPlan, readPersonaClipBatchPlan } from "../services/persona-clip-planner.js";
import {
  autoFillStockAssets,
  importStockAsset,
  listSupplementalAssets,
  matchAssetsToNeeds,
  searchStockAssets
} from "../services/clip-assets.js";
import { cleanupExpiredClipOutputs, cleanupExpiredClipUploads, readClipTempUpload, storeClipTempUpload } from "../services/clip-temp-storage.js";

interface RenderBody {
  sampleId?: string;
  startSeconds?: number;
  durationSeconds?: number;
  contentTemplate?: string;
  visualTemplate?: ClipVisualTemplate;
  tone?: ClipTone;
  mirror?: boolean;
  headline?: string;
  audience?: string;
  sellingPoint?: string;
  personalView?: string;
  cta?: string;
}

interface PlanBody {
  sampleIds?: string[];
  sourceMode?: "livestream" | "product";
  targetDurationSeconds?: number;
  template?: ClipStoryTemplate;
  confirmedFacts?: string;
  personalAngle?: string;
  catalogId?: string;
  productId?: string;
  productName?: string;
  productRanges?: ClipProductRange[];
}

interface ProductCatalogBody {
  sampleIds?: string[];
  contextText?: string;
}

interface RenderPlanBody {
  planId?: string;
  claimsConfirmed?: boolean;
  selected?: Array<{ segmentId?: string; cropMode?: ClipCropMode; startSeconds?: number; endSeconds?: number }>;
  autoFillAssets?: boolean;
  musicMode?: "none" | "upload" | "jianying";
  musicUploadId?: string;
  assetUploads?: Array<{ needId?: string; uploadId?: string }>;
}

interface PersonaPlanBody {
  sampleId?: string;
  targetDurationSeconds?: number;
  topicHint?: string;
}

interface RenderPersonaTopicBody {
  batchPlanId?: string;
  topicId?: string;
  selected?: Array<{ segmentId?: string; cropMode?: ClipCropMode; startSeconds?: number; endSeconds?: number }>;
}

const visualTemplates = new Set<ClipVisualTemplate>(["clean", "focus", "depth"]);
const tones = new Set<ClipTone>(["natural", "warm", "clear"]);
const storyTemplates = new Set<ClipStoryTemplate>(["evidence_conversion", "experience_recommendation", "audience_fit", "question_answer"]);

export async function registerClipLabRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get<{ Querystring: { mode?: "commerce" | "persona" } }>("/clip-lab/samples", async (request) => {
    await cleanupExpiredClipUploads();
    await cleanupExpiredClipOutputs();
    const files = await getLocalSamples(request.query.mode === "persona" ? "persona" : "commerce");
    return {
      testMode: env.NODE_ENV !== "production",
      samples: await Promise.all(files.map(async (samplePath) => {
        const info = await probeClip(samplePath);
        const fileStat = await stat(samplePath);
        return {
          id: path.basename(samplePath),
          filename: path.basename(samplePath),
          byteSize: fileStat.size,
          ...info,
          thumbnailUrl: `/clip-lab/samples/${encodeURIComponent(path.basename(samplePath))}/thumbnail`
        };
      }))
    };
  });

  app.post<{ Querystring: { kind?: "source" | "music" | "asset" } }>("/clip-lab/uploads", async (request, reply) => {
    const kind = request.query.kind === "music" || request.query.kind === "asset" ? request.query.kind : "source";
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: kind === "source" ? 2 * 1024 * 1024 * 1024 : kind === "asset" ? 300 * 1024 * 1024 : 80 * 1024 * 1024
      }
    });
    if (!file) return reply.code(400).send({ error: "file_required", message: "请选择要上传的文件" });
    const upload = await storeClipTempUpload({ kind, file });
    if (kind === "music") {
      return {
        status: "uploaded",
        music: { id: upload.id, filename: upload.filename, byteSize: upload.byteSize },
        expiresInHours: 24
      };
    }
    if (kind === "asset") {
      return {
        status: "uploaded",
        asset: {
          id: upload.id,
          filename: upload.filename,
          byteSize: upload.byteSize,
          type: /\.(jpg|jpeg|png|webp)$/i.test(upload.filename) ? "image" : "video"
        },
        expiresInHours: 24
      };
    }
    const info = await probeClip(upload.localPath);
    return {
      status: "uploaded",
      sample: {
        id: upload.id,
        filename: upload.filename,
        byteSize: upload.byteSize,
        ...info,
        thumbnailUrl: `/clip-lab/samples/${upload.id}/thumbnail`,
        temporary: true
      },
      expiresInHours: 24
    };
  });

  app.get<{ Params: { sampleId: string }; Querystring: { at?: string } }>("/clip-lab/samples/:sampleId/thumbnail", async (request, reply) => {
    const sourcePath = await resolveSample(request.params.sampleId);
    if (!sourcePath) return reply.code(404).send({ error: "sample_not_found", message: "测试素材不存在" });
    const requestedAt = Number(request.query.at ?? 3);
    const seekSeconds = Number.isFinite(requestedAt) ? Math.max(0, requestedAt) : 3;
    const frameKey = Math.round(seekSeconds * 10);
    const thumbnailRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "thumbnails");
    const thumbnailPath = path.join(thumbnailRoot, `${safeSampleStem(request.params.sampleId)}-${frameKey}.jpg`);
    try {
      await access(thumbnailPath);
    } catch {
      await createClipThumbnail(sourcePath, thumbnailPath, seekSeconds);
    }
    return sendWholeFile(reply, thumbnailPath, "image/jpeg");
  });

  app.get<{ Params: { sampleId: string } }>("/clip-lab/samples/:sampleId/video", async (request, reply) => {
    const sourcePath = await resolveSample(request.params.sampleId);
    if (!sourcePath) return reply.code(404).send({ error: "sample_not_found", message: "素材不存在或已经过期" });
    return sendRangeFile(request, reply, sourcePath, videoContentType(sourcePath));
  });

  app.post<{ Body: ProductCatalogBody }>("/clip-lab/product-catalog", async (request, reply) => {
    const body = request.body ?? {};
    const sampleIds = [...new Set((body.sampleIds ?? []).filter((value): value is string => typeof value === "string"))].slice(0, 20);
    if (!sampleIds.length) return reply.code(400).send({ error: "samples_required", message: "请先选择一条或多条直播素材" });
    const sources: Array<{ sourceId: string; sourcePath: string }> = [];
    for (const sampleId of sampleIds) {
      const sourcePath = await resolveSample(sampleId);
      if (!sourcePath) return reply.code(400).send({ error: "sample_not_found", message: `素材不存在：${sampleId}` });
      sources.push({ sourceId: sampleId, sourcePath });
    }
    const catalog = await buildClipProductCatalog({ sources, provider, contextText: shortText(body.contextText, 1000) });
    return { status: "completed", catalog };
  });

  app.post<{ Body: RenderBody }>("/clip-lab/render", async (request, reply) => {
    const startedAt = Date.now();
    const body = request.body ?? {};
    const sourcePath = await resolveSample(body.sampleId ?? "");
    if (!sourcePath) {
      return reply.code(400).send({ error: "sample_required", message: "请选择桌面“张芷豪合作/带货讲品”中的测试素材" });
    }
    const visualTemplate = visualTemplates.has(body.visualTemplate as ClipVisualTemplate)
      ? body.visualTemplate as ClipVisualTemplate
      : "clean";
    const tone = tones.has(body.tone as ClipTone) ? body.tone as ClipTone : "natural";
    const result = await renderClip({
      sourcePath,
      sourceName: path.basename(sourcePath),
      contentTemplate: shortText(body.contentTemplate, 40) || "商品卖点",
      startSeconds: numberOr(body.startSeconds, 0),
      durationSeconds: numberOr(body.durationSeconds, 60),
      visualTemplate,
      tone,
      mirror: body.mirror === true,
      headline: shortText(body.headline, 48),
      audience: shortText(body.audience, 48),
      sellingPoint: shortText(body.sellingPoint, 80),
      personalView: shortText(body.personalView, 80),
      cta: shortText(body.cta, 48)
    });
    const totalMs = Date.now() - startedAt;
    const renderedSeconds = result.output.durationSeconds;
    const estimatedHumanMinutes = Math.max(3, Math.round((renderedSeconds / 60) * 1.5 + 1));
    const machineVideosPerHour = Math.max(1, Math.floor(3_600_000 / Math.max(totalMs, 1)));
    const humanVideosPerHour = Math.max(1, Math.floor(60 / estimatedHumanMinutes));
    return {
      status: "completed",
      result: {
        ...result,
        outputUrl: result.outputUrl,
        totalMs,
        contentTemplate: shortText(body.contentTemplate, 40) || "商品卖点",
        measurement: {
          selectedSourceSeconds: renderedSeconds,
          totalMs,
          renderMs: result.renderMs,
          realtimeFactor: Number((result.renderMs / 1000 / Math.max(renderedSeconds, 1)).toFixed(2)),
          machineVideosPerHour,
          estimatedHumanMinutes,
          humanReviewVideosPerHour: humanVideosPerHour
        },
        inspectionScope: {
          processed: `机器逐帧处理了所选 ${Math.round(renderedSeconds)} 秒画面，并处理了整段音轨`,
          semanticReview: "本版本没有让模型擅自判断高转化片段；起止点由人工指定",
          notReviewed: "机器未核验商品政策、价格真实性、授权和平台合规"
        }
      }
    };
  });

  app.post<{ Body: PlanBody }>("/clip-lab/plan", async (request, reply) => {
    const body = request.body ?? {};
    const sampleIds = [...new Set((body.sampleIds ?? []).filter((value): value is string => typeof value === "string"))].slice(0, 5);
    if (sampleIds.length === 0) return reply.code(400).send({ error: "samples_required", message: "请至少选择一条原始素材" });
    const sources: Array<{ sourceId: string; sourcePath: string }> = [];
    for (const sampleId of sampleIds) {
      const sourcePath = await resolveSample(sampleId);
      if (!sourcePath) return reply.code(400).send({ error: "sample_not_found", message: `素材不存在：${sampleId}` });
      sources.push({ sourceId: sampleId, sourcePath });
    }
    const template = storyTemplates.has(body.template as ClipStoryTemplate)
      ? body.template as ClipStoryTemplate
      : "evidence_conversion";
    let product: { productId: string; name: string; ranges: ClipProductRange[] } | undefined;
    if (body.catalogId && body.productId) {
      const catalog = await readClipProductCatalog(shortText(body.catalogId, 50));
      const catalogProduct = catalog.products.find((item) => item.productId === body.productId);
      if (!catalogProduct) return reply.code(404).send({ error: "product_not_found", message: "没有找到这个商品章节" });
      product = {
        productId: catalogProduct.productId,
        name: shortText(body.productName, 60) || catalogProduct.name,
        ranges: validateProductRanges(body.productRanges, catalogProduct.ranges)
      };
    } else if (body.sourceMode === "product") {
      const fullSourceRanges = await Promise.all(sources.map(async (source) => ({
        sourceId: source.sourceId,
        startSeconds: 0,
        endSeconds: (await probeClip(source.sourcePath)).durationSeconds
      })));
      product = {
        productId: "uploaded-product-material",
        name: shortText(body.productName, 60) || "已切好的商品素材",
        ranges: validateProductRanges(body.productRanges, fullSourceRanges)
      };
    } else {
      return reply.code(400).send({
        error: "product_required",
        message: "整场直播请先完成商品识别；如果上传的是已切好的商品素材，请选择对应入口"
      });
    }
    const plan = await buildClipRoughCutPlan({
      sources,
      targetDurationSeconds: Math.min(60, Math.max(20, numberOr(body.targetDurationSeconds, 60))),
      template,
      confirmedFacts: shortText(body.confirmedFacts, 2000),
      personalAngle: shortText(body.personalAngle, 500),
      provider,
      product
    });
    const assets = await listSupplementalAssets(plan.assetNeeds);
    return {
      status: "completed",
      plan,
      assetMatches: matchAssetsToNeeds(plan.assetNeeds, assets),
      localAssets: assets.map(({ localPath: _localPath, ...asset }) => asset)
    };
  });

  app.post<{ Body: PersonaPlanBody }>("/clip-lab/persona/plan", async (request, reply) => {
    const body = request.body ?? {};
    const sampleId = shortText(body.sampleId, 260);
    const sourcePath = await resolveSample(sampleId);
    if (!sourcePath) return reply.code(400).send({ error: "sample_required", message: "请选择一条人设、观点或故事类原始素材" });
    const plan = await buildPersonaClipBatchPlan({
      source: { sourceId: sampleId, sourcePath },
      targetDurationSeconds: Math.min(120, Math.max(30, numberOr(body.targetDurationSeconds, 60))),
      topicHint: shortText(body.topicHint, 500),
      provider
    });
    return { status: "completed", plan };
  });

  app.post<{ Body: RenderPersonaTopicBody }>("/clip-lab/persona/render-topic", async (request, reply) => {
    const body = request.body ?? {};
    const plan = await readPersonaClipBatchPlan(shortText(body.batchPlanId, 50));
    const topic = plan.topics.find((item) => item.topicId === body.topicId);
    if (!topic) return reply.code(404).send({ error: "topic_not_found", message: "没有找到这条话题方案" });
    const personaPool = [
      ...topic.selected,
      ...((topic as typeof topic & { candidateGroups?: Array<{ candidates: SelectedClipSegment[] }> }).candidateGroups ?? []).flatMap((group) => group.candidates)
    ];
    const selected = applySelectedEdits(personaPool, body.selected);
    if (selected.length < 2) return reply.code(400).send({ error: "timeline_too_short", message: "至少保留两个完整口述片段" });
    const sourcePath = await resolveSample(plan.sourceId);
    if (!sourcePath) return reply.code(400).send({ error: "sample_not_found", message: "原始素材不存在或临时上传已经过期" });
    const startedAt = Date.now();
    const result = await renderRoughCutPlan({
      planId: `${plan.batchPlanId}-${topic.topicId}`,
      segments: selected,
      donorSegments: [],
      sourcePaths: { [plan.sourceId]: sourcePath },
      broll: []
    });
    const personaResult = {
      ...result,
      aiWork: [
        `从完整长素材中识别“${topic.title}”话题，并重组 ${selected.length} 个真实口述片段`,
        "按强开头、必要背景、故事或论证、核心观点和完整收束组织内容",
        "所有切点落在完整语义和完整句之后，没有改写或补造说话内容",
        "保留干净人声，不叠加字幕和背景音乐，方便继续精修",
        "统一画幅、音量与编码，分别导出标准竖屏初剪片"
      ],
      humanChecklist: [
        "完整观看一遍，确认开头能独立理解、故事逻辑连续、结尾自然",
        "核对人名、地名、数字、方言和容易听错的词",
        "在剪映等软件中按需要添加字幕、音乐、花字和少量补充画面",
        "确认人物肖像、原视频和补充素材拥有对应使用授权",
        "完成平台规则与最终审美检查后再发布"
      ],
      qualityFlags: result.qualityFlags.filter((flag) => !flag.includes("背景音乐"))
    };
    return {
      status: "completed",
      result: {
        ...personaResult,
        totalMs: Date.now() - startedAt,
        topicId: topic.topicId,
        title: topic.title,
        estimatedHumanMinutes: Math.max(2, Math.ceil(result.output.durationSeconds / 25))
      }
    };
  });

  app.post<{ Body: RenderPlanBody }>("/clip-lab/render-plan", async (request, reply) => {
    const body = request.body ?? {};
    const plan = await readClipPlan(shortText(body.planId, 50));
    const candidatePool = [...plan.selected, ...(plan.candidateGroups ?? []).flatMap((group) => group.candidates)];
    const selected = applySelectedEdits(candidatePool, body.selected);
    const selectedIds = new Set(selected.map((segment) => segment.segmentId));
    // A cutter may deliberately remove an unverified claim. Only gate the
    // clips that remain in the exported timeline.
    const unresolvedClaims = plan.claimFlags.filter((flag) => flag.requiresConfirmation && selectedIds.has(flag.segmentId));
    if (unresolvedClaims.length > 0 && body.claimsConfirmed !== true) {
      return reply.code(400).send({ error: "claims_confirmation_required", message: "请先确认价格、销量、保险、赔付、产地等强声明" });
    }
    if (selected.length < 2) return reply.code(400).send({ error: "timeline_too_short", message: "粗剪时间线至少保留两个片段" });
    const sourcePaths: Record<string, string> = {};
    for (const sourceId of new Set([...selected, ...(plan.visualDonors ?? [])].map((segment) => segment.sourceId))) {
      const sourcePath = await resolveSample(sourceId);
      if (!sourcePath) return reply.code(400).send({ error: "sample_not_found", message: `素材不存在：${sourceId}` });
      sourcePaths[sourceId] = sourcePath;
    }
    const assetAutomation = body.autoFillAssets === false
      ? { imported: [] as string[], skipped: [] as string[] }
      : await autoFillStockAssets(plan.assetNeeds);
    const uploadedAssetByNeed = new Map<string, Awaited<ReturnType<typeof readClipTempUpload>>>();
    for (const item of (body.assetUploads ?? []).slice(0, 8)) {
      const need = plan.assetNeeds.find((candidate) => candidate.id === item.needId);
      if (!need || !item.uploadId || uploadedAssetByNeed.has(need.id)) continue;
      const upload = await readClipTempUpload(shortText(item.uploadId, 50), "asset");
      if (upload) uploadedAssetByNeed.set(need.id, upload);
    }
    const assets = await listSupplementalAssets(plan.assetNeeds);
    const matches = matchAssetsToNeeds(plan.assetNeeds, assets);
    const uploadedBroll = plan.assetNeeds.flatMap((need) => {
      const upload = uploadedAssetByNeed.get(need.id);
      if (!upload) return [];
      return [{
        assetPath: upload.localPath,
        assetType: /\.(jpg|jpeg|png|webp)$/i.test(upload.filename) ? "image" as const : "video" as const,
        insertAfterSegmentId: need.insertAfterSegmentId,
        durationSeconds: need.durationSeconds,
        // A real certificate/price/package is useful beside the speaker. Generic
        // cooking or usage footage should instead take over the full frame.
        presentation: need.role === "evidence" ? "pip" as const : "fullscreen" as const
      }];
    });
    const catalogBroll = matches.flatMap((match) => {
      if (uploadedAssetByNeed.has(match.id)) return [];
      if (!match.matchedAsset) return [];
      const asset = assets.find((item) => item.id === match.matchedAsset?.id);
      if (!asset) return [];
      return [{
        assetPath: asset.localPath,
        assetType: asset.type,
        insertAfterSegmentId: match.insertAfterSegmentId,
        durationSeconds: match.durationSeconds,
        presentation: match.role === "evidence" ? "pip" as const : "fullscreen" as const
      }];
    });
    const broll = [...uploadedBroll, ...catalogBroll];
    const uploadedMusic = body.musicMode === "upload" && body.musicUploadId
      ? await readClipTempUpload(shortText(body.musicUploadId, 50), "music")
      : undefined;
    const backgroundMusic = uploadedMusic
      ? { filename: uploadedMusic.filename, localPath: uploadedMusic.localPath }
      : undefined;
    const startedAt = Date.now();
    const result = await renderRoughCutPlan({
      planId: plan.planId,
      segments: selected,
      donorSegments: plan.visualDonors ?? [],
      sourcePaths,
      broll,
      backgroundMusic
    });
    const musicHandoff = body.musicMode === "jianying" ? "jianying" : backgroundMusic ? "mixed" : "none";
    const deliveredResult = musicHandoff === "jianying"
      ? {
          ...result,
          aiWork: result.aiWork.map((item) => item.startsWith("未上传已授权背景音乐")
            ? "按用户选择保留干净人声，背景音乐交由剪映完成"
            : item),
          qualityFlags: result.qualityFlags.filter((item) => !item.includes("背景音乐"))
        }
      : result;
    return {
      status: "completed",
      result: {
        ...deliveredResult,
        totalMs: Date.now() - startedAt,
        unresolvedAssetCount: matches.filter((match) => match.status !== "matched" && !uploadedAssetByNeed.has(match.id)).length,
        autoImportedAssetCount: assetAutomation.imported.length,
        userProvidedAssetCount: uploadedAssetByNeed.size,
        estimatedHumanMinutes: Math.max(2, Math.ceil(result.output.durationSeconds / 20)),
        musicHandoff
      }
    };
  });

  app.get("/clip-lab/assets", async () => {
    const assets = await listSupplementalAssets();
    return {
      assets: assets.map(({ localPath: _localPath, ...asset }) => ({ ...asset, previewUrl: `/clip-lab/assets/${encodeURIComponent(asset.id)}` }))
    };
  });

  app.get<{ Params: { planId: string } }>("/clip-lab/plans/:planId/assets", async (request) => {
    const plan = await readClipPlan(request.params.planId);
    const assets = await listSupplementalAssets(plan.assetNeeds);
    return {
      assetMatches: matchAssetsToNeeds(plan.assetNeeds, assets),
      localAssets: assets.map(({ localPath: _localPath, ...asset }) => asset)
    };
  });

  app.get<{ Querystring: { q?: string } }>("/clip-lab/assets/search", async (request) => {
    return searchStockAssets(String(request.query.q ?? ""));
  });

  app.post<{ Body: { provider?: "pexels" | "pixabay"; id?: string; downloadUrl?: string; pageUrl?: string; creator?: string; query?: string; needId?: string } }>("/clip-lab/assets/import", async (request, reply) => {
    const body = request.body ?? {};
    if ((body.provider !== "pexels" && body.provider !== "pixabay") || !body.id || !body.downloadUrl || !body.pageUrl) {
      return reply.code(400).send({ error: "invalid_stock_asset", message: "素材来源信息不完整" });
    }
    const imported = await importStockAsset({
      provider: body.provider,
      id: body.id,
      downloadUrl: body.downloadUrl,
      pageUrl: body.pageUrl,
      creator: shortText(body.creator, 100),
      query: shortText(body.query, 100),
      needId: shortText(body.needId, 60)
    });
    return { status: "imported", asset: imported };
  });

  app.get<{ Params: { assetId: string } }>("/clip-lab/assets/:assetId", async (request, reply) => {
    const assets = await listSupplementalAssets();
    const asset = assets.find((item) => item.id === request.params.assetId);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "补充素材不存在" });
    const contentType = asset.type === "video" ? "video/mp4" : imageContentType(asset.filename);
    return asset.type === "video"
      ? sendRangeFile(request, reply, asset.localPath, contentType)
      : sendWholeFile(reply, asset.localPath, contentType);
  });

  app.get<{ Params: { filename: string } }>("/clip-lab/results/:filename", async (request, reply) => {
    await cleanupExpiredClipOutputs();
    if (!/^[a-f0-9-]{36}\.mp4$/i.test(request.params.filename)) {
      return reply.code(404).send({ error: "result_not_found", message: "成片不存在" });
    }
    const filePath = path.resolve(env.UPLOAD_DIR, "clip-lab", request.params.filename);
    try {
      await access(filePath);
    } catch {
      return reply.code(404).send({ error: "result_not_found", message: "成片不存在" });
    }
    return sendRangeFile(request, reply, filePath, "video/mp4");
  });
}

function getSampleRoot(): string {
  return path.join(process.env.USERPROFILE ?? "", "Desktop", "张芷豪合作", "带货讲品");
}

function getPersonaSampleRoot(): string {
  return path.join(process.env.USERPROFILE ?? "", "Desktop", "张芷豪合作");
}

async function getLocalSamples(mode: "commerce" | "persona" = "commerce"): Promise<string[]> {
  if (env.NODE_ENV === "production") return [];
  const sampleRoot = mode === "persona" ? getPersonaSampleRoot() : getSampleRoot();
  try {
    const entries = await readdir(sampleRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(mp4|mov|m4v)$/i.test(entry.name) && !/^成片/i.test(entry.name))
      .map((entry) => path.join(sampleRoot, entry.name))
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
  } catch {
    return [];
  }
}

async function resolveSample(sampleId: string): Promise<string | undefined> {
  const uploaded = await readClipTempUpload(sampleId, "source");
  if (uploaded) return uploaded.localPath;
  const basename = path.basename(sampleId);
  if (!basename || basename !== sampleId || !/\.(mp4|mov|m4v)$/i.test(basename)) return undefined;
  const samples = [...await getLocalSamples("commerce"), ...await getLocalSamples("persona")];
  return samples.find((samplePath) => path.basename(samplePath) === basename);
}

async function sendWholeFile(reply: FastifyReply, filePath: string, contentType: string) {
  const fileStat = await stat(filePath);
  reply.header("Content-Type", contentType);
  reply.header("Content-Length", fileStat.size);
  reply.header("Cache-Control", "private, max-age=3600");
  return reply.send(createReadStream(filePath));
}

async function sendRangeFile(request: FastifyRequest, reply: FastifyReply, filePath: string, contentType: string) {
  const fileStat = await stat(filePath);
  const range = request.headers.range;
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "private, max-age=3600");
  if (!range) {
    reply.header("Content-Length", fileStat.size);
    return reply.send(createReadStream(filePath));
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return reply.code(416).send();
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1;
  if (start < 0 || start >= fileStat.size || end < start) return reply.code(416).send();
  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
  reply.header("Content-Length", end - start + 1);
  return reply.send(createReadStream(filePath, { start, end }));
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shortText(value: string | undefined, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeSampleStem(value: string): string {
  return path.basename(value, path.extname(value)).replace(/[^a-zA-Z0-9_-]/g, "_") || "sample";
}

function applySelectedEdits(
  original: SelectedClipSegment[],
  edits?: Array<{ segmentId?: string; cropMode?: ClipCropMode; startSeconds?: number; endSeconds?: number }>
): SelectedClipSegment[] {
  if (!Array.isArray(edits) || edits.length === 0) return original;
  const byId = new Map(original.map((segment) => [segment.segmentId, segment]));
  const used = new Set<string>();
  return edits.flatMap((edit) => {
    const source = edit.segmentId ? byId.get(edit.segmentId) : undefined;
    if (!source || used.has(source.segmentId)) return [];
    used.add(source.segmentId);
    const minStart = source.editableStartSeconds ?? source.startSeconds;
    const maxEnd = source.editableEndSeconds ?? source.endSeconds;
    const requestedStart = numberOr(edit.startSeconds, source.startSeconds);
    const requestedEnd = numberOr(edit.endSeconds, source.endSeconds);
    const startSeconds = Math.max(minStart, Math.min(requestedStart, maxEnd - 0.35));
    const endSeconds = Math.min(maxEnd, Math.max(requestedEnd, startSeconds + 0.35));
    return [{
      ...source,
      startSeconds,
      endSeconds,
      cropMode: edit.cropMode === "speaker" || edit.cropMode === "product" || edit.cropMode === "evidence" ? edit.cropMode : "wide"
    }];
  });
}

function validateProductRanges(input: ClipProductRange[] | undefined, fallback: ClipProductRange[]): ClipProductRange[] {
  if (!Array.isArray(input) || !input.length) return fallback;
  const allowedSources = new Set(fallback.map((range) => range.sourceId));
  const result = input.flatMap((range) => {
    if (!range || !allowedSources.has(range.sourceId)) return [];
    const startSeconds = Math.max(0, numberOr(range.startSeconds, 0));
    const endSeconds = Math.max(startSeconds + 1, numberOr(range.endSeconds, startSeconds + 1));
    return [{ sourceId: range.sourceId, startSeconds, endSeconds }];
  });
  return result.length ? result : fallback;
}

function videoContentType(filename: string): string {
  if (/\.webm$/i.test(filename)) return "video/webm";
  if (/\.mov$/i.test(filename)) return "video/quicktime";
  return "video/mp4";
}

function imageContentType(filename: string): string {
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "image/jpeg";
}
