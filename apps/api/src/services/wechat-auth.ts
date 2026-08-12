import { env, getWechatAuthConfigIssues } from "../config/env.js";

export class WechatAuthNotConfiguredError extends Error {
  constructor(public readonly issues: string[]) {
    super("wechat_auth_not_configured");
  }
}

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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WeChat OAuth request failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    openid?: string;
    unionid?: string;
    scope?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode) {
    throw new Error(`WeChat OAuth error ${data.errcode}: ${data.errmsg ?? "unknown"}`);
  }
  if (!data.openid) {
    throw new Error("WeChat OAuth response missing openid");
  }

  return {
    openid: data.openid,
    unionid: data.unionid,
    scope: data.scope
  };
}

