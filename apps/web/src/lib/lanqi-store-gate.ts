/**
 * 兰琪工作台「门店可用性」判定（WorkBuddy 2026-09-10 报告 Bug7 / Bug8 / Bug9）。
 *
 * 报告里的真实场景：进到朋友圈获客后表单能填、按钮是灰的，
 * 页面只给一句「当前企业尚未开通此产品，请联系服务团队。」，
 * 老板分不清是**没开通产品**、**没门店**还是**读取失败**，也没有任何自助出口。
 *
 * 这里把判定收敛成一个纯函数，好处有三点：
 * ① 原因分流只有一处，朋友圈 / 微信群 / 后续板块共同使用，不会再各写一套；
 * ② 可以直接被 node smoke 断言（`scripts/lanqi-store-gate-smoke.ts`），不依赖浏览器；
 * ③ 「按钮为什么是灰的」有唯一答案，界面上必须把它显示出来。
 *
 * 口径铁律：本文件只做「能不能生成 + 给出原因和出口」，不产生任何业务数字，
 * 更不允许在无数据时补 0（缺失就是缺失，界面只能显示引导）。
 */

export interface LanqiStoreRef {
  id: string;
  name: string;
  city?: string | null;
}

export interface LanqiStoreCta {
  label: string;
  href: string;
}

export type LanqiStoreGate =
  | {
      kind: "loading";
      headline: string;
      detail: string;
      cta: null;
      secondaryCta: null;
      retry: false;
      canGenerate: false;
      blockedReason: string;
    }
  | {
      kind: "ready";
      headline: string;
      detail: string;
      cta: null;
      secondaryCta: null;
      retry: false;
      canGenerate: true;
      blockedReason: "";
      storeId: string;
      storeName: string;
      storeCity: string;
    }
  | {
      kind: "empty";
      headline: string;
      detail: string;
      cta: LanqiStoreCta;
      secondaryCta: LanqiStoreCta | null;
      retry: false;
      canGenerate: false;
      blockedReason: string;
    }
  | {
      kind: "error";
      reason: LanqiStoreErrorReason;
      headline: string;
      detail: string;
      cta: LanqiStoreCta | null;
      secondaryCta: LanqiStoreCta | null;
      retry: boolean;
      canGenerate: false;
      blockedReason: string;
    };

export type LanqiStoreErrorReason =
  | "entitlement_expired"
  | "entitlement_inactive"
  | "entitlement_missing"
  | "forbidden"
  | "network";

const PARKING_PAGE_HREF = "/lanqi/store-profile";
const STORE_ADMIN_HREF = "/lanqi/store";
const LOGIN_HREF = "/login/lanqi";
// 经营驾驶舱本轮仍是「开发中」（LANQI_MOMENTS_ONLY_LAUNCH），弹窗里的返回入口
// 统一落到八板块总览，避免把用户带到一个明说「开发中」的页面。
const DASHBOARD_HREF = "/lanqi/brain";

function reasonOfCode(errorCode: string | null | undefined): LanqiStoreErrorReason {
  switch ((errorCode ?? "").trim()) {
    case "product_entitlement_expired":
      return "entitlement_expired";
    case "product_entitlement_inactive":
      return "entitlement_inactive";
    case "product_entitlement_required":
    case "product_entitlement_missing":
      return "entitlement_missing";
    case "store_forbidden":
    case "forbidden":
    case "permission_denied":
      return "forbidden";
    default:
      return "network";
  }
}

export interface DescribeLanqiStoreGateInput {
  /** 门店列表还在读的时候为 true。 */
  loading?: boolean;
  /** 后端 `/lanqi/stores` 返回的门店；undefined 与 [] 都表示「还没读到任何门店」。 */
  stores?: LanqiStoreRef[] | null;
  /** 后端 403 细分原因（`error.code`），读不到门店时用于文案分流。 */
  errorCode?: string | null;
  /** 读取失败时的原始提示，仅作为 detail 兜底，不改写真实原因。 */
  errorMessage?: string | null;
  /** 出错时的重试动作由页面绑定；纯函数只标 retry 标记。 */
  featureLabel?: string;
}

/**
 * 「能不能生成 + 为什么不能 + 去哪解决」的唯一判定入口。
 *
 * 优先级：读取中 > 读取失败 > 没有门店 > 可用。
 * 这样即使接口报错，也不会先按「没门店」提示老板去建店，避免把人带错方向。
 */
