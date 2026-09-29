import { useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api";
import { Topbar } from "../marketplace/shell.js";
import { toSafeAppRoute } from "../lib/app-route.js";
import { billingErrorCopy } from "../lib/humanize-error.js";
import { WORKBUDDY_MCP_PUBLIC_URL } from "../config/site";
// 充值流程逻辑（档位/下单/native 二维码/jsapi 收银台/轮询）已抽到共享 hook：
// 页面与商城右侧抽屉消费同一实现，保证「支付逻辑一致，只差样式布局」。
import { packOff, packPts, useRechargeFlow } from "../lib/use-recharge-flow.js";

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
  // 充值流程共享 hook（与商城右侧抽屉同一实现）：档位/下单/支付/轮询都在这里。
  const flow = useRechargeFlow();
  const { token, wallet, packs, planIdx, setPlanIdx, method, setMethod, loading, error, notice, busyCode, qrSrc, payMode, orderId, isLocal, setError, setNotice, createOrder, mockPayOrder } = flow;
  /** WorkBuddy MCP 接入指令用到的服务地址与本次生成的连接密钥（`sitong_wb_`）。 */
  const [mcpUrl, setMcpUrl] = useState(WORKBUDDY_MCP_PUBLIC_URL);
  const [mcpToken, setMcpToken] = useState("");

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
        {/* 2026-09-26（用户）：顶部导航与其他商城页统一，改用共用 Topbar（原手写 topbar 缺「常用/我的/主题切换/退出」） */}
        <Topbar active="recharge" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
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
            <div className="rc-from"><span className="rcf-ico">🧩</span><div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，用的就是这份算力——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div></div>
          )}
          <h1>算力充值</h1>
          <p className="rc-sub">基准 1 元 = 10 算力，<b>充得越多多送越多</b>。一份算力两处用。</p>
          <div className="rc-login">
            <div className="rcl-ico">🔑</div>
            <b>登录后充值</b>
            <p>算力跟思潼AI 账号走。你在 WorkBuddy 用什么方式登录不影响，这里只需一个思潼AI 账号。</p>
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
      {/* 2026-09-26（用户）：顶部导航与其他商城页统一，改用共用 Topbar */}
      <Topbar active="recharge" balance={wallet?.balance ?? null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />

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
            <div className="rcf-txt"><b>你来自 WorkBuddy</b><p>在 WorkBuddy 里用的思潼智能体，用的就是这份算力——充完回到 WorkBuddy 继续用，也能直接用思潼AI 里的行业智能体。</p></div>
          </div>
        )}
        <h1>算力充值</h1>
        <p className="rc-sub">基准 1 元 = 10 算力，<b>充得越多多送越多</b>。一份算力两处用：思潼AI 里的行业智能体能用，WorkBuddy 里的思潼智能体也一样通用。</p>

        {(error || notice) && <div className="notice">{error || notice}</div>}

        {loading ? <div className="loading">正在加载充值信息…</div> : (
          <div className="rc-grid">
            <div className="rc-main">
              <div className="rc-balance">
                <div>
                  <div className="rcb-label">当前算力余额</div>
                  <div className="rcb-val">💎 {wallet?.balance ?? "—"}</div>
                  {wallet && <div style={{ color: "#9db0d4", fontSize: 13, marginTop: 2 }}>充值 {wallet.paidBalance} · 赠送 {wallet.bonusBalance}</div>}
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
                    <div className="rcp-price">到账 {packPts(pack)} 算力</div>
                    <div className="rcp-per">{pack.bonusCredits > 0 ? `${pack.baseCredits} + 多送 ${pack.bonusCredits}` : "基准 10 算力 / 元"}</div>
                    <div className="rcp-tag">{pack.name}</div>
                  </button>
                ))}
              </div>

              {currentPlan && (
                <div className="rc-worth">💰 这一档到账 <b>{packPts(currentPlan)} 算力</b>{currentPlan.bonusCredits > 0 ? `（含多送 ${currentPlan.bonusCredits}）` : ""}</div>
              )}

              <h3>支付方式</h3>
              <div className="rc-methods">
                <button className={`rc-method ${method === "wx" ? "on" : ""}`} onClick={() => setMethod("wx")}><span className="rcm-ico">💚</span><div><b>微信支付</b><span>推荐 · 支持零钱与银行卡</span></div><i className="rcm-dot"></i></button>
                <button className="rc-method" disabled title="支付宝暂未接入"><span className="rcm-ico">💙</span><div><b>支付宝</b><span>待接入</span></div><i className="rcm-dot"></i></button>
              </div>

              {currentPlan && (
                <button className="btn primary block rc-pay" disabled={Boolean(busyCode)} onClick={() => void createOrder(currentPlan)}>
                  {busyCode ? "正在创建支付订单…" : `确认充值 · 到账 ${packPts(currentPlan)} 算力 · ¥${currentPlan.priceCny}`}
                </button>
              )}

              {isLocal && orderId && (
                <button className="btn ghost block" style={{ marginTop: 10 }} disabled={busyCode === "mock"} onClick={() => void mockPayOrder()}>
                  {busyCode === "mock" ? "正在到账…" : "模拟支付到账（本机验收）"}
                </button>
              )}

      {qrSrc && (
        <div className="rc-qr"><p>请使用微信扫码支付，到账后算力立即可用。</p><img src={qrSrc} alt="微信支付二维码" /></div>
      )}
      {payMode === "jsapi" && !qrSrc && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
          微信内支付：已直接调起微信收银台（不需要扫码）。若没有弹出，点上面的按钮重试；仍不行就用电脑打开本页扫码支付。
        </p>
      )}

              <div className="rc-notes">
                <span>✓ 基准 1 元 = 10 算力，充得越多多送越多</span>
                <span>✓ 充值算力不过期；赠送算力 90 天有效，扣费时先扣赠送</span>
                <span>✓ 按结果交付：一次拿到一份完整交付物；需要再要一份，重新发起即可</span>
              </div>
            </div>

            <aside className="rc-side">
              <div className="rc-card"><b>💎 算力用在哪</b><p>思潼AI 创始人IP专区 + 各行业专区的所有智能体，共用这一份算力。</p></div>
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
