import type { SkillId } from "@baolu/shared";
import { loadSkillPrompt, loadSkillQualityContract, SKILL_MANIFESTS } from "@baolu/skills";
import { BEAUTY_XHS_PROVIDER_OUTPUT_DIRECTIVE } from "./xhs-provider-output.js";

export type BeautyWorkflowId = "xiaohongshu" | "topics" | "content-ten" | "video-content-review" | "video-data-review" | "live-script" | "live-review" | "sales";

export type BeautyIndustryScope =
  | "acquisition:topics"
  | "acquisition:video-content"
  | "acquisition:video-content-review"
  | "acquisition:xhs"
  | "acquisition:live"
  | "acquisition:video-data-review"
  | "acquisition:live-review"
  | "operations:daily-brief"
  | "operations:business-qa"
  | "sales:advice";

export interface BeautyWorkflowDefinition {
  toolName: string;
  displayName: string;
  scope: BeautyIndustryScope;
  capabilityId: string;
  primarySkillId: SkillId;
  constraintSkillIds: SkillId[];
  internalGuard: true;
  evidenceMode: "none" | "topic_sources" | "structured_data" | "parsed_video";
  medicalClaims: "fail_closed";
  unknownPriceCase: "mark_missing";
  crossIndustry: "reject";
  materialAuthorization: "required";
  externalActions: "preview_only";
}

const guard = { internalGuard: true, medicalClaims: "fail_closed", unknownPriceCase: "mark_missing", crossIndustry: "reject", materialAuthorization: "required", externalActions: "preview_only" } as const;

export const BEAUTY_WORKFLOWS: Record<BeautyWorkflowId, BeautyWorkflowDefinition> = {
  xiaohongshu: { toolName: "beauty.xiaohongshu_package", displayName: "小红书图文生成", scope: "acquisition:xhs", capabilityId: "beauty_xiaohongshu_package", primarySkillId: "wechat-xhs-content-line", constraintSkillIds: ["beauty-industry-xhs", "beauty-industry-compliance"], evidenceMode: "none", ...guard },
  topics: { toolName: "beauty.topic_ideas", displayName: "美业选题生成", scope: "acquisition:topics", capabilityId: "topic_inspiration", primarySkillId: "baolu_topics", constraintSkillIds: ["beauty-industry-content-diff", "beauty-industry-compliance"], evidenceMode: "topic_sources", ...guard },
  "content-ten": { toolName: "beauty.content_ten_pack", displayName: "内容系统", scope: "acquisition:video-content", capabilityId: "content_plan", primarySkillId: "baolu_content_creator", constraintSkillIds: ["beauty-industry-content-diff", "beauty-industry-compliance"], evidenceMode: "none", ...guard },
  "video-content-review": { toolName: "beauty.video_content_review", displayName: "视频内容复盘", scope: "acquisition:video-content-review", capabilityId: "shooting_editing", primarySkillId: "baolu_content_creator", constraintSkillIds: ["beauty-industry-content-diff", "beauty-industry-compliance"], evidenceMode: "parsed_video", ...guard },
  "video-data-review": { toolName: "beauty.video_data_review", displayName: "视频数据复盘", scope: "acquisition:video-data-review", capabilityId: "video_data_review", primarySkillId: "baolu_review_engine", constraintSkillIds: ["beauty-industry-content-diff", "beauty-industry-compliance"], evidenceMode: "structured_data", ...guard },
  "live-script": { toolName: "beauty.live_script", displayName: "直播话术生成", scope: "acquisition:live", capabilityId: "live_script", primarySkillId: "live_script_planner", constraintSkillIds: ["beauty-industry-compliance"], evidenceMode: "none", ...guard },
  "live-review": { toolName: "beauty.live_review", displayName: "直播复盘", scope: "acquisition:live-review", capabilityId: "live_review", primarySkillId: "baolu_live_review_engine", constraintSkillIds: ["beauty-industry-compliance"], evidenceMode: "none", ...guard },
  sales: { toolName: "beauty.sales_advice", displayName: "美业销售建议", scope: "sales:advice", capabilityId: "beauty_sales", primarySkillId: "sales_growth_advisor", constraintSkillIds: ["beauty-industry-compliance"], evidenceMode: "none", ...guard }
};

