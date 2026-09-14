import { useEffect, useState, type CSSProperties } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { adminAuthHeaders, adminReadJson, Topbar } from "./shell.js";

/** 体验额度发放（PLAT-11）：销售/运营确认真实商家身份后，按客户手机号/微信自助发额度。 */
const TRIAL_IDENTITY_OPTIONS = [
  { key: "phone", label: "客户手机号", placeholder: "13800000000" },
  { key: "wechatOpenid", label: "微信 openid", placeholder: "oXXXXXXXXXXXXXXXX" },
  { key: "wechatUnionid", label: "微信 unionid", placeholder: "oXXXXXXXXXXXXXXXX" },
  { key: "userId", label: "用户 ID", placeholder: "c..." }
] as const;

type TrialIdentityKey = (typeof TRIAL_IDENTITY_OPTIONS)[number]["key"];

interface TrialGrantRow {
  id: string;
  grantId: string;
  amount: number;
  userId: string;
  nickname: string | null;
  phone: string | null;
  operator: string | null;
  createdAt: string;
}

interface TrialGrantResult {
  state: "created" | "already_applied" | "dry_run";
  grantId: string;
  amount: number;
  user: { id: string; nickname: string | null; phone: string | null; wechatOpenid: string | null };
  wallet: { paidBalance: number; bonusBalance: number; balance: number };
  grantedAt: string | null;
}

/** 默认体验额度口径（2026-09-11 用户拍板）：400 积分 / 3 天。 */
const TRIAL_DEFAULT_CREDITS = 400;
const TRIAL_DEFAULT_VALID_DAYS = 3;

