import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { readSessionToken } from "../lib/session.js";
import { chatFlowFor, buildRunBody } from "./chat-flows.js";
import { IpPosReport, type IpPosPayload } from "./ip-pos-report.js";
import { VidrevReport, isVidrevPayload, VIDREV_PREFILL_KEY, type VidrevPayload } from "./vidrev-report.js";
import { audioExtensionForMime, useVoiceInput, voiceTranscriptionFailureMessage } from "../components/chat/useVoiceInput.js";
import sitongAvatar from "../assets/sitong-beauty.png";
import { bundleSteps, coreSkuCode, isBundle, isComingSoon, zoneOfSku, type MarketplaceIndustry, type MarketplaceSku } from "./sku-model.js";
import { authHeaders, fetchMarketMe, guestToLogin, handleStaleSession, readJson, Topbar } from "./shell.js";

interface ChatItem {
  id: string;
  role: "ai" | "user";
  text: string;
  html?: boolean;
  /** ip-pos / vidrev 等有结构化契约的智能体会同时返回 payload，用于专用渲染。 */
  payload?: IpPosPayload | VidrevPayload;
}

/** 从视频复盘跳过来时带的「候选选题」预填；只在对应轮次自动填入一次。 */
interface ChatPrefill {
  sku: string;
  slotKey: string;
  value: string;
  note?: string;
}

