import assert from "node:assert/strict";
import { prisma } from "../packages/db/src/index.js";

const apiBase = process.env.SITONG_API_BASE_URL ?? "http://127.0.0.1:3014";
const parsedBase = new URL(apiBase);
assert.equal(parsedBase.protocol, "http:", "FIP evidence API acceptance must use local HTTP");
assert.ok(["127.0.0.1", "localhost"].includes(parsedBase.hostname), "FIP evidence API acceptance must stay on loopback");

async function request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  const text = await response.text();
  let payload: T;
  try { payload = (text ? JSON.parse(text) : {}) as T; } catch { payload = { message: text } as T; }
  return { status: response.status, payload };
}

async function login(tenantName: string): Promise<{ token: string; tenantId: string; userId: string }> {
  const response = await request<{ token?: string; tenantId?: string; userId?: string }>("/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ tenantRole: "personal_ip", tenantName, planCode: "ip_standard", industry: "美业问题肌" })
  });
  assert.equal(response.status, 200, "isolated dev login must succeed");
  assert.ok(response.payload.token && response.payload.tenantId && response.payload.userId, "isolated dev login must return scoped identity");
  return response.payload as { token: string; tenantId: string; userId: string };
}

async function main(): Promise<void> {
  const ready = await request<{ ok?: boolean; dataMode?: string }>("/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.payload.ok, true);
  assert.equal(ready.payload.dataMode, "database", "evidence API acceptance must use isolated database mode");

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tenantA = await login(`FIP证据门禁验收A-${suffix}`);
  const headersA = { authorization: `Bearer ${tenantA.token}` };
  const subjectResponse = await request<{ subject?: { id?: string } }>("/knowledge-base/subjects", {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({ subjectType: "ip", name: `美业问题肌加盟主体-${suffix}`, industry: "美业问题肌" })
  });
  assert.equal(subjectResponse.status, 200);
  const subjectId = subjectResponse.payload.subject?.id;
  assert.ok(subjectId, "subject creation must return an id");

  const brief = {
    subjectId,
    target: "franchise",
    identity: "美业问题肌品牌创始人",
    targetCustomer: "10万投资预算的美业从业者",
    acquisitionGoal: "获取加盟咨询",
    offer: "问题肌加盟条件需在咨询中确认",
    accountStage: "稳定更新期",
    industry: "美业问题肌",
    benchmarkAccounts: []
  } as const;
  const saveBrief = await request<{ brief?: { subjectId?: string } }>("/agents/acquisition/founder-ip-goal-briefs", {
    method: "PUT",
    headers: headersA,
    body: JSON.stringify(brief)
  });
  assert.equal(saveBrief.status, 200);
  assert.equal(saveBrief.payload.brief?.subjectId, subjectId);

  const catalogBefore = await request<{ creditBalance?: number }>("/agents/me", { headers: headersA });
  const transactionCountBefore = await prisma.creditTransaction.count({ where: { tenantId: tenantA.tenantId } });
  const requestIds = {
    noEvidence: `fip-no-evidence-${suffix}`,
    stale: `fip-stale-${suffix}`,
    foreign: `fip-foreign-${suffix}`
  };
  const runBody = {
    requestId: requestIds.noEvidence,
    input: "【选题系统自动运行】【选题系统四源运行】围绕已保存的美业问题肌加盟目标生成选题。",
    routingInput: "从四大来源生成创始人IP选题",
    capabilityId: "topic_inspiration",
    capabilitySelectionMode: "explicit",
    topicSystemRun: true,
    topicSourceSelection: { industry: false, benchmark: false, transcript: false, videoReview: false },
    founderIpTopicContext: brief,
    knowledgeSubjectId: subjectId,
    deviceScope: "desktop"
  };

  const noEvidence = await request<{ error?: string; rejectedSourceCount?: number }>("/agents/acquisition/runs", {
    method: "POST", headers: headersA, body: JSON.stringify(runBody)
  });
  assert.equal(noEvidence.status, 422, "no qualified evidence must fail before Provider execution");
  assert.equal(noEvidence.payload.error, "founder_ip_topic_evidence_required");

  const duplicate = await request<{ error?: string }>("/agents/acquisition/runs", {
    method: "POST", headers: headersA, body: JSON.stringify(runBody)
  });
  assert.equal(duplicate.status, 422, "repeated blocked request must remain fail-closed without execution");
  assert.equal(duplicate.payload.error, "founder_ip_topic_evidence_required");

  const stale = await request<{ error?: string; staleFields?: string[] }>("/agents/acquisition/runs", {
    method: "POST",
    headers: headersA,
    body: JSON.stringify({
      ...runBody,
      requestId: requestIds.stale,
      topicSourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false },
      founderIpTopicContext: { ...brief, identity: "企业AI咨询创始人", industry: "企业AI咨询" }
    })
  });
  assert.equal(stale.status, 409, "stale project/industry context must be rejected before generation");
  assert.equal(stale.payload.error, "founder_ip_topic_context_stale");
  assert.ok(stale.payload.staleFields?.includes("identity") && stale.payload.staleFields?.includes("industry"));

  const tenantB = await login(`FIP证据门禁验收B-${suffix}`);
  const foreign = await request<{ error?: string }>("/agents/acquisition/runs", {
    method: "POST",
    headers: { authorization: `Bearer ${tenantB.token}` },
    body: JSON.stringify({
      ...runBody,
      requestId: requestIds.foreign,
      topicSourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false }
    })
  });
  assert.ok([400, 404].includes(foreign.status), `foreign tenant subject must fail before generation, got ${foreign.status}`);

  const catalogAfter = await request<{ creditBalance?: number }>("/agents/me", { headers: headersA });
  assert.equal(catalogAfter.payload.creditBalance, catalogBefore.payload.creditBalance, "blocked evidence requests must not consume credits");
  const transactionCountAfter = await prisma.creditTransaction.count({ where: { tenantId: tenantA.tenantId } });
  assert.equal(transactionCountAfter, transactionCountBefore, "blocked evidence requests must not create credit ledger entries");
  const persistedRuns = await prisma.agentRun.count({ where: { requestId: { in: Object.values(requestIds) } } });
  assert.equal(persistedRuns, 0, "blocked or cross-tenant topic requests must not persist AgentRun records");

  console.log("founder_ip_topic_evidence_api:PASS no_evidence=422 duplicate=422 stale_context=409 tenant_isolation=PASS agent_runs=0 credit_transactions=0 provider_calls=0");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
