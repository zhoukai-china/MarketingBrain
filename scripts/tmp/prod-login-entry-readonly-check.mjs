// 只读验收：在真实部署实例上确认「登录 / 注册」入口渲染正确（微信一键 + 邀请码开工作区）。
// 不提交任何表单、不写任何数据，仅做页面与 console 检查。
// 用法：LOGIN_READONLY_WEB_URL=https://api.lcppch.top/os-v2 SHOT_DIR=... node scripts/tmp/prod-login-entry-readonly-check.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.LOGIN_READONLY_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `login-readonly-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "login-readonly-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1200", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

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

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
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
    returnByValue: true, awaitPromise: true
  }, sessionId);
  return res.result?.value;
};
const waitFor = async (sessionId, fn, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate(sessionId, fn).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${fn}`);
    await delay(300);
  }
};

await mkdir(shotDir, { recursive: true });
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  // 0. 匿名访问根路径：必须落到货架并提示未登录（不能是内测免登录实例）。
  await send("Page.navigate", { url: `${webBase}/` }, sessionId);
  const home = await waitFor(sessionId, `() => {
    const text = document.body.innerText;
    if (/内测实例|正在进入体验工作区/.test(text) || localStorage.getItem("store_os_token")) {
      return { directTest: true, text: text.slice(0, 120) };
    }
    if (window.location.pathname.endsWith("/market") && text.includes("货架")) {
      return { directTest: false, text: text.slice(0, 120) };
    }
    return false;
  }`);
  assert.equal(home.directTest, false, `this instance must not be a direct-test instance: ${home.text}`);
  const homeText = await evaluate(sessionId, `() => document.body.innerText`);
  assert.match(homeText, /行业智能体平台/, "root lands on the platform home");
  assert.match(homeText, /未登录/, "anonymous visitor is prompted to log in");
  const homeShot = path.join(shotDir, "01-root-market.png");
  await writeFile(homeShot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));

  // 1. /login 必须渲染平台登录/注册页，并给出微信入口 + 邀请码入口。
  await send("Page.navigate", { url: `${webBase}/login` }, sessionId);
  await waitFor(sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
  // 注意：这段字符串最终会被当成 JS 源码求值，正则里的 `/` 必须写成 `\\/`，
  // 否则模板字符串会把 `\/` 还原成裸 `/`，让正则字面量提前闭合、求值恒抛错。
  await waitFor(sessionId, `() => Boolean(document.querySelector(".wechatLoginBtn"))
    || /使用邀请码开通/.test(document.body.innerText)
    || /微信一键登录 \\/ 注册/.test(document.body.innerText)`);
  const loginText = await evaluate(sessionId, `() => document.body.innerText`);
  assert.match(loginText, /思潼AI 行业智能体平台/, "login page shows platform name");
  assert.match(loginText, /一个账号、一个积分钱包/, "login page explains the shared wallet");
  assert.doesNotMatch(loginText, /单项快速诊断/, "login page is not the legacy diagnosis flow");
  await writeFile(path.join(shotDir, "02-login-page.txt"), loginText, "utf8");

  // 2. 微信入口必须可用：按钮要先等 `/auth/wechat-config` 回来（加载期按钮是 disabled）。
  await waitFor(sessionId, `() => {
    const btn = document.querySelector(".wechatLoginBtn");
    return Boolean(btn) && !btn.disabled;
  }`, 20000);
  const wechatState = await evaluate(sessionId, `() => {
    const btn = document.querySelector(".wechatLoginBtn");
    const text = document.body.innerText;
    return {
      hasButton: Boolean(btn),
      disabled: btn ? btn.disabled : null,
      label: btn ? btn.textContent.trim() : null,
      configReady: text.includes("微信一键登录 / 注册"),
      unavailableNotice: /暂不可用|尚未配置/.test(text)
    };
  }`);
  await writeFile(path.join(shotDir, "03-wechat-state.json"), JSON.stringify(wechatState, null, 2), "utf8");
  assert.ok(wechatState.hasButton, "login page exposes the WeChat login button");
  assert.equal(wechatState.disabled, false, "WeChat login button is clickable");
  assert.equal(wechatState.configReady, true, "/auth/wechat-config reports configured");
  assert.equal(wechatState.unavailableNotice, false, "no 'wechat unavailable' notice is shown");
  const loginShot = path.join(shotDir, "02-login-page.png");
  await writeFile(loginShot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));

  // 3. 邀请码入口按服务端开关 INVITE_REQUIRED 分流（只读，不提交任何表单）。
  //   邀请制（true）：主入口是「使用邀请码开通」，展开后邀请码必填。
  //   开放注册（false，2026-09-10 产品拍板「去掉邀请码，只留微信一键登录/注册」）：
  //                     平台主入口不得再渲染任何邀请码入口或邀请码输入框。
  // 两种模式都必须给出明确文案，不允许「既不说要邀请码、也不说不要」的模糊态。
  const openRegistration = loginText.includes("不需要邀请码");
  const invitesNeeded = loginText.includes("（需邀请码）");
  assert.ok(
    openRegistration || invitesNeeded,
    "login page must state whether the invite code is required (开放注册 / 需邀请码)"
  );
  const formShot = path.join(shotDir, "04-invite-form.png");
  let formState;
  if (openRegistration) {
    assert.doesNotMatch(
      loginText,
      /用邀请码开通/,
      "开放注册下不得再出现邀请码入口（只留微信一键登录 / 注册）"
    );
    formState = await evaluate(sessionId, `() => ({
      forms: document.querySelectorAll(".loginForm form").length,
      inputs: document.querySelectorAll(".loginForm form input").length,
      inviteEntry: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("邀请码"))
    })`);
    assert.equal(formState.forms, 0, "开放注册下不得渲染工作区 / 邀请码表单，用户只能走微信一键登录 / 注册");
    assert.equal(formState.inputs, 0, "开放注册下不得渲染任何输入框（含邀请码）");
    assert.equal(formState.inviteEntry, false, "开放注册下不得出现任何带「邀请码」的按钮");
    await writeFile(path.join(shotDir, "04-open-registration.json"), JSON.stringify(formState, null, 2), "utf8");
    await writeFile(formShot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  } else {
    assert.match(loginText, /使用邀请码开通/, "邀请制时必须保留「使用邀请码开通」入口");
    const opened = await evaluate(sessionId, `() => {
      if (document.querySelector(".loginForm form")) return "already-open";
      const link = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("用邀请码开通"));
      if (!link) return false;
      link.click();
      return "clicked";
    }`);
    assert.notEqual(opened, false, "workspace entry is reachable from the login page");
    await waitFor(sessionId, `() => document.querySelectorAll(".loginForm form input").length >= 2`);
    formState = await evaluate(sessionId, `() => ({
      inputs: document.querySelectorAll(".loginForm form input").length,
      submit: document.querySelector(".loginSubmit")?.textContent?.trim() ?? null,
      invitePlaceholder: [...document.querySelectorAll(".loginForm form input")]
        .map((i) => i.getAttribute("placeholder") ?? "")
        .find((p) => p.includes("邀请")) ?? null
    })`);
    await writeFile(path.join(shotDir, "04-invite-form.json"), JSON.stringify(formState, null, 2), "utf8");
    await writeFile(formShot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
    assert.ok(formState.inputs >= 2, "invite form has workspace name + invite code inputs");
    assert.ok(formState.submit, "invite form exposes its submit action");
    assert.match(
      formState.invitePlaceholder ?? "",
      /邀请码/,
      "邀请制下邀请码输入框必须存在且可识别"
    );
  }

  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);

  console.log(
    "prod_login_entry_readonly_check:PASS"
    + ` base=${webBase}`
    + " root_market=PASS anonymous=PASS"
    + " login_page=PASS wallet_copy=PASS"
    + " wechat_button=PASS wechat_config=PASS"
    + ` invite_mode=${openRegistration ? "open-registration" : "invite-required"}`
    + " invite_form=PASS console_clean=PASS"
    + ` shots=${[homeShot, loginShot, formShot].join(",")}`
  );
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}
