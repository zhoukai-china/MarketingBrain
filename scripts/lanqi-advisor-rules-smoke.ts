// 公域获客 · AI 运营顾问确定性规则冒烟（不触达 DB / Provider）
import {
  ADVISOR_PLATFORMS,
  ADVISOR_PLATFORM_KEYS,
  ADVISOR_RULES_VERSION,
  ADVISOR_TOPICS,
  advisorGate,
  buildSources,
  detectPlatform,
  detectTopics,
  isAdvisorPlatform,
  mentionsForeignPlatform,
  normalizeSteps,
  platformAskBack,
  stepsAreUsable,
  stringList
} from "../apps/api/src/products/beauty-industry/advisor-rules.js";

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

// 1. 只覆盖 demo 的三个平台
assert("规则版本已声明", ADVISOR_RULES_VERSION === "advisor_rules_v1");
assert("只有抖音/视频号/美团三个平台", ADVISOR_PLATFORM_KEYS.length === 3);
assert("平台顺序与 demo 一致", ADVISOR_PLATFORM_KEYS.join(",") === "dy,sph,mt");
assert("平台中文名与 demo 一致", ADVISOR_PLATFORMS.dy.label === "抖音" && ADVISOR_PLATFORMS.sph.label === "视频号" && ADVISOR_PLATFORMS.mt.label === "美团");

// 2. 平台识别：与 demo methods.html detectPlatform 关键词逐条对齐
assert("识别抖音", detectPlatform("抖音投了本地推没转化") === "dy");
assert("识别抖加", detectPlatform("抖加怎么开") === "dy");
assert("识别同城口播", detectPlatform("同城口播号怎么做") === "dy");
assert("识别视频号", detectPlatform("视频号发了没人转") === "sph");
assert("识别朋友圈语境归视频号", detectPlatform("朋友圈联动怎么发") === "sph");
assert("识别美团", detectPlatform("美团星级掉了") === "mt");
assert("识别大众点评", detectPlatform("大众点评差评多") === "mt");
assert("识别团购", detectPlatform("团购利润被压") === "mt");
assert("识别不出平台返回 null", detectPlatform("新门店预算少，该从哪个平台开始？") === null);
assert("空问题不识别", detectPlatform("   ") === null);
assert("识别顺序：先抖音后美团", detectPlatform("抖音和美团团购哪个划算") === "dy");

// 3. 类型守卫
assert("isAdvisorPlatform 正向", isAdvisorPlatform("dy") && isAdvisorPlatform("sph") && isAdvisorPlatform("mt"));
assert("isAdvisorPlatform 拒绝 auto/未知", !isAdvisorPlatform("auto") && !isAdvisorPlatform("ks") && !isAdvisorPlatform(null));

// 4. 输入门禁
assert("空问题被拦下", (advisorGate("") ?? "").includes("请先描述"));
assert("过短问题被拦下", (advisorGate("怎么办") ?? "").includes("具体一点"));
assert("正常问题放行", advisorGate("视频号发了没人转，问题在哪？") === null);

// 5. demo 反问话术
assert("反问话术提到三个平台", /抖音/.test(platformAskBack()) && /视频号/.test(platformAskBack()) && /美团/.test(platformAskBack()));

// 6. 话题识别：6 类快捷问题都要能命中
assert("话题共 6 类", ADVISOR_TOPICS.length === 6);
const quick = [
  "新门店预算少，该从哪个平台开始？",
  "差评多、星级低，怎么救？",
  "没空拍视频，怎么持续获客）",
  "视频号发了没人转，问题在哪？",
  "抖音投了本地推没转化，怎么调？",
  "美团团购利润被压，怎么办？"
];
quick.forEach((question, index) => assert(`快捷问题 ${index + 1} 命中话题`, detectTopics(question).length > 0));
assert("差评命中评价话题", detectTopics("差评多、星级低，怎么救？").some((t) => t.key === "review"));
assert("没空拍视频命中持续产出话题", detectTopics("没空拍视频，怎么持续获客）").some((t) => t.key === "no-time"));
assert("没人转命中转发话题", detectTopics("视频号发了没人转").some((t) => t.key === "forward"));
assert("本地推命中投放话题", detectTopics("抖音投了本地推没转化").some((t) => t.key === "ads"));
assert("团购利润命中利润话题", detectTopics("美团团购利润被压").some((t) => t.key === "margin"));
assert("空文本不命中话题", detectTopics("").length === 0);

// 7. 结构收敛：3~5 条动作，每条要有可执行细节
const steps = normalizeSteps([
  { title: "先停投", detail: "先把转化差的计划暂停，避免继续消耗预算。" },
  { title: "重做前3秒", detail: "把城市和项目放进开场第一句话，只投有自然互动的素材。" },
  { title: "重挂团购", detail: "投流页换成低价体验团购，价格锚点要明显低于正价。" }
]);
assert("收敛成 3 条动作", steps.length === 3);
assert("3 条动作可用", stepsAreUsable(steps));
assert("少于 3 条不可用", !stepsAreUsable(steps.slice(0, 2)));
assert("细节过短不可用", !stepsAreUsable([{ title: "先停投", detail: "太短" }, ...steps.slice(1)]));
assert("最多收敛到 5 条", normalizeSteps(Array.from({ length: 9 }, (_, i) => ({ title: `动作${i}`, detail: "这是一条足够长的可执行动作说明文本。" }))).length === 5);
assert("非数组返回空", normalizeSteps("bad").length === 0);

// 8. 字符串列表与来源标签
assert("追问最多 3 条", stringList(["a", "b", "c", "d"], 3).length === 3);
assert("顿弃空字符串", stringList([" ", "真实问题"], 3).length === 1);
const topics = detectTopics("差评多、星级低，怎么救？");
const sources = buildSources([], topics, 3);
assert("模型没给来源时用话题标签补齐", sources.length > 0 && sources.length <= 3);
assert("来源去重", new Set(sources).size === sources.length);
assert("模型给了 3 条就用模型给的", buildSources(["甲", "乙", "丙"], topics, 3).join(",") === "甲,乙,丙");

// 9. 外平台拦截：不能把门店带向别的平台
assert("命中快手", mentionsForeignPlatform("可以试试快手") === "快手");
assert("命中小红书", mentionsForeignPlatform("发小红书笔记") === "小红书");
assert("干净文本返回 null", mentionsForeignPlatform("抖音投本地推，先修承接页") === null);

console.log(`\nadvisor-rules: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
