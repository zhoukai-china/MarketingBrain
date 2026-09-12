// One-off read-only probe: inspect one OSS bucket's policy-relevant properties.
import { createRequire } from "node:module";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(repoRoot, "apps", "api", "package.json"));
const OSS = require("ali-oss");

const { OSS_PROBE_AK, OSS_PROBE_SK, OSS_PROBE_BUCKET } = process.env;
if (!OSS_PROBE_AK || !OSS_PROBE_SK || !OSS_PROBE_BUCKET) {
  console.error("missing OSS_PROBE_AK / OSS_PROBE_SK / OSS_PROBE_BUCKET");
  process.exit(2);
}

const client = new OSS({
  accessKeyId: OSS_PROBE_AK,
  accessKeySecret: OSS_PROBE_SK,
  bucket: OSS_PROBE_BUCKET,
  region: "oss-cn-beijing",
  endpoint: "oss-cn-beijing.aliyuncs.com",
  secure: true
});

const report = {};
for (const [key, fn] of [
  ["bucketInfo", () => client.getBucketInfo(OSS_PROBE_BUCKET)],
  ["versioning", () => client.getBucketVersioning(OSS_PROBE_BUCKET)],
  ["acl", () => client.getBucketACL(OSS_PROBE_BUCKET)],
  ["listOne", () => client.list({ "max-keys": 1, prefix: "beauty-industry/video-staging/v1/" })]
]) {
  try {
    const r = await fn();
    report[key] = { ok: true, data: r.res ? r.res : r };
  } catch (error) {
    report[key] = { ok: false, code: error?.code, status: error?.status, message: String(error?.message).slice(0, 160) };
  }
}
console.log(JSON.stringify(report, null, 2));
