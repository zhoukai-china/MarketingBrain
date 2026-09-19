import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PRODUCT_LOGIN_DEFINITIONS,
  type ProductLoginCode,
  type TenantType,
} from "@baolu/shared";
import { apiBase, apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { markExistingUserReferralNotice } from "../lib/referral-notice.js";
import { clearPendingReferral, readPendingReferral, rememberPendingReferral } from "../lib/pending-referral.js";
import {
  DEFAULT_TENANT_BRANDING,
  tenantBrandLogoSrc,
  usePublicTenantBranding,
} from "../lib/tenant-branding.js";

type TenantRole = TenantType;
export type LoginEntry = ProductLoginCode | "generic" | "internal";

interface LoginPageProps {
  mode: "dev" | "production";
  entry: LoginEntry;
  onLogin: (result: LoginResult) => void;
}

export interface LoginResult {
  token: string;
  tenantId: string;
  userId: string;
  tenantRole: TenantRole;
  tenantName: string;
  planCode: string;
  dataMode: string;
  diagnosisRequired: boolean;
}

const ROLE_OPTIONS: Array<{ value: TenantRole; label: string; desc: string }> = [
  { value: "personal_ip", label: "个人 IP / OPC", desc: "单人创业者、创始人 IP、专家 IP" },
  { value: "local_business", label: "本地单店商家", desc: "餐饮、美业、教育、本地生活服务" },
  { value: "chain_brand", label: "连锁品牌", desc: "多门店、区域连锁、招商加盟企业" },
];

const postLoginRedirectKey = "store_os_post_login_redirect";
const productLoginSessionKey = "store_os_product_login_code";
/**
 * 首次开通时，老板在登录页填过的产品邀请码必须在微信授权过程中留住。
 *
 * QA-20260912-013 的真实现场：兰琪入口「先扫码 → 被判定新用户 → 前端把页面 replace 回
 * /login/lanqi 补资料」，但这一步会丢掉刚填的邀请码，老板看到的就是「扫码成功了，怎么还
 * 要邀请码」，于是进不去。这里把码暂存在 sessionStorage（同一浏览器同一标签页），
 * 授权回来补资料时再带上、并自动核验，老板只需要补门店名称。
 */
const pendingInviteKey = "store_os_pending_invite";
function rememberPendingInvite(code: string): void {
  const normalized = (code ?? "").trim();
  if (normalized) sessionStorage.setItem(pendingInviteKey, normalized);
  else sessionStorage.removeItem(pendingInviteKey);
}
function readPendingInvite(): string {
  return sessionStorage.getItem(pendingInviteKey) ?? "";
}
/**
 * PLAT-28 推荐有礼：推荐链接形如 `/login?ref=ref-xxxxxxxx`。
 *
 * 推荐码与产品邀请码是两码事（邀请码是**开通资格**，推荐码是**归因来源**），
 * 所以单独存一个键，互不覆盖。微信授权会跳走再回来（同标签页），sessionStorage 能留住它；
 * 补资料页提交开通时再带上，服务端在注册落库后异步核对归因。
 */
function previewReferralCode(code: string): string {
  const normalized = code.trim();
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 6)}****${normalized.slice(-2)}`;
}

const onboardingTokenKey = "store_os_onboarding_token";
/**
 * 「刚清掉一个过期授权」的提示标记（sessionStorage，同标签页有效）。
 * 用独立键而不是 useState 里的对象，是因为 React StrictMode 会双调用 useState 初始化函数：
 * 第一次调用完成清理，第二次调用就读不到「过期」这件事，提示就会丢（本地 dev 实测）。
 */
const onboardingExpiredNoticeKey = "store_os_onboarding_expired_notice";

/** 读取 JWT 的 exp（只用于前端体验判断，不做任何安全判定——真伪一律由服务端验签）。 */
function readJwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * 读取本机「微信授权后补资料」令牌。
 *
 * 过期/损坏的必须当场清掉：否则登录页会把自己渲染成「完成注册，开通你的工作区」，
 * 把「微信一键登录 / 注册」入口藏起来；用户填完表单只会一直撞
 * 401 `invalid_onboarding_token`，点「再试一次」永远失败，无路可走。
 * 2026-09-12 生产真机实测就是这个现场（老板截图：企业/品牌名称填「蓝测」→ 401，连点 7 次）。
 */
function readUsableOnboardingToken(): string {
  const raw = localStorage.getItem(onboardingTokenKey) ?? "";
  if (!raw) return "";
  const expiry = readJwtExpiry(raw);
  if (!expiry || expiry * 1000 <= Date.now()) {
    localStorage.removeItem(onboardingTokenKey);
    sessionStorage.setItem(onboardingExpiredNoticeKey, "1");
    return "";
  }
  return raw;
}

function readOnboardingExpiredNotice(): boolean {
  return sessionStorage.getItem(onboardingExpiredNoticeKey) === "1";
}
const PRODUCT_REDIRECT_PREFIXES: Record<ProductLoginCode, readonly string[]> = {
  "founder-ip": ["/agents/acquisition"],
  takeaway: ["/agents/takeaway-growth"],
  lanqi: ["/lanqi"],
  "beauty-industry": ["/agents/beauty-industry"],
};

function isRedirectForProduct(value: string | null, productCode: ProductLoginCode): boolean {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  const path = getAppRoutePath(value.split(/[?#]/, 1)[0] ?? "");
  return PRODUCT_REDIRECT_PREFIXES[productCode].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 微信内置浏览器才允许直接跳 oauth2；电脑端和普通手机浏览器会撞上「请在微信客户端打开链接」死页。 */
function wechatInAppBrowser(): boolean {
  try {
    return /MicroMessenger/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** 电脑端扫码登录会话（PLAT-13）：二维码 + 一次性取结果的凭据。 */
interface WechatQrState {
  id: string;
  secret: string;
  qrSrc: string;
  expiresAt: number;
  /** 过期后二维码块继续留在页面上（用户还需要点「刷新二维码」），只是不能再扫。 */
  expired: boolean;
}

export default function LoginPage({ mode, entry, onLogin }: LoginPageProps) {
  const publicBrand = usePublicTenantBranding();
  const branding = publicBrand.matched ? publicBrand.branding : DEFAULT_TENANT_BRANDING;
  const product = entry !== "generic" && entry !== "internal" ? PRODUCT_LOGIN_DEFINITIONS[entry] : null;
  const [role, setRole] = useState<TenantRole>("local_business");
  const [tenantName, setTenantName] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
  // PLAT-28：推荐码只来自推荐链接（`?ref=`），不提供手工输入框（手工填码属于后台口径，不是用户路径）。
  const [referralCode] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? "");
  const [inviteValidated, setInviteValidated] = useState(false);
  const [wechatReady, setWechatReady] = useState<boolean | null>(null);
  // 是否强制邀请码由服务端开关决定（INVITE_REQUIRED）。null = 还没问回来，
  // 此时按「要邀请码」处理，避免配置没到手就先把注册放开。
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [inviteFallbackOpen, setInviteFallbackOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retryReady, setRetryReady] = useState(false);
  const [wechatQr, setWechatQr] = useState<WechatQrState | null>(null);
  const loginInFlight = useRef(false);
  // 轮询 effect 只依赖二维码本身，避免父组件重渲染把定时器反复重置。
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;
  const productCodeRef = useRef<string | undefined>(undefined);
  productCodeRef.current = product?.code;
  const isProduction = mode === "production";
  const isCustomDomain = publicBrand.matched;
  const showWechatLogin = isCustomDomain || !isProduction || Boolean(import.meta.env.VITE_WECHAT_AUTH_APPID);
  const brandLogo = tenantBrandLogoSrc(branding);
  const internalEntry = entry === "internal";
  const directTestLogin = import.meta.env.VITE_DIRECT_TEST_LOGIN === "true";
  const [onboardingToken, setOnboardingToken] = useState(() => readUsableOnboardingToken());
  const [onboardingExpired, setOnboardingExpired] = useState(() => readOnboardingExpiredNotice());
  /** 令牌过期/被服务端拒绝时统一收口：清本地 + 恢复登录入口 + 说明原因。 */
  const clearOnboardingToken = (expired = true) => {
    localStorage.removeItem(onboardingTokenKey);
    setOnboardingToken("");
    if (expired) {
      sessionStorage.setItem(onboardingExpiredNoticeKey, "1");
      setOnboardingExpired(true);
    } else {
      sessionStorage.removeItem(onboardingExpiredNoticeKey);
      setOnboardingExpired(false);
    }
  };

  useEffect(() => {
    document.title = `${product?.name ?? branding.systemName} - 登录 / 注册`;
  }, [branding.systemName, product?.name]);

  useEffect(() => {
    if (referralCode.trim()) rememberPendingReferral(referralCode);
  }, [referralCode]);

  useEffect(() => {
    if (isCustomDomain) return;
    let cancelled = false;
    void fetch(`${apiBase}/auth/wechat-config`, { method: "GET" })
      .then((res) => (res.ok ? res.json() : null))
      .then((config: { configured?: boolean; inviteRequired?: boolean } | null) => {
        if (cancelled) return;
        setWechatReady(Boolean(config?.configured));
        if (typeof config?.inviteRequired === "boolean") setInviteRequired(config.inviteRequired);
      })
      .catch(() => {
        if (!cancelled) setWechatReady(false);
      });
    return () => { cancelled = true; };
  }, [isCustomDomain]);

  useEffect(() => {
    if (product) {
      setRole(product.tenantRole);
      const existingRedirect = localStorage.getItem(postLoginRedirectKey);
      if (!isRedirectForProduct(existingRedirect, product.code)) {
        localStorage.setItem(postLoginRedirectKey, getAppPath(product.defaultPath));
      }
    }
  }, [product]);

  // 扫码开通回来会带上 ?invite=<邀请码>：这里自动核验一次，让老板直接落到「门店资料」表单，
  // 不用再手填一遍邀请码（QA-20260912-013）。只自动试一次，失败仍由用户手动重试。
  const autoInviteTried = useRef(false);
  useEffect(() => {
    if (!product || product.code === "lanqi" || inviteValidated || autoInviteTried.current) return;
    const fromQuery = new URLSearchParams(window.location.search).get("invite") ?? "";
    if (!fromQuery.trim()) return;
    autoInviteTried.current = true;
    void submitProductInviteCode(fromQuery);
  }, [product, inviteValidated]);

  // 电脑端：轮询扫码会话，拿到手机授权后的登录结果并就地完成登录。
  useEffect(() => {
    if (!wechatQr || wechatQr.expired) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > wechatQr.expiresAt) {
        setWechatQr((prev) => (prev ? { ...prev, expired: true } : prev));
        return;
      }
      try {
        const res = await fetch(apiPath(
          `/auth/wechat-bridge/status?id=${encodeURIComponent(wechatQr.id)}&secret=${encodeURIComponent(wechatQr.secret)}`
        ));
        const data = (await res.json().catch(() => ({}))) as {
          state?: string;
          ok?: boolean;
          message?: string;
          login?: {
            token?: string;
            tenantId?: string;
            userId?: string;
            tenantName?: string;
            needsTenant?: boolean;
            onboardingToken?: string;
            plan?: { planCode?: string };
            dataMode?: string;
            diagnosisRequired?: boolean;
          };
        };
        if (cancelled) return;
        if (res.status === 404 || res.status === 410) {
          setWechatQr((prev) => (prev ? { ...prev, expired: true } : prev));
          return;
        }
        if (!res.ok || data.state !== "completed") return;
        setWechatQr(null);
        if (data.ok !== true) {
          setError(typeof data.message === "string" && data.message ? data.message : "微信授权失败，请重新扫码。");
          return;
        }
        const login = data.login ?? {};
        if (login.needsTenant) {
          // 新用户还没工作区：沿用手机端直连的行为，去补资料页完成开通。
          localStorage.setItem(onboardingTokenKey, login.onboardingToken ?? "");
          setOnboardingToken(login.onboardingToken ?? "");
          sessionStorage.removeItem(onboardingExpiredNoticeKey);
          setOnboardingExpired(false);
          const code = productCodeRef.current;
          // 带上刚填的邀请码：否则老板会看到「扫码成功了却还要邀请码」的死循环。
          const target = getAppPath(code ? `/login/${code}` : "/login");
          const pendingInvite = readPendingInvite();
          const pendingReferral = readPendingReferral();
          // 回跳的 URL 也要带上推荐码：微信授权往返有可能换 webview / 丢存储，URL 是最稳的那一层。
          const query = [
            pendingInvite ? `invite=${encodeURIComponent(pendingInvite)}` : "",
            pendingReferral ? `ref=${encodeURIComponent(pendingReferral)}` : ""
          ].filter(Boolean).join("&");
          window.location.replace(query ? `${target}?${query}` : target);
          return;
        }
        if (!login.token) {
          setError("微信登录未返回登录凭证，请重新扫码。");
          return;
        }
        // 老账号带着推荐码登录：只有「首次开通工作区」才会建立推荐关系，这里给落地页留一句提示。
        if (readPendingReferral()) markExistingUserReferralNotice();
        localStorage.setItem("store_os_token", login.token);
        onLoginRef.current({
          token: login.token,
          tenantId: login.tenantId ?? "",
          userId: login.userId ?? "",
          tenantRole: login.plan?.planCode?.startsWith("chain") ? "chain_brand"
            : login.plan?.planCode?.startsWith("ip") ? "personal_ip"
            : "local_business",
          tenantName: login.tenantName ?? "",
          planCode: login.plan?.planCode ?? "local_standard",
          dataMode: login.dataMode ?? "database",
          diagnosisRequired: login.diagnosisRequired ?? true,
        });
      } catch {
        // 网络抖动：下一轮再试，不打断用户。
      }
    };

    const timer = window.setInterval(() => { void poll(); }, 2000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wechatQr]);

  function clearFeedback() {
    setError("");
    setStatus("");
    setRetryReady(false);
  }

  /**
   * 微信内打开：保持原来的直接跳转授权（这是微信唯一放行的方式）。
   * 其它环境（电脑、普通手机浏览器）：不再跳 oauth2 撞「请在微信客户端打开链接」死页，
   * 改成当场显示二维码，用手机微信扫码完成授权，结果回填到这台电脑。
   */
  async function handleWechatLogin() {
    if (wechatInAppBrowser()) {
      await startInAppWechatLogin();
      return;
    }
    await startWechatQrLogin();
  }

  async function startInAppWechatLogin() {
    setBusy(true);
    clearFeedback();
    setStatus("正在打开微信授权...");
    try {
      const res = await fetch(`${apiBase}/auth/wechat-config`, { method: "GET" });
      if (!res.ok) throw new Error("微信登录暂未配置，请使用邀请码开通或联系服务团队。");
      const config = (await res.json()) as { appid?: string };
      const appId = config.appid ?? (import.meta.env.VITE_WECHAT_AUTH_APPID as string | undefined);
      if (!appId) throw new Error("微信登录缺少 AppID，请联系服务团队。");

      // 把推荐码塞进微信 `state`：微信会原样回传，即使中途丢了 URL 或浏览器存储，
      // 回调页也能把码找回来（2026-09-13 真机实测：货架→登录那一跳会丢 ?ref=）。
      const pendingReferralForState = readPendingReferral();
      const state = pendingReferralForState
        ? `${crypto.randomUUID()}|${pendingReferralForState}`
        : crypto.randomUUID();
      sessionStorage.setItem("wechat_oauth_state", state);
      // 微信内打开也要留住邀请码：授权回跳落 /wechat-callback，同样会走「补资料」分支。
      rememberPendingInvite(inviteCode);
      if (product) sessionStorage.setItem(productLoginSessionKey, product.code);
      else sessionStorage.removeItem(productLoginSessionKey);
      if (isCustomDomain) sessionStorage.setItem("wechat_tenant_hostname", publicBrand.hostname);
      else sessionStorage.removeItem("wechat_tenant_hostname");

      const redirectUri = (import.meta.env.VITE_WECHAT_AUTH_REDIRECT_URI as string | undefined)
        ?? `${window.location.origin}${getAppPath("/wechat-callback")}`;
      window.location.href = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_userinfo&state=${encodeURIComponent(state)}#wechat_redirect`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "微信登录请求失败，请稍后重试。");
      setStatus("");
      setBusy(false);
    }
  }

  /** 生成一次性扫码会话 + 二维码；二维码内容是本站在 `/wechat-bridge` 上的中转页。 */
  async function startWechatQrLogin() {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    setBusy(true);
    clearFeedback();
    setStatus("正在生成登录二维码...");
    // 扫码前填了邀请码就先留住：扫码结果若是「新用户要补资料」，
    // 回跳时会带上它并自动核验，老板不用再填一遍（QA-20260912-013）。
    rememberPendingInvite(inviteCode);
    try {
      const res = await fetch(apiPath("/auth/wechat-bridge/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(product ? { productCode: product.code } : {}),
          ...(isCustomDomain ? { tenantHostname: publicBrand.hostname } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        secret?: string;
        ttlSeconds?: number;
        message?: string;
      };
      if (!res.ok || !data.id || !data.secret) {
        throw new Error(data.message ?? "生成登录二维码失败，请稍后重试。");
      }
      // 二维码指向本站中转页；同一份代码要同时服务 /os-v2/ 与 /lanqi-test/，
      // 所以地址由前端按当前站点拼，不依赖服务端配置。
      const scanUrl = new URL(getAppPath("/wechat-bridge"), window.location.origin);
      scanUrl.searchParams.set("b", data.id);
      scanUrl.searchParams.set("s", data.secret);
      const ttlSeconds = Number(data.ttlSeconds) > 0 ? Number(data.ttlSeconds) : 300;
      setWechatQr({
        id: data.id,
        secret: data.secret,
        qrSrc: apiPath(`/auth/wechat-bridge/qrcode?u=${encodeURIComponent(scanUrl.toString())}`),
        expiresAt: Date.now() + ttlSeconds * 1000,
        expired: false,
      });
      setStatus("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成登录二维码失败，请稍后重试。");
      setStatus("");
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * 产品邀请码核验（表单提交 + 「扫码开通回来」自动核验共用同一条实现）。
   * QA-20260912-013：以前只有表单这一条入口，扫码回来自动核对的需求只能手填，
   * 于是老板扫码成功后仍被要求「再填一次邀请码」。
   */
  async function submitProductInviteCode(rawCode: string) {
    if (!product || loginInFlight.current) return;
    // Bug4（WorkBuddy 2026-09-10）：以前这里靠原生 required 拦空值，
    // 浏览器只弹一个「请填写此字段」的气泡，用户看到的是「按钮没反应」。
    // 表单已加 noValidate，空值一律走这条中文提示。
    const normalizedInvite = rawCode.trim();
    if (!normalizedInvite) {
      setError("请输入邀请消息中的邀请码。");
      setRetryReady(true);
      return;
    }
    loginInFlight.current = true;
    setBusy(true);
    clearFeedback();
    setStatus("正在核对产品邀请码...");
    try {
      const res = await fetch(`${apiBase}/auth/product-invite/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: product.code, inviteCode: normalizedInvite }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) throw new Error(data.message ?? data.error ?? "邀请码验证失败。");
      setInviteValidated(true);
      setStatus("邀请码有效，请完成工作区资料。");
    } catch {
      // 2026-09-17 起取消邀请码制度；老链接里带的无效邀请码不再挡注册，丢掉并直接开通。
      setInviteCode("");
      setStatus("链接里的邀请码已失效，已忽略；可直接开通，不影响注册。");
      setRetryReady(false);
      clearFeedback();
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    if (loginInFlight.current) return;
    const normalizedTenantName = tenantName.trim();
    if (!normalizedTenantName) {
      setError("请输入有效的企业、品牌或门店名称，不能只填写空格。");
      setRetryReady(true);
      return;
    }
    // 2026-09-17 用户口径：取消兰琪邀请码制度，所有产品入口都不再强制邀请码。
    // 平台主入口是否还要码由服务端开关 INVITE_REQUIRED 决定（随 wechat-config 下发）。
    const invitesNeeded = product ? false : (isProduction && inviteRequired !== false);
    if (invitesNeeded && !inviteCode.trim()) {
      setError("请输入邀请码。");
      setRetryReady(true);
      return;
    }

    loginInFlight.current = true;
    setBusy(true);
    clearFeedback();
    setStatus("正在创建你的专属工作区...");
    const useOnboarding = Boolean(onboardingToken);
    const useBetaLogin = isProduction || Boolean(product);
    try {
      const endpoint = useOnboarding ? "/auth/onboarding/create-workspace" : useBetaLogin ? "/auth/beta-login" : "/auth/dev-login";
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantRole: product?.tenantRole ?? role,
          planCode: product?.planCode,
          productCode: product?.code,
          onboardingToken: useOnboarding ? onboardingToken : undefined,
          tenantName: normalizedTenantName,
          industry: product?.code === "beauty-industry" ? "美业" : industry.trim() || undefined,
          city: city.trim() || undefined,
          inviteCode: useBetaLogin && product?.code !== "lanqi" ? inviteCode.trim() : undefined,
          referralCode: readPendingReferral() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // 授权过期是「可恢复」的业务失败：清掉死令牌、把登录入口还给用户，不能让「再试一次」永远失败。
        if (data.error === "invalid_onboarding_token") {
          clearOnboardingToken();
          throw new Error("上次的微信授权已过期（30 分钟有效），请点下面「微信一键登录 / 注册」重新授权。");
        }
        throw new Error(data.message ?? data.error ?? "登录失败，请检查信息后重试。");
      }

      // 同理：带着推荐码但本次并没有产生归因（服务端未返回 bound），说明这是已有工作区的老账号。
      if (readPendingReferral() && (data as { referral?: { state?: string } }).referral?.state !== "bound") {
        markExistingUserReferralNotice();
      }
      localStorage.setItem("store_os_token", data.token);
      localStorage.removeItem(onboardingTokenKey);
      setOnboardingToken("");
      sessionStorage.removeItem(onboardingExpiredNoticeKey);
      setOnboardingExpired(false);
      // 归因已经交给服务端；清掉暂存的推荐码，避免同一个标签页里后续再开通别的产品时被重复带上。
      clearPendingReferral();
      onLogin({
        token: data.token,
        tenantId: data.tenantId,
        userId: data.userId,
        tenantRole: data.tenantRole ?? product?.tenantRole ?? role,
        tenantName: data.tenantName ?? normalizedTenantName,
        planCode: data.plan?.planCode ?? product?.planCode ?? "local_standard",
        dataMode: data.dataMode ?? "database",
        diagnosisRequired: data.diagnosisRequired ?? true,
      });
    } catch (cause) {
      setStatus("");
      setRetryReady(true);
      setError(cause instanceof Error ? cause.message : "登录失败，请稍后重试。");
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }

  async function handleDemoQuickLogin() {
    if (loginInFlight.current) return;
    const demoLoginRole = product?.tenantRole ?? "local_business";
    const demoLoginTenantName = product ? `本机${product.shortName}工作区` : "演示门店";
    const demoLoginPlanCode = product?.planCode;
    loginInFlight.current = true;
    setBusy(true);
    clearFeedback();
    setStatus(product ? `正在开通本机${product.shortName}体验工作区...` : "正在创建演示工作区...");
    try {
      const res = await fetch(`${apiBase}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantRole: demoLoginRole,
          tenantName: demoLoginTenantName,
          planCode: demoLoginPlanCode,
          productCode: product?.code,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message ?? data.error ?? "演示登录失败。");
      localStorage.setItem("store_os_token", data.token);
      onLogin({
        token: data.token,
        tenantId: data.tenantId,
        userId: data.userId,
        tenantRole: data.tenantRole ?? demoLoginRole,
        tenantName: data.tenantName ?? demoLoginTenantName,
        planCode: data.plan?.planCode ?? demoLoginPlanCode ?? "local_standard",
        dataMode: data.dataMode ?? "demo",
        diagnosisRequired: data.diagnosisRequired ?? true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "演示登录失败，请稍后重试。");
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }

  if (!isCustomDomain && entry === "generic") {
    // 微信首次授权后回到这里补资料，这一步就是「注册」；完成后直接进平台首页。
    const finishingSignup = Boolean(onboardingToken);
    // 平台主入口是否还要邀请码由服务端开关 INVITE_REQUIRED 决定（随 /auth/wechat-config 下发）。
    // 开放注册（false）：只保留「微信一键登录 / 注册」，不渲染邀请码入口和邀请码输入框。
    // 邀请制（true）：保留「使用邀请码开通」入口，邀请码必填。
    // 配置还没回来时按「需要邀请码」处理，宁可多问一次也不要放过未授权的开通。
    const invitesNeeded = isProduction && inviteRequired !== false;
    const showInviteForm = invitesNeeded ? (inviteFallbackOpen || wechatReady === false) : wechatReady === false;
    const workspaceFields = <>
      <label><span className="loginFieldLabel">企业 / 品牌名称<b className="requiredMarker">*</b></span><input value={tenantName} onChange={(event) => { setTenantName(event.target.value); clearFeedback(); }} placeholder="例如：XX品牌 / XX门店" maxLength={80} autoComplete="organization" required /></label>
      {invitesNeeded && <label><span className="loginFieldLabel">邀请码<b className="requiredMarker">*</b></span><input value={inviteCode} onChange={(event) => { setInviteCode(event.target.value); clearFeedback(); }} placeholder="请输入邀请码" maxLength={200} autoComplete="one-time-code" /></label>}
    </>;
    return <div className="loginPage"><main className="loginCard platformLoginCard">
      <div className="loginBrand">
        <span className="loginBadge">{branding.systemName}</span>
        <h1>{finishingSignup ? "完成注册，开通你的工作区" : "登录 / 注册"}</h1>
        <p>一个账号、一份全平台通用积分，商城上的行业智能体随取随用。</p>
        {referralCode.trim() && <p className="wechatLoginHint">已识别推荐码 {previewReferralCode(referralCode)}：<b>只有首次开通工作区的新账号</b>才会登记推荐关系；已有工作区的账号直接登录，不重复绑定。</p>}
      </div>
      <div className="loginForm">
        {!finishingSignup && onboardingExpired && (
          <div className="loginError" role="alert">
            上次的微信授权已过期（30 分钟有效），已帮你清除。请点下面的「微信一键登录 / 注册」重新开始。
          </div>
        )}
        {!finishingSignup && wechatReady !== false && <WeChatLoginArea qr={wechatQr} busy={busy} disabled={wechatReady === null} label={wechatReady === null ? "正在检查登录方式…" : "微信一键登录 / 注册"} onStart={() => void handleWechatLogin()} onRefresh={() => void startWechatQrLogin()} />}
        {!finishingSignup && wechatReady === true && !showInviteForm && <p className="wechatLoginHint">首次使用微信登录，会自动为你注册账号并开通工作区{invitesNeeded ? "（需邀请码）" : "，不需要邀请码"}。</p>}
        {finishingSignup ? (
          <form onSubmit={handleLoginSubmit}>
            {workspaceFields}
            <button className="loginSubmit" type="submit" disabled={busy}>{busy ? "正在开通…" : retryReady ? "再试一次" : "完成注册并进入平台"}</button>
            <button className="switchProductLink" type="button" disabled={busy} onClick={() => { clearOnboardingToken(false); setTenantName(""); clearFeedback(); void handleWechatLogin(); }}>不是这个微信号？重新授权</button>
          </form>
        ) : !showInviteForm ? (
          invitesNeeded
            ? <button className="switchProductLink" type="button" onClick={() => { setInviteFallbackOpen(true); clearFeedback(); }}>使用邀请码开通</button>
            : null
        ) : (
          <form onSubmit={handleLoginSubmit}>
            {workspaceFields}
            <button className="loginSubmit" type="submit" disabled={busy}>{busy ? "正在进入…" : retryReady ? "再试一次" : "进入思潼AI 智能体平台"}</button>
          </form>
        )}
        <Feedback error={error} status={status} />
      </div>
      {mode === "dev" && <a className="internalOnboardingLink" href={getAppPath("/internal/onboarding")}>内部开发开通入口</a>}
      <LoginFooter />
    </main></div>;
  }

  const headline = product?.headline ?? (internalEntry ? "内部工作区开通" : branding.loginHeadline);
  const description = product?.description ?? (internalEntry ? "仅供内部测试和受控开通使用，不是客户公共登录页。" : branding.loginDescription);

  return <div className={`loginPage ${product ? `productLoginPage product-${product.code}` : ""}`}><main className="loginCard">
    <div className="loginBrand">
      {brandLogo && <img className="tenantLoginLogo" src={brandLogo} alt={`${branding.brandName} Logo`} />}
      <span className="loginBadge">{product?.shortName ?? (internalEntry ? "思潼 AI · 内部入口" : branding.systemName)}</span>
      <h1>{headline}</h1><p>{description}</p>
    </div>

    {isCustomDomain ? <div className="loginForm brandedDomainLogin">
      <WeChatLoginArea qr={wechatQr} busy={busy} disabled={publicBrand.loading} label="微信授权登录" onStart={() => void handleWechatLogin()} onRefresh={() => void startWechatQrLogin()} />
      <p className="wechatLoginHint">仅已加入 {branding.brandName} 企业空间的成员可以登录。</p>
      <Feedback error={error} status={status} />
    </div> : <>
      {product && showWechatLogin && <><WeChatLoginArea qr={wechatQr} busy={busy} disabled={false} label="微信授权登录" onStart={() => void handleWechatLogin()} onRefresh={() => void startWechatQrLogin()} /><p className="wechatLoginHint">已有账号可直接登录；首次开通填下面的资料即可，<b>不需要邀请码</b>。</p><div className="loginDivider"><span>首次开通</span></div></>}
      {internalEntry && <div className="loginRolePicker"><p className="loginSectionLabel">内部开通：选择企业经营类型</p><div className="roleCards">{ROLE_OPTIONS.map((option) => <button key={option.value} className={role === option.value ? "roleCard active" : "roleCard"} onClick={() => setRole(option.value)} type="button"><strong>{option.label}</strong><small>{option.desc}</small></button>)}</div></div>}
      <form onSubmit={handleLoginSubmit} className="loginForm">
        {product && product.code !== "lanqi" && inviteValidated && <div className="validatedInvite"><span>邀请码有效（品牌归属已按码生效）</span></div>}
        <label><span className="loginFieldLabel">{product?.code === "beauty-industry" ? "门店/品牌名称" : product?.code === "lanqi" ? "门店名称" : "企业/品牌名称"}<b className="requiredMarker">*</b></span><input value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder={product?.code === "beauty-industry" ? "例如：XX皮肤管理中心" : product?.code === "lanqi" ? "例如：兰琪某某门店" : "例如：XX连锁品牌"} maxLength={80} autoComplete="organization" required /></label>
        <div className="loginInlineFields">{product?.code !== "beauty-industry" && <label><span>行业</span><input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder={product?.code === "lanqi" ? "例如：美业" : "例如：餐饮 / 教育"} maxLength={80} /></label>}<label><span>所在城市</span><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="例如：杭州" maxLength={80} autoComplete="address-level2" /></label></div>
        {internalEntry && isProduction && <label><span>内部邀请码<b className="requiredMarker">*</b></span><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="请输入内部邀请码" maxLength={200} required /></label>}
        <Feedback error={error} status={status} />
        <button className="loginSubmit" type="submit" disabled={busy}>{busy ? "正在进入..." : retryReady ? "再试一次" : product ? `开通并进入${product.shortName}` : "创建内部工作区"}</button>
      </form>
      {internalEntry && mode === "dev" && <div className="loginDevSection"><div className="loginDivider"><span>开发者快速入口</span></div><button className="loginDemoBtn" onClick={handleDemoQuickLogin} disabled={busy} type="button">一键演示登录</button><p className="loginDemoHint">仅本地开发环境可用，生产后端会拒绝此登录。</p></div>}
    </>}
    {(mode === "dev" || directTestLogin) && product && !isCustomDomain && <div className="loginDevSection"><div className="loginDivider"><span>本机体验入口</span></div><button className="loginDemoBtn" onClick={handleDemoQuickLogin} disabled={busy} type="button">本机直接开通并进入{product.shortName}</button><p className="loginDemoHint">不需要邀请码，可直接进入体验工作区。</p></div>}
    <LoginFooter customDomain={isCustomDomain} />
  </main></div>;
}

function Feedback({ error, status }: { error: string; status: string }) {
  return <div className="loginFeedback" aria-live="polite">{error ? <div className="loginError" role="alert">{error}</div> : status ? <div className="loginStatus" role="status">{status}</div> : null}</div>;
}

/**
 * 微信登录入口：没有二维码时是原来的绿色按钮；拿到扫码会话后换成二维码块。
 * 电脑端与普通手机浏览器都走二维码，只有微信内置浏览器才直接跳 oauth2。
 */
function WeChatLoginArea({ qr, busy, disabled, label, onStart, onRefresh }: {
  qr: WechatQrState | null;
  busy: boolean;
  disabled: boolean;
  label: string;
  onStart: () => void;
  onRefresh: () => void;
}) {
  if (!qr) {
    return <button className="wechatLoginBtn" onClick={onStart} disabled={busy || disabled} type="button">{busy ? "正在打开微信…" : label}</button>;
  }
  return <div className="wechatQrBlock" data-wechat-qr={qr.expired ? "expired" : "pending"}>
    <p className="wechatQrTitle">{qr.expired ? "二维码已失效" : "请用微信扫这个码登录"}</p>
    {!qr.expired && <img className="wechatQrImage" src={qr.qrSrc} alt="微信登录二维码" width={200} height={200} />}
    <p className="wechatQrHint">{qr.expired
      ? "二维码 5 分钟内有效，点下面的按钮重新生成一张。"
      : "用手机微信「扫一扫」扫码并授权，这台电脑会自动登录。"}</p>
    {!qr.expired && <div className="loginStatus" role="status">等待扫码授权…</div>}
    <button className="switchProductLink" type="button" onClick={onRefresh}>刷新二维码</button>
  </div>;
}

function LoginFooter({ customDomain = false }: { customDomain?: boolean }) {
  return <p className="loginFooter">登录即表示同意<a href={getAppPath("/terms")} target="_blank" rel="noreferrer">服务条款</a>和<a href={getAppPath("/privacy")} target="_blank" rel="noreferrer">隐私政策</a>。{customDomain && <span className="whiteLabelProvider"> 技术能力由思潼 AI 提供</span>}</p>;
}
