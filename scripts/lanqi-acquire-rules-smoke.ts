import {
  ACQUIRE_RULES_VERSION,
  OPENING_KEYS,
  OPENING_TITLES,
  SCORE_DIMS,
  VIDEO_GOALS,
  VIDEO_PURPOSES,
  buildScores,
  copywriterGate,
  draftStructureGate,
  inferPurpose,
  isAcquireInputRich,
  isVideoGoal,
  isVideoPurpose,
  placeholderFor,
  scoreRawDraft
} from "../apps/api/src/products/beauty-industry/acquire-rules.js";

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

// 1. 五维评分口径：满分合计 10，与 demo「为什么这样改」一致
assert("五维共 5 项", SCORE_DIMS.length === 5);
assert("满分合计 10", SCORE_DIMS.reduce((sum, d) => sum + d.max, 0) === 10);
assert("核心对象与代入感满分 3", SCORE_DIMS.find((d) => d.key === "audience")?.max === 3);
assert("行动号召满分 1", SCORE_DIMS.find((d) => d.key === "cta")?.max === 1);

// 2. 用途 / 目标枚举与类型守卫
assert("三种用途齐全", Object.keys(VIDEO_PURPOSES).length === 3);
assert("四种优化目标齐全", Object.keys(VIDEO_GOALS).length === 4);
assert("isVideoPurpose 正向", isVideoPurpose("deal") && isVideoPurpose("aware") && isVideoPurpose("exposure"));
assert("isVideoPurpose 拒绝 auto", isVideoPurpose("auto") === false);
assert("isVideoPurpose 拒绝非字符串", isVideoPurpose(3) === false);
assert("isVideoGoal 正向", isVideoGoal("all") && isVideoGoal("conversion"));
assert("isVideoGoal 拒绝未知值", isVideoGoal("viral") === false);

// 3. 三种开头与 demo 标题一致
assert("开头三类", OPENING_KEYS.length === 3 && OPENING_KEYS.join(",") === "hook,claim,scene");
assert("钩子提问标题", OPENING_TITLES.hook === "钩子提问");
assert("反直觉断言标题", OPENING_TITLES.claim === "反直觉断言");
assert("当下场景代入标题", OPENING_TITLES.scene === "当下场景代入");

// 4. 输入门禁
assert("空原稿被拒", copywriterGate("") !== null);
assert("纯空白被拒", copywriterGate("     ") !== null);
assert("undefined 被拒", copywriterGate(undefined) !== null);
assert("已贴原稿即通过门禁（短素材改走请补充分支）", copywriterGate("一二三四五六七八九") === null);
assert("demo 默认样例通过门禁", copywriterGate("写一个获客文案") === null);

// 5. 素材丰度：太虚要用户补，具体才改稿
assert("demo 默认短句判为不够", isAcquireInputRich("写一个获客文案") === false);
assert("含数字视为足够", isAcquireInputRich("这个月做到了 120 单。") === true);
assert("含美业具体项目视为足够", isAcquireInputRich("最近很多人来问皮肤管理项目怎么做") === true);
assert("长文本视为足够", isAcquireInputRich("我们店最近在做活动，想让更多的同城顾客知道我们店里有什么服务，并且愿意到店体验一下看看效果如何") === true);
assert("只有时间没有优惠仍不够", isAcquireInputRich("最近今天") === false);

// 6. 用途推断：用户没选时按原稿与目标判断
assert("目标为转化率时判成交型", inferPurpose("随便写点什么", "conversion") === "deal");
assert("目标为完播率时判曝光型", inferPurpose("随便写点什么", "completion") === "exposure");
assert("含到店/价格判成交型", inferPurpose("到店体验价 98 元") === "deal");
assert("含门店介绍判了解型", inferPurpose("介绍一下我们门店的服务项目") === "aware");
assert("无信号判曝光型", inferPurpose("今天天气不错") === "exposure");

// 7. 确定性评分：同一输入稳定、且不超过各维度满分
const rich = "姐妹们注意了，最近很多同城老板来问 AI 获客。今天教你 3 步：第一，用 AI 找出同城痛点；第二，把门店项目改成顾客听得懂的话；第三，到店体验时自然引导关注。";
const s1 = scoreRawDraft(rich);
const s2 = scoreRawDraft(rich);
assert("同一输入评分稳定", JSON.stringify(s1) === JSON.stringify(s2));
assert(
  "评分不超上限",
  SCORE_DIMS.every((d) => {
    const v = s1[d.key];
    return typeof v === "number" && v >= 0 && v <= d.max;
  })
);
assert("具体原稿行动号召命中", s1.cta === 1);

const thin = "随便写一句话吧";
const thinScore = scoreRawDraft(thin);
assert(
  "虚输入评分不超上限且信息量低",
  SCORE_DIMS.every((d) => thinScore[d.key] <= d.max) && thinScore.audience + thinScore.share + thinScore.scarcity <= 1
);

// 8. 合并模型评语时分数以规则为准，且夹取到 [0, max]
const mergedThin = buildScores(thin, {
  audience: { comment: "模型评语", advice: "模型建议" },
  cta: { comment: "  ", advice: "" }
});
assert("合并后仍是 5 项", mergedThin.length === 5);
assert(
  "分数以规则为准",
  mergedThin.every((m) => m.score === Math.max(0, Math.min(m.max, thinScore[m.key])))
);
assert("未满分的维度采用模型评语", mergedThin.find((m) => m.key === "audience")?.comment === "模型评语");
assert("空评语回落到默认文案", (mergedThin.find((m) => m.key === "cta")?.comment ?? "").length > 0);
assert("每条都有建议文案", mergedThin.every((m) => m.advice.length > 0));

const mergedRich = buildScores(rich, {
  audience: { comment: "模型说这一项有问题", advice: "模型建议：再多用口语词" }
});
const richAudience = mergedRich.find((m) => m.key === "audience");
assert("样本在核心对象维度确实拿满分", richAudience?.score === richAudience?.max);
assert("满分维度用系统正向评语，不出现自相矛盾", richAudience?.comment === "这一项原稿已经做得不错。");
assert("满分维度仍保留模型的改进建议", richAudience?.advice === "模型建议：再多用口语词");

// 9. 成稿结构门禁
assert("空成稿被拦", draftStructureGate("").pass === false);
assert("过短成稿被拦", draftStructureGate("太短了这一段").pass === false);
assert("单句长文被拦（无分段）", draftStructureGate("这是一句没有任何标点断句的特别特别特别特别特别特别特别特别特别长的正文内容").pass === false);
assert("两段成稿通过", draftStructureGate("你是不是也遇到过：发了 100 条私信没回音？\n\n今天教你 3 步，到店就能用。").pass === true);

// 10. 数字占位：模型不得编造数字
assert("原稿与成稿都无数字时提醒亲补", placeholderFor("今天来了客人", "今天来了客人，做完效果不错。") !== null);
assert("原稿有数字不提醒", placeholderFor("今天做到 8 单", "今天做到 8 单。") === null);
assert("成稿有数字不提醒", placeholderFor("今天来了客人", "今天来了 3 位客人。") === null);

console.log(`\n${ACQUIRE_RULES_VERSION} -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
