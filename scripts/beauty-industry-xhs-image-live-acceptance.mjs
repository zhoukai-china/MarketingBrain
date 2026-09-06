import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const apiBase = process.env.BEAUTY_IMAGE_LIVE_API_URL ?? "http://127.0.0.1:3016";
const webBase = process.env.BEAUTY_IMAGE_LIVE_WEB_URL ?? "http://127.0.0.1:5176";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const grantPath = process.env.BEAUTY_IMAGE_LIVE_GRANT_PATH;
const runtimeRecordPath = process.env.BEAUTY_IMAGE_LIVE_RUNTIME_RECORD;
const operatorGate = process.env.BEAUTY_IMAGE_LIVE_OPERATOR_GATE === "true";
const resumeConsumedBatch = process.env.BEAUTY_IMAGE_LIVE_RESUME_CONSUMED_BATCH === "true";
const reuseRunId = process.env.BEAUTY_IMAGE_LIVE_REUSE_RUN_ID?.trim() ?? "";
const reuseTenantId = process.env.BEAUTY_IMAGE_LIVE_REUSE_TENANT_ID?.trim() ?? "";
const reuseUserId = process.env.BEAUTY_IMAGE_LIVE_REUSE_USER_ID?.trim() ?? "";
const expectOneRealTextRun = process.env.BEAUTY_IMAGE_LIVE_EXPECT_TEXT_CALLS === "1";
const combinedCostCeilingYuan = Number(process.env.BEAUTY_IMAGE_LIVE_COMBINED_COST_CEILING_YUAN ?? "NaN");
const apiLogPath = process.env.BEAUTY_IMAGE_LIVE_API_LOG?.trim() ?? "";
const visualVariant = process.env.BEAUTY_IMAGE_LIVE_VISUAL_VARIANT?.trim() ?? "";
const quoteOnlyVisualVariant = "自然摄影感，使用干净材质、水面反光、毛巾与绿植细节，不出现瓶罐包装、标签面或任何文字";
const expectedResumeJobIds = new Set((process.env.BEAUTY_IMAGE_LIVE_EXPECTED_JOB_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const quoteOnly = process.env.BEAUTY_IMAGE_LIVE_QUOTE_ONLY === "true";
const route = `/agents/beauty-industry/acquisition/xhs?apiBase=${encodeURIComponent(apiBase)}`;
const userInput = "为皮肤管理产品生成一套面向附近女性顾客的小红书图文";
const userInputSha256 = createHash("sha256").update(userInput).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readControlledJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/u, ""));
}

assert.ok(runtimeRecordPath, "controlled runtime record path is required");
if (quoteOnly) {
  assert.notEqual(process.env.BEAUTY_IMAGE_LIVE_APPROVED, "true", "quote-only mode must not carry paid image approval");
  assert.equal(Boolean(reuseRunId), true, "quote-only mode requires a persisted successful run");
  assert.equal(Boolean(grantPath), false, "quote-only mode must not receive a grant file");
} else {
  assert.equal(process.env.BEAUTY_IMAGE_LIVE_APPROVED, "true", "explicit live image approval is required");
  assert.ok(grantPath, "one-time grant path is required");
  assert.ok(visualVariant.length >= 20, "a distinct customer-facing visual variant is required for a new controlled batch");
  assert.doesNotMatch(visualVariant, /grant|runner|provider|验收|测试|批次|幂等/iu, "the visual variant must remain customer-facing rather than carrying internal markers");
}

async function createTenant(label) {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" })
  });
  const body = await response.json();
  assert.equal(response.status, 200, "synthetic acceptance tenant login failed");
  assert.ok(body.token, "synthetic acceptance token missing");
  return body.token;
}

function createSessionToken(tenantId, userId) {
  assert.ok(process.env.JWT_SECRET, "JWT_SECRET is required for reused-run browser admission");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1_000);
  const body = Buffer.from(JSON.stringify({ tenantId, userId, planCode: "local_standard", iat: now, exp: now + 86_400 })).toString("base64url");
  const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function readProfileHash(tenantId) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for profile isolation audit");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const profile = await prisma.tenantProfile.findUnique({ where: { tenantId }, select: { data: true, confirmedData: true, version: true } });
    return createHash("sha256").update(JSON.stringify(profile ?? null)).digest("hex");
  } finally {
    await prisma.$disconnect();
  }
}

async function readRunInputHash(runId) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for grant/run binding");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { input: true } });
    return createHash("sha256").update(run.input).digest("hex");
  } finally {
    await prisma.$disconnect();
  }
}

async function auditRun(runId) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for run audit");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { id: true, tenantId: true, status: true, capabilityId: true, skillVersion: true, qualityFlags: true, creditCost: true } });
    const mediaJobs = await prisma.lanqiMediaJob.count({ where: { previewId: runId, kind: "beauty_image" } });
    return { ...run, mediaJobs };
  } finally {
    await prisma.$disconnect();
  }
}

async function readProviderUsageAfter(offset) {
  if (!apiLogPath) return [];
  const text = await readFile(apiLogPath, "utf8");
  return text.slice(offset).split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.event === "domestic_provider_usage" ? [value] : [];
    } catch { return []; }
  });
}

