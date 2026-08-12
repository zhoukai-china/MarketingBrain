const originalFetch = globalThis.fetch;
const calls: string[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  let body: Record<string, unknown>;
  if (url.includes("tenant_access_token")) body = { code: 0, tenant_access_token: "feishu-token" };
  else if (url.includes("/wiki/v2/spaces?") ) body = { code: 0, data: { items: [{ space_id: "space-1" }] } };
  else if (url.includes("/wiki/v2/spaces/space-1/nodes")) body = { code: 0, data: { items: [{ obj_type: "docx", obj_token: "space-doc-token", title: "测试知识库文档" }] } };
  else if (url.includes("raw_content")) body = { code: 0, data: { content: "飞书同步的测试资料" } };
  else if (url.includes("cgi-bin/gettoken")) body = { errcode: 0, access_token: "wecom-token" };
  else if (url.includes("department/list")) body = { errcode: 0, department: [{ id: 1, name: "测试部门" }] };
  else if (url.includes("user/simplelist")) body = { errcode: 0, userlist: [{ userid: "u-1", name: "测试成员" }] };
  else body = { code: 0, data: {} };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

async function main() {
try {
  process.env.DOMESTIC_NETWORK_ONLY = "true";
  process.env.DOMESTIC_OUTBOUND_ALLOWLIST = "open.feishu.cn,qyapi.weixin.qq.com";
  const { pullFeishuKnowledge, pullWecomKnowledge, verifyFeishuKnowledgeAccess, platformSyncErrorMessage } = await import("../apps/api/src/services/platform-knowledge-connectors.js");
  const verifiedSpace = await verifyFeishuKnowledgeAccess({ appId: "cli_test", appSecret: "test-secret" });
  if (!verifiedSpace.capabilities.includes("knowledge_space_read_verified")) throw new Error("feishu connection did not verify knowledge-space read access");
  const verifiedDocument = await verifyFeishuKnowledgeAccess({ appId: "cli_test", appSecret: "test-secret", resourceUrl: "https://example.feishu.cn/docx/doc-token" });
  if (!verifiedDocument.capabilities.includes("document_read_verified")) throw new Error("feishu connection did not verify document read access");
  if (!platformSyncErrorMessage("feishu", "http_400_999_invalid request").includes("新版文档")) throw new Error("feishu HTTP 400 does not provide an actionable error message");
  const oneClickFeishu = await pullFeishuKnowledge({ appId: "cli_test", appSecret: "test-secret" });
  if (oneClickFeishu.documents.length < 1) throw new Error("feishu one-click sync did not import authorised knowledge-space documents");
  const feishu = await pullFeishuKnowledge({ appId: "cli_test", appSecret: "test-secret", resourceUrl: "https://example.feishu.cn/docx/doc-token" });
  if (feishu.documents.length !== 1 || feishu.documents[0]?.content !== "飞书同步的测试资料") throw new Error("feishu document content was not imported");
  if (!calls.some((url) => url.includes("docx/v1/documents/doc-token/raw_content"))) throw new Error("feishu raw-content endpoint was not called");

  const wecom = await pullWecomKnowledge({ corpId: "corp-test", corpSecret: "test-secret" });
  if (wecom.documents.length !== 1 || !wecom.documents[0]?.content.includes("测试成员")) throw new Error("wecom directory was not imported");
  if (!calls.some((url) => url.includes("department/list")) || !calls.some((url) => url.includes("user/simplelist"))) throw new Error("wecom directory endpoints were not called");

  console.log("Platform knowledge connector smoke passed.");
} finally {
  globalThis.fetch = originalFetch;
}
}

void main();
