import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath, getAppPath } from "../lib/api.js";
import {
  PROJECT_SOLUTIONS,
  buildClientProjectInput,
  cloneSeedProjects,
  createEmptyProject,
  projectCompletion,
  solutionForProject,
  type ClientProject,
  type ClientProjectRun,
  type ClientProjectStatus,
  type ProjectExecutionStep
} from "../lib/client-project-workbench.js";

const storageKey = "sitong_internal_client_projects_v1";
const activeProjectKey = "sitong_internal_active_client_project_v1";

interface AgentRunResponse {
  status?: string;
  deliveryStatus?: "completed" | "needs_input" | "failed";
  answerText?: string;
  message?: string;
  qualityFlags?: string[];
  traceId?: string;
  conversationId?: string;
  execution?: {
    mode?: string;
    steps?: ProjectExecutionStep[];
  };
}

interface DeliverySection {
  title: string;
  content: string;
}

interface DeliveryBrief {
  summary: string;
  items: string[];
}

function migrateProjects(projects: ClientProject[]): ClientProject[] {
  return projects.map((project) => {
    if (project.id !== "project-zhenshui-jiangnan") return project;
    const requiredFacts = [
      "7家外卖店全部位于沈阳。",
      "主要成交平台为美团、饿了么、淘宝闪购等外卖平台。",
      "抖音短视频负责本地曝光与种草，用户可能回到美团等平台下单；目前抖音团购不是主要成交方式。"
    ];
    const knownFacts = requiredFacts.reduce((facts, item) => facts.includes(item) ? facts : `${facts.trim()}\n${item}`.trim(), project.knownFacts);
    const missingFacts = project.missingFacts.replace("新店所在城市和商圈", "新店具体商圈与配送半径");
    const industry = project.industry === "中式快餐" ? "中式快餐外卖" : project.industry;
    const currentProblem = project.currentProblem === "新开门店业绩不好，需要提升外卖销售额。"
      ? "新开外卖店线上订单表现不好，需要提升外卖平台订单量与销售额。"
      : project.currentProblem;
    const goal = project.goal === "先找出新店外卖增长的可执行抓手，形成30天获客与销售提升方案。"
      ? "围绕美团、饿了么、淘宝闪购优化曝光—进店—加购—下单—复购链路，并用抖音短视频增加沈阳本地曝光与品牌搜索。"
      : project.goal;
    if (project.city === "沈阳" && knownFacts === project.knownFacts && missingFacts === project.missingFacts && industry === project.industry && currentProblem === project.currentProblem && goal === project.goal) return project;
    const updatedAt = new Date().toISOString();
    return {
      ...project,
      city: "沈阳",
      industry,
      currentProblem,
      goal,
      knownFacts,
      missingFacts,
      status: "ready",
      updatedAt
    };
  });
}

function readProjects(): ClientProject[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return cloneSeedProjects();
    const parsed = JSON.parse(raw) as ClientProject[];
    return Array.isArray(parsed) && parsed.length > 0 ? migrateProjects(parsed) : cloneSeedProjects();
  } catch {
    return cloneSeedProjects();
  }
}

function splitDelivery(answer: string): { overview: string; sections: DeliverySection[] } {
  const headingPattern = /^([一二三四五六七八九十]+)、(行业热点|文案创作|直播话术|招商获客|朋友圈私域|客户诊断|异议回复|跟单计划)\s*$/gm;
  const matches = Array.from(answer.matchAll(headingPattern));
  if (matches.length === 0) return { overview: "", sections: [{ title: "完整交付", content: answer }] };
  const firstIndex = matches[0].index ?? 0;
  const sections = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? answer.length;
    return { title: match[2], content: answer.slice(start, end).trim() };
  });
  return { overview: answer.slice(0, firstIndex).trim(), sections };
}

