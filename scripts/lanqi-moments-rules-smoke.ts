import {
  MOMENTS_RULES_VERSION,
  PILLARS,
  FAST_GOALS,
  diagnosticIssues,
  scoreOf,
  upgradedScore,
  missingRequired,
  fastGate,
  publishCheck,
  structureGate,
  containsBanWords,
  containsAbsWords
} from "../apps/api/src/products/beauty-industry/moments-rules.js";

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

// 1. 七柱配置完整性
assert("七柱共 7 类", Object.keys(PILLARS).length === 7);
assert("工作现场占比 35%", PILLARS.work.pct === 35);
assert("工作现场必填含门店名称+今天", PILLARS.work.required.some((f) => f.key === "storeName") && PILLARS.work.required.some((f) => f.key === "today"));
assert("客户问题必填 3 项", PILLARS.problem.required.length === 3);

// 2. 快速五目标齐全
assert("五目标齐全", Object.keys(FAST_GOALS).length === 5);

// 3. 快速门禁
assert("快速原话为空被拒", fastGate("") !== null);
assert("快速原话 <15 字被拒", fastGate("今天店里来了个客人") !== null);
assert("快速原话 ≥15 字通过", fastGate("今天店里来了个客人，做了个深层清洁，她说皮肤亮了不少。") === null);

// 4. 短内容诊断
const short = "今天店里来了个客人做完脸走了";
const shortIssues = diagnosticIssues(short);
assert("短内容被诊断有内容太短", shortIssues.some((i) => i.t === "内容太短"));

// 5. 评分范围与提升
const raw = "今天店里做了 8 单。新来的小姐姐做完深度清洁，说皮肤亮了一个度，当场约了下个月。姐妹们皮肤有困扰的，到店我手把手教。";
const issues = diagnosticIssues(raw);
const score = scoreOf(raw, issues);
assert("评分在 30-80", score >= 30 && score <= 80);
assert("轻改 +18", upgradedScore(score, "light") === Math.min(96, score + 18));
assert("深改 +36", upgradedScore(score, "deep") === Math.min(96, score + 36));

// 6. 必填校验
assert("工作现场缺 today 报缺失", missingRequired("work", { storeName: "本店" }).length === 1);
assert("工作现场齐全 0 缺失", missingRequired("work", { storeName: "本店", today: "做了清洁" }).length === 0);

// 7. 合规：引导词 / 绝对化
assert("ban 含私信", containsBanWords("想参加的私信我").some((x) => x.word === "私信"));
assert("ban 含加我", containsBanWords("加我微信").some((x) => x.word === "加我"));
assert("abs 含根治", containsAbsWords("这个能根治").some((x) => x.word === "根治"));
assert("第一次不算绝对化词", containsAbsWords("新客第一次来只要98元").length === 0);
assert("全城第一算绝对化词", containsAbsWords("技术全城第一").some((x) => x.word === "第一"));
// 复盘回归：序数用法曾被误判成绝对化词，导致正常运营话术过不了门禁
assert("第一周不算绝对化词", containsAbsWords("第一周先把承接页修好").length === 0);
assert("第一句话不算绝对化词", containsAbsWords("开场第一句话就报城市和项目").length === 0);
assert("第一步不算绝对化词", containsAbsWords("第一步先把转化差的计划停掉").length === 0);
assert("第一时间不算绝对化词", containsAbsWords("留资后第一时间回访").length === 0);
assert("第一品牌仍算绝对化词", containsAbsWords("本地第一品牌").some((x) => x.word === "第一"));
assert("销量第一仍算绝对化词", containsAbsWords("销量第一靠的是口碑").some((x) => x.word === "第一"));
// 复盘回归（0909 直播 422）：模型把流程写成「第一部分/第二部分」，被当成绝对化词拦下整批
assert("第一部分不算绝对化词", containsAbsWords("今天分五部分讲，第一部分讲流程").length === 0);
assert("第一场不算绝对化词", containsAbsWords("第一场直播先讲流程").length === 0);
assert("第一款不算绝对化词", containsAbsWords("第一款套餐适合新客").length === 0);
assert("第一节课不算绝对化词", containsAbsWords("第一节课先教基础手法").length === 0);
assert("技术全城第一仍算绝对化词", containsAbsWords("技术全城第一").some((x) => x.word === "第一"));
assert("我们店第一仍算绝对化词", containsAbsWords("我们店第一，别家比不了").some((x) => x.word === "第一"));
// 复盘回归（0909 AI 顾问整段被拦）：门店让模型写「不要这样做」时，模型会把违规词原样复述出来
assert("劝阻语境复述不算违规引导", containsBanWords("不引导加微信，只引导到店或下单团购").length === 0);
assert("平台内回复消息不算导流", containsBanWords("固定一人每天回复评论和私信，只回复到店时间与价格").length === 0);
assert("渠道并列描述不算导流", containsBanWords("对营业时间、价格、能否预约的评论或私信，直接回复具体信息").length === 0);
assert("劝阻语境复述特效不算疗效词", containsAbsWords("不用特效滤镜，拍门店真实操作过程").length === 0);
assert("私信我仍算违规引导", containsBanWords("有需要的姐妹私信我").some((x) => x.word === "私信"));
assert("加微信仍算违规引导", containsBanWords("想参加的加微信找我").some((x) => x.word === "加微信"));
assert("特效级效果仍算疗效词", containsAbsWords("做完就是特效级效果").some((x) => x.word === "特效"));
assert("隔句否定仍算违规引导", containsBanWords("别家都没有，私信我").some((x) => x.word === "私信"));
assert("否定＋无关词仍算违规引导", containsBanWords("不管怎样私信我领取").some((x) => x.word === "私信"));
assert("合规文案不触发 ban", containsBanWords("想参加的姐妹，到店提一句就行").length === 0);

// 8. 发布前检查
const okBody = "今天店里做了 8 单，新客皮肤亮了。姐妹们到店体验一下。";
const checksOk = publishCheck(okBody);
assert("合规正文无违规引导", checksOk.find((c) => c.label === "违规引导词")?.ok === true);
assert("无数字正文数字项 warn", publishCheck("今天店里来了客人，皮肤不错。到店看看。").find((c) => c.label === "有具体数字")?.ok === false);
assert("含【待你补一句】强制数字 warn", publishCheck("今天来了客人【待你补一句】到店看看。").find((c) => c.label === "有具体数字")?.ok === false);

// 9. 结构门禁
assert("deep 正文过短被拦", structureGate("太短了", "deep").pass === false);
assert("空正文被拦", structureGate("", "std").pass === false);
assert("正常正文通过", structureGate("今天店里做了 8 单，到店体验。", "std").pass === true);

console.log(`\n${MOMENTS_RULES_VERSION} -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
