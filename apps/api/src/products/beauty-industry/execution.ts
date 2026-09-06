import { createHash } from "node:crypto";
import type { AgentRequest, AgentResponse, LlmProvider } from "@baolu/agent";
import { SKILL_MANIFESTS } from "@baolu/skills";
import type { BeautyIndustryExecutionResult } from "./mcp-adapter.js";
import { getRuntimeAgent, loadAgentRunReplay } from "../../services/agent-runtime.js";
import { beautyDeliveryModeQualityFlag, readBeautyDeliveryPreview } from "./structured-delivery.js";
import { persistChatResult } from "../../services/chat-persistence.js";
import { releaseCreditReservation, reserveCreditsBeforeProvider } from "../../services/credit-reservations.js";
import { invokeSkillViaGateway } from "../../services/mcp-client.js";
import type { RequestContext } from "../../services/request-context.js";
import { classifyRuntimeError } from "../../services/runtime-stage-trace.js";
import {
  buildBeautyIndustryRunInput,
  hasBeautyStructuredDataRecords,
  readBeautyIndustryProfileFromTenantData,
  type BeautyProfessionalOptions,
  type BeautyRunMode
} from "./profile.js";
import { buildBeautyWorkflowPrompt, getBeautyWorkflow } from "./workflows.js";
import { buildBeautyXhsTaskFactDirective } from "./xhs-task-facts.js";
import {
  BEAUTY_TEXT_BUDGET_VERSION,
  createBeautyTextBudgetedProvider
} from "./text-budget.js";
import { assertBeautyWorkflowRuntimeResult } from "./output-contract.js";
import {
  beautyRouteReceiptQualityFlags,
  buildBeautyRouteReceipt,
  type BeautyRouteReceipt
} from "./route-receipt.js";
import {
  applyBeautyTopicVerifiedBrief,
  assessBeautyTopicEvidence,
  type BeautyTopicWorkflowInput
} from "./topic-evidence.js";
import {
  BEAUTY_CONTENT_WORKFLOW_VERSION,
  buildBeautyContentWorkflowDirective,
  type BeautyContentWorkflowInput
} from "./content-workflow.js";
import {
  BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
  buildBeautyVideoContentWorkflowDirective,
  type BeautyVideoContentWorkflowInput
} from "./video-content-workflow.js";
import {
  BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION,
  buildBeautyLiveReviewWorkflowDirective,
  type BeautyLiveReviewWorkflowInput
} from "./live-review-workflow.js";
import { assertBeautyXhsTaskReady, buildBeautyXhsTaskSnapshot, buildBeautyXhsTaskSnapshotDirective } from "./xhs-task-snapshot.js";
import { assertBeautySalesProfessionalInput } from "./sales-workflow.js";
import {
  buildBeautyIndustryBrandCompositionReceipt,
  resolveBeautyIndustryBrandContext
} from "./brand-config.js";
import { createBeautyXhsStructuredOutputProvider } from "./xhs-provider-output.js";

export interface BeautyIndustryProductExecutionInput {
  context: RequestContext;
  agent: Awaited<ReturnType<typeof getRuntimeAgent>>;
  provider: LlmProvider;
  requestId: string;
  requestFingerprint: string;
  operatingEntityId: string;
  channel: "web" | "mcp";
  credentialId?: string;
  capabilityId: string;
  skillId: string;
  input: string;
  mode?: BeautyRunMode;
  professionalOptions?: BeautyProfessionalOptions;
  oneOffConfirmedFacts?: string;
  priorTaskContext?: { runId: string; capabilityId: string; output: string };
  topicWorkflow?: BeautyTopicWorkflowInput;
  contentWorkflow?: BeautyContentWorkflowInput;
  videoContentWorkflow?: BeautyVideoContentWorkflowInput;
  liveReviewWorkflow?: BeautyLiveReviewWorkflowInput;
  conversationId?: string;
  deviceScope: "desktop" | "mobile";
  signal?: AbortSignal;
}

export interface BeautyIndustryProductExecutionResult extends BeautyIndustryExecutionResult {
  conversationId?: string;
  skillId: string;
  capabilityId: string;
  abilityUsed: string;
  routeReceipt: BeautyRouteReceipt;
  structuredDelivery?: import("./structured-delivery.js").BeautyStructuredDelivery;
}

