import assert from "node:assert/strict";
import {
  BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
  getMissingBeautyProviderAssetRuntimeHosts,
  validateBeautyProviderAssetUrl
} from "../apps/api/src/services/beauty-provider-asset-policy.js";
import {
  isResultHostAllowed,
  normalizeAliyunOssResultUrl
} from "../apps/api/src/services/viral-video-replication-assets.js";

const runtimeHosts = ["dashscope.aliyuncs.com", "oss-cn-beijing.aliyuncs.com", "oss-accelerate.aliyuncs.com"];
const acceleratorUrl = "https://dashscope-result-bj.oss-accelerate.aliyuncs.com/synthetic/path/image.png?Expires=1&Signature=redacted";
const regionalUrl = "https://synthetic-bucket.oss-cn-beijing.aliyuncs.com/synthetic/path/image.png";

assert.equal(BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION, "beauty-provider-asset-url-v1");
assert.deepEqual(validateBeautyProviderAssetUrl(acceleratorUrl, runtimeHosts), {
  policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
  hostClass: "aliyun_oss_accelerate"
});
assert.deepEqual(validateBeautyProviderAssetUrl(regionalUrl, runtimeHosts), {
  policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
  hostClass: "aliyun_oss_regional"
});
assert.deepEqual(getMissingBeautyProviderAssetRuntimeHosts(runtimeHosts), []);

// LQ-27 现场（2026-09-13）：百炼图生视频结果落到 dashscope-0484.oss-cn-wulanchabu.aliyuncs.com，
// 区域白名单只认 cn-beijing / accelerate → artifact_host_not_approved，任务 FAILED 且积分退回。
const wulanchabuHosts = [...runtimeHosts, "oss-cn-wulanchabu.aliyuncs.com"];
const wulanchabuUrl =
  "https://dashscope-0484.oss-cn-wulanchabu.aliyuncs.com/synthetic/path/video.mp4?Expires=1789364806&Signature=redacted";
assert.deepEqual(validateBeautyProviderAssetUrl(wulanchabuUrl, wulanchabuHosts), {
  policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
  hostClass: "aliyun_oss_regional"
});
assert.deepEqual(
  validateBeautyProviderAssetUrl(
    "https://dashscope-9999.oss-cn-hangzhou.aliyuncs.com/other/region.mp4",
    [...wulanchabuHosts, "oss-cn-hangzhou.aliyuncs.com"]
  ),
  { policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION, hostClass: "aliyun_oss_regional" }
);
assert.deepEqual(
  validateBeautyProviderAssetUrl(
    "https://dashscope-result-bj.oss-accelerate.aliyuncs.com/synthetic/path/video.mp4",
    wulanchabuHosts
  ),
  { policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION, hostClass: "aliyun_oss_accelerate" }
);

// 资产落库侧：白名单按「精确或子域」放行 + 结果 http 升级 https（Aliyun OSS 支持 https；验证仍拒绝裸 http）。
assert.equal(isResultHostAllowed("dashscope-0484.oss-cn-wulanchabu.aliyuncs.com", ["oss-cn-wulanchabu.aliyuncs.com"]), true);
assert.equal(isResultHostAllowed("other.aliyuncs.com", ["oss-cn-wulanchabu.aliyuncs.com"]), false);
assert.equal(
  normalizeAliyunOssResultUrl("http://dashscope-0484.oss-cn-wulanchabu.aliyuncs.com/a.mp4", ["oss-cn-wulanchabu.aliyuncs.com"]),
  "https://dashscope-0484.oss-cn-wulanchabu.aliyuncs.com/a.mp4"
);
assert.equal(
  normalizeAliyunOssResultUrl("https://dashscope-0484.oss-cn-wulanchabu.aliyuncs.com/a.mp4", ["oss-cn-wulanchabu.aliyuncs.com"]),
  "https://dashscope-0484.oss-cn-wulanchabu.aliyuncs.com/a.mp4"
);
assert.equal(
  normalizeAliyunOssResultUrl("http://evil.invalid/a.mp4", ["oss-cn-wulanchabu.aliyuncs.com"]),
  "http://evil.invalid/a.mp4",
  "非白名单主机不做协议升级（后续会被 persist 拒绝）"
);
assert.deepEqual(
  getMissingBeautyProviderAssetRuntimeHosts(["dashscope.aliyuncs.com", "oss-cn-beijing.aliyuncs.com"]),
  ["oss-accelerate.aliyuncs.com"],
  "an explicit runtime allowlist must not silently drop the official Bailian asset host"
);

const rejected = [
  "http://dashscope-result-bj.oss-accelerate.aliyuncs.com/image.png",
  "https://user:pass@dashscope-result-bj.oss-accelerate.aliyuncs.com/image.png",
  "https://dashscope-result-bj.oss-accelerate.aliyuncs.com:8443/image.png",
  "https://oss-accelerate.aliyuncs.com.evil.invalid/image.png",
  "https://127.0.0.1/image.png",
  "https://169.254.169.254/latest/meta-data",
  "https://evil.invalid/image.png"
];

for (const value of rejected) {
  assert.throws(() => validateBeautyProviderAssetUrl(value, runtimeHosts), /beauty_provider_asset_url_rejected/);
}
// 供应商结果区域由调度决定且会变（wulanchabu / hangzhou / accelerate 均已实测）：
// 安全边界收敛为「阿里云 OSS 域名族」，env 基域缺该区域也不得挡真实成片（协议仍强制 https）。
assert.deepEqual(
  validateBeautyProviderAssetUrl(
    "https://dashscope-9999.oss-cn-hangzhou.aliyuncs.com/other/region.mp4",
    ["dashscope.aliyuncs.com", "oss-cn-beijing.aliyuncs.com", "oss-accelerate.aliyuncs.com"]
  ),
  { policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION, hostClass: "aliyun_oss_regional" }
);
assert.deepEqual(
  validateBeautyProviderAssetUrl(acceleratorUrl, ["dashscope.aliyuncs.com", "oss-cn-beijing.aliyuncs.com"]),
  { policyVersion: BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION, hostClass: "aliyun_oss_accelerate" }
);

process.stdout.write(`beauty_image_asset_url_policy_p1_smoke=PASS;policy=${BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION};accepted=2;rejected=${rejected.length};provider_calls=0;external_network=0\n`);
