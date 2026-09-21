import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { readSessionIdentity, readSessionToken } from "../lib/session.js";
import { chatFlowFor, effectiveSlots, buildRunBody, normalizeVidrevPlatform } from "./chat-flows.js";
import { IpPosReport, type IpPosPayload } from "./ip-pos-report.js";
import { VidrevReport, isVidrevPayload, VIDREV_PREFILL_KEY, type VidrevPayload } from "./vidrev-report.js";
import { audioExtensionForMime, useVoiceInput, voiceTranscriptionFailureMessage } from "../components/chat/useVoiceInput.js";
import sitongAvatar from "../assets/sitong-beauty.png";
import { employeePersonaLabel } from "./employee-names.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import { bundleSteps, coreSkuCode, isBundle, isComingSoon, zoneOfSku, type MarketplaceIndustry, type MarketplaceSku } from "./sku-model.js";
import { authHeaders, fetchMarketMe, guestToLogin, handleStaleSession, readJson, Topbar } from "./shell.js";
import { readAttachmentText } from "./text-attachment.js";
import { isRestartCommand } from "./chat-commands.js";

/**
 * 视频复盘：还没拿到数据表时的回复（工单 2026-09-13 §四「未传文件时输入复盘」）。
 * 这里刻意不调用后端、不消耗积分，只把「数据从哪来、怎么传」讲清楚。
 */
const VIDREV_NO_DATA_GUIDE = [
  "**先别急——我还没拿到你的数据。** 没有数据我只能编，我不会编。",
  "",
  "📥 数据导出指南（上方卡片也能随时展开）",
  "- **视频号**：登录视频号助手 https://channels.weixin.qq.com/login.html → 数据中心 → 视频数据 → 单篇视频 → 选「近 30 天」→ 下载表格",
  "- **抖音**：登录抖音创作者中心 https://creator.douyin.com/ → 数据中心 → 作品数据 → 近 30 天 → 导出数据",
  "",
  "把下载好的 **CSV 或 Excel** 直接拖进对话框上传，再跟我说「复盘」即可。（本次没有调用模型、不消耗积分）"
].join("\n");

interface ChatItem {
  id: string;
  role: "ai" | "user";
  text: string;
  html?: boolean;
  /** ip-pos / vidrev 等有结构化契约的智能体会同时返回 payload，用于专用渲染。 */
  payload?: IpPosPayload | VidrevPayload;
  /**
   * 2026-09-16（WorkBuddy 验收 P2 + 用户现场「充值完回来还得重填」）：
   * 余额不足时不能让客户自己去顶栏找充值入口——这里在气泡里给一个**带返回路径**的动作按钮，
   * 充完（或不充）点一下就能回到这个智能体，本机留存的 5 项输入原样还在。
   */
  action?: { label: string; href: string };
}

/** 从视频复盘跳过来时带的「候选选题」预填；只在对应轮次自动填入一次。 */
interface ChatPrefill {
  sku: string;
  slotKey: string;
  value: string;
  note?: string;
}

/**
 * 包月订阅视图（用户 2026-09-17 拍板：有的智能体按次卖、有的按消耗卖、有的支持按月订阅）。
 *
 * 文案智能体＝4000 积分/月、每天 5 条，**订阅期内不再扣积分**。
 * 所以「确认生成」前必须说清这次扣不扣分，交付后也要说明白是包月覆盖而不是漏扣。
 * 字段与 `apps/api/src/routes/marketplace.ts` 的 `accessStateFor()` 一一对应。
 */
interface SubscriptionView {
  subscribed: boolean;
  dailyQuota: number | null;
  usedToday: number;
  remaining: number | null;
  exhausted: boolean;
  endDate?: string | null;
  /** 未订阅时的包月报价：让用户自己选「按次」还是「包月」。 */
  offer?: { credits: number; dailyQuota: number | null; quota?: string | null; periodDays: number } | null;
}

/** 把 `/market/skus/:skuId/access` 的返回压成前端视图；没有包月能力就返回 null（界面保持原样）。 */
function toSubscriptionView(access: {
  subscription?: {
    endDate?: string | null;
    dailyQuota?: number | null;
    usedToday?: number;
    remaining?: number | null;
    exhausted?: boolean;
  } | null;
  subscriptionOffer?: {
    credits: number;
    dailyQuota?: number | null;
    quota?: string | null;
    periodDays: number;
  } | null;
} | null): SubscriptionView | null {
  if (!access) return null;
  const offer = access.subscriptionOffer
    ? {
        credits: access.subscriptionOffer.credits,
        dailyQuota: access.subscriptionOffer.dailyQuota ?? null,
        quota: access.subscriptionOffer.quota ?? null,
        periodDays: access.subscriptionOffer.periodDays
      }
    : null;
  const sub = access.subscription;
  if (sub) {
    const dailyQuota = sub.dailyQuota ?? offer?.dailyQuota ?? null;
    const usedToday = sub.usedToday ?? 0;
    const remaining = dailyQuota == null ? null : Math.max(0, sub.remaining ?? dailyQuota - usedToday);
    return {
      subscribed: true,
      dailyQuota,
      usedToday,
      remaining,
      exhausted: Boolean(sub.exhausted ?? (dailyQuota != null && usedToday >= dailyQuota)),
      endDate: sub.endDate ?? null,
      offer
    };
  }
  if (!offer) return null;
  return {
    subscribed: false,
    dailyQuota: offer.dailyQuota,
    usedToday: 0,
    remaining: null,
    exhausted: false,
    endDate: null,
    offer
  };
}

