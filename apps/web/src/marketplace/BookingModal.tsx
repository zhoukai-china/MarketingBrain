// 商品/专区预约弹窗（F3-F7 未上线功能：留手机号预约上线提醒，POST /market/bookings）。
// 表单态 → 成功态；同手机号 + 同商品幂等（后端去重，重复提交提示已预约）。

import { useState } from "react";
import { apiPath } from "../lib/api.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { IconGlyph } from "./IconGlyph.js";

export function BookingModal({
  open,
  productName,
  productKey,
  source = "mall",
  onClose
}: {
  open: boolean;
  productName: string;
  productKey: string;
  source?: string;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState("");

  // 弹窗打开时锁背景滚动（2026-09-29 用户要求：任何弹窗背景都要固定）。
  useScrollLock(open);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiPath("/market/bookings"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, productKey, productName, source })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "提交失败，请稍后再试");
        return;
      }
      setAlready(Boolean(data.already));
      setDone(true);
    } catch {
      setError("网络异常，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="eh-bk-mask" onClick={onClose}>
      <div className="eh-cd-sheet eh-bk-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="eh-rd-x eh-cd-x" onClick={onClose}>✕</button>

        {done ? (
          <div className="eh-bk-done">
            <div className="eh-bk-done-ico"><IconGlyph name="check" size={30} /></div>
            <b>{already ? "您已预约过啦" : "预约成功"}</b>
            <p>
              「{productName}」上线后我们会第一时间<b>短信通知</b>您（{phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}），
              请留意查收。
            </p>
            <button type="button" className="eh-bk-btn" onClick={onClose}>好的，期待上线</button>
          </div>
        ) : (
          <>
            <div className="eh-bk-head">
              <div className="eh-bk-ico"><IconGlyph name="bolt" size={22} /></div>
              <div>
                <b>预约「{productName}」</b>
                <span>功能打磨中 · 留手机号，上线第一时间通知您</span>
              </div>
            </div>
            <div className="eh-bk-form">
              <input
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="请输入手机号"
                aria-label="手机号"
              />
              <button type="button" disabled={busy || phone.length !== 11} onClick={() => void submit()}>
                {busy ? "提交中…" : "确认预约"}
              </button>
            </div>
            {error ? <div className="eh-bk-err">{error}</div> : null}
            <div className="eh-bk-notes">
              <span>· 仅用于上线通知，不做其他用途</span>
              <span>· 上线后预约用户可享首发权益</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
