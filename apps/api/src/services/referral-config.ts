import { Prisma, prisma } from "@baolu/db";
import { env, parseOptionalIsoDate } from "../config/env.js";

/**
 * 平台运行期配置位（PLAT-28 第①批）。
 *
 * 为什么要有这层：推荐有礼的 10 个开关既要**发版前可读**（env 默认值），
 * 又要**上线后能改**（老板/运营在后台 `/agents/admin` 改，不发版、不重启）。
 * 于是：env 提供默认值与生产 fail-closed 的兜底，`PlatformSetting` 表存后台覆盖值。
 *
 * 冻结口径（用户 2026-09-12 拍板，不要改）：
 * - 三段奖励：新客 100、推荐人第一段 100（新客首次真实使用）、推荐人第二段 200（新客首次真实充值）；
 * - 奖励积分只能用于文字类智能体 → `REFERRAL_REWARD_TEXT_ONLY` 锁死为 true（env 校验 + 本层校验 + 后台只读）；
 * - 奖励进 bonus 桶、90 天有效、不设单人月上限（超阈值只告警）；
 * - 绑定 / 首次真实使用 / 首次真实充值三个事件都必须落在活动窗内，左闭右开。
 *
 * 第①批只让这些开关**可读可写**，不产生任何奖励。
 */

export type PlatformSettingType = "boolean" | "integer" | "datetime";

export interface PlatformSettingDefinition {
  key: string;
  group: "referral" | "marketplace";
  label: string;
  description: string;
  type: PlatformSettingType;
  min?: number;
  max?: number;
  /** 冻结口径：后台不允许改成别的值（当前只有 text-only=true）。 */
  lockedValue?: boolean;
}

export const PLATFORM_SETTING_DEFINITIONS: readonly PlatformSettingDefinition[] = [
  {
    key: "REFERRAL_REWARD_ENABLED",
    group: "referral",
    label: "推荐有礼总开关",
    description: "打开后第②批的奖励引擎才会发奖；第①批即使打开也不发奖（本批只做归因）。",
    type: "boolean"
  },
  {
    key: "REFERRAL_CAMPAIGN_STARTS_AT",
    group: "referral",
    label: "活动开始（含）",
    description: "口径：上线第②批的那一刻。ISO 8601，例 2026-09-12T20:00:00+08:00。留空=未开始。",
    type: "datetime"
  },
  {
    key: "REFERRAL_CAMPAIGN_ENDS_AT",
    group: "referral",
    label: "活动结束（不含）",
    description: "用户给定：2026-09-30 24:00 北京时间 = 2026-10-01T00:00:00+08:00（右开）。",
    type: "datetime"
  },
  {
    key: "REFERRAL_NEW_USER_CREDITS",
    group: "referral",
    label: "新客奖励积分",
    description: "被推荐人注册绑定即得（第②批）。默认 100，进 bonus 桶、90 天、只能用于文字类智能体。",
    type: "integer",
    min: 0,
    max: 100000
  },
  {
    key: "REFERRAL_REFERRER_FIRST_USE_CREDITS",
    group: "referral",
    label: "推荐人第一段（新客首次真实使用）",
    description: "默认 100。",
    type: "integer",
    min: 0,
    max: 100000
  },
  {
    key: "REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS",
    group: "referral",
    label: "推荐人第二段（新客首次真实充值）",
    description: "默认 0（用户 2026-09-15「先只做推荐有礼：被推荐人 100 + 推荐人 100」，本段先关闭）。改回 200 即恢复 2026-09-12 的三段口径。",
    type: "integer",
    min: 0,
    max: 100000
  },
  {
    key: "REFERRAL_REWARD_VALID_DAYS",
    group: "referral",
    label: "推荐奖励有效期（天）",
    description: "默认 90 天（普通体验额度/其他赠送仍是 30 天，不共用一个数）。",
    type: "integer",
    min: 1,
    max: 3650
  },
  {
    key: "REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS",
    group: "referral",
    label: "超阈值告警线（积分）",
    description: "默认 20000。不设单人月上限：达到/超过该值只告警，不拦截发放。",
    type: "integer",
    min: 1,
    max: 1000000
  },
  {
    key: "REFERRAL_REWARD_TEXT_ONLY",
    group: "referral",
    label: "奖励积分只能用于文字类智能体",
    description: "冻结口径，锁死为 true（服务端硬限制，前端隐藏不算）。真实充值积分不受影响。",
    type: "boolean",
    lockedValue: true
  },
  {
    key: "MARKETPLACE_TRIAL_GRANT_ENABLED",
    group: "marketplace",
    label: "人工体验额度发放",
    description: "默认停用：接口与运维 CLI 一律拒绝（403 trial_grant_disabled），历史流水只读保留。",
    type: "boolean"
  }
] as const;

