import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyGetNoteFailure, pullGetNoteTranscripts, type GetNoteSyncObservation } from "../apps/api/src/services/getnote-connector.js";

async function main(): Promise<void> {
  const root = process.cwd();
  const route = await readFile(`${root}/apps/api/src/routes/knowledge-base.ts`, "utf8");
  const connector = await readFile(`${root}/apps/api/src/services/getnote-connector.ts`, "utf8");
  const schema = await readFile(`${root}/packages/db/prisma/schema.prisma`, "utf8");
  const webSync = await readFile(`${root}/apps/web/src/lib/knowledge-sync.ts`, "utf8").catch(() => "");
  const webEntrypoints = await Promise.all([
    "apps/web/src/pages/KnowledgeBasePage.tsx",
    "apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx",
    "apps/web/src/pages/AgentProductsApp.tsx",
    "apps/web/src/components/acquisition/TopicSystemWorkbench.tsx"
  ].map((file) => readFile(`${root}/${file}`, "utf8")));

  assert.match(schema, /model KnowledgeSyncJob/, "同步必须有知识库域内的持久任务模型");
  assert.match(route, /reply\.code\(202\)/, "同步启动必须非阻塞返回 202");
  assert.match(route, /knowledge_sync_(?:accepted|stage|completed|failed)/, "同步必须输出脱敏分段观测事件");
  assert.match(route, /status: \{ in: \["queued", "running"\] \}/, "同租户同连接必须复用进行中的任务");
  assert.match(route, /sync_process_interrupted/, "失去心跳的运行任务必须进入可恢复中断终态");
  assert.match(route, /tenantId: context\.tenantId, connectionId/, "增量水位只能读取当前租户当前连接");
  assert.match(route, /未推进同步水位/, "部分详情失败不能推进水位而丢失失败条目");
  assert.match(connector, /knownDocuments/, "Get笔记连接器必须接收租户内增量水位");
  assert.match(connector, /onObservation/, "Get笔记连接器必须暴露列表、详情、节流和退避观测");
  assert.match(webSync, /pollKnowledgeSync/, "Web 入口必须共用可恢复轮询合同");
  assert.match(webSync, /clientStartedAt/, "Web 必须发送点击到 API 接收的遥测起点");
  assert.match(webSync, /resumeKnowledgeSync/, "刷新后必须能恢复既有任务状态");
  for (const source of webEntrypoints) {
    assert.match(source, /runKnowledgeSync/, "每个同步入口必须使用同一异步任务合同");
    assert.match(source, /knowledgeSyncProgressText/, "每个同步入口必须显示真实阶段而非无反馈等待");
  }

  let simulatedNow = 0;
  let sleptMs = 0;
  const observations: GetNoteSyncObservation[] = [];
  const calls: string[] = [];
  const fixtureFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/list")) {
      return new Response(JSON.stringify({ data: { list: [
        { id: "unchanged-note", updated_at: "2026-08-26T08:00:00.000Z" },
        { id: "updated-note", updated_at: "2026-08-26T09:00:00.000Z" }
      ], has_more: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: { note: {
      id: "updated-note", title: "合成笔记", content: "仅用于同步合同测试的合成正文。",
      updated_at: "2026-08-26T09:00:00.000Z", note_type: "note"
    } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await pullGetNoteTranscripts({ apiKey: "synthetic-key", clientId: "synthetic-client" }, {
    knownDocuments: new Map([
      ["unchanged-note", { externalUpdatedAt: new Date("2026-08-26T08:00:00.000Z"), contentHash: "unchanged" }],
      ["updated-note", { externalUpdatedAt: new Date("2026-08-26T07:00:00.000Z"), contentHash: "old" }]
    ]),
    fetchImpl: fixtureFetch,
    sleep: async (milliseconds) => { sleptMs += milliseconds; simulatedNow += milliseconds; },
    now: () => simulatedNow,
    onObservation: (observation) => { observations.push(observation); }
  });
  assert.equal(result.scanned, 2);
  assert.equal(result.unchanged, 1, "更新时间水位相同的资料必须跳过详情请求");
  assert.equal(result.detailRequests, 1, "两条中只有变化的一条读取详情");
  assert.equal(result.documents.length, 1);
  assert.equal(result.throttleMs, 350, "详情读取仍保留正式节流保护");
  assert.equal(sleptMs, 350);
  assert.ok(observations.some((item) => item.stage === "listing"));
  assert.ok(observations.some((item) => item.stage === "details"));
  assert.ok(observations.some((item) => item.stage === "throttling"));
  assert.doesNotMatch(JSON.stringify(observations), /合成正文|synthetic-key/, "遥测不得包含正文或凭证");
  assert.equal(calls.filter((item) => item.includes("/detail")).length, 1);

  let rateLimitCalls = 0;
  const retryWaits: number[] = [];
  const retried = await pullGetNoteTranscripts({ apiKey: "synthetic-key", clientId: "synthetic-client" }, {
    maxPages: 1,
    fetchImpl: (async () => {
      rateLimitCalls += 1;
      return rateLimitCalls === 1
        ? new Response(JSON.stringify({ code: 10202 }), { status: 429, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ data: { list: [], has_more: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
    sleep: async (milliseconds) => { retryWaits.push(milliseconds); }
  });
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.backoffMs, 500);
  assert.deepEqual(retryWaits, [500]);
  assert.equal(classifyGetNoteFailure("getnote_http_401"), "authorization");
  assert.equal(classifyGetNoteFailure("getnote_http_429"), "rate_limit");
  assert.equal(classifyGetNoteFailure("getnote_http_503"), "temporary");

  let partialDetailAttempts = 0;
  const partial = await pullGetNoteTranscripts({ apiKey: "synthetic-key", clientId: "synthetic-client" }, {
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/list")) return new Response(JSON.stringify({ data: { list: [{ id: "broken" }, { id: "healthy" }], has_more: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("id=broken")) {
        partialDetailAttempts += 1;
        return new Response(JSON.stringify({ code: 50000 }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { note: { title: "合成成功项", content: "合成内容", updated_at: "2026-08-26T10:00:00.000Z" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
    sleep: async () => undefined
  });
  assert.equal(partial.failed, 1, "单条详情失败必须保留为部分失败计数");
  assert.equal(partial.documents.length, 1, "部分失败时成功资料仍进入正式持久化阶段");
  assert.equal(partialDetailAttempts, 4, "5xx 单请求最多四次且不追加第五次");

  let nonRetryableCalls = 0;
  await assert.rejects(() => pullGetNoteTranscripts({ apiKey: "synthetic-key", clientId: "synthetic-client" }, {
    maxPages: 1,
    fetchImpl: (async () => {
      nonRetryableCalls += 1;
      return new Response(JSON.stringify({ code: 40001 }), { status: 400, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
    sleep: async () => undefined
  }), /getnote_http_400/);
  assert.equal(nonRetryableCalls, 1, "不可重试错误不得退避或重复请求");

  const unchangedDurations: number[] = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const sampleStart = performance.now();
    const unchangedResult = await pullGetNoteTranscripts({ apiKey: "synthetic-key", clientId: "synthetic-client" }, {
      knownDocuments: new Map([["stable", { externalUpdatedAt: new Date("2026-08-26T08:00:00.000Z"), contentHash: "stable" }]]),
      fetchImpl: (async () => new Response(JSON.stringify({ data: { list: [{ id: "stable", updated_at: "2026-08-26T08:00:00.000Z" }], has_more: false } }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch,
      sleep: async () => undefined
    });
    assert.equal(unchangedResult.detailRequests, 0);
    unchangedDurations.push(performance.now() - sampleStart);
  }
  unchangedDurations.sort((a, b) => a - b);
  assert.ok(unchangedDurations[Math.ceil(unchangedDurations.length * 0.95) - 1] <= 5_000, "合成无变化增量同步 P95 必须不超过 5 秒");
  console.log("beauty-industry getnote sync P1 smoke passed");
}

void main();
