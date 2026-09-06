import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { getAppPath } from "../../lib/api.js";

export type BeautyIndustryNavKey = "home" | "daily" | "knowledge" | "acquisition" | "sales" | "delivery" | "operations" | "tasks" | "profile" | "workbuddy";

export type BeautyIndustryPublicBrand = {
  version: string;
  brandCode: "default" | "lanqi";
  displayName: string;
  productSubtitle: string;
  theme: {
    tokenName: "beauty-default" | "lanqi-orange";
    primary: string;
    primaryDark: string;
    primaryLight: string;
    surface: string;
    text: string;
    textOnPrimary: string;
  };
  logo: { kind: "text"; text: string };
  domain: { mode: "shared_current_entry"; hostname: null };
  pageCopy: { workspaceKicker: string; connectionLabel: string };
  featureFlags: { customBrandKnowledge: false };
  knowledge: { status: "not_configured" | "awaiting_authorized_sources"; authorized: false };
};

const DEFAULT_BRAND: BeautyIndustryPublicBrand = {
  version: "beauty-industry-brand-v1",
  brandCode: "default",
  displayName: "美业智能体",
  productSubtitle: "门店 AI 经营大脑",
  theme: { tokenName: "beauty-default", primary: "#1F6B57", primaryDark: "#17352F", primaryLight: "#D9EEE7", surface: "#F7F5EF", text: "#17352F", textOnPrimary: "#FFFFFF" },
  logo: { kind: "text", text: "美" },
  domain: { mode: "shared_current_entry", hostname: null },
  pageCopy: { workspaceKicker: "门店经营工作台", connectionLabel: "美业专属连接" },
  featureFlags: { customBrandKnowledge: false },
  knowledge: { status: "not_configured", authorized: false }
};

export const BEAUTY_INDUSTRY_NAV_ITEMS: Array<{
  key: BeautyIndustryNavKey;
  label: string;
  path: string;
  icon: string;
  status?: "planned";
  requiredTool?: string;
}> = [
  { key: "home", label: "工作台首页", path: "/agents/beauty-industry", icon: "⌂" },
  { key: "daily", label: "美业 AI 日报", path: "/agents/beauty-industry/daily", icon: "▥", status: "planned" },
  { key: "knowledge", label: "美业知识问题", path: "/agents/beauty-industry/knowledge", icon: "?", status: "planned" },
  { key: "acquisition", label: "美业获客", path: "/agents/beauty-industry/acquisition", icon: "↗" },
  { key: "sales", label: "美业销售", path: "/agents/beauty-industry/sales", icon: "◎", requiredTool: "beauty.sales_advice" },
  { key: "delivery", label: "美业专属交付", path: "/agents/beauty-industry/delivery", icon: "◇", status: "planned" },
  { key: "operations", label: "美业专属经营", path: "/agents/beauty-industry/operations", icon: "⌁", status: "planned" },
  { key: "tasks", label: "任务中心", path: "/agents/beauty-industry/tasks", icon: "▤" },
  { key: "profile", label: "经营档案", path: "/agents/beauty-industry/profile", icon: "○" },
  { key: "workbuddy", label: "WorkBuddy 连接", path: "/agents/beauty-industry/workbuddy", icon: "⌘" }
];

type BeautyIndustryShellProps = {
  activeKey: BeautyIndustryNavKey;
  pageTitle: string;
  creditBalance?: number;
  enterpriseName?: string;
  city?: string | null;
  localAcceptance?: boolean;
  permittedTools?: ReadonlySet<string>;
  brand?: BeautyIndustryPublicBrand;
  children: ReactNode;
};

