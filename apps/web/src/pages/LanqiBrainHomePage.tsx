import { useEffect } from "react";
import { apiPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import { getAppPath } from "../lib/api.js";

/**
 * 兰琪八板块总览（`/lanqi/brain`）。
 *
 * 每一项都必须指向**真实存在的兰琪路由**：以前 6 项都写 `/lanqi/brain`，
 * 等于点了原地不动或掉进兜底页；现在未开发的板块落到兰琪自己的占位页。
 */
const BOARDS: Array<{ key: string; name: string; icon: string; href: string; done: boolean }> = [
  { key: "home", name: "经营驾驶舱", icon: "🏠", href: getAppPath("/lanqi/dashboard"), done: true },
  { key: "cases", name: "门店AI使用案例", icon: "🏬", href: getAppPath("/lanqi/cases"), done: false },
  { key: "acquire", name: "公域获客", icon: "📣", href: getAppPath("/lanqi/acquire"), done: true },
  { key: "moments", name: "私域营销", icon: "💬", href: getAppPath("/lanqi/moments"), done: true },
  { key: "crm", name: "客户管理", icon: "👤", href: getAppPath("/lanqi/customers"), done: false },
  { key: "analysis", name: "AI客户分析", icon: "📈", href: getAppPath("/lanqi/analysis"), done: false },
  { key: "sales", name: "AI模拟销售", icon: "🤝", href: getAppPath("/lanqi/sales-sim"), done: false },
  { key: "store", name: "门店后台", icon: "🖥️", href: getAppPath("/lanqi/store"), done: false }
];

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function LanqiBrainHomePage() {
  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) return;
    void fetch(apiPath("/lanqi/stores"), { headers: authHeaders() }).catch(() => {});
  }, []);

  return (
    <LanqiBrainShell active="brain" subtitle="经营驾驶舱">
      <main className="lq-brain__main">
        <div className="lq-brain__cards">
          {BOARDS.map((b) => (
            <a key={b.key} className={`lq-brain__card${b.done ? " on" : ""}`} href={b.href}>
              <span className="lq-brain__card-ic">{b.icon}</span>
              <span className="lq-brain__card-name">{b.name}</span>
              <span className="lq-brain__card-tag">{b.done ? "可体验" : "开发中 · 后续板块"}</span>
            </a>
          ))}
        </div>
        <p className="lq-brain__note">已可体验：经营驾驶舱（本月目标与达成 · 9 维健康度 · 今日动作）、私域营销（朋友圈快速/专业模式 + 微信群话术）、公域获客（视频获客 / 文案改稿 / 直播话术 / AI 运营顾问）。其余板块陆续开放。</p>
      </main>
    </LanqiBrainShell>
  );
}
