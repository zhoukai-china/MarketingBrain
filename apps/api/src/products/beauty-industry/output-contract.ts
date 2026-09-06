import type { SkillId } from "@baolu/shared";
import { loadSkillQualityContract } from "@baolu/skills";
import { getBeautyWorkflow } from "./workflows.js";
import { inspectBeautyXhsTaskFactIssues } from "./xhs-task-facts.js";
import { parseBeautyXhsDelivery } from "./xhs-delivery.js";
import { parseBeautyContentDelivery, parseBeautySalesDelivery, type BeautyStructuredDelivery } from "./structured-delivery.js";

export const BEAUTY_OUTPUT_CONTRACT_VERSION = "beauty-workflow-output-v1" as const;

interface BeautyRuntimeResultForValidation {
  capabilityId?: string;
  skillId: string;
  skillVersion: string;
  answerText: string;
  deliveryStatus: "completed" | "needs_input";
  qualityFlags: string[];
  creditCost?: number;
  providerFailure?: { code?: string };
}

export interface BeautyWorkflowValidationInput {
  capabilityId: string;
  expectedSkillId: SkillId;
  expectedSkillVersion: string;
  result: BeautyRuntimeResultForValidation;
  observedProviderOutputs: string[];
  replay: boolean;
  taskFactSource?: string;
}

export interface BeautyWorkflowValidationResult {
  parser: typeof BEAUTY_OUTPUT_CONTRACT_VERSION;
  fallbackUsed: boolean;
  providerOutputVerified: boolean;
  structuredDelivery?: BeautyStructuredDelivery;
}

const BLOCKING_QUALITY_FLAGS = [
  /^too_short$/,
  /^missing_contract_terms:/,
  /^provider_fallback_used$/,
  /^topic_final_delivery_rebuilt$/,
  /^provider_failure_/,
  /^rubric_scene_mismatch$/,
  /^rubric_fact_retention_weak$/,
  /^rubric_fact_contradiction$/,
  /^rubric_generic_template$/,
  /^rubric_not_boss_usable$/,
  /cross_industry/i,
  /contract_not_enforced/i,
  /wrong_(?:skill|module|scenario)/i
] as const;

const FOREIGN_INDUSTRY_OR_INTERNAL = /(?:餐饮|外卖|牛肉面|火锅|烧烤|创始人\s*IP|AI工具|兰琪|枕水江南|验收[AB]店|tenant(?:Id|Key)?)/i;

const MODULE_FINGERPRINTS: Record<string, string[]> = {
  beauty_xiaohongshu_package: ["标题候选", "配图方向一｜封面图", "后期叠字"],
  topic_inspiration: ["四大来源自动采集结果", "三关筛选后的TOP10", "配比调整建议"],
  content_plan: ["口播逐字稿", "拍摄脚本", "剪辑EDL"],
  shooting_editing: ["视频基本信息", "现有版本诊断", "八、核心改进点"],
  video_data_review: ["数据质量审计", "视频分层", "完播率深层归因"],
  live_script: ["主播口播稿", "轮播节奏表", "场控执行清单"],
  live_review: ["一、核心数据速览", "五、话术执行对照表", "八、下次直播调整清单"],
  beauty_sales: ["当前判断", "核心破局点", "推荐回复"]
};

export function assertPendingBeautyVideoContentReviewOutput(answer: string): void {
  const normalized = normalizeAnswer(answer);
  const required = [
    "视频基本信息", "现有版本诊断", "一、优化版选题定位", "二、优化版口播逐字稿", "三、优化版拍摄脚本",
    "四、拍摄注意事项", "五、优化版剪辑EDL", "六、优化版发布策略", "七、投流建议", "八、核心改进点"
  ];
  const missing = required.find((term) => !containsContractTerm(normalized, term));
  if (missing) throw new Error(`beauty_workflow_output_contract_failed:missing_${safeErrorToken(missing)}`);
  if (FOREIGN_INDUSTRY_OR_INTERNAL.test(normalized)) {
    throw new Error("beauty_workflow_output_foreign_module_failed:foreign_industry_or_internal");
  }
  if (/已(?:读取|看过|识别|分析).{0,16}(?:画面|口播|视频)/.test(normalized) && !/(?:视觉|画面).{0,24}(?:成功|回执)[\s\S]{0,160}(?:ASR|语音转写).{0,24}(?:成功|回执)/i.test(normalized)) {
    throw new Error("beauty_workflow_output_evidence_failed:media_success_receipts_missing");
  }
  if (/提升\s*\d+(?:\.\d+)?%|预计(?:播放|完播|互动|转化).{0,12}\d/.test(normalized) && !/(?:待发布验证|测试目标)/.test(normalized)) {
    throw new Error("beauty_workflow_output_evidence_failed:unsupported_uplift_claim");
  }
}

