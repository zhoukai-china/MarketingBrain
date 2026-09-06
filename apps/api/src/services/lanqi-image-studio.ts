import type { LanqiStoreProfileFacts } from "./lanqi-store-profile.js";

export const LANQI_IMAGE_CAPABILITY = "media.image.generate" as const;
export const LANQI_IMAGE_PROMPT_SKILL = "lanqi-image-prompt-enhancer" as const;
export const LANQI_IMAGE_PROMPT_VERSION = "1.0.1" as const;
export const LANQI_IMAGE_PREVIEW_CREDIT_ESTIMATE = 100;
const fallbackNames = ["高级留白", "真实材质", "温暖氛围"];
const fallbackVariables = ["构图与留白", "材质写实程度", "光线与色温"];

export const LANQI_IMAGE_PURPOSES = ["xiaohongshu_cover", "social_poster", "service_intro", "store_branding"] as const;
export const LANQI_IMAGE_RATIOS = ["1:1", "3:4", "9:16", "16:9"] as const;
export const LANQI_IMAGE_STYLES = ["natural", "warm", "premium", "clean"] as const;
export const LANQI_IMAGE_TEXT_MODES = ["no_text", "title_space", "provided_text"] as const;

export type LanqiImagePurpose = typeof LANQI_IMAGE_PURPOSES[number];
export type LanqiImageRatio = typeof LANQI_IMAGE_RATIOS[number];
export type LanqiImageStyle = typeof LANQI_IMAGE_STYLES[number];
export type LanqiImageTextMode = typeof LANQI_IMAGE_TEXT_MODES[number];

export type LanqiImageBrief = {
  request: string;
  purpose: LanqiImagePurpose;
  ratio: LanqiImageRatio;
  style: LanqiImageStyle;
  textMode: LanqiImageTextMode;
  overlayText?: string;
  rightsConfirmed: true;
  basePreviewId?: string;
  revisionInstruction?: string;
  intentUnderstanding?: string;
};

export type LanqiImagePromptParameters = {
  purpose: LanqiImagePurpose;
  aspectRatio: LanqiImageRatio;
  style: LanqiImageStyle;
  composition: string;
  subject: string;
  scene: string;
  lighting: string;
  colorPalette: string;
  camera: string;
  materials: string;
  clarity: "high";
};

export type LanqiImagePromptDirection = {
  id: string;
  name: string;
  variable: string;
  positivePrompt: string;
  negativePrompt: string;
  overlayText: { mode: "post_process"; text: string; placement: "top_safe_area" | "center_safe_area" | "bottom_safe_area" };
  parameters: LanqiImagePromptParameters;
};

export type LanqiImagePreview = Omit<LanqiImageBrief, "basePreviewId" | "revisionInstruction" | "intentUnderstanding"> & {
  id: string;
  request: string;
  inputSummary: string;
  intentUnderstanding: string;
  missingQuestions: string[];
  directions: LanqiImagePromptDirection[];
  selectedDirectionId: string;
  promptPreview: string;
  negativePrompt: string;
  factBoundary: string[];
  complianceNotes: string[];
  enhancer: {
    id: typeof LANQI_IMAGE_PROMPT_SKILL;
    version: typeof LANQI_IMAGE_PROMPT_VERSION;
    source: "runtime_skill" | "deterministic_fallback";
    revisionSummary: string;
    basePreviewId?: string;
  };
  modelAdapter: {
    capability: typeof LANQI_IMAGE_CAPABILITY;
    prompt: string;
    negativePrompt: string;
    parameters: {
      aspectRatio: LanqiImageRatio;
      canvas: { width: number; height: number };
      imageCount: 1;
      renderText: false;
      watermark: true;
    };
    overlayText: LanqiImagePromptDirection["overlayText"];
  };
  factSummary: { storeName?: string; city?: string; mainServices: string[]; displayStoreName: string; syntheticTestData: boolean };
  knowledgeVersion: { status: "not_loaded"; version: null; note: string };
  quotePreview: { creditCost: number; billable: false; confirmationRequired: true; note: string };
  execution: {
    status: "preview_only";
    canSubmit: false;
    requiredCapability: typeof LANQI_IMAGE_CAPABILITY;
    storageDependency: "media.asset.persist";
    billingDependency: "credits.reserve_and_settle";
    blockedReason: string;
  };
  status: "preview";
  createdAt: string;
  updatedAt: string;
};

const purposeLabels: Record<LanqiImagePurpose, string> = {
  xiaohongshu_cover: "小红书封面",
  social_poster: "社交平台海报",
  service_intro: "服务项目介绍",
  store_branding: "门店品牌形象",
};

