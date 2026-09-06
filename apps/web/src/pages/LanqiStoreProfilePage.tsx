import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

type FieldKey =
  | "storeName"
  | "city"
  | "businessArea"
  | "storeType"
  | "mainServices"
  | "teamSize"
  | "monthlyRevenueRange"
  | "monthlyNewCustomersRange"
  | "repeatPurchaseRateRange"
  | "customerProfile"
  | "primaryChannels"
  | "currentChallenges"
  | "notes";

type Facts = Partial<Record<FieldKey, string | string[]>>;
type StoreProfile = {
  confirmedFacts: Facts;
  estimatedFacts: Facts;
  needsInput: FieldKey[];
  updatedAt: string | null;
  canEdit: boolean;
};

const confirmedFields: Array<{ key: FieldKey; label: string; hint?: string; list?: boolean }> = [
  { key: "storeName", label: "门店名称" },
  { key: "city", label: "所在城市" },
  { key: "businessArea", label: "商圈 / 区域" },
  { key: "storeType", label: "门店类型" },
  { key: "mainServices", label: "主营服务", hint: "多个服务用顿号、逗号或换行分开", list: true },
];
const estimatedFields: Array<{ key: FieldKey; label: string; hint?: string; list?: boolean; long?: boolean }> = [
  { key: "teamSize", label: "团队规模", hint: "例如：3–5 人" },
  { key: "monthlyRevenueRange", label: "月营收区间", hint: "例如：10–20 万" },
  { key: "monthlyNewCustomersRange", label: "月新增客户区间", hint: "例如：50–80 人" },
  { key: "repeatPurchaseRateRange", label: "复购率区间", hint: "例如：30%–40%" },
  { key: "customerProfile", label: "主要客群", hint: "例如：25–40 岁附近白领" },
  { key: "primaryChannels", label: "当前主要获客渠道", hint: "多个渠道用顿号、逗号或换行分开", list: true },
  { key: "currentChallenges", label: "当前经营难题", hint: "多个难题用顿号、逗号或换行分开", list: true, long: true },
  { key: "notes", label: "补充说明", long: true },
];
const needsOptions = [...confirmedFields, ...estimatedFields];

const emptyProfile: StoreProfile = { confirmedFacts: {}, estimatedFacts: {}, needsInput: [], updatedAt: null, canEdit: false };

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function toText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("、") : value ?? "";
}

function parseList(value: string): string[] {
  return value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean);
}

function toInputValues(facts: Facts): Record<FieldKey, string> {
  return Object.fromEntries(needsOptions.map(field => [field.key, toText(facts[field.key])])) as Record<FieldKey, string>;
}

function toFacts(values: Record<FieldKey, string>, fields: typeof confirmedFields | typeof estimatedFields): Facts {
  return Object.fromEntries(fields.flatMap(field => {
    const value = values[field.key].trim();
    if (!value) return [];
    return [[field.key, field.list ? parseList(value) : value]];
  })) as Facts;
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.setItem("store_os_post_login_redirect", window.location.pathname);
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login"));
    throw new Error("登录状态已失效，正在返回登录页。");
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求失败，请稍后重试。");
  return body;
}

