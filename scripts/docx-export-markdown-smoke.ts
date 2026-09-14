/**
 * 交付件 Word 导出的 markdown 残留契约（QA-20260914-002）。
 *
 * 现场：IP 定位智能体交付内容里的 markdown 标题写成 `## 视觉锤` / `## 声音钉`
 * （无「一、」「1.」编号），`isSectionHeading()` 只认编号标题，于是这两行被当成
 * 正文丢进 renderLine，Word 里直接出现 `## 视觉锤`。
 *
 * 这里不解压到 Word/PDF 渲染，而是直接对生成的 OOXML（word/document.xml）断言，
 * 因为「markdown 标记有没有漏进正文」是纯结构事实，不需要像素级渲染：
 *   ① 整篇正文的 `<w:t>` 文本里不允许再出现 `#`（标题符必须被剥干净）；
 *   ② 无编号标题要升级成真正的章节标题（`02  视觉锤`），不能降级成正文；
 *   ③ 章节顺序与内容不能被剥标记的动作打乱或丢失；
 *   ④ 4~6 级 markdown 标题（`#### 四级标题`）同样不允许漏 `#`。
 */
import zlib from "node:zlib";
import { buildAnswerDocx } from "../apps/api/src/routes/exports.js";
import type { TenantBrandingConfig } from "@baolu/shared";

let failures = 0;
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

/** 只读 word/document.xml，不需要完整 unzip 实现（docx 内部是标准 deflate zip）。 */
function readZipEntry(buf: Buffer, name: string): Buffer {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("end of central directory not found");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory header");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const entryName = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip entry not found: ${name}`);
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 按段落还原正文文本（一个段落可能被拆成多个 `<w:t>` run）。 */
function paragraphTexts(documentXml: string): string[] {
  return documentXml
    .split(/<w:p[ >]/)
    .slice(1)
    .map((paragraph) => {
      const runs = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1]));
      return runs.join("");
    });
}

const branding: TenantBrandingConfig = {
  brandName: "思潼 AI 增长 OS",
  systemName: "思潼 AI 增长 OS",
  primaryColor: "#1B2430",
  loginHeadline: "登录思潼 AI 增长 OS",
  loginDescription: "用一句话拿到可落地的下一步",
  exportFooter: "思潼 AI 增长 OS 提供技术支持",
  isCustomized: false
};

// 复刻 IP 定位智能体的真实交付结构：编号标题 + 无编号标题 + 4 级标题 + 表格。
const content = [
  "# IP 定位全案（示例交付）",
  "一句话定位：本地连锁门店老板要的是可落地的下一步。",
  "",
  "## 一、一句话定位",
  "你是当地连锁门店的创始人，最擅长把复杂的事情做成标准动作。",
  "",
  "## 视觉锤",
  "视觉锤（一眼认出你）：门店里那台总在擦拭的设备，就是你的记忆符号。",
  "",
  "## 声音钉",
  "声音钉（一耳朵听出你）：我是老周，干了 10 年，说点实话。",
  "",
  "## 二、目标用户",
  "30-45 岁、怕踩坑、想省心的本地客人。",
  "",
  "#### 内容选题",
  "每周三条：门店日常 / 客户问答 / 老板手记。"
].join("\n");

async function main(): Promise<void> {
  const buffer = await buildAnswerDocx(content, "IP定位智能体交付样例", branding);
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const paragraphs = paragraphTexts(xml);
  const wholeText = paragraphs.join("\n");

  record("生成 docx 且能读到 word/document.xml", xml.length > 0, `document.xml=${xml.length}B`);

  const hashResidue = paragraphs.filter((paragraph) => paragraph.includes("#"));
  record(
    "正文段落里零 `#` 残留（markdown 标题符已剥离）",
    hashResidue.length === 0,
    hashResidue.length ? `残留段落=${JSON.stringify(hashResidue.slice(0, 4))}` : ""
  );

  const hasHeading = (expected: string) => paragraphs.some((paragraph) => paragraph.replace(/\s+/g, " ").trim() === expected);
  record("无编号 `## 视觉锤` 升级为章节标题 02 视觉锤", hasHeading("02 视觉锤"));
  record("无编号 `## 声音钉` 升级为章节标题 03 声音钉", hasHeading("03 声音钉"));
  record("编号 `## 一、一句话定位` → 01 一句话定位", hasHeading("01 一句话定位"));
  record("编号 `## 二、目标用户` → 04 目标用户", hasHeading("04 目标用户"));
  record("4 级标题 `#### 内容选题` → 05 内容选题", hasHeading("05 内容选题"));

  const order = ["01 一句话定位", "02 视觉锤", "03 声音钉", "04 目标用户", "05 内容选题"].map((title) =>
    wholeText.search(new RegExp(title.replace(/\s/g, "\\s+")))
  );
  record("章节顺序未被剥标记动作打乱", order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])), `positions=${order.join(",")}`);

  record("正文内容未丢失（视觉锤正文与选题正文仍在）", wholeText.includes("一眼认出你") && wholeText.includes("门店日常"));
  record("段内标签仍走字段排版（视觉锤：… 被拆成标签+值）", wholeText.includes("视觉锤（一眼认出你）"));

  console.log(`\n${results.filter((item) => item.ok).length} passed / ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("CRASH", error);
  process.exitCode = 1;
});
