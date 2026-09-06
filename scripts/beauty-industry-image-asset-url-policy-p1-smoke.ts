import assert from "node:assert/strict";
import {
  BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION,
  getMissingBeautyProviderAssetRuntimeHosts,
  validateBeautyProviderAssetUrl
} from "../apps/api/src/services/beauty-provider-asset-policy.js";

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
assert.throws(
  () => validateBeautyProviderAssetUrl(acceleratorUrl, ["dashscope.aliyuncs.com", "oss-cn-beijing.aliyuncs.com"]),
  /beauty_provider_asset_runtime_host_missing/,
  "the stale acceptance allowlist must fail before a paid Provider task"
);

process.stdout.write(`beauty_image_asset_url_policy_p1_smoke=PASS;policy=${BEAUTY_PROVIDER_ASSET_URL_POLICY_VERSION};accepted=2;rejected=${rejected.length};provider_calls=0;external_network=0\n`);
