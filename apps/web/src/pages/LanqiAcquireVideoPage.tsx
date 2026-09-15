// 兰琪美业门店 AI 经营大脑 · 公域获客 / 视频获客
//
// 0912 一期口径：本页只交付「爆款复刻」单模式（不渲染模式页签）。
// `AssetsMode` / `ClipMode` 的代码保留在下方供后续复用，但本期不挂入口；一键成片是独立路由。
// 口径（0909 总纲 + 硬约束）：
//   · 界面只出现画质档位（草稿预览 480p / 标准成片 720p / 高清成片 1080p），不出现任何模型名或厂商名。
//   · 门店用户不注册账号、不建密钥、不做实名认证；唯一合规动作 = 肖像授权确认。
//   · 一期单店：不出门店切换器、不出门店下拉。
//   · 爆款复刻（LQ-28/LQ-30）不再由平台搜爆款、也不读平台链接：参考素材由门店自备原片上传，
//     报价与出片沿用 LQ-27 既有链路，缺素材或授权一律 fail closed 明确提示，绝不假装成功。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

// ────────────────────────────── 常量（与 demo 一一对应） ──────────────────────────────

type Mode = "replicate" | "assets" | "clip" | "script";

const MODES: { k: Mode; n: string }[] = [
  { k: "replicate", n: "🔥 爆款复刻" },
  { k: "assets", n: "🏪 门店素材成片" },
  { k: "clip", n: "✂️ AI 剪辑" },
  { k: "script", n: "📝 文案转片" }
];

/**
 * demo video.html 顶栏副标题随模式切换（`ws-top h1 .sub-title`）。
 * 唯一改动：demo「文案转片」原文含「看积分预算」分句，兰琪一期不做积分，按硬约束去掉该分句。
 */
const MODE_SUBTITLE: Record<Mode, string> = {
  replicate: "视频获客 · 爆款复刻（上传原片 → 换脸/换人成片）",
  assets: "门店素材成片（上传老板照片 + 门店环境 → 生成老板宣传 / 达人探店视频，风格任意选）",
  clip: "AI 剪辑（自己拍的视频传上来 → AI 自动精选片段 / 加字幕 / 配 BGM / 加片头片尾 → 出成片）",
  script: "文案转片（贴文案 → AI 出分镜脚本 → 传人物卡/场景卡/道具卡 → 逐镜生成出成片）"
};

const PLATFORMS = [
  { k: "all", n: "抖音+视频号" },
  { k: "dy", n: "抖音" },
  { k: "sph", n: "视频号" }
];

const ASSET_TEMPLATES = [
  { k: "owner_promo", ico: "🧑‍💼", n: "老板宣传视频", desc: "老板照片 + 口播模板 + 门店环境，生成老板自然口播推门店的视频" },
  { k: "kol_visit", ico: "🎥", n: "达人探店视频", desc: "达人照片 + 门店环境，换脸到探店参考动作，生成「在店里」探店视频" }
];

const ASSET_STYLES = [
  { k: "pastoral", n: "田园风" },
  { k: "real", n: "实拍风" },
  { k: "beat", n: "卡点风" },
  { k: "guochao", n: "国潮风" },
  { k: "custom", n: "自定义" }
];

const CLIP_TEMPLATES = [
  { k: "promo", ico: "🏪", n: "门店宣传竖版", desc: "突出门头 / 环境 / 项目，适合抖音同城获客" },
  { k: "kol", ico: "🗣️", n: "口播精华", desc: "AI 挑出讲得最好的片段，剪成干货口播" },
  { k: "seed", ico: "🌱", n: "探店种草", desc: "体验过程 + 项目特写，种草向节奏" },
  { k: "moments", ico: "💬", n: "朋友圈快剪", desc: "轻快短平快，适合私域日常发" }
];

const CLIP_LENGTHS = [
  { k: "15", n: "15 秒", desc: "信息流 / 朋友圈" },
  { k: "30", n: "30 秒", desc: "抖音 / 视频号主流" },
  { k: "60", n: "60 秒", desc: "深度种草 / 口播" }
];

const CLIP_OPTS = [
  { k: "clean", n: "去废镜头" },
  { k: "sub", n: "自动字幕" },
  { k: "bgm", n: "BGM 卡点" },
  { k: "head", n: "片头片尾" }
];

/** 画面风格：与后端 key 一一对应（界面只描述光影 / 色调 / 质感）。 */
const SCRIPT_STYLES = [
  { k: "cinema", n: "电影质感" },
  { k: "comm", n: "高级商业广告" },
  { k: "warm", n: "温暖生活感" },
  { k: "guo", n: "国风雅致" },
  { k: "tech", n: "科技未来" }
];

const SPLIT_MODES = [
  { k: "auto", n: "自动按 15 秒切", d: "推荐 · 按语义断句" },
  { k: "s10", n: "每段 10 秒", d: "镜头更碎更抓人" },
  { k: "s5", n: "每段 5 秒", d: "卡点快剪" }
];

/** 画质档位：界面唯一允许出现的三档。不含价格、不含积分。 */
const TIERS = [
  { k: "draft", ico: "📝", n: "草稿预览", res: "480p", d: "先看分镜顺不顺、人物脸稳不稳，不对就重来", out: "480p · 内部确认用，不建议外发" },
  { k: "std", ico: "📱", n: "标准成片", res: "720p", d: "朋友圈 / 视频号 / 企微日常发，够用", out: "720p · 主流平台够用" },
  { k: "final", ico: "🎬", n: "高清成片", res: "1080p", d: "抖音投放 / 门店大屏 / 招商会用", out: "1080p · 投放级画质" }
];

const CAST_ANGLES = [
  { k: "front", n: "正面", ico: "🧍", role: "首帧图" },
  { k: "side", n: "侧面", ico: "👤", role: "参考图" },
  { k: "back", n: "背面", ico: "🔙", role: "参考图" }
];

const MAX_IMGS = 9;
const MAX_AUDIOS = 3;
const MAX_SEC = 15;
/**
 * LQ-32 音轨：门店自己上传的一段音频（BGM / 口播 / 环境音），
 * 也可以上传一段带声音的视频，由后端 ffmpeg 抽出其中的声音当音轨。
 */
const AUDIO_MAX_MB = 20;
const AUDIO_RIGHTS_TEXT = "我拥有这段音频 / 视频的使用权，或已取得授权，同意把它作为本次成片的音轨用于门店宣传。";

const SCRIPT_DEMO =
  "很多人问我，开了十六年的美业店，到底靠什么活下来。其实没什么秘诀，就是把每一次护理都做扎实。我们的手法讲究先看肤质再上产品，一次护理四十分钟，全程不推销。店里用的精华套盒，都是我自己先试过三个月的。如果你也在为皮肤状态发愁，欢迎来店里坐坐，我们免费给你做一次肤质检测。";

/**
 * 门店素材成片 / AI 剪辑 两条线仍未接通，继续保持 fail closed。
 * 文案转片（LQ-23）已接通真实图生视频，走下方 ScriptMode 自己的就绪口径，不看这个开关。
 */
const VIDEO_RENDERING_READY = false;
const RENDERING_OFFLINE_MSG = "视频生成服务暂未开通，这条成片现在还出不来。你的文案 / 素材 / 设置已经留在页面上，服务开通后直接点生成即可。";
/**
 * 参考素材（LQ-28 → LQ-30）：取消「搜索爆款」入口，改为门店自备素材。
 * 用户 2026-09-14 指示「先取消抖音链接的爆款复刻，只支持上传视频」：
 * 平台链接既不能证明是不是爆款、也拿不到站内视频文件（实测 4 条路径全空壳），
 * 所以这里只保留**上传原片**一条路，不再放登记来源的入口，避免让人以为贴链接能出片。
 */
const REFERENCE_MIN_SECONDS = 2;
const REFERENCE_MAX_SECONDS = 30;
const REFERENCE_MAX_MB = 200;
const PORTRAIT_MAX_MB = 5;

const PORTRAIT_SCRIPT = "上传的人物照片为本人或已取得本人授权，同意用于 AI 生成视频并用于门店宣传。";
const PORTRAIT_ASSET = "我已获得照片中人物的肖像权授权，同意将其用于生成门店宣传 / 探店视频，并知悉生成内容含该人物肖像。达人探店场景需额外取得达人本人授权。";
const CLIP_CONSENT = "原始素材是我自己拍摄的；如画面中出现员工 / 顾客肖像，已取得本人同意，允许 AI 剪辑加工后用于门店宣传。";

/** 文案转片：每镜真实出片的可调参数与硬边界。 */
const SHOT_TIER_RES: Record<string, "720P" | "1080P"> = { draft: "720P", std: "720P", final: "1080P" };
/** 首帧图在上传前压到这个最长边，既保证清晰度又不让请求体超限。 */
const FIRST_FRAME_MAX_EDGE = 1280;
const FIRST_FRAME_REFUSED = "暂时读不到这张照片，请换一张 JPG / PNG 再试。";
const VIDEO_POLL_INTERVAL_MS = 6000;
const VIDEO_POLL_LIMIT = 80;

type ShotRender = {
  no: number;
  status: "queued" | "running" | "succeeded" | "failed";
  jobId?: string;
  objectUrl?: string;
  creditCost?: number;
  message?: string;
};

// ────────────────────────────── 类型与工具 ──────────────────────────────

interface StoreInfo { id: string; name: string; city: string | null }

interface StoryboardShot {
  no: number;
  text: string;
  seconds: number;
  kind: string;
  cam: string;
  move: string;
  desc: string;
  prompt: string;
  negative: string;
}

interface StoryboardResult {
  shots: StoryboardShot[];
  shotCount: number;
  totalSeconds: number;
  sourceChars: number;
  style: { k: string; n: string };
  splitMode: { k: string; n: string };
  negative: string;
  maxSeconds: number;
  maxImages: number;
  imageGroupingNote: string;
}

interface CastCard { id: number; name: string; imgs: (File | null)[] }
interface SceneCard { id: number; name: string; imgs: File[] }
interface PropCard { id: number; name: string; img: File | null }
interface AudioCard {
  id: number;
  name: string;
  kind: string;
  /** 展示用的文件名（未上传为 null）。 */
  file: string | null;
  /** 平台文件 id（`POST /files` 返回），合成成片时用它取音轨。 */
  fileId: string | null;
  mediaKind: "audio" | "video" | null;
}

const AUDIO_KINDS = [
  { k: "bgm", n: "BGM 配乐", ico: "🎵" },
  { k: "voice", n: "口播配音", ico: "🎤" },
  { k: "ambient", n: "环境音", ico: "🔊" }
];

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

/** multipart 上传不能带 Content-Type，否则浏览器不会补 boundary。 */
function uploadHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login"));
    throw new Error("登录已失效");
  }
  if (!response.ok) {
    /* 带上下游错误码：调用方要按码给「下一步怎么做」，不能把 403 一律显示成「请稍后重试」。 */
    const error = new Error(body.message ?? body.error ?? "请求失败") as Error & { code?: string };
    error.code = typeof body.error === "string" ? body.error : "";
    throw error;
  }
  return body;
}

/**
 * 用户 2026-09-14 反馈「先报价，再出片 点不了」。前端把按钮放开后还有一层真实拦截：
 * 复刻链路挂在美业产品权益下，只有兰琪权益的账号调用 `/viral-video-replication/*` 必然 403
 * （见 docs/BUG_REGRESSIONS.md QA-20260914-004 的根因段）。后端原文「请按前置条件处理」会把
 * 人引到「素材没填对」的错误方向，所以这里按码照实说明：**没开通能力**跟素材无关。
 * 识别不了的错误码原样显示，不猜原因、不谎称成功。
 */
function replicationFailureNotice(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code === "product_access_denied") {
    return "当前账号还没有开通这项出片能力，所以拿不到报价；这与素材、授权是否填对无关。请联系思潼服务团队为这个账号开通后再试（已上传的素材会保留在本页）。";
  }
  if (code === "asset_not_found") {
    return "这条素材在服务端没登记上，请删掉重新上传一次再报价。";
  }
  if (code === "insufficient_credits") {
    return "积分不足：这次没有创建任务、也没有扣积分。请点右上角「我的 · 充值」，充值后回来点确认出片。";
  }
  if (code === "execution_permit_required" || code === "execution_permit_not_reusable" || code === "execution_budget_too_small") {
    return "这次没有拿到出片许可（单批预算不足或已失效），没有创建任务、没有扣积分；请重试一次，仍然失败请联系思潼服务团队。";
  }
  if (code === "asset_authorization_required") {
    return "素材授权声明没登记上，请重新上传素材后再点一次「先报价，再出片」。";
  }
  return error instanceof Error && error.message ? error.message : "请求失败，请稍后重试。";
}

/**
 * 报价缺口码要说人话：服务端返回的是业务码（`insufficient_credits` 等），
 * 直接铺给门店看等于没说。未在表内的码原样显示，不猜、不美化。
 */
const REPLICATION_GAP_LABELS: Record<string, string> = {
  insufficient_credits: "积分不足，请点右上角「我的 · 充值」",
  // 用户 2026-09-15 口径：**用户端不设单条预算上限**，有积分就能出片；
  // 所以这条缺口现在只会因为「片长超过模型支持的 30 秒」出现，不再是我们自己卡的预算。
  provider_budget_exceeded: "这条片超过模型支持的时长上限（2–30 秒），请先裁剪再上传",
  execution_permit_required: "出片许可没签下来，请重试一次",
  execution_budget_too_small: "服务端出片额度未配置，请联系思潼服务团队",
  secure_staging_required: "安全暂存未就绪",
  server_asset_authorization_required: "素材授权声明未登记",
  controlled_execution_not_enabled: "出片执行未开启"
};

function replicationGapText(gaps: string[] | undefined): string {
  return (gaps ?? []).map((gap) => REPLICATION_GAP_LABELS[gap] ?? gap).join("、");
}

async function copyText(label: string, text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
  void label;
  return true;
}

function readMode(): Mode {
  if (typeof window === "undefined") return "replicate";
  const value = new URLSearchParams(window.location.search).get("mode");
  return value === "assets" || value === "clip" || value === "script" ? value : "replicate";
}

/**
 * 把门店选中的首帧图读成 base64（JPEG）。先把最长边压到 1280，
 * 既保证模型接到的首帧够清晰，又不让请求体把网关顶爆。
 */