export function describeLanqiStoreGate(input: DescribeLanqiStoreGateInput): LanqiStoreGate {
  const feature = input.featureLabel ?? "这项功能";
  if (input.loading) {
    return {
      kind: "loading",
      headline: "正在读取门店…",
      detail: `门店信息读出来以后才能生成，稍等一两秒。`,
      cta: null,
      secondaryCta: null,
      retry: false,
      canGenerate: false,
      blockedReason: "正在读取门店，读完就能生成。"
    };
  }

  if (input.errorCode || input.errorMessage) {
    const reason = reasonOfCode(input.errorCode);
    if (reason === "entitlement_expired") {
      return {
        kind: "error",
        reason,
        headline: "兰琪美业使用期限已到期",
        detail: "续期后即可继续使用，续期前门店数据不会丢失。",
        cta: { label: "重新登录", href: LOGIN_HREF },
        secondaryCta: { label: "返回板块总览", href: DASHBOARD_HREF },
        retry: false,
        canGenerate: false,
        blockedReason: "产品已到期，续期后即可生成。"
      };
    }
    if (reason === "entitlement_inactive") {
      return {
        kind: "error",
        reason,
        headline: "兰琪美业当前处于停用状态",
        detail: "请联系服务团队重新启用；启用后这里会自动恢复。",
        cta: { label: "返回板块总览", href: DASHBOARD_HREF },
        secondaryCta: null,
        retry: false,
        canGenerate: false,
        blockedReason: "产品已停用，启用后即可生成。"
      };
    }
    if (reason === "entitlement_missing") {
      return {
        kind: "error",
        reason,
        headline: "当前账号还没有开通兰琪美业",
        detail: "请从兰琪美业入口登录开通；本机体验入口不授予产品权限。",
        cta: { label: "开通兰琪美业", href: LOGIN_HREF },
        secondaryCta: null,
        retry: false,
        canGenerate: false,
        blockedReason: "产品未开通，开通后才能生成。"
      };
    }
    if (reason === "forbidden") {
      return {
        kind: "error",
        reason,
        headline: "当前账号没有这家门店的权限",
        detail: "前台只能使用自己绑定的门店；换老板 / 店长账号登录，或让老板把门店绑定到你的账号。",
        cta: { label: "返回板块总览", href: DASHBOARD_HREF },
        secondaryCta: null,
        retry: false,
        canGenerate: false,
        blockedReason: "没有该门店权限，无法生成。"
      };
    }
    return {
      kind: "error",
      reason: "network",
      headline: "门店读取失败",
      detail: input.errorMessage || "网络或服务暂时不可用，重试一次；一直失败再联系服务团队。",
      cta: null,
      secondaryCta: null,
      retry: true,
      canGenerate: false,
      blockedReason: "门店没读出来，暂时不能生成。"
    };
  }

  const stores = input.stores ?? [];
  if (!stores.length) {
    return {
      kind: "empty",
      headline: "当前账号还没有门店",
      detail: `${feature}要挂在具体门店上。先创建或完善门店档案，再回来生成。`,
      cta: { label: "去完善门店档案", href: PARKING_PAGE_HREF },
      secondaryCta: { label: "门店后台", href: STORE_ADMIN_HREF },
      retry: false,
      canGenerate: false,
      blockedReason: "当前账号没有可用门店，无法生成。先完善门店档案。"
    };
  }

  const active = stores[0];
  const city = (active.city ?? "").trim();
  return {
    kind: "ready",
    headline: `门店：${active.name}`,
    detail: city ? `${city} · 文案会写在「${active.name}」名下` : `文案会写在「${active.name}」名下`,
    cta: null,
    secondaryCta: null,
    retry: false,
    canGenerate: true,
    blockedReason: "",
    storeId: active.id,
    storeName: active.name,
    storeCity: city
  };
}

/** 从后端错误对象里取细分原因；`error.code` 优先，兼容旧调用方用的 `error.error`。 */
export function storeErrorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; error?: unknown };
  if (typeof candidate.code === "string" && candidate.code) return candidate.code;
  if (typeof candidate.error === "string" && candidate.error) return candidate.error;
  return null;
}
