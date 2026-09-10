// IP 定位全案（ip-pos）结构化渲染。
// 契约：CODEX-IP定位智能体-样例输出.md §8 —— 顶部不折叠的 1 分钟速览、章节卡片、
// 选题四类 Tab 带「已生成 N / 需 ≥M」、主页四件套可抄卡片（签名档 4 行 + 一键复制）、
// 口播正例单独导出 TXT、空值显示「—」。
import { useState } from "react";

export interface IpPosPayload {
  meta: { brand: string; industry: string; goal: string; generatedAt: string };
  overview: {
    project: string;
    user: string;
    persona: string;
    archetype: string;
    ip_status: string;
    content_focus: string;
    platform: string;
    month_actions: string;
  };
  stats: {
    topic_total: number;
    by_type: { trust: number; cognitive: number; connection: number; conversion: number };
  };
  validation: { passed: boolean; errors: Array<{ code: string; field: string; message: string }> };
  homepage?: { nickname: string; avatar: string; bio: string[]; banner: string };
  tone?: { positive: string; negative: string };
  topics: {
    trust: string[];
    cognitive: string[];
    connection: string[];
    conversion: string[];
    top10: string[];
    calendar30: string[];
  };
  sections?: Record<string, string>;
}

type TopicKey = "trust" | "cognitive" | "connection" | "conversion";

const DASH = "—";

const OVERVIEW_ROWS: Array<[string, keyof IpPosPayload["overview"]]> = [
  ["项目定位", "project"],
  ["核心用户", "user"],
  ["IP人设", "persona"],
  ["IP原型", "archetype"],
  ["当前IP状态", "ip_status"],
  ["内容重心", "content_focus"],
  ["首选平台", "platform"],
  ["第一个月核心动作", "month_actions"]
];

const TOPIC_TABS: Array<{ key: TopicKey; label: string; min: number }> = [
  { key: "trust", label: "信任型", min: 22 },
  { key: "cognitive", label: "认知型", min: 22 },
  { key: "connection", label: "连接型", min: 22 },
  { key: "conversion", label: "转化型", min: 14 }
];

const CHAPTERS: Array<{ key: string; label: string }> = [
  { key: "positioning", label: "一、项目定位" },
  { key: "user", label: "二、目标用户定位" },
  { key: "ip", label: "三、IP人设定位" },
  { key: "content", label: "四、内容定位" },
  { key: "topics", label: "五、选题方向" },
  { key: "ads", label: "六、投流建议" },
  { key: "growth", label: "七、IP发展规划" },
  { key: "execution", label: "八、执行建议" }
];

function dash(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  if (!text || text === "-" || text === DASH || text === "待补充") return DASH;
  return text;
}

/**
 * 摘掉指定小节（含其子标题），用于把「主页四件套 / 语言风格 / 四类选题清单」
 * 从原始 Markdown 里拿掉，改由专门卡片渲染，避免同一内容出现两次。
 */
function stripSubSections(section: string, isTarget: (title: string) => boolean): string {
  const lines = section.split(/\r?\n/);
  const out: string[] = [];
  let skipLevel = 0;
  for (const line of lines) {
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skipLevel && level > skipLevel) continue;
      skipLevel = 0;
      if (isTarget(heading[2].trim())) {
        skipLevel = level;
        continue;
      }
      out.push(line);
      continue;
    }
    if (skipLevel) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 签名档 4 行去掉「第N行（标签）：」脚手架，只留可粘贴正文。 */
