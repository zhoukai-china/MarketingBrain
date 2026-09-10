// 公域获客 · 直播逐字稿规则层冒烟（确定性，不调用真实 Provider）
// 契约来源：demo `live.html`（活规范）
import {
  LIVE_BATCHES,
  LIVE_FILLER_CATEGORIES,
  LIVE_FILLER_PER_CATEGORY,
  LIVE_PLANNED_MINUTES,
  LIVE_ROUNDS,
  LIVE_SEGMENTS,
  LIVE_SERVICE_VERSION,
  LIVE_WORDS_PER_MINUTE,
  buildLiveBatches,
  buildLivePlan,
  countLiveWords,
  liveLinkWord,
  liveStats,
  validateLiveInput,
  type LiveInput
} from "../apps/api/src/products/beauty-industry/live-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

function throws(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const baseInput: LiveInput = {
  storeId: "store_1",
  host: "美肌研 · 创始人晓曼",
  carries: ["团购券", "居家产品"],
  main: "水光深层补水",
  sell: "做完当天就能上妆，不闷痘",
  price: "团购价参考 199",
  card: "储值 2000 送 300",
  platforms: ["抖音"]
};

function main() {
  // 1. 版本与口径常量
  assert("服务版本已声明", LIVE_SERVICE_VERSION === "lanqi_live_service_v1");
  assert("口播速度 200 字/分钟", LIVE_WORDS_PER_MINUTE === 200);
  assert("计划时长 120 分钟", LIVE_PLANNED_MINUTES === 120);

  // 2. 5 组轮次
  assert("轮次正好 5 组", LIVE_ROUNDS.length === 5);
  assert("轮次号连续 0-4", LIVE_ROUNDS.every((round, index) => round.no === index));
  assert("开场时段 0:00–0:10", LIVE_ROUNDS[0].time === "0:00–0:10");
  assert("收尾时段 1:49–2:00", LIVE_ROUNDS[4].time === "1:49–2:00");
  assert("每组都有目标", LIVE_ROUNDS.every((round) => Boolean(round.goal)));

  // 3. 23 段骨架
  assert("段落正好 23 段", LIVE_SEGMENTS.length === 23);
  assert("段号连续 1-23", LIVE_SEGMENTS.every((seg, index) => seg.no === index + 1));
  assert("每段归属存在的轮次", LIVE_SEGMENTS.every((seg) => LIVE_ROUNDS.some((round) => round.no === seg.round)));
  assert("每段都有主题与分钟数", LIVE_SEGMENTS.every((seg) => Boolean(seg.theme) && seg.mins > 0));
  assert(
    "23 段总时长正好 120 分钟",
    LIVE_SEGMENTS.reduce((sum, seg) => sum + seg.mins, 0) === LIVE_PLANNED_MINUTES
  );
  assert("每段都带时间段", LIVE_SEGMENTS.every((seg) => /^\d+:\d{2}–\d+:\d{2}$/.test(seg.time)));
  const firstOfRound = LIVE_SEGMENTS[0];
  const lastOfRound = LIVE_SEGMENTS[LIVE_SEGMENTS.length - 1];
  assert("首段从 0:00 开始", firstOfRound.time.startsWith("0:00–"));
  assert("末段到 2:00 结束", lastOfRound.time.endsWith("–2:00"));

  // 4. 分批：同一轮内连续合批，单批 ≤2 段且 ≤8 分钟（控制单请求输出体量）
  assert("分批结果为 19 批", LIVE_BATCHES.length === 19);
  assert("批次号连续", LIVE_BATCHES.every((batch, index) => batch.no === index + 1));
  assert("每批最多 2 段", LIVE_BATCHES.every((batch) => batch.segNos.length >= 1 && batch.segNos.length <= 2));
  assert("每批最多 8 分钟", LIVE_BATCHES.every((batch) => batch.totalMins <= 8));
  assert("每批不跨轮次", LIVE_BATCHES.every((batch) => {
    const segs = batch.segNos.map((no) => LIVE_SEGMENTS.find((seg) => seg.no === no)!);
    return segs.every((seg) => seg.round === batch.round);
  }));
  assert("每批段号连续", LIVE_BATCHES.every((batch) =>
    batch.segNos.every((no, index) => index === 0 || no === batch.segNos[index - 1] + 1)
  ));
  assert("每批字数目标 = 分钟 × 200", LIVE_BATCHES.every((batch) => batch.targetWords === batch.totalMins * LIVE_WORDS_PER_MINUTE));
  assert("全部 23 段都被分到批次里", LIVE_BATCHES.flatMap((batch) => batch.segNos).length === 23);
  assert(
    "各批分钟合计 = 120",
    LIVE_BATCHES.reduce((sum, batch) => sum + batch.totalMins, 0) === LIVE_PLANNED_MINUTES
  );
  assert("每次调用分批结果一致", JSON.stringify(buildLiveBatches()) === JSON.stringify(LIVE_BATCHES));

  // 5. 救场话术库：5 类 × 6 条
  assert("救场库 5 类", LIVE_FILLER_CATEGORIES.length === 5);
  assert("救场库每类 6 条", LIVE_FILLER_PER_CATEGORY === 6);
  assert("救场库类别不重复", new Set(LIVE_FILLER_CATEGORIES).size === 5);

  // 6. 字数口径：去掉 [方括号] 舞台提示与空白
  assert("方括号提示不计字数", countLiveWords("[停顿]大家好") === 3);
  assert("空白不计字数", countLiveWords("大家 好 呀") === "大家好呀".length);
  assert("空串为 0", countLiveWords("") === 0);

  // 7. 下单引导词跟随平台
  assert("抖音说小黄车", liveLinkWord(["抖音"]) === "小黄车");
  assert("视频号说视频号小店", liveLinkWord(["视频号"]) === "视频号小店");
  assert("双平台优先小黄车", liveLinkWord(["抖音", "视频号"]) === "小黄车");
  assert("都没有时兜底购物车", liveLinkWord([]) === "购物车");

  // 8. 输入门禁
  assert("齐全输入无缺失", validateLiveInput(baseInput).length === 0);
  assert("缺主播报缺失", validateLiveInput({ ...baseInput, host: "  " }).includes("店名 / 主播身份"));
  assert("缺主打项目报缺失", validateLiveInput({ ...baseInput, main: "" }).includes("主打项目 / 产品名"));
  assert("缺卖点报缺失", validateLiveInput({ ...baseInput, sell: "" }).includes("真实卖点"));
  assert("缺带货标的报缺失", validateLiveInput({ ...baseInput, carries: [] }).includes("带货标的"));
  assert("缺平台报缺失", validateLiveInput({ ...baseInput, platforms: [] }).includes("平台"));

  // 9. 计划输出（纯规则，不调模型）
  const plan = buildLivePlan(baseInput);
  assert("计划带 5 组轮次", plan.rounds.length === 5);
  assert("计划带 23 段骨架", plan.segments.length === 23);
  assert("计划带全部批次", plan.batches.length === LIVE_BATCHES.length);
  assert("计划带下单引导词", plan.linkWord === "小黄车");
  assert("计划时长 120", plan.plannedMinutes === 120);
  assert("计划带服务版本", plan.serviceVersion === LIVE_SERVICE_VERSION);
  assert("骨架段不带正文（正文由模型填）", !("script" in plan.segments[0]));
  const planThrows = throws(() => buildLivePlan({ ...baseInput, platforms: [] }));
  assert("输入不全时计划拒绝", (planThrows ?? "").includes("还差必填"));

  // 10. 统计口径：可撑分钟 = 全部字数 / 200
  const stats = liveStats(
    [
      { script: "今天讲一讲补水这件事", fill: ["再补一句", "还有一句"], mins: 4 },
      { script: "第二段继续讲", fill: [], mins: 3 }
    ],
    [{ cat: LIVE_FILLER_CATEGORIES[0], items: ["救场一句"] }]
  );
  const expectedWords = countLiveWords("今天讲一讲补水这件事") + countLiveWords("第二段继续讲");
  const expectedFill = countLiveWords("再补一句") + countLiveWords("还有一句");
  assert("段落数正确", stats.segments === 2);
  assert("口播字数只算 script", stats.words === expectedWords);
  assert("备用话术字数单算", stats.fillWords === expectedFill);
  assert("救场库字数单算", stats.poolWords === countLiveWords("救场一句"));
  assert("总字数 = 三项之和", stats.total === expectedWords + expectedFill + countLiveWords("救场一句"));
  assert("可撑分钟按 200 字/分钟取整", stats.estMinAll === Math.round(stats.total / 200));
  assert("计划时长固定 120", stats.plannedMinutes === 120);
  assert("已排分钟数按段落累加", stats.mins === 7);

  console.log(`\nlive-rules: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
