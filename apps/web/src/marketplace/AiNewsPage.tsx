import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

/**
 * AI 资讯页（/agents/ai-news）——落地自 docs/prototypes/ai-news-demo-20261006.html。
 *
 * 接口（apps/api/src/routes/ai-news.ts）：
 * - GET  /ai-news              资讯列表（type/cat 过滤 + limit 分页）
 * - GET  /ai-news/hero         置顶「思潼解读」（refresh=1 触发大模型重写）
 * - POST /ai-news/:id/interpret 单条「思潼解读」现场生成
 * - POST /ai-news/:id/ask      「问思潼」针对单条资讯提问
 *
 * 卡片默认展示编辑审校稿（seed insight）；大模型生成的文案带「AI 现场解读」徽标。
 */

type AiNewsType = "case" | "ind";

interface AiNewsItem {
  id: string;
  type: AiNewsType;
  cat: string;
  color: string;
  src: string;
  time: string;
  title: string;
  summary: string;
  tags: string[];
  tagColor?: "" | "blue" | "green" | "purple";
  insight: string;
  cta: string;
  ctaHref: string;
  hot?: boolean;
}

interface AiNewsHero {
  title: string;
  summary: string;
  meaning: string;
}

interface ListResponse {
  updatedAt: string;
  total: number;
  items: AiNewsItem[];
}

const FILTERS: Array<{ k: string; label: string }> = [
  { k: "all", label: "全部" },
  { k: "case", label: "改造案例" },
  { k: "ind", label: "行业动态" },
  { k: "零售电商", label: "零售电商" },
  { k: "餐饮连锁", label: "餐饮连锁" },
  { k: "美业", label: "美业" },
  { k: "制造", label: "制造" },
  { k: "出行酒旅", label: "出行酒旅" }
];

const FIRST_PAGE = 10;
const PAGE_STEP = 4;
const FAV_STORAGE_KEY = "an_favs";

type InterpretState =
  | { phase: "editor" }
  | { phase: "loading" }
  | { phase: "ai"; text: string }
  | { phase: "failed"; message: string };

interface AskTurn { role: "user" | "sitong"; text: string }

function readFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function AiNewsPage() {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(FIRST_PAGE);
  const [items, setItems] = useState<AiNewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("今日 08:00 更新");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [hero, setHero] = useState<AiNewsHero | null>(null);
  const [heroSource, setHeroSource] = useState<"llm" | "cache" | "editor">("editor");
  const [heroRefreshing, setHeroRefreshing] = useState(false);

  const [interpret, setInterpret] = useState<Record<string, InterpretState>>({});
  const [asks, setAsks] = useState<Record<string, AskTurn[]>>({});
  const [askDrafts, setAskDrafts] = useState<Record<string, string>>({});
  const [askPending, setAskPending] = useState<Record<string, boolean>>({});
  const [askOpen, setAskOpen] = useState<Record<string, boolean>>({});
  const [favs, setFavs] = useState<string[]>(readFavs);

  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    const params = new URLSearchParams({ limit: String(limit), offset: "0" });
    if (filter === "case" || filter === "ind") params.set("type", filter);
    else if (filter !== "all") params.set("cat", filter);
    fetch(apiPath(`/ai-news?${params.toString()}`))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ListResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
        setUpdatedAt(data.updatedAt);
        setListLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setListError("资讯加载失败，请下拉重试");
        setListLoading(false);
      });
    return () => { cancelled = true; };
  }, [filter, limit]);

  useEffect(() => {
    let cancelled = false;
    fetch(apiPath("/ai-news/hero"))
      .then(async (response) => (await response.json()) as { source: typeof heroSource; hero: AiNewsHero })
      .then((data) => {
        if (cancelled) return;
        setHero(data.hero);
        setHeroSource(data.source);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function pickFilter(next: string) {
    if (next === filter) return;
    setFilter(next);
    setLimit(FIRST_PAGE);
  }

  function loadMore() {
    if (limit >= total) {
      showToast("明日 08:00 自动更新，敬请期待");
      return;
    }
    setLimit(limit + PAGE_STEP);
  }

  async function refreshHero() {
    setHeroRefreshing(true);
    try {
      const response = await fetch(apiPath("/ai-news/hero?refresh=1"));
      const data = await response.json() as { source: typeof heroSource; hero?: AiNewsHero; message?: string };
      if (!response.ok || !data.hero) {
        showToast(data.message ?? "AI 解读暂时不可用，稍后再试");
        return;
      }
      setHero(data.hero);
      setHeroSource(data.source);
      showToast(data.source === "editor" ? "AI 暂时离线，先看编辑解读" : "思潼解读已更新");
    } catch {
      showToast("网络不给力，稍后再试");
    } finally {
      setHeroRefreshing(false);
    }
  }

  async function generateInterpret(item: AiNewsItem) {
    setInterpret((prev) => ({ ...prev, [item.id]: { phase: "loading" } }));
    try {
      const response = await fetch(apiPath(`/ai-news/${encodeURIComponent(item.id)}/interpret`), { method: "POST" });
      const data = await response.json() as { interpretation?: string; message?: string };
      if (!response.ok || !data.interpretation) {
        setInterpret((prev) => ({ ...prev, [item.id]: { phase: "failed", message: data.message ?? "AI 解读暂时不可用" } }));
        return;
      }
      setInterpret((prev) => ({ ...prev, [item.id]: { phase: "ai", text: data.interpretation! } }));
    } catch {
      setInterpret((prev) => ({ ...prev, [item.id]: { phase: "failed", message: "网络不给力，稍后再试" } }));
    }
  }

  async function sendAsk(item: AiNewsItem) {
    const question = (askDrafts[item.id] ?? "").trim();
    if (question.length < 2) {
      showToast("问题至少写 2 个字");
      return;
    }
    setAskPending((prev) => ({ ...prev, [item.id]: true }));
    setAsks((prev) => ({ ...prev, [item.id]: [...(prev[item.id] ?? []), { role: "user", text: question }] }));
    setAskDrafts((prev) => ({ ...prev, [item.id]: "" }));
    try {
      const response = await fetch(apiPath(`/ai-news/${encodeURIComponent(item.id)}/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await response.json() as { answer?: string; message?: string };
      setAsks((prev) => ({
        ...prev,
        [item.id]: [...(prev[item.id] ?? []), { role: "sitong", text: data.answer ?? data.message ?? "思潼暂时离线，稍后再问一次。" }]
      }));
    } catch {
      setAsks((prev) => ({ ...prev, [item.id]: [...(prev[item.id] ?? []), { role: "sitong", text: "网络不给力，稍后再问一次。" }] }));
    } finally {
      setAskPending((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  function toggleFav(id: string) {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
      try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next)); } catch { /* 隐私模式写不进也不影响浏览 */ }
      return next;
    });
    if (!favs.includes(id)) showToast("已收藏 · 正式版将推送到你的微信");
  }

  return (
    <div className="an-page">
      <header className="an-top">
        <a className="an-back" href={getAppPath("/agents")} aria-label="返回商城">‹</a>
        <div className="an-tt">AI资讯</div>
        <div className="an-upd">{updatedAt}</div>
      </header>

      <div className="an-strip"><span className="an-dot" />每日 08:00 自动抓取全网 AI 要闻 · AI 摘要 + 思潼解读</div>

      <section className="an-hero">
        <div className="an-hero-tag">
          思潼解读 · 置顶
          <button
            type="button"
            className="an-hero-refresh"
            onClick={() => void refreshHero()}
            disabled={heroRefreshing}
          >
            {heroRefreshing ? "思潼解读中…" : "AI 重写一版"}
          </button>
        </div>
        <h1>{hero?.title ?? "正在生成今日置顶解读…"}</h1>
        <p>{hero?.summary ?? ""}</p>
        {hero && (
          <div className="an-hero-in">
            <b>💡 对企业意味着什么</b>
            <span>{hero.meaning}</span>
          </div>
        )}
        <a className="an-hero-btn" href={getAppPath("/agents")}>去商城 · 找你的第一个 AI 员工 ›</a>
      </section>

      <nav className="an-chips" aria-label="资讯筛选">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            type="button"
            className={`an-chip${f.k === filter ? " act" : ""}`}
            onClick={() => pickFilter(f.k)}
          >
            {f.label}
          </button>
        ))}
      </nav>

      <main className="an-list">
        {listLoading && items.length === 0 && (
          <div className="an-card"><p className="an-sum">资讯加载中…</p></div>
        )}
        {listError && items.length === 0 && (
          <div className="an-card"><p className="an-sum">{listError}</p></div>
        )}
        {!listLoading && !listError && items.length === 0 && (
          <div className="an-card"><p className="an-sum">这个分类暂时没有资讯，先看看其他分类吧～</p></div>
        )}
        {items.map((item) => {
          const state = interpret[item.id] ?? { phase: "editor" as const };
          const insightText = state.phase === "ai" ? state.text : item.insight;
          return (
            <article className="an-card" key={item.id}>
              <div className="an-meta">
                <span className="an-src">{item.src}</span>
                <span className="an-cat"><i style={{ background: item.color }} />{item.cat}</span>
                <span className="an-cd">{item.time}</span>
              </div>
              <h2>{item.title}</h2>
              <p className="an-sum">{item.summary}</p>
              <div className="an-tags">
                {item.tags.map((tag) => (
                  <span className={`an-tag${item.tagColor ? ` ${item.tagColor}` : ""}`} key={tag}>{tag}</span>
                ))}
              </div>
              <div className="an-insight">
                <b>
                  💡 {state.phase === "ai" ? "思潼解读 · AI 现场生成" : "思潼解读"}
                  {state.phase === "ai" && <span className="an-ai-badge">AI 生成</span>}
                </b>
                <span>
                  {state.phase === "loading"
                    ? "思潼解读中…"
                    : state.phase === "failed"
                      ? `${state.message}（先看编辑解读：${item.insight}）`
                      : insightText}
                </span>
              </div>
              <div className="an-row">
                <button
                  type="button"
                  className={`an-go${item.hot ? " hot" : ""}`}
                  onClick={() => { window.location.assign(getAppPath(item.ctaHref)); }}
                >
                  做同款 · {item.cta} ›
                </button>
                <button
                  type="button"
                  className="an-ai"
                  onClick={() => void generateInterpret(item)}
                  disabled={state.phase === "loading"}
                >
                  {state.phase === "loading" ? "解读中…" : state.phase === "ai" ? "再解读一次" : "AI 解读"}
                </button>
                <button
                  type="button"
                  className={`an-fav${favs.includes(item.id) ? " on" : ""}`}
                  onClick={() => toggleFav(item.id)}
                  aria-label="收藏"
                >
                  {favs.includes(item.id) ? "♥" : "♡"}
                </button>
              </div>
              <div className="an-ask">
                {askOpen[item.id] && (asks[item.id]?.length ?? 0) > 0 && (
                  <div className="an-ask-log">
                    {(asks[item.id] ?? []).map((turn, index) => (
                      turn.role === "user"
                        ? <div className="an-q" key={index}>{turn.text}</div>
                        : <div className="an-a" key={index}>{turn.text}</div>
                    ))}
                  </div>
                )}
                <div className="an-row">
                  <button
                    type="button"
                    className="an-ai"
                    onClick={() => setAskOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  >
                    {askOpen[item.id] ? "收起提问" : "问思潼"}
                  </button>
                </div>
                {askOpen[item.id] && (
                  <form
                    className="an-ask-form"
                    style={{ marginTop: 8 }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!askPending[item.id]) void sendAsk(item);
                    }}
                  >
                    <input
                      className="an-ask-input"
                      value={askDrafts[item.id] ?? ""}
                      onChange={(event) => setAskDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      placeholder="问问思潼：这条对我有用吗？"
                      maxLength={300}
                    />
                    <button className="an-ask-send" type="submit" disabled={askPending[item.id]}>
                      {askPending[item.id] ? "…" : "发送"}
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </main>

      <button
        type="button"
        className={`an-more${!listLoading && total > 0 && limit >= total ? " end" : ""}`}
        onClick={loadMore}
        disabled={listLoading}
      >
        {listLoading
          ? "加载中…"
          : total === 0
            ? "暂无更多资讯"
            : limit >= total
              ? "已到底 · 明日 08:00 继续更新"
              : `加载更多 ↓（还剩 ${total - limit} 条）`}
      </button>

      <div className={`an-toast${toast ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
