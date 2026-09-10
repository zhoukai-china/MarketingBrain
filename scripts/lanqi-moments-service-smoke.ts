import { MOMENTS_SERVICE_VERSION, upgradeMoments, validateStoreScope, isInputRich, type MomentsUpgradeInput } from "../apps/api/src/products/beauty-industry/moments-service.js";

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

const base: MomentsUpgradeInput = {
  storeId: "s1",
  mode: "fast",
  goal: "visit",
  tone: "亲切大姐",
  level: "std",
  keepMine: false,
  raw: "今天店里做了 8 单。新来的小姐姐做完深度清洁，说皮肤亮了一个度，当场约了下个月。姐妹们皮肤有困扰的，到店我手把手教。"
};

// 1. 快速模式成功
const r1 = upgradeMoments(base);
assert("快速模式生成正文", r1.body.length > 20);
assert("正文含结尾动作 CTA", /到店|体验|聊聊/.test(r1.body));
assert("rawLen/rawScore 正确", r1.rawLen === base.raw!.length && r1.rawScore >= 30 && r1.rawScore <= 80);
assert("诊断输出为数组", Array.isArray(r1.issues));
assert("发布前检查 5 项", r1.checks.length === 5);
assert("无违规引导词", r1.checks.find((c) => c.label === "违规引导词")?.ok === true);

// 2. 空店拒
let threw = false;
try {
  validateStoreScope({ ...base, storeId: "" });
} catch {
  threw = true;
}
assert("缺 store_id 拒绝", threw);

// 3. 快速原话校验
threw = false;
try {
  upgradeMoments({ ...base, raw: "太短了" });
} catch {
  threw = true;
}
assert("快速原话 <15 字拒绝", threw);

// 4. keepMine 保留原话
const rKeep = upgradeMoments({ ...base, keepMine: true });
assert("keepMine 保留原句", rKeep.core === base.raw!.trim());

// 5. 专业模式七柱
const rPro = upgradeMoments({ storeId: "s1", mode: "pro", pillar: "problem", level: "std", fields: { storeName: "本店", concern: "皮肤总是出油", view: "先做好清洁和补水" } });
assert("七柱问题类型生成正文", rPro.body.includes("到店") || rPro.body.includes("看看"));
assert("七柱正文包含用户字段内容", rPro.body.includes("皮肤总是出油") && rPro.body.includes("先做好清洁和补水"));
assert("七柱 rawLen>0（源文案来自必填字段）", rPro.rawLen > 0);
assert("七柱缺失时拒绝", (() => { try { upgradeMoments({ storeId: "s1", mode: "pro", pillar: "problem", fields: { storeName: "本店" } }); return false; } catch { return true; } })());

// 6. 无数字正文插入占位 + 数字项 warn
const rNoDigit = upgradeMoments({ ...base, raw: "今天店里来了个客人，做了清洁，皮肤不错，到店看看。" });
assert("无数字插入【待你补一句】", rNoDigit.placeholder === true);
assert("占位强制数字项 warn", rNoDigit.checks.find((c) => c.label === "有具体数字")?.ok === false);

// 7. 素材富力度：虚输入判「需要补充」，具体输入判「足够」
assert("含数字视为足够", isInputRich("今天店里做了 8 单。") === true);
assert("含具体服务视为足够", isInputRich("那个 客人皮肤起皮 想补水 你看着办") === true);
assert("太虚无重点判需要补充", isInputRich("今天店里来了个客人 做了个东西 她挺满意的 嗯 没了") === false);
assert("泛词活动单独不算够", isInputRich("搞个活动 就是那个 嗯 大概 想搞一下 你写吧") === false);
assert("泛词活动+具体时间名额算够", isInputRich("搞个活动 周四 名额 10 位 98 元") === true);

console.log(`\n${MOMENTS_SERVICE_VERSION} -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
