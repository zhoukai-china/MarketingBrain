import { env } from "../config/env.js";

/**
 * 运维 / 老板通知（企业微信机器人）。
 *
 * 2026-09-16 用户：「用户付费了我咋样才能知道呢？也给我推送到企业微信吧（跟服务器空间不足预警推送一样）」。
 * 复用**同一条**告警通道：`scripts/ops/disk-alert.sh` 用的 `SITONG_ALERT_WEBHOOK`（企业微信机器人 webhook），
 * 所以老板只要已经收到过磁盘告警，就说明这条链路是通的。
 *
 * 原则：
 *   - **只发通知，绝不影响主流程**：网络失败 / 未配置 webhook 都只写日志，绝不抛出（付费入账不能因为通知失败而回滚）；
 *   - 不打印 webhook 地址本身，也不发任何密钥；
 *   - 文案里只放**经营需要的信息**（客户名、金额、积分、余额），不放客户内容与凭据。
 */
export function isOpsAlertConfigured(): boolean {
  return Boolean(env.SITONG_ALERT_WEBHOOK);
}

export async function notifyOps(message: string): Promise<boolean> {
  const webhook = env.SITONG_ALERT_WEBHOOK;
  if (!webhook) {
    console.warn("[ops-alert] SITONG_ALERT_WEBHOOK 未配置，通知只写日志: " + message);
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: message } }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(`[ops-alert] 通知发送失败（HTTP ${response.status}）: ${message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[ops-alert] 通知发送异常（${error instanceof Error ? error.message : "unknown"}）: ${message}`);
    return false;
  }
}

/** 充值到账通知：客户充值成功后推给老板，一眼看到「谁、多少钱、多少积分、现在还剩多少」。 */
export function buildRechargeNotice(params: {
  tenantName: string;
  userName?: string | null;
  amountCny: number;
  basePts: number;
  bonusPts: number;
  balance: number;
  method?: string | null;
  orderId?: string | null;
}): string {
  const bonus = params.bonusPts > 0 ? `（含多送 ${params.bonusPts}）` : "";
  return [
    "【思潼AI增长OS · 客户充值到账】",
    `客户：${params.tenantName}${params.userName ? `（${params.userName}）` : ""}`,
    `金额：¥${params.amountCny}`,
    `到账：${params.basePts + params.bonusPts} 积分${bonus}`,
    `该客户当前余额：${params.balance} 积分`,
    params.method ? `支付方式：${params.method}` : "",
    params.orderId ? `订单：${params.orderId}` : "",
    "（后台「客户」页可看每个客户的充值 / 消耗 / 剩余与常用智能体）"
  ]
    .filter(Boolean)
    .join("\n");
}