export type PlatformSettingValue = boolean | number | string | null;

export interface PlatformSettingView {
  key: string;
  group: "referral" | "marketplace";
  label: string;
  description: string;
  type: PlatformSettingType;
  min?: number;
  max?: number;
  lockedValue?: boolean;
  /** 当前生效值（数据库覆盖值优先，否则 env 默认值） */
  value: PlatformSettingValue;
  /** env 默认值（用于「恢复默认」与排查） */
  envValue: PlatformSettingValue;
  source: "database" | "env";
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PlatformSettingsSnapshot {
  settings: PlatformSettingView[];
  /** 便捷标志：后台面板与接口守卫直接读它，避免各处重复解析 */
  trialGrantEnabled: boolean;
  referralRewardEnabled: boolean;
  referralTextOnly: boolean;
}

export interface ReferralConfig {
  enabled: boolean;
  campaignStartsAt: string | null;
  campaignEndsAt: string | null;
  newUserCredits: number;
  referrerFirstUseCredits: number;
  referrerFirstRechargeCredits: number;
  rewardValidDays: number;
  alertThresholdCredits: number;
  textOnly: boolean;
  sources: Record<string, "database" | "env">;
}

export class PlatformSettingError extends Error {
  readonly code = "invalid_platform_setting";
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "PlatformSettingError";
    this.key = key;
  }
}

const DEFINITION_BY_KEY = new Map(PLATFORM_SETTING_DEFINITIONS.map((item) => [item.key, item]));

/** 环境变量默认值（生产用 env 兜底，未配置时即冻结口径里的默认数）。 */
function envValueOf(key: string): PlatformSettingValue {
  switch (key) {
    case "REFERRAL_REWARD_ENABLED":
      return env.REFERRAL_REWARD_ENABLED === "true";
    case "REFERRAL_REWARD_TEXT_ONLY":
      return env.REFERRAL_REWARD_TEXT_ONLY === "true";
    case "MARKETPLACE_TRIAL_GRANT_ENABLED":
      return env.MARKETPLACE_TRIAL_GRANT_ENABLED === "true";
    case "REFERRAL_CAMPAIGN_STARTS_AT":
      return normalizeDate(env.REFERRAL_CAMPAIGN_STARTS_AT);
    case "REFERRAL_CAMPAIGN_ENDS_AT":
      return normalizeDate(env.REFERRAL_CAMPAIGN_ENDS_AT);
    case "REFERRAL_NEW_USER_CREDITS":
      return env.REFERRAL_NEW_USER_CREDITS;
    case "REFERRAL_REFERRER_FIRST_USE_CREDITS":
      return env.REFERRAL_REFERRER_FIRST_USE_CREDITS;
    case "REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS":
      return env.REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS;
    case "REFERRAL_REWARD_VALID_DAYS":
      return env.REFERRAL_REWARD_VALID_DAYS;
    case "REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS":
      return env.REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS;
    default:
      throw new PlatformSettingError(key, `未知配置键：${key}`);
  }
}

function normalizeDate(value: string | null | undefined): string | null {
  const parsed = parseOptionalIsoDate(value);
  return parsed ? parsed.toISOString() : null;
}

/**
 * 把后台传来的值归一化到该键允许的类型。
 * 严格：布尔不接受 "yes"/"1"，整数不接受小数/越界，时间不接受非法 ISO、不接受裸日期。
 */
