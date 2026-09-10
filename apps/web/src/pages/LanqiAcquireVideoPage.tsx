// 兰琪美业门店 AI 经营大脑 · 公域获客 / 视频获客
//
// 严格对齐 demo `video.html`（活规范）：4 个模式页签 —— 爆款复刻 / 门店素材成片 / AI 剪辑 / 文案转片。
// 口径（0909 总纲 + 硬约束）：
//   · 界面只出现画质档位（草稿预览 480p / 标准成片 720p / 高清成片 1080p），不出现任何模型名或厂商名。
//   · 门店用户不注册账号、不建密钥、不做实名认证；唯一合规动作 = 肖像授权确认。
//   · 本阶段不做积分 / 计费 / 定价（主按钮不写「扣 N 积分」）。
//   · 一期单店：不出门店切换器、不出门店下拉。
//   · 真实视频出片能力尚未开通：需要出片的按钮一律 fail closed 明确提示，绝不假装成功。

import { useCallback, useEffect, useMemo, useState } from "react";
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
  replicate: "视频获客 · 爆款复刻（关键词搜爆款 → 换脸/换人/换产品成片）",
  assets: "门店素材成片（上传老板照片 + 门店环境 → 生成老板宣传 / 达人探店视频，风格任意选）",
  clip: "AI 剪辑（自己拍的视频传上来 → AI 自动精选片段 / 加字幕 / 配 BGM / 加片头片尾 → 出成片）",
  script: "文案转片（贴文案 → AI 出分镜脚本 → 传人物卡/场景卡/道具卡 → 逐镜生成出成片）"
};

const PLATFORMS = [
  { k: "all", n: "抖音+视频号" },
  { k: "dy", n: "抖音" },
  { k: "sph", n: "视频号" }
];

