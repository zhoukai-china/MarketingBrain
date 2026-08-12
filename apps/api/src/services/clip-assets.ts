import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";
import type { ClipAssetNeed } from "./clip-planner.js";

export interface SupplementalAsset {
  id: string;
  filename: string;
  type: "video" | "image";
  byteSize: number;
  localPath: string;
  matchedNeedIds: string[];
}

export interface StockAssetResult {
  provider: "pexels" | "pixabay";
  id: string;
  title: string;
  pageUrl: string;
  previewUrl: string;
  downloadUrl: string;
  creator: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  licenseLabel: string;
}

export interface StockSearchResponse {
  configured: boolean;
  provider?: "pexels" | "pixabay";
  query: string;
  results: StockAssetResult[];
  manualLinks: Array<{ label: string; url: string }>;
  notice: string;
}

const mediaPattern = /\.(mp4|mov|m4v|webm|jpg|jpeg|png|webp)$/i;
export function getSupplementalAssetRoot(): string {
  return path.resolve(env.UPLOAD_DIR, "clip-lab", "asset-catalog");
}

export async function listSupplementalAssets(needs: ClipAssetNeed[] = []): Promise<SupplementalAsset[]> {
  const root = getSupplementalAssetRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries
    .filter((entry) => entry.isFile() && mediaPattern.test(entry.name))
    .map(async (entry) => {
      const localPath = path.join(root, entry.name);
      const info = await stat(localPath);
      return {
        id: entry.name,
        filename: entry.name,
        type: /\.(jpg|jpeg|png|webp)$/i.test(entry.name) ? "image" as const : "video" as const,
        byteSize: info.size,
        localPath,
        matchedNeedIds: needs.filter((need) => assetMatchesNeed(entry.name, need)).map((need) => need.id)
      };
    }));
}

export function matchAssetsToNeeds(needs: ClipAssetNeed[], assets: SupplementalAsset[]): Array<ClipAssetNeed & {
  status: "matched" | "search_available" | "human_required";
  matchedAsset?: Pick<SupplementalAsset, "id" | "filename" | "type">;
  searchLinks: Array<{ label: string; url: string }>;
}> {
  return needs.map((need) => {
    const matched = assets.find((asset) => asset.matchedNeedIds.includes(need.id));
    const query = need.queryEn || need.queryZh;
    return {
      ...need,
      status: matched ? "matched" : need.sourcePolicy === "stock" ? "search_available" : "human_required",
      matchedAsset: matched ? { id: matched.id, filename: matched.filename, type: matched.type } : undefined,
      searchLinks: need.sourcePolicy === "stock" ? buildManualSearchLinks(query) : []
    };
  });
}

export async function searchStockAssets(query: string): Promise<StockSearchResponse> {
  const normalized = query.trim().slice(0, 100);
  if (!normalized) throw new Error("search_query_required");
  const manualLinks = buildManualSearchLinks(normalized);
  if (env.PEXELS_API_KEY) {
    return {
      configured: true,
      provider: "pexels",
      query: normalized,
      results: await searchPexels(normalized),
      manualLinks,
      notice: "通用素材可用于商业剪辑，但不得暗示画面中的人物或品牌为本商品背书。"
    };
  }
  if (env.PIXABAY_API_KEY) {
    return {
      configured: true,
      provider: "pixabay",
      query: normalized,
      results: await searchPixabay(normalized),
      manualLinks,
      notice: "搜索结果来自 Pixabay；导入时保存来源，最终发布前仍需人工确认授权与画面适配。"
    };
  }
  return {
    configured: false,
    query: normalized,
    results: [],
    manualLinks,
    notice: "尚未配置 Pexels/Pixabay API Key。可以打开合规图库搜索，下载后放入“补充素材”文件夹。"
  };
}

