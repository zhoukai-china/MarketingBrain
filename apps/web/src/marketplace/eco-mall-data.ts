import baoluChiefAvatar from "../assets/baolu-chief.jpg";
import { getPublicAssetPath } from "../lib/api.js";

export type EcoSkinKey = "通用" | "美业专精" | "餐饮专精";

/**
 * 员工弹窗里行业皮肤的**固定展示顺序**（2026-09-19 用户口径：通用 → 餐饮 → 美业）。
 *
 * 不能依赖 `Object.keys(employee.skins)` 的顺序：那只是对象字面量的书写顺序，
 * 谁在前面谁先渲染，容易出现「同一个员工两处顺序不一样」。
 */
export const ECO_SKIN_ORDER: EcoSkinKey[] = ["通用", "餐饮专精", "美业专精"];

export type EcoEmployeeZoneKey =
  | "通用"
  | "美业专区"
  | "餐饮专区"
  | "品牌工作台专区"
  | "汽车后市场专区"
  | "宠物专区";

export interface EcoEmployeeSkin {
  hook: string;
  deliver: string;
  need: string;
}

export interface EcoEmployee {
  key: string;
  role: string;
  icon: string;
  color: string;
  status: "ok" | "dev";
  hookBase: string;
  personality: string;
  ability: string;
  /** 对应货架能力核（ip-pos / topic / copy / vidrev / livescript / liverev / sales / moments）。 */
  capability: string;
  skins: Partial<Record<EcoSkinKey, EcoEmployeeSkin>>;
}

export interface EcoConsultant {
  key: string;
  name: string;
  icon: string;
  color: string;
  face: string;
  meta: string;
  status: "ok" | "dev";
}

export const ECO_EMPLOYEE_ZONES: Array<{ key: EcoEmployeeZoneKey; label: string; shortLabel: string; note: string }> = [
  { key: "餐饮专区", label: "餐饮专区", shortLabel: "餐饮专精", note: "按餐饮堂食 / 外卖 / 私域同城到店场景交付。" },
  { key: "美业专区", label: "美业专区", shortLabel: "美业专精", note: "按美业合规话术与同城到店场景交付。" },
  { key: "宠物专区", label: "宠物专区", shortLabel: "宠物", note: "宠物专区正在准备，员工暂未开放。" },
  { key: "汽车后市场专区", label: "汽车后市场专区", shortLabel: "汽车后市场", note: "汽车后市场专区正在准备，员工暂未开放。" },
  { key: "通用", label: "通用行业", shortLabel: "通用", note: "什么行业都能用，先按创始人的日常节奏推进。" },
  { key: "品牌工作台专区", label: "兰琪品牌工作台", shortLabel: "品牌工作台", note: "兰琪品牌工作台正在接入，暂未开放员工。" }
];

export function employeeZoneSkin(zone: EcoEmployeeZoneKey): EcoSkinKey {
  if (zone === "美业专区") return "美业专精";
  if (zone === "餐饮专区") return "餐饮专精";
  return "通用";
}

export function employeeStatusForZone(employee: EcoEmployee, zone: EcoEmployeeZoneKey): "ok" | "dev" {
  if (zone !== "通用" && zone !== "美业专区" && zone !== "餐饮专区") return "dev";
  return employee.status;
}

