import { useEffect, type ReactNode } from "react";
import { getAppPath } from "../../lib/api.js";

export type BrainActive = "brain" | "home" | "cases" | "acquire" | "moments" | "crm" | "analysis" | "sales" | "store";

/**
 * 侧栏导航必须逐项指向**真实存在的兰琪路由**。
 *
 * 之前 8 项里有 6 项都写成 `/lanqi/brain`，而 `/lanqi/brain` 又不在 `main.tsx` 的
 * 兰琪路由表内，于是点侧栏会掉进全局兜底页（外卖增长智能体首页），看起来像「串台」。
 * 现在每一项都指向兰琪自己的地址，未开发的板块由 `/lanqi/*` 兜底页接管。
 */
const NAV: Array<{ key: BrainActive; name: string; icon: string; href: string; badge?: string }> = [
  { key: "home", name: "经营驾驶舱", icon: "🏠", href: getAppPath("/lanqi/dashboard") },
  { key: "cases", name: "门店AI使用案例", icon: "🏬", href: getAppPath("/lanqi/cases") },
  { key: "acquire", name: "公域获客", icon: "📣", href: getAppPath("/lanqi/acquire") },
  { key: "moments", name: "私域营销", icon: "💬", href: getAppPath("/lanqi/moments") },
  { key: "crm", name: "客户管理", icon: "👤", href: getAppPath("/lanqi/customers") },
  { key: "analysis", name: "AI客户分析", icon: "📈", href: getAppPath("/lanqi/analysis") },
  { key: "sales", name: "AI模拟销售", icon: "🤝", href: getAppPath("/lanqi/sales-sim") },
  { key: "store", name: "门店后台", icon: "🖥️", href: getAppPath("/lanqi/store"), badge: "新" }
];

/** demo 顶栏品牌名：`ws-top h1 .main-title` 写品牌名的页面用它做主标题。 */
const BRAND_TITLE = "兰琪·美业门店AI经营大脑";

/**
 * 顶栏结构逐页对齐 demo 的 `ws-top h1`：
 * `<span class="main-title">主标题</span><span class="sub-title">副标题</span>`。
 * 原型里主标题并不统一（acquire/video/methods 用品牌名，moments/live/copywriter 用模块名），
 * 这里保留各页原型文案，不做“统一美化”，避免与 demo 对照时出现差异。
 */
export function LanqiBrainShell({ active, mainTitle, subtitle, crumb, headerSlot, children }: { active: BrainActive; mainTitle?: string; subtitle: string; crumb?: string; headerSlot?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.setProperty("color-scheme", "light");
    document.body.style.background = "#F4F1EC";
  }, []);

  // demo 只在经营驾驶舱（home.html）保留「今日待办」入口，其余板块顶栏不出现该按钮。
  const showTodo = active === "brain" || active === "home";

  return (
    <div className="lq-pd">
        <aside className="lq-pd__side">
          <div className="lq-pd__brand"><span className="lq-pd__logo">兰琪</span><span className="lq-pd__brand-name">美业门店 AI 经营大脑</span></div>
          <nav className="lq-pd__nav">
            {NAV.map((n) => (
              <a key={n.key} className={`lq-pd__item${active === n.key ? " on" : ""}`} href={n.href}>
                <span>{n.icon}</span><span className="lq-pd__label">{n.name}</span>
                {n.badge ? <span className="lq-pd__badge">{n.badge}</span> : null}
              </a>
            ))}
          </nav>
        </aside>
        <main className="lq-pd__main">
          <header className="lq-pd__top">
            <div className="lq-pd__crumb">
              <h1>
                <span className="lq-pd__title">{mainTitle ?? BRAND_TITLE}</span>
                <span className="lq-pd__sub">{subtitle}</span>
              </h1>
            </div>
            {crumb ? <span className="lq-pd__path">{crumb}</span> : null}
            <div className="lq-pd__controls">
              {headerSlot}
              <span className="lq-pd__pts">🔄 多端实时同步</span>
              <a href={getAppPath("/my-ai")} className="lq-pd__me">
                <span className="lq-pd__me-avatar">🧑</span>
                <span className="lq-pd__me-label">我的</span>
              </a>
              {/*
                「今日待办」原来是个没有 onClick 的 <button>，点了没反应（报告 Bug6）。
                这里改成真链接：跳到驾驶舱「今天干什么」，那里才是按当前信号生成的动作清单。
              */}
              {showTodo ? (
                <a className="lq-pd__todo" href={`${getAppPath("/lanqi/dashboard")}#today`}>🔔 今日待办</a>
              ) : null}
            </div>
          </header>
          <section className="lq-pd__body">{children}</section>
        </main>
      </div>
  );
}