async function readFirstFrameBase64(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(FIRST_FRAME_REFUSED));
      element.src = objectUrl;
    });
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longest) throw new Error(FIRST_FRAME_REFUSED);
    const scale = Math.min(1, FIRST_FRAME_MAX_EDGE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(FIRST_FRAME_REFUSED);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    const base64 = dataUrl.replace(/^data:[^,]*,/, "");
    if (!base64) throw new Error(FIRST_FRAME_REFUSED);
    return base64;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function FilePick({
  label,
  accept = "image/*",
  multiple = false,
  disabled = false,
  onPick
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onPick: (files: File[]) => void;
}) {
  return (
    <label className={`lq-vd__pick${disabled ? " off" : ""}`}>
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          onPick(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </label>
  );
}

// ────────────────────────────── 页面 ──────────────────────────────

export function LanqiAcquireVideoPage() {
  const [mode, setMode] = useState<Mode>(readMode);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [notice, setNotice] = useState("");

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 3200);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() });
        const body = await readResponse(response);
        const list: StoreInfo[] = body.stores ?? [];
        if (alive && list.length) setStore(list[0]);
      } catch {
        /* 门店加载失败不阻断页面，单店口径下不弹错误 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const storeId = store?.id ?? "";
  const storeName = store?.name ?? "本店";

  /*
   * 0912 一期口径（`2026-09-12-视频获客一期最终范围-Codex交接.md`）：
   * 视频获客只有两个任务页 —— 本页 = 爆款复刻（单模式），一键成片是独立路由。
   * 门店素材成片（AssetsMode）与 AI 剪辑（ClipMode）的代码保留在下方供后续复用，
   * 但**本期不挂入口、不交付**，所以这里不再渲染页签，也不再出现它们。
   */
  return (
    <LanqiBrainShell active="acquire" subtitle={MODE_SUBTITLE.replicate} crumb="/ 公域获客 / 视频获客 / 爆款复刻">
      <div className="lq-vd">
        <a className="lq-vd__back" href={getAppPath("/lanqi/acquire")}>← 返回公域获客</a>
        <ReplicateMode storeId={storeId} flash={flash} />
        {notice && <p className="lq-vd__toast">{notice}</p>}
      </div>
    </LanqiBrainShell>
  );
}

// ────────────────────────── 一键成片（原「文案转片」，0912 一期） ──────────────────────────

/**
 * 一键成片 = 独立页面（**不是**爆款复刻页里的页签），6 步：
 *   说需求 → AI 生成文案（3 版候选）→ AI 分镜脚本 → 传素材卡 → 积分预算 → 成片。
 * 本期**没有「手动贴文案」入口**：门店老板写不出文案，所以第 1 步只说需求。
 * 第 3–6 步复用下面的 `ScriptMode`（分镜 / 素材卡 / 预算 / 出片），所以它从第 2 步之后接管。
 */
export function LanqiAcquireVideoCopyPage() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [notice, setNotice] = useState("");

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 3200);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() });
        const body = await readResponse(response);
        const list: StoreInfo[] = body.stores ?? [];
        if (alive && list.length) setStore(list[0]);
      } catch {
        /* 门店加载失败不阻断页面，单店口径下不弹错误 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <LanqiBrainShell
      active="acquire"
      subtitle="视频获客 · 一键成片（说需求 → AI 写文案 → AI 分镜 → 素材卡 → 积分预算 → 成片）"
      crumb="/ 公域获客 / 视频获客 / 一键成片"
    >
      <div className="lq-vd">
        <a className="lq-vd__back" href={getAppPath("/lanqi/acquire")}>← 返回公域获客</a>
        <OneClickCopyMode storeId={store?.id ?? ""} storeName={store?.name ?? "本店"} flash={flash} />
        {notice && <p className="lq-vd__toast">{notice}</p>}
      </div>
    </LanqiBrainShell>
  );
}

// ────────────────────────────── 模式 1：爆款复刻 ──────────────────────────────

/**
 * 爆款复刻的四项授权（与美业侧同一口径）：逐条确认后才允许报价与出片。
 * 后端 `material-authorizations` / `quote` / `confirm` 三个接口都用这四个布尔值做门禁。
 */
const REPLICATION_RIGHTS = [
  { k: "visual", label: "我拥有原视频画面及改编使用权" },
  { k: "audio", label: "我拥有原音频 / 音乐的使用权" },
  { k: "performer", label: "原视频主角已单独同意被替换" },
  { k: "portrait", label: "替换照片为本人，或已取得本人书面授权" }
] as const;
type ReplicationRightKey = (typeof REPLICATION_RIGHTS)[number]["k"];

/** 上传前读真实时长与画面尺寸；读不到就返回 null，交给服务端校验，不在这里假装成功。 */
function readVideoMeta(file: File): Promise<{ seconds: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    let timer: number | undefined;
    let settled = false;
    const finish = (value: { seconds: number | null; width: number | null; height: number | null }) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    timer = window.setTimeout(() => finish({ seconds: null, width: null, height: null }), 8000);
    probe.preload = "metadata";
    probe.onloadedmetadata = () =>
      finish({
        seconds: Number.isFinite(probe.duration) ? probe.duration : null,
        width: probe.videoWidth || null,
        height: probe.videoHeight || null
      });
    probe.onerror = () => finish({ seconds: null, width: null, height: null });
    probe.src = objectUrl;
  });
}

/**
 * 幂等键：报价 / 确认共用同一个 key。**换掉原片或人物照片后必须换新 key**，
 * 否则服务端会把「换了素材」当成同一次请求重放，返回上一次的报价或任务。
 */
