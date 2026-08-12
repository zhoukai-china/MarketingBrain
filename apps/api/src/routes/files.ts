import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { runAgent, type LlmProvider } from "@baolu/agent";
import { env } from "../config/env.js";
import { getDemoFile, listDemoFiles, saveDemoFile } from "../services/demo-files.js";
import { storeMultipartFile, summarizeStoredFile } from "../services/file-storage.js";
import { resolveRequestContext } from "../services/request-context.js";

export async function registerFileRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.post("/files", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "file_required" });
    }

    const upload = await storeMultipartFile({
      tenantId: context.tenantId,
      file
    });

    if (env.DATA_MODE === "demo") {
      const record = saveDemoFile({
        tenantId: context.tenantId,
        userId: context.userId,
        upload
      });
      return {
        dataMode: "demo",
        file: record
      };
    }

    const record = await prisma.uploadedFile.create({
      data: {
        id: upload.id,
        tenantId: context.tenantId,
        userId: context.userId,
        filename: upload.filename,
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        storagePath: upload.storagePath,
        sha256: upload.sha256
      }
    });

    return {
      dataMode: "database",
      file: record
    };
  });

  app.get("/files", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        files: listDemoFiles(context.tenantId)
      };
    }

    const files = await prisma.uploadedFile.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        analyses: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    return {
      dataMode: "database",
      files
    };
  });

  app.post<{ Params: { fileId: string } }>("/files/:fileId/analyze", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const file =
      env.DATA_MODE === "demo"
        ? getDemoFile(request.params.fileId, context.tenantId)
        : await prisma.uploadedFile.findFirst({
            where: {
              id: request.params.fileId,
              tenantId: context.tenantId
            }
          });

    if (!file) {
      return reply.code(404).send({ error: "file_not_found" });
    }

    const fileSummary = await summarizeStoredFile({
      filename: file.filename,
      mimeType: file.mimeType,
      storagePath: file.storagePath
    });

    const result = await runAgent(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        planCode: context.planCode,
        input: [
          "请分析下面这份客户资料。",
          "输出必须包括：关键发现、经营问题、可执行建议、需要客户补充的数据、下一步行动清单。",
          "",
          fileSummary
        ].join("\n"),
        requestedSkillId: "sales_growth_advisor",
        tenantProfile: context.profile,
        channel: "workbench"
      },
      provider
    );

    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        persisted: false,
        analysis: {
          fileId: file.id,
          skillId: result.skillId,
          output: result.answer,
          qualityFlags: result.qualityFlags ?? null,
          creditCost: result.creditCost
        }
      };
    }

    const analysis = await prisma.fileAnalysis.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        fileId: file.id,
        skillId: result.skillId,
        status: "succeeded",
        summary: fileSummary.slice(0, 2000),
        output: result.answer,
        qualityFlags: result.qualityFlags ?? null,
        creditCost: result.creditCost
      }
    });

    return {
      dataMode: "database",
      persisted: true,
      analysis
    };
  });
}

