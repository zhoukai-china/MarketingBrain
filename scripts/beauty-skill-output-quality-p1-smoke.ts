import { resolveAgentMaxTokens, runAgent, type LlmMessage, type LlmProvider } from "../packages/agent/src/index.js";
import { DomesticProviderTerminalError, parseChatCompletionResponse } from "../apps/api/src/services/domestic-chat-provider.js";

const failures: string[] = [];

function check(condition: boolean, code: string): void {
  if (!condition) failures.push(code);
}

class FailingProvider implements LlmProvider {
  readonly name = "beauty-p1-controlled-failure";
  async complete(): Promise<string> {
    throw new Error("controlled_provider_failure");
  }
}

class RepairableBeautyProvider implements LlmProvider {
  readonly name = "beauty-p1-controlled-repair";
  constructor(private readonly mode: "topic" | "xhs") {}

  async complete(messages: LlmMessage[]): Promise<string> {
    const system = messages[0]?.content ?? "";
    const latest = messages[messages.length - 1]?.content ?? "";
    if (system.includes("内部事实分析器")) {
      return JSON.stringify({
        goal: "获得附近顾客真实咨询",
        confirmedFacts: [{ fact: "生活美容门店只提供基础清洁、日常补水和舒缓护理", source: "用户本轮" }],
        findings: [],
        missingInformation: ["城市", "价格", "预约方式"],
        recommendedApproach: "只使用已确认服务与获授权素材"
      });
    }
    if (latest.includes("上一次输出没有严格符合")) {
      return this.mode === "topic" ? completeTopicAnswer() : completeXhsAnswer();
    }
    return this.mode === "topic" ? incompleteTopicAnswer() : unsafeXhsAnswer();
  }
}

class IncompleteBeautySalesProvider implements LlmProvider {
  readonly name = "beauty-sales-incomplete-contract";
  async complete(): Promise<string> {
    return [
      "顾客异议",
      "顾客在确认一次护理是否能明显改善。",
      "可直接复制话术",
      "每个人的实际情况不同，先了解当前情况，再说明已确认的服务步骤。",
      "后续跟进",
      "记录顾客关注点，确认真实项目资料后再继续沟通。",
      "不承诺疗效，不编价格、案例或预约方式。"
    ].join("\n").repeat(5);
  }
}

async function main(): Promise<void> {
  check(resolveAgentMaxTokens("beauty_acquisition_strategy", "beauty-industry-content-diff") === 8192, "beauty_content_diff_token_budget_not_bounded_8192");
  check(resolveAgentMaxTokens("beauty_xiaohongshu_package", "beauty-industry-xhs") === 8192, "beauty_xhs_token_budget_not_bounded_8192");
  checkTruncatedProviderResponse();
  await checkBeautyTopicRepair();
  await checkBeautyXhsRepair();
  await checkBeautyShortVideoBoundary();
  await checkBeautyLiveBoundary();
  await checkBeautySalesContract();
  await checkVideoReviewFieldRetention();

  if (failures.length > 0) {
    throw new Error(`beauty_skill_output_quality_p1_failures:${failures.join(",")}`);
  }
  console.log("beauty skill output quality P1 smoke passed");
}

function checkTruncatedProviderResponse(): void {
  let rejected = false;
  try {
    parseChatCompletionResponse("deepseek", {
      choices: [{ finish_reason: "length", message: { content: "投流结论：可以测试。止损：达到测试预算仍无" } }],
      usage: { prompt_tokens: 120, completion_tokens: 4096 }
    });
  } catch (error) {
    rejected = error instanceof DomesticProviderTerminalError && error.providerFailure.code === "output_token_limit";
  }
  check(rejected, "paid_traffic_truncation_not_fail_closed");
}

