import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiPath, getAppPath } from "../lib/api";

interface CreditPack {
  code: string;
  name: string;
  priceCny: number;
  baseCredits: number;
  bonusCredits: number;
}

interface BillingCatalog {
  creditPacks: CreditPack[];
}

interface WalletBalance {
  paidBalance: number;
  bonusBalance: number;
  balance: number;
}

interface BillingAccessToken {
  id: string;
  label: string | null;
  tokenPrefix: string;
  status: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const PTS_PER_YUAN = 20;

function packPts(pack: CreditPack): number {
  return pack.baseCredits + pack.bonusCredits;
}

function packOff(pack: CreditPack): number {
  return Math.round((1 - pack.priceCny / (packPts(pack) / PTS_PER_YUAN)) * 100);
}

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message ?? payload.error ?? "request_failed"), { status: response.status, payload });
  return payload as T;
}

function customerMessage(reason: unknown, fallback = "服务暂时不可用，请稍后再试。"): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/insufficient_credits/.test(message)) return "企业积分不足，请先充值后再使用。";
  if (/login_required|membership_not_found|missing_tenant_or_user/.test(message)) return "请先完成登录。";
  if (/^[a-z0-9_:-]+$/i.test(message)) return fallback;
  return message || fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function RechargePage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const fromWorkbuddy = query.get("from") === "workbuddy";
  const skill = query.get("skill") ?? "";
  const [token, setToken] = useState(() => localStorage.getItem("store_os_token") ?? "");
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [planIdx, setPlanIdx] = useState<number | null>(null);
  const [method, setMethod] = useState("wx");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  const [orderId, setOrderId] = useState("");
  const [accessTokens, setAccessTokens] = useState<BillingAccessToken[]>([]);
  const [newToken, setNewToken] = useState("");
  const [tokenLabel, setTokenLabel] = useState("WorkBuddy 访问令牌");
  const pollRef = useRef<number | null>(null);
  const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  useEffect(() => {
    void loadPacks();
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadAccount();
  }, [token]);

  async function loadPacks() {
    setLoading(true);
    setError("");
    try {
      const catalog = await fetch(apiPath("/billing/catalog")).then(readJson<BillingCatalog>);
      setPacks(catalog.creditPacks ?? []);
      if (planIdx === null) {
        const hot = (catalog.creditPacks ?? []).findIndex((pack) => pack.code === "pack_100");
        setPlanIdx(hot >= 0 ? hot : 0);
      }
    } catch (reason) {
      setError(customerMessage(reason, "充值档位加载失败，请刷新重试。"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAccount() {
    try {
      const [walletData, tokens] = await Promise.all([
        fetch(apiPath("/wallet"), { headers: authHeaders(), cache: "no-store" }).then(readJson<WalletBalance>),
        fetch(apiPath("/billing/access-tokens"), { headers: authHeaders() }).then(readJson<{ tokens?: BillingAccessToken[] }>)
      ]);
      setWallet(walletData);
      setAccessTokens(tokens.tokens ?? []);
    } catch (reason) {
      const status = (reason as { status?: number })?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem("store_os_token");
        setToken("");
      } else {
        setWallet(null);
        setAccessTokens([]);
      }
    }
  }

  async function createOrder(pack: CreditPack) {
    setError("");
    setNotice("");
    setQrSrc("");
    setBusyCode(pack.code);
    try {
      const created = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_pack", creditPackCode: pack.code })
      }).then(readJson<{ order: { id: string } }>);

      if (isLocal) {
        setNotice("本机验收：订单已创建，点击「模拟支付到账」入账双桶。");
      } else {
        await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ tradeType: "native" })
        }).then(readJson);
        setQrSrc(apiPath(`/billing/orders/${created.order.id}/wechat-qr.svg`));
      }
      setOrderId(created.order.id);
      void pollOrder(created.order.id);
    } catch (reason) {
      const status = (reason as { status?: number })?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem("store_os_token");
        setToken("");
        return;
      }
      setError(customerMessage(reason, "下单失败，请稍后重试。"));
    } finally {
      setBusyCode("");
    }
  }

  function pollOrder(id: string) {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    void (async () => {
      try {
        const order = await fetch(apiPath(`/billing/orders/${id}`), { headers: authHeaders() }).then(readJson<{ order?: { status: string } }>);
        if (order.order?.status === "paid") {
          setNotice("支付成功，积分已到账。");
          setQrSrc("");
          await refreshBalance();
          return;
        }
      } catch {
        // 网络抖动时继续轮询，不让用户错过支付成功状态。
      }
      pollRef.current = window.setTimeout(() => pollOrder(id), 2500);
    })();
  }

  async function refreshBalance() {
    try {
      const data = await fetch(apiPath("/wallet"), { headers: authHeaders(), cache: "no-store" }).then(readJson<WalletBalance>);
      setWallet(data);
    } catch {
      // 支付已成功，余额刷新失败会在下次刷新时恢复。
    }
  }

  async function mockPayOrder() {
    if (!orderId) return;
    setBusyCode("mock");
    setError("");
    setNotice("");
    try {
      await fetch(apiPath(`/billing/orders/${orderId}/mock-pay`), {
        method: "POST",
        headers: authHeaders()
      }).then(readJson);
      setNotice("模拟支付成功，积分已入双桶。");
      setOrderId("");
      await refreshBalance();
    } catch (reason) {
      setError(customerMessage(reason, "模拟支付失败。"));
    } finally {
      setBusyCode("");
    }
  }

  async function createAccessToken(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const created = await fetch(apiPath("/billing/access-tokens"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ label: tokenLabel.trim() || "WorkBuddy 访问令牌" })
      }).then(readJson<{ token: string; accessToken: BillingAccessToken }>);
      setNewToken(created.token);
      setAccessTokens((current) => [created.accessToken, ...current]);
      setNotice("访问令牌已生成，只显示这一次，请立即复制保存。");
    } catch (reason) {
      setError(customerMessage(reason, "访问令牌生成失败。"));
    }
  }

  async function rotateAccessToken(id: string) {
    setError("");
    setNotice("");
    try {
      const rotated = await fetch(apiPath(`/billing/access-tokens/${id}/rotate`), {
        method: "POST",
        headers: authHeaders()
      }).then(readJson<{ token: string; accessToken: BillingAccessToken }>);
      setNewToken(rotated.token);
      setAccessTokens((current) => [rotated.accessToken, ...current.filter((item) => item.id !== id)]);
      setNotice("旧访问令牌已失效，新访问令牌只显示这一次。");
    } catch (reason) {
      setError(customerMessage(reason, "访问令牌刷新失败。"));
    }
  }

  async function revokeAccessToken(id: string) {
    setError("");
    setNotice("");
    try {
      await fetch(apiPath(`/billing/access-tokens/${id}`), { method: "DELETE", headers: authHeaders() }).then(readJson);
      setAccessTokens((current) => current.map((item) => item.id === id ? { ...item, status: "revoked", revokedAt: new Date().toISOString() } : item));
      setNotice("访问令牌已失效。");
    } catch (reason) {
      setError(customerMessage(reason, "访问令牌失效操作失败。"));
    }
  }

  const currentPlan = packs[planIdx ?? 0] ?? packs[0];

  if (!token) {
    return (
      <main className="app-wrap">
        <header className="topbar">
          <div className="brand" onClick={() => { window.location.href = getAppPath("/agents"); }}>
            <span className="brand-mark">思潼<span className="brand-accent">AI</span></span>
            <span className="brand-sub">行业智能体平台</span>
          </div>
          <nav className="topnav">
            <a className="nav-link" onClick={() => { window.location.href = getAppPath("/agents"); }}>货架</a>
            <a className="nav-link active">积分充值</a>
          </nav>
          <div className="wallet-pill" title="积分余额 · 点击登录" onClick={() => { localStorage.setItem("store_os_post_login_redirect", getAppPath(`/recharge${window.location.search}`)); window.location.href = getAppPath("/login"); }}>🔒 未登录 · 点击登录</div>
        </header>
        <section className="view view-recharge">
          {fromWorkbuddy && (
            <div className="rc-from"><span className="rcf-ico">🧩</span><div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，充的就是这个钱包——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div></div>
          )}
          <h1>积分充值</h1>
          <p className="rc-sub">基准 1 元 = 20 积分，<b>充得越多多送越多</b>。一个钱包两处用。</p>
          <div className="rc-login">
            <div className="rcl-ico">🔑</div>
            <b>登录后充值</b>
            <p>积分跟思潼AI 账号走。你在 WorkBuddy 用什么方式登录不影响，这里只需一个思潼AI 账号。</p>
            <div className="rcl-btns">
              <button className="btn primary block" onClick={() => { localStorage.setItem("store_os_post_login_redirect", getAppPath(`/recharge${window.location.search}`)); window.location.href = getAppPath("/login"); }}>微信登录</button>
              <button className="btn ghost block" onClick={() => { localStorage.setItem("store_os_post_login_redirect", getAppPath(`/recharge${window.location.search}`)); window.location.href = getAppPath("/login"); }}>手机号登录</button>
            </div>
            <div className="rcl-tip">{fromWorkbuddy ? "充值完成后回到 WorkBuddy 即可继续使用，无需再次登录。" : "已有账号？登录后可查看余额与充值记录。"}</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <header className="topbar">
        <div className="brand" onClick={() => { window.location.href = getAppPath("/agents"); }}>
          <span className="brand-mark">思潼<span className="brand-accent">AI</span></span>
          <span className="brand-sub">行业智能体平台</span>
        </div>
        <nav className="topnav">
          <a className="nav-link" onClick={() => { window.location.href = getAppPath("/agents"); }}>货架</a>
          <a className="nav-link active">积分充值</a>
        </nav>
        <div className="wallet-pill" title="积分余额 · 点击充值" onClick={() => { window.location.href = getAppPath("/recharge"); }}>💎 <b>{wallet?.balance ?? "—"}</b> 积分 <span className="wp-tag">全平台通用</span></div>
      </header>

      <section className="view view-recharge">
        {fromWorkbuddy && (
          <div className="rc-from">
            <span className="rcf-ico">🧩</span>
            <div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，充的就是这个钱包——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div>
          </div>
        )}
        <h1>积分充值</h1>
        <p className="rc-sub">基准 1 元 = 20 积分，<b>充得越多多送越多</b>。一个钱包两处用：思潼AI 里的行业智能体能用，WorkBuddy 里的思潼智能体也扣这个钱包。</p>

        {(error || notice) && <div className="notice">{error || notice}</div>}

        {loading ? <div className="loading">正在加载充值信息…</div> : (
          <div className="rc-grid">
            <div className="rc-main">
              <div className="rc-balance">
                <div>
                  <div className="rcb-label">当前积分余额</div>
                  <div className="rcb-val">💎 {wallet?.balance ?? "—"}</div>
                  {wallet && <div style={{ color: "#9db0d4", fontSize: 13, marginTop: 2 }}>基础 {wallet.paidBalance} · 多送 {wallet.bonusBalance}</div>}
                </div>
                <span className="rcb-tag">全平台通用</span>
              </div>

              <h3>选择充值档位</h3>
              <div className="rc-packs">
                {packs.map((pack, i) => (
                  <button key={pack.code} className={`rc-pack ${i === (planIdx ?? 0) ? "on" : ""}`} onClick={() => setPlanIdx(i)}>
                    {pack.code === "pack_100" && <span className="rcp-hot">最多人选</span>}
                    {pack.bonusCredits > 0 && <span className="rcp-off">多 {packOff(pack)}%</span>}
                    <div className="rcp-pts">¥{pack.priceCny}</div>
                    <div className="rcp-price">到账 {packPts(pack)} 积分</div>
                    <div className="rcp-per">{pack.bonusCredits > 0 ? `${pack.baseCredits} + 多送 ${pack.bonusCredits}` : "基准 20 积分 / 元"}</div>
                    <div className="rcp-tag">{pack.name}</div>
                  </button>
                ))}
              </div>

              {currentPlan && (
                <div className="rc-worth">💰 这一档到账 <b>{packPts(currentPlan)} 积分</b>{currentPlan.bonusCredits > 0 ? `（含多送 ${currentPlan.bonusCredits}）` : ""}</div>
              )}

              <h3>支付方式</h3>
              <div className="rc-methods">
                <button className={`rc-method ${method === "wx" ? "on" : ""}`} onClick={() => setMethod("wx")}><span className="rcm-ico">💚</span><div><b>微信支付</b><span>推荐 · 支持零钱与银行卡</span></div><i className="rcm-dot"></i></button>
                <button className="rc-method" disabled title="支付宝暂未接入"><span className="rcm-ico">💙</span><div><b>支付宝</b><span>待接入</span></div><i className="rcm-dot"></i></button>
              </div>

              {currentPlan && (
                <button className="btn primary block rc-pay" disabled={Boolean(busyCode)} onClick={() => void createOrder(currentPlan)}>
                  {busyCode ? "正在创建支付订单…" : `确认充值 · 到账 ${packPts(currentPlan)} 积分 · ¥${currentPlan.priceCny}`}
                </button>
              )}

              {isLocal && orderId && (
                <button className="btn ghost block" style={{ marginTop: 10 }} disabled={busyCode === "mock"} onClick={() => void mockPayOrder()}>
                  {busyCode === "mock" ? "正在到账…" : "模拟支付到账（本机验收）"}
                </button>
              )}

              {qrSrc && (
                <div className="rc-qr"><p>请使用微信扫码支付，到账后积分立即可用。</p><img src={qrSrc} alt="微信支付二维码" /></div>
              )}

              <div className="rc-notes">
                <span>✓ 基准 1 元 = 20 积分，充得越多多送越多</span>
                <span>✓ 积分不过期，思潼AI 与 WorkBuddy 里的思潼智能体通用</span>
                <span>✓ 按结果付费：付一次 = 拿到一份交付物，不满意可重做一次</span>
              </div>
            </div>

            <aside className="rc-side">
              <div className="rc-card"><b>💎 积分用在哪</b><p>思潼AI 里所有按次使用的智能体（创始人IP专区 + 各行业专区）都从这一个钱包扣。</p></div>
              <div className="rc-card token">
                <b>🔑 WorkBuddy 访问令牌</b>
                <p>在 WorkBuddy 里使用思潼智能体时粘贴这个令牌，扣的就是这个钱包，不用再单独充值。</p>
                <form className="rc-token-form" onSubmit={createAccessToken}>
                  <input value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} maxLength={80} aria-label="令牌名称" />
                  <button className="btn ghost sm" type="submit">生成访问令牌</button>
                </form>
                {newToken && <div className="rct-reveal"><span>请立即复制，只显示这一次</span><code>{newToken}</code></div>}
                <div className="rc-token-list">
                  {accessTokens.length === 0 && <p className="rc-empty">还没有访问令牌。</p>}
                  {accessTokens.map((item) => (
                    <div key={item.id} className="rct-row">
                      <div><strong>{item.label ?? "WorkBuddy 访问令牌"}</strong><code>{item.tokenPrefix}</code><span>{item.status === "revoked" ? "已失效" : item.expiresAt ? `有效期至 ${formatDate(item.expiresAt)}` : "长期有效"}</span></div>
                      {item.status !== "revoked" && <div className="rct-actions"><button type="button" onClick={() => void rotateAccessToken(item.id)}>刷新</button><button type="button" onClick={() => void revokeAccessToken(item.id)}>失效</button></div>}
                    </div>
                  ))}
                </div>
              </div>
              {fromWorkbuddy && (
                <div className="rc-card ad"><b>🏭 顺手看看思潼AI</b><p>你在 WorkBuddy 用的是单个智能体；思潼AI 里有按行业打包的完整解决方案——同一套方法论，说你那个行业的行话。</p><button className="btn ghost sm block" onClick={() => { window.location.href = getAppPath("/agents"); }}>去看看行业智能体 ›</button></div>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
