// 兰琪「公域获客 · 美业文案十件套」（LQ-33）：新增一张卡，独立计费。
//
// 用户口径（2026-09-15）：**新增一张卡**（不塞进「短视频文案改稿」做模式切换）+ 独立计费口径。
// 合同不复制：提示词与结构校验都取 `../beauty-industry/copy-ten-contract.js`
// （货架「文案智能体」用的同一份「内容十件套 V5」），兰琪这侧只加一层「怎么问、缺信息怎么办」的壳。
//
// 计费边界（与兰琪其它出片 / 图片能力同一套口径：租户积分账户 `creditAccount`）：
//   ① 余额不足 → 402，**不调模型、不扣积分**；
//   ② 模型失败 / 信息不足 / 十件套结构校验不过 → 不扣积分；
//   ③ 只有拿到合格的十件套才扣，条件更新（`balance >= price`）保证并发不为负，并写 `creditTransaction` 流水；
//   ④ 同一 `requestKey` + 同一输入 → 复用同一份结果、不重复扣积分；同键不同输入 → 409 冲突。
import type { LlmMessage, LlmProvider } from "@baolu/agent";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import { COPY_TEN_SECTIONS, COPY_TEN_SYSTEM_PROMPT, parseCopyTenContract } from "../beauty-industry/copy-ten-contract.js";

/** 对外（审计 / 回归）的合同标识：与货架同源的「内容十件套 V5」。 */
export const LANQI_COPY_KIT_CONTRACT_VERSION = "copy_ten_v5" as const;
/** 兰琪这侧「提问壳」的版本（改壳不改合同，便于回溯是哪一版问法）。 */
export const LANQI_COPY_KIT_WRAPPER_VERSION = "lanqi_copy_kit_v1" as const;
/** 门店点名的交付件，与合同里的十个章节一一对应（前端只做展示分组）。 */
export const LANQI_COPY_KIT_SECTIONS = COPY_TEN_SECTIONS;
export const LANQI_COPY_KIT_PLATFORMS = [
  { k: "all", n: "三个平台都要" },
  { k: "dy", n: "抖音（同城）" },
  { k: "xhs", n: "小红书（种草）" },
  { k: "sph", n: "视频号（熟客）" }
] as const;
export const LANQI_COPY_KIT_GOALS = [
  { k: "visit", n: "到店体验 / 团单" },
  { k: "private", n: "加店主 / 私域" },
  { k: "franchise", n: "招商 / 加盟" }
] as const;

const CLARIFY_MARK = "【需补充信息】";
const MIN_BRIEF_CHARS = 12;
/**
 * 输出额度。默认 8192，可用 `LANQI_COPY_KIT_MAX_TOKENS` 调高。
 *
 * 为什么不是「像货架那样关掉思考」：2026-09-15 真实 Eval 对比过——
 *   ① 走默认推理档 + 8192 额度：正文 3.5k 字、结构合格，但 3 次里 1 次把额度花在推理上被截断；
 *   ② 关掉思考（standard + disabled）：正文掉到 ~2.5k 字，出现口播单句 >40 字、违禁词等结构失败。
 * 所以这里保留推理档，改为给足输出额度；偶发失败由结构校验兜住（不扣积分、可重试）。
 */
const MAX_TOKENS = Number(process.env.LANQI_COPY_KIT_MAX_TOKENS ?? "") > 0
  ? Math.round(Number(process.env.LANQI_COPY_KIT_MAX_TOKENS))
  : 16384;
/** 合同提示词指纹：缓存与审计用，能在不暴露提示词的前提下核对「这份结果出自哪版合同」。 */
const CONTRACT_PROMPT_HASH = createHash("sha256").update(COPY_TEN_SYSTEM_PROMPT).digest("hex").slice(0, 16);

export type LanqiCopyKitPlatform = (typeof LANQI_COPY_KIT_PLATFORMS)[number]["k"];
export type LanqiCopyKitGoal = (typeof LANQI_COPY_KIT_GOALS)[number]["k"];

export interface LanqiCopyKitRequest {
  brief: string;
  platform?: LanqiCopyKitPlatform;
  goal?: LanqiCopyKitGoal;
  storeName?: string;
}

export type LanqiCopyKitResult =
  | { status: "needs_input"; message: string }
  | { status: "invalid"; failures: string[] }
  | { status: "ready"; content: string; contractVersion: string; failures: [] };