export function ipPosBioLines(payload: IpPosPayload): string[] {
  return (payload.homepage?.bio ?? [])
    .map((line) =>
      line
        .replace(/^第\s*[1-4一二三四]\s*行\s*(?:[（(][^）)]*[）)])?\s*[：:]\s*/, "")
        .replace(/[*`]/g, "")
        .trim()
    )
    .filter(Boolean);
}

/** 口播正例 TXT 内容（契约 §8.5：口播正例单独导出 TXT）。 */
export function ipPosToneTxt(payload: IpPosPayload): string {
  const brand = dash(payload.meta?.brand);
  return [
    "口播语言正例 · 可直接照读",
    brand === DASH ? "" : `品牌：${brand}`,
    "",
    dash(payload.tone?.positive),
    ""
  ]
    .filter((line, index) => !(index === 1 && line === ""))
    .join("\n");
}

export function downloadTextFile(filename: string, content: string): void {
  // BOM：保证 Windows 记事本 / 微信打开 TXT 不乱码。
  const blob = new Blob([`\uFEFF${content}`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    ok ? resolve() : reject(new Error("copy_failed"));
  });
}

export function IpPosReport({
  payload,
  renderMarkdown
}: {
  payload: IpPosPayload;
  renderMarkdown: (markdown: string) => string;
}) {
  const [tab, setTab] = useState<TopicKey>("trust");
  const [copied, setCopied] = useState("");

  const bioLines = ipPosBioLines(payload);
  const sections = payload.sections ?? {};
  const chapterBody = (key: string, isTarget?: (title: string) => boolean): string => {
    const raw = sections[key] ?? "";
    return isTarget ? stripSubSections(raw, isTarget) : raw;
  };
  const chapterCards = CHAPTERS.map((chapter) => {
    if (chapter.key === "topics") return null;
    const targets: Record<string, (title: string) => boolean> = {
      ip: (title) => /主页四件套/.test(title) || /语言风格/.test(title)
    };
    const body = chapterBody(chapter.key, targets[chapter.key]);
    if (!body.trim()) return null;
    return (
      <div className="chat-report" key={chapter.key}>
        <div className="cr-head">📄 {chapter.label}</div>
        <div
          className="cr-sec md-rich"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
        />
      </div>
    );
  });

  const activeTab = TOPIC_TABS.find((item) => item.key === tab) ?? TOPIC_TABS[0];
  const topicItems = payload.topics?.[activeTab.key] ?? [];
  const restTopics = stripSubSections(
    sections.topics ?? "",
    (title) => /选题/.test(title) && /信任型|认知型|连接型|转化型/.test(title)
  );

  async function copy(text: string, tag: string) {
    try {
      await copyToClipboard(text);
      setCopied(tag);
      window.setTimeout(() => setCopied((current) => (current === tag ? "" : current)), 2000);
    } catch {
      setCopied("");
    }
  }

  return (
    <div className="ipr">
      {payload.validation && !payload.validation.passed && (
        <div className="chat-report ipr-invalid">
          <div className="cr-head">⚠️ 本次交付未通过技能校验（未扣积分）</div>
          <ul className="cr-list">
            {payload.validation.errors.slice(0, 10).map((error, index) => (
              <li key={`${error.code}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="chat-report ipr-overview">
        <div className="cr-head">📌 1分钟速览</div>
        <table className="report-table ipr-overview-table">
          <tbody>
            {OVERVIEW_ROWS.map(([label, key]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{dash(payload.overview?.[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chapterCards[0]}
      {chapterCards[1]}
      {chapterCards[2]}

      <div className="chat-report">
        <div className="cr-head">🏠 主页四件套 · 可直接抄</div>
        <div className="cr-sec">
          <div className="ipr-home-grid">
            <div className="ipr-home-item">
              <span>昵称</span>
              <b>{dash(payload.homepage?.nickname)}</b>
              <button className="ipr-copy" onClick={() => void copy(dash(payload.homepage?.nickname), "nickname")}>
                {copied === "nickname" ? "已复制" : "复制"}
              </button>
            </div>
            <div className="ipr-home-item">
              <span>头像</span>
              <b>{dash(payload.homepage?.avatar)}</b>
            </div>
            <div className="ipr-home-item">
              <span>背景图</span>
              <b>{dash(payload.homepage?.banner)}</b>
            </div>
          </div>
          <div className="cr-sub-h">
            签名档（4 行）
            <button
              className="ipr-copy"
              disabled={bioLines.length === 0}
              onClick={() => void copy(bioLines.join("\n"), "bio")}
            >
              {copied === "bio" ? "已复制" : "一键复制"}
            </button>
          </div>
          {bioLines.length > 0 ? (
            <ol className="ipr-bio-lines">
              {bioLines.map((line, index) => (
                <li key={index}>
                  <i>{index + 1}</i>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="copy-box">{DASH}</div>
          )}
        </div>
      </div>

      <div className="chat-report">
        <div className="cr-head">🗣 语言风格 · 能直接照读</div>
        <div className="cr-sec">
          <div className="cr-sub-h">正例（照读）</div>
          <div className="copy-box">{dash(payload.tone?.positive)}</div>
          <div className="cr-sub-h">反例（用户会划走的原因）</div>
          <div className="copy-box ipr-muted">{dash(payload.tone?.negative)}</div>
          {payload.tone?.positive && (
            <button
              className="btn ghost sm ipr-txt"
              onClick={() =>
                downloadTextFile(
                  `${dash(payload.meta?.brand) === DASH ? "IP定位" : dash(payload.meta?.brand)}-口播正例.txt`,
                  ipPosToneTxt(payload)
                )
              }
            >
              ⬇ 口播正例导出 TXT
            </button>
          )}
        </div>
      </div>

      {chapterCards[3]}

      <div className="chat-report">
        <div className="cr-head">💡 五、选题方向</div>
        <div className="cr-sec">
          <div className="ipr-tabs" role="tablist">
            {TOPIC_TABS.map((item) => {
              const count = payload.stats?.by_type?.[item.key] ?? payload.topics?.[item.key]?.length ?? 0;
              const ok = count >= item.min;
              return (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`ipr-tab${tab === item.key ? " on" : ""}${ok ? "" : " bad"}`}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                  <b>
                    已生成 {count} / 需 ≥{item.min}
                  </b>
                  {ok ? "" : " ⚠"}
                </button>
              );
            })}
          </div>
          <div className="ipr-topic-meta">
            四类合计 <b>{payload.stats?.topic_total ?? 0}</b> 条 · 门槛 ≥80 条
            {payload.stats?.topic_total >= 80 ? " ✅" : " ⚠ 未达标"}
          </div>
          <ul className="cr-list ipr-topics">
            {topicItems.length > 0 ? (
              topicItems.map((item, index) => <li key={index}>{item}</li>)
            ) : (
              <li>{DASH}</li>
            )}
          </ul>
        </div>
        {restTopics && (
          <div
            className="cr-sec md-rich"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(restTopics) }}
          />
        )}
      </div>

      {chapterCards[5]}
      {chapterCards[6]}
      {chapterCards[7]}
    </div>
  );
}
