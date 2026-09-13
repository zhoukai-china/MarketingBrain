#!/usr/bin/env node
/**
 * 兰琪私域两页的错误文案契约（QA-20260913-005，WorkBuddy 内测报告 #9 红灯）。
 *
 * 现场：断网时页面只显示英文 `Failed to fetch`，既不是人话也没有重试入口。
 * 这里锁三件事：
 *   ① 网络类异常必须变成中文人话（含"网络"与"再试/重试"）；
 *   ② 任何情况下都不允许把纯英文/无中文的原始错误直接抛给门店；
 *   ③ 两页的报错态都要有可见的重试入口（重新生成 / 再试一次）。
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

const { humanizeAsyncError } = await import("../apps/web/src/lib/humanize-error.ts");

const network = humanizeAsyncError(new TypeError("Failed to fetch"));
record("网络异常 → 中文人话 + 重试指引", /网络/.test(network) && /(再试|重试)/.test(network), network);

const safariNetwork = humanizeAsyncError(new Error("Load failed"));
record("Safari 网络文案同样被识别", /网络/.test(safariNetwork), safariNetwork);

const timeout = humanizeAsyncError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
record("超时/中断 → 中文人话", /超时|网络/.test(timeout) && /(再试|重试)/.test(timeout), timeout);

const unknownEnglish = humanizeAsyncError(new Error("Internal Server Error"));
record("未知英文错误不外泄（兜底中文）", /[\u4e00-\u9fa5]/.test(unknownEnglish), unknownEnglish);

const chinese = humanizeAsyncError(new Error("生成内容未通过合规门禁：违规引导词"));
record("已有的中文业务提示原样保留", chinese.includes("合规门禁"), chinese);

const momentsPage = read("apps/web/src/pages/LanqiMomentsPage.tsx");
const wechatPage = read("apps/web/src/pages/LanqiMomentsWechatGroupPage.tsx");
for (const [label, source] of [["朋友圈", momentsPage], ["微信群", wechatPage]]) {
  record(`${label}页使用统一错误人话化`, source.includes("humanizeAsyncError"), "");
  record(`${label}页报错态有重试入口`, /data-lanqi-retry/.test(source), "");
  record(`${label}页不再直出原始 e.message`, !/setError\(e instanceof Error \? e\.message/.test(source), "");
}

console.log(`\nlanqi_moments_error_copy_smoke: ${results.length - failures} passed / ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
