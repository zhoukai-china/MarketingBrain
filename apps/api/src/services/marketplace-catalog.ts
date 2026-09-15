import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, prisma } from "@baolu/db";
import { env } from "../config/env.js";

const v3Data = JSON.parse(
  readFileSync(new URL("../data/marketplace-v3.json", import.meta.url), "utf8")
) as {
  skills: Record<string, Record<string, unknown>>;
  industries: Record<string, Record<string, unknown>>;
};

const MARKETPLACE_ZONE_ICONS: Record<string, string> = {
  ipzone: "🚀",
  canyin: "🍜",
  meiye: "💆",
  lanqi: "🧠",
  chongwu: "🐾",
  // 行业专家专区（用户 2026-09-15）：先放老板的能力分身，后续再引入财税/股权等专家。
  expert: "🎓"
};

/**
 * 开卖状态（`ov.<skill>.status`）以**发布文件** `marketplace-v3.json` 为准，不从数据库专区 profile 读。
 *
 * 原因：专区 profile 行支持运维在运行时改（`PATCH /market/admin/industries/:key`），
 * 而 `syncMarketplaceIndustryProfiles()` 只在首次建行时写入 `ov`、之后不再覆盖；而
 * `loadMarketplaceIndustryProfiles()` 又会用库里的 `ov` 覆盖内存里的文件值。
 * 于是「改文件 + 发版」在库里已有 profile 行的环境下会静默失效
 * （2026-09-11 实测：文件已是 selling，线上仍是 coming_soon）。
 * 开卖=动钱，必须随发布走、可回滚，所以这里固定读发布文件的 `ov.<skill>.status`。
 */
const MARKETPLACE_SKU_STATUS_OVERRIDES: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(v3Data.industries).map(([zoneKey, industry]) => {
    const ov = (industry.ov ?? {}) as Record<string, Record<string, unknown>>;
    const perSkill: Record<string, string> = {};
    for (const [skillId, entry] of Object.entries(ov)) {
      const status = industryValue(entry?.status);
      if (status) perSkill[skillId] = status;
    }
    return [zoneKey, perSkill];
  })
);

export const MARKETPLACE_ZONES = Object.values(v3Data.industries).map((industry) => ({
  key: String(industry.key),
  name: String(industry.title),
  tagline: String(industry.tag),
  icon: MARKETPLACE_ZONE_ICONS[String(industry.key)] ?? "🏭",
  ready: Boolean(industry.ready),
  general: Boolean(industry.general),
  prefix: typeof industry.prefix === "string" ? industry.prefix : undefined
}));

export const MARKETPLACE_INDUSTRIES = Object.fromEntries(
  Object.entries(v3Data.industries).map(([key, industry]) => [
    key,
    {
      key,
      title: String(industry.title),
      tag: String(industry.tag),
      ready: Boolean(industry.ready),
      general: Boolean(industry.general),
      prefix: typeof industry.prefix === "string" ? industry.prefix : undefined,
      who: industryValue(industry.who),
      lexicon: industryValues(industry.lexicon),
      pains: industryValues(industry.pains),
      redline: industryValues(industry.redline),
      skills: industryValues(industry.skills),
      ov: (industry.ov ?? {}) as Record<string, Record<string, unknown>>
    }
  ])
) as Record<string, {
  key: string;
  title: string;
  tag: string;
  ready: boolean;
  general: boolean;
  prefix?: string;
  who?: string;
  lexicon: string[];
  pains: string[];
  redline: string[];
  skills: string[];
  ov: Record<string, Record<string, unknown>>;
}>;

export type MarketplaceZoneKey = (typeof MARKETPLACE_ZONES)[number]["key"];

export type MarketplaceSkuStatus =
  | "selling"
  | "trial"
  | "internal"
  | "coming_soon"
  | "offline";

export interface MarketplaceSupplierSeed {
  code: string;
  name: string;
  type: "self_operated" | "third_party";
  settlementRate: number;
  contactEmail?: string;
  status?: string;
}

export interface MarketplaceSkuSeed {
  skuCode: string;
  agentId?: string;
  capabilityKey?: string;
  supplierCode: string;
  zone: string;
  name: string;
  icon: string;
  badge?: string;
  description: string;
  verbs: string[];
  useCase: string;
  need: string;
  tags: string[];
  keywords: string[];
  ppu: number;
  subscriptionPriceCny?: number;
  subscriptionQuota?: string;
  trial: boolean;
  status: MarketplaceSkuStatus;
  sortOrder: number;
}

export const MARKETPLACE_SUPPLIER_SEEDS: MarketplaceSupplierSeed[] = [
  {
    code: "sitong_self",
    name: "思潼AI 自营",
    type: "self_operated",
    settlementRate: 0,
    contactEmail: "ops@sitong.ai"
  }
];