export function coercePlatformSettingValue(key: string, raw: unknown): PlatformSettingValue {
  const definition = DEFINITION_BY_KEY.get(key);
  if (!definition) throw new PlatformSettingError(key, `未知配置键：${key}`);

  if (definition.type === "boolean") {
    const parsed =
      typeof raw === "boolean"
        ? raw
        : typeof raw === "string" && raw.trim().toLowerCase() === "true"
          ? true
          : typeof raw === "string" && raw.trim().toLowerCase() === "false"
            ? false
            : null;
    if (parsed === null) throw new PlatformSettingError(key, `${definition.label} 只能是 true / false`);
    if (definition.lockedValue !== undefined && parsed !== definition.lockedValue) {
      throw new PlatformSettingError(key, `${definition.label} 是冻结口径，只能是 ${String(definition.lockedValue)}`);
    }
    return parsed;
  }

  if (definition.type === "integer") {
    const text = typeof raw === "string" ? raw.trim() : raw;
    if (text === null || text === undefined || text === "") {
      throw new PlatformSettingError(key, `${definition.label} 需要填写整数`);
    }
    const parsed = typeof text === "number" ? text : Number(text);
    if (!Number.isInteger(parsed)) throw new PlatformSettingError(key, `${definition.label} 必须是整数`);
    if (definition.min !== undefined && parsed < definition.min) {
      throw new PlatformSettingError(key, `${definition.label} 不能小于 ${definition.min}`);
    }
    if (definition.max !== undefined && parsed > definition.max) {
      throw new PlatformSettingError(key, `${definition.label} 不能大于 ${definition.max}`);
    }
    return parsed;
  }

  // datetime
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  if (typeof raw !== "string") throw new PlatformSettingError(key, `${definition.label} 需要 ISO 8601 时间字符串`);
  const text = raw.trim();
  if (!/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    throw new PlatformSettingError(key, `${definition.label} 需要带时间的 ISO 8601，例 2026-10-01T00:00:00+08:00`);
  }
  const parsed = parseOptionalIsoDate(text);
  if (!parsed) throw new PlatformSettingError(key, `${definition.label} 不是合法时间：${text}`);
  return parsed.toISOString();
}

/** 活动窗判断：左闭右开。窗口未配置完整（任一端为空）时一律视为窗外。 */
export function isWithinReferralCampaignWindow(
  at: Date,
  window: { campaignStartsAt: string | null; campaignEndsAt: string | null }
): boolean {
  const startsAt = window.campaignStartsAt ? new Date(window.campaignStartsAt) : null;
  const endsAt = window.campaignEndsAt ? new Date(window.campaignEndsAt) : null;
  if (!startsAt || !endsAt) return false;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return false;
  const time = at.getTime();
  return time >= startsAt.getTime() && time < endsAt.getTime();
}

/**
 * 演示/本地无库场景（DATA_MODE=demo）用内存覆盖，保证后台面板在本地也能读写；
 * 生产一律走数据库，避免「重启就丢配置」。
 */
const demoOverrides = new Map<string, { value: PlatformSettingValue; updatedAt: string; updatedBy: string | null }>();
let warnedOnDatabaseFallback = false;

