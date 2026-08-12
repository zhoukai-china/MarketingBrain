import type { MemoryState, BusinessRole, Consultant, ConsultantId, DailyInsight, PlanCode, CreditPackCode } from "../types";

export const memoryDefaults: MemoryState = {
  role: "local_business" as BusinessRole,
  tenantName: "",
  industry: "",
  city: "",
  positioning: "",
  customer: "",
  offer: "",
  tone: "",
  acquisition: "",
  sales: "",
  delivery: "",
  management: "",
  diagnosisSummary: ""
};

export const dailyInsightsData: DailyInsight[] = [
  {
    change: `AI正在从\u201C回答问题\u201D进入\u201C执行任务\u201D：智能体、工作流、插件和企业知识库正在变成新的生产工具。`,
    view: `对企业来说，AI不再只是写文案，而是可以参与获客、销售跟进、员工训练、投流复盘和经营汇报。`
  },
  {
    change: `模型能力持续增强，越来越多工具开始支持图片、语音、文件和多步骤任务处理。`,
    view: `门店最先应该改造高频动作：朋友圈选题、问价顾客跟进、录音复盘、日报生成和SOP检查。`
  },
  {
    change: `企业AI应用正在从单点工具转向私有知识库和业务数据结合。`,
    view: `真正有价值的不是通用回答，而是基于门店定位、产品套餐、目标客群和历史记录的专属建议。`
  },
  {
    change: `AI资讯每天都在变化，但能落到经营上的机会只占一部分。`,
    view: `思潼视角会把行业变化翻译成老板能决策、运营能执行、员工能照做的下一步动作。`
  }
];

export const roleOptions: Array<{ value: BusinessRole; title: string; desc: string }> = [
  { value: "local_business", title: "本地单店商家", desc: "餐饮/零售/美业/生活服务等" },
  { value: "chain_brand", title: "连锁品牌", desc: "多门店连锁、加盟品牌" },
  { value: "personal_ip", title: "个人IP / 知识付费", desc: "创始人IP打造、内容变现" }
];

export const billingRolePlanMap: Record<BusinessRole, PlanCode[]> = {
  local_business: ["local_standard"],
  chain_brand: ["chain_standard"],
  personal_ip: ["ip_standard"]
};

const viteBasePath = (import.meta.env.BASE_URL as string | undefined) ?? "/";

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export const apiBase = import.meta.env.VITE_API_BASE_URL ?? (() => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3011";
  }
  return `${normalizeBasePath(viteBasePath).replace(/\/$/, "")}/api`;
})();

export const betaInviteCode = "BLV2-NEICE-0628";
export const initialDiagnosisDoneKey = "store_os_initial_diagnosis_done";
export const proactiveThreadsKey = "store_os_proactive_threads";
export const openProactiveThreadKey = "store_os_open_proactive_thread";
export const pendingConsultantPromptKey = "store_os_pending_consultant_prompt";
export const DEDAO_RECORDER_SHOP_LINK = "https://shop.xiaoe-tech.com/...";
export const DEDAO_RECORDER_SHOP_DEEP_LINK = "weixin://...";
