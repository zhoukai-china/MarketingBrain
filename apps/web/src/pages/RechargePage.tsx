import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api";
import { toSafeAppRoute } from "../lib/app-route.js";
import { billingErrorCopy } from "../lib/humanize-error.js";

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

const PTS_PER_YUAN = 20;

/**
 * WorkBuddy 接入思潼 AI 的 MCP：把这段整段发给 WorkBuddy，它会自己合并 mcpServers 配置。
 * 与「企业账户 → WorkBuddy 调用思潼 AI」里生成的是同一段指令，密钥前缀是 `sitong_wb_`。
 */
export function buildWorkbuddyInstruction(url: string, key: string): string {
  const config = JSON.stringify({
    mcpServers: {
      "sitong-ai": {
        type: "streamable-http",
        url,
        headers: { Authorization: `Bearer ${key}` }
      }
    }
  }, null, 2);
  return `请帮我在 WorkBuddy 中接入“思潼 AI”MCP。请打开 MCP 配置，将下面的 sitong-ai 配置合并进现有的 mcpServers（不要删除我已有的其他 MCP），保存配置并刷新 MCP 服务列表。配置完成后请提示我：我会自行前往 MCP 服务管理页面，对 sitong-ai 点击信任并启用。\n\n${config}`;
}

/**
 * 微信内置浏览器：必须走 JSAPI 收银台（`WeixinJSBridge`），不能只出二维码。
 *
 * 2026-09-13 用户真机实测：手机微信里打开充值页，页面只出 Native 二维码——
 * 用户没法用同一部手机扫自己屏幕上的码，长按识别又被微信拒绝
 * （“该商户暂时不支持通过长按识别二维码完成支付”），只能改用电脑打开页面才付得了款。
 * 现在微信内 → JSAPI 直接拉起收银台；其它环境（电脑、普通手机浏览器）→ 仍用二维码。
 */
function isWechatInAppBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

interface WeixinJsBridgeLike {
  invoke: (api: string, params: Record<string, unknown>, callback: (res: { err_msg?: string }) => void) => void;
}