async function readStoredRows(): Promise<Map<string, { value: PlatformSettingValue; updatedAt: Date; updatedBy: string | null }>> {
  const stored = new Map<string, { value: PlatformSettingValue; updatedAt: Date; updatedBy: string | null }>();
  if (env.DATA_MODE !== "database") {
    for (const [key, row] of demoOverrides) {
      stored.set(key, { value: row.value, updatedAt: new Date(row.updatedAt), updatedBy: row.updatedBy });
    }
    return stored;
  }
  try {
    const rows = await prisma.platformSetting.findMany({
      where: { key: { in: PLATFORM_SETTING_DEFINITIONS.map((item) => item.key) } },
      select: { key: true, value: true, updatedAt: true, updatedBy: true }
    });
    for (const row of rows) {
      stored.set(row.key, { value: row.value as PlatformSettingValue, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
    }
  } catch (error) {
    // 表还没迁移（老库/本地）时不能把服务打挂：退回 env 默认值（默认就是最保守的状态）。
    if (!warnedOnDatabaseFallback) {
      warnedOnDatabaseFallback = true;
      console.warn(
        "[referral-config] PlatformSetting 读取失败，暂用 env 默认值：",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return stored;
}

export async function readPlatformSettings(): Promise<PlatformSettingsSnapshot> {
  const stored = await readStoredRows();
  const settings = PLATFORM_SETTING_DEFINITIONS.map((definition) => {
    const envValue = envValueOf(definition.key);
    const override = stored.get(definition.key);
    const value = override ? override.value : envValue;
    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      type: definition.type,
      ...(definition.min !== undefined ? { min: definition.min } : {}),
      ...(definition.max !== undefined ? { max: definition.max } : {}),
      ...(definition.lockedValue !== undefined ? { lockedValue: definition.lockedValue } : {}),
      value,
      envValue,
      source: override ? ("database" as const) : ("env" as const),
      updatedAt: override ? override.updatedAt.toISOString() : null,
      updatedBy: override?.updatedBy ?? null
    };
  });
  const valueOf = (key: string): PlatformSettingValue =>
    settings.find((item) => item.key === key)?.value ?? null;
  return {
    settings,
    trialGrantEnabled: valueOf("MARKETPLACE_TRIAL_GRANT_ENABLED") === true,
    referralRewardEnabled: valueOf("REFERRAL_REWARD_ENABLED") === true,
    referralTextOnly: valueOf("REFERRAL_REWARD_TEXT_ONLY") === true
  };
}

/** 后台写入：整批校验通过才落库，避免「改了一半」。 */
export async function updatePlatformSettings(
  updates: Record<string, unknown>,
  operator: string | null
): Promise<PlatformSettingsSnapshot> {
  const entries = Object.entries(updates ?? {});
  if (entries.length === 0) throw new PlatformSettingError("", "没有要更新的配置项");
  if (entries.length > PLATFORM_SETTING_DEFINITIONS.length) {
    throw new PlatformSettingError("", "一次提交的配置项过多");
  }
  const coerced = entries.map(([key, raw]) => [key, coercePlatformSettingValue(key, raw)] as const);

  // 跨键规则必须在写入前检查：活动窗完整且左闭右开、总开关打开时窗口必须完整。
  const current = await readPlatformSettings();
  const merged = new Map(current.settings.map((item) => [item.key, item.value]));
  for (const [key, value] of coerced) merged.set(key, value);
  const startsAt = merged.get("REFERRAL_CAMPAIGN_STARTS_AT") as string | null;
  const endsAt = merged.get("REFERRAL_CAMPAIGN_ENDS_AT") as string | null;
  if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new PlatformSettingError(
      "REFERRAL_CAMPAIGN_STARTS_AT",
      "活动开始必须早于活动结束（活动窗左闭右开）"
    );
  }
  if (merged.get("REFERRAL_REWARD_ENABLED") === true && (!startsAt || !endsAt)) {
    throw new PlatformSettingError(
      "REFERRAL_REWARD_ENABLED",
      "打开推荐有礼前必须先把活动开始与结束时间填完整"
    );
  }

  const updatedAt = new Date();
  if (env.DATA_MODE === "database") {
    await prisma.$transaction(
      coerced.map(([key, value]) =>
        prisma.platformSetting.upsert({
          where: { key },
          update: { value: value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue), updatedBy: operator ?? null },
          create: {
            key,
            value: value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue),
            updatedBy: operator ?? null
          }
        })
      )
    );
  } else {
    for (const [key, value] of coerced) {
      demoOverrides.set(key, { value, updatedAt: updatedAt.toISOString(), updatedBy: operator ?? null });
    }
  }
  return await readPlatformSettings();
}

/** 人工体验额度发放入口是否放行（PLAT-28 第①批：默认停用）。 */
export async function isMarketplaceTrialGrantEnabled(): Promise<boolean> {
  const snapshot = await readPlatformSettings();
  return snapshot.trialGrantEnabled;
}

/** 第②批奖励引擎要读的配置（第①批只保证读得到、读得对，不发奖）。 */
export async function getReferralConfig(): Promise<ReferralConfig> {
  const snapshot = await readPlatformSettings();
  const valueOf = (key: string): PlatformSettingValue =>
    snapshot.settings.find((item) => item.key === key)?.value ?? null;
  const sources: Record<string, "database" | "env"> = {};
  for (const item of snapshot.settings) sources[item.key] = item.source;
  return {
    enabled: snapshot.referralRewardEnabled,
    campaignStartsAt: (valueOf("REFERRAL_CAMPAIGN_STARTS_AT") as string | null) ?? null,
    campaignEndsAt: (valueOf("REFERRAL_CAMPAIGN_ENDS_AT") as string | null) ?? null,
    newUserCredits: Number(valueOf("REFERRAL_NEW_USER_CREDITS") ?? 0),
    referrerFirstUseCredits: Number(valueOf("REFERRAL_REFERRER_FIRST_USE_CREDITS") ?? 0),
    referrerFirstRechargeCredits: Number(valueOf("REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS") ?? 0),
    rewardValidDays: Number(valueOf("REFERRAL_REWARD_VALID_DAYS") ?? 0),
    alertThresholdCredits: Number(valueOf("REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS") ?? 0),
    textOnly: valueOf("REFERRAL_REWARD_TEXT_ONLY") === true,
    sources
  };
}

/** 仅测试用：清掉内存覆盖（demo 模式）与已读告警标记。 */
export function resetReferralConfigCacheForTests(): void {
  demoOverrides.clear();
  warnedOnDatabaseFallback = false;
}
