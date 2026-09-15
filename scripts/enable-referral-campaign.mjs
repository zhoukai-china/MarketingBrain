/**
 * 推荐有礼「启动/关闭」开关脚本（PLAT-28 第②批）。
 *
 * 用户 2026-09-16 口径：被推荐人 100 + 推荐人 100；活动窗**暂定 2026-10-01 ~ 2026-10-07**。
 * 活动窗是**左闭右开**：开始 2026-10-01T00:00:00+08:00，结束要写 **2026-10-08T00:00:00+08:00**
 * （这样 10-07 全天在内、10-08 00:00 起不再发奖）。
 *
 * 用法（默认**只预览不写**，看到 diff 再决定）：
 *   node scripts/enable-referral-campaign.mjs                        # 预览
 *   node scripts/enable-referral-campaign.mjs --apply                # 按默认口径启用
 *   node scripts/enable-referral-campaign.mjs --apply --start 2026-10-01T00:00:00+08:00 --end 2026-10-08T00:00:00+08:00
 *   node scripts/enable-referral-campaign.mjs --apply --disable      # 关闭（回滚：只关开关，窗口留着）
 *
 * 目标库由 `DATABASE_URL` 决定（本地 / 测试实例用 lanqi_test schema / 生产 public schema）。
 * 只写 PlatformSetting（后台配置位），不动代码、不动钱包、不发任何分润。
 */
import "dotenv/config";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const apply = hasFlag("--apply");
const disable = hasFlag("--disable");
const startsAt = valueOf("--start", "2026-10-01T00:00:00+08:00");
const endsAt = valueOf("--end", "2026-10-08T00:00:00+08:00");

const planned = [
  ["REFERRAL_REWARD_ENABLED", !disable],
  ["REFERRAL_CAMPAIGN_STARTS_AT", disable ? null : startsAt],
  ["REFERRAL_CAMPAIGN_ENDS_AT", disable ? null : endsAt],
  ["REFERRAL_NEW_USER_CREDITS", 100],
  ["REFERRAL_REFERRER_FIRST_USE_CREDITS", 100],
  ["REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS", 0],
  ["REFERRAL_REWARD_VALID_DAYS", 90],
  ["REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS", 20000]
];

function assertIso(label, value) {
  if (value === null) return;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} 不是合法 ISO 8601 时间：${value}`);
  if (!/[+-]\d{2}:\d{2}$|Z$/.test(value)) throw new Error(`${label} 必须带时区（例如 +08:00）：${value}`);
}

assertIso("--start", startsAt);
assertIso("--end", endsAt);
if (!disable && Date.parse(startsAt) >= Date.parse(endsAt)) {
  throw new Error(`活动窗倒挂：start(${startsAt}) 必须早于 end(${endsAt})`);
}

const existing = await prisma.platformSetting.findMany({ where: { key: { in: planned.map(([key]) => key) } } });
const before = new Map(existing.map((row) => [row.key, row.value]));

console.log("== 推荐有礼活动配置 ==");
console.log(`${apply ? "模式：写入（--apply）" : "模式：预览（不写；加 --apply 才生效）"}${disable ? " · 关闭" : ""}`);
console.log("口径：被推荐人 100 / 推荐人 100 / 首充段 0；奖励进 bonus 桶、90 天有效、只能用于文字类智能体");
if (!disable) console.log(`活动窗（左闭右开）：${startsAt} → ${endsAt}（含 10-07 全天）`);
for (const [key, next] of planned) {
  const prev = before.has(key) ? JSON.stringify(before.get(key)) : "（未设置 → 用 env 默认值）";
  console.log(`  ${key}\n    现状：${prev}\n    目标：${JSON.stringify(next)}`);
}

if (!apply) {
  console.log("\n预览结束：没有写入任何东西。确认无误后加 `--apply` 再跑一次。");
  await prisma.$disconnect();
  process.exit(0);
}

for (const [key, value] of planned) {
  await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

const after = await prisma.platformSetting.findMany({ where: { key: { in: planned.map(([key]) => key) } } });
const view = new Map(after.map((row) => [row.key, row.value]));
const mismatched = planned.filter(([key, value]) => JSON.stringify(view.get(key) ?? null) !== JSON.stringify(value ?? null));
console.log("\n== 写入后复核 ==");
for (const [key] of planned) console.log(`  ${key} = ${JSON.stringify(view.get(key))}`);
console.log(mismatched.length === 0 ? "写入复核通过（6/8 项与目标一致）".replace("6/8", `${planned.length}/${planned.length}`) : `写入复核不一致：${mismatched.map(([key]) => key).join(", ")}`);

if (disable) {
  console.log("\n已关闭：接口不再发奖（窗口值保留，便于下次直接启用）。");
} else {
  console.log("\n已启用：活动窗内「绑定 / 首次真实使用 / 首次充值」三件事都会按上表发奖；窗外一律不发。");
  console.log("提示：生效无需重启服务（发奖时每次重新读配置位）。");
}

await prisma.$disconnect();
