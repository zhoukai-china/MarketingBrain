import { createHash } from "node:crypto";
import type { LlmMessage, LlmProvider, ProviderFailureInfo } from "@baolu/agent";
import type { AgentReasoningProfile } from "@baolu/shared";
import { assertHighCapabilityLlmModel } from "./llm-model-policy.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export interface DomesticChatProviderOptions {
  providerName: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  domesticNetworkOnly: boolean;
  allowedHosts: string[];
  temperature?: number;
  streamTemperature?: number;
  onUsage?: (usage: DomesticProviderUsageObservation) => void;
  assertModelAllowed?: (model: string) => void;
}

export class DomesticProviderTerminalError extends Error {
  constructor(providerName: string, public readonly providerFailure: ProviderFailureInfo) {
    super(`${providerName}_provider_${providerFailure.code}`);
    this.name = "DomesticProviderTerminalError";
  }
}

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; reasoning_content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

export interface DomesticProviderUsageObservation {
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export function readDomesticProviderUsage(data: unknown): DomesticProviderUsageObservation | undefined {
  if (!data || typeof data !== "object") return undefined;
  const response = data as ChatCompletionResponse;
  const finishReason = normalizeFinishReason(response.choices?.[0]?.finish_reason);
  const promptTokens = safeTokenCount(response.usage?.prompt_tokens);
  const completionTokens = safeTokenCount(response.usage?.completion_tokens);
  if (!finishReason || promptTokens === undefined || completionTokens === undefined) return undefined;
  const reasoningTokens = safeTokenCount(response.usage?.completion_tokens_details?.reasoning_tokens) ?? 0;
  const totalTokens = safeTokenCount(response.usage?.total_tokens) ?? promptTokens + completionTokens;
  return { finishReason, promptTokens, completionTokens, reasoningTokens, totalTokens };
}

export function parseChatCompletionResponse(providerName: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    throw new DomesticProviderTerminalError(providerName, { code: "invalid_response" });
  }
  const response = data as ChatCompletionResponse;
  const choice = response.choices?.[0];
  if (!choice?.message) {
    throw new DomesticProviderTerminalError(providerName, { code: "invalid_response" });
  }
  const finishReason = normalizeFinishReason(choice.finish_reason);
  const content = typeof choice.message.content === "string" ? choice.message.content : "";
  if (finishReason === "length") {
    const usage = response.usage;
    throw new DomesticProviderTerminalError(providerName, {
      code: "output_token_limit",
      finishReason,
      hasReasoningContent: Boolean(choice.message.reasoning_content?.trim()),
      ...(safeTokenCount(usage?.prompt_tokens) !== undefined ? { promptTokens: safeTokenCount(usage?.prompt_tokens) } : {}),
      ...(safeTokenCount(usage?.completion_tokens) !== undefined ? { completionTokens: safeTokenCount(usage?.completion_tokens) } : {}),
      ...(safeTokenCount(usage?.completion_tokens_details?.reasoning_tokens) !== undefined ? { reasoningTokens: safeTokenCount(usage?.completion_tokens_details?.reasoning_tokens) } : {})
    });
  }
  if (content.trim()) return content;
  const usage = response.usage;
  const promptTokens = safeTokenCount(usage?.prompt_tokens);
  const completionTokens = safeTokenCount(usage?.completion_tokens);
  const reasoningTokens = safeTokenCount(usage?.completion_tokens_details?.reasoning_tokens);
  throw new DomesticProviderTerminalError(providerName, {
    code: classifyEmptyFinal(finishReason),
    ...(finishReason ? { finishReason } : {}),
    hasReasoningContent: Boolean(choice.message.reasoning_content?.trim()),
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
  });
}

function normalizeFinishReason(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:stop|length|content_filter|tool_calls|insufficient_system_resource)$/.test(value)
    ? value
    : undefined;
}

