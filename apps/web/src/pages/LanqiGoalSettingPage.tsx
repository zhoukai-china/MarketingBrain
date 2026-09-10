/**
 * 目标设置页（LQ-20）。
 *
 * 这是**整个兰琪系统里唯一的录入页**：4 个目标（业绩 / 新客 / 升单 / 沉睡唤醒）。
 * 每张卡里的「已完成」是自动统计的只读值，没有任何输入框。
 *
 * 三个关键口径：
 * ① 保存只提交**表单当前值**——原型 `goal-setting.html` 的 `save()` 会把编辑前的
 *    旧值写回去，这里从数据流上避免（提交的就是用户此刻输入框里的数字）；
 * ② 月初未设目标不能显示 0：输入框留空 + 明确提示「未设置 / 沿用上月」；
 * ③ 前台（staff/operator）只读：输入框 disabled，并给出原因，而不是静默禁用。
 */
import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import {
  type GoalKey,
  type GoalsView,
  LanqiApiError,
  currentMonthKey,
  fetchGoals,
  formatMoney,
  formatValue,
  saveGoals
} from "../lib/lanqi-dashboard.js";
import "../styles/lanqi-dashboard.css";

/** 每条目标的手输校验口径：与后端 `normalizeGoalValues` 保持一致。 */
const GOAL_LIMIT: Record<GoalKey, { max: number; min: number; label: string }> = {
  rev: { min: 1, max: 100_000_000, label: "业绩目标" },
  new: { min: 1, max: 100_000, label: "新客目标" },
  up: { min: 1, max: 100_000, label: "升单目标" },
  wake: { min: 1, max: 100_000, label: "沉睡唤醒" }
};

/** 驾驶舱数字的来源说明（原型 goal-setting.html 的 8 行表格，逐条照抄）。 */
const SOURCE_ROWS: Array<{ name: string; source: "man" | "auto"; how: string }> = [
  { name: "本月目标（业绩/新客/升单/唤醒）", source: "man", how: "老板或店长每月录入一次，按门店存；改完立即重算达成率" },
  { name: "已完成值（4 项）", source: "auto", how: "收银 + 扣卡流水实时汇总，没人手输" },
  { name: "会员数", source: "auto", how: "客户档案去重统计" },
  { name: "沉睡存量 / 沉睡率", source: "auto", how: "按「最后一次到店」自动分档：30-59 天 = M1，60-89 天 = M2，≥90 天 = M3；沉睡率 = 沉睡存量 ÷ 会员数" },
  { name: "卡耗率", source: "auto", how: "卡耗业绩 ÷ 预收余额（健康线 60%）" },
  { name: "预收负债", source: "auto", how: "充值实收 − 卡耗；赠送额不进预收，记营销费用" },
  { name: "今日营收 / 到店 / 客单价", source: "auto", how: "当天流水实时统计" },
  { name: "9 维健康度雷达", source: "auto", how: "全部由上面这些算出来，不单独录入" }
];

type Draft = Record<GoalKey, string>;

function draftFrom(values: Record<GoalKey, number | null>): Draft {
  return {
    rev: values.rev === null ? "" : String(values.rev),
    new: values.new === null ? "" : String(values.new),
    up: values.up === null ? "" : String(values.up),
    wake: values.wake === null ? "" : String(values.wake)
  };
}

