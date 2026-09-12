import { useEffect, useRef, useState } from "react";
import { apiBase, getAppPath } from "../lib/api.js";
import { tenantBrandLogoSrc, usePublicTenantBranding } from "../lib/tenant-branding.js";
import { savePendingWeChatBridge } from "../lib/wechat-bridge-session.js";

/**
 * 手机侧中转页（PLAT-13）。
 *
 * 电脑端登录页生成二维码，二维码内容就是这一页：`/wechat-bridge?b=<id>&s=<secret>`。
 * 用户在手机微信里扫码后：
 *   1. 先把一次性 id/secret 存进 sessionStorage；
 *   2. 直接跳转微信 oauth2 授权（和手机端原生登录用的是同一条 `/wechat-callback`）；
 *   3. `/wechat-callback` 把 code 交回服务端，由服务端把登录结果写给电脑端在轮询的会话。
 *
 * 这一页自己不发任何凭据、也不落 token：微信登录结果的消费者只有电脑端。
 */
export default function WeChatBridgePage() {
  const publicBrand = usePublicTenantBranding();
  const branding = publicBrand.branding;
  const brandLogo = tenantBrandLogoSrc(branding);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在打开微信授权...");
  const started = useRef(false);

  useEffect(() => {
    // React 18 开发态会双执行 effect；授权跳转只能发起一次。
    if (started.current) return;
    started.current = true;

    async function startAuthorization() {
      try {
        const params = new URLSearchParams(window.location.search);
        const id = params.get("b") ?? "";
        const secret = params.get("s") ?? "";
        if (!id || !secret) {
          setError("登录二维码不完整，请回到电脑重新生成二维码后再扫。");
          setStatus("");
          return;
        }

        savePendingWeChatBridge({ id, secret });

        const res = await fetch(`${apiBase}/auth/wechat-config`, { method: "GET" });
        if (!res.ok) throw new Error("微信登录暂未配置，请联系服务团队。");
        const config = (await res.json()) as { appid?: string };
        const appId = config.appid ?? (import.meta.env.VITE_WECHAT_AUTH_APPID as string | undefined);
        if (!appId) throw new Error("微信登录缺少 AppID，请联系服务团队。");

        // 和手机端原生登录共用同一份 state 校验与回调页。
        const state = crypto.randomUUID();
        sessionStorage.setItem("wechat_oauth_state", state);

        const redirectUri = (import.meta.env.VITE_WECHAT_AUTH_REDIRECT_URI as string | undefined)
          ?? `${window.location.origin}${getAppPath("/wechat-callback")}`;
        window.location.replace(
          `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(appId)}`
          + `&redirect_uri=${encodeURIComponent(redirectUri)}`
          + `&response_type=code&scope=snsapi_userinfo&state=${encodeURIComponent(state)}#wechat_redirect`
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "打开微信授权失败，请回到电脑刷新二维码后重试。");
        setStatus("");
      }
    }

    void startAuthorization();
  }, []);

  return (
    <div className="loginPage">
      <div className="loginCard wechatCallbackCard">
        <div className="loginBrand">
          {brandLogo && <img className="tenantLoginLogo" src={brandLogo} alt={`${branding.brandName} Logo`} />}
          <span className="loginBadge">{branding.systemName}</span>
          <h1>扫码登录</h1>
        </div>
        {error ? (
          <>
            <div className="loginError">{error}</div>
            <a
              href={getAppPath("/login")}
              className="loginDemoBtn"
              style={{ textDecoration: "none", display: "inline-block", marginTop: "1rem" }}
            >
              回到电脑登录页
            </a>
          </>
        ) : (
          <>
            <div className="loginStatus">{status}</div>
            <div className="wechatLoadingSpinner" />
            <p className="wechatCallbackHint">请稍候，正在跳转微信授权...</p>
          </>
        )}
      </div>
    </div>
  );
}
