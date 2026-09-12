import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { yuanLabelForCredits } from "@baolu/shared";
import { apiPath, getAppPath } from "../lib/api.js";
import { referenceCaseForSku, type ReferenceCase } from "../marketplace/reference-cases.js";
import { clearStoredSession, readSessionToken } from "../lib/session.js";
import { chatFlowFor, buildRunBody } from "../marketplace/chat-flows.js";
import { IpPosReport, type IpPosPayload } from "../marketplace/ip-pos-report.js";
import { VidrevReport, isVidrevPayload, VIDREV_PREFILL_KEY, type VidrevPayload } from "../marketplace/vidrev-report.js";
import sitongAvatar from "../assets/sitong-beauty.png";

interface MarketplaceZone {
  key: string;
  name: string;
  tagline: string;
  icon: string;
  ready?: boolean;
  general?: boolean;
  prefix?: string;
}

interface MarketplaceIndustry {
  key: string;
  title: string;
  tag: string;
  ready: boolean;
  general: boolean;
  prefix?: string;
  who?: string;
  lexicon: string[];
  pains: string[];
  redline: string[];
  ov?: Record<string, Record<string, unknown>>;
}

interface MarketplaceSku {
  id: string;
  skuCode: string;
  zone: string;
  zoneName: string;
  name: string;
  icon?: string | null;
  badge?: string | null;
  description: string;
  verbs: string[];
  useCase: string;
  need: string;
  tags: string[];
  keywords: string[];
  ppu: number;
  status: string;
  sortOrder: number;
  supplierName: string;
}

const BUNDLE_ORDER = ["ip-pos", "topic", "copy", "vidrev", "livescript", "liverev", "sales"];

function coreSkuCode(skuCode: string): string {
  const separator = skuCode.indexOf("__");
  return separator >= 0 ? skuCode.slice(separator + 2) : skuCode;
}

function zoneOfSku(skuCode: string): string {
  const separator = skuCode.indexOf("__");
  return separator >= 0 ? skuCode.slice(0, separator) : "";
}

function isBundle(sku: MarketplaceSku): boolean {
  return coreSkuCode(sku.skuCode) === "ip-pack";
}

// 货架可见但内核未完成：仍可进详情看能力介绍，但不允许进入对话、不消耗积分。
function isComingSoon(sku: MarketplaceSku | null | undefined): boolean {
  return Boolean(sku && sku.status === "coming_soon");
}

function bundleSteps(sku: MarketplaceSku, all: MarketplaceSku[]): MarketplaceSku[] {
  if (!isBundle(sku)) return [];
  const zone = zoneOfSku(sku.skuCode);
  return BUNDLE_ORDER
    .map((sid) => all.find((item) => item.skuCode === `${zone}__${sid}`))
    .filter((item): item is MarketplaceSku => Boolean(item));
}

function bundleTotal(sku: MarketplaceSku, all: MarketplaceSku[]): number {
  return bundleSteps(sku, all).reduce((sum, step) => sum + step.ppu, 0);
}

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `请求失败（${response.status}）`);
  return data;
}

/** 管理端读取：把 401/403 翻译成销售能看懂的话，其余沿用服务端 message / error。 */
async function adminReadJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("当前账号没有发放权限（需要 operator 及以上角色），请用运营/销售后台账号登入。");
    }
    if (response.status === 401) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        data.error === "admin_token_required"
          ? "体验额度发放需要平台运营凭证：请在上方填写「平台管理令牌」后再试。"
          : "登录已失效，请重新登入后再发放。"
      );
    }
    const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

/**
 * 运营后台专用请求头（PLAT-11）。
 *
 * 体验额度是资金侧写操作，服务端除角色守卫外还要求平台运营凭证
 * （`x-sitong-admin-token` == `ADMIN_TOKEN`，与 `/admin/invites` 同源），
 * 否则任何商家 owner 都能给自己发体验积分（QA-20260911-009）。
 * 凭证只挂在这一条请求路径上，不并进通用 `authHeaders`，避免泄漏到普通接口。
 */
function adminAuthHeaders(json = false): Record<string, string> {
  const token = sessionStorage.getItem("sitong_admin_token");
  return {
    ...authHeaders(json),
    ...(token ? { "x-sitong-admin-token": token } : {})
  };
}

/**
 * 服务端判定「会话失效」（401/403）时统一收口：清掉本地 token。
 * 不清的话页面会一边显示「未登录 · 点击登录」、一边在 localStorage 里留着失效 token，
 * 用户点登录立刻被弹回货架，形成登录死循环（QA-20260910-018）。
 */
function handleStaleSession(status: number): boolean {
  if (status !== 401 && status !== 403) return false;
  clearStoredSession();
  return true;
}

/** 读货架账户信息（余额 / 使用记录）；未登录或会话失效时返回 null。 */
async function fetchMarketMe<T>(): Promise<T | null> {
  if (!localStorage.getItem("store_os_token")) return null;
  const response = await fetch(apiPath("/market/me"), { headers: authHeaders(), cache: "no-store" });
  if (handleStaleSession(response.status)) return null;
  return readJson<T>(response);
}

/**
 * 主题切换（2026-09-11：平台默认浅色）。
 *
 * 用 state 记住当前主题，切换后按钮能立即反映新状态；`data-theme` 与 localStorage
 * 仍然是唯一事实来源（首次渲染从 DOM 读取，避免和 main.tsx 的初始化打架）。
 */
function useTheme(): { theme: "light" | "dark"; toggle: () => void } {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light"
  );
  const toggle = () => {
    const next: "light" | "dark" = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#101721" : "#F4F7FC");
    try {
      localStorage.setItem("sitong-theme", next);
    } catch {
      // 隐私模式下不阻断主流程。
    }
    setTheme(next);
  };
  return { theme, toggle };
}

function guestToLogin(path: string): void {
  localStorage.setItem("store_os_post_login_redirect", getAppPath(path));
  window.location.href = getAppPath("/login");
}

function groupByZone(skus: MarketplaceSku[], zones: MarketplaceZone[]) {
  return zones
    .map((zone) => ({ zone, items: skus.filter((sku) => sku.zone === zone.key) }))
    .filter((group) => group.items.length > 0);
}

