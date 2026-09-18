import { z } from "zod";
import { PRODUCT_LOGIN_CODES } from "@baolu/shared";

export const productLoginCodeSchema = z.enum(PRODUCT_LOGIN_CODES);

export const devLoginSchema = z.object({
  tenantRole: z.enum(["personal_ip", "local_business", "chain_brand"]).default("local_business"),
  tenantName: z.string().trim().min(1).max(80).default("演示商家"),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).optional(),
  industry: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  productCode: productLoginCodeSchema.optional(),
  // PLAT-28：推荐有礼推荐码（`/login?ref=xxx` 带过来）。无效/重复只拒绝归因，不影响开通。
  referralCode: z.string().trim().max(200).optional(),
  // PLAT-48：市场合伙人专属链接码（`/login?partner=xxx` 带过来）。无效/重复只拒绝归因，不影响开通。
  partnerCode: z.string().trim().max(200).optional(),
});

export const betaLoginSchema = z.object({
  tenantRole: z.enum(["personal_ip", "local_business", "chain_brand"]).default("local_business"),
  tenantName: z.string().trim().min(1).max(80).default("演示商家"),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).optional(),
  industry: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  // 平台主入口开放注册（INVITE_REQUIRED=false）后不再强制邀请码，schema 必须允许缺省；
  // 缺省时由 validateInviteCode 按服务端开关判定：开放注册放行，邀请制返回
  // 403 invite_code_required（与产品入口同一套错误语义），不再在 schema 层抛 400。
  inviteCode: z.string().trim().max(200).optional(),
  productCode: productLoginCodeSchema.optional(),
  // PLAT-28：推荐有礼推荐码；缺省或非法都不阻断注册，只是不产生归因。
  referralCode: z.string().trim().max(200).optional(),
  // PLAT-48：市场合伙人专属链接码；缺省或非法都不阻断注册，只是不产生归因。
  partnerCode: z.string().trim().max(200).optional(),
});

export const productInviteValidationSchema = z.object({
  productCode: productLoginCodeSchema,
  inviteCode: z.string().trim().min(1).max(200),
});

export const wechatLoginSchema = z.object({
  code: z.string().min(1),
  tenantHostname: z.string().trim().max(253).optional(),
  productCode: productLoginCodeSchema.optional(),
});

export const bindPhoneSchema = z.object({
  phone: z.string().min(6).max(32),
  code: z.string().optional()
});

export const diagnosisReportSchema = z.object({
  summary: z.string(),
  recommendedPlan: z.string(),
  roadmap: z.array(z.object({ step: z.string(), content: z.string(), priority: z.number() }))
});

export const onboardingWorkspaceSchema = z.object({
  onboardingToken: z.string().min(1),
  planCode: z.enum(["local_standard", "local_premium", "ip_standard", "ip_premium", "chain_standard", "chain_premium"]).default("local_standard"),
  tenantName: z.string().min(1).max(80),
  industry: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  nickname: z.string().optional(),
  inviteCode: z.string().optional(),
  // PLAT-28：推荐有礼推荐码（微信授权 → 补资料 → 开通工作区这条路上带的码）。
  referralCode: z.string().optional(),
  // PLAT-48：市场合伙人专属链接码（微信授权 → 补资料 → 开通工作区这条路上带的码）。
  partnerCode: z.string().optional(),
  productCode: productLoginCodeSchema.optional(),
  diagnosisReport: diagnosisReportSchema.optional()
});
