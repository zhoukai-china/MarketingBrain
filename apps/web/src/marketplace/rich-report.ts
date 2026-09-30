/**
 * 生成结果 · 方案 C 结构化排版（2026-09-30 用户拍板「双栏速览工作台」）。
 *
 * 用户口径（2026-09-30）：**只改新版本的页面**——本模块只给新版工作台交付面板用
 * （CopyWorkbench 交付件等）；以前的页面（对话页 AgentChatPage 的 markdown 气泡、
 * 直播复盘 LivescriptWorkbench 专属渲染）一律不走这里。
 *
 * 切章规则：`#`/`##` 标题行、带序号的独立加粗行（`**一、选题策划**`）。
 * 章节体内的逐字稿时间轴行（`0-3秒` / `3–15 秒｜钩子`）**不切章**，渲染成章节内的
 * 时间轴行（.mdc-tl），目录只列真正的章。正文仍用 renderMarkdownHtml 转 HTML。
 * 桌面 ≥760px 左侧常驻目录 + 右侧章节卡；手机退化为单列卡片流。
 */
import { renderMarkdownHtml } from "./AgentChatPage.js";
import "../styles/rich-report.css";

let mdcSeq = 0;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TIME_RE = /^(\d{1,3}\s*[–—-]\s*\d{1,3}\s*秒)(?:\s*｜\s*(.*))?$/;

/** 章节序号提取：`一、` `1.` `第3章` → chip + 剩余标题。 */
function mdcChipOf(title: string): { chip: string; rest: string } {
  const m = /^(?:第\s*)?([零一二三四五六七八九十百0-9]{1,4})\s*[、.．:：]\s*(.*)$/.exec(title);
  const cleaned = (m ? m[2] : title).replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, "").trim();
  return { chip: m ? m[1] : "•", rest: cleaned || title };
}

/** 章节体里的逐字稿时间轴 + 独立标签行（加粗的「标题」「正文（60 秒口播）」这类）→ .mdc-tl 行。 */
function renderBodyWithTimeline(lines: string[]): string {
  const normal: string[] = [];
  const rows: Array<{ time: string; label: string; body: string[] }> = [];
  let curRow: { time: string; label: string; body: string[] } | null = null;
  for (const line of lines) {
    const t = line.trim();
    // 2026-09-30：模型输出的时间行/标签行常带 ** 加粗，识别前先剥掉
    const bare = t.replace(/^\*\*(.+)\*\*$/, "$1").trim();
    const tm = bare ? TIME_RE.exec(bare) : null;
    const loneBold = bare && !tm ? /^\*\*(.+?)\*\*$/.test(t) : false;
    if (tm) {
      curRow = { time: tm[1].replace(/\s+/g, ""), label: (tm[2] ?? "").trim(), body: [] };
      rows.push(curRow);
      continue;
    }
    if (loneBold && !/^(?:第\s*)?[零一二三四五六七八九十百0-9]{1,4}\s*[、.．:：]/.test(bare)) {
      // 无序号的独立加粗行 = 标签行（标题 / 正文（60 秒口播）…），也进时间轴式行
      curRow = { time: "", label: bare.replace(/\*\*/g, "").trim(), body: [] };
      rows.push(curRow);
      continue;
    }
    if (curRow && t) {
      curRow.body.push(line);
      continue;
    }
    if (curRow && !t) {
      // 空行暂不关闭时间轴（段间空行常见）
      curRow.body.push(line);
      continue;
    }
    normal.push(line);
  }
  const normalHtml = normal.some((l) => l.trim()) ? renderMarkdownHtml(normal.join("\n")) : "";
  const tlHtml = rows.length
    ? `<div class="mdc-tl">${rows.map((r) => `<div class="mdc-tl-r"><span class="mdc-tl-t">${escapeHtml(r.time || "•")}</span><div class="mdc-tl-c">${r.label ? `<em>${escapeHtml(r.label)}</em>` : ""}${renderMarkdownHtml(r.body.join("\n"))}</div></div>`).join("")}</div>`
    : "";
  return normalHtml + tlHtml;
}

export function renderRichReportHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const sections: Array<{ title: string; body: string[] }> = [];
  const pre: string[] = [];
  let cur: { title: string; body: string[] } | null = null;
  const headingOf = (t: string): string | null => {
    const h = /^#{1,2}\s+(.+)$/.exec(t);
    if (h) return h[1].trim();
    const bold = /^\*\*(.+?)\*\*\s*$/.exec(t);
    // 独立加粗行只有带序号才算章节（**0-3秒｜钩子** 这类是逐字稿时间轴，不切章）
    if (bold && /^(?:第\s*)?[零一二三四五六七八九十百0-9]{1,4}\s*[、.．:：]/.test(bold[1].trim())) return bold[1].trim();
    return null;
  };
  for (const line of lines) {
    const t = line.trim();
    const title = t ? headingOf(t) : null;
    if (title) {
      cur = { title, body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      pre.push(line);
    }
  }
  if (sections.length === 0) {
    // 无章节（如轻量件「可直发文案」：标题/正文/0-3秒…）：正文 + 时间轴行直接铺
    return renderBodyWithTimeline(lines);
  }
  const id = `mdc${++mdcSeq}`;
  const secHtml = sections.map((s, idx) => {
    const { chip, rest } = mdcChipOf(s.title);
    const head = `<div class="mdc-sec-h"><i>${escapeHtml(chip)}</i>${rest ? `<b>${escapeHtml(rest)}</b>` : ""}</div>`;
    return `<section class="mdc-sec" id="${id}-s${idx}">${head}${renderBodyWithTimeline(s.body)}</section>`;
  }).join("");
  const toc = sections.length >= 3
    ? `<aside class="mdc-side"><b>本篇结构</b><nav>${sections.map((s, idx) => `<a href="#${id}-s${idx}">${escapeHtml(s.title)}</a>`).join("")}</nav></aside>`
    : "";
  const preHtml = pre.some((l) => l.trim()) ? `<section class="mdc-sec mdc-lead">${renderMarkdownHtml(pre.join("\n"))}</section>` : "";
  return `<div class="mdc">${toc}<div class="mdc-main">${preHtml}${secHtml}</div></div>`;
}
