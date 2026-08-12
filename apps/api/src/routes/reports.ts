import type { FastifyInstance } from "fastify";
import { AlignmentType, Document, Footer, Header, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { runAgent, type LlmProvider } from "@baolu/agent";
import { type TenantBrandingConfig } from "@baolu/shared";
import { env } from "../config/env.js";
import { toAgentRequest } from "../services/demo-context.js";
import { InsufficientCreditsError, persistChatResult } from "../services/chat-persistence.js";
import { resolveRequestContext } from "../services/request-context.js";
import { resolveTenantBranding } from "./tenant.js";

const createReportSchema = z.object({
  title: z.string().min(1).max(80).default("经营增长建议报告"),
  scope: z.enum(["latest", "chat", "files", "audio_cards", "all"]).default("all"),
  format: z.enum(["markdown", "html"]).default("markdown"),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop")
});

const createDocxSchema = z.object({
  title: z.string().min(1).max(120).default("思潼 企业AI增长飞轮咨询报告"),
  filename: z.string().min(1).max(180).default("思潼 企业AI增长飞轮咨询报告.docx"),
  content: z.string().min(1).max(120000),
  consultantName: z.string().max(40).optional(),
  consultantTitle: z.string().max(80).optional()
});

export async function registerReportRoutes(
  app: FastifyInstance,
  provider: LlmProvider
): Promise<void> {
  app.get<{ Querystring: { deviceScope?: string } }>("/reports", async (request, reply) => {
    const query = z.object({ deviceScope: z.enum(["desktop", "mobile"]).default("desktop") }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "invalid_request", details: query.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        reports: [
          {
            id: "demo-latest-report",
            title: "演示经营增长建议报告",
            status: "available",
            createdAt: new Date().toISOString()
          }
        ]
      };
    }

    const recentRuns = await prisma.agentRun.findMany({
      where: {
        tenantId: context.tenantId,
        status: "succeeded",
        deviceScope: query.data.deviceScope
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20,
      select: {
        id: true,
        skillId: true,
        creditCost: true,
        createdAt: true
      }
    });

    return {
      dataMode: "database",
      reports: recentRuns.map((run: any) => ({
        id: run.id,
        title: `${run.skillId} 经营建议`,
        status: "source_agent_run",
        creditCost: run.creditCost,
        createdAt: run.createdAt.toISOString()
      }))
    };
  });

  app.post("/reports", async (request, reply) => {
    const parsed = createReportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    try {
      const sourceBundle =
        env.DATA_MODE === "demo"
          ? buildDemoSourceBundle(parsed.data.scope)
          : await buildDatabaseSourceBundle(context.tenantId, parsed.data.scope, parsed.data.deviceScope);

      const input = buildReportAgentInput({
        title: parsed.data.title,
        scope: parsed.data.scope,
        tenantName: context.profile?.tenantName,
        industry: context.profile?.industry,
        city: context.profile?.city,
        sourceBundle
      });

      const result = await runAgent(
        toAgentRequest({
          auth: context,
          input,
          requestedSkillId: "sales_growth_advisor",
          channel: "workbench"
        }),
        provider
      );
      const persistence = await persistChatResult({
        context,
        input,
        result,
        provider,
        deviceScope: parsed.data.deviceScope
      });

      const markdown = buildMarkdownReport({
        title: parsed.data.title,
        tenantName: context.profile?.tenantName,
        generatedAt: new Date(),
        scope: parsed.data.scope,
        sourceBundle,
        aiAdvice: result.answer
      });

      return {
        dataMode: context.source,
        format: parsed.data.format,
        report: {
          title: parsed.data.title,
          markdown,
          html: markdownToHtml(markdown)
        },
        sourceCount: sourceBundle.items.length,
        ...persistence,
        skillId: result.skillId,
        creditCost: result.creditCost,
        qualityFlags: result.qualityFlags
      };
    } catch (error) {
      request.log.error(error);
      if (error instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          error: "insufficient_credits",
          message: "积分不足，请充值积分后继续使用"
        });
      }
      throw error;
    }
  });

  app.post("/reports/docx", async (request, reply) => {
    const parsed = createDocxSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const branding = resolveTenantBranding(context.profile.data);
    const requestedFilename = parsed.data.filename === "思潼 企业AI增长飞轮咨询报告.docx"
      ? `${branding.brandName} ${branding.systemName}咨询报告.docx`
      : parsed.data.filename;
    const safeFilename = sanitizeDocxFilename(requestedFilename);
    const doc = buildDocxExportDocument({
      title: parsed.data.title,
      content: parsed.data.content,
      consultantName: parsed.data.consultantName,
      consultantTitle: parsed.data.consultantTitle,
      tenantName: context.profile?.tenantName,
      branding
    });
    const buffer = await Packer.toBuffer(doc);

    return reply
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`)
      .send(buffer);
  });
}

function sanitizeDocxFilename(raw: string): string {
  const base = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  const fallback = base || "思潼 企业AI增长飞轮咨询报告";
  return fallback.toLowerCase().endsWith(".docx") ? fallback : `${fallback}.docx`;
}

function buildDocxExportDocument(params: {
  title: string;
  content: string;
  consultantName?: string;
  consultantTitle?: string;
  tenantName?: string;
  branding: TenantBrandingConfig;
}): Document {
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const consultantLine = [params.consultantName, params.consultantTitle].filter(Boolean).join(" · ");
  return new Document({
    title: params.title,
    subject: `${params.branding.systemName}咨询交付报告`,
    creator: `${params.branding.brandName} · ${params.branding.systemName}`,
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${params.branding.brandName} · ${params.branding.systemName}`, color: "667085", size: 18 })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: params.branding.exportFooter, color: "98A2B3", size: 18 })]
            })]
          })
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({
              text: `${params.branding.brandName} · ${params.branding.systemName} · 咨询交付报告`,
              color: params.branding.primaryColor.slice(1).toUpperCase(),
              bold: true
            })]
          }),
          new Paragraph({ text: params.title, heading: HeadingLevel.TITLE }),
          new Paragraph({
            children: [
              new TextRun(
                [
                  `生成时间：${generatedAt}`,
                  params.tenantName ? `服务对象：${params.tenantName}` : null,
                  consultantLine ? `输出角色：${consultantLine}` : null
                ]
                  .filter(Boolean)
                  .join("    ")
              )
            ],
            spacing: { after: 280 }
          }),
          ...buildDocxExportParagraphs(params.content),
          new Paragraph({
            children: [new TextRun(`本文件由${params.branding.brandName} ${params.branding.systemName}基于当前对话、经营记忆和专项咨询逻辑生成。`)],
            spacing: { before: 280 }
          })
        ]
      }
    ]
  });
}