async function apiJson(url, token, init = {}) {
  const response = await fetch(`${apiBase}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  // Current Windows Chrome may hand off to a profile-bound child and let the
  // launcher exit with code 0 before stderr prints the DevTools endpoint. The
  // browser-owned DevToolsActivePort file is the authoritative endpoint and
  // keeps the acceptance harness bound to this unique temporary profile.
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  let endpoint;
  const endpointDeadline = Date.now() + 15_000;
  while (Date.now() < endpointDeadline) {
    const activePort = await readFile(activePortPath, "utf8").catch(() => "");
    const [port, socketPath] = activePort.trim().split(/\r?\n/);
    if (/^\d+$/.test(port ?? "") && socketPath?.startsWith("/devtools/browser/")) {
      endpoint = `ws://127.0.0.1:${port}${socketPath}`;
      break;
    }
    await delay(100);
  }
  if (!endpoint) throw new Error(`Chrome DevTools endpoint timeout (launcher=${child.exitCode ?? "running"})`);
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const requestFailures = [];
  const confirmRequests = [];
  const confirmResponses = [];
  const requestMethods = new Map();
  const quoteRequests = [];
  const runRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`));
      else handler.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
    if (message.method === "Network.loadingFailed" && !message.params.canceled) requestFailures.push(message.params.errorText);
    if (message.method === "Network.requestWillBeSent") {
      const { url, method, postData } = message.params.request;
      requestMethods.set(message.params.requestId, method);
      if (method === "POST" && url === `${apiBase}/beauty-industry/acquisition/runs`) runRequests.push({ url });
      if (method === "POST" && /\/beauty-industry\/acquisition\/runs\/[^/]+\/media\/quote$/.test(url)) quoteRequests.push({ url, postData });
      if (method === "POST" && /\/beauty-industry\/acquisition\/runs\/[^/]+\/media\/confirm$/.test(url)) confirmRequests.push({ url, postData });
    }
    if (message.method === "Network.responseReceived") {
      const { url, status } = message.params.response;
      if (requestMethods.get(message.params.requestId) === "POST" && /\/beauty-industry\/acquisition\/runs\/[^/]+\/media\/confirm$/.test(url)) confirmResponses.push({ url, status });
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, requestFailures, confirmRequests, confirmResponses, quoteRequests, runRequests };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function createPage(cdp, token, width, height) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: width === 390 ? 3 : 1, mobile: width === 390 }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'", 15_000);
  await evaluate(cdp, sessionId, `(value) => localStorage.setItem("store_os_token", value)`, token);
  await cdp.send("Page.navigate", { url: `${webBase}${route}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "图文获客"`, 20_000);
  return { browserContextId, sessionId };
}

async function consumeGrant(expectedBusinessInputSha256, actualVisualRequirements) {
  const grant = await readControlledJson(grantPath);
  assert.equal(grant.approved, true);
  assert.match(grant.grantId, /^by(?:26-image-quality|35-image-composition|38-content-packaging|43-premium-delivery)-live-\d{8}-once-[a-f0-9]{12}$/);
  assert.equal(grant.provider, "aliyun_bailian");
  assert.equal(grant.model, "wan2.7-image");
  assert.equal(grant.imagePlanVersion, "beauty-xhs-image-plan-v2");
  assert.equal(grant.providerPromptVersion, "beauty-image-provider-prompt-v1.7");
  assert.equal(grant.safetyDetectorVersion, "beauty-image-safety-v2.16");
  assert.equal(grant.contentRoleContractVersion, "beauty-image-content-role-contract-v1");
  assert.equal(grant.compositionVersion, "beauty-image-composition-v1.1");
  if (operatorGate) {
    assert.ok(process.env.UPLOAD_DIR?.trim(), "UPLOAD_DIR must be explicit for live asset verification");
  }
  assert.equal(grant.maxProviderTasks, 3);
  assert.equal(grant.maxImages, 3);
  assert.equal(grant.maxCostYuan, 0.6);
  assert.equal(grant.textProviderCalls, expectOneRealTextRun ? 1 : 0);
  assert.equal(grant.videoProviderCalls, 0);
  assert.equal(grant.asrProviderCalls, 0);
  assert.equal(grant.automaticRetries, 0);
  assert.equal(grant.repairCalls, 0);
  assert.equal(grant.modelSwitches, 0);
  assert.equal(grant.businessInputSha256, expectedBusinessInputSha256, "grant must be bound to the exact persisted task input");
  assert.equal(actualVisualRequirements, visualVariant, "the browser-confirmed visual requirements must match the approved variant exactly");
  assert.equal(grant.visualRequirementsSha256, createHash("sha256").update(actualVisualRequirements).digest("hex"), "grant must be bound to the exact browser-confirmed visual requirements");
  const mediaContractSource = await readFile(new URL("../apps/api/src/products/beauty-industry/media-contract.ts", import.meta.url), "utf8");
  const compositionSource = await readFile(new URL("../apps/api/src/services/beauty-image-compositor.ts", import.meta.url), "utf8");
  assert.match(mediaContractSource, /BEAUTY_XHS_IMAGE_PLAN_VERSION\s*=\s*"beauty-xhs-image-plan-v2"/, "grant image plan version does not match current source");
  assert.match(mediaContractSource, /BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION\s*=\s*"beauty-image-provider-prompt-v1\.7"/, "grant prompt version does not match current source");
  assert.match(mediaContractSource, /BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION\s*=\s*"beauty-image-safety-v2\.15"/, "grant safety version does not match current source");
  assert.match(mediaContractSource, /BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION\s*=\s*"beauty-image-content-role-contract-v1"/, "grant content-role contract version does not match current source");
  assert.match(compositionSource, /BEAUTY_IMAGE_COMPOSITION_VERSION\s*=\s*"beauty-image-composition-v1\.1"/, "grant composition version does not match current source");
  assert.ok(Date.parse(grant.approvedAt) <= Date.now());
  assert.ok(Date.parse(grant.expiresAt) > Date.now(), "one-time image grant expired");
  const runtime = await readControlledJson(runtimeRecordPath);
  assert.equal(grant.sourceFingerprint, runtime.sourceFingerprint, "grant/runtime source fingerprint mismatch");
  assert.equal(grant.consumedAt, null, "one-time image grant was already consumed");
  const consumedPath = grantPath.replace(/\.json$/, ".consumed.json");
  await rename(grantPath, consumedPath);
  await writeFile(consumedPath, JSON.stringify({ ...grant, consumedAt: new Date().toISOString() }, null, 2), "utf8");
  return consumedPath;
}

async function waitForTerminalBatch(runId, token, timeoutMs = 10 * 60_000, expectedJobIds) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/jobs`, token);
    assert.equal(latest.response.status, 200);
    const jobs = expectedJobIds
      ? latest.body.jobs.filter((job) => expectedJobIds.has(job.id))
      : latest.body.jobs;
    if (expectedJobIds && jobs.length !== expectedJobIds.size) {
      await delay(250);
      continue;
    }
    if (["succeeded", "quality_failed"].includes(latest.body.batchStatus)) return { ...latest.body, jobs };
    await delay(2_000);
  }
  throw new Error(`image batch terminal timeout:${latest?.body?.batchStatus ?? "unknown"}`);
}

async function materializeOperatorReviewAsset(runId, job, index) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the operator review audit");
  const uploadDir = process.env.UPLOAD_DIR?.trim() || fileURLToPath(new URL("../apps/api/uploads/", import.meta.url));
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId }, select: { tenantId: true } });
    const tenantKey = createHash("sha256").update(run.tenantId).digest("hex").slice(0, 24);
    const base = path.resolve(uploadDir, "beauty-industry-media", tenantKey, job.id);
    const metadata = await readControlledJson(`${base}.json`);
    const extension = metadata.contentType === "image/jpeg" ? ".jpg" : metadata.contentType === "image/webp" ? ".webp" : ".png";
    const assetPath = metadata.customerComposite ? `${base}.final.png` : `${base}${extension}`;
    const bytes = await readFile(assetPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { index, assetPath, sha256, bytes: bytes.length, width: metadata.width, height: metadata.height };
  } finally {
    await prisma.$disconnect();
  }
}

