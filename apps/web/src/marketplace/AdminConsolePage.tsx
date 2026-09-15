import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { readSessionToken } from "../lib/session.js";
import { adminAuthHeaders, Topbar } from "./shell.js";
import "../styles/admin-console.css";

/**
 * 统一管理后台（用户 2026-09-15：「侧边导航把 5 个视图 + 客户/订单/积分干预串起来，复用已有 API」；
 * 「后台只有我需要用，不需要给用户」）。
 *
 * 口径与边界：
 * - 只给平台运营用：需要**平台管理令牌**（`x-sitong-admin-token`）**且**当前登录账号是 owner/admin
 *   （`/market/admin/*` 的读写守卫按租户角色判定）。两个条件缺一都在页面上直说，不静默失败。
 * - 全部复用已有接口，不新造聚合 API：数据接口见每个视图的 `endpoints` 字段（页面上直接显示，
 *   排障时一眼能看出这个数字是从哪来的）。
 * - 写操作只保留后台本来就有的三类：发体验额度、建邀请码、上下架/改价 SKU（+ 生成推荐码）；
 *   其余一律只读展示，避免在后台里再造一套计费逻辑。
 */

type SectionId = "overview" | "customers" | "orders" | "credits" | "shelf" | "referral" | "quality";

interface AdminSection {
  id: SectionId;
  label: string;
  hint: string;
  endpoints: string[];
}

/** 侧边导航：5 个主视图（概览/客户/订单与收款/积分干预/智能体与货架）+ 推荐归因 + 质量与安全。 */
const SECTIONS: AdminSection[] = [
  { id: "overview", label: "概览", hint: "平台关键数字：货架、客户、流水、运行态", endpoints: ["GET /market/admin/overview", "GET /admin/ops/summary"] },
  { id: "customers", label: "客户", hint: "客户 / 租户清单、邀请码与开通记录", endpoints: ["GET /admin/customers", "GET /admin/invites", "POST /admin/invites"] },
  { id: "orders", label: "订单与收款", hint: "计费审计与统一账本（按次 + 包月）", endpoints: ["GET /admin/billing/audit", "GET /market/admin/ledger"] },
  { id: "credits", label: "积分干预", hint: "发体验额度、查发放记录", endpoints: ["GET /market/admin/trial-grants", "POST /market/admin/trial-grants"] },
  { id: "shelf", label: "智能体与货架", hint: "SKU 上下架/改价、供应商、Agent 定义", endpoints: ["GET /market/admin/skus", "PATCH /market/admin/skus/:skuId", "GET /market/admin/suppliers", "GET /admin/agents"] },
  { id: "referral", label: "推荐归因", hint: "推荐有礼配置位、生成推荐码、归因清单", endpoints: ["GET /market/admin/referral-config", "POST /market/admin/referral-codes", "GET /market/admin/referrals"] },
  { id: "quality", label: "质量与安全", hint: "质量摘要与租户隔离审计", endpoints: ["GET /admin/quality/summary", "GET /admin/security/isolation-audit"] }
];

const IDENTITY_KEYS = ["phone", "wechatOpenid", "wechatUnionid", "userId"] as const;
type IdentityKey = (typeof IDENTITY_KEYS)[number];

const IDENTITY_LABELS: Record<IdentityKey, string> = {
  phone: "客户手机号",
  wechatOpenid: "微信 openid",
  wechatUnionid: "微信 unionid",
  userId: "用户 ID"
};

function nowStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * 后台专用错误翻译。
 *
 * 不能直接用通用 `adminReadJson`：它是在「体验额度发放」页写的，会把任何 401/403
 * 都说成「发放需要平台运营凭证」，在概览/客户这些只读视图里就会误导排障
 * （2026-09-15 本地验收实测）。
 */
async function consoleReadJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (response.status === 401 || payload.error === "admin_token_required") {
    throw new Error("这个视图需要平台管理令牌：请在上方「平台管理令牌」里粘贴后重试。");
  }
  if (response.status === 403) {
    if (payload.error === "trial_grant_disabled") throw new Error(payload.message ?? "人工发放体验额度已停用。");
    if ((payload.error ?? "").startsWith("marketplace_admin")) {
      throw new Error(payload.message ?? "当前账号不是 owner / admin，读不了后台数据。");
    }
    throw new Error(payload.message ?? "当前账号没有这个后台视图的权限。");
  }
  throw new Error(payload.message ?? payload.error ?? `请求失败（${response.status}）`);
}