export const MARKETPLACE_SKU_SEEDS: MarketplaceSkuSeed[] = [
  {
    skuCode: "ip-pos",
    capabilityKey: "ip_positioning",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "IP定位智能体",
    icon: "🎯",
    description: "把创始人、门店或品牌讲成一个有记忆点、能持续输出的 IP。",
    verbs: ["定位", "人设", "内容方向"],
    useCase: "1 次使用 = 帮你完成一份 IP 定位与内容方向草案",
    need: "项目名称、目标人群、创始人或门店基础信息",
    tags: ["IP定位", "个人IP", "创始人IP", "人设", "内容方向"],
    keywords: ["抖音IP", "视频号IP", "创始人定位", "怎么做个人IP"],
    ppu: 5,
    trial: true,
    status: "selling",
    sortOrder: 10
  },
  {
    skuCode: "topic",
    capabilityKey: "topic_inspiration",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "选题智能体",
    icon: "💡",
    description: "从热点、复盘、对标账号和真实资料中筛出值得拍、能转化的选题。",
    verbs: ["选题", "热点", "内容策划"],
    useCase: "1 次使用 = 帮你筛出可执行的 10 个选题",
    need: "行业、目标人群、账号阶段和已有内容数据",
    tags: ["选题", "热点", "选题策划", "爆款选题"],
    keywords: ["短视频选题", "视频号选题", "抖音选题", "内容选题"],
    ppu: 3,
    subscriptionPriceCny: 198,
    subscriptionQuota: "每天 10 次选题",
    trial: true,
    status: "selling",
    sortOrder: 20
  },
  {
    skuCode: "copy",
    capabilityKey: "content_plan",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "文案智能体",
    icon: "✍️",
    description: "把已确认事实生成口播逐字稿、标题、话题和发布建议。",
    verbs: ["文案", "口播", "内容创作"],
    useCase: "1 次使用 = 帮你生成一套可直接拍摄的内容脚本",
    need: "选题、目标人群、产品/服务事实和发布平台",
    tags: ["文案", "口播稿", "短视频脚本", "内容创作"],
    keywords: ["短视频文案", "口播逐字稿", "内容脚本", "视频文案"],
    ppu: 3,
    subscriptionPriceCny: 298,
    subscriptionQuota: "每天 10 条文案",
    trial: true,
    status: "selling",
    sortOrder: 30
  },
  {
    skuCode: "vidrev",
    capabilityKey: "video_data_review",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "视频复盘智能体",
    icon: "📊",
    description: "先审计数据质量，再归因播放、完播、互动和转化，给出下一条动作。",
    verbs: ["视频复盘", "数据归因", "下一条动作"],
    useCase: "1 次使用 = 帮你完成一条视频的数据归因与改进动作",
    need: "视频数据（完播、互动、转化）或结构化数据文件",
    tags: ["视频复盘", "数据复盘", "短视频复盘"],
    keywords: ["视频数据复盘", "完播率", "互动率", "转化复盘"],
    ppu: 6,
    subscriptionPriceCny: 199,
    subscriptionQuota: "每天 5 次视频复盘",
    trial: true,
    status: "selling",
    sortOrder: 40
  },
  {
    skuCode: "livescript",
    capabilityKey: "live_script",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "直播话术智能体",
    icon: "🎤",
    description: "先判断带货或招商，再生成口播分段、运营动作和合规自查。",
    verbs: ["直播话术", "带货", "招商"],
    useCase: "1 次使用 = 帮你生成一套可开播的直播话术包",
    need: "直播类型、产品/项目事实、目标人群和时长",
    tags: ["直播话术", "直播脚本", "带货话术", "招商话术"],
    keywords: ["直播脚本", "带货话术", "招商直播", "直播流程"],
    ppu: 8,
    subscriptionPriceCny: 399,
    subscriptionQuota: "每天 3 套直播话术",
    trial: true,
    status: "selling",
    sortOrder: 50
  },
  {
    skuCode: "liverev",
    capabilityKey: "live_review",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "直播复盘智能体",
    icon: "🔁",
    description: "从流量、转化、互动、话术执行、人货场和方法论六个维度复盘直播。",
    verbs: ["直播复盘", "六维诊断", "迭代带"],
    useCase: "1 次使用 = 帮你完成一场直播的六维复盘",
    need: "直播类型、数据和录音/片段",
    tags: ["直播复盘", "直播诊断", "六维复盘"],
    keywords: ["直播数据复盘", "直播诊断", "直播问题"],
    ppu: 8,
    trial: true,
    status: "selling",
    sortOrder: 60
  },
  {
    skuCode: "ip-pack",
    capabilityKey: "ip_positioning",
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "创始人IP增长套装",
    icon: "🚀",
    badge: "全案套装",
    description: "覆盖定位、选题、内容、复盘、直播和私域承接的创始人 IP 全案。",
    verbs: ["全案", "定位", "内容", "直播", "复盘"],
    useCase: "1 次使用 = 帮你完成一套创始人 IP 增长方案",
    need: "创始人基础信息、目标人群、现有账号和经营目标",
    tags: ["创始人IP", "全案套装", "IP增长"],
    keywords: ["创始人IP全案", "IP增长方案", "个人品牌全案"],
    ppu: 50,
    subscriptionPriceCny: 599,
    subscriptionQuota: "每天 1 次全案生成",
    trial: false,
    status: "selling",
    sortOrder: 70
  },
  {
    skuCode: "moments",
    capabilityKey: "private_domain",
    supplierCode: "sitong_self",
    zone: "siyu",
    name: "朋友圈文案智能体",
    icon: "💬",
    badge: "新",
    description: "按七柱内容结构生成有信任、有业务价值、软引导的朋友圈私域文案。",
    verbs: ["朋友圈", "私域", "文案"],
    useCase: "1 次使用 = 帮你生成一组可发的朋友圈私域文案",
    need: "发圈对象、主题、业务目标和已确认事实",
    tags: ["朋友圈文案", "私域营销", "朋友圈"],
    keywords: ["朋友圈文案", "私域内容", "朋友圈营销"],
    ppu: 3,
    subscriptionPriceCny: 158,
    subscriptionQuota: "每天 10 条朋友圈文案",
    trial: true,
    status: "selling",
    sortOrder: 10
  },
  {
    skuCode: "sales",
    capabilityKey: "customer_diagnosis",
    supplierCode: "sitong_self",
    zone: "siyu",
    name: "销售话术智能体",
    icon: "🤝",
    description: "做客户诊断、异议回复、跟单计划和成交推进，不虚假承诺。",
    verbs: ["销售", "异议回复", "跟单"],
    useCase: "1 次使用 = 帮你完成一次客户诊断与下一步话术",
    need: "客户背景或真实聊天记录",
    tags: ["销售话术", "客户诊断", "异议回复"],
    keywords: ["销售话术", "成交话术", "客户异议", "跟单计划"],
    ppu: 10,
    trial: true,
    status: "selling",
    sortOrder: 20
  },
  {
    skuCode: "catering",
    capabilityKey: "restaurant_diagnosis",
    supplierCode: "sitong_self",
    zone: "canyin",
    name: "餐饮增长智能体",
    icon: "🍽️",
    badge: "大脑",
    description: "从堂食、外卖、私域和门店经营数据定位增长瓶颈并给方案。",
    verbs: ["餐饮增长", "经营诊断", "堂食", "外卖"],
    useCase: "1 次使用 = 帮你完成一次餐饮经营增长诊断",
    need: "门店经营数据、目标人群和当前问题",
    tags: ["餐饮增长", "餐饮诊断", "堂食", "外卖"],
    keywords: ["餐饮经营", "餐饮增长方案", "门店经营诊断"],
    ppu: 20,
    subscriptionPriceCny: 1299,
    subscriptionQuota: "每天 2 次增长诊断",
    trial: false,
    status: "coming_soon",
    sortOrder: 10
  },
  {
    skuCode: "takeaway",
    capabilityKey: "takeaway_growth",
    supplierCode: "sitong_self",
    zone: "canyin",
    name: "外卖增长智能体",
    icon: "🛵",
    badge: "大脑",
    description: "面向外卖老店增长与新店突破，从平台数据定位订单与利润断点。",
    verbs: ["外卖增长", "平台诊断", "增长实验"],
    useCase: "1 次使用 = 帮你完成一次外卖增长诊断",
    need: "外卖平台数据、门店阶段和目标",
    tags: ["外卖增长", "外卖诊断", "老店增长", "新店突破"],
    keywords: ["外卖经营", "外卖订单增长", "外卖诊断"],
    ppu: 15,
    subscriptionPriceCny: 899,
    subscriptionQuota: "每天 2 次外卖诊断",
    trial: false,
    status: "coming_soon",
    sortOrder: 20
  },
  {
    skuCode: "catering-pack",
    capabilityKey: "restaurant_diagnosis",
    supplierCode: "sitong_self",
    zone: "canyin",
    name: "餐饮增长组合",
    icon: "🍜",
    badge: "全案套装",
    description: "堂食、外卖、私域一体化餐饮增长组合方案。",
    verbs: ["组合", "堂食", "外卖", "私域"],
    useCase: "1 次使用 = 帮你完成一套餐饮增长组合方案",
    need: "门店经营数据、线上平台数据和经营目标",
    tags: ["餐饮组合", "全案套装", "堂食外卖"],
    keywords: ["餐饮全案", "餐饮增长组合", "堂食外卖方案"],
    ppu: 60,
    subscriptionPriceCny: 699,
    subscriptionQuota: "每天 1 次组合方案",
    trial: false,
    status: "coming_soon",
    sortOrder: 30
  },
  {
    skuCode: "meiye",
    capabilityKey: "beauty_business_qa",
    supplierCode: "sitong_self",
    zone: "meiye",
    name: "美业AI经营大脑",
    icon: "💆",
    badge: "大脑",
    description: "面向门店与连锁的美业经营诊断、获客、成交、培训和复盘。",
    verbs: ["美业经营", "获客", "成交", "复盘"],
    useCase: "1 次使用 = 帮你完成一次美业经营诊断",
    need: "门店类型、经营事实、目标人群和当前问题",
    tags: ["美业", "经营大脑", "门店经营"],
    keywords: ["美业经营", "美业诊断", "门店增长", "美容院经营"],
    ppu: 30,
    subscriptionPriceCny: 999,
    subscriptionQuota: "每天 2 次经营诊断",
    trial: false,
    status: "coming_soon",
    sortOrder: 10
  },
  {
    skuCode: "third-party-placeholder",
    agentId: undefined,
    supplierCode: "sitong_self",
    zone: "gongyu",
    name: "第三方示例智能体",
    icon: "🔌",
    badge: "第三方",
    description: "用于验证供应商分账与后端搜索的第三方商品占位，不接具体智能体输出。",
    verbs: ["占位", "供应商"],
    useCase: "1 次使用 = 验证第三方 SKU 的货架与权限链路",
    need: "演示用途，不接真实客户数据",
    tags: ["第三方", "供应商", "占位"],
    keywords: ["第三方agent", "供应商分账", "平台化"],
    ppu: 1,
    trial: false,
    status: "internal",
    sortOrder: 999
  }
];

