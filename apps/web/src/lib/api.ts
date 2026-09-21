const envApiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const viteBasePath = (import.meta.env.BASE_URL as string | undefined) ?? "/";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function getApiBase(): string {
  if (envApiBase) return trimTrailingSlash(envApiBase);
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    const queryApiBase = new URLSearchParams(window.location.search).get("apiBase");
    if (import.meta.env.DEV && queryApiBase && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(queryApiBase)) {
      return trimTrailingSlash(queryApiBase);
    }
    return "http://localhost:3011";
  }
  return `${normalizeBasePath(viteBasePath).replace(/\/$/, "")}/api`;
}

export function getAppPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const appPath = `${normalizeBasePath(viteBasePath)}${normalizedPath}`;
  if (typeof window !== "undefined" && import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    const queryApiBase = new URLSearchParams(window.location.search).get("apiBase");
    if (queryApiBase && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(queryApiBase)) {
      const separator = appPath.includes("?") ? "&" : "?";
      return `${appPath}${separator}apiBase=${encodeURIComponent(queryApiBase)}`;
    }
  }
  return appPath;
}

export function getAppRoutePath(pathname: string): string {
  const basePath = normalizeBasePath(viteBasePath).replace(/\/$/, "");
  if (!basePath || basePath === "/") return pathname || "/";
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) || "/" : pathname;
}

/**
 * `apps/web/public/**` 静态资源的可访问路径。
 *
 * 生产构建的 `base` 是 `/os-v2/`（见 `apps/web/vite.config.ts`），直接写 `/avatars/x.png`
 * 会请求域名根目录而 404；公共资源一律走这里拼 base，dev（base `/`）下结果不变。
 */
export function getPublicAssetPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizeBasePath(viteBasePath)}${normalizedPath}`;
}

export const apiBase = getApiBase();

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}
