// IP 定位全案（ip-pos）结构化渲染。
// 契约：CODEX-IP定位智能体-样例输出.md §8 —— 顶部不折叠的 1 分钟速览、章节卡片、
// 选题四类 Tab 带「已生成 N / 需 ≥M」、主页四件套可抄卡片（签名档 4 行 + 一键复制）、
// 口播正例单独导出 TXT、空值显示「—」。
import { Fragment, useState, type ReactNode } from "react";

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

/**
 * 交付分组 tab（2026-09-27 用户拍板，对齐原型 renderDeliverables）：
 * 全部 / 速览区 / 定位区 / 人设区 / 内容区 / 增长区，点击筛选显示对应分区章节。
 * 计数沿用「9 件 · 速览 + 8 章」产品口径：主页四件套、语言风格是第三章的展开卡，
 * 归入人设区随章显示，不单独计数。
 */
type ReportGroup = "ov" | "pos" | "per" | "con" | "gro";

/** 原型分区配色（docs/prototypes 的 GCOLOR / GSOFT），结果卡头与标签共用。 */
const GROUP_COLOR: Record<ReportGroup, string> = {
  ov: "#E8651A",
  pos: "#2563eb",
  per: "#7c3aed",
  con: "#0f8a5f",
  gro: "#b26a00"
};
const GROUP_SOFT: Record<ReportGroup, string> = {
  ov: "#fdeee2",
  pos: "#e8effd",
  per: "#f1eafd",
  con: "#e6f5ee",
  gro: "#fff4e0"
};
const GROUP_LABEL: Record<ReportGroup, string> = {
  ov: "速览区",
  pos: "定位区",
  per: "人设区",
  con: "内容区",
  gro: "增长区"
};

/** 八章的卡片头元数据：序号徽标 + 所属分区（对齐原型 PIECES 的 no / g / gt）。 */
const CHAPTER_META: Record<string, { no: string; group: ReportGroup }> = {
  positioning: { no: "一", group: "pos" },
  user: { no: "二", group: "pos" },
  ip: { no: "三", group: "per" },
  content: { no: "四", group: "con" },
  topics: { no: "五", group: "con" },
  ads: { no: "六", group: "gro" },
  growth: { no: "七", group: "gro" },
  execution: { no: "八", group: "gro" }
};

const GROUP_TABS: Array<{ key: "all" | ReportGroup; name: string; count: number }> = [
  { key: "all", name: "全部", count: 9 },
  { key: "ov", name: "📌 速览区", count: 1 },
  { key: "pos", name: "🎯 定位区", count: 2 },
  { key: "per", name: "🧑 人设区", count: 1 },
  { key: "con", name: "✍️ 内容区", count: 2 },
  { key: "gro", name: "🚀 增长区", count: 3 }
];

/**
 * 把 LLM 产出的章节 Markdown 规整成原型 .pc .c 的形态，再交给通用渲染器：
 * - 去掉正文首行的「## 一、项目定位」章节标题（卡片头已显示，避免重复）；
 * - 剥掉小节标题的「3.1 / 3.1.2」序号前缀（原型用干净的 h4）；
 * - #### 子标题统一降级成 ###，避免被当成裸段落露出「####」；
 * - 模型偶发的「• / ·」伪列表还原成「- 列表」，否则 **粗体** 会露馅。
 */
