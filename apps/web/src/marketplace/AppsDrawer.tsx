import { useEffect, useState } from "react";
import { apiPath, getPublicAssetPath } from "../lib/api.js";
import { authHeaders, guestToLogin, handleStaleSession, readJson } from "./shell.js";
import { DrawerPager, useIsMobile } from "./DrawerPager.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";

/**
 * 「关联应用」右侧抽屉（2026-09-30 用户：目录化设计，不止得到大脑）。
 *
 * 共享组件：商城「我的」页与选题策略官工作台（来源 1 配置入口）共用同一份抽屉，
 * 点「去『关联应用』配置」直接在本页右侧弹出，不再跳旧版「我的」页。
 *
 * 目录来自后端 /knowledge-base/connectors（getnote 可接入；飞书/企微/钉钉/微信读书 规划中），
 * 连接状态来自 /knowledge-base/connections；点可接入的应用展开对应配置表单：
 * 得到大脑 = 先「①测试连接」（不落库）→ 通过后「②保存并生效」；
 * 平台类（飞书/企微）= 一次「测试并保存」（服务端校验通过才落库）。
 */

export interface ConnectorView {
  provider: string;
  name: string;
  status: "available" | "planned";
  sourceTypes: string[];
  requiredFields: string[];
}

const APPS_PAGE_SIZE = 10;
const APP_FIELD_LABELS: Record<string, string> = {
  apiKey: "API Key", clientId: "Client ID", appId: "App ID", appSecret: "App Secret", corpId: "Corp ID", corpSecret: "Corp Secret"
};
const APP_FIELD_PLACEHOLDERS: Record<string, string> = {
  apiKey: "gk_ 开头的 API Key", clientId: "cli_ 开头的 Client ID", appId: "飞书应用 App ID",
  appSecret: "飞书应用 App Secret", corpId: "企业微信 Corp ID", corpSecret: "企业微信应用 Secret"
};