const styleVisuals: Record<LanqiImageStyle, { mood: string; light: string; palette: string }> = {
  natural: { mood: "自然写实、真实肤感与克制修饰", light: "柔和窗边自然光，明暗过渡真实", palette: "暖白、浅杏与低饱和肤色" },
  warm: { mood: "温柔亲和、舒缓而有生活温度", light: "柔和侧光与轻微暖色反射光", palette: "奶油白、杏橙与浅蜜桃色" },
  premium: { mood: "精致高级、克制留白与编辑感", light: "大面积柔光配细腻轮廓光", palette: "象牙白、深琥珀与少量哑光金" },
  clean: { mood: "清爽干净、主体聚焦与通透层次", light: "均匀高键柔光，阴影轻且边缘清晰", palette: "纯净暖白、浅水蓝与微量杏色" },
};

const canvasByRatio: Record<LanqiImageRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 768, height: 1024 },
  "9:16": { width: 576, height: 1024 },
  "16:9": { width: 1024, height: 576 },
};

const managementTerms = /积分|计费|权限|事实边界|人工审核|系统说明|存储依赖|模型授权|API\s*key|供应商/gi;
const syntheticStoreNamePattern = /(?:兰琪)?(?:验收|测试|脱敏测试|合成测试)[\s_-]*[AＢABab一二12]?(?:店|门店|租户)|(?:tenant|test[\s_-]*tenant)/i;

export type LanqiImageModelFacts = {
  storeName?: string;
  city?: string;
  mainServices: string[];
  displayStoreName: string;
  syntheticTestData: boolean;
};

export function normalizeLanqiCareLanguage(value: string): string {
  return value
    .replace(/问题肌肤(?:的)?(?:修复|治疗|治愈)/g, "问题肌肤日常护理")
    .replace(/问题性肌肤(?:的)?(?:修复|治疗|治愈)/g, "问题肌肤日常护理");
}

export function normalizeLanqiImageFactsForModel(facts: LanqiStoreProfileFacts): LanqiImageModelFacts {
  const rawStoreName = readFact(facts.storeName);
  const syntheticTestData = Boolean(rawStoreName && syntheticStoreNamePattern.test(rawStoreName));
  const storeName = syntheticTestData ? undefined : rawStoreName;
  const city = syntheticTestData ? undefined : readFact(facts.city);
  const mainServices = syntheticTestData ? [] : readList(facts.mainServices).map(normalizeLanqiCareLanguage);
  return {
    storeName,
    city,
    mainServices,
    displayStoreName: storeName ?? "本店",
    syntheticTestData,
  };
}

export function validateLanqiImageBrief(input: Omit<LanqiImageBrief, "rightsConfirmed"> & { rightsConfirmed: boolean }): string | undefined {
  const normalized = input.request.replace(/[\s，。！？!?、]/g, "");
  if (normalized.length < 8) return "请再说清楚想展示的服务、场景或画面主体，告诉我其中一项就可以。";
  if (!input.rightsConfirmed) return "请先确认本次文字、品牌和人物描述均有权使用。";
  if (input.textMode === "provided_text" && !input.overlayText?.trim()) return "请选择无文字或预留标题区，或者填写需要呈现的短标题。";
  if ((input.overlayText?.trim().length ?? 0) > 40) return "画面短标题请控制在 40 个字以内。";
  if ((input.revisionInstruction?.trim().length ?? 0) > 300) return "本轮调整要求请控制在 300 个字以内。";
  if (/(保证|包治|根治|永久|百分之百|100%|零风险|无效退款).{0,8}(效果|治愈|改善|祛除|减肥|变白)?/i.test(input.request)) {
    return "画面需求包含未经证实的保证或疗效表述，请改成可核对的服务场景描述。";
  }
  if (/(?<!不)(?<!不要)(?<!不能)(?<!禁止)(?<!避免)(换脸|换头|模仿|复刻|冒充).{0,10}(明星|名人|真人|顾客|他人|博主|网红)/i.test(input.request)) {
    return "不能模仿或冒充未经授权的真人，请改成不指向特定人物的画面描述。";
  }
  if (/(系统提示词|内部提示词|api\s*key|密钥|供应商参数)/i.test(input.request)) {
    return "这项内容不属于图片画面需求，请只描述要展示的服务、场景或主体。";
  }
  return undefined;
}

