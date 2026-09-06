import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLanqiContentDraftFromSkill } from "../apps/api/src/services/lanqi-content-studio.js";

const skillAnswer = `标题候选：
1. 夏季到店护理前，先确认这三件事
2. 在烟台做护理，预约前可以先问什么
3. 第一次到店护理的准备清单

正文：
夏季到店护理前，与其临时做决定，不如先确认自己的需求、可安排的时间，以及门店当前能够提供的服务。脱敏门店目前已确认提供护理服务，位于烟台。其他服务细节、价格和效果均待确认，发布前请以门店官方说明为准。

话题标签：
#烟台生活 #到店护理 #护理准备 #门店日常 #小红书笔记

互动与承接：
你第一次预约护理时最想先问什么？如需了解，请通过门店已确认的官方渠道咨询，渠道待确认。

发布前核对：
本稿仅依据门店已确认资料，未引用兰琪专属方法论或内部定价；价格、优惠、疗效、案例和客户评价均未写入。`;
const result = buildLanqiContentDraftFromSkill(
  { topic: "夏季到店护理准备", audience: "本地有护理需求的人群", goal: "预约咨询" },
  { storeName: "脱敏门店", city: "烟台", mainServices: ["护理"] },
  skillAnswer,
);
assert.equal(result.sourceMode, "store_facts_with_xiaohongshu_skill");
assert.equal(result.copyDraft.title, "夏季到店护理前，先确认这三件事");
assert.equal(result.copyDraft.titleCandidates.length, 3);
assert.equal(result.copyDraft.selectedTitle, result.copyDraft.title);
assert.ok(result.copyDraft.body.includes("价格和效果均待确认"));
assert.deepEqual(result.copyDraft.tags.slice(0, 2), ["#烟台生活", "#到店护理"]);
assert.ok(result.copyDraft.callToAction.includes("承接方式待确认"), "未提供已确认渠道时必须保留承接占位，不能假设存在官方渠道");
assert.ok(result.copyDraft.disclosure.includes("未引用兰琪专属方法论"));
assert.equal(result.imagePrompt, "");
assert.equal(result.videoPrompt, "");

const sparseTagsResult = buildLanqiContentDraftFromSkill(
  { topic: "第一次到店护理", audience: "本地顾客", goal: "咨询" },
  { city: "烟台", mainServices: ["皮肤护理"] },
  skillAnswer.replace("#烟台生活 #到店护理 #护理准备 #门店日常 #小红书笔记", "#护理准备 #门店日常 #小红书笔记"),
);
assert.ok(sparseTagsResult.copyDraft.tags.length >= 5, "模型标签不足时必须用已确认事实和安全标签补足到 5 个");
assert.ok(sparseTagsResult.copyDraft.tags.length <= 8, "小红书标签不得超过 8 个");
assert.ok(sparseTagsResult.copyDraft.tags.includes("#烟台生活"), "补足标签只能使用已确认城市等事实");

const unsafeSkillAnswer = `标题候选：
1. 99元根治敏感肌，98%顾客都说好

正文：
门店目前提供黄金补水护理，已经服务1000名顾客，保证7天见效。门店目前在杭州。请通过已确认的咨询方式预约。今天私信即可领取99元特价。

话题标签：
#根治敏感肌 #99元补水 #虚构案例 #小红书笔记

互动与承接：
私信发送手机号，立即预约99元项目。

发布前核对：
以上数据均为真实案例。`;
const unsafeResult = buildLanqiContentDraftFromSkill(
  { topic: "夏季补水护理", audience: "附近上班族", goal: "了解服务" },
  {},
  unsafeSkillAnswer,
);
const unsafePublicCopy = JSON.stringify(unsafeResult.copyDraft);
assert.doesNotMatch(unsafePublicCopy, /99元|98%|1000名|根治|保证7天|真实案例|发送手机号/, "模型输出中的未确认价格、疗效、案例和联系方式必须被硬拦截");
assert.doesNotMatch(unsafeResult.copyDraft.body, /门店目前提供黄金补水护理/, "用户需求不得被模型升级成已确认门店服务");
assert.doesNotMatch(unsafeResult.copyDraft.body, /门店目前在杭州/, "通用画像或模型猜测的城市不得升级成门店所在地");
assert.doesNotMatch(unsafeResult.copyDraft.body, /已确认的咨询方式/, "承接渠道待补时不得声称已有确认咨询方式");
assert.match(unsafeResult.copyDraft.body, /需.*确认|待确认/, "拦截未确认事实后必须给出可理解的待确认提示");
assert.match(unsafeResult.copyDraft.callToAction, /承接方式待确认/, "没有已确认承接渠道时不得生成预约或导流动作");

const routeSource = readFileSync(new URL("../apps/api/src/routes/lanqi-content-studio.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../apps/web/src/pages/LanqiContentStudioPage.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../apps/web/src/styles/lanqi-content-studio.css", import.meta.url), "utf8");
assert.match(routeSource, /invokeSkillViaGateway/, "兰琪小红书内容必须通过统一 MCP Skill 网关生成");
assert.match(routeSource, /skillId:\s*"xiaohongshu_ops"/, "兰琪小红书内容必须锁定专用小红书 Skill");
assert.doesNotMatch(routeSource, /skillId:\s*"baolu_content_creator"/, "兰琪小红书内容不得调用通用内容 Skill");
assert.match(routeSource, /capabilityLocked:\s*true/, "兰琪小红书入口不得被路由到其他 Skill");
assert.doesNotMatch(routeSource, /readFact\(facts\.city\)\s*\?\?\s*context\.profile\.city/, "通用租户画像城市不得冒充门店已确认城市");
assert.match(pageSource, /这次想发什么/, "用户入口必须收敛为一个自然语言需求输入");
assert.match(pageSource, /生成小红书图文/, "主操作必须明确为统一生成小红书图文");
assert.match(pageSource, /\/lanqi\/content-studio\/packages/, "统一页面必须调用同一图文工作流");
assert.doesNotMatch(pageSource, /getAppPath\("\/lanqi\/image-studio"\)/, "用户主导航不得继续跳转独立图片工作室");
assert.doesNotMatch(pageSource, /阿里云|百炼|DashScope|quote\.model/, "用户界面不得暴露媒体供应商或模型名称");
assert.doesNotMatch(pageSource, /¥1\.00|customerPriceYuan/, "用户界面只显示积分，不把售价误写成供应商成本");
assert.match(styleSource, /--lanqi-orange:/, "兰琪内容工作台必须使用橙色 VI 变量");
assert.match(styleSource, /lanqiPackageResultGrid/, "统一图文结果必须具备桌面与移动布局");
console.log("lanqi content studio smoke: PASS");
