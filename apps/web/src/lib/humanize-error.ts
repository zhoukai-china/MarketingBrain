/**
 * 把异步错误变成门店看得懂的中文（QA-20260913-001，WorkBuddy 内测报告 #9）。
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

export function humanizeAsyncError(error: unknown, fallback = "这次没生成出来，请稍后重试。"): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || TIMEOUT_PATTERNS.some((pattern) => pattern.test(message))) {
    return `这次等太久了（网络慢或服务忙），没拿到结果。${RETRY_HINT}`;
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(message))) {
    return `网络开小差了，没连上服务器。检查一下网络，${RETRY_HINT}`;
  }
  if (message && hasChinese(message)) return message;
  return fallback;
}