function Topbar({ active, balance, onNavigate }: { active: string; balance: number | null; onNavigate: (path: string) => void }) {
  const { theme, toggle } = useTheme();
  // 2026-09-11：货架页登入后此前没有退出入口（商家换账号只能自己清浏览器缓存）。
  // 只要本地还有 token 或服务端已返回余额，就认为当前是登录态，展示「退出登录」。
  const [loggedIn, setLoggedIn] = useState(() => Boolean(readSessionToken()));

  useEffect(() => {
    if (balance !== null) setLoggedIn(true);
  }, [balance]);

  function handleLogout() {
    clearStoredSession();
    // 运营凭证只活在当前标签页，退出时一并清掉，避免换账号后残留。
    try {
      sessionStorage.removeItem("sitong_admin_token");
    } catch {
      // 隐私模式下 sessionStorage 不可写：不影响退出登录主流程。
    }
    // 退出后落回货架，重新登入成功仍回到货架，不会卡在登录页。
    localStorage.setItem("store_os_post_login_redirect", getAppPath("/agents"));
    setLoggedIn(false);
    window.location.href = getAppPath("/login");
  }

  return (
    <>
      <header className="topbar">
        <div className="brand" onClick={() => onNavigate("/agents")}>
          <span className="brand-mark">思潼<span className="brand-accent">AI</span></span>
          <span className="brand-sub">行业智能体平台</span>
        </div>
        <nav className="topnav">
          <a className={`nav-link ${active === "market" ? "active" : ""}`} onClick={() => onNavigate("/agents")}>货架</a>
          <a className={`nav-link ${active === "mine" ? "active" : ""}`} onClick={() => onNavigate("/mine")}>我的智能体</a>
          <a className={`nav-link ${active === "recharge" ? "active" : ""}`} onClick={() => onNavigate("/recharge")}>积分充值</a>
        </nav>
        <button className="theme-toggle" onClick={toggle} title="切换深色 / 浅色">
          <span className="tt-ico">{theme === "light" ? "☀️" : "🌙"}</span>
          <span>{theme === "light" ? "浅色" : "深色"}</span>
        </button>
        <div className="wallet-pill" onClick={() => (balance === null ? guestToLogin("/agents") : onNavigate("/recharge"))} title="积分余额 · 点击充值">
          {balance === null ? "🔒 未登录 · 点击登录" : <>💎 <b>{balance}</b> 积分 · {yuanLabelForCredits(balance)} <span className="wp-tag">全平台通用</span></>}
        </div>
        {loggedIn ? (
          <button className="logout-link" onClick={handleLogout} title="退出后用另一个账号重新登入">退出登录</button>
        ) : null}
      </header>
      <div className="shared-banner">💎 <b>积分全平台通用</b> · 按次使用从统一积分钱包扣，创始人IP专区与各行业专区的所有智能体均可抵扣</div>
    </>
  );
}