export function AdminConsolePage() {
  const [section, setSection] = useState<SectionId>("overview");
  const [token, setToken] = useState(() => sessionStorage.getItem("sitong_admin_token") ?? "");
  const [hasSession, setHasSession] = useState(() => Boolean(readSessionToken()));

  useEffect(() => {
    setHasSession(Boolean(readSessionToken()));
  }, []);

  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <div className="marketplace adminConsole">
      <Topbar active="admin" balance={null} onNavigate={(path) => { window.location.href = getAppPath(path); }} />
      <div className="adminConsoleBody">
        <aside className="adminConsoleNav" aria-label="后台导航">
          <div className="adminConsoleNavTitle">
            <strong>平台管理后台</strong>
            <span>仅运营使用 · 不对外开放</span>
          </div>
          <nav>
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === section ? "adminNavItem active" : "adminNavItem"}
                onClick={() => setSection(item.id)}
              >
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </button>
            ))}
          </nav>
        </aside>

        <main className="adminConsoleMain">
          <header className="adminConsoleHeader">
            <div>
              <h1>{active.label}</h1>
              <p>{active.hint}</p>
            </div>
            <div className="adminConsoleEndpoints">
              {active.endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)}
            </div>
          </header>

          {!hasSession && (
            <div className="adminConsoleNotice warn">
              当前浏览器没有平台登录态。<b>先用你的平台账号（owner）登录</b>，再回来打开这个页面——
              `/market/admin/*` 的读写守卫按账号角色判定，光有令牌不够。
              <button type="button" className="btn ghost sm" onClick={() => { window.location.href = getAppPath("/login"); }}>去登录</button>
            </div>
          )}
          <AdminLoginPanel token={token} onTokenChange={setToken} />

          {section === "overview" && <OverviewSection />}
          {section === "customers" && <CustomersSection />}
          {section === "orders" && <OrdersSection />}
          {section === "credits" && <CreditsSection />}
          {section === "shelf" && <ShelfSection />}
          {section === "referral" && <ReferralSection />}
          {section === "quality" && <QualitySection />}
        </main>
      </div>
    </div>
  );
}

/**
 * 后台登录（PLAT-39，用户 2026-09-15「得设置个管理员账号密码登入才行」）。
 *
 * 账号 + 密码 → 服务端换一枚 12 小时有效的会话令牌，存在本标签页 sessionStorage；
 * 旧的「平台管理令牌」保留为折叠的高级选项（脚本/运维用）。
 */
function AdminLoginPanel({ token, onTokenChange }: { token: string; onTokenChange: (value: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function login() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiPath("/admin/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = (await response.json().catch(() => ({}))) as { token?: string; message?: string; error?: string };
      if (!response.ok || !data.token) {
        throw new Error(data.message ?? data.error ?? `登录失败（${response.status}）`);
      }
      sessionStorage.setItem("sitong_admin_token", data.token);
      onTokenChange(data.token);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    return (
      <div className="adminConsoleToken">
        <span className="adminTokenState ok">已登录管理后台（会话 12 小时有效）</span>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            sessionStorage.removeItem("sitong_admin_token");
            onTokenChange("");
          }}
        >
          退出管理后台
        </button>
      </div>
    );
  }

  return (
    <div className="adminLoginPanel">
      <div className="adminLoginForm">
        <label><span>管理员账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="管理员账号" /></label>
        <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="密码" onKeyDown={(event) => { if (event.key === "Enter") void login(); }} /></label>
        <button type="button" className="btn primary sm" onClick={() => void login()} disabled={busy || !username.trim() || !password}>
          {busy ? "登录中…" : "登录管理后台"}
        </button>
      </div>
      {error && <div className="adminConsoleNotice warn">{error}</div>}
      <button type="button" className="adminAdvancedToggle" onClick={() => setAdvancedOpen((value) => !value)}>
        {advancedOpen ? "收起" : "高级：直接粘贴平台管理令牌"}
      </button>
      {advancedOpen && <AdminTokenRow token={token} onTokenChange={onTokenChange} />}
    </div>
  );
}