export function buildLanqiImageSkillInput(params: {
  brief: LanqiImageBrief;
  facts: LanqiStoreProfileFacts;
  previous?: LanqiImagePreview;
}): string {
  const summary = normalizeLanqiCareLanguage(sanitizeImageInput(params.brief.request));
  const facts = normalizeLanqiImageFactsForModel(params.facts);
  const previous = params.previous
    ? {
      id: params.previous.id,
      intentUnderstanding: params.brief.intentUnderstanding ?? params.previous.intentUnderstanding,
      selectedDirection: params.previous.directions.find(item => item.id === params.previous!.selectedDirectionId),
    }
    : undefined;
  return [
    "请将以下兰琪美业图片需求增强为严格 JSON。只生成提示词预览，不生成图片、不计费。",
    `用户需求摘要：${summary}`,
    `用途：${params.brief.purpose}`,
    `比例：${params.brief.ratio}`,
    `偏好风格：${params.brief.style}`,
    `后期叠字：${params.brief.textMode === "provided_text" ? params.brief.overlayText?.trim() || "待补" : params.brief.textMode}`,
    `门店已确认事实：${JSON.stringify({ storeName: facts.storeName, city: facts.city, mainServices: facts.mainServices })}`,
    `门店展示名称：${facts.displayStoreName}。未确认真实门店名称时只能使用“本店”，不得补写城市或门店名。`,
    facts.syntheticTestData ? "当前档案含合成测试标识；相关门店名和城市不得进入需求理解、提示词或可复制结果。" : "当前档案不含合成测试标识。",
    "兰琪知识版本：not_loaded。不得冒充兰琪视觉方法论或内部定价。",
    `授权确认：${params.brief.rightsConfirmed ? "已确认本轮文字、品牌和人物描述有权使用" : "未确认"}`,
    params.brief.revisionInstruction ? `本轮调整：${sanitizeImageInput(params.brief.revisionInstruction)}` : "本轮调整：首次增强",
    previous ? `上轮已选方向：${JSON.stringify(previous)}` : "上轮已选方向：无",
    "保留用户真实主体、已确认城市、品牌、人群和禁止项。将问题肌肤修复等效果性表述规范为问题肌肤日常护理或舒缓护理，并说明改写原因；不得编价格、疗效、案例、销量、顾客形象或真实门店场景。",
    "输出2至3个单变量方向；中文文字只放 overlayText 后期叠加字段；positivePrompt 不得出现费用、权限、审核、事实管理或供应商说明。",
  ].join("\n");
}

export function buildLanqiImagePreview(params: {
  id: string;
  brief: LanqiImageBrief;
  facts: LanqiStoreProfileFacts;
  enhancementAnswer?: string;
  previous?: LanqiImagePreview;
  now?: string;
}): LanqiImagePreview {
  const now = params.now ?? new Date().toISOString();
  const request = sanitizeImageInput(params.brief.request);
  const normalizedRequest = normalizeLanqiCareLanguage(request);
  const normalizedBrief = { ...params.brief, request: normalizedRequest };
  const facts = normalizeLanqiImageFactsForModel(params.facts);
  const blockedTerms = facts.syntheticTestData
    ? [readFact(params.facts.storeName), readFact(params.facts.city)].filter((item): item is string => Boolean(item))
    : [];
  const parsed = parseEnhancement(params.enhancementAnswer, normalizedBrief);
  const fallback = buildDeterministicEnhancement(normalizedBrief, facts, params.previous);
  const enhancement = parsed ?? fallback;
  const directions = enhancement.directions.map((direction, index) => sanitizeLanqiDirection(normalizeDirection(direction, index, normalizedBrief), blockedTerms));
  const selectedDirectionId = directions.some(item => item.id === params.previous?.selectedDirectionId)
    ? params.previous!.selectedDirectionId
    : directions[0]!.id;
  const selected = directions.find(item => item.id === selectedDirectionId) ?? directions[0]!;
  const complianceNotes = normalizedRequest !== request
    ? ["已将“问题肌肤修复”等可能造成效果承诺的表述规范为“问题肌肤日常护理”；保留护理主题，不表达治疗或修复效果。"]
    : [];
  const defaultQuestions = inferMissingQuestions(normalizedRequest, normalizedBrief, facts);
  const missingQuestions = Array.from(new Set([...defaultQuestions, ...enhancement.missingQuestions]))
    .map(item => sanitizeLanqiModelText(item, blockedTerms))
    .filter(Boolean);
  const factBoundary = confirmedFactBoundary(facts);

  return {
    id: params.id,
    request,
    inputSummary: request,
    purpose: params.brief.purpose,
    ratio: params.brief.ratio,
    style: params.brief.style,
    textMode: params.brief.textMode,
    overlayText: params.brief.overlayText?.trim() || undefined,
    rightsConfirmed: true,
    intentUnderstanding: sanitizeLanqiModelText(enhancement.intentUnderstanding, blockedTerms),
    missingQuestions: filterMissingQuestions(missingQuestions, normalizedBrief).slice(0, 3),
    directions,
    selectedDirectionId,
    promptPreview: selected.positivePrompt,
    negativePrompt: selected.negativePrompt,
    factBoundary,
    complianceNotes,
    enhancer: {
      id: LANQI_IMAGE_PROMPT_SKILL,
      version: LANQI_IMAGE_PROMPT_VERSION,
      source: parsed ? "runtime_skill" : "deterministic_fallback",
      revisionSummary: sanitizeLanqiModelText(enhancement.revisionSummary, blockedTerms),
      basePreviewId: params.brief.basePreviewId,
    },
    modelAdapter: buildModelAdapter(params.brief.ratio, selected),
    factSummary: facts,
    knowledgeVersion: {
      status: "not_loaded",
      version: null,
      note: "当前没有已审核并激活到本租户的兰琪专属知识版本；预览只使用门店已确认资料和通用视觉表达。",
    },
    quotePreview: {
      creditCost: LANQI_IMAGE_PREVIEW_CREDIT_ESTIMATE,
      billable: false,
      confirmationRequired: true,
      note: "这是未来真实生成的产品积分预估；本次提示词增强不扣积分、不创建图片任务。",
    },
    execution: {
      status: "preview_only",
      canSubmit: false,
      requiredCapability: LANQI_IMAGE_CAPABILITY,
      storageDependency: "media.asset.persist",
      billingDependency: "credits.reserve_and_settle",
      blockedReason: "尚未获得真实生成授权，永久存储或图片模型能力也未完成放行。",
    },
    status: "preview",
    createdAt: now,
    updatedAt: now,
  };
}

