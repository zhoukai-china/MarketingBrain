import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveRequestContext } from "../services/request-context.js";
import {
  buildTakeawayDashboard,
  listTakeawayImports,
  parseTakeawayWorkbook,
  saveTakeawayImport
} from "../services/takeaway-growth-data.js";

const importQuerySchema = z.object({
  platform: z.string().trim().max(40).optional(),
  storeName: z.string().trim().max(100).optional()
});

const dashboardQuerySchema = z.object({
  platform: z.string().trim().max(40).optional(),
  storeName: z.string().trim().max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const supportedExtensions = new Set([".xlsx", ".xls", ".csv", ".tsv", ".json", ".txt"]);

export async function registerTakeawayGrowthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: Record<string, unknown> }>("/agents/takeaway-growth/imports", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsedQuery = importQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) return reply.code(400).send({ error: "invalid_request", details: parsedQuery.error.flatten() });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "file_required", message: "请选择外卖经营数据文件。" });
    const extension = path.extname(file.filename).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      return reply.code(415).send({ error: "unsupported_file", message: "当前支持 XLSX、XLS、CSV、TSV、JSON、TXT。PDF、Word 和截图可作为诊断资料，但不能直接计算逐行经营指标。" });
    }
    const buffer = await file.toBuffer();
    const parsed = parseTakeawayWorkbook({
      filename: file.filename,
      buffer,
      tenantId: context.tenantId,
      platformHint: parsedQuery.data.platform,
      storeNameHint: parsedQuery.data.storeName
    });
    const saved = await saveTakeawayImport({ tenantId: context.tenantId, userId: context.userId, parsed });
    const dashboard = await buildTakeawayDashboard({ tenantId: context.tenantId });
    const { normalizedRows: _rows, fieldMappings: _mappings, ...publicRecord } = saved.record;
    return {
      dataMode: context.source,
      duplicateFile: saved.duplicateFile,
      import: publicRecord,
      detectedSheets: parsed.detectedSheets,
      dashboard
    };
  });

  app.get("/agents/takeaway-growth/imports", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const records = await listTakeawayImports(context.tenantId);
    return {
      imports: records.map(({ normalizedRows: _rows, fieldMappings: _mappings, ...record }) => record)
    };
  });

  app.get<{ Querystring: Record<string, unknown> }>("/agents/takeaway-growth/dashboard", async (request, reply) => {
    const parsed = dashboardQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (parsed.data.dateFrom && parsed.data.dateTo && parsed.data.dateFrom > parsed.data.dateTo) {
      return reply.code(400).send({ error: "invalid_date_range", message: "开始日期不能晚于结束日期。" });
    }
    const context = await resolveRequestContext(request.headers);
    return buildTakeawayDashboard({ tenantId: context.tenantId, ...parsed.data });
  });
}
