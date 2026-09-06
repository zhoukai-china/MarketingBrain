import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { BeautyIndustryShell, type BeautyIndustryPublicBrand } from "../components/beauty-industry/BeautyIndustryShell.js";

type Connection = { id: string; label: string; productCode?: string | null; tokenPrefix: string; scopes?: string[]; status: string; lastUsedAt?: string | null; createdAt: string; expiresAt?: string | null };
type ConnectionsResponse = { enabled: boolean; mcpUrl: string; connections: Connection[] };
type Overview = { creditBalance: number; brand: BeautyIndustryPublicBrand; localAcceptance?: boolean; enterpriseBase?: { brandName: string; city: string | null }; tools: Array<{ name: string; description: string }> };
type Run = { id: string; capabilityId?: string; usageChannel?: string; createdAt: string; creditCost: number };
const USER_TOOL_LABELS: Record<string, { label: string; result: string }> = {
  "beauty.topic_ideas": { label: "美业选题生成", result: "得到结合门店档案、目标顾客和渠道的可拍选题。" },
  "beauty.content_ten_pack": { label: "内容系统", result: "得到选题、文案、访谈话术、拍摄与剪辑等完整 V5 十件交付。" },
  "beauty.xiaohongshu_package": { label: "小红书图文生成", result: "得到标题、正文、标签和配套图片方向；真实图片需确认费用。" },
  "beauty.live_script": { label: "直播话术生成", result: "得到适合美业到店服务场景的直播话术草稿。" },
  "beauty.video_data_review": { label: "视频数据复盘", result: "上传并解析 CSV/Excel 后，得到播放、完播、互动和转化复盘。" },
  "beauty.live_review": { label: "直播复盘", result: "根据真实直播数据得到问题判断和下一轮改进动作。" },
  "beauty.sales_advice": { label: "美业销售建议", result: "根据真实顾客沟通得到合规回复和跟进建议。" }
};

