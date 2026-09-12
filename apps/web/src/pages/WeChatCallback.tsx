import { useEffect, useState } from "react";
import { type LoginResult } from "./LoginPage.js";
import { apiBase, getAppPath } from "../lib/api.js";
import { tenantBrandLogoSrc, usePublicTenantBranding } from "../lib/tenant-branding.js";
import { clearPendingWeChatBridge, readPendingWeChatBridge } from "../lib/wechat-bridge-session.js";

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
          window.location.replace(getAppPath(nextPath));
          return;
        }

        // Successful login
        localStorage.setItem("store_os_token", data.token);
        localStorage.setItem("store_os_diagnosis_done", "false");

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