async function checkBeautyTopicRepair(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "beauty-industry-content-diff",
    capabilityId: "topic_inspiration",
    input: [
      "请给社区生活美容门店 6 个适合小红书和短视频的获客选题。",
      "已确认服务只有基础清洁、日常补水和舒缓护理；目标顾客是附近工作节奏快、重视体验但担心推销的人；可拍用品、空间局部和已授权员工手部。",
      "价格、真实案例、顾客评价、城市和预约方式都未确认。选题要具体，不要把护理写成治疗。"
    ].join("\n")
  }), new RepairableBeautyProvider("topic"));
  check((result.answer.match(/选题\s*[1-6]/g)?.length ?? 0) >= 6, "topic_result_not_repaired_to_six_topics");
  check(!/模型连接不稳定|可执行结构/.test(result.answer), "topic_generic_failure_template_returned");
}

async function checkBeautyXhsRepair(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "beauty-industry-xhs",
    capabilityId: "beauty_xiaohongshu_package",
    input: [
      "做一篇夏季日常补水护理的小红书图文，语气温柔、真实、克制，目标是获得附近顾客的咨询。",
      "已确认：基础清洁与日常补水护理；可使用无人物的用品和空间局部；不出现顾客正脸。",
      "未确认门店名、城市、价格、优惠、案例、预约方式。请给 3 个标题、完整正文、标签、互动承接，以及封面图、内容图、互动承接图三张配图的正负提示词方向；只做提示词，不生成图片。"
    ].join("\n")
  }), new RepairableBeautyProvider("xhs"));
  check(["配图方向一｜封面图", "配图方向二｜内容图", "配图方向三｜互动承接图"].every((term) => result.answer.includes(term)), "xhs_three_image_directions_missing");
  check(!/我最近|我做完|我的体验|亲测|护理师会/.test(result.answer), "xhs_fabricated_personal_experience_retained");
  check(!/私信发|私信问|附近可约|我们会回复|可约情况/.test(result.answer), "xhs_unconfirmed_conversion_channel_retained");
}

async function checkBeautyShortVideoBoundary(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "baolu_content_creator",
    capabilityId: "content_plan",
    input: [
      "请为生活美容门店做一条 60 秒短视频完整执行包，主题是‘第一次做基础护理，先问清这几件事’。",
      "目标是降低顾客对强推销和不透明流程的顾虑。已确认可拍接待区、用品、服务流程和一名获授权员工；不拍顾客正脸。",
      "价格、优惠、顾客案例、疗效数据和发布时间表现均未确认。输出选题、完整口播、拍摄脚本、注意事项、剪辑 EDL、标题标签、发布时间建议依据、评论承接和投流 PREVIEW_ONLY 路由。"
    ].join("\n")
  }), new FailingProvider());
  if (process.env.BEAUTY_P1_DEBUG === "1") console.error(`[short-video]\n${result.answer}`);
  check(/基础护理|皮肤管理|日常补水|舒缓护理|生活美容/.test(result.answer), "short_video_lost_beauty_service_scope");
  check(!/美甲|指甲|甲油|手型|上色|照灯|通勤甲/.test(result.answer), "short_video_misclassified_as_manicure");
  check(/PREVIEW_ONLY/.test(result.answer), "short_video_missing_preview_only_route");
  check(!/想变美但怕踩坑的女生|主发布平台|XX路XX号|工具消毒/.test(result.answer), "short_video_unconfirmed_beauty_fact_retained");
}

async function checkBeautyLiveBoundary(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "live_script_planner",
    capabilityId: "live_script",
    input: [
      "为生活美容门店写一份 20 分钟直播话术草稿。",
      "已确认：介绍基础清洁和日常补水护理、服务步骤、用品与环境；目标是让附近顾客了解流程并提出咨询。",
      "直播模式：本地生活门店服务介绍，不带货、不挂团购；主播身份：门店护理师；评论互动由主播口头回答。",
      "真实产品/套餐内容与核心卖点：暂无；本次只介绍已确认的服务流程和到店前顾虑，不销售产品或套餐。",
      "价格、优惠、疗效、预约方式和顾客案例未确认。不能自动开播或发布。"
    ].join("\n")
  }), new FailingProvider());
  if (process.env.BEAUTY_P1_DEBUG === "1") console.error(`[live-script]\n${result.answer}`);
  check(/生活美容|基础清洁|日常补水|服务流程/.test(result.answer), "live_script_lost_beauty_service_scope");
  check(!/美甲|通勤甲|选款|菜品|客单价|产品带货|购买\/核销/.test(result.answer), "live_script_cross_industry_or_commerce_contamination");
}