function newReplicationRequestKey(): string {
  return `lq-rep-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function ReplicateMode({ storeId, flash }: { storeId: string; flash: (message: string) => void }) {
  /** 第 1 步参考素材：用户 2026-09-14 口径「只支持上传视频」，不再有贴链接入口。 */
  const [replaceMode, setReplaceMode] = useState<"face" | "body">("face");

  /*
   * 出片接线（LQ-27）：上传原片 + 人物照片 → 四项授权 → 报价 → 确认 → 轮询 → 播放/下载。
   * 全部复用既有链路（`/files`、`/viral-video-replication/*`），没有新建后端能力。
   */
  const [videoFile, setVideoFile] = useState<{ id: string; name: string; seconds: number | null; width: number | null; height: number | null } | null>(null);
  const [portraitFile, setPortraitFile] = useState<{ id: string; name: string } | null>(null);
  const [rights, setRights] = useState<Record<ReplicationRightKey, boolean>>({
    visual: false,
    audio: false,
    performer: false,
    portrait: false
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [quote, setQuote] = useState<{ canConfirm?: boolean; creditCost?: number | null; message?: string; gaps?: string[] } | null>(null);
  const [job, setJob] = useState<{ id: string; status: string } | null>(null);
  const [assetUrl, setAssetUrl] = useState("");
  const requestKeyRef = useRef(newReplicationRequestKey());
  /**
   * 已登记过声明的素材：**按素材各自记账**。换原片时人像没变，就不该把同一条人像再声明一遍
   * （服务端对同一 fileId 只允许一条声明，重复声明换了依据文件会回 409 —— 页面虽然能继续，
   * 但会给用户和验收留下无意义的失败请求）。
   */
  const declaredRef = useRef<{ video: string | null; portrait: string | null }>({ video: null, portrait: null });
  /**
   * 授权依据文件**整场会话只上传一次**：同一素材重复声明时，服务端按 (requestKey, 指纹) 幂等，
   * 而指纹里含依据文件 id 与到期时间 —— 每次重新上传依据文件会让「换素材后重传同一张人像」
   * 变成指纹漂移 → 409（功能不受影响，但会留下无意义的 4xx 噪声）。缓存后同一素材的声明输入
   * 完全一致，服务端直接返回已登记记录。
   */
  const basisRef = useRef<{ basisFileId: string; expiresAt: string } | null>(null);

  const photoNeeded = replaceMode === "face" ? "头部图片" : "全身画面";
  const rightsOk = REPLICATION_RIGHTS.every((item) => rights[item.k]);
  const uploadAsset = useCallback(async (kind: "video" | "portrait", file: File | undefined) => {
    if (!file) return;
    if (kind === "video") {
      if (!/\.(mp4|mov)$/i.test(file.name)) {
        setNotice("参考视频只支持 MP4 / MOV 文件；抖音、视频号的播放页链接平台不读取。");
        return;
      }
      if (file.size > REFERENCE_MAX_MB * 1024 * 1024) {
        setNotice(`参考视频超过 ${REFERENCE_MAX_MB}MB，请先裁短或压缩再上传。`);
        return;
      }
    } else {
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
        setNotice("人物照片只支持 JPG / PNG / WebP。");
        return;
      }
      if (file.size > PORTRAIT_MAX_MB * 1024 * 1024) {
        setNotice(`人物照片超过 ${PORTRAIT_MAX_MB}MB，请先压缩再上传。`);
        return;
      }
    }
    let meta: { seconds: number | null; width: number | null; height: number | null } = { seconds: null, width: null, height: null };
    if (kind === "video") {
      setBusy("正在读取视频信息…");
      setNotice("");
      meta = await readVideoMeta(file);
      if (meta.seconds !== null && (meta.seconds < REFERENCE_MIN_SECONDS || meta.seconds > REFERENCE_MAX_SECONDS)) {
        setBusy("");
        setNotice(
          `参考视频要在 ${REFERENCE_MIN_SECONDS}–${REFERENCE_MAX_SECONDS} 秒之间（这条读到 ${meta.seconds.toFixed(1)} 秒），请先裁剪再上传。`
        );
        return;
      }
      if (
        meta.width !== null &&
        meta.height !== null &&
        (meta.width < 200 || meta.height < 200 || meta.width > 2048 || meta.height > 2048 || meta.width / meta.height < 1 / 3 || meta.width / meta.height > 3)
      ) {
        setBusy("");
        setNotice("参考视频的画面尺寸不支持：短边要 ≥200px、长边 ≤2048px，画面比例在 1:3 – 3:1 之间。");
        return;
      }
    }
    setBusy(kind === "video" ? "正在上传参考视频…" : "正在上传人物照片…");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(apiPath("/files"), { method: "POST", headers: uploadHeaders(), body: form });
      const body = await readResponse(response);
      const id = body?.file?.id;
      if (!id) throw new Error("素材上传失败，请稍后重试。");
      if (kind === "video") {
        setVideoFile({ id, name: file.name, seconds: meta.seconds, width: meta.width, height: meta.height });
      } else {
        setPortraitFile({ id, name: file.name });
      }
      /* 换了原片 / 人物照片就是一次新的复刻请求：换新幂等键并清掉上一次的报价与成片。 */
      requestKeyRef.current = newReplicationRequestKey();
      setQuote(null);
      setJob(null);
      setAssetUrl("");
      setNotice(kind === "video" ? "参考视频已上传。" : "人物照片已上传。");
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : "素材上传失败，请稍后重试。");
    } finally {
      setBusy("");
    }
  }, []);

  /**
   * 删除已上传素材（用户 2026-09-14 反馈「已上传的照片 / 视频无法删除、无法替换」）。
   * 清理口径与 `uploadAsset` 换素材完全一致：换新幂等键 + 清掉上一次的报价 / 任务 / 成片，
   * 免得服务端把「删了重传」当成同一次请求重放，返回上一次的报价或任务。
   */
  const removeAsset = useCallback((kind: "video" | "portrait") => {
    requestKeyRef.current = newReplicationRequestKey();
    if (kind === "video") setVideoFile(null);
    else setPortraitFile(null);
    setQuote(null);
    setJob(null);
    setAssetUrl("");
    setNotice(kind === "video" ? "已删除参考视频，可以重新上传另一条。" : "已删除人物照片，可以重新上传另一张。");
  }, []);

  const replicationPayload = useCallback(
    () => ({
      referenceFileId: videoFile?.id,
      portraitFileId: portraitFile?.id,
      requestKey: requestKeyRef.current,
      model: "aliyun_strict",
      visualRightsConfirmed: rights.visual,
      audioRightsConfirmed: rights.audio,
      performerConsentConfirmed: rights.performer,
      portraitConsentConfirmed: rights.portrait
    }),
    [portraitFile, rights, videoFile]
  );

  /**
   * 「在线勾选即算声明」（用户 2026-09-14 口径）：不再要求门店上传 PDF 授权书。
   * 把四条勾选落成一份声明文本 → 作为**授权依据文件**上传 → 再为原片与人像各登记一条素材授权。
   * requestKey 由素材 fileId 决定，服务端按它幂等：同一素材重复登记不会产生第二份记录。
   */
  const ensureMaterialDeclarations = useCallback(async () => {
    const videoId = videoFile?.id;
    const portraitId = portraitFile?.id;
    if (!videoId || !portraitId) throw new Error("请先上传原片与人物照片。");
    const needVideo = declaredRef.current.video !== videoId;
    const needPortrait = declaredRef.current.portrait !== portraitId;
    if (!needVideo && !needPortrait) return;
    if (!basisRef.current) {
      const basisText = [
        "兰琪 · 爆款复刻 素材与肖像授权在线声明",
        "（由门店用户在本页逐条勾选后生成；平台未独立核验法律真实性，只作为授权依据引用）",
        "1) 原视频画面与改编权：已确认拥有或已获授权",
        "2) 原视频音频：已确认拥有或已获授权",
        "3) 原视频主角同意被替换：已确认",
        "4) 替换照片本人或已获授权：已确认",
        "声明人：本账号门店操作人；声明仅用于本人上传素材的本次生成。"
      ].join("\n");
      const form = new FormData();
      form.append("file", new File([basisText], "兰琪-素材与肖像授权在线声明.txt", { type: "text/plain" }));
      const basisResponse = await fetch(apiPath("/files"), { method: "POST", headers: uploadHeaders(), body: form });
      const basisBody = await readResponse(basisResponse);
      const basisFileId = basisBody?.file?.id;
      if (!basisFileId) throw new Error("授权依据上传失败，请稍后重试。");
      basisRef.current = { basisFileId, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() };
    }
    const { basisFileId, expiresAt } = basisRef.current;
    for (const [fileId, subjectRole, needed] of [[videoId, "reference", needVideo], [portraitId, "owner", needPortrait]] as const) {
      if (!needed) continue;
      try {
        const response = await fetch(apiPath("/viral-video-replication/material-authorizations"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            fileId,
            basisFileId,
            subjectRole,
            purpose: "video_replacement",
            expiresAt,
            requestKey: `lqvd-${subjectRole}-${fileId}`,
            rightsDeclared: true
          })
        });
        await readResponse(response);
      } catch (error) {
        /* 同一素材已登记过（依据文件换了）→ 幂等冲突，服务端已有的声明继续有效，不当作失败。 */
        if ((error as { code?: string } | null)?.code !== "idempotency_conflict") throw error;
      }
      if (subjectRole === "reference") declaredRef.current.video = fileId;
      else declaredRef.current.portrait = fileId;
    }
  }, [portraitFile, videoFile]);

  const requestQuote = useCallback(async () => {
    if (!videoFile) { setNotice("请先上传要复刻的原视频（MP4 / MOV）。"); return; }
    if (!portraitFile) { setNotice(`请先上传${photoNeeded}照片。`); return; }
    if (!rightsOk) { setNotice("请先逐条确认四项素材与肖像授权。"); return; }
    setBusy("正在登记素材授权…");
    setNotice("");
    setQuote(null);
    try {
      await ensureMaterialDeclarations();
      setBusy("正在校验素材与授权…");
      const response = await fetch(apiPath("/viral-video-replication/quote"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(replicationPayload())
      });
      const body = await readResponse(response);
      setQuote(body);
      setNotice(body?.message ?? "报价已生成");
    } catch (error) {
      setNotice(replicationFailureNotice(error));
    } finally {
      setBusy("");
    }
  }, [ensureMaterialDeclarations, photoNeeded, replicationPayload, rightsOk, portraitFile, videoFile]);

  const loadAsset = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(apiPath(`/viral-video-replication/jobs/${jobId}/content`), { headers: authHeaders() });
      if (!response.ok) throw new Error("成片读取失败");
      const blob = await response.blob();
      setAssetUrl(URL.createObjectURL(blob));
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : "成片读取失败");
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 6000));
        try {
          const response = await fetch(apiPath("/viral-video-replication/jobs"), { headers: authHeaders() });
          const body = await readResponse(response);
          const found = (body?.jobs ?? []).find((item: { id?: string }) => item.id === jobId);
          const status = String(found?.status ?? "unknown");
          setJob({ id: jobId, status });
          if (status === "succeeded") {
            setNotice("成片已生成，可以播放或下载。");
            void loadAsset(jobId);
            return;
          }
          if (status === "failed" || status === "cancelled") {
            setNotice(`任务结束：${status}。没有成片可下载，你没有拿到会自动退还。`);
            return;
          }
        } catch {
          /* 单次轮询失败不终止，下一轮继续 */
        }
      }
      setNotice("任务还在处理中，可以稍后回到本页刷新查看。");
    },
    [loadAsset]
  );

  const confirmReplication = useCallback(async () => {
    setBusy("正在创建任务…");
    setNotice("");
    try {
      const response = await fetch(apiPath("/viral-video-replication/confirm"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(replicationPayload())
      });
      const body = await readResponse(response);
      const id = body?.job?.id;
      if (!id) throw new Error("任务没有创建成功，请稍后重试。");
      setJob({ id, status: String(body.job.status ?? "submitted") });
      setNotice(`任务已提交，当前状态：${body.job.status ?? "submitted"}。`);
      void pollJob(id);
    } catch (error) {
      setNotice(replicationFailureNotice(error));
    } finally {
      setBusy("");
    }
  }, [pollJob, replicationPayload]);

  /** 换素材重来：清空参考素材、人物形象、授权与上一次的报价 / 任务，并换新幂等键。 */
  const resetAll = useCallback(() => {
    requestKeyRef.current = newReplicationRequestKey();
    setVideoFile(null);
    setPortraitFile(null);
    setRights({ visual: false, audio: false, performer: false, portrait: false });
    setQuote(null);
    setJob(null);
    setAssetUrl("");
    setNotice("");
  }, []);

  /**
   * 还差什么才允许报价。用户 2026-09-14 口径：参考素材只支持上传视频
   * （平台链接拿不到视频文件，实测 4 条路径全空壳），所以只点名原片、人物照片与四项授权。
   */
  const missing = [
    !videoFile ? "参考视频原片（先在抖音 / 视频号里「保存本地视频」，再上传）" : "",
    !portraitFile ? photoNeeded : "",
    !rightsOk ? "四项素材与肖像授权" : ""
  ].filter(Boolean);
  const stage = !videoFile
    ? "第 1 步 / 3 · 上传要复刻的原片"
    : !portraitFile
      ? "第 2 步 / 3 · 提供要替换的人物形象"
      : !rightsOk
        ? "第 3 步 / 3 · 逐条确认素材与肖像授权"
        : "第 3 步 / 3 · 素材与授权已齐，可以校验并报价";

  /*
   * 用户 2026-09-14 反馈「先报价，再出片 点不了」：原实现里这颗按钮在拿到报价之前恒为禁用，
   * 用户看到的是一个点不动的橙色按钮，也没有任何解释。现在按阶段给出可执行状态：
   *   · 素材 / 授权没齐 → 禁用，并逐项点名还差什么；
   *   · 齐了但还没报价 → **可点**，点它先去报价（等价于上面的「校验素材与授权，看报价」）；
   *   · 报价可以确认 → 可点，文案变成「确认并出片（按报价扣积分）」；
   *   · 服务端前置条件不满足 → 禁用，并照实说明缺口，不创建任务、不扣积分。
   */
  const primary: { state: string; label: string; disabled: boolean; action: "quote" | "confirm"; hint: string } = busy
    ? { state: "busy", label: busy, disabled: true, action: "quote", hint: "" }
    : missing.length > 0
      ? {
          state: "missing",
          label: "先补齐素材与授权，再出片",
          disabled: true,
          action: "quote",
          hint: `还差：${missing.join("、")}。补齐后这里会自动可以点。`
        }
      : !quote
        ? {
            state: "need_quote",
            label: "先报价，再出片",
            disabled: false,
            action: "quote",
            hint: "点这里就是先报价：拿到积分与前置条件后，按钮会变成「确认并出片」，再点一次才会扣积分出片。"
          }
        : quote.canConfirm
          ? {
              state: "ready",
              label: `✅ 确认并出片（按报价扣 ${quote.creditCost ?? 0} 积分）`,
              disabled: false,
              action: "confirm",
              hint: "点这一下才会真正建任务、扣积分；未确认前不会扣。"
            }
          : {
              state: "blocked",
              label: "当前还不能出片",
              disabled: true,
              action: "confirm",
              hint: "服务端反馈还缺前置条件或授权，未创建任务、未扣积分；缺口见下方说明。"
            };

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">{stage}</div>

        <h3 className="lq-vd__card-title">① 参考素材 <span className="tag green">必填 · 上传原片</span></h3>
        <p className="lq-vd__card-sub">
          参考素材由你自己提供，平台不替你去搜、也不读取平台链接里的视频文件（抖音、视频号都不开放站内视频下载）。
          请先在抖音 / 视频号里点「分享 → 保存本地视频」，再把这条<b>原片</b>传上来。
        </p>
        {(
          <>
            <p className="lq-vd__card-sub" style={{ marginTop: 14 }}>
              MP4 / MOV，≤{REFERENCE_MAX_MB}MB，时长 {REFERENCE_MIN_SECONDS}–{REFERENCE_MAX_SECONDS} 秒。
              抖音、视频号的分享链接平台不读取，请先把原片存到手机或电脑再上传。
            </p>
            <div className="lq-vd__fileinfo">
              <b>{videoFile ? `已上传：${videoFile.name}` : "未上传参考视频"}</b>
              <p>
                {videoFile
                  ? `时长 ${
                      videoFile.seconds !== null ? `${videoFile.seconds.toFixed(1)} 秒` : "读不到（以服务端校验为准）"
                    }${
                      videoFile.width && videoFile.height ? ` · ${videoFile.width}×${videoFile.height}` : ""
                    }`
                  : "只有拿到授权的原片才能复刻；未授权素材请勿上传。"}
              </p>
            </div>
            <div className="lq-vd__actions">
              <FilePick
                label={videoFile ? "🔄 更换原视频" : "选择原视频（MP4 / MOV）"}
                accept="video/mp4,video/quicktime,.mp4,.mov"
                onPick={(files) => void uploadAsset("video", files[0])}
              />
              {videoFile && (
                <button
                  className="lq-vd__btn ghost small danger"
                  data-lq-vd-remove="video"
                  type="button"
                  onClick={() => removeAsset("video")}
                >
                  🗑 删除这条原片
                </button>
              )}
            </div>
          </>
        )}

        <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>
          ② 人物形象 <span className="tag green">换脸 / 换人</span>
        </h3>
        <p className="lq-vd__card-sub">AI 保留原片的画面、动作、节奏与配音，只把主角换成你上传的人；照片会上传到你账号名下，仅用于本次生成。</p>
        <div className="lq-vd__chips">
          <button
            type="button"
            className={`lq-vd__pill${replaceMode === "face" ? " on" : ""}`}
            onClick={() => setReplaceMode("face")}
          >
            换脸 <span className="hint">给头部图片</span>
          </button>
          <button
            type="button"
            className={`lq-vd__pill${replaceMode === "body" ? " on" : ""}`}
            onClick={() => setReplaceMode("body")}
          >
            换人 <span className="hint">给人物全身画面</span>
          </button>
        </div>
        <div className="lq-vd__fileinfo">
          <b>{portraitFile ? `已上传：${portraitFile.name}` : `未上传${photoNeeded}照片`}</b>
          <p>换脸给头部照片，换人给人物全身画面；照片须为本人或已获授权。JPG / PNG / WebP，≤{PORTRAIT_MAX_MB}MB。</p>
        </div>
        <div className="lq-vd__actions">
          <FilePick
            label={portraitFile ? "🔄 更换照片" : "选择照片"}
            accept="image/jpeg,image/png,image/webp"
            onPick={(files) => void uploadAsset("portrait", files[0])}
          />
          {portraitFile && (
            <button
              className="lq-vd__btn ghost small danger"
              data-lq-vd-remove="portrait"
              type="button"
              onClick={() => removeAsset("portrait")}
            >
              🗑 删除这张照片
            </button>
          )}
        </div>

        <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>
          替换产品 <span className="tag opt">可选</span>
        </h3>
        <p className="lq-vd__card-sub">本期生成只替换主角，产品 / 道具替换尚未开通 —— 这里不放用不上的上传控件。</p>
        <div className="lq-vd__fileinfo">
          <b>保留原片的产品 / 道具</b>
          <p>等后端支持产品替换后再开放这一步。</p>
        </div>

        <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>
          ③ 素材与肖像授权 <span className="tag green">逐条确认</span>
        </h3>
        <p className="lq-vd__card-sub">这四项是平台合规动作，逐条确认后才允许报价与出片。</p>
        {REPLICATION_RIGHTS.map((item) => (
          <label className="lq-vd__consent" key={item.k}>
            <input
              type="checkbox"
              checked={rights[item.k]}
              onChange={(event) => setRights((current) => ({ ...current, [item.k]: event.target.checked }))}
            />
            <span className="cb-txt">{item.label}</span>
          </label>
        ))}

        <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>④ 报价与出片</h3>
        <div className="lq-vd__card">
          <div className="lq-vd__kv">
            <span className="k">预计积分</span>
            <span className="v">
              {quote?.creditCost ? `${quote.creditCost} 积分 · 确认后才扣减` : quote ? "本次未能报价" : "点「校验并报价」后显示"}
            </span>
          </div>
          <div className="lq-vd__kv"><span className="k">输出</span><span className="v">MP4 · 沿用原片画幅与时长 · 起始画面带 AI 标识</span></div>
          <div className="lq-vd__kv"><span className="k">任务</span><span className="v">{job ? `${job.id} · ${job.status}` : "尚未创建"}</span></div>
        </div>
        {missing.length > 0 && <p className="lq-vd__hint">还差：{missing.join("、")}。</p>}
        <button className="lq-vd__btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void requestQuote()}>
          🧾 校验素材与授权，看报价
        </button>
        {/* 2026-09-15 现场：结果原先渲染在主按钮下方，店长点完看不到任何反馈，以为「点了没反应」。
            现在把本次结果（notice / 缺口）紧跟在「校验并报价」下面、主按钮之前，点击处就能看到。 */}
        {notice && <p className="lq-vd__hint" data-lq-vd-notice>{notice}</p>}
        {quote?.gaps && quote.gaps.length > 0 && (
          <div className="lq-vd__warn" data-lq-vd-gaps={quote.gaps.join(",")}>
            这一版还不能出片：{replicationGapText(quote.gaps)}。未创建任务、未扣积分。
          </div>
        )}
        {primary.hint && <p className="lq-vd__hint" data-lq-vd-primary-hint={primary.state}>{primary.hint}</p>}
        <button
          className="lq-vd__btn primary block"
          data-lq-vd-primary={primary.state}
          type="button"
          disabled={primary.disabled}
          onClick={() => void (primary.action === "quote" ? requestQuote() : confirmReplication())}
        >
          {primary.label}
        </button>
        {assetUrl && (
          <>
            <video className="lq-vd__result" src={assetUrl} controls playsInline />
            <a className="lq-vd__btn ghost" href={assetUrl} download={`lanqi-replication-${job?.id ?? "result"}.mp4`}>
              ⬇ 下载成片
            </a>
          </>
        )}
        <button className="lq-vd__btn ghost" type="button" onClick={resetAll}>
          ↻ 换一组参考素材重来
        </button>
      </section>

      <section className="lq-vd__right">
        <div className="lq-vd__sec-title">
          爆款复刻 · 换脸 / 换人 <span className="lq-vd__badge">严格复刻</span>
        </div>
        <div className="lq-vd__warn">
          参考素材由你自己提供：<b>上传原片</b>才能出片。平台不抓站内视频流、不解析平台链接，也不替你去搜爆款。
        </div>
        <div className="lq-vd__card">
          <div className="lq-vd__kv">
            <span className="k">参考素材</span>
            <span className="v">{videoFile ? videoFile.name : "未上传参考视频"}</span>
          </div>
          <div className="lq-vd__kv">
            <span className="k">参考视频</span>
            <span className="v">
              {videoFile
                ? `${videoFile.name}${videoFile.seconds !== null ? ` · ${videoFile.seconds.toFixed(1)} 秒` : ""}`
                : "未上传原片（没有原片就不会出片）"}
            </span>
          </div>
          <div className="lq-vd__kv">
            <span className="k">人物形象</span>
            <span className="v">
              {replaceMode === "face" ? "换脸（头部图片）" : "换人（全身画面）"}
              {portraitFile ? ` · ${portraitFile.name}` : " · 待上传"}
            </span>
          </div>
          <div className="lq-vd__kv">
            <span className="k">替换产品</span>
            <span className="v">保留原片的产品 / 道具（本期尚未开通替换）</span>
          </div>
          <div className="lq-vd__kv"><span className="k">生成方式</span><span className="v">AI 人像替换 · 平台内置能力，无需你自行配置</span></div>
          <div className="lq-vd__kv"><span className="k">输出</span><span className="v">MP4 · 沿用原片画幅与时长 · 起始画面带 AI 生成标识</span></div>
        </div>
        <div className="lq-vd__note">
          {missing.length > 0 ? (
            <>
              <b>还差这些才出片：</b>
              {missing.join("、")}。补齐后点「校验素材与授权，看报价」。
            </>
          ) : (
            <>
              <b>素材与授权已齐：</b>点「校验素材与授权，看报价」拿到积分与前置条件，再决定要不要出片。
            </>
          )}
        </div>
        <div className="lq-vd__warn">换脸需先完成肖像授权，授权后方可生成；平台不提供站内视频下载，链接仅作来源登记。</div>
      </section>
    </div>
  );
}

// ────────────────────────────── 模式 2：门店素材成片 ──────────────────────────────

