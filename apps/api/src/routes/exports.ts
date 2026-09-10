import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import { z } from "zod";
import { EXPORT_PRICING, type TenantBrandingConfig } from "@baolu/shared";
import { resolveRequestContext } from "../services/request-context.js";
import { getBearerToken, verifySessionToken } from "../services/auth-token.js";
import { consumeWalletCredits, readWallet, buildRechargeUrl } from "../services/sitong-wallet.js";
import { resolveTenantBranding } from "./tenant.js";

interface ParsedSection {
  title: string;
  lines: string[];
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

type AnswerContentBlock = { type: "text"; lines: string[] } | { type: "table"; table: ParsedTable };

interface ExportRecord {
  buffer: Buffer;
  filename: string;
  createdAt: number;
  tenantId: string;
  userId: string;
}

const fallbackTitle = "连锁品牌IP获客交付件";
const exportSchema = z.object({
  content: z.string().min(1).max(120_000),
  title: z.string().max(120).optional()
});
const exportRecords = new Map<string, ExportRecord>();
const exportTtlMs = 10 * 60 * 1000;

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/exports/docx/price", async () => ({
    credits: EXPORT_PRICING.docxCredits,
    version: EXPORT_PRICING.docxVersion,
    effectiveAt: EXPORT_PRICING.docxEffectiveAt
  }));

  app.post("/exports/docx", async (request, reply) => {
    const context = await resolveExportContext(request.headers, reply);
    if (!context) return;
    const parsed = exportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_export_payload",
        message: "Word 导出内容为空或过长"
      });
    }

    cleanupExportRecords();

    const price = EXPORT_PRICING.docxCredits;
    const walletBefore = await readWallet(context.userId);
    if (walletBefore.balance < price) {
      return reply.code(402).send({
        error: "insufficient_credits",
        message: "当前积分不足，充值后可导出精美 Word。",
        balance: walletBefore.balance,
        required: price,
        rechargeUrl: buildRechargeUrl("docx_export")
      });
    }

    const branding = resolveTenantBranding(context.profile.data);
    const { title } = parseAnswer(parsed.data.content);
    const filename = `${normalizeFilenamePart(parsed.data.title || title) || fallbackTitle}.docx`;
    const buffer = await buildAnswerDocx(parsed.data.content, parsed.data.title || title, branding);
    const id = crypto.randomUUID();

    // 交付物生成完成后才扣费；同一次导出用 recordId 幂等，失败不扣。
    const consumed = await consumeWalletCredits({
      userId: context.userId,
      requestId: `docx:${id}`,
      price,
      skillId: "docx_export",
      priceVersion: EXPORT_PRICING.docxVersion,
      source: "web"
    });
    if (consumed.status === "insufficient") {
      return reply.code(402).send({
        error: "insufficient_credits",
        message: "当前积分不足，充值后可导出精美 Word。",
        balance: consumed.wallet.balance,
        required: price,
        rechargeUrl: buildRechargeUrl("docx_export")
      });
    }

    exportRecords.set(id, {
      buffer,
      filename,
      createdAt: Date.now(),
      tenantId: context.tenantId,
      userId: context.userId
    });

    return {
      id,
      filename,
      downloadUrl: `/exports/docx/${id}`,
      consumedCredits: price,
      balance: consumed.wallet.balance
    };
  });

  app.get<{ Params: { id: string } }>("/exports/docx/:id", async (request, reply) => {
    const context = await resolveExportContext(request.headers, reply);
    if (!context) return;
    // Lookup and consume after the asynchronous authorization, so concurrent
    // downloads cannot both obtain the same one-use buffer.
    cleanupExportRecords();
    const record = exportRecords.get(request.params.id);
    if (!record) {
      return reply.code(404).send({
        error: "export_not_found",
        message: "Word 文件已过期，请重新点击下载"
      });
    }
    if (record.tenantId !== context.tenantId) {
      return reply.code(403).send({
        error: "export_tenant_forbidden",
        message: "当前文件不属于本经营主体"
      });
    }
    if (record.userId !== context.userId) {
      return reply.code(404).send({ error: "export_not_found", message: "当前文件不可用，请重新导出自己的内容" });
    }

    exportRecords.delete(request.params.id);
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("Content-Disposition", buildContentDisposition(record.filename))
      .send(record.buffer);
  });
}

