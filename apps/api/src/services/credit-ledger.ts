import { Prisma, prisma } from "@baolu/db";
import { readWallet, type WalletSnapshot } from "./sitong-wallet.js";

/**
 * 用户级「算力明细」（钱包流水）读取层。
 *
 * 为什么读 `WalletLedger` 而不是 `CreditTransaction`：货架的展示（`/market/me`）与扣费
 * 走的是**用户级双桶钱包**，`CreditTransaction` 是租户级旧账本。明细如果读旧账本，
 * 用户会看到「余额 100、明细 0 笔」这种对不上的页面（2026-09-30 全站审计已标记）。
 * 所以这里与余额同源。
 *
 * 2026-09-30（用户）：「算力明细」改成右侧抽屉，要能**分类 / 搜索 / 分页**。分类按
 * `type` 落到 SQL（计数走 `count()`，不吃全表）；搜索因为要让中文关键词（「签到」
 * 「开通礼」）也能命中，改在服务层对已翻译过的 label/detail 做过滤（最多取 300 条，
 * 个人钱包规模足够）。未带搜索词时走 SQL 分页。
 */

export type CreditLedgerBucket = "paid" | "bonus";

/** 明细分类（前端分类页签直接渲染这个 key，不要再自己翻译）。 */
export type CreditLedgerCategory = "all" | "recharge" | "gift" | "consume" | "refund";

export interface CreditLedgerEntry {
  id: string;
  createdAt: string;
  type: string;
  bucket: CreditLedgerBucket;
  /** in = 入账，out = 消耗，flat = 不产生金额变动的记录（重做）。 */
  direction: "in" | "out" | "flat";
  amount: number;
  /** 一句话说明（前端直接渲染，不再自己翻译 type）。 */
  label: string;
  /** 补充信息：智能体标识 / 订单号 / 来源。 */
  detail: string;
  expiresAt: string | null;
  expired: boolean;
  /** 该笔所属分类（供前端做「分类」页签与行内标签）。 */
  category: CreditLedgerCategory;
}

export interface CreditLedgerCategoryView {
  key: CreditLedgerCategory;
  label: string;
  count: number;
}

export interface CreditLedgerView {
  wallet: WalletSnapshot;
  entries: CreditLedgerEntry[];
  /** 分页信息（前端直接渲染「第 x / y 页 · 共 n 笔」）。 */
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** 当前分类与搜索词（回显用）。 */
  category: CreditLedgerCategory;
  query: string;
  categories: CreditLedgerCategoryView[];
  /** 赠送算力里「下一笔会过期」的时间（按先用最近到期的口径推算）；没有则 null。 */
  bonusExpiringAt: string | null;
  /** 赠送算力剩余可用（已扣掉过期与已消耗部分）。 */
  usableBonus: number;
  /** 已过期未核销的赠送算力（提示用户「有 N 算力已过期」）。 */
  expiredBonus: number;
}

export interface ReadCreditLedgerOptions {
  page?: number;
  pageSize?: number;
  category?: string | null;
  q?: string | null;
}

export const LEDGER_CATEGORY_LABELS: Array<{ key: CreditLedgerCategory; label: string }> = [
  { key: "all", label: "全部" },
  { key: "recharge", label: "充值" },
  { key: "gift", label: "赠送" },
  { key: "consume", label: "消耗" },
  { key: "refund", label: "退回" }
];

/** 分类 → SQL 条件。分类口径与「钱从哪来/去哪」对齐，不跟 type 字面一一对应。 */
function categoryWhere(category: CreditLedgerCategory): Prisma.WalletLedgerWhereInput {
  switch (category) {
    case "recharge":
      return { type: "recharge" };
    case "gift":
      return { type: { in: ["bonus", "admin"] } };
    case "consume":
      return { type: "consume" };
    case "refund":
      return { type: { in: ["refund", "redo"] } };
    default:
      return {};
  }
}

function categoryOf(type: string): CreditLedgerCategory {
  if (type === "recharge") return "recharge";
  if (type === "bonus" || type === "admin") return "gift";
  if (type === "consume") return "consume";
  if (type === "refund" || type === "redo") return "refund";
  return "all";
}

export function normalizeLedgerCategory(raw: string | null | undefined): CreditLedgerCategory {
  const value = String(raw ?? "").trim();
  const found = LEDGER_CATEGORY_LABELS.find((item) => item.key === value);
  return found ? found.key : "all";
}

/** 来源 → 中文说明。签到的来源串在 `daily-signin.ts`，这里只做展示映射。 */
function describeSource(source: string | null): string {
  const value = (source ?? "").trim();
  if (!value) return "";
  if (value === "signup_gift") return "新用户开通礼";
  if (value === "signup") return "新用户注册礼";
  if (value === "daily_signin") return "每日签到";
  if (value === "recharge") return "充值加赠";
  if (value.startsWith("referral") || value.includes("referral")) return "邀请奖励";
  if (value.startsWith("admin")) return "人工发放";
  if (value.startsWith("settle") || value.includes("refund")) return "预扣差额退回";
  return value;
}

