/**
 * 兰琪经营驾驶舱（LQ-20，一期单店）。
 *
 * 区块顺序对齐原型 home.html：结论条 → 本月目标与达成 → 9 维雷达 →
 * 门店健康度红绿灯 → 今日关键指标 → 工具入口 → 今天干什么。
 *
 * 铁律：本页**没有任何录入框**。全系统只有「本月 4 个目标」可手输，入口是
 * `⚙ 设置目标`（跳 goal-setting）。目标未设置时一切派生值渲染成引导文案，
 * 不显示 0、更不显示 NaN。
 */
import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import {
  type DashboardView,
  type Radar,
  type RadarDim,
  type Todo,
  LanqiApiError,
  currentMonthKey,
  fetchDashboard,
  formatMoney,
  formatPct
} from "../lib/lanqi-dashboard.js";
import "../styles/lanqi-dashboard.css";

// ===== 9 维雷达（纯 SVG，无图表库、无动画、不可拖拽）=====

const RADAR_SIZE = 400;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_R = 112;
const RADAR_LABEL_R = 141;
const RADAR_RINGS = [25, 50, 75, 100];
const RADAR_START_DEG = -90;
const RADAR_STEP_DEG = 40;

function pointOn(radius: number, index: number, count: number): { x: number; y: number } {
  const deg = RADAR_START_DEG + RADAR_STEP_DEG * index;
  const rad = (deg * Math.PI) / 180;
  return { x: RADAR_CENTER + radius * Math.cos(rad), y: RADAR_CENTER + radius * Math.sin(rad) };
}

