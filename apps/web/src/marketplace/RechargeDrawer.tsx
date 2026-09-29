import { getAppPath } from "../lib/api.js";
import { packOff, packPts, useRechargeFlow } from "../lib/use-recharge-flow.js";
import { IconAuto } from "./IconGlyph.js";
import { fmtCredits } from "../lib/fmt.js";

/**
 * 充值右侧抽屉（2026-09-29 用户拍板：右侧抽屉不跳页）。
 *
 * 支付逻辑与 /recharge 完全一致——两者消费同一个 `useRechargeFlow` hook，
 * 这里只做「样式和布局」：桌面右侧滑入 440px，手机端全屏；左侧导航与顶栏保持不动。
 * 完整页 /recharge 保留为兜底入口（头部有「在完整页面打开」）。
 */
export function RechargeDrawer({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid?: () => void }) {
  const flow = useRechargeFlow({
    onPaid: () => {
      // 通知全站顶栏/侧栏刷新余额（MallTopbar 监听该事件）。
      window.dispatchEvent(new CustomEvent("sitong:balance-changed"));
      onPaid?.();
    }
  });
  const { wallet, packs, planIdx, setPlanIdx, method, setMethod, loading, error, notice, busyCode, qrSrc, payMode, orderId, isLocal, setError, setNotice, createOrder, mockPayOrder } = flow;
  const currentPlan = packs[planIdx ?? 0] ?? packs[0];

  if (!open) return null;

  return (
    <div className="eh-rd-overlay" onClick={onClose}>
      <aside
        className="eh-rd-panel"
        role="dialog"
        aria-modal="true"
        aria-label="算力充值"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="eh-rd-head">
          <b>算力充值</b>
          <span style={{ flex: 1 }} />
          <button type="button" className="eh-rd-x" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="eh-rd-body">
          {flow.token ? (
            <>
              {wallet ? (
                <div className="eh-rd-balance">
                  <div>
                    <div style={{ fontSize: 11, color: "#94796B" }}>当前算力余额</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#E86A00" }}><IconAuto v="💎" size={20} /> {fmtCredits(wallet.balance)}</div>
                    <div style={{ fontSize: 11, color: "#BEA488" }}>充值 {wallet.paidBalance} · 赠送 {wallet.bonusBalance}</div>
                  </div>
                  <span className="eh-rd-tag">全平台通用</span>
                </div>
              ) : null}

              {(error || notice) && <div className="eh-rd-notice">{error || notice}</div>}

              {loading ? (
                <div className="eh-rd-loading">正在加载充值信息…</div>
              ) : (
                <>
                  <div className="eh-rd-sec">选择充值档位</div>
                  <div className="eh-rd-packs">
                    {packs.map((pack, i) => (
                      <button
                        key={pack.code}
                        type="button"
                        className={`eh-rd-pack ${i === (planIdx ?? 0) ? "on" : ""}`}
                        onClick={() => setPlanIdx(i)}
                      >
                        {pack.code === "pack_100" && <span className="eh-rd-hot">最多人选</span>}
                        {pack.bonusCredits > 0 && <span className="eh-rd-off">多 {packOff(pack)}%</span>}
                        <div className="eh-rd-price">¥{pack.priceCny}</div>
                        <div className="eh-rd-pts">到账 {packPts(pack)} 算力</div>
                        <div className="eh-rd-sub">{pack.bonusCredits > 0 ? `${pack.baseCredits} + 多送 ${pack.bonusCredits}` : "基准 10 算力 / 元"}</div>
                        <div className="eh-rd-name">{pack.name}</div>
                      </button>
                    ))}
                  </div>

                  {currentPlan ? (
                    <div className="eh-rd-worth"><IconAuto v="💰" size={13} /> 这一档到账 <b>{packPts(currentPlan)} 算力</b>{currentPlan.bonusCredits > 0 ? `（含多送 ${currentPlan.bonusCredits}）` : ""}</div>
                  ) : null}

                  <div className="eh-rd-sec">支付方式</div>
                  <button
                    type="button"
                    className={`eh-rd-method ${method === "wx" ? "on" : ""}`}
                    onClick={() => setMethod("wx")}
                  >
                    <span><IconAuto v="💚" size={16} /></span>
                    <span style={{ flex: 1, textAlign: "left" }}><b>微信支付</b><small style={{ display: "block", color: "#94796B", fontSize: 11 }}>推荐 · 支持零钱与银行卡</small></span>
                    <i className="eh-rd-dot" />
                  </button>

                  {currentPlan ? (
                    <button
                      type="button"
                      className="btn-orange eh-rd-pay"
                      disabled={Boolean(busyCode)}
                      onClick={() => void createOrder(currentPlan)}
                    >
                      {busyCode ? "正在创建支付订单…" : `确认充值 · 到账 ${packPts(currentPlan)} 算力 · ¥${currentPlan.priceCny}`}
                    </button>
                  ) : null}

                  {isLocal && orderId ? (
                    <button type="button" className="eh-rd-mock" disabled={busyCode === "mock"} onClick={() => void mockPayOrder()}>
                      {busyCode === "mock" ? "正在到账…" : "模拟支付到账（本机验收）"}
                    </button>
                  ) : null}

                  {qrSrc ? (
                    <div className="eh-rd-qr">
                      <p>请使用微信扫码支付，到账后算力立即可用。</p>
                      <img src={qrSrc} alt="微信支付二维码" />
                    </div>
                  ) : null}
                  {payMode === "jsapi" && !qrSrc ? (
                    <p className="eh-rd-jsapi">微信内支付：已直接调起微信收银台（不需要扫码）。若没有弹出，点上面的按钮重试。</p>
                  ) : null}

                  <div className="eh-rd-notes">
                    <span>✓ 基准 1 元 = 10 算力，充得越多多送越多</span>
                    <span>✓ 充值算力不过期；赠送算力 90 天有效，扣费时先扣赠送</span>
                    <span>✓ 按结果交付：一次拿到一份完整交付物；需要再要一份，重新发起即可</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="eh-rd-login">
              <div><IconAuto v="🔑" size={26} /></div>
              <b>登录后充值</b>
              <p>算力跟思潼AI 账号走，登录后即可充值并查看余额与记录。</p>
              <button
                type="button"
                className="btn-orange"
                style={{ width: "100%" }}
                onClick={() => {
                  localStorage.setItem("store_os_post_login_redirect", getAppPath("/recharge"));
                  window.location.href = getAppPath("/login");
                }}
              >去登录</button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