const WORKFLOW_BY_CAPABILITY = new Map(Object.entries(BEAUTY_WORKFLOWS).map(([id, value]) => [value.capabilityId, { id: id as BeautyWorkflowId, ...value }]));

export function getBeautyWorkflow(capabilityId: string) {
  const workflow = WORKFLOW_BY_CAPABILITY.get(capabilityId);
  if (!workflow) throw new Error("beauty_workflow_not_found");
  return workflow;
}

export async function buildBeautyWorkflowPrompt(capabilityId: string): Promise<{ prompt: string; version: string; skillChain: Array<{ skillId: SkillId; version: string }> }> {
  const workflow = getBeautyWorkflow(capabilityId);
  const skillIds = [workflow.primarySkillId, ...workflow.constraintSkillIds];
  const layers = await Promise.all(skillIds.map(async (skillId, index) => {
    const manifest = SKILL_MANIFESTS[skillId];
    if (!manifest) throw new Error(`beauty_workflow_skill_missing:${skillId}`);
    const [loadedPrompt, contract] = await Promise.all([loadSkillPrompt(skillId), loadSkillQualityContract(skillId)]);
    const prompt = index === 0
      ? selectBeautyPrimarySkillPrompt(workflow, loadedPrompt)
      : loadedPrompt;
    const runtimeContract = workflow.capabilityId === "beauty_xiaohongshu_package"
      ? compactRuntimeContract(contract)
      : contract;
    return { skillId, version: manifest.version, contract, text: [index === 0 ? `主业务 Skill：${skillId} ${manifest.version}` : `内部约束 Skill：${skillId} ${manifest.version}`, prompt, "该层质量合约：", JSON.stringify(runtimeContract)].join("\n") };
  }));
  const primaryContract = layers[0]?.contract;
  // Configured XHS Providers return the versioned JSON transport below. The
  // server renders the canonical Markdown headings deterministically before
  // the unchanged formal contract runs, so duplicating the whole heading
  // skeleton here only consumes the strict 25 KB prompt budget.
  const exactHeadingSkeleton = workflow.capabilityId === "beauty_xiaohongshu_package"
    ? ""
    : buildPrimaryHeadingSkeleton(workflow.capabilityId, primaryContract?.requiredSections ?? []);
  const usesConditionalLiveScriptContract = workflow.capabilityId === "live_script";
  const topicFactRetentionDirective = workflow.capabilityId === "topic_inspiration"
    ? "目标用户、账号阶段和本轮获客目标必须逐字保留服务端核验值；只可调整句式，不得改写、概括或遗漏这些值。四来源缺失状态必须照实写待补/待核验。"
    : "";
  const xhsFactRetentionDirective = workflow.capabilityId === "beauty_xiaohongshu_package"
    ? "输入中的“本次任务事实清单”由服务端锁定。客户成品、制作说明和内部审核必须分层；任务事实回执只放质量与合规检查。客户标题、正文、标签与相关配图方向继续使用同一组已提供事实。没有时点事实时不得虚构季节或写时点占位。遗漏、事实矛盾、内部术语污染客户成品或用其他项目/人群替换均为硬失败。"
    : "";
  const xhsProviderOutputDirective = workflow.capabilityId === "beauty_xiaohongshu_package"
    ? BEAUTY_XHS_PROVIDER_OUTPUT_DIRECTIVE
    : "";
  const contentDeliveryLayerDirective = workflow.capabilityId === "content_plan"
    ? "内容系统必须分为十件正式交付与末尾质量审核两层。十件交付只写可直接使用的内容和面向门店运营的制作说明，不得出现待补、待核验、回执、Schema、Eval、供应商或受控流程等内部词。未确认的门店名、价格、预约方式、案例、疗效、经营数字与素材授权只放入末尾“质量与合规检查”，不得机械插入十件正文；真正影响方向的必填简报应在生成前阻断。"
    : "";
  const finalOutputDirective = [
    "【最终输出结构优先级】",
    "最终输出结构以主业务 Skill 的质量合约为唯一用户交付结构。内部约束 Skill 只负责行业差异、事实与合规修正，不得替换主结构、另起一份检查报告或把其他模块内容追加为用户要求。",
    primaryContract?.requiredSections?.length && !usesConditionalLiveScriptContract
      ? `必须逐项出现：${primaryContract.requiredSections.join("、")}。`
      : "",
    usesConditionalLiveScriptContract
      ? "直播话术按用户本轮范围交付：只有用户明确要求完整版、整场或给出直播时长时，才执行主 Skill 的完整场次结构；普通直播话术请求使用下面的标准结构，不得被完整场次栏目强行扩写。"
      : "",
    exactHeadingSkeleton ? "必须原样保留下面的栏目标题；在每个标题下填写本轮真实内容，不得改名、合并或省略：" : "",
    exactHeadingSkeleton,
    topicFactRetentionDirective,
    xhsFactRetentionDirective,
    xhsProviderOutputDirective,
    contentDeliveryLayerDirective,
    primaryContract?.requiredTerms?.length ? `必须保留关键内容：${primaryContract.requiredTerms.join("、")}。` : "",
    primaryContract?.requiredDeliverables?.length ? `最终交付必须可验证：${primaryContract.requiredDeliverables.join("、")}。` : "",
    "未确认的价格、疗效、案例、门店事实或素材权利写待补；不得用约束层示例或其他行业资料补齐。",
    "只输出完整最终答案，不解释 Skill、约束、路由、模型或质量检查过程。"
  ].filter(Boolean).join("\n");
  return {
    version: layers.map((item) => `${item.skillId}@${item.version}`).join("+"),
    skillChain: layers.map(({ skillId, version }) => ({ skillId, version })),
    prompt: [`【固定美业能力】${workflow.capabilityId}`, "这是美业产品固定业务工作流。按下面顺序同时执行主业务 Skill 和内部约束 Skill；后者是内部护栏，不向用户暴露 Skill 名称、Prompt 或检查过程。", "显式 capability 已由服务端锁定，禁止根据自由文本切换到其他业务分支。", "任何医疗疗效承诺、未确认价格/案例、跨行业内容、未授权素材或已执行外部动作都是硬失败。", ...layers.map((item) => item.text), finalOutputDirective].join("\n\n")
  };
}

