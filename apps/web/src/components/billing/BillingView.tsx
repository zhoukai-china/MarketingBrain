import { useState } from "react";
import { apiPath } from "../../lib/api";
import type { CreditPackCode } from "../../types";

interface BillingViewProps {
  token: string;
  headers: Record<string, string>;
  onNeedLogin: () => void;
}

interface BillingOrderResponse {
  order?: { id: string; codeUrl?: string };
  error?: string;
  message?: string;
}

const creditPacks: Array<{
  code: CreditPackCode;
  title: string;
  price: number;
  credits: number;
  bonus: number;
  description: string;
}> = [
  { code: "pack_50", title: "试试看", price: 50, credits: 1000, bonus: 0, description: "起充档，零赠送" },
  { code: "pack_100", title: "够用一阵", price: 100, credits: 2200, bonus: 200, description: "多送 200 积分" },
  { code: "pack_300", title: "常用", price: 300, credits: 7000, bonus: 1000, description: "多送 1000 积分" },
  { code: "pack_500", title: "重度", price: 500, credits: 12000, bonus: 2000, description: "多送 2000 积分" },
  { code: "pack_1000", title: "团队年用", price: 1000, credits: 25000, bonus: 5000, description: "多送 5000 积分" }
];

export function BillingView({ token, headers, onNeedLogin }: BillingViewProps) {
  const [busyCode, setBusyCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  const [error, setError] = useState("");

  async function createOrder(creditPackCode: CreditPackCode) {
    if (!token) {
      onNeedLogin();
      return;
    }

    setBusyCode(creditPackCode);
    setError("");
    setQrSrc("");
    try {
      const res = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_pack", creditPackCode })
      });
      const data = (await res.json()) as BillingOrderResponse;
      if (!res.ok || data.error || !data.order?.id) {
        setError(data.message ?? "下单失败，请稍后重试");
        return;
      }
      setQrSrc(apiPath(`/billing/orders/${data.order.id}/wechat-qr.svg`));
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusyCode("");
    }
  }

  return (
    <div className="billingPage">
      <section className="billingHero billingHeroCompact">
        <div>
          <p className="goldLabel">积分制使用</p>
          <h1>不收月费，只按实际调用扣积分</h1>
          <p>所有已上线智能体和基础能力均可使用。每次执行按实际消耗积分扣除；积分不足时再充值，没有月度订阅、没有 30 天使用权。</p>
        </div>
        <div className="billingHeroStats">
          <strong>算力成本 × 10 定价</strong>
          <span>例如：实际算力成本 1 元，用户支付 10 元；当前 1 积分对应 0.01 元算力成本。</span>
        </div>
      </section>

      {error && <div className="diagnosisError billingNotice">{error}</div>}
      {qrSrc && (
        <div className="billingQrBox">
          <p>请使用微信扫码支付，到账后积分立即可用。</p>
          <img src={qrSrc} alt="微信支付二维码" />
        </div>
      )}

      <section className="diagnosisCard billingPlanCard">
        <span className="goldLabel">购买积分</span>
        <h3>按需充值，用多少算多少</h3>
        <p>价格固定按实际算力成本的 10 倍计算；智能体访问权限不再按月收费。</p>
        <div className="billingRuleBox">
          <strong>计费规则</strong>
          <span>积分只在实际执行智能体、生成内容或分析资料时扣除；连接知识库、管理资料和配置自动化不收月费。</span>
          <span>系统会在每次执行结果中展示本次消耗积分；余额不足时会先提示充值，不会继续扣费。</span>
        </div>
        <div className="billingOfferList">
          {creditPacks.map((pack) => (
            <button
              key={pack.code}
              type="button"
              onClick={() => void createOrder(pack.code)}
              disabled={Boolean(busyCode)}
            >
              <strong>{pack.title} · ¥{pack.price} = {pack.credits} 积分{pack.bonus > 0 ? `（多送 ${pack.bonus}）` : ""}</strong>
              <span>{busyCode === pack.code ? "正在创建支付订单…" : pack.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
