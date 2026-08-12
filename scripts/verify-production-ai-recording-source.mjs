import { prisma } from "../packages/db/dist/index.js";

const connection = await prisma.knowledgeConnection.findFirst({
  where: { provider: "getnote", status: "active" },
  orderBy: { updatedAt: "desc" },
  select: { id: true, tenantId: true, lastSyncedAt: true }
});

if (!connection) throw new Error("no_active_getnote_connection");
const membership = await prisma.membership.findFirst({
  where: { tenantId: connection.tenantId, isActive: true },
  select: { userId: true }
});
if (!membership) throw new Error("no_active_membership");

const response = await fetch("http://127.0.0.1:3002/knowledge-base/documents?type=transcript&limit=20", {
  headers: {
    "x-sitong-tenant-id": connection.tenantId,
    "x-sitong-user-id": membership.userId
  }
});
if (!response.ok) throw new Error(`knowledge_endpoint_${response.status}`);
const payload = await response.json();
const documents = payload.documents ?? [];
const usable = documents.filter((item) => Number(item.characterCount ?? 0) >= 40);

const latestTopicRuns = await prisma.agentRun.findMany({
  where: { tenantId: connection.tenantId, capabilityId: "topic_inspiration" },
  orderBy: { createdAt: "desc" },
  take: 3,
  select: { id: true, createdAt: true, input: true, output: true, status: true }
});

console.log(JSON.stringify({
  tenantId: connection.tenantId,
  lastSyncedAt: connection.lastSyncedAt,
  endpointDocuments: documents.length,
  usableDocuments: usable.length,
  sample: documents.slice(0, 3).map((item) => ({
    id: item.id,
    title: item.title,
    documentType: item.documentType,
    characterCount: item.characterCount,
    previewLength: item.preview?.length ?? 0
  })),
  latestTopicRuns: latestTopicRuns.map((run) => ({
    id: run.id,
    createdAt: run.createdAt,
    status: run.status,
    declaredRecordingCount: run.input.match(/已选择\s+(\d+)\s+条得到大脑录音转写/)?.[1] ?? "0",
    outputSaysMissingRecording: /AI录音卡[\s\S]{0,100}(?:未发现|待补)/.test(run.output ?? "")
  }))
}, null, 2));

await prisma.$disconnect();