export function BeautyIndustryShell(props: BeautyIndustryShellProps) {
  const brand = props.brand ?? DEFAULT_BRAND;
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const navId = "beauty-industry-primary-navigation";

  useEffect(() => {
    document.title = `${props.pageTitle}｜${brand.displayName} · ${brand.productSubtitle}`;
    const description = `${brand.displayName}，${brand.productSubtitle}。当前页面只读取已授权租户数据。`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [brand.displayName, brand.productSubtitle, props.pageTitle]);

  function setMenu(open: boolean, restoreFocus = false) {
    setMobileOpen(open);
    if (open) window.requestAnimationFrame(() => firstLinkRef.current?.focus());
    else if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setMenu(false, true);
  }

  const brandStyle = {
    "--beauty-green": brand.theme.primary,
    "--beauty-ink": brand.theme.text,
    "--beauty-mint": brand.theme.primaryLight,
    "--beauty-cream": brand.theme.surface,
    "--beauty-brand-dark": brand.theme.primaryDark,
    "--beauty-text-on-primary": brand.theme.textOnPrimary
  } as CSSProperties;

  return <main className="beautyIndustryPage beautyIndustryFormalPage" style={brandStyle} data-brand-code={brand.brandCode} data-theme-token={brand.theme.tokenName}>
    <div className="beautyIndustryShell">
      <aside className="beautyIndustrySidebar" data-open={mobileOpen ? "true" : "false"} onKeyDown={handleMenuKeyDown}>
        <div className="beautyIndustrySidebarHeader">
          <a className="beautyIndustrySidebarBrand" href={getAppPath("/agents/beauty-industry")} aria-label={`${brand.displayName}，${brand.productSubtitle}，返回工作台首页`}>
            <span>{brand.logo.text}</span><strong>{brand.displayName}</strong><small>{brand.productSubtitle}</small>
          </a>
          <button type="button" className="beautyIndustryMobileClose" onClick={() => setMenu(false, true)} aria-label="关闭导航">×</button>
        </div>
        <nav id={navId} aria-label="美业智能体主导航">
          {BEAUTY_INDUSTRY_NAV_ITEMS.map((item, index) => {
            const permissionState = item.requiredTool && !props.permittedTools?.has(item.requiredTool) ? "unavailable" : item.status ?? "available";
            return <a
              key={item.key}
              ref={index === 0 ? firstLinkRef : undefined}
              href={getAppPath(item.path)}
              className={props.activeKey === item.key ? "active" : ""}
              aria-current={props.activeKey === item.key ? "page" : undefined}
              data-permission-state={permissionState}
              onClick={() => setMobileOpen(false)}
            >
              <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>
              {permissionState === "planned" && <em>规划中</em>}
              {permissionState === "unavailable" && <em>未开通</em>}
            </a>;
          })}
        </nav>
        <p>规划中页面只说明用途与开放边界；导航不会创建任务、调用 Provider 或扣除积分。</p>
      </aside>
      {mobileOpen && <button type="button" className="beautyIndustryNavBackdrop" onClick={() => setMenu(false, true)} aria-label="关闭导航遮罩" />}
      <div className="beautyIndustryShellContent">
        <header className="beautyIndustryFormalTopbar">
          <button ref={menuButtonRef} type="button" className="beautyIndustryMobileMenu" aria-expanded={mobileOpen} aria-controls={navId} onClick={() => setMenu(!mobileOpen)} aria-label="展开美业智能体导航">☰ 导航</button>
          <div className="beautyIndustryTopProduct"><strong>{brand.displayName}</strong><small>{brand.productSubtitle}</small></div>
          <div className="beautyIndustryTenantStatus"><strong>{props.enterpriseName || "当前经营主体待补"}</strong><small>当前租户 · {props.city || "城市待补"}</small></div>
          {props.localAcceptance && <span className="beautyIndustryEnvironmentBadge">本地验收环境</span>}
          <div><span>积分余额</span><strong>{props.creditBalance ?? "—"}</strong></div>
          <a className="beautyIndustryBackToAi" href={getAppPath("/my-ai")}>返回我的 AI</a>
        </header>
        {props.children}
      </div>
    </div>
  </main>;
}
