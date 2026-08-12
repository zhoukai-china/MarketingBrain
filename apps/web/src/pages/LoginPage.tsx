import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiBase, getAppPath } from "../lib/api.js";
import {
  DEFAULT_TENANT_BRANDING,
  tenantBrandLogoSrc,
  usePublicTenantBranding
} from "../lib/tenant-branding.js";

type TenantRole = "personal_ip" | "local_business" | "chain_brand";

interface LoginPageProps {
  mode: "dev" | "production";
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
  { value: "personal_ip", label: "个人IP / OPC", desc: "单人创业者、创始人IP、专家IP、知识付费" },
  { value: "local_business", label: "本地单店商家", desc: "餐饮、美业、教育、本地生活服务等实体门店" },
  { value: "chain_brand", label: "连锁品牌", desc: "多门店、区域连锁、招商加盟企业" }
];

export default function LoginPage({ mode, onLogin }: LoginPageProps) {
  const publicBrand = usePublicTenantBranding();
  // Public domains are the platform entrance. Tenant branding is only allowed
  // on a verified tenant-specific domain, otherwise an old tenant default can
  // incorrectly turn the flywheel onboarding page into a single workbench page.
  const branding = publicBrand.matched ? publicBrand.branding : DEFAULT_TENANT_BRANDING;
  const [role, setRole] = useState<TenantRole>("local_business");
  const [tenantName, setTenantName] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retryReady, setRetryReady] = useState(false);
  const loginInFlight = useRef(false);
  const isProduction = mode === "production";
  const isCustomDomain = publicBrand.matched;
  const showWechatLogin = isCustomDomain || !isProduction || Boolean(import.meta.env.VITE_WECHAT_AUTH_APPID);
  const brandLogo = tenantBrandLogoSrc(branding);

  useEffect(() => {
    document.title = `${branding.systemName} - 登录`;
  }, [branding.systemName, isCustomDomain]);

  async function handleWechatLogin() {
    setBusy(true);
    setError("");
    setStatus("正在打开微信授权...");

    try {
      const res = await fetch(`${apiBase}/auth/wechat-config`, { method: "GET" });
      if (!res.ok) {
        setError("微信登录暂未配置，请先使用邀请码入驻。");
        setBusy(false);
        setStatus("");
        return;
      }
      const config = (await res.json()) as { appid?: string };
      const appId = config.appid ?? (import.meta.env.VITE_WECHAT_AUTH_APPID as string | undefined);
      if (!appId) {
        setError("微信登录缺少 AppID，请联系服务团队。");
        setBusy(false);
        setStatus("");
        return;
      }

      const state = crypto.randomUUID();
      sessionStorage.setItem("wechat_oauth_state", state);
      if (isCustomDomain) sessionStorage.setItem("wechat_tenant_hostname", publicBrand.hostname);
      else sessionStorage.removeItem("wechat_tenant_hostname");

      const redirectUri =
        (import.meta.env.VITE_WECHAT_AUTH_REDIRECT_URI as string | undefined) ??
        `${window.location.origin}${getAppPath("/wechat-callback")}`;
      const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_userinfo&state=${encodeURIComponent(state)}#wechat_redirect`;

      window.location.href = authUrl;
    } catch {
      setError("微信登录请求失败，请稍后重试。");
      setBusy(false);
      setStatus("");
    }
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    if (loginInFlight.current) return;
    const normalizedTenantName = tenantName.trim();
    if (!normalizedTenantName) {
      setStatus("");
      setRetryReady(true);
      setError("请输入有效的企业或品牌名称，不能只填写空格。");
      return;
    }
    if (isProduction && !inviteCode.trim()) {
      setStatus("");
      setRetryReady(true);
      setError("请输入内测邀请码。");
      return;
    }

    loginInFlight.current = true;
    setBusy(true);
    setRetryReady(false);
    setError("");
    setStatus(isProduction ? "正在校验邀请码并创建工作区..." : "正在创建你的专属工作区...");

    try {
      const res = await fetch(`${apiBase}${isProduction ? "/auth/beta-login" : "/auth/dev-login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantRole: role,
          tenantName: normalizedTenantName,
          industry: industry.trim() || undefined,
          city: city.trim() || undefined,
          inviteCode: isProduction ? inviteCode.trim() : undefined
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setStatus("");
        setRetryReady(true);
        setError(data.message ?? data.error ?? "登录失败，请检查信息后重试。");
        return;
      }

      localStorage.setItem("store_os_token", data.token);
      localStorage.setItem("store_os_diagnosis_done", "false");

      onLogin({
        token: data.token,
        tenantId: data.tenantId,
        userId: data.userId,
        tenantRole: data.tenantRole ?? role,
        tenantName: data.tenantName ?? tenantName,
        planCode: data.plan?.planCode ?? "local_standard",
        dataMode: data.dataMode ?? "database",
        diagnosisRequired: true
      });
    } catch {
      setStatus("");
      setRetryReady(true);
      setError("登录失败，请稍后重试。");
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }

  async function handleDemoQuickLogin() {
    setBusy(true);
    setError("");
    setStatus("正在创建演示工作区...");

    try {
      const res = await fetch(`${apiBase}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantRole: "local_business", tenantName: "演示门店" })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message ?? data.error ?? "演示登录失败。");
        return;
      }

      localStorage.setItem("store_os_token", data.token);
      localStorage.setItem("store_os_diagnosis_done", "false");

      onLogin({
        token: data.token,
        tenantId: data.tenantId,
        userId: data.userId,
        tenantRole: "local_business",
        tenantName: "演示门店",
        planCode: data.plan?.planCode ?? "local_standard",
        dataMode: data.dataMode ?? "demo",
        diagnosisRequired: true
      });
    } catch {
      setError("演示登录失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginBrand">
          {brandLogo && <img className="tenantLoginLogo" src={brandLogo} alt={`${branding.brandName} Logo`} />}
          <span className="loginBadge">{branding.systemName}</span>
          <h1>{branding.loginHeadline}</h1>
          <p>{branding.loginDescription}</p>
        </div>

        {!isCustomDomain && <div className="loginRolePicker">
          <p className="loginSectionLabel">首次进入，请选择企业经营类型</p>
          <div className="roleCards">
            {ROLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={role === opt.value ? "roleCard active" : "roleCard"}
                onClick={() => setRole(opt.value)}
                type="button"
                aria-pressed={role === opt.value}
              >
                <strong>{opt.label}</strong>
                <small>{opt.desc}</small>
              </button>
            ))}
          </div>
        </div>}

        {!isCustomDomain ? <form onSubmit={handleLoginSubmit} className="loginForm">
          <label>
            <span className="loginFieldLabel">企业/品牌名称<b className="requiredMarker" aria-hidden="true">*</b><span className="srOnly">必填</span></span>
            <input
              id="tenantName"
              name="tenantName"
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              placeholder="例如：枕水江南"
              maxLength={80}
              autoComplete="organization"
              aria-required="true"
              aria-invalid={Boolean(error && !tenantName.trim())}
              aria-describedby="loginFeedback"
              required
            />
          </label>

          <div className="loginInlineFields">
            <label>
              <span className="loginFieldLabel">行业</span>
              <input
                id="industry"
                name="industry"
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
                placeholder="例如：餐饮 / 美业 / 教育"
                maxLength={80}
                autoComplete="off"
              />
            </label>
            <label>
              <span className="loginFieldLabel">所在城市</span>
              <input
                id="city"
                name="city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="例如：大连"
                maxLength={80}
                autoComplete="address-level2"
              />
            </label>
          </div>

          {isProduction && (
            <label>
              <span className="loginFieldLabel">内测邀请码<b className="requiredMarker" aria-hidden="true">*</b><span className="srOnly">必填</span></span>
              <input
                id="inviteCode"
                name="inviteCode"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="请输入服务团队发放的邀请码"
                maxLength={200}
                autoComplete="one-time-code"
                aria-required="true"
                aria-invalid={Boolean(error && !inviteCode.trim())}
                aria-describedby="loginFeedback"
                spellCheck={false}
                required
              />
            </label>
          )}

          {showWechatLogin && (
            <div className="wechatLoginSection">
              <div className="loginDivider"><span>或</span></div>
              <button className="wechatLoginBtn" onClick={handleWechatLogin} disabled={busy} type="button">
                微信授权登录
              </button>
              <p className="wechatLoginHint">如果已配置微信公众号授权，可以用微信快速登录。</p>
            </div>
          )}

          <div id="loginFeedback" className="loginFeedback" aria-live="polite">
            {error && <div className="loginError" role="alert">{error}</div>}
            {!error && status && <div className="loginStatus" role="status">{status}</div>}
          </div>

          <button className="loginSubmit" type="submit" disabled={busy}>
            {busy ? "正在进入..." : retryReady ? "再试一次" : isProduction ? "创建企业空间并进入增长飞轮" : "开始AI经营诊断"}
          </button>
        </form> : <div className="loginForm brandedDomainLogin">
          <button className="wechatLoginBtn" onClick={handleWechatLogin} disabled={busy || publicBrand.loading} type="button">
            {busy ? "正在打开微信…" : "微信授权登录"}
          </button>
          <p className="wechatLoginHint">仅已加入 {branding.brandName} 企业空间的成员可以登录。</p>
          <div id="loginFeedback" className="loginFeedback" aria-live="polite">
            {error && <div className="loginError" role="alert">{error}</div>}
            {!error && status && <div className="loginStatus" role="status">{status}</div>}
          </div>
        </div>}

        {mode === "dev" && !isCustomDomain && (
          <div className="loginDevSection">
            <div className="loginDivider"><span>开发者快速入口</span></div>
            <button className="loginDemoBtn" onClick={handleDemoQuickLogin} disabled={busy} type="button">
              一键演示登录
            </button>
            <p className="loginDemoHint">演示账号使用模拟数据，可直接体验完整流程。</p>
          </div>
        )}

        <p className="loginFooter">
          登录即表示同意
          <a href={getAppPath("/terms")} target="_blank" rel="noreferrer">服务条款</a>
          和
          <a href={getAppPath("/privacy")} target="_blank" rel="noreferrer">隐私政策</a>。
          {isCustomDomain && <span className="whiteLabelProvider"> 技术能力由思潼 AI 提供</span>}
        </p>
      </div>
    </div>
  );
}
