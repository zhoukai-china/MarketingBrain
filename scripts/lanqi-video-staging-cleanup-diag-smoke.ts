// LQ-27 现场：暂存清理失败时，真实子原因被兜底成通用码，诊断不了（QA-20260913-005 同批发现）。
//
// 两件事必须锁住：
//   ① 传输层抛出非 ReplicationError（如 TypeError: socket hang up）时，审计要带上真实错误名，
//      不能再是一个看不出原因的 oss_transport_unknown；
//   ② 暂存释放失败时，租约上记的 errorCode 必须是**驱动给的具体码**，不能固定成通用码，
//      否则接口只会回一句 staging_cleanup_failed，运维无从下手。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOssPrivateVideoStaging } from "../apps/api/src/services/beauty-video-oss-staging.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const events: Array<{ code: string; detail?: string; operation: string }> = [];
const driver = createOssPrivateVideoStaging({
  config: {
    bucket: "lanqi-video-staging",
    region: "cn-beijing",
    prefix: "beauty-industry/video-staging/v1/lanqi-prod/",
    approvedOrigin: "https://lanqi-video-staging.oss-cn-beijing.aliyuncs.com"
  },
  credentials: () => ({
    accessKeyId: "STS.ABCDEFGHIJKLMNOP",
    accessKeySecret: "0123456789abcdef",
    securityToken: "security-token",
    expiresAt: Date.now() + 3600_000
  }),
  // 模拟现场：HTTPS 层直接报错（非我们自己的 ReplicationError）。
  transport: async () => {
    throw new TypeError("socket hang up");
  },
  now: () => Date.now(),
  audit: (event) => events.push(event as { code: string; detail?: string; operation: string })
});

const object = {
  key: `${"a".repeat(32)}-reference.mp4`,
  authorizationId: "auth-1",
  version: 1,
  fileId: "file-1",
  sha256: "b".repeat(64),
  role: "reference" as const,
  expiresAt: Date.now() + 600_000,
  mimeType: "video/mp4"
};

async function main() {
  try {
    await driver.remove(object);
  } catch {
    /* 预期失败 */
  }

  const transportEvent = events.find((event) => event.code === "oss_transport_unknown");
  assert("传输层失败被审计到", Boolean(transportEvent), JSON.stringify(events));
  assert(
    "审计里能看到真实错误名（TypeError: socket hang up）",
    Boolean(transportEvent?.detail && /TypeError/.test(transportEvent.detail) && /socket hang up/.test(transportEvent.detail)),
    String(transportEvent?.detail ?? "（无 detail）")
  );

  const source = readFileSync(fileURLToPath(new URL("../apps/api/src/services/beauty-video-private-staging.ts", import.meta.url)), "utf8");
  assert(
    "释放失败记的是驱动具体码（不再固定成通用码）",
    /errorCode:code/.test(source) && !/errorCode:"staging_cleanup_failed"/.test(source)
  );
  assert("释放失败按驱动码抛出（接口能直接看到子码）", /throw new ReplicationError\(code,503\)/.test(source));

  console.log(`\nlanqi_video_staging_cleanup_diag_smoke: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