function AdminTokenRow({ token, onTokenChange }: { token: string; onTokenChange: (value: string) => void }) {
  const [draft, setDraft] = useState(token);
  return (
    <div className="adminConsoleToken">
      <label>
        <span>平台管理令牌（x-sitong-admin-token）</span>
        <input
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="粘贴平台管理令牌；只存在本标签页"
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => {
          const next = draft.trim();
          if (next) sessionStorage.setItem("sitong_admin_token", next);
          else sessionStorage.removeItem("sitong_admin_token");
          onTokenChange(next);
        }}
      >
        {token ? "更新令牌" : "保存令牌"}
      </button>
      <span className={token ? "adminTokenState ok" : "adminTokenState"}>{token ? "已保存（仅本标签页）" : "未填写"}</span>
    </div>
  );
}

/** 通用取数：所有视图都走它，保证 401/403 的人话提示与令牌失效处理一致。 */
function useAdminData<T>(path: string | null, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiPath(path), { headers: adminAuthHeaders(), cache: "no-store" });
      setData(await consoleReadJson<T>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  return { data, error, loading, reload: load };
}

function Panel({ title, error, loading, children, onReload }: {
  title: string;
  error?: string;
  loading?: boolean;
  children: ReactNode;
  onReload?: () => void;
}) {
  return (
    <section className="adminPanel">
      <header>
        <h2>{title}</h2>
        {onReload && <button type="button" className="btn ghost sm" onClick={onReload} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>}
      </header>
      {error ? <div className="adminConsoleNotice warn">{error}</div> : children}
    </section>
  );
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

const TABLE_SKIP_KEYS = new Set(["id", "tenantId", "userId", "createdAt", "updatedAt", "metadata", "data", "redemptions"]);

/** 通用表格：数组就直接列；对象里有数组字段就先列摘要、再列出那个数组。 */
function DataView({ data, columns, emptyText = "暂无数据" }: { data: unknown; columns?: string[]; emptyText?: string }) {
  const tables = collectTables(data, columns);
  if (tables.length === 0) return <p className="adminConsoleEmpty">{emptyText}</p>;
  return (
    <>
      {tables.map((table) => (
        <div key={table.title} className="adminTableWrap">
          <p className="adminTableCaption">{table.title}（{table.rows.length} 行）</p>
          <table className="adminTable">
            <thead>
              <tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 50).map((row, index) => (
                <tr key={index}>
                  {table.columns.map((column) => <td key={column}>{valueText(row[column])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {table.rows.length > 50 && <p className="adminTableCaption">只显示前 50 行（共 {table.rows.length} 行）。</p>}
        </div>
      ))}
    </>
  );
}

interface RenderedTable {
  title: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

function collectTables(data: unknown, preferred?: string[]): RenderedTable[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return [toTable("", data, preferred)];
  const record = data as Record<string, unknown>;
  const tables: RenderedTable[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value) && value.length > 0) tables.push(toTable(key, value, preferred));
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = Object.entries(value as Record<string, unknown>).find(([, item]) => Array.isArray(item));
      if (nested) tables.push(toTable(`${key}.${nested[0]}`, nested[1] as unknown[], preferred));
    }
  }
  if (tables.length === 0) tables.push(toTable("", [record], preferred));
  return tables;
}

function toTable(title: string, rows: unknown[], preferred?: string[]): RenderedTable {
  const objects = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  if (objects.length === 0) return { title, columns: ["值"], rows: rows.map((row) => ({ 值: row })) };
  const discovered = preferred?.length ? preferred : Object.keys(objects[0]).filter((key) => !TABLE_SKIP_KEYS.has(key)).slice(0, 8);
  return { title, columns: discovered, rows: objects };
}

/** 概览：关键数字用卡片，其余用通用表格。 */
function OverviewSection() {
  const overview = useAdminData<Record<string, unknown>>("/market/admin/overview");
  const ops = useAdminData<Record<string, unknown>>("/admin/ops/summary");

  /**
   * 老板要的「客户 / 订单 / 积分 / 消耗 / 余额」在这里一次给全（用户 2026-09-15）。
   * 之前只把第一层数字铺成卡片，嵌套的 `tenants.total`、`billing.paidAmountCny` 全部被丢掉，
   * 看起来就像「空壳」。
   */
  const businessCards = pickNumbers(ops.data, [
    ["tenants.total", "客户（工作区）"],
    ["users.total", "注册用户"],
    ["subscriptions.activeOrTrialing", "在服务订阅"],
    ["billing.paidOrders", "已支付订单"],
    ["billing.pendingOrders", "待支付订单"],
    ["billing.paidAmountCny", "已收款（元）"],
    ["usage.agentRuns", "累计智能体运行"],
    ["usage.agentRunsToday", "今日智能体运行"],
    ["credit.consumedCreditsTotal", "累计消耗积分"],
    ["credit.balanceTotal", "客户剩余积分合计"],
    ["credit.walletPaidBalanceTotal", "其中付费积分"],
    ["credit.walletBonusBalanceTotal", "其中赠送积分"]
  ]);
  const cards = businessCards.length > 0 ? businessCards : flattenNumbers(overview.data?.overview ?? overview.data);
  return (
    <>
      <Panel title="关键数字（客户 / 订单 / 积分）" error={ops.error} loading={ops.loading} onReload={() => void ops.reload()}>
        {cards.length === 0
          ? <DataView data={ops.data} />
          : <div className="adminCards">{cards.map((card) => (
              <div key={card.label} className="adminCard"><span>{card.label}</span><strong>{card.value}</strong></div>
            ))}</div>}
      </Panel>
      <Panel title="货架概览" error={overview.error} loading={overview.loading} onReload={() => void overview.reload()}>
        <DataView data={overview.data?.overview ?? overview.data} />
      </Panel>
    </>
  );
}

/** 按「点号路径」取数字并配上中文标签；取不到就跳过（不显示 0 假数据）。 */
function pickNumbers(source: unknown, spec: Array<[string, string]>): Array<{ label: string; value: string }> {
  if (!source || typeof source !== "object") return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const [path, label] of spec) {
    let current: unknown = source;
    for (const key of path.split(".")) {
      if (!current || typeof current !== "object") { current = undefined; break; }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "number" || typeof current === "string") out.push({ label, value: valueText(current) });
  }
  return out;
}

function flattenNumbers(source: unknown): Array<{ label: string; value: string }> {
  if (!source || typeof source !== "object") return [];
  return Object.entries(source as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    .slice(0, 12)
    .map(([label, value]) => ({ label, value: valueText(value) }));
}

function CustomersSection() {
  const [refresh, setRefresh] = useState(0);
  const customers = useAdminData<Record<string, unknown>>("/admin/customers", refresh);
  const invites = useAdminData<Record<string, unknown>>("/admin/invites", refresh);

  const [productCode, setProductCode] = useState("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [code, setCode] = useState(`invite-${nowStamp()}`);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function createInvite() {
    setBusy(true);
    setResult("");
    try {
      const response = await fetch(apiPath("/admin/invites"), {
        method: "POST",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          code: code.trim(),
          label: label.trim() || undefined,
          productCode: productCode || undefined,
          maxUses: Number(maxUses) || 1,
          createdBy: "admin-console"
        })
      });
      const data = await consoleReadJson<Record<string, unknown>>(response);
      setResult(`已创建：${(data.invite as Record<string, unknown>)?.code ?? code}`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="客户 / 租户" error={customers.error} loading={customers.loading} onReload={() => void customers.reload()}>
        <DataView data={customers.data} columns={["name", "type", "industry", "city", "planName", "creditBalance", "memberCount", "agentRunCount"]} />
      </Panel>
      <Panel title="邀请码（新建 / 已有）" error={invites.error} loading={invites.loading} onReload={() => void invites.reload()}>
        <div className="adminForm">
          <label><span>邀请码</span><input value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} /></label>
          <label><span>产品（留空=平台通用）</span>
            <select value={productCode} onChange={(event) => setProductCode(event.target.value)}>
              <option value="">平台通用</option>
              <option value="lanqi">兰琪（必须邀请码）</option>
              <option value="beauty-industry">美业智能体</option>
              <option value="founder-ip">创始人 IP 获客</option>
              <option value="takeaway">外卖增长</option>
            </select>
          </label>
          <label><span>可用次数</span><input value={maxUses} onChange={(event) => setMaxUses(event.target.value)} inputMode="numeric" /></label>
          <label><span>备注</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} /></label>
          <button type="button" className="btn primary sm" onClick={() => void createInvite()} disabled={busy || code.trim().length < 4}>
            {busy ? "创建中…" : "创建邀请码"}
          </button>
        </div>
        {result && <div className="adminConsoleNotice">{result}</div>}
        <DataView data={invites.data} columns={["codePreview", "label", "productCode", "planCode", "maxUses", "usedCount", "isActive", "expiresAt"]} />
      </Panel>
    </>
  );
}

function OrdersSection() {
  const audit = useAdminData<Record<string, unknown>>("/admin/billing/audit");
  const ledger = useAdminData<Record<string, unknown>>("/market/admin/ledger?limit=50");
  return (
    <>
      <Panel title="计费审计" error={audit.error} loading={audit.loading} onReload={() => void audit.reload()}>
        <DataView data={audit.data} />
      </Panel>
      <Panel title="统一账本（按次 + 包月）" error={ledger.error} loading={ledger.loading} onReload={() => void ledger.reload()}>
        <DataView data={ledger.data} columns={["type", "amountCredits", "amountCny", "skuId", "userId", "createdAt"]} />
      </Panel>
    </>
  );
}

function CreditsSection() {
  const [refresh, setRefresh] = useState(0);
  const grants = useAdminData<Record<string, unknown>>("/market/admin/trial-grants?limit=20", refresh);
  const [identityKey, setIdentityKey] = useState<IdentityKey>("phone");
  const [identity, setIdentity] = useState("");
  const [amount, setAmount] = useState("400");
  const [operator, setOperator] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function grant() {
    setBusy(true);
    setResult("");
    try {
      const response = await fetch(apiPath("/market/admin/trial-grants"), {
        method: "POST",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          identity: { [identityKey]: identity.trim() },
          amount: Number(amount) || 0,
          grantId: `console-${nowStamp()}-${Math.random().toString(36).slice(2, 6)}`,
          operator: operator.trim() || undefined
        })
      });
      const data = await consoleReadJson<Record<string, unknown>>(response);
      const grantRow = data.grant as Record<string, unknown> | undefined;
      setResult(`发放完成：${grantRow?.state ?? "ok"}，本次 ${grantRow?.amount ?? amount} 积分`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : "发放失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="体验额度发放（资金侧写操作）" error={grants.error} loading={grants.loading} onReload={() => void grants.reload()}>
      <div className="adminForm">
        <label><span>身份类型</span>
          <select value={identityKey} onChange={(event) => setIdentityKey(event.target.value as IdentityKey)}>
            {IDENTITY_KEYS.map((key) => <option key={key} value={key}>{IDENTITY_LABELS[key]}</option>)}
          </select>
        </label>
        <label><span>{IDENTITY_LABELS[identityKey]}</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="填写客户身份后发放" /></label>
        <label><span>积分数量</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></label>
        <label><span>经办人（可选）</span><input value={operator} onChange={(event) => setOperator(event.target.value)} maxLength={40} /></label>
        <button type="button" className="btn primary sm" onClick={() => void grant()} disabled={busy || identity.trim().length === 0}>
          {busy ? "发放中…" : "发放体验额度"}
        </button>
      </div>
      {result && <div className="adminConsoleNotice">{result}</div>}
      <DataView data={grants.data} columns={["grantId", "amount", "nickname", "phone", "operator", "createdAt"]} />
    </Panel>
  );
}

function ShelfSection() {
  const [refresh, setRefresh] = useState(0);
  const skus = useAdminData<Record<string, unknown>>("/market/admin/skus", refresh);
  const suppliers = useAdminData<Record<string, unknown>>("/market/admin/suppliers");
  const agents = useAdminData<Record<string, unknown>>("/admin/agents");
  const [message, setMessage] = useState("");

  async function patchSku(skuId: string, body: Record<string, unknown>) {
    setMessage("");
    try {
      const response = await fetch(apiPath(`/market/admin/skus/${encodeURIComponent(skuId)}`), {
        method: "PATCH",
        headers: adminAuthHeaders(true),
        body: JSON.stringify(body)
      });
      await consoleReadJson<Record<string, unknown>>(response);
      setMessage(`已更新 ${skuId}`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "更新失败");
    }
  }

  const skuRows = Array.isArray((skus.data as Record<string, unknown> | null)?.skus)
    ? ((skus.data as Record<string, unknown>).skus as Array<Record<string, unknown>>)
    : [];

  return (
    <>
      <Panel title="货架 SKU（可上下架 / 改价）" error={skus.error} loading={skus.loading} onReload={() => void skus.reload()}>
        {skuRows.length === 0 ? <DataView data={skus.data} /> : (
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead><tr><th>SKU</th><th>名称</th><th>状态</th><th>积分/次</th><th>操作</th></tr></thead>
              <tbody>
                {skuRows.slice(0, 60).map((sku) => {
                  const skuCode = String(sku.skuCode ?? "");
                  const skuId = String(sku.id ?? skuCode);
                  const status = String(sku.status ?? "");
                  return (
                    <tr key={skuId}>
                      <td>{skuCode}</td>
                      <td>{valueText(sku.name)}</td>
                      <td>{status}</td>
                      <td>{valueText(sku.ppu)}</td>
                      <td className="adminRowActions">
                        {status === "selling"
                          ? <button type="button" className="btn ghost sm" onClick={() => void patchSku(skuId, { status: "coming_soon" })}>下架</button>
                          : <button type="button" className="btn ghost sm" onClick={() => void patchSku(skuId, { status: "selling" })}>上架</button>}
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => {
                            const next = window.prompt(`把 ${skuCode} 的每次积分改成多少？`, String(sku.ppu ?? ""));
                            if (next && Number(next) > 0) void patchSku(skuId, { ppu: Number(next) });
                          }}
                        >
                          改价
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {message && <div className="adminConsoleNotice">{message}</div>}
      </Panel>
      <Panel title="供应商" error={suppliers.error} loading={suppliers.loading} onReload={() => void suppliers.reload()}>
        <DataView data={suppliers.data} />
      </Panel>
      <Panel title="Agent 定义" error={agents.error} loading={agents.loading} onReload={() => void agents.reload()}>
        <DataView data={agents.data} columns={["agentId", "name", "status", "activeSkillReleaseId", "updatedAt"]} />
      </Panel>
    </>
  );
}

function ReferralSection() {
  const [refresh, setRefresh] = useState(0);
  const config = useAdminData<Record<string, unknown>>("/market/admin/referral-config", refresh);
  const bindings = useAdminData<Record<string, unknown>>("/market/admin/referrals?limit=50", refresh);
  const [identityKey, setIdentityKey] = useState<IdentityKey>("userId");
  const [identity, setIdentity] = useState("");
  const [label, setLabel] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function issueCode() {
    setBusy(true);
    setResult("");
    try {
      const response = await fetch(apiPath("/market/admin/referral-codes"), {
        method: "POST",
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ identity: { [identityKey]: identity.trim() }, label: label.trim() || undefined })
      });
      const data = await consoleReadJson<Record<string, unknown>>(response);
      const issued = data.referralCode as Record<string, unknown> | undefined;
      setResult(`已生成推荐码：${issued?.code ?? "见下方清单"}（把它拼进统一注册链接 ?ref=）`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="推荐有礼配置位" error={config.error} loading={config.loading} onReload={() => void config.reload()}>
        <DataView data={config.data} columns={["key", "value", "source", "updatedAt"]} />
      </Panel>
      <Panel title="生成推荐码（给某个用户）」" error={bindings.error} loading={bindings.loading} onReload={() => void bindings.reload()}>
        <div className="adminForm">
          <label><span>推荐人身份</span>
            <select value={identityKey} onChange={(event) => setIdentityKey(event.target.value as IdentityKey)}>
              {IDENTITY_KEYS.map((key) => <option key={key} value={key}>{IDENTITY_LABELS[key]}</option>)}
            </select>
          </label>
          <label><span>{IDENTITY_LABELS[identityKey]}</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
          <label><span>备注</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} /></label>
          <button type="button" className="btn primary sm" onClick={() => void issueCode()} disabled={busy || identity.trim().length === 0}>
            {busy ? "生成中…" : "生成推荐码"}
          </button>
        </div>
        {result && <div className="adminConsoleNotice">{result}</div>}
        <DataView data={bindings.data} columns={["codePreview", "referrer", "referred", "boundAt", "status"]} />
      </Panel>
    </>
  );
}

function QualitySection() {
  const quality = useAdminData<Record<string, unknown>>("/admin/quality/summary");
  const isolation = useAdminData<Record<string, unknown>>("/admin/security/isolation-audit");
  return (
    <>
      <Panel title="质量摘要" error={quality.error} loading={quality.loading} onReload={() => void quality.reload()}>
        <DataView data={quality.data} />
      </Panel>
      <Panel title="租户隔离审计" error={isolation.error} loading={isolation.loading} onReload={() => void isolation.reload()}>
        <DataView data={isolation.data} />
      </Panel>
    </>
  );
}