async function resolveExportContext(headers: Record<string, unknown>, reply: FastifyReply) {
  reply.header("Cache-Control", "private, no-store");
  const token = getBearerToken(headers);
  try {
    const identity = token ? verifySessionToken(token) : null;
    if (!identity) {
      reply.code(401).send({ error: "export_session_required", message: "请登录后重新导出或下载" });
      return undefined;
    }
    // The shared demo resolver accepts identity headers; derive them only from
    // the verified token here. Database mode rechecks active membership per request.
    return await resolveRequestContext({ ...headers,
      "x-sitong-tenant-id": identity.tenantId, "x-sitong-user-id": identity.userId
    });
  } catch (error) {
    const revoked = error instanceof Error && error.message === "membership_not_found";
    const code = revoked ? "export_membership_forbidden" : "export_authorization_unavailable";
    reply.log.warn({ event: "export.authorization_rejected", code });
    reply.code(revoked ? 403 : 503).send({ error: code, message: revoked ? "当前成员权限不可用，请联系管理员" : "暂时无法核验下载权限，请稍后再试" });
    return undefined;
  }
}

export async function buildAnswerDocx(content: string, overrideTitle: string | undefined, branding: TenantBrandingConfig): Promise<Buffer> {
  const { title: parsedTitle, intro, sections } = parseAnswer(content);
  const title = overrideTitle || parsedTitle;
  const brandColor = branding.primaryColor.slice(1).toUpperCase();
  const brandSignature = `${branding.brandName} · ${branding.systemName}`;
  const border = { style: BorderStyle.SINGLE, size: 1, color: "D7DEE8" };
  const mutedBorder = { style: BorderStyle.SINGLE, size: 1, color: "EEF2F7" };
  const mdRuns = (text: string, opts: { size?: number; color?: string; bold?: boolean; font?: string } = {}) => {
    const parts = cleanInlineText(text).split(/(\*\*[^*]+\*\*)/g).filter((part) => part.length > 0);
    const runs = parts.map((part) => {
      const isBold = /^\*\*[^*]+\*\*$/.test(part);
      return new TextRun({
        text: isBold ? part.slice(2, -2) : part,
        font: opts.font ?? "Microsoft YaHei",
        size: opts.size ?? 22,
        color: opts.color ?? "1B2430",
        bold: opts.bold || isBold
      });
    });
    return runs.length > 0
      ? runs
      : [new TextRun({ text: "", font: opts.font ?? "Microsoft YaHei", size: opts.size ?? 22, color: opts.color ?? "1B2430" })];
  };
  const bodyParagraph = (text: string, color = "1B2430", bold = false, size = 22) =>
    new Paragraph({
      spacing: { after: 120, line: 300 },
      children: mdRuns(text, { size, color, bold })
    });
  const bulletParagraph = (text: string) =>
    new Paragraph({
      numbering: { reference: "answer-bullets", level: 0 },
      spacing: { after: 80, line: 300 },
      children: mdRuns(text, { size: 21, color: "253244" })
    });
  const quoteParagraph = (text: string) =>
    new Paragraph({
      spacing: { after: 80, line: 300 },
      indent: { left: 260 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: brandColor, space: 8 } },
      shading: { fill: "FBF8F4", color: "auto", type: ShadingType.CLEAR },
      children: mdRuns(text, { size: 21, color: "454F5B" })
    });
  const labelParagraph = (text: string) =>
    new Paragraph({
      spacing: { after: 80, line: 280 },
      children: mdRuns(text, { size: 20, color: "203748", bold: true })
    });
  const valueParagraph = (text: string) =>
    new Paragraph({
      spacing: { after: 80, line: 280 },
      children: mdRuns(text, { size: 20, color: "253244" })
    });
  const fieldParagraph = (label: string, value: string) =>
    new Paragraph({
      spacing: { after: 95, line: 300 },
      children: [
        ...mdRuns(`${label}：`, { size: 21, color: "7A5A00", bold: true }),
        ...mdRuns(value, { size: 21, color: "253244" })
      ]
    });
  const tableFromParsed = ({ headers, rows }: ParsedTable) => {
    const colWidth = Math.floor(9360 / headers.length);
    const columnWidths = headers.length === 2 ? [1700, 7660] : headers.map(() => colWidth);
    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      columnWidths,
      layout: TableLayoutType.FIXED,
      margins: { top: 110, bottom: 110, left: 140, right: 140 },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: mutedBorder,
        insideVertical: mutedBorder
      },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map(
            (header, index) =>
              new TableCell({
                width: { size: columnWidths[index] ?? colWidth, type: WidthType.DXA },
                shading: { fill: "E8EEF5", color: "auto", type: ShadingType.CLEAR },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 120, bottom: 120, left: 140, right: 140 },
                children: [labelParagraph(header)]
              })
          )
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              cantSplit: true,
              children: headers.map(
                (_, index) =>
                  new TableCell({
                    width: { size: columnWidths[index] ?? colWidth, type: WidthType.DXA },
                    verticalAlign: VerticalAlign.CENTER,
                    margins: { top: 110, bottom: 110, left: 140, right: 140 },
                    children: [valueParagraph(row[index] ?? "")]
                  })
              )
            })
        )
      ]
    });
  };
  const renderLine = (line: string, sectionTitle: string): Paragraph | undefined => {
    if (/^>\s?/.test(line)) return quoteParagraph(line);
    if (/^\s*[-*]\s+/.test(line)) return bulletParagraph(line);
    const match = line.match(/^([^：:]{1,22})[：:]\s*(.+)$/);
    const label = match ? match[1].trim() : "说明";
    const value = stripRepeatedSectionLabel(match ? match[2].trim() : line, sectionTitle);
    if (!value) return undefined;
    return label !== "说明" ? fieldParagraph(label, value) : bodyParagraph(value);
  };

  const sectionChildren = (section: ParsedSection, index: number) => {
    const children: any[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 140 },
        keepNext: true,
        children: [
          new TextRun({ text: `${String(index + 1).padStart(2, "0")}  ${section.title}`, font: "Microsoft YaHei", size: 26, color: brandColor, bold: true })
        ]
      })
    ];

    for (const block of splitSectionBlocks(section.lines)) {
      if (block.type === "table") {
        children.push(tableFromParsed(block.table), bodyParagraph(""));
        continue;
      }

      for (const line of block.lines) {
        const paragraph = renderLine(line, section.title);
        if (paragraph) children.push(paragraph);
      }
    }

    return children;
  };

  const doc = new Document({
    title,
    subject: `${branding.systemName} 交付文件`,
    creator: brandSignature,
    numbering: {
      config: [
        {
          reference: "answer-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 540, hanging: 270 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 60 },
                children: [new TextRun({ text: brandSignature, font: "Microsoft YaHei", size: 18, color: "667085" })]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: branding.exportFooter, font: "Microsoft YaHei", size: 18, color: "98A2B3" })]
              })
            ]
          })
        },
        children: [
          new Paragraph({
            spacing: { before: 260, after: 90 },
            children: [new TextRun({ text: branding.systemName, font: "Microsoft YaHei", size: 22, color: brandColor, bold: true })]
          }),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { after: 140 },
            children: [new TextRun({ text: title, font: "Microsoft YaHei", size: 44, color: "203748", bold: true })]
          }),
          new Paragraph({
            spacing: { after: 260 },
            children: [
              new TextRun({
                text: brandSignature,
                font: "Microsoft YaHei",
                size: 20,
                color: "667085"
              })
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "D9B875", space: 8 } }
          }),
          ...intro.map((line) => renderLine(line, "")).filter((paragraph): paragraph is Paragraph => Boolean(paragraph)),
          ...sections.flatMap((section, index) => sectionChildren(section, index))
        ]
      }
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { font: "Microsoft YaHei", size: 22, color: "1B2430" },
          paragraph: { spacing: { after: 120, line: 300 } }
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Microsoft YaHei", size: 44, color: "203748", bold: true },
          paragraph: { spacing: { before: 260, after: 140 }, keepNext: true }
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Microsoft YaHei", size: 26, color: brandColor, bold: true },
          paragraph: { spacing: { before: 280, after: 140 }, keepNext: true }
        }
      ]
    }
  });

  return Packer.toBuffer(doc);
}

