#!/usr/bin/env node
/**
 * 内测实例「点任一功能先出现中间页」契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 用户 2026-09-11 反馈：在内测实例（`https://api.lcppch.top/lanqi-test`，`VITE_DIRECT_TEST_LOGIN=true`）
 * 点任一功能都会先看到一屏
 * `兰琪美业 · 内测实例 / 正在进入体验工作区 / 正在进入美业智能体体验工作区…`。
 *
 * 根因：内测实例的侧栏导航是**整页跳转**（`LanqiBrainShell` 用 `<a href>`），每次跳转都会
 * 重新挂载 `main.tsx` 的 `DirectTestLoginGate`；而 Gate 以前不管本地有没有会话，初态一律
 * `"checking"`，必须等 `ensureDirectTestSession()` 里的探活请求回来才渲染页面。
 * 于是「明明已经登录」的每次导航都被挡成中间页。
 *
 * 契约（回归红线）：
 *  1) `ensureDirectTestSession()` 必须能区分「这次真的新建了会话」和「本地已有可用会话」，
 *     否则调用方无法判断要不要重新取数；
 *  2) Gate 初态必须依据本地会话判定：已有会话直接渲染 children，不得无条件进 `"checking"`；
 *  3) 后台校验失败时，已渲染的页面不得被整页换成错误页（只在首屏没有会话时提示失败）；
 *  4) 生产实例（开关关闭）行为不变：初态仍为 `"ready"`，不触发任何体验会话请求。
 *
 * 真实页面口径由 `scripts/lanqi-test-instance-splash-browser-e2e.mjs` 在内测实例上跑。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const main = read("apps/web/src/main.tsx");
const session = read("apps/web/src/lib/direct-test-session.ts");

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function requireMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, hit, hit ? `命中 ${String(pattern)}` : `缺少 ${String(pattern)}`);
}

function forbidMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, !hit, hit ? `仍存在 ${String(pattern)}` : "未出现");
}

// ① 会话层：必须能区分「新建」与「复用」
requireMatch(
  session,
  /export function hasDirectTestSession\(\): boolean \{\s*return DIRECT_TEST_LOGIN_ENABLED && Boolean\(readStoredToken\(\)\);/,
  "会话层：导出 hasDirectTestSession()，只看本地是否已有体验会话（不发网络请求）"
);
requireMatch(
  session,
  /export function ensureDirectTestSession\(\): Promise<boolean>/,
  "会话层：ensureDirectTestSession() 返回 boolean（true=本次新建会话）"
);
requireMatch(
  session,
  /if \(existing && \(await sessionIsUsable\(existing\)\)\) return false;/,
  "会话层：已有可用会话时返回 false（复用，不重建）"
);
requireMatch(
  session,
  /await createTestSession\(\);\s*return true;/,
  "会话层：会话缺失/失效时重建并返回 true"
);

// ② 门卫组件：初态必须依据本地会话，且会话校验放到后台
requireMatch(
  main,
  /import \{[\s\S]*?ensureDirectTestSession,[\s\S]*?hasDirectTestSession,[\s\S]*?\} from "\.\/lib\/direct-test-session\.js";/,
  "main.tsx：DirectTestLoginGate 同时引入 hasDirectTestSession 与 ensureDirectTestSession"
);
requireMatch(
  main,
  /const renderedWithStoredSession = useRef\(hasDirectTestSession\(\)\);/,
  "main.tsx：进入 Gate 时先看本地是否已有会话"
);
requireMatch(
  main,
  /DIRECT_TEST_LOGIN_ENABLED && !renderedWithStoredSession\.current \? "checking" : "ready"/,
  "main.tsx：已有会话时初态直接 ready（不渲染中间页）；无会话才 checking"
);
forbidMatch(
  main,
  /useState<"checking" \| "ready" \| "failed">\(\s*DIRECT_TEST_LOGIN_ENABLED \? "checking" : "ready"\s*\)/,
  "main.tsx：Gate 初态不得再无条件下钻到 checking（本次缺陷的原始写法）"
);
requireMatch(
  main,
  /\.then\(\(created\) => \{/,
  "main.tsx：后台校验拿到「是否新建会话」的结果"
);
requireMatch(
  main,
  /if \(created && renderedWithStoredSession\.current\) \{/,
  "main.tsx：后台发现旧会话失效并重建时，才让页面刷新重取数据"
);
requireMatch(
  main,
  /const last = Number\(sessionStorage\.getItem\(key\) \?\? 0\);\s*if \(!Number\.isFinite\(last\) \|\| Date\.now\(\) - last > 15_000\) \{/,
  "main.tsx：自动刷新有 15 秒节流，避免会话建不起来时刷新死循环"
);
requireMatch(
  main,
  /if \(renderedWithStoredSession\.current\) \{\s*setState\("ready"\);\s*return;\s*\}/,
  "main.tsx：已渲染页面不会被一次后台校验失败换成错误页"
);

// ③ 生产实例（开关关闭）不受影响
forbidMatch(
  session,
  /hasDirectTestSession\(\)[^\n]*fetch\(/,
  "会话层：hasDirectTestSession() 不发网络请求（首屏零等待）"
);
requireMatch(
  session,
  /export function ensureDirectTestSession\(\): Promise<boolean> \{\s*if \(!DIRECT_TEST_LOGIN_ENABLED\) return Promise\.resolve\(false\);/,
  "会话层：生产实例（开关关闭）立即返回 false，行为不变"
);

console.log(`\nlanqi_test_splash_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed, ${results.length} checks)`);
process.exit(failures === 0 ? 0 : 1);