async function checkBeautySalesContract(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "sales_growth_advisor",
    capabilityId: "beauty_sales",
    input: "顾客询问基础补水护理是否一次就能明显改善。请给门店员工一套合规回复和后续沟通步骤；项目价格、顾客肤况、疗效证据和预约方式都未确认。"
  }), new IncompleteBeautySalesProvider());
  const required = ["当前判断", "异议", "核心破局点", "推荐回复", "客户可能回复与预判应对", "下一步动作", "待核实"];
  check(required.every((term) => result.answer.includes(term)), "beauty_sales_objection_contract_not_enforced");
  check(!/企业项目|总预算超出预期|内部决策人/.test(result.answer), "beauty_sales_b2c_request_used_b2b_script");
  check(!/保证(?:改善|疗效|见效|治愈)|一次见效|根治/.test(result.answer), "beauty_sales_unsafe_claim_retained");
}

async function checkVideoReviewFieldRetention(): Promise<void> {
  const result = await runAgent(baseRequest({
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_review",
    input: [
      "复盘本店最近 4 条生活美容短视频。以下是从后台导出的真实 CSV 明细：",
      "作品标题,播放量,3秒留存率,完播率,点赞量,评论量,私信咨询量",
      "基础清洁流程,2100,52%,24%,45,7,3",
      "门店环境,980,38%,17%,18,2,0",
      "补水知识,1640,49%,29%,36,5,1",
      "员工自我介绍,720,33%,14%,9,1,0",
      "没有到店、成交、发布时间和投流数据。请区分事实与判断，不把播放量写成到店。"
    ].join("\n")
  }), new FailingProvider());
  check(/3秒留存/.test(result.answer) && /52%/.test(result.answer), "video_review_lost_three_second_retention");
  check(/私信(?:咨询)?合计\s*4|私信(?:咨询)?[^\n]{0,12}4/.test(result.answer), "video_review_lost_private_message_metric");
}

function baseRequest(params: {
  requestedSkillId: Parameters<typeof runAgent>[0]["requestedSkillId"];
  capabilityId: string;
  input: string;
}): Parameters<typeof runAgent>[0] {
  return {
    tenantId: "beauty-p1-eval-tenant",
    userId: "beauty-p1-eval-owner",
    role: "owner",
    planCode: "local_premium",
    ...params,
    tenantProfile: {
      tenantId: "beauty-p1-eval-tenant",
      tenantName: "当前门店",
      tenantType: "local_business",
      industry: "生活美容",
      data: { synthetic: true }
    },
    channel: "admin"
  };
}

function incompleteTopicAnswer(): string {
  return "模型连接不稳定，我先按当前能力给你一版可执行结构：先做用户痛点、服务流程和到店承接，具体选题待补。";
}

function completeTopicAnswer(): string {
  return [
    "行业目标补充",
    "围绕附近工作节奏快、担心推销的生活美容顾客，先建立流程透明与低压力咨询信任。",
    "选题方向",
    "选题1｜第一次做基础清洁，先问清服务步骤｜顾客顾虑：怕流程不透明｜素材：用品与空间局部。",
    "选题2｜日常补水不是治疗：门店能说明哪些边界｜顾客顾虑：怕夸大效果｜素材：护理用品。",
    "选题3｜不想被强推销，到店前可以先确认这三件事｜顾客顾虑：销售压力｜素材：咨询清单。",
    "选题4｜舒缓护理会经过哪些环节｜顾客顾虑：不知道过程｜素材：已授权员工手部。",
    "选题5｜只拍空间局部，也能讲清一次基础护理｜顾客顾虑：担心环境｜素材：非特定空间。",
    "选题6｜咨询和预约之间，门店还要补哪一步｜顾客顾虑：不知道怎么继续｜素材：承接清单。",
    "内容约束",
    "只写基础清洁、日常补水、舒缓护理和已授权素材，不写治疗、疗效、价格、案例或顾客评价。",
    "到店承接待补",
    "城市、门店名、价格、真实预约方式未确认；确认前只引导顾客提出问题，不虚构入口。",
    "合规检查",
    "以上是美业目标补充和至少3个差异化选题；行业参考不写成门店事实，只输出草案或预览。"
  ].join("\n");
}

