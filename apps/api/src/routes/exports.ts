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
import { env } from "../config/env.js";
import { prisma } from "@baolu/db";

/**
 * Word 下载的**一次性链接令牌**（2026-09-16 客户现场）。
 *
 * 事故：导出文件本来已经生成成功，但前端是「带 token 拉字节 → 造一个 blob: 链接 → 点 a 下载」，
 * 手机（尤其微信内置浏览器）拿到的就是这个 `blob:` 链接——微信收藏/转换、WPS 都打不开，
 * 客户看到的是「没有生成文件 / 不支持转换的链接」。
 *
 * 所以导出接口额外签发一个**短期、只对这份文件有效**的令牌，前端直接把链接交出去：
 * `GET /exports/docx/<id>?t=<token>` 在手机浏览器里就是一次普通下载，微信/系统/WPS 都能接。
 * 令牌只在服务端 HMAC 校验（不落库、不进日志），10 分钟后随导出记录一起失效。
 */
function exportTokenSignature(exportId: string, userId: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", env.JWT_SECRET ?? "export-download")
    .update(`${exportId}.${userId}.${expiresAt}`)
    .digest("base64url");
}

function signExportDownloadToken(exportId: string, userId: string): string {
  const expiresAt = Date.now() + exportTtlMs;
  return `${expiresAt}.${exportTokenSignature(exportId, userId, expiresAt)}`;
}

function verifyExportDownloadToken(exportId: string, userId: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt || !signature) return false;
  const expected = exportTokenSignature(exportId, userId, expiresAt);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

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
  /** 已被某次下载「占位」：保证同一条一次性链接并发只能真正读到一次字节。 */
  claimed?: boolean;
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

    /**
     * 同一份报告只扣一次（用户 2026-09-16：客户下载失败重试 4 次被扣 4 次，不合理）。
     *
     * 计费键 = 「用户 + 标题 + 正文」的指纹：第一次导出正常扣 `docxCredits`，
     * 之后对**同一份内容**再导出（换手机、下载失败重下、清理浏览器后再下）命中同一 requestId，
     * 钱包幂等直接返回，不重复扣费；余额为 0 也能重下自己已付费的那份。
     */
    const contentFingerprint = crypto
      .createHash("sha256")
      .update(`${context.userId}\n${parsed.data.title ?? ""}\n${parsed.data.content}`)
      .digest("hex")
      .slice(0, 40);
    const exportRequestId = `docx:${contentFingerprint}`;
    const alreadyCharged = Boolean(
      await prisma.walletLedger.findFirst({
        where: { userId: context.userId, refRequestId: exportRequestId, type: "consume" },
        select: { id: true }
      })
    );
    const price = alreadyCharged ? 0 : EXPORT_PRICING.docxCredits;
    const walletBefore = await readWallet(context.userId);
    if (!alreadyCharged && walletBefore.balance < price) {
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
    let balanceAfter = walletBefore.balance;
    if (!alreadyCharged) {
      const consumed = await consumeWalletCredits({
        userId: context.userId,
        requestId: exportRequestId,
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
      balanceAfter = consumed.wallet.balance;
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
      // 带一次性令牌的直链：手机端（微信内置浏览器 / WPS）直接点就能拿到文件。
      downloadUrl: `/exports/docx/${id}?t=${encodeURIComponent(signExportDownloadToken(id, context.userId))}`,
      consumedCredits: price,
      balance: balanceAfter,
      // 同一份报告重下不重复扣费（前端据此给一句说明，而不是让用户以为又被扣了）。
      redownload: alreadyCharged
    };
  });

  app.get<{ Params: { id: string } }>("/exports/docx/:id", async (request, reply) => {
    // 交付物可能含经营数据：无论走哪条取件路径，都不允许中间层缓存。
    reply.header("Cache-Control", "private, no-store");
    // Lookup and consume after the asynchronous authorization, so concurrent
    // downloads cannot both obtain the same one-use buffer.
    // 两条取件路径（令牌直链 / 会话头）都必须声明不可缓存：交付物是客户私有文件；此处只声明一次。
    cleanupExportRecords();
    const record = exportRecords.get(request.params.id);
    const gone = () =>
      reply.code(404).send({ error: "export_not_found", message: "Word 文件已过期，请重新点击下载" });
    if (!record) return gone();
    /**
     * 一次性缓冲用**同步占位**来保证：并发的两次取件只有一次能真读到字节，另一次 404
     * （会话校验是异步的，若等校验回来再删，两次并发会双双成功）。
     * 授权没通过时立刻释放占位——不能让别人拿一条链接把创建者自己的下载占掉。
     */
    if (record.claimed) return gone();
    record.claimed = true;
    const releaseClaim = () => {
      record.claimed = false;
    };
    /**
     * 两种取件方式：
     * ① 浏览器直链 `?t=<一次性令牌>`——手机/微信必须走这条（浏览器导航带不了 Authorization 头）；
     * ② 原来的会话 Bearer 头——保留给老前端与脚本，语义不变。
     *
     * QA-20260916-011：令牌只解决「导航请求带不了头」这一件事，不是「谁拿到链接都能取件」。
     * 只要这次请求**本身带了会话**，就必须继续走会话 + 租户 + 归属校验：同租户的同事拿着链接、
     * 别的租户的账号、已被停用的成员，都不能借令牌取走创建者的文件（停用/数据库异常同样拦在这里）。
     */
    const queryToken = (request.query as { t?: string } | undefined)?.t;
    const tokenOk = verifyExportDownloadToken(request.params.id, record.userId, queryToken);
    const presentedSession = getBearerToken(request.headers);
    if (!tokenOk || presentedSession) {
      const context = await resolveExportContext(request.headers, reply);
      if (!context) {
        releaseClaim();
        return;
      }
      if (record.tenantId !== context.tenantId) {
        releaseClaim();
        return reply.code(403).send({
          error: "export_tenant_forbidden",
          message: "当前文件不属于本经营主体"
        });
      }
      if (record.userId !== context.userId) {
        releaseClaim();
        return reply.code(404).send({ error: "export_not_found", message: "当前文件不可用，请重新导出自己的内容" });
      }
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
  const renderLine = (rawLine: string, sectionTitle: string): Paragraph | undefined => {
    // 去掉 markdown 标题符（## 视觉锤 这类无编号标题不能被 isSectionHeading 捕获，会原样带 # 进 Word）。
    const line = rawLine.replace(/^#{1,6}\s*/, "");
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
    if (isSectionHeading(line) || /^#{1,6}\s+/.test(line)) {
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
  // 1~6 级 markdown 标题符都要剥掉：之前只认 1~3 级，`#### 内容选题` 会残留一个 `#` 进 Word。
  return line.replace(/^#{1,6}\s*/, "").replace(/[*_]/g, "").trim();
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