function classifyEmptyFinal(finishReason: string | undefined): ProviderFailureInfo["code"] {
  if (finishReason === "length") return "output_token_limit";
  if (finishReason === "content_filter") return "content_filtered";
  if (finishReason === "tool_calls") return "unexpected_tool_call";
  if (finishReason === "insufficient_system_resource") return "upstream_capacity";
  return "empty_final";
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function buildChatCompletionPayload(params: {
  providerName: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  reasoningProfile?: AgentReasoningProfile;
  thinkingMode?: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
  maxTokens?: number;
  responseFormat?: "json_object";
}): Record<string, unknown> {
  return {
    model: params.model,
    messages: params.messages,
    ...(params.providerName === "aliyun" && params.thinkingMode
      ? {
          enable_thinking: params.thinkingMode === "enabled",
          preserve_thinking: false,
        }
      : {}),
    ...(params.providerName === "deepseek" && params.thinkingMode
      ? { thinking: { type: params.thinkingMode } }
      : {}),
    ...(params.providerName === "deepseek" && params.reasoningEffort
      ? { reasoning_effort: params.reasoningEffort }
      : {}),
    ...(params.providerName === "deepseek" && params.thinkingMode === "enabled"
      ? {}
      : {
          temperature: params.reasoningProfile === "deep"
            ? Math.min(params.temperature ?? 0.35, 0.2)
            : params.temperature ?? 0.3
        }),
    ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    ...((params.providerName === "deepseek" || params.providerName === "aliyun") && params.responseFormat
      ? { response_format: { type: params.responseFormat } }
      : {})
  };
}

export class DomesticChatProvider implements LlmProvider {
  readonly name: string;

  constructor(private readonly options: DomesticChatProviderOptions) {
    this.name = options.providerName;
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey && this.options.baseUrl);
  }

  getModel(): string {
    return this.options.model;
  }

  async complete(
    messages: LlmMessage[],
    requestOptions?: {
      signal?: AbortSignal;
      reasoningProfile?: AgentReasoningProfile;
      thinkingMode?: "enabled" | "disabled";
      reasoningEffort?: "low" | "high" | "max";
      maxTokens?: number;
      responseFormat?: "json_object";
    }
  ): Promise<string> {
    (this.options.assertModelAllowed ?? assertHighCapabilityLlmModel)(this.options.model);
    const controlledMockInput = messages.map((message) => message.content).join("\n\n");

    if (shouldUseDemoFallback()) {
      return buildMockReply(controlledMockInput);
    }

    if (!this.isConfigured()) {
      throw new Error(`${this.name}_provider_not_configured`);
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(requestOptions?.signal?.reason);
    if (requestOptions?.signal?.aborted) abortFromParent();
    else requestOptions?.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const endpoint = buildChatCompletionsUrl(this.options.baseUrl!);
    const endpointUrl = new URL(endpoint);
    const requestStartedAt = Date.now();
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify([this.options.model, messages]))
      .digest("hex")
      .slice(0, 16);
    const endpointTrace = {
      targetHostHash: createHash("sha256").update(endpointUrl.host).digest("hex").slice(0, 16),
      targetPathHash: createHash("sha256").update(endpointUrl.pathname).digest("hex").slice(0, 16)
    };
    let terminalTraceEmitted = false;

    try {
      assertOutboundUrlAllowed(this.name, this.options.baseUrl!, {
        domesticNetworkOnly: this.options.domesticNetworkOnly,
        allowedHosts: this.options.allowedHosts
      });
      console.info(JSON.stringify({
        event: "domestic_provider_request_started",
        selectedProvider: this.name,
        selectedModel: this.options.model,
        requestFingerprint,
        ...endpointTrace
      }));
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify(buildChatCompletionPayload({
          providerName: this.name,
          model: this.options.model,
          messages,
          temperature: this.options.temperature,
          reasoningProfile: requestOptions?.reasoningProfile,
          thinkingMode: requestOptions?.thinkingMode,
          reasoningEffort: requestOptions?.reasoningEffort,
          maxTokens: requestOptions?.maxTokens,
          responseFormat: requestOptions?.responseFormat
        }))
      });

      if (!response.ok) {
        terminalTraceEmitted = true;
        console.warn(JSON.stringify({
          event: "domestic_provider_request_finished",
          selectedProvider: this.name,
          selectedModel: this.options.model,
          requestFingerprint,
          ...endpointTrace,
          httpStatus: response.status,
          elapsedMs: Math.max(0, Date.now() - requestStartedAt),
          terminalCode: "http_error"
        }));
        await response.body?.cancel().catch(() => undefined);
        throw new DomesticProviderTerminalError(this.name, { code: "http_error", httpStatus: response.status });
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new DomesticProviderTerminalError(this.name, { code: "invalid_json" });
      }
      const usage = readDomesticProviderUsage(data);
      const responseEnvelope = JSON.stringify(data);
      terminalTraceEmitted = true;
      console.info(JSON.stringify({
        event: "domestic_provider_request_finished",
        selectedProvider: this.name,
        selectedModel: this.options.model,
        requestFingerprint,
        ...endpointTrace,
        httpStatus: response.status,
        elapsedMs: Math.max(0, Date.now() - requestStartedAt),
        responseHash: createHash("sha256").update(responseEnvelope).digest("hex"),
        responseBytes: Buffer.byteLength(responseEnvelope, "utf8"),
        finishReason: usage?.finishReason ?? "unknown"
      }));
      if (usage) {
        this.options.onUsage?.(usage);
        console.info(JSON.stringify({
          event: "domestic_provider_usage",
          selectedProvider: this.name,
          selectedModel: this.options.model,
          requestFingerprint,
          ...usage
        }));
      }
      return parseChatCompletionResponse(this.name, data);
    } catch (error) {
      if (!terminalTraceEmitted) {
        console.warn(JSON.stringify({
          event: "domestic_provider_request_finished",
          selectedProvider: this.name,
          selectedModel: this.options.model,
          requestFingerprint,
          ...endpointTrace,
          elapsedMs: Math.max(0, Date.now() - requestStartedAt),
          terminalCode: safeProviderTraceCode(error)
        }));
      }
      if (error instanceof DomesticProviderTerminalError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        if (requestOptions?.signal?.aborted) {
          const cancelled = new DomesticProviderTerminalError(this.name, { code: "cancelled" });
          cancelled.name = "AbortError";
          throw cancelled;
        }
        throw new DomesticProviderTerminalError(this.name, { code: "timed_out" });
      }
      if (shouldUseDemoFallback()) {
        return buildMockReply(controlledMockInput);
      }
      throw new DomesticProviderTerminalError(this.name, { code: "transport_error" });
    } finally {
      clearTimeout(timeout);
      requestOptions?.signal?.removeEventListener("abort", abortFromParent);
    }
  }

  async streamComplete(
    messages: LlmMessage[],
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    (this.options.assertModelAllowed ?? assertHighCapabilityLlmModel)(this.options.model);
    const controlledMockInput = messages.map((message) => message.content).join("\n\n");

    if (shouldUseDemoFallback()) {
      const mock = buildMockReply(controlledMockInput);
      await emitTextInChunks(mock, onDelta);
      return mock;
    }

    if (!this.isConfigured()) {
      throw new Error(`${this.name}_provider_not_configured`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      assertOutboundUrlAllowed(this.name, this.options.baseUrl!, {
        domesticNetworkOnly: this.options.domesticNetworkOnly,
        allowedHosts: this.options.allowedHosts
      });
      const response = await fetch(buildChatCompletionsUrl(this.options.baseUrl!), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          temperature: this.options.streamTemperature ?? this.options.temperature ?? 0.3,
          stream: true
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.name} stream request failed: ${response.status} ${body.slice(0, 500)}`);
      }
      if (!response.body) {
        throw new Error(`${this.name} stream response did not include a body`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;
          fullText += delta;
          await onDelta(delta);
        }
      }

      if (!fullText) {
        if (shouldUseDemoFallback()) {
          const mock = buildMockReply(controlledMockInput);
          await emitTextInChunks(mock, onDelta);
          return mock;
        }
        throw new Error(`${this.name} stream did not include message content`);
      }
      return fullText;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${this.name} request timed out after ${this.options.timeoutMs}ms`);
      }
      if (shouldUseDemoFallback()) {
        const mock = buildMockReply(controlledMockInput);
        await emitTextInChunks(mock, onDelta);
        return mock;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeProviderTraceCode(error: unknown): string {
  if (error instanceof DomesticProviderTerminalError) return error.providerFailure.code;
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "transport_error";
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function shouldUseDemoFallback(): boolean {
  return process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true";
}

function buildMockReply(_userInput: string): string {
  const lockedBeautyCapability = /【固定美业能力】([a-z_]+)/.exec(_userInput)?.[1];
  if (lockedBeautyCapability === "beauty_business_qa") {
    return [
      "## 先给结论",
      "先把今天最影响结果的一环做成可观察的小动作，不用一次改完所有经营环节。当前是流程预览，只验证问答、历史和事实边界，不代表真实模型质量。",
      "",
      "## 今天先做",
      "1. 从最近真实咨询里选一个最常见的问题，记录顾客原话和最终是否预约。",
      "2. 只调整一处回复：先回应顾虑，再问一个能推进判断的问题；当天由门店负责人检查执行情况。",
      "3. 明天按咨询数、有效回复数和预约数复盘；样本不足时只记录现象，不写成因果。",
      "",
      "## 可以直接使用",
      "给员工的执行清单：今天每次咨询都记录“顾客原话—我们的回复—下一步动作—是否预约”，下班前汇总，不补写没有发生的结果。",
      "",
      "## 仍需确认",
      "要进一步做成门店专属方案，下一步只需补充最常见的一句顾客原话；价格、疗效、顾客案例和经营业绩没有证据时不进入建议。"
    ].join("\n");
  }
  if (lockedBeautyCapability === "beauty_xiaohongshu_package") {
    const taskFacts = extractControlledXhsTaskFacts(_userInput);
    const timeContext = taskFacts.time_context;
    const serviceProject = taskFacts.service_project ?? "日常皮肤管理";
    const geography = taskFacts.audience_geography ?? "附近";
    const targetAudience = taskFacts.target_audience ?? "女性顾客";
    const audiencePhrase = `${geography}${targetAudience}`;
    const projectTag = serviceProject.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "") || "日常护理";
    return [
      "## 客户可复制成品",
      "### 标题候选",
      `1. ${audiencePhrase}了解${serviceProject}，先看这3点`,
      `2. 想了解${serviceProject}，先把这几个问题问清楚`,
      `3. ${serviceProject}怎么选？${audiencePhrase}先别急着跟风`,
      "",
      "### 正文",
      `最近想了解${serviceProject}，又担心跟风选择不适合自己？${audiencePhrase}可以先从三个方面了解：服务主要解决什么日常需求、体验流程包含哪些环节、日常护理习惯需要怎样配合。选择前先说清自己的关注点，再听门店介绍具体流程和适用边界，比只看一句效果描述更有参考价值。皮肤状态和护理需求因人而异，内容只帮助你整理到店前的问题，不替代专业判断，也不承诺护理效果。`,
      "",
      "### 话题标签",
      `#日常皮肤管理 #${projectTag} #附近生活 #女性护理 #到店前攻略 #小红书图文`,
      "",
      "### 互动与承接",
      "你最想先了解服务流程、适用边界，还是日常护理建议？欢迎留言说说你的关注点。",
      "",
      "## 门店制作说明",
      "### 配图方向一｜封面图",
      "#### 正向视觉提示词",
      "干净的护理用品静物，3:4 竖版封面，主体居中并预留顶部标题安全区，柔和自然光，米白与浅绿色，真实克制的生活美容内容质感。",
      "#### 负向提示词",
      "真人正脸，疗效文字，价格，案例，医疗器械，品牌商标，二维码，乱码中文。",
      "#### 后期叠字",
      `${serviceProject}｜到店前先看这3点`,
      "#### 视觉参数",
      "3:4 竖版，1080×1440 参考尺寸，主体居中，顶部与底部各保留 12% 安全区。",
      "",
      "### 配图方向二｜内容图",
      "#### 正向视觉提示词",
      "无人物的整洁护理空间局部，纵深引导线与充分留白，温暖漫射光，奶油白与低饱和木色，呈现日常护理用品和舒适氛围。",
      "#### 负向提示词",
      "虚构门店招牌，顾客，医疗器械，治疗效果对比，价格，促销信息，二维码，乱码中文。",
      "#### 后期叠字",
      "先了解需求·流程·边界",
      "#### 视觉参数",
      "3:4 竖版，中景构图，左右各保留 10% 文案安全区，暖色漫射光。",
      "",
      "### 配图方向三｜互动承接图",
      "#### 正向视觉提示词",
      "皮肤管理问题卡的无人物视觉，三段式层级，清透水感与纸张肌理，右侧预留互动问题安全区，中文标题仅供后期叠加。",
      "#### 负向提示词",
      "模型直接绘制中文，夸大效果，对比案例，二维码，电话，未确认预约入口，乱码中文。",
      "#### 后期叠字",
      "你最想先了解哪一项？",
      "#### 视觉参数",
      "3:4 竖版，三段式信息层级，右侧保留 30% 互动文案安全区，清透低饱和配色。",
      "",
      "## 质量与合规检查",
      "### 任务事实回执",
      `- 季节/时点：${timeContext ?? "本次未提供；未进入客户成品"}`,
      `- 服务项目：${serviceProject}`,
      `- 地理范围：${geography}`,
      `- 目标顾客：${targetAudience}`,
      `- 平台：${taskFacts.platform ?? "小红书"}`,
      `- 交付形式：${taskFacts.deliverable ?? "图文"}`,
      "### 事实与合规待补",
      "门店名称、城市、具体服务步骤、项目适用边界、素材授权、预约方式和价格未随本次任务确认。客户成品没有补造这些信息；不得虚构顾客案例、效果对比、疗效、成交数据或门店实景。"
    ].join("\n");
  }

  if (lockedBeautyCapability === "topic_inspiration") {
    return buildControlledTopicReply(_userInput);
  }

  if (lockedBeautyCapability === "content_plan") {
    return buildControlledContentPlanReply(_userInput);
  }

  if (lockedBeautyCapability === "video_data_review") {
    return buildControlledVideoDataReply();
  }

  if (lockedBeautyCapability === "shooting_editing") {
    return [
      "## 视频基本信息",
      "仅引用正式输入中的平台、标题、目标与已确认素材。口播证据和画面证据分别列出，未提供的平台数据不进入本报告；账号、价格和案例缺失只作为审核信息，不改写成已确认事实。",
      "## 现有版本诊断",
      "只依据用户确认的画面证据与口播转写，不把元数据预检冒充内容理解。逐项核对开场信息、主题一致性、证据支撑、节奏和承接；没有画面或原话支持的判断不进入诊断。",
      "## 一、优化版选题定位",
      "围绕已确认目标人群和业务目标收紧一个主题，用一个具体问题作为开场，再用已确认服务事实解释。定位只说明这条视频要帮助谁理解什么，不承诺播放、完播或转化提升。",
      "## 二、优化版口播逐字稿",
      "开头说明已确认问题，中段使用已确认服务事实，结尾给出可撤回的咨询动作。口播使用自然短句，不虚构顾客经历、门店效果或平台反馈；涉及个体情况时明确需要结合真实情况判断。",
      "## 三、优化版拍摄脚本",
      "按现有画面证据安排主体、景别和动作：开场保留最清楚的问题画面，中段用已授权细节支撑口播，结尾回到出镜者完成互动承接。不存在的空间、人物或产品镜头不得补造。",
      "## 四、拍摄注意事项",
      "核对素材授权、人物入镜和事实边界，禁止未确认价格、案例或疗效。收音需清楚，字幕需与真实口播逐字核对；顾客肖像、门店标识和品牌素材没有授权时不使用。",
      "## 五、优化版剪辑EDL",
      "字幕与口播保持一致，删除无信息停顿，不编造不存在的画面。剪辑只调整顺序、停顿和信息密度；每次只改变一个主要变量，保留可与原版对照的测试记录。",
      "## 六、优化版发布策略",
      "发布前复核标题、正文、授权和平台规则；未提供后台数据时不推断最佳时段。发布文案只概括视频真实内容，互动问题保持一个，预约或联系方式没有确认时不自动补写。",
      "## 七、投流建议",
      "没有真实自然流量和转化数据时只列观察指标，不建议直接付费放量。先观察播放、完播、互动和有效咨询，数据口径统一后再决定是否申请独立投流测试。",
      "## 八、核心改进点",
      "先按口播、画面、节奏、承接逐项验证：主题是否一致、每个判断是否有证据、字幕是否忠于原话、结尾是否只有一个动作。流程预览不自动发布或投放，也不把预检状态包装成已理解视频。"
    ].join("\n");
  }

  if (lockedBeautyCapability === "live_script") {
    return buildControlledLiveScriptReply();
  }

  if (lockedBeautyCapability === "live_review") {
    return [
      "直播数据复盘报告（受控测试输出）",
      "## 一、核心数据速览",
      "证据：当前只承认正式输入中逐项提供的数据；未提供的场观、停留、互动、咨询、预约、到店、订单和成交统一列为数据缺口，不补零、不估算。判断：若本轮没有后台数值，本模块只完成字段审计，不能形成高低结论。原因边界：当前测试输出不连接任何平台，也不读取其他场次。下次动作：负责人为运营，从当前平台后台导出单场数据，验收指标为字段名、数值、单位和时间粒度可同时核对。待核实：不同后台字段是否采用同一统计周期。",
      "## 二、流量诊断",
      "证据：仅使用正式输入中存在的曝光、进房、在线峰值与停留字段。判断：缺少这些字段时不能区分流量入口问题和进房后承接问题。原因边界：不把转写中的主观表达当作平台流量数据，也不把相关性写成因果。下次动作：负责人为运营，补导分时流量和停留数据；验收指标为至少能够按同一时间粒度对齐。待核实：是否存在付费流量及其独立口径。",
      "## 三、转化归因",
      "证据：咨询、私信、预约、到店、订单或成交必须在输入中有明确口径。判断：没有口径时只记录数据缺口，不输出转化率、ROI 或成交原因。原因边界：主播原话中的经营数字只视为待核实陈述。下次动作：负责人为门店运营，定义本场有效咨询与预约口径；验收指标为每个转化字段能追溯到台账或平台记录。",
      "## 四、互动诊断",
      "证据：只依据输入中的评论、提问、点赞、分享或分时互动记录。判断：没有互动记录时不能判断观众兴趣点或顾客顾虑。原因边界：不得编造评论内容、顾客身份和反馈。下次动作：负责人为场控，按时间点脱敏记录高频问题；验收指标为每类问题包含出现时段和真实来源。",
      "## 五、话术执行对照表",
      "证据：只有原话术计划与真实转写同时存在时，才对照计划、实际表达和偏差；只有转写时仅复盘实际表达。判断：缺一类证据就降级，不虚构主播原话。原因边界：没有同粒度时间轴时不声称某句话直接导致某项数据变化。待核实：转写时间戳与后台分时数据是否可对齐。下次动作：负责人为主播与场控，保存开播前版本和带时间戳转写；验收指标为关键环节均可逐段核对。",
      "## 六、人货场诊断",
      "证据：人、项目与场景判断只接受用户确认的画面证据和项目事实。判断：未提供录屏核验时，布景、陈列、镜头、主播状态和设备保持待补。原因边界：系统未读取录屏，不补造顾客、价格、优惠、库存、疗效或项目效果。下次动作：负责人为场控，按合规边界记录关键画面事实；验收指标为每条画面结论有时间点和授权来源。",
      "## 七、方法论沉淀",
      "证据：只沉淀本场可重复验证的证据链，不把一次结果包装成普遍规律。判断：当前适合沉淀的是资料采集与对齐方法，而不是没有数据支持的经营结论。原因边界：跨场比较还需要相同口径和观察窗口。下次动作：负责人为运营，建立场次资料包；验收指标为数据、转写、计划和事实边界四项状态清晰。待核实：下一场是否保持同一测试变量。",
      "## 八、下次直播调整清单",
      "1. 运营负责补齐单场后台数据，验收指标为核心字段带数值、单位与统计周期；缺失项明确标记未提供。\n2. 场控负责保存带时间戳的脱敏互动与转写，验收指标为关键环节可与分时数据对齐。\n3. 主播负责保留开播前话术计划并标注实际调整，验收指标为话术执行对照表可逐项核验。\n4. 门店负责人确认项目、咨询和成交口径，验收指标为不包含未确认价格、疗效、案例或顾客隐私。\n5. 若资料仍不完整，继续保持对应模块降级；不自动调用其他模型、上传录屏、发布、投流或付款。"
    ].join("\n");
  }

  if (lockedBeautyCapability === "beauty_sales") {
    const currentRequest = readControlledCurrentRequest(_userInput);
    const professional = /【使用模式】[\s\S]{0,160}专业模式/u.test(_userInput);
    const project = readControlledLine(_userInput, "本次项目");
    const concern = readControlledLine(_userInput, "顾客原话/主要顾虑");
    const stage = readControlledLine(_userInput, "沟通阶段");
    const nextAction = readControlledLine(_userInput, "允许的下一步动作");
    const confirmedSituation = /犹豫|考虑|再想想/.test(currentRequest) && /不下单|没下单|未下单|不决定|没决定/.test(currentRequest)
      ? "顾客正在犹豫，尚未下单；门店需要先识别真实顾虑，再决定如何继续沟通。"
      : /太贵|价格|预算/.test(currentRequest)
        ? "顾客正在比较价格或预算，但尚未提供具体项目、报价和预算证据。"
        : "顾客提出了成交沟通问题；本轮未提供具体项目、价格、顾客情况或到店安排。";
    return [
      "## 建议先这样回复",
      professional
        ? `理解您现在还在考虑。关于${project}，我先不替您做判断；您最在意的是${concern}中的哪一点？我会只按已经确认的项目与价格边界说明。`
        : "理解您还在考虑，不着急做决定。想先确认一下，您现在最担心的是是否适合、价格、时间、服务流程，还是对效果边界不放心？您告诉我最关键的一项，我先把这一点说明白。",
      "",
      "## 为什么这样回",
      professional
        ? `当前处于${stage}，先回应顾客已经表达的顾虑，再限定只使用已确认信息，可以避免把催单、优惠或适合度判断强加给顾客。`
        : "这是一条通用初步回复：先降低决策压力，再识别真实顾虑；没有项目、价格和顾客情况时不把猜测包装成个性化方案。",
      "",
      "## 顾客可能的下一句",
      "顾客可能会说担心是否适合、觉得价格需要比较、时间不方便、不了解流程，或还不确定能否信任效果边界。先记录顾客亲口确认的一项，不替顾客选择答案。",
      "",
      "## 你接下来问什么",
      professional
        ? `确认顾客是否愿意继续到${nextAction}；若不愿意，停止推进并保留其自主决定。`
        : "请让顾客从这五项中选一项：①是否适合；②价格；③时间；④服务流程；⑤信任或效果边界。若都不是，再问“还有哪一点让您暂时不想决定？”",
      "",
      "## 策略详情",
      "## 当前判断",
      `### 已确认事实\n${confirmedSituation}`,
      "### 待核实判断\n顾客犹豫的原因尚未确认，可能与适合度、流程、价格、时间或信任有关，但这些都只是待核实选项。项目、报价、顾客情况、到店时间和联系方式未提供，不能自行补造。",
      "### 异议\n当前属于原因未明确的犹豫异议。重点不是催促成交，而是让顾客说出最关键的一项顾虑，再用已确认信息回应；在原因确认前不把沉默解释成嫌贵、没需求或拒绝。",
      "## 核心破局点\n先承认顾客需要时间，再用一个开放但容易回答的问题识别顾虑。一次只处理一个问题，只引用门店已确认的流程、价格和边界；没有证据的效果、优惠、名额或案例不进入回复。",
      "## 推荐回复\n理解您还在考虑，不着急做决定。想先确认一下，您现在最担心的是是否适合、服务流程、价格，还是时间安排？您告诉我最关键的一项，我只按门店已经确认的信息给您说明，未确认的内容不会替您下结论。您也可以先不预约，了解清楚后再决定。",
      "## 客户可能回复与预判应对\n如果顾客说“担心不适合”，先询问其希望解决的日常需求，并说明不能在线诊断或承诺效果；如果说“价格还要比较”，只发送已确认报价和包含内容，不制造限时压力；如果说“再想想”，约定由顾客方便时主动联系，不连续催促；如果说“时间不合适”，只提供真实可选时段，不替顾客预约。",
      "## 下一步动作\n第一步由接待人员发送上述一条话术并记录顾客主动确认的顾虑类型；第二步只补对应的一项已确认信息；第三步在顾客明确愿意继续时再讨论到店安排。建议在本次回复后等待顾客反馈，无回复时不自动连发、不替顾客预约或下单。验收标准是对话记录能区分已确认事实、待核实判断和顾客自主决定。",
      "## 质量与合规检查",
      `结果类型：${professional ? "专业异议策略" : "通用初步回复"}；不做医疗诊断，不承诺疗效，不虚构顾客、案例、价格、优惠、名额或联系方式。快速模式未取得顾客详情时不包装成个性化最终方案。`
    ].join("\n");
  }

  if (lockedBeautyCapability) {
    throw new Error(`controlled_beauty_capability_fixture_missing:${lockedBeautyCapability}`);
  }

  if (/当前能力入口：行业热点|行业热点/.test(_userInput)) {
    return [
      "行业热点方案",
      "",
      "短结论",
      "这次先做近期行业热点咨询判断。先看客户和老板最近在问什么，再转成今天能发、能拍、能引导私信的IP选题。",
      "",
      "一、行业热点速览：热点咨询",
      "热点1：老板在问这件事到底该不该做，先做哪个环节最容易见效。",
      "热点2：客户在问怎么选服务商、怎么验收效果、成本和数据安全怎么控。",
      "热点3：短视频、小红书、朋友圈都在从泛流量转向精准咨询和私域承接。",
      "",
      "二、热点来源/线索",
      "公开实时数据待补：如果没有热榜截图或平台链接，请用“行业名 + 热点 / 企业落地 / 怎么选 / 真实案例 / 中小企业”去验证。",
      "",
      "三、热点判断",
      "适合蹭的是客户本来就在问的问题，不适合蹭的是和成交无关的泛娱乐话题。",
      "",
      "四、IP获客机会",
      "把热点转成客户判断题：我适不适合、怎么选、多少钱值、现在要不要行动。",
      "",
      "五、可蹭选题",
      "选题1：老板别急着买工具，先判断你该不该做这一步。",
      "选题2：AI改造有没有效果，看这5个验收指标。",
      "选题3：中小企业做AI，最容易浪费钱的是这个环节。",
      "",
      "六、短视频切入",
      "开头3秒先说：别急着下单/预约，先看你是不是这种情况。中段给判断标准，结尾引导私信发情况。",
      "",
      "七、朋友圈切入",
      "朋友圈可以发观点：最近很多人问我怎么选，其实不是看谁说得最好，而是看你的需求、预算和使用场景。",
      "",
      "八、直播切入",
      "直播主题：新手怎么避坑。前15分钟讲判断标准，中段答评论区问题，最后引导私信/预约。",
      "",
      "九、风险提醒",
      "不要编造热榜排名、平台数据、政策结论和客户案例。热点必须服务你的主产品。",
      "",
      "十、今日动作",
      "今天选1个热点问题，发1条短视频、1条朋友圈、1个评论区引导。24小时后看停留、评论/私信和有效咨询。"
    ].join("\n");
  }

  if (/当前能力入口：拍剪优化|拍剪优化/.test(_userInput)) {
    return [
      "拍剪优化方案",
      "",
      "短结论",
      "这次只做拍摄和剪辑优化，不输出内容九件套。重点先把开头停留、镜头信息密度、字幕节奏和结尾行动入口调清楚。",
      "",
      "一、镜头结构",
      "开头0到3秒：直接给结果画面或用户痛点，不要先介绍背景。",
      "中段3到15秒：用真实过程、产品细节或客户案例补足信任。",
      "结尾15到30秒：只留一个行动入口，例如私信、预约、到店或领取资料。",
      "",
      "二、拍摄注意事项",
      "画面要亮，主体要近，声音要清楚。不要连续拍空镜，也不要一个镜头承载太多信息。",
      "",
      "三、分镜脚本",
      "镜头1：问题或结果先出现。",
      "镜头2：展示服务/产品/案例证据。",
      "镜头3：给行动理由。",
      "镜头4：收口到一个动作。",
      "",
      "四、剪辑EDL",
      "0到3秒：最强画面 + 12字以内字幕。",
      "3到8秒：删掉停顿和空镜，进入核心场景。",
      "8到18秒：快切2到3个证据镜头。",
      "18到30秒：放行动入口，字幕和口播保持一致。",
      "",
      "五、发布前检查",
      "开头是否能让目标客户停下来；字幕是否清楚；结尾是否只有一个动作；声音是否压过BGM。"
    ].join("\n");
  }

  if (/当前能力入口：直播话术|直播话术|直播脚本/.test(_userInput)) {
    return [
      "直播话术方案",
      "",
      "短结论",
      "这场直播先按直播话术策划来做，不写短视频脚本，也不输出内容九件套。先判断场景，再给主播能照着说的话术。",
      "",
      "一、场景识别",
      /招商|加盟/.test(_userInput) ? "已识别为招商加盟直播，重点是痛点挖掘、实力背书、模型测算、扶持保障、留资钩子和风险提示。" : "已识别为本地生活/产品带货直播，重点是到店理由、福利机制、互动留人和成交动作。",
      "",
      "二、直播目标",
      "目标：留住进入直播间的人，讲清产品/项目价值，引导咨询、下单、加微信或预约到店。",
      "",
      "三、开播前检查",
      "主播：熟悉产品、价格、福利和不能说的边界。",
      "场控：准备评论回复、福利提醒、留资入口和违规词提醒。",
      "",
      "四、主播口播稿",
      "开场：刚进来的朋友先别划走，我用30秒讲清楚今天这场直播适合谁。",
      "留人：如果你正在看这个项目/产品，但还不知道值不值得行动，先听我把核心差异讲完。",
      "互动：你现在最关心价格、效果、位置还是合作条件？在评论区打出来，我按你们最多的问题先讲。",
      "产品承接：我们不是只讲概念，核心是把产品、服务流程、适合人群和真实限制讲清楚。",
      "转化：想进一步了解的，直接在评论区打“了解”，场控会发你下一步资料或预约方式。",
      "逼单：今天直播间只做本场福利/本场资料领取，错过就按正常流程咨询。",
      "下播后跟进：下播后先按留言名单分层跟进，优先回复已经问价格、位置、合作条件的人。",
      "",
      "五、运营配合动作",
      "场控每5分钟提醒一次福利和咨询入口；主播讲到关键点时，场控同步置顶评论。",
      "",
      "六、合规提醒",
      /招商|加盟/.test(_userInput) ? "招商加盟不能承诺稳赚、保底收益、零风险，要用模型测算和历史参考表达，并提示投资有风险，加盟需谨慎。" : "福利和价格必须真实，不使用极限词，不虚构原价和库存。",
      "",
      "七、复盘指标",
      "看进入人数、平均停留、评论数、咨询数、留资数、成交/预约数和下播后跟进结果。"
    ].join("\n");
  }

  if (/当前能力入口：朋友圈私域|朋友圈私域|朋友圈|私域/.test(_userInput)) {
    return [
      "朋友圈私域方案",
      "",
      "短结论",
      "朋友圈不要写成广告，要让客户感觉你每天都在真实解决问题。今天先发信任、场景、成交三类内容，再配私聊承接。",
      "",
      "一、今日朋友圈策略",
      "先铺信任，再给场景，最后给一个轻转化入口。不要连续硬卖。",
      "",
      "二、信任型朋友圈",
      "今天又遇到一个客户问同一个问题：到底怎么判断自己适不适合这个产品/服务。其实不是看别人买什么，而是看你的需求、预算和使用场景。",
      "",
      "三、场景型朋友圈",
      "如果你最近也在纠结这个问题，可以先把你的情况发我，我帮你判断适不适合，合适再安排，不合适我也会直接告诉你。",
      "",
      "四、成交型朋友圈",
      "今天还可以安排几个咨询/预约名额。想了解的直接私信我“想了解”，我先帮你看情况。",
      "",
      "五、私聊承接话术",
      "你先把现在最想解决的问题发我，我看一下你适不适合。合适的话，我再给你对应的方案和下一步安排。",
      "",
      "六、发布节奏",
      "上午发信任型，中午发场景型，傍晚发成交型；每条发完30分钟内及时回复私信。"
    ].join("\n");
  }

  if (/当前能力入口：视频数据复盘|视频数据复盘|当前能力入口：视频复盘|视频复盘/.test(_userInput)) {
    return [
      "视频数据复盘报告",
      "",
      "## 零、数据质量审计",
      "请上传平台后台导出的 CSV 或 Excel。至少需要作品标题/描述和播放量；建议同时包含发布时间、完播率、平均播放时长、点赞、评论、分享和关注。",
      "",
      "## 一、数据总览",
      "有效记录 0 条，所有指标不可计算。",
      "",
      "## 二、视频分层",
      "数据不足，无法分层。",
      "",
      "## 三、内容结构健康度",
      "数据不足，无法判断。",
      "",
      "## 四、单条深拆",
      "数据不足，无法选取。",
      "",
      "## 五、完播率深层归因",
      "数据不足，不可计算。",
      "",
      "## 六、互动深度分析",
      "数据不足，不可计算。",
      "",
      "## 七、趋势分析",
      "数据不足，跳过趋势判断。",
      "",
      "## 八、规律总结",
      "没有有效样本，不沉淀规律。",
      "",
      "## 九、方法论沉淀",
      "没有证据，不生成方法论条目。",
      "",
      "## 十、下周期选题建议",
      "先上传完整数据明细，系统会在读取全部有效行后给测试方向。",
      "",
      "## 十一、综合诊断结论",
      "当前阻塞点是文件未成功解析。视频数据复盘只分析数据文件，不分析 MP4 画面、口播或剪辑；没有字段时不判断限流、违规、平台机制、投流或成交。"
    ].join("\n");
  }

  return [
    "完整报告（内容九件套）",
    "",
    "短结论",
    "这是开发预览模式的稳定输出，用来测试页面、路由和交付物展示。真实模型配置好以后，这里会替换成模型生成结果。",
    "",
    "一、选题",
    "主选题：今天为什么值得立刻到店体验。",
    "内容角度：用真实场景、真实服务过程和明确行动理由，把用户从刷到内容推进到咨询或到店。",
    "",
    "二、可直接发布的文案",
    "今天这条内容不要只介绍产品，要让用户知道：我适合谁、现在来有什么好处、下一步怎么联系你。",
    "",
    "三、可直接拍摄的脚本：拍摄脚本",
    "镜头1：开头3秒给结果画面或客户场景，字幕写“今天为什么值得来”。",
    "镜头2：展示服务过程或产品细节。",
    "镜头3：说清适合人群和到店理由。",
    "镜头4：结尾引导评论、私信或查看主页。",
    "",
    "四、拍摄注意事项",
    "画面要亮，人物说话要像和熟人聊天。不要堆形容词，多拍真实动作和客户能感知的细节。",
    "",
    "五、剪辑EDL",
    "0-3秒：结果/痛点钩子。",
    "3-10秒：服务过程。",
    "10-18秒：价值说明。",
    "18-25秒：行动引导。",
    "",
    "六、发布标题话题",
    "标题：附近想解决这个问题的人，可以先看这条。",
    "话题：本地生活 IP获客 到店转化 内容运营",
    "",
    "七、发布时间",
    "本地到店类内容优先测试上午10:30-11:30、下午17:00-18:00。",
    "",
    "八、评论区引导话术",
    "置顶评论：想看方案或价格，评论区打“想了解”，我发你适合你的版本。",
    "",
    "九、投流建议",
    "先自然跑24小时，看完播、主页点击、评论、私信和到店线索。数据稳定后再小预算测试本地推。",
    "复盘指标：完播率、主页点击率、评论率、私信数、到店线索数。"
  ].join("\n");
}

function buildControlledContentPlanReply(source: string): string {
  const topic = readControlledLine(source, "选题") ?? "皮肤管理产品到店前先了解三件事";
  const target = readControlledLine(source, "目标顾客") ?? "附近关注日常皮肤管理的女性用户";
  const objective = readControlledLine(source, "本轮目标") ?? "帮助目标用户了解服务并发起合规咨询";
  return [
    "## 短结论",
    `围绕“${topic}”完成一套可拍、可发、可复盘的内容交付，面向${target}，目标是${objective}。`,
    "## 一、选题",
    `${topic}。内容从顾客到店前真正关心的问题切入：服务是什么、流程怎样、选择前要确认什么。`,
    "## 二、口播逐字稿",
    "以下为可直接发布的文案。",
    "开头3秒钩子：想了解皮肤管理产品，先别急着跟风，先把这三件事问清楚。第一，服务主要面向什么日常需求；第二，体验流程包含哪些环节；第三，自己的实际情况有哪些需要提前说明。今天不讲夸张效果，只把到店前值得了解的信息讲清楚。皮肤状态和护理需求因人而异，具体选择请结合真实情况判断。你最想先了解哪一步？欢迎留言。",
    "## 三、访谈话术",
    "提问一：顾客第一次了解这类服务时最常问什么？提问二：门店会怎样介绍真实流程？提问三：哪些情况需要先说明边界？回答只使用已确认服务信息，不引用未授权顾客经历。",
    "## 四、拍摄脚本",
    "以下为可直接拍摄的脚本。",
    "镜头与字幕：0—3秒，护理用品静物与标题字幕；3—12秒，店长口播说明三个问题；12—28秒，已授权空间与用品细节；28—40秒，回到店长口播说明个体差异与互动问题。每个镜头只承载一个信息。",
    "## 五、拍摄注意事项",
    "使用竖屏、自然光和清晰收音；不出现未授权顾客正脸、门店标识或效果对比；口播与字幕逐句核对，未知事实直接省略。",
    "## 六、剪辑EDL",
    "0—3秒保留钩子与大字标题；3—12秒每个问题配一个短字幕；12—28秒用三组已授权细节画面覆盖跳剪；28—40秒保留边界说明和一个互动动作。删除停顿，不添加不存在的画面。",
    "## 七、发布标题与话题",
    "标题一：想了解皮肤管理产品，先问清这3件事。标题二：附近女性用户到店前，可以先看这份清单。话题：#皮肤管理 #附近生活 #女性护理 #到店前攻略 #短视频内容。",
    "## 八、最佳发布时间",
    "先按账号已有活跃时段选择一个固定测试窗口；没有真实账号数据时不声称某个时段最佳。连续发布后用同口径数据复盘。",
    "## 九、评论区引导话术",
    "置顶评论：你最想先了解服务流程、适用边界还是到店准备？留言说说你的关注点。回复时只提供门店已确认信息。",
    "## 十、投流建议",
    "本预览不执行投流。先观察自然播放、完播、互动和有效咨询；复盘指标使用平台真实数据，同一轮只改变一个变量。",
    "## 下一步动作",
    "明确的下一步动作：由运营核对口播事实、素材授权与字幕，确认后完成拍摄；发布后按同一观察窗口记录真实表现。",
    "## 质量与合规检查",
    "本次没有确认门店名称、价格、预约方式、疗效、案例或顾客经历，这些内容未进入十件客户交付。流程预览不代表真实模型质量，不自动发布、投流或付款。"
  ].join("\n");
}

function buildControlledVideoDataReply(): string {
  const evidence = "本流程预览只允许使用已成功解析表格中的字段和值；缺失值不按零处理。字段覆盖、统计口径和证据边界必须在每个结论旁说明，所有原因均标记为待验证。";
  return [
    "## 数据质量审计", `${evidence} 有效记录、来源文件、平台、观察周期和缺失字段必须逐项列明。`,
    "## 数据总览", `${evidence} 汇总播放、完播、互动与转化时分别写清分母和有效样本。`,
    "## 视频分层", `${evidence} 仅按已提供指标分层，不能把未提供的完播、投流或成交写成结论。`,
    "## 内容结构健康度", `${evidence} 只能把标题或描述字段作为文字结构证据，不能声称读取视频画面、口播或剪辑。`,
    "## 单条深拆", `${evidence} 选择代表作品时说明选择口径，不用模型常识补造内容。`,
    "## 完播率深层归因", `${evidence} 没有完播率或平均播放时长时不可判断；存在字段时也只提出可验证假设。`,
    "## 互动深度分析", `${evidence} 互动率按点赞、评论、分享与播放量计算，缺字段时缩小口径。`,
    "## 趋势分析", `${evidence} 只有有效发布日期和足够记录才比较趋势，平台和观察窗口分开。`,
    "## 规律总结", `${evidence} 只总结重复出现且可核对的模式，不把单条表现写成普遍规律。`,
    "## 方法论沉淀", `${evidence} 新规律保持待验证，未经过复验不得写成门店长期方法。`,
    "## 下周期选题建议", `${evidence} 给出单变量测试建议和验收指标，不展开其他内容制作交付。`,
    "## 综合诊断结论", `${evidence} 结论按观察事实、待验证假设和下一步动作分开；不推断限流、违规、平台机制或未提供的业务转化。`
  ].join("\n");
}

function buildControlledLiveScriptReply(): string {
  return [
    "## 短结论\n本场只介绍已确认的皮肤管理产品、适合了解的人群和到店前准备，不作医疗诊断或效果承诺。",
    "## 场景识别\n本地生活项目讲解直播；价格、优惠和库存没有确认时不进入口播。",
    "## 直播目标\n帮助观众听懂服务流程与边界，并留下一个合规咨询问题。",
    "## 开播前检查\n主播核对项目事实、适合说明的范围和禁用词；场控核对评论承接、素材授权与应急提示；运营确认本场只使用已核对资料。价格、优惠、库存和预约入口没有确认时不得口播。页面不自动发布、付款或投流。",
    "## 主播口播稿",
    "### 开场\n刚进来的朋友先别划走，今天用一分钟讲清楚了解皮肤管理产品前值得先问的三个问题。我们不讲夸张效果，只把需求、流程和选择边界说清楚。",
    "### 留人\n如果你也在比较服务流程和适用边界，听完这三点再决定要不要继续了解。第一点讲适合先了解什么，第二点讲体验流程，第三点讲到店前怎样准备。",
    "### 互动\n你更想先听服务流程、日常护理建议还是到店准备？在评论区留下一个问题。场控会先归类问题，主播只回答本场已经确认的信息。",
    "### 产品承接\n我们只介绍已经确认的服务信息，先说需求，再说流程，最后说明个体差异和选择边界。每个人的实际情况不同，直播内容不替代专业判断。",
    "### 转化\n想继续了解的，可以留下最关心的问题；场控会按门店已确认信息回复。没有确认联系方式或预约方式时，只承接问题，不自动引导到未知入口。",
    "### 逼单\n不使用虚假倒计时、库存或优惠；没有真实活动时不制造紧迫感。用“先了解清楚再决定”作为收口，不把咨询包装成必须立即购买。",
    "## 运营配合动作\n场控每个环节只置顶一个相关问题，记录真实高频问题，未确认信息交由负责人复核后再回复。主播讲到服务边界时同步展示克制提示卡；发现医疗或疗效问题时及时提醒按合规口径回答。",
    "## 下播后跟进\n按问题类型整理咨询，不复制顾客隐私；先答已确认事实，再询问是否需要继续了解。对流程、适用边界和到店准备分别建立回复清单，无法确认的问题交给门店负责人，不用模板补造。",
    "## 合规提醒\n不承诺疗效，不作诊断，不虚构价格、案例、资质、优惠或顾客经历。",
    "## 复盘指标\n使用真实进房、停留、评论、有效咨询和后续到店口径；缺失字段不按零处理。按相同观察窗口记录每个环节的真实反馈，只总结可复核变化，不把单场相关性写成因果。"
  ].join("\n");
}

function buildControlledTopicReply(source: string): string {
  const availableLine = readControlledLine(source, "已启用且有可用资料的来源") ?? "行业与用户热点";
  const availableSources = ["私有知识与客户问题", "行业与用户热点", "自身账号数据复盘", "同行与对标内容"]
    .filter((label) => availableLine.includes(label));
  const usableSources = availableSources.length > 0 ? availableSources : ["行业与用户热点"];
  const target = readControlledLine(source, "目标用户") ?? readControlledLine(source, "目标顾客") ?? "关注日常皮肤管理的女性用户";
  const goal = readControlledLine(source, "本轮获客目标") ?? "获得合规咨询";
  const industry = readControlledLine(source, "细分赛道")?.replace(/（[^）]*）/g, "") ?? "美业";
  const accountStage = readControlledLine(source, "账号阶段");
  const project = readControlledLine(source, "本轮项目")
    ?? source.match(/(?:本轮项目|服务项目)[：:]([^；。\n]{2,80})/)?.[1]?.trim()
    ?? `${industry}相关服务`;
  const allSources = [
    ["私有知识与客户问题", "存在当前租户已确认资料；受控夹具只核对接入状态，不扩写其中事实"],
    ["行业与用户热点", `已确认细分赛道为${industry}；没有 URL、日期与来源时实时热点仍待核验`],
    ["自身账号数据复盘", "存在已解析并保存的本账号复盘；受控夹具不补造指标"],
    ["同行与对标内容", "存在用户提供的对标线索；尚未核验作品与互动证据"]
  ] as const;
  const sourceRows = allSources.map(([label, readyDetail], index) =>
    `${index + 1}. ${label}：${usableSources.includes(label) ? `已启用；${readyDetail}` : "待补；本轮没有可用资料，不声称已经读取"}。`
  );
  const topicPatterns = [
    `${project}前，${target}最值得先确认的三个问题`,
    `怎样把${project}的真实服务步骤讲清楚`,
    `${target}了解${project}时容易忽略哪些边界`,
    `介绍${project}时，哪些信息需要先确认清楚`,
    `${project}内容怎样避免夸大效果或虚构案例`,
    `用一条短视频说明${project}适合先了解什么`,
    `${target}咨询前，可以先准备哪些真实问题`,
    `${project}的服务流程如何拍得清楚且保护隐私`,
    `如何用已确认资料承接${goal}`,
    `发布${project}内容后，下一轮应核对哪些真实反馈`
  ];
  const topicCards = topicPatterns.map((topic, index) => {
    return [
      `### ${String(index + 1).padStart(2, "0")}. ${topic}`,
      `- 适合人群：${target}`,
      `- 内容角度：${index % 2 === 0 ? "用顾客问题切入，给清晰判断清单" : "拆解真实服务流程与选择边界"}`,
      `- 为什么有助${goal}：先让用户确认需求，再引导了解真实服务信息。`,
      `- 建议内容形式：${index % 3 === 0 ? "30秒店长口播" : index % 3 === 1 ? "流程细节短视频" : "问题清单图文视频"}`,
      `- 生成内容：可带入内容系统继续制作。`
    ].join("\n");
  });
  const pendingSources = allSources.map(([label]) => label).filter((label) => !usableSources.includes(label));

  return [
    "## 用户可用TOP10",
    ...topicCards,
    "## 选题策略摘要",
    `服务主体：本店；目标用户：${target}；获客目标：${goal}；项目方向：${project}；细分赛道：${industry}。`,
    `本轮以“顾客是否愿意继续了解并走向${goal}”作为筛选重点，10条分别覆盖问题答疑、流程拆解、选择边界和行动承接。`,
    "## 来源与质量审核",
    "### 本轮主体与目标",
    `目标用户：${target}。`,
    `账号阶段：${accountStage ?? "本次未提供；未进入用户TOP10"}。`,
    `本轮获客目标：${goal}。`,
    `本轮项目：${project}。`,
    `细分赛道：${industry}。`,
    "### 四大来源自动采集结果",
    ...sourceRows,
    "## 三关筛选后的TOP10",
    "最终选题：见用户可用TOP10；类型：问题答疑与流程拆解；来源：仅来自上面已启用来源；第一关证据：需用真实反馈复验；共识层级、客资准度、适用阶段与创作建议保留在每条内部审计记录。",
    "## 配比调整建议",
    `本轮只按 ${usableSources.length}/4 个真实可用来源形成第一版；可用来源为${usableSources.join("、")}。${pendingSources.length ? `待补来源为${pendingSources.join("、")}。` : "四类来源均有可用资料。"}先围绕${goal}验证真实完播、互动和咨询，再调整配比。`,
    "## 待验证动作与证据边界",
    `${pendingSources.length ? `在选题工作区补充${pendingSources.join("、")}；` : "当前四类来源都已接入；"}第一关仍须用真实评论、私信、作品互动或账号数据复验。流程预览不会把接入状态写成内容效果。`,
    "事实边界：不连接实时平台、不评估真实模型内容质量，也不补造价格、疗效、案例、顾客经历、热点或经营数据。"
  ].join("\n");
}

function readControlledLine(source: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}[：:]([^。\\n]+)`))?.[1]?.trim();
}

function readControlledCurrentRequest(source: string): string {
  const matches = Array.from(source.matchAll(/用户这次说：([^\n]{1,500})/g), (match) => match[1]?.trim()).filter(Boolean) as string[];
  return matches.at(-1)?.slice(0, 500) ?? "";
}

function extractControlledXhsTaskFacts(source: string): Partial<Record<"time_context" | "service_project" | "audience_geography" | "target_audience" | "platform" | "deliverable", string>> {
  const entries = Array.from(source.matchAll(/\[XHS_TASK_FACT:([a-z_]+)]\s*([^\n]{1,160})/g), (match) => [match[1], match[2]?.trim()] as const);
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])));
}

async function emitTextInChunks(
  text: string,
  onDelta: (delta: string) => void | Promise<void>
): Promise<void> {
  for (let index = 0; index < text.length; index += 24) {
    await onDelta(text.slice(index, index + 24));
  }
}
