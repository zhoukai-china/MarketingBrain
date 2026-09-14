#!/usr/bin/env node
/**
 * 思潼AI 货架体验额度：销售/运营确认真实商家身份后**手工定向发放**（PLAT-10）。
 *
 * 口径（与产品拍板一致）：
 * - 新用户注册默认 **0 积分**，不自动赠送任何欢迎积分（`NEW_USER_*_TRIAL_CREDITS` 仅用于隔离测试环境）。
 * - 体验额度只在「销售确认商家身份」之后由人触发，走**用户级钱包 bonus 桶**：不可退款、不可折现、不计收入。
 * - 同一 `--grant-id` 幂等：重复执行不会重复加币；同一 grant-id 换金额直接报错。
 * - 系统当前**不自动回收**过期体验积分；`--valid-days` 只用于打印运营建议到期日，回收靠人工。
 * - **PLAT-28 第①批（2026-09-12 用户口径）：人工发放默认停用**。开关为
 *   `MARKETPLACE_TRIAL_GRANT_ENABLED`（默认 false；后台 `/agents/admin` 的同名开关可覆盖），
 *   关闭时本脚本打印明确原因并以退出码 2 结束，绝不写任何流水。
 *
 * 用法（在仓库根目录、进程内已有 DATABASE_URL 时执行）：
 *   node scripts/grant-marketplace-trial-credits.mjs \
 *     --phone 13800000000 --amount 400 --grant-id 20260911-sales01-store07 \
 *     --operator sales01 --valid-days 3
 *   node scripts/grant-marketplace-trial-credits.mjs --user-id <cuid> --amount 200 --grant-id ... --dry-run
 *
 * 身份定位参数四选一：`--user-id` / `--phone` / `--wechat-openid` / `--wechat-unionid`。
 * 用户必须先自己扫码注册登入（脚本找不到用户就报 `user_not_found`），可选 `--tenant-id` 校验归属，
 * 避免把额度发到同一个人名下的另一个工作区。
 */
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

/** 体验额度发放流水前缀：`trial_grant:<grant-id>`，用来做幂等键与后续对账检索。 */
const TRIAL_GRANT_SOURCE_PREFIX = "trial_grant:";
/** 单笔体验额度硬上限：防止误输入把「体验」发成「大额赠送」。 */
const MAX_TRIAL_CREDITS = 800;

/**
 * 人工发放总开关：后台 PlatformSetting 覆盖值优先，其次 env（默认 false）。
 * 表还没迁移时退回 env——默认值即「停用」，失败方向是安全的。
 */
async function resolveTrialGrantEnabled(prisma) {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: "MARKETPLACE_TRIAL_GRANT_ENABLED" }
    });
    if (row) return row.value === true || row.value === "true";
  } catch {
    /* 老库还没有 PlatformSetting 表：退回 env 判定 */
  }
  return process.env.MARKETPLACE_TRIAL_GRANT_ENABLED === "true";
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") continue;
    if (!item?.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[item.slice(2)] = "true";
      continue;
    }
    values[item.slice(2)] = next;
    index += 1;
  }
  return values;
}

function requireText(value, name, { min = 1, max = 120 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) {
    throw new Error(`${name} must be ${min}-${max} characters`);
  }
  return text;
}

function resolveUserSelector(args) {
  const selectors = [
    ["--user-id", args["user-id"] ? { id: args["user-id"].trim() } : null],
    ["--phone", args.phone ? { phone: args.phone.trim() } : null],
    ["--wechat-openid", args["wechat-openid"] ? { wechatOpenid: args["wechat-openid"].trim() } : null],
    ["--wechat-unionid", args["wechat-unionid"] ? { wechatUnionid: args["wechat-unionid"].trim() } : null]
  ].filter(([, where]) => where !== null);

  if (selectors.length !== 1) {
    throw new Error(
      "exactly one identity selector is required: --user-id | --phone | --wechat-openid | --wechat-unionid"
    );
  }
  return selectors[0];
}

async function resolveUser(tx, args) {
  const [label, where] = resolveUserSelector(args);
  const users = await tx.user.findMany({
    where,
    select: { id: true, nickname: true, phone: true, wechatOpenid: true, createdAt: true },
    take: 5
  });
  if (users.length === 0) {
    throw new Error(`user_not_found: no user matched ${label} (该微信号必须先自己扫码注册登入)`);
  }
  if (users.length > 1) {
    throw new Error(`user_ambiguous: ${users.length} users matched ${label}, please pass --user-id`);
  }
  return users[0];
}