export async function assertBeautyWorkflowRuntimeResult(
  input: BeautyWorkflowValidationInput
): Promise<BeautyWorkflowValidationResult> {
  const workflow = getBeautyWorkflow(input.capabilityId);
  if (workflow.primarySkillId !== input.expectedSkillId) {
    throw new Error("beauty_workflow_output_route_failed:registry_skill_mismatch");
  }
  if (input.result.skillId !== input.expectedSkillId) {
    throw new Error("beauty_workflow_output_route_failed:runtime_skill_mismatch");
  }
  if (input.result.capabilityId && input.result.capabilityId !== input.capabilityId) {
    throw new Error("beauty_workflow_output_route_failed:runtime_capability_mismatch");
  }
  if (input.result.skillVersion !== input.expectedSkillVersion) {
    throw new Error("beauty_workflow_output_route_failed:runtime_version_mismatch");
  }
  if (input.result.providerFailure) {
    throw new Error(`beauty_workflow_output_provider_failed:${input.result.providerFailure.code ?? "unknown"}`);
  }

  const fallbackUsed = input.result.qualityFlags.some((flag) => /fallback|deterministic_draft|deterministic_plan/i.test(flag));
  if (input.result.deliveryStatus === "needs_input") {
    if (fallbackUsed) throw new Error("beauty_workflow_output_quality_failed:clarification_fallback");
    if ((input.result.creditCost ?? 0) !== 0) {
      throw new Error("beauty_workflow_output_quality_failed:clarification_charged");
    }
    if (!/(?:待补|补充|请提供|请填写|请上传|需要确认|还需要)/.test(input.result.answerText)) {
      throw new Error("beauty_workflow_output_contract_failed:invalid_clarification");
    }
    if (looksLikeCompletedForeignModule(input.capabilityId, input.result.answerText)) {
      throw new Error("beauty_workflow_output_foreign_module_failed:clarification");
    }
    return {
      parser: BEAUTY_OUTPUT_CONTRACT_VERSION,
      fallbackUsed: false,
      providerOutputVerified: input.observedProviderOutputs.length > 0
    };
  }

  const blockingFlag = input.result.qualityFlags.find((flag) =>
    BLOCKING_QUALITY_FLAGS.some((pattern) => pattern.test(flag))
  );
  if (blockingFlag) throw new Error(`beauty_workflow_output_quality_failed:${safeErrorToken(blockingFlag)}`);
  if (fallbackUsed) throw new Error("beauty_workflow_output_quality_failed:fallback_used");

  await assertPrimaryContract(input.expectedSkillId, input.result.answerText, input.capabilityId);
  assertCapabilityDeliverables(input.capabilityId, input.result.answerText);
  assertTaskFactRetention(input.capabilityId, input.result.answerText, input.taskFactSource);
  const deterministicEvidenceDelivery = input.result.qualityFlags.includes("video_table_review_direct");
  assertNoForeignModuleOrIndustry(
    input.capabilityId,
    input.result.answerText,
    deterministicEvidenceDelivery ? input.taskFactSource : undefined
  );

  if (input.replay) {
    return {
      parser: BEAUTY_OUTPUT_CONTRACT_VERSION,
      fallbackUsed: false,
      providerOutputVerified: false
    };
  }

  const providerOutputCheck = await inspectProviderOutputsAgainstPrimaryContract(
    input.expectedSkillId,
    input.capabilityId,
    input.observedProviderOutputs,
    input.taskFactSource
  );
  const providerOutputVerified = providerOutputCheck.verified;
  if (!providerOutputVerified && !deterministicEvidenceDelivery) {
    throw new Error(`beauty_workflow_output_quality_failed:unverified_runtime_fallback_${providerOutputCheck.issue}`);
  }
  return {
    parser: BEAUTY_OUTPUT_CONTRACT_VERSION,
    fallbackUsed: false,
    providerOutputVerified,
    ...(input.capabilityId === "beauty_xiaohongshu_package"
      ? { structuredDelivery: parseBeautyXhsDelivery(input.result.answerText, process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true") }
      : input.capabilityId === "content_plan"
        ? { structuredDelivery: parseBeautyContentDelivery(input.result.answerText, process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true") }
        : input.capabilityId === "beauty_sales"
          ? { structuredDelivery: parseBeautySalesDelivery(input.result.answerText, process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true", /【使用模式】[\s\S]{0,160}专业模式/u.test(input.taskFactSource ?? "") ? "professional_advice" : "quick_response") }
        : {})
  };
}

async function inspectProviderOutputsAgainstPrimaryContract(
  skillId: SkillId,
  capabilityId: string,
  outputs: string[],
  taskFactSource?: string
): Promise<{ verified: boolean; issue: string }> {
  let firstIssue = outputs.length > 0 ? "contract_mismatch" : "no_provider_output";
  for (const output of outputs) {
    try {
      await assertPrimaryContract(skillId, output, capabilityId);
      assertCapabilityDeliverables(capabilityId, output);
      assertTaskFactRetention(capabilityId, output, taskFactSource);
      assertNoForeignModuleOrIndustry(capabilityId, output);
      return { verified: true, issue: "none" };
    } catch (error) {
      if (error instanceof Error) {
        firstIssue = safeErrorToken(error.message.replace(/^beauty_workflow_output_[^:]+:/, "")) || firstIssue;
      }
      // A model repair may follow an invalid first answer. Only a later output
      // that independently satisfies the same contract can be accepted.
    }
  }
  return { verified: false, issue: firstIssue };
}

async function assertPrimaryContract(skillId: SkillId, answer: string, capabilityId?: string): Promise<void> {
  const contract = await loadSkillQualityContract(skillId);
  if (!contract) throw new Error("beauty_workflow_output_contract_failed:missing_contract");
  const normalized = normalizeAnswer(answer);
  if (normalized.length < Math.max(contract.minLength ?? 80, 80)) {
    throw new Error("beauty_workflow_output_contract_failed:min_length");
  }
  const required = uniqueStrings([
    ...(contract.requiredSections ?? []),
    ...(contract.requiredTerms ?? []).filter((term) => isLiteralRequiredTerm(capabilityId, term))
  ]);
  const missing = required.filter((term) => !containsContractTerm(normalized, term));
  if (missing.length > 0 && !satisfiesCapabilityAlternativeContract(capabilityId, normalized)) {
    throw new Error(`beauty_workflow_output_contract_failed:missing_${safeErrorToken(missing[0]!)}`);
  }
  const forbidden = (contract.forbiddenTerms ?? []).find((term) => containsForbiddenContractTerm(capabilityId, normalized, term));
  if (forbidden) throw new Error(`beauty_workflow_output_contract_failed:forbidden_${safeErrorToken(forbidden)}`);
}

function containsForbiddenContractTerm(capabilityId: string | undefined, answer: string, term: string): boolean {
  if (!containsContractTerm(answer, term)) return false;
  if (
    capabilityId !== "topic_inspiration"
    || !new Set(["完整内容执行包", "口播逐字稿", "拍摄脚本", "剪辑EDL"]).has(term)
  ) {
    return true;
  }
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clauses = answer
    .split(/[。；;\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.includes(term));
  return clauses.some((clause) => {
    if (new RegExp(`(?:不|未|没有|禁止)(?:生成|展开|输出|包含)?[^。；;\\n]{0,36}${escapedTerm}`).test(clause)) return false;
    if (new RegExp(`进入内容系统[^。；;\\n]{0,30}(?:生成|完成)[^。；;\\n]{0,12}${escapedTerm}`).test(clause)) return false;
    if (new RegExp(`${escapedTerm}[^。；;\\n]{0,24}(?:待后续|由内容系统|不在本页)`).test(clause)) return false;
    return true;
  });
}

function satisfiesCapabilityAlternativeContract(capabilityId: string | undefined, answer: string): boolean {
  if (capabilityId === "shooting_editing") {
    const videoContentTerms = [
      "视频基本信息", "现有版本诊断", "一、优化版选题定位", "二、优化版口播逐字稿", "三、优化版拍摄脚本",
      "四、拍摄注意事项", "五、优化版剪辑EDL", "六、优化版发布策略", "七、投流建议", "八、核心改进点"
    ];
    return videoContentTerms.every((term) => containsContractTerm(answer, term));
  }
  if (capabilityId !== "live_script") return false;
  const standardLiveScriptTerms = [
    "短结论", "场景识别", "直播目标", "开播前检查", "主播口播稿", "运营配合动作",
    "开场", "留人", "互动", "产品承接", "转化", "逼单", "下播后跟进", "合规提醒", "复盘指标"
  ];
  return standardLiveScriptTerms.every((term) => containsContractTerm(answer, term));
}

function isLiteralRequiredTerm(capabilityId: string | undefined, term: string): boolean {
  if (capabilityId === "beauty_xiaohongshu_package") {
    return !new Set(["事实母版", "画面方向", "逐张提示词"]).has(term);
  }
  return true;
}

function assertNoForeignModuleOrIndustry(capabilityId: string, answer: string, evidenceSource?: string): void {
  const foreignMatches = [...answer.matchAll(new RegExp(FOREIGN_INDUSTRY_OR_INTERNAL.source, "giu"))]
    .map((match) => match[0])
    .filter(Boolean);
  const unsupportedForeignMatch = foreignMatches.find((match) => !isSourceGroundedForeignEvidence(match, evidenceSource));
  if (unsupportedForeignMatch) {
    throw new Error("beauty_workflow_output_foreign_module_failed:foreign_industry_or_internal");
  }
  if (looksLikeCompletedForeignModule(capabilityId, answer)) {
    throw new Error("beauty_workflow_output_foreign_module_failed:other_capability_signature");
  }
}

function isSourceGroundedForeignEvidence(value: string, evidenceSource: string | undefined): boolean {
  if (!evidenceSource) return false;
  // Deterministic table reviews must quote the uploaded row titles faithfully.
  // A cross-industry term already present in that tenant-owned evidence is not
  // template pollution. Internal acceptance/tenant markers are never allowed.
  if (/(?:验收[AB]店|tenant(?:Id|Key)?)/iu.test(value)) return false;
  const normalize = (input: string) => normalizeAnswer(input).replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
  return normalize(evidenceSource).includes(normalize(value));
}

function assertCapabilityDeliverables(capabilityId: string, answer: string): void {
  if (capabilityId !== "beauty_xiaohongshu_package") return;
  parseBeautyXhsDelivery(answer, process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true");
  const titleBlock = extractSection(answer, "标题候选", "正文");
  const titleCount = (titleBlock.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:标题\s*)?[1-3一二三](?:[.、:：)）]\s*)/g) ?? []).length;
  if (titleCount < 3) throw new Error("beauty_workflow_output_contract_failed:xhs_deliverables_title_count");

  const tagBlock = extractSection(answer, "话题标签", "互动与承接");
  const tags = new Set(tagBlock.match(/#[^\s#，,；;]+/g) ?? []);
  if (tags.size < 5 || tags.size > 8) {
    throw new Error("beauty_workflow_output_contract_failed:xhs_deliverables_tag_count");
  }

  for (const term of ["正向视觉提示词", "负向提示词", "后期叠字", "视觉参数"]) {
    if (countOccurrences(answer, term) < 3) {
      throw new Error(`beauty_workflow_output_contract_failed:xhs_deliverables_${safeErrorToken(term)}_count`);
    }
  }
}

function assertTaskFactRetention(capabilityId: string, answer: string, taskFactSource: string | undefined): void {
  if (capabilityId !== "beauty_xiaohongshu_package" || !taskFactSource) return;
  const issues = inspectBeautyXhsTaskFactIssues(answer, taskFactSource);
  const contradiction = issues.find((issue) => issue.kind === "contradiction");
  if (contradiction) {
    throw new Error(`beauty_workflow_output_fact_contradiction:${safeErrorToken(contradiction.key)}`);
  }
  const missing = issues.find((issue) => issue.kind === "missing");
  if (missing) {
    throw new Error(`beauty_workflow_output_fact_retention_failed:${safeErrorToken(missing.key)}`);
  }
}

function extractSection(answer: string, start: string, end: string): string {
  const startIndex = answer.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = answer.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? answer.slice(startIndex + start.length) : answer.slice(startIndex + start.length, endIndex);
}

function countOccurrences(answer: string, term: string): number {
  return answer.split(term).length - 1;
}

function looksLikeCompletedForeignModule(capabilityId: string, answer: string): boolean {
  const normalized = normalizeAnswer(answer);
  return Object.entries(MODULE_FINGERPRINTS).some(([otherCapabilityId, terms]) => {
    if (otherCapabilityId === capabilityId) return false;
    if (capabilityId === "shooting_editing" && otherCapabilityId === "content_plan") {
      // The formal video-content review contract intentionally contains an
      // optimized script, shooting plan and EDL. Its own diagnosis and eight
      // review sections distinguish it from the content-ten workflow.
      return false;
    }
    if (capabilityId === "topic_inspiration" && otherCapabilityId === "content_plan") {
      // The topic workbench may name the next content-system deliverables in a
      // handoff sentence.  That is not the same as returning those sections.
      // Reuse the context-aware forbidden-term check so actual script/EDL
      // sections still fail closed.
      return terms.every((term) => containsForbiddenContractTerm(capabilityId, normalized, term));
    }
    return terms.every((term) => containsContractTerm(normalized, term));
  });
}

function containsContractTerm(answer: string, term: string): boolean {
  return answer.includes(normalizeAnswer(term));
}

function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeAnswer(value)).filter(Boolean))];
}

function safeErrorToken(value: string): string {
  return value.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 80);
}
