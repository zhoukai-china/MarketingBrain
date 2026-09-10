import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider, LlmMessage } from "@baolu/agent";

/**
 * GEO（生成式引擎优化）大脑端点。
 *
 * 由 GEO 多租户中台（geo_backend_server）以 server-to-server 方式调用，
 * 让「思潼」成为 GEO 分析的真实大脑（单一事实源），而非本地模拟壳。
 *
 * 鉴权：请求头 `x-geo-token`（或 `Authorization: Bearer <token>`）必须等于
 * 思潼侧环境变量 `GEO_API_TOKEN`。两端设置同一值即可。未配置 GEO_API_TOKEN 时
 * 拒绝所有请求（不暴露端点）。
 *
 * 说明：本端点使用「思潼」当前配置的 LLM Provider（DeepSeek 或阿里云百炼）做真实分析，
 * 返回真实文本，不伪造。多引擎并集收录能力仍在 GEO 中台 geo_brain.js 侧完成；
 * 若需思潼侧也做多引擎并集，需将对应引擎 Key 配置进思潼环境（后续扩展）。
 */

const geoAnalyzeSchema = z.object({
  brand: z.string().trim().min(1).max(200),
  industry: z.string().trim().min(1).max(200),
  type: z
    .enum(["diagnose", "inclusion", "keywords", "article", "expand"])
    .default("diagnose"),
  keyword: z.string().trim().max(200).optional(),
});

function buildMessages(
  type: string,
  brand: string,
  industry: string,
  keyword?: string
): LlmMessage[] {
  const system =
    "你是GEO（生成式引擎优化）分析专家，服务于企业AI搜索可见度优化。" +
    "你的回答必须基于事实与常识，不编造品牌、不虚构数据。输出结构清晰、可直接用于经营决策。";

  let user = "";
  switch (type) {
    case "diagnose":
      user =
        `请对品牌「${brand}」在「${industry}」行业的AI搜索可见度做诊断。\n` +
        `输出包含：①该品牌当前在AI问答/生成式搜索中被主动提及的可能性评估；` +
        `②主要差距（信源缺失/品牌词弱/语义关联不足等）；③3条可执行的GEO优化建议。`;
      break;
    case "inclusion":
      user =
        `在「${industry}」行业，当普通用户向AI助手询问相关品牌或选购推荐时，` +
        `你会主动提及哪些品牌？请直接列出品牌名称，用顿号分隔。` +
        `如果你从未听说过「${brand}」这个品牌，不要编造，直接说明"未收录"。`;
      break;
    case "keywords":
      user =
        `为品牌「${brand}」（行业：${industry}）生成一份 GEO 优化关键词列表，` +
        `覆盖品牌词、行业词、长尾问题词、竞品对比词四类，每类5-8个，用换行分隔并标注类别。`;
      break;
    case "article":
      user =
        `为品牌「${brand}」（行业：${industry}）写一篇约600字的GEO信源文章，` +
        `用于提升其在AI生成式搜索中的引用概率。要求：含品牌名与行业关键词、结构清晰、` +
        `客观不夸大、结尾自然带出品牌价值。`;
      break;
    case "expand":
      user =
        `请围绕核心关键词「${keyword || brand}」（行业：${industry}）扩展15个相关长尾关键词，` +
        `用换行分隔，优先覆盖用户真实提问型短语。`;
      break;
  }

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export async function registerGeoRoutes(
  app: FastifyInstance,
  provider: LlmProvider & { isConfigured(): boolean; getModel(): string }
): Promise<void> {
  app.post("/geo/analyze", async (request, reply) => {
    const expected = process.env.GEO_API_TOKEN;
    const headerToken =
      (request.headers["x-geo-token"] as string | undefined) ||
      (typeof request.headers.authorization === "string"
        ? request.headers.authorization.replace(/^Bearer\s+/i, "")
        : undefined);

    if (expected && headerToken !== expected) {
      return reply.code(401).send({ error: "unauthorized", message: "缺少或错误的 GEO token" });
    }
    if (!expected) {
      return reply
        .code(401)
        .send({ error: "geo_token_not_configured", message: "思潼侧未配置 GEO_API_TOKEN" });
    }

    const parsed = geoAnalyzeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: parsed.error.issues[0]?.message ?? "参数错误" });
    }
    const { brand, industry, type, keyword } = parsed.data;

    if (!provider.isConfigured()) {
      return reply
        .code(503)
        .send({ error: "llm_not_configured", simulated: false, degraded: true });
    }

    const messages = buildMessages(type, brand, industry, keyword);
    try {
      const answer = await provider.complete(messages);
      return {
        type,
        brand,
        industry,
        answer,
        model: provider.getModel(),
        simulated: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.error({ err }, "geo.analyze llm call failed");
      return reply
        .code(502)
        .send({ error: "llm_call_failed", message, simulated: true, degraded: true });
    }
  });
}