async function waitForOperatorGatedBatch(runId, token, expectedJobIds, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const reviews = [];
  try {
    while (Date.now() < deadline) {
      const latest = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/jobs`, token);
      assert.equal(latest.response.status, 200);
      const jobs = expectedJobIds
        ? latest.body.jobs.filter((job) => expectedJobIds.has(job.id))
        : latest.body.jobs;
      if (expectedJobIds && jobs.length !== expectedJobIds.size) {
        await delay(250);
        continue;
      }
      if (["succeeded", "quality_failed"].includes(latest.body.batchStatus)) return { ...latest.body, jobs, operatorReviews: reviews };
      const pendingReview = jobs.find((job) => job.technicalStatus === "succeeded" && job.qualityStatus === "passed" && job.operatorQualityStatus === "pending");
      if (pendingReview) {
        const orderedIndex = jobs.findIndex((job) => job.id === pendingReview.id) + 1;
        const asset = await materializeOperatorReviewAsset(runId, pendingReview, orderedIndex);
        process.stdout.write(`AWAITING_OPERATOR_REVIEW ${JSON.stringify({ index: orderedIndex, jobId: pendingReview.id, providerTaskId: pendingReview.providerTaskId, assetPath: asset.assetPath, sha256: asset.sha256, bytes: asset.bytes })}\n`);
        const decision = (await input.question(`operator decision for image ${orderedIndex} (approve/reject): `)).trim().toLowerCase();
        assert.ok(decision === "approve" || decision === "reject", "operator decision must be approve or reject");
        const reviewed = await apiJson(`/beauty-industry/media/jobs/${encodeURIComponent(pendingReview.id)}/operator-review`, token, { method: "POST", body: JSON.stringify({ decision: decision === "approve" ? "approved" : "rejected" }) });
        assert.equal(reviewed.response.status, 200, "operator review must be accepted exactly once");
        reviews.push({ ...asset, decision });
        if (decision === "reject") {
          const terminal = await waitForTerminalBatch(runId, token, 30_000, expectedJobIds);
          return { ...terminal, operatorReviews: reviews };
        }
        continue;
      }
      const active = jobs.find((job) => job.technicalStatus === "submitted" || job.technicalStatus === "processing");
      if (active) {
        const refreshed = await apiJson(`/beauty-industry/media/jobs/${encodeURIComponent(active.id)}/refresh`, token, { method: "POST" });
        assert.equal(refreshed.response.status, 200, "Provider terminal refresh became unknown; stop without another task");
      }
      await delay(2_000);
    }
    throw new Error("operator-gated image batch timeout");
  } finally {
    input.close();
  }
}

async function auditProviderTasks(runId, terminalJobIds) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the non-secret Provider task-count audit");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const jobs = await prisma.lanqiMediaJob.findMany({
      where: { previewId: runId, kind: "beauty_image" },
      select: { id: true, providerTaskId: true, parameters: true, status: true }
    });
    const currentBatchIds = new Set(terminalJobIds);
    const currentBatch = jobs.filter((job) => currentBatchIds.has(job.id));
    const ordered = currentBatch.sort((left, right) => Number(left.parameters?.batchIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.parameters?.batchIndex ?? Number.MAX_SAFE_INTEGER));
    const providerTaskIds = ordered.map((job) => job.providerTaskId).filter(Boolean);
    return { jobs: ordered, providerTaskIds, count: providerTaskIds.length };
  } finally {
    await prisma.$disconnect();
  }
}

async function readPersistedMediaJobIds(runId) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for persisted batch identity audit");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const jobs = await prisma.lanqiMediaJob.findMany({ where: { previewId: runId, kind: "beauty_image" }, select: { id: true } });
    return new Set(jobs.map((job) => job.id));
  } finally {
    await prisma.$disconnect();
  }
}

async function auditResumedBatchLedger(jobIds) {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for resumed batch ledger audit");
  const { prisma } = await import("../packages/db/dist/index.js");
  try {
    const jobs = await prisma.lanqiMediaJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, billingStatus: true, parameters: true } });
    assert.equal(jobs.length, 3, "the resumed batch must contain exactly three persisted jobs");
    const reservationIds = [...new Set(jobs.map((job) => job.parameters && typeof job.parameters === "object" && !Array.isArray(job.parameters) ? job.parameters.reservationId : undefined).filter(Boolean))];
    assert.equal(reservationIds.length, 1, "the resumed batch must bind one credit reservation");
    const reservation = await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservationIds[0] }, select: { id: true, amount: true, actualAmount: true, status: true } });
    return { reservation, jobBillingStatuses: jobs.map((job) => job.billingStatus) };
  } finally {
    await prisma.$disconnect();
  }
}

async function selectHistoryRun(cdp, sessionId, runId) {
  await waitFor(cdp, sessionId, `document.querySelector("[data-testid='xhs-task-history'] button[data-run-id='${runId}']")`, 30_000);
  await evaluate(cdp, sessionId, `() => {
    const history = document.querySelector("[data-testid='xhs-task-history']");
    history.open = true;
    history.querySelector("button[data-run-id='${runId}']").click();
  }`);
  await waitFor(cdp, sessionId, `document.querySelector("[data-testid='xhs-task-history'] button.active")?.dataset.runId === "${runId}"`, 20_000);
  await waitFor(cdp, sessionId, `document.querySelectorAll("[data-testid='xhs-image-card']").length === 3`, 30_000);
}

async function prepareRetryQuote(cdp, sessionId, nextVisualRequirement) {
  const retryButtonReady = await evaluate(cdp, sessionId, `() => [...document.querySelectorAll(".beautyXhsImageDelivery button")].some((button) => !button.disabled && button.textContent?.includes("修改本次图片要求"))`);
  if (retryButtonReady) {
    await evaluate(cdp, sessionId, `() => {
      const retryButton = [...document.querySelectorAll(".beautyXhsImageDelivery button")].find((button) => !button.disabled && button.textContent?.includes("修改本次图片要求"));
      retryButton.click();
    }`);
    await delay(250);
  }
  await evaluate(cdp, sessionId, `(value) => {
    const visualStyle = [...document.querySelectorAll("label")].find((label) => label.textContent?.includes("三图总体视觉要求"))?.querySelector("textarea");
    if (!visualStyle) throw new Error("XHS visual requirement textarea missing");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(visualStyle, value);
    visualStyle.dispatchEvent(new Event("input", { bubbles: true }));
    visualStyle.dispatchEvent(new Event("change", { bubbles: true }));
  }`, nextVisualRequirement);
  await waitFor(cdp, sessionId, `[...document.querySelectorAll("label")].find((label) => label.textContent?.includes("三图总体视觉要求"))?.querySelector("textarea")?.value === ${JSON.stringify(nextVisualRequirement)}`, 5_000);
  return retryButtonReady;
}

async function waitForPersistedCustomerAssets(cdp, sessionId, expectedCount) {
  if (expectedCount === 0) return;
  await waitFor(
    cdp,
    sessionId,
    `document.querySelectorAll(".beautyXhsImageCards img").length === ${expectedCount} && [...document.querySelectorAll(".beautyXhsImageCards img")].every((image) => image.complete && image.naturalWidth > 0)`,
    30_000
  );
}

async function finishResumedBatch({ cdp, desktop, tokenA, tokenB, runId, consumedPath, expectedJobIds }) {
  assert.equal(expectedJobIds.size, 3, "resuming a live batch requires its exact three persisted job ids");
  const terminal = operatorGate ? await waitForOperatorGatedBatch(runId, tokenA, expectedJobIds) : await waitForTerminalBatch(runId, tokenA, 10 * 60_000, expectedJobIds);
  assert.equal(terminal.jobs.length, 3);
  assert.equal(new Set(terminal.jobs.map((job) => job.id)).size, 3);
  const providerAudit = await auditProviderTasks(runId, terminal.jobs.map((job) => job.id));
  const providerTasksCreated = providerAudit.count;
  assert.ok(providerTasksCreated >= 1 && providerTasksCreated <= 3);
  assert.equal(new Set(providerAudit.providerTaskIds).size, providerTasksCreated);
  const technicalSucceeded = terminal.jobs.filter((job) => job.technicalStatus === "succeeded").length;
  const qualityPassed = terminal.jobs.filter((job) => job.qualityStatus === "passed").length;
  const qualityRejected = terminal.jobs.filter((job) => job.qualityStatus === "rejected").length;
  const customerUsable = terminal.jobs.filter((job) => job.customerUsable).length;
  if (terminal.batchStatus === "succeeded") {
    assert.deepEqual({ providerTasksCreated, technicalSucceeded, qualityPassed, qualityRejected, customerUsable }, { providerTasksCreated: 3, technicalSucceeded: 3, qualityPassed: 3, qualityRejected: 0, customerUsable: 3 });
    assert.ok(terminal.jobs.every((job) => job.compositionStatus === "completed" && job.billingStatus === "charged"));
  } else {
    assert.equal(terminal.batchStatus, "quality_failed");
    assert.ok(qualityRejected >= 1 || terminal.jobs.some((job) => job.technicalStatus === "failed"));
    assert.equal(customerUsable, 0);
    assert.ok(terminal.jobs.every((job) => job.billingStatus === "refunded"));
  }

  const assets = [];
  for (const job of terminal.jobs) {
    const url = `/beauty-industry/media/assets/${encodeURIComponent(job.id)}`;
    const owner = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const isolated = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.equal(isolated.status, 404);
    if (terminal.batchStatus === "succeeded") {
      assert.equal(owner.status, 200);
      const bytes = Buffer.from(await owner.arrayBuffer());
      assets.push({ jobId: job.id, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } else assert.equal(owner.status, 404);
  }

  await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
  await selectHistoryRun(cdp, desktop.sessionId, runId);
  await waitForPersistedCustomerAssets(cdp, desktop.sessionId, terminal.batchStatus === "succeeded" ? 3 : 0);
  const desktopState = await evaluate(cdp, desktop.sessionId, `() => ({ images: [...document.querySelectorAll(".beautyXhsImageCards img")].map((img) => ({ width: img.naturalWidth, height: img.naturalHeight })), downloads: [...document.querySelectorAll(".beautyXhsImageCards button")].filter((button) => button.textContent?.includes("下载")).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.equal(desktopState.images.length, terminal.batchStatus === "succeeded" ? 3 : 0);
  assert.equal(desktopState.downloads, terminal.batchStatus === "succeeded" ? 3 : 0);
  assert.equal(desktopState.overflow, 0);
  if (terminal.batchStatus === "succeeded") assert.ok(desktopState.images.every((image) => image.width === 768 && image.height === 1024));

  const mobile = await createPage(cdp, tokenA, 390, 844);
  await selectHistoryRun(cdp, mobile.sessionId, runId);
  await waitForPersistedCustomerAssets(cdp, mobile.sessionId, terminal.batchStatus === "succeeded" ? 3 : 0);
  const mobileState = await evaluate(cdp, mobile.sessionId, `() => ({ images: document.querySelectorAll(".beautyXhsImageCards img").length, downloads: [...document.querySelectorAll(".beautyXhsImageCards button")].filter((button) => button.textContent?.includes("下载")).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.equal(mobileState.images, terminal.batchStatus === "succeeded" ? 3 : 0);
  assert.equal(mobileState.downloads, terminal.batchStatus === "succeeded" ? 3 : 0);
  assert.equal(mobileState.overflow, 0);

  const ledger = await auditResumedBatchLedger(terminal.jobs.map((job) => job.id));
  assert.equal(ledger.reservation.amount, 300);
  assert.equal(ledger.reservation.status, terminal.batchStatus === "succeeded" ? "settled" : "released");
  assert.equal(ledger.reservation.actualAmount, terminal.batchStatus === "succeeded" ? 300 : 0);
  assert.deepEqual(cdp.consoleErrors, []);
  assert.deepEqual(cdp.requestFailures, []);
  process.stdout.write(`${JSON.stringify({ ok: true, resumed: true, runId, grantFile: path.basename(consumedPath), batchStatus: terminal.batchStatus, providerTasksCreated, technicalSucceeded, qualityPassed, qualityRejected, customerUsable, conservativeCostYuan: Number((providerTasksCreated * 0.2).toFixed(2)), reservation: ledger.reservation, jobs: terminal.jobs.map((job) => ({ jobId: job.id, technicalStatus: job.technicalStatus, qualityStatus: job.qualityStatus, qualityReasons: job.qualityReasons, customerUsable: job.customerUsable, billingStatus: job.billingStatus })), operatorReviews: terminal.operatorReviews ?? [], images: assets.map((asset, index) => ({ ...asset, width: desktopState.images[index]?.width, height: desktopState.images[index]?.height })), desktop: "PASS", mobile390: "PASS", tenantIsolation: "PASS", consoleErrors: 0, providerCalls: providerTasksCreated })}\n`);
}

async function main() {
  const startedAt = Date.now();
  const stamp = Date.now();
  const providerLogOffset = apiLogPath ? Buffer.byteLength(await readFile(apiLogPath, "utf8")) : 0;
  if (!quoteOnly) assert.ok(Number.isFinite(combinedCostCeilingYuan) && combinedCostCeilingYuan <= 1, "combined Provider budget must be explicitly capped at one yuan");
  const worstTextCostYuan = expectOneRealTextRun ? 0.13 : 0;
  if (!quoteOnly) assert.ok(0.6 + worstTextCostYuan <= combinedCostCeilingYuan, "authorized combined ceiling cannot cover the image and text worst cases");
  assert.equal(Boolean(reuseRunId), Boolean(reuseTenantId && reuseUserId), "reused run identity must be complete");
  const tokenA = reuseRunId ? createSessionToken(reuseTenantId, reuseUserId) : await createTenant(`BY26三图质量终验-${stamp}`);
  const tokenB = await createTenant(`BY26三图隔离对照-${stamp}`);
  const initialCredits = await apiJson("/credits/transactions?limit=20", tokenA);
  assert.equal(initialCredits.response.status, 200);
  assert.ok(initialCredits.body.creditBalance >= (resumeConsumedBatch ? 0 : 300), resumeConsumedBatch ? "resumed batch credit balance is invalid" : "synthetic tenant needs at least 300 test credits");

  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by25-image-live-"));
  const cdp = await connectChrome(userDataDir);
  let consumedPath;
  try {
    const desktop = await createPage(cdp, tokenA, 1440, 1000);
    if (!reuseRunId) await evaluate(cdp, desktop.sessionId, `(value) => {
      const setField = (labelText, nextValue) => {
        const label = [...document.querySelectorAll("form label")].find((item) => item.textContent?.includes(labelText));
        const field = label?.querySelector("input,textarea");
        if (!field) throw new Error("XHS required field missing:" + labelText);
        const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(field, nextValue);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setField("本次主题与目的", value);
      setField("目标顾客", "附近女性顾客");
      setField("本次项目", "皮肤管理产品");
    }`, userInput);
    if (!reuseRunId) {
      await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary")?.disabled === false`, 10_000);
      await evaluate(cdp, desktop.sessionId, `() => document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary").click()`);
    } else {
      await waitFor(cdp, desktop.sessionId, `document.querySelector("[data-testid='xhs-task-history'] button[data-run-id='${reuseRunId}']")`, 20_000);
      await evaluate(cdp, desktop.sessionId, `() => {
        const history = document.querySelector("[data-testid='xhs-task-history']");
        history.open = true;
        history.querySelector("button[data-run-id='${reuseRunId}']").click();
      }`);
      await waitFor(cdp, desktop.sessionId, `document.querySelector("[data-testid='xhs-task-history'] button.active")?.dataset.runId === "${reuseRunId}"`, 20_000);
      await delay(250);
    }
    try {
      await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsTitlePicker")`, 30_000);
    } catch (error) {
      const recoveryState = await evaluate(cdp, desktop.sessionId, `() => ({
        historyButtons: document.querySelectorAll("[data-testid='xhs-task-history'] button").length,
        activeHistoryButtons: document.querySelectorAll("[data-testid='xhs-task-history'] button.active").length,
        resultHeading: document.querySelector(".beautyXhsResultPanel>header strong")?.textContent ?? "",
        visibleAlerts: [...document.querySelectorAll("[role='alert']")].map((item) => item.textContent?.slice(0, 120) ?? "")
      })`);
      process.stderr.write(`SAFE_RECOVERY_STATE ${JSON.stringify(recoveryState)}\n`);
      throw error;
    }
    if (resumeConsumedBatch) {
      assert.ok(reuseRunId && operatorGate, "resuming a consumed image batch requires a fixed run and operator gate");
      assert.match(path.basename(grantPath), /\.consumed\.json$/, "resume mode requires the already-consumed grant evidence");
      consumedPath = grantPath;
      await finishResumedBatch({ cdp, desktop, tokenA, tokenB, runId: reuseRunId, consumedPath, expectedJobIds: expectedResumeJobIds });
      return;
    }
    await prepareRetryQuote(cdp, desktop.sessionId, visualVariant || quoteOnlyVisualVariant);
    try {
      await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled === false`, 20_000);
    } catch (error) {
      const mediaRecoveryState = await evaluate(cdp, desktop.sessionId, `() => ({
        activeRunId: document.querySelector("[data-testid='xhs-task-history'] button.active")?.dataset.runId ?? "",
        mediaButtons: [...document.querySelectorAll(".beautyXhsImageDelivery button")].map((item) => ({ text: item.textContent?.trim() ?? "", disabled: item.disabled })),
        mediaStatus: document.querySelector(".beautyXhsImageDelivery")?.innerText?.slice(0, 1200) ?? "",
        visualRequirementLength: [...document.querySelectorAll("label")].find((label) => label.textContent?.includes("三图总体视觉要求"))?.querySelector("textarea")?.value.length ?? 0,
        alerts: [...document.querySelectorAll("[role='alert']")].map((item) => item.textContent?.slice(0, 120) ?? "")
      })`);
      const lastQuoteBody = cdp.quoteRequests.at(-1)?.postData ? JSON.parse(cdp.quoteRequests.at(-1).postData) : null;
      mediaRecoveryState.quoteRequestCount = cdp.quoteRequests.length;
      mediaRecoveryState.lastQuoteFlags = lastQuoteBody ? {
        retryAfterQualityFailure: lastQuoteBody.retryAfterQualityFailure === true,
        hasRetryOfJobId: Boolean(lastQuoteBody.retryOfJobId),
        overallVisualRequirementsLength: lastQuoteBody.imageRequirements?.overallVisualRequirements?.length ?? 0,
        prohibitedContentLength: lastQuoteBody.imageRequirements?.prohibitedContent?.length ?? 0
      } : null;
      // A disabled confirmation button is a fail-closed preflight in both
      // quote-only and live modes. Read the same authenticated quote once so
      // the runner reports the server state code instead of leaving a generic
      // grey-button symptom. This endpoint is non-billable and cannot create
      // media jobs or credit reservations.
      if (lastQuoteBody && reuseRunId) {
        const quoteDiagnosis = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(reuseRunId)}/media/quote`, tokenA, { method: "POST", body: JSON.stringify(lastQuoteBody) });
        mediaRecoveryState.quoteDiagnosis = {
          status: quoteDiagnosis.response.status,
          canConfirm: quoteDiagnosis.body?.canConfirm === true,
          code: quoteDiagnosis.body?.stateCode ?? quoteDiagnosis.body?.code ?? quoteDiagnosis.body?.error ?? "",
          message: quoteDiagnosis.body?.message ?? "",
          imageCount: quoteDiagnosis.body?.imageCount ?? 0,
          creditCost: quoteDiagnosis.body?.creditCost ?? 0
        };
      }
      process.stderr.write(`SAFE_MEDIA_RECOVERY_STATE ${JSON.stringify(mediaRecoveryState)}\n`);
      throw error;
    }
    const preflight = await evaluate(cdp, desktop.sessionId, `() => ({
      text: document.querySelector(".beautyXhsImageDelivery")?.innerText ?? "",
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      customer: [".beautyXhsTitlePicker", ".beautyXhsCopySection", ".beautyXhsTopicSection"].map((selector) => document.querySelector(selector)?.innerText ?? "").join("\\n"),
      environment: [
        document.querySelector(".beautyIndustryTestBanner")?.innerText ?? "",
        document.querySelector(".beautyXhsEnvironmentNotice")?.innerText ?? "",
        document.querySelector(".beautyXhsPreviewBoundary")?.innerText ?? ""
      ].filter(Boolean).join("\\n"),
      brand: document.body.innerText.includes("兰琪")
    })`);
    assert.match(preflight.text, /3 张 · 300 积分/);
    assert.doesNotMatch(preflight.text, /wan2\.7-image|aliyun_bailian|正向视觉提示词|负向视觉提示词/);
    assert.match(preflight.text, /文案已保存后，再由你确认积分并真实生成/);
    assert.match(preflight.text, /并与本次图文一起恢复/);
    if (!reuseRunId) {
      assert.match(preflight.customer, /皮肤管理产品/);
      assert.match(preflight.customer, /附近女性顾客/);
    }
    assert.doesNotMatch(preflight.customer, /controlled_mock|受控流程|Schema|Eval|待补|核验/);
    if (reuseRunId || expectOneRealTextRun) assert.doesNotMatch(preflight.environment, /controlled mock/);
    else assert.match(preflight.environment, /controlled mock|流程预览|正式发布内容/);
    if (reuseRunId) assert.equal(preflight.brand, true, "reused acceptance tenant must render the Lanqi brand pack");
    assert.equal(preflight.overflow, 0);
    assert.equal(cdp.runRequests.length, reuseRunId ? 0 : 1, "restoring a persisted formal text run must not create another text call");
    assert.ok(cdp.quoteRequests.length >= 1, "the Web path must complete a server-side quote before confirmation");
    const quoteRequest = cdp.quoteRequests.at(-1);
    const runId = reuseRunId || new URL(quoteRequest.url).pathname.split("/").at(-3);
    const quotePayload = quoteRequest.postData ? JSON.parse(quoteRequest.postData) : { imageCount: 3 };
    const quote = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/quote`, tokenA, { method: "POST", body: JSON.stringify(quotePayload) });
    assert.equal(quote.response.status, 200);
    assert.deepEqual({ imageCount: quote.body.imageCount, creditCost: quote.body.creditCost, canConfirm: quote.body.canConfirm, imagePlanVersion: quote.body.imagePlan?.version }, { imageCount: 3, creditCost: 300, canConfirm: true, imagePlanVersion: "beauty-xhs-image-plan-v2" });
    const creditsBeforeMedia = await apiJson("/credits/transactions?limit=30", tokenA);
    assert.equal(creditsBeforeMedia.response.status, 200);
    assert.ok(creditsBeforeMedia.body.creditBalance >= 300);

    if (quoteOnly) {
      const desktopQuoteState = await evaluate(cdp, desktop.sessionId, `() => ({
        button: document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.textContent?.trim() ?? "",
        disabled: document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled ?? true,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      })`);
      assert.equal(desktopQuoteState.disabled, false, "desktop explicit 300-credit confirmation must be enabled");
      assert.match(desktopQuoteState.button, /(?:确认真实生成三张图片|确认生成新一组三图|再次确认新批次)｜300 积分/);
      assert.equal(desktopQuoteState.overflow, 0);

      await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
      await waitFor(cdp, desktop.sessionId, `document.querySelector("[data-testid='xhs-task-history'] button[data-run-id='${runId}']")`, 20_000);
      await selectHistoryRun(cdp, desktop.sessionId, runId);
      await prepareRetryQuote(cdp, desktop.sessionId, quoteOnlyVisualVariant);
      try {
        await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled === false`, 20_000);
      } catch (error) {
        const restoredQuoteState = await evaluate(cdp, desktop.sessionId, `() => ({
          buttons: [...document.querySelectorAll(".beautyXhsImageDelivery button")].map((button) => ({ text: button.textContent?.trim() ?? "", disabled: button.disabled })),
          status: document.querySelector(".beautyXhsImageDelivery")?.innerText?.slice(0, 1200) ?? "",
          activeRunId: document.querySelector("[data-testid='xhs-task-history'] button.active")?.dataset.runId ?? "",
          visualRequirementLength: [...document.querySelectorAll("label")].find((label) => label.textContent?.includes("三图总体视觉要求"))?.querySelector("textarea")?.value.length ?? 0
        })`);
        const restoredQuoteBody = cdp.quoteRequests.at(-1)?.postData ? JSON.parse(cdp.quoteRequests.at(-1).postData) : null;
        restoredQuoteState.quoteRequestCount = cdp.quoteRequests.length;
        restoredQuoteState.lastQuoteFlags = restoredQuoteBody ? {
          retryAfterQualityFailure: restoredQuoteBody.retryAfterQualityFailure === true,
          hasRetryOfJobId: Boolean(restoredQuoteBody.retryOfJobId),
          overallVisualRequirementsLength: restoredQuoteBody.imageRequirements?.overallVisualRequirements?.length ?? 0
        } : null;
        if (restoredQuoteBody) {
          const quoteDiagnosis = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/quote`, tokenA, { method: "POST", body: JSON.stringify(restoredQuoteBody) });
          restoredQuoteState.quoteDiagnosis = {
            status: quoteDiagnosis.response.status,
            canConfirm: quoteDiagnosis.body?.canConfirm === true,
            code: quoteDiagnosis.body?.stateCode ?? quoteDiagnosis.body?.code ?? "",
            message: quoteDiagnosis.body?.message ?? ""
          };
        }
        process.stderr.write(`SAFE_RESTORED_QUOTE_STATE ${JSON.stringify(restoredQuoteState)}\n`);
        throw error;
      }

      const mobile = await createPage(cdp, tokenA, 390, 844);
      await waitFor(cdp, mobile.sessionId, `document.querySelector("[data-testid='xhs-task-history'] button[data-run-id='${runId}']")`, 20_000);
      await selectHistoryRun(cdp, mobile.sessionId, runId);
      await prepareRetryQuote(cdp, mobile.sessionId, quoteOnlyVisualVariant);
      await waitFor(cdp, mobile.sessionId, `document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled === false`, 20_000);
      const mobileQuoteState = await evaluate(cdp, mobile.sessionId, `() => ({
        button: document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.textContent?.trim() ?? "",
        disabled: document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled ?? true,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      })`);
      assert.equal(mobileQuoteState.disabled, false, "390px explicit 300-credit confirmation must be enabled");
      assert.match(mobileQuoteState.button, /(?:确认真实生成三张图片|确认生成新一组三图|再次确认新批次)｜300 积分/);
      assert.equal(mobileQuoteState.overflow, 0);

      const isolated = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/quote`, tokenB, { method: "POST", body: JSON.stringify(quotePayload) });
      assert.equal(isolated.response.status, 404, "another tenant must not quote the persisted run");
      assert.equal(cdp.confirmRequests.length, 0, "quote-only browser path must never confirm image generation");
      assert.deepEqual(await readProviderUsageAfter(providerLogOffset), [], "quote-only browser path must not create Provider usage events");
      assert.deepEqual(cdp.consoleErrors, []);
      assert.deepEqual(cdp.requestFailures, []);
      process.stdout.write(`${JSON.stringify({ ok: true, quoteOnly: true, runId, desktop1440: desktopQuoteState, mobile390: mobileQuoteState, refresh: "PASS", tenantIsolation: "PASS", confirmRequests: 0, providerCalls: 0, consoleErrors: 0 })}\n`);
      return;
    }

    const expectedBusinessInputSha256 = reuseRunId ? await readRunInputHash(runId) : userInputSha256;
    const persistedJobIdsBeforeConfirm = await readPersistedMediaJobIds(runId);
    consumedPath = await consumeGrant(expectedBusinessInputSha256, quotePayload.imageRequirements?.overallVisualRequirements ?? "");
    await evaluate(cdp, desktop.sessionId, `() => document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary").click()`);
    const confirmResponseDeadline = Date.now() + 30_000;
    while (cdp.confirmResponses.length < 1 && Date.now() < confirmResponseDeadline) await delay(100);
    assert.equal(cdp.confirmRequests.length, 1, "the Web path must create one parent confirmation request");
    assert.equal(cdp.confirmResponses.length, 1, "the Web path must receive one parent confirmation response");
    assert.ok([200, 202, 204].includes(cdp.confirmResponses[0].status), "the parent confirmation must succeed before reading batch state");
    const firstConfirm = cdp.confirmRequests[0];
    assert.equal(new URL(firstConfirm.url).pathname.split("/").at(-3), runId);
    const confirmBody = JSON.parse(firstConfirm.postData);
    assert.equal(confirmBody.imageCount, 3);
    assert.ok(confirmBody.imageRequirements?.selectedTitle, "the selected customer title must be bound to the final image composition");
    const accepted = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/confirm`, tokenA, { method: "POST", body: JSON.stringify(confirmBody), headers: { "X-Idempotency-Key": confirmBody.requestKey } });
    assert.equal(accepted.response.status, 200, "the accepted batch identity must be recoverable through the same idempotency key");
    assert.equal(accepted.body.idempotent, true, "the accepted batch identity check must not create another batch");
    assert.equal(accepted.body.jobs.length, 3, "the accepted batch must contain exactly three persisted jobs");
    const acceptedJobIds = new Set(accepted.body.jobs.map((job) => job.id));
    assert.equal(acceptedJobIds.size, 3, "the accepted batch job identities must be unique");
    await waitFor(cdp, desktop.sessionId, `document.querySelectorAll("[data-testid='xhs-image-card']").length === 3`, 30_000);
    const terminal = operatorGate ? await waitForOperatorGatedBatch(runId, tokenA, acceptedJobIds) : await waitForTerminalBatch(runId, tokenA, 10 * 60_000, acceptedJobIds);
    assert.equal(terminal.jobs.length, 3);
    assert.equal(new Set(terminal.jobs.map((job) => job.id)).size, 3);
    assert.ok(terminal.jobs.every((job) => !persistedJobIdsBeforeConfirm.has(job.id)), "the accepted batch must contain three newly persisted jobs, never a historical terminal batch");
    const providerAudit = await auditProviderTasks(runId, terminal.jobs.map((job) => job.id));
    const providerTasksCreated = providerAudit.count;
    const providerTaskIds = providerAudit.providerTaskIds;
    assert.ok(providerTasksCreated >= 1 && providerTasksCreated <= 3, "the terminal must create between one and three sequential Provider tasks");
    assert.equal(new Set(providerTaskIds).size, providerTasksCreated, "Provider task ids must be unique");
    const qualityPassed = terminal.jobs.filter((job) => job.qualityStatus === "passed").length;
    const qualityRejected = terminal.jobs.filter((job) => job.qualityStatus === "rejected").length;
    const technicalSucceeded = terminal.jobs.filter((job) => job.technicalStatus === "succeeded").length;
    const customerUsable = terminal.jobs.filter((job) => job.customerUsable).length;
    if (terminal.batchStatus === "succeeded") {
      assert.equal(providerTasksCreated, 3);
      assert.equal(technicalSucceeded, 3);
      assert.equal(qualityPassed, 3);
      assert.equal(qualityRejected, 0);
      assert.equal(customerUsable, 3);
      assert.ok(terminal.jobs.every((job) => job.compositionStatus === "completed"), "all customer assets must complete deterministic composition");
      assert.ok(terminal.jobs.every((job) => job.billingStatus === "charged"));
    } else {
      assert.equal(terminal.batchStatus, "quality_failed");
      assert.ok(qualityRejected >= 1 || terminal.jobs.some((job) => job.technicalStatus === "failed"));
      assert.equal(customerUsable, 0, "an incomplete three-image batch must expose no customer asset");
      assert.ok(terminal.jobs.every((job) => job.billingStatus === "refunded"));
      const firstRejectedIndex = terminal.jobs.findIndex((job) => job.qualityStatus === "rejected" || job.technicalStatus === "failed");
      if (firstRejectedIndex >= 0) assert.ok(providerAudit.jobs.slice(firstRejectedIndex + 1).every((job) => !job.providerTaskId), "no Provider task may be created after the first technical/quality failure");
    }

    const transactionsBeforeDuplicate = (await apiJson("/credits/transactions?limit=30", tokenA)).body.transactions;
    const duplicate = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/confirm`, tokenA, { method: "POST", body: JSON.stringify(confirmBody), headers: { "X-Idempotency-Key": confirmBody.requestKey } });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.idempotent, true);
    assert.equal(duplicate.body.jobs.length, 3);
    assert.deepEqual(duplicate.body.jobs.map((job) => job.providerTaskId), terminal.jobs.map((job) => job.providerTaskId));
    const transactionsAfterDuplicate = (await apiJson("/credits/transactions?limit=30", tokenA)).body.transactions;
    assert.equal(transactionsAfterDuplicate.length, transactionsBeforeDuplicate.length, "duplicate confirmation must not create a new ledger entry");

    const assets = [];
    for (const job of terminal.jobs) {
      const url = `/beauty-industry/media/assets/${encodeURIComponent(job.id)}`;
      const asset = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${tokenA}` } });
      const isolated = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${tokenB}` } });
      assert.equal(isolated.status, 404, "tenant B must not access tenant A image asset");
      if (terminal.batchStatus === "succeeded") {
        assert.equal(asset.status, 200);
        const bytes = Buffer.from(await asset.arrayBuffer());
        assets.push({ jobId: job.id, providerTaskId: job.providerTaskId, model: job.model, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      } else {
        assert.equal(asset.status, 404, "quality-failed batches must expose no owner download");
      }
    }

    await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
    await waitFor(cdp, desktop.sessionId, `document.querySelectorAll("[data-testid='xhs-image-card']").length === 3`, 30_000);
    await waitForPersistedCustomerAssets(cdp, desktop.sessionId, terminal.batchStatus === "succeeded" ? 3 : 0);
    const restored = await evaluate(cdp, desktop.sessionId, `() => ({ images: [...document.querySelectorAll(".beautyXhsImageCards img")].map((img) => ({ width: img.naturalWidth, height: img.naturalHeight })), downloads: [...document.querySelectorAll(".beautyXhsImageCards button")].filter((button) => button.textContent?.includes("下载")).length, text: document.querySelector(".beautyXhsImageDelivery")?.innerText ?? "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.equal(restored.overflow, 0);
    assert.equal(restored.images.length, terminal.batchStatus === "succeeded" ? 3 : 0);
    assert.equal(restored.downloads, terminal.batchStatus === "succeeded" ? 3 : 0);
    if (terminal.batchStatus === "succeeded") assert.ok(restored.images.every((image) => image.width === 768 && image.height === 1024));
    else assert.match(restored.text, /图片未达到交付标准，不建议使用/);

    const mobile = await createPage(cdp, tokenA, 390, 844);
    await waitFor(cdp, mobile.sessionId, `document.querySelectorAll("[data-testid='xhs-image-card']").length === 3`, 30_000);
    await waitForPersistedCustomerAssets(cdp, mobile.sessionId, terminal.batchStatus === "succeeded" ? 3 : 0);
    const mobileState = await evaluate(cdp, mobile.sessionId, `() => ({ images: document.querySelectorAll(".beautyXhsImageCards img").length, downloads: [...document.querySelectorAll(".beautyXhsImageCards button")].filter((button) => button.textContent?.includes("下载")).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.equal(mobileState.images, terminal.batchStatus === "succeeded" ? 3 : 0);
    assert.equal(mobileState.downloads, terminal.batchStatus === "succeeded" ? 3 : 0);
    assert.equal(mobileState.overflow, 0);

    const creditsAfter = await apiJson("/credits/transactions?limit=30", tokenA);
    assert.equal(creditsAfter.response.status, 200);
    assert.equal(creditsBeforeMedia.body.creditBalance - creditsAfter.body.creditBalance, terminal.batchStatus === "succeeded" ? 300 : 0);
    let newRunAudit = null;
    let regenerationQuote = null;
    let textUsage = [];
    if (terminal.batchStatus === "succeeded" && reuseRunId && expectOneRealTextRun) {
      const profileHashBefore = await readProfileHash(reuseTenantId);
      const logOffset = apiLogPath ? Buffer.byteLength(await readFile(apiLogPath, "utf8")) : 0;
      await evaluate(cdp, desktop.sessionId, `() => {
        const set = (labelText, value) => {
          const label = [...document.querySelectorAll("label")].find((item) => item.textContent?.includes(labelText));
          const field = label?.querySelector("input,textarea");
          if (!field) throw new Error("missing field:" + labelText);
          const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        };
        set("本次主题与目的", "为皮肤管理产品生成一套面向附近女性顾客的小红书图文");
        set("目标顾客", "附近女性顾客");
        set("本次项目", "皮肤管理产品");
        set("内容角度", "日常护理困扰与到店咨询");
        set("表达语气", "自然、温和、专业");
        set("三图总体视觉要求", "纯摄影静物，干净自然，无人物正脸");
        set("本次明确事实", "仅确认皮肤管理产品和附近女性顾客");
        set("明确禁用内容", "价格、疗效、顾客案例、品牌文字、人物正脸");
        document.querySelector(".beautyXhsGenerateActions button[type=submit]").click();
      }`);
      await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsTaskSnapshot")?.innerText.includes("皮肤管理产品") && document.querySelector(".beautyXhsImageDelivery button.beautyIndustryPrimary")?.disabled === false`, 190_000);
      assert.equal(cdp.runRequests.length, 1, "the BY34 batch allows exactly one real text request");
      const newQuoteRequest = cdp.quoteRequests.at(-1);
      const newRunId = new URL(newQuoteRequest.url).pathname.split("/").at(-3);
      assert.notEqual(newRunId, runId, "the new text task must have an independent AgentRun");
      newRunAudit = await auditRun(newRunId);
      assert.equal(newRunAudit.status, "succeeded");
      assert.equal(newRunAudit.capabilityId, "beauty_xiaohongshu_package");
      assert.match(newRunAudit.skillVersion, /^wechat-xhs-content-line@1\.0\.3\+beauty-industry-xhs@1\.1\.0\+beauty-industry-compliance@1\.0\.0$/);
      assert.ok(newRunAudit.qualityFlags.includes("route_fallback:no"));
      assert.equal(newRunAudit.mediaJobs, 0, "new text task must not create images before confirmation");
      assert.equal(await readProfileHash(reuseTenantId), profileHashBefore, "per-task fields must not modify the long-term operating profile");
      textUsage = await readProviderUsageAfter(logOffset);
      assert.equal(textUsage.length, 1, "exactly one real text Provider terminal is required");
      assert.equal(textUsage[0].selectedModel, "deepseek-v4-pro");
      assert.equal(textUsage[0].finishReason, "stop");
      assert.equal(textUsage[0].reasoningTokens, 0);
      assert.ok(Number(textUsage[0].promptTokens) <= 25_000, "real text prompt exceeded the authorized token ceiling");
      assert.ok(Number(textUsage[0].completionTokens) <= 5_120, "real text completion exceeded the authorized token ceiling");

      await evaluate(cdp, desktop.sessionId, `() => document.querySelectorAll("[data-testid='xhs-task-history'] button")[1].click()`);
      await waitFor(cdp, desktop.sessionId, `document.querySelectorAll(".beautyXhsImageCards img").length === 3`, 30_000);
      await evaluate(cdp, desktop.sessionId, `() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("修改图片要求并重新报价"))?.click()`);
      await evaluate(cdp, desktop.sessionId, `() => {
        const label = [...document.querySelectorAll("label")].find((item) => item.textContent?.includes("三图总体视觉要求"));
        const field = label?.querySelector("textarea");
        if (!field) throw new Error("visual requirements field missing");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "纯摄影静物，暖色自然光，背景更简洁，无人物正脸");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }`);
      await waitFor(cdp, desktop.sessionId, `[...document.querySelectorAll("button")].some((button) => button.textContent?.includes("确认生成新一组三图｜300 积分") && !button.disabled)`, 20_000);
      regenerationQuote = await evaluate(cdp, desktop.sessionId, `() => ({ button: [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("确认生成新一组三图"))?.textContent ?? "", hint: document.querySelector(".beautyXhsMediaActionHint")?.textContent ?? "" })`);
      assert.equal(cdp.confirmRequests.length, 1, "re-quote must not submit a second paid image batch");
      assert.equal((await auditProviderTasks(runId)).count, providerTasksCreated, "re-quote must not create another Provider task");
    }
    assert.deepEqual(cdp.consoleErrors, []);
    assert.deepEqual(cdp.requestFailures, []);
    process.stdout.write(JSON.stringify({
      ok: true,
      runId,
      grantFile: path.basename(consumedPath),
      batchStatus: terminal.batchStatus,
      providerTasksCreated,
      technicalSucceeded,
      qualityPassed,
      qualityRejected,
      customerUsable,
      model: "wan2.7-image",
      conservativeCostYuan: Number((providerTasksCreated * 0.2).toFixed(2)),
      creditsReserved: 300,
      creditsSettled: terminal.batchStatus === "succeeded" ? 300 : 0,
      creditsReleasedOrCompensated: terminal.batchStatus === "succeeded" ? 0 : 300,
      jobs: terminal.jobs.map((job) => ({ jobId: job.id, providerTaskId: job.providerTaskId, technicalStatus: job.technicalStatus, qualityStatus: job.qualityStatus, qualityReasons: job.qualityReasons, customerUsable: job.customerUsable, billingStatus: job.billingStatus })),
      operatorReviews: terminal.operatorReviews ?? [],
      images: assets.map((asset, index) => ({ ...asset, width: restored.images[index]?.width, height: restored.images[index]?.height })),
      desktop: "PASS",
      mobile390: "PASS",
      refresh: "PASS",
      duplicateConfirm: "PASS",
      tenantIsolation: "PASS",
      consoleErrors: 0,
      elapsedMs: Date.now() - startedAt,
      newTextRun: newRunAudit ? { id: newRunAudit.id, status: newRunAudit.status, skillVersion: newRunAudit.skillVersion, creditCost: newRunAudit.creditCost, mediaJobs: newRunAudit.mediaJobs } : null,
      textUsage: textUsage.map((item) => ({ model: item.selectedModel, finishReason: item.finishReason, promptTokens: item.promptTokens, completionTokens: item.completionTokens, reasoningTokens: item.reasoningTokens, totalTokens: item.totalTokens })),
      combinedWorstCostYuan: Number((providerTasksCreated * 0.2 + worstTextCostYuan).toFixed(2)),
      regenerationQuote
    }, null, 2));
  } finally {
    await cdp.send("Browser.close").catch(() => undefined);
    cdp.socket.close();
    if (cdp.child.exitCode === null) {
      const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
      cdp.child.kill();
      await Promise.race([exited, delay(2_000)]);
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