/** 只保留数字；空字符串代表「这一项没填」，不会变成 0。 */
function parseDraft(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** 逐项校验，返回第一条能直接展示给用户的原因。 */
function validateDraft(draft: Draft): string {
  let atLeastOne = false;
  for (const key of Object.keys(GOAL_LIMIT) as GoalKey[]) {
    const raw = draft[key].trim();
    if (!raw) continue;
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return `${GOAL_LIMIT[key].label}只能填数字`;
    const num = Number(digits);
    if (!Number.isInteger(num) || num < GOAL_LIMIT[key].min) return `${GOAL_LIMIT[key].label}要填大于 0 的整数`;
    if (num > GOAL_LIMIT[key].max) return `${GOAL_LIMIT[key].label}超出合理范围，请核对是否多输了 0`;
    atLeastOne = true;
  }
  if (!atLeastOne) return "四个目标至少要填一个，否则驾驶舱算不出达成率";
  return "";
}

export function LanqiGoalSettingPage() {
  const params = new URLSearchParams(window.location.search);
  const [month] = useState(params.get("month")?.trim() || currentMonthKey());
  const [view, setView] = useState<GoalsView | null>(null);
  const [draft, setDraft] = useState<Draft>({ rev: "", new: "", up: "", wake: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchGoals({ month })
      .then((data) => {
        if (cancelled) return;
        setView(data);
        setDraft(draftFrom(data.values));
        setHint(
          data.status === "unset"
            ? "本月还没设目标。填完保存即可；不填的话驾驶舱不会显示 0，只会提示你来设置。"
            : ""
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "目标加载失败");
        setErrorCode(cause instanceof LanqiApiError ? cause.code : "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const canEdit = view?.canEdit ?? false;
  const dashboardHref = getAppPath("/lanqi/dashboard");

  function updateDraft(key: GoalKey, value: string) {
    // 输入框永远是唯一真值来源：任何一次编辑都直接写进 draft，不做「回读旧值」。
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setBlockedReason("");
    setHint("");
  }

  const validation = validateDraft(draft);
  const dirty = view ? JSON.stringify(draftFrom(view.values)) !== JSON.stringify(draft) : false;

  async function save() {
    if (!view) return;
    if (!view.canEdit) {
      setBlockedReason("当前账号是前台/操作员，只能查看目标、不能修改。要让老板或店长来改。");
      return;
    }
    const reason = validateDraft(draft);
    if (reason) {
      setBlockedReason(reason);
      return;
    }
    setBlockedReason("");
    setSaving(true);
    try {
      const targets: Record<GoalKey, number | null> = {
        rev: parseDraft(draft.rev),
        new: parseDraft(draft.new),
        up: parseDraft(draft.up),
        wake: parseDraft(draft.wake)
      };
      const result = await saveGoals({ storeId: view.store.id, month, targets });
      setView({ ...view, status: "set", fromMonth: month, values: result.values, updatedAt: result.updatedAt ?? null });
      setDraft(draftFrom(result.values));
      setSaved(true);
      setHint("目标已保存，驾驶舱会按新目标立刻重算达成率、缺口和日均。");
    } catch (cause) {
      const code = cause instanceof LanqiApiError ? cause.code : "";
      setBlockedReason(
        code === "goal_write_forbidden"
          ? "当前账号没有修改目标的权限（只有门店老板或店长可以改）。"
          : cause instanceof Error
            ? cause.message
            : "保存失败"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <LanqiBrainShell
      active="brain"
      mainTitle="目标设置"
      subtitle="全系统唯一的手输入口 · 每月 4 个数"
      crumb="/ 经营驾驶舱 / 目标设置"
    >
      <div className="lq-goal">
        <p className="lq-goal__note">
          ✍️ <b>整个系统里，老板/店长只需要输这 4 个数。</b>
          其余所有数字（已完成多少、会员数、沉睡率、卡耗率、预收负债、9 维雷达）全部由收银、扣卡、预约流水
          <b>自动统计</b>，不设任何录入框 —— 手输的地方越多，数字越容易对不上。
        </p>

        {loading ? <p className="lq-dash__loading">正在加载目标…</p> : null}

        {!loading && error ? (
          <section className="lq-dash__error" role="alert">
            <h2>{errorCode === "unauthorized" ? "请先登录" : "目标暂时打不开"}</h2>
            <p>{errorCode === "store_not_found" ? "当前账号下还没有门店，先建门店再设目标。" : error}</p>
            <div className="lq-dash__error-actions">
              <a href={dashboardHref}>返回驾驶舱</a>
              {errorCode === "unauthorized" ? <a href={getAppPath("/login/lanqi")}>去登录</a> : null}
            </div>
          </section>
        ) : null}

        {!loading && !error && view ? (
          <>
            <section className="lq-goal__sec">
              <header className="lq-goal__sec-head">
                <div>
                  <h2>{view.monthName} 目标</h2>
                  <p>
                    当前门店：<b>{view.store.name}</b> · 目标按 store_id 存，一家店一条
                  </p>
                </div>
                <span className="lq-goal__spacer" />
                {canEdit
                  ? <span className="lq-goal__pill">老板 / 店长可改</span>
                  : <span className="lq-goal__pill lq-goal__pill--lock">前台只读 · 需要老板或店长修改</span>}
              </header>

              {view.status === "unset" ? (
                <p className="lq-goal__banner lq-goal__banner--warn">
                  本月目标<b>未设置</b>。填好下面任意一项再保存；不设置的话驾驶舱会把达成率显示成「待设置」，不会显示 0。
                </p>
              ) : null}
              {view.status === "carried_over" ? (
                <p className="lq-goal__banner">
                  本月还没单独设置，驾驶舱目前<b>沿用 {view.fromMonth} 的目标</b>。在这里保存后会替换成本月自己的目标。
                </p>
              ) : null}

              <div className="lq-goal__grid">
                {view.goalItems.map((item) => {
                  const draftValue = draft[item.key];
                  const goalNum = parseDraft(draftValue);
                  const previousValue = view.previous?.values[item.key] ?? null;
                  return (
                    <article key={item.key} className="lq-goal__card">
                      <div className="lq-goal__card-head">
                        <span className="lq-goal__ic">{item.icon}</span>
                        <span className="lq-goal__card-name">{item.label}</span>
                        <span className="lq-goal__spacer" />
                        <span className="lq-goal__tag-auto">已完成自动统计</span>
                      </div>
                      <div className="lq-goal__fields">
                        <label className="lq-goal__field">
                          <span>本月目标（手输）{!canEdit ? " · 只读" : ""}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={draftValue}
                            disabled={!canEdit}
                            placeholder={view.status === "carried_over" && previousValue ? String(previousValue) : "未设置"}
                            onChange={(event) => updateDraft(item.key, event.target.value)}
                          />
                        </label>
                        <label className="lq-goal__field ro">
                          <span>已完成（自动，不可改）</span>
                          <input
                            value={formatValue(item.key, view.current?.[item.key] ?? null, item.unit)}
                            disabled
                            readOnly
                          />
                        </label>
                      </div>
                      <p className="lq-goal__card-foot">
                        {goalNum === null
                          ? "这一项还没填，保存后驾驶舱会把它标成「待设置」，不会算成 0。"
                          : "保存后驾驶舱会按这个目标重算达成率、缺口和日均。"}
                      </p>
                    </article>
                  );
                })}
              </div>

              {blockedReason ? <p className="lq-goal__block" role="alert">{blockedReason}</p> : null}
              {hint ? <p className="lq-goal__hint">{hint}</p> : null}

              <div className="lq-goal__acts">
                <button
                  type="button"
                  className="lq-goal__save"
                  disabled={saving || !canEdit || validation !== "" || !dirty}
                  onClick={() => void save()}
                >
                  {saving ? "保存中…" : saved ? "已保存 ✓" : "保存并返回驾驶舱"}
                </button>
                <a className="lq-goal__cancel" href={dashboardHref}>取消</a>
                {!canEdit ? (
                  <span className="lq-goal__why">按钮不可用：当前账号是前台，目标只有老板或店长能改。</span>
                ) : validation ? (
                  <span className="lq-goal__why">{validation}</span>
                ) : !dirty ? (
                  <span className="lq-goal__why">还没有改动，改完任意一项就能保存。</span>
                ) : null}
              </div>
              <p className="lq-goal__lock">保存后驾驶舱的达成率、缺口、日均要出多少会立刻按新目标重算。</p>
            </section>

            <section className="lq-goal__sec">
              <header className="lq-goal__sec-head">
                <div>
                  <h2>驾驶舱那些数字，到底从哪来</h2>
                  <p>给店主看的口径说明，也是给开发的取值规则</p>
                </div>
              </header>
              <table className="lq-goal__table">
                <thead>
                  <tr><th>指标</th><th>谁输</th><th>怎么来的</th></tr>
                </thead>
                <tbody>
                  {SOURCE_ROWS.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className={row.source === "man" ? "man" : "auto"}>
                        {row.source === "man" ? "✍️ 手输" : "🤖 自动统计"}
                      </td>
                      <td>{row.how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="lq-goal__foot">
                💡 一期单店：目标按 <b>store_id</b> 存，一个账号一家店。二期连锁时每家店单独设目标，总部看合计（合计 = 各店算术和）。
              </p>
            </section>
          </>
        ) : null}
      </div>
    </LanqiBrainShell>
  );
}