export const ECO_EMPLOYEES: EcoEmployee[] = [
  {
    key: "ip-position",
    role: "首席定位官",
    icon: "🎯",
    color: "#E8651A",
    status: "ok",
    hookBase: "我是你的首席定位官。先把你这个人想明白——对谁说、说啥——再给你一份能直接用的定位全案。",
    personality: "我性格稳，做事讲策略。不急着给方案，先把你的情况问清楚再下结论。",
    ability: "我能一次把人设、目标用户、内容矩阵和选题方向讲透，省得你自己东拼西凑。",
    capability: "ip-pos",
    skins: {
      通用: {
        hook: "先把你这个人想明白，再定「对谁说、说啥」。",
        deliver: "1 份 IP 定位全案：一句话定位 / 目标用户 / 人设五维 / 内容矩阵 / 选题方向",
        need: "品牌名、现状、目标用户线索"
      },
      美业专精: {
        hook: "美业创始人该打技术派、经营派还是布道派？我帮你定，还分清你要的是 C 端顾客还是 B 端加盟商。",
        deliver: "1 份美业 IP 定位全案：业态定位 + 同城内容矩阵 + 合规表达边界",
        need: "业态与城市、门店数、最硬的一项技术、做 IP 为获客还是招商"
      },
      餐饮专精: {
        hook: "餐饮老板该用「老板人设」还是「菜品人设」打同城？我帮你定方向。",
        deliver: "1 份餐饮 IP 定位全案：人设方向 + 同城爆店内容矩阵",
        need: "品类、门店数、想打的品牌主张"
      }
    }
  },
  {
    key: "topic",
    role: "选题策略官",
    icon: "💡",
    color: "#E8651A",
    status: "dev",
    hookBase: "我是你的选题策略官。每天给你挑好「今天拍哪条能火」，还讲清为什么。",
    personality: "我脑子快、嗅觉灵，爱拆爆款，也会追着你问真实素材在哪。",
    ability: "我每天给你能直接开拍的选题，每条都说明白为什么这条更容易火。",
    capability: "topic",
    skins: {
      通用: {
        hook: "每天给你 3–5 条带「三关筛选」标签、可直接开拍的选题。",
        deliver: "3–5 条短视频选题（切入角度 + 平台建议）",
        need: "行业 / 品牌 / 账号阶段"
      },
      美业专精: {
        hook: "给你美业场景能直接拍的选题，每条都标好合规风险，不碰红线。",
        deliver: "3–5 条美业选题（三关标签 + 适配平台 + 合规标注）",
        need: "业态与城市、账号阶段、当季主推项目或热点"
      },
      餐饮专精: {
        hook: "给你餐饮同城能拍的选题，直接贴到店和团购转化。",
        deliver: "3–5 条餐饮选题（同城角度 + 团购钩子）",
        need: "品类、城市、想追的热点"
      }
    }
  },
  {
    key: "copywriter",
    role: "金牌文案主笔",
    icon: "✍️",
    color: "#E8651A",
    status: "ok",
    hookBase: "我是你的金牌文案主笔。你把卖点甩给我，我给你一条能直接念、能直接发的稿子。",
    personality: "我说人话、重钩子，最烦绕弯子，擅长把专业词翻成顾客听得懂的大白话。",
    ability: "我能把卖点写成标题、正文、话题都齐的文案，你复制就能发。",
    capability: "copy",
    skins: {
      通用: {
        hook: "你把卖点给我，我给你一条多平台适配、带钩子的可直发文案。",
        deliver: "1 条文案（标题 + 正文 + 话题）",
        need: "产品 / 服务与卖点、投放平台、想要的动作"
      },
      美业专精: {
        hook: "美业合规、能直接发的文案，疗效那类话我一句不写。",
        deliver: "1 条美业文案（标题钩子 + 口播正文 + 话题，合规版）",
        need: "项目名与顾客能感知的体验点、触达人群、平台（抖音同城 / 小红书 / 视频号）"
      },
      餐饮专精: {
        hook: "餐饮同城文案，带上团购和到店钩子。",
        deliver: "1 条餐饮文案（口播 + 团购引导）",
        need: "主推菜品 / 团单、城市、平台"
      }
    }
  },
  {
    key: "video-diag",
    role: "流量诊断官",
    icon: "📊",
    color: "#E8651A",
    status: "ok",
    hookBase: "我是你的流量诊断官。一条视频没流量，我帮你看出问题出在哪、下条怎么改。",
    personality: "我理性、抠数据，没依据的话不讲，结论都拿数据撑着。",
    ability: "我从播放、完播、互动、转化里找毛病，再给你下一步怎么改的动作。",
    capability: "vidrev",
    skins: {
      通用: {
        hook: "给一条视频做数据复盘，告诉你为什么没爆、下条怎么调。",
        deliver: "1 条视频复盘（播放 / 完播 / 互动 / 转化归因）+ 下一条迭代动作",
        need: "视频后台数据或链接"
      },
      美业专精: {
        hook: "看美业视频的同城占比和团单点击，找出问题卡在哪。",
        deliver: "1 条美业视频复盘（同城占比 / 完播 / 咨询与团单点击归因）+ 迭代动作",
        need: "视频后台数据截图（含同城占比更佳）、是否挂团购 / POI"
      },
      餐饮专精: {
        hook: "看餐饮视频的到店和团购转化，找出问题卡在哪。",
        deliver: "1 条餐饮视频复盘（团购点击 / 到店归因）+ 迭代动作",
        need: "视频后台数据、挂的团单"
      }
    }
  },
  {
    key: "live-host",
    role: "直播操盘总监",
    icon: "🎤",
    color: "#E8651A",
    status: "dev",
    hookBase: "我是你的直播操盘总监。开播前我给你排好逐字稿和节奏，你照着念就能上。",
    personality: "我现场感强，懂怎么留人、怎么逼单，按分钟给你排流程。",
    ability: "我给你能直接开播的逐字稿、节奏表和场控清单。",
    capability: "livescript",
    skins: {
      通用: {
        hook: "给你一套可开播的逐字直播话术稿，照着念就上。",
        deliver: "1 套直播逐字稿（轮播节奏表 + 场控清单）",
        need: "产品 / 活动 / 人群、带货 or 招商、场次时长"
      },
      美业专精: {
        hook: "美业直播逐字稿，带货、招商两套都给你。",
        deliver: "1 套美业直播逐字稿（双场景 + 节奏表 + 场控清单）",
        need: "主推项目或团单、卖货 or 招商、场次时长、主播是谁"
      },
      餐饮专精: {
        hook: "餐饮直播逐字稿，带上团购逼单节奏。",
        deliver: "1 套餐饮直播逐字稿（团购话术 + 节奏表）",
        need: "主推团单、场次时长"
      }
    }
  },
  {
    key: "live-coach",
    role: "直播复盘导师",
    icon: "🔁",
    color: "#E8651A",
    status: "dev",
    hookBase: "我是你的直播复盘导师。一场播完我帮你复盘，告诉你下场哪里要改。",
    personality: "我复盘型，只看事实不讲空话，眼里只有下一场怎么变好。",
    ability: "我做定量 + 定性双维复盘，给你能反复用的话术迭代带。",
    capability: "liverev",
    skins: {
      通用: {
        hook: "一场直播定量 + 定性双维复盘，给你能复用的话术迭代带。",
        deliver: "1 场直播复盘（流量 / 转化 / 话术执行）+ 迭代动作",
        need: "直播后台数据"
      },
      美业专精: {
        hook: "美业直播复盘，看留人、团单点击、成交核销。",
        deliver: "1 场美业直播复盘（场观 / 停留 / 团单点击 / 成交 / 核销）+ 话术迭代带",
        need: "直播后台数据"
      },
      餐饮专精: {
        hook: "餐饮直播复盘，看团购转化漏斗。",
        deliver: "1 场餐饮直播复盘（观看 → 团购点击 → 核销）+ 迭代带",
        need: "直播后台数据"
      }
    }
  },
  {
    key: "sales-coach",
    role: "首席成交官",
    icon: "🤝",
    color: "#E8651A",
    status: "dev",
    hookBase: "我是你的首席成交官。客户卡单了，我告诉你话术怎么接、异议怎么挡。",
    personality: "我务实，听得懂客户卡在哪，不堆漂亮话。",
    ability: "我给一个场景的成交话术和异议处理脚本，你照着用。",
    capability: "sales",
    skins: {
      通用: {
        hook: "给一个客户场景的标准成交话术 + 异议处理。",
        deliver: "1 个场景成交话术 + 异议处理脚本",
        need: "客户画像与卡点、场景（高客单 / 招商加盟）、当前卡在哪"
      },
      美业专精: {
        hook: "美业 C 端升单、B 端招商的标准话术，照着用。",
        deliver: "1 个美业成交场景话术（C 端体验卡→疗程卡→年卡 / B 端加盟学员）",
        need: "客户画像与当前卡点"
      },
      餐饮专精: {
        hook: "餐饮招商、团购转化的标准话术。",
        deliver: "1 个餐饮成交场景话术（加盟 / 团单升单）",
        need: "客户画像与卡点"
      }
    }
  },
  {
    key: "private",
    role: "私域增长顾问",
    icon: "💬",
    color: "#E8651A",
    status: "dev",
    hookBase: "我是你的私域增长顾问。你今天想发朋友圈，我给你一条能直接粘贴的。",
    personality: "我克制、懂信任，不硬广，靠真实感让人愿意回你。",
    ability: "我写能直接发的朋友圈，信任、业务价值、软引导三样都顾上。",
    capability: "moments",
    skins: {
      通用: {
        hook: "给你一条能直接发的朋友圈文案，信任人设 + 业务价值 + 软引导。",
        deliver: "1 条朋友圈文案，贴合私域节奏",
        need: "你是做什么的 / 想立什么人设、今天想发的话题、目标"
      },
      美业专精: {
        hook: "美业朋友圈，100–200 字，信任 + 专业 + 软邀约。",
        deliver: "1 条美业朋友圈文案，可直接粘贴",
        need: "今天真实发生的事、想立的人设、目的（信任 / 约到店 / 招学徒）"
      },
      餐饮专精: {
        hook: "餐饮朋友圈，带到店和团购软引导。",
        deliver: "1 条餐饮朋友圈文案",
        need: "今天真实发生的事、想立的人设、目的"
      }
    }
  }
];