function suggestedGrantId(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-trial-${suffix}`;
}

function addDaysLabel(fromIso: string | null, days: number): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  if (Number.isNaN(base.getTime())) return "—";
  const until = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const y = until.getFullYear();
  const m = String(until.getMonth() + 1).padStart(2, "0");
  const d = String(until.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const adminFieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "var(--muted)"
};
const adminInputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--bg2)",
  color: "var(--text)",
  fontSize: 14
};

/**
 * PLAT-28 第①批：推荐有礼配置位（9 个 referral 键 + 人工发放总开关）。
 *
 * 这一批**不发奖励**，只保证老板/运营能在后台看到、改到、改错了有明确提示；
 * 真正发奖的口径（三段金额、首次真实使用/首充、退款冲正）留给第②批。
 * `REFERRAL_REWARD_TEXT_ONLY` 是冻结口径，界面只读。
 */
interface PlatformSettingView {
  key: string;
  group: "referral" | "marketplace";
  label: string;
  description: string;
  type: "boolean" | "integer" | "datetime";
  min?: number;
  max?: number;
  lockedValue?: boolean;
  value: boolean | number | string | null;
  envValue: boolean | number | string | null;
  source: "database" | "env";
  updatedAt: string | null;
  updatedBy: string | null;
}

interface PlatformSettingsResponse {
  settings: PlatformSettingView[];
  trialGrantEnabled: boolean;
  referralRewardEnabled: boolean;
  referralTextOnly: boolean;
}

function settingInputValue(setting: PlatformSettingView): string {
  if (setting.type === "boolean") return setting.value === true ? "true" : "false";
  if (setting.value === null || setting.value === undefined) return "";
  return String(setting.value);
}

function settingEnvHint(setting: PlatformSettingView): string {
  const envText =
    setting.envValue === null || setting.envValue === undefined || setting.envValue === ""
      ? "未设置"
      : String(setting.envValue);
  return setting.source === "database"
    ? `默认值 ${envText} → 已被后台改为当前值（${setting.updatedAt?.slice(0, 16).replace("T", " ") ?? "—"}${setting.updatedBy ? ` · ${setting.updatedBy}` : ""}）`
    : `当前=默认值（${envText}），尚未在后台改过`;
}

function PlatformSettingsPanel({
  adminToken,
  onTrialGrantEnabledChange
}: {
  adminToken: string;
  onTrialGrantEnabledChange: (enabled: boolean) => void;
}) {
  const [settings, setSettings] = useState<PlatformSettingView[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!adminToken.trim()) {
      setError("填写平台管理令牌后，这里会显示推荐有礼配置位。");
      setSettings([]);
      setLoaded(false);
      return;
    }
    try {
      const response = await fetch(apiPath("/market/admin/referral-config"), { headers: adminAuthHeaders(), cache: "no-store" });
      const data = await adminReadJson<PlatformSettingsResponse>(response);
      setSettings(data.settings ?? []);
      setDraft({});
      setError("");
      setLoaded(true);
      onTrialGrantEnabledChange(Boolean(data.trialGrantEnabled));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void load();
    // 令牌变化（负责人填/换令牌）后重新拉一次；改完保存会自己刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  const dirtyKeys = settings
    .filter((item) => draft[item.key] !== undefined && draft[item.key] !== settingInputValue(item))
    .map((item) => item.key);

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const updates: Record<string, unknown> = {};
      for (const key of dirtyKeys) {
        const setting = settings.find((item) => item.key === key);
        if (!setting) continue;
        const raw = draft[key];
        updates[key] = setting.type === "boolean" ? raw === "true" : raw;
      }
      const response = await fetch(apiPath("/market/admin/referral-config"), {
        method: "PATCH",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ updates })
      });
      const data = await adminReadJson<PlatformSettingsResponse>(response);
      setSettings(data.settings ?? []);
      setDraft({});
      setStatus(`已保存 ${dirtyKeys.length} 项配置（本批仍不发奖励）。`);
      onTrialGrantEnabledChange(Boolean(data.trialGrantEnabled));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="marketplaceAdminTable" style={{ padding: "8px 0 8px" }}>
      <div className="marketplaceAdminSectionTitle">
        <h2>推荐有礼配置位（PLAT-28 第①批）</h2>
        <p>
          本批只提供开关的读写与校验，<b>不发放任何奖励</b>：三段奖励金额、90 天有效期、text-only
          硬限制、活动窗左闭右开等口径由第②批按这里的配置执行。奖励积分的「只能用于文字类智能体」是冻结口径，不可改。
        </p>
      </div>
      {error && <div className="marketplaceAdminError" role="alert">{error}</div>}
      {status && <p className="mine-tip" role="status">{status}</p>}
      {loaded && !error && (
        <div style={{ display: "grid", gap: 12, maxWidth: 760, marginTop: 8 }}>
          {settings.map((setting) => (
            <label key={setting.key} style={adminFieldStyle}>
              <span>
                {setting.label}
                <code style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>{setting.key}</code>
                {setting.lockedValue !== undefined && <b style={{ marginLeft: 8, fontSize: 11 }}>冻结口径</b>}
              </span>
              {setting.type === "boolean" ? (
                <select
                  value={draft[setting.key] ?? settingInputValue(setting)}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [setting.key]: event.target.value }))}
                  style={adminInputStyle}
                  disabled={setting.lockedValue !== undefined}
                >
                  <option value="true">打开</option>
                  <option value="false">关闭</option>
                </select>
              ) : (
                <input
                  value={draft[setting.key] ?? settingInputValue(setting)}
                  inputMode={setting.type === "integer" ? "numeric" : "text"}
                  placeholder={setting.type === "datetime" ? "例：2026-10-01T00:00:00+08:00" : ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [setting.key]: event.target.value }))}
                  style={adminInputStyle}
                />
              )}
              <small style={{ fontSize: 12, opacity: 0.75 }}>
                {setting.description}
                {setting.min !== undefined || setting.max !== undefined
                  ? `（范围 ${setting.min ?? "-"} ~ ${setting.max ?? "-"}）`
                  : ""}
              </small>
              <small style={{ fontSize: 12, opacity: 0.6 }}>{settingEnvHint(setting)}</small>
            </label>
          ))}
          <div>
            <button className="btn primary" disabled={busy || dirtyKeys.length === 0} onClick={() => { void save(); }}>
              {busy ? "保存中…" : dirtyKeys.length === 0 ? "没有改动" : `保存 ${dirtyKeys.length} 项`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function MarketplaceAdminPage() {
  const [identityKey, setIdentityKey] = useState<TrialIdentityKey>("phone");
  const [identityValue, setIdentityValue] = useState("");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("sitong_admin_token") ?? "");
  const [amount, setAmount] = useState(String(TRIAL_DEFAULT_CREDITS));
  const [validDays, setValidDays] = useState(String(TRIAL_DEFAULT_VALID_DAYS));
  const [grantId, setGrantId] = useState(suggestedGrantId());
  const [operator, setOperator] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TrialGrantResult | null>(null);
  const [grants, setGrants] = useState<TrialGrantRow[]>([]);
  const [grantsError, setGrantsError] = useState("");
  /**
   * 人工体验额度发放总开关（PLAT-28 第①批）。默认 false = 停用：
   * 面板在拿到服务端配置之前按「已停用」渲染，避免守卫还没回来就把发放按钮露出来。
   */
  const [trialGrantEnabled, setTrialGrantEnabled] = useState(false);

  const loadGrants = async () => {
    // 没有平台运营凭证时不发请求：服务端会 401，直接把「先去填令牌」讲清楚即可。
    if (!sessionStorage.getItem("sitong_admin_token")) {
      setGrants([]);
      setGrantsError("填写平台管理令牌后，这里会显示最近的发放记录。");
      return;
    }
    try {
      const response = await fetch(apiPath("/market/admin/trial-grants?limit=20"), { headers: adminAuthHeaders(), cache: "no-store" });
      const data = await adminReadJson<{ grants: TrialGrantRow[] }>(response);
      setGrants(data.grants ?? []);
      setGrantsError("");
    } catch (reason) {
      setGrantsError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void loadGrants();
  }, []);

  const submit = async () => {
    setError("");
    setResult(null);
    const trimmed = identityValue.trim();
    if (!trimmed) {
      setError("请先填写客户身份（手机号 / 微信 / 用户 ID）");
      return;
    }
    const amountNumber = Number.parseInt(amount, 10);
    if (!Number.isInteger(amountNumber) || amountNumber < 1 || amountNumber > 800) {
      setError("发放积分必须是 1-800 的整数");
      return;
    }
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(grantId.trim())) {
      setError("发放编号只允许字母、数字、- 和 _，长度 8-80");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiPath("/market/admin/trial-grants"), {
        method: "POST",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          identity: { [identityKey]: trimmed },
          amount: amountNumber,
          grantId: grantId.trim(),
          ...(operator.trim() ? { operator: operator.trim() } : {}),
          dryRun
        })
      });
      const data = await adminReadJson<{ grant: TrialGrantResult }>(response);
      setResult(data.grant);
      if (data.grant.state !== "dry_run") {
        setGrantId(suggestedGrantId());
        void loadGrants();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const days = Number.parseInt(validDays, 10) || TRIAL_DEFAULT_VALID_DAYS;

  return (
    <main className="app-wrap">
      <Topbar active="admin" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>{trialGrantEnabled ? "体验额度发放" : "体验额度发放（已停用）"}</h1>
        <p className="mine-tip">
          销售/运营确认真实商家身份后发放体验额度。额度只能发给<b>已经自己扫码注册登入</b>的客户，
          走 bonus 桶、不计收入、不退款；默认口径 {TRIAL_DEFAULT_CREDITS} 积分 / {TRIAL_DEFAULT_VALID_DAYS} 天。
          本页属于资金侧操作，除账号角色外还需要<b>平台管理令牌</b>（ADMIN_TOKEN），否则任何商家都能给自己发额度。
        </p>
        {!trialGrantEnabled && (
          <div className="marketplaceAdminError" role="alert" style={{ maxWidth: 560 }}>
            <b>人工发放入口已停用（PLAT-28 第①批，2026-09-12 用户口径）。</b>
            <br />
            接口 <code>POST /market/admin/trial-grants</code> 现在返回 <code>403 trial_grant_disabled</code>，
            运维脚本同样拒绝执行；<b>历史发放流水一条未删</b>，下面仍可查看与对账。
            推荐有礼相关配置在下方「推荐有礼配置位」里读写；如需临时恢复人工发放，
            在那里把「人工体验额度发放」打开（会记下谁在什么时候改的）。
          </div>
        )}

        <div style={{ display: "grid", gap: 14, maxWidth: 560, marginTop: 12 }}>
          <label style={adminFieldStyle}>
            <span>平台管理令牌（仅本次会话保存在浏览器，关闭标签页即清除）</span>
            <input
              type="password"
              value={adminToken}
              onChange={(event) => {
                setAdminToken(event.target.value);
                const next = event.target.value.trim();
                if (next) sessionStorage.setItem("sitong_admin_token", next);
                else sessionStorage.removeItem("sitong_admin_token");
                setGrantsError("");
              }}
              onBlur={() => { void loadGrants(); }}
              placeholder="内部运营凭证，由负责人下发"
              style={adminInputStyle}
            />
          </label>
          {!trialGrantEnabled && (
            <p className="mine-tip" style={{ margin: 0 }}>
              填入平台管理令牌后本页会自动读取当前配置；停用状态下不渲染发放表单，避免误操作。
            </p>
          )}
          {trialGrantEnabled && <>
          <label style={adminFieldStyle}>
            <span>客户身份类型</span>
            <select
              value={identityKey}
              onChange={(event) => { setIdentityKey(event.target.value as TrialIdentityKey); setIdentityValue(""); }}
              style={adminInputStyle}
            >
              {TRIAL_IDENTITY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <label style={adminFieldStyle}>
            <span>{TRIAL_IDENTITY_OPTIONS.find((option) => option.key === identityKey)?.label ?? "客户身份"}</span>
            <input
              value={identityValue}
              onChange={(event) => setIdentityValue(event.target.value)}
              placeholder={TRIAL_IDENTITY_OPTIONS.find((option) => option.key === identityKey)?.placeholder}
              style={adminInputStyle}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label style={adminFieldStyle}>
              <span>发放积分（1-800）</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" style={adminInputStyle} />
            </label>
            <label style={adminFieldStyle}>
              <span>运营有效期（天）</span>
              <input value={validDays} onChange={(event) => setValidDays(event.target.value)} inputMode="numeric" style={adminInputStyle} />
            </label>
          </div>

          <label style={adminFieldStyle}>
            <span>发放编号（幂等键：同一个编号只会发一次）</span>
            <input value={grantId} onChange={(event) => setGrantId(event.target.value)} style={adminInputStyle} />
          </label>

          <label style={adminFieldStyle}>
            <span>发放人（销售/运营，选填，留空记为当前账号）</span>
            <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="如 sales01 / 张三" style={adminInputStyle} />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            预演（dry-run）：只校验身份，不写入任何积分
          </label>

          <div>
            <button className="btn primary" disabled={busy} onClick={() => { void submit(); }}>
              {busy ? "处理中…" : dryRun ? "预演发放" : `发放 ${amount || "—"} 积分`}
            </button>
          </div>
          </>}
        </div>

        {error && <div className="marketplaceAdminError" role="alert">{error}</div>}

        {result && (
          <div className="marketplaceAdminOverview" style={{ padding: 0, marginTop: 18 }}>
            <article>
              <span>发放结果</span>
              <strong style={{ fontSize: 20 }}>
                {result.state === "created" ? "发放成功" : result.state === "already_applied" ? "已发放过（幂等）" : "预演完成"}
              </strong>
            </article>
            <article>
              <span>客户</span>
              <strong style={{ fontSize: 18 }}>{result.user.nickname ?? result.user.phone ?? result.user.id.slice(0, 8)}</strong>
            </article>
            <article>
              <span>体验额度余额（bonus 桶）</span>
              <strong style={{ fontSize: 22 }}>💎 {result.wallet.bonusBalance}</strong>
            </article>
            <article>
              <span>钱包总余额</span>
              <strong style={{ fontSize: 22 }}>{result.wallet.balance}</strong>
            </article>
          </div>
        )}

        {result && result.state !== "already_applied" && (
          <p className="mine-tip" style={{ marginTop: 8 }}>
            运营口径有效期 {days} 天，建议到期日：<b>{addDaysLabel(result.grantedAt, days)}</b>
            （系统当前不自动回收过期体验积分，到期需人工核对）。
          </p>
        )}

        <section className="marketplaceAdminTable" style={{ padding: "20px 0 40px" }}>
          <div className="marketplaceAdminSectionTitle">
            <h2>最近发放记录</h2>
            <p>来自钱包流水 <code>trial_grant:*</code>，用于对账与核对客户余额。</p>
          </div>
          {grantsError && <div className="marketplaceAdminError" role="alert">{grantsError}</div>}
          {!grantsError && grants.length === 0 && <p className="mine-tip">暂无发放记录。</p>}
          {!grantsError && grants.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>发放时间</th>
                  <th>发放编号</th>
                  <th>客户</th>
                  <th>积分</th>
                  <th>发放人</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{row.grantId}</td>
                    <td>{row.nickname ?? row.phone ?? row.userId.slice(0, 8)}</td>
                    <td>+{row.amount}</td>
                    <td>{row.operator ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <PlatformSettingsPanel adminToken={adminToken} onTrialGrantEnabledChange={setTrialGrantEnabled} />
      </section>
    </main>
  );
}
