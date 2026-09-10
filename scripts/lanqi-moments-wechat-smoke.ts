import {
  generateWechatGroup,
  resolveWechatTopic,
  MOMENTS_SERVICE_VERSION
} from "../apps/api/src/products/beauty-industry/moments-service.js";

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

const base = {
  storeId: "s1",
  scene: "notice" as const,
  topic: "下周门店护理活动",
  detail: "周四到周日做护理送一次肩颈，到店前群里说一声。"
};

const r = generateWechatGroup(base);
assert("群公告生成标题含主题", r.title.includes("下周门店护理活动") || r.title.includes("门店动态"));
assert("正文含主题与内容", r.body.includes("下周门店护理活动") && r.body.includes("肩颈"));
assert("正文含结尾动作", /到店|群里/.test(r.body));
assert("发布前检查 5 项", r.checks.length === 5);
assert("无违规引导词", r.checks.find((c) => c.label === "违规引导词")?.ok === true);
assert("rawLen>0", r.rawLen > 0);

assert("缺内容拒绝", (() => { try { generateWechatGroup({ ...base, detail: "" }); return false; } catch { return true; } })());

/**
 * 主题改为可选（2026-09-10 用户报障「微信群营销话术生成不了」）：
 * 旧实现要求主题必填，页面按钮也跟着 `!topic` 一起禁用，老板只填「具体内容」就永远生成不了。
 * 这里锁**新语义**：主题留空时从具体内容派生标题，且字数不重复计算派生出来的那一段。
 */
const noTopic = generateWechatGroup({ storeId: "s1", scene: "notice", topic: "", detail: "周六下午两点做肩颈体验，限 8 个名额。" });
assert("缺主题不再拒绝（改从具体内容派生）", noTopic.title.includes("周六下午两点做肩颈") && noTopic.body.includes("限 8 个名额"));
assert("缺主题时 rawLen 只算具体内容、不重复计派生标题", noTopic.rawLen === "周六下午两点做肩颈体验，限 8 个名额。".length);
assert("显式主题仍优先", resolveWechatTopic("下周活动", "周六下午两点做肩颈体验。", "notice") === "下周活动");
assert("派生主题取第一句并截断 18 字", resolveWechatTopic("", "一二三四五六七八九十一二三四五六七八九十十一十二十三。后半句", "notice").length === 18);
assert("具体内容没有可派生的文字时回落场景名", resolveWechatTopic("  ", "。。。。", "reactivate") === "沉睡唤醒");

const care = generateWechatGroup({ ...base, scene: "care", topic: "天气转凉提醒", detail: "姐妹记得多喝水，皮肤干了随时来店里做补水。" });
assert("关怀场景可用", care.title.includes("关怀") || care.body.includes("照顾好自己") || care.body.includes("补水"));

console.log(`\n${MOMENTS_SERVICE_VERSION} wechat -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