export function AppsDrawer({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected?: () => void }) {
  const isMobile = useIsMobile();
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [appsSel, setAppsSel] = useState<string>("getnote");
  const [appFields, setAppFields] = useState<Record<string, string>>({});
  const [appTestedOk, setAppTestedOk] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [appMsg, setAppMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [appsConns, setAppsConns] = useState<Array<{ id: string; provider: string; status: string; label?: string | null }>>([]);
  const [appsView, setAppsView] = useState<{ page: number; pageSize: number; total: number; totalPages: number } | null>(null);
  const [appsPage, setAppsPage] = useState(1);
  const [appsBusy, setAppsBusy] = useState(false);

  useScrollLock(open);

  useEffect(() => {
    if (open) {
      setAppsConns([]);
      setAppFields({});
      setAppMsg(null);
      setAppTestedOk(false);
      setAppsSel("getnote");
      void loadAppsPage(1, false);
      // 应用目录（后端 connectors 可扩展：新增 provider 只改服务端，前端自动出卡片）
      void fetch(apiPath("/knowledge-base/connectors"), { headers: authHeaders(), cache: "no-store" })
        .then((r) => (r.ok ? readJson<{ connectors: ConnectorView[] }>(r) : null))
        .then((d) => { if (d?.connectors) setConnectors(d.connectors); })
        .catch(() => { /* 目录拉不到时退回已有连接列表 */ });
    }
  }, [open]);

  async function loadAppsPage(page: number, append: boolean): Promise<void> {
    setAppsBusy(true);
    try {
      const params = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(APPS_PAGE_SIZE) });
      const res = await fetch(apiPath(`/knowledge-base/connections?${params.toString()}`), { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_apps_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) return;
      const view = (await res.json()) as {
        connections: Array<{ id: string; provider: string; status: string; label?: string | null }>;
        page?: number; total?: number; totalPages?: number;
      };
      const conns = view.connections ?? [];
      setAppsView({ page: view.page ?? 1, pageSize: APPS_PAGE_SIZE, total: view.total ?? conns.length, totalPages: view.totalPages ?? 1 });
      setAppsConns((prev) => (append ? [...prev, ...conns] : conns));
      setAppsPage(Math.max(1, view.page ?? 1));
    } catch { /* 抽屉里给空态 */ }
    finally { setAppsBusy(false); }
  }

  function isProviderConnected(provider: string): boolean {
    return appsConns.some((item) => item.provider === provider && item.status === "active");
  }

  /** 平台类应用（飞书/企业微信）：一次「测试并保存」——服务端校验凭证通过后才落库。 */
  async function connectPlatform(sel: ConnectorView): Promise<void> {
    setAppBusy(true); setAppMsg(null);
    try {
      const body: Record<string, unknown> = { provider: sel.provider, label: sel.name };
      for (const field of sel.requiredFields) {
        const value = (appFields[field] ?? "").trim();
        if (!value) { setAppMsg({ ok: false, text: `请先填写 ${APP_FIELD_LABELS[field] ?? field}。` }); return; }
        body[field] = value;
      }
      const response = await fetch(apiPath("/knowledge-base/connections/platform"), { method: "POST", headers: { ...authHeaders(true) }, body: JSON.stringify(body) });
      if (handleStaleSession(response.status)) { setAppMsg({ ok: false, text: "登录状态已失效，请重新登录后再试。" }); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setAppMsg({ ok: false, text: data?.message ?? data?.error ?? "连接校验未通过，请检查凭证。" }); return; }
      setAppMsg({ ok: true, text: data?.message ?? `✅ ${sel.name} 已连接，数字员工可以引用这里的资料了。` });
      onConnected?.();
      void loadAppsPage(1, false);
    } catch {
      setAppMsg({ ok: false, text: "网络异常，请稍后重试。" });
    } finally {
      setAppBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="eh-rd-overlay" onClick={onClose}>
      <aside
        className="eh-rd-panel"
        role="dialog"
        aria-modal="true"
        aria-label="关联应用"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="eh-rd-head">
          <b>🔌 关联应用</b>
          <span style={{ flex: 1 }} />
          <button type="button" className="eh-rd-x" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="eh-rd-body eh-ap-body">
          <p className="eh-ap-tip">
            把你的私有知识源接到平台，数字员工生成选题等内容时可以直接引用（与「企业知识库」是同一份配置）。点一个应用进行接入。
          </p>
          {/* ---- 应用目录（后端 connectors 可扩展，前端不再写死某个大脑） ---- */}
          <ul className="eh-ap-list">
            {(connectors.length > 0
              ? connectors
              : [{ provider: "getnote", name: "得到大脑", status: "available" as const, sourceTypes: [], requiredFields: ["apiKey", "clientId"] }]
            ).map((conn) => {
              const connected = isProviderConnected(conn.provider);
              const planned = conn.status === "planned";
              return (
                <li key={conn.provider}>
                  <button
                    type="button"
                    className={"eh-ap-item" + (appsSel === conn.provider ? " sel" : "") + (planned ? " off" : "")}
                    disabled={planned}
                    onClick={() => { setAppsSel(conn.provider); setAppFields({}); setAppMsg(null); setAppTestedOk(false); }}
                  >
                    <span className="eh-ap-logo" aria-hidden="true">
                      {conn.provider === "getnote"
                        ? <img src={getPublicAssetPath("/logos/getnote-logo.png")} alt="" />
                        : conn.name.slice(0, 1)}
                    </span>
                    <span className="eh-ap-info">
                      <b>{conn.name}</b>
                      <span>{conn.sourceTypes.length > 0 ? `可引用：${conn.sourceTypes.join(" / ")}` : "私有知识源"}</span>
                    </span>
                    <span className={"eh-ap-st" + (connected ? " on" : planned ? "" : " ready")}>
                      {connected ? "已连接" : planned ? "即将上线" : "可接入"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <DrawerPager
            isMobile={isMobile}
            page={appsPage}
            totalPages={appsView?.totalPages ?? 1}
            total={appsView?.total ?? 0}
            unit="个"
            busy={appsBusy}
            onPrev={() => void loadAppsPage(appsPage - 1, false)}
            onNext={() => void loadAppsPage(appsPage + 1, false)}
            onLoadMore={() => void loadAppsPage(appsPage + 1, true)}
          />

          {/* ---- 选中应用的配置表单（得到大脑：先测试再保存；飞书/企微：服务端校验通过即保存） ---- */}
          {(() => {
            const sel = connectors.find((c) => c.provider === appsSel);
            if (!sel) return null;
            const connected = isProviderConnected(sel.provider);
            if (sel.status === "planned") {
              return (
                <div className="eh-ap-cfg">
                  <b>配置{sel.name}</b>
                  <p className="eh-ap-cfg-tip">「{sel.name}」正在接入规划中（可引用：{sel.sourceTypes.join(" / ") || "私有资料"}），上线后会在这里出现配置入口。</p>
                </div>
              );
            }
            const isGetnote = sel.provider === "getnote";
            return (
              <div className="eh-ap-cfg">
                <b>配置{sel.name}</b>
                <p className="eh-ap-cfg-tip">
                  {isGetnote
                    ? <>凭证按你的账号单独保存（与企业知识库是同一份配置）。在{" "}<a href="https://www.biji.com/openapi" target="_blank" rel="noreferrer">Get 笔记开放平台</a>{" "}登录后，在你的应用「凭证」里复制 API Key 和 Client ID。</>
                    : <>需要{sel.name}管理员在开放平台创建应用并授权对应文档/通讯录范围；平台只会读取你显式授权的资料，不会读取聊天记录。</>}
                </p>
                {connected ? (
                  <div className="eh-ap-ok">当前已连接。重新填写并保存即可更新凭证。</div>
                ) : null}
                {sel.requiredFields.map((field) => (
                  <div key={field}>
                    <label htmlFor={`eh-ap-${field}`}>{APP_FIELD_LABELS[field] ?? field}</label>
                    <input
                      id={`eh-ap-${field}`}
                      type={/secret/i.test(field) ? "password" : "text"}
                      value={appFields[field] ?? ""}
                      onChange={(e) => { setAppFields((prev) => ({ ...prev, [field]: e.target.value })); setAppTestedOk(false); }}
                      placeholder={APP_FIELD_PLACEHOLDERS[field] ?? `填写${APP_FIELD_LABELS[field] ?? field}`}
                    />
                  </div>
                ))}
                {appMsg ? <div className={"eh-ap-msg" + (appMsg.ok ? " ok" : "")}>{appMsg.text}</div> : null}
                <div className="eh-ap-actions">
                  {isGetnote ? (
                    <>
                      <button
                        type="button"
                        className="eh-ap-btn ghost"
                        disabled={appBusy || !(appFields.apiKey ?? "").trim()}
                        onClick={() => {
                          void (async () => {
                            setAppBusy(true); setAppMsg(null); setAppTestedOk(false);
                            try {
                              const body: Record<string, unknown> = {};
                              if ((appFields.apiKey ?? "").trim()) body.apiKey = appFields.apiKey.trim();
                              if ((appFields.clientId ?? "").trim()) body.clientId = appFields.clientId.trim();
                              if (!body.apiKey) { setAppMsg({ ok: false, text: "请先填写 API Key。" }); return; }
                              const response = await fetch(apiPath("/knowledge-base/connections/getnote"), { method: "POST", headers: { ...authHeaders(true) }, body: JSON.stringify({ ...body, testOnly: true }) });
                              if (handleStaleSession(response.status)) { setAppMsg({ ok: false, text: "登录状态已失效，请重新登录后再试。" }); return; }
                              const data = await response.json().catch(() => ({}));
                              if (!response.ok) { setAppMsg({ ok: false, text: data?.message ?? data?.error ?? "测试未通过，请检查凭证。" }); return; }
                              setAppTestedOk(true);
                              setAppMsg({ ok: true, text: `✅ 连接可用${typeof data?.noteCount === "number" ? `，已读到 ${data.noteCount} 条笔记` : ""}。点「保存并生效」完成配置。` });
                            } catch {
                              setAppMsg({ ok: false, text: "网络异常，请稍后重试。" });
                            } finally {
                              setAppBusy(false);
                            }
                          })();
                        }}
                      >
                        {appBusy ? "测试中…" : "① 测试连接"}
                      </button>
                      <button
                        type="button"
                        className="eh-ap-btn primary"
                        disabled={!appTestedOk || appBusy}
                        onClick={() => {
                          void (async () => {
                            setAppBusy(true); setAppMsg(null);
                            try {
                              const body: Record<string, unknown> = {};
                              if ((appFields.apiKey ?? "").trim()) body.apiKey = appFields.apiKey.trim();
                              if ((appFields.clientId ?? "").trim()) body.clientId = appFields.clientId.trim();
                              if (!body.apiKey) { setAppMsg({ ok: false, text: "请先填写 API Key。" }); return; }
                              const response = await fetch(apiPath("/knowledge-base/connections/getnote"), { method: "POST", headers: { ...authHeaders(true) }, body: JSON.stringify(body) });
                              if (handleStaleSession(response.status)) { setAppMsg({ ok: false, text: "登录状态已失效，请重新登录后再试。" }); return; }
                              const data = await response.json().catch(() => ({}));
                              if (!response.ok) { setAppMsg({ ok: false, text: data?.message ?? data?.error ?? "保存失败，请稍后重试。" }); return; }
                              setAppMsg({ ok: true, text: "已保存并生效，数字员工现在可以引用你的得到大脑笔记了。" });
                              onConnected?.();
                              void loadAppsPage(1, false);
                            } catch {
                              setAppMsg({ ok: false, text: "网络异常，请稍后重试。" });
                            } finally {
                              setAppBusy(false);
                            }
                          })();
                        }}
                      >
                        ② 保存并生效
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="eh-ap-btn primary"
                      disabled={appBusy}
                      onClick={() => void connectPlatform(sel)}
                    >
                      {appBusy ? "校验中…" : "测试并保存"}
                    </button>
                  )}
                </div>
                <p className="eh-ap-cfg-note">
                  {isGetnote
                    ? "每次修改都要先「测试连接」，通过后才能保存生效——避免把不可用的凭证存进系统。"
                    : "保存前服务端会先校验凭证，校验不通过不会落库。"}
                </p>
              </div>
            );
          })()}
        </div>
      </aside>
    </div>
  );
}
