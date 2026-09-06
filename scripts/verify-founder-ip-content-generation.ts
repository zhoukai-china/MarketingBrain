import assert from "node:assert/strict";

const baseUrl = process.env.SITONG_API_BASE_URL || "http://127.0.0.1:3011";
const now = Date.now();

type TestAuth = { tenantId: string; headers: Record<string, string> };

async function createTestAuth(label: string): Promise<TestAuth> {
  const response = await fetch(`${baseUrl}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantRole: "personal_ip", tenantName: `FIP内容验收-${label}`, planCode: "ip_standard", industry: "创始人IP获客" })
  });
  const payload = await response.json() as { token?: string; tenantId?: string };
  assert.equal(response.status, 200, "database runtime verification must create an isolated test workspace");
  assert.ok(payload.token && payload.tenantId, "dev login must return a scoped test token");
  return { tenantId: payload.tenantId, headers: { "Content-Type": "application/json", authorization: `Bearer ${payload.token}` } };
}

async function request<T>(headers: Record<string, string>, path: string, body?: unknown): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, payload: (text ? JSON.parse(text) : {}) as T };
}

async function main(): Promise<void> {
  const auth = await createTestAuth(`${now}`);
  const subject = await request<{ subject?: { id?: string } }>(auth.headers, "/knowledge-base/subjects", { subjectType: "ip", name: "内容验收主体", industry: "餐饮招商" });
  assert.equal(subject.status, 200, "must create an isolated subject");
  assert(subject.payload.subject?.id, "subject id required");
  const subjectId = subject.payload.subject.id;
  const brief = await fetch(`${baseUrl}/agents/acquisition/founder-ip-goal-briefs`, { method: "PUT", headers: auth.headers, body: JSON.stringify({ subjectId, target: "franchise", identity: "早餐加盟创始人", targetCustomer: "有餐饮经验的创业者", acquisitionGoal: "获取加盟咨询", offer: "加盟条件需沟通确认", accountStage: "起号测试期", industry: "餐饮招商", benchmarkAccounts: [] }) });
  assert.equal(brief.status, 200, "must save the FIP brief before generation");
  const created = await request<{ draft?: { id?: string } }>(auth.headers, "/agents/acquisition/founder-ip-content-drafts", { subjectId, target: "franchise", topic: "加盟前先核对哪三个经营条件", audience: "有餐饮经验的创业者", sourceEvidence: "创始人已确认：加盟条件需沟通确认", factBoundary: "价格、收益、门店数量和案例待确认，不得写成事实", goalRelation: "帮助有餐饮经验的创业者先判断是否值得发起加盟咨询" });
  assert.equal(created.status, 200, "must create a tenant-scoped FIP content draft");
  assert(created.payload.draft?.id, "draft id required");
  const generated = await request<{ content?: string; draft?: { content?: string }; error?: string; message?: string }>(auth.headers, `/agents/acquisition/founder-ip-content-drafts/${created.payload.draft.id}/generate`, { requestId: `fip-runtime-${now}`, deviceScope: "desktop" });
  if (generated.status === 503) {
    assert.equal(generated.payload.error, "founder_ip_content_provider_unavailable", "unconfigured provider must return an explicit, safe FIP error");
    assert.equal(generated.payload.content, undefined, "blocked generation must not return a generic or cross-target content product");
    const restoredBlocked = await request<{ draft?: { content?: string } }>(auth.headers, `/agents/acquisition/founder-ip-content-drafts/${created.payload.draft.id}`);
    assert.equal(restoredBlocked.status, 200, "same tenant must still restore the blocked draft context");
    assert.ok(!restoredBlocked.payload.draft?.content?.trim(), "blocked generation must not persist a generic fallback as content");
    const foreign = await createTestAuth(`${now}-other`);
    const crossTenantBlocked = await fetch(`${baseUrl}/agents/acquisition/founder-ip-content-drafts/${created.payload.draft.id}`, { headers: foreign.headers });
    assert.equal(crossTenantBlocked.status, 404, "another tenant must not read a blocked FIP draft");
    console.log("founder_ip_content_generation_runtime:BLOCKED_PROVIDER no_content_saved=tenant_isolation");
    return;
  }
  assert.equal(generated.status, 200, `FIP generation should return an editable content product, got ${generated.status}: ${generated.payload.message ?? generated.payload.error ?? "unknown"}`);
  assert.match(generated.payload.content ?? "", /加盟前先核对哪三个经营条件/, "result must preserve the selected topic");
  assert.match(generated.payload.content ?? "", /加盟(?:咨询|条件|评估|申请|考察)/, "result must preserve franchise CTA");
  assert.equal(generated.payload.draft?.content, generated.payload.content, "generated content must be saved for refresh recovery");
  const restored = await request<{ draft?: { content?: string } }>(auth.headers, `/agents/acquisition/founder-ip-content-drafts/${created.payload.draft.id}`);
  assert.equal(restored.status, 200, "same tenant must restore generated content");
  assert.equal(restored.payload.draft?.content, generated.payload.content, "refresh must recover the generated content");
  const foreign = await createTestAuth(`${now}-other`);
  const crossTenant = await fetch(`${baseUrl}/agents/acquisition/founder-ip-content-drafts/${created.payload.draft.id}`, { headers: foreign.headers });
  assert.equal(crossTenant.status, 404, "another tenant must not read this content draft");
  console.log("founder_ip_content_generation_runtime:PASS generate=save=restore=tenant_isolation");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
