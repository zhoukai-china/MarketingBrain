import { env, getWechatAuthConfigIssues } from "../config/env.js";

export class WechatAuthNotConfiguredError extends Error {
  constructor(public readonly issues: string[]) {
    super("wechat_auth_not_configured");
  }
}

/**
 * 微信换取授权码的可预期失败。
 *
 * 生产观察（2026-09-11，LQ 微信扫码失败路径探针）：无效/过期 code 以前会以普通 Error 抛出，
 * 被 server.ts 的兜底错误处理统一映射成 500 `internal_server_error`，用户看到的是
 * 「服务暂时不可用」这种把业务失败说成服务器故障的文案，同时污染 5xx 告警。
 *
 * 这里把两类失败分开，调用方据此返回不同的业务错误：
 * - `invalid_code`：授权码无效/已被使用/已过期，用户重新授权即可，属 401。
 * - `upstream_unavailable`：微信侧配置或服务异常，属 502，需要运维介入。
 * 上游 errmsg 只放在 `detail` 里给服务端日志，绝不复述给终端用户。
 */
export class WechatOAuthExchangeError extends Error {
  constructor(
    public readonly kind: "invalid_code" | "upstream_unavailable",
    public readonly detail: string
  ) {
    super(`wechat_oauth_${kind}`);
  }
}

// 微信 OAuth 授权码本身的失败：用户重新走一次授权就能恢复。
const INVALID_CODE_ERRCODES = new Set([40029, 40163]);

export interface WechatOAuthIdentity {
  openid: string;
  unionid?: string;
  scope?: string;
}

export async function exchangeWechatOAuthCode(code: string): Promise<WechatOAuthIdentity> {
  const issues = getWechatAuthConfigIssues();
  if (issues.length > 0) {
    throw new WechatAuthNotConfiguredError(issues);
  }

  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", env.WECHAT_AUTH_APPID!);
  url.searchParams.set("secret", env.WECHAT_AUTH_SECRET!);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new WechatOAuthExchangeError(
      "upstream_unavailable",
      `wechat_oauth_fetch_failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new WechatOAuthExchangeError(
      "upstream_unavailable",
      `wechat_oauth_http_${response.status}: ${(await response.text()).slice(0, 500)}`
    );
  }

  let data: {
    openid?: string;
    unionid?: string;
    scope?: string;
    errcode?: number;
    errmsg?: string;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch (error) {
    throw new WechatOAuthExchangeError(
      "upstream_unavailable",
      `wechat_oauth_bad_payload: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (data.errcode) {
    throw new WechatOAuthExchangeError(
      INVALID_CODE_ERRCODES.has(data.errcode) ? "invalid_code" : "upstream_unavailable",
      `wechat_oauth_errcode_${data.errcode}: ${data.errmsg ?? "unknown"}`
    );
  }
  if (!data.openid) {
    throw new WechatOAuthExchangeError("upstream_unavailable", "wechat_oauth_missing_openid");
  }

  return {
    openid: data.openid,
    unionid: data.unionid,
    scope: data.scope
  };
}