export function MarketplaceHomePage() {
  const [zones, setZones] = useState<MarketplaceZone[]>([]);
  const [skus, setSkus] = useState<MarketplaceSku[]>([]);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [zoneData, skuData] = await Promise.all([
          fetch(apiPath("/market/zones")).then((r) => readJson<{ zones: MarketplaceZone[] }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setZones(zoneData.zones);
        setSkus(skuData.skus);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skus.filter((sku) => {
      if (zone && sku.zone !== zone) return false;
      if (!q) return true;
      const hay = [sku.name, sku.skuCode, sku.zoneName, sku.badge ?? "", sku.description, sku.useCase, sku.need, ...sku.verbs, ...sku.tags, ...sku.keywords].join(" ").toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
  }, [skus, query, zone]);

  const groups = useMemo(() => groupByZone(filtered, zones), [filtered, zones]);

  return (
    <main className="app-wrap">
      <Topbar active="market" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-home">
        <div className="hero">
          <div className="hero-anchor">行业 AI 解决方案 · 不是通用 AI 工具</div>
          <h1>懂你行业的 AI 智能体</h1>
          <p>同样是 IP 定位、直播话术、销售跟单，讲给美业门店听、和讲给餐饮店听，根本不是一套话。大厂做通用工具，我们只做行业解决方案——每个智能体说你行业的行话、盯你行业的痛点，不说外行话。</p>
          <div className="arch-note">🎯 <b>创始人IP专区</b>：定位 → 内容 → 直播 → 成交，什么行业都能用　·　<b>行业专区</b>：说该行业的行话、盯该行业的痛点、守该行业的规矩</div>
          <div className="hero-cta"><span className="h-cta-item">🏭 懂你的行业，不说外行话</span><span className="h-cta-item">💎 充值一次，处处可用</span><span className="h-cta-item">📦 一次使用 = 完成一件事</span></div>
        </div>

        <div className="shop-bar">
          <div className="searchbar"><span className="sb-ico">🔍</span><input type="text" placeholder="搜智能体：如 定位 / 朋友圈 / 直播复盘…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <span className="sb-clear" onClick={() => setQuery("")}>✕</span>}</div>
          <div className="zone-nav">
            <button className={`zone-chip ${zone === "" ? "on" : ""}`} onClick={() => setZone("")}>全部 <em>{skus.length}</em></button>
            {zones.map((z) => (
              <button key={z.key} className={`zone-chip ${zone === z.key ? "on" : ""}${z.ready ? "" : " soon"}`} onClick={() => setZone(z.key)}>
                {z.name.replace("专区", "")} {z.ready ? <em>{skus.filter((s) => s.zone === z.key).length}</em> : <em>待上线</em>}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="loading">正在加载货架…</div> : (
          <div className="home-res">
            {groups.map(({ zone: z, items }) => (
              <div className="shelf" key={z.key}>
                <div className="shelf-head"><h2>{z.name}</h2><span className="shelf-tag">{z.tagline}</span></div>
                <div className="card-grid skill-grid">
                  {items.map((sku) => <AgentCard key={sku.id} sku={sku} all={skus} />)}
                </div>
              </div>
            ))}
            {zones.filter((z) => !z.ready).map((z) => (
              <div className="shelf" key={z.key}>
                <div className="shelf-head"><h2>{z.name}</h2><span className="shelf-tag">{z.tagline}</span></div>
                <div className="zone-soon">🚧 该专区正在上新，敬请期待。</div>
              </div>
            ))}
            {groups.length === 0 && <div className="search-empty">🔍 没有匹配「{query}」的智能体<br /><span>试试搜：定位 / 选题 / 文案 / 复盘 / 直播 / 销售 / 朋友圈 / 套装</span></div>}
          </div>
        )}
      </section>
    </main>
  );
}

function AgentCard({ sku, all }: { sku: MarketplaceSku; all: MarketplaceSku[] }) {
  const bundle = isBundle(sku);
  const soon = isComingSoon(sku);
  const priceText = soon
    ? `🧩 开发中 · 上线后按次计费`
    : bundle
      ? `按环节计费 · 走完 ${bundleSteps(sku, all).length} 步共 ${bundleTotal(sku, all)} 积分 · ${yuanLabelForCredits(bundleTotal(sku, all))}`
      : `${sku.ppu} 积分/次 · ${yuanLabelForCredits(sku.ppu)}`;
  return (
    <article className="agent-card skill-card" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(sku.skuCode)}`); }}>
      <div className="ac-top">
        <div className="ac-ico">{sku.icon}</div>
        <div className="ac-head">
          <div className="ac-name">{sku.name}</div>
          {sku.verbs.length > 0 && <div className="ac-verbs">{sku.verbs.map((v) => <span key={v}>{v}</span>)}</div>}
        </div>
        {(soon || sku.badge) && <div className="ac-tags">{soon && <span className="chip soon">🚧 开发中</span>}{sku.badge && <span className="chip kit">{sku.badge}</span>}</div>}
      </div>
      <p className="ac-use">{sku.useCase}</p>
      <div className="ac-need">🧩 需要：{(sku.need || "你的业务输入").split("；")[0]}…</div>
      <div className={`ac-price${soon ? " soon" : ""}`}>{priceText}</div>
      <div className="ac-foot">{soon ? <span className="chip soon only">开发中 · 敬请期待</span> : <span className="chip go only">去看看 ›</span>}</div>
    </article>
  );
}

export function MarketplaceAgentDetailPage({ skuId }: { skuId: string }) {
  const [sku, setSku] = useState<MarketplaceSku | null>(null);
  const [industry, setIndustry] = useState<MarketplaceIndustry | null>(null);
  const [all, setAll] = useState<MarketplaceSku[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [benchmark, setBenchmark] = useState<ReferenceCase | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [detail, catalog] = await Promise.all([
          fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}`)).then((r) => readJson<{ sku: MarketplaceSku; industry: MarketplaceIndustry | null }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setSku(detail.sku);
        setIndustry(detail.industry);
        setAll(catalog.skus);
      } catch (reason) {
        if (!cancelled) setNotice(reason instanceof Error ? reason.message : "智能体不存在");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [skuId]);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <main className="app-wrap"><Topbar active="market" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} /><div className="loading">正在加载智能体…</div></main>;
  if (!sku) return <main className="app-wrap"><Topbar active="market" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} /><div className="search-empty">智能体不存在或已下架。</div></main>;

  const bundle = isBundle(sku);
  const steps = bundleSteps(sku, all);
  const total = bundleTotal(sku, all);
  const runSku = bundle ? steps[0] ?? sku : sku;
  const soon = isComingSoon(sku);

  function startChat() {
    if (!runSku || soon) return;
    window.location.href = getAppPath(`/agent/${encodeURIComponent(runSku.skuCode)}/chat`);
  }

  return (
    <main className="app-wrap">
      <Topbar active="market" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-detail">
        <button className="back" onClick={() => { window.location.href = getAppPath("/agents"); }}>‹ 返回货架</button>
        <div className="detail-grid">
          <div className="detail-main">
            <div className="d-head"><span className="d-ico">{sku.icon}</span><div><h1>{sku.name}</h1><div className="d-cat">{sku.zoneName}{sku.verbs.length ? ` · ${sku.verbs.join(" / ")}` : ""}</div></div></div>
            <div className="completes-card">🎯 <b>一次使用 = 帮你完成：</b>{sku.useCase}</div>
            {sku.need && <div className="need-card">🧩 <b>使用前准备：</b>{sku.need}<div className="need-hint">准备好这些，AI 一次引导提问就能补全，产出更贴你。</div></div>}
            {industry && !industry.general && (
              <div className="ind-card">
                <div className="ind-h">🏭 {industry.title.replace("专区", "")}专属 · 说{industry.title.replace("专区", "")}的行话，不说外行话</div>
                {industry.who && <div className="ind-row"><span>服务谁</span><b>{industry.who}</b></div>}
                {industry.lexicon.length > 0 && <div className="ind-row"><span>行业术语</span><b>{industry.lexicon.join(" · ")}</b></div>}
                {industry.pains.length > 0 && <div className="ind-row"><span>典型痛点</span><b>{industry.pains.join(" · ")}</b></div>}
                {industry.redline.length > 0 && <div className="ind-row cr-redline"><span>合规红线</span><b>{industry.redline.join(" · ")}</b></div>}
              </div>
            )}
            <h3>能力介绍</h3><p className="d-cap">{sku.description}</p>
            {sku.tags.length > 0 && <><h3>能力标签</h3><div className="ac-verbs">{sku.tags.map((t) => <span key={t}>{t}</span>)}</div></>}
          </div>

          <aside className="detail-buy">
            {soon && (
              <div className="zone-soon">🚧 <b>该智能体正在开发中</b>：能力介绍和输出参考案例可以先看，暂未开放使用。上线后直接用统一积分钱包按次使用，不需要重复充值。</div>
            )}
            <div className="use-card">
              <div className="use-label">开始使用 · 对话式智能体</div>
              {soon
                ? <div className="use-quick off">🚧 开发中 · 敬请期待</div>
                : <div className="use-quick" onClick={startChat}>💬 直接进对话体验 ›</div>}
              <div className="use-sub">AI 会先读你上传的资料，再按对应方法论<b>逐轮主动提问</b>补全信息，最后产出结构化结果。</div>
            </div>
            <div className="price-card">
              {bundle ? (
                <div className="pc-block">
                  <div className="pc-label">按环节计费 · 走一步扣一步</div>
                  <div className="pc-pts">{total} <span>积分 · 走完 {steps.length} 步 · {yuanLabelForCredits(total)}</span></div>
                  <div className="pk-steps">
                    {steps.map((s, i) => <div className="pk-row" key={s.skuCode}><i>{i + 1}</i><b>{s.name.replace(/智能体$/, "")}</b><span>{s.ppu} 分 · {yuanLabelForCredits(s.ppu)}</span></div>)}
                    <div className="pk-row total"><i>Σ</i><b>走完全链路</b><span>{total} 分 · {yuanLabelForCredits(total)}</span></div>
                  </div>
                  <button className="btn primary block" disabled={soon} onClick={startChat}>{soon ? "开发中 · 敬请期待" : `开始第 1 步 · 扣 ${steps[0]?.ppu ?? 0} 积分（${yuanLabelForCredits(steps[0]?.ppu ?? 0)}）`}</button>
                  {soon
                    ? <div className="pc-note">🚧 组合内各环节正在开发中，上线后开放按环节使用。</div>
                    : <div className="pc-note">🎯 <b>不用先付全款</b>：进入后一步一步走，每步交付完才扣该步的积分——<b>中途停下来，没做的环节不扣钱</b>。</div>}
                </div>
              ) : (
                <div className="pc-block">
                  <div className="pc-label">用一次 · 扣多少</div>
                  <div className="pc-pts">{sku.ppu} <span>积分/次 · {yuanLabelForCredits(sku.ppu)}</span></div>
                  <div className="pc-result">{sku.useCase}</div>
                  <button className="btn primary block" disabled={soon} onClick={startChat}>{soon ? "开发中 · 敬请期待" : `用一次 · 扣 ${sku.ppu} 积分（${yuanLabelForCredits(sku.ppu)}）`}</button>
                  {soon
                    ? <div className="pc-note">🚧 该智能体内核正在开发中，暂不能发起生成；这里的 {sku.ppu} 积分/次（{yuanLabelForCredits(sku.ppu)}）为规划定价，上线前会再确认。</div>
                    : <div className="pc-note">🎯 <b>按结果付费</b>：付一次 = 拿到上面那份交付物；不满意可申请重做一次，不重复扣积分。</div>}
                </div>
              )}
              {/* 方案②：行业专属样例按完整 SKU 命中，通用专区一律回落通用中性样例。 */}
              <button className="btn ghost block demo-chat-btn" onClick={() => setBenchmark(referenceCaseForSku(sku.skuCode) ?? null)}>👀 输出参考案例 · 不消耗积分</button>
            </div>
            <div className="shared-card">💎 <b>一个钱包，全平台通用</b><br />按次使用的积分来自思潼AI 统一钱包，各行业专区的智能体共用；在 WorkBuddy 里用思潼智能体，扣的也是这个钱包。</div>
            {notice && <div className="notice">{notice}</div>}
          </aside>
        </div>
      </section>

      {benchmark && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--ovl-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setBenchmark(null)}
        >
          <div
            style={{ maxWidth: 760, width: "100%", maxHeight: "86vh", overflow: "auto", background: "var(--drawer-bg)", border: "1px solid var(--line)", borderRadius: 18, padding: "22px 24px", color: "var(--text)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>输出参考案例 · 不消耗积分 · 不调用模型</div>
                <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{sku.name}</h2>
              </div>
              <button className="back" onClick={() => setBenchmark(null)}>关闭</button>
            </div>
            <div style={{ background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, color: "var(--muted)", fontSize: 14 }}>
              {benchmark.input}
            </div>
            {benchmark.html ? (
              <div style={{ fontSize: 15 }} dangerouslySetInnerHTML={{ __html: benchmark.html }} />
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>{benchmark.title}</div>
                {(benchmark.rows ?? []).map((row) => (
                  <div key={row.k} style={{ display: "grid", gridTemplateColumns: "minmax(120px,200px) 1fr", gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.07)" }}>
                    <b style={{ color: "var(--accent2)" }}>{row.k}</b>
                    <span style={{ color: "var(--text)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{row.v}</span>
                  </div>
                ))}
                <p style={{ marginTop: 16, color: "var(--muted-2)", fontSize: 12, lineHeight: 1.6 }}>
                  🔒 案例已做脱敏处理：客户品牌名、创始人姓名、可反推的具体数据均已隐去或模糊化。实际产出由智能体按你的输入逐轮推导，非套用固定模板。
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export function MarketplaceMinePage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; skuName?: string | null; amountCredits: number; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  // 本地有 token 不代表还登录着（token 可能已过期）；只有服务端确认过才算已登录，
  // 否则这里会一边显示余额区一边显示「未登录」，用户点登录又被弹回来。
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem("store_os_token")));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchMarketMe<{ creditBalance: number; recentPpu: Array<{ id: string; skuName?: string | null; amountCredits: number; createdAt: string }> }>()
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setSignedIn(false);
          setBalance(null);
          return;
        }
        setBalance(d.creditBalance);
        setRecent(d.recentPpu ?? []);
      })
      .catch(() => { if (!cancelled) setBalance(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!signedIn) {
    return (
      <main className="app-wrap">
        <Topbar active="mine" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
        <section className="view view-mine"><div className="login-gate big">🔒 你还未登录<p>登录后可查看积分余额与使用记录。</p><button className="btn primary" onClick={() => guestToLogin("/mine")}>登录</button></div></section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <Topbar active="mine" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>我的智能体</h1>
        <div className="mine-top">
          <div className="balance-card"><div className="bc-label">积分余额</div><div className="bc-val">💎 {balance ?? "—"}</div><div className="bc-sub">{balance === null ? "按次使用 · 全平台通用" : `${yuanLabelForCredits(balance)} · 按次使用 · 全平台通用`}</div><button className="btn ghost sm" onClick={() => { window.location.href = getAppPath("/recharge"); }}>+ 充值积分</button></div>
          <div className="shared-card wide">💎 <b>跨智能体通用</b><br />积分在统一钱包，可在创始人IP专区与各行业专区的智能体抵扣——只充一次，处处可用。</div>
        </div>
        <h3>近期按次使用</h3>
        {loading ? <div className="loading">正在加载…</div> : recent.length === 0 ? <p className="mine-tip">暂无按次使用记录</p> : (
          <div className="card-grid">
            {recent.map((entry) => (
              <article className="agent-card owned-card" key={entry.id}>
                <div className="ac-ico">🤖</div>
                <div className="ac-name">{entry.skuName ?? "智能体"}</div>
                <div className="ac-price">{entry.amountCredits} 积分 · {yuanLabelForCredits(entry.amountCredits)}</div>
                <div className="ac-foot"><span className="chip owned">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</span></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** 体验额度发放（PLAT-11）：销售/运营确认真实商家身份后，按客户手机号/微信自助发额度。 */
const TRIAL_IDENTITY_OPTIONS = [
  { key: "phone", label: "客户手机号", placeholder: "13800000000" },
  { key: "wechatOpenid", label: "微信 openid", placeholder: "oXXXXXXXXXXXXXXXX" },
  { key: "wechatUnionid", label: "微信 unionid", placeholder: "oXXXXXXXXXXXXXXXX" },
  { key: "userId", label: "用户 ID", placeholder: "c..." }
] as const;

type TrialIdentityKey = (typeof TRIAL_IDENTITY_OPTIONS)[number]["key"];

interface TrialGrantRow {
  id: string;
  grantId: string;
  amount: number;
  userId: string;
  nickname: string | null;
  phone: string | null;
  operator: string | null;
  createdAt: string;
}

interface TrialGrantResult {
  state: "created" | "already_applied" | "dry_run";
  grantId: string;
  amount: number;
  user: { id: string; nickname: string | null; phone: string | null; wechatOpenid: string | null };
  wallet: { paidBalance: number; bonusBalance: number; balance: number };
  grantedAt: string | null;
}

/** 默认体验额度口径（2026-09-11 用户拍板）：400 积分 / 3 天。 */
const TRIAL_DEFAULT_CREDITS = 400;
const TRIAL_DEFAULT_VALID_DAYS = 3;

function suggestedGrantId(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-trial-${suffix}`;
}

function addDaysLabel(fromIso: string | null, days: number): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  if (Number.isNaN(base.getTime())) return "—";
  const until = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const y = until.getFullYear();
  const m = String(until.getMonth() + 1).padStart(2, "0");
  const d = String(until.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const adminFieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "var(--muted)"
};
const adminInputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--bg2)",
  color: "var(--text)",
  fontSize: 14
};

export function MarketplaceAdminPage() {
  const [identityKey, setIdentityKey] = useState<TrialIdentityKey>("phone");
  const [identityValue, setIdentityValue] = useState("");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("sitong_admin_token") ?? "");
  const [amount, setAmount] = useState(String(TRIAL_DEFAULT_CREDITS));
  const [validDays, setValidDays] = useState(String(TRIAL_DEFAULT_VALID_DAYS));
  const [grantId, setGrantId] = useState(suggestedGrantId());
  const [operator, setOperator] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TrialGrantResult | null>(null);
  const [grants, setGrants] = useState<TrialGrantRow[]>([]);
  const [grantsError, setGrantsError] = useState("");

  const loadGrants = async () => {
    // 没有平台运营凭证时不发请求：服务端会 401，直接把「先去填令牌」讲清楚即可。
    if (!sessionStorage.getItem("sitong_admin_token")) {
      setGrants([]);
      setGrantsError("填写平台管理令牌后，这里会显示最近的发放记录。");
      return;
    }
    try {
      const response = await fetch(apiPath("/market/admin/trial-grants?limit=20"), { headers: adminAuthHeaders(), cache: "no-store" });
      const data = await adminReadJson<{ grants: TrialGrantRow[] }>(response);
      setGrants(data.grants ?? []);
      setGrantsError("");
    } catch (reason) {
      setGrantsError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void loadGrants();
  }, []);

  const submit = async () => {
    setError("");
    setResult(null);
    const trimmed = identityValue.trim();
    if (!trimmed) {
      setError("请先填写客户身份（手机号 / 微信 / 用户 ID）");
      return;
    }
    const amountNumber = Number.parseInt(amount, 10);
    if (!Number.isInteger(amountNumber) || amountNumber < 1 || amountNumber > 800) {
      setError("发放积分必须是 1-800 的整数");
      return;
    }
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(grantId.trim())) {
      setError("发放编号只允许字母、数字、- 和 _，长度 8-80");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiPath("/market/admin/trial-grants"), {
        method: "POST",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          identity: { [identityKey]: trimmed },
          amount: amountNumber,
          grantId: grantId.trim(),
          ...(operator.trim() ? { operator: operator.trim() } : {}),
          dryRun
        })
      });
      const data = await adminReadJson<{ grant: TrialGrantResult }>(response);
      setResult(data.grant);
      if (data.grant.state !== "dry_run") {
        setGrantId(suggestedGrantId());
        void loadGrants();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const days = Number.parseInt(validDays, 10) || TRIAL_DEFAULT_VALID_DAYS;

  return (
    <main className="app-wrap">
      <Topbar active="admin" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>体验额度发放</h1>
        <p className="mine-tip">
          销售/运营确认真实商家身份后发放体验额度。额度只能发给<b>已经自己扫码注册登入</b>的客户，
          走 bonus 桶、不计收入、不退款；默认口径 {TRIAL_DEFAULT_CREDITS} 积分 / {TRIAL_DEFAULT_VALID_DAYS} 天。
          本页属于资金侧操作，除账号角色外还需要<b>平台管理令牌</b>（ADMIN_TOKEN），否则任何商家都能给自己发额度。
        </p>

        <div style={{ display: "grid", gap: 14, maxWidth: 560, marginTop: 12 }}>
          <label style={adminFieldStyle}>
            <span>平台管理令牌（仅本次会话保存在浏览器，关闭标签页即清除）</span>
            <input
              type="password"
              value={adminToken}
              onChange={(event) => {
                setAdminToken(event.target.value);
                const next = event.target.value.trim();
                if (next) sessionStorage.setItem("sitong_admin_token", next);
                else sessionStorage.removeItem("sitong_admin_token");
                setGrantsError("");
              }}
              onBlur={() => { void loadGrants(); }}
              placeholder="内部运营凭证，由负责人下发"
              style={adminInputStyle}
            />
          </label>

          <label style={adminFieldStyle}>
            <span>客户身份类型</span>
            <select
              value={identityKey}
              onChange={(event) => { setIdentityKey(event.target.value as TrialIdentityKey); setIdentityValue(""); }}
              style={adminInputStyle}
            >
              {TRIAL_IDENTITY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <label style={adminFieldStyle}>
            <span>{TRIAL_IDENTITY_OPTIONS.find((option) => option.key === identityKey)?.label ?? "客户身份"}</span>
            <input
              value={identityValue}
              onChange={(event) => setIdentityValue(event.target.value)}
              placeholder={TRIAL_IDENTITY_OPTIONS.find((option) => option.key === identityKey)?.placeholder}
              style={adminInputStyle}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label style={adminFieldStyle}>
              <span>发放积分（1-800）</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" style={adminInputStyle} />
            </label>
            <label style={adminFieldStyle}>
              <span>运营有效期（天）</span>
              <input value={validDays} onChange={(event) => setValidDays(event.target.value)} inputMode="numeric" style={adminInputStyle} />
            </label>
          </div>

          <label style={adminFieldStyle}>
            <span>发放编号（幂等键：同一个编号只会发一次）</span>
            <input value={grantId} onChange={(event) => setGrantId(event.target.value)} style={adminInputStyle} />
          </label>

          <label style={adminFieldStyle}>
            <span>发放人（销售/运营，选填，留空记为当前账号）</span>
            <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="如 sales01 / 张三" style={adminInputStyle} />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            预演（dry-run）：只校验身份，不写入任何积分
          </label>

          <div>
            <button className="btn primary" disabled={busy} onClick={() => { void submit(); }}>
              {busy ? "处理中…" : dryRun ? "预演发放" : `发放 ${amount || "—"} 积分`}
            </button>
          </div>
        </div>

        {error && <div className="marketplaceAdminError" role="alert">{error}</div>}

        {result && (
          <div className="marketplaceAdminOverview" style={{ padding: 0, marginTop: 18 }}>
            <article>
              <span>发放结果</span>
              <strong style={{ fontSize: 20 }}>
                {result.state === "created" ? "发放成功" : result.state === "already_applied" ? "已发放过（幂等）" : "预演完成"}
              </strong>
            </article>
            <article>
              <span>客户</span>
              <strong style={{ fontSize: 18 }}>{result.user.nickname ?? result.user.phone ?? result.user.id.slice(0, 8)}</strong>
            </article>
            <article>
              <span>体验额度余额（bonus 桶）</span>
              <strong style={{ fontSize: 22 }}>💎 {result.wallet.bonusBalance}</strong>
            </article>
            <article>
              <span>钱包总余额</span>
              <strong style={{ fontSize: 22 }}>{result.wallet.balance}</strong>
            </article>
          </div>
        )}

        {result && result.state !== "already_applied" && (
          <p className="mine-tip" style={{ marginTop: 8 }}>
            运营口径有效期 {days} 天，建议到期日：<b>{addDaysLabel(result.grantedAt, days)}</b>
            （系统当前不自动回收过期体验积分，到期需人工核对）。
          </p>
        )}

        <section className="marketplaceAdminTable" style={{ padding: "20px 0 40px" }}>
          <div className="marketplaceAdminSectionTitle">
            <h2>最近发放记录</h2>
            <p>来自钱包流水 <code>trial_grant:*</code>，用于对账与核对客户余额。</p>
          </div>
          {grantsError && <div className="marketplaceAdminError" role="alert">{grantsError}</div>}
          {!grantsError && grants.length === 0 && <p className="mine-tip">暂无发放记录。</p>}
          {!grantsError && grants.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>发放时间</th>
                  <th>发放编号</th>
                  <th>客户</th>
                  <th>积分</th>
                  <th>发放人</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{row.grantId}</td>
                    <td>{row.nickname ?? row.phone ?? row.userId.slice(0, 8)}</td>
                    <td>+{row.amount}</td>
                    <td>{row.operator ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>
    </main>
  );
}

interface ChatItem {
  id: string;
  role: "ai" | "user";
  text: string;
  html?: boolean;
  /** ip-pos / vidrev 等有结构化契约的智能体会同时返回 payload，用于专用渲染。 */
  payload?: IpPosPayload | VidrevPayload;
}

/** 从视频复盘跳过来时带的「候选选题」预填；只在对应轮次自动填入一次。 */
interface ChatPrefill {
  sku: string;
  slotKey: string;
  value: string;
  note?: string;
}

export function MarketplaceAgentChatPage({ skuId }: { skuId: string }) {
  const [sku, setSku] = useState<MarketplaceSku | null>(null);
  const [all, setAll] = useState<MarketplaceSku[]>([]);
  const [industry, setIndustry] = useState<MarketplaceIndustry | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [awaitingSupplement, setAwaitingSupplement] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attachments, setAttachments] = useState<Array<{ kind: string; name: string }>>([]);
  const [uploadNote, setUploadNote] = useState("");
  const [docxPrice, setDocxPrice] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  /** 最近一次成功交付的 requestId：作为「免费重做」的凭证。 */
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  /** 当前这份交付是否已经是免费重做产物（每单仅限免费重做 1 次）。 */
  const [freeRedoUsed, setFreeRedoUsed] = useState(false);
  /** 发起中的免费重做凭证；追问补充信息的续跑也要沿用，避免变成付费重跑。 */
  const redoOfRef = useRef<string | null>(null);
  /** 视频复盘「加入选题池」带过来的候选选题（一次性消费）。 */
  const [prefill, setPrefill] = useState<ChatPrefill | null>(null);
  const timerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [detail, catalog] = await Promise.all([
          fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}`)).then((r) => readJson<{ sku: MarketplaceSku; industry: MarketplaceIndustry | null }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setSku(detail.sku);
        setIndustry(detail.industry);
        setAll(catalog.skus);
      } catch {
        if (!cancelled) setSku(null);
      }
    })();
    return () => { cancelled = true; };
  }, [skuId]);

  const bundle = sku ? isBundle(sku) : false;
  const steps = sku ? bundleSteps(sku, all) : [];
  const runSku = sku ? (bundle ? steps[0] ?? sku : sku) : sku;
  const soon = isComingSoon(runSku);
  const flow = runSku ? chatFlowFor(coreSkuCode(runSku.skuCode)) : undefined;
  const ovWelcome = runSku
    ? (industry?.ov?.[coreSkuCode(runSku.skuCode)]?.welcome as string | undefined) ?? ""
    : "";
  const welcome = ovWelcome || flow?.welcome || "";
  /** 同专区「选题」智能体：视频复盘第十章候选选题一键带入它。 */
  const topicSkuCode = runSku
    ? all.find((item) => item.skuCode === `${zoneOfSku(runSku.skuCode)}__topic`)?.skuCode ?? null
    : null;

  useEffect(() => {
    if (!flow || soon) return;
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${flow.slots[0].label}**：${flow.slots[0].q}` }
    ]);
    setStep(0);
    setAnswers({});
    setInput("");
    setCost(null);
    setDone(false);
    setConfirmPending(false);
    setAwaitingSupplement(false);
    setElapsed(0);
    setLastRequestId(null);
    setFreeRedoUsed(false);
    redoOfRef.current = null;
    try {
      const rawPrefill = sessionStorage.getItem(VIDREV_PREFILL_KEY);
      sessionStorage.removeItem(VIDREV_PREFILL_KEY);
      const parsed = rawPrefill ? (JSON.parse(rawPrefill) as Partial<ChatPrefill>) : null;
      setPrefill(parsed?.sku && parsed.slotKey && parsed.value ? { sku: parsed.sku, slotKey: parsed.slotKey, value: parsed.value, note: parsed.note } : null);
    } catch {
      setPrefill(null);
    }
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }, [flow?.name, industry?.key, soon]);

  // 走到被预填的那一轮时，把候选选题放进输入框，用户可改可发。
  useEffect(() => {
    if (!flow || !prefill) return;
    if (coreSkuCode(runSku?.skuCode ?? skuId) !== prefill.sku) return;
    const index = flow.slots.findIndex((slot) => slot.key === prefill.slotKey);
    if (index < 0 || step !== index || input.trim()) return;
    setInput(prefill.value);
    if (prefill.note) setUploadNote(prefill.note);
  }, [step, prefill, flow, runSku?.skuCode, skuId, input]);

  useEffect(() => {
    void fetch(apiPath("/exports/docx/price"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { credits?: number } | null) => {
        if (data && typeof data.credits === "number") setDocxPrice(data.credits);
      })
      .catch(() => {});
  }, []);

  async function generateRun(finalAnswers: Record<string, string>) {
    if (!flow || !runSku || soon) return;
    setConfirmPending(false);
    setBusy(true);
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timeoutRef.current = window.setTimeout(() => {
      setBusy(false);
      setItems((prev) => [...prev, { id: `timeout${Date.now()}`, role: "ai", text: "生成超时（已超过 120 秒），可能是模型繁忙，请稍后重试。本次未扣积分。" }]);
      if (timerRef.current) window.clearInterval(timerRef.current);
    }, 150000);
    try {
      const redoOf = redoOfRef.current;
      const runResponse = await fetch(apiPath(`/market/skus/${encodeURIComponent(runSku.skuCode)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          // 视频复盘额外带 mode / platform / period / has_revenue_data 结构化入参，
          // 后端据此重算口径并校验（其余技能仍是纯文本需求单）。
          ...buildRunBody(coreSkuCode(runSku.skuCode), flow, finalAnswers),
          ...(redoOf ? { redoOf } : {})
        })
      });
      if (handleStaleSession(runResponse.status)) {
        throw new Error("登录状态已失效，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次未扣积分。");
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        balance: number;
        needsInput?: boolean;
        payload?: IpPosPayload | VidrevPayload;
        requestId?: string;
        freeRedo?: boolean;
      }>(runResponse);
      if (result.needsInput) {
        setItems((prev) => [
          ...prev,
          { id: `clr${Date.now()}`, role: "ai", text: result.answer },
          { id: `clrq${Date.now()}`, role: "ai", text: "以上关键信息还需要你补充一下。直接把补充内容发给我，我会重新生成（本次不扣积分）。" }
        ]);
        setAwaitingSupplement(true);
        setDone(false);
        setCost(null);
        return;
      }
      setItems((prev) => [...prev, { id: "final", role: "ai", text: result.answer, html: true, payload: result.payload }]);
      setCost(result.consumedCredits);
      setDone(true);
      setAwaitingSupplement(false);
      // 记录本次交付凭证；免费重做产物本身不再享有重做机会。
      setLastRequestId(result.requestId ?? null);
      setFreeRedoUsed(Boolean(result.freeRedo));
      redoOfRef.current = null;
      if (result.freeRedo) {
        setItems((prev) => [
          ...prev,
          { id: `redo${Date.now()}`, role: "ai", text: "已按你的反馈免费重做一份（本次未扣积分）。每个付费交付仅限免费重做 1 次。" }
        ]);
      }
    } catch (reason) {
      // 免费重做被后端拒绝（额度用尽/凭证无效）时不能继续挂着凭证，避免下一次误判为免费。
      redoOfRef.current = null;
      setItems((prev) => [...prev, { id: "err", role: "ai", text: reason instanceof Error ? reason.message : "生成失败" }]);
    } finally {
      setBusy(false);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    }
  }

  async function send() {
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    await submitAnswer(value);
  }

  /** 快捷选项按钮：值直接来自 ChatSlot.choices，避免用户自由输入被后端误判。 */
  async function sendChoice(value: string) {
    if (busy) return;
    setInput("");
    await submitAnswer(value);
  }

  async function submitAnswer(value: string) {
    if (!flow || !runSku || soon || busy) return;
    if (awaitingSupplement) {
      setItems((prev) => [...prev, { id: `su${Date.now()}`, role: "user", text: value }]);
      await generateRun({ ...answers, __supplement: value });
      return;
    }

    const nextAnswers = { ...answers, [flow.slots[step].key]: value };
    setAnswers(nextAnswers);
    setItems((prev) => [...prev, { id: `u${step}`, role: "user", text: value }]);

    if (step < flow.slots.length - 1) {
      const next = step + 1;
      setStep(next);
      setItems((prev) => [...prev, { id: `q${next}`, role: "ai", text: `**${flow.slots[next].label}**：${flow.slots[next].q}` }]);
      return;
    }

    // 5 项收齐后先确认需求再生成，避免「瞎输入」直接扣积分。
    setConfirmPending(true);
  }

  function confirmBrief() {
    setConfirmPending(false);
    void generateRun(answers);
  }

  function editBrief() {
    if (!flow) return;
    setConfirmPending(false);
    setAnswers({});
    setStep(0);
    setItems((prev) => [...prev, { id: `editq${Date.now()}`, role: "ai", text: `好的，我们重新填一遍。**${flow.slots[0].label}**：${flow.slots[0].q}` }]);
  }

  /** 按结果付费兜底：不满意可免费重做一次，不重复扣积分。 */
  function redoDelivery() {
    if (!flow || !runSku || busy) return;
    if (!lastRequestId || freeRedoUsed) return;
    redoOfRef.current = lastRequestId;
    setItems((prev) => [
      ...prev,
      { id: `redou${Date.now()}`, role: "user", text: "这份交付我不太满意，请免费重做一次（不扣积分）。" }
    ]);
    void generateRun(answers);
  }

  function restart() {
    if (!flow) return;
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${flow.slots[0].label}**：${flow.slots[0].q}` }
    ]);
    setStep(0);
    setAnswers({});
    setInput("");
    setCost(null);
    setDone(false);
    setConfirmPending(false);
    setAwaitingSupplement(false);
    setElapsed(0);
    setLastRequestId(null);
    setFreeRedoUsed(false);
    redoOfRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }

  function openFile(kind: "file" | "video") {
    fileRef.current?.setAttribute("accept", kind === "video" ? "video/*" : ".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv,.txt,.md");
    fileRef.current?.setAttribute("data-kind", kind);
    fileRef.current?.click();
  }

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    const kind = fileRef.current?.getAttribute("data-kind") ?? "file";
    if (!file) return;
    setAttachments((prev) => [...prev, { kind, name: file.name }]);
    setUploadNote(`已上传${kind === "video" ? "视频" : "文件"}：${file.name}` + (kind === "video" ? "（视频内容解析将在后续接入）" : ""));
    if (fileRef.current) fileRef.current.value = "";
  }

  function enhanceInput() {
    if (!flow) return;
    const base = input.trim() || "（待补充）";
    const enhanced = `【${runSku?.name ?? flow.name}需求 · 增强】\n• 业务背景：${base}\n• 关键目标：\n• 已有数据 / 素材：${attachments.map((a) => a.name).join("、") || "（无）"}\n• 最想解决的问题：\n\n请按「${flow.name}」方法论补全维度后输出。`;
    setInput(enhanced);
    setUploadNote("已按该方法论增强，请在原有基础上补充缺口后发送。");
  }

  async function downloadWord() {
    if (exporting) return;
    const finalItem = [...items].reverse().find((item) => item.role === "ai" && item.html);
    const md = finalItem?.text ?? "";
    if (!md.trim()) return;
    const title = `${runSku?.name ?? flow?.name ?? "思潼AI"}交付`;
    setExporting(true);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ title, content: md })
      });
      if (response.status === 402) {
        const data = (await response.json().catch(() => ({}))) as { message?: string; required?: number };
        const required = data.required ?? docxPrice ?? 0;
        window.alert(`${data.message ?? "当前积分不足，无法导出。"}本次导出需 ${required} 积分（${yuanLabelForCredits(required)}），请先充值。`);
        return;
      }
      if (handleStaleSession(response.status)) {
        window.alert("登录状态已失效，本地登录信息已清除。请重新登录后再导出；本次未扣积分。");
        return;
      }
      const created = await readJson<{ downloadUrl?: string; filename?: string }>(response);
      if (!created.downloadUrl) throw new Error("Word 生成失败，请稍后再试。");
      const fileResponse = await fetch(apiPath(created.downloadUrl), { headers: authHeaders(), cache: "no-store" });
      if (!fileResponse.ok) throw new Error("Word 下载失败，请重新导出。");
      const blob = await fileResponse.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = created.filename || `${title}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Word 生成失败，请稍后再试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="app-wrap chat-page">
      <header className="topbar">
        <div className="brand" onClick={() => { window.location.href = getAppPath("/agents"); }}>
          <span className="brand-mark">思潼<span className="brand-accent">AI</span></span>
          <span className="brand-sub">行业智能体平台</span>
        </div>
        <nav className="topnav">
          <a className="nav-link" onClick={() => { window.location.href = getAppPath("/agents"); }}>货架</a>
          <a className="nav-link active">对话</a>
        </nav>
      </header>

      {soon ? (
        <section className="view view-chat chat-page-body">
          <div className="chat-page-shell">
            <div className="chat-page-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="back" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情</button>
                <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
                <span className="chat-page-title">{sku?.name ?? "智能体"} · 开发中</span>
              </div>
            </div>
            <div className="zone-soon" style={{ margin: "0 16px" }}>
              🚧 <b>该智能体内核还在开发中</b>，对话与生成暂未开放，也不会扣积分。<br />
              上线后直接用统一积分钱包按次使用，不需要重复充值；可以先回详情页看「输出参考案例」了解交付物长什么样。
            </div>
            <div className="chat-page-composer">
              <button className="btn ghost block" style={{ marginBottom: 10 }} onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情 · 看输出参考案例</button>
              <button className="btn primary block" onClick={() => { window.location.href = getAppPath("/agents"); }}>去货架挑已上线的智能体</button>
            </div>
          </div>
        </section>
      ) : !flow ? (
        <div className="loading" style={{ padding: 48 }}>正在加载对话…</div>
      ) : (
        <section className="view view-chat chat-page-body">
          <div className="chat-page-shell">
          <div className="chat-page-head">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="back" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情</button>
              <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
              <span className="chat-page-title">{flow.name} · {runSku?.name ?? ""}</span>
            </div>
            {cost !== null && <span className="chat-page-cost">本次消耗 {cost} 积分（{yuanLabelForCredits(cost)}）· 双桶钱包</span>}
          </div>
          {!done && flow.slots.length > 1 && (
            <div className="chat-progress">
              {flow.slots.map((slot, idx) => {
                const answeredCount = items.filter((it) => it.role === "user").length;
                const state = idx < answeredCount ? "done" : idx === step ? "cur" : "todo";
                return <span key={slot.key} className={`chat-prog ${state}`}><i>{state === "done" ? "✓" : idx + 1}</i><b>{slot.label.replace(/第\d+\s*轮·?/g, "")}</b></span>;
              })}
            </div>
          )}
          <div className="chat-page-list">
            {items.map((item) => (
              <div key={item.id} className={`chat-row ${item.role}`}>
                {item.role === "ai" && <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />}
                <div className={`chat-bubble ${item.role}`}>
                  {item.role === "ai" ? (
                    <>
                      <span className="chat-bubble-label">思潼 · {sku?.name ?? "智能体"}</span>
                      {isVidrevPayload(item.payload) ? (
                        <VidrevReport payload={item.payload} renderMarkdown={renderMarkdownHtml} topicSkuCode={topicSkuCode} reportTitle={runSku?.name} />
                      ) : item.payload?.sections ? (
                        <IpPosReport payload={item.payload} renderMarkdown={renderMarkdownHtml} />
                      ) : (
                        <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: item.html ? renderMarkdownHtml(item.text) : renderInline(item.text) }} />
                      )}
                    </>
                  ) : (
                    <>
                      <span className="chat-bubble-label">你</span>
                      <div style={{ color: "inherit", fontSize: 14, lineHeight: 1.6 }}>{item.text}</div>
                    </>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="chat-row ai"><img className="chat-avatar-img" src={sitongAvatar} alt="思潼" /><div className="chat-bubble ai"><span style={{ color: "var(--muted)" }}>AI 正在按方法论生成交付… 已用 {elapsed}s</span></div></div>}
            {confirmPending && !busy && flow && (
              <div className="chat-row ai">
                <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
                <div className="chat-bubble ai" style={{ maxWidth: "84%" }}>
                  <span className="chat-bubble-label">思潼 · {sku?.name ?? "智能体"}</span>
                  <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }}>
                    <p><b>请先确认需求</b>：确认后我按下面这套信息生成交付（约扣 {runSku?.ppu ?? 0} 积分 · {yuanLabelForCredits(runSku?.ppu ?? 0)}）。如有不对，点「修改」重填。</p>
                    <table className="report-table">
                      <tbody>
                        {flow.slots.map((slot) => (
                          <tr key={slot.key}>
                            <td style={{ width: 150, color: "var(--muted)" }}>{slot.label}</td>
                            <td>{answers[slot.key] || "（未填）"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button className="btn primary" onClick={confirmBrief}>✓ 确认，开始生成</button>
                    <button className="btn ghost" onClick={editBrief}>✎ 修改</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {done && <div className="chat-donebar">✓ 已生成结果 · 可继续用文字追问迭代，或上传新资料重做</div>}

          {done ? (
            <div className="chat-page-composer">
              {freeRedoUsed ? (
                <div className="chat-hint" style={{ marginBottom: 10 }}>
                  本单的免费重做机会已用完；如需再生成会按次扣 {runSku?.ppu ?? 0} 积分（{yuanLabelForCredits(runSku?.ppu ?? 0)}），可点「重新开始」。
                </div>
              ) : (
                <button className="btn ghost block" style={{ marginBottom: 10 }} disabled={busy || !lastRequestId} onClick={redoDelivery}>
                  😕 不满意 · 免费重做一次（不扣积分）
                </button>
              )}
              <button className="btn ghost block" style={{ marginBottom: 10 }} disabled={exporting} onClick={downloadWord}>
                {exporting ? "正在导出…" : `⬇ 下载精美 Word${docxPrice ? ` · ${docxPrice} 积分（${yuanLabelForCredits(docxPrice)}）` : ""}`}
              </button>
              <button className="btn primary block" onClick={restart}>再问一次 / 重新开始</button>
            </div>
          ) : confirmPending ? (
            <div className="chat-page-composer">
              <div className="chat-hint">请在上方确认需求，或点「修改」重填后再生成。</div>
            </div>
          ) : (
            <div className="chat-page-composer">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button className="btn ghost sm" onClick={() => openFile("file")}>📎 文件</button>
                <button className="btn ghost sm" onClick={() => openFile("video")}>🎬 视频</button>
                <button className="btn ghost sm" onClick={enhanceInput}>✨ 增强提示词</button>
                <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onFileChange} />
              </div>
              {attachments.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {attachments.map((a, i) => (
                    <span key={i} style={{ background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "var(--text)" }}>{a.kind === "video" ? "🎬" : "📎"} {a.name}</span>
                  ))}
                </div>
              )}
              {uploadNote && <div className="chat-hint" style={{ color: "var(--accent2)", marginBottom: 8 }}>{uploadNote}</div>}
              {!awaitingSupplement && (flow.slots[step]?.choices?.length ?? 0) > 0 && (
                <div className="chat-choices">
                  {flow.slots[step].choices?.map((choice) => (
                    <button key={choice} type="button" className="chat-choice" disabled={busy} onClick={() => void sendChoice(choice)}>{choice}</button>
                  ))}
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={awaitingSupplement ? "补充缺失的信息，发送后重新生成（不扣积分）" : "在这里输入，AI 主动引导你逐步补全"}
                style={{ width: "100%", background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", color: "var(--text)", fontSize: 14, resize: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <span style={{ color: "var(--muted-2)", fontSize: 12 }}>Enter 发送 · Shift+Enter 换行</span>
                <button className="btn primary" style={{ marginLeft: "auto" }} disabled={busy || !input.trim()} onClick={() => void send()}>
                  {busy ? "正在生成…" : awaitingSupplement ? "重新生成" : step < flow.slots.length - 1 ? "下一步" : "确认需求"}
                </button>
              </div>
              <div className="chat-hint">AI 会按本智能体技能逻辑<b>主动提问，引导你补全信息</b>，补全后产出结果 · 可上传：视频 / 文件（单文件 ≤ 50MB）</div>
            </div>
          )}
          </div>
        </section>
      )}
    </main>
  );
}

function renderInline(text: string): string {
  // 兼容原型里用 **加粗** 的简单标记。
  return text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function renderMarkdownHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // 代码块
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-pre">${buf.join("\n")}</pre>`);
      continue;
    }

    // 表格
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (i === start + 1 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
          i++;
          continue;
        }
        rows.push(cells);
        i++;
      }
      if (rows.length) {
        out.push("<table class=\"report-table\"><thead><tr>" + rows[0].map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + rows.slice(1).map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
      }
      continue;
    }

    // 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { out.push("<hr/>"); i++; continue; }

    // 标题
    if (/^#{1,3}\s/.test(trimmed)) {
      out.push(`<h4>${inline(trimmed.replace(/^#{1,3}\s*/, ""))}</h4>`);
      i++; continue;
    }

    // 独立加粗段作为小节标题（如 **一、选题策划**）
    const loneBold = /^\*\*(.+?)\*\*\s*$/.exec(trimmed);
    if (loneBold) { out.push(`<h4>${inline(loneBold[1])}</h4>`); i++; continue; }

    // 引用（> 行合并成一段）
    if (trimmed.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(inline(lines[i].trim().replace(/^>\s?/, "")));
        i++;
      }
      out.push(`<blockquote>${buf.join("<br/>")}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s*/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.、]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.、]\s/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+[.、]\s*/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 普通段落（访谈话术的问答单独上色）
    const isAsk = /^\*{0,2}【问/.test(trimmed);
    const isAns = /^\*{0,2}【答/.test(trimmed);
    out.push(isAsk ? `<p class="md-ask">${inline(trimmed)}</p>` : isAns ? `<p class="md-ans">${inline(trimmed)}</p>` : `<p>${inline(trimmed)}</p>`);
    i++;
  }
  return out.join("\n");
}

function inline(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s])_([^_]+)_(?=[\s,.!?，。！？）】]|$)/g, "$1<i>$2</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