export function MarketplaceAgentChatPage({ skuId }: { skuId: string }) {
  const [sku, setSku] = useState<MarketplaceSku | null>(null);
  const [all, setAll] = useState<MarketplaceSku[]>([]);
  const [industry, setIndustry] = useState<MarketplaceIndustry | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [awaitingSupplement, setAwaitingSupplement] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attachments, setAttachments] = useState<Array<{ kind: string; name: string; text?: string }>>([]);
  const [uploadNote, setUploadNote] = useState("");
  /** 拖拽悬停态：让「把文件拖进来」这件事在界面上看得见。 */
  const [dragActive, setDragActive] = useState(false);
  const [docxPrice, setDocxPrice] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  /**
   * PLAT-24：chat 页也要有顶栏（登录 / 钱包 / 主题）与「进页即检测登录态」。
   * 之前匿名用户能一路填完 4 步、点「确认生成」才撞 401，而错误提示让他去点的
   * 「右上角『未登录 · 点击登录』」在这个页面根本不存在（WorkBuddy QA 2026-09-12 三条 P1）。
   */
  const [balance, setBalance] = useState<number | null>(null);
  const [hasSession, setHasSession] = useState(() => Boolean(readSessionToken()));
  /** 最近一次成功交付的 requestId：作为「免费重做」的凭证。 */
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  /** 当前这份交付是否已经是免费重做产物（每单仅限免费重做 1 次）。 */
  const [freeRedoUsed, setFreeRedoUsed] = useState(false);
  /** 发起中的免费重做凭证；追问补充信息的续跑也要沿用，避免变成付费重跑。 */
  const redoOfRef = useRef<string | null>(null);
  /** 视频复盘「加入选题池」带过来的候选选题（一次性消费）。 */
  const [prefill, setPrefill] = useState<ChatPrefill | null>(null);
  const timerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [detail, catalog] = await Promise.all([
          fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}`)).then((r) => readJson<{ sku: MarketplaceSku; industry: MarketplaceIndustry | null }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setSku(detail.sku);
        setIndustry(detail.industry);
        setAll(catalog.skus);
      } catch {
        if (!cancelled) setSku(null);
      }
    })();
    return () => { cancelled = true; };
  }, [skuId]);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => {
        if (cancelled) return;
        setBalance(data ? data.creditBalance : null);
        // 服务端认账（拿到余额）就说明会话有效；被 `handleStaleSession` 清掉时会回落成未登录。
        if (data) setHasSession(true);
        else if (!readSessionToken()) setHasSession(false);
      })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);


  const bundle = sku ? isBundle(sku) : false;
  const steps = sku ? bundleSteps(sku, all) : [];
  const runSku = sku ? (bundle ? steps[0] ?? sku : sku) : sku;
  const soon = isComingSoon(runSku);
  const flow = runSku ? chatFlowFor(coreSkuCode(runSku.skuCode)) : undefined;
  /** 工单 2.1/2.3：视频复盘专属——未上传数据前展示导出指南，「增强提示词」改成一键填充标准请求。 */
  const isVidrev = coreSkuCode(runSku?.skuCode ?? skuId) === "vidrev";
  /** 公共平台对话页的语音输入：录音 → `/voice/transcribe`（受授权转写入口）→ 并入输入框。 */
  const voice = useVoiceInput({
    transcribe: transcribeVoiceBlob,
    onText: (text) => setInput((prev) => [prev.trim(), text].filter(Boolean).join("\n"))
  });
  const ovWelcome = runSku
    ? (industry?.ov?.[coreSkuCode(runSku.skuCode)]?.welcome as string | undefined) ?? ""
    : "";
  const welcome = ovWelcome || flow?.welcome || "";
  /** 同专区「选题」智能体：视频复盘第十章候选选题一键带入它。 */
  const topicSkuCode = runSku
    ? all.find((item) => item.skuCode === `${zoneOfSku(runSku.skuCode)}__topic`)?.skuCode ?? null
    : null;
  /**
   * PLAT-25B：chat 页浏览器 <title> 带上智能体名与专区名（多标签可区分、分享有识别度）；
   * 页内标题同步用「智能体名 · 专区名」，不再拼 `flow.name · agent.name` 的重复段。
   */
  useEffect(() => {
    if (runSku?.name) {
      document.title = industry?.title ? `${runSku.name} · ${industry.title}` : `${runSku.name} - 思潼AI 行业智能体平台`;
    }
  }, [runSku?.skuCode, runSku?.name, industry?.title]);


  useEffect(() => {
    if (!flow || soon) return;
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${flow.slots[0].label}**：${flow.slots[0].q}` }
    ]);
    setStep(0);

    setAnswers({});
    setInput("");
    setCost(null);
    setDone(false);
    setConfirmPending(false);
    setAwaitingSupplement(false);
    setElapsed(0);
    setLastRequestId(null);
    setFreeRedoUsed(false);
    redoOfRef.current = null;
    try {
      const rawPrefill = sessionStorage.getItem(VIDREV_PREFILL_KEY);
      sessionStorage.removeItem(VIDREV_PREFILL_KEY);
      const parsed = rawPrefill ? (JSON.parse(rawPrefill) as Partial<ChatPrefill>) : null;
      setPrefill(parsed?.sku && parsed.slotKey && parsed.value ? { sku: parsed.sku, slotKey: parsed.slotKey, value: parsed.value, note: parsed.note } : null);
    } catch {
      setPrefill(null);
    }
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }, [flow?.name, industry?.key, soon]);

  // 走到被预填的那一轮时，把候选选题放进输入框，用户可改可发。
  useEffect(() => {
    if (!flow || !prefill) return;
    if (coreSkuCode(runSku?.skuCode ?? skuId) !== prefill.sku) return;
    const index = flow.slots.findIndex((slot) => slot.key === prefill.slotKey);
    if (index < 0 || step !== index || input.trim()) return;
    setInput(prefill.value);
    if (prefill.note) setUploadNote(prefill.note);
  }, [step, prefill, flow, runSku?.skuCode, skuId, input]);

  useEffect(() => {
    void fetch(apiPath("/exports/docx/price"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { credits?: number } | null) => {
        if (data && typeof data.credits === "number") setDocxPrice(data.credits);
      })
      .catch(() => {});
  }, []);

  async function generateRun(finalAnswers: Record<string, string>) {
    if (!flow || !runSku || soon) return;
    setConfirmPending(false);
    setBusy(true);
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timeoutRef.current = window.setTimeout(() => {
      setBusy(false);
      setItems((prev) => [...prev, { id: `timeout${Date.now()}`, role: "ai", text: "生成超时（已超过 120 秒），可能是模型繁忙，请稍后重试。本次未扣积分。" }]);
      if (timerRef.current) window.clearInterval(timerRef.current);
    }, 150000);
    try {
      const redoOf = redoOfRef.current;
      const body: Record<string, unknown> = {
        // 视频复盘额外带 mode / platform / period / has_revenue_data 结构化入参，
        // 后端据此重算口径并校验（其余技能仍是纯文本需求单）。
        ...buildRunBody(coreSkuCode(runSku.skuCode), flow, finalAnswers),
        ...(redoOf ? { redoOf } : {})
      };
      // 附件必须真的进需求单：文本类附件内容拼在 input 末尾（接口上限 5 万字，这里再兜一次底），
      // 只记文件名等于让 AI 空手干活——那才是真正的「不支持上传」。
      const attachmentText = attachments
        .filter((item) => item.text)
        .map((item) => `【附件：${item.name}】\n${item.text}`)
        .join("\n\n");
      if (attachmentText) {
        const baseInput = typeof body.input === "string" ? body.input : "";
        body.input = `${baseInput}${baseInput ? "\n\n" : ""}${attachmentText}`.slice(0, 50_000);
      }
      const runResponse = await fetch(apiPath(`/market/skus/${encodeURIComponent(runSku.skuCode)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (handleStaleSession(runResponse.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次未扣积分。");
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        balance: number;
        needsInput?: boolean;
        payload?: IpPosPayload | VidrevPayload;
        requestId?: string;
        freeRedo?: boolean;
      }>(runResponse);
      if (result.needsInput) {
        setItems((prev) => [
          ...prev,
          { id: `clr${Date.now()}`, role: "ai", text: result.answer },
          { id: `clrq${Date.now()}`, role: "ai", text: "以上关键信息还需要你补充一下。直接把补充内容发给我，我会重新生成（本次不扣积分）。" }
        ]);
        setAwaitingSupplement(true);
        setDone(false);
        setCost(null);
        return;
      }
      setItems((prev) => [...prev, { id: "final", role: "ai", text: result.answer, html: true, payload: result.payload }]);
      setCost(result.consumedCredits);
      setDone(true);
      setAwaitingSupplement(false);
      // 记录本次交付凭证；免费重做产物本身不再享有重做机会。
      setLastRequestId(result.requestId ?? null);
      setFreeRedoUsed(Boolean(result.freeRedo));
      redoOfRef.current = null;
      if (result.freeRedo) {
        setItems((prev) => [
          ...prev,
          { id: `redo${Date.now()}`, role: "ai", text: "已按你的反馈免费重做一份（本次未扣积分）。每个付费交付仅限免费重做 1 次。" }
        ]);
      }
    } catch (reason) {
      // 免费重做被后端拒绝（额度用尽/凭证无效）时不能继续挂着凭证，避免下一次误判为免费。
      redoOfRef.current = null;
      setItems((prev) => [...prev, { id: "err", role: "ai", text: reason instanceof Error ? reason.message : "生成失败" }]);
    } finally {
      setBusy(false);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    }
  }

  async function send() {
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    await submitAnswer(value);
  }

  /** 快捷选项按钮：值直接来自 ChatSlot.choices，避免用户自由输入被后端误判。 */
  async function sendChoice(value: string) {
    if (busy) return;
    setInput("");
    await submitAnswer(value);
  }

  async function submitAnswer(value: string) {
    if (!flow || !runSku || soon || busy) return;
    if (awaitingSupplement) {
      setItems((prev) => [...prev, { id: `su${Date.now()}`, role: "user", text: value }]);
      await generateRun({ ...answers, __supplement: value });
      return;
    }

    const nextAnswers = { ...answers, [flow.slots[step].key]: value };
    setAnswers(nextAnswers);
    // 附件要出现在用户自己那条消息里，否则用户不知道文件到底有没有被带上。
    const attachmentSuffix = attachments.length > 0
      ? `\n（附件：${attachments.map((item) => item.name).join("、")}）`
      : "";
    setItems((prev) => [...prev, { id: `u${step}`, role: "user", text: value + attachmentSuffix }]);

    if (step < flow.slots.length - 1) {
      const next = step + 1;
      setStep(next);
      setItems((prev) => [...prev, { id: `q${next}`, role: "ai", text: `**${flow.slots[next].label}**：${flow.slots[next].q}` }]);
      return;
    }

    // 5 项收齐后先确认需求再生成，避免「瞎输入」直接产出。
    setConfirmPending(true);
  }

  function confirmBrief() {
    setConfirmPending(false);
    void generateRun(answers);
  }

  function editBrief() {
    if (!flow) return;
    setConfirmPending(false);
    setAnswers({});
    setStep(0);
    setItems((prev) => [...prev, { id: `editq${Date.now()}`, role: "ai", text: `好的，我们重新填一遍。**${flow.slots[0].label}**：${flow.slots[0].q}` }]);
  }

  /** 按结果付费兜底：不满意可免费重做一次，不重复扣积分。 */
  function redoDelivery() {
    if (!flow || !runSku || busy) return;
    if (!lastRequestId || freeRedoUsed) return;
    redoOfRef.current = lastRequestId;
    setItems((prev) => [
      ...prev,
      { id: `redou${Date.now()}`, role: "user", text: "这份交付我不太满意，请免费重做一次（不扣积分）。" }
    ]);
    void generateRun(answers);
  }

  function restart() {
    if (!flow) return;
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${flow.slots[0].label}**：${flow.slots[0].q}` }
    ]);
    setStep(0);
    setAnswers({});
    setInput("");
    setCost(null);
    setDone(false);
    setConfirmPending(false);
    setAwaitingSupplement(false);
    setElapsed(0);
    setLastRequestId(null);
    setFreeRedoUsed(false);
    redoOfRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }

  function openFile(kind: "file" | "video") {
    fileRef.current?.setAttribute("accept", kind === "video" ? "video/*" : ".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv,.txt,.md");
    fileRef.current?.setAttribute("data-kind", kind);
    fileRef.current?.click();
  }

  /** 会被真正读进需求里的文本类附件（视频复盘的后台导出 CSV 就是走这条）。 */
  const TEXT_ATTACHMENT_PATTERN = /\.(txt|md|csv|tsv|json|log|srt)$/i;
  const MAX_ATTACHMENT_TEXT = 20_000;

  /**
   * 统一的附件入口：按钮选择、**拖拽进对话框**、以及粘贴文件都走这里。
   *
   * 口径（2026-09-13 用户要求「支持文件直接拖拽进浏览器的对话框」）：
   * - 文本类（txt/md/csv/tsv/json/log/srt）直接读内容，发请求时拼进需求单，智能体真的能看到；
   * - 其它类型（PDF/Word/Excel/图片/视频）当前只记录文件名并**明确告诉用户**要粘贴关键内容，
   *   不做「假装已解析」。
   */
  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    const next: Array<{ kind: string; name: string; text?: string }> = [];
    const notes: string[] = [];
    for (const file of files) {
      const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name);
      const kind = isVideo ? "video" : "file";
      if (!isVideo && TEXT_ATTACHMENT_PATTERN.test(file.name)) {
        try {
          const raw = await file.text();
          const truncated = raw.length > MAX_ATTACHMENT_TEXT;
          next.push({ kind, name: file.name, text: raw.slice(0, MAX_ATTACHMENT_TEXT) });
          notes.push(`已读取「${file.name}」的内容${truncated ? `（超过 ${MAX_ATTACHMENT_TEXT} 字，已截断）` : ""}`);
        } catch {
          next.push({ kind, name: file.name });
          notes.push(`无法读取「${file.name}」，请把关键内容粘贴到对话框`);
        }
      } else if (isVideo) {
        next.push({ kind, name: file.name });
        notes.push(`已添加视频「${file.name}」：视频内容暂不能自动解析，请用文字说明要点`);
      } else {
        next.push({ kind, name: file.name });
        notes.push(`已添加「${file.name}」：这类文件暂不能自动读取，请把关键内容（或另存为 CSV/TXT）粘贴/拖进来`);
      }
    }
    setAttachments((prev) => [...prev, ...next]);
    setUploadNote(notes.join("；"));
  }

  function onFileChange() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) return;
    void addFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  function enhanceInput() {
    if (!flow) return;
    const base = input.trim() || "（待补充）";
    const enhanced = `【${runSku?.name ?? flow.name}需求 · 增强】\n• 业务背景：${base}\n• 关键目标：\n• 已有数据 / 素材：${attachments.map((a) => a.name).join("、") || "（无）"}\n• 最想解决的问题：\n\n请按「${flow.name}」方法论补全维度后输出。`;
    setInput(enhanced);
    setUploadNote("已按该方法论增强，请在原有基础上补充缺口后发送。");
  }

  /**
   * 工单 2.3：视频复盘的「增强提示词」改成一键填充标准请求——
   * 没上传文件就先提示去上传；上传了就把「文件名 / 平台 / 周期」拼成一条标准请求填进输入框。
   */
  function fillVidrevStandardRequest() {
    const file = attachments[0];
    if (!file) {
      setUploadNote("请先把平台后台导出的数据表格（CSV / Excel）拖进对话框上传，再点「一键填充标准请求」。");
      return;
    }
    const platform = (answers.platform ?? "").trim() || "抖音";
    const periodText = (answers.period ?? "").trim() || "近30天";
    setInput(`我已上传 ${file.name}，平台是 ${platform}，统计周期 ${periodText}，请做深度复盘。`);
    setUploadNote("已按标准请求填充，直接发送即可。");
  }

  /**
   * 公共平台对话页的语音输入转写：把录音 blob 传到 `/voice/transcribe`
   * （PLAT-33 的受授权语音入口，与智能体工作台同一通道），拿回文字；
   * 失败时给一句人话，绝不静默。
   */
  async function transcribeVoiceBlob(blob: Blob): Promise<{ text: string; message?: string }> {
    const mimeType = blob.type || "audio/webm";
    const file = new File([blob], `语音输入-${Date.now()}.${audioExtensionForMime(mimeType)}`, { type: mimeType });
    const formData = new FormData();
    formData.append("file", file, file.name);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(apiPath("/voice/transcribe"), {
        method: "POST",
        // multipart 的 Content-Type 由浏览器带 boundary 生成，这里只带鉴权头。
        headers: authHeaders(),
        body: formData,
        signal: controller.signal
      });
    } catch (error) {
      return {
        text: "",
        message: (error as { name?: string }).name === "AbortError"
          ? "语音转写超过60秒，已自动停止；本次未扣积分，请缩短录音或直接用文字输入。"
          : "语音转写服务暂时不可用，本次未扣积分。可以直接输入文字或稍后重试。"
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (!response.ok) {
      let detail = `语音服务请求失败（${response.status}）`;
      try {
        const payload = (await response.json()) as { message?: string; error?: string };
        detail = payload.message?.trim() || payload.error?.trim() || detail;
      } catch {
        // 服务端没返回 JSON 时保留状态码文案。
      }
      return { text: "", message: detail };
    }
    const analysis = (await response.json()) as { configured?: boolean; transcript?: string; warnings?: string[] };
    const text = analysis.transcript?.trim() ?? "";
    return { text, message: text ? "" : voiceTranscriptionFailureMessage(analysis) };
  }

  async function downloadWord() {
    if (exporting) return;
    const finalItem = [...items].reverse().find((item) => item.role === "ai" && item.html);
    const md = finalItem?.text ?? "";
    if (!md.trim()) return;
    const title = `${runSku?.name ?? flow?.name ?? "思潼AI"}交付`;
    setExporting(true);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ title, content: md })
      });
      if (response.status === 402) {
        const data = (await response.json().catch(() => ({}))) as { message?: string; required?: number };
        const required = data.required ?? docxPrice ?? 0;
        window.alert(`${data.message ?? "当前积分不足，无法导出。"}本次导出需 ${required} 积分，请先充值。`);
        return;
      }
      if (handleStaleSession(response.status)) {
        window.alert("登录状态已失效，本地登录信息已清除。请重新登录后再导出；本次未扣积分。");
        return;
      }
      const created = await readJson<{ downloadUrl?: string; filename?: string }>(response);
      if (!created.downloadUrl) throw new Error("Word 生成失败，请稍后再试。");
      const fileResponse = await fetch(apiPath(created.downloadUrl), { headers: authHeaders(), cache: "no-store" });
      if (!fileResponse.ok) throw new Error("Word 下载失败，请重新导出。");
      const blob = await fileResponse.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = created.filename || `${title}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Word 生成失败，请稍后再试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="app-wrap chat-page">
      <Topbar active="chat" balance={balance} onNavigate={(path) => { window.location.href = getAppPath(path); }} />

      {soon ? (
        <section className="view view-chat chat-page-body">
          <div className="chat-page-shell">
            <div className="chat-page-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="back" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情</button>
                <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
                <span className="chat-page-title">{sku?.name ?? "智能体"} · 开发中</span>
              </div>
            </div>
            <div className="zone-soon" style={{ margin: "0 16px" }}>
              🚧 <b>该智能体内核还在开发中</b>，对话与生成暂未开放，也不会扣积分。<br />
              上线后直接用统一积分钱包按次使用，不需要重复充值；可以先回详情页看「输出参考案例」了解交付物长什么样。
            </div>
            <div className="chat-page-composer">
              <button className="btn ghost block" style={{ marginBottom: 10 }} onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情 · 看输出参考案例</button>
              <button className="btn primary block" onClick={() => { window.location.href = getAppPath("/agents"); }}>去货架挑已上线的智能体</button>
            </div>
          </div>
        </section>
      ) : !flow ? (
        <div className="loading" style={{ padding: 48 }}>正在加载对话…</div>
      ) : !hasSession ? (
        <section className="view view-chat chat-page-body">
          <div className="chat-page-shell">
            <div className="chat-page-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="back" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情</button>
                <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
                <span className="chat-page-title">{runSku?.name ?? "智能体"} · 需登录</span>
              </div>
            </div>
            <div className="zone-soon" style={{ margin: "0 16px" }}>
                🔒 <b>这个智能体要登录后才能使用</b>：结果存进你自己的账号，方便回看，也方便不满意时免费重做一次。<br />
              现在不用填任何信息——登录后自动回到这一页，我再带你走那 4 步。
            </div>
            <div className="chat-page-composer">
              <button className="btn primary block" onClick={() => guestToLogin(`/agent/${encodeURIComponent(skuId)}/chat`)}>🔒 立即登录 · 用「{runSku?.name ?? "这个智能体"}」</button>
              <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>先看它交付什么 · 输出参考案例</button>
            </div>
          </div>
        </section>
      ) : (
        <section className="view view-chat chat-page-body">
          <div
            className="chat-page-shell"
            style={{ position: "relative" }}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (!next || !event.currentTarget.contains(next)) setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void addFiles(Array.from(event.dataTransfer?.files ?? []));
            }}
          >
          <div className="chat-page-head">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="back" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情</button>
              <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
              <span className="chat-page-title">{runSku?.name ?? flow.name ?? "智能体"}{industry?.title ? ` · ${industry.title}` : ""}</span>
            </div>
            {cost !== null && <span className="chat-page-cost">本次消耗 {cost} 积分 · 双桶钱包</span>}
          </div>
          {isVidrev && !done && !soon && (
            <details className="chat-vidrev-guide" open>
              <summary>📥 视频数据导出指南（不知道数据从哪来、怎么传，先看这里）</summary>
              <div className="chat-vidrev-guide-body">
                <p>请先从你发视频的平台后台导出近 <b>30 天</b>数据表格（CSV / Excel），然后直接拖到这里上传。</p>
                <h4>视频号</h4>
                <ol>
                  <li>登录视频号助手：<a href="https://channels.weixin.qq.com/login.html" target="_blank" rel="noreferrer">channels.weixin.qq.com/login.html</a>（扫码登录）</li>
                  <li>进入：数据中心 → 视频数据 → 单篇视频</li>
                  <li>选择日期范围（建议「近 30 天」）→ 下载表格</li>
                  <li>把下载好的表格拖到对话框上传，输入「复盘」</li>
                </ol>
                <h4>抖音</h4>
                <ol>
                  <li>登录抖音创作者中心：<a href="https://creator.douyin.com/" target="_blank" rel="noreferrer">creator.douyin.com</a>（扫码登录）</li>
                  <li>进入：数据中心 → 作品数据 → 近 30 天 → 导出数据</li>
                  <li>把下载好的表格拖到对话框上传，输入「复盘」</li>
                </ol>
                <h4>上传后我会做什么</h4>
                <ul>
                  <li>自动识别平台字段，缺字段会告诉你哪些数据缺失、是否影响结论</li>
                  <li>一次只复盘一个平台；想换平台请重新上传对应表格</li>
                  <li>建议 5–50 条视频，太少趋势不可信，太多建议拆周期</li>
                </ul>
              </div>
            </details>
          )}
          {dragActive && (
            <div
              className="chat-hint"
              style={{
                margin: "0 0 10px",
                padding: "8px 12px",
                borderRadius: 12,
                border: "1px dashed var(--accent2)",
                background: "rgba(255,138,61,.14)",
                color: "var(--accent2)"
              }}
            >
              松手即可把文件添加到对话框（文本类 CSV / TXT / MD / JSON 会直接读进需求）
            </div>
          )}
          {!done && flow.slots.length > 1 && (
            <div className="chat-progress">
              {flow.slots.map((slot, idx) => {
                const answeredCount = items.filter((it) => it.role === "user").length;
                const state = idx < answeredCount ? "done" : idx === step ? "cur" : "todo";
                return <span key={slot.key} className={`chat-prog ${state}`}><i>{state === "done" ? "✓" : idx + 1}</i><b>{slot.label.replace(/第\d+\s*轮·?/g, "")}</b></span>;
              })}
            </div>
          )}
          <div className="chat-page-list">
            {items.map((item) => (
              <div key={item.id} className={`chat-row ${item.role}`}>
                {item.role === "ai" && <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />}
                <div className={`chat-bubble ${item.role}`}>
                  {item.role === "ai" ? (
                    <>
                      <span className="chat-bubble-label">思潼 · {sku?.name ?? "智能体"}</span>
                      {isVidrevPayload(item.payload) ? (
                        <VidrevReport payload={item.payload} renderMarkdown={renderMarkdownHtml} topicSkuCode={topicSkuCode} reportTitle={runSku?.name} />
                      ) : item.payload?.sections ? (
                        <IpPosReport payload={item.payload} renderMarkdown={renderMarkdownHtml} />
                      ) : (
                        <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: item.html ? renderMarkdownHtml(item.text) : renderInline(item.text) }} />
                      )}
                    </>
                  ) : (
                    <>
                      <span className="chat-bubble-label">你</span>
                      <div style={{ color: "inherit", fontSize: 14, lineHeight: 1.6 }}>{item.text}</div>
                    </>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="chat-row ai"><img className="chat-avatar-img" src={sitongAvatar} alt="思潼" /><div className="chat-bubble ai"><span style={{ color: "var(--muted)" }}>AI 正在按方法论生成交付… 已用 {elapsed}s</span></div></div>}
            {confirmPending && !busy && flow && (
              <div className="chat-row ai">
                <img className="chat-avatar-img" src={sitongAvatar} alt="思潼" />
                <div className="chat-bubble ai" style={{ maxWidth: "84%" }}>
                  <span className="chat-bubble-label">思潼 · {sku?.name ?? "智能体"}</span>
                  <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }}>
                <p><b>请先确认需求</b>：确认后我按下面这套信息生成交付。如有不对，点「修改」重填。</p>
                    <table className="report-table">
                      <tbody>
                        {flow.slots.map((slot) => (
                          <tr key={slot.key}>
                            <td style={{ width: 150, color: "var(--muted)" }}>{slot.label}</td>
                            <td>{answers[slot.key] || "（未填）"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button className="btn primary" onClick={confirmBrief}>✓ 确认，开始生成</button>
                    <button className="btn ghost" onClick={editBrief}>✎ 修改</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {done && <div className="chat-donebar">✓ 已生成结果 · 可继续用文字追问迭代，或上传新资料重做</div>}

          {done ? (
            <div className="chat-page-composer">
              {freeRedoUsed ? (
                <div className="chat-hint" style={{ marginBottom: 10 }}>
                本单的免费重做机会已用完；如需再生成一次，可点「重新开始」。
                </div>
              ) : (
                <button className="btn ghost block" style={{ marginBottom: 10 }} disabled={busy || !lastRequestId} onClick={redoDelivery}>
                  😕 不满意 · 免费重做一次（不扣积分）
                </button>
              )}
              <button className="btn ghost block" style={{ marginBottom: 10 }} disabled={exporting} onClick={downloadWord}>
                {exporting ? "正在导出…" : `⬇ 下载精美 Word${docxPrice ? ` · ${docxPrice} 积分` : ""}`}
              </button>
              <button className="btn primary block" onClick={restart}>再问一次 / 重新开始</button>
            </div>
          ) : confirmPending ? (
            <div className="chat-page-composer">
              <div className="chat-hint">请在上方确认需求，或点「修改」重填后再生成。</div>
            </div>
          ) : (
            <div className="chat-page-composer">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button className="btn ghost sm" onClick={() => openFile("file")}>📎 文件</button>
                <button className="btn ghost sm" onClick={() => openFile("video")}>🎬 视频</button>
                <button
                  className={`btn ghost sm${voice.recording ? " voice-recording" : ""}`}
                  type="button"
                  onClick={voice.toggle}
                  disabled={busy || voice.busy}
                  title={voice.recording ? "结束录音并转成文字" : "语音输入：点一下开始说话"}
                >
                  {voice.recording ? "⏹ 结束录音" : "🎤 语音"}
                </button>
                {isVidrev
                  ? <button className="btn ghost sm" onClick={fillVidrevStandardRequest}>✨ 一键填充标准请求</button>
                  : <button className="btn ghost sm" onClick={enhanceInput}>✨ 增强提示词</button>}
                <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onFileChange} />
              </div>
              <div>
              {attachments.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {attachments.map((a, i) => (
                    <span key={i} style={{ background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "var(--text)" }}>
                      {a.kind === "video" ? "🎬" : "📎"} {a.name}{a.text ? "（已读取）" : ""}
                      <button
                        type="button"
                        aria-label={`移除 ${a.name}`}
                        onClick={() => setAttachments((prev) => prev.filter((_, index) => index !== i))}
                        style={{ marginLeft: 6, background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {uploadNote && <div className="chat-hint" style={{ color: "var(--accent2)", marginBottom: 8 }}>{uploadNote}</div>}
              {voice.message && (
                <div className="chat-hint" style={{ color: voice.recording ? "var(--accent2)" : "var(--muted)", marginBottom: 8 }}>
                  {voice.message}
                </div>
              )}
              {!awaitingSupplement && (flow.slots[step]?.choices?.length ?? 0) > 0 && (
                <div className="chat-choices">
                  {flow.slots[step].choices?.map((choice) => (
                    <button key={choice} type="button" className="chat-choice" disabled={busy} onClick={() => void sendChoice(choice)}>{choice}</button>
                  ))}
                </div>
              )}
              <textarea
                value={input}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData?.files ?? []);
                  if (files.length > 0) {
                    event.preventDefault();
                    void addFiles(files);
                  }
                }}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={awaitingSupplement ? "补充缺失的信息，发送后重新生成（不扣积分）" : "在这里输入，AI 主动引导你逐步补全"}
                style={{ width: "100%", background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", color: "var(--text)", fontSize: 14, resize: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <span style={{ color: "var(--muted-2)", fontSize: 12 }}>Enter 发送 · Shift+Enter 换行</span>
                <button className="btn primary" style={{ marginLeft: "auto" }} disabled={busy || !input.trim()} onClick={() => void send()}>
                  {busy ? "正在生成…" : awaitingSupplement ? "重新生成" : step < flow.slots.length - 1 ? "下一步" : "确认需求"}
                </button>
              </div>
              </div>
              <div className="chat-hint">AI 会按本智能体技能逻辑<b>主动提问，引导你补全信息</b>，补全后产出结果 · <b>可把文件直接拖进这里</b>（文本类 CSV/TXT/MD/JSON 会读进需求；PDF/Word/Excel/图片/视频暂只记文件名）</div>
            </div>
          )}
          </div>
        </section>
      )}
    </main>
  );
}

function renderInline(text: string): string {
  // 兼容原型里用 **加粗** 的简单标记。
  return text.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function renderMarkdownHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // 代码块
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-pre">${buf.join("\n")}</pre>`);
      continue;
    }

    // 表格
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (i === start + 1 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
          i++;
          continue;
        }
        rows.push(cells);
        i++;
      }
      if (rows.length) {
        out.push("<table class=\"report-table\"><thead><tr>" + rows[0].map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + rows.slice(1).map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
      }
      continue;
    }

    // 水平分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { out.push("<hr/>"); i++; continue; }

    // 标题
    if (/^#{1,3}\s/.test(trimmed)) {
      out.push(`<h4>${inline(trimmed.replace(/^#{1,3}\s*/, ""))}</h4>`);
      i++; continue;
    }

    // 独立加粗段作为小节标题（如 **一、选题策划**）
    const loneBold = /^\*\*(.+?)\*\*\s*$/.exec(trimmed);
    if (loneBold) { out.push(`<h4>${inline(loneBold[1])}</h4>`); i++; continue; }

    // 引用（> 行合并成一段）
    if (trimmed.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(inline(lines[i].trim().replace(/^>\s?/, "")));
        i++;
      }
      out.push(`<blockquote>${buf.join("<br/>")}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s*/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.、]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.、]\s/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+[.、]\s*/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 普通段落（访谈话术的问答单独上色）
    const isAsk = /^\*{0,2}【问/.test(trimmed);
    const isAns = /^\*{0,2}【答/.test(trimmed);
    out.push(isAsk ? `<p class="md-ask">${inline(trimmed)}</p>` : isAns ? `<p class="md-ans">${inline(trimmed)}</p>` : `<p>${inline(trimmed)}</p>`);
    i++;
  }
  return out.join("\n");
}

function inline(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s])_([^_]+)_(?=[\s,.!?，。！？）】]|$)/g, "$1<i>$2</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
