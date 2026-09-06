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
  const official = officialHostClasses.find(({ baseHost }) => isSameOrSubdomain(hostname, baseHost));
  if (!official) throw new Error("beauty_provider_asset_url_rejected");

  try {
    assertOutboundUrlAllowed("Beauty generated image", rawUrl, {
      domesticNetworkOnly: true,
      allowedHosts: [...runtimeAllowedHosts]
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
