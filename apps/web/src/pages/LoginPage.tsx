import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PRODUCT_LOGIN_DEFINITIONS,
  type ProductLoginCode,
  type TenantType,
} from "@baolu/shared";
import { apiBase, getAppPath, getAppRoutePath } from "../lib/api.js";
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

export default function LoginPage({ mode, entry, onLogin }: LoginPageProps) {
  const publicBrand = usePublicTenantBranding();
  const branding = publicBrand.matched ? publicBrand.branding : DEFAULT_TENANT_BRANDING;
  const product = entry !== "generic" && entry !== "internal" ? PRODUCT_LOGIN_DEFINITIONS[entry] : null;
  const [role, setRole] = useState<TenantRole>("local_business");
  const [tenantName, setTenantName] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
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
  const loginInFlight = useRef(false);
  const isProduction = mode === "production";
  const isCustomDomain = publicBrand.matched;
  const showWechatLogin = isCustomDomain || !isProduction || Boolean(import.meta.env.VITE_WECHAT_AUTH_APPID);
  const brandLogo = tenantBrandLogoSrc(branding);
  const internalEntry = entry === "internal";
  const directTestLogin = import.meta.env.VITE_DIRECT_TEST_LOGIN === "true";
  const onboardingToken = localStorage.getItem("store_os_onboarding_token") ?? "";

  useEffect(() => {
    document.title = `${product?.name ?? branding.systemName} - 登录 / 注册`;
  }, [branding.systemName, product?.name]);

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

  function clearFeedback() {
    setError("");
    setStatus("");
    setRetryReady(false);
  }

  async function handleWechatLogin() {
    setBusy(true);
    clearFeedback();
    setStatus("正在打开微信授权...");
    try {
      const res = await fetch(`${apiBase}/auth/wechat-config`, { method: "GET" });
      if (!res.ok) throw new Error("微信登录暂未配置，请使用邀请码开通或联系服务团队。");
      const config = (await res.json()) as { appid?: string };
      const appId = config.appid ?? (import.meta.env.VITE_WECHAT_AUTH_APPID as string | undefined);
      if (!appId) throw new Error("微信登录缺少 AppID，请联系服务团队。");

      const state = crypto.randomUUID();
      sessionStorage.setItem("wechat_oauth_state", state);
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

  async function handleProductInviteValidate(event: FormEvent) {
    event.preventDefault();
    if (!product || loginInFlight.current) return;
    // Bug4（WorkBuddy 2026-09-10）：以前这里靠原生 required 拦空值，
    // 浏览器只弹一个「请填写此字段」的气泡，用户看到的是「按钮没反应」。
    // 表单已加 noValidate，空值一律走这条中文提示。
    if (!inviteCode.trim()) {
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
        body: JSON.stringify({ productCode: product.code, inviteCode: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) throw new Error(data.message ?? data.error ?? "邀请码验证失败。");
      setInviteValidated(true);
      setStatus("邀请码有效，请完成工作区资料。");
    } catch (cause) {
      setStatus("");
      setRetryReady(true);
      setError(cause instanceof Error ? cause.message : "邀请码验证失败，请稍后重试。");
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
    // 平台主入口是否强制邀请码由服务端开关决定（INVITE_REQUIRED，随 /auth/wechat-config 下发）；
    // 产品入口（美业 / 兰琪）仍按产品邀请码走服务端校验。
    const invitesNeeded = product ? true : (isProduction && inviteRequired !== false);
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
          inviteCode: useBetaLogin ? inviteCode.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message ?? data.error ?? "登录失败，请检查信息后重试。");

      localStorage.setItem("store_os_token", data.token);
      localStorage.removeItem("store_os_onboarding_token");
      localStorage.setItem("store_os_diagnosis_done", "false");
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
      localStorage.setItem("store_os_diagnosis_done", "false");
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
        <p>一个账号、一个积分钱包，货架上的行业智能体随取随用。</p>
      </div>
      <div className="loginForm">
        {!finishingSignup && wechatReady !== false && <button className="wechatLoginBtn" onClick={handleWechatLogin} disabled={busy || wechatReady === null} type="button">{busy ? "正在打开微信…" : wechatReady === null ? "正在检查登录方式…" : "微信一键登录 / 注册"}</button>}
        {!finishingSignup && wechatReady === true && !showInviteForm && <p className="wechatLoginHint">首次使用微信登录，会自动为你注册账号并开通工作区{invitesNeeded ? "（需邀请码）" : "，不需要邀请码"}。</p>}
        {finishingSignup ? (
          <form onSubmit={handleLoginSubmit}>
            {workspaceFields}
            <button className="loginSubmit" type="submit" disabled={busy}>{busy ? "正在开通…" : retryReady ? "再试一次" : "完成注册并进入平台"}</button>
            <button className="switchProductLink" type="button" disabled={busy} onClick={() => { localStorage.removeItem("store_os_onboarding_token"); setTenantName(""); clearFeedback(); void handleWechatLogin(); }}>不是这个微信号？重新授权</button>
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
      <button className="wechatLoginBtn" onClick={handleWechatLogin} disabled={busy || publicBrand.loading} type="button">{busy ? "正在打开微信…" : "微信授权登录"}</button>
      <p className="wechatLoginHint">仅已加入 {branding.brandName} 企业空间的成员可以登录。</p>
      <Feedback error={error} status={status} />
    </div> : product && !inviteValidated ? <form onSubmit={handleProductInviteValidate} className="loginForm productInviteForm" noValidate>
      {showWechatLogin && <><button className="wechatLoginBtn" onClick={handleWechatLogin} disabled={busy} type="button">微信授权登录</button><p className="wechatLoginHint">已有账号可直接登录；首次开通请使用邀请消息中的邀请码。</p><div className="loginDivider"><span>首次开通</span></div></>}
      <label><span className="loginFieldLabel">产品邀请码<b className="requiredMarker">*</b></span><input value={inviteCode} onChange={(event) => { setInviteCode(event.target.value); clearFeedback(); }} placeholder="请输入邀请消息中的邀请码" maxLength={200} autoComplete="one-time-code" required /></label>
      <Feedback error={error} status={status} />
      <button className="loginSubmit" type="submit" disabled={busy}>{busy ? "正在验证..." : retryReady ? "重新验证邀请码" : `继续进入${product.shortName}`}</button>
      <a className="switchProductLink" href={getAppPath("/login")}>这不是我要进入的产品</a>
    </form> : <>
      {internalEntry && <div className="loginRolePicker"><p className="loginSectionLabel">内部开通：选择企业经营类型</p><div className="roleCards">{ROLE_OPTIONS.map((option) => <button key={option.value} className={role === option.value ? "roleCard active" : "roleCard"} onClick={() => setRole(option.value)} type="button"><strong>{option.label}</strong><small>{option.desc}</small></button>)}</div></div>}
      <form onSubmit={handleLoginSubmit} className="loginForm">
        {product && <div className="validatedInvite"><span>邀请码已验证</span><button type="button" onClick={() => { setInviteValidated(false); clearFeedback(); }}>更换</button></div>}
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

function LoginFooter({ customDomain = false }: { customDomain?: boolean }) {
  return <p className="loginFooter">登录即表示同意<a href={getAppPath("/terms")} target="_blank" rel="noreferrer">服务条款</a>和<a href={getAppPath("/privacy")} target="_blank" rel="noreferrer">隐私政策</a>。{customDomain && <span className="whiteLabelProvider"> 技术能力由思潼 AI 提供</span>}</p>;
}
