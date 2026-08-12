import type { LlmMessage, LlmProvider } from "@baolu/agent";
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
    requestOptions?: { signal?: AbortSignal; reasoningProfile?: AgentReasoningProfile }
  ): Promise<string> {
    assertHighCapabilityLlmModel(this.options.model);

    if (shouldUseDemoFallback()) {
      return buildMockReply(messages[messages.length - 1]?.content ?? "");
    }

    if (!this.isConfigured()) {
      return buildMockReply(messages[messages.length - 1]?.content ?? "");
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(requestOptions?.signal?.reason);
    if (requestOptions?.signal?.aborted) abortFromParent();
    else requestOptions?.signal?.addEventListener("abort", abortFromParent, { once: true });
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
          temperature: requestOptions?.reasoningProfile === "deep"
            ? Math.min(this.options.temperature ?? 0.35, 0.2)
            : this.options.temperature ?? 0.3
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.name} request failed: ${response.status} ${body.slice(0, 500)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        if (shouldUseDemoFallback()) {
          return buildMockReply(messages[messages.length - 1]?.content ?? "");
        }
        throw new Error(`${this.name} response did not include message content`);
      }
      return content;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (requestOptions?.signal?.aborted) {
          const cancelled = new Error("llm_request_cancelled");
          cancelled.name = "AbortError";
          throw cancelled;
        }
        throw new Error(`${this.name} request timed out after ${this.options.timeoutMs}ms`);
      }
      if (shouldUseDemoFallback()) {
        return buildMockReply(messages[messages.length - 1]?.content ?? "");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      requestOptions?.signal?.removeEventListener("abort", abortFromParent);
    }
  }

  async streamComplete(
    messages: LlmMessage[],
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    assertHighCapabilityLlmModel(this.options.model);

    if (shouldUseDemoFallback()) {
      const mock = buildMockReply(messages[messages.length - 1]?.content ?? "");
      await emitTextInChunks(mock, onDelta);
      return mock;
    }

    if (!this.isConfigured()) {
      const mock = buildMockReply(messages[messages.length - 1]?.content ?? "");
      await emitTextInChunks(mock, onDelta);
      return mock;
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
          const mock = buildMockReply(messages[messages.length - 1]?.content ?? "");
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
        const mock = buildMockReply(messages[messages.length - 1]?.content ?? "");
        await emitTextInChunks(mock, onDelta);
        return mock;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function shouldUseDemoFallback(): boolean {
  return process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true";
}

function buildMockReply(_userInput: string): string {
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

async function emitTextInChunks(
  text: string,
  onDelta: (delta: string) => void | Promise<void>
): Promise<void> {
  for (let index = 0; index < text.length; index += 24) {
    await onDelta(text.slice(index, index + 24));
  }
}