export const PUBLIC_MARKETPLACE_STATUSES: MarketplaceSkuStatus[] = [
  "selling",
  "trial",
  "internal",
  "coming_soon"
];

/** 货架对外可见但不可下单的状态：展示「开发中」，禁止购买与运行。 */
const MARKETPLACE_STATUS_WHITELIST: MarketplaceSkuStatus[] = [
  "selling",
  "trial",
  "internal",
  "coming_soon",
  "offline"
];

export function normalizeMarketplaceSkuStatus(value: unknown): MarketplaceSkuStatus {
  return typeof value === "string" && (MARKETPLACE_STATUS_WHITELIST as string[]).includes(value)
    ? (value as MarketplaceSkuStatus)
    : "selling";
}

/** 只有 selling / trial / internal 允许进入下单与运行链路。 */
export function isMarketplaceSkuPurchasable(status: MarketplaceSkuStatus | string | null | undefined): boolean {
  return status === "selling" || status === "trial" || status === "internal";
}

export interface MarketplaceSkuQuery {
  q?: string;
  zone?: string;
  tag?: string;
  badge?: string;
  trial?: boolean;
  supplierId?: string;
  minPpu?: number;
  maxPpu?: number;
  minSub?: number;
  maxSub?: number;
  status?: MarketplaceSkuStatus;
}

