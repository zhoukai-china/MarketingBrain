// 兰琪「微信授权登录」失败路径生产探针（只读，不建租户、不消耗席位）。
//
// 背景：③ 真人微信扫码是人工路径，正常路径无法自动化；但它的失败分支必须可回归，
// 否则一旦上游改动导致「500 / 英文内部错误 / 缺 state 仍发请求」这类回归，
// 只能等真人扫码时才暴露。本脚本把失败分支固化成可重复执行的生产探针。
//
// 覆盖：
//   A 接口层（POST /auth/wechat-login）
//     A1 缺 code            -> 400 invalid_request，不透传内部信息
//     A2 code 为空串        -> 400 invalid_request
//     A3 非法 tenantHostname-> 400 invalid_tenant_domain（不触发外部换取）
//     A4 无效 code          -> 明确的业务错误（非 5xx），且不透传上游/内部信息
//   B 页面层（/wechat-callback，CDP 实际渲染）
//     B1 缺 state           -> 页内拒绝，且 0 次访问 /auth/wechat-login
//     B2 state 不匹配       -> 页内拒绝，且 0 次访问 /auth/wechat-login
//     B3 state 匹配但用户取消（无 code + errcode=access_denied）-> 提示取消，0 次换取
//     B4 state 匹配 + 无效 code -> 发起换取并给出中文可读错误，不得显示英文内部错误
//
// 用法：
//   WECHAT_PROBE_WEB_URL=https://api.lcppch.top/os-v2 \
//   node scripts/tmp/prod-lanqi-wechat-failure-paths.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.WECHAT_PROBE_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const apiBase = process.env.WECHAT_PROBE_API_BASE ?? `${webBase}/api`;
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.WECHAT_PROBE_SHOT_DIR ?? path.join(tmpdir(), `lanqi-wechat-failure-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 任何响应体都不允许出现的内部信息特征。
const LEAK_PATTERNS = [
  [/at\s+\S+\s+\(.*:\d+:\d+\)/, "stack frame"],
  [/node_modules/, "node_modules path"],
  [/\bError:\s/, "raw Error string"],
  [/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/, "network errno"],
  [/WECHAT_AUTH_SECRET/, "secret env name"],
  [/secret=/i, "secret query param"],
  [/[A-Za-z]:\\[^"\\]*(?:apps|packages|node_modules)/, "windows source path"],
];
const assertNoLeak = (label, text) => {
  for (const [re, name] of LEAK_PATTERNS) {
    assert.ok(!re.test(text), `${label} 响应泄露内部信息（${name}）：${text.slice(0, 240)}`);
  }
};

const results = [];
const check = async (id, title, fn) => {
  try {
    const detail = await fn();
    results.push({ id, title, status: "PASS", detail });
    console.log(`PASS ${id} ${title}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id, title, status: "FAIL", detail: message });
    console.error(`FAIL ${id} ${title} :: ${message}`);
  }
};

