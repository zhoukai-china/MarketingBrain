import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.WORKBUDDY_MCP_ENABLED = "true";

async function main(): Promise<void> {
  const [{ prisma }, { hashWorkbuddyToken, resolveWorkbuddyConnection }] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/services/workbuddy-connections.js")
  ]);
  const membership = await prisma.membership.findFirst({
    where: {
      isActive: true,
      role: { in: ["owner", "admin"] },
      tenant: { agentEntitlements: { some: { status: "active" } } }
    },
    include: {
      tenant: {
        include: {
          agentEntitlements: {
            where: { status: "active" },
            take: 1,
            include: { agent: true }
          }
        }
      }
    }
  });
  assert(membership, "No active owner/admin membership with an Agent entitlement was found");
  const entitlement = membership.tenant.agentEntitlements[0];
  assert(entitlement?.agent, "No active Agent entitlement was found");

  const token = `sitong_wb_smoke_${randomBytes(24).toString("base64url")}`;
  const created = await prisma.workbuddyMcpConnection.create({
    data: {
      tenantId: membership.tenantId,
      userId: membership.userId,
      agentId: entitlement.agentId,
      label: "deployment-smoke",
      tokenHash: hashWorkbuddyToken(token),
      tokenPrefix: token.slice(0, 18)
    }
  });
  try {
    const resolved = await resolveWorkbuddyConnection(`Bearer ${token}`);
    assert.equal(resolved?.tenantId, membership.tenantId);
    assert.equal(resolved?.userId, membership.userId);
    assert.equal(resolved?.agentId, entitlement.agentId);
    assert.equal(await resolveWorkbuddyConnection("Bearer invalid-smoke-token"), null);
    if (process.env.WORKBUDDY_SMOKE_MCP_URL) {
      const response = await fetch(process.env.WORKBUDDY_SMOKE_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: "smoke-list", method: "tools/list" })
      });
      const payload = await response.json() as { error?: { message?: string }; result?: { tools?: Array<{ name?: string }> } };
      assert.equal(response.status, 200, `External MCP returned HTTP ${response.status}`);
      assert.equal(payload.error, undefined, payload.error?.message);
      assert(payload.result?.tools?.some((tool) => tool.name === "sitong.ask"), "sitong.ask was not exposed");
      assert(payload.result?.tools?.some((tool) => tool.name === "sitong.skills"), "sitong.skills was not exposed");

      const askResponse = await fetch(process.env.WORKBUDDY_SMOKE_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "smoke-clarification",
          method: "tools/call",
          params: { name: "sitong.ask", arguments: { input: "思潼 AI 都有哪些能力？" } }
        })
      });
      const askPayload = await askResponse.json() as {
        error?: { message?: string };
        result?: { content?: Array<{ type?: string; text?: string }>; structuredContent?: { status?: string } };
      };
      assert.equal(askResponse.status, 200, `sitong.ask clarification returned HTTP ${askResponse.status}`);
      assert.equal(askPayload.error, undefined, askPayload.error?.message);
      assert.equal(askPayload.result?.structuredContent?.status, "clarification_required");
      assert(askPayload.result?.content?.[0]?.text, "sitong.ask clarification did not return user-facing text");
    }
  } finally {
    await prisma.workbuddyMcpConnection.delete({ where: { id: created.id } });
    await prisma.$disconnect();
  }
  console.log("WorkBuddy self-service smoke passed: hashed database token resolves to the scoped tenant, user and Agent.");
}

void main();
