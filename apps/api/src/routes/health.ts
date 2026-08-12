import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import {
  domesticNetworkOnly,
  domesticOutboundAllowlist,
  env,
  getHighCapabilityLlmModels,
  getWechatAuthConfigIssues,
  getWechatPayConfigIssues,
  inviteCodes,
  inviteRequired,
  validateRuntimeConfig,
  wechatAuthRequired
} from "../config/env.js";
import { requireOpsToken } from "../services/access-guards.js";
import type { RuntimeLlmProvider } from "../services/llm-provider-factory.js";

const wechatAuthCheckQuerySchema = z.object({
  redirectUri: z.string().url().optional(),
  state: z.string().max(80).optional()
});

export async function registerHealthRoutes(
  app: FastifyInstance,
  provider: RuntimeLlmProvider
): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    service: "Sitong-os-v2-api",
    time: new Date().toISOString()
  }));

  app.get("/ready", async (_request, reply) => {
    const issues = validateRuntimeConfig();
    const db = await checkDatabase();
    const llm = {
      provider: provider.name,
      model: provider.getModel(),
      requiredTier: "approved_top_tier_domestic_model",
      allowedModels: getHighCapabilityLlmModels(),
      configured: provider.isConfigured()
    };

    const ok = issues.length === 0 && db.ok;
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: "Sitong-os-v2-api",
      dataMode: env.DATA_MODE,
      nodeEnv: env.NODE_ENV,
      checks: {
        config: {
          ok: issues.length === 0,
          issues
        },
        database: db,
        llm
      },
      time: new Date().toISOString()
    });
  });

  async function llmSmoke(_request: unknown, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
    if (!provider.isConfigured()) {
      return reply.code(503).send({
        ok: false,
        error: "llm_not_configured",
        message: "当前选中的中国国内大模型 API Key 和 Base URL 未配置"
      });
    }

    const answer = await provider.complete([
      {
        role: "system",
        content: "你是AI增长OS的模型连通性检测助手，只需简短回答。"
      },
      {
        role: "user",
        content: "请回复：模型连接正常"
      }
    ]);

    return {
      ok: true,
      provider: provider.name,
      model: provider.getModel(),
      requiredTier: "approved_top_tier_domestic_model",
      answer
    };
  }

  app.get("/ops/llm-smoke", { preHandler: requireOpsToken }, llmSmoke);
  app.post("/ops/llm-smoke", { preHandler: requireOpsToken }, llmSmoke);

  app.get("/ops/wechat-auth-check", { preHandler: requireOpsToken }, async (request, reply) => {
    const parsed = wechatAuthCheckQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    if (!wechatAuthRequired) {
      return {
        ok: true,
        configured: false,
        required: false,
        issues: [],
        appIdPreview: null,
        redirectUri: null,
        authorizeUrl: null,
        nextAction: "WECHAT_AUTH_REQUIRED=false，当前为邀请码内测登录模式；准备微信网页授权后再开启。"
      };
    }

    const redirectUri =
      parsed.data.redirectUri ??
      env.WECHAT_AUTH_REDIRECT_URI ??
      process.env.VITE_WECHAT_AUTH_REDIRECT_URI;
    const issues = getWechatAuthConfigIssues().filter(
      (issue) =>
        !redirectUri ||
        (!issue.includes("WECHAT_AUTH_REDIRECT_URI") &&
          !issue.includes("VITE_WECHAT_AUTH_REDIRECT_URI"))
    );
    if (!redirectUri) {
      issues.push("WECHAT_AUTH_REDIRECT_URI or redirectUri query is required for OAuth URL preview");
    }

    return {
      ok: issues.length === 0,
      configured: issues.length === 0,
      issues,
      appIdPreview: env.WECHAT_AUTH_APPID ? previewValue(env.WECHAT_AUTH_APPID) : null,
      redirectUri: redirectUri ?? null,
      authorizeUrl:
        issues.length === 0 && redirectUri
          ? buildWechatAuthorizeUrl({
              appId: env.WECHAT_AUTH_APPID!,
              redirectUri,
              state: parsed.data.state ?? `baolu_${Date.now()}`
            })
          : null,
      nextAction:
        issues.length === 0
          ? "Copy authorizeUrl into a WeChat browser or test with the configured H5 login button."
          : "Fix WeChat auth configuration before customer login testing."
    };
  });

  app.get("/ops/wechat-pay-check", { preHandler: requireOpsToken }, async () => {
    const issues = getWechatPayConfigIssues();
    const warnings: string[] = [];
    const notifyUrl = env.WECHAT_PAY_NOTIFY_URL ?? null;

    if (env.WECHAT_PAY_PRIVATE_KEY && !looksLikePem(env.WECHAT_PAY_PRIVATE_KEY)) {
      warnings.push("WECHAT_PAY_PRIVATE_KEY does not look like a PEM key; use \\n for newlines in env files.");
    }
    if (env.WECHAT_PAY_PLATFORM_PUBLIC_KEY && !looksLikePem(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY)) {
      warnings.push("WECHAT_PAY_PLATFORM_PUBLIC_KEY does not look like a PEM key; use \\n for newlines in env files.");
    }
    if (notifyUrl && !notifyUrl.includes("/billing/wechat/notify")) {
      warnings.push("WECHAT_PAY_NOTIFY_URL should usually end with /os-v2/api/billing/wechat/notify.");
    }

    return {
      ok: issues.length === 0,
      configured: issues.length === 0,
      required: env.WECHAT_PAY_REQUIRED !== "false",
      issues,
      warnings,
      appIdPreview: env.WECHAT_PAY_APPID ? previewValue(env.WECHAT_PAY_APPID) : null,
      mchIdPreview: env.WECHAT_PAY_MCH_ID ? previewValue(env.WECHAT_PAY_MCH_ID) : null,
      certSerialPreview: env.WECHAT_PAY_CERT_SERIAL_NO
        ? previewValue(env.WECHAT_PAY_CERT_SERIAL_NO)
        : null,
      notifyUrl,
      callbackPath: "/billing/wechat/notify",
      nextAction:
        issues.length === 0
          ? "Create a test order and run beta:smoke with --include-wechat-pay to verify native prepay."
          : "Fix WeChat Pay configuration before payment testing."
    };
  });

  app.get("/ops/launch-check", { preHandler: requireOpsToken }, async () => {
    const configIssues = validateRuntimeConfig();
    const db = await checkDatabase();
    const inviteGate = await checkInviteGate();
    const wechatAuthIssues = getWechatAuthConfigIssues();
    const wechatPayRequired = env.WECHAT_PAY_REQUIRED !== "false";
    const wechatPayIssues = wechatPayRequired ? getWechatPayConfigIssues() : [];
    const checks = [
      {
        key: "runtime_config",
        ok: configIssues.length === 0,
        issues: configIssues
      },
      {
        key: "database",
        ok: env.DATA_MODE === "database" ? db.ok : env.NODE_ENV !== "production",
        issues:
          env.DATA_MODE === "database"
            ? db.ok
              ? []
              : [db.error ?? "database check failed"]
            : ["demo mode is only acceptable for local/internal demo"]
      },
      {
        key: "domestic_network_policy",
        ok: domesticNetworkOnly && domesticOutboundAllowlist.length > 0,
        issues: domesticNetworkOnly
          ? []
          : ["DOMESTIC_NETWORK_ONLY must be true before customer launch"]
      },
      {
        key: "llm_provider",
        ok: provider.isConfigured(),
        issues: provider.isConfigured()
          ? []
          : ["当前选中的中国国内大模型 API Key 和 Base URL 是客户上线前必填项"]
      },
      {
        key: "invite_gate",
        ok: inviteGate.ok,
        issues: inviteGate.issues,
        metadata: inviteGate.metadata
      },
      {
        key: "wechat_auth",
        ok: wechatAuthIssues.length === 0,
        issues: wechatAuthIssues,
        metadata: {
          required: wechatAuthRequired,
          mode: wechatAuthRequired ? "wechat_oauth" : "invite_only_beta"
        }
      },
      {
        key: "wechat_pay",
        ok: wechatPayIssues.length === 0,
        issues: wechatPayIssues,
        metadata: {
          required: wechatPayRequired
        }
      },
      {
        key: "dev_login_disabled",
        ok: env.NODE_ENV === "production",
        issues:
          env.NODE_ENV === "production"
            ? []
            : ["NODE_ENV must be production before public customer launch"]
      }
    ];
    const blockingKeys = [
      "runtime_config",
      "database",
      "domestic_network_policy",
      "llm_provider",
      "invite_gate",
      "wechat_auth",
      "wechat_pay",
      "dev_login_disabled"
    ];
    const ok = checks
      .filter((check) => blockingKeys.includes(check.key))
      .every((check) => check.ok);

    return {
      ok,
      launchMode: ok ? "customer_ready" : "not_ready",
      service: "Sitong-os-v2-api",
      dataMode: env.DATA_MODE,
      nodeEnv: env.NODE_ENV,
      checks,
      nextAction: ok
        ? "可以进入小范围老客户体验"
        : "先修复 ok=false 的检查项，再开放给客户",
      time: new Date().toISOString()
    };
  });
}

function buildWechatAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  url.searchParams.set("appid", params.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_base");
  url.searchParams.set("state", params.state);
  return `${url.toString()}#wechat_redirect`;
}

function previewValue(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function looksLikePem(value: string): boolean {
  const normalized = value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
  return normalized.includes("-----BEGIN") && normalized.includes("-----END");
}

async function checkDatabase(): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  if (env.DATA_MODE === "demo") {
    return { ok: true, skipped: true };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, skipped: false };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : "unknown database error"
    };
  }
}

async function checkInviteGate(): Promise<{
  ok: boolean;
  issues: string[];
  metadata?: Record<string, unknown>;
}> {
  if (!inviteRequired) {
    return {
      ok: true,
      issues: [],
      metadata: {
        required: false
      }
    };
  }

  if (env.DATA_MODE === "database") {
    try {
      const now = new Date();
      const availableInvites = await prisma.inviteCode.findMany({
        where: {
          isActive: true,
          OR: [
            {
              expiresAt: null
            },
            {
              expiresAt: {
                gt: now
              }
            }
          ]
        },
        select: {
          id: true,
          maxUses: true,
          usedCount: true
        },
        take: 200
      });
      const availableInviteCount = availableInvites.filter(
        (invite: any) => invite.usedCount < invite.maxUses
      ).length;
      const highCapacityInviteCount = availableInvites.filter(
        (invite: any) =>
          invite.usedCount < invite.maxUses &&
          (invite.maxUses > 10 || invite.maxUses - invite.usedCount > 10)
      ).length;
      const hasAvailableInvite = availableInviteCount > 0 || inviteCodes.length > 0;
      const hasUnsafeSharedInvite = highCapacityInviteCount > 0 || inviteCodes.length > 0;
      return {
        ok: hasAvailableInvite && !hasUnsafeSharedInvite,
        issues: [
          ...(!hasAvailableInvite
            ? ["No active database invite codes or INVITE_CODES configured"]
            : []),
          ...(highCapacityInviteCount > 0
            ? [
                `${highCapacityInviteCount} active high-capacity shared invite code(s) remain; deactivate them and issue one-time customer codes.`
              ]
            : []),
          ...(inviteCodes.length > 0
            ? [
                "INVITE_CODES fallback is configured; remove shared plaintext env invite codes and use database one-time codes."
              ]
            : [])
        ],
        metadata: {
          required: true,
          databaseInviteCount: availableInviteCount,
          highCapacityInviteCount,
          envInviteCount: inviteCodes.length,
          recommendedMaxUsesPerCustomerCode: 1
        }
      };
    } catch (error) {
      return {
        ok: false,
        issues: [error instanceof Error ? error.message : "invite gate check failed"],
        metadata: {
          required: true
        }
      };
    }
  }

  return {
    ok: inviteCodes.length > 0,
    issues: inviteCodes.length > 0 ? [] : ["INVITE_CODES is required while INVITE_REQUIRED=true"],
    metadata: {
      required: true,
      envInviteCount: inviteCodes.length
    }
  };
}