export function BeautyIndustryWorkBuddyPage() {
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const headers = useMemo<Record<string, string>>(() => { const token = localStorage.getItem("store_os_token"); const value: Record<string, string> = {}; if (token) value.Authorization = `Bearer ${token}`; return value; }, []);

  useEffect(() => { if (!("Authorization" in headers)) { localStorage.setItem("store_os_post_login_redirect", "/agents/beauty-industry/workbuddy"); window.location.replace(getAppPath("/login/beauty-industry")); return; } void load(); }, []);
  async function load() {
    setLoading(true); setLoadError("");
    try {
      const [all, product, runs] = await Promise.all([
        readJson<ConnectionsResponse>(await fetch(apiPath("/integrations/workbuddy/connections"), { headers, cache: "no-store" })),
        readJson<Overview>(await fetch(apiPath("/beauty-industry/acquisition"), { headers, cache: "no-store" })),
        readJson<{ runs: Run[] }>(await fetch(apiPath("/beauty-industry/acquisition/history"), { headers, cache: "no-store" }))
      ]);
      setConnections({ ...all, connections: all.connections.filter((item) => item.productCode === "beauty-industry") }); setOverview(product); setHistory(runs.runs);
    } catch (reason) { setLoadError(friendlyError(reason, "美业 WorkBuddy 连接加载失败")); }
    finally { setLoading(false); }
  }
  async function create() {
    if (busy) return; setBusy(true); setOneTimeSecret(""); setStatus("正在生成美业专属连接…");
    try { const value = await readJson<ConnectionsResponse & { token: string; connection: Connection }>(await fetch(apiPath("/integrations/workbuddy/connections"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ productCode: "beauty-industry", label: "我的美业智能体" }) })); setOneTimeSecret(value.token); setConnections((current) => ({ enabled: value.enabled, mcpUrl: value.mcpUrl, connections: [value.connection, ...(current?.connections ?? [])] })); setStatus("连接已生成。密钥只显示这一次，请立即复制到 WorkBuddy。"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "连接生成失败"); } finally { setBusy(false); }
  }
  async function rotate(id: string) {
    if (busy || !window.confirm("轮换后旧密钥立即失效。确认继续？")) return; setBusy(true); setOneTimeSecret("");
    try { const value = await readJson<ConnectionsResponse & { token: string; connection: Connection }>(await fetch(apiPath(`/integrations/workbuddy/connections/${id}/rotate`), { method: "POST", headers })); setOneTimeSecret(value.token); setConnections((current) => current ? { ...current, connections: [value.connection, ...current.connections.map((item) => item.id === id ? { ...item, status: "revoked" } : item)] } : current); setStatus("连接已轮换；新密钥只显示这一次。"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "轮换失败"); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy || !window.confirm("撤销后该 WorkBuddy 连接立即失效。确认继续？")) return; setBusy(true);
    try { await readJson(await fetch(apiPath(`/integrations/workbuddy/connections/${id}`), { method: "DELETE", headers })); setConnections((current) => current ? { ...current, connections: current.connections.map((item) => item.id === id ? { ...item, status: "revoked" } : item) } : current); setStatus("连接已撤销。"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "撤销失败"); } finally { setBusy(false); }
  }
  async function copySetup() {
    if (!connections?.mcpUrl || !oneTimeSecret) return;
    const config = JSON.stringify({ mcpServers: { "beauty-industry": { type: "streamable-http", url: connections.mcpUrl, headers: { Authorization: `Bearer ${oneTimeSecret}` } } } }, null, 2);
    try { await navigator.clipboard.writeText(config); setStatus("美业 MCP 配置已复制；请粘贴到 WorkBuddy 的 MCP 服务配置。 "); } catch { setStatus("浏览器未允许复制，请检查剪贴板权限。"); }
  }

  const latest = history.find((item) => item.usageChannel === "mcp");
  const permittedTools = new Set(overview?.tools.map((tool) => tool.name) ?? []);
  return <BeautyIndustryShell activeKey="workbuddy" pageTitle="WorkBuddy 连接" creditBalance={overview?.creditBalance} enterpriseName={overview?.enterpriseBase?.brandName} city={overview?.enterpriseBase?.city} localAcceptance={overview?.localAcceptance} permittedTools={permittedTools} brand={overview?.brand}>
    {loading ? <section className="beautyIndustryLoadState" role="status"><span className="beautyIndustryLoadingMark" /><h1>正在读取 WorkBuddy 连接</h1><p>正在核对当前租户的连接、权限和用量。</p></section> : loadError ? <section className="beautyIndustryLoadState beautyIndustryLoadError" role="alert"><h1>WorkBuddy 连接暂时没有加载成功</h1><p>{loadError}</p><button type="button" onClick={() => void load()}>重新加载</button></section> : <div className="beautyIndustryWorkBuddyPage">
    <section className="beautyIndustryHero"><div><span className="beautyIndustryKicker">邀请制内测 · {overview?.brand.pageCopy.connectionLabel ?? "美业产品专属连接"}</span><h1>连接 WorkBuddy</h1><p>配置一个连接，即可在 WorkBuddy 使用当前已开通的美业能力；品牌、积分和历史记录与网页共用。</p></div><aside><strong>{overview?.creditBalance ?? "—"}</strong><span>受控测试积分</span><em>{connections?.enabled ? "MCP 已启用" : "当前连接未启用"}</em></aside></section>
    <section className="beautyIndustryConnectionGrid">
      <article><h2>连接地址</h2><code>{connections?.mcpUrl || "当前环境未配置"}</code><p>传输方式：Streamable HTTP。密钥由本页生成，只显示一次，服务端只保存哈希与前缀。</p><button className="beautyIndustryPrimary" type="button" onClick={() => void create()} disabled={busy || !connections?.enabled}>生成一次性密钥</button>{oneTimeSecret && <div className="beautyIndustrySecret" role="status"><strong>仅此一次显示</strong><code>{oneTimeSecret}</code><button type="button" onClick={() => void copySetup()}>复制 WorkBuddy 配置</button></div>}{status && <p className="beautyIndustryNotice">{status}</p>}</article>
      <article><h2>已开放美业工具</h2><ul>{overview?.tools.map((tool) => { const visible = USER_TOOL_LABELS[tool.name]; return visible ? <li key={tool.name}><strong>{visible.label}</strong><span>{visible.result}</span></li> : null; })}</ul><p>视频内容复盘、文生视频和图生视频暂未开放。真实图片只在网页明确展示报价并由用户确认后生成，MCP 不会自动付费调用。</p></article>
    </section>
    <section className="beautyIndustryHistory"><div><span className="beautyIndustryKicker">连接与用量</span><h2>美业专属</h2><p>{latest ? `最近 MCP 调用：${new Date(latest.createdAt).toLocaleString()} · ${latest.creditCost} 积分` : "尚无美业 MCP 调用记录"}</p></div><div className="beautyIndustryConnectionList">{connections?.connections.length ? connections.connections.map((item) => <article key={item.id}><div><strong>{item.label}</strong><code>{item.tokenPrefix}</code><span>{item.scopes?.length ?? 0} 项工具范围 · {item.status === "active" ? "已启用" : "已撤销"}</span><small>{item.lastUsedAt ? `最近使用：${new Date(item.lastUsedAt).toLocaleString()}` : `创建于：${new Date(item.createdAt).toLocaleString()}`}</small></div>{item.status === "active" && <div><button type="button" onClick={() => void rotate(item.id)} disabled={busy}>轮换密钥</button><button type="button" onClick={() => void revoke(item.id)} disabled={busy}>撤销</button></div>}</article>) : <p>还没有美业专属连接。</p>}</div></section>
    </div>}
  </BeautyIndustryShell>;
}

async function readJson<T = unknown>(response: Response): Promise<T> { const value = await response.json().catch(() => ({})) as { message?: string; error?: string }; if (!response.ok) throw new Error(value.message || value.error || `请求失败（${response.status}）`); return value as T; }
function friendlyError(reason: unknown, fallback: string): string { return reason instanceof TypeError ? "网络连接失败，请检查网络后重试。" : reason instanceof Error ? reason.message : fallback; }