const postWechatLogin = async (body) => {
  const res = await fetch(`${apiBase}/auth/wechat-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 也照实记录 */ }
  return { status: res.status, text, json };
};

await mkdir(shotDir, { recursive: true });
const report = { webBase, apiBase, shotDir, results, api: [], page: {}, consoleErrors: [], shots: [], error: null };

// ---------- A 接口层 ----------
const invalidCode = `lanqi-probe-invalid-${Date.now()}`;
const apiCases = [
  { id: "A1", title: "缺 code 返回 400 invalid_request", body: {}, expectStatus: 400 },
  { id: "A2", title: "code 为空串返回 400 invalid_request", body: { code: "" }, expectStatus: 400 },
  { id: "A3", title: "非法 tenantHostname 返回 400 invalid_tenant_domain", body: { code: "x", tenantHostname: "not a host!!" }, expectStatus: 400 },
  { id: "A4", title: "无效 code 返回明确业务错误（非 5xx）", body: { code: invalidCode, productCode: "lanqi" }, expectStatus: null },
];

for (const c of apiCases) {
  await check(c.id, c.title, async () => {
    const r = await postWechatLogin(c.body);
    const record = { id: c.id, status: r.status, body: r.json ?? r.text.slice(0, 400) };
    report.api.push(record);
    assertNoLeak(c.id, r.text);
    if (c.expectStatus !== null) {
      assert.equal(r.status, c.expectStatus, `${c.id} 期望 HTTP ${c.expectStatus}，实际 ${r.status}：${r.text.slice(0, 240)}`);
      const err = r.json?.error;
      if (c.id === "A1" || c.id === "A2") assert.equal(err, "invalid_request", `${c.id} 期望 error=invalid_request，实际 ${err}`);
      if (c.id === "A3") assert.equal(err, "invalid_tenant_domain", `${c.id} 期望 error=invalid_tenant_domain，实际 ${err}`);
      return record;
    }
    // A4：无效授权码属于可预期的业务失败，必须给调用方一个可读的中文业务错误，
    // 不能是 5xx，也不能把上游微信的英文 errmsg 直接抛给用户界面。
    assert.ok(r.status < 500, `A4 无效 code 不应返回 5xx（实际 ${r.status}）：${r.text.slice(0, 240)}`);
    const message = String(r.json?.message ?? r.json?.error ?? "");
    assert.ok(/[\u4e00-\u9fa5]/.test(message), `A4 错误信息需为中文可读文案，实际：${message || r.text.slice(0, 240)}`);
    assert.ok(!/Internal Server Error/i.test(r.text), "A4 不应返回 Internal Server Error");
    assert.ok(!/WeChat OAuth/i.test(r.text), "A4 不应把上游 WeChat OAuth 原始错误透传给前端");
    return record;
  });
}

// ---------- B 页面层（CDP） ----------
const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-wechat-probe-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1000", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

let socket = null;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("DevTools endpoint timeout")), 15000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => {
      out += c;
      const m = out.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.once("exit", (code) => reject(new Error(`chrome exited early (${code})`)));
  });

  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const wechatLoginRequests = [];
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
    }
    if (msg.method === "Network.requestWillBeSent" && String(msg.params?.request?.url ?? "").includes("/auth/wechat-login")) {
      wechatLoginRequests.push(msg.params.request.url);
    }
    if (!msg.id) return;
    const h = pending.get(msg.id);
    if (!h) return;
    pending.delete(msg.id);
    msg.error ? h.reject(new Error(msg.error.message)) : h.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (sessionId, fn, args) => {
    const res = await send("Runtime.evaluate", {
      expression: args ? `(${fn})(${JSON.stringify(args)})` : `(${fn})()`,
      returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "evaluate failed");
    return res.result?.value;
  };
  const waitFor = async (sessionId, fn, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await evaluate(sessionId, fn).catch(() => false);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`waitFor timeout: ${fn}`);
      await delay(250);
    }
  };
  const shot = async (sessionId, name) => {
    const file = path.join(shotDir, name);
    await writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
    report.shots.push(file);
    return file;
  };
  const bodyText = (sessionId) => evaluate(sessionId, `() => document.body.innerText || ""`);
  const seedSession = (sessionId, values) => evaluate(sessionId, `(values) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === null) { sessionStorage.removeItem(k); continue; }
      if (String(k).startsWith("local:")) { localStorage.setItem(String(k).slice(6), v); continue; }
      sessionStorage.setItem(k, v);
    }
    return true;
  }`, values);
  const goto = async (sessionId, url, readyExpr) => {
    await send("Page.navigate", { url }, sessionId);
    await waitFor(sessionId, readyExpr, 30000);
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

  // 回到同源页面才能写 sessionStorage，模拟真人从登录页跳转到回调页的会话状态。
  await goto(sessionId, `${webBase}/login/lanqi`, `() => Boolean(document.querySelector(".loginPage, .productInviteForm, .loginCard"))`);

  const callback = (query) => `${webBase}/wechat-callback${query}`;
  const errorVisible = `() => {
    const el = document.querySelector(".loginError");
    return el && el.textContent.trim() ? el.textContent.trim() : false;
  }`;
  const countRequests = (from) => wechatLoginRequests.length - from;

  await check("B1", "缺 state：页内拒绝且不请求 /auth/wechat-login", async () => {
    await seedSession(sessionId, { wechat_oauth_state: null, wechat_tenant_hostname: null, store_os_product_login_code: "lanqi" });
    const from = wechatLoginRequests.length;
    await goto(sessionId, callback("?code=probe-code"), errorVisible);
    const text = await bodyText(sessionId);
    const requests = countRequests(from);
    await shot(sessionId, "01-missing-state.png");
    assert.match(text, /state 不匹配/, `缺 state 时页面应提示 state 校验失败，实际：${text.slice(0, 200)}`);
    assert.equal(requests, 0, `缺 state 时不应访问 /auth/wechat-login，实际 ${requests} 次`);
    assertNoLeak("B1", text);
    return { message: text.split("\n").find((l) => l.includes("state 不匹配")), requests };
  });

  await check("B2", "state 不匹配：页内拒绝且不请求 /auth/wechat-login", async () => {
    await seedSession(sessionId, { wechat_oauth_state: "probe-saved-state", store_os_product_login_code: "lanqi" });
    const from = wechatLoginRequests.length;
    await goto(sessionId, callback("?code=probe-code&state=probe-other-state"), errorVisible);
    const text = await bodyText(sessionId);
    const requests = countRequests(from);
    await shot(sessionId, "02-state-mismatch.png");
    assert.match(text, /state 不匹配/, `state 不匹配时页面应拒绝，实际：${text.slice(0, 200)}`);
    assert.equal(requests, 0, `state 不匹配时不应访问 /auth/wechat-login，实际 ${requests} 次`);
    assertNoLeak("B2", text);
    return { message: text.split("\n").find((l) => l.includes("state 不匹配")), requests };
  });

  await check("B3", "用户取消授权：提示取消且不请求 /auth/wechat-login", async () => {
    await seedSession(sessionId, { wechat_oauth_state: "probe-cancel-state", store_os_product_login_code: "lanqi" });
    const from = wechatLoginRequests.length;
    await goto(sessionId, callback("?state=probe-cancel-state&errcode=access_denied"), errorVisible);
    const text = await bodyText(sessionId);
    const requests = countRequests(from);
    await shot(sessionId, "03-access-denied.png");
    assert.match(text, /取消/, `用户取消授权时应提示取消，实际：${text.slice(0, 200)}`);
    assert.equal(requests, 0, `用户取消时不应访问 /auth/wechat-login，实际 ${requests} 次`);
    assertNoLeak("B3", text);
    return { message: text.split("\n").find((l) => l.includes("取消")), requests };
  });

  const pageInvalid = { status: null, message: "" };
  await check("B4", "无效 code：发起换取并给出中文可读错误（非英文内部错误）", async () => {
    await seedSession(sessionId, { wechat_oauth_state: "probe-e2e-state", store_os_product_login_code: "lanqi" });
    const from = wechatLoginRequests.length;
    await goto(sessionId, callback(`?state=probe-e2e-state&code=${invalidCode}`), errorVisible);
    const text = await bodyText(sessionId);
    const requests = countRequests(from);
    pageInvalid.message = text.split("\n").find((l) => l.includes("微信")) ?? text.slice(0, 200);
    await shot(sessionId, "04-invalid-code.png");
    assert.ok(requests >= 1, `无效 code 时应访问 /auth/wechat-login 完成换取，实际 ${requests} 次`);
    assertNoLeak("B4", text);
    assert.ok(!/Internal Server Error/i.test(text), `页面不得显示英文内部错误，实际：${pageInvalid.message}`);
    assert.ok(!/WeChat OAuth/i.test(text), `页面不得显示上游原始错误，实际：${pageInvalid.message}`);
    assert.ok(/[\u4e00-\u9fa5]/.test(pageInvalid.message), `页面应显示中文错误文案，实际：${pageInvalid.message}`);
    return { message: pageInvalid.message, requests };
  });

  report.page = { wechatLoginRequests: wechatLoginRequests.length, invalidCodeMessage: pageInvalid.message };
  report.consoleErrors = consoleErrors;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (socket) socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

const failed = results.filter((r) => r.status === "FAIL");
report.summary = { total: results.length, pass: results.length - failed.length, fail: failed.length, infrastructureError: report.error };
await writeFile(path.join(shotDir, "lanqi-wechat-failure-report.json"), JSON.stringify(report, null, 2), "utf8");

if (report.error) {
  console.error(`prod_lanqi_wechat_failure_paths:ERROR ${report.error}`);
  process.exitCode = 1;
} else if (failed.length > 0) {
  console.error(`prod_lanqi_wechat_failure_paths:FAIL ${failed.length}/${results.length}`);
  process.exitCode = 1;
} else {
  console.log(`prod_lanqi_wechat_failure_paths:PASS ${results.length}/${results.length}`);
}
console.log(`report=${path.join(shotDir, "lanqi-wechat-failure-report.json")}`);
