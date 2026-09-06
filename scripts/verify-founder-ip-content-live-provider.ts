import assert from "node:assert/strict";
import { liveProviderCases } from "./founder-ip-content-live-provider-eval.ts";

const baseUrl = process.env.SITONG_API_BASE_URL;
const expectedModel = process.env.FIP_EXPECTED_MODEL || "deepseek-v4-pro";
const timeoutMs = readBoundedInteger("FIP_LIVE_TIMEOUT_MS", 120_000, 10_000, 300_000);
const repeats = readBoundedInteger("FIP_LIVE_REPEATS", 3, 1, 3);
const selectedTarget = process.env.FIP_LIVE_TARGET?.trim();

assert.equal(process.env.FIP_LIVE_PROVIDER_CONFIRMED, "1", "set FIP_LIVE_PROVIDER_CONFIRMED=1 only after the gateway single-request fix is handed back");
assert(baseUrl, "SITONG_API_BASE_URL is required for the non-demo live-provider verification");
const parsedBaseUrl = new URL(baseUrl);
assert.equal(parsedBaseUrl.protocol, "http:", "live-provider verification only accepts the local HTTP test API");
assert.ok(["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname), "live-provider verification only accepts a local test API");

type TestAuth = { tenantId: string; headers: Record<string, string> };
type TimedResponse = { status: number; payload: any; latencyMs: number };

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value >= minimum && value <= maximum, `${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

async function timedFetch(path: string, init?: RequestInit): Promise<TimedResponse> {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { status: response.status, payload: text ? JSON.parse(text) : {}, latencyMs: Date.now() - startedAt };
}

async function createTestAuth(label: string): Promise<TestAuth> {
  const response = await timedFetch("/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantRole: "personal_ip", tenantName: `FIP真实模型验收-${label}`, planCode: "ip_standard", industry: "创始人IP获客" })
  });
  assert.equal(response.status, 200, "live-provider verification must create an isolated test workspace");
  assert.ok(response.payload.token && response.payload.tenantId, "dev login must return a scoped test token");
  return { tenantId: response.payload.tenantId, headers: { "Content-Type": "application/json", authorization: `Bearer ${response.payload.token}` } };
}

async function call(auth: TestAuth, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<TimedResponse> {
  return timedFetch(path, { method, headers: auth.headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function assertRuntimeReady(): Promise<{ provider: string; model: string }> {
  const ready = await timedFetch("/ready");
  assert.equal(ready.status, 200, "live-provider API must pass /ready before any model request");
  assert.equal(ready.payload.dataMode, "database", "live-provider Eval must use database mode");
  const llm = ready.payload.checks?.llm;
  assert.equal(llm?.configured, true, "selected provider must be configured");
  assert.equal(llm?.provider, "deepseek", "FIP content generation must use the controlled DeepSeek provider");
  assert.equal(llm?.model, expectedModel, `FIP content generation must use ${expectedModel}`);
  return { provider: llm.provider, model: llm.model };
}

async function main(): Promise<void> {
  const runtime = await assertRuntimeReady();
  const cases = selectedTarget ? liveProviderCases.filter((item) => item.target === selectedTarget) : liveProviderCases;
  assert.ok(cases.length > 0, `FIP_LIVE_TARGET must be one of: ${liveProviderCases.map((item) => item.target).join(", ")}`);
  const targetOutputs = new Map<string, string[]>();

  for (const item of cases) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const auth = await createTestAuth(`${item.target}-${Date.now()}-${repeat}`);
      const subject = await call(auth, "/knowledge-base/subjects", { subjectType: "ip", name: `FIP ${item.target} 验收主体`, industry: "创始人IP获客" });
      assert.equal(subject.status, 200, `${item.target}/${repeat} subject must be created`);
      const subjectId = subject.payload.subject.id as string;
      const brief = await call(auth, "/agents/acquisition/founder-ip-goal-briefs", { subjectId, target: item.target, identity: item.identity, targetCustomer: item.customer, acquisitionGoal: item.goal, offer: "已确认条件需在咨询中说明", accountStage: "稳定更新期", industry: "创始人IP获客", benchmarkAccounts: [] }, "PUT");
      assert.equal(brief.status, 200, `${item.target}/${repeat} brief must save`);
      const draft = await call(auth, "/agents/acquisition/founder-ip-content-drafts", { subjectId, target: item.target, topic: item.topic, audience: item.customer, sourceEvidence: item.evidence, factBoundary: "案例、数字、价格和政策待核验，不得写成事实", goalRelation: item.relation });
      assert.equal(draft.status, 200, `${item.target}/${repeat} draft must create`);
      const requestId = `fip-live-${item.target}-${repeat}-${Date.now()}`;
      let generated: TimedResponse;
      try {
        generated = await call(auth, `/agents/acquisition/founder-ip-content-drafts/${draft.payload.draft.id}/generate`, { requestId, deviceScope: repeat % 2 === 0 ? "mobile" : "desktop" });
      } catch (error) {
        console.error(JSON.stringify({ stage: "content_generation", target: item.target, repeat, provider: runtime.provider, model: runtime.model, success: false, fallback: false, error: error instanceof Error ? error.name : "unknown" }));
        throw error;
      }
      console.log(JSON.stringify({ stage: "content_generation", target: item.target, repeat, provider: runtime.provider, model: runtime.model, latencyMs: generated.latencyMs, success: generated.status === 200, fallback: false }));
      assert.equal(generated.status, 200, `${item.target}/${repeat} must be a real accepted content product, not a fallback: ${generated.payload.message ?? generated.payload.error ?? "unknown"}`);
      assert.equal(generated.payload.dataMode, "database", `${item.target}/${repeat} must remain on the database path`);
      assert.equal(generated.payload.providerName, runtime.provider, `${item.target}/${repeat} must report the selected provider`);
      assert.equal(generated.payload.selectedProvider, runtime.provider, `${item.target}/${repeat} must audit the selected provider`);
      assert.equal(generated.payload.selectedModel, runtime.model, `${item.target}/${repeat} must audit the exact selected model`);
      assert.equal(generated.payload.selectedReasoningMode, "reasoning_high", `${item.target}/${repeat} must keep the approved reasoning mode`);
      assert.ok(generated.payload.skillId && generated.payload.skillVersion, `${item.target}/${repeat} must report the selected Skill contract`);
      const content = generated.payload.content as string;
      assert.match(content, new RegExp(item.topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${item.target}/${repeat} must preserve topic`);
      assert.ok(content.replace(/\s+/g, "").includes(item.evidence.replace(/\s+/g, "")), `${item.target}/${repeat} must preserve source evidence`);
      assert.ok(content.replace(/\s+/g, "").includes(item.relation.replace(/\s+/g, "")), `${item.target}/${repeat} must preserve the goal relation`);
      assert.match(content, item.required, `${item.target}/${repeat} must use target CTA`);
      assert.doesNotMatch(content, item.forbidden, `${item.target}/${repeat} must not cross goals`);
      assert.match(content, /待(?:补|核验|确认)|未(?:提供|核验)/, `${item.target}/${repeat} must keep fact boundary`);
      const outputs = targetOutputs.get(item.target) ?? [];
      outputs.push(content.replace(/\s+/g, ""));
      targetOutputs.set(item.target, outputs);
      const restored = await call(auth, `/agents/acquisition/founder-ip-content-drafts/${draft.payload.draft.id}`);
      assert.equal(restored.payload.draft.content, content, `${item.target}/${repeat} must restore saved content`);
      const foreign = await createTestAuth(`${item.target}-other-${Date.now()}-${repeat}`);
      const foreignResult = await call(foreign, `/agents/acquisition/founder-ip-content-drafts/${draft.payload.draft.id}`);
      assert.equal(foreignResult.status, 404, `${item.target}/${repeat} must remain tenant-isolated`);
    }
    const outputs = targetOutputs.get(item.target) ?? [];
    if (outputs.length >= 3) assert.ok(new Set(outputs).size >= 2, `${item.target} must not return one identical fixed template in all three real runs`);
  }
  console.log(`founder_ip_content_live_provider_verification:PASS targets=${cases.length} repeats=${repeats} provider=${runtime.provider} model=${runtime.model}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
