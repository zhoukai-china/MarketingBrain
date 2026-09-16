/**
 * 回跳参数（`next=`）的安全取值：**只放行站内绝对路径**。
 *
 * 背景（2026-09-16）：余额不足时对话页把客户送到充值页，并带 `next` 说明「充完回哪」。
 * 这类参数一旦原样交给 `window.location`，就是一个开放跳转（钓鱼/白标投放会用它把客户带去站外）。
 * 所以这里用白名单：必须以单个 `/` 开头，且不含反斜杠 / 空白 / 冒号；其余一律返回空串（调用方视为没有回跳）。
 *
 * 注：应用前缀（如 `/os-v2/`、`/lanqi-test/`）由 `getAppPath()` 负责补，这里存的始终是**去掉前缀的站内路由**，
 * 否则前缀会被拼两遍。
 */
export function toSafeAppRoute(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  if (/[\\\s]/.test(raw)) return "";
  if (raw.includes(":")) return "";
  return raw;
}
