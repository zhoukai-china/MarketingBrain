import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export const BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION = "beauty-provider-asset-url-v1" as const;

const requiredRuntimeHosts = ["oss-accelerate.aliyuncs.com"] as const;
const officialHostClasses = [
  { baseHost: "oss-accelerate.aliyuncs.com", hostClass: "aliyun_oss_accelerate" },
  { baseHost: "oss-cn-beijing.aliyuncs.com", hostClass: "aliyun_oss_regional" }
] as const;

export type BeautyProviderAssetUrlDecision = {
  policyVersion: typeof BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION;
  hostClass: (typeof officialHostClasses)[number]["hostClass"];
};

/** 阿里云 OSS 结果域名族：oss-accelerate 与任意 oss-cn-<region>（含前缀子域）。
 *  百炼图/视频结果区域由供应商调度决定（实测 wulanchabu / hangzhou / accelerate 都出现过），
 *  精确到区域的硬编码会让真实成片永远数组外；安全边界收敛到「只允许阿里云 OSS 域名族」。 */
export function isAliyunOssResultFamily(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "oss-accelerate.aliyuncs.com" || host.endsWith(".oss-accelerate.aliyuncs.com") ||
    /(^|\.)oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(host);
}

export function getMissingBeautyProviderAssetRuntimeHosts(runtimeAllowedHosts: readonly string[]): string[] {
  const normalized = new Set(runtimeAllowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  return requiredRuntimeHosts.filter((host) => !normalized.has(host));
}

export function validateBeautyProviderAssetUrl(
  rawUrl: string,
  runtimeAllowedHosts: readonly string[]
): BeautyProviderAssetUrlDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("beauty_provider_asset_url_rejected");
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.port.length > 0 && url.port !== "443")
  ) {
    throw new Error("beauty_provider_asset_url_rejected");
  }

  const hostname = url.hostname.toLowerCase();
  // 百炼视频结果可能落在任意 OSS 区域（2026-09-13 实测 dashscope-0484.oss-cn-wulanchabu）。
  // 安全边界仍是「阿里云 OSS 域名族」：oss-accelerate 与 oss-cn-<region>（含前缀子域）；
  // 精确放行由运行时 allowlist（env BEAUTY_VIDEO_RESULT_HOSTS / DOMESTIC_OUTBOUND_ALLOWLIST）二次把关。
  const accelerate = hostname === "oss-accelerate.aliyuncs.com" || hostname.endsWith(".oss-accelerate.aliyuncs.com");
  const regional = /(^|\.)oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(hostname);
  if (!accelerate && !regional) throw new Error("beauty_provider_asset_url_rejected");
  const official = accelerate
    ? { baseHost: officialHostClasses[0].baseHost, hostClass: "aliyun_oss_accelerate" as const }
    : { baseHost: "oss-cn-*.aliyuncs.com", hostClass: "aliyun_oss_regional" as const };

  try {
    // 运行时 allowlist 是第二道防线；对已通过 OSS 域名族的地址，自动带上本主机所在区域基域，
    // 避免供应商结果区域变化（wulanchabu / hangzhou / accelerate…）把真实成片挡在门外。
    const familyBase = accelerate ? "oss-accelerate.aliyuncs.com" : hostname.slice(hostname.indexOf("oss-cn-"));
    assertOutboundUrlAllowed("Beauty generated image", rawUrl, {
      domesticNetworkOnly: true,
      allowedHosts: [...new Set([...runtimeAllowedHosts, familyBase])]
    });
  } catch {
    throw new Error("beauty_provider_asset_runtime_host_missing");
  }

  return {
    policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
    hostClass: official.hostClass
  };
}

function isSameOrSubdomain(hostname: string, baseHost: string): boolean {
  return hostname === baseHost || hostname.endsWith(`.${baseHost}`);
}
