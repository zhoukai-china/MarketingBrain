import { useEffect, useState, type RefObject } from "react";
import type { ConsultantId, ChatMessage } from "../../types";
import { ipAcquisitionCapabilities, type IpAcquisitionCapability, type IpAcquisitionCapabilityId } from "../../data/ipAcquisitionAgent";
import { apiPath } from "../../lib/api";
import { getStoredMemory, normalizeFilenamePart } from "../../lib/utils";
import sitongAvatar from "../../assets/sitong-beauty.png";

interface ChatMessagesProps {
  messages: ChatMessage[];
  busy: boolean;
  thinkingStep?: string;
  currentConsultantId: ConsultantId;
  capabilityId?: IpAcquisitionCapabilityId;
  chatEndRef: RefObject<HTMLDivElement>;
  onQuickPrompt: (capability: IpAcquisitionCapability) => void;
}

interface ParsedSection {
  title: string;
  lines: string[];
}

interface TableRowData {
  label: string;
  value: string;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

type AnswerContentBlock = { type: "text"; lines: string[] } | { type: "table"; table: ParsedTable };

const fallbackTitle = "IP获客交付件";

export function ChatMessages({ messages, busy, thinkingStep, currentConsultantId, capabilityId, chatEndRef, onQuickPrompt }: ChatMessagesProps) {
  // Word 导出对所有智能体答案统一按次独立扣积分；按钮先说明价格，避免用户点完才知道扣费。
  const [docxPrice, setDocxPrice] = useState<number | null>(null);
  useEffect(() => {
    void fetch(apiPath("/exports/docx/price"))
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { credits?: number } | null) => {
        if (data && typeof data.credits === "number") setDocxPrice(data.credits);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="consultChatMessages"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      {messages.length === 0 && (
        <div className="consultWelcome">
          <img className="consultWelcomeAvatar" src={sitongAvatar} alt="思潼" />
          <div className="consultWelcomeBubble">
            <strong>你好，我是思潼，专门帮你做 IP 获客内容。</strong>
            <p>{emptyHintFor(currentConsultantId, capabilityId)}</p>
            <p>{inputHintFor(capabilityId)}</p>
            <div className="consultWelcomeChips">
              {ipAcquisitionCapabilities.map((capability) => (
                <button key={capability.id} onClick={() => onQuickPrompt(capability)}>
                  {capability.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <div key={msg.id} className={`consultMessage ${msg.role}`}>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              maxWidth: msg.role === "user" ? "80%" : "100%",
              marginLeft: msg.role === "user" ? "auto" : 0
            }}
          >
            {msg.role === "advisor" && <img className="consultMessageAvatar" src={sitongAvatar} alt="思潼" />}
            <div className={msg.role === "advisor" ? "consultMessageBody advisorBody" : "consultMessageBody"}>
              <div className={msg.role === "advisor" ? "consultBubble reportBubble" : "consultBubble userBubbleCompact"}>
                {msg.role === "advisor" ? <FormattedAnswer content={msg.content} /> : msg.content}
              </div>
              {msg.role === "advisor" && (
                <div className="messageDownloadBar" aria-label="下载交付件">
                  <button type="button" onClick={() => void downloadAnswerDocx(msg.content)}>
                    {`下载精美 Word${docxPrice ? ` · ${docxPrice} 积分` : ""}`}
                  </button>
                </div>
              )}
              <div className="consultMessageMeta">
                {msg.role === "advisor" ? "IP获客智能体" : "我"} · {formatTime(msg.createdAt)}
              </div>
            </div>
          </div>
        </div>
      ))}

      {busy && (
        <div className="consultMessage advisor">
          <div className="consultThinkingMessage">
            <img className="consultMessageAvatar" src={sitongAvatar} alt="思潼" />
            <div className="typingRow">
              <div className="generatingSpinner" />
              <span>{thinkingStep || "正在整理可直接使用的内容..."}</span>
            </div>
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}

function FormattedAnswer({ content }: { content: string }) {
  const { title, sections } = parseAnswer(content);
  if (sections.length === 0) return <div className="plainAnswer">{content}</div>;
  const summary = sections.find((section) => section.title === "短结论");
  const deliverySections = sections.filter((section) => section !== summary);

  return (
    <article className="formattedAnswer">
      <header>
          <span>思潼 IP 获客交付件</span>
          <h2>{title}</h2>
        <p>已整理成便于浏览和下载的交付格式。</p>
      </header>
      {summary && (
        <section className="answerExecutiveBlock">
          <span>短结论</span>
          <SectionContent section={summary} compact />
        </section>
      )}
      <div className="answerSectionStack">
        {deliverySections.map((section, index) => (
          <section key={section.title} className="answerSection">
            <div className="answerSectionHead">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{section.title}</h3>
            </div>
            <SectionContent section={section} />
          </section>
        ))}
      </div>
    </article>
  );
}

function SectionContent({ section, compact = false }: { section: ParsedSection; compact?: boolean }) {
  const blocks = splitSectionBlocks(section.lines);
  return (
    <div className={compact ? "answerBlockStack compact" : "answerBlockStack"}>
      {blocks.map((block, blockIndex) => {
        if (block.type === "table") {
          return <AnswerTable key={`table-${blockIndex}`} headers={block.table.headers} rows={block.table.rows} />;
        }

        const rows = parseColonRows(block.lines);
        if (!compact && rows.length > 0 && rows.some((row) => row.label !== "说明")) {
          return (
            <div key={`fields-${blockIndex}`} className="answerFieldList">
              {rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className={row.label === "说明" ? "answerFieldRow note" : "answerFieldRow"}>
                  {row.label !== "说明" && <span>{row.label}</span>}
                  <p>{cleanDisplayText(stripRepeatedSectionLabel(row.value, section.title))}</p>
                </div>
              ))}
            </div>
          );
        }

        return (
          <div key={`text-${blockIndex}`} className="answerParagraphs">
            {block.lines.map((line, index) => (
              <p key={`${line}-${index}`}>{cleanDisplayText(stripRepeatedSectionLabel(line, section.title))}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AnswerTable({ headers, rows }: ParsedTable) {
  return (
    <div className="answerTableWrap">
      <table className="answerTable">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row.join("-")}-${rowIndex}`}>
              {headers.map((_, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseAnswer(content: string): { title: string; sections: ParsedSection[] } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0];
  const title = firstLine && !isSectionHeading(firstLine) ? firstLine.replace(/^#+\s*/, "") : fallbackTitle;
  const bodyLines = firstLine && title === firstLine.replace(/^#+\s*/, "") ? lines.slice(1) : lines;
  const sections: ParsedSection[] = [];
  let current: ParsedSection | undefined;

  for (const line of bodyLines) {
    if (isSectionHeading(line)) {
      current = { title: cleanSectionTitle(line), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: "短结论", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }

  return {
    title,
    sections: sections.filter((section) => section.lines.length > 0)
  };
}

function isSectionHeading(line: string): boolean {
  return /^(#{2,3}\s*)?([一二三四五六七八九十]+、|\d+[.、])\S+/.test(line) || knownSectionTitles.has(cleanDisplayText(line));
}

function cleanSectionTitle(line: string): string {
  return line.replace(/^#{2,3}\s*/, "").replace(/^([一二三四五六七八九十]+、|\d+[.、])\s*/, "");
}

const knownSectionTitles = new Set([
  "短结论",
  "诊断结论",
  "数据/内容判断",
  "数据判断",
  "内容判断",
  "钩子复盘",
  "内容结构复盘",
  "画面节奏复盘",
  "转化点复盘",
  "下一条怎么改",
  "复盘指标",
  "镜头结构",
  "拍摄注意事项",
  "分镜脚本",
  "剪辑EDL",
  "字幕节奏",
  "封面标题",
  "发布前检查",
  "场景识别",
  "直播目标",
  "开播前检查",
  "主播口播稿",
  "运营配合动作",
  "合规提醒",
  "朋友圈策略",
  "今日朋友圈策略",
  "私聊承接话术",
  "发布节奏",
  "行业热点速览",
  "热点来源/线索",
  "热点判断",
  "IP获客机会",
  "可蹭选题",
  "短视频切入",
  "朋友圈切入",
  "直播切入",
  "风险提醒",
  "今日动作",
  "对标账号",
  "最新内容",
  "内容主题",
  "爆点结构",
  "可借鉴动作",
  "不适合照搬的风险",
  "下一步监控"
]);

function parseColonRows(lines: string[]): TableRowData[] {
  return lines.map((line) => {
    const match = line.match(/^([^：:]{1,22})[：:]\s*(.+)$/);
    if (!match) return { label: "说明", value: line };
    return { label: match[1], value: match[2] };
  });
}

function stripRepeatedSectionLabel(line: string, sectionTitle: string): string {
  return line === sectionTitle ? "" : line;
}

function parseMarkdownTable(lines: string[]): ParsedTable | undefined {
  const tableLines = lines.filter((line) => /^\|.+\|$/.test(line));
  return parseMarkdownTableLines(tableLines);
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

function isWideSection(title: string): boolean {
  return /脚本|剪辑|投流|复盘|评论|文案|朋友圈|直播/.test(title);
}

function cleanDisplayText(text: string): string {
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

async function downloadAnswerDocx(content: string): Promise<void> {
  try {
    const { title } = parseAnswer(content);
    const response = await fetch(apiPath("/exports/docx"), {
      method: "POST",
      headers: exportAuthHeaders(true),
      body: JSON.stringify({
        title: normalizeFilenamePart(title) || fallbackTitle,
        content
      })
    });
    const data = (await response.json().catch(() => ({}))) as { downloadUrl?: string; filename?: string; message?: string };
    if (!response.ok || !data.downloadUrl) {
      throw new Error(data.message || "Word 文件生成失败");
    }
    const fileResponse = await fetch(apiPath(data.downloadUrl), { headers: exportAuthHeaders(), cache: "no-store" });
    if (!fileResponse.ok) {
      throw new Error("Word 文件下载失败");
    }
    const blob = await fileResponse.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = data.filename || `${normalizeFilenamePart(title) || fallbackTitle}.docx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Word document generation failed", error);
    window.alert("Word 文件生成失败，请稍后再试。");
  }
}

function exportAuthHeaders(json = false): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("store_os_token") : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

function formatTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function emptyHintFor(id: ConsultantId, capabilityId?: IpAcquisitionCapabilityId): string {
  if (capabilityId === "topic_inspiration") return "点击后我会自动扫描四大来源，再通过目标用户兴趣、共识层级与客资精准度、账号阶段三关筛选TOP10选题。";
  if (capabilityId === "industry_hotspots") return "告诉我行业、区域和目标客户，我会整理近期热点、内容机会和今天能用的选题切入。";
  if (capabilityId === "shooting_editing") return "把视频、图片或文件传上来，我会只做拍摄、镜头、剪辑和发布前优化。";
  if (capabilityId === "content_nine_piece") return "我可以帮你生成内容九件套：选题、文案、脚本、拍摄、剪辑、发布和投流建议。";
  if (capabilityId === "paid_traffic") return "告诉我平台、转化目标、可承接地域、待投素材、自然数据和预算上限，我会先判断能不能投，再给小额测试和止损建议。";
  if (capabilityId === "video_review") return "上传视频后台导出的 CSV 或 Excel，我会逐行核对数据、分层作品并给下一轮选题测试方向。";
  if (capabilityId === "live_script") return "告诉我产品、直播目标和福利，我会写开场、留人、互动、转化和下播跟进话术。";
  if (capabilityId === "moments_private") return "告诉我产品、客户关系和成交目标，我会生成朋友圈内容和私聊承接话术。";
  if (id === "baolu_content_creator") return "我可以帮你生成内容九件套，也可以只做拍摄、剪辑和发布前优化。";
  if (id === "baolu_topics") return "我会自动扫描私有知识、行业热点、账号复盘和对标内容，经三关筛选生成TOP10选题。";
  if (id === "baolu_review_engine") return "上传视频后台导出的 CSV 或 Excel，我会逐行核对数据、分层作品并给下一轮选题测试方向。";
  if (id === "live_script_planner") return "告诉我产品、直播目标和福利，我会写开场、留人、互动、转化和下播跟进话术。";
  if (id === "moments_generator") return "告诉我产品、客户和成交目标，我会生成朋友圈内容和私聊承接话术。";
  return "首版只处理 IP获客相关的行业热点、内容生产、拍剪优化、视频数据复盘、直播话术和朋友圈私域。";
}

function inputHintFor(capabilityId?: IpAcquisitionCapabilityId): string {
  if (capabilityId === "industry_hotspots") return "请补充行业/品类、城市或区域、目标客户、重点平台和想转成的内容形式。";
  if (capabilityId === "live_script") return "请补充直播产品、价格/福利、目标客户、直播目标和需要的话术环节。";
  if (capabilityId === "moments_private") return "请补充你是谁、朋友圈里的人、主推产品、成交目标和希望的表达风格。";
  if (capabilityId === "video_review") return "请上传 CSV/Excel 数据文件，并说明优先想看播放、停留、互动、关注还是业务线索。";
  if (capabilityId === "shooting_editing") return "请补充视频目的、拍摄对象、出镜方式、已有文件、剪辑风格和发布平台。";
  if (capabilityId === "paid_traffic") return "请补充平台、目标、地域、素材自然数据、历史投放和预算上限；没有的数据可以写待补。";
  return "请补充产品/服务、目标客户、发布平台、目标动作、已有文件和想要输出。";
}