function firstUsefulLine(content: string): string {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const shortConclusion = lines.findIndex((line) => line === "短结论");
  const candidate = shortConclusion >= 0 ? lines[shortConclusion + 1] : lines.find((line) => !/^[一二三四五六七八九十]+、/.test(line));
  return (candidate ?? "本模块已生成执行初稿，先核对方向，再查看完整执行稿。").slice(0, 180);
}

function moduleBrief(section: DeliverySection): DeliveryBrief {
  const source = section.content;
  if (section.title === "文案创作") {
    const topics = Array.from(source.matchAll(/第\d+天[^：\n]*：主题《([^》]+)》/g)).map((match) => match[1]).slice(0, 3);
    return {
      summary: "先看7天选题是否围绕真实菜品、真实包装和外卖平台下单；完整逐字稿放在下一级，不需要一次读完。",
      items: topics.length > 0 ? topics : ["菜品与套餐内容待客户确认", "短视频负责沈阳本地曝光与种草", "成交回流美团、饿了么或淘宝闪购"]
    };
  }
  if (section.title === "直播话术") {
    return {
      summary: "直播定位为外卖菜品种草与品牌搜索，不以抖音团购核销为成交目标。",
      items: ["讲清真实菜品、包装、分量和配送规则", "只引导已确认的外卖店铺入口", "复盘店铺访问、商品点击、加购与订单"]
    };
  }
  if (section.title === "行业热点") {
    const topics = Array.from(source.matchAll(/选题\d+[：:]\s*([^\n]+)/g)).map((match) => match[1]).slice(0, 3);
    return {
      summary: "这里不是追泛餐饮热点，而是寻找会影响外卖用户搜索、比较和下单的真实问题。",
      items: topics.length > 0 ? topics : ["外卖平台曝光与店铺进店", "菜单、套餐与商品点击", "加购、下单与复购"]
    };
  }
  return { summary: firstUsefulLine(source), items: source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3) };
}

function formatDeliveryMarkdown(content: string): string {
  return content.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return "";
    if (/^第\d+天/.test(line)) {
      const sentences = line.split("。").map((sentence) => sentence.trim()).filter(Boolean);
      const [title, ...details] = sentences;
      return [`### ${title}`, ...details.map((sentence) => `- ${sentence}。`)].join("\n\n");
    }
    if (/^(短结论|[一二三四五六七八九十]+、)/.test(line)) return `### ${line}`;
    if (/^(?:热点|选题|动作|问题|步骤)\d+[：:]/.test(line) || /^\d+[.、]/.test(line)) return `- ${line}`;
    const label = line.match(/^([^：:]{2,16})[：:]\s*(.+)$/);
    if (label) return `**${label[1]}：** ${label[2]}`;
    return line;
  }).join("\n\n");
}

function reviewActionSummary(solutionId: string): string {
  if (solutionId === "restaurant_store_growth") return "先审外卖平台成交链路、7天抖音种草和30天订单动作，不必逐字看全部话术。";
  if (solutionId === "restaurant_franchise_growth") return "先审招商定位、线索筛选和考察转化，再看具体直播与私域话术。";
  if (solutionId === "beauty_franchise_growth") return "先审美业门店模型、加盟商画像、线索筛选和到店考察，再看直播与私域跟进话术。";
  return "先审增长路径与30天动作，再按需要查看内容和私域执行明细。";
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw Object.assign(new Error(String(payload.message ?? payload.error ?? `请求失败（${response.status}）`)), {
      status: response.status,
      payload
    });
  }
  return payload as T;
}

