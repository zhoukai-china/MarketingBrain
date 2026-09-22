import { apiBase } from "./api.js";

/**
 * 微信 OAuth `state` 的取用与解析（服务端签发，前端只负责搬运）。
 *
 * 背景（2026-09-22 生产真机实锤）：微信安卓在网页授权往返中会切换 webview 内核
 * （XWEB ↔ 老 X5），localStorage / sessionStorage / cookie **都不跨内核共享**，所以
 * 「前端生成 state 存本地、回调页比对」的做法在该链路上必然失败（报「state 不匹配」）。
 *
 * 现在改为：发起授权前向后端要一个**带签名的一次性 state**，原样交给微信；微信会把
 * state 原样带回回调页，回调页再把它交回后端验签。校验不依赖任何客户端存储。
 *
 * 另外，扫码中转（PLAT-13）的一次性 id/secret 也不再依赖 sessionStorage——直接编进
 * state 里由微信带回来，避免同一内核切换把扫码链路也打断。
 */

/** 与服务端约定的签名 state 前缀（见 apps/api/src/services/wechat-oauth-state.ts）。 */
const SIGNED_STATE_PREFIX = "w1";
/** 扫码中转 state 前缀：`bh.<base64url({b,s})>`。 */
const BRIDGE_STATE_PREFIX = "bh";

function base64UrlEncode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return decodeURIComponent(escape(atob(padded + pad)));
}

export interface WechatOauthStateContext {
  /** 推荐码 */
  ref?: string;
  /** 产品登录码 */
  pcode?: string;
  /** 品牌自定义域名 */
  host?: string;
}

/**
 * 向后端要一个带签名的一次性 state。
 * 后端不可用时回退随机 UUID——那样只是退化成「无服务端校验」，不会卡住登录。
 */
export async function fetchWechatOauthState(context: WechatOauthStateContext = {}): Promise<string> {
  try {
    const params = new URLSearchParams();
    if (context.ref) params.set("ref", context.ref);
    if (context.pcode) params.set("pcode", context.pcode);
    if (context.host) params.set("host", context.host);
    const query = params.toString();
    const res = await fetch(`${apiBase}/auth/wechat-state${query ? `?${query}` : ""}`, { method: "GET" });
    if (!res.ok) throw new Error("wechat_state_unavailable");
    const data = (await res.json()) as { state?: string };
    if (!data.state) throw new Error("wechat_state_empty");
    return data.state;
  } catch {
    // 拿不到签名 state 时不让登录直接挂掉：退化成旧的随机串。
    return crypto.randomUUID();
  }
}

/** 扫码中转页用：把一次性 id/secret 编进 state，交给微信原样带回。 */
export function buildWechatBridgeState(id: string, secret: string): string {
  return `${BRIDGE_STATE_PREFIX}.${base64UrlEncode(JSON.stringify({ b: id, s: secret }))}`;
}

export interface DecodedWechatOauthState {
  kind: "signed" | "bridge" | "unknown";
  /** 推荐码（signed 载荷里带的，或旧格式 `|<ref>` 后缀） */
  ref?: string;
  /** 扫码中转 id（bridge 载荷里带的） */
  b?: string;
  /** 扫码中转 secret（bridge 载荷里带的） */
  s?: string;
}

/** 回调页解析微信带回的 state（只解码、不校验；校验由服务端做）。 */
export function decodeWechatOauthState(raw: string | null | undefined): DecodedWechatOauthState {
  if (!raw) return { kind: "unknown" };

  if (raw.startsWith(`${BRIDGE_STATE_PREFIX}.`)) {
    try {
      const parsed = JSON.parse(base64UrlDecode(raw.slice(BRIDGE_STATE_PREFIX.length + 1))) as {
        b?: string;
        s?: string;
      };
      return { kind: "bridge", b: parsed.b, s: parsed.s };
    } catch {
      return { kind: "unknown" };
    }
  }

  if (raw.startsWith(`${SIGNED_STATE_PREFIX}.`)) {
    const parts = raw.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(base64UrlDecode(parts[1] ?? "")) as {
          ref?: string;
          b?: string;
          s?: string;
        };
        return { kind: "signed", ref: payload.ref, b: payload.b, s: payload.s };
      } catch {
        return { kind: "unknown" };
      }
    }
  }

  // 旧格式：`<uuid>|<ref>`（老版本前端发起的授权，保留兼容）。
  const sep = raw.indexOf("|");
  if (sep >= 0) {
    const ref = raw.slice(sep + 1).trim();
    return { kind: "unknown", ref: ref || undefined };
  }
  return { kind: "unknown" };
}
