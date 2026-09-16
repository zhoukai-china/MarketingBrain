// LQ-27 爆款复刻出片 · OSS 传输层回归冒烟（纯本地，不连网、不带凭据）。
//
// 背景（2026-09-13 生产实跑定位）：Node v20.20.2 的 https.request 在 autoSelectFamily
// （Happy Eyeballs）下会以 `options.all = true` 调用自定义 `lookup`，旧签名
// `callback(null, address, family)` 只回一个 string，Node 按数组解构得到
// `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`，所有 OSS 请求瞬间失败，
// 被映射成 `oss_transport_unknown`（quote 不碰 OSS 所以"成功"，confirm 必挂）。
import {
  createPinnedIpLookup,
  rawErrorDetail
} from "../apps/api/src/services/beauty-video-oss-staging.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

type LookupCallback = (
  err: Error | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number
) => void;

async function invoke(options: unknown): Promise<{ address?: unknown; family?: unknown; error: Error | null }> {
  let captured: { address?: unknown; family?: unknown } = {};
  let errOut: Error | null = null;
  const lookup = createPinnedIpLookup("1.2.3.4", 4) as unknown as (
    host: string,
    options: unknown,
    callback: (...args: unknown[]) => void
  ) => void;
  await new Promise<void>((resolve) => {
    lookup("lanqi-video-staging.oss-cn-beijing.aliyuncs.com", options, ((error: Error | null, address?: unknown, family?: unknown) => {
      errOut = error;
      captured = { address, family };
      resolve();
    }) as LookupCallback);
  });
  return { ...captured, error: errOut };
}

async function main() {
  // Node ≥20 autoSelectFamily：options.all = true → 必须返回数组 [{address,family}]。
  const allTrue = await invoke({ all: true });
  assert(
    "all=true 时返回地址数组",
    Array.isArray(allTrue.address) &&
      (allTrue.address as Array<{ address: string; family: number }>)[0]?.address === "1.2.3.4" &&
      (allTrue.address as Array<{ address: string; family: number }>)[0]?.family === 4
  );
  assert("all=true 时不带 family 参数", allTrue.family === undefined);

  // 传统路径：options.all = false → 返回 (address, family)。
  const allFalse = await invoke({ all: false });
  assert("all=false 时返回字符串地址", allFalse.address === "1.2.3.4");
  assert("all=false 时返回 family", allFalse.family === 4);

  // 个别调用方直接传 boolean all（旧 Node 风格）。
  const booleanAll = await invoke(true);
  assert("options=true（boolean）时返回地址数组", Array.isArray(booleanAll.address));
  const booleanPlain = await invoke(false);
  assert("options=false（boolean）时返回字符串地址", booleanPlain.address === "1.2.3.4");

  // 无 options（Node 老版本普通调用）。
  const bare = await invoke(undefined);
  assert("options 为空时返回字符串地址", bare.address === "1.2.3.4");
  assert("options 为空时返回 family", bare.family === 4);

  // 原始错误诊断：包装层必须带上底层错误名/码/消息，不能再只看到统一的 oss_transport_unknown。
  const detail = rawErrorDetail({
    name: "TypeError",
    code: "ERR_INVALID_IP_ADDRESS",
    message: "Invalid IP address: undefined"
  });
  assert("原始错误诊断保留错误名与码", detail.includes("TypeError") && detail.includes("ERR_INVALID_IP_ADDRESS"));
  /**
   * 2026-09-16 修正过期断言：2026-09-15 的安全回归把「原始 message 原样落审计」改掉了
   * （上游 message 可能含签名 URL / 桶名 / AccessKeyId），现在只留 `messageFingerprint=<12 位 sha256>`。
   * 所以这里断言的是**指纹在、原文不在**——比旧断言更严格。
   */
  assert(
    "原始错误诊断只留消息指纹、不落原文（2026-09-15 安全口径）",
    /messageFingerprint=[a-f0-9]{12}/.test(detail) && !detail.includes("Invalid IP address")
  );

  console.log(`\nlanqi_video_oss_transport_smoke: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
