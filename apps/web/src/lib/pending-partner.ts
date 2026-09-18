/**
 * 市场合伙人专属链接码（PLAT-48）的跨授权往返暂存。
 *
 * 与 `pending-referral.ts` 的推荐码机制完全平行，只是参数名不同（`?partner=` vs `?ref=`）。
 * 推荐有礼与市场合伙人是两套归因，互不影响。
 */

const PENDING_PARTNER_SESSION_KEY = "store_os_pending_partner";
const PENDING_PARTNER_LOCAL_KEY = "store_os_pending_partner_v2";
const PENDING_PARTNER_TTL_MS = 24 * 60 * 60 * 1000;

export function rememberPendingPartner(code: string | null | undefined): void {
  const normalized = (code ?? "").trim();
  if (!normalized) {
    clearPendingPartner();
    return;
  }
  try {
    sessionStorage.setItem(PENDING_PARTNER_SESSION_KEY, normalized);
  } catch {
    /* 隐私模式：跳过，靠 localStorage 或 URL */
  }
  try {
    localStorage.setItem(PENDING_PARTNER_LOCAL_KEY, JSON.stringify({ code: normalized, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readPendingPartner(): string {
  try {
    const fromSession = (sessionStorage.getItem(PENDING_PARTNER_SESSION_KEY) ?? "").trim();
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(PENDING_PARTNER_LOCAL_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!code) return "";
    if (!at || Date.now() - at > PENDING_PARTNER_TTL_MS) {
      localStorage.removeItem(PENDING_PARTNER_LOCAL_KEY);
      return "";
    }
    return code;
  } catch {
    return "";
  }
}

export function clearPendingPartner(): void {
  try {
    sessionStorage.removeItem(PENDING_PARTNER_SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_PARTNER_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