export function selectLanqiImageDirection(preview: LanqiImagePreview, directionId: string, now = new Date().toISOString()): LanqiImagePreview | undefined {
  const selected = preview.directions.find(item => item.id === directionId);
  if (!selected) return undefined;
  return {
    ...preview,
    selectedDirectionId: directionId,
    promptPreview: selected.positivePrompt,
    negativePrompt: selected.negativePrompt,
    modelAdapter: buildModelAdapter(preview.ratio, selected),
    updatedAt: now,
  };
}

export function sanitizeLanqiImagePreviewForDisplay(preview: LanqiImagePreview): LanqiImagePreview {
  const rawFacts = preview.factSummary ?? { mainServices: [] };
  const facts = normalizeLanqiImageFactsForModel(rawFacts);
  const blockedTerms = facts.syntheticTestData
    ? [readFact(rawFacts.storeName), readFact(rawFacts.city)].filter((item): item is string => Boolean(item))
    : [];
  const directions = preview.directions.map(direction => sanitizeLanqiDirection(direction, blockedTerms));
  const selected = directions.find(item => item.id === preview.selectedDirectionId) ?? directions[0]!;
  const normalizedRequest = normalizeLanqiCareLanguage(preview.request);
  const complianceNotes = normalizedRequest !== preview.request
    ? ["已将“问题肌肤修复”等可能造成效果承诺的表述规范为“问题肌肤日常护理”；保留护理主题，不表达治疗或修复效果。"]
    : preview.complianceNotes ?? [];
  const missingQuestions = Array.from(new Set([
    ...inferMissingQuestions(normalizedRequest, preview, facts),
    ...preview.missingQuestions,
  ])).map(item => sanitizeLanqiModelText(item, blockedTerms)).filter(Boolean).slice(0, 3);
  return {
    ...preview,
    inputSummary: normalizeLanqiCareLanguage(preview.inputSummary || preview.request),
    intentUnderstanding: facts.syntheticTestData
      ? `为本店制作一张${purposeLabels[preview.purpose]}，保留用户需求“${normalizedRequest}”；不使用未确认的门店名称、城市、疗效、价格、案例或真实门店场景。`
      : sanitizeLanqiModelText(preview.intentUnderstanding, blockedTerms),
    missingQuestions,
    directions,
    selectedDirectionId: selected.id,
    promptPreview: selected.positivePrompt,
    negativePrompt: selected.negativePrompt,
    factBoundary: confirmedFactBoundary(facts),
    complianceNotes,
    enhancer: { ...preview.enhancer, revisionSummary: sanitizeLanqiModelText(preview.enhancer.revisionSummary, blockedTerms) },
    modelAdapter: buildModelAdapter(preview.ratio, selected),
    factSummary: facts,
  };
}