async function assertTenantMembership(tx, userId, tenantId) {
  const membership = await tx.membership.findFirst({
    where: { userId, tenantId },
    select: { id: true }
  });
  if (!membership) {
    throw new Error(`tenant_mismatch: user ${userId} is not a member of tenant ${tenantId}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const args = parseArgs(process.argv.slice(2));
  const grantId = requireText(args["grant-id"], "--grant-id", { min: 8, max: 80 });
  if (!/^[A-Za-z0-9_-]+$/.test(grantId)) {
    throw new Error("--grant-id must contain only letters, digits, hyphen and underscore");
  }
  const amount = Number.parseInt(args.amount ?? "", 10);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TRIAL_CREDITS) {
    throw new Error(`--amount must be an integer between 1 and ${MAX_TRIAL_CREDITS}`);
  }
  const operator = args.operator ? requireText(args.operator, "--operator", { min: 2, max: 40 }) : null;
  const tenantIdFilter = args["tenant-id"] ? args["tenant-id"].trim() : null;
  const validDays = args["valid-days"] === undefined ? null : Number.parseInt(args["valid-days"], 10);
  if (validDays !== null && (!Number.isInteger(validDays) || validDays < 1 || validDays > 90)) {
    throw new Error("--valid-days must be an integer between 1 and 90");
  }
  const dryRun = args["dry-run"] === "true";

  const prisma = new PrismaClient();
  try {
    if (!(await resolveTrialGrantEnabled(prisma))) {
      console.error("trial_grant_disabled: 人工发放体验额度已停用（PLAT-28 第①批，2026-09-12 用户口径）。");
      console.error("- 未写入任何积分与流水；历史发放记录仍可只读核对。");
      console.error("- 重新放行：在后台 /agents/admin「推荐有礼配置位」打开「人工体验额度发放」，");
      console.error("  或把 MARKETPLACE_TRIAL_GRANT_ENABLED=true 写进运行环境后再执行本脚本。");
      process.exitCode = 2;
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const user = await resolveUser(tx, args);
      if (tenantIdFilter) await assertTenantMembership(tx, user.id, tenantIdFilter);

      const source = `${TRIAL_GRANT_SOURCE_PREFIX}${grantId}`;
      const existing = await tx.walletLedger.findFirst({
        where: { userId: user.id, source },
        select: { id: true, delta: true, createdAt: true }
      });

      const wallet = dryRun
        ? await tx.wallet.findUnique({ where: { userId: user.id } })
        : await tx.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

      if (existing) {
        if (existing.delta !== amount) {
          throw new Error(
            `grant_id_conflict: grant ${grantId} already applied with amount ${existing.delta}, refusing amount ${amount}`
          );
        }
        return {
          state: "already_applied",
          user,
          wallet: wallet ?? { paidBalance: 0, bonusBalance: 0 },
          grantedAt: existing.createdAt
        };
      }

      if (dryRun) {
        return {
          state: "dry_run",
          user,
          wallet: wallet ?? { paidBalance: 0, bonusBalance: 0 },
          grantedAt: null
        };
      }

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { bonusBalance: { increment: amount } }
      });
      const ledger = await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: user.id,
          delta: amount,
          bucket: "bonus",
          type: "bonus",
          source,
          refOrderId: operator ? `operator:${operator}` : null
        }
      });
      return { state: "created", user, wallet: updated, grantedAt: ledger.createdAt };
    });

    const total = result.wallet.paidBalance + result.wallet.bonusBalance;
    console.log(
      `marketplace_trial_grant=${result.state};grant_id=${grantId};amount=${amount};user_id=${result.user.id};bonus_balance=${result.wallet.bonusBalance};paid_balance=${result.wallet.paidBalance};balance=${total}`
    );
    console.log(
      `- 用户：${result.user.nickname ?? "(无昵称)"}；手机号：${result.user.phone ?? "(未绑定)"}；微信 openid：${result.user.wechatOpenid ?? "(未绑定)"}`
    );
    console.log(`- 体验额度走 bonus 桶：不可退款、不可折现、不开发票、不计入收入。`);
    if (result.state === "dry_run") {
      console.log(`- dry-run：未写入任何流水与余额，实际执行会发放 ${amount} 积分。`);
    }
    if (validDays !== null) {
      const base = result.grantedAt ?? new Date();
      const until = new Date(base.getTime() + validDays * 24 * 60 * 60 * 1000);
      console.log(`- 运营建议到期日：${until.toISOString().slice(0, 10)}（${validDays} 天）`);
      console.log(`- 注意：系统当前不自动回收过期体验积分，到期后需要人工核对余额并决定是否回收。`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