export const ECO_CONSULTANTS: EcoConsultant[] = [
  {
    key: "baolu",
    name: "保禄数字分身",
    icon: "🧭",
    color: "#E8651A",
    face: "思潼AI 创始人",
    meta: "我是保禄的数字分身，把他的 AI 增长和连锁经营方法论都装进来了。你有具体问题，我按保禄的思路接着答。",
    status: "dev"
  }
];

/**
 * 数字员工形象（`apps/web/public/avatars/**`）按**能力核**登记。
 *
 * 2026-09-21 用户口径：商城卡片、智能体详情页、对话页（页头与 AI 气泡）都要是**这个数字员工自己的形象**，
 * 不能再一律用品牌形象「思潼」。能力核是唯一口径，所以这里以能力核为准，
 * `EMPLOYEE_IMAGE_PATHS`（按 `EcoEmployee.key`）由它派生，避免两张表各写一份、改一处漏一处。
 */
export const EMPLOYEE_AVATAR_BY_CAPABILITY: Record<string, string> = {
  "ip-pos": "avatars/ip-position.png",
  topic: "avatars/topic.png",
  copy: "avatars/copywriter.png",
  vidrev: "avatars/video-diag.png",
  livescript: "avatars/live-host.png",
  liverev: "avatars/live-coach.png",
  sales: "avatars/sales-coach.png",
  moments: "avatars/private.png"
};