function AssetsMode({ storeName }: { storeName: string }) {
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(null);
  const [envPhoto, setEnvPhoto] = useState<string | null>(null);
  const [envVideo, setEnvVideo] = useState<string | null>(null);
  const [template, setTemplate] = useState("owner_promo");
  const [style, setStyle] = useState("pastoral");
  const [consent, setConsent] = useState(false);
  const [warn, setWarn] = useState(false);

  const tpl = ASSET_TEMPLATES.find((item) => item.k === template) ?? ASSET_TEMPLATES[0];
  const styleName = ASSET_STYLES.find((item) => item.k === style)?.n ?? ASSET_STYLES[0].n;
  const blocked = !ownerPhoto;

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">门店素材成片 · 第 1 步 / 3 · 上传素材 + 选模板</div>
        <h3 className="lq-vd__card-title">门店素材库</h3>
        <p className="lq-vd__card-sub">上传老板照片与门店环境，AI 用你自己的素材生成专属视频。素材只在你本机预览。</p>

        <div className="lq-vd__asset">
          <div className="ac-hd">👤 老板照片 <span className="tag green">必填</span></div>
          <div className="ac-sub">正面、光线均匀、五官清晰，生成时用于换脸到口播 / 探店主角。</div>
          <div className="lq-vd__fileinfo">
            <b>{ownerPhoto ? "已上传老板照片" : "未上传"}</b>
            <p>建议半身或头部照，姿态自然。</p>
          </div>
          <FilePick label={ownerPhoto ? "重新选择" : "选择照片"} onPick={(files) => { setOwnerPhoto(files[0]?.name ?? null); setWarn(false); }} />
        </div>

        <div className="lq-vd__asset">
          <div className="ac-hd">🏪 门店环境图 <span className="tag opt">可选</span></div>
          <div className="ac-sub">门头、店内、项目场景等，用作视频背景。不填则用系统默认场景。</div>
          <div className="lq-vd__fileinfo">
            <b>{envPhoto ? "已上传门店环境图" : "未上传"}</b>
            <p>可多张，建议横版实拍。</p>
          </div>
          <FilePick label={envPhoto ? "重新选择" : "选择图片"} multiple onPick={(files) => setEnvPhoto(files[0]?.name ?? null)} />
        </div>

        <div className="lq-vd__asset">
          <div className="ac-hd">🎬 门店环境视频 <span className="tag opt">可选 · 达人探店建议填</span></div>
          <div className="ac-sub">一段门店走动 / 服务的视频，达人探店模式下作为换脸动作参考。</div>
          <div className="lq-vd__fileinfo">
            <b>{envVideo ? "已上传门店环境视频" : "未上传"}</b>
            <p>建议 5-15 秒横版。</p>
          </div>
          <FilePick label={envVideo ? "重新选择" : "选择视频"} accept="video/*" onPick={(files) => setEnvVideo(files[0]?.name ?? null)} />
        </div>

        <div className="lq-vd__field" style={{ marginTop: 18 }}>
          <label>视频模板 <span className="tag green">必选</span></label>
          <div className="lq-vd__opts">
            {ASSET_TEMPLATES.map((item) => (
              <button
                key={item.k}
                type="button"
                className={`lq-vd__opt${template === item.k ? " on" : ""}`}
                onClick={() => setTemplate(item.k)}
              >
                <b>{item.ico} {item.n}</b>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lq-vd__field">
          <label>画面风格 <span className="tag opt">可自由选</span></label>
          <div className="lq-vd__chips">
            {ASSET_STYLES.map((item) => (
              <button
                key={item.k}
                type="button"
                className={`lq-vd__chip${style === item.k ? " on" : ""}`}
                onClick={() => setStyle(item.k)}
              >
                {item.n}
              </button>
            ))}
          </div>
          <p className="lq-vd__hint">风格不限：田园风只是参考示例，实拍 / 卡点 / 国潮 / 自定义都可以。</p>
        </div>

        <div className="lq-vd__ready">
          ✅ <b>传照片就能生视频，不用做任何开通动作</b> —— 不用注册账号、不用实名认证、不用自己配密钥，也不用管背后用什么模型。<br />
          你只要确认一件事：<b>照片里的人同意出镜</b>。
        </div>

        <label className="lq-vd__consent">
          <input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); if (event.target.checked) setWarn(false); }} />
          <span className="cb-txt">{PORTRAIT_ASSET}</span>
        </label>
        {warn && <div className="lq-vd__consentwarn">⚠ 需先勾选肖像权授权再生成（合规要求）</div>}
        <button
          className="lq-vd__btn primary block"
          type="button"
          onClick={() => {
            if (!consent) { setWarn(true); return; }
            if (blocked || !VIDEO_RENDERING_READY) { window.alert(blocked ? "请先上传老板照片（模板主角需要）。" : RENDERING_OFFLINE_MSG); return; }
          }}
        >
          生成门店视频
        </button>
      </section>

      <section className="lq-vd__right">
        <div className="lq-vd__sec-title">门店素材成片 <span className="lq-vd__badge">9:16</span></div>
        <div className="lq-vd__card">
          <div className="lq-vd__kv"><span className="k">模板</span><span className="v">{tpl.n}</span></div>
          <div className="lq-vd__kv"><span className="k">风格</span><span className="v">{styleName}</span></div>
          <div className="lq-vd__kv"><span className="k">老板照片</span><span className="v">{ownerPhoto ? "已上传" : "未传（用占位）"}</span></div>
          <div className="lq-vd__kv"><span className="k">门店环境</span><span className="v">{envPhoto ? "已上传图片" : "未传"}{envVideo ? " + 视频" : ""}</span></div>
          <div className="lq-vd__kv"><span className="k">生成方式</span><span className="v">AI 人像替换 · 平台内置能力，无需你自行配置</span></div>
          <div className="lq-vd__kv"><span className="k">肖像授权</span><span className="v">{consent ? "✅ 已授权（合规）" : "⚠ 未授权"}</span></div>
          <div className="lq-vd__kv"><span className="k">输出</span><span className="v">MP4 · 9:16 · 起始画面带 AI 生成标识</span></div>
        </div>
        <div className="lq-vd__placeholder">
          上传左侧门店素材、选好模板与风格后<br />右侧这里会实时预览成片效果<br /><br />
          当前选择：<b>{tpl.n}</b> · <b>{styleName}风格</b><br />
          <span className="lq-vd__hint">门店：{storeName}</span>
        </div>
        <div className="lq-vd__offline">
          <div className="ico">🔌</div>
          <h3>出片服务暂未开通</h3>
          <p>{RENDERING_OFFLINE_MSG}</p>
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────── 模式 3：AI 剪辑 ──────────────────────────────

function ClipMode({ storeName, flash }: { storeName: string; flash: (message: string) => void }) {
  const [videos, setVideos] = useState<string[]>([]);
  const [template, setTemplate] = useState("promo");
  const [length, setLength] = useState("30");
  const [opts, setOpts] = useState<Record<string, boolean>>({ clean: true, sub: true, bgm: true, head: false });
  const [consent, setConsent] = useState(false);
  const [warn, setWarn] = useState(false);

  const tpl = CLIP_TEMPLATES.find((item) => item.k === template) ?? CLIP_TEMPLATES[0];
  const lenName = CLIP_LENGTHS.find((item) => item.k === length)?.n ?? "30 秒";
  const optText = CLIP_OPTS.filter((item) => opts[item.k]).map((item) => item.n).join(" · ") || "无";
  const shots = Math.max(4, Math.min(18, Math.round(Number(length) / 2.5)));

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">AI 剪辑 · 第 1 步 / 3 · 上传自己拍的视频</div>
        <h3 className="lq-vd__card-title">原始视频 <span className="tag green">至少 1 段</span></h3>
        <p className="lq-vd__card-sub">手机拍好直接传，横竖版都可以、不用自己剪。AI 会自己看内容、挑片段、排节奏。</p>
        <div className="lq-vd__fileinfo">
          <b>{videos.length ? `已上传 ${videos.length} 段视频` : "未上传"}</b>
          <p>可一次多选。建议每段 10 秒以上，画面稳一点。</p>
        </div>
        <FilePick
          label={videos.length ? "继续添加" : "选择视频"}
          accept="video/*"
          multiple
          onPick={(files) => setVideos((current) => [...current, ...files.map((file) => file.name)])}
        />
        {videos.length > 0 && (
          <>
            <div className="lq-vd__files">
              {videos.map((name, index) => (
                <span className="lq-vd__filechip" key={`${name}-${index}`}>🎞 片段 {index + 1} · <b>{name}</b></span>
              ))}
            </div>
            <button className="lq-vd__btn ghost" type="button" onClick={() => setVideos([])}>清空重传</button>
          </>
        )}

        <div className="lq-vd__field" style={{ marginTop: 18 }}>
          <label>成片用途 <span className="tag green">必选</span></label>
          <div className="lq-vd__opts">
            {CLIP_TEMPLATES.map((item) => (
              <button
                key={item.k}
                type="button"
                className={`lq-vd__opt${template === item.k ? " on" : ""}`}
                onClick={() => setTemplate(item.k)}
              >
                <b>{item.ico} {item.n}</b>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lq-vd__field">
          <label>成片时长</label>
          <div className="lq-vd__opts three">
            {CLIP_LENGTHS.map((item) => (
              <button
                key={item.k}
                type="button"
                className={`lq-vd__opt${length === item.k ? " on" : ""}`}
                onClick={() => setLength(item.k)}
              >
                <b>{item.n}</b>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lq-vd__field">
          <label>AI 自动处理 <span className="tag opt">可多选</span></label>
          <div className="lq-vd__chips">
            {CLIP_OPTS.map((item) => (
              <button
                key={item.k}
                type="button"
                className={`lq-vd__chip${opts[item.k] ? " on" : ""}`}
                onClick={() => setOpts((current) => ({ ...current, [item.k]: !current[item.k] }))}
              >
                {item.n}
              </button>
            ))}
          </div>
        </div>

        <label className="lq-vd__consent">
          <input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); if (event.target.checked) setWarn(false); }} />
          <span className="cb-txt">{CLIP_CONSENT}</span>
        </label>
        {warn && <div className="lq-vd__consentwarn">⚠ 需先勾选素材授权再剪辑（合规要求）</div>}
        <button
          className="lq-vd__btn primary block"
          type="button"
          onClick={() => {
            if (!consent) { setWarn(true); return; }
            if (!videos.length) { flash("请先上传至少 1 段原始视频。"); return; }
            window.alert(RENDERING_OFFLINE_MSG);
          }}
        >
          AI 开始剪辑
        </button>
      </section>

      <section className="lq-vd__right">
        <div className="lq-vd__sec-title">AI 剪辑 · 设置 <span className="lq-vd__badge">{tpl.n}</span></div>
        <div className="lq-vd__card">
          <div className="lq-vd__kv"><span className="k">成片用途</span><span className="v">{tpl.n}</span></div>
          <div className="lq-vd__kv"><span className="k">成片时长</span><span className="v">{lenName}</span></div>
          <div className="lq-vd__kv"><span className="k">原始视频</span><span className="v">{videos.length} 段</span></div>
          <div className="lq-vd__kv"><span className="k">AI 自动处理</span><span className="v">{optText}</span></div>
          <div className="lq-vd__kv"><span className="k">素材授权</span><span className="v">{consent ? "✅ 已确认（合规）" : "⚠ 未确认"}</span></div>
          <div className="lq-vd__kv"><span className="k">输出</span><span className="v">MP4 · 9:16 / 16:9 自适应 · 附音乐版权说明</span></div>
        </div>
        <div className="lq-vd__placeholder">
          左侧传好自己拍的视频、选好用途与时长<br />点「AI 开始剪辑」，右侧这里出成片<br /><br />
          当前选择：<b>{tpl.n}</b> · <b>{lenName}</b><br />
          <span className="lq-vd__hint">门店：{storeName}</span>
        </div>
        <div className="lq-vd__offline">
          <div className="ico">🔌</div>
          <h3>出片服务暂未开通</h3>
          <p>{RENDERING_OFFLINE_MSG}</p>
          <p className="lq-vd__hint">剪辑流程：分镜切分、语音转写对轴字幕、BGM 卡点与成片渲染全自动，约 60–120 秒出片。按当前设置，预计成片精选 <b>{shots}</b> 个镜头。</p>
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────── 模式 4：文案转片 ──────────────────────────────

/** 一键成片第 2 步的一版候选文案（后端大模型生成，字数与预估时长由后端算）。 */
interface CopyCandidate {
  id: string;
  style: string;
  styleLabel: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  chars: number;
  durEst: number;
  chosen: boolean;
  fullText: string;
}

/** 文案风格 / 目标时长：与后端 `video-copy-service.ts` 的 key 一一对应（界面不出现任何厂商名）。 */
const COPY_STYLES = [
  { k: "hook", n: "痛点钩子", d: "前 3 秒戳痛点，转化最猛" },
  { k: "story", n: "故事信任", d: "老板亲述，适合 IP 号" },
  { k: "dry", n: "干货科普", d: "讲知识，涨粉收藏" },
  { k: "promo", n: "促销活动", d: "限时钩子，拉到店" }
];

const COPY_DURS = [
  { k: 15, n: "15 秒左右", d: "1–2 个分镜 · 快节奏" },
  { k: 30, n: "30 秒左右", d: "2–3 个分镜 · 最常用" },
  { k: 45, n: "45 秒以上", d: "3+ 个分镜 · 讲透一件事" }
];

const COPY_STEPS = ["说需求", "AI 生成文案", "AI 分镜脚本", "传素材卡", "积分预算", "成片"];

/**
 * 一键成片 · 第 1–2 步：门店老板写不出文案，所以先说需求，由**后端大模型**写 3 版候选；
 * 选定一版后交给 `ScriptMode` 从第 3 步（AI 分镜脚本）接管 → 素材卡 → 积分预算 → 成片。
 * 本期没有「手动贴文案」入口；生成失败只能「换一批」或退回第 1 步补信息。
 */
function OneClickCopyMode({ storeId, storeName, flash }: { storeId: string; storeName: string; flash: (message: string) => void }) {
  const [need, setNeed] = useState("");
  const [style, setStyle] = useState("hook");
  const [dur, setDur] = useState(30);
  const [sell, setSell] = useState("");
  const [plat, setPlat] = useState("all");
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<CopyCandidate[]>([]);
  const [chosen, setChosen] = useState<CopyCandidate | null>(null);

  const generate = useCallback(
    async (nextRound: number) => {
      const text = need.trim();
      if (!text) {
        setError("请先用一句话说清这条视频要推广什么。");
        return;
      }
      if (!storeId) {
        setError("门店信息还在加载，请稍后再试一次。");
        return;
      }
      setError("");
      setBusy(true);
      try {
        const response = await fetch(apiPath("/lanqi/acquire/video/copy-candidates"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ storeId, need: text, cat: "skin", style, dur, sell: sell.trim(), plat, round: nextRound })
        });
        const body = await readResponse(response);
        const list: CopyCandidate[] = body?.result?.candidates ?? [];
        if (list.length < 3) throw new Error("这次没有生成出 3 版文案，请点「换一批」重试。");
        setCandidates(list);
        setWarnings(Array.isArray(body?.result?.warnings) ? body.result.warnings : []);
        setRound(nextRound);
        flash("文案已生成，挑一版用。");
      } catch (err) {
        setCandidates([]);
        setError(err instanceof Error && err.message ? err.message : "这次没有生成出可用的文案，请点「换一批」重试，或退回第 1 步把需求再说具体一点。");
      } finally {
        setBusy(false);
      }
    },
    [dur, flash, need, plat, sell, storeId, style]
  );

  // 选定一版后：第 3–6 步由分镜流程接管。
  if (chosen) {
    return <ScriptMode key={chosen.id} storeId={storeId} storeName={storeName} flash={flash} initialScript={chosen.fullText} />;
  }

  const stage = candidates.length ? 2 : 1;
  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">一键成片 · 第 {stage} 步 / 6 · {COPY_STEPS[stage - 1]}</div>
        {stage === 1 ? (
          <>
            <h3 className="lq-vd__card-title">这条视频要推广什么 <span className="tag green">必填</span></h3>
            <p className="lq-vd__card-sub">一句话说清就行，剩下的文案交给 AI 写 —— 你不需要自己写口播稿。</p>
            <div className="lq-vd__field">
              <label htmlFor="lq-copy-need">一句话需求 <span className="req">*</span></label>
              <div className="lq-vd__kw">
                <span className="lead-ico" aria-hidden="true">💬</span>
                <input
                  id="lq-copy-need"
                  value={need}
                  placeholder="如：推广祛痘体验课，想让同城客到店"
                  onChange={(event) => setNeed(event.target.value)}
                />
              </div>
              <p className="lq-vd__hint">例：推广祛痘体验课 / 拉老客回店做肩颈 / 招同城探店达人</p>
            </div>
            <div className="lq-vd__field">
              <label>文案风格 <span className="tag opt">第 1 版按你选的风格写</span></label>
              <div className="lq-vd__chips">
                {COPY_STYLES.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__chip${style === item.k ? " on" : ""}`}
                    onClick={() => setStyle(item.k)}
                  >
                    {item.n}
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-vd__field">
              <label>目标时长</label>
              <div className="lq-vd__opts three">
                {COPY_DURS.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__opt${dur === item.k ? " on" : ""}`}
                    onClick={() => setDur(item.k)}
                  >
                    <b>{item.n}</b>
                    <span>{item.d}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-vd__field">
              <label htmlFor="lq-copy-sell">主打卖点 <span className="tag opt">可选</span></label>
              <input
                id="lq-copy-sell"
                className="lq-vd__input"
                value={sell}
                placeholder="如：先做肤质检测，不办卡也能做"
                onChange={(event) => setSell(event.target.value)}
              />
            </div>
            <div className="lq-vd__field">
              <label>投放平台</label>
              <div className="lq-vd__chips">
                {PLATFORMS.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__chip${plat === item.k ? " on" : ""}`}
                    onClick={() => setPlat(item.k)}
                  >
                    {item.n}
                  </button>
                ))}
              </div>
            </div>
            <button className="lq-vd__btn primary block" type="button" disabled={busy || !need.trim()} onClick={() => void generate(0)}>
              {busy ? "⏳ AI 正在写文案…" : "✨ 让 AI 写 3 版文案"}
            </button>
            {error && <p className="lq-vd__hint">{error}</p>}
          </>
        ) : (
          <>
            <h3 className="lq-vd__card-title">本次需求</h3>
            <div className="lq-vd__card">
              <div className="lq-vd__kv"><span className="k">需求</span><span className="v">{need.trim()}</span></div>
              <div className="lq-vd__kv"><span className="k">风格</span><span className="v">{COPY_STYLES.find((item) => item.k === style)?.n}</span></div>
              <div className="lq-vd__kv"><span className="k">时长</span><span className="v">{dur} 秒左右</span></div>
              <div className="lq-vd__kv"><span className="k">卖点</span><span className="v">{sell.trim() || "（没填 · AI 不会自己编）"}</span></div>
              <div className="lq-vd__kv"><span className="k">平台</span><span className="v">{PLATFORMS.find((item) => item.k === plat)?.n}</span></div>
            </div>
            <p className="lq-vd__card-sub">右边挑一版，点「用这版」直接进分镜；换一批 = 保留你选的风格那版，只换另外两版。</p>
            <button className="lq-vd__btn ghost" type="button" disabled={busy} onClick={() => { setCandidates([]); setError(""); }}>
              ← 回去改需求
            </button>
            {warnings.map((item) => (
              <p className="lq-vd__hint" key={item}>⚠️ {item}</p>
            ))}
          </>
        )}
      </section>

      <section className="lq-vd__right">
        {stage === 1 ? (
          <>
            <div className="lq-vd__sec-title">一键成片怎么做 <span className="lq-vd__badge">6 步</span></div>
            {COPY_STEPS.map((label, index) => (
              <div className={`lq-vd__step${index === 0 ? " on" : ""}`} key={label}>
                <span className="n">{index + 1}</span>
                <span>{label}</span>
              </div>
            ))}
            <div className="lq-vd__note">
              门店老板写不出文案，这是做视频最大的卡点 —— 所以第 1 步只说需求，文案和分镜都由 AI 出；<br />
              你只需要挑一版、传素材、确认预算，最后看成片。
            </div>
          </>
        ) : (
          <>
            <div className="lq-vd__sec-title">AI 写的 3 版文案 <span className="lq-vd__badge">{round ? `第 ${round + 1} 批` : "按你选的风格"}</span></div>
            {candidates.map((candidate) => (
              <div className="lq-vd__card" key={candidate.id}>
                <div className="lq-vd__hit-top">
                  <span className="lq-vd__hit-badge">{candidate.styleLabel}</span>
                  {candidate.chosen && <span className="lq-vd__hit-kind">按你选的风格</span>}
                  <span className="lq-vd__hit-site">{candidate.chars} 字 · 约 {candidate.durEst} 秒</span>
                </div>
                <p className="lq-vd__hit-title">{candidate.title}</p>
                <p className="lq-vd__hit-snippet">【钩子】{candidate.hook}</p>
                <p className="lq-vd__hit-snippet">{candidate.body}</p>
                <p className="lq-vd__hit-snippet">【结尾】{candidate.cta}</p>
                <button className="lq-vd__btn primary block" type="button" onClick={() => setChosen(candidate)}>
                  用这版 → 进分镜
                </button>
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" disabled={busy} onClick={() => void generate(round + 1)}>
              {busy ? "⏳ 正在换一批…" : "↻ 换一批（保留第 1 版）"}
            </button>
            {error && <p className="lq-vd__hint">{error}</p>}
            <div className="lq-vd__warn">
              这 3 版由平台内置能力生成（你不用注册任何账号）。生成失败的处理顺序：<b>换一批 → 退回第 1 步把需求说具体</b>。
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ScriptMode({
  storeId,
  storeName,
  flash,
  initialScript = ""
}: {
  storeId: string;
  storeName: string;
  flash: (message: string) => void;
  initialScript?: string;
}) {
  // 0912 一期：第 1–2 步（说需求 / AI 写文案）在 OneClickCopyMode 里完成，
  // 本组件从第 3 步「AI 分镜脚本」接管，所以初始 step = 2（且不再有「手动贴文案」入口）。
  const [step, setStep] = useState(2);
  const [script, setScript] = useState(initialScript);
  const [splitMode, setSplitMode] = useState("auto");
  const [styleKey, setStyleKey] = useState("cinema");
  const [tierKey, setTierKey] = useState("std");
  const [board, setBoard] = useState<StoryboardResult | null>(null);
  const [shots, setShots] = useState<StoryboardShot[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mapping, setMapping] = useState<Record<number, { cast?: string; scene?: string; prop?: string }>>({});
  const [casts, setCasts] = useState<CastCard[]>([{ id: 1, name: "老板本人", imgs: [null, null, null] }]);
  const [scenes, setScenes] = useState<SceneCard[]>([{ id: 1, name: "门店前台", imgs: [] }]);
  const [props, setProps] = useState<PropCard[]>([]);
  const [audios, setAudios] = useState<AudioCard[]>([{ id: 1, name: "轻柔钢琴 BGM", kind: "bgm", file: null, fileId: null, mediaKind: null }]);
  const [audioTrackId, setAudioTrackId] = useState(1);
  const [audioRights, setAudioRights] = useState(false);
  const [audioBusy, setAudioBusy] = useState(0);
  const [composeState, setComposeState] = useState<{ status: "idle" | "running" | "succeeded" | "failed"; objectUrl?: string; message?: string; durationSeconds?: number; audioIncluded?: boolean }>({ status: "idle" });
  const [refs, setRefs] = useState<File[]>([]);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentWarn, setConsentWarn] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [shotsRender, setShotsRender] = useState<Record<number, ShotRender>>({});
  const [rendering, setRendering] = useState(false);

  const tier = TIERS.find((item) => item.k === tierKey) ?? TIERS[1];
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const renderedCount = shots.filter((shot) => shotsRender[shot.no]?.status === "succeeded").length;
  const usedCredits = shots.reduce((sum, shot) => sum + (shotsRender[shot.no]?.creditCost ?? 0), 0);
  /** 本片音轨：用户显式选中的那一段；没选中时退回第一条已上传的音轨。 */
  const activeAudio = audios.find((item) => item.id === audioTrackId && item.fileId) ?? audios.find((item) => item.fileId) ?? null;
  const succeededShotIds = shots.map((shot) => shotsRender[shot.no]).filter((item) => item?.status === "succeeded" && item.jobId).map((item) => item.jobId as string);
  const allShotsReady = shots.length > 0 && succeededShotIds.length === shots.length && shots.length >= 2;
  const sceneNames = scenes.map((item) => item.name).filter(Boolean);
  const propNames = props.map((item) => item.name).filter(Boolean);
  const castNames = casts.map((item) => item.name).filter(Boolean);
  const imgCount = useMemo(() => {
    const castImgs = casts.reduce((sum, item) => sum + item.imgs.filter(Boolean).length, 0);
    const sceneImgs = scenes.reduce((sum, item) => sum + item.imgs.length, 0);
    const propImgs = props.filter((item) => item.img).length;
    return castImgs + sceneImgs + propImgs + refs.length;
  }, [casts, scenes, props, refs]);

  const FbTAGS = ["人物形象不像", "口型/配音不同步", "背景/场景不自然", "动作僵硬", "分镜/文案顺序不对", "色调/风格不满意", "产品展示不清楚", "其他"];

  const buildStoryboard = useCallback(async () => {
    setError("");
    if (!script.trim()) { setError("请先选一版文案。"); return; }
    if (!storeId) { setError("门店信息还在加载，请稍后再试一次。"); return; }
    setBusy("正在按语义断句、切分镜、补生视频提示词…");
    try {
      const response = await fetch(apiPath("/lanqi/acquire/video/storyboard"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          storeId,
          script,
          styleKey,
          splitMode,
          castName: castNames[0],
          sceneNames,
          propNames
        })
      });
      const body = await readResponse(response);
      const result: StoryboardResult = body.result;
      setBoard(result);
      setShots(result.shots);
      setMapping({});
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分镜生成失败");
    } finally {
      setBusy("");
    }
  }, [script, storeId, styleKey, splitMode, castNames, sceneNames, propNames]);

  /** 一键成片：选定文案后自动出分镜（用户不必再点一次「生成分镜脚本」）。 */
  const autoBuilt = useRef(false);
  useEffect(() => {
    if (!initialScript.trim() || autoBuilt.current) return;
    autoBuilt.current = true;
    void buildStoryboard();
  }, [buildStoryboard, initialScript]);

  const rebuildOne = useCallback(
    async (index: number) => {
      const shot = shots[index];
      if (!shot) return;
      const map = mapping[shot.no] ?? {};
      setBusy(`正在重写第 ${shot.no} 镜…`);
      try {
        const response = await fetch(apiPath("/lanqi/acquire/video/shot"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            storeId,
            text: shot.text,
            styleKey,
            castName: map.cast ?? castNames[0],
            sceneName: map.scene ?? sceneNames[index % Math.max(1, sceneNames.length)],
            propName: map.prop ?? propNames[index % Math.max(1, propNames.length)],
            index,
            total: shots.length
          })
        });
        const body = await readResponse(response);
        const rebuilt: StoryboardShot = body.result;
        setShots((current) => current.map((item, i) => (i === index ? { ...item, ...rebuilt, no: item.no } : item)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "这一镜重写失败");
      } finally {
        setBusy("");
      }
    },
    [shots, mapping, storeId, styleKey, castNames, sceneNames, propNames]
  );

  /** 传完素材后：把人物 / 场景 / 道具名补进每一镜的提示词。 */
  const refreshPrompts = useCallback(async () => {
    if (!shots.length || !storeId) return;
    setBusy("正在把素材名补进每一镜的生视频提示词…");
    try {
      const rebuilt = await Promise.all(
        shots.map(async (shot, index) => {
          const map = mapping[shot.no] ?? {};
          const response = await fetch(apiPath("/lanqi/acquire/video/shot"), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              storeId,
              text: shot.text,
              styleKey,
              castName: map.cast ?? castNames[0],
              sceneName: map.scene ?? sceneNames[index % Math.max(1, sceneNames.length)],
              propName: map.prop ?? propNames[index % Math.max(1, propNames.length)],
              index,
              total: shots.length
            })
          });
          const body = await readResponse(response);
          return { ...(body.result as StoryboardShot), no: shot.no };
        })
      );
      setShots(rebuilt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提示词刷新失败");
    } finally {
      setBusy("");
    }
  }, [shots, mapping, storeId, styleKey, castNames, sceneNames, propNames]);

  const exportPrompts = useCallback(() => {
    const lines: string[] = [
      `兰琪美业 · 文案转片提示词（${storeName}）`,
      `画面风格：${SCRIPT_STYLES.find((item) => item.k === styleKey)?.n ?? ""} · 画质档位：${tier.n}（${tier.res}）`,
      `分镜 ${shots.length} 镜 · 合计 ${totalSeconds} 秒`,
      ""
    ];
    shots.forEach((shot) => {
      lines.push(`── 分镜 ${shot.no} · ${shot.seconds} 秒 · ${shot.kind} ──`);
      lines.push(`口播原句：${shot.text}`);
      lines.push(`画面描述：${shot.desc}`);
      lines.push(`生视频提示词：${shot.prompt}`);
      lines.push(`负面提示词：${shot.negative}`);
      lines.push("");
    });
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `兰琪文案转片提示词_${shots.length}镜.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash("已导出提示词 TXT。");
  }, [shots, totalSeconds, styleKey, tier, storeName, flash]);

  const markShot = useCallback((no: number, patch: Partial<ShotRender>) => {
    setShotsRender((current) => ({ ...current, [no]: { ...current[no], no, status: current[no]?.status ?? "queued", ...patch } }));
  }, []);

  /**
   * 这一镜用哪张人物正面照当首帧图。
   * 缺图时明确告诉老板「缺谁的正脸、回第 3 步补」，绝不静默降级成没有本人的文生视频。
   */
  const firstFrameFileFor = useCallback(
    (index: number): { file?: File; castName: string; block?: string } => {
      const shot = shots[index];
      if (!shot) return { castName: "", block: "这一镜不存在了，请刷新页面重试。" };
      const map = mapping[shot.no] ?? {};
      const targetName = map.cast ?? castNames[0];
      const card = casts.find((item) => item.name === targetName) ?? casts[0];
      if (!card) return { castName: "", block: "还没有人物卡。先回第 3 步上传一张人物正面照。" };
      const label = card.name || `人物 ${card.id}`;
      const file = card.imgs.find((item): item is File => Boolean(item));
      if (!file) return { castName: label, block: `「${label}」还缺正面照（首帧图）。先回第 3 步把正面照传上，再回来生成这一镜。` };
      return { file, castName: label };
    },
    [shots, mapping, casts, castNames]
  );

  /** 轮询到结果后，把成片按带登录态的请求取回来（媒体接口要 token，不能直接当 video src）。 */
  const fetchShotAsset = useCallback(async (jobId: string): Promise<string> => {
    const response = await fetch(apiPath(`/lanqi/media/assets/${jobId}`), { headers: authHeaders() });
    if (!response.ok) throw new Error("成片已经生成，但这次没取回来。点「重新取回」再试一次，不会重复扣费。");
    const blob = await response.blob();
    if (!blob.size) throw new Error("成片已经生成，但这次没取回来。点「重新取回」再试一次，不会重复扣费。");
    return URL.createObjectURL(blob);
  }, []);

  /** 从已提交的任务继续看结果（刷新页面 / 上一轮轮询超时后用），不会新建任务、不会二次扣费。 */
  const resumeShot = useCallback(
    async (no: number) => {
      const jobId = shotsRender[no]?.jobId;
      if (!jobId) return;
      setError("");
      markShot(no, { status: "running", message: undefined });
      try {
        const response = await fetch(apiPath(`/lanqi/media/jobs/${jobId}/refresh`), { method: "POST", headers: authHeaders() });
        const body = await response.json().catch(() => ({}));
        const job = body.job;
        if (job?.status === "succeeded") {
          const objectUrl = await fetchShotAsset(jobId);
          markShot(no, { status: "succeeded", objectUrl, creditCost: job.creditCost, message: undefined });
          flash(`第 ${no} 镜已出片。`);
          return;
        }
        if (job?.status === "failed" || job?.status === "canceled") {
          markShot(no, { status: "failed", message: job.errorMessage ?? "这一镜没出成片，预留积分已自动退回。" });
          return;
        }
        markShot(no, { status: "running", message: body.message ?? "还在生成中，稍后再点一次「查询结果」。" });
      } catch (cause) {
        markShot(no, { status: "failed", message: cause instanceof Error ? cause.message : "查询失败，请稍后再试。" });
      }
    },
    [shotsRender, markShot, fetchShotAsset, flash]
  );

  /** 单镜真实出片：首帧图 → 费用预览 → 明确确认 → 轮询 → 取回成片。失败不显示成片、不重复扣费。 */
  const renderShot = useCallback(
    async (index: number) => {
      const shot = shots[index];
      if (!shot) return;
      const no = shot.no;
      const pick = firstFrameFileFor(index);
      if (!pick.file) {
        setError(pick.block ?? "这一镜缺人物正面照，先回第 3 步上传。");
        markShot(no, { status: "failed", message: pick.block ?? "这一镜缺人物正面照。" });
        return;
      }
      setError("");
      markShot(no, { status: "queued", message: "正在读取首帧图…", objectUrl: undefined });
      try {
        const dataBase64 = await readFirstFrameBase64(pick.file);
        const payload = {
          kind: "image_to_video" as const,
          prompt: shot.prompt,
          negativePrompt: shot.negative,
          resolution: SHOT_TIER_RES[tierKey] ?? "720P",
          durationSeconds: shot.seconds,
          firstFrame: { contentType: "image/jpeg", dataBase64 }
        };
        const quoteResponse = await fetch(apiPath("/lanqi/media/quote"), { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
        const quote = await readResponse(quoteResponse);
        if (!quote.canConfirm) {
          markShot(no, { status: "failed", message: quote.message ?? "视频生成能力当前没有放行，本次没有创建任务、没有扣积分。" });
          return;
        }
        markShot(no, { status: "queued", message: `已锁定费用 ${quote.creditCost} 积分，正在创建任务…`, creditCost: quote.creditCost });
        const requestKey = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
        const confirmResponse = await fetch(apiPath("/lanqi/media/confirm"), {
          method: "POST",
          headers: { ...authHeaders(), "X-Idempotency-Key": requestKey },
          body: JSON.stringify({ ...payload, requestKey, confirmed: true })
        });
        const confirmed = await readResponse(confirmResponse);
        const job = confirmed.job;
        markShot(no, { status: "running", jobId: job.id, creditCost: job.creditCost, message: "任务已提交，正在生成这一镜…" });
        let latest = job;
        for (let attempt = 0; attempt < VIDEO_POLL_LIMIT; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
          const refreshResponse = await fetch(apiPath(`/lanqi/media/jobs/${job.id}/refresh`), { method: "POST", headers: authHeaders() });
          const body = await refreshResponse.json().catch(() => ({}));
          if (!refreshResponse.ok) {
            const failedJob = body.job;
            if (failedJob && ["failed", "canceled"].includes(failedJob.status)) {
              markShot(no, { status: "failed", message: failedJob.errorMessage ?? body.message ?? "这一镜没出成片，预留积分已自动退回。" });
              return;
            }
            throw new Error(body.message ?? "生成状态暂时刷不出来，任务还在跑。点「查询结果」可以继续看，不会重复扣费。");
          }
          latest = body.job;
          if (latest.status === "succeeded") break;
          if (latest.status === "failed" || latest.status === "canceled") {
            markShot(no, { status: "failed", message: latest.errorMessage ?? "这一镜没出成片，预留积分已自动退回。" });
            return;
          }
        }
        if (latest.status !== "succeeded") {
          markShot(no, { status: "running", message: "这一镜还在生成。点「查询结果」继续看，不会重复扣费。" });
          return;
        }
        const objectUrl = await fetchShotAsset(job.id);
        markShot(no, { status: "succeeded", objectUrl, creditCost: latest.creditCost ?? job.creditCost, message: undefined });
        flash(`第 ${no} 镜已出片。`);
      } catch (cause) {
        markShot(no, { status: "failed", message: cause instanceof Error ? cause.message : "这一镜生成失败。" });
      }
    },
    [shots, firstFrameFileFor, markShot, tierKey, fetchShotAsset, flash]
  );

  /** 整片出片：按分镜顺序逐镜生成，上一镜没出结果就停下，不并发烧钱。 */
  const renderAll = useCallback(async () => {
    if (rendering || !shots.length) return;
    setRendering(true);
    try {
      for (let index = 0; index < shots.length; index += 1) {
        const no = shots[index].no;
        if (shotsRender[no]?.status === "succeeded") continue;
        await renderShot(index);
      }
    } finally {
      setRendering(false);
    }
  }, [rendering, shots, shotsRender, renderShot]);

  const downloadShot = useCallback((no: number) => {
    const objectUrl = shotsRender[no]?.objectUrl;
    if (!objectUrl) return;
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `兰琪成片_第${no}镜.mp4`;
    anchor.click();
  }, [shotsRender]);

  /**
   * LQ-32 音轨上传：音频直接用；视频由后端 ffmpeg 抽音。
   * 上传走平台既有 `POST /files`，租户隔离与文件归属沿用同一套。
   */
  const uploadAudioTrack = useCallback(
    async (cardId: number, file: File) => {
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      if (!isAudio && !isVideo) {
        setError("音轨只支持音频文件（MP3 / WAV / M4A），或一段带声音的 MP4 / MOV。");
        return;
      }
      if (file.size > AUDIO_MAX_MB * 1024 * 1024) {
        setError(`音轨文件不能超过 ${AUDIO_MAX_MB}MB，请先裁短或压缩再上传。`);
        return;
      }
      setError("");
      setAudioBusy(cardId);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(apiPath("/files"), { method: "POST", headers: uploadHeaders(), body: form });
        const body = await readResponse(response);
        const fileId = body?.file?.id;
        if (!fileId) throw new Error("音轨上传失败，请重试。");
        setAudios((current) =>
          current.map((item) =>
            item.id === cardId ? { ...item, file: file.name, fileId, mediaKind: isVideo ? "video" : "audio" } : item
          )
        );
        setAudioTrackId(cardId);
        flash(isVideo ? `已上传「${file.name}」，成片时会抽取其中的声音作为音轨。` : `已上传音轨「${file.name}」。`);
      } catch (cause) {
        setError(cause instanceof Error && cause.message ? cause.message : "音轨上传失败，请重试。");
      } finally {
        setAudioBusy(0);
      }
    },
    [flash]
  );

  /**
   * LQ-32 合成成片：把已出片的镜次按分镜顺序拼成一条，并混入本片音轨。
   * 合片与混音都是本机 ffmpeg，不额外扣积分；没出片 / 没授权时不发请求。
   */
  const composeFilm = useCallback(async () => {
    if (!allShotsReady) {
      setError("先把每一镜都出片成功，再合成整条成片。");
      return;
    }
    if (activeAudio?.fileId && !audioRights) {
      setError("带音轨的成片要先勾选音频授权（你拥有这段音频 / 视频的使用权）。");
      return;
    }
    setError("");
    setComposeState({ status: "running", message: "正在把各镜拼成一条并混入音轨，请别关页面…" });
    try {
      const requestKey = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
      const payload: Record<string, unknown> = { shotJobIds: succeededShotIds, requestKey };
      if (activeAudio?.fileId) {
        payload.audioFileId = activeAudio.fileId;
        payload.audioRightsConfirmed = true;
      }
      const response = await fetch(apiPath("/lanqi/media/compose"), { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
      const body = await readResponse(response);
      const composeId = body?.compose?.composeId;
      if (!composeId) throw new Error("合成没有返回结果，请重试。");
      const assetResponse = await fetch(apiPath(`/lanqi/media/compose/${composeId}`), { headers: authHeaders() });
      if (!assetResponse.ok) throw new Error("成片已合成，但这次没取回来。重新点一次「合成成片」不会重复扣积分。");
      const blob = await assetResponse.blob();
      if (!blob.size) throw new Error("成片已合成，但这次没取回来。重新点一次「合成成片」不会重复扣积分。");
      setComposeState({
        status: "succeeded",
        objectUrl: URL.createObjectURL(blob),
        message: body.compose.notice,
        durationSeconds: body.compose.durationSeconds,
        audioIncluded: Boolean(body.compose.audioIncluded),
      });
      flash("成片已合成，可以播放或下载整条片子。");
    } catch (cause) {
      setComposeState({ status: "failed", message: cause instanceof Error && cause.message ? cause.message : "合成失败，请重试。" });
    }
  }, [allShotsReady, activeAudio, audioRights, succeededShotIds, flash]);

  const downloadComposed = useCallback(() => {
    if (!composeState.objectUrl) return;
    const anchor = document.createElement("a");
    anchor.href = composeState.objectUrl;
    anchor.download = "兰琪一键成片.mp4";
    anchor.click();
  }, [composeState.objectUrl]);

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">
          {rendering || renderedCount > 0 || Object.keys(shotsRender).length > 0
            ? `一键成片 · 第 6 步 / 6 · ${COPY_STEPS[5]}`
            : `一键成片 · 第 ${step + 1} 步 / 6 · ${COPY_STEPS[step]}`}
        </div>

        {step === 2 && (
          <>
            <h3 className="lq-vd__card-title">分镜已出 <span className="tag green">{shots.length} 镜</span></h3>
            <p className="lq-vd__card-sub">右侧逐镜确认：口播原句、画面描述、生视频提示词都能直接改，改完再进下一步。</p>
            <div className="lq-vd__card">
              <div className="lq-vd__kv"><span className="k">原文</span><span className="v">{board?.sourceChars ?? 0} 字</span></div>
              <div className="lq-vd__kv"><span className="k">分镜</span><span className="v">{shots.length} 镜 · {totalSeconds} 秒</span></div>
              <div className="lq-vd__kv"><span className="k">画面风格</span><span className="v">{SCRIPT_STYLES.find((item) => item.k === styleKey)?.n}</span></div>
              <div className="lq-vd__kv"><span className="k">切分规则</span><span className="v">{board?.splitMode?.n ?? splitMode}</span></div>
            </div>
            <div className="lq-vd__field" style={{ marginTop: 12 }}>
              <label>切分规则</label>
              <div className="lq-vd__opts three">
                {SPLIT_MODES.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__opt${splitMode === item.k ? " on" : ""}`}
                    onClick={() => setSplitMode(item.k)}
                  >
                    <b>{item.n}</b>
                    <span>{item.d}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-vd__field">
              <label>画面风格</label>
              <div className="lq-vd__chips">
                {SCRIPT_STYLES.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__chip${styleKey === item.k ? " on" : ""}`}
                    onClick={() => setStyleKey(item.k)}
                  >
                    {item.n}
                  </button>
                ))}
              </div>
            </div>
            <button className="lq-vd__btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void buildStoryboard()}>
              {busy ? "正在重新切分…" : "↻ 重新切分"}
            </button>
            <button className="lq-vd__btn ghost" type="button" onClick={exportPrompts}>⬇ 导出提示词（TXT）</button>
            <button className="lq-vd__btn primary block" type="button" onClick={() => setStep(3)}>📦 下一步：上传素材卡</button>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="lq-vd__card-title">① 人物卡 <span className="tag green">必填 · 三视图</span></h3>
            <p className="lq-vd__card-sub">同一个人拍 正面 / 侧面 / 背面 三张。正面做首帧，侧背做参考，让跨镜头不跑脸。</p>
            {casts.map((cast) => (
              <div className="lq-vd__sg" key={cast.id}>
                <div className="sg-head">
                  <span className="sg-idx">人物 {cast.id}</span>
                  <input
                    className="sg-name"
                    value={cast.name}
                    placeholder="如：老板本人"
                    onChange={(event) =>
                      setCasts((current) => current.map((item) => (item.id === cast.id ? { ...item, name: event.target.value } : item)))
                    }
                  />
                  {casts.length > 1 && (
                    <button className="sg-del" type="button" onClick={() => setCasts((current) => current.filter((item) => item.id !== cast.id))}>✕</button>
                  )}
                </div>
                <div className="lq-vd__angles">
                  {CAST_ANGLES.map((angle, index) => (
                    <div className="ang" key={angle.k}>
                      <div className="ang-cap">{angle.ico} {angle.n}</div>
                      <FilePick
                        label={cast.imgs[index] ? "已选" : "选择"}
                        onPick={(files) =>
                          setCasts((current) =>
                            current.map((item) => {
                              if (item.id !== cast.id) return item;
                              const imgs = [...item.imgs];
                              imgs[index] = files[0] ?? null;
                              return { ...item, imgs };
                            })
                          )
                        }
                      />
                      <div className="ang-role">{angle.role}{cast.imgs[index] ? ` · ${cast.imgs[index]?.name}` : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" onClick={() => setCasts((current) => [...current, { id: current.length + 1, name: "", imgs: [null, null, null] }])}>
              + 再加一个出镜人
            </button>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>② 场景卡 <span className="tag green">想呈现在哪个场景</span></h3>
            <p className="lq-vd__card-sub">你想让这条片子发生在哪，就传哪。每个场景可传 1–3 张，第 1 张做主图 / 首帧，其余做补充参考。</p>
            {scenes.map((scene) => (
              <div className="lq-vd__sg" key={scene.id}>
                <div className="sg-head">
                  <span className="sg-idx">场景 {scene.id}</span>
                  <input
                    className="sg-name"
                    value={scene.name}
                    placeholder="如：门店前台"
                    onChange={(event) =>
                      setScenes((current) => current.map((item) => (item.id === scene.id ? { ...item, name: event.target.value } : item)))
                    }
                  />
                  {scenes.length > 1 && (
                    <button className="sg-del" type="button" onClick={() => setScenes((current) => current.filter((item) => item.id !== scene.id))}>✕</button>
                  )}
                </div>
                <FilePick
                  label={scene.imgs.length ? `已选 ${scene.imgs.length} 张` : "选择图片（可多张）"}
                  multiple
                  onPick={(files) =>
                    setScenes((current) => current.map((item) => (item.id === scene.id ? { ...item, imgs: [...item.imgs, ...files].slice(0, 3) } : item)))
                  }
                />
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" onClick={() => setScenes((current) => [...current, { id: current.length + 1, name: "", imgs: [] }])}>
              + 再加一个场景
            </button>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>③ 音频卡 <span className="tag opt">可选 · ≤{MAX_AUDIOS} 段</span></h3>
            <p className="lq-vd__card-sub">
              画面由 AI 逐镜生成（模型只出<b>无声</b>画面），声音由你提供的音轨混进去：<b>上传一段音频</b>（MP3 / WAV / M4A），或<b>上传一段带声音的视频</b>，
              平台会把其中的声音抽出来当音轨。成片只会混<b>一条</b>音轨，请在你实际要用的那一段上点「设为本片音轨」。
            </p>
            {audios.map((audio) => (
              <div className="lq-vd__sg" key={audio.id}>
                <div className="sg-head">
                  <span className="sg-idx">{AUDIO_KINDS.find((item) => item.k === audio.kind)?.ico} 音频 {audio.id}</span>
                  <input
                    className="sg-name"
                    value={audio.name}
                    placeholder="如：轻柔钢琴 BGM"
                    onChange={(event) =>
                      setAudios((current) => current.map((item) => (item.id === audio.id ? { ...item, name: event.target.value } : item)))
                    }
                  />
                </div>
                <div className="lq-vd__chips">
                  {AUDIO_KINDS.map((item) => (
                    <button
                      key={item.k}
                      type="button"
                      className={`lq-vd__chip${audio.kind === item.k ? " on" : ""}`}
                      onClick={() => setAudios((current) => current.map((row) => (row.id === audio.id ? { ...row, kind: item.k } : row)))}
                    >
                      {item.ico} {item.n}
                    </button>
                  ))}
                </div>
                <div className="aud-file">{audio.file ? `已记录 · ${audio.file}` : "未记录 · 未上传音轨"}</div>
                <FilePick
                  label={
                    audioBusy === audio.id
                      ? "上传中…"
                      : audio.file
                        ? `已上传 · ${audio.file}（点此更换）`
                        : `上传音频 / 带声音的视频（≤${AUDIO_MAX_MB}MB）`
                  }
                  accept="audio/*,video/*"
                  disabled={audioBusy === audio.id}
                  onPick={(files) => {
                    const file = files[0];
                    if (file) void uploadAudioTrack(audio.id, file);
                  }}
                />
                {audio.file ? (
                  <div className="lq-vd__chips" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className={`lq-vd__chip${audioTrackId === audio.id ? " on" : ""}`}
                      onClick={() => setAudioTrackId(audio.id)}
                    >
                      {audioTrackId === audio.id ? "✅ 本片音轨" : "设为成片音轨"}
                    </button>
                    <button
                      type="button"
                      className="lq-vd__chip"
                      onClick={() => {
                        setAudios((current) =>
                          current.map((item) => (item.id === audio.id ? { ...item, file: null, fileId: null, mediaKind: null } : item))
                        );
                        setAudioRights(false);
                      }}
                    >
                      🗑 移除这段音轨
                    </button>
                    {audio.mediaKind === "video" ? <span className="lq-vd__pill on">🎧 抽音轨</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
            <button
              className="lq-vd__btn ghost"
              type="button"
              disabled={audios.length >= MAX_AUDIOS}
              onClick={() => setAudios((current) => [...current, { id: current.length + 1, name: "", kind: "ambient", file: null, fileId: null, mediaKind: null }])}
            >
              + 加一段音频（{audios.length}/{MAX_AUDIOS}）
            </button>
            {activeAudio?.fileId ? (
              <label className="lq-vd__consent">
                <input type="checkbox" checked={audioRights} onChange={(event) => setAudioRights(event.target.checked)} />
                <span className="cb-txt">{AUDIO_RIGHTS_TEXT}</span>
              </label>
            ) : (
              <div className="lq-vd__note">不上传音轨也能出片，但成片会是无声的。想带 BGM / 口播，就上传一段音轨并勾选授权。</div>
            )}

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>④ 道具卡 <span className="tag opt">可选</span></h3>
            <p className="lq-vd__card-sub">出镜的产品、仪器、工具。不传也能生成，传了画面里才认得出是你家的东西。</p>
            {props.map((prop) => (
              <div className="lq-vd__sg" key={prop.id}>
                <div className="sg-head">
                  <span className="sg-idx">道具 {prop.id}</span>
                  <input
                    className="sg-name"
                    value={prop.name}
                    placeholder="如：精华套盒"
                    onChange={(event) =>
                      setProps((current) => current.map((item) => (item.id === prop.id ? { ...item, name: event.target.value } : item)))
                    }
                  />
                  <button className="sg-del" type="button" onClick={() => setProps((current) => current.filter((item) => item.id !== prop.id))}>✕</button>
                </div>
                <FilePick
                  label={prop.img ? `已选 · ${prop.img.name}` : "选择道具图"}
                  onPick={(files) => setProps((current) => current.map((item) => (item.id === prop.id ? { ...item, img: files[0] ?? null } : item)))}
                />
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" onClick={() => setProps((current) => [...current, { id: current.length + 1, name: "", img: null }])}>
              + 加一个道具
            </button>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>⑤ 其他参考 <span className="tag opt">可选</span></h3>
            <p className="lq-vd__card-sub">不填也能跑。填了画面更贴你想要的样子。（风格参考图最多 2 张，视频参考最多 3 段）</p>
            <FilePick label={refs.length ? `已选 ${refs.length} 张风格参考图` : "选择风格参考图"} multiple onPick={(files) => setRefs((current) => [...current, ...files].slice(0, 2))} />
            <div className="lq-vd__note">
              参考图合计 <b>{imgCount}</b> / {MAX_IMGS} 张
              {imgCount > MAX_IMGS ? "，已超出单次上限，系统会按分镜所属场景自动分组调用。" : "。"}
              {board?.imageGroupingNote ? ` ${board.imageGroupingNote}` : ""}
            </div>

            <button className="lq-vd__btn ghost" type="button" onClick={() => setStep(2)}>← 上一步（改分镜）</button>
            <button className="lq-vd__btn primary block" type="button" disabled={Boolean(busy)} onClick={() => void refreshPrompts().then(() => setStep(4))}>
              {busy ? "正在补全提示词…" : "✅ 下一步：输出规格"}
            </button>
          </>
        )}

        {step === 4 && (
          <>
            <h3 className="lq-vd__card-title">⑥ 画面风格</h3>
            <div className="lq-vd__chips">
              {SCRIPT_STYLES.map((item) => (
                <button
                  key={item.k}
                  type="button"
                  className={`lq-vd__chip${styleKey === item.k ? " on" : ""}`}
                  onClick={() => setStyleKey(item.k)}
                >
                  {item.n}
                </button>
              ))}
            </div>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>⑦ 输出规格 <span className="tag green">画质档位</span></h3>
            <p className="lq-vd__card-sub">成片档位只决定画质。拿不准就先用草稿档过一遍，满意再出高清档。</p>
            <div className="lq-vd__tiers">
              {TIERS.map((item) => (
                <button
                  key={item.k}
                  type="button"
                  className={`lq-vd__tier${tierKey === item.k ? " on" : ""}`}
                  onClick={() => setTierKey(item.k)}
                >
                  <span className="ti-n">{item.ico} {item.n}</span>
                  <span className="ti-res">{item.res}</span>
                  <span className="ti-d">{item.d}</span>
                  <span className="ti-out">{item.out}</span>
                </button>
              ))}
            </div>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>⑧ 生成选项</h3>
            <div className="lq-vd__chips">
              {activeAudio?.fileId ? (
                <span className="lq-vd__pill on">
                  {activeAudio.mediaKind === "video" ? "🎧 抽音轨成片" : "🔊 带音轨成片"}{" "}
                  <span className="hint">{activeAudio.file} · 成片混这一条音轨（不额外扣积分）</span>
                </span>
              ) : (
                <span className="lq-vd__pill on">🔇 无声成片 <span className="hint">没上传音轨，成片只有画面</span></span>
              )}
              <span className="lq-vd__pill on">🔒 人物一致性锁定 <span className="hint">每镜都用同一张人物首帧图</span></span>
            </div>
            <div className="lq-vd__note">
              人物一致性锁定：AI 生视频跨多次生成会在 3–4 个镜头后出现脸漂移。本期做法是每一镜都复用同一张人物首帧图，把出镜人钉在同一个人身上。
            </div>

            <label className="lq-vd__consent">
              <input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); if (event.target.checked) setConsentWarn(false); }} />
              <span className="cb-txt">{PORTRAIT_SCRIPT}</span>
            </label>
            {consentWarn && <div className="lq-vd__consentwarn">⚠ 需先勾选肖像授权再生成（合规要求）</div>}

            <div className="lq-vd__card" style={{ marginTop: 12 }}>
              <div className="lq-vd__kv"><span className="k">成片档位</span><span className="v">{tier.n} · {tier.res}</span></div>
              <div className="lq-vd__kv"><span className="k">分镜</span><span className="v">{shots.length} 镜 · {totalSeconds} 秒</span></div>
              <div className="lq-vd__kv"><span className="k">人物卡</span><span className="v">{casts.map((item) => item.name || "未命名").join(" / ")}</span></div>
              <div className="lq-vd__kv"><span className="k">参考图</span><span className="v">{imgCount} / {MAX_IMGS} 张</span></div>
              <div className="lq-vd__kv"><span className="k">肖像授权</span><span className="v">{portraitOk ? "✅ 已确认（合规）" : consent ? "已勾选声明，待确认弹层" : "⚠ 未确认"}</span></div>
            </div>

            <button className="lq-vd__btn ghost" type="button" onClick={() => setStep(3)}>← 上一步（改素材）</button>
            <button className="lq-vd__btn ghost" type="button" onClick={exportPrompts}>⬇ 导出提示词（TXT）</button>
            <button
              className="lq-vd__btn primary block"
              type="button"
              onClick={() => {
                if (!consent) { setConsentWarn(true); return; }
                setPortraitOpen(true);
              }}
            >
              ✅ 确认并生成
            </button>
            <div className="lq-vd__warn">
              提示词已按门店行业词与镜头口径改写；真实出片由后端异步任务完成，出片后会在「我的生成」里通知你，失败分镜不重复计费。
            </div>
          </>
        )}

        {error && <p className="lq-vd__err">{error}</p>}
        {busy && <p className="lq-vd__busy">{busy}</p>}
      </section>

      <section className="lq-vd__right">
        {!shots.length && (
          <>
            <div className="lq-vd__sec-title">一键成片怎么做 <span className="lq-vd__badge">6 步</span></div>
            <div className="lq-vd__step on"><span className="n">1</span><span><b>说需求</b> · 一句话说清推广什么，不用自己写文案</span></div>
            <div className="lq-vd__step"><span className="n">2</span><span><b>AI 生成文案</b> · 出 3 版候选，每版标字数与预估时长</span></div>
            <div className="lq-vd__step"><span className="n">3</span><span><b>分镜脚本</b> · 自动切不超过 15 秒的分镜，每镜直接出<b>生视频提示词</b></span></div>
            <div className="lq-vd__step"><span className="n">4</span><span><b>传素材卡</b> · 人物 / 场景 / 道具 / 音频，提示词自动补进去</span></div>
            <div className="lq-vd__step"><span className="n">5</span><span><b>积分预算</b> · 选画质档位，看清这次要花多少积分</span></div>
            <div className="lq-vd__step"><span className="n">6</span><span><b>成片</b> · 逐镜出片，满意就下载，不满意按反馈重跑</span></div>
            <div className="lq-vd__step"><span className="n">3</span><span><b>传素材卡</b> · 人物卡（正/侧/背）+ 场景卡 + 音频卡 + 道具卡 + 其他参考</span></div>
            <div className="lq-vd__step"><span className="n">4</span><span><b>成片</b> · 选定画质档位后出片，直接发抖音 / 视频号 / 朋友圈</span></div>
            <div className="lq-vd__placeholder" style={{ height: 180 }}>
            左侧选好一版文案<br />系统自动出分镜脚本<br />右侧这里出分镜表
            </div>
          </>
        )}

        {shots.length > 0 && step <= 2 && (
          <>
            <div className="lq-vd__sec-title">
              分镜脚本 <span className="lq-vd__badge">{shots.length} 镜 · 共 {totalSeconds} 秒</span>
            </div>
            <div className="lq-vd__note">
              原文 <b>{board?.sourceChars ?? 0}</b> 字 → 按语义断句切成 <b>{shots.length}</b> 镜，每镜 ≤{MAX_SEC} 秒。
            </div>
            <div className="lq-vd__shots">
              {shots.map((shot, index) => (
                <article className="lq-vd__shot" key={shot.no}>
                  <header className="pr-top">
                    <span className="pr-no">分镜 {shot.no}</span>
                    <select
                      className="pr-sel"
                      value={shot.seconds}
                      onChange={(event) =>
                        setShots((current) => current.map((item, i) => (i === index ? { ...item, seconds: Number(event.target.value) } : item)))
                      }
                    >
                      {Array.from({ length: MAX_SEC - 3 }, (_, offset) => offset + 4).map((value) => (
                        <option key={value} value={value}>{value} 秒</option>
                      ))}
                    </select>
                    <span className="pr-tag">{shot.kind}</span>
                    <span style={{ flex: 1 }} />
                    <button className="pr-mini ghost" type="button" onClick={() => void rebuildOne(index)}>↻ 重写这镜</button>
                    <button
                      className="pr-mini ghost"
                      type="button"
                      disabled={shots.length <= 1}
                      onClick={() => setShots((current) => current.filter((_, i) => i !== index).map((item, i) => ({ ...item, no: i + 1 })))}
                    >
                      ✕ 删除
                    </button>
                  </header>
                  <div className="pr-lab">🗣 口播原句</div>
                  <div className="pr-text">{shot.text}</div>
                  <div className="pr-lab">🎥 画面描述（AI 补的镜头，可直接改）</div>
                  <textarea
                    className="pr-area"
                    value={shot.desc}
                    onChange={(event) => setShots((current) => current.map((item, i) => (i === index ? { ...item, desc: event.target.value } : item)))}
                  />
                  <div className="pr-lab">✍️ 生视频提示词（= 这镜的生视频指令，可改）</div>
                  <textarea
                    className="pr-area prompt"
                    value={shot.prompt}
                    onChange={(event) => setShots((current) => current.map((item, i) => (i === index ? { ...item, prompt: event.target.value } : item)))}
                  />
                  <div className="pr-lab">🚫 负面提示词</div>
                  <div className="pr-neg">{shot.negative}</div>
                </article>
              ))}
            </div>
            <button
              className="lq-vd__btn ghost"
              type="button"
              onClick={() => setShots((current) => [...current, { ...current[current.length - 1], no: current.length + 1, text: "", desc: "（手动加的一镜，请补画面描述）", prompt: "" }])}
            >
              + 手动加一个分镜
            </button>
          </>
        )}

        {shots.length > 0 && step === 3 && (
          <>
            <div className="lq-vd__sec-title">
              素材总览 <span className="lq-vd__badge">{shots.length} 镜 · 参考图 {imgCount}/{MAX_IMGS}</span>
            </div>
            <div className="lq-vd__note">AI 已按分镜顺序自动分配好场景和人物，你可以在下面逐镜改。缺图的镜会降级成文生视频（画面里没有你本人）。</div>
            <div className="lq-vd__shots">
              {shots.map((shot, index) => {
                const map = mapping[shot.no] ?? {};
                const hasCast = casts.some((item) => item.name === (map.cast ?? castNames[0])) || Boolean(map.cast);
                const hasScene = scenes.some((item) => item.name === (map.scene ?? sceneNames[index % Math.max(1, sceneNames.length)]));
                const ok = hasCast && hasScene;
                return (
                  <article className="lq-vd__shot" key={shot.no}>
                    <header className="pr-top">
                      <span className="pr-no">分镜 {shot.no}</span>
                      <span className="pr-sec">{shot.seconds} 秒</span>
                      <span className="pr-tag">{shot.kind}</span>
                    </header>
                    <div className="pr-src"><i>画面 · </i>{shot.desc}</div>
                    <div className="sd-maprow">
                      人物
                      <select className="pr-sel" value={map.cast ?? castNames[0] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [shot.no]: { ...current[shot.no], cast: event.target.value } }))}>
                        {casts.map((item) => <option key={item.id} value={item.name}>{item.name || `人物 ${item.id}`}</option>)}
                      </select>
                      场景
                      <select className="pr-sel" value={map.scene ?? sceneNames[index % Math.max(1, sceneNames.length)] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [shot.no]: { ...current[shot.no], scene: event.target.value } }))}>
                        {scenes.map((item) => <option key={item.id} value={item.name}>{item.name || `场景 ${item.id}`}</option>)}
                      </select>
                      道具
                      <select className="pr-sel" value={map.prop ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [shot.no]: { ...current[shot.no], prop: event.target.value } }))}>
                        <option value="">无</option>
                        {props.map((item) => <option key={item.id} value={item.name}>{item.name || `道具 ${item.id}`}</option>)}
                      </select>
                      <span className={ok ? "map-ok" : "map-warn"}>{ok ? "✅ 图生视频（首帧 + 参考图）" : "⚠️ 缺人物正面图或场景图，降级为文生视频"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="lq-vd__warn">单次请求的图数超过 {MAX_IMGS} 张时，按分镜所属场景自动分组调用；人物三视图每次都带，保证跨镜头不换脸。</div>
          </>
        )}

        {shots.length > 0 && step === 4 && (
          <>
            <div className="lq-vd__sec-title">输出规格 <span className="lq-vd__badge">{shots.length} 镜 · {totalSeconds} 秒</span></div>
            <div className="lq-vd__note">分镜与提示词已在第 3 步定稿（分镜脚本 = 生视频提示词）。这一步只确认画质档位，没问题就直接生成。</div>
            <div className="lq-vd__card">
              <div className="lq-vd__kv"><span className="k">画质档位</span><span className="v">{tier.n} · {tier.res}</span></div>
              <div className="lq-vd__kv"><span className="k">规格说明</span><span className="v">{tier.out}</span></div>
              <div className="lq-vd__kv"><span className="k">画面风格</span><span className="v">{SCRIPT_STYLES.find((item) => item.k === styleKey)?.n}</span></div>
              <div className="lq-vd__kv">
                <span className="k">音轨</span>
                <span className="v">
                  {activeAudio?.fileId
                    ? `${activeAudio.mediaKind === "video" ? "由「" + activeAudio.file + "」抽取声音" : activeAudio.file} · ${audioRights ? "已确认授权" : "⚠ 未确认授权"}`
                    : "无声成片（未上传音轨）"}
                </span>
              </div>
              <div className="lq-vd__kv"><span className="k">一致性锁定</span><span className="v">每镜复用同一张人物正面照当首帧图</span></div>
              <div className="lq-vd__kv"><span className="k">AI 标识</span><span className="v">起始画面显式标识</span></div>
            </div>
            <div className="lq-vd__note">
              逐镜按 <b>{SHOT_TIER_RES[tierKey] ?? "720P"}</b> 出片：模型只出<b>无声画面</b>，声音在「合成成片」这一步混进你上传的音轨（合片与混音不额外扣积分）。
              每镜都复用同一张人物正面照当首帧图，出镜人才不会换脸。费用在每一次生成前先给你看清楚，确认后才创建任务；没出成的镜次预留积分会自动退回。
            </div>
            <div className="lq-vd__sec-title" style={{ marginTop: 14 }}>
              分镜出片 <span className="lq-vd__badge">{renderedCount}/{shots.length} 镜已出片</span>
            </div>
            <div className="lq-vd__note">
              {usedCredits
                ? <>本次已确认 <b>{usedCredits}</b> 积分。没出成的镜次预留积分会自动退回，同一镜重试不会重复扣费。</>
                : "可以点每一镜的「生成本镜」单独出片，也可以点「逐镜生成整片」按分镜顺序一次跑完。"}
            </div>
            <div className="lq-vd__shots">
              {shots.map((shot, index) => {
                const item = shotsRender[shot.no];
                const status = item?.status;
                const busy = status === "running" || status === "queued";
                return (
                  <article className="lq-vd__shot" key={shot.no}>
                    <header className="pr-top">
                      <span className="pr-no">分镜 {shot.no}</span>
                      <span className="pr-sec">{shot.seconds} 秒</span>
                      <span className="pr-tag">{shot.kind}</span>
                      <span style={{ flex: 1 }} />
                      {item?.creditCost ? <span className="pr-sec">已确认 {item.creditCost} 积分</span> : null}
                    </header>
                    <div className="pr-lab">出片状态</div>
                    <div className="pr-text">
                      {status === "succeeded"
                        ? "✅ 已出片，可直接播放 / 下载。"
                        : status === "failed"
                          ? `⚠️ ${item?.message ?? "这一镜没出成片。"}`
                          : busy
                            ? `⏳ ${item?.message ?? "正在生成…"}`
                            : "未生成。点下面的按钮才会真正创建生成任务。"}
                    </div>
                    {item?.objectUrl ? (
                      <video src={item.objectUrl} controls playsInline style={{ width: "100%", marginTop: 8, borderRadius: 10, background: "#000" }} />
                    ) : null}
                    <div className="lq-vd__chips" style={{ marginTop: 8 }}>
                      <button className="lq-vd__btn ghost" type="button" disabled={rendering || busy} onClick={() => void renderShot(index)}>
                        {status === "succeeded" ? "🎬 重新生成这一镜" : status === "failed" ? "🎬 重试这一镜" : "🎬 生成本镜"}
                      </button>
                      {item?.jobId && status !== "succeeded" ? (
                        <button className="lq-vd__btn ghost" type="button" disabled={busy} onClick={() => void resumeShot(shot.no)}>
                          🔍 查询结果
                        </button>
                      ) : null}
                      {item?.objectUrl ? (
                        <button className="lq-vd__btn ghost" type="button" onClick={() => downloadShot(shot.no)}>
                          ⬇ 下载这一镜
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            <button className="lq-vd__btn primary block" type="button" disabled={rendering} onClick={() => void renderAll()}>
              {rendering
                ? "正在按分镜顺序逐镜出片，跑完一镜再跑下一镜…"
                : renderedCount && renderedCount < shots.length
                  ? `🎬 继续生成剩下 ${shots.length - renderedCount} 镜`
                  : renderedCount
                    ? "🎬 全部已出片，重新逐镜生成"
                    : "🎬 逐镜生成整片"}
            </button>
            <div className="lq-vd__card" style={{ marginTop: 14 }} data-lq-vd-compose>
              <h3 className="lq-vd__card-title">🧩 合成成片 <span className="tag green">按分镜拼接 + 混音</span></h3>
              <p className="lq-vd__card-sub">
                各镜出片成功后，点一次就把它们按分镜顺序拼成<b>一条整片</b>
                {activeAudio?.fileId ? "，并把你的音轨混进去" : "（你还没上传音轨，这条成片会是无声的）"}
                。合片与混音是本机完成，<b>不额外扣积分</b>。
              </p>
              <div className="lq-vd__kv"><span className="k">参与合成</span><span className="v">{succeededShotIds.length} / {shots.length} 镜已出片</span></div>
              <div className="lq-vd__kv">
                <span className="k">音轨</span>
                <span className="v">
                  {activeAudio?.fileId
                    ? `${activeAudio.mediaKind === "video" ? "由「" + activeAudio.file + "」抽音" : activeAudio.file}${audioRights ? "" : " · 未确认授权"}`
                    : "无 · 成片无声"}
                </span>
              </div>
              <button
                className="lq-vd__btn primary block"
                type="button"
                data-lq-vd-compose-btn
                disabled={composeState.status === "running" || !allShotsReady}
                onClick={() => void composeFilm()}
              >
                {composeState.status === "running"
                  ? "正在合成整条成片，请不要关闭页面…"
                  : allShotsReady
                    ? "🧩 合成成片（拼接 + 混音）"
                    : `还差 ${Math.max(0, shots.length - succeededShotIds.length)} 镜没出片`}
              </button>
              {composeState.message ? <div className="lq-vd__note">{composeState.message}</div> : null}
              {composeState.objectUrl ? (
                <>
                  <video src={composeState.objectUrl} controls playsInline style={{ width: "100%", marginTop: 8, borderRadius: 10, background: "#000" }} />
                  <div className="lq-vd__kv">
                    <span className="k">整条成片</span>
                    <span className="v">
                      {composeState.durationSeconds ? `${composeState.durationSeconds} 秒 · ` : ""}
                      {composeState.audioIncluded ? "带音轨" : "无声"}
                    </span>
                  </div>
                  <button className="lq-vd__btn ghost" type="button" onClick={downloadComposed}>⬇ 下载整条成片</button>
                </>
              ) : null}
            </div>
            <div className="lq-vd__field">
              <label>🔄 不满意？一键重新生成，并指出要调整哪里</label>
              <div className="lq-vd__chips">
                {FbTAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`lq-vd__chip${feedback.includes(tag) ? " on" : ""}`}
                    onClick={() => setFeedback((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <textarea
                className="lq-vd__area small"
                value={feedbackNote}
                placeholder="具体说哪里不对：比如「第三镜老板口型没合上」「背景像 P 的，想要更自然的光」「产品特写不够清晰」"
                onChange={(event) => setFeedbackNote(event.target.value)}
              />
              <p className="lq-vd__hint">已记录反馈：{feedback.length ? feedback.join(" / ") : "未选标签"}{feedbackNote ? ` · ${feedbackNote}` : ""}</p>
            </div>
          </>
        )}
      </section>

      {portraitOpen && (
        <div className="lq-vd__modal">
          <div className="lq-vd__modal-card">
            <h3>✍️ 肖像授权确认</h3>
            <div className="lq-vd__ready">
            ✅ <b>一键成片的出片能力已接通</b> —— 你不用注册账号、不用实名认证、不用自己配密钥，也不用管背后用的什么模型。
              确认授权后系统会按分镜逐镜出片，每一镜都会先给出费用再创建任务。
            </div>
            <p className="lq-vd__card-sub" style={{ marginTop: 10 }}>
              需要你确认的只有一件事：<b>照片里的人是本人，或者已经拿到对方书面同意</b>。这是肖像权合规要求，确认一次长期有效。
            </p>
            <ul className="lq-vd__ul">
              <li>确认上传的照片是<b>老板本人</b>，或员工 / 顾客<b>已签授权书</b></li>
              <li>勾选下面的授权声明（等同于门店对外承诺）</li>
              <li>点确认 —— 素材进门店形象库，之后直接选用</li>
              <li>成片自动带 <b>AI 生成标识</b>，符合平台 AIGC 标注要求</li>
            </ul>
            <p className="lq-vd__hint">照片仅用于生成你自己门店的视频，不做人脸库、不用于训练、不共享给第三方。你可以随时在设置里撤回授权并清空形象库。</p>
            <div className="lq-vd__modal-actions">
              <button
                className="lq-vd__btn primary"
                type="button"
                onClick={() => {
                  setPortraitOk(true);
                  setPortraitOpen(false);
                  void renderAll();
                }}
              >
                ✅ 确认授权，开始用
              </button>
              <button
                className="lq-vd__btn ghost"
                type="button"
                onClick={() => {
                  setPortraitOpen(false);
                  flash("已改用平台虚拟人像库：不涉及真人肖像，连授权确认都不用做。");
                }}
              >
                🎭 改用虚拟人像
              </button>
              <button className="lq-vd__btn ghost" type="button" onClick={() => setPortraitOpen(false)}>稍后再说</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