function polygonOf(radius: number, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const { x, y } = pointOn(radius, index, count);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function RadarChart({ radar }: { radar: Radar }) {
  const count = radar.dims.length;
  const measured = radar.dims.filter((dim) => dim.score !== null);

  // 已测维度按分数连成面；待设目标的维度不参与，避免出现「0 分」的假形状。
  const shape = measured.length >= 3
    ? measured
        .map((dim) => {
          const index = radar.dims.indexOf(dim);
          const { x, y } = pointOn((RADAR_R * (dim.score ?? 0)) / 100, index, count);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";

  return (
    <div className="lq-dash__radar">
      <svg viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`} role="img" aria-label="9 维经营健康度雷达">
        {RADAR_RINGS.map((pct) => (
          <polygon
            key={pct}
            points={polygonOf((RADAR_R * pct) / 100, count)}
            className={`lq-radar__ring${pct === 100 ? " outer" : ""}`}
          />
        ))}
        {Array.from({ length: count }, (_, index) => {
          const { x, y } = pointOn(RADAR_R, index, count);
          return <line key={index} x1={RADAR_CENTER} y1={RADAR_CENTER} x2={x} y2={y} className="lq-radar__spoke" />;
        })}
        {/* 85 分健康线（虚线） */}
        <polygon points={polygonOf((RADAR_R * 85) / 100, count)} className="lq-radar__line85" />
        {shape ? <polygon points={shape} className="lq-radar__shape" /> : null}
        {measured.map((dim) => {
          const index = radar.dims.indexOf(dim);
          const { x, y } = pointOn((RADAR_R * (dim.score ?? 0)) / 100, index, count);
          return <circle key={dim.k} cx={x} cy={y} r={4} className="lq-radar__dot" style={{ fill: dim.color ?? "#999" }} />;
        })}
        {radar.dims.map((dim: RadarDim, index: number) => {
          const { x, y } = pointOn(RADAR_LABEL_R, index, count);
          const anchor = index === 0 ? "middle" : x > RADAR_CENTER + 6 ? "start" : x < RADAR_CENTER - 6 ? "end" : "middle";
          return (
            <text
              key={dim.k}
              x={x}
              y={y}
              textAnchor={anchor}
              className={`lq-radar__label${dim.score === null ? " pending" : ""}`}
              dominantBaseline="middle"
            >
              {dim.ico} {dim.n}
            </text>
          );
        })}
      </svg>
      <div className="lq-radar__side">
        <div className="lq-radar__total">
          <span className="lq-radar__total-num">{radar.total === null ? "—" : radar.total}</span>
          <span className="lq-radar__total-unit">综合健康度 · {radar.level}</span>
        </div>
        <ul className="lq-radar__legend">
          {radar.dims.map((dim) => (
            <li key={dim.k} className={dim.score === null ? "pending" : ""}>
              <span className="lq-radar__dot" style={{ background: dim.color ?? "#C9BEB4" }} />
              <span className="lq-radar__name">{dim.ico} {dim.n}</span>
              <span className="lq-radar__val">
                {dim.value === null ? "待设目标" : `${dim.value}${dim.unit}`}
                {dim.score === null ? "" : ` · ${dim.score} 分`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ===== 小组件 =====

function TodoList({ todos }: { todos: Todo[] }) {
  if (!todos.length) {
    return <p className="lq-dash__empty">今天没有需要特别处理的信号，按日常节奏执行即可。</p>;
  }
  return (
    <ul className="lq-dash__todos">
      {todos.map((todo) => (
        <li key={todo.id}>
          <span className={`lq-dash__pri lq-dash__pri--${todo.priority.toLowerCase()}`}>{todo.priority}</span>
          <div className="lq-dash__todo-main">
            <a href={getAppPath(todo.href)} className="lq-dash__todo-title">{todo.title}</a>
            <p className="lq-dash__todo-why">{todo.why}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const HEALTH_LABEL: Record<string, string> = { ok: "正常", warn: "需关注", bad: "有风险", pending: "待设目标" };

export function LanqiDashboardPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const [view, setView] = useState<DashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchDashboard({ month })
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "驾驶舱加载失败");
        setErrorCode(cause instanceof LanqiApiError ? cause.code : "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const goalSettingHref = getAppPath(`/lanqi/goal-setting?month=${month}`);
  const pending = view?.state === "ready" && view.goalStatus === "unset";

  return (
    <LanqiBrainShell
      active="brain"
      subtitle="经营驾驶舱"
      crumb="/ 经营驾驶舱"
      mainTitle="经营驾驶舱"
      headerSlot={
        <div className="lq-dash__header-actions">
          <select value={month} onChange={(event) => setMonth(event.target.value)} aria-label="选择月份">
            {[0, 1, 2, 3, 4, 5].map((offset) => {
              const date = new Date();
              date.setDate(1);
              date.setMonth(date.getMonth() - offset);
              const key = currentMonthKey(date);
              return <option key={key} value={key}>{`${date.getFullYear()}年${date.getMonth() + 1}月`}</option>;
            })}
          </select>
          {view?.state === "ready" && view.canEditGoals !== false ? (
            <a className="lq-dash__set-goal" href={goalSettingHref}>⚙ 设置目标</a>
          ) : null}
        </div>
      }
    >
      <div className="lq-dash">
        {loading ? <p className="lq-dash__loading">正在加载驾驶舱…</p> : null}

        {!loading && error ? (
          <section className="lq-dash__error" role="alert">
            <h2>{errorCode === "unauthorized" ? "请先登录" : "驾驶舱暂时打不开"}</h2>
            <p>{error}</p>
            <div className="lq-dash__error-actions">
              <button type="button" onClick={() => setMonth(currentMonthKey())}>重试</button>
              {errorCode === "unauthorized" ? <a href={getAppPath("/login/lanqi")}>去登录</a> : null}
            </div>
          </section>
        ) : null}

        {!loading && !error && view?.state === "no_store" ? (
          <section className="lq-dash__empty-store">
            <h2>还没有门店</h2>
            <p>驾驶舱按门店统计。先创建门店并绑定店长/前台，这里才会出现经营数据。</p>
            <a className="lq-dash__cta" href={getAppPath("/lanqi/store-profile")}>去完善门店资料</a>
          </section>
        ) : null}

        {!loading && !error && view?.state === "ready" && view.targets && view.verdict && view.radar && view.health && view.today ? (
          <>
            {view.dataSource === "demo" ? (
              <p className="lq-dash__demo-note">
                当前为<b>演示数据</b>：门店经营指标由系统按门店 + 月份生成的确定性快照，尚未接入真实收银 / 扣卡流水。
                只有「本月 4 个目标」是手输数据。
              </p>
            ) : null}

            {/* ① 结论条 */}
            <section className={`lq-dash__verdict lq-dash__verdict--${view.verdict.tone}`}>
              <span className="lq-dash__verdict-tag">本月结论</span>
              <div className="lq-dash__verdict-body">
                {view.verdict.tone === "pending" ? (
                  <>
                    <b>还没设本月目标，先设置目标</b>
                    <p>时间进度 {view.verdict.timePct}%。没有目标就算不出达成率、缺口和日均，驾驶舱只能先看已完成值。</p>
                  </>
                ) : (
                  <>
                    <b>
                      预计月末完成 {formatMoney(view.verdict.forecast)}
                      {view.verdict.gap !== null && view.verdict.gap >= 0
                        ? `，超目标 ${formatMoney(view.verdict.gap)}`
                        : `，还差 ${formatMoney(Math.abs(view.verdict.gap ?? 0))}`}
                    </b>
                    <p>
                      业绩达成 {formatPct(view.verdict.revPct)}，时间进度 {view.verdict.timePct}%。
                      {view.verdict.weakestLabel
                        ? `最拖后腿的是「${view.verdict.weakestLabel}」${formatPct(view.verdict.weakestPct)}，落后时间进度 ${view.verdict.weakestBehindPct} 个百分点`
                        : ""}
                    </p>
                  </>
                )}
              </div>
            </section>

            {/* ② 本月目标与达成 */}
            <section className="lq-dash__block">
              <header className="lq-dash__block-head">
                <h2>本月目标与达成</h2>
                <p>
                  {view.month.name} · 已过 {view.month.passedDays} 天 / 剩 {view.month.leftDays} 天
                  {view.goalStatus === "carried_over" ? ` · 目标沿用 ${view.goalFromMonth}` : ""}
                </p>
                <span className="lq-dash__spacer" />
                {view.goalStatus === "unset" ? (
                  <a className="lq-dash__pill lq-dash__pill--warn" href={goalSettingHref}>未设置 · 去设置目标</a>
                ) : view.goalStatus === "carried_over" ? (
                  <a className="lq-dash__pill" href={goalSettingHref}>沿用上月，点此修改</a>
                ) : null}
                {view.canEditGoals === false ? <span className="lq-dash__pill">前台只读</span> : null}
              </header>
              <div className="lq-dash__targets">
                {view.targets.map((target) => {
                  const pct = target.achievedPct === null ? null : Math.min(100, Math.max(0, target.achievedPct));
                  return (
                    <article key={target.key} className={`lq-dash__target${target.goalSet ? "" : " pending"}`}>
                      <div className="lq-dash__target-head">
                        <span className="lq-dash__target-ic">{target.icon}</span>
                        <span className="lq-dash__target-name">{target.label}</span>
                        <span className="lq-dash__spacer" />
                        <span className="lq-dash__tag-auto">已完成自动统计</span>
                      </div>
                      <div className="lq-dash__target-nums">
                        <div>
                          <span className="lq-dash__k">本月目标</span>
                          <b>{target.goalSet ? (target.key === "rev" ? formatMoney(target.goal) : `${target.goal} ${target.unit}`) : "未设置"}</b>
                        </div>
                        <div>
                          <span className="lq-dash__k">已完成</span>
                          <b className="ro">{target.key === "rev" ? formatMoney(target.cur) : `${target.cur} ${target.unit}`}</b>
                        </div>
                      </div>
                      <div className="lq-dash__bar"><i style={{ width: `${pct ?? 0}%` }} /></div>
                      <p className="lq-dash__target-foot">
                        {target.goalSet ? (
                          <>
                            达成 <b>{formatPct(target.achievedPct)}</b>
                            {target.gap === 0
                              ? " · 已达标 🎉"
                              : (
                                <>
                                  {" · 还差 "}
                                  <b>{target.key === "rev" ? formatMoney(target.gap) : `${target.gap} ${target.unit}`}</b>
                                  {target.perDay !== null ? <> · 剩余 {view.month.leftDays} 天，日均 {target.key === "rev" ? formatMoney(target.perDay) : `${target.perDay} ${target.unit}`}</> : null}
                                </>
                              )}
                          </>
                        ) : (
                          <>目标未设置，达成率与缺口暂不计算 · <a href={goalSettingHref}>去设置</a></>
                        )}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* ③ 9 维雷达 */}
            <section className="lq-dash__block">
              <header className="lq-dash__block-head">
                <h2>9 维经营健康度</h2>
                <p>
                  只有 100% 来自自动统计。
                  {view.radar.measured < view.radar.dims.length ? `当前有 ${view.radar.pendingKeys.length} 个维度缺目标，先设目标才能算全。` : ""}
                </p>
              </header>
              <RadarChart radar={view.radar} />
            </section>

            {/* ④ 门店健康度红绿灯 */}
            <section className="lq-dash__block">
              <header className="lq-dash__block-head">
                <h2>门店健康度</h2>
                <p>{view.store?.name} · 红绿灯只看硬指标，不看好话</p>
                <span className="lq-dash__spacer" />
                <span className={`lq-dash__light lq-dash__light--${view.health.light}`}>{view.health.label}</span>
              </header>
              <ul className="lq-dash__rules">
                {view.health.rules.map((rule) => (
                  <li key={rule.key} className={`lq-dash__rule lq-dash__rule--${rule.level}`}>
                    <span className="lq-dash__rule-dot" />
                    <b>{rule.label}</b>
                    <span className="lq-dash__rule-level">{HEALTH_LABEL[rule.level]}</span>
                    <span className="lq-dash__rule-detail">{rule.detail}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* ⑤ 今日关键指标 */}
            <section className="lq-dash__block">
              <header className="lq-dash__block-head">
                <h2>今日关键指标</h2>
                <p>当天流水实时统计，全部只读</p>
              </header>
              <div className="lq-dash__today">
                <div><span>今日营收</span><b>{formatMoney(view.today.revenue)}</b></div>
                <div><span>今日到店</span><b>{view.today.visits} 人</b></div>
                <div><span>客单价</span><b>{formatMoney(view.today.aov)}</b></div>
                <div><span>会员数</span><b>{view.today.membersTotal} 人</b></div>
                <div><span>沉睡率</span><b>{view.today.sleepRate}%</b></div>
                <div><span>卡耗率</span><b>{view.today.kahaoRate}%</b></div>
              </div>
              <div className="lq-dash__tiers">
                {view.today.sleepTiers.map((tier) => (
                  <div key={tier.key}>
                    <span>{tier.key.toUpperCase()} 沉睡存量</span>
                    <b>{tier.stock} 人</b>
                    <i>今日唤醒 {tier.cur} · {tier.rate}%</i>
                  </div>
                ))}
              </div>
            </section>

            {/* ⑥ 工具入口 */}
            <section className="lq-dash__block">
              <header className="lq-dash__block-head">
                <h2>工具入口</h2>
                <p>发现信号后直接进对应工具处理</p>
              </header>
              <div className="lq-dash__tools">
                <a href={getAppPath("/lanqi/moments")}>💬 私域营销<span>朋友圈 / 微信群话术</span></a>
                <a href={getAppPath("/lanqi/acquire")}>📣 公域获客<span>视频 / 文案 / 直播</span></a>
                <a href={getAppPath("/lanqi/business-qa")}>🧠 经营问答<span>先问再动手</span></a>
                <a href={goalSettingHref}>⚙ 目标设定<span>唯一手输入口</span></a>
              </div>
            </section>

            {/* ⑦ 今天干什么 */}
            <section className="lq-dash__block" id="today">
              <header className="lq-dash__block-head">
                <h2>今天干什么</h2>
                <p>只按当前已经算出来的信号给动作，没信号就不编</p>
              </header>
              <TodoList todos={view.todos} />
            </section>

            {pending ? (
              <p className="lq-dash__foot-note">
                提示：整个系统只有「本月 4 个目标」需要老板手输，其余数字都由收银 / 扣卡 / 客户档案自动统计。
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </LanqiBrainShell>
  );
}