export function dedupeLanqiImagePreviews(previews: LanqiImagePreview[]): LanqiImagePreview[] {
  const seen = new Set<string>();
  return previews.filter(preview => {
    const key = [preview.inputSummary || preview.request, preview.purpose, preview.ratio, preview.style, preview.textMode, preview.overlayText ?? "", preview.promptPreview]
      .map(item => String(item).trim().toLowerCase().replace(/\s+/g, " "))
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sanitizeImageInput(value: string): string {
  return value
    .replace(/1[3-9]\d{9}/g, "[手机号已隐藏]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已隐藏]")
    .replace(/\b\d{17}[\dXx]\b/g, "[证件号已隐藏]")
    .replace(/(微信|vx|v信)\s*[:：]?\s*[A-Za-z][A-Za-z0-9_-]{5,19}/gi, "$1：[账号已隐藏]")
    .trim()
    .slice(0, 1200);
}

function buildDeterministicEnhancement(
  brief: LanqiImageBrief,
  facts: LanqiImageModelFacts,
  previous?: LanqiImagePreview,
) {
  const request = sanitizeImageInput(brief.request).replace(managementTerms, "").trim();
  const visual = styleVisuals[brief.style];
  const subject = inferSubject(request, facts.mainServices);
  const visualSubject = describeVisualSubject(subject, request);
  const intentUnderstanding = brief.intentUnderstanding?.trim()
    || `为${facts.city ? `${facts.city}本地` : "当前门店"}制作一张${purposeLabels[brief.purpose]}，核心表现“${subject}”，保持${visual.mood}。用户原始意图与限制为：“${request}”。`;
  const missingQuestions = inferMissingQuestions(request, brief, facts);
  const overlayText = {
    mode: "post_process" as const,
    text: brief.textMode === "provided_text" ? brief.overlayText?.trim() || "" : "",
    placement: "top_safe_area" as const,
  };
  const baseNegative = buildNegativePrompt(request);
  const shared = {
    purpose: brief.purpose,
    aspectRatio: brief.ratio,
    style: brief.style,
    subject,
    clarity: "high" as const,
  };
  const revision = sanitizeImageInput(brief.revisionInstruction ?? "");
  const directions: LanqiImagePromptDirection[] = [
    {
      id: "direction-1",
      name: "高级留白",
      variable: "构图与留白",
      positivePrompt: `${brief.ratio} ${purposeLabels[brief.purpose]}底图，${visualSubject}。采用单一视觉中心和不对称编辑式构图，主体位于画面下方或侧下方，顶部形成干净连贯的标题安全留白区。使用${visual.light}，${visual.palette}，整体${visual.mood}。以50mm中近景视角呈现清透层次，材质细腻、边缘自然、反光克制，背景为不指向任何真实门店的中性专业棚拍环境，高分辨率、商业美业摄影质感、主体清晰、细节真实。${revision ? `本轮只按“${revision}”微调，其他构图与主体保持。` : ""}`.trim(),
      negativePrompt: baseNegative,
      overlayText,
      parameters: { ...shared, composition: "单一视觉中心，不对称编辑构图，顶部安全留白", scene: "非真实门店的中性专业棚拍环境", lighting: visual.light, colorPalette: visual.palette, camera: "50mm 中近景，轻微俯拍", materials: "细腻真实、半哑光、克制反光" },
    },
    {
      id: "direction-2",
      name: "真实材质",
      variable: "材质写实程度",
      positivePrompt: `${brief.ratio} ${purposeLabels[brief.purpose]}底图，${visualSubject}。构图维持简洁聚焦，使用近距离细节摄影表现水润、柔软、洁净等与主题一致的真实材质层次。主体纹理具有微小自然起伏和可信反射，背景采用无品牌、不可识别地点的暖白中性台面，顶部保留干净完整的标题安全区。使用柔和窗边侧光、真实阴影和${visual.palette}，85mm微距感镜头，浅景深但主体关键细节清晰，高分辨率商业静物摄影。${revision ? `本轮只按“${revision}”调整，主体和构图不变。` : ""}`.trim(),
      negativePrompt: baseNegative,
      overlayText,
      parameters: { ...shared, composition: "近距离细节构图，主体聚焦，顶部留白", scene: "无品牌、不可识别地点的中性台面", lighting: "柔和窗边侧光与真实阴影", colorPalette: visual.palette, camera: "85mm 微距感，浅景深", materials: "真实细纹理、自然反射、无塑料感" },
    },
    {
      id: "direction-3",
      name: "温暖氛围",
      variable: "光线与色温",
      positivePrompt: `${brief.ratio} ${purposeLabels[brief.purpose]}底图，${visualSubject}。采用稳定的中景层次和少量前景虚化，背景使用抽象柔和空间。光线变量调整为清晨般的暖色漫射光，从侧后方形成柔和轮廓与空气感，阴影轻盈，画面以奶油白、杏橙和低饱和蜜桃色为主，色彩温暖但不过黄。上方保留完整干净的标题安全区；50mm标准镜头，自然透视，织物与半透明材质触感真实，高分辨率、干净、亲和、可用于本地美业内容。${revision ? `本轮只按“${revision}”微调色温或氛围，不改变主体与画幅。` : ""}`.trim(),
      negativePrompt: baseNegative,
      overlayText,
      parameters: { ...shared, composition: "稳定中景，少量前景虚化，上方标题留白", scene: "不代表真实门店的抽象柔和空间", lighting: "清晨暖色漫射光与柔和侧后轮廓光", colorPalette: "奶油白、杏橙、低饱和蜜桃色", camera: "50mm 标准镜头，自然透视", materials: "柔软织物与半透明材质，触感真实" },
    },
  ];
  return {
    intentUnderstanding,
    missingQuestions,
    directions: preserveRequestedInvariant(directions, previous, revision),
    revisionSummary: revision || "首次增强：仅将普通需求转换为三个单变量视觉方向",
    factBoundary: confirmedFactBoundary(facts),
  };
}

function parseEnhancement(answer: string | undefined, brief: LanqiImageBrief): {
  intentUnderstanding: string;
  missingQuestions: string[];
  directions: LanqiImagePromptDirection[];
  revisionSummary: string;
  factBoundary: string[];
} | undefined {
  if (!answer?.trim()) return undefined;
  try {
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    const raw = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof raw.intentUnderstanding !== "string" || !Array.isArray(raw.directions)) return undefined;
    const directions = raw.directions
      .slice(0, 3)
      .map((item, index) => parseDirection(item, index, brief))
      .filter((item): item is LanqiImagePromptDirection => Boolean(item));
    if (directions.length < 2) return undefined;
    return {
      intentUnderstanding: raw.intentUnderstanding.trim().slice(0, 500),
      missingQuestions: Array.isArray(raw.missingQuestions) ? raw.missingQuestions.filter(isString).map(cleanText).slice(0, 3) : [],
      directions,
      revisionSummary: typeof raw.revisionSummary === "string" ? cleanText(raw.revisionSummary).slice(0, 300) : "模型增强",
      factBoundary: Array.isArray(raw.factBoundary) ? raw.factBoundary.filter(isString).map(cleanText).slice(0, 8) : [],
    };
  } catch {
    return undefined;
  }
}

function parseDirection(value: unknown, index: number, brief: LanqiImageBrief): LanqiImagePromptDirection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.positivePrompt !== "string" || raw.positivePrompt.trim().length < 80 || typeof raw.negativePrompt !== "string") return undefined;
  const parameters = raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters) ? raw.parameters as Record<string, unknown> : {};
  const overlay = raw.overlayText && typeof raw.overlayText === "object" && !Array.isArray(raw.overlayText) ? raw.overlayText as Record<string, unknown> : {};
  const proposedName = typeof raw.name === "string" ? cleanText(raw.name).slice(0, 40) : "";
  const proposedVariable = typeof raw.variable === "string" ? cleanText(raw.variable).slice(0, 80) : "";
  const genericName = !proposedName || /^方向\s*[一二三123]$/i.test(proposedName);
  const genericVariable = !proposedVariable || /^(?:视觉方向|风格方向|direction|style)$/i.test(proposedVariable);
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 60) : `direction-${index + 1}`,
    name: genericName ? fallbackNames[index] ?? `方向 ${index + 1}` : proposedName,
    variable: genericVariable ? fallbackVariables[index] ?? "视觉方向" : proposedVariable,
    positivePrompt: cleanPrompt(raw.positivePrompt),
    negativePrompt: mergeRequiredNegativePrompt(raw.negativePrompt, brief.request),
    overlayText: {
      mode: "post_process",
      text: brief.textMode === "provided_text" ? brief.overlayText?.trim() || "" : "",
      placement: readPlacement(overlay.placement),
    },
    parameters: {
      purpose: brief.purpose,
      aspectRatio: brief.ratio,
      style: brief.style,
      composition: readParameter(parameters.composition, "主体聚焦并预留标题安全区", 8),
      subject: readParameter(parameters.subject, sanitizeImageInput(brief.request)),
      scene: readParameter(parameters.scene, "不代表真实门店的中性场景"),
      lighting: readParameter(parameters.lighting, styleVisuals[brief.style].light),
      colorPalette: readParameter(parameters.colorPalette, styleVisuals[brief.style].palette),
      camera: readParameter(parameters.camera, "50mm 标准镜头"),
      materials: readParameter(parameters.materials, "真实细腻材质"),
      clarity: "high",
    },
  };
}