const CATS = [
  { k: "skin", n: "美容·皮肤管理" },
  { k: "nail", n: "美甲美睫" },
  { k: "spa", n: "SPA·养生" },
  { k: "mix", n: "综合生活美容" }
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

const SCRIPT_DEMO =
  "很多人问我，开了十六年的美业店，到底靠什么活下来。其实没什么秘诀，就是把每一次护理都做扎实。我们的手法讲究先看肤质再上产品，一次护理四十分钟，全程不推销。店里用的精华套盒，都是我自己先试过三个月的。如果你也在为皮肤状态发愁，欢迎来店里坐坐，我们免费给你做一次肤质检测。";

/** 真实出片能力开关：未开通时所有「要出片」的动作都必须 fail closed。 */
const VIDEO_RENDERING_READY = false;
const RENDERING_OFFLINE_MSG = "视频生成服务暂未开通，这条成片现在还出不来。你的文案 / 素材 / 设置已经留在页面上，服务开通后直接点生成即可。";
/** 真实爆款检索开关：未接通时绝不编造搜索结果与链接。 */
const REPLICATE_SEARCH_READY = false;
const REPLICATE_OFFLINE_MSG = "暂未接通真实爆款检索，所以这里不给结果 —— 不编造视频链接和播放量。已保留关键词与筛选条件，检索接通后直接点搜索即可。";

const PORTRAIT_SCRIPT = "上传的人物照片为本人或已取得本人授权，同意用于 AI 生成视频并用于门店宣传。";
const PORTRAIT_ASSET = "我已获得照片中人物的肖像权授权，同意将其用于生成门店宣传 / 探店视频，并知悉生成内容含该人物肖像。达人探店场景需额外取得达人本人授权。";
const CLIP_CONSENT = "原始素材是我自己拍摄的；如画面中出现员工 / 顾客肖像，已取得本人同意，允许 AI 剪辑加工后用于门店宣传。";

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

interface CastCard { id: number; name: string; imgs: (string | null)[] }
interface SceneCard { id: number; name: string; imgs: string[] }
interface PropCard { id: number; name: string; img: string | null }
interface AudioCard { id: number; name: string; kind: string; file: string | null }

const AUDIO_KINDS = [
  { k: "bgm", n: "BGM 配乐", ico: "🎵" },
  { k: "voice", n: "口播配音", ico: "🎤" },
  { k: "ambient", n: "环境音", ico: "🔊" }
];

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login"));
    throw new Error("登录已失效");
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求失败");
  return body;
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

function FilePick({
  label,
  accept = "image/*",
  multiple = false,
  onPick
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
}) {
  return (
    <label className="lq-vd__pick">
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
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

  // demo video.html：主标题=品牌名，副标题随模式切换
  return (
    <LanqiBrainShell active="acquire" subtitle={MODE_SUBTITLE[mode]} crumb="/ 公域获客 / 视频获客">
      <div className="lq-vd">
        <a className="lq-vd__back" href={getAppPath("/lanqi/acquire")}>← 返回公域获客</a>

        <div className="lq-vd__tabs" role="tablist">
          {MODES.map((item) => (
            <button
              key={item.k}
              type="button"
              role="tab"
              aria-selected={mode === item.k}
              className={`lq-vd__tab${mode === item.k ? " on" : ""}`}
              onClick={() => setMode(item.k)}
            >
              {item.n}
            </button>
          ))}
        </div>

        {mode === "replicate" && <ReplicateMode />}
        {mode === "assets" && <AssetsMode storeName={storeName} />}
        {mode === "clip" && <ClipMode storeName={storeName} flash={flash} />}
        {mode === "script" && <ScriptMode storeId={storeId} storeName={storeName} flash={flash} />}

        {notice && <p className="lq-vd__toast">{notice}</p>}
      </div>
    </LanqiBrainShell>
  );
}

// ────────────────────────────── 模式 1：爆款复刻 ──────────────────────────────

function ReplicateMode() {
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState("all");
  const [category, setCategory] = useState("skin");
  const [stage, setStage] = useState<"input" | "blocked">("input");
  const [replaceMode, setReplaceMode] = useState<"face" | "body">("face");
  const [photo, setPhoto] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);

  const canSearch = keyword.trim().length > 0;
  const photoNeeded = replaceMode === "face" ? "头部图片" : "全身画面";

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">
          {stage === "input" ? "步骤 1 / 3 · 告诉 AI 要找什么样的爆款" : "步骤 2 / 3 · 从结果里选一条复刻"}
        </div>
        {stage === "input" ? (
          <>
            <h3 className="lq-vd__card-title">搜爆款关键词</h3>
            <p className="lq-vd__card-sub">AI 会自动去抖音、视频号找同赛道高热度视频，挑可复刻的给你。</p>
            <div className="lq-vd__field">
              <label htmlFor="lq-vd-kw">关键词 <span className="req">*</span></label>
              <div className="lq-vd__kw">
                <span className="lead-ico" aria-hidden="true">🔍</span>
                <input
                  id="lq-vd-kw"
                  value={keyword}
                  placeholder="如：皮肤管理门店获客"
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
              <p className="lq-vd__hint">例：皮肤管理门店获客 / 美甲店同城引流 / 肩颈护理种草</p>
            </div>
            <div className="lq-vd__field">
              <label>平台筛选</label>
              <div className="lq-vd__chips">
                {PLATFORMS.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__chip${platform === item.k ? " on" : ""}`}
                    onClick={() => setPlatform(item.k)}
                  >
                    {item.n}
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-vd__field">
              <label>行业领域</label>
              <div className="lq-vd__chips">
                {CATS.map((item) => (
                  <button
                    key={item.k}
                    type="button"
                    className={`lq-vd__chip${category === item.k ? " on" : ""}`}
                    onClick={() => setCategory(item.k)}
                  >
                    {item.n}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="lq-vd__btn primary block"
              type="button"
              disabled={!canSearch}
              onClick={() => {
                if (!REPLICATE_SEARCH_READY) {
                  setStage("blocked");
                  return;
                }
              }}
            >
              🚀 AI 去抖音/视频号搜爆款
            </button>
          </>
        ) : (
          <>
            <h3 className="lq-vd__card-title">搜索条件</h3>
            <div className="lq-vd__kv"><span className="k">关键词</span><span className="v">{keyword.trim() || "（未填）"}</span></div>
            <div className="lq-vd__kv"><span className="k">平台</span><span className="v">{PLATFORMS.find((p) => p.k === platform)?.n}</span></div>
            <div className="lq-vd__kv"><span className="k">领域</span><span className="v">{CATS.find((c) => c.k === category)?.n}</span></div>
            <button className="lq-vd__btn ghost" type="button" onClick={() => setStage("input")}>↻ 换个关键词重新搜</button>

            <div className="lq-vd__stage" style={{ marginTop: 18 }}>步骤 3 / 3 · 提供素材，替换主角与产品</div>
            <h3 className="lq-vd__card-title">替换主角 <span className="tag green">换脸 / 换人</span></h3>
            <p className="lq-vd__card-sub">AI 会保留原爆款的画面、动作、节奏与配音，只把主角换成你。</p>
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
              <b>{photo ? `已提供${photoNeeded}` : "未提供素材"}</b>
              <p>保留素材在你的电脑上，不上传、不联网。要出你自己的成片时选一张照片即可。</p>
            </div>
            <FilePick label={photo ? "重新选择照片" : "选择照片"} onPick={(files) => setPhoto(files[0]?.name ?? null)} />

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>替换产品 <span className="tag opt">可选</span></h3>
            <p className="lq-vd__card-sub">把原爆款里的产品 / 道具换成你自己的产品图，不填则保留原产品。</p>
            <div className="lq-vd__fileinfo">
              <b>{product ? "已提供产品图" : "未替换产品（保留原产品）"}</b>
              <p>建议白底或场景图，主体清晰、无复杂文字。</p>
            </div>
            <FilePick label={product ? "重新选择" : "选择产品图"} onPick={(files) => setProduct(files[0]?.name ?? null)} />

            <button
              className="lq-vd__btn primary block"
              type="button"
              disabled={!photo}
              onClick={() => window.alert(RENDERING_OFFLINE_MSG)}
            >
              {photo ? "🎬 生成爆款复刻视频" : `⚠️ 请先提供${photoNeeded}再生成`}
            </button>
            <button className="lq-vd__btn ghost" type="button" onClick={() => setStage("input")}>↻ 换照片重新生成</button>
          </>
        )}
      </section>

      <section className="lq-vd__right">
        {stage === "input" ? (
          <div className="lq-vd__placeholder">
            填好左侧关键词，点「搜爆款」<br />AI 会自动去抖音、视频号找同赛道高热度视频
          </div>
        ) : (
          <>
            <div className="lq-vd__sec-title">
              爆款复刻 · 换脸 / 换人 <span className="lq-vd__badge">严格复刻</span>
            </div>
            <div className="lq-vd__warn">
              搜索结果按关键词匹配的高热度视频，帮你快速找可复刻条目；版权与原创度请自行核对。
            </div>
            <div className="lq-vd__offline">
              <div className="ico">🔌</div>
              <h3>暂未接通真实爆款检索</h3>
              <p>{REPLICATE_OFFLINE_MSG}</p>
              <p className="lq-vd__hint">
                硬要求：不做假数据。宁可不给结果，也不给你一条点开是 404 的「爆款」。
              </p>
            </div>
            <div className="lq-vd__card">
              <div className="lq-vd__kv"><span className="k">来源</span><span className="v">待检索接通</span></div>
              <div className="lq-vd__kv"><span className="k">原视频</span><span className="v">暂无</span></div>
              <div className="lq-vd__kv"><span className="k">替换模式</span><span className="v">{replaceMode === "face" ? "换脸（头部图片）" : "换人（全身画面）"}</span></div>
              <div className="lq-vd__kv"><span className="k">替换产品</span><span className="v">{product ? "已替换为上传产品" : "保留原产品"}</span></div>
              <div className="lq-vd__kv"><span className="k">生成方式</span><span className="v">AI 人像替换 · 平台内置能力，无需你自行配置</span></div>
              <div className="lq-vd__kv"><span className="k">输出</span><span className="v">MP4 · 9:16 · 起始画面带 AI 生成标识</span></div>
            </div>
            <div className="lq-vd__warn">换脸需先完成肖像授权，授权后方可生成；此处预览仅作效果示意。</div>
          </>
        )}
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

function ScriptMode({ storeId, storeName, flash }: { storeId: string; storeName: string; flash: (message: string) => void }) {
  const [step, setStep] = useState(1);
  const [script, setScript] = useState("");
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
  const [audios, setAudios] = useState<AudioCard[]>([{ id: 1, name: "轻柔钢琴 BGM", kind: "bgm", file: null }]);
  const [refs, setRefs] = useState<string[]>([]);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentWarn, setConsentWarn] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");

  const tier = TIERS.find((item) => item.k === tierKey) ?? TIERS[1];
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
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
    if (!script.trim()) { setError("请先贴入口播文案。"); return; }
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

  return (
    <div className="lq-vd__main">
      <section className="lq-vd__left">
        <div className="lq-vd__stage">文案转片 · 第 {Math.min(step, 4)} 步 / 4</div>

        {step === 1 && (
          <>
            <h3 className="lq-vd__card-title">口播文案 / 脚本 <span className="tag green">必填</span></h3>
            <p className="lq-vd__card-sub">
              把你写好的口播稿原样贴进来。下一步自动断句，切成每镜不超过 15 秒的<b>分镜脚本</b>，镜头、景别、运镜、
              <b>生视频提示词</b>全给你补上。
            </p>
            <textarea
              className="lq-vd__area"
              value={script}
              placeholder="例：很多人问我，开了十六年的美业店，到底靠什么活下来……"
              onChange={(event) => setScript(event.target.value)}
            />
            <button className="lq-vd__btn ghost" type="button" onClick={() => setScript(SCRIPT_DEMO)}>📋 填入示例文案（兰琪）</button>

            <div className="lq-vd__field" style={{ marginTop: 16 }}>
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

            <button className="lq-vd__btn primary block" type="button" disabled={Boolean(busy)} onClick={() => void buildStoryboard()}>
              {busy ? "正在生成分镜…" : "✂️ 生成分镜脚本"}
            </button>
            <div className="lq-vd__warn">
              硬约束（视频能力限制）：单次生成 4–15 秒，所以长文案必须切镜；单次请求最多 9 张参考图，所以按分镜所属场景分组调用。
            </div>
          </>
        )}

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
            <button className="lq-vd__btn ghost" type="button" onClick={() => void buildStoryboard()}>↻ 重新切分</button>
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
                              imgs[index] = files[0]?.name ?? null;
                              return { ...item, imgs };
                            })
                          )
                        }
                      />
                      <div className="ang-role">{angle.role}{cast.imgs[index] ? ` · ${cast.imgs[index]}` : ""}</div>
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
                    setScenes((current) => current.map((item) => (item.id === scene.id ? { ...item, imgs: [...item.imgs, ...files.map((file) => file.name)].slice(0, 3) } : item)))
                  }
                />
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" onClick={() => setScenes((current) => [...current, { id: current.length + 1, name: "", imgs: [] }])}>
              + 再加一个场景
            </button>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>③ 音频卡 <span className="tag opt">可选 · ≤{MAX_AUDIOS} 段</span></h3>
            <p className="lq-vd__card-sub">成片要用的声音：背景音乐 / 老板口播配音 / 门店环境音。不传也行 —— 不传时 AI 会自己生成环境音；传了就用你的。</p>
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
                <div className="aud-file">
                  {audio.file ? `已上传 · ${audio.file}` : "未上传 · 不传则由 AI 生成环境音"}
                </div>
                <FilePick
                  label={audio.file ? "↻ 替换音频" : "⬆ 上传音频"}
                  accept="audio/*"
                  onPick={(files) => setAudios((current) => current.map((item) => (item.id === audio.id ? { ...item, file: files[0]?.name ?? null } : item)))}
                />
              </div>
            ))}
            <button
              className="lq-vd__btn ghost"
              type="button"
              disabled={audios.length >= MAX_AUDIOS}
              onClick={() => setAudios((current) => [...current, { id: current.length + 1, name: "", kind: "ambient", file: null }])}
            >
              + 加一段音频（{audios.length}/{MAX_AUDIOS}）
            </button>

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
                  label={prop.img ? `已选 · ${prop.img}` : "选择道具图"}
                  onPick={(files) => setProps((current) => current.map((item) => (item.id === prop.id ? { ...item, img: files[0]?.name ?? null } : item)))}
                />
              </div>
            ))}
            <button className="lq-vd__btn ghost" type="button" onClick={() => setProps((current) => [...current, { id: current.length + 1, name: "", img: null }])}>
              + 加一个道具
            </button>

            <h3 className="lq-vd__card-title" style={{ marginTop: 18 }}>⑤ 其他参考 <span className="tag opt">可选</span></h3>
            <p className="lq-vd__card-sub">不填也能跑。填了画面更贴你想要的样子。（风格参考图最多 2 张，视频参考最多 3 段）</p>
            <FilePick label={refs.length ? `已选 ${refs.length} 张风格参考图` : "选择风格参考图"} multiple onPick={(files) => setRefs((current) => [...current, ...files.map((file) => file.name)].slice(0, 2))} />
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
              <span className="lq-vd__pill on">🔊 原生音画同步 <span className="hint">环境音+人声一起出</span></span>
              <span className="lq-vd__pill on">🔒 人物一致性锁定 <span className="hint">固定 seed + 尾帧接首帧</span></span>
            </div>
            <div className="lq-vd__note">
              人物一致性锁定：AI 生视频跨多次生成会在 3–4 个镜头后出现脸漂移。开启后固定 seed，并把上一镜尾帧作为下一镜首帧串联，能明显压住漂移。
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
            <div className="lq-vd__sec-title">文案怎么变成成片 <span className="lq-vd__badge">4 步</span></div>
            <div className="lq-vd__step on"><span className="n">1</span><span><b>贴文案</b> · 你写好的口播稿，原样贴进来</span></div>
            <div className="lq-vd__step"><span className="n">2</span><span><b>分镜脚本</b> · 自动切不超过 15 秒的分镜，每镜直接出<b>生视频提示词</b></span></div>
            <div className="lq-vd__step"><span className="n">3</span><span><b>传素材卡</b> · 人物卡（正/侧/背）+ 场景卡 + 音频卡 + 道具卡 + 其他参考</span></div>
            <div className="lq-vd__step"><span className="n">4</span><span><b>成片</b> · 选定画质档位后出片，直接发抖音 / 视频号 / 朋友圈</span></div>
            <div className="lq-vd__placeholder" style={{ height: 180 }}>
              左侧贴好文案<br />点「✂️ 生成分镜脚本」<br />右侧这里出分镜表
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
            <div className="lq-vd__note">分镜与提示词已在第 2 步定稿（分镜脚本 = 生视频提示词）。这一步只确认画质档位，没问题就直接生成。</div>
            <div className="lq-vd__card">
              <div className="lq-vd__kv"><span className="k">画质档位</span><span className="v">{tier.n} · {tier.res}</span></div>
              <div className="lq-vd__kv"><span className="k">规格说明</span><span className="v">{tier.out}</span></div>
              <div className="lq-vd__kv"><span className="k">画面风格</span><span className="v">{SCRIPT_STYLES.find((item) => item.k === styleKey)?.n}</span></div>
              <div className="lq-vd__kv"><span className="k">音频</span><span className="v">{audios.filter((item) => item.file).length ? `${audios.filter((item) => item.file).length} 段已上传` : "AI 自动生成环境音（未上传音频卡）"}</span></div>
              <div className="lq-vd__kv"><span className="k">一致性锁定</span><span className="v">固定 seed + 尾帧串联</span></div>
              <div className="lq-vd__kv"><span className="k">AI 标识</span><span className="v">起始画面显式标识</span></div>
            </div>
            <div className="lq-vd__offline">
              <div className="ico">🔌</div>
              <h3>出片服务暂未开通</h3>
              <p>{RENDERING_OFFLINE_MSG}</p>
              <p className="lq-vd__hint">可以先把分镜和提示词导出去（⬇ 导出提示词 TXT），成片服务开通后回来点生成即可。</p>
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
              {VIDEO_RENDERING_READY ? (
                <>✅ <b>视频能力平台已接通</b> —— 你不用注册账号、不用实名认证、不用自己配密钥，也不用管背后用的什么模型。</>
              ) : (
                <>🔌 <b>视频能力由平台统一接通</b> —— 你不用注册账号、不用实名认证、不用自己配密钥，也不用管背后用的什么模型；成片服务开通后直接生成，不用再确认一次授权。</>
              )}
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
                  window.alert(RENDERING_OFFLINE_MSG);
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
