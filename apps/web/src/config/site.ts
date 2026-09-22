/**
 * 站点级环境配置集中入口。
 *
 * 把所有「写死的网址 / 域名」统一在这里读取环境变量，便于在
 * 本地 / 内测 / 生产等不同环境里切换，而不必改业务代码。
 *
 * 未配置时回退到生产默认值；本地开发通常不需要配置即可工作。
 * 构建期（Vite）会把 VITE_* 注入，因此不同部署只需在各自的 .env 里填不同值。
 */

import { apiBase, getAppPath } from "../lib/api.js";

const env = import.meta.env;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimBothSlash(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * 浏览器调后端用的 API 基址（同域走相对路径即可，不需要公网绝对地址）。
 * 直接复用 lib/api.ts 的 apiBase：本地开发回退 3011，否则用应用前缀 + /api。
 */
export const API_BASE_URL: string = apiBase;

/**
 * 站点公开根址：用于拼「外部可见的绝对 URL」（分享链接、webhook 回调、微信回跳等）。
 * 不同环境配置不同值，例如：
 *   生产  https://api.lcppch.top/os-v2
 *   内测  https://api.lcppch.top/lanqi-test
 *   本地  http://localhost:5174/os-v2   （与 vite base 对应）
 */
export const PUBLIC_WEB_BASE_URL: string =
  trimTrailingSlash((env.VITE_PUBLIC_WEB_BASE_URL as string | undefined) ?? "") ||
  "https://api.lcppch.top/os-v2";

/** 由公开基址派生的公网 API 基址（外部服务回调用绝对地址）。 */
export const PUBLIC_API_BASE_URL: string = `${PUBLIC_WEB_BASE_URL}/api`;

/**
 * 微信网页授权回跳地址。
 * 优先用显式配置的 VITE_WECHAT_AUTH_REDIRECT_URI（部署脚本已注入为 `${PUBLIC_BASE_URL}/wechat-callback`）；
 * 未配置时回退到「当前域名 + 应用路径」自适应，保证本地 / 内测不指向生产。
 */
export const WECHAT_AUTH_REDIRECT_URI: string =
  (env.VITE_WECHAT_AUTH_REDIRECT_URI as string | undefined) ||
  (typeof window !== "undefined"
    ? `${window.location.origin}${getAppPath("/wechat-callback")}`
    : `${PUBLIC_WEB_BASE_URL}/wechat-callback`);

/** 第三方：得到大脑录音拉取地址。 */
export const GETNOTE_RECENT_RECORDINGS_URL: string =
  (env.VITE_GETNOTE_RECENT_URL as string | undefined) ||
  "https://api.getnote.cn/recordings/recent?source=sitong";

/** 录音卡 webhook 绝对地址基址（外部服务 getnote / 飞书 回调用）。 */
export const AUDIO_CARD_WEBHOOK_BASE_URL: string = `${PUBLIC_API_BASE_URL}/audio-card-webhooks`;

/** WorkBuddy MCP 接入地址（充值页「接入指令」展示用）。 */
export const WORKBUDDY_MCP_PUBLIC_URL: string = `${PUBLIC_API_BASE_URL}/integrations/workbuddy/mcp`;
