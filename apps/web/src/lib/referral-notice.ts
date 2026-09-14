/**
 * 「你已有工作区，不产生推荐关系」的一次性提示（PLAT-28 第①批补充，用户 2026-09-12 要求）。
 *
 * 背景：被推荐人只有**首次开通工作区**时才会建立推荐关系（`ReferralBinding`）。
 * 已有工作区的老账号带着推荐码登录时，服务端直接给它登录，不会（也不该）产生归因——
 * 但页面上什么都不说，老板就会以为「推荐坏了」，每次都要靠后台日志解释。
 *
 * 做法：登录侧（LoginPage / WeChatCallback）在「老账号成功登录且手上带着推荐码」时打标，
 * 落地页（货架首页）读一次并展示，用户点「知道了」后清除（sessionStorage，同标签页一次性）。
 */
const REFERRAL_EXISTING_NOTICE_KEY = "store_os_referral_existing_notice";

export function markExistingUserReferralNotice(): void {
  try {
    sessionStorage.setItem(REFERRAL_EXISTING_NOTICE_KEY, "1");
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用：提示丢了不影响登录 */
  }
}

export function readExistingUserReferralNotice(): boolean {
  try {
    return sessionStorage.getItem(REFERRAL_EXISTING_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearExistingUserReferralNotice(): void {
  try {
    sessionStorage.removeItem(REFERRAL_EXISTING_NOTICE_KEY);
  } catch {
    /* ignore */
  }
}