function parseAnswer(content: string): { title: string; intro: string[]; sections: ParsedSection[] } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];
  const title = firstLine && !isSectionHeading(firstLine) ? firstLine.replace(/^#+\s*/, "") : fallbackTitle;
  const bodyLines = firstLine && title === firstLine.replace(/^#+\s*/, "") ? lines.slice(1) : lines;
  const sections: ParsedSection[] = [];
  const intro: string[] = [];
  let current: ParsedSection | undefined;

  for (const line of bodyLines) {
    if (isSectionHeading(line)) {
      current = { title: cleanSectionTitle(line), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      // 第一个章节标题之前的内容作为“引言”，不占用章节编号。
      intro.push(line);
      continue;
    }
    current.lines.push(line);
  }

  if (sections.length === 0) {
    // 完全没有章节标题时，退回单节，避免内容丢失。
    return { title, intro: [], sections: intro.length ? [{ title: "内容概要", lines: intro }] : [] };
  }

  return {
    title,
    intro,
    sections: sections.filter((section) => section.lines.length > 0)
  };
}

function isSectionHeading(line: string): boolean {
  const bare = stripInlineMarks(line);
  return /^([一二三四五六七八九十]+、|\d+[.、])\S+/.test(bare);
}

function cleanSectionTitle(line: string): string {
  return stripInlineMarks(line).replace(/^([一二三四五六七八九十]+、|\d+[.、])\s*/, "").trim();
}

function stripInlineMarks(line: string): string {
  return line.replace(/^#{1,3}\s*/, "").replace(/[*_]/g, "").trim();
}

function parseMarkdownTableLines(tableLines: string[]): ParsedTable | undefined {
  if (tableLines.length < 2) return undefined;
  const rows = tableLines
    .filter((line) => !/^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
    )
    .filter((row) => row.some(Boolean));
  if (rows.length < 2) return undefined;
  return { headers: rows[0], rows: rows.slice(1) };
}

function splitSectionBlocks(lines: string[]): AnswerContentBlock[] {
  const blocks: AnswerContentBlock[] = [];
  let textLines: string[] = [];
  let index = 0;
  const flushText = () => {
    const cleaned = textLines.map((line) => line.trim()).filter((line) => line && line !== "---" && !/^```/.test(line));
    if (cleaned.length > 0) blocks.push({ type: "text", lines: cleaned });
    textLines = [];
  };

  while (index < lines.length) {
    if (/^\|.+\|$/.test(lines[index])) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const table = parseMarkdownTableLines(tableLines);
      if (table) {
        flushText();
        blocks.push({ type: "table", table });
        continue;
      }
      textLines.push(...tableLines);
      continue;
    }
    textLines.push(lines[index]);
    index += 1;
  }

  flushText();
  return blocks;
}

function stripRepeatedSectionLabel(line: string, sectionTitle: string): string {
  return line === sectionTitle ? "" : line;
}

function cleanInlineText(text: string): string {
  return text
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function normalizeFilenamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function buildContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "ip-acquisition.docx";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function cleanupExportRecords(): void {
  const now = Date.now();
  for (const [id, record] of exportRecords.entries()) {
    if (now - record.createdAt > exportTtlMs) {
      exportRecords.delete(id);
    }
  }
}
