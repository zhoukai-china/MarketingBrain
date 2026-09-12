/**
 * 兰琪「视频获客 · 爆款复刻」的爆款检索服务（LQ-25）。
 *
 * 只做一件事：把关键词交给**一个可替换的公开网页检索 Provider**，拿回原始检索结果，
 * 再由规则层筛成「真实可点开的抖音 / 视频号（微信生态）条目」。
 *
 * 设计红线（与 demo 的「宁可不给结果，也不给一条点开是 404 的爆款」一致）：
 *   · 只用检索结果的 `title / url / site / snippet`，**不使用模型生成的自然语言结论**，
 *     所以不存在「模型编一条看起来很像的爆款」这条路；
 *   · 没有配 Provider、上游整体失败、上游全是第三方站点 → 一律失败关闭，返回明确文案；
 *   · 不做热度推算：检索源没给播放量 / 点赞数，条目里就没有这两个字段。
 */
import { assertOutboundUrlAllowed } from "../../services/outbound-policy.js";
import {
  VIRAL_SEARCH_DISCLOSURE,
  VIRAL_SEARCH_EMPTY_NOTE,
  VIRAL_SEARCH_UNAVAILABLE_NOTE,
  VIRAL_SEARCH_UPSTREAM_FAILED_NOTE,
  buildViralSearchQuery,
  normalizePlatformFilter,
  normalizeViralCategory,
  normalizeViralKeyword,
  normalizeViralResults,
  platformsForFilter,
  type ViralPlatformFilter,
  type ViralSearchHit,
  type ViralSearchItem
} from "./viral-search-rules.js";

export const VIRAL_SEARCH_SERVICE_VERSION = "lanqi_viral_search_service_v1";

/** 检索默认端点：阿里云百炼（DashScope）原生 generation 接口，用于拿**来源页**而不是模型结论。 */
export const VIRAL_SEARCH_DEFAULT_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
export const VIRAL_SEARCH_DEFAULT_TIMEOUT_MS = 25_000;

export const VIRAL_SEARCH_ERROR_CODES = {
  invalidInput: "invalid_input",
  unavailable: "viral_search_unavailable",
  upstreamFailed: "viral_search_upstream_failed"
} as const;
export type ViralSearchErrorCode = (typeof VIRAL_SEARCH_ERROR_CODES)[keyof typeof VIRAL_SEARCH_ERROR_CODES];

export class ViralSearchError extends Error {
  constructor(
    readonly code: ViralSearchErrorCode,
    message: string,
    readonly httpStatus: 400 | 502 | 503
  ) {
    super(message);
    this.name = "ViralSearchError";
  }
}

export interface ViralSearchProvider {
  readonly name: string;
  search(query: string): Promise<ViralSearchHit[]>;
}

export interface ViralSearchInput {
  storeId?: string;
  keyword: unknown;
  platform?: unknown;
  category?: unknown;
}

export interface ViralSearchResult {
  keyword: string;
  platform: ViralPlatformFilter;
  disclosure: string;
  note: string;
  items: ViralSearchItem[];
  provider: string;
}

export interface ViralSearchDeps {
  /**
   * `null` = 检索源未配置（默认部署状态）；`undefined` = 由调用方另行注入。
   * 两个分支都不允许「返回假条目」来掩盖未接通。
   */
  provider?: ViralSearchProvider | null;
  limit?: number;
}

export async function searchLanqiViralVideos(
  input: ViralSearchInput,
  deps: ViralSearchDeps = {}
): Promise<ViralSearchResult> {
  const keyword = normalizeViralKeyword(input?.keyword);
  if (!keyword) {
    throw new ViralSearchError(VIRAL_SEARCH_ERROR_CODES.invalidInput, "请输入要检索的关键词（1-40 个字）。", 400);
  }
  const platform = normalizePlatformFilter(input?.platform);
  const category = normalizeViralCategory(input?.category);
  const provider = deps.provider ?? null;
  if (!provider) {
    throw new ViralSearchError(VIRAL_SEARCH_ERROR_CODES.unavailable, VIRAL_SEARCH_UNAVAILABLE_NOTE, 503);
  }

  const queries = platformsForFilter(platform).map(target => buildViralSearchQuery(keyword, target, category));
  const settled = await Promise.allSettled(queries.map(query => provider.search(query)));
  const hits: ViralSearchHit[] = [];
  let fulfilled = 0;
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    fulfilled += 1;
    hits.push(...entry.value);
  }
  // 两个平台都失败才算上游失败；只失败一个平台时，另一个平台的真实结果照常给出。
  if (fulfilled === 0) {
    throw new ViralSearchError(VIRAL_SEARCH_ERROR_CODES.upstreamFailed, VIRAL_SEARCH_UPSTREAM_FAILED_NOTE, 502);
  }

  const items = normalizeViralResults(hits, { platform, limit: deps.limit });
  return {
    keyword,
    platform,
    disclosure: VIRAL_SEARCH_DISCLOSURE,
    note: items.length ? "" : VIRAL_SEARCH_EMPTY_NOTE,
    items,
    provider: provider.name
  };
}

/** 只读 `output.search_info.search_results`（来源页清单），刻意不读模型生成的正文。 */
export function parseWebSearchResults(payload: unknown): ViralSearchHit[] {
  const output = (payload as { output?: { search_info?: { search_results?: unknown } } } | null)?.output;
  const results = output?.search_info?.search_results;
  if (!Array.isArray(results)) throw new Error("upstream_response_shape");
  return results.map(entry => {
    const item = entry as { site_name?: unknown; title?: unknown; url?: unknown; snippet?: unknown };
    return {
      siteName: typeof item.site_name === "string" ? item.site_name : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined
    };
  });
}

export interface WebSearchProviderOptions {
  apiKey?: string | undefined;
  endpoint?: string | undefined;
  model?: string;
  strategy?: "standard" | "pro";
  timeoutMs?: number;
  domesticNetworkOnly: boolean;
  allowedHosts: string[];
  serviceName?: string;
  /** 测试注入点：默认用全局 fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * 公开网页检索 Provider。没有 key 就返回 `null`（部署默认值），让调用方走失败关闭，
 * 而不是偷偷回退成一份本地假数据。
 */
export function createWebSearchProvider(options: WebSearchProviderOptions): ViralSearchProvider | null {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;
  const endpoint = (options.endpoint?.trim() || VIRAL_SEARCH_DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const model = options.model?.trim() || "qwen-plus";
  const strategy = options.strategy ?? "pro";
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : VIRAL_SEARCH_DEFAULT_TIMEOUT_MS;
  const serviceName = options.serviceName ?? "lanqi-viral-search";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "public_web_search",
    async search(query: string): Promise<ViralSearchHit[]> {
      assertOutboundUrlAllowed(serviceName, endpoint, {
        domesticNetworkOnly: options.domesticNetworkOnly,
        allowedHosts: options.allowedHosts
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            input: {
              messages: [
                { role: "system", content: "只做网页检索，不要改写任何事实。" },
                { role: "user", content: `请检索：${query}` }
              ]
            },
            parameters: {
              enable_search: true,
              search_options: { enable_source: true, enable_citation: true, search_strategy: strategy },
              result_format: "message"
            }
          })
        });
        if (!response.ok) throw new Error(`upstream_http_${response.status}`);
        return parseWebSearchResults(await response.json());
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