function normalizeDirection(direction: LanqiImagePromptDirection, index: number, brief: LanqiImageBrief): LanqiImagePromptDirection {
  return parseDirection(direction, index, brief) ?? buildDeterministicEnhancement(brief, { mainServices: [], displayStoreName: "本店", syntheticTestData: false }).directions[index % 3]!;
}

function buildModelAdapter(ratio: LanqiImageRatio, selected: LanqiImagePromptDirection): LanqiImagePreview["modelAdapter"] {
  return {
    capability: LANQI_IMAGE_CAPABILITY,
    prompt: selected.positivePrompt,
    negativePrompt: selected.negativePrompt,
    parameters: { aspectRatio: ratio, canvas: canvasByRatio[ratio], imageCount: 1, renderText: false, watermark: true },
    overlayText: selected.overlayText,
  };
}

function preserveRequestedInvariant(directions: LanqiImagePromptDirection[], previous: LanqiImagePreview | undefined, revision: string): LanqiImagePromptDirection[] {
  if (!previous || !revision || !/保持构图|构图不变/.test(revision) || !/颜色|色彩|色温/.test(revision)) return directions;
  const previousSelected = previous.directions.find(item => item.id === previous.selectedDirectionId) ?? previous.directions[0];
  if (!previousSelected) return directions;
  return directions.map((direction, index) => ({
    ...direction,
    id: index === 0 ? previousSelected.id : direction.id,
    parameters: { ...direction.parameters, composition: previousSelected.parameters.composition },
  }));
}

