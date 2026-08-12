import assert from "node:assert/strict";

async function main(): Promise<void> {
  process.env.SKILL_MCP_URL = "http://127.0.0.1:39999/mcp";
  process.env.SKILL_MCP_ENABLED = "true";
  process.env.SKILL_MCP_REQUIRED = "true";
  process.env.SKILL_MCP_TIMEOUT_MS = "1000";

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary_mcp_failure");
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: "load-skill-general_qa",
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            skillId: "general_qa",
            source: "resilience-smoke",
            prompt: "恢复后的原始Skill方法论"
          })
        }]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { loadSkillPrompt } = await import("../packages/skills/src/index.js");
    await assert.rejects(() => loadSkillPrompt("general_qa"), /temporary_mcp_failure/);
    const recovered = await loadSkillPrompt("general_qa");
    assert.equal(recovered, "恢复后的原始Skill方法论");
    assert.equal(calls, 2, "失败的MCP Promise不能永久留在缓存中");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("Skill MCP resilience smoke passed: transient failures are evicted and the next load recovers.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