function labelOf(entry: { type: string; bucket: string; source: string | null; skillId: string | null }): {
  label: string;
  detail: string;
} {
  const source = describeSource(entry.source);
  switch (entry.type) {
    case "recharge":
      return { label: "充值到账", detail: entry.bucket === "bonus" ? "充值加赠 · 赠送性质" : "实付充值 · 长期有效" };
    case "bonus":
      return { label: source && source !== "recharge" ? source : "赠送到账", detail: "赠送算力 · 限自营文字类智能体" };
    case "admin":
      return { label: source || "人工发放", detail: "运营发放" };
    case "consume":
      return { label: "智能体消耗", detail: entry.skillId ?? "智能体" };
    case "refund":
      return { label: "退回", detail: source || "预扣差额退回" };
    case "redo":
      return { label: "免费重做", detail: entry.skillId ?? "不扣算力" };
    default:
      return { label: entry.type, detail: source };
  }
}

type LedgerRow = {
  id: string;
  createdAt: Date;
  type: string;
  bucket: string;
  delta: number;
  source: string | null;
  skillId: string | null;
  expiresAt: Date | null;
};

function mapRow(row: LedgerRow, now: number): CreditLedgerEntry {
  const { label, detail } = labelOf({
    type: row.type,
    bucket: row.bucket,
    source: row.source ?? null,
    skillId: row.skillId ?? null
  });
  const direction = row.delta > 0 ? "in" : row.delta < 0 ? "out" : "flat";
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    type: row.type,
    bucket: row.bucket === "paid" ? "paid" : "bonus",
    direction,
    amount: Math.abs(row.delta),
    label,
    detail,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: Boolean(row.expiresAt && row.expiresAt.getTime() <= now),
    category: categoryOf(row.type)
  };
}

const LEDGER_SELECT = {
  id: true,
  createdAt: true,
  type: true,
  bucket: true,
  delta: true,
  source: true,
  skillId: true,
  expiresAt: true
} as const;

/** 搜索只在服务层对「翻译后的中文」做匹配，所以最多扫这么多条（个人钱包规模足够）。 */
const SEARCH_SCAN_LIMIT = 300;

export async function readCreditLedger(userId: string, options: ReadCreditLedgerOptions = {}): Promise<CreditLedgerView> {
  const pageSize = Math.max(1, Math.min(Math.trunc(Number(options.pageSize) || 8), 50));
  const page = Math.max(1, Math.trunc(Number(options.page) || 1));
  const category = normalizeLedgerCategory(options.category);
  const query = String(options.q ?? "").trim();
  const now = Date.now();

  const [wallet, totalUnfiltered, categoryCounts] = await Promise.all([
    readWallet(userId),
    prisma.walletLedger.count({ where: { userId } }),
    Promise.all(
      LEDGER_CATEGORY_LABELS.map(async (item) => ({
        ...item,
        count: await prisma.walletLedger.count({ where: { userId, ...categoryWhere(item.key) } })
      }))
    )
  ]);

  // 过期与可用赠送：与扣费侧同一口径（`consumeWalletCredits` 也是按 expiresAt 聚合过期量）。
  const allBonus = await prisma.walletLedger.findMany({
    where: { userId, bucket: "bonus", type: { in: ["bonus", "admin"] } },
    select: { delta: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });
  const expiredBonus = allBonus.reduce(
    (sum, row) => (row.expiresAt && row.expiresAt.getTime() <= now ? sum + Math.max(0, row.delta) : sum),
    0
  );
  const usableBonus = Math.max(0, wallet.bonusBalance - expiredBonus);

  // 「下一笔会过期的时间」：按「到期日最近者优先」扣减的口径，模拟扣掉已消耗部分。
  const grantedBonus = allBonus.reduce((sum, row) => sum + Math.max(0, row.delta), 0);
  let consumedBudget = Math.max(0, grantedBonus - wallet.bonusBalance);
  const lots = allBonus
    .filter((row) => row.expiresAt)
    .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0));
  let bonusExpiringAt: string | null = null;
  for (const lot of lots) {
    const delta = Math.max(0, lot.delta);
    if (consumedBudget >= delta) {
      consumedBudget -= delta;
      continue;
    }
    bonusExpiringAt = lot.expiresAt?.toISOString() ?? null;
    break;
  }

  const where = { userId, ...categoryWhere(category) };

  let entries: CreditLedgerEntry[];
  let total: number;

  if (query) {
    // 带搜索词：取最近 300 条 → 翻译成中文 → 在中文上过滤（「签到」「开通礼」这类词
    // 在 source 里是英文串，SQL 直搜搜不到，用户会以为明细丢了）。
    const rows = (await prisma.walletLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SEARCH_SCAN_LIMIT,
      select: LEDGER_SELECT
    })) as LedgerRow[];
    const mapped = rows.map((row) => mapRow(row, now));
    const needle = query.toLowerCase();
    const hit = mapped.filter((item) =>
      `${item.label} ${item.detail} ${item.type}`.toLowerCase().includes(needle)
    );
    total = hit.length;
    entries = hit.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const [count, rows] = await Promise.all([
      prisma.walletLedger.count({ where }),
      prisma.walletLedger.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: LEDGER_SELECT
      })
    ]);
    total = count;
    entries = (rows as LedgerRow[]).map((row) => mapRow(row, now));
  }

  return {
    wallet,
    entries,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    category,
    query,
    categories: categoryCounts.map((item) => ({
      key: item.key,
      label: item.label,
      count: item.key === "all" ? totalUnfiltered : item.count
    })),
    bonusExpiringAt,
    usableBonus,
    expiredBonus
  };
}