function unsafeXhsAnswer(): string {
  return [
    "标题候选",
    "1. 夏季补水先把护理节奏慢下来",
    "2. 不追求立刻改变的日常补水",
    "3. 怕推销的人可以先问清这些步骤",
    "正文",
    "我最近习惯去做基础补水，做完脸不会紧，护理师会把每一步说清楚。这是完整正文，可直接发布。",
    "话题标签",
    "#日常补水 #基础护理 #夏季护肤 #生活美容 #护理体验；共5至8个标签。",
    "互动与承接",
    "你更关心护理步骤还是到店体验？预约方式待补。",
    "事实与合规待补",
    "门店名、城市、价格、优惠、案例和预约方式待补。",
    "正向视觉提示词",
    "一张无人物的护理用品静物图，柔和自然光。",
    "负向提示词",
    "顾客正脸、医疗器械、治疗前后对比、价格与商标。",
    "后期叠字",
    "夏季日常补水；独立后期叠字。",
    "视觉参数",
    "3:4，小红书封面，供应商无关视觉参数。",
    "交付说明：3个标题候选、完整正文、5至8个标签、独立后期叠字、供应商无关视觉参数。"
  ].join("\n");
}

function completeXhsAnswer(): string {
  return [
    "标题候选",
    "1. 夏季日常补水，先把基础护理做稳",
    "2. 不追求立刻改变，一次日常补水会做什么",
    "3. 怕被推销，到店前可以先问清这几步",
    "正文",
    "夏季空调环境可能让皮肤感觉干燥或紧绷。已确认服务是基础清洁与日常补水护理，因此本文只解释日常护理过程，不把护理写成医疗治疗，也不承诺统一效果。考虑到店时，可以先确认服务步骤、用品类型和过程中如何沟通感受。门店名、城市、价格、优惠、案例和预约方式尚未确认，资料补齐后再加入真实承接信息。",
    "话题标签",
    "#日常补水 #基础护理 #夏季护肤 #生活美容 #护理体验",
    "互动与承接",
    "私信发“补水”，我们会回复当前可约情况。",
    "事实与合规待补",
    "门店名、城市、价格、优惠、案例、真实环境和预约方式待补；不出现顾客正脸。",
    "配图方向一｜封面图",
    "正向视觉提示词：无人物护理用品静物，清透水感材质，柔和自然光，上方留标题安全区，3:4。",
    "负向提示词：顾客正脸、医疗器械、治疗对比、品牌商标、价格、乱码文字。",
    "配图方向二｜内容图",
    "正向视觉提示词：基础清洁与补水用品的步骤化平铺，三段留白构图，温柔米白与浅青色。",
    "负向提示词：虚构门店、顾客案例、夸张水滴、医疗操作、无授权人物。",
    "配图方向三｜互动承接图",
    "正向视觉提示词：无人物的咨询问题卡与护理用品局部，右侧留互动问题安全区，克制真实。",
    "负向提示词：二维码、电话、虚构预约入口、折扣、疗效承诺、商标。",
    "后期叠字",
    "封面：夏季日常补水；内容：先问清护理步骤；承接：你更关心哪一步？中文只做后期叠字。",
    "视觉参数",
    "三张均为3:4、小红书图文、非特定门店场景、供应商无关视觉参数。",
    "交付说明：3个标题候选、完整正文、5至8个标签、独立后期叠字、供应商无关视觉参数。"
  ].join("\n");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