function statusLabel(status: ClientProjectStatus): string {
  return {
    draft: "资料草稿",
    ready: "可试跑",
    running: "生成中",
    completed: "已完成",
    needs_input: "需补信息",
    failed: "运行失败"
  }[status];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function internalRunHeaders(project: ClientProject): Record<string, string> {
  const profile = {
    industry: project.industry,
    city: project.city,
    offer: solutionForProject(project).name,
    customer: project.goal
  };
  return {
    "Content-Type": "application/json",
    "x-sitong-tenant-id": `internal-${project.id}`,
    "x-sitong-user-id": "internal-project-owner",
    "x-sitong-plan": "chain_premium",
    "x-sitong-profile": encodeURIComponent(JSON.stringify(profile))
  };
}

export function ClientProjectWorkbenchPage() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("sitong_admin_token") ?? "");
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authChecking, setAuthChecking] = useState(false);
  const [projects, setProjects] = useState<ClientProject[]>(readProjects);
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem(activeProjectKey) ?? "project-zhenshui-jiangnan");
  const [runMessage, setRunMessage] = useState("");
  const [previewInput, setPreviewInput] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const activeRun = activeProject?.runs[0];
  const solution = activeProject ? solutionForProject(activeProject) : PROJECT_SOLUTIONS[0];
  const completion = activeProject ? projectCompletion(activeProject) : { completed: 0, total: 0, missing: [] as string[] };
  const delivery = useMemo(() => activeRun ? splitDelivery(activeRun.answer) : undefined, [activeRun]);
  const runOutdated = Boolean(activeProject && activeRun && new Date(activeProject.updatedAt).getTime() > new Date(activeRun.createdAt).getTime() + 1_000);
  const stats = useMemo(() => ({
    total: projects.length,
    ready: projects.filter((project) => project.status === "ready").length,
    completed: projects.filter((project) => project.status === "completed").length,
    needsInput: projects.filter((project) => project.status === "needs_input").length
  }), [projects]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem(activeProjectKey, activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (adminToken) void verifyAdmin(adminToken, false);
    // Only check the token restored at page entry. Manual checks happen through the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verifyAdmin(token = adminToken, persist = true) {
    setAuthChecking(true);
    setAuthError("");
    try {
      await fetch(apiPath("/admin/agents"), {
        headers: { "x-sitong-admin-token": token }
      }).then((response) => readJson(response));
      if (persist) localStorage.setItem("sitong_admin_token", token);
      setAuthorized(true);
    } catch {
      setAuthorized(false);
      setAuthError("管理员凭证无效，客户项目工作台仅供思潼内部使用。");
    } finally {
      setAuthChecking(false);
    }
  }

  function updateActive(patch: Partial<ClientProject>) {
    if (!activeProject) return;
    setProjects((current) => current.map((project) => {
      if (project.id !== activeProject.id) return project;
      const merged = { ...project, ...patch, updatedAt: new Date().toISOString() };
      if (patch.status || project.status === "running") return merged;
      return { ...merged, status: projectCompletion(merged).missing.length > 0 ? "draft" : "ready" };
    }));
  }

  function addProject() {
    const project = createEmptyProject();
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setRunMessage("已新建客户项目，请先补齐核心资料。");
  }

  function deleteProject() {
    if (!activeProject || !window.confirm(`确认删除“${activeProject.title}”及其本机交付记录吗？`)) return;
    const remaining = projects.filter((project) => project.id !== activeProject.id);
    const next = remaining.length > 0 ? remaining : [createEmptyProject()];
    setProjects(next);
    setActiveProjectId(next[0].id);
    setRunMessage("项目已从本机工作台删除。");
  }

  function resetDemoProjects() {
    if (!window.confirm("确认恢复三家老客户的初始项目？当前本机项目和运行记录会被替换。")) return;
    const seeded = cloneSeedProjects();
    setProjects(seeded);
    setActiveProjectId(seeded[0].id);
    setRunMessage("已恢复三家老客户的初始项目。");
  }

  async function runProject() {
    if (!activeProject || activeProject.status === "running") return;
    if (completion.missing.length > 0) {
      setRunMessage(`请先补齐：${completion.missing.join("、")}。`);
      updateActive({ status: "draft" });
      return;
    }
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const selectedSolution = solutionForProject(activeProject);
    updateActive({ status: "running" });
    setRunMessage(`正在调用${selectedSolution.capabilityNames.join("、")}，复杂任务可能需要几分钟，请不要关闭页面。`);
    try {
      const response = await fetch(apiPath(`/agents/${selectedSolution.agentSlug}/runs`), {
        method: "POST",
        headers: internalRunHeaders(activeProject),
        body: JSON.stringify({
          requestId,
          input: buildClientProjectInput(activeProject),
          routingInput: `客户：${activeProject.clientName}。行业：${activeProject.industry}。请结合近期行业热点完成：${activeProject.currentProblem}｜${activeProject.goal}`,
          capabilityIds: selectedSolution.capabilityIds,
          capabilitySelectionMode: "explicit",
          deviceScope: "desktop"
        })
      });
      const data = await readJson<AgentRunResponse>(response);
      const deliveryStatus = data.deliveryStatus ?? (data.answerText ? "completed" : "failed");
      const run: ClientProjectRun = {
        id: requestId,
        createdAt: new Date().toISOString(),
        status: deliveryStatus,
        answer: data.answerText ?? data.message ?? "本次运行没有返回可交付内容。",
        solutionId: selectedSolution.id,
        agentSlug: selectedSolution.agentSlug,
        capabilityIds: selectedSolution.capabilityIds,
        qualityFlags: data.qualityFlags ?? [],
        executionMode: data.execution?.mode,
        steps: data.execution?.steps ?? [],
        durationMs: Date.now() - startedAt,
        traceId: data.traceId,
        conversationId: data.conversationId
      };
      setProjects((current) => current.map((project) => project.id === activeProject.id
        ? { ...project, status: deliveryStatus, runs: [run, ...project.runs].slice(0, 20), updatedAt: run.createdAt }
        : project));
      setRunMessage(deliveryStatus === "completed"
        ? "第一版方案已完成并保存到本机交付记录。"
        : deliveryStatus === "needs_input"
          ? "已生成可用部分，系统标记了需要补充的信息。"
          : "本次只完成了部分步骤，请查看失败项后重试。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "运行失败";
      const run: ClientProjectRun = {
        id: requestId,
        createdAt: new Date().toISOString(),
        status: "failed",
        answer: `本次运行失败：${message}`,
        solutionId: selectedSolution.id,
        agentSlug: selectedSolution.agentSlug,
        capabilityIds: selectedSolution.capabilityIds,
        qualityFlags: ["request_failed"],
        steps: [],
        durationMs: Date.now() - startedAt,
        traceId: requestId
      };
      setProjects((current) => current.map((project) => project.id === activeProject.id
        ? { ...project, status: "failed", runs: [run, ...project.runs].slice(0, 20), updatedAt: run.createdAt }
        : project));
      setRunMessage(`运行失败：${message}。已保存失败记录，可稍后重试。`);
    }
  }

  async function copyRun() {
    if (!activeRun) return;
    await navigator.clipboard.writeText(activeRun.answer);
    setRunMessage("方案全文已复制，可直接粘贴到 Word 或微信。");
  }

  function downloadMarkdown() {
    if (!activeRun || !activeProject) return;
    const content = `# ${activeProject.title}\n\n客户：${activeProject.clientName}\n\n方案：${solutionForProject(activeProject).name}\n\n生成时间：${new Date(activeRun.createdAt).toLocaleString("zh-CN")}\n\n---\n\n${activeRun.answer}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeProject.clientName || "客户"}-${solutionForProject(activeProject).shortName}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setRunMessage("Markdown 方案已下载，可作为后续 Word/PDF 排版底稿。");
  }

  function printRun() {
    if (!activeRun || !activeProject) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setRunMessage("浏览器阻止了打印窗口，请允许弹窗后重试。");
      return;
    }
    const escaped = activeRun.answer.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character);
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${activeProject.title}</title><style>body{max-width:860px;margin:42px auto;padding:0 28px;color:#263c35;font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif}h1{color:#174d3e;border-bottom:2px solid #2f8068;padding-bottom:14px}.meta{color:#64766f;margin-bottom:30px}pre{white-space:pre-wrap;font:inherit}@media print{body{margin:0}}</style></head><body><h1>${activeProject.title}</h1><div class="meta">客户：${activeProject.clientName}　方案：${solutionForProject(activeProject).name}　生成时间：${new Date(activeRun.createdAt).toLocaleString("zh-CN")}</div><pre>${escaped}</pre><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }

  if (!authorized) {
    return (
      <main className="clientProjectPage clientProjectGate">
        <section>
          <span className="projectEyebrow">思潼内部系统</span>
          <h1>客户项目工作台</h1>
          <p>用于老客户模拟测试、方案生成和交付留档，暂不对客户开放。</p>
          <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="ADMIN_TOKEN" onKeyDown={(event) => { if (event.key === "Enter") void verifyAdmin(); }} />
          <button onClick={() => void verifyAdmin()} disabled={authChecking || !adminToken}>{authChecking ? "验证中…" : "验证并进入"}</button>
          {authError && <strong>{authError}</strong>}
          <button className="projectTextButton" onClick={() => window.location.assign(getAppPath("/internal"))}>返回 Agent 控制台</button>
        </section>
      </main>
    );
  }

  if (!activeProject) return null;

  return (
    <main className="clientProjectPage">
      <header className="projectTopbar">
        <button className="projectBrand" onClick={() => window.location.assign(getAppPath("/internal"))}><span>思潼</span><div><strong>客户项目工作台</strong><small>内部模拟与交付留档</small></div></button>
        <div><button className="projectGhostButton" onClick={resetDemoProjects}>恢复示例项目</button><button className="projectPrimaryButton" onClick={addProject}>＋ 新建项目</button></div>
      </header>

      <section className="projectSummaryBar">
        <div><span>客户项目</span><strong>{stats.total}</strong></div>
        <div><span>可试跑</span><strong>{stats.ready}</strong></div>
        <div><span>已完成</span><strong>{stats.completed}</strong></div>
        <div><span>需补信息</span><strong>{stats.needsInput}</strong></div>
        <p><b>第一版运行方式：</b>项目与交付记录保存在当前浏览器；直接调用现有组合 Agent，不要求客户登录。</p>
      </section>

      <div className="projectWorkbenchLayout">
        <aside className="projectSidebar">
          <div className="projectPanelTitle"><div><span>01</span><strong>客户项目</strong></div><small>{projects.length} 个</small></div>
          <div className="projectList">
            {projects.map((project) => <button key={project.id} className={project.id === activeProject.id ? "active" : ""} onClick={() => { setActiveProjectId(project.id); setRunMessage(""); }}>
              <div><strong>{project.clientName || "未命名客户"}</strong><span className={`projectStatus ${project.status}`}>{statusLabel(project.status)}</span></div>
              <p>{project.currentProblem || "等待填写核心问题"}</p>
              <small>{solutionForProject(project).shortName} · {formatDate(project.updatedAt)}</small>
            </button>)}
          </div>
          <button className="projectDeleteButton" onClick={deleteProject}>删除当前项目</button>
        </aside>

        <section className="projectEditor">
          <div className="projectPanelTitle"><div><span>02</span><strong>项目资料</strong></div><em>{completion.completed}/{completion.total} 已补齐</em></div>
          <div className="projectCompletion"><i style={{ width: `${completion.total ? completion.completed / completion.total * 100 : 0}%` }} /></div>
          {completion.missing.length > 0 && <p className="projectMissing">运行前还需补：{completion.missing.join("、")}</p>}
          <div className="projectFormGrid">
            <label className="wide">项目标题<input value={activeProject.title} onChange={(event) => updateActive({ title: event.target.value })} /></label>
            <label>客户名称<input value={activeProject.clientName} onChange={(event) => updateActive({ clientName: event.target.value })} /></label>
            <label>行业<input value={activeProject.industry} onChange={(event) => updateActive({ industry: event.target.value })} /></label>
            <label>经营形态<select value={activeProject.businessType} onChange={(event) => updateActive({ businessType: event.target.value as ClientProject["businessType"] })}><option value="single_store">单店</option><option value="chain_brand">连锁品牌</option></select></label>
            <label>门店规模<input value={activeProject.storeCount} onChange={(event) => updateActive({ storeCount: event.target.value })} /></label>
            <label className="wide">城市 / 区域（可待补）<input value={activeProject.city} onChange={(event) => updateActive({ city: event.target.value })} placeholder="未确认可留空，输出中会标记【待补】" /></label>
            <label className="wide">当前核心问题<textarea rows={3} value={activeProject.currentProblem} onChange={(event) => updateActive({ currentProblem: event.target.value })} /></label>
            <label className="wide">本次目标<textarea rows={3} value={activeProject.goal} onChange={(event) => updateActive({ goal: event.target.value })} /></label>
            <label className="wide">已确认事实<textarea rows={5} value={activeProject.knownFacts} onChange={(event) => updateActive({ knownFacts: event.target.value })} placeholder="一行一个事实；只写已经确认的内容" /></label>
            <label className="wide">待补信息<textarea rows={5} value={activeProject.missingFacts} onChange={(event) => updateActive({ missingFacts: event.target.value })} placeholder="一行一个待确认项；系统允许先出第一版" /></label>
          </div>
        </section>

        <aside className="projectRunPanel">
          <div className="projectPanelTitle"><div><span>03</span><strong>方案与运行</strong></div></div>
          <label className="solutionSelect">选择解决方案<select value={activeProject.solutionId} onChange={(event) => updateActive({ solutionId: event.target.value, status: "ready" })}>{PROJECT_SOLUTIONS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <article className="solutionCard">
            <span>{solution.agentSlug === "acquisition" ? "获客智能体" : "销售智能体"}</span>
            <h2>{solution.name}</h2>
            <p>{solution.description}</p>
            <div>{solution.capabilityNames.map((name, index) => <i key={name}><b>{index + 1}</b>{name}</i>)}</div>
          </article>
          <button className="projectRunButton" disabled={activeProject.status === "running"} onClick={() => void runProject()}>{activeProject.status === "running" ? "组合 Agent 正在生成…" : activeRun ? "重新生成第一版方案" : "生成第一版方案"}</button>
          <button className="projectGhostButton projectPreviewInput" onClick={() => setPreviewInput((current) => !current)}>{previewInput ? "收起运行输入" : "预览发给 Agent 的输入"}</button>
          {previewInput && <pre className="projectInputPreview">{buildClientProjectInput(activeProject)}</pre>}
          {runMessage && <p className="projectRunMessage">{runMessage}</p>}
          <p className="projectPrivacyNote">内部试跑不会主动联系客户，也不会对外发布。客户未确认的数据会按【待补】处理。</p>
        </aside>
      </div>

      <section className="projectDelivery">
        <header>
          <div><span>04</span><div><strong>交付记录</strong><small>{activeRun ? `${formatDate(activeRun.createdAt)} · ${statusLabel(activeRun.status)}` : "尚未生成"}</small></div></div>
          {activeRun && <nav><button onClick={() => void copyRun()}>复制全文</button><button onClick={downloadMarkdown}>下载底稿</button><button onClick={printRun}>打印 / 存PDF</button></nav>}
        </header>
        {activeRun ? <>
          {runOutdated && <div className="projectOutdatedNotice"><strong>客户资料或方案方向已更新</strong><span>下面是更新前的旧方案，请重新生成后再用于内部评审或客户沟通。</span></div>}
          <div className="projectRunMeta">
            <span>耗时 {(activeRun.durationMs / 1000).toFixed(1)} 秒</span>
            <span>{activeRun.executionMode ? `${activeRun.executionMode} 编排` : "组合执行"}</span>
            <span>{activeRun.steps.filter((step) => step.status === "success").length}/{activeRun.steps.length || activeRun.capabilityIds.length} 步完成</span>
            {activeRun.qualityFlags.slice(0, 4).map((flag) => <code key={flag}>{flag}</code>)}
          </div>
          {activeRun.steps.length > 0 && <div className="projectStepGrid">{activeRun.steps.map((step, index) => <article key={step.stepId} className={step.status}><b>{index + 1}</b><div><strong>{solution.capabilityNames[index] ?? step.capabilityId}</strong><small>{step.status === "success" ? "已完成" : step.status === "needs_input" ? "需补充" : "未通过"} · {(step.durationMs / 1000).toFixed(1)}秒</small></div></article>)}</div>}
          <section className="projectOwnerReview">
            <header><span>老板审阅版</span><h2>你先看这四件事，不用逐字看完</h2><p>先判断方向和事实，专业执行明细需要修改时再展开。</p></header>
            <div className="projectReviewGrid">
              <article><span>01 · 事实</span><strong>{activeProject.city || "区域待补"} · {activeProject.storeCount}</strong><p>{activeProject.currentProblem}</p></article>
              <article><span>02 · 成交方向</span><strong>{solution.shortName}</strong><p>主成交在外卖平台，抖音负责曝光与种草。</p></article>
              <article><span>03 · 动作</span><strong>看能不能真的执行</strong><p>{reviewActionSummary(activeProject.solutionId)}</p></article>
              <article><span>04 · 待补</span><strong>{activeProject.missingFacts.split(/\r?\n/).filter(Boolean).length}项客户资料</strong><p>{activeProject.missingFacts.split(/\r?\n/).filter(Boolean).slice(0, 3).join("；") || "暂无"}</p></article>
            </div>
            {delivery?.overview && <article className="projectExecutiveSummary"><span>系统执行摘要</span><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.overview}</ReactMarkdown></article>}
          </section>
          <section className="projectDeliveryModules">
            <header><div><span>专业交付明细</span><h2>{delivery?.sections.length ?? 0}个模块，需要时再展开</h2></div><small>对外正式方案会重新提炼，不会把三份原始长稿直接发给客户。</small></header>
            {delivery?.sections.map((section, index) => {
              const brief = moduleBrief(section);
              return <details key={`${section.title}-${index}`}>
              <summary><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{section.title}</strong><span>{section.title === "行业热点" ? "看选题依据和内容方向" : section.title === "文案创作" ? "看可直接拍摄的内容成品" : section.title === "直播话术" ? "看直播流程与转化动作" : "查看本模块完整交付"}</span></div><em>展开</em></summary>
              <div className="projectModuleBrief"><span>本模块先看</span><p>{brief.summary}</p><ul>{brief.items.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <details className="projectFullDraft">
                <summary><div><strong>查看完整执行稿</strong><span>已重新分段，适合逐项修改</span></div><em>{section.content.length}字</em></summary>
                <article className="projectMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{formatDeliveryMarkdown(section.content)}</ReactMarkdown></article>
              </details>
            </details>})}
          </section>
          {activeProject.runs.length > 1 && <details className="projectHistory"><summary>查看历史运行记录（{activeProject.runs.length - 1}）</summary>{activeProject.runs.slice(1).map((run) => <button key={run.id} onClick={() => setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, runs: [run, ...project.runs.filter((item) => item.id !== run.id)] } : project))}><strong>{formatDate(run.createdAt)}</strong><span>{statusLabel(run.status)}</span><small>{(run.durationMs / 1000).toFixed(1)}秒</small></button>)}</details>}
        </> : <div className="projectEmptyDelivery"><span>AI</span><h2>还没有交付方案</h2><p>确认客户事实、选择解决方案后，运行组合 Agent。结果会自动保存在当前浏览器。</p></div>}
      </section>
    </main>
  );
}
