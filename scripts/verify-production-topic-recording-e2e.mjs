import { prisma } from "../packages/db/dist/index.js";

const baseUrl = process.env.SITONG_INTERNAL_URL ?? "http://127.0.0.1:3002";
const connection = await prisma.knowledgeConnection.findFirst({
  where: { provider: "getnote", status: "active" },
  orderBy: { updatedAt: "desc" },
  select: { tenantId: true }
});
if (!connection) throw new Error("no_active_getnote_connection");

const membership = await prisma.membership.findFirst({
  where: { tenantId: connection.tenantId, isActive: true },
  select: { userId: true }
});
if (!membership) throw new Error("no_active_membership");

const headers = {
  "content-type": "application/json",
  "x-sitong-tenant-id": connection.tenantId,
  "x-sitong-user-id": membership.userId
};
const documentsResponse = await fetch(`${baseUrl}/knowledge-base/documents?type=transcript&limit=1`, { headers });
if (!documentsResponse.ok) throw new Error(`documents_${documentsResponse.status}`);
const documentsPayload = await documentsResponse.json();
const document = documentsPayload.documents?.find((item) => Number(item.characterCount ?? 0) >= 40);
if (!document) throw new Error("no_usable_recording_document");

const runResponse = await fetch(`${baseUrl}/agents/acquisition/runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    requestId: `recording-e2e-${Date.now()}`,
    input: "我是做IP和AI企业服务的，目标客户是需要IP打造或AI落地的企业老板，目标是引导有效客户私信咨询。请从四大来源生成10条选题，录音卡中出现的客户问题优先，但不要虚构原话或数据。",
    capabilityId: "topic_inspiration",
    capabilitySelectionMode: "explicit",
    deviceScope: "desktop",
    knowledgeDocumentIds: [document.id]
  })
});
const runPayload = await runResponse.json();
if (!runResponse.ok) throw new Error(`run_${runResponse.status}_${runPayload.error ?? "unknown"}_${runPayload.message ?? ""}`);
const answer = String(runPayload.answerText ?? runPayload.answer ?? runPayload.output ?? runPayload.result?.answer ?? runPayload.data?.answer ?? "");
const recordingRow = answer.match(/\|\s*AI录音卡\s*\|([^\n]*)/u)?.[0] ?? "";
if (!/已读取/.test(recordingRow) || /\|\s*0\s*\|?\s*$/.test(recordingRow)) {
  throw new Error(`recording_not_used:${recordingRow || "missing_row"};keys=${Object.keys(runPayload).join(",")};answerLength=${answer.length}`);
}
if (!Array.isArray(runPayload.knowledgeSources) || !runPayload.knowledgeSources.some((item) => item.id === document.id)) {
  throw new Error("recording_not_reported_in_knowledge_sources");
}

console.log(JSON.stringify({
  ok: true,
  runId: runPayload.runId ?? runPayload.id ?? null,
  knowledgeSourceCount: runPayload.knowledgeSources.length,
  recordingSourceStatus: "已读取且贡献非零"
}, null, 2));
await prisma.$disconnect();
