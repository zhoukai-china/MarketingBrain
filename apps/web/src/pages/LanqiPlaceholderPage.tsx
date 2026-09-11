/**
 * 兰琪未开发板块的统一占位页（LQ-20）。
 *
 * 侧栏 8 项必须**每一项都能落在兰琪自己的页面上**。以前 6 项写成 `/lanqi/brain`，
 * 而 `/lanqi/brain` 不在路由表里，点下去就掉进全局兜底页（外卖增长智能体首页），
 * 看起来像「串台」（报告 Bug2）。现在未开发的板块统一落到这里：明说「开发中」，
 * 给出该板块要解决什么，而不是把用户甩到一个别的产品的首页。
 */
import { getAppPath } from "../lib/api.js";
import { LanqiBrainShell, type BrainActive } from "../components/lanqi-brain/LanqiBrainShell.js";

export interface LanqiPlaceholderProps {
  active: BrainActive;
  icon: string;
  title: string;
  subtitle: string;
  summary: string;
  bullets: string[];
}

export function LanqiPlaceholderPage({ active, icon, title, subtitle, summary, bullets }: LanqiPlaceholderProps) {
  return (
    <LanqiBrainShell active={active} mainTitle={title} subtitle={subtitle} crumb={`/ ${title}`}>
      <div className="lq-dash">
        <section className="lq-dash__block">
          <header className="lq-dash__block-head">
            <h2>{icon} {title}</h2>
            <p>{subtitle}</p>
            <span className="lq-dash__spacer" />
            <span className="lq-dash__pill">开发中 · 后续板块</span>
          </header>
          <p className="lq-dash__target-foot">{summary}</p>
          <ul className="lq-dash__rules">
            {bullets.map((item) => (
              <li key={item} className="lq-dash__rule lq-dash__rule--pending">
                <span className="lq-dash__rule-dot" />
                <b>{item}</b>
                <span className="lq-dash__rule-level">待开发</span>
                <span className="lq-dash__rule-detail">已排进兰琪经营大脑后续版本</span>
              </li>
            ))}
          </ul>
          <div className="lq-dash__tools" style={{ marginTop: 16 }}>
            <a href={getAppPath("/lanqi/moments")}>💬 去用私域营销<span>朋友圈 / 微信群话术（已上线）</span></a>
            <a href={getAppPath("/lanqi/brain")}>🧭 返回板块总览<span>看看八个板块各自开放到哪一步</span></a>
          </div>
        </section>
      </div>
    </LanqiBrainShell>
  );
}

/**
 * 本轮上线口径（用户 2026-09-11）：只有「私域营销」可以正常上线，其余板块显示「开发中」。
 *
 * 经营驾驶舱（LQ-20）用户已明确「本轮不验收」，公域获客（LQ-19）还是「待业务验收」，
 * 所以这两块也按「开发中」对待——真实页面组件保留在仓库里，等对应板块专项验收通过后
 * 由 `apps/web/src/main.tsx` 的 `LANQI_MOMENTS_ONLY_LAUNCH` 白名单逐块放开。
 */
export function LanqiDashboardInDevelopmentPage() {
  return (
    <LanqiPlaceholderPage
      active="home"
      icon="🏠"
      title="经营驾驶舱"
      subtitle="本月目标与达成 · 9 维健康度 · 今日动作"
      summary="把门店本月目标、达成进度、9 维经营健康度和今天该做什么放到一屏。本板块还在开发中，暂未对门店开放。"
      bullets={["本月目标与达成进度（老板手输 4 个目标）", "9 维经营健康度雷达与门店红绿灯", "今日关键指标与今日动作清单"]}
    />
  );
}

export function LanqiAcquireInDevelopmentPage() {
  return (
    <LanqiPlaceholderPage
      active="acquire"
      icon="📣"
      title="公域获客"
      subtitle="短视频文案 · 直播话术 · AI 运营顾问"
      summary="面向公域流量的获客动作：短视频文案改稿、直播话术、AI 运营顾问和文案转片。本板块还在开发中，暂未对门店开放。"
      bullets={["短视频文案改稿（四步向导）", "直播话术逐字稿与 AI 运营顾问", "文案转片与爆款复刻（待接通外部服务）"]}
    />
  );
}

export function LanqiCasesPage() {
  return (
    <LanqiPlaceholderPage
      active="cases"
      icon="🏬"
      title="门店AI使用案例"
      subtitle="同行怎么用的 · 可复制的动作"
      summary="把美业门店真实能用起来的 AI 动作整理成案例，按门店阶段（新店/稳定期/连锁）分类，看完能直接照着做。"
      bullets={["按门店阶段筛选案例", "每个案例给「用了什么 + 结果 + 怎么复现」", "门店可直接收藏成本店动作清单"]}
    />
  );
}

export function LanqiCustomersPage() {
  return (
    <LanqiPlaceholderPage
      active="crm"
      icon="👤"
      title="客户管理"
      subtitle="客户档案 · 沉睡分层 · 到店记录"
      summary="按客户档案自动维护到店与消费记录，按「最后一次到店」自动分档 M1/M2/M3，客户数据不外泄给其他门店。"
      bullets={["客户档案与到店记录", "沉睡分层自动打标（M1/M2/M3）", "分店数据严格隔离，只认本店客户"]}
    />
  );
}

export function LanqiAnalysisPage() {
  return (
    <LanqiPlaceholderPage
      active="analysis"
      icon="📈"
      title="AI客户分析"
      subtitle="客户结构 · 复购与流失预警"
      summary="基于客户档案和流水做结构分析：新客占比、复购率、流失风险，先把结论说清楚再给动作。"
      bullets={["客户结构分层（新客 / 老客 / 沉睡）", "复购与流失风险预警", "分析结论直接转成当日动作"]}
    />
  );
}

export function LanqiSalesSimPage() {
  return (
    <LanqiPlaceholderPage
      active="sales"
      icon="🤝"
      title="AI模拟销售"
      subtitle="话术陪练 · 异议处理"
      summary="把客户最常问的问题变成陪练场景，前台先在这里练一遍，再到店里用，降低开口难度。"
      bullets={["按项目（卡项 / 升级 / 唤醒）出陪练场景", "常见异议的标准应答", "陪练记录只在本门店可见"]}
    />
  );
}

export function LanqiStoreAdminPage() {
  return (
    <LanqiPlaceholderPage
      active="store"
      icon="🖥️"
      title="门店后台"
      subtitle="门店资料 · 员工与权限"
      summary="门店自己的后台：门店资料、员工与角色权限（老板 / 店长 / 前台），目标是先管住「谁能改什么」。"
      bullets={["门店资料与营业信息", "员工与角色权限管理", "目标修改权只给老板 / 店长"]}
    />
  );
}
