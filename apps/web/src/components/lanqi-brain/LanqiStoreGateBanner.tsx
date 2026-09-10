/**
 * 兰琪页面通用的「门店可用性」提示条（LQ-20，修 WorkBuddy 报告 Bug7/8/9）。
 *
 * 只在**不能生成**时出现，把三件事一次说清：
 * ① 现在是什么状态（未开通 / 已到期 / 无权限 / 没有门店 / 读取失败）；
 * ② 为什么生成按钮点不了（直接显示 `blockedReason`，不再是「按钮灰着但没说原因」）；
 * ③ 去哪解决（CTA：用邀请码登录 / 去完善门店档案 / 返回驾驶舱 / 重试）。
 *
 * 能正常生成时返回 `null`，不占版面。
 */
import { getAppPath } from "../../lib/api.js";
import type { LanqiStoreGate } from "../../lib/lanqi-store-gate.js";

export interface LanqiStoreGateBannerProps {
  gate: LanqiStoreGate;
  onRetry?: () => void;
}

export function LanqiStoreGateBanner({ gate, onRetry }: LanqiStoreGateBannerProps) {
  if (gate.kind === "ready") return null;

  const tone = gate.kind === "error" && gate.reason !== "network" ? "blocked" : gate.kind === "empty" ? "empty" : "info";
  const icon = tone === "blocked" ? "🚫" : tone === "empty" ? "🏪" : "⏳";

  return (
    <div className={`lq-gate lq-gate--${tone}`} role="status" data-lanqi-gate={gate.kind}>
      <div className="lq-gate__head">
        <span className="lq-gate__icon" aria-hidden="true">{icon}</span>
        <div className="lq-gate__text">
          <b className="lq-gate__headline">{gate.headline}</b>
          <span className="lq-gate__detail">{gate.detail}</span>
        </div>
      </div>
      <p className="lq-gate__reason" data-lanqi-gate-reason>{gate.blockedReason}</p>
      {(gate.cta || gate.secondaryCta || (gate.kind === "error" && gate.retry)) && (
        <div className="lq-gate__actions">
          {gate.cta && <a className="lq-gate__cta" href={getAppPath(gate.cta.href)}>{gate.cta.label}</a>}
          {gate.secondaryCta && (
            <a className="lq-gate__cta lq-gate__cta--ghost" href={getAppPath(gate.secondaryCta.href)}>
              {gate.secondaryCta.label}
            </a>
          )}
          {gate.kind === "error" && gate.retry && (
            <button className="lq-gate__cta lq-gate__cta--ghost" type="button" onClick={onRetry}>
              重新读取门店
            </button>
          )}
        </div>
      )}
    </div>
  );
}