export async function executeBeautyIndustryProductTool(
  params: BeautyIndustryProductExecutionInput
): Promise<BeautyIndustryProductExecutionResult> {
  if (params.agent.id !== "agent_beauty_acquisition") throw new Error("beauty_product_agent_mismatch");
  const profile = readBeautyIndustryProfileFromTenantData(params.context.profile.data);
  const xhsTaskSnapshot = params.capabilityId === "beauty_xiaohongshu_package"
    ? buildBeautyXhsTaskSnapshot({
        question: params.input,
        profile,
        professionalOptions: params.professionalOptions,
        confirmedFacts: params.oneOffConfirmedFacts
      })
    : undefined;
  if (xhsTaskSnapshot) assertBeautyXhsTaskReady(xhsTaskSnapshot);
  const brandComposition = buildBeautyIndustryBrandCompositionReceipt(
    resolveBeautyIndustryBrandContext(params.context.profile.data)
  );
  const workflow = getBeautyWorkflow(params.capabilityId);
  if (workflow.primarySkillId !== params.skillId) throw new Error("beauty_workflow_skill_mismatch");
  if (params.capabilityId === "topic_inspiration" && !params.topicWorkflow) {
    throw new Error("beauty_topic_workflow_required");
  }
  if (params.capabilityId !== "topic_inspiration" && params.topicWorkflow) {
    throw new Error("beauty_topic_workflow_forbidden");
  }
  if (params.capabilityId === "content_plan" && !params.contentWorkflow) {
    throw new Error("beauty_content_workflow_required");
  }
  if (params.capabilityId !== "content_plan" && params.contentWorkflow) {
    throw new Error("beauty_content_workflow_forbidden");
  }
  if (params.capabilityId === "shooting_editing" && !params.videoContentWorkflow) {
    throw new Error("beauty_video_content_workflow_required");
  }
  if (params.capabilityId !== "shooting_editing" && params.videoContentWorkflow) {
    throw new Error("beauty_video_content_workflow_forbidden");
  }
  if (params.capabilityId === "live_review" && !params.liveReviewWorkflow) {
    throw new Error("beauty_live_review_workflow_required");
  }
  if (params.capabilityId !== "live_review" && params.liveReviewWorkflow) {
    throw new Error("beauty_live_review_workflow_forbidden");
  }
  if (params.capabilityId === "beauty_sales") {
    assertBeautySalesProfessionalInput(params.mode ?? "quick", params.professionalOptions);
  }
  if (workflow.evidenceMode === "structured_data" || workflow.evidenceMode === "parsed_video") {
    const parsedEvidence = workflow.evidenceMode === "parsed_video"
      ? [params.videoContentWorkflow?.visualEvidence, params.videoContentWorkflow?.sceneTimeline, params.videoContentWorkflow?.transcript].filter(Boolean).join("\n").trim()
      : params.professionalOptions?.parsedEvidence?.trim();
    const parseReady = workflow.evidenceMode === "parsed_video" ? Boolean(params.videoContentWorkflow && parsedEvidence) : params.professionalOptions?.parseStatus === "parsed";
    if (!parseReady || !parsedEvidence) {
      throw new Error(workflow.evidenceMode === "structured_data" ? "beauty_video_data_not_parsed" : "beauty_video_content_not_parsed");
    }
    if (workflow.evidenceMode === "structured_data" && !hasBeautyStructuredDataRecords(parsedEvidence)) {
      throw new Error("beauty_video_data_empty");
    }
  }
  const topicEvidence = params.topicWorkflow
    ? await assessBeautyTopicEvidence({
        context: params.context,
        agentId: params.agent.id,
        profile,
        workflow: params.topicWorkflow
      })
    : null;
  const workflowPrompt = await buildBeautyWorkflowPrompt(params.capabilityId);
  const liveReviewWorkflowDirective = params.liveReviewWorkflow
    ? buildBeautyLiveReviewWorkflowDirective(params.liveReviewWorkflow)
    : undefined;
  const effectiveInput = buildBeautyIndustryRunInput({
    question: liveReviewWorkflowDirective ? `${params.input}\n\n${liveReviewWorkflowDirective}` : params.input,
    profile,
    mode: params.mode ?? "quick",
    professionalOptions: params.professionalOptions,
    oneOffConfirmedFacts: params.oneOffConfirmedFacts
    ,xhsTaskFactDirective: params.capabilityId === "beauty_xiaohongshu_package"
      ? buildBeautyXhsTaskFactDirective({
          question: params.input,
          project: xhsTaskSnapshot?.project,
          audience: xhsTaskSnapshot?.audience,
          platform: params.professionalOptions?.platform
        })
      : undefined
    ,xhsTaskSnapshotDirective: params.capabilityId === "beauty_xiaohongshu_package"
      ? buildBeautyXhsTaskSnapshotDirective(xhsTaskSnapshot!)
      : undefined
    ,priorTaskContext: params.priorTaskContext
    ,topicEvidenceContext: topicEvidence?.directive
    ,contentWorkflowContext: params.contentWorkflow
      ? buildBeautyContentWorkflowDirective(params.contentWorkflow)
      : undefined
    ,videoContentWorkflowContext: params.videoContentWorkflow
      ? buildBeautyVideoContentWorkflowDirective(params.videoContentWorkflow)
      : undefined
  });
  const effectiveFingerprint = createHash("sha256").update(JSON.stringify({
    requestFingerprint: params.requestFingerprint,
    profileVersion: profile?.version ?? 0,
    profileConfirmedAt: profile?.confirmedAt ?? null,
    mode: params.mode ?? "quick",
    professionalOptions: params.professionalOptions ?? null
    ,topicWorkflow: params.topicWorkflow ?? null
    ,contentWorkflow: params.contentWorkflow ?? null
    ,contentWorkflowVersion: params.contentWorkflow ? BEAUTY_CONTENT_WORKFLOW_VERSION : null
    ,videoContentWorkflow: params.videoContentWorkflow ?? null
    ,videoContentWorkflowVersion: params.videoContentWorkflow ? BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION : null
    ,liveReviewWorkflow: params.liveReviewWorkflow ?? null
    ,liveReviewWorkflowVersion: params.liveReviewWorkflow ? BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION : null
    ,topicEvidence: topicEvidence ? {
      sourceCount: topicEvidence.sourceCount,
      qualifiedTranscriptIds: topicEvidence.qualifiedTranscriptIds,
      rejectedTranscriptIds: topicEvidence.rejectedTranscriptIds,
      videoReviewId: topicEvidence.videoReviewId ?? null
    } : null
    ,workflowVersion: workflowPrompt.version
    ,sourceRunId: params.priorTaskContext?.runId ?? null,
    brandComposition,
    sourceRunOutputHash: params.priorTaskContext?.output
      ? createHash("sha256").update(params.priorTaskContext.output).digest("hex")
      : null
  })).digest("hex");
  if (params.capabilityId === "beauty_xiaohongshu_package") {
    console.info(JSON.stringify({
      event: "beauty_xhs_route_selected",
      routeDecision: "fixed_product_capability",
      routeCode: "BEAUTY_WORKFLOWS.xiaohongshu",
      toolName: workflow.toolName,
      capabilityId: params.capabilityId,
      scope: workflow.scope,
      skillId: params.skillId,
      skillVersion: workflowPrompt.version,
      requestFingerprint: params.requestFingerprint.slice(0, 16),
      effectiveInputHash: createHash("sha256").update(effectiveInput).digest("hex").slice(0, 16),
      tenantHash: createHash("sha256").update(params.context.tenantId).digest("hex").slice(0, 16),
      parameterSchema: {
        questionPresent: Boolean(params.input.trim()),
        questionBytes: Buffer.byteLength(params.input, "utf8"),
        confirmedFactsPresent: Boolean(params.oneOffConfirmedFacts?.trim()),
        professionalOptionKeys: Object.keys(params.professionalOptions ?? {}).sort(),
        professionalOptionCount: Object.keys(params.professionalOptions ?? {}).length
      }
    }));
  }
  const replay = await loadAgentRunReplay(params.context, params.agent, params.requestId, effectiveFingerprint);
  if (replay) {
    const replayValidation = await assertBeautyWorkflowRuntimeResult({
      capabilityId: params.capabilityId,
      expectedSkillId: params.skillId as keyof typeof SKILL_MANIFESTS,
      expectedSkillVersion: workflowPrompt.version,
      result: replay,
      observedProviderOutputs: [],
      replay: true,
      taskFactSource: effectiveInput
    });
    const routeReceipt = buildBeautyRouteReceipt({
      channel: params.channel,
      toolName: workflow.toolName,
      capabilityId: params.capabilityId,
      scope: workflow.scope,
      skillChain: workflowPrompt.skillChain,
      provider: params.provider,
      parser: replayValidation.parser,
      fallbackUsed: replayValidation.fallbackUsed,
      requestId: params.requestId,
      tenantId: params.context.tenantId
    });
    return {
      status: replay.deliveryStatus === "needs_input" ? "clarification_required" : "succeeded",
      text: replay.answerText,
      runId: replay.agentRunId ?? params.requestId,
      creditCost: replay.creditCost,
      remainingCredits: replay.remainingCredits,
      conversationId: replay.conversationId,
      skillId: replay.skillId,
      capabilityId: replay.capabilityId ?? params.capabilityId,
      abilityUsed: workflow.displayName,
      routeReceipt
      ,structuredDelivery: params.capabilityId === "beauty_xiaohongshu_package"
        ? (await import("./xhs-delivery.js")).tryParseBeautyXhsDelivery(replay.answerText, readBeautyDeliveryPreview(replay.qualityFlags) ?? (process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true"))
        : params.capabilityId === "content_plan"
          ? (await import("./structured-delivery.js")).tryParseBeautyContentDelivery(replay.answerText, readBeautyDeliveryPreview(replay.qualityFlags) ?? (process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true"))
          : params.capabilityId === "beauty_sales"
            ? (await import("./structured-delivery.js")).tryParseBeautySalesDelivery(replay.answerText, readBeautyDeliveryPreview(replay.qualityFlags) ?? (process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true"), params.mode === "professional" ? "professional_advice" : "quick_response")
          : undefined
    };
  }

  const manifest = SKILL_MANIFESTS[params.skillId as keyof typeof SKILL_MANIFESTS];
  if (!manifest) throw new Error("skill_not_allowed");
  const budgetedProvider = workflow.evidenceMode === "structured_data"
    ? createEvidenceOnlyProvider(params.provider)
    : createBeautyTextBudgetedProvider(params.provider, params.capabilityId, params.skillId);
  const outputAdaptedProvider = params.capabilityId === "beauty_xiaohongshu_package"
    && params.provider.name.trim().toLowerCase() === "deepseek"
    && process.env.LLM_MOCK_MODE !== "true"
    && process.env.USE_MOCK_LLM !== "true"
    ? createBeautyXhsStructuredOutputProvider(budgetedProvider, {
        onAccepted(diagnostic) {
          console.info(JSON.stringify({
            event: "beauty_xhs_provider_output_adapted",
            capabilityId: params.capabilityId,
            scope: workflow.scope,
            skillId: params.skillId,
            skillVersion: workflowPrompt.version,
            provider: params.provider.name,
            requestFingerprint: params.requestFingerprint.slice(0, 16),
            tenantHash: createHash("sha256").update(params.context.tenantId).digest("hex").slice(0, 16),
            ...diagnostic
          }));
        },
        onRejected(diagnostic) {
          console.warn(JSON.stringify({
            event: "beauty_xhs_provider_output_rejected",
            capabilityId: params.capabilityId,
            scope: workflow.scope,
            skillId: params.skillId,
            skillVersion: workflowPrompt.version,
            provider: params.provider.name,
            requestFingerprint: params.requestFingerprint.slice(0, 16),
            tenantHash: createHash("sha256").update(params.context.tenantId).digest("hex").slice(0, 16),
            ...diagnostic
          }));
        }
      })
    : budgetedProvider;
  const providerObservation = createObservedProvider(outputAdaptedProvider);
  const billingContext = {
    productCode: "beauty-industry",
    operatingEntityId: params.operatingEntityId,
    channel: params.channel,
    ...(params.credentialId ? { credentialId: params.credentialId } : {})
  } as const;
  const reservation = await reserveCreditsBeforeProvider({
    context: params.context,
    billing: billingContext,
    requestId: params.requestId,
    requestFingerprint: effectiveFingerprint,
    capabilityId: params.capabilityId,
    provider: params.provider.name,
    amount: manifest.baseCreditCost
  });
  let xhsProductResultTrace: { answerText?: string; qualityFlags?: string[] } | undefined;
  try {
    const result = await invokeSkillViaGateway({
      requestId: params.requestId,
      requestFingerprint: effectiveFingerprint,
      context: params.context,
      provider: createNoPaidRetryProvider(providerObservation.provider),
      agentId: params.agent.id,
      capabilityId: params.capabilityId,
      skillId: params.skillId,
      input: effectiveInput,
      // A fixed product tool may continue a business task only through the
      // explicit priorTaskContext assembled by this product. Loading a whole
      // cross-capability chat here lets stale module text outrank the selected
      // entry even though the capability metadata remains locked.
      conversationId: undefined,
      channel: params.channel === "mcp" ? "workbuddy" : "h5",
      deviceScope: params.deviceScope,
      routingSource: "capability",
      capabilityLocked: true,
      promptCompositionPolicy: "locked_product_workflow",
      // Required inputs for locked beauty tools are validated by the product
      // route and capability-specific workflow schemas before reservation.
      // The generic Agent clarification fast paths are cross-product helpers
      // (for example, the enterprise content-plan questions) and must not
      // intercept a fixed beauty workflow. The formal beauty output contract
      // still rejects placeholders or incomplete fixtures after generation.
      deliveryPolicy: params.capabilityId === "content_plan" ? "draft_with_placeholders" : "clarify",
      skillPromptOverride: workflowPrompt.prompt,
      skillVersionOverride: workflowPrompt.version,
      providerPolicyVersion: BEAUTY_TEXT_BUDGET_VERSION,
      persist: false,
      signal: params.signal
    });
    if (result.providerFailure) throw new Error(`provider_failure:${result.providerFailure.code}`);
    const productResult = params.topicWorkflow
      ? applyBeautyTopicVerifiedBrief(result, params.topicWorkflow)
      : result;
    if (params.capabilityId === "beauty_xiaohongshu_package") {
      xhsProductResultTrace = { answerText: productResult.answerText, qualityFlags: productResult.qualityFlags };
    }
    const validation = await assertBeautyWorkflowRuntimeResult({
      capabilityId: params.capabilityId,
      expectedSkillId: params.skillId as keyof typeof SKILL_MANIFESTS,
      expectedSkillVersion: workflowPrompt.version,
      result: productResult,
      observedProviderOutputs: providerObservation.outputs,
      replay: false,
      taskFactSource: effectiveInput
    });
    const routeReceipt = buildBeautyRouteReceipt({
      channel: params.channel,
      toolName: workflow.toolName,
      capabilityId: params.capabilityId,
      scope: workflow.scope,
      skillChain: workflowPrompt.skillChain,
      provider: params.provider,
      parser: validation.parser,
      fallbackUsed: validation.fallbackUsed,
      requestId: params.requestId,
      tenantId: params.context.tenantId
    });
    const auditedQualityFlags = [...new Set([
      ...productResult.qualityFlags,
      ...beautyRouteReceiptQualityFlags(routeReceipt),
      ...(validation.structuredDelivery ? [beautyDeliveryModeQualityFlag(validation.structuredDelivery)] : [])
    ])];

    const agentResponse: AgentResponse = {
      skillId: productResult.skillId as AgentResponse["skillId"],
      skillVersion: productResult.skillVersion,
      tenantType: params.context.profile.tenantType,
      answer: productResult.answerText,
      creditCost: productResult.creditCost,
      qualityFlags: auditedQualityFlags,
      analysisMode: productResult.analysisMode,
      deliveryStatus: productResult.deliveryStatus === "needs_input" ? "needs_input" : "completed",
      analysisBrief: productResult.analysisBrief
    };
    const persisted = await persistChatResult({
      context: params.context,
      input: effectiveInput,
      result: agentResponse,
      provider: params.provider,
      channel: params.channel === "mcp" ? "workbuddy" : "h5",
      conversationId: params.conversationId,
      deviceScope: params.deviceScope,
      agentId: params.agent.id,
      capabilityId: params.capabilityId,
      requestId: params.requestId,
      requestFingerprint: effectiveFingerprint,
      mcpCallId: productResult.mcpCallId,
      billingContext,
      billingReservationId: reservation?.id,
      routingSource: "capability"
    });
    if (!persisted.agentRunId) throw new Error("beauty_product_run_not_persisted");
    return {
      status: productResult.deliveryStatus === "needs_input" ? "clarification_required" : "succeeded",
      text: productResult.answerText,
      runId: persisted.agentRunId,
      creditCost: productResult.creditCost,
      remainingCredits: persisted.remainingCredits,
      conversationId: persisted.conversationId,
      skillId: productResult.skillId,
      capabilityId: params.capabilityId,
      abilityUsed: workflow.displayName,
      routeReceipt,
      structuredDelivery: validation.structuredDelivery
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown";
    if (errorMessage.startsWith("beauty_workflow_output_")) {
      const xhsTrace = params.capabilityId === "beauty_xiaohongshu_package"
        ? buildBeautyXhsSafeContractTrace(xhsProductResultTrace)
        : undefined;
      console.warn(JSON.stringify({
        event: "beauty_workflow_output_rejected",
        channel: params.channel,
        capabilityId: params.capabilityId,
        scope: workflow.scope,
        skillId: params.skillId,
        skillVersion: workflowPrompt.version,
        constraintVersions: workflowPrompt.skillChain.slice(1),
        provider: params.provider.name,
        parser: "beauty-workflow-output-v1",
        contractRule: errorMessage.slice(0, 160),
        requestFingerprint: params.requestFingerprint.slice(0, 16),
        tenantHash: createHash("sha256").update(params.context.tenantId).digest("hex").slice(0, 16),
        ...(xhsTrace ? { outputTrace: xhsTrace } : {})
      }));
    }
    await releaseCreditReservation(reservation?.id, classifyRuntimeError(error));
    throw error;
  }
}

function buildBeautyXhsSafeContractTrace(result: { answerText?: string; qualityFlags?: string[] } | undefined): Record<string, unknown> | undefined {
  if (!result?.answerText) return undefined;
  const answer = result.answerText;
  return {
    responseHash: createHash("sha256").update(answer).digest("hex"),
    responseBytes: Buffer.byteLength(answer, "utf8"),
    titleCount: answer.match(/^\s*(?:[1-3一二三])[.、:：)）]\s*\S.+$/gm)?.length ?? 0,
    tagCount: new Set(answer.match(/#[^\s#，,；;]+/g) ?? []).size,
    imageDirectionCount: answer.match(/^###\s+配图方向(?:一|二|三)｜/gm)?.length ?? 0,
    customerLayerPresent: /(?:^|\n)##\s+客户可复制成品\s*(?:\n|$)/.test(answer),
    productionLayerPresent: /(?:^|\n)##\s+门店制作说明\s*(?:\n|$)/.test(answer),
    auditLayerPresent: /(?:^|\n)##\s+质量与合规检查\s*(?:\n|$)/.test(answer),
    blockingQualityFlags: (result.qualityFlags ?? []).filter((flag) => /^(?:rubric_[a-z_]+|too_short|provider_fallback_used)$/.test(flag))
  };
}

function createObservedProvider(provider: LlmProvider): { provider: LlmProvider; outputs: string[] } {
  const outputs: string[] = [];
  const providerWithModel = provider as LlmProvider & {
    getModel?: () => string;
    preflightAgentRequest?: (request: AgentRequest) => Promise<void>;
  };
  return {
    outputs,
    provider: {
      name: provider.name,
      ...(providerWithModel.getModel ? { getModel: () => providerWithModel.getModel!() } : {}),
      ...(providerWithModel.preflightAgentRequest
        ? { preflightAgentRequest: (request: AgentRequest) => providerWithModel.preflightAgentRequest!(request) }
        : {}),
      async complete(messages, options) {
        const answer = await provider.complete(messages, options);
        outputs.push(answer);
        return answer;
      }
    } as LlmProvider
  };
}

function createEvidenceOnlyProvider(provider: LlmProvider): LlmProvider {
  const providerWithModel = provider as LlmProvider & { getModel?: () => string };
  return {
    name: provider.name,
    ...(providerWithModel.getModel ? { getModel: () => providerWithModel.getModel!() } : {}),
    async complete() {
      throw new Error("beauty_video_data_provider_forbidden");
    }
  } as LlmProvider;
}

function createNoPaidRetryProvider(provider: LlmProvider): LlmProvider {
  let terminalError: unknown;
  const providerWithModel = provider as LlmProvider & {
    getModel?: () => string;
    preflightAgentRequest?: (request: AgentRequest) => Promise<void>;
  };
  return {
    name: provider.name,
    ...(providerWithModel.getModel ? { getModel: () => providerWithModel.getModel!() } : {}),
    ...(providerWithModel.preflightAgentRequest
      ? { preflightAgentRequest: (request: AgentRequest) => providerWithModel.preflightAgentRequest!(request) }
      : {}),
    async complete(messages, options) {
      if (terminalError) throw terminalError;
      try {
        return await provider.complete(messages, options);
      } catch (error) {
        terminalError = error;
        throw error;
      }
    }
  } as LlmProvider;
}
