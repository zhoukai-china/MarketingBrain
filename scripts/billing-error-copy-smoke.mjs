#!/usr/bin/env node
/**
 * 充值 / 账单页的错误文案契约（QA-20260914-001，WorkBuddy《新用户链路验收报告》两条红灯）。
 *
 * 现场证据（2026-09-12，生产 + 测试实例）：
 *   · P1：合成 500（`mock server error`）被页面原样直出——英文开发期文案暴露给门店；
 *   · P2：断网时页面直出 `Failed to fetch`，既不是人话也没有重试指引。
 *
 * 旧实现只在「整串都是 [a-z0-9_:-]」（无空格的机器码）时才回落到中文兜底，
 * 所以带空格的英文句子一定会漏出去。这里锁死四条：
 *   ① 无中文、非已知业务码的错误 → 必须变成中文兜底，原串一个字符都不许出现；
 *   ② 网络类异常 → 中文人话 + 重试指引；
 *   ③ 已知业务码 → 仍然是原来那句中文；
 *   ④ 服务端已经给的中文提示 → 原样保留，不被英文兜底吃掉。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

const hasChinese = (value) => /[\u4e00-\u9fa5]/.test(value);
const { billingErrorCopy } = await import("../apps/web/src/lib/humanize-error.ts");

const FALLBACK = "下单失败，请稍后重试。";

const mockServer = billingErrorCopy(new Error("mock server error"), FALLBACK);
record(
  "非中文服务端错误（mock server error）不外泄",
  hasChinese(mockServer) && !/mock|server error/i.test(mockServer),
  mockServer
);

const internalError = billingErrorCopy(new Error("Internal Server Error"), FALLBACK);
record(
  "英文 500 文案（Internal Server Error）不外泄",
  hasChinese(internalError) && !/internal/i.test(internalError),
  internalError
);

const offline = billingErrorCopy(new TypeError("Failed to fetch"), FALLBACK);
record("断网 → 中文人话 + 重试指引", hasChinese(offline) && /网络/.test(offline) && /(再试|重试)/.test(offline), offline);

const insufficient = billingErrorCopy(new Error("insufficient_credits"), FALLBACK);
record("积分不足业务码仍是原提示", /积分不足/.test(insufficient), insufficient);

const loginRequired = billingErrorCopy(new Error("login_required"), FALLBACK);
record("登录失效业务码仍是原提示", /登录/.test(loginRequired), loginRequired);

const serverChinese = billingErrorCopy(new Error("微信支付未配置，请联系管理员。"), FALLBACK);
record("服务端中文提示原样保留", serverChinese.includes("微信支付未配置"), serverChinese);

const emptyReason = billingErrorCopy(undefined, FALLBACK);
record("空异常回落到调用方兜底", emptyReason === FALLBACK, emptyReason);

const recharge = read("apps/web/src/pages/RechargePage.tsx");
record("充值页使用统一账单错误文案", recharge.includes("billingErrorCopy"), "");
record(
  "充值页不再用「整串机器码」判断是否兜底（旧漏点已移除）",
  !/\^\[a-z0-9_:-\]\+\$\/i\.test\(message\)/.test(recharge),
  ""
);
record("充值页不直出原始 reason.message", !/setError\(reason instanceof Error \? reason\.message/.test(recharge), "");

console.log(`\nbilling_error_copy_smoke: ${results.length - failures} passed / ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