function compactRuntimeContract(contract: Awaited<ReturnType<typeof loadSkillQualityContract>>): Record<string, unknown> | undefined {
  if (!contract) return undefined;
  return {
    version: contract.version,
    qualityBar: contract.qualityBar,
    minLength: contract.minLength,
    scoreThreshold: contract.scoreThreshold,
    requiredSections: contract.requiredSections,
    requiredTerms: contract.requiredTerms,
    requiredDeliverables: contract.requiredDeliverables,
    forbiddenTerms: contract.forbiddenTerms
  };
}

function selectBeautyPrimarySkillPrompt(workflow: BeautyWorkflowDefinition, loadedPrompt: string): string {
  if (workflow.capabilityId === "shooting_editing" && workflow.primarySkillId === "baolu_content_creator") {
    const startMarker = "### 拍摄剪辑优化输出合同";
    const endMarker = "\n---";
    const start = loadedPrompt.indexOf(startMarker);
    const end = loadedPrompt.indexOf(endMarker, Math.max(0, start));
    if (start < 0 || end <= start) throw new Error("beauty_video_content_prompt_contract_missing");
    return loadedPrompt.slice(start, end).trim();
  }
  if (workflow.capabilityId !== "content_plan" || workflow.primarySkillId !== "baolu_content_creator") {
    return loadedPrompt;
  }
  const startMarker = "## 输出格式（内容十件套 · V5）";
  const endMarker = "## 核心文件";
  const start = loadedPrompt.indexOf(startMarker);
  const end = loadedPrompt.indexOf(endMarker, Math.max(0, start));
  if (start < 0 || end <= start) throw new Error("beauty_content_ten_prompt_contract_missing");
  return loadedPrompt
    .slice(start, end)
    .replace(/### 第一层：思潼方法论[\s\S]*?(?=### 第二层：)/, "")
    .replaceAll("思潼", "当前任务出镜者")
    .replace("招商加盟视频：晒过程（加盟商实拍）+ 讲故事（成功案例）", "服务项目内容：晒过程（仅限授权真实素材）+ 讲依据（案例需经核验）")
    .replace("#招商加盟", "#{细分赛道关键词}")
    .trim();
}

function buildPrimaryHeadingSkeleton(capabilityId: string, requiredSections: string[]): string {
  if (capabilityId === "topic_inspiration") {
    return [
      "## 本轮主体与目标",
      "目标用户：",
      "账号阶段：",
      "本轮获客目标：",
      "## 四大来源自动采集结果",
      "### 私有知识与客户问题",
      "### 行业与用户热点",
      "### 自身账号数据复盘",
      "### 同行与对标内容",
      "## 三关筛选后的TOP10",
      "| # | 最终选题 | 类型 | 来源 | 第一关证据 | 共识层级 | 客资准度 | 适用阶段 | 创作建议 |",
      "|---|---|---|---|---|---|---|---|---|",
      "## 配比调整建议",
      "## 待验证动作与证据边界"
    ].join("\n");
  }
  if (capabilityId === "beauty_xiaohongshu_package") {
    return [
      "## 客户可复制成品",
      "### 标题候选",
      "1. 【标题一】",
      "2. 【标题二】",
      "3. 【标题三】",
      "### 正文",
      "### 话题标签",
      "### 互动与承接",
      "## 门店制作说明",
      ...["配图方向一｜封面图", "配图方向二｜内容图", "配图方向三｜互动承接图"].flatMap((direction) => [
        `### ${direction}`,
        "#### 正向视觉提示词",
        "#### 负向提示词",
        "#### 后期叠字",
        "#### 视觉参数"
      ]),
      "## 质量与合规检查",
      "### 任务事实回执",
      "- 季节/时点：",
      "- 服务项目：",
      "- 地理范围：",
      "- 目标顾客：",
      "- 平台：",
      "- 交付形式：",
      "### 事实与合规待补"
    ].join("\n");
  }
  if (capabilityId === "content_plan") {
    return [
      "## 短结论",
      "## 一、选题",
      "## 二、口播逐字稿",
      "开头3秒钩子：",
      "## 三、访谈话术",
      "## 四、拍摄脚本",
      "镜头与字幕：",
      "## 五、拍摄注意事项",
      "## 六、剪辑EDL",
      "## 七、发布标题与话题",
      "## 八、最佳发布时间",
      "## 九、评论区引导话术",
      "## 十、投流建议",
      "复盘指标：",
      "## 下一步动作",
      "## 质量与合规检查"
    ].join("\n");
  }
  if (capabilityId === "shooting_editing") {
    return [
      "## 视频基本信息",
      "## 现有版本诊断",
      "## 一、优化版选题定位",
      "## 二、优化版口播逐字稿",
      "## 三、优化版拍摄脚本",
      "## 四、拍摄注意事项",
      "## 五、优化版剪辑EDL",
      "## 六、优化版发布策略",
      "## 七、投流建议",
      "## 八、核心改进点"
    ].join("\n");
  }
  if (capabilityId === "live_script") {
    return [
      "## 短结论",
      "## 场景识别",
      "## 直播目标",
      "## 开播前检查",
      "## 主播口播稿",
      "### 开场",
      "### 留人",
      "### 互动",
      "### 产品承接",
      "### 转化",
      "### 逼单",
      "## 运营配合动作",
      "## 下播后跟进",
      "## 合规提醒",
      "## 复盘指标"
    ].join("\n");
  }
  if (capabilityId === "beauty_sales") {
    return [
      "## 建议先这样回复",
      "## 为什么这样回",
      "## 顾客可能的下一句",
      "## 你接下来问什么",
      "## 策略详情",
      "## 当前判断",
      "### 已确认事实",
      "### 待核实判断",
      "### 异议",
      "## 核心破局点",
      "## 推荐回复",
      "## 客户可能回复与预判应对",
      "## 下一步动作",
      "## 质量与合规检查"
    ].join("\n");
  }
  return requiredSections.map((section) => `## ${section}`).join("\n");
}
