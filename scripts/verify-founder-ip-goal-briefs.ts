import assert from "node:assert/strict";

const baseUrl = process.env.SITONG_API_BASE_URL || "http://127.0.0.1:3011";

async function request<T>(path: string, options: RequestInit = {}): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
  });
  const text = await response.text();
  let payload: T;
  try { payload = (text ? JSON.parse(text) : {}) as T; } catch { payload = { message: text } as T; }
  return { status: response.status, payload };
}

function demoTenant(tenantId: string): Record<string, string> {
  return { "x-sitong-tenant-id": tenantId, "x-sitong-user-id": `${tenantId}-user`, "x-sitong-plan": "ip_standard" };
}

async function createSubject(headers: Record<string, string>, name: string): Promise<string> {
  const { status, payload } = await request<{ subject?: { id?: string } }>("/knowledge-base/subjects", {
    method: "POST", headers, body: JSON.stringify({ subjectType: "ip", name, industry: "教培" })
  });
  assert.equal(status, 200);
  assert(payload.subject?.id, "subject creation must return its id");
  return payload.subject.id;
}

async function main(): Promise<void> {
  const tenantA = demoTenant(`fip-brief-a-${Date.now()}`);
  const tenantB = demoTenant(`fip-brief-b-${Date.now()}`);
  const subjectId = await createSubject(tenantA, `创始人主体 ${Date.now()}`);
  const baseBrief = {
    subjectId, target: "franchise" as const, identity: "连锁餐饮创始人", targetCustomer: "有开店经验的创业者",
    acquisitionGoal: "获取加盟咨询", offer: "加盟模型", accountStage: "起号测试期", industry: "餐饮连锁", benchmarkAccounts: ["公开对标账号 A"]
  };

  let response = await request<{ brief?: { identity?: string } }>("/agents/acquisition/founder-ip-goal-briefs", { method: "PUT", headers: tenantA, body: JSON.stringify(baseBrief) });
  assert.equal(response.status, 200, "owner must save current subject brief");
  assert.equal(response.payload.brief?.identity, baseBrief.identity);

  response = await request<{ brief?: { acquisitionGoal?: string } }>(`/agents/acquisition/founder-ip-goal-briefs?subjectId=${subjectId}&target=franchise`, { headers: tenantA });
  assert.equal(response.status, 200);
  assert.equal(response.payload.brief?.acquisitionGoal, "获取加盟咨询", "refresh must restore the saved brief");

  response = await request<{ brief?: { acquisitionGoal?: string } }>("/agents/acquisition/founder-ip-goal-briefs", { method: "PUT", headers: tenantA, body: JSON.stringify({ ...baseBrief, acquisitionGoal: "预约品牌考察" }) });
  assert.equal(response.status, 200);
  response = await request<{ brief?: { acquisitionGoal?: string } }>(`/agents/acquisition/founder-ip-goal-briefs?subjectId=${subjectId}&target=franchise`, { headers: tenantA });
  assert.equal(response.payload.brief?.acquisitionGoal, "预约品牌考察", "same target must update rather than create an ambiguous duplicate");

  response = await request<{ brief?: unknown }>(`/agents/acquisition/founder-ip-goal-briefs?subjectId=${subjectId}&target=student`, { headers: tenantA });
  assert.equal(response.status, 200);
  assert.equal(response.payload.brief, null, "another goal must not inherit the franchise brief");

  const crossTenant = await request<{ error?: string }>(`/agents/acquisition/founder-ip-goal-briefs?subjectId=${subjectId}&target=franchise`, { headers: tenantB });
  assert.equal(crossTenant.status, 404, "another tenant must not read this subject or its brief");
  assert.equal(crossTenant.payload.error, "knowledge_subject_not_found");

  console.log("founder_ip_goal_briefs_runtime:PASS save=update=restore target_isolation=tenant_isolation");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
