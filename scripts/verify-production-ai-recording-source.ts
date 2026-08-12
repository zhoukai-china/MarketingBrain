import { prisma } from "../packages/db/src/index.js";

async function main(): Promise<void> {
const connections = await prisma.knowledgeConnection.findMany({
  where: { provider: "getnote", status: "active" },
  orderBy: { updatedAt: "desc" },
  take: 5,
  select: { id: true, tenantId: true, lastSyncedAt: true }
});

const marker = /录音(?:信息|总结|转写|时间)|录制时间|音频时长|参与人数/;
const empty = /(?:空录音转写内容|录音(?:时长|总时长)[：:\s]*0\s*秒|时长[：:\s]*(?:约\s*)?0\s*秒|无有效.*转写|未识别到.*(?:语音|转写))/;
const results = [];

for (const connection of connections) {
  const documents = await prisma.knowledgeDocument.findMany({
    where: { connectionId: connection.id },
    orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: { documentType: true, title: true, content: true, subjects: { select: { id: true } } }
  });
  const recordings = documents.filter((item) => item.documentType === "transcript" || marker.test(`${item.title}\n${item.content}`));
  const usable = recordings.filter((item) => item.content.trim().length >= 40 && !empty.test(`${item.title}\n${item.content}`));
  results.push({
    tenantId: connection.tenantId,
    lastSyncedAt: connection.lastSyncedAt,
    scanned: documents.length,
    recordings: recordings.length,
    usableRecordings: usable.length,
    assignedToSubject: recordings.filter((item) => item.subjects.length > 0).length
  });
}

let endpointDocuments = 0;
let endpointUsableDocuments = 0;
let endpointSample: Array<Record<string, unknown>> = [];
const primaryConnection = connections[0];
if (primaryConnection) {
  const membership = await prisma.membership.findFirst({
    where: { tenantId: primaryConnection.tenantId, isActive: true },
    select: { userId: true }
  });
  if (membership) {
    const response = await fetch("http://127.0.0.1:3002/knowledge-base/documents?type=transcript&limit=20", {
      headers: {
        "x-sitong-tenant-id": primaryConnection.tenantId,
        "x-sitong-user-id": membership.userId
      }
    });
    if (!response.ok) throw new Error(`knowledge_endpoint_${response.status}`);
    const payload = await response.json() as { documents?: Array<{
      id?: string;
      title?: string;
      documentType?: string;
      characterCount?: number;
      preview?: string;
    }> };
    const endpointItems = payload.documents ?? [];
    endpointDocuments = endpointItems.length;
    endpointUsableDocuments = endpointItems.filter((item) => (item.characterCount ?? 0) >= 40).length;
    endpointSample = endpointItems.slice(0, 3).map((item) => ({
      id: item.id,
      title: item.title,
      documentType: item.documentType,
      characterCount: item.characterCount,
      previewLength: item.preview?.length ?? 0
    }));
  }
}

console.log(JSON.stringify({ sourceLabel: "AI录音卡", endpointDocuments, endpointUsableDocuments, endpointSample, connections: results }, null, 2));
await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