function inferSubject(request: string, services: string[]): string {
  const matchingService = services.find(service => request.includes(service));
  if (matchingService) return matchingService;
  const concise = request
    .replace(/^.*?(?:做|制作|设计)一张/, "")
    .replace(/(?:小红书封面|社交平台海报|服务项目介绍图|门店品牌形象图).*$/, "")
    .replace(/[，。；;].*$/, "")
    .replace(/^(?:一张|一个)/, "")
    .trim();
  return concise.slice(0, 80) || request.replace(/[，。；;].*$/, "").slice(0, 80) || "用户指定的美业服务主题";
}

function describeVisualSubject(subject: string, request: string): string {
  if (/补水|水润|保湿/.test(`${subject}${request}`)) {
    return `以“${subject}”为主题，清透水滴、柔和水波与半透明凝露形成可见的水润层次，少量柔软织物作为陪体`;
  }
  if (/产品|包装|瓶|仪器|设备/.test(`${subject}${request}`)) {
    return `以用户提供并确认有权使用的“${subject}”参考主体为视觉中心，保持外形、比例与标识位置一致`;
  }
  if (/美容师|人物|模特|老师/.test(`${subject}${request}`)) {
    return `以经授权且符合用户描述的“${subject}”人物为主体，姿态自然，身份特征不过度推断`;
  }
  if (/门店活动|活动/.test(`${subject}${request}`)) {
    return `以“${subject}”的轻盈庆祝氛围为视觉中心，使用抽象色块与克制装饰形成活动感`;
  }
  return `以“${subject}”为视觉中心，用与主题一致的真实美业静物和细腻材质建立清晰层次`;
}