export function LanqiStoreProfilePage() {
  const [profile, setProfile] = useState<StoreProfile>(emptyProfile);
  const [confirmedValues, setConfirmedValues] = useState<Record<FieldKey, string>>(() => toInputValues({}));
  const [estimatedValues, setEstimatedValues] = useState<Record<FieldKey, string>>(() => toInputValues({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", window.location.pathname);
      window.location.replace(getAppPath("/login"));
      return;
    }
    void loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      const result = await readResponse(await fetch(apiPath("/lanqi/store-profile"), { headers: authHeaders() }));
      const next = result.profile as StoreProfile;
      setProfile(next);
      setConfirmedValues(toInputValues(next.confirmedFacts));
      setEstimatedValues(toInputValues(next.estimatedFacts));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "档案加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  const usedFields = useMemo(() => new Set([
    ...Object.entries(confirmedValues).filter(([, value]) => value.trim()).map(([key]) => key),
    ...Object.entries(estimatedValues).filter(([, value]) => value.trim()).map(([key]) => key),
  ]), [confirmedValues, estimatedValues]);

  function setValue(kind: "confirmed" | "estimated", key: FieldKey, value: string) {
    const setter = kind === "confirmed" ? setConfirmedValues : setEstimatedValues;
    setter(current => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  }

  function toggleNeedsInput(key: FieldKey) {
    if (usedFields.has(key)) return;
    setProfile(current => ({
      ...current,
      needsInput: current.needsInput.includes(key) ? current.needsInput.filter(item => item !== key) : [...current.needsInput, key],
    }));
    setMessage("");
  }

  async function saveProfile() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const confirmedFacts = toFacts(confirmedValues, confirmedFields);
      const estimatedFacts = toFacts(estimatedValues, estimatedFields);
      const needsInput = profile.needsInput.filter(key => !(key in confirmedFacts) && !(key in estimatedFacts));
      const result = await readResponse(await fetch(apiPath("/lanqi/store-profile"), {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ confirmedFacts, estimatedFacts, needsInput }),
      }));
      const next = result.profile as StoreProfile;
      setProfile(next);
      setConfirmedValues(toInputValues(next.confirmedFacts));
      setEstimatedValues(toInputValues(next.estimatedFacts));
      setMessage("经营档案已保存。资料缺口会在后续兰琪诊断中明确提示，不会被系统当作事实。 ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请检查后重试。");
    } finally {
      setSaving(false);
    }
  }

  return <div className="lanqiProfilePage">
    <header className="lanqiProfileHeader">
      <button className="lanqiProfileBrand" onClick={() => window.location.href = getAppPath("/my-ai")}>兰琪美业 <span>经营增长系统</span></button>
      <button className="lanqiProfileBack" onClick={() => window.location.href = getAppPath("/my-ai")}>返回我的 AI</button>
    </header>
    <main className="lanqiProfileMain">
      <section className="lanqiProfileHero">
        <p>STORE PROFILE · LQ-04</p>
        <h1>先把门店真实情况讲清楚</h1>
        <div>后续诊断只会依据这里明确记录的资料；估算和待补项会被保留标识，不会伪装成门店事实。</div>
      </section>

      <section className="lanqiProfileLegend" aria-label="资料来源说明">
        <article><i className="confirmed" /> <strong>已确认</strong><span>门店已核实的真实情况</span></article>
        <article><i className="estimated" /> <strong>经营估算</strong><span>当前可用但尚待核实的范围</span></article>
        <article><i className="needs" /> <strong>待补资料</strong><span>下一次诊断前建议补全</span></article>
      </section>

      {error && <section className="lanqiProfileNotice error"><strong>未能完成操作：</strong>{error}<button onClick={() => void loadProfile()}>重新加载</button></section>}
      {message && <section className="lanqiProfileNotice success">{message}</section>}

      {loading ? <section className="lanqiProfileLoading">正在读取本门店经营档案…</section> : <>
        <section className="lanqiProfileCard">
          <div className="lanqiProfileCardHeading"><span className="sourceTag confirmed">已确认</span><h2>门店基础事实</h2><p>请填写已核实内容。空着不代表没有，只是尚未确认。</p></div>
          <div className="lanqiProfileFormGrid">
            {confirmedFields.map(field => <ProfileField key={field.key} field={field} value={confirmedValues[field.key]} disabled={!profile.canEdit} onChange={value => setValue("confirmed", field.key, value)} />)}
          </div>
        </section>

        <section className="lanqiProfileCard estimateCard">
          <div className="lanqiProfileCardHeading"><span className="sourceTag estimated">经营估算</span><h2>当前经营范围</h2><p>请写区间或判断依据；后续确认后可移入“已确认”。</p></div>
          <div className="lanqiProfileFormGrid">
            {estimatedFields.map(field => <ProfileField key={field.key} field={field} value={estimatedValues[field.key]} disabled={!profile.canEdit} onChange={value => setValue("estimated", field.key, value)} />)}
          </div>
        </section>

        <section className="lanqiProfileCard needsCard">
          <div className="lanqiProfileCardHeading"><span className="sourceTag needs">待补资料</span><h2>下一次需要补什么</h2><p>已填写的字段不能同时标记为待补，避免诊断依据混乱。</p></div>
          <div className="lanqiNeedsGrid">
            {needsOptions.map(field => <label key={field.key} className={usedFields.has(field.key) ? "disabled" : ""}>
              <input type="checkbox" checked={profile.needsInput.includes(field.key)} disabled={!profile.canEdit || usedFields.has(field.key)} onChange={() => toggleNeedsInput(field.key)} />
              <span>{field.label}</span>{usedFields.has(field.key) && <em>已填写</em>}
            </label>)}
          </div>
        </section>

        {!profile.canEdit && <section className="lanqiProfileNotice readonly">当前账号仅可查看本门店档案。如需修改，请由门店老板或管理员操作。</section>}
        {profile.canEdit && <div className="lanqiProfileActions"><span>{profile.updatedAt ? `最近保存：${new Date(profile.updatedAt).toLocaleString("zh-CN")}` : "尚未保存过档案"}</span><button disabled={saving} onClick={() => void saveProfile()}>{saving ? "保存中…" : "保存门店经营档案"}</button></div>}
      </>}
    </main>
  </div>;
}

function ProfileField({ field, value, disabled, onChange }: { field: { key: FieldKey; label: string; hint?: string; list?: boolean; long?: boolean }; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className={field.long ? "wide" : ""}><span>{field.label}</span>{field.long
    ? <textarea value={value} placeholder={field.hint} disabled={disabled} onChange={event => onChange(event.target.value)} />
    : <input value={value} placeholder={field.hint} disabled={disabled} onChange={event => onChange(event.target.value)} />}
    {field.hint && <small>{field.hint}</small>}
  </label>;
}