export async function importStockAsset(params: {
  provider: "pexels" | "pixabay";
  id: string;
  downloadUrl: string;
  pageUrl: string;
  creator: string;
  query: string;
  needId?: string;
}): Promise<{ filename: string; byteSize: number }> {
  const download = new URL(params.downloadUrl);
  if (download.protocol !== "https:") throw new Error("stock_asset_https_required");
  assertOutboundUrlAllowed(`${params.provider} stock download`, download.toString(), {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(download, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`素材下载失败：${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > 120 * 1024 * 1024) throw new Error("素材超过120MB，请手工下载压缩后再添加");
  const contentType = response.headers.get("content-type") ?? "video/mp4";
  const extension = contentType.includes("image/") ? imageExtension(contentType) : ".mp4";
  const safeId = params.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const safeNeedId = (params.needId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const filename = `${safeNeedId ? `${safeNeedId}-` : ""}stock-${params.provider}-${safeId}${extension}`;
  const root = getSupplementalAssetRoot();
  await mkdir(root, { recursive: true });
  const outputPath = path.join(root, filename);
  await pipeline(response.body as never, createWriteStream(outputPath));
  const info = await stat(outputPath);
  await writeFile(`${outputPath}.source.json`, JSON.stringify({
    provider: params.provider,
    sourcePage: params.pageUrl,
    creator: params.creator,
    query: params.query,
    needId: params.needId,
    importedAt: new Date().toISOString(),
    licenseReviewRequired: true
  }, null, 2), "utf8");
  return { filename, byteSize: info.size };
}

export async function autoFillStockAssets(needs: ClipAssetNeed[]): Promise<{
  imported: string[];
  skipped: string[];
}> {
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const need of needs.filter((item) => item.sourcePolicy === "stock").slice(0, 4)) {
    const existing = await listSupplementalAssets([need]);
    if (existing.some((asset) => asset.matchedNeedIds.includes(need.id))) continue;
    try {
      const search = await searchStockAssets(need.queryEn || need.queryZh);
      const candidate = search.results[0];
      if (!search.configured || !candidate) {
        skipped.push(need.id);
        continue;
      }
      const result = await importStockAsset({
        provider: candidate.provider,
        id: candidate.id,
        downloadUrl: candidate.downloadUrl,
        pageUrl: candidate.pageUrl,
        creator: candidate.creator,
        query: search.query,
        needId: need.id
      });
      imported.push(result.filename);
    } catch {
      skipped.push(need.id);
    }
  }
  return { imported, skipped };
}

function assetMatchesNeed(filename: string, need: ClipAssetNeed): boolean {
  const haystack = filename.toLowerCase();
  if (haystack.includes(need.id.toLowerCase())) return true;
  const keywordGroups: Record<ClipAssetNeed["role"], string[]> = {
    usage: ["炒", "炸", "饺子", "烹饪", "做饭", "厨房", "倒油", "cooking", "fry", "dumpling", "pour"],
    product: ["产品", "包装", "商品", "product", "pack", "bottle"],
    evidence: ["标签", "保险", "证明", "检测", "证书", "label", "insurance", "certificate"],
    transition: ["转场", "环境", "transition", "scene"]
  };
  const queryTokens = `${need.queryZh} ${need.queryEn}`.toLowerCase().split(/[\s,，、_-]+/).filter((token) => token.length >= 2);
  return [...keywordGroups[need.role], ...queryTokens].some((keyword) => haystack.includes(keyword));
}

async function searchPexels(query: string): Promise<StockAssetResult[]> {
  const url = new URL("https://api.pexels.com/v1/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "8");
  assertOutboundUrlAllowed("Pexels API", url.toString(), { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(url, { headers: { Authorization: env.PEXELS_API_KEY! } });
  if (!response.ok) throw new Error(`Pexels搜索失败：${response.status}`);
  const json = await response.json() as {
    videos?: Array<{
      id: number;
      url: string;
      image: string;
      duration: number;
      user?: { name?: string };
      video_files?: Array<{ link: string; width?: number; height?: number; quality?: string }>;
    }>;
  };
  const results: StockAssetResult[] = [];
  for (const video of json.videos ?? []) {
    const files = (video.video_files ?? []).filter((file) => file.link && file.height && file.width);
    const preferred = files.sort((a, b) => scoreFile(b) - scoreFile(a))[0];
    if (!preferred) continue;
    results.push({
      provider: "pexels",
      id: String(video.id),
      title: `${query} · ${video.user?.name ?? "Pexels创作者"}`,
      pageUrl: video.url,
      previewUrl: video.image,
      downloadUrl: preferred.link,
      creator: video.user?.name ?? "Pexels创作者",
      durationSeconds: video.duration,
      width: preferred.width,
      height: preferred.height,
      licenseLabel: "Pexels License"
    });
  }
  return results;
}

async function searchPixabay(query: string): Promise<StockAssetResult[]> {
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", env.PIXABAY_API_KEY!);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "zh");
  url.searchParams.set("category", "food");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", "8");
  assertOutboundUrlAllowed("Pixabay API", url.toString(), { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Pixabay搜索失败：${response.status}`);
  const json = await response.json() as {
    hits?: Array<{
      id: number;
      pageURL: string;
      tags: string;
      duration: number;
      user: string;
      videos?: Record<string, { url?: string; width?: number; height?: number; thumbnail?: string }>;
    }>;
  };
  const results: StockAssetResult[] = [];
  for (const video of json.hits ?? []) {
    const file = video.videos?.medium ?? video.videos?.small ?? video.videos?.large;
    if (!file?.url) continue;
    results.push({
      provider: "pixabay",
      id: String(video.id),
      title: video.tags || query,
      pageUrl: video.pageURL,
      previewUrl: file.thumbnail ?? "",
      downloadUrl: file.url,
      creator: video.user,
      durationSeconds: video.duration,
      width: file.width,
      height: file.height,
      licenseLabel: "Pixabay Content License"
    });
  }
  return results;
}

function scoreFile(file: { width?: number; height?: number; quality?: string }): number {
  const portraitBonus = (file.height ?? 0) > (file.width ?? 0) ? 1_000_000 : 0;
  const resolution = Math.min((file.width ?? 0) * (file.height ?? 0), 1920 * 1080);
  return portraitBonus + resolution + (file.quality === "hd" ? 1000 : 0);
}

function buildManualSearchLinks(query: string): Array<{ label: string; url: string }> {
  return [
    { label: "在 Pexels 搜索", url: `https://www.pexels.com/search/videos/${encodeURIComponent(query)}/` },
    { label: "在 Pixabay 搜索", url: `https://pixabay.com/videos/search/${encodeURIComponent(query)}/` }
  ];
}

function imageExtension(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}
