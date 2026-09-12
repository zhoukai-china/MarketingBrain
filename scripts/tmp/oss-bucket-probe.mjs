// One-off read-only probe: list OSS buckets for the (main) Aliyun AccessKey.
// No bucket is created, modified or read. Prints only names/locations.
import { createRequire } from "node:module";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(repoRoot, "apps", "api", "package.json"));
const OSS = require("ali-oss");

const accessKeyId = process.env.OSS_PROBE_AK;
const accessKeySecret = process.env.OSS_PROBE_SK;
if (!accessKeyId || !accessKeySecret) {
  console.error("missing OSS_PROBE_AK / OSS_PROBE_SK");
  process.exit(2);
}

const client = new OSS({
  accessKeyId,
  accessKeySecret,
  region: "oss-cn-beijing",
  endpoint: "oss-cn-beijing.aliyuncs.com",
  secure: true
});

const res = await client.listBuckets({ "max-keys": 200 });
const buckets = (res.buckets ?? []).map((b) => ({
  name: b.name,
  region: b.region,
  storageClass: b.storageClass,
  creationDate: b.creationDate
}));
console.log(JSON.stringify({ count: buckets.length, buckets }, null, 2));