/**
 * 独立计费口径：默认 40 积分 / 次 —— 与货架「文案智能体」**同一份合同、同一档价**。
 * 老板要把这张卡定成别的价，只改 env `LANQI_COPY_KIT_CREDITS` 即可，不必发版。
 */
export function lanqiCopyKitPriceCredits(): number {
  const override = Number(process.env.LANQI_COPY_KIT_CREDITS ?? "");
  if (Number.isFinite(override) && override > 0) return Math.round(override);
  return 40;
}

/** 兰琪侧只加「怎么问、缺信息怎么办」这一层壳，十件套结构仍由共享合同定义。 */
export function buildLanqiCopyKitMessages(params: { request: LanqiCopyKitRequest }): LlmMessage[] {
  const platform = LANQI_COPY_KIT_PLATFORMS.find((item) => item.k === (params.request.platform ?? "all"))?.n ?? "三个平台都要";
  const goal = LANQI_COPY_KIT_GOALS.find((item) => item.k === (params.request.goal ?? "visit"))?.n ?? "到店体验 / 团单";
  const store = params.request.storeName?.trim();
  return [
    { role: "system", content: COPY_TEN_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        store ? `门店：${store}（美业门店，主营皮肤管理 / 美容护理类项目）。` : "门店：美业门店（皮肤管理 / 美容护理类项目）。",
        `投放平台：${platform}`,
        `想要的结果：${goal}`,
        "",
        "门店老板的原话（本次唯一业务事实来源；除它之外不要编造任何品牌、城市、价格、案例、资质和数据，缺的在正文里写「待补充」）：",
        params.request.brief.trim(),
        "",
        "按上面的合同输出这份「内容十件套 V5」：一、…十、十节齐全、每节独立成段。",
        "四条硬要求（不满足就是不合格，会被结构校验打回）：",
        "1) 第二节口播逐字稿：正文不少于 150 个汉字（【动作/情绪】与 >B-roll 行不算字数），按 0-3 / 3-15 / 15-30 / 30-45 / 45-55 / 55-60 六段，含【动作/情绪】与 >B-roll 切换点，每句不超过 40 个字。",
        "2) 第七节正好 3 行标题（主标题 + 2 条备选），话题里逐字写出「大流量」「精准」「行业」三个层级词。",
        "3) 若第一节把内容类型判为获客型：第三节给 5-6 组【问·…】问答，第十节主投「本地推」。",
        "4) 全文任何位置（包括第五节禁忌说明、第六节表格备注、第九节评论引导）都不许出现这些字面词：私信、加微信、电话、联系我、找我、留个、扫码领、加我、唯一、保证、100%、根治、彻底、永久、包回本、稳赚、月入过万、零风险、躺赚。要表达「不要引流」时写成「不做站外导流」「不做引流话术」。",
        `如果老板这句原话里的「行业 / 项目卖点」或「想触达的人群」缺失、敷衍（乱码、随便、测试、111 之类），只输出第一行是 ${CLARIFY_MARK} 的最多 3 条「需要补充：…」，不要猜、不要输出十件套。`,
        "只输出这份十件套 Markdown，不要输出任何推导过程、评分标准或内部术语。"
      ].join("\n")
    }
  ];
}