function preprocessIpPosMd(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let droppedTitle = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    // 章节标题（## / # 一级二级）作为卡片头已显示，正文里去掉首条
    if (!droppedTitle && /^#{1,2}\s+/.test(trimmed)) {
      droppedTitle = true;
      continue;
    }
    // 任意层级标题 → ###，并剥掉 N.M 序号前缀（3.1 / 3.1.2 / 三、 都剥）
    const heading = /^(#{3,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const title = heading[2].replace(/^(?:\d+[.、]?\s*)+/, "");
      out.push(`### ${title}`);
      continue;
    }
    // 伪列表还原
    if (/^[•·▪◦‣]\s+/.test(trimmed)) {
      out.push(line.replace(/^[•·▪◦‣]\s+/, "- "));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

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
  /** 交付分组筛选：all = 全部；其余按分区显示（2026-09-27 对齐原型）。 */
  const [group, setGroup] = useState<"all" | ReportGroup>("all");

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
    const raw = chapterBody(chapter.key, targets[chapter.key]);
    if (!raw.trim()) return null;
    const body = preprocessIpPosMd(raw);
    const meta = CHAPTER_META[chapter.key];
    const title = chapter.label.replace(/^[^、]+、/, "");
    return (
      <div className="chat-report" key={chapter.key}>
        <div className="cr-head ipr-ch-head">
          {meta && (
            <span className="ipr-no" style={{ background: GROUP_COLOR[meta.group] }}>
              {meta.no}
            </span>
          )}
          <b>{title}</b>
          {meta && (
            <span
              className="ipr-gtag"
              style={{ color: GROUP_COLOR[meta.group], background: GROUP_SOFT[meta.group] }}
            >
              {GROUP_LABEL[meta.group]}
            </span>
          )}
          {/* hero 承诺「每章可一键复制」：复制剥好的 Markdown 正文，贴到 Word/微信不掉格式。 */}
          <button
            className="ipr-copy"
            style={{ marginLeft: "auto" }}
            onClick={() => void copy(body, `ch-${chapter.key}`)}
          >
            {copied === `ch-${chapter.key}` ? "已复制" : "⧉ 复制本件"}
          </button>
        </div>
        <div
          className="cr-sec md-rich"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
        />
      </div>
    );
  });

  const activeTab = TOPIC_TABS.find((item) => item.key === tab) ?? TOPIC_TABS[0];
  const topicItems = payload.topics?.[activeTab.key] ?? [];
  const restTopics = preprocessIpPosMd(
    stripSubSections(
      sections.topics ?? "",
      (title) => /选题/.test(title) && /信任型|认知型|连接型|转化型/.test(title)
    )
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

  /** 全部交付卡按分区归组（主页四件套 / 语言风格是人设区第三章的展开卡，随章显示不单独计数）。 */
  const groupedCards: Array<{ key: string; group: ReportGroup; node: ReactNode }> = [
    {
      key: "overview",
      group: "ov",
      node: (
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
      )
    },
    { key: "ch-positioning", group: "pos", node: chapterCards[0] },
    { key: "ch-user", group: "pos", node: chapterCards[1] },
    { key: "ch-ip", group: "per", node: chapterCards[2] },
    {
      key: "homepage",
      group: "per",
      node: (
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
      )
    },
    {
      key: "tone",
      group: "per",
      node: (
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
      )
    },
    { key: "ch-content", group: "con", node: chapterCards[3] },
    {
      key: "topics",
      group: "con",
      node: (
        <div className="chat-report">
          <div className="cr-head ipr-ch-head">
            <span className="ipr-no" style={{ background: GROUP_COLOR.con }}>五</span>
            <b>选题方向</b>
            <span className="ipr-gtag" style={{ color: GROUP_COLOR.con, background: GROUP_SOFT.con }}>
              {GROUP_LABEL.con}
            </span>
            <button
              className="ipr-copy"
              style={{ marginLeft: "auto" }}
              onClick={() => void copy(restTopics, "ch-topics")}
            >
              {copied === "ch-topics" ? "已复制" : "⧉ 复制本件"}
            </button>
          </div>
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
      )
    },
    { key: "ch-ads", group: "gro", node: chapterCards[5] },
    { key: "ch-growth", group: "gro", node: chapterCards[6] },
    { key: "ch-execution", group: "gro", node: chapterCards[7] }
  ];
  const visibleCards = groupedCards.filter((card) => group === "all" || card.group === group);

  return (
    <div className="ipr">
      {payload.validation && !payload.validation.passed && (
        <div className="chat-report ipr-invalid">
          <div className="cr-head">⚠️ 本次交付未通过技能校验（不消耗算力）</div>
          <ul className="cr-list">
            {payload.validation.errors.slice(0, 10).map((error, index) => (
              <li key={`${error.code}-${index}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 分组 tab（对齐原型）：全部 / 速览区 / 定位区 / 人设区 / 内容区 / 增长区，点击筛选章节 */}
      <div className="ipr-gtabs" role="tablist">
        {GROUP_TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={group === item.key}
            className={`ipr-gtab${group === item.key ? " on" : ""}`}
            onClick={() => setGroup(item.key)}
          >
            {item.name} <span className="n">{item.count}</span>
          </button>
        ))}
      </div>

      {visibleCards.map((card) => (
        <Fragment key={card.key}>{card.node}</Fragment>
      ))}
    </div>
  );
}
