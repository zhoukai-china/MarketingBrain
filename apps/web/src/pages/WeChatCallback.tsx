import { useEffect, useState } from "react";
import { type LoginResult } from "./LoginPage.js";
import { apiBase, getAppPath } from "../lib/api.js";
import { tenantBrandLogoSrc, usePublicTenantBranding } from "../lib/tenant-branding.js";
import { clearPendingWeChatBridge, readPendingWeChatBridge } from "../lib/wechat-bridge-session.js";
import { markExistingUserReferralNotice } from "../lib/referral-notice.js";
import { readPendingReferral } from "../lib/pending-referral.js";
import { rememberPendingReferral } from "../lib/pending-referral.js";
import { readPendingPartner, rememberPendingPartner } from "../lib/pending-partner.js";

interface WeChatCallbackProps {
  onLogin: (result: LoginResult) => void;
}

export default function WeChatCallback({ onLogin }: WeChatCallbackProps) {
  const publicBrand = usePublicTenantBranding();
  const branding = publicBrand.branding;
  const brandLogo = tenantBrandLogoSrc(branding);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在完成微信登录...");
  const [returnProductCode] = useState(() => sessionStorage.getItem("store_os_product_login_code") ?? "");
  // 电脑端扫码登录：手机只负责把 code 交回服务端，不在这里落 token。
  const [bridgeDone, setBridgeDone] = useState(false);

  useEffect(() => {
    async function exchangeCode() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        const savedState = sessionStorage.getItem("wechat_oauth_state");
        const tenantHostname = sessionStorage.getItem("wechat_tenant_hostname") ?? undefined;
        const productCode = sessionStorage.getItem("store_os_product_login_code") ?? undefined;

        // Validate state parameter to prevent CSRF
        if (!state || state !== savedState) {
          setError("微信授权验证失败（state 不匹配），请重新登录");
          setStatus("");
          return;
        }
        sessionStorage.removeItem("wechat_oauth_state");
        sessionStorage.removeItem("wechat_tenant_hostname");
        sessionStorage.removeItem("store_os_product_login_code");
        // 推荐码 / 合伙人码由微信 state 原样带回（格式：`<uuid>|<ref>|<partner>`）：即使 URL
        // 或存储中途丢了，这里也能重新种回去，保证补资料提交时还带着码。
        const stateParts = state.split("|");
        const referralFromState = (stateParts[1] ?? "").trim();
        const partnerFromState = (stateParts[2] ?? "").trim();
        if (referralFromState) rememberPendingReferral(referralFromState);
        if (partnerFromState) rememberPendingPartner(partnerFromState);

        if (!code) {
          const errDesc = params.get("errcode") ?? "";
          if (errDesc === "access_denied" || params.get("errmsg")?.includes("拒绝")) {
            setError("你取消了微信授权，请重新尝试");
          } else {
            setError("微信授权未返回授权码，请重新登录");
          }
          setStatus("");
          return;
        }

        // PLAT-13：从电脑端二维码进来的，走扫码中转；登录结果由电脑端取走。
        const bridge = readPendingWeChatBridge();
        if (bridge) {
          setStatus("正在把授权结果同步到电脑...");
          const bridgeRes = await fetch(`${apiBase}/auth/wechat-bridge/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: bridge.id, secret: bridge.secret, code })
          });
          const bridgeData = (await bridgeRes.json().catch(() => ({}))) as {
            ok?: boolean;
            needsTenant?: boolean;
            message?: string;
          };
          if (!bridgeRes.ok || bridgeData.ok !== true) {
            // 失败结果服务端会留着，用户回到电脑刷新二维码再扫即可。
            setError(bridgeData.message ?? "微信授权失败，请回到电脑刷新二维码后重新扫码。");
            setStatus("");
            return;
          }
          clearPendingWeChatBridge();
          setBridgeDone(true);
          setStatus(bridgeData.needsTenant === true
            ? "已授权。请回到电脑补全企业信息，完成开通。"
            : "已授权，请回到电脑完成登录。");
          return;
        }

        setStatus("正在通过微信验证你的身份...");

        const res = await fetch(`${apiBase}/auth/wechat-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, tenantHostname, productCode })
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          setError(data.message ?? data.error ?? "微信登录失败，请重试");
          setStatus("");
          return;
        }

        // Handle tenant-less new user (needs onboarding)
        if (data.needsTenant) {
          localStorage.setItem("store_os_onboarding_token", data.onboardingToken ?? "");
          const nextPath = productCode ? `/login/${productCode}` : "/login";
          // QA-20260912-013：手机微信内授权同样会落到「补资料」，把登录页填过的产品邀请码带上，
          // 否则老板会看到「授权成功了却还要邀请码」。
          const pendingInvite = sessionStorage.getItem("store_os_pending_invite") ?? "";
          const pendingReferral = readPendingReferral();
          const pendingPartner = readPendingPartner();
          const target = getAppPath(nextPath);
          // 推荐码 / 合伙人码既存本地，也继续挂在回跳 URL 上：微信授权往返可能换 webview / 丢存储，URL 是最稳的那层。
          const query = [
            pendingInvite ? `invite=${encodeURIComponent(pendingInvite)}` : "",
            pendingReferral ? `ref=${encodeURIComponent(pendingReferral)}` : "",
            pendingPartner ? `partner=${encodeURIComponent(pendingPartner)}` : ""
          ].filter(Boolean).join("&");
          window.location.replace(query ? `${target}?${query}` : target);
          return;
        }

        // Successful login
        // 老账号带着推荐码登录：只有首次开通工作区才建立推荐关系，给落地页留一句提示。
        if ((sessionStorage.getItem("store_os_pending_referral") ?? "").trim()) markExistingUserReferralNotice();
        localStorage.setItem("store_os_token", data.token);

        onLogin({
          token: data.token,
          tenantId: data.tenantId,
          userId: data.userId,
          tenantRole: data.plan?.planCode?.startsWith("chain") ? "chain_brand"
            : data.plan?.planCode?.startsWith("ip") ? "personal_ip"
            : "local_business",
          tenantName: data.tenantName ?? "",
          planCode: data.plan?.planCode ?? "local_standard",
          dataMode: data.dataMode ?? "database",
          diagnosisRequired: data.diagnosisRequired ?? true
        });
      } catch {
        setError("网络错误，微信登录失败，请检查网络后重试");
        setStatus("");
      }
    }

    exchangeCode();
  }, [onLogin]);

  if (error) {
    return (
      <div className="loginPage">
        <div className="loginCard wechatCallbackCard">
          <div className="loginBrand">
            {brandLogo && <img className="tenantLoginLogo" src={brandLogo} alt={`${branding.brandName} Logo`} />}
            <span className="loginBadge">{branding.systemName}</span>
            <h1>微信登录</h1>
          </div>
          <div className="loginError">{error}</div>
          <a href={getAppPath(returnProductCode ? `/login/${returnProductCode}` : "/login")} className="loginDemoBtn" style={{ textDecoration: "none", display: "inline-block", marginTop: "1rem" }}>
            返回登录页面
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="loginPage">
      <div className="loginCard wechatCallbackCard">
        <div className="loginBrand">
          {brandLogo && <img className="tenantLoginLogo" src={brandLogo} alt={`${branding.brandName} Logo`} />}
          <span className="loginBadge">{branding.systemName}</span>
          <h1>微信登录</h1>
        </div>
        <div className="loginStatus">{status}</div>
        {bridgeDone ? <p className="wechatCallbackHint">这台手机不用再操作了，回到电脑页面会自动登录。</p> : <>
          <div className="wechatLoadingSpinner" />
          <p className="wechatCallbackHint">请稍候，正在处理微信授权...</p>
        </>}
      </div>
    </div>
  );
}