/** 取某个能力核 / SKU 编码（`ipzone__ip-pos`、`ip-pos`）对应的数字员工形象路径；套装或未知能力返回 null。 */
export function employeeAvatarPath(skuCodeOrCapability: string | null | undefined): string | null {
  if (!skuCodeOrCapability) return null;
  const capability = skuCodeOrCapability.includes("__")
    ? skuCodeOrCapability.slice(skuCodeOrCapability.lastIndexOf("__") + 2)
    : skuCodeOrCapability;
  const asset = EMPLOYEE_AVATAR_BY_CAPABILITY[capability];
  return asset ? getPublicAssetPath(asset) : null;
}

/** `EcoEmployee.key`（卡片 key）→ 形象路径，由能力核映射派生。 */
export const EMPLOYEE_IMAGE_PATHS: Record<string, string> = Object.fromEntries(
  ECO_EMPLOYEES.flatMap((employee) => {
    const avatar = employeeAvatarPath(employee.capability);
    return avatar ? [[employee.key, avatar] as const] : [];
  })
);

export const CONSULTANT_IMAGE_PATHS: Record<string, string> = {
  baolu: baoluChiefAvatar
};

export function employeeImagePath(employee: EcoEmployee): string {
  return EMPLOYEE_IMAGE_PATHS[employee.key] ?? "";
}

export function consultantImagePath(consultant: EcoConsultant): string {
  return CONSULTANT_IMAGE_PATHS[consultant.key] ?? "";
}

export function employeeSkuCode(employee: EcoEmployee, skin: EcoSkinKey): string | null {
  const zone = skin === "美业专精" ? "meiye" : skin === "餐饮专精" ? "canyin" : "ipzone";
  return `${zone}__${employee.capability}`;
}

export function employeeDetailPath(employee: EcoEmployee, skin: EcoSkinKey): string | null {
  const skuCode = employeeSkuCode(employee, skin);
  return skuCode ? `/agent/${encodeURIComponent(skuCode)}` : null;
}

const LEGACY_SKU_NAME_BY_CAPABILITY: Record<string, string> = {
  "ip-pos": "首席定位官",
  topic: "选题策略官",
  copy: "金牌文案主笔",
  vidrev: "流量诊断官",
  livescript: "直播操盘总监",
  liverev: "直播复盘导师",
  sales: "首席成交官",
  moments: "私域增长顾问"
};

/** 把旧货架 SKU 名（如「文案智能体」）映射成新表达（如「金牌文案主笔」）。 */
export function employeeDisplayName(skuCode: string, fallback: string): string {
  const capability = skuCode.includes("__") ? skuCode.slice(skuCode.lastIndexOf("__") + 2) : skuCode;
  return LEGACY_SKU_NAME_BY_CAPABILITY[capability] ?? fallback;
}

const LEGACY_EMPLOYEE_NAME_ALIASES: Array<[RegExp, string]> = [
  [/IP定位智能体/, "首席定位官"],
  [/选题智能体/, "选题策略官"],
  [/文案智能体/, "金牌文案主笔"],
  [/视频复盘智能体/, "流量诊断官"],
  [/直播话术智能体/, "直播操盘总监"],
  [/直播复盘智能体/, "直播复盘导师"],
  [/销售话术智能体/, "首席成交官"],
  [/朋友圈(?:文案)?智能体/, "私域增长顾问"]
];

/** 兼容历史 SKU 名（例如「美业文案智能体」）到新岗位名的展示映射。 */
export function employeeDisplayNameFromLegacyName(fallback: string | null | undefined): string | null {
  if (!fallback) return null;
  for (const [pattern, role] of LEGACY_EMPLOYEE_NAME_ALIASES) {
    if (pattern.test(fallback)) return role;
  }
  return fallback;
}