export interface PublicMarketplaceSku {
  id: string;
  skuCode: string;
  agentId?: string | null;
  capabilityKey?: string | null;
  zone: string;
  zoneName: string;
  name: string;
  icon?: string | null;
  badge?: string | null;
  description: string;
  verbs: string[];
  useCase: string;
  need: string;
  tags: string[];
  keywords: string[];
  ppu: number;
  subscriptionPriceCny?: number | null;
  subscriptionQuota?: string | null;
  trial: boolean;
  status: MarketplaceSkuStatus;
  sortOrder: number;
  supplierId: string;
  supplierName: string;
  supplierType: string;
}

const MARKETPLACE_CAPABILITY_BY_SKILL: Record<string, string> = {
  "ip-pos": "ip_positioning",
  topic: "topic_inspiration",
  copy: "content_plan",
  vidrev: "video_data_review",
  livescript: "live_script",
  liverev: "live_review",
  sales: "customer_diagnosis",
  moments: "private_domain",
  "ip-pack": "ip_positioning"
};

function industryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function industryValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildMarketplaceSkuSeeds(): MarketplaceSkuSeed[] {
  const seeds: MarketplaceSkuSeed[] = [];
  for (const [industryKey, industry] of Object.entries(MARKETPLACE_INDUSTRIES)) {
    if (!industry.ready) continue;
    const zone = industryKey as MarketplaceZoneKey;
    const prefix = industryValue(industry.prefix) ?? "";
    const lexicon = industryValues(industry.lexicon);
    const pains = industryValues(industry.pains);
    const overrideMap = industry.ov ?? {};
    // 品牌专区可以只上架自己的内核（industries[].skills 白名单）。未声明的专区保持原行为：上架全部通用内核。
    // 2026-09-15：**显式声明空数组 = 本专区暂不上架任何智能体**（行业专家专区先建栏、后放专家）。
    const declaredSkills = (v3Data.industries as Record<string, { skills?: unknown }>)[industryKey]?.skills;
    if (Array.isArray(declaredSkills) && declaredSkills.length === 0) continue;
    const zoneSkillAllowList = industryValues(industry.skills);

    for (const [skillId, core] of Object.entries(v3Data.skills)) {
      if (zoneSkillAllowList.length > 0 && !zoneSkillAllowList.includes(skillId)) continue;
      // 品牌专属内核可以用 skills[].zones 限定只在指定专区上架（如 lanqi-brain 只在兰琪专区）。
      // 未声明 zones 的内核保持原有行为：在全部 ready 专区上架。
      const skillZones = industryValues(core.zones);
      if (skillZones.length > 0 && !skillZones.includes(industryKey)) continue;

      const override = overrideMap[skillId] ?? {};
      const id = `${industryKey}__${skillId}`;
      const coreName = industryValue(core.name) ?? skillId;
      const name = industryValue(override.name) ?? `${prefix}${coreName}`;
      const useCase = industryValue(override.use) ?? industryValue(core.use) ?? "一次使用 = 交付结构化业务结果";
      const need = industryValue(override.need) ?? industryValue(core.need) ?? "";
      const verbs = industryValues(override.verbs).length > 0
        ? industryValues(override.verbs)
        : industryValues(core.verbs);
      const description = industryValue(override.cap)
        ?? industryValue(core.cap)
        ?? useCase;
      const tags = [
        ...new Set([
          ...(industryValues(core.verbs)),
          ...verbs,
          ...lexicon,
          ...pains
        ])
      ].slice(0, 30);
      const keywords = [...lexicon, ...pains, name, useCase].slice(0, 30);
      const sub = (core.sub ?? {}) as { price?: number; quota?: string };

      seeds.push({
        skuCode: id,
        capabilityKey: MARKETPLACE_CAPABILITY_BY_SKILL[skillId],
        supplierCode: "sitong_self",
        zone,
        name,
        icon: industryValue(core.ico) ?? "🤖",
        badge: industryValue(core.badge),
        description,
        verbs: verbs.length > 0 ? verbs.slice(0, 12) : ["智能体"],
        useCase,
        need,
        tags,
        keywords,
        ppu: Number(core.ppu) || 0,
        subscriptionPriceCny: typeof sub.price === "number" ? sub.price : undefined,
        subscriptionQuota: typeof sub.quota === "string" ? sub.quota : undefined,
        trial: Boolean(core.trial),
        // 专区级 override 可以单独改开卖状态：同一个内核在不同专区的准备度不同。
        // 优先取发布文件里的 `ov.<skill>.status`（见 MARKETPLACE_SKU_STATUS_OVERRIDES 注释），
        // 其次取内存 override（可能来自库里的专区 profile），最后回落到内核缺省状态。
        status: normalizeMarketplaceSkuStatus(
          MARKETPLACE_SKU_STATUS_OVERRIDES[industryKey]?.[skillId] ?? override.status ?? core.status
        ),
        sortOrder: seeds.length
      });
    }
  }
  return seeds;
}

