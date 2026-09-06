import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, prisma } from "@baolu/db";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { validateAgentWorkMapDefinition } from "@baolu/shared";
import { env } from "../config/env.js";
import { AGENT_DEFINITIONS } from "./agent-definitions.js";

export async function ensureAgentProductCatalog(): Promise<void> {
  if (env.DATA_MODE !== "database") return;

  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.marketing.workMap) continue;
    const workMapIssues = validateAgentWorkMapDefinition(agent.marketing.workMap, agent.capabilities.map((item) => item.key));
    if (workMapIssues.length) throw new Error(`agent_work_map_invalid:${agent.slug}:${workMapIssues.join(",")}`);
  }

  const releaseIds = new Map<string, string>();
  for (const skillId of new Set(AGENT_DEFINITIONS.flatMap((agent) => agent.capabilities.map((item) => item.skillId)))) {
    const manifest = SKILL_MANIFESTS[skillId as keyof typeof SKILL_MANIFESTS];
    if (!manifest) throw new Error(`agent_catalog_skill_missing:${skillId}`);
    const original = await readOriginalSkill(skillId);
    const baseVersion = readOriginalSkillVersion(original.text, manifest.version);
    const version = `${baseVersion}+${original.fileHash.slice(0, 8)}`;
    const fileHash = original.fileHash;
    const release = await prisma.skillRelease.upsert({
      where: { skillId_version: { skillId, version } },
      // Releases are immutable. A changed file hash produces a new version;
      // startup must never overwrite or silently reactivate an old release.
      update: {},
      create: {
        skillId,
        version,
        fileHash,
        packageSnapshot: { prompt: original.text },
        status: "active",
        publishedAt: new Date()
      }
    });
    releaseIds.set(skillId, release.id);
  }

  for (const seed of AGENT_DEFINITIONS) {
    const agent = await prisma.agentDefinition.upsert({
      where: { slug: seed.slug },
      update: {
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        status: seed.status,
        sortOrder: seed.sortOrder,
        marketing: seed.marketing as unknown as Prisma.InputJsonValue
      },
      create: {
        id: seed.id,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        status: seed.status,
        sortOrder: seed.sortOrder,
        marketing: seed.marketing as unknown as Prisma.InputJsonValue
      }
    });

    const activeCapabilityKeys = seed.capabilities.map((item) => item.key);
    await prisma.agentCapability.updateMany({
      where: {
        agentId: agent.id,
        key: { notIn: activeCapabilityKeys }
      },
      data: { isActive: false }
    });

    for (const skillId of new Set(seed.capabilities.map((item) => item.skillId))) {
      const skillReleaseId = releaseIds.get(skillId)!;
      const existingBinding = await prisma.agentSkillBinding.findFirst({
        where: { agentId: agent.id, skillRelease: { skillId } }
      });
      if (!existingBinding) {
        await prisma.agentSkillBinding.create({
          data: {
          agentId: agent.id,
          skillReleaseId,
          isDefault: skillId === seed.defaultSkillId
          }
        });
      } else {
        await prisma.agentSkillBinding.update({
          where: { id: existingBinding.id },
          data: {
            skillReleaseId,
            isDefault: skillId === seed.defaultSkillId
          }
        });
      }
    }

    for (let index = 0; index < seed.capabilities.length; index += 1) {
      const capability = seed.capabilities[index];
      await prisma.agentCapability.upsert({
        where: { agentId_key: { agentId: agent.id, key: capability.key } },
        update: {
          title: capability.title,
          subtitle: capability.subtitle,
          promptTemplate: capability.promptTemplate,
          skillReleaseId: releaseIds.get(capability.skillId)!,
          sortOrder: index * 10,
          isActive: true
        },
        create: {
          agentId: agent.id,
          key: capability.key,
          title: capability.title,
          subtitle: capability.subtitle,
          promptTemplate: capability.promptTemplate,
          skillReleaseId: releaseIds.get(capability.skillId)!,
          sortOrder: index * 10,
          isActive: true
        }
      });
    }
  }

  await grantCreditOnlyAgentAccess();
}

/**
 * Agent capability is no longer sold as a time-limited product. Every active
 * enterprise gets the active Agent catalog; individual execution is governed
 * by credit balance in the runtime instead of a monthly subscription.
 */
async function grantCreditOnlyAgentAccess(): Promise<void> {
  const agents = AGENT_DEFINITIONS.filter((item) => item.status === "active");
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      memberships: { where: { isActive: true }, select: { id: true } }
    }
  });

  for (const tenant of tenants) {
    for (const agent of agents) {
      await prisma.tenantAgentEntitlement.upsert({
        where: { tenantId_agentId: { tenantId: tenant.id, agentId: agent.id } },
        update: {
          status: "active",
          source: "credits_only",
          expiresAt: null,
          orderId: null
        },
        create: {
          tenantId: tenant.id,
          agentId: agent.id,
          status: "active",
          source: "credits_only"
        }
      });
      for (const membership of tenant.memberships) {
        await prisma.memberAgentAccess.upsert({
          where: { membershipId_agentId: { membershipId: membership.id, agentId: agent.id } },
          update: {},
          create: { membershipId: membership.id, agentId: agent.id }
        });
      }
    }
  }
}

