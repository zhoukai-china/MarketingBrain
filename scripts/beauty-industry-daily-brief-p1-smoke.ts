import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
  BEAUTY_DAILY_BRIEF_SECTIONS,
  beautyDailyBriefUniqueKey,
  canClaimBeautyDailyBriefLease,
  composeBeautyDailyBriefReport,
  decideBeautyDailyBriefSchedule,
  interruptedBeautyDailyBriefStatus,
  selectBeautyDailyBriefSources,
  validateBeautyDailyBriefReport
} from "../apps/api/src/products/beauty-industry/daily-brief-contract.js";
import {
  buildControlledBeautyDailyBriefSources,
  controlledBeautyDailyBriefAction,
  controlledBeautyDailyBriefTrends
} from "../apps/api/src/products/beauty-industry/daily-brief-fixtures.js";

async function main() {
  const [shell, productRoute, productPage, genericService, genericPage] = await Promise.all([
    readFile("apps/web/src/components/beauty-industry/BeautyIndustryShell.tsx", "utf8"),
    readFile("apps/api/src/routes/beauty-industry.ts", "utf8"),
    readFile("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8"),
    readFile("apps/api/src/services/daily-brief.ts", "utf8"),
    readFile("apps/web/src/components/diagnosis/DailyView.tsx", "utf8")
  ]);

  assert.doesNotMatch(shell, /美业AI改造日报/, "美业日报仍使用旧规划名称");
  assert.match(productRoute, /beauty-industry\/daily-brief/, "美业产品 entitlement 内缺少日报稳定 API");
  assert.match(productPage, /BeautyIndustryDailyBrief/, "规划页尚未升级为美业日报专属页面");
  assert.match(productRoute, /beauty_daily_brief/, "美业日报没有固定 capability");
  assert.match(productRoute, /Asia\/Shanghai/, "美业日报没有北京时间业务日合同");
  assert.doesNotMatch(productRoute, /run-scheduler/, "美业日报不得复制通用未鉴权 scheduler 路由");
  assert.match(genericService, /FALLBACK_LIBRARY/, "基线漂移：通用日报静态 fallback 已不存在");
  assert.match(genericPage, /buildFallbackDailyBriefReport/, "基线漂移：通用页面离线日报已不存在");

  const at0859 = decideBeautyDailyBriefSchedule({ now: new Date("2026-08-26T00:59:00Z"), hasSucceeded: false, hasActiveTask: false });
  assert.equal(at0859.shouldEnqueue, false);
  assert.equal(at0859.reason, "before_schedule");
  const at0900 = decideBeautyDailyBriefSchedule({ now: new Date("2026-08-26T01:00:00Z"), hasSucceeded: false, hasActiveTask: false });
  assert.equal(at0900.shouldEnqueue, true);
  assert.equal(at0900.trigger, "scheduled");
  const at0901 = decideBeautyDailyBriefSchedule({ now: new Date("2026-08-26T01:01:00Z"), hasSucceeded: false, hasActiveTask: false });
  assert.equal(at0901.shouldEnqueue, true);
  assert.equal(at0901.trigger, "catchup");
  assert.equal(decideBeautyDailyBriefSchedule({ now: new Date("2026-08-26T01:01:00Z"), hasSucceeded: true, hasActiveTask: false }).reason, "already_succeeded");
  assert.equal(decideBeautyDailyBriefSchedule({ now: new Date("2026-08-26T01:01:00Z"), hasSucceeded: false, hasActiveTask: true }).reason, "already_active");
  assert.equal(decideBeautyDailyBriefSchedule({ now: new Date("2026-12-31T16:30:00Z"), hasSucceeded: false, hasActiveTask: false }).businessDate, "2027-01-01");
  assert.equal(decideBeautyDailyBriefSchedule({ now: new Date("2028-02-29T01:00:00Z"), hasSucceeded: false, hasActiveTask: false }).businessDate, "2028-02-29");
  assert.equal(beautyDailyBriefUniqueKey("2026-08-26"), `beauty-industry:2026-08-26:${BEAUTY_DAILY_BRIEF_CONTRACT_VERSION}`);
  assert.equal(canClaimBeautyDailyBriefLease({ status: "queued", providerCallCount: 0 }), true);
  assert.equal(canClaimBeautyDailyBriefLease({ status: "collecting_sources", leaseExpiresAt: new Date("2026-08-26T00:59:00Z"), providerCallCount: 0, now: new Date("2026-08-26T01:00:00Z") }), true);
  assert.equal(canClaimBeautyDailyBriefLease({ status: "generating", leaseExpiresAt: new Date("2026-08-26T00:59:00Z"), providerCallCount: 1, now: new Date("2026-08-26T01:00:00Z") }), false);
  assert.equal(interruptedBeautyDailyBriefStatus(0), "queued");
  assert.equal(interruptedBeautyDailyBriefStatus(1), "terminal_unknown");

  const cutoffAt = new Date("2026-08-26T01:00:00Z");
  const sources24 = buildControlledBeautyDailyBriefSources(cutoffAt);
  const selected24 = selectBeautyDailyBriefSources({ candidates: sources24, cutoffAt, runtimeMode: "controlled_mock" });
  assert.equal(selected24.ok, true, selected24.ok ? undefined : selected24.issues.join(","));
  if (!selected24.ok) throw new Error("expected selected sources");
  assert.equal(selected24.sourceWindowHours, 24);
  assert.equal(selected24.items.length, 15);
  assert.deepEqual(BEAUTY_DAILY_BRIEF_SECTIONS.map((section) => selected24.items.filter((item) => item.section === section).length), [3, 3, 3, 3, 3]);
  const report = composeBeautyDailyBriefReport({ items: selected24.items, businessDate: "2026-08-26", cutoffAt, now: new Date("2026-08-26T01:00:02Z"), trigger: "scheduled", runtimeMode: "controlled_mock", sourceWindowHours: 24, trends: controlledBeautyDailyBriefTrends(), todayAction: controlledBeautyDailyBriefAction() });
  assert.deepEqual(validateBeautyDailyBriefReport(report), []);
  assert.match(report.controlledNotice ?? "", /测试.*非实时资讯/);

  const sources72 = buildControlledBeautyDailyBriefSources(cutoffAt, [2, 5, 30]);
  const selected72 = selectBeautyDailyBriefSources({ candidates: sources72, cutoffAt, runtimeMode: "controlled_mock" });
  assert.equal(selected72.ok, true);
  if (!selected72.ok) throw new Error("expected 72-hour expansion");
  assert.equal(selected72.sourceWindowHours, 72);

  const assertRejected = (mutate: (sources: ReturnType<typeof buildControlledBeautyDailyBriefSources>) => void, issue: RegExp) => {
    const sources = buildControlledBeautyDailyBriefSources(cutoffAt);
    mutate(sources);
    const selected = selectBeautyDailyBriefSources({ candidates: sources, cutoffAt, runtimeMode: "controlled_mock" });
    assert.equal(selected.ok, false);
    if (selected.ok) throw new Error("expected source rejection");
    assert.match(selected.issues.join("|"), issue);
  };
  assertRejected((sources) => { sources[0].sourceUrl = "not-a-url"; }, /source_url_invalid/);
  assertRejected((sources) => { sources[0].reachable = false; }, /source_unreachable/);
  assertRejected((sources) => { sources[0].publishedAt = new Date(cutoffAt.getTime() - 73 * 3_600_000).toISOString(); }, /source_older_than_72h/);
  assertRejected((sources) => { sources[0].summary = `${sources[0].summary} 餐饮外卖`; }, /foreign_or_internal_pollution/);
  assertRejected((sources) => { sources[0].sitongComment = `${sources[0].sitongComment} 保证治愈`; }, /compliance_claim_forbidden/);
  assertRejected((sources) => { sources[0].sourceUrl = sources[1].sourceUrl; }, /source_insufficient|^$/);
  const insufficient = selectBeautyDailyBriefSources({ candidates: sources24.slice(0, 14), cutoffAt, runtimeMode: "controlled_mock" });
  assert.equal(insufficient.ok, false, "72小时仍不足15条时不得凑数");

  console.log("beauty industry daily brief P1 smoke passed");
}

void main();