export const MARKETPLACE_V3_SKU_SEEDS: MarketplaceSkuSeed[] = buildMarketplaceSkuSeeds();

export function refreshMarketplaceSkuSeeds(): void {
  MARKETPLACE_V3_SKU_SEEDS.splice(0, MARKETPLACE_V3_SKU_SEEDS.length, ...buildMarketplaceSkuSeeds());
}

export function zoneName(zoneKey: string): string {
  return MARKETPLACE_ZONES.find((zone) => zone.key === zoneKey)?.name ?? zoneKey;
}

export function normalizeJsonArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function matchesMarketplaceQuery(
  sku: {
    name: string;
    description: string;
    useCase: string;
    need: string;
    badge?: string | null;
    verbs: string[];
    tags: string[];
    keywords: string[];
    zone: string;
    supplierName?: string;
    trial?: boolean;
    ppu?: number;
  },
  query: MarketplaceSkuQuery
): boolean {
  const filters: Array<boolean> = [];

  if (query.q?.trim()) {
    const haystack = [
      sku.name,
      sku.description,
      sku.useCase,
      sku.need,
      sku.badge,
      zoneName(sku.zone),
      sku.supplierName,
      ...sku.verbs,
      ...sku.tags,
      ...sku.keywords
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const terms = query.q.trim().toLowerCase().split(/\s+/);
    filters.push(terms.every((term) => haystack.includes(term)));
  }
  if (query.zone) filters.push(sku.zone === query.zone);
  if (query.badge) filters.push(sku.badge === query.badge);
  if (typeof query.trial === "boolean") filters.push(Boolean(sku.trial) === query.trial);
  if (query.tag) filters.push(sku.tags.includes(query.tag));
  if (typeof query.minPpu === "number") filters.push((sku.ppu ?? 0) >= query.minPpu);
  if (typeof query.maxPpu === "number") filters.push((sku.ppu ?? 0) <= query.maxPpu);

  return filters.every(Boolean);
}

function parseArray(value: unknown): string[] {
  return normalizeJsonArray(value);
}

export function toPublicMarketplaceSku(
  row: {
    id: string;
    skuCode: string;
    agentId: string | null;
    capabilityKey: string | null;
    zone: string;
    name: string;
    icon: string | null;
    badge: string | null;
    description: string;
    verbs: unknown;
    useCase: string;
    need: string;
    tags: unknown;
    keywords: unknown;
    ppu: number;
    subscriptionPriceCny: number | null;
    subscriptionQuota: string | null;
    trial: boolean;
    status: string;
    sortOrder: number;
    supplierId: string;
    supplierName: string;
    supplierType: string;
  }
): PublicMarketplaceSku {
  return {
    id: row.id,
    skuCode: row.skuCode,
    agentId: row.agentId,
    capabilityKey: row.capabilityKey,
    zone: row.zone,
    zoneName: zoneName(row.zone),
    name: row.name,
    icon: row.icon,
    badge: row.badge,
    description: row.description,
    verbs: parseArray(row.verbs),
    useCase: row.useCase,
    need: row.need,
    tags: parseArray(row.tags),
    keywords: parseArray(row.keywords),
    ppu: row.ppu,
    subscriptionPriceCny: row.subscriptionPriceCny,
    subscriptionQuota: row.subscriptionQuota,
    trial: row.trial,
    status: row.status as MarketplaceSkuStatus,
    sortOrder: row.sortOrder,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierType: row.supplierType
  };
}

async function syncMarketplaceIndustryProfiles(): Promise<void> {
  for (const [zoneKey, industry] of Object.entries(v3Data.industries)) {
    await prisma.marketplaceIndustryProfile.upsert({
      where: { zoneKey },
      update: {},
      create: {
        zoneKey,
        title: String(industry.title),
        tag: String(industry.tag),
        who: industryValue(industry.who),
        lexicon: (industryValues(industry.lexicon) ?? []) as Prisma.InputJsonValue,
        pains: (industryValues(industry.pains) ?? []) as Prisma.InputJsonValue,
        redline: (industryValues(industry.redline) ?? []) as Prisma.InputJsonValue,
        ov: ((industry.ov ?? {}) as Prisma.InputJsonValue),
        ready: Boolean(industry.ready),
        general: Boolean(industry.general)
      }
    });
  }
}

export async function loadMarketplaceIndustryProfiles(): Promise<void> {
  const rows = await prisma.marketplaceIndustryProfile.findMany();
  for (const row of rows) {
    const current = MARKETPLACE_INDUSTRIES[row.zoneKey];
    if (!current) continue;
    MARKETPLACE_INDUSTRIES[row.zoneKey] = {
      ...current,
      title: row.title,
      tag: row.tag,
      who: row.who ?? undefined,
      lexicon: normalizeJsonArray(row.lexicon),
      pains: normalizeJsonArray(row.pains),
      redline: normalizeJsonArray(row.redline),
      ready: row.ready,
      general: row.general,
      ov: (row.ov ?? {}) as Record<string, Record<string, unknown>>
    };
  }
}

export async function ensureMarketplaceCatalog(): Promise<void> {
  if (env.DATA_MODE !== "database") return;

  await syncMarketplaceIndustryProfiles();
  await loadMarketplaceIndustryProfiles();
  refreshMarketplaceSkuSeeds();

  for (const seed of MARKETPLACE_SUPPLIER_SEEDS) {
    await prisma.marketplaceSupplier.upsert({
      where: { code: seed.code },
      update: {},
      create: {
        code: seed.code,
        name: seed.name,
        type: seed.type,
        settlementRate: new Prisma.Decimal(seed.settlementRate),
        contactEmail: seed.contactEmail,
        status: seed.status ?? "active"
      }
    });
  }

  const suppliers = await prisma.marketplaceSupplier.findMany({
    where: { code: { in: MARKETPLACE_SUPPLIER_SEEDS.map((seed) => seed.code) } },
    select: { id: true, code: true }
  });
  const supplierIdByCode = new Map(suppliers.map((item) => [item.code, item.id]));

  for (const seed of MARKETPLACE_V3_SKU_SEEDS) {
    const supplierId = supplierIdByCode.get(seed.supplierCode);
    if (!supplierId) throw new Error(`marketplace_supplier_missing:${seed.supplierCode}`);
    await prisma.marketplaceSku.upsert({
      where: { skuCode: seed.skuCode },
      update: {
        agentId: seed.agentId,
        capabilityKey: seed.capabilityKey,
        supplierId,
        zone: seed.zone,
        name: seed.name,
        icon: seed.icon,
        badge: seed.badge,
        description: seed.description,
        verbs: seed.verbs as unknown as Prisma.InputJsonValue,
        useCase: seed.useCase,
        need: seed.need,
        tags: seed.tags as unknown as Prisma.InputJsonValue,
        keywords: seed.keywords as unknown as Prisma.InputJsonValue,
        ppu: seed.ppu,
        subscriptionPriceCny: null,
        subscriptionQuota: null,
        trial: false,
        status: seed.status,
        sortOrder: seed.sortOrder
      },
      create: {
        skuCode: seed.skuCode,
        agentId: seed.agentId,
        capabilityKey: seed.capabilityKey,
        supplierId,
        zone: seed.zone,
        name: seed.name,
        icon: seed.icon,
        badge: seed.badge,
        description: seed.description,
        verbs: seed.verbs as unknown as Prisma.InputJsonValue,
        useCase: seed.useCase,
        need: seed.need,
        tags: seed.tags as unknown as Prisma.InputJsonValue,
        keywords: seed.keywords as unknown as Prisma.InputJsonValue,
        ppu: seed.ppu,
        subscriptionPriceCny: seed.subscriptionPriceCny,
        subscriptionQuota: seed.subscriptionQuota,
        trial: seed.trial,
        status: seed.status,
        sortOrder: seed.sortOrder
      }
    });
  }

  // v3 组合式智能体统一使用 `<zone>__<skill>` 命名；清理两版旧货架残留的短 id SKU。
  const validSkuCodes = MARKETPLACE_V3_SKU_SEEDS.map((seed) => seed.skuCode);
  await prisma.marketplaceSku.deleteMany({
    where: { skuCode: { notIn: validSkuCodes } }
  });
}

export interface DemoMarketplaceSupplier {
  id: string;
  code: string;
  name: string;
  type: "self_operated" | "third_party";
  settlementRate: number;
  contactEmail?: string;
  status: string;
}

export interface DemoMarketplaceSku {
  id: string;
  skuCode: string;
  agentId?: string;
  capabilityKey?: string;
  supplierId: string;
  zone: MarketplaceZoneKey;
  name: string;
  icon: string;
  badge?: string;
  description: string;
  verbs: string[];
  useCase: string;
  need: string;
  tags: string[];
  keywords: string[];
  ppu: number;
  subscriptionPriceCny?: number;
  subscriptionQuota?: string;
  trial: boolean;
  status: MarketplaceSkuStatus;
  sortOrder: number;
}

export interface DemoMarketplaceLedgerEntry {
  id: string;
  tenantId: string;
  userId?: string;
  skuId?: string;
  type: "topup" | "ppu_consume" | "ppu_refund" | "subscription_charge" | "subscription_refund" | "adjustment";
  direction: "credit" | "debit";
  amountCredits: number;
  amountCny: number;
  status: string;
  idempotencyKey?: string;
  refType?: string;
  refId?: string;
  createdAt: string;
}

export interface DemoMarketplaceSubscription {
  id: string;
  tenantId: string;
  userId?: string;
  skuId: string;
  status: string;
  startDate: string;
  endDate: string;
  priceCny: number;
  quota?: string;
}

export interface DemoMarketplaceOrder {
  id: string;
  tenantId: string;
  userId?: string;
  skuId: string;
  priceCny: number;
  status: "pending" | "paid" | "canceled" | "expired" | "refunded";
  provider: string;
  codeUrl: string;
  expiresAt: string;
  paidAt?: string;
  createdAt: string;
  subscriptionId?: string;
}

class DemoMarketplaceStore {
  private suppliers = new Map<string, DemoMarketplaceSupplier>();
  private skus = new Map<string, DemoMarketplaceSku>();
  private balances = new Map<string, number>();
  private subscriptions: DemoMarketplaceSubscription[] = [];
  private orders = new Map<string, DemoMarketplaceOrder>();
  private ledger: DemoMarketplaceLedgerEntry[] = [];
  private seeded = false;

  seed(): void {
    if (this.seeded) return;
    this.seeded = true;
    for (const seed of MARKETPLACE_SUPPLIER_SEEDS) {
      this.suppliers.set(seed.code, {
        id: seed.code,
        code: seed.code,
        name: seed.name,
        type: seed.type,
        settlementRate: seed.settlementRate,
        contactEmail: seed.contactEmail,
        status: seed.status ?? "active"
      });
    }
    for (const seed of MARKETPLACE_V3_SKU_SEEDS) {
      const supplierId = seed.supplierCode;
      this.skus.set(seed.skuCode, {
        id: seed.skuCode,
        skuCode: seed.skuCode,
        agentId: seed.agentId,
        capabilityKey: seed.capabilityKey,
        supplierId,
        zone: seed.zone,
        name: seed.name,
        icon: seed.icon,
        badge: seed.badge,
        description: seed.description,
        verbs: seed.verbs,
        useCase: seed.useCase,
        need: seed.need,
        tags: seed.tags,
        keywords: seed.keywords,
        ppu: seed.ppu,
        subscriptionPriceCny: seed.subscriptionPriceCny,
        subscriptionQuota: seed.subscriptionQuota,
        trial: seed.trial,
        status: seed.status,
        sortOrder: seed.sortOrder
      });
    }
  }

  getBalance(tenantId: string): number {
    this.seed();
    return this.balances.get(tenantId) ?? 300;
  }

  listSuppliers(): DemoMarketplaceSupplier[] {
    this.seed();
    return [...this.suppliers.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  listSkus(query: MarketplaceSkuQuery = {}, includeOffline = false): DemoMarketplaceSku[] {
    this.seed();
    return [...this.skus.values()]
      .filter((sku) => includeOffline || PUBLIC_MARKETPLACE_STATUSES.includes(sku.status))
      .filter((sku) => {
        if (!query.status) return true;
        return sku.status === query.status;
      })
      .filter((sku) => {
        if (query.supplierId && sku.supplierId !== query.supplierId) return false;
        if (query.badge && sku.badge !== query.badge) return false;
        if (typeof query.trial === "boolean" && sku.trial !== query.trial) return false;
        if (typeof query.minPpu === "number" && sku.ppu < query.minPpu) return false;
        if (typeof query.maxPpu === "number" && sku.ppu > query.maxPpu) return false;
        if (typeof query.minSub === "number" && (sku.subscriptionPriceCny ?? 0) < query.minSub) return false;
        if (typeof query.maxSub === "number" && (sku.subscriptionPriceCny ?? 0) > query.maxSub) return false;
        return matchesMarketplaceQuery(
          {
            ...sku,
            supplierName: this.suppliers.get(sku.supplierId)?.name
          },
          query
        );
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  getSku(idOrCode: string): DemoMarketplaceSku | undefined {
    this.seed();
    return this.skus.get(idOrCode) ?? [...this.skus.values()].find((sku) => sku.id === idOrCode);
  }

  toPublic(sku: DemoMarketplaceSku): PublicMarketplaceSku {
    const supplier = this.suppliers.get(sku.supplierId);
    return toPublicMarketplaceSku({
      id: sku.id,
      skuCode: sku.skuCode,
      agentId: sku.agentId ?? null,
      capabilityKey: sku.capabilityKey ?? null,
      zone: sku.zone,
      name: sku.name,
      icon: sku.icon ?? null,
      badge: sku.badge ?? null,
      description: sku.description,
      verbs: sku.verbs,
      useCase: sku.useCase,
      need: sku.need,
      tags: sku.tags,
      keywords: sku.keywords,
      ppu: sku.ppu,
      subscriptionPriceCny: sku.subscriptionPriceCny ?? null,
      subscriptionQuota: sku.subscriptionQuota ?? null,
      trial: sku.trial,
      status: sku.status,
      sortOrder: sku.sortOrder,
      supplierId: sku.supplierId,
      supplierName: supplier?.name ?? "未知供应商",
      supplierType: supplier?.type ?? "self_operated"
    });
  }

  hasActiveSubscription(tenantId: string, skuId: string): DemoMarketplaceSubscription | undefined {
    const now = Date.now();
    return this.subscriptions.find(
      (item) =>
        item.tenantId === tenantId &&
        item.skuId === skuId &&
        item.status === "active" &&
        new Date(item.endDate).getTime() > now
    );
  }

  accessState(tenantId: string, sku: DemoMarketplaceSku) {
    const balance = this.getBalance(tenantId);
    if (!isMarketplaceSkuPurchasable(sku.status)) return { state: "unavailable", balance };
    if (this.hasActiveSubscription(tenantId, sku.id)) {
      return { state: "subscribed", track: "subscription", balance };
    }
    if (balance >= sku.ppu) return { state: "ready", track: "ppu", balance };
    return { state: "insufficient_credits", track: "ppu", balance };
  }

  consumePpu(tenantId: string, userId: string, skuId: string, idempotencyKey: string) {
    const sku = this.getSku(skuId);
    if (!sku) throw new Error("marketplace_sku_not_found");
    if (!isMarketplaceSkuPurchasable(sku.status)) {
      return { state: "unavailable" as const, balance: this.getBalance(tenantId) };
    }
    const existing = this.ledger.find(
      (entry) => entry.tenantId === tenantId && entry.idempotencyKey === idempotencyKey
    );
    if (existing) return { state: "completed", balance: this.getBalance(tenantId), idempotent: true };
    if (sku.ppu > 0 && this.getBalance(tenantId) < sku.ppu) {
      return { state: "insufficient_credits", balance: this.getBalance(tenantId) };
    }
    if (sku.ppu > 0) this.balances.set(tenantId, this.getBalance(tenantId) - sku.ppu);
    this.ledger.push({
      id: randomUUID(),
      tenantId,
      userId,
      skuId: sku.id,
      type: "ppu_consume",
      direction: "debit",
      amountCredits: sku.ppu,
      amountCny: 0,
      status: "completed",
      idempotencyKey,
      refType: "marketplace_ppu_consume",
      refId: idempotencyKey,
      createdAt: new Date().toISOString()
    });
    return { state: "completed", balance: this.getBalance(tenantId), idempotent: false };
  }

  createSubscription(tenantId: string, userId: string, skuId: string): DemoMarketplaceOrder {
    const sku = this.getSku(skuId);
    if (!sku) throw new Error("marketplace_sku_not_found");
    if (!sku.subscriptionPriceCny) throw new Error("marketplace_subscription_not_available");
    const order: DemoMarketplaceOrder = {
      id: randomUUID(),
      tenantId,
      userId,
      skuId: sku.id,
      priceCny: sku.subscriptionPriceCny,
      status: "pending",
      provider: "wechat_pay",
      codeUrl: `weixin://wxpay/marketplace/${sku.skuCode}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString()
    };
    this.orders.set(order.id, order);
    return order;
  }

  paySubscription(orderId: string, tenantId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.tenantId !== tenantId) throw new Error("marketplace_order_not_found");
    if (order.status === "paid") {
      const existing = this.subscriptions.find((item) => item.id === order.subscriptionId);
      if (existing) return existing;
    }
    const sku = this.getSku(order.skuId);
    if (!sku || !sku.subscriptionPriceCny) throw new Error("marketplace_subscription_not_available");
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const subscription: DemoMarketplaceSubscription = {
      id: randomUUID(),
      tenantId,
      userId: order.userId,
      skuId: sku.id,
      status: "active",
      startDate: new Date().toISOString(),
      endDate: endDate.toISOString(),
      priceCny: order.priceCny,
      quota: sku.subscriptionQuota
    };
    this.subscriptions.push(subscription);
    order.status = "paid";
    order.paidAt = new Date().toISOString();
    order.subscriptionId = subscription.id;
    this.ledger.push({
      id: randomUUID(),
      tenantId,
      userId: order.userId,
      skuId: sku.id,
      type: "subscription_charge",
      direction: "debit",
      amountCredits: 0,
      amountCny: order.priceCny,
      status: "completed",
      idempotencyKey: `subscription-order:${order.id}`,
      refType: "marketplace_subscription_order",
      refId: order.id,
      createdAt: new Date().toISOString()
    });
    return subscription;
  }

  listSubscriptions(tenantId: string): DemoMarketplaceSubscription[] {
    return this.subscriptions.filter((item) => item.tenantId === tenantId);
  }

  overview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = this.ledger.filter((entry) => new Date(entry.createdAt) >= startOfToday);
    const ppu = today.filter((entry) => entry.type === "ppu_consume");
    const gmv = today
      .filter((entry) => entry.type === "subscription_charge" || entry.type === "topup")
      .reduce((sum, entry) => sum + entry.amountCny, 0);
    const activeTenants = new Set(today.map((entry) => entry.tenantId)).size;
    return {
      todayCalls: ppu.length,
      todayPoints: ppu.reduce((sum, entry) => sum + entry.amountCredits, 0),
      activeTenants,
      gmvCny: gmv
    };
  }

  listLedger(tenantId?: string, limit = 50): DemoMarketplaceLedgerEntry[] {
    return this.ledger
      .filter((entry) => !tenantId || entry.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  upsertSupplier(input: Omit<DemoMarketplaceSupplier, "id"> & { id?: string }): DemoMarketplaceSupplier {
    const id = input.id ?? input.code;
    const existing = this.suppliers.get(input.code);
    const supplier: DemoMarketplaceSupplier = {
      id,
      code: input.code,
      name: input.name,
      type: input.type,
      settlementRate: input.settlementRate,
      contactEmail: input.contactEmail,
      status: input.status
    };
    if (existing) {
      this.suppliers.set(input.code, { ...existing, ...supplier, id: existing.id });
      return this.suppliers.get(input.code)!;
    }
    this.suppliers.set(input.code, supplier);
    return supplier;
  }

  upsertSku(input: Omit<DemoMarketplaceSku, "id" | "supplierId"> & { id?: string; supplierId: string }): DemoMarketplaceSku {
    const existing = this.skus.get(input.skuCode);
    const supplier =
      this.suppliers.get(input.supplierId) ??
      [...this.suppliers.values()].find((item) => item.id === input.supplierId);
    if (!supplier) throw new Error("marketplace_supplier_not_found");
    const sku: DemoMarketplaceSku = {
      id: existing?.id ?? input.id ?? input.skuCode,
      skuCode: input.skuCode,
      agentId: input.agentId,
      capabilityKey: input.capabilityKey,
      supplierId: supplier.id,
      zone: input.zone,
      name: input.name,
      icon: input.icon,
      badge: input.badge,
      description: input.description,
      verbs: input.verbs,
      useCase: input.useCase,
      need: input.need,
      tags: input.tags,
      keywords: input.keywords,
      ppu: input.ppu,
      subscriptionPriceCny: input.subscriptionPriceCny,
      subscriptionQuota: input.subscriptionQuota,
      trial: input.trial,
      status: input.status,
      sortOrder: input.sortOrder
    };
    this.skus.set(sku.skuCode, sku);
    return sku;
  }
}

export const demoMarketplace = new DemoMarketplaceStore();