/** 拉起微信内支付。返回 ok / cancel / fail，失败时由上层给「重新支付」与备选路径。 */
function invokeWechatJsapiPay(payParams: Record<string, unknown>): Promise<"ok" | "cancel" | "fail"> {
  return new Promise((resolve) => {
    const bridge = (window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge;
    const call = () => {
      const active = (window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge;
      if (!active) {
        resolve("fail");
        return;
      }
      active.invoke("getBrandWCPayRequest", payParams, (res) => {
        const message = res?.err_msg ?? "";
        if (message === "get_brand_wcpay_request:ok") resolve("ok");
        else if (message === "get_brand_wcpay_request:cancel") resolve("cancel");
        else resolve("fail");
      });
    };
    if (bridge) {
      call();
      return;
    }
    // 微信注入 JSBridge 有两个时机：已注入、或等 `WeixinJSBridgeReady` 事件。
    const onReady = () => {
      document.removeEventListener("WeixinJSBridgeReady", onReady);
      call();
    };
    document.addEventListener("WeixinJSBridgeReady", onReady);
    window.setTimeout(() => {
      document.removeEventListener("WeixinJSBridgeReady", onReady);
      if (!(window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge) resolve("fail");
    }, 2000);
  });
}

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

export function RechargePage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const fromWorkbuddy = query.get("from") === "workbuddy";
  const skill = query.get("skill") ?? "";
  /**
   * 2026-09-16（WorkBuddy 验收 P2 + 用户现场「充值完还得重填」）：
   * 从智能体对话页余额不足跳过来时带 `next=<站内路由>`，这里给一条**明确的回头路**——
   * 充完（或先不充）点「返回继续生成」就回到那个智能体，本机留存的输入原样还在。
   *
   * `next` 只接受**站内绝对路径**（单个前导 `/`），拒绝 `//host`、`http:`、反斜杠等一切跨站写法，
   * 避免这个参数被当成开放跳转使用；再交给 `getAppPath()` 补回 `/os-v2/` 这类应用前缀。
   */
  const nextRoute = toSafeAppRoute(query.get("next"));
  const goNext = () => { if (nextRoute) window.location.href = getAppPath(nextRoute); };
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
  /** 当前这一单用的是哪种支付方式：jsapi（微信内收银台）/ native（二维码）。 */
  const [payMode, setPayMode] = useState<"none" | "jsapi" | "native">("none");
  const [orderId, setOrderId] = useState("");
  /** WorkBuddy MCP 接入指令用到的服务地址与本次生成的连接密钥（`sitong_wb_`）。 */
  const [mcpUrl, setMcpUrl] = useState("https://api.lcppch.top/os-v2/api/integrations/workbuddy/mcp");
  const [mcpToken, setMcpToken] = useState("");
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
      setError(billingErrorCopy(reason, "充值档位加载失败，请刷新重试。"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAccount() {
    try {
      const [walletData, mcpInfo] = await Promise.all([
        fetch(apiPath("/wallet"), { headers: authHeaders(), cache: "no-store" }).then(readJson<WalletBalance>),
        fetch(apiPath("/integrations/workbuddy/connections"), { headers: authHeaders(), cache: "no-store" })
          .then(readJson<{ mcpUrl?: string }>)
          .catch((): { mcpUrl?: string } => ({}))
      ]);
      setWallet(walletData);
      if (mcpInfo.mcpUrl) setMcpUrl(mcpInfo.mcpUrl);
    } catch (reason) {
      const status = (reason as { status?: number })?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem("store_os_token");
        setToken("");
      } else {
        setWallet(null);
      }
    }
  }

  async function createOrder(pack: CreditPack) {
    setError("");
    setNotice("");
    setQrSrc("");
    setPayMode("none");
    setBusyCode(pack.code);
    try {
      const created = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_pack", creditPackCode: pack.code })
      }).then(readJson<{ order: { id: string } }>);

      if (isLocal) {
        setNotice("本机验收：订单已创建，点击「模拟支付到账」入账双桶。");
      } else if (isWechatInAppBrowser()) {
        // 微信内：直接拉起收银台，用户不需要（也没法）扫自己屏幕上的二维码。
        setPayMode("jsapi");
        let payParams: Record<string, unknown> | undefined;
        try {
          const prepay = await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ tradeType: "jsapi" })
          }).then(readJson<{ payParams?: Record<string, unknown>; order?: { payParams?: Record<string, unknown> } }>);
          // 接口把收银台参数放在顶层 `payParams`（实测 2026-09-13：appId/nonceStr/package/paySign/signType/timeStamp）。
          // 同时兼容早期把 payParams 嵌在 order 里的结构，避免任何一侧改动把支付打哑。
          payParams = prepay.payParams ?? prepay.order?.payParams;
        } catch {
          // 例如账号没有微信 openid（非微信注册的老账号）：下面回落二维码，不让流程卡死。
          payParams = undefined;
        }
        setOrderId(created.order.id);
        void pollOrder(created.order.id);
        if (!payParams) {
          try {
            await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
              method: "POST",
              headers: { ...authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ tradeType: "native" })
            }).then(readJson);
            setPayMode("native");
            setQrSrc(apiPath(`/billing/orders/${created.order.id}/wechat-qr.svg`));
            setNotice("已在页面生成收款二维码：用另一台设备的微信扫码支付；也可以点上面的按钮重试微信内支付。");
          } catch {
            setNotice("微信支付暂时拉不起来，请点上面的按钮重试，或稍后换电脑打开本页扫码支付。");
          }
          return;
        }
        const result = await invokeWechatJsapiPay(payParams);
        if (result === "ok") setNotice("支付完成，正在到账…（到账后积分立即可用）");
        else if (result === "cancel") setNotice("你取消了支付，点上面的按钮可以重新支付。");
        else setNotice("微信收银台没有正常拉起：请点上面的按钮重试；仍然不行就用电脑打开本页扫码支付。");
        return;
      } else {
        await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ tradeType: "native" })
        }).then(readJson);
        setPayMode("native");
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
      setError(billingErrorCopy(reason, "下单失败，请稍后重试。"));
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
      setError(billingErrorCopy(reason, "模拟支付失败。"));
    } finally {
      setBusyCode("");
    }
  }

  /**
   * 复制「给 WorkBuddy 的安装指令」。首次调用会先按当前账号生成一条专属 MCP 连接
   * （密钥 `sitong_wb_` 只显示这一次），再把地址 + 密钥拼进指令一起复制。
   */
  async function copyWorkbuddyInstruction() {
    setError("");
    setNotice("");
    try {
      let key = mcpToken;
      let url = mcpUrl;
      if (!key) {
        const created = await fetch(apiPath("/integrations/workbuddy/connections"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "marketplace", label: "WorkBuddy 连接" })
        }).then(readJson<{ token: string; mcpUrl?: string }>);
        key = created.token;
        if (created.mcpUrl) url = created.mcpUrl;
        setMcpToken(key);
        setMcpUrl(url);
      }
      await navigator.clipboard.writeText(buildWorkbuddyInstruction(url, key));
      setNotice("安装指令已复制，直接粘贴发给 WorkBuddy 即可。");
    } catch (reason) {
      setError(billingErrorCopy(reason, "安装指令复制失败，请重试。"));
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
            <a className="nav-link" onClick={() => { window.location.href = getAppPath("/agents"); }}>商城</a>
            <a className="nav-link active">积分充值</a>
          </nav>
          <div className="wallet-pill" title="积分余额 · 点击登录" onClick={() => { localStorage.setItem("store_os_post_login_redirect", getAppPath(`/recharge${window.location.search}`)); window.location.href = getAppPath("/login"); }}>🔒 未登录 · 点击登录</div>
        </header>
        <section className="view view-recharge">
          {nextRoute && (
            <div className="rc-from">
              <span className="rcf-ico">↩️</span>
            <div className="rcf-txt">
              <b>你正在为刚才那次生成充值</b>
              <p>充完点右边按钮就能回到那个智能体继续生成；<b>你已经填的内容留在本机，不会丢，不用重填</b>。</p>
            </div>
              <button className="btn ghost sm" style={{ marginLeft: "auto", flex: "0 0 auto" }} onClick={goNext}>返回继续生成</button>
            </div>
          )}
          {fromWorkbuddy && (
            <div className="rc-from"><span className="rcf-ico">🧩</span><div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，用的就是这份积分——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div></div>
          )}
          <h1>积分充值</h1>
          <p className="rc-sub">基准 1 元 = 20 积分，<b>充得越多多送越多</b>。一份积分两处用。</p>
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
          <a className="nav-link" onClick={() => { window.location.href = getAppPath("/agents"); }}>商城</a>
          <a className="nav-link active">积分充值</a>
        </nav>
        <div className="wallet-pill" title="积分余额 · 点击充值" onClick={() => { window.location.href = getAppPath("/recharge"); }}>💎 <b>{wallet?.balance ?? "—"}</b> 积分 <span className="wp-tag">全平台通用</span></div>
      </header>

      <section className="view view-recharge">
        {nextRoute && (
          <div className="rc-from">
            <span className="rcf-ico">↩️</span>
            <div className="rcf-txt">
              <b>你正在为刚才那次生成充值</b>
              <p>充完点右边按钮就能回到那个智能体继续生成；<b>你已经填的内容留在本机，不会丢，不用重填</b>。</p>
            </div>
            <button className="btn ghost sm" style={{ marginLeft: "auto", flex: "0 0 auto" }} onClick={goNext}>返回继续生成</button>
          </div>
        )}
        {fromWorkbuddy && (
          <div className="rc-from">
            <span className="rcf-ico">🧩</span>
            <div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，用的就是这份积分——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div>
          </div>
        )}
        <h1>积分充值</h1>
        <p className="rc-sub">基准 1 元 = 20 积分，<b>充得越多多送越多</b>。一份积分两处用：思潼AI 里的行业智能体能用，WorkBuddy 里的思潼智能体也一样通用。</p>

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
      {payMode === "jsapi" && !qrSrc && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
          微信内支付：已直接调起微信收银台（不需要扫码）。若没有弹出，点上面的按钮重试；仍不行就用电脑打开本页扫码支付。
        </p>
      )}

              <div className="rc-notes">
                <span>✓ 基准 1 元 = 20 积分，充得越多多送越多</span>
                <span>✓ 积分不过期，思潼AI 与 WorkBuddy 里的思潼智能体通用</span>
                <span>✓ 按结果交付：一次拿到一份完整交付物；需要再要一份，重新发起即可</span>
              </div>
            </div>

            <aside className="rc-side">
              <div className="rc-card"><b>💎 积分用在哪</b><p>思潼AI 创始人IP专区 + 各行业专区的所有智能体，共用这一份积分。</p></div>
              <div className="rc-card token">
                <b>🔗 在 WorkBuddy 里接入思潼 AI</b>
                <p>把下面这段整段复制，直接发给 WorkBuddy，它就会自动接入思潼 AI 的 MCP（不用手动改 JSON）。</p>
                <pre className="rc-mcp-cmd">{buildWorkbuddyInstruction(mcpUrl, mcpToken || "在这里粘贴 sitong_wb_ 开头的连接密钥")}</pre>
                <button className="btn ghost sm block" type="button" onClick={() => void copyWorkbuddyInstruction()}>📋 复制安装指令</button>
                <p className="rc-empty">连接密钥（sitong_wb_ 开头）只显示这一次：点上面按钮会自动生成并连指令一起复制；要换密钥去「企业账户 → WorkBuddy 调用思潼 AI」。</p>
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