/** 包月按钮上的统一说法：套餐价 + 每日条数。 */
function subscriptionOfferText(offer: { credits: number; dailyQuota: number | null }): string {
  const quota = offer.dailyQuota == null ? "不限次数" : `每天 ${offer.dailyQuota} 条`;
  return `${offer.credits} 积分/月 · ${quota}（订阅期内不扣积分）`;
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
   * 包月订阅状态（用户 2026-09-17 拍板）：文案智能体 4000 积分/月、每天 5 条，订阅期内不再扣积分。
   *
   * 所以「确认生成」前必须说清这次**扣不扣积分**：订阅中不能说「预计消耗约 N 积分」，
   * 交付后也不该让用户以为漏扣了。
   */
  const [subscriptionView, setSubscriptionView] = useState<SubscriptionView | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  /**
   * PLAT-24：chat 页也要有顶栏（登录 / 钱包 / 主题）与「进页即检测登录态」。
   * 之前匿名用户能一路填完 4 步、点「确认生成」才撞 401，而错误提示让他去点的
   * 「右上角『未登录 · 点击登录』」在这个页面根本不存在（WorkBuddy QA 2026-09-12 三条 P1）。
   */
  const [balance, setBalance] = useState<number | null>(null);
  const [hasSession, setHasSession] = useState(() => Boolean(readSessionToken()));
  /** 最近一次成功交付的 requestId（免费重做已于 2026-09-15 下线，仅用于交付状态判断）。 */
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
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
        /**
         * 包月状态单独拉一次：它依赖登录态，且失败（未登录 / 网络抖动 / 老后端没有这个字段）
         * 不能影响对话页主流程——拿不到就按「没有包月」渲染，界面与改动前完全一致。
         */
        const access = await fetch(apiPath(`/market/skus/${encodeURIComponent(detail.sku.skuCode)}/access`), {
          headers: authHeaders()
        })
          .then((r) => readJson<Parameters<typeof toSubscriptionView>[0]>(r))
          .catch(() => null);
        if (cancelled) return;
        setSubscriptionView(toSubscriptionView(access));
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
  /**
   * 当前实际会走的槽位（按已填答案做场景分流）。
   * 直播话术先选「带货 / 团购」还是「招商」，选完只走对应那条线的后续提问；
   * 其余没有条件槽位的技能，这里等价于 `slots`。
   */
  const slots = flow ? effectiveSlots(flow, answers) : [];
  /** 工单 2.1/2.3：视频复盘专属——未上传数据前展示导出指南，「增强提示词」改成一键填充标准请求。 */
  const isVidrev = coreSkuCode(runSku?.skuCode ?? skuId) === "vidrev";
  /** 直播话术：交付为几万字 · 2 小时完整逐字稿，生成耗时明显长于普通货架技能，需单独提示耐心等待。 */
  const isLiveScript = coreSkuCode(runSku?.skuCode ?? skuId) === "livescript";
  /** 这一轮是否已经动过（填过 / 传过 / 生成过）：决定「↺ 重新开始」按钮是否常驻。 */
  const hasProgress = step > 0 || Object.keys(answers).length > 0 || attachments.length > 0 || done || awaitingSupplement || confirmPending;
  /** 公共平台对话页的语音输入：录音 → `/voice/transcribe`（受授权转写入口）→ 并入输入框。 */
  const voice = useVoiceInput({
    transcribe: transcribeVoiceBlob,
    onText: (text) => setInput((prev) => [prev.trim(), text].filter(Boolean).join("\n"))
  });
  const ovWelcome = runSku
    ? (industry?.ov?.[coreSkuCode(runSku.skuCode)]?.welcome as string | undefined) ?? ""
    : "";
  const welcome = ovWelcome || flow?.welcome || "";
  /**
   * 数字员工人名（用户 2026-09-21：对话页标题与头像标签也要带名字，不能都叫「思潼」）。
   *
   * 取展示用 SKU（`sku`）而不是 `runSku`：套装 `ip-pack` 的 runSku 是链路里的第一步，
   * 按它取名字会把「IP 增长套装」显示成「沈定」，而套装是 7 大能力的入口、不是某一个人。
   */
  const personaLabel = employeePersonaLabel(sku?.skuCode ?? skuId);
  /**
   * 数字员工形象（用户 2026-09-21：对话页头像要是**这个数字员工自己的形象**，不能一律用品牌形象「思潼」）。
   *
   * 取形象的 SKU 与取名一致（展示用 `sku`）：套装 `ip-pack` 没有对应员工，回退品牌形象「思潼」。
   */
  const personaAvatar = employeeAvatarPath(sku?.skuCode ?? skuId) ?? sitongAvatar;
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
      document.title = industry?.title ? `${personaLabel} · ${runSku.name} · ${industry.title}` : `${personaLabel} · ${runSku.name} - 思潼AI 行业智能体平台`;
    }
  }, [runSku?.skuCode, runSku?.name, industry?.title, personaLabel]);

  /** 每次对话/进度变化都把本机留存写回（退出再进来能接着看，也能重新下载已付费的报告）。 */
  useEffect(() => {
    if (!runSku?.skuCode || soon || items.length === 0) return;
    try {
      localStorage.setItem(`sitong_chat_${runSku.skuCode}`, JSON.stringify({
        // 指纹用**稳定身份**（tenantId:userId），不是 token 末 8 位——重新登录/会话重建不该丢草稿。
        fp: readSessionIdentity(),
        items,
        answers,
        step,
        done,
        cost,
        savedAt: Date.now()
      }));
    } catch {
      /* 存储不可用（隐私模式/超配额）：不影响主流程 */
    }
  }, [runSku?.skuCode, soon, items, answers, step, done, cost]);


  useEffect(() => {
    if (!flow || soon) return;
    /**
     * 2026-09-16 客户现场（汽配信息网）：客户**退出页面再进来，填过的信息和已交付的报告全没了**，
     * 连付过积分的那份交付物也找不回来。这里的处理是**存在客户本机**（localStorage），
     * 不落我们的服务器（沿用「客户内容不落库」的口径）：
       *   - 记录带一个**稳定身份指纹**（会话 JWT 里的 tenantId:userId）：换账号/换人自动丢弃，避免串数据；
       *     不能用 token 末 8 位——token 被重新签发时同一个人也会被判成换了人（2026-09-16 真机复现）；
     *   - 只有第一次打开这个智能体才用欢迎语初始化，之后恢复上次的对话与交付物；
     *   - 点「再问一次 / 重新开始」= 显式清空本机留存。
     */
    try {
      const raw = localStorage.getItem(`sitong_chat_${runSku?.skuCode ?? ""}`);
      if (raw) {
        const saved = JSON.parse(raw) as {
          fp?: string;
          items?: ChatItem[];
          answers?: Record<string, string>;
          step?: number;
          done?: boolean;
          cost?: number | null;
        };
        if (saved?.fp && saved.fp === readSessionIdentity() && Array.isArray(saved.items) && saved.items.length > 0) {
          setItems(saved.items);
          const restoredAnswers = saved.answers ?? {};
          const restoredStep = typeof saved.step === "number" ? saved.step : 0;
          setAnswers(restoredAnswers);
          setStep(restoredStep);
          setDone(Boolean(saved.done));
          setCost(typeof saved.cost === "number" ? saved.cost : null);
          setInput("");
          setConfirmPending(false);
          setAwaitingSupplement(false);
          setElapsed(0);
          setLastRequestId(null);
          /**
           * 本机留存**不含附件正文**（附件只在内存里）。视频复盘回到「数据」这一轮时，
           * 历史里明明写着「（附件：xxx.csv）」，但附件其实已经不在了——不说明白，
           * 用户再发一次「复盘」只会收到「我还没拿到你的数据」（2026-09-17 现场就是这么撞上的）。
           */
          if (isVidrev && slots[restoredStep]?.key === "data") {
            setUploadNote("已恢复上次的对话记录。上传的文件不会保存在浏览器里，请把数据表格重新拖进来，再发「复盘」；想清空重来就打「重新开始」。");
          }
          return;
        }
      }
    } catch {
      // 隐私模式 / 存储被禁用：按新会话处理，不影响主流程。
    }
    /**
     * 本机没有留存（换了手机 / 清了浏览器 / 换了设备）时，问服务端要**7 天内已付费的交付物**。
     * 用户 2026-09-16：客户关了页面就再也拿不回自己的报告，只能退款——这才是真正的兜底。
     */
    if (runSku?.skuCode && readSessionToken()) {
      void fetch(apiPath(`/market/me/deliverables?skuCode=${encodeURIComponent(runSku.skuCode)}`), {
        headers: authHeaders(),
        cache: "no-store"
      })
        .then((response) => (response.ok ? readJson<{ deliverables?: Array<{ input: string; answer: string; credits: number }> }>(response) : null))
        .then((data) => {
          const latest = data?.deliverables?.[0];
          if (!latest?.answer) return;
          setItems([
            { id: "w", role: "ai", text: welcome },
            { id: "restored-final", role: "ai", text: latest.answer, html: true },
            { id: "restored-note", role: "ai", text: "（这是你 7 天内的历史交付，已为你恢复；点「下载精美 Word」可随时再存一份，不会重复扣积分。）" }
          ]);
          setDone(true);
          setCost(latest.credits);
          setStep(slots.length - 1);
        })
        .catch(() => {
          /* 找回失败就走新会话，不打扰用户 */
        });
    }
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${slots[0].label}**：${slots[0].q}` }
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
    const index = slots.findIndex((slot) => slot.key === prefill.slotKey);
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
      setItems((prev) => [...prev, { id: `timeout${Date.now()}`, role: "ai", text: "生成超时（已超过 120 秒），可能是模型繁忙，请稍后重试。本次不消耗积分。" }]);
      if (timerRef.current) window.clearInterval(timerRef.current);
    }, 150000);
    try {
      const body: Record<string, unknown> = {
        // 视频复盘额外带 mode / platform / period / has_revenue_data 结构化入参，
        // 后端据此重算口径并校验（其余技能仍是纯文本需求单）。
        ...buildRunBody(coreSkuCode(runSku.skuCode), flow, finalAnswers)
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
        // 工单 2026-09-13 §2.4：有成交口径字段时后端才允许出 ROI 数值。
        // 抖音/视频号导出的表里就有「成交金额」，所以这里要连附件内容一起判断，
        // 否则用户明明传了成交数据，报告却只给留资成本口径。
        if (coreSkuCode(runSku.skuCode) === "vidrev" && /成交金额|成交额|营业额|销售额|GMV|收入/i.test(attachmentText)) {
          body.has_revenue_data = true;
        }
      }
      const runResponse = await fetch(apiPath(`/market/skus/${encodeURIComponent(runSku.skuCode)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (handleStaleSession(runResponse.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗积分。");
      }
      /**
       * 余额不足（402）单独处理：服务端会带 `rechargeUrl`，但那是给 MCP/外部编排用的相对路径，
       * 网页里直接跳 `/recharge` 会丢掉 `/os-v2/` 这类应用前缀（子路径部署下就是 404）。
       * 所以网页自己拼一条**带 next 回跳**的地址：`next` 用去掉应用前缀的站内路由，
       * 由充值页用 `getAppPath()` 还原，避免前缀被拼两遍。
       */
      if (runResponse.status === 402) {
        const payload = (await runResponse.json().catch(() => ({}))) as { message?: string; required?: number; balance?: number };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setItems((prev) => [
          ...prev,
          {
            id: `recharge${Date.now()}`,
            role: "ai",
            text:
              `${payload.message ?? "当前积分不足，请先充值后再使用。"}` +
              `（本次**未消耗积分**；你填的 ${slots.length} 项已经存在本机，充值回来点「继续生成」即可，**不用重填**。）`,
            action: {
              label: "去充值（回来不用重填）",
              href: getAppPath(`/recharge?from=agent&skill=${encodeURIComponent(runSku.skuCode)}&next=${encodeURIComponent(nextRoute)}`)
            }
          }
        ]);
        return;
      }
      /**
       * 包月额度当天用完（409）：**不能静默改成扣积分**——用户买了包月就不该再被扣分。
       * 明确告知今天还剩 0 次、本次不消耗积分、明天 0 点恢复。
       */
      if (runResponse.status === 409) {
        const payload = (await runResponse.json().catch(() => ({}))) as { error?: string; message?: string };
        if (payload.error === "marketplace_subscription_quota_exhausted") {
          const text = `${payload.message ?? "你已开通本智能体的包月，今天的次数已经用完。"}（本次**不消耗积分**；额度每天 0 点恢复。）`;
          setItems((prev) => [...prev, { id: `quota${Date.now()}`, role: "ai", text }]);
          setSubscriptionNotice(text);
          setCost(null);
          setDone(false);
          setConfirmPending(true);
          setSubscriptionView((prev) =>
            prev ? { ...prev, subscribed: true, remaining: 0, exhausted: true } : prev
          );
          return;
        }
        throw new Error(payload.message ?? "本次请求被拒绝；本次不消耗积分。");
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        balance: number;
        needsInput?: boolean;
        payload?: IpPosPayload | VidrevPayload;
        requestId?: string;
        /** 服务端结算口径：subscription = 本次由包月覆盖、没扣积分。 */
        pricingMode?: string;
        subscription?: {
          covered?: boolean;
          dailyQuota?: number | null;
          usedToday?: number;
          remaining?: number | null;
          endDate?: string | null;
        };
      }>(runResponse);
      if (result.needsInput) {
        setItems((prev) => [
          ...prev,
          { id: `clr${Date.now()}`, role: "ai", text: result.answer },
          { id: `clrq${Date.now()}`, role: "ai", text: "以上关键信息还需要你补充一下。直接把补充内容发给我，我会重新生成（本次不消耗积分）。" }
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
      setLastRequestId(result.requestId ?? null);
      setLastRequestId(result.requestId ?? null);
      /**
       * 包月覆盖的这次交付：刷新「今天还剩几条」，并把「不扣积分」写进面板，
       * 免得用户看到「本次实际消耗 0 积分」以为是漏扣。
       */
      if (result.pricingMode === "subscription") {
        const sub = result.subscription;
        setSubscriptionView((prev) => {
          const base: SubscriptionView = prev ?? {
            subscribed: true,
            dailyQuota: sub?.dailyQuota ?? null,
            usedToday: 0,
            remaining: sub?.remaining ?? null,
            exhausted: false,
            endDate: sub?.endDate ?? null,
            offer: null
          };
          return {
            ...base,
            subscribed: true,
            dailyQuota: sub?.dailyQuota ?? base.dailyQuota,
            usedToday: sub?.usedToday ?? base.usedToday,
            remaining: sub?.remaining ?? base.remaining,
            exhausted: sub?.dailyQuota != null && (sub?.remaining ?? 1) <= 0,
            endDate: sub?.endDate ?? base.endDate
          };
        });
        setSubscriptionNotice(
          `本次由包月覆盖，**不扣积分**${sub?.remaining == null ? "" : `（今天还剩 ${Math.max(0, sub.remaining)} 条）`}。`
        );
      }
    } catch (reason) {
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

    // 客户在输入框里直接打「重新开始」= 命令，不是这一轮的答案（2026-09-17 现场缺陷）。
    if (isRestartCommand(value)) {
      resetConversationState();
      setItems([
        { id: `restart-u${Date.now()}`, role: "user", text: value },
        {
          id: `restart-a${Date.now()}`,
          role: "ai",
          text: "好，重新开始。上一轮的填写内容、已上传的文件和本机留存都已经清空，我们从第一轮重新来一遍。"
        },
        { id: "w", role: "ai", text: welcome },
        { id: "q0", role: "ai", text: `**${slots[0].label}**：${slots[0].q}` }
      ]);
      return;
    }

    if (awaitingSupplement) {
      setItems((prev) => [...prev, { id: `su${Date.now()}`, role: "user", text: value }]);
      await generateRun({ ...answers, __supplement: value });
      return;
    }

    /**
     * 视频复盘的「平台」这一步必须真的拿到平台名（2026-09-17 现场：老板把
     * 「复盘（附件：视频号动态数据明细.csv）」当答案发在平台那一步，平台名成了整句话，
     * 后端按「非抖音/视频号」拒绝，同一份视频号文件连发三次都说「只支持抖音和视频号」）。
     * 口径：能从这句话或附件里认出平台，就按规范平台名（抖音 / 视频号）记账往下走；
     * 认不出来就**停在平台这一步**追问，不推进、不消耗积分。
     */
    let answerValue = value;
    if (isVidrev && slots[step].key === "platform") {
      const fromText = normalizeVidrevPlatform(value);
      const fromAttachment = fromText
        ? fromText
        : normalizeVidrevPlatform(
            attachments.map((item) => `${item.name} ${item.text?.slice(0, 400) ?? ""}`).join(" ")
          );
      if (!fromAttachment) {
        setItems((prev) => [
          ...prev,
          { id: `plat-u${Date.now()}`, role: "user", text: value },
          {
            id: `plat-a${Date.now()}`,
            role: "ai",
            text:
              "这一步只确认**平台**：这批视频发在**抖音**还是**视频号**？\n\n" +
              "点下面的选项，或直接打「抖音」/「视频号」两个字。（一次只复盘一个平台，跨平台请分开出报告；本次没有调用模型、不消耗积分）"
          }
        ]);
        setInput("");
        setUploadNote("平台还没确认，先点「抖音」或「视频号」；也可以把后台导出的表格拖进来，我会从文件名认平台。");
        return;
      }
      answerValue = fromAttachment;
      if (fromAttachment !== value.trim()) {
        setUploadNote(`已按「${fromAttachment}」记录这次复盘的平台（从你的输入 / 附件名识别）。`);
      }
    }

    // 工单 2026-09-13 §四：未传数据时输入「复盘」不能空跑一轮（更不能消耗积分）——
    // 先把「数据从哪来、怎么传」讲清楚，用户看到指南再去导出。
    if (isVidrev && slots[step].key === "data" && !vidrevHasData(answerValue)) {
      setItems((prev) => [
        ...prev,
        { id: `nodata-u${Date.now()}`, role: "user", text: value },
        { id: `nodata-a${Date.now()}`, role: "ai", text: VIDREV_NO_DATA_GUIDE }
      ]);
      setInput("");
      setUploadNote("本次没有调用模型、不消耗积分。");
      return;
    }

    const nextAnswers = { ...answers, [slots[step].key]: answerValue };
    setAnswers(nextAnswers);
    /**
     * 分场景分流：按「包含本次答案」之后的有效槽位推进。
     * 直播话术选完「带货/团购/招商」后，条件槽位才被纳入，否则会把「只填了类型」
     * 误判成已收齐、直接跳到空确认卡。
     */
    const nextSlots = flow ? effectiveSlots(flow, nextAnswers) : [];
    // 附件要出现在用户自己那条消息里，否则用户不知道文件到底有没有被带上。
    const attachmentSuffix = attachments.length > 0
      ? `\n（附件：${attachments.map((item) => item.name).join("、")}）`
      : "";
    setItems((prev) => [...prev, { id: `u${step}`, role: "user", text: value + attachmentSuffix }]);

    if (step < nextSlots.length - 1) {
      const next = step + 1;
      setStep(next);
      setItems((prev) => [...prev, { id: `q${next}`, role: "ai", text: `**${nextSlots[next].label}**：${nextSlots[next].q}` }]);
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
    setItems((prev) => [...prev, { id: `editq${Date.now()}`, role: "ai", text: `好的，我们重新填一遍。**${slots[0].label}**：${slots[0].q}` }]);
  }

  /**
   * 开通包月（用户 2026-09-17 拍板：4000 积分/月、每天 5 条，订阅期内不扣积分）。
   *
   * 后端是幂等的（已订阅直接返回当前这期，不重复扣分），所以这里不做本地「已点过」判断，
   * 只把结果如实告诉用户：扣了多少分、这期到哪天、每天几次。
   */
  async function subscribeMonthly() {
    const offer = subscriptionView?.offer;
    if (!runSku || !offer || subscribing) return;
    if (!hasSession) {
      guestToLogin(`${getAppRoutePath(window.location.pathname)}${window.location.search}`);
      return;
    }
    setSubscribing(true);
    setSubscriptionNotice("");
    try {
      const response = await fetch(apiPath("/market/subscriptions"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ skuId: runSku.skuCode })
      });
      if (handleStaleSession(response.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录后再订阅；本次不消耗积分。");
      }
      if (response.status === 402) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string; required?: number; balance?: number };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setItems((prev) => [
          ...prev,
          {
            id: `subrecharge${Date.now()}`,
            role: "ai",
            text:
              `${payload.message ?? `订阅包月需要 ${offer.credits} 积分，当前积分不足，请先充值。`}` +
              `（本次**不消耗积分**；充完回来点「开通包月」即可，你填的内容还在。）`,
            action: {
              label: "去充值（回来接着订阅）",
              href: getAppPath(`/recharge?from=agent&skill=${encodeURIComponent(runSku.skuCode)}&next=${encodeURIComponent(nextRoute)}`)
            }
          }
        ]);
        return;
      }
      const result = await readJson<{
        applied?: boolean;
        alreadySubscribed?: boolean;
        credits?: number;
        balance?: number;
        subscription?: { endDate?: string | null; dailyQuota?: number | null } | null;
        subscriptionStatus?: { dailyQuota?: number | null; usedToday?: number; endDate?: string | null };
      }>(response);
      const dailyQuota = result.subscriptionStatus?.dailyQuota ?? result.subscription?.dailyQuota ?? offer.dailyQuota;
      const endDate = result.subscriptionStatus?.endDate ?? result.subscription?.endDate ?? null;
      const usedToday = result.subscriptionStatus?.usedToday ?? 0;
      setBalance(typeof result.balance === "number" ? result.balance : balance);
      setSubscriptionView({
        subscribed: true,
        dailyQuota: dailyQuota ?? null,
        usedToday,
        remaining: dailyQuota == null ? null : Math.max(0, dailyQuota - usedToday),
        exhausted: false,
        endDate,
        offer
      });
      const until = endDate ? new Date(endDate).toLocaleDateString("zh-CN") : "";
      setItems((prev) => [
        ...prev,
        {
          id: `subok${Date.now()}`,
          role: "ai",
          text: result.alreadySubscribed
            ? `你**已经在包月期内**了，这次没有重复扣积分。${dailyQuota == null ? "次数不限" : `每天 ${dailyQuota} 条`}，额度每天 0 点恢复${until ? `，本期末到 ${until}` : ""}。`
            : `✅ **包月已开通**：已扣 **${result.credits ?? offer.credits} 积分**（${dailyQuota == null ? "次数不限" : `每天 ${dailyQuota} 条`}）${until ? `，本期末到 ${until}` : ""}。\n\n从现在起，本智能体**生成不再扣积分**，额度每天 0 点恢复。`
        }
      ]);
      setSubscriptionNotice(
        result.alreadySubscribed
          ? "你已在包月期内（本次未重复扣分）。"
          : `包月已开通：本次生成不扣积分（${dailyQuota == null ? "次数不限" : `今天还剩 ${dailyQuota} 条`}）。`
      );
    } catch (reason) {
      setItems((prev) => [
        ...prev,
        { id: `suberr${Date.now()}`, role: "ai", text: reason instanceof Error ? reason.message : "订阅失败，请稍后再试。" }
      ]);
    } finally {
      setSubscribing(false);
    }
  }

  /**
   * 重开一轮要清掉的会话状态（不含聊天记录本身）。
   *
   * 2026-09-17 现场缺陷：这里以前只清「本机留存 + 记录 + 填写内容」，**没清附件**——
   * 于是新一轮会悄悄带着上一轮的文件跑，用户以为「重新开始」是干净的。
   */
  function resetConversationState() {
    // 显式清空本机留存（客户主动要重来一份）。
    try {
      if (runSku?.skuCode) localStorage.removeItem(`sitong_chat_${runSku.skuCode}`);
    } catch {
      /* 存储不可用：忽略 */
    }
    setStep(0);
    setAnswers({});
    setInput("");
    setCost(null);
    setDone(false);
    setConfirmPending(false);
    setAwaitingSupplement(false);
    setElapsed(0);
    setLastRequestId(null);
    setAttachments([]);
    setUploadNote("");
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }

  function restart() {
    if (!flow) return;
    resetConversationState();
    setItems([
      { id: "w", role: "ai", text: welcome },
      { id: "q0", role: "ai", text: `**${slots[0].label}**：${slots[0].q}` }
    ]);
  }

  function openFile(kind: "file" | "video") {
    fileRef.current?.setAttribute("accept", kind === "video" ? "video/*" : ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.xlsx,.csv,.txt,.md");
    fileRef.current?.setAttribute("data-kind", kind);
    fileRef.current?.click();
  }

  /** 会被真正读进需求里的文本类附件（视频复盘的后台导出 CSV 就是走这条）。 */
  const TEXT_ATTACHMENT_PATTERN = /\.(txt|md|csv|tsv|json|log|srt)$/i;
  /** 视频复盘专用：平台后台默认导出的 Excel 也要能真读到数据（工单 2026-09-13 §2.1）。 */
  const WORKBOOK_ATTACHMENT_PATTERN = /\.(xlsx|xls)$/i;
  /**
   * 图片附件（用户 2026-09-17「确定放开 A+图片」）。
   *
   * 口径：图片对**全部智能体**开放，并且要**真的解析进需求**（不是只记文件名）。
   * 走平台受登录态保护、带计费预留/结算的 `/media/analyze` 视觉通道（qwen-vl）；
   * 只按**成功的视觉调用**收费（每次 10 积分），没有成功调用时全额退回、0 收费。
   */
  const IMAGE_ATTACHMENT_PATTERN = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const MAX_ATTACHMENT_TEXT = 20_000;

  /**
   * 统一的附件入口：按钮选择、**拖拽进对话框**、以及粘贴文件都走这里。
   *
   * 口径（2026-09-13 用户要求「支持文件直接拖拽进浏览器的对话框」）：
   * - 文本类（txt/md/csv/tsv/json/log/srt）直接读内容，发请求时拼进需求单，智能体真的能看到；
   * - 视频复盘例外：平台后台默认导出的 Excel（.xlsx/.xls）会经平台文档解析入口读成表格文本（工单 2026-09-13 §2.1）。
   * - 图片（2026-09-17 起）：对全部智能体开放，走 `/media/analyze` 真解析进需求（见 `parseImageAttachment`）；
   * - 其它类型（PDF/Word/视频）当前只记录文件名并**明确告诉用户**要粘贴关键内容，
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
          // 后台导出的 CSV 常见 GBK/GB18030，`file.text()` 恒按 UTF-8 解会得到乱码表头，
          // 视频复盘因此一条数据都认不出来（2026-09-16 现场缺陷）。改走带编码探测的解码。
          const decodedAttachment = await readAttachmentText(file);
          const raw = decodedAttachment.text;
          const truncated = raw.length > MAX_ATTACHMENT_TEXT;
          next.push({ kind, name: file.name, text: raw.slice(0, MAX_ATTACHMENT_TEXT) });
          const encodingNote = decodedAttachment.encoding === "gb18030" ? "（识别为 GBK/GB18030 编码）" : "";
          notes.push(`已读取「${file.name}」的内容${encodingNote}${truncated ? `（超过 ${MAX_ATTACHMENT_TEXT} 字，已截断）` : ""}`);
        } catch {
          next.push({ kind, name: file.name });
          notes.push(`无法读取「${file.name}」，请把关键内容粘贴到对话框`);
        }
      } else if (isVidrev && !isVideo && WORKBOOK_ATTACHMENT_PATTERN.test(file.name)) {
        // 工单 2026-09-13 §2.1/§2.4：视频号助手与抖音创作者中心默认导出的就是 Excel，
        // 拖进来必须真读到数据，不能只说「暂不能自动读取」。走平台受授权的文档解析入口
        // （`/media/analyze` 只对音视频 fail-closed，表格是文档，不进 ASR 通道）。
        try {
          const raw = await parseWorkbookAttachment(file);
          if (raw) {
            const truncated = raw.length > MAX_ATTACHMENT_TEXT;
            next.push({ kind, name: file.name, text: raw.slice(0, MAX_ATTACHMENT_TEXT) });
            notes.push(`已读取「${file.name}」的表格内容（Excel 已转成表格文本）${truncated ? `（超过 ${MAX_ATTACHMENT_TEXT} 字，已截断）` : ""}`);
          } else {
            next.push({ kind, name: file.name });
            notes.push(`「${file.name}」里没有读到可用数据，请确认导出的是视频号 / 抖音后台的作品数据表（至少含标题、发布时间、播放量等列）`);
          }
        } catch (error) {
          next.push({ kind, name: file.name });
          const detail = error instanceof Error && error.message ? `（${error.message}）` : "";
          notes.push(`「${file.name}」解析失败${detail}，请确认是视频号 / 抖音后台导出的 Excel（.xlsx），或另存为 CSV 再上传`);
        }
      } else if (isVideo) {
        next.push({ kind, name: file.name });
        notes.push(`已添加视频「${file.name}」：视频内容暂不能自动解析，请用文字说明要点`);
      } else if (IMAGE_ATTACHMENT_PATTERN.test(file.name) || /^image\//.test(file.type)) {
        // 用户 2026-09-17「确定放开 A+图片」：图片对全部智能体开放，并且真解析进需求。
        try {
          const parsed = await parseImageAttachment(file);
          if (parsed.text) {
            const truncated = parsed.text.length > MAX_ATTACHMENT_TEXT;
            next.push({ kind: "image", name: file.name, text: parsed.text.slice(0, MAX_ATTACHMENT_TEXT) });
            const costNote = parsed.creditCost > 0 ? `，本次视觉解析 ${parsed.creditCost} 积分` : "，本次没有产生视觉调用、不扣积分";
            notes.push(`已识别图片「${file.name}」的画面内容${costNote}${truncated ? `（超过 ${MAX_ATTACHMENT_TEXT} 字，已截断）` : ""}`);
          } else {
            next.push({ kind: "image", name: file.name });
            notes.push(`「${file.name}」没有识别到可用信息（本次不扣积分）；请确认图片清晰、或直接把关键内容打在对话框里`);
          }
        } catch (error) {
          next.push({ kind: "image", name: file.name });
          const detail = error instanceof Error && error.message ? `（${error.message}）` : "";
          notes.push(`「${file.name}」识别失败${detail}，本次不扣积分；可重试或把关键内容粘贴到对话框`);
        }
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

  /**
   * 视频复盘：把 Excel 交给平台自己的文档解析入口，拿回「表头 + 数据行」的表格文本。
   * 这条链路不调用 ASR / 视觉模型，仍然要求登录态；解析失败会抛出人话原因。
   */
  async function parseWorkbookAttachment(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("metadata", "视频复盘数据表");
    formData.append("frames", "[]");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(apiPath("/media/analyze"), {
        method: "POST",
        headers: authHeaders(),
        body: formData,
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message?.trim() || `解析失败（${response.status}）`);
      }
      const payload = (await response.json()) as { documentText?: string };
      return (payload.documentText ?? "").trim();
    } catch (error) {
     if ((error as { name?: string }).name === "AbortError") throw new Error("解析超过 60 秒已停止，请换更小的表格重试");
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /**
   * 图片解析（用户 2026-09-17「确定放开 A+图片」）：把图片交给平台自己的视觉解析入口，
   * 拿回「画面里能验证的事实」并拼进需求单，让智能体真的看到图片内容（不是只记文件名）。
   *
   * 计费由服务端结算：只按成功的视觉调用收费（每次 10 积分）；没有成功调用会全额退回。
   * 余额不足时服务端返回 402，这里把原因如实告诉用户。
   */
  async function parseImageAttachment(file: File): Promise<{ text: string; creditCost: number }> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("metadata", "用户上传图片");
    formData.append("frames", "[]");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(apiPath("/media/analyze"), {
        method: "POST",
        headers: authHeaders(),
        body: formData,
        signal: controller.signal
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message?.trim() || `识别失败（${response.status}）`);
      }
      const payload = (await response.json()) as {
        frameSummary?: string;
        contextText?: string;
        creditCost?: number;
      };
      return {
        text: (payload.contextText ?? payload.frameSummary ?? "").trim(),
        creditCost: typeof payload.creditCost === "number" ? payload.creditCost : 0
      };
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw new Error("识别超过 60 秒已停止，本次未扣积分，请换更小的图片重试");
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /**
   * 视频复盘的「数据」轮：只有真带了数据（已读到的附件文本，或含指标+数字的描述）才放行。
   * 只打「复盘」两个字属于「还没给数据」，先回导出指南，不调用模型也不消耗积分。
   */
  function vidrevHasData(value: string): boolean {
    if (attachments.some((item) => item.text)) return true;
    const text = value.trim();
    if (!text) return false;
    const hasMetric = /标题|播放|点赞|评论|分享|收藏|完播|发表时间|发布时间|播放量|播放数/.test(text);
    return hasMetric && /\d/.test(text);
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
  async function transcribeVoiceBlob(blob: Blob, meta: { durationSeconds?: number } = {}): Promise<{ text: string; message?: string }> {
    const mimeType = blob.type || "audio/webm";
    const file = new File([blob], `语音输入-${Date.now()}.${audioExtensionForMime(mimeType)}`, { type: mimeType });
    const formData = new FormData();
    formData.append("file", file, file.name);
    // 录音时长交给服务端算预留额度（不传则服务端按字节数上界保守估算）。
    if (meta.durationSeconds) formData.append("durationSeconds", String(meta.durationSeconds));
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
          ? "语音转写超过60秒，已自动停止；本次不消耗积分，请缩短录音或直接用文字输入。"
          : "语音转写服务暂时不可用，本次不消耗积分。可以直接输入文字或稍后重试。"
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
        window.alert("登录状态已失效，本地登录信息已清除。请重新登录后再导出；本次不消耗积分。");
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
                <img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} />
                <span className="chat-page-title">{personaLabel} · {sku?.name ?? "智能体"} · 开发中</span>
              </div>
            </div>
            <div className="zone-soon" style={{ margin: "0 16px" }}>
              🚧 <b>该智能体内核还在开发中</b>，对话与生成暂未开放，也不会消耗积分。<br />
              上线后可直接使用，和平台其他智能体共用同一份积分，不需要重复充值；可以先回详情页看「输出参考案例」了解交付物长什么样。
            </div>
            <div className="chat-page-composer">
              <button className="btn ghost block" style={{ marginBottom: 10 }} onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}`); }}>‹ 返回详情 · 看输出参考案例</button>
              <button className="btn primary block" onClick={() => { window.location.href = getAppPath("/agents"); }}>去商城挑已上线的智能体</button>
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
                <img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} />
                <span className="chat-page-title">{personaLabel} · {runSku?.name ?? "智能体"} · 需登录</span>
              </div>
            </div>
            <div className="zone-soon" style={{ margin: "0 16px" }}>
                🔒 <b>这个智能体要登录后才能使用</b>：结果存进你自己的账号，方便随时回看与继续追问。<br />
              现在不用填任何信息——登录后自动回到这一页，我再带你按智能体的节奏逐轮补全信息。
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
              <img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} />
              <span className="chat-page-title">{personaLabel} · {runSku?.name ?? flow.name ?? "智能体"}{industry?.title ? ` · ${industry.title}` : ""}</span>
            </div>
            {cost !== null && (
              <span className="chat-page-cost">
                {cost === 0 && subscriptionView?.subscribed ? (
                  <>本次由包月覆盖 · 不扣积分</>
                ) : (
                  <>本次实际消耗 {cost} 积分</>
                )}
              </span>
            )}
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
          {!done && slots.length > 1 && (
            <div className="chat-progress">
              {slots.map((slot, idx) => {
                const answeredCount = items.filter((it) => it.role === "user").length;
                const state = idx < answeredCount ? "done" : idx === step ? "cur" : "todo";
                return <span key={slot.key} className={`chat-prog ${state}`}><i>{state === "done" ? "✓" : idx + 1}</i><b>{slot.label.replace(/第\d+\s*轮·?/g, "")}</b></span>;
              })}
            </div>
          )}
          <div className="chat-page-list">
            {items.map((item) => (
              <div key={item.id} className={`chat-row ${item.role}`}>
                {item.role === "ai" && <img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} />}
                {/*
                 * 结构化报告（IP 定位全案 / 视频复盘）加 `report` 类：窄屏下气泡默认只占 74% 宽，
                 * 报告里的多列表格会被挤成「每列一个字」竖排（用户 2026-09-16 手机端截图）。
                 * 报告类气泡在手机上占满宽度，表格改为横向滚动。
                 */}
                <div className={`chat-bubble ${item.role}${item.payload ? " report" : ""}`}>
                  {item.role === "ai" ? (
                    <>
                      <span className="chat-bubble-label">{personaLabel} · {sku?.name ?? "智能体"}</span>
                      {isVidrevPayload(item.payload) ? (
                        <VidrevReport payload={item.payload} renderMarkdown={renderMarkdownHtml} topicSkuCode={topicSkuCode} />
                      ) : item.payload?.sections ? (
                        <IpPosReport payload={item.payload} renderMarkdown={renderMarkdownHtml} />
                      ) : (
                        <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: item.html ? renderMarkdownHtml(item.text) : renderInline(item.text) }} />
                      )}
                      {item.action && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            type="button"
                            className="btn primary sm"
                            onClick={() => { window.location.href = item.action!.href; }}
                          >
                            {item.action.label}
                          </button>
                        </div>
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
            {busy && <div className="chat-row ai"><img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} /><div className="chat-bubble ai"><span style={{ color: "var(--muted)" }}>{isLiveScript ? `正在生成约几万字的 2 小时直播话术逐字稿，预计 5-10 分钟（整稿分九段依次生成，中途请勿关闭页面），请耐心等待… 已用 ${elapsed}s` : `AI 正在按方法论生成交付… 已用 ${elapsed}s`}</span></div></div>}
            {confirmPending && !busy && flow && (
              <div className="chat-row ai">
                <img className="chat-avatar-img" src={personaAvatar} alt={personaLabel} />
                <div className="chat-bubble ai" style={{ maxWidth: "84%" }}>
                  <span className="chat-bubble-label">{personaLabel} · {sku?.name ?? "智能体"}</span>
                  <div className="md-rich" style={{ color: "var(--text)", fontSize: 14, lineHeight: 1.7 }}>
                <p><b>请先确认需求</b>：确认后我按下面这套信息生成交付。如有不对，点「修改」重填。</p>
                    {/*
                     * 计费说法按「这个智能体自己的规则」来（用户 2026-09-17 拍板）：
                     * - 包月且今日还有额度：明确说**本次不扣积分**，并报剩余条数；
                     * - 包月但今日额度用完：明确说会被拒、不扣积分、明天恢复；
                     * - 未订阅：沿用 2026-09-16 口径，使用前给预估、使用后给实际。
                     */}
                    {subscriptionView?.subscribed && !subscriptionView.exhausted ? (
                      <p>
                        ✅ 你已开通<b>包月</b>（{subscriptionView.dailyQuota == null ? "不限次数" : `每天 ${subscriptionView.dailyQuota} 条`}）：
                        本次生成<b>不扣积分</b>
                        {subscriptionView.remaining == null ? "" : `，今天还剩 ${subscriptionView.remaining} 条`}。
                      </p>
                    ) : subscriptionView?.subscribed && subscriptionView.exhausted ? (
                      <p>
                        ⚠️ 今天额度已用完（{subscriptionView.usedToday}/{subscriptionView.dailyQuota}）：
                        现在点生成会被拒绝，<b>本次不扣积分</b>，明天 0 点自动恢复。
                      </p>
                    ) : (
                      <>
                        {typeof runSku?.ppu === "number" && runSku.ppu > 0 && (
                          <p>
                            预计消耗约 <b>{runSku.ppu}</b> 积分（<b>按本次实际用量结算</b>，可能略有出入；生成完成后会告诉你实际扣了多少）。
                          </p>
                        )}
                        {subscriptionView?.offer && (
                          <p style={{ marginTop: 4 }}>
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={subscribing}
                              onClick={() => { void subscribeMonthly(); }}
                            >
                              {subscribing ? "正在开通…" : `📅 改包月：${subscriptionOfferText(subscriptionView.offer)}`}
                            </button>
                            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                              低频使用按次更划算；高频用选包月，订阅期内不再扣积分。
                            </span>
                          </p>
                        )}
                      </>
                    )}
                    {subscriptionNotice && (
                      <p style={{ color: "var(--accent2)", fontSize: 12 }}>{subscriptionNotice}</p>
                    )}
                    <table className="report-table">
                      <tbody>
                        {slots.map((slot) => (
                          <tr key={slot.key}>
                            <td style={{ width: 150, color: "var(--muted)" }}>{slot.label}</td>
                            <td>{answers[slot.key] || "（未填）"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      className="btn primary"
                      disabled={Boolean(subscriptionView?.subscribed && subscriptionView.exhausted)}
                      onClick={confirmBrief}
                    >
                      {subscriptionView?.subscribed && subscriptionView.exhausted ? "今日额度已用完" : "✓ 确认，开始生成"}
                    </button>
                    <button className="btn ghost" onClick={editBrief}>✎ 修改</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {done && <div className="chat-donebar">✓ 已生成结果 · 可继续用文字追问迭代；重新生成会按实际用量计算</div>}

          {done ? (
            <div className="chat-page-composer">
              <div className="chat-hint" style={{ marginBottom: 10 }}>
                需要再要一份时，点「再问一次 / 重新开始」即可，用量按实际消耗计算。
              </div>
              <button className="btn ghost block" style={{ marginBottom: 10 }} disabled={exporting} onClick={downloadWord}>
                {exporting ? "正在导出…" : `⬇ 下载精美 Word / WPS 报告${docxPrice ? ` · ${docxPrice} 积分` : ""}`}
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
                      {a.kind === "video" ? "🎬" : a.kind === "image" ? "🖼" : "📎"} {a.name}{a.text ? "（已读取）" : ""}
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
              {!awaitingSupplement && (slots[step]?.choices?.length ?? 0) > 0 && (
                <div className="chat-choices">
                  {slots[step].choices?.map((choice) => (
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
                placeholder={awaitingSupplement ? "补充缺失的信息，发送后重新生成（不消耗积分）" : "在这里输入，AI 主动引导你逐步补全"}
                style={{ width: "100%", background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", color: "var(--text)", fontSize: 14, resize: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <span style={{ color: "var(--muted-2)", fontSize: 12 }}>Enter 发送 · Shift+Enter 换行</span>
                {/**
                 * 用户 2026-09-17：「我并没有找到哪里重新开始」——重开不能只靠输入框里打口令，
                 * 必须有个看得见的按钮。只要这一轮已经动过（填过、传过、生成过），就常驻在发送键旁边。
                 */}
                {hasProgress && (
                  <button
                    className="btn ghost"
                    style={{ marginLeft: "auto" }}
                    disabled={busy}
                    title="清空这次填写的内容与已上传文件，从第一轮重新开始"
                    onClick={restart}
                  >
                    ↺ 重新开始
                  </button>
                )}
                <button
                  className="btn primary"
                  style={{ marginLeft: hasProgress ? 8 : "auto" }}
                  disabled={busy || !input.trim()}
                  onClick={() => void send()}
                >
                  {busy ? "正在生成…" : awaitingSupplement ? "重新生成" : step < slots.length - 1 ? "下一步" : "确认需求"}
                </button>
              </div>
              </div>
              <div className="chat-hint">
                AI 会按本智能体技能逻辑<b>主动提问，引导你补全信息</b>，补全后产出结果 · <b>可把文件直接拖进这里</b>
                {isVidrev
                  ? "（文本类 CSV/TXT/MD/JSON、后台导出的 Excel（.xlsx）与图片会读进需求；PDF/Word/视频暂只记文件名）。图片按识别次数计费，每次 10 积分，识别失败/无有效内容不扣积分。"
                  : "（文本类 CSV/TXT/MD/JSON 与图片会读进需求；PDF/Word/Excel/视频暂只记文件名）。图片按识别次数计费，每次 10 积分，识别失败/无有效内容不扣积分。"}
              </div>
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
