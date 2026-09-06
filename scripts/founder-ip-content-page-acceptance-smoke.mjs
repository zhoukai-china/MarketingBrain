import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../apps/web/src/components/acquisition/ContentSystemWorkbench.tsx", import.meta.url), "utf8");
const topicWorkbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const browserE2e = readFileSync(new URL("./verify-founder-ip-content-browser-e2e.ps1", import.meta.url), "utf8");
const playwrightE2e = readFileSync(new URL("./verify-founder-ip-content-browser-playwright-e2e.mjs", import.meta.url), "utf8");
assert.match(page, /founder-ip-content-drafts\/\$\{encodeURIComponent\(draftId\)\}\/generate/, "FIP must call its isolated content generation endpoint");
assert.match(page, /onOpenTrafficPreview=\{\(\) => \{ setSelected\("paid_traffic"\)/, "a valid FIP draft must have a traffic-preview navigation path");
assert.match(workbench, /内容生成未完成/, "failure state must be visible to users");
assert.match(workbench, /保存待补草稿/, "failure state must preserve an editable safe draft");
assert.match(workbench, /进入投流系统查看预览/, "only a valid content draft may expose traffic preview");
assert.match(workbench, /点击生成或重新生成会调用 AI 模型/, "FIP content generation must warn users before a model call");
assert.match(workbench, /!fipGenerationError/, "failed content must not open traffic preview");
assert.match(workbench, /founder-ip-content-drafts\/\$\{encodeURIComponent\(fipDraftId\)\}/, "refresh must restore the tenant-scoped FIP draft");
assert.match(workbench, /\[agentSlug, fipDraftId, headers\.Authorization\]/, "draft restore must not repeat merely because the parent created a new headers object");
assert.match(topicWorkbench, /\[activeTarget, agentSlug, headers\.Authorization, isFounderMode, subjectId\]/, "goal-brief restore must not repeat merely because the parent created a new headers object");
assert.match(workbench, /fipMode \? <article[\s\S]*正在恢复当前内容草稿/, "a pending FIP draft must not fall through to the legacy generic content modules");
assert.match(workbench, /!fipMode && <article className=\{`contentSystemCard videoOptimizeCard/, "FIP restore and error paths must hide the legacy video optimization module");
assert.match(workbench, /\(!fipMode \|\| Boolean\(fipDraft\)\) && <section className="systemDialoguePanel"/, "FIP restore failures must not expose a misleading content-edit dialogue");
for (const testId of ["fip-content-editor", "fip-content-save", "fip-content-retry", "fip-content-stop", "fip-content-restore-error", "fip-content-back-to-topics", "fip-content-traffic-preview"]) {
  assert.match(workbench, new RegExp(`data-testid=[{]?\\"${testId}\\"`), `${testId} must remain available to the real browser E2E`);
}
assert.doesNotMatch(browserE2e, /Invoke-FipJson\s+"POST"\s+"[^\"]*\/generate"/, "browser E2E must not send a new model request");
assert.match(browserE2e, /model_requests=0/, "browser E2E must report its zero-model-request boundary");
assert.match(browserE2e, /bsk session stop/, "browser E2E must always close its browser-skill session");
assert.match(browserE2e, /"--width",\s*"390",\s*"--height",\s*"844"/, "browser E2E must exercise the 390px mobile viewport");
assert.match(browserE2e, /__fipE2eErrors/, "browser E2E must collect console and unhandled browser errors");
assert.match(main, /import\.meta\.env\.DEV[\s\S]*\/fip\/e2e\/local/, "the zero-model browser fixture must stay restricted to local development");
assert.match(page, /fipE2eScenario[\s\S]*e2eScenario === "failure"[\s\S]*e2eScenario === "cancel"/, "the local E2E fixture must expose controlled failure and cancellation without a Provider call");
assert.match(playwrightE2e, /executablePath:\s*browserExecutable/, "loopback E2E must use an already installed system browser");
assert.match(playwrightE2e, /modelRequests,\s*0/, "loopback E2E must hard-fail if any model request is sent");
assert.match(playwrightE2e, /width:\s*390,\s*height:\s*844/, "loopback E2E must exercise the 390px mobile viewport");
assert.match(playwrightE2e, /consoleErrors[\s\S]*requestFailures[\s\S]*network/, "loopback E2E must collect browser console and network evidence");
console.log("founder_ip_content_page_acceptance_smoke:PASS");
