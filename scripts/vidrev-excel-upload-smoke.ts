import assert from "node:assert/strict";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import multipart from "../apps/api/node_modules/@fastify/multipart/index.js";
import * as XLSX from "../apps/api/node_modules/xlsx/xlsx.mjs";
import { registerMediaRoutes } from "../apps/api/src/routes/media.js";
import { parseVidrevRowsFromText, computeVidrevMetrics } from "../apps/api/src/services/video-review-engine.js";

// 工单 2026-09-13 §2.1/§2.4：视频号助手与抖音创作者中心默认导出的就是 Excel，
// 用户把 .xlsx 拖进来必须真读到数据（不能只说「暂不能自动读取」，也不能无输出）。
//
// 本 smoke 走**真实 HTTP handler**（`POST /media/analyze` 文档路径）+ 真实 xlsx 解析 +
// vidrev 引擎纯函数：合成 xlsx → 文档解析 → 表格文本 → 数据行/平台/周期/受限维度。
// 注入 transport 断言 0 次 Provider 调用、0 费用、不碰数据库。
const originalFetch = globalThis.fetch;

const DOUYIN_HEADERS = [
  "视频标题", "发布时间", "播放数", "点赞数", "评论数", "分享数", "收藏数",
  "完播率", "5秒完播率", "粉丝净增量", "成交金额", "投流金额"
];
const DOUYIN_ROWS = [
  ["示例一", "2026-08-12", "124000", "3200", "286", "410", "520", "31%", "62%", "120", "0", "0"],
  ["示例二", "2026-08-18", "32000", "900", "60", "120", "200", "38%", "60%", "18", "0", "0"],
  ["示例三", "2026-08-25", "11000", "300", "40", "30", "90", "26%", "44%", "5", "1200", "0"]
];
const CHANNELS_HEADERS = ["标题", "发表时间", "播放量", "点赞量", "评论量", "转发量", "收藏量", "平均播放进度", "完播率", "成交金额"];
const CHANNELS_ROWS = [
  ["视频号示例一", "2026-08-14", "86000", "2100", "180", "260", "300", "42%", "29%", "0"],
  ["视频号示例二", "2026-08-22", "23000", "640", "52", "88", "120", "37%", "24%", "600"]
];

function workbookBuffer(headers: string[], rows: string[][], sheetName: string): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function xlsxForm(bytes: Buffer, filename: string) {
  const boundary = "vidrev-excel-synthetic-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

async function main(): Promise<void> {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Synthetic transport must never be called by the document path");
  };

  const app = Fastify({ disableRequestLogging: true, logger: false });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024 } });
  await registerMediaRoutes(app);

  const cases = {
    douyin: { headers: DOUYIN_HEADERS, rows: DOUYIN_ROWS, file: "抖音作品数据.xlsx", count: 3, limited: "none" as const },
    // 视频号后台没有「5秒完播率」这一列——这正是工单要的「核心字段缺失进受限维度、而不是无输出」。
    channels: { headers: CHANNELS_HEADERS, rows: CHANNELS_ROWS, file: "视频号视频数据.xlsx", count: 2, limited: "optional_only" as const }
  };

  try {
    for (let round = 0; round < 3; round += 1) {
      for (const [key, item] of Object.entries(cases)) {
        const upload = await app.inject({
          method: "POST",
          url: "/media/analyze",
          remoteAddress: `127.31.${round}.${key === "douyin" ? 1 : 2}`,
          ...xlsxForm(workbookBuffer(item.headers, item.rows, "作品数据"), item.file)
        });
        assert.equal(upload.statusCode, 200, `${key} xlsx upload returns 200 (got ${upload.statusCode})`);
        const body = upload.json() as { documentText?: string; transcript?: string };
        assert.ok((body.documentText ?? "").includes(item.headers[0]), `${key} xlsx document text keeps the header row`);
        assert.equal(body.transcript, undefined, `${key} xlsx must not enter the ASR path`);

        const parsed = parseVidrevRowsFromText(body.documentText ?? "");
        assert.equal(parsed.rows.length, item.count, `${key} xlsx parses ${item.count} rows (got ${parsed.rows.length})`);
        const metrics = computeVidrevMetrics(parsed.rows);
        assert.equal(metrics.count, item.count, `${key} metrics count matches rows`);
        assert.ok(
          parsed.rows.every((row) => typeof row.title === "string" && row.title.length > 0),
          `${key} xlsx maps the title column through the alias table`
        );
        assert.ok(
          parsed.rows.every((row) => typeof row.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.published_at)),
          `${key} xlsx maps the publish-date column`
        );
        assert.ok(parsed.rows.every((row) => typeof row.plays === "number" && row.plays > 0), `${key} xlsx maps plays`);
        if (item.limited === "none") {
          assert.deepEqual(metrics.limitedDimensions, [], `${key} xlsx core fields are complete, so no limited dimension`);
        } else {
          assert.ok(metrics.limitedDimensions.length > 0, `${key} xlsx keeps the missing optional column in limited dimensions`);
          for (const entry of metrics.limitedDimensions) {
            assert.match(entry, /5秒完播率/, `${key} xlsx only lists the optional 5s column, got: ${entry}`);
          }
        }
      }

      // 空表（只有表头）：必须明确「没有识别到视频记录」，而不是假装成功。
      const empty = await app.inject({
        method: "POST",
        url: "/media/analyze",
        remoteAddress: `127.32.${round}.1`,
        ...xlsxForm(workbookBuffer(DOUYIN_HEADERS, [], "作品数据"), "空表.xlsx")
      });
      assert.equal(empty.statusCode, 200);
      const emptyParsed = parseVidrevRowsFromText((empty.json() as { documentText?: string }).documentText ?? "");
      assert.equal(emptyParsed.rows.length, 0, "header-only workbook must not invent rows");
      assert.ok(
        emptyParsed.notes.some((note) => /未|没有|空/.test(note)),
        `header-only workbook must explain the miss: ${JSON.stringify(emptyParsed.notes)}`
      );

      // 缺核心字段（只有标题 + 点赞）：进「受限维度」，而不是无输出。
      const thin = await app.inject({
        method: "POST",
        url: "/media/analyze",
        remoteAddress: `127.33.${round}.1`,
        ...xlsxForm(workbookBuffer(["标题", "点赞数"], [["缺字段示例", "120"]], "作品数据"), "缺字段.xlsx")
      });
      const thinParsed = parseVidrevRowsFromText((thin.json() as { documentText?: string }).documentText ?? "");
      const thinMetrics = thinParsed.rows.length > 0 ? computeVidrevMetrics(thinParsed.rows) : null;
      assert.ok(
        thinParsed.rows.length === 0 || (thinMetrics?.limitedDimensions.length ?? 0) > 0,
        "workbook without core fields must be reported as a limited dimension instead of a silent empty report"
      );
    }

    assert.equal(providerCalls, 0, "document parsing must not call any model provider");
    console.log(JSON.stringify({
      result: "VIDREV_EXCEL_UPLOAD_PASS",
      rounds: 3,
      douyinRows: cases.douyin.count,
      channelsRows: cases.channels.count,
      headerOnlyRejected: true,
      providerCalls,
      costYuan: 0
    }));
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
