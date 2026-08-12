#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

const allowedPlans = new Set([
  "local_standard",
  "local_premium",
  "chain_standard",
  "chain_premium",
  "ip_standard",
  "ip_premium"
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") continue;
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function normalizeInviteCode(code) {
  return (code ?? "").trim().toLowerCase();
}

function hashInviteCode(code) {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

function previewInviteCode(code) {
  const normalized = normalizeInviteCode(code);
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

function readDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --expires-at value: ${value}`);
  }
  return date;
}

function readMaxUses(value) {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--max-uses must be a positive integer");
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const code = normalizeInviteCode(args.code ?? process.env.INVITE_CODE);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (code.length < 6) {
    throw new Error("Invite code must be at least 6 characters. Pass --code or set INVITE_CODE.");
  }

  const planCode = args.plan ?? process.env.INVITE_PLAN ?? null;
  if (planCode && !allowedPlans.has(planCode)) {
    throw new Error(`Invalid plan code: ${planCode}`);
  }

  const data = {
    codeHash: hashInviteCode(code),
    codePreview: previewInviteCode(code),
    label: args.label ?? process.env.INVITE_LABEL ?? null,
    planCode,
    maxUses: readMaxUses(args["max-uses"] ?? process.env.INVITE_MAX_USES),
    expiresAt: readDate(args["expires-at"] ?? process.env.INVITE_EXPIRES_AT),
    createdBy: args["created-by"] ?? process.env.INVITE_CREATED_BY ?? "script:create-beta-invite",
    isActive: true
  };

  const prisma = new PrismaClient();
  try {
    const invite = await prisma.inviteCode.upsert({
      where: {
        codeHash: data.codeHash
      },
      create: data,
      update: {
        codePreview: data.codePreview,
        label: data.label,
        planCode: data.planCode,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
        createdBy: data.createdBy,
        isActive: true
      }
    });

    console.log(
      JSON.stringify(
        {
          id: invite.id,
          codePreview: invite.codePreview,
          label: invite.label,
          planCode: invite.planCode,
          maxUses: invite.maxUses,
          usedCount: invite.usedCount,
          expiresAt: invite.expiresAt,
          isActive: invite.isActive
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