async function ensureDraftOffers(): Promise<void> {
  const offers = [
    { code: "ceo_cockpit_agent", name: "CEO经营驾驶舱智能体", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_ceo_cockpit"] },
    { code: "takeaway_growth_agent", name: "思潼·外卖增长智能体", description: "品牌总部与门店外卖增长工作台。", status: "active" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_takeaway_growth"] },
    { code: "restaurant_growth_agent", name: "思潼·餐饮增长智能体", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_restaurant_growth"] },
    { code: "acquisition_agent", name: "思潼·创始人IP获客系统", description: "199元使用30天，含2000积分；支持招商加盟、C端团购到店、学员招募与合作方招募，活动与指标分别隔离。", status: "active" as const, amountCny: 199, credits: 2000, durationDays: 30, agentIds: ["agent_acquisition"] },
    // Keep the legacy offer and Agent ID for existing tenants during FIP-01.
    { code: "store_acquisition_agent", name: "思潼·门店获客智能体（兼容入口）", description: "旧门店获客入口在迁移期间保持可用；新任务统一进入创始人IP获客系统的C端团购到店目标。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 30, agentIds: ["agent_store_acquisition"] },
    { code: "sales_agent", name: "销售 Agent", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_sales"] },
    { code: "clipper_agent", name: "自由组片 Agent", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_clipper"] },
    { code: "growth_duo", name: "获客 + 销售组合", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_acquisition", "agent_sales"] },
    { code: "content_growth_bundle", name: "获客 + 自由组片组合", description: "请在内部后台确认价格、积分和有效期后上架。", status: "draft" as const, amountCny: 0, credits: 0, durationDays: 365, agentIds: ["agent_acquisition", "agent_clipper"] }
  ];
  for (const seed of offers) {
    const offer = await prisma.agentOffer.upsert({
      where: { code: seed.code },
      update: {
        name: seed.name,
        description: seed.description,
        status: seed.status,
        amountCny: seed.amountCny,
        credits: seed.credits,
        durationDays: seed.durationDays
      },
      create: {
        code: seed.code,
        name: seed.name,
        description: seed.description,
        status: seed.status,
        amountCny: seed.amountCny,
        credits: seed.credits,
        durationDays: seed.durationDays
      }
    });
    for (const agentId of seed.agentIds) {
      await prisma.agentOfferAgent.upsert({
        where: { offerId_agentId: { offerId: offer.id, agentId } },
        update: {},
        create: { offerId: offer.id, agentId }
      });
    }
  }
}

async function grantCeoCockpitPilotAccess(): Promise<void> {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === "agent_ceo_cockpit" && item.status === "active");
  if (!agent) return;
  const tenants = await prisma.tenant.findMany({
    where: {
      subscriptions: { some: { status: { in: ["active", "trialing"] } } }
    },
    select: { id: true }
  });
  for (const tenant of tenants) {
    await prisma.tenantAgentEntitlement.upsert({
      where: { tenantId_agentId: { tenantId: tenant.id, agentId: agent.id } },
      update: {},
      create: {
        tenantId: tenant.id,
        agentId: agent.id,
        status: "active",
        source: "ceo_cockpit_pilot"
      }
    });
  }
}

async function grantRestaurantGrowthPilotAccess(): Promise<void> {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === "agent_restaurant_growth" && item.status === "active");
  if (!agent) return;
  const tenants = await prisma.tenant.findMany({
    where: {
      subscriptions: { some: { status: { in: ["active", "trialing"] } } }
    },
    select: { id: true }
  });
  for (const tenant of tenants) {
    await prisma.tenantAgentEntitlement.upsert({
      where: { tenantId_agentId: { tenantId: tenant.id, agentId: agent.id } },
      update: {},
      create: {
        tenantId: tenant.id,
        agentId: agent.id,
        status: "active",
        source: "restaurant_growth_pilot"
      }
    });
  }
}

async function grantTakeawayGrowthPilotAccess(): Promise<void> {
  const agent = AGENT_DEFINITIONS.find((item) => item.id === "agent_takeaway_growth" && item.status === "active");
  if (!agent) return;
  const tenants = await prisma.tenant.findMany({
    where: {
      subscriptions: { some: { status: { in: ["active", "trialing"] } } }
    },
    select: { id: true }
  });
  for (const tenant of tenants) {
    await prisma.tenantAgentEntitlement.upsert({
      where: { tenantId_agentId: { tenantId: tenant.id, agentId: agent.id } },
      update: {},
      create: {
        tenantId: tenant.id,
        agentId: agent.id,
        status: "active",
        source: "takeaway_growth_pilot"
      }
    });
  }
}

async function grantLaunchAgentsToExistingCustomers(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: {
      subscriptions: { some: { status: { in: ["active", "trialing"] } } }
    },
    select: { id: true }
  });
  for (const tenant of tenants) {
    for (const agent of AGENT_DEFINITIONS.filter((item) => item.status === "active")) {
      await prisma.tenantAgentEntitlement.upsert({
        where: { tenantId_agentId: { tenantId: tenant.id, agentId: agent.id } },
        update: { status: "active" },
        create: {
          tenantId: tenant.id,
          agentId: agent.id,
          status: "active",
          source: "launch_migration"
        }
      });
    }
  }
}

async function readOriginalSkill(skillId: string): Promise<{ text: string; fileHash: string }> {
  const file = await readFile(await resolveOriginalSkillPath(skillId));
  return {
    text: file.toString("utf8"),
    fileHash: createHash("sha256").update(file).digest("hex")
  };
}

function readOriginalSkillVersion(text: string, fallback: string): string {
  const match = text.match(/^version:\s*["']?([^\s"']+)/m);
  return match?.[1] ?? fallback;
}

async function resolveOriginalSkillPath(skillId: string): Promise<string> {
  const candidates = [
    path.resolve(env.ORIGINAL_SKILL_ROOT, skillId, "SKILL.md"),
    path.resolve(process.cwd(), "mcp-skills", "skills", skillId, "SKILL.md"),
    path.resolve(process.cwd(), "..", "..", "mcp-skills", "skills", skillId, "SKILL.md")
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Try the next deployment layout.
    }
  }
  throw new Error(`original_skill_not_found:${skillId}`);
}