function inferMissingQuestions(request: string, brief: LanqiImageBrief, facts: { storeName?: string; city?: string; mainServices: string[] }): string[] {
  const questions: string[] = [];
  if (!facts.storeName) questions.push("如需展示真实门店名称，请先在经营档案中确认；当前提示词统一使用“本店”，不会补写门店名。");
  if (/产品|包装|瓶|仪器|设备/.test(request) && !/已上传|参考图|具体型号|具体产品/.test(request)) questions.push("若要准确呈现具体产品或设备，请补充已授权参考图；否则将使用不带品牌的中性视觉表达。");
  if (/店内|前台|护理间|门店环境|门店实景/.test(request) && !/已上传|实景图|参考图/.test(request)) questions.push("若要表现真实门店环境，请补充已授权实景参考图；当前不会虚构门店装修。");
  if (/顾客|人物|模特|美容师|老师/.test(request) && !/不出现|不要人物|不露脸|不出现正脸/.test(request)) questions.push("人物需要可识别到具体真人吗？如需要，请补充肖像授权和参考素材；否则仅生成不可识别人物。");
  if (/兰琪色|品牌色|logo|标志/.test(request) && !/#(?:[0-9a-f]{3}){1,2}\b/i.test(request)) questions.push("若要准确使用品牌色或标志，请补充已授权色值或品牌素材。");
  if (!facts.mainServices.length && brief.purpose === "service_intro") questions.push("这张项目介绍图对应哪项已确认服务？补充服务名称后能避免画错主体。");
  return questions.slice(0, 3);
}

function buildNegativePrompt(request: string): string {
  const items = ["低清晰度", "过度磨皮", "塑料皮肤", "肢体畸形", "多余手指", "错误手部", "扭曲面部", "乱码中文", "随机英文", "错误商标", "价格标签", "促销数字", "医疗前后对比", "夸张疗效视觉", "虚构顾客案例", "虚构门店标识", "拥挤构图", "脏乱背景"];
  if (/不出现顾客正脸|不露脸|不要正脸/.test(request)) items.push("可识别顾客正脸", "正面人像特写");
  if (/不出现人物|不要人物|无人/.test(request)) items.push("人物", "人手", "人脸");
  return Array.from(new Set(items)).join("，");
}

function filterMissingQuestions(questions: string[], brief: LanqiImageBrief): string[] {
  return questions.filter(question => {
    if (brief.textMode !== "provided_text" && /标题|文案|叠字|哪几个字/.test(question)) return false;
    if (!/城市|地域|地标/.test(brief.request) && /城市名|所在城市|地域/.test(question)) return false;
    if (!/品牌|logo|标志|兰琪色/.test(brief.request) && /品牌名|品牌色|logo|标志/.test(question)) return false;
    return true;
  });
}

function confirmedFactBoundary(facts: LanqiImageModelFacts): string[] {
  const result = [
    facts.storeName ? `已确认门店名称：${facts.storeName}` : "门店名称未确认：用户可见文案使用“本店”，本次不绘制门店标志",
    facts.city ? `已确认城市：${facts.city}` : "城市待补，本次不添加地域地标",
    facts.mainServices.length ? `已确认服务：${facts.mainServices.join("、")}` : "服务清单待补，只保留用户本轮明确主题",
    ...(facts.syntheticTestData ? ["当前验收档案为合成测试数据；内部测试门店名和城市未作为真实事实进入提示词"] : []),
    "兰琪专属知识版本未加载，本次未引用兰琪方法论或内部定价",
  ];
  return result;
}

function sanitizeLanqiModelText(value: string, blockedTerms: string[]): string {
  let result = normalizeLanqiCareLanguage(cleanText(value));
  for (const term of blockedTerms) result = result.split(term).join("");
  result = result
    .replace(new RegExp(syntheticStoreNamePattern.source, "gi"), "本店")
    .replace(/(?:青岛|烟台|济南|北京|上海)?\s*(?:本店){2,}/g, "本店")
    .replace(/\s{2,}/g, " ")
    .replace(/([，。；：])\1+/g, "$1")
    .trim();
  return result;
}

function sanitizeLanqiDirection(direction: LanqiImagePromptDirection, blockedTerms: string[]): LanqiImagePromptDirection {
  return {
    ...direction,
    name: sanitizeLanqiModelText(direction.name, blockedTerms),
    variable: sanitizeLanqiModelText(direction.variable, blockedTerms),
    positivePrompt: sanitizeLanqiModelText(direction.positivePrompt, blockedTerms),
    negativePrompt: sanitizeLanqiModelText(direction.negativePrompt, blockedTerms),
    parameters: {
      ...direction.parameters,
      composition: sanitizeLanqiModelText(direction.parameters.composition, blockedTerms),
      subject: sanitizeLanqiModelText(direction.parameters.subject, blockedTerms),
      scene: sanitizeLanqiModelText(direction.parameters.scene, blockedTerms),
      lighting: sanitizeLanqiModelText(direction.parameters.lighting, blockedTerms),
      colorPalette: sanitizeLanqiModelText(direction.parameters.colorPalette, blockedTerms),
      camera: sanitizeLanqiModelText(direction.parameters.camera, blockedTerms),
      materials: sanitizeLanqiModelText(direction.parameters.materials, blockedTerms),
    },
  };
}

function cleanPrompt(value: string): string {
  return cleanText(value).replace(managementTerms, "").replace(/\s{2,}/g, " ").slice(0, 5000);
}

function cleanNegativePrompt(value: string): string {
  return cleanText(value)
    .split(/[，,]/)
    .map(item => item.trim())
    .filter(item => item && !/^(?:watermark|水印)$/i.test(item))
    .join("，")
    .slice(0, 1200);
}

function mergeRequiredNegativePrompt(value: string, request: string): string {
  return Array.from(new Set([
    ...cleanNegativePrompt(value).split("，"),
    ...buildNegativePrompt(request).split("，"),
  ].map(item => item.trim()).filter(Boolean))).join("，").slice(0, 1200);
}

function cleanText(value: string): string {
  return sanitizeImageInput(value).replace(/[\u0000-\u001f]/g, " ").trim();
}

function readParameter(value: unknown, fallback: string, minimumLength = 1): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const cleaned = cleanText(value).slice(0, 300);
  return cleaned.length >= minimumLength ? cleaned : fallback;
}

function readPlacement(value: unknown): LanqiImagePromptDirection["overlayText"]["placement"] {
  return value === "center_safe_area" || value === "bottom_safe_area" ? value : "top_safe_area";
}

function readFact(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || undefined;
  return value?.trim() || undefined;
}

function readList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(item => item.trim()).filter(Boolean);
  return value?.split(/[，,、]/).map(item => item.trim()).filter(Boolean) ?? [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
