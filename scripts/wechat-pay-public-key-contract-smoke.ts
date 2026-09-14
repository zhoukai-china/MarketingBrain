/**
 * 微信支付公钥契约 smoke（离线：不连网、不调微信、不花钱）。
 *
 * 来源：2026-09-12 用户真实付款 ¥1 验证时暴露的 P1（QA-20260912-012）——
 * `WECHAT_PAY_PLATFORM_PUBLIC_KEY` 以「单行 + 字面 `\n`」写在 env 文件里，systemd 读 EnvironmentFile
 * 时吃掉反斜杠（`\n` → 字面 `n`），运行进程拿到的一行非法 PEM；回调验签抛
 * `error:1E08010C:DECODER routines::unsupported`，微信重试、订单停在 pending，钱已扣但系统不认。
 *
 * 本契约钉住：
 *  ① 合法 PEM 必须原样通过；
 *  ② 「systemd 吃掉反斜杠」那种畸形值必须抛出**明确指引**的配置错误（提示改用 `_FILE`），
 *     而不是让验签在客户付完钱之后才报 OpenSSL 的隐晦错误；
 *  ③ 完全不是 PEM 的值也必须报「不是合法 PEM」。
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertParsablePublicKey } from "../apps/api/src/services/wechat-pay.js";

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

let checks = 0;
function ok(condition: unknown, message: string): void {
  assert.ok(condition, `FAIL: ${message}`);
  checks += 1;
}

// ① 合法 PEM 原样通过
ok(assertParsablePublicKey(publicKey, "WECHAT_PAY_PLATFORM_PUBLIC_KEY") === publicKey, "合法 PEM 必须原样返回");

// ② systemd 吃掉反斜杠后的畸形值（单行、没有换行、头部后面直接跟字母）必须给出明确指引
const mangled = publicKey.replace(/\n/g, "n");
ok(!mangled.includes("\n"), "构造的畸形值确实只有一行");
let mangledError: Error | undefined;
try {
  assertParsablePublicKey(mangled, "WECHAT_PAY_PLATFORM_PUBLIC_KEY");
} catch (error) {
  mangledError = error as Error;
}
ok(mangledError !== undefined, "畸形单行 PEM 必须抛错");
const mangledIssues = (mangledError as unknown as { issues?: string[] })?.issues ?? [];
ok(mangledIssues.some((item) => item.includes("不是合法 PEM")), "错误信息必须点明「不是合法 PEM」");
ok(mangledIssues.some((item) => item.includes("WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE")), "错误信息必须指向 _FILE 形式的修法");
ok(mangledIssues.some((item) => item.includes("systemd")), "错误信息必须提示 systemd 转义这个根因");

// ③ 完全不是 PEM 的值
let garbageError: Error | undefined;
try {
  assertParsablePublicKey("not-a-pem-at-all", "WECHAT_PAY_PLATFORM_PUBLIC_KEY");
} catch (error) {
  garbageError = error as Error;
}
ok(garbageError !== undefined, "非 PEM 值必须抛错");
ok(((garbageError as unknown as { issues?: string[] })?.issues ?? []).some((item) => item.includes("不是合法 PEM")), "非 PEM 值也要报「不是合法 PEM」");

// ④ QA-20260913-001 加固：支付检查必须真的运行时读一次密钥（配置齐全不等于文件可读）。
const wechatPaySrc = readFileSync("apps/api/src/services/wechat-pay.ts", "utf8");
ok(wechatPaySrc.includes("export function probeWechatPayRuntimeKeys"), "wechat-pay.ts 必须导出 probeWechatPayRuntimeKeys（运行时读密钥探测）");
ok(wechatPaySrc.includes("getWechatPayPrivateKey()"), "探测必须走支付路径同一套私钥读取函数");
ok(wechatPaySrc.includes("getWechatPayPlatformPublicKey()"), "探测必须覆盖平台公钥运行时读取");
const healthSrc = readFileSync("apps/api/src/routes/health.ts", "utf8");
ok(healthSrc.includes("probeWechatPayRuntimeKeys()"), "health.ts 必须在 /ops/wechat-pay-check 调用运行时探测");
ok(healthSrc.includes("wechatPayRuntime"), "/ready 必须包含支付运行时探测（生产+必需时支付不可用直接红灯）");
ok(healthSrc.includes("wechat_pay: {"), "/ready 响应必须带 wechat_pay 检查项");

console.log(`[PASS] 合法 PEM 通过 / 畸形单行 PEM 与垃圾值都被拦下（${checks} 条断言）`);
console.log("PASS wechat-pay-public-key-contract-smoke");
