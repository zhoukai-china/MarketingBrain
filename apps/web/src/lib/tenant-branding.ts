import { useEffect, useState } from "react";
import type { TenantBrandingConfig } from "@baolu/shared";
import { apiPath } from "./api.js";

export const DEFAULT_TENANT_BRANDING: TenantBrandingConfig = {
  brandName: "思潼",
  systemName: "思潼AI增长飞轮",
  primaryColor: "#1f6a57",
  loginHeadline: "进入思潼AI增长飞轮",
  loginDescription: "先创建统一的企业空间，再进入外卖、获客及其他已开通的智能体工作台。",
  exportFooter: "由思潼AI增长飞轮生成",
  isCustomized: false
};

const BRANDING_CACHE_KEY = "sitong_tenant_branding";
const BRANDING_EVENT = "sitong-branding-updated";

export function normalizeTenantBranding(value: unknown): TenantBrandingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_TENANT_BRANDING;
  const raw = value as Record<string, unknown>;
  if (isLegacyDefaultBranding(raw)) return DEFAULT_TENANT_BRANDING;
  return {
    brandName: textValue(raw.brandName, DEFAULT_TENANT_BRANDING.brandName, 60),
    systemName: textValue(raw.systemName, DEFAULT_TENANT_BRANDING.systemName, 80),
    ...(typeof raw.logoUrl === "string" && raw.logoUrl.startsWith("/tenant-brand-assets/") ? { logoUrl: raw.logoUrl } : {}),
    primaryColor: typeof raw.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.primaryColor)
      ? raw.primaryColor
      : DEFAULT_TENANT_BRANDING.primaryColor,
    loginHeadline: textValue(raw.loginHeadline, DEFAULT_TENANT_BRANDING.loginHeadline, 120),
    loginDescription: textValue(raw.loginDescription, DEFAULT_TENANT_BRANDING.loginDescription, 300),
    exportFooter: textValue(raw.exportFooter, DEFAULT_TENANT_BRANDING.exportFooter, 160),
    isCustomized: raw.isCustomized === true
  };
}

function isLegacyDefaultBranding(raw: Record<string, unknown>): boolean {
  return raw.brandName === "枕水江南"
    && raw.systemName === "枕水江南外卖增长智能体"
    && raw.loginHeadline === "让 AI 成为枕水江南外卖增长的工作台"
    && (!raw.logoUrl || typeof raw.logoUrl !== "string");
}

export function tenantBrandLogoSrc(branding: TenantBrandingConfig): string | undefined {
  return branding.logoUrl ? apiPath(branding.logoUrl) : undefined;
}

export function publishTenantBranding(value: unknown): TenantBrandingConfig {
  const branding = normalizeTenantBranding(value);
  localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
  window.dispatchEvent(new CustomEvent<TenantBrandingConfig>(BRANDING_EVENT, { detail: branding }));
  applyBranding(branding);
  return branding;
}

export function clearTenantBrandingCache(): void {
  localStorage.removeItem(BRANDING_CACHE_KEY);
  applyBranding(DEFAULT_TENANT_BRANDING);
}

export function useTenantBranding(): TenantBrandingConfig {
  const [branding, setBranding] = useState<TenantBrandingConfig>(readCachedBranding);

  useEffect(() => {
    applyBranding(branding);
  }, [branding]);

  useEffect(() => {
    const onBranding = (event: Event) => {
      const detail = (event as CustomEvent<TenantBrandingConfig>).detail;
      setBranding(normalizeTenantBranding(detail));
    };
    window.addEventListener(BRANDING_EVENT, onBranding);
    const token = localStorage.getItem("store_os_token");
    if (token) {
      void fetch(apiPath("/tenant/current"), { headers: { Authorization: `Bearer ${token}` } })
        .then(async (response) => {
          if (!response.ok) throw new Error("branding_load_failed");
          return response.json() as Promise<{ branding?: unknown }>;
        })
        .then((payload) => setBranding(publishTenantBranding(payload.branding)))
        .catch(() => undefined);
    }
    return () => window.removeEventListener(BRANDING_EVENT, onBranding);
  }, []);

  return branding;
}

export function usePublicTenantBranding(): {
  branding: TenantBrandingConfig;
  matched: boolean;
  loading: boolean;
  hostname: string;
} {
  const hostname = window.location.hostname.toLowerCase();
  const [state, setState] = useState({
    branding: DEFAULT_TENANT_BRANDING,
    matched: false,
    loading: true,
    hostname
  });

  useEffect(() => {
    let active = true;
    void fetch(`${apiPath("/public/tenant-branding")}?hostname=${encodeURIComponent(hostname)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("public_branding_load_failed");
        return response.json() as Promise<{ branding?: unknown; matched?: boolean; hostname?: string }>;
      })
      .then((payload) => {
        if (!active) return;
        const branding = normalizeTenantBranding(payload.branding);
        applyBranding(branding);
        setState({ branding, matched: payload.matched === true, loading: false, hostname: payload.hostname ?? hostname });
      })
      .catch(() => {
        if (active) setState({ branding: DEFAULT_TENANT_BRANDING, matched: false, loading: false, hostname });
      });
    return () => { active = false; };
  }, [hostname]);

  return state;
}

function readCachedBranding(): TenantBrandingConfig {
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY);
    return raw ? normalizeTenantBranding(JSON.parse(raw)) : DEFAULT_TENANT_BRANDING;
  } catch {
    return DEFAULT_TENANT_BRANDING;
  }
}

function applyBranding(branding: TenantBrandingConfig): void {
  document.documentElement.style.setProperty("--tenant-primary", branding.primaryColor);
  document.documentElement.dataset.tenantBranding = branding.isCustomized ? "custom" : "default";
  document.title = branding.isCustomized ? branding.systemName : DEFAULT_TENANT_BRANDING.systemName;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}
