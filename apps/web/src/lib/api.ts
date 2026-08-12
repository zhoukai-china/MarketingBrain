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
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3011";
  }
  return `${normalizeBasePath(viteBasePath).replace(/\/$/, "")}/api`;
}

export function getAppPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizeBasePath(viteBasePath)}${normalizedPath}`;
}

export const apiBase = getApiBase();

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}