function buildDocxExportParagraphs(content: string): Paragraph[] {
  const lines = cleanExportText(content)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [new Paragraph("暂无可导出的内容。")];
  return lines.map((line) => {
    const heading = inferDocxHeading(line);
    return new Paragraph({
      text: line,
      heading,
      spacing: { after: heading ? 180 : 120 }
    });
  });
}

function inferDocxHeading(line: string) {
  if (line.length > 36) return undefined;
  if (/^(一|二|三|四|五|六|七|八|九|十)[、.]/.test(line)) return HeadingLevel.HEADING_2;
  if (/^(简短结论|完整方案|执行清单|交付物|下一步|注意事项|诊断结论)/.test(line)) {
    return HeadingLevel.HEADING_2;
  }
  return undefined;
}

function cleanExportText(content: string): string {
  return content
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

interface ReportSourceBundle {
  items: Array<{
    type: string;
    title: string;
    createdAt: string;
    content: string;
  }>;
}

function buildDemoSourceBundle(scope: string): ReportSourceBundle {
  const now = new Date().toISOString();
  const allItems = [
    {
      type: "chat",
      title: "本地商家获客与成交咨询",
      createdAt: now,
      content: "客户希望提升朋友圈成交、短视频获客和老客复购，当前问题是新客跟进弱、内容发布后没有私信承接。"
    },
    {
      type: "file",
      title: "客户经营数据文件分析",
      createdAt: now,
      content: "文件分析发现：新客咨询多集中在价格，成交跟进缺少标准话术，复购动作不稳定。"
    },
    {
      type: "audio_card",
      title: "门店运营录音卡",
      createdAt: now,
      content: "员工记录：今天新增18个微信，成交1个，短视频发布1条但未做私信跟进，下午客流少。"
    }
  ];

  return {
    items: filterSourcesByScope(allItems, scope)
  };
}

async function buildDatabaseSourceBundle(
  tenantId: string,
  scope: string,
  deviceScope: "desktop" | "mobile"
): Promise<ReportSourceBundle> {
  const [agentRuns, fileAnalyses, audioCards] = await Promise.all([
    prisma.agentRun.findMany({
      where: {
        tenantId,
        status: "succeeded",
        deviceScope
      },
      orderBy: {
        createdAt: "desc"
      },
      take: scope === "latest" ? 5 : 8
    }),
    prisma.fileAnalysis.findMany({
      where: {
        tenantId,
        status: "succeeded"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: scope === "latest" ? 3 : 5,
      include: {
        file: true
      }
    }),
    prisma.automationTask.findMany({
      where: {
        tenantId,
        type: "audio_card_analysis",
        status: "analyzed"
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: scope === "latest" ? 3 : 5
    })
  ]);

  const items = [
    ...agentRuns.map((run: any) => ({
      type: "chat",
      title: `Agent输出：${run.skillId}`,
      createdAt: run.createdAt.toISOString(),
      content: [run.input, run.output].filter(Boolean).join("\n\n")
    })),
    ...fileAnalyses.map((analysis: any) => ({
      type: "file",
      title: `文件分析：${analysis.file.filename}`,
      createdAt: analysis.createdAt.toISOString(),
      content: [analysis.summary, analysis.output].filter(Boolean).join("\n\n")
    })),
    ...audioCards.map((task: any) => ({
      type: "audio_card",
      title: "录音卡分析",
      createdAt: task.updatedAt.toISOString(),
      content: stringifyJsonPreview(task.payload)
    }))
  ];

  return {
    items: filterSourcesByScope(items, scope)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, scope === "latest" ? 8 : 18)
  };
}

function filterSourcesByScope<T extends { type: string }>(items: T[], scope: string): T[] {
  if (scope === "chat") return items.filter((item) => item.type === "chat");
  if (scope === "files") return items.filter((item) => item.type === "file");
  if (scope === "audio_cards") return items.filter((item) => item.type === "audio_card");
  return items;
}

function buildReportAgentInput(params: {
  title: string;
  scope: string;
  tenantName?: string;
  industry?: string;
  city?: string;
  sourceBundle: ReportSourceBundle;
}): string {
  const sources = params.sourceBundle.items
    .map(
      (item, index) =>
        `【资料${index + 1}｜${item.type}｜${item.title}｜${item.createdAt}】\n${item.content.slice(0, 3000)}`
    )
    .join("\n\n");

  return [
    `请生成《${params.title}》。`,
    "你是思潼 企业AI增长飞轮的垂直经营增长咨询师，不是通用AI。",
    params.tenantName ? `客户：${params.tenantName}` : null,
    params.industry ? `行业：${params.industry}` : null,
    params.city ? `城市：${params.city}` : null,
    `报告范围：${params.scope}`,
    "",
    "请输出：经营诊断、关键问题、未来7天动作、内容/朋友圈建议、销售跟进建议、管理提醒、需要补充的数据。",
    "要求具体、可执行、适合中国本地商家/连锁品牌。",
    "",
    sources || "当前没有足够历史资料，请基于客户画像给出一份基础经营建议报告。"
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMarkdownReport(params: {
  title: string;
  tenantName?: string;
  generatedAt: Date;
  scope: string;
  sourceBundle: ReportSourceBundle;
  aiAdvice: string;
}): string {
  const sources = params.sourceBundle.items
    .map((item, index) => `${index + 1}. ${item.title}（${item.type}，${item.createdAt}）`)
    .join("\n");

  return [
    `# ${params.title}`,
    "",
    `客户：${params.tenantName ?? "未命名客户"}`,
    `生成时间：${params.generatedAt.toISOString()}`,
    `报告范围：${params.scope}`,
    `资料数量：${params.sourceBundle.items.length}`,
    "",
    "## AI经营建议",
    "",
    params.aiAdvice,
    "",
    "## 引用资料",
    "",
    sources || "暂无引用资料"
  ].join("\n");
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const htmlLines = lines.map((line) => {
    if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (/^\d+\. /.test(line)) return `<p>${escapeHtml(line)}</p>`;
    if (line.trim() === "") return "";
    return `<p>${escapeHtml(line)}</p>`;
  });

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    "<title>思潼 企业AI增长飞轮经营报告</title>",
    "<style>body{font-family:Arial,'Microsoft YaHei',sans-serif;max-width:860px;margin:40px auto;line-height:1.8;color:#17211d}h1,h2{line-height:1.3}h1{font-size:28px}h2{font-size:20px;margin-top:28px}p{white-space:pre-wrap}</style>",
    "</head>",
    "<body>",
    ...htmlLines,
    "</body>",
    "</html>"
  ].join("\n");
}

function stringifyJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 5000);
  } catch {
    return String(value).slice(0, 5000);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