export function extractCopyKitClarification(text: string): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  if (!trimmed.slice(0, 160).includes(CLARIFY_MARK)) return null;
  return trimmed.replace(/[\s*_#>]*【需补充信息】[\s*_]*/, "").trim() || "还需要补充「项目 / 卖点」与「想触达的人群」才能开始。";
}

/** 结构校验直接复用共享合同，兰琪不另立一套标准。 */
export function validateLanqiCopyKitContent(content: string): string[] {
  const text = (content ?? "").trim();
  if (!text) return ["内容为空"];
  return parseCopyTenContract(text).failures;
}

export interface LanqiCopyKitGeneration {
  result: LanqiCopyKitResult;
  contractVersion: string;
  promptHash: string;
}

export async function generateLanqiCopyKit(params: {
  request: LanqiCopyKitRequest;
  /** 离线回归可以注入假 provider；生产走运行时 Provider。 */
  provider?: LlmProvider;
  /**
   * 观测钩子：拿到模型原始输出时回调一次（**不落库、不回给用户**）。
   * 只用于本机诊断/Eval 定位「到底是模型写错、还是结构校验误伤」。
   */
  onRaw?: (raw: string) => void;
}): Promise<LanqiCopyKitGeneration> {
  const brief = params.request.brief?.trim() ?? "";
  if (brief.length < MIN_BRIEF_CHARS) {
    return {
      contractVersion: LANQI_COPY_KIT_CONTRACT_VERSION,
      promptHash: CONTRACT_PROMPT_HASH,
      result: { status: "needs_input", message: "先多写两句：这条内容主推哪个项目 / 套餐，想让谁看到（同城新客 / 老客 / 加盟商），顾客的痛点是什么。" }
    };
  }
  const provider = params.provider ?? createRuntimeLlmProvider();
  const messages = buildLanqiCopyKitMessages({ request: { ...params.request, brief } });
  const raw = await provider.complete(messages, {
    maxTokens: MAX_TOKENS
  });
  params.onRaw?.(raw ?? "");
  const clarification = extractCopyKitClarification(raw ?? "");
  if (clarification) {
    return {
      contractVersion: LANQI_COPY_KIT_CONTRACT_VERSION,
      promptHash: CONTRACT_PROMPT_HASH,
      result: { status: "needs_input", message: clarification }
    };
  }
  const failures = validateLanqiCopyKitContent(raw ?? "");
  if (failures.length) {
    return {
      contractVersion: LANQI_COPY_KIT_CONTRACT_VERSION,
      promptHash: CONTRACT_PROMPT_HASH,
      result: { status: "invalid", failures }
    };
  }
  return {
    contractVersion: LANQI_COPY_KIT_CONTRACT_VERSION,
    promptHash: CONTRACT_PROMPT_HASH,
    result: { status: "ready", content: String(raw).trim(), contractVersion: LANQI_COPY_KIT_CONTRACT_VERSION, failures: [] }
  };
}

// ---------------------------------------------------------------------------
// 幂等与结果留存
//
// 结果落本租户目录（与兰琪媒体资产同一套「路径里带租户、再按租户校验」的隔离口径），
// 这样「点了一次、响应丢了、再点一次」不会重复扣积分，也不会白花钱拿不到内容。
// ---------------------------------------------------------------------------

export interface LanqiCopyKitCacheEntry {
  /** 同一 `requestKey` 的输入指纹：同键不同输入必须报冲突，不能把旧结果当成新需求交付。 */
  inputHash: string;
  content: string;
  contractVersion: string;
  promptHash: string;
  creditCost: number;
  createdAt: string;
}

export function lanqiCopyKitInputHash(request: LanqiCopyKitRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.brief?.trim() ?? "", request.platform ?? "all", request.goal ?? "visit", request.storeName?.trim() ?? ""]))
    .digest("hex")
    .slice(0, 24);
}

export async function readLanqiCopyKitCache(params: { tenantId: string; requestKey: string }): Promise<LanqiCopyKitCacheEntry | undefined> {
  try {
    const raw = JSON.parse(await readFile(copyKitCachePath(params.tenantId, params.requestKey), "utf8")) as LanqiCopyKitCacheEntry;
    return typeof raw?.content === "string" && raw.content.trim() ? raw : undefined;
  } catch {
    return undefined;
  }
}

export async function writeLanqiCopyKitCache(params: { tenantId: string; requestKey: string; entry: LanqiCopyKitCacheEntry }): Promise<void> {
  const target = copyKitCachePath(params.tenantId, params.requestKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(params.entry), "utf8");
}

/**
 * 当前租户名下已有的 `requestKey`（只读本租户目录；目录名是租户 id 的哈希，
 * 别的租户的 key 永远不会出现在这里）。
 */
export async function listLanqiCopyKitKeys(params: { tenantId: string }): Promise<string[]> {
  try {
    const entries = await readdir(path.dirname(copyKitCachePath(params.tenantId, "000000000000000000000000")));
    return entries.filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

function copyKitCachePath(tenantId: string, requestKey: string): string {
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestKey)) throw new Error("invalid_copy_kit_request_key");
  const tenantKey = createHash("sha256").update(tenantId).digest("hex").slice(0, 24);
  return path.resolve(env.UPLOAD_DIR, "lanqi-copy-kit", tenantKey, `${requestKey}.json`);
}
