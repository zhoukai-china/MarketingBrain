/**
 * 把异步错误变成门店看得懂的中文（QA-20260913-005，WorkBuddy 内测报告 #9）。
 *
 * 现场：断网时页面把 fetch 的原始英文 Failed to fetch 直接显示给门店，既不是人话、
 * 也没有重试指引。这里统一收口：
 *   · 网络类 / 超时类异常 → 中文人话 + 明确的「重新生成」重试指引（输入本来就会保留）；
 *   · 已经是中文的业务提示（合规门禁、参数不足等）→ 原样保留，不覆盖；
 *   · 其余英文/未知异常 → 用中文兜底，绝不把原始英文异常抛给门店。
 */
const NETWORK_PATTERNS = [/failed to fetch/i, /load failed/i, /networkerror/i, /network error/i, /fetch failed/i, /err_connection/i, /\boffline\b/i];
const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /time out/i, /\babort(ed)?\b/i];
const RETRY_HINT = "点「🔄 重新生成」再试一次，刚才填的内容不会丢。";

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fa5]/.test(value);
}

export function humanizeAsyncError(
  error: unknown,
  fallback = "这次没生成出来，请稍后重试。",
  retryHint = RETRY_HINT
): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || TIMEOUT_PATTERNS.some((pattern) => pattern.test(message))) {
    return `这次等太久了（网络慢或服务忙），没拿到结果。${retryHint}`;
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(message))) {
    return `网络开小差了，没连上服务器。检查一下网络，${retryHint}`;
  }
  if (message && hasChinese(message)) return message;
  return fallback;
}

/**
 * 充值 / 账单页的错误文案（QA-20260914-001，WorkBuddy 新用户链路验收报告 P1 + P2）。
 *
 * 现场：合成 500 时页面直出英文 `mock server error`；断网时直出 `Failed to fetch`。
 * 旧实现只在「整串都是 [a-z0-9_:-]」这种无空格机器码时才回落中文兜底，
 * 带空格的英文句子必然漏出去——所以这里不再判断"像不像码"，改判"有没有中文"。
 *
 * 顺序：已知业务码 → 固定中文；其余交给统一的异步错误人话化（网络 / 超时 / 未知英文）；
 * 服务端已经返回的中文提示原样保留。
 */
const BILLING_RETRY_HINT = "请重试；仍然失败请稍后再试或联系客服。";

export function billingErrorCopy(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  if (/insufficient_credits/.test(message)) return "企业积分不足，请先充值后再使用。";
  if (/login_required|membership_not_found|missing_tenant_or_user/.test(message)) return "请先完成登录。";
  return humanizeAsyncError(reason, fallback, BILLING_RETRY_HINT);
}
