# 模型 Provider 台账

> ⚠️ 历史归档恢复：本文于 2026-09-18 从归档 worktree（fe6e）恢复，内容停留在 2026-08-14 审计口径，价格与接入状态可能已过时，仅供参考；实际以当前源码和供应商账单为准。

> 审计快照：2026-08-14（Asia/Shanghai）  
> 价格观察日：2026-08-14；价格会变化，实际结算以供应商账单和账号合同为准。  
> 安全声明：本文只登记环境变量名称，不包含任何密钥值、客户原文或签名下载地址。

## 1. 口径与结论

本文把“源码存在”“当前产品路径已调用”“本次新增但仅供 Eval”“官方公开可用”“本项目账号已获权限”分开记录：

- **现状 / 产品路径**：`server.ts` 当前实际注册并可到达的代码路径；不等于任一部署环境已配置凭据。
- **本次新增 / Eval-only**：仓库已有 contract、adapter、配置或测试，但未注入 `server.ts` 的产品调用链，不能写成已上线。
- **候选 / flag-off**：仅登记官方能力和价格，默认开关关闭，不能真实调用。
- **官方已证实**：官方文档确认模型 ID、协议或公开价格。
- **账号未证实**：没有使用项目账号做 live smoke，权限、限流、账单、成功率或 SLA 仍是 `unknown`。

核心结论：

1. 当前通用文本运行时不是多 Provider 网关。进程启动时由 `LLM_PROVIDER` 三选一，创建一个全局 `LlmProvider`，再注入全部文本业务路由；默认是 DeepSeek `deepseek-v4-pro`。证据：`apps/api/src/config/env.ts:23-59`、`apps/api/src/services/llm-provider-factory.ts:10-43`、`apps/api/src/server.ts:97-135`。
2. 当前通用文本运行时没有供应商级自动 failover。主调用失败时，Agent 层可能返回确定性业务兜底；这不是切换到另一个模型。证据：`packages/agent/src/index.ts:2027-2061`。
3. “阿里云百炼”是平台，不是模型。本仓库已发现百炼上的 `qwen-max`、`qwen-vl-max`、`qwen3-asr-flash`、`qwen3-asr-flash-filetrans`、`wan2.2-animate-mix` 五类具体模型路径，覆盖文本、视觉/OCR 式提取、ASR 和视频换人；没有证据表明百炼已承载图片生成、TTS、向量或重排。
4. 本次新增的统一网关只由 `createModelGatewayForEvaluation()` 构造，并由 `MODEL_CHALLENGER_EVAL_ENABLED` 门控；`server.ts` 未导入或调用它。因此新配置里的 fallback、重试、熔断、用量和成本估算均不是当前产品行为。证据：`apps/api/src/services/model-gateway-factory.ts:15-65`、`apps/api/src/server.ts:97-135`。
5. 外卖增长有额外的产品级 DeepSeek 路由契约：仅 `deepseek-v4-pro`、`deepseek-v4-flash`；provider/model/配置不满足时 fail closed，不能降级到百炼、其他 DeepSeek 模型或固定模板。实际模型调用的精确 ID 通过 `AgentRun.selectedModel` 持久化并返回；当前环境默认配置仍是 `deepseek-v4-pro`，Flash 只是已核实的可允许 ID，未自动启用。
5. MiniMax M3 是文本/Agent Challenger；MiniMax H3 是通用多模态视频生成候选，不是文本模型，也不等同于百炼“视频换人/动作复刻”。两者默认关闭，均未做项目账号 live call。

## 2. Provider 与模型逐项台账

### 2.1 DeepSeek / `deepseek-v4-pro`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 默认通用文本路径**；代码默认不代表当前环境一定有凭据。 |
| 能力 | 通用文本、经营诊断、文案与 Agent 推理；源码把它作为高质量文本模型，但旧 adapter 没有暴露原生结构化输出或工具调用。 |
| 协议 / endpoint | OpenAI-compatible `POST {DEEPSEEK_BASE_URL}/chat/completions`，HTTP Bearer；示例 base 为 `https://api.deepseek.com/v1`。 |
| 环境变量 | `LLM_PROVIDER`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`LLM_TIMEOUT_MS`、`LLM_ALLOWED_MODELS`、`DOMESTIC_OUTBOUND_ALLOWLIST`。 |
| 入口 | `createRuntimeLlmProvider()` → `DomesticChatProvider` → `server.ts` 注入 chat、agent、诊断、报告、知识库、剪辑等路由。 |
| 默认路由 / 降级 | `LLM_PROVIDER=deepseek` 是默认；无 Provider failover。未配置时非生产代码返回 mock；运行异常时部分 Agent 返回确定性 fallback。 |
| 超时 / 重试 | transport 默认 180 秒；Agent planner/primary/repair 默认 90/180/120 秒，媒体 primary/repair 240/120 秒。没有 transport 自动重试或模型熔断。 |
| 取消 / 幂等 | `complete()` 支持父 `AbortSignal`；旧 `streamComplete()` 不接收父 signal。正式 Agent 路由有 DB `requestId` 回放，但推理前没有跨进程 in-flight 锁，极端并发仍可能重复产生供应商成本。 |
| Token / 成本 | 旧 adapter 不读取 `usage`；`AgentRun.tokenEstimate` 存在但未写入，产品按 Skill 固定积分而非 token 计费。 |
| 租户 / 任务 | 上游 Agent 请求和 `AgentRun` 带 tenant/user/requestId；Provider 只收到 messages，不收到 tenant/task，也没有逐调用审计记录。 |
| 日志脱敏 | 旧 adapter 会把供应商错误正文前 500 字带入异常，Fastify 只配置 `logger: true`，未发现统一 redact；属于待修缺口。 |
| 证据 | `apps/api/src/services/domestic-chat-provider.ts:33-105`、`packages/agent/src/index.ts:123-129,1647-1719`、`apps/api/src/services/chat-persistence.ts:135-207`、`packages/db/prisma/schema.prisma:442-478`。 |

已证实：模型 ID 是 DeepSeek 中国区官方当前模型；官方支持 JSON、工具调用、Responses 与 Anthropic 协议。本次新增的 **Eval adapter** 明确声明 `supportsStructuredOutput=true`、`supportsToolCalls=true`；这不改变现有产品 adapter。未证实：项目账号权限、真实延迟/成功率/实际账单；现有产品 adapter 没有使用这些高级能力。

### 2.2 DeepSeek / `deepseek-v4-flash`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **官方存在、仓库暂未接入**；当前模型策略明确阻止 `flash`，没有 adapter/路由/Eval 证据。 |
| 重叠 | 与百炼低成本通用文本、M3 Challenger 的 `text_fast`/`text_standard` 范围重叠。 |
| 决定 | 暂不加入；先用同一业务 Eval 证明百炼现有文本模型不能覆盖，才新增，避免重复建设。 |
| 证据 | `apps/api/src/services/llm-model-policy.ts:10-23`、`config/model-gateway.json` 的 `unsupportedCapabilities.text_fast`。 |

### 2.3 阿里云百炼 / `qwen-max`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 可选通用文本路径**；仅当 `LLM_PROVIDER=aliyun` 时成为全局文本 Provider。新 Eval 配置把它列为 fallback，但该配置未接产品。 |
| 能力 | 通用文本、经营分析与长文本；旧 adapter 未暴露原生结构化输出或工具调用。 |
| 协议 / endpoint | OpenAI-compatible `POST {ALIYUN_BASE_URL}/chat/completions`；默认 base `https://dashscope.aliyuncs.com/compatible-mode/v1`。 |
| 环境变量 | `LLM_PROVIDER`、`ALIYUN_API_KEY`、`ALIYUN_BASE_URL`、`ALIYUN_MODEL`、`LLM_TIMEOUT_MS`。注意通用文本路径不回退读取 `DASHSCOPE_API_KEY`。 |
| 路由 / 降级 / 弹性 | 选中后是唯一通用文本 Provider；无 Provider failover、自动重试和模型熔断。取消、超时、mock 与确定性 fallback 行为同 DeepSeek。 |
| Token / 成本 / 租户 | 旧路径不采集 usage 或供应商成本；上游按 Skill 固定积分并持久化 tenant/requestId，Provider 调用不带 tenant/task。 |
| 证据 | `apps/api/src/config/env.ts:28-30`、`apps/api/src/services/llm-provider-factory.ts:11-20`、`apps/api/src/services/domestic-chat-provider.ts:58-89`。 |

已证实：源码真实接入和官方公开模型/价格。本次新增的 **Eval adapter** 明确声明 `supportsStructuredOutput=false`、`supportsToolCalls=false`，不能把协议可能支持的能力误写成当前 adapter 已支持。未证实：任一环境实际选择它、项目账号 entitlement 和真实账单。

### 2.4 国内 OpenAI-compatible 中转 / 动态模型

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 可选兼容路径**；它是协议适配槽位，不是确定供应商。默认模型字符串为 `deepseek-v4-pro`。 |
| 协议 / endpoint | OpenAI-compatible Chat Completions，endpoint 由环境配置。 |
| 环境变量 | `LLM_PROVIDER=domestic_compatible`、`DOMESTIC_COMPATIBLE_PROVIDER_NAME`、`DOMESTIC_COMPATIBLE_API_KEY`、`DOMESTIC_COMPATIBLE_BASE_URL`、`DOMESTIC_COMPATIBLE_MODEL`。 |
| 安全边界 | model 必须通过高能力国内模型策略；host 必须通过国内网络 allowlist。Provider 名、真实模型、价格、地域、数据处理方均依赖部署环境，仓库不能替部署台账。 |
| 弹性 / 计费 / 租户 | 与旧 `DomesticChatProvider` 相同；无 usage/成本、Provider failover、重试或熔断。 |
| 证据 | `apps/api/src/services/llm-provider-factory.ts:23-32`、`apps/api/src/config/env.ts:44-47,124-170`。 |

### 2.5 阿里云百炼 / `qwen-vl-max`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 直接媒体路径**，不经过通用文本 Provider factory。 |
| 能力 | 图片与视频关键帧理解、扫描 PDF 页面提取、剪辑画面对齐和 OCR 式事实提取；不是图片生成模型，也不是独立 OCR 模型。 |
| 协议 / endpoint | OpenAI-compatible Chat Completions，多模态 `messages[].content` 传 data URL。 |
| 环境变量 | `ALIYUN_VIDEO_MODEL`（默认 `qwen-vl-max`）、`ALIYUN_API_KEY` 或 `DASHSCOPE_API_KEY`、`ALIYUN_BASE_URL` 或 `DASHSCOPE_BASE_URL`、`ALIYUN_MEDIA_BASE64_MAX_MB`。 |
| 入口 | `POST /media/analyze` 的图片/关键帧/PDF 页面；`analyzeSelectedClipVisuals()` 的剪辑关键帧。 |
| 降级 / 弹性 | `/media/analyze` 捕获失败并返回 warnings；剪辑视觉分析返回 fallback analysis。直接 `fetch` 没有 timeout、retry、cancel、idempotency 或 circuit breaker。 |
| Token / 成本 / 租户 | 不解析 usage/成本，供应商调用仍未关联具体 task。`/media/analyze` 已先解析统一租户上下文，匿名或伪造 Bearer 返回 401，限额键包含 `tenantId + IP`；分析结果未持久化到共享租户记录。剪辑缓存依赖上游本地 source path。 |
| 日志脱敏 | 供应商错误正文前 160/220 字可能进入异常或 warning，尚无统一脱敏。 |
| 证据 | `apps/api/src/routes/media.ts`、`scripts/media-provider-auth-smoke.ts`、`apps/api/src/services/clip-visual-analyzer.ts`。 |

### 2.6 阿里云百炼 / `qwen3-asr-flash`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 短音视频直接 ASR 路径**。 |
| 能力 | 音频转文字；视频先用 ffmpeg 抽取单声道 16k MP3。 |
| 协议 / endpoint | OpenAI-compatible Chat Completions；`input_audio` 使用 base64 data URL，附 `asr_options.enable_itn=false`。 |
| 环境变量 | `ALIYUN_ASR_MODEL`（默认 `qwen3-asr-flash`）、百炼 key/base 两套兼容变量、`ALIYUN_MEDIA_BASE64_MAX_MB`。 |
| 入口 | `POST /media/analyze`；超过配置大小会跳过并返回 warning。 |
| 弹性 / 成本 / 租户 | ffmpeg 30 秒；供应商 `fetch` 无 timeout/retry/cancel/circuit/idempotency，不解析 usage/成本，调用不带 tenant/task；失败变 warning。 |
| 证据 | `apps/api/src/routes/media.ts:158-165,223-273,299-349`。 |

### 2.7 阿里云百炼 / `qwen3-asr-flash-filetrans`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / Clip Lab 长文件异步 ASR**。 |
| 能力 | 文件转写、句词级时间戳，为带货粗剪和人物 IP 剪辑提供字幕边界。 |
| 协议 / endpoint | 先从 `GET /api/v1/uploads?action=getPolicy&model=...` 获取 OSS 上传凭证并上传临时 MP3；再以 `X-DashScope-Async: enable` 提交 `/api/v1/services/audio/asr/transcription`，轮询 `/api/v1/tasks/{taskId}`，下载 `transcription_url`。 |
| 环境变量 | `ALIYUN_ASR_FILETRANS_MODEL`（默认 `qwen3-asr-flash-filetrans`）、`DASHSCOPE_API_KEY` 或 `ALIYUN_API_KEY`、`DASHSCOPE_BASE_URL` 或 `ALIYUN_BASE_URL`、`UPLOAD_DIR`。 |
| 超时 / 重试 / 恢复 | ffmpeg 超时按源时长动态计算；轮询每 1.8 秒，8–40 分钟动态总超时。无网络自动重试、取消 signal 或跨进程任务恢复；缓存成功转写以避免重复调用。 |
| Token / 成本 / 租户 | 不记录供应商 usage/价格；helper 不接 tenant/task，租户边界依赖上游 source path 和调用路由。 |
| 证据 | `apps/api/src/services/clip-asr.ts:40-98,128-210,219-228`、`apps/api/src/services/clip-planner.ts:367-386`、`apps/api/src/services/persona-clip-planner.ts:229-255`。 |

### 2.8 阿里云百炼 / `wan2.2-animate-mix`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **现状 / 视频复刻 Champion 代码路径，但新付费任务当前安全硬阻断**；保留百炼默认，不切换。`isDurableReplicationOutputStorageReady()` 当前固定为 `false`，所以 quote 返回 `canConfirm=false`，confirm 在建单、扣分和供应商调用前返回 `durable_output_storage_required`。 |
| 能力 | 输入人物图片 + 参考视频，保留动作/场景语义并替换人物；官方叫“视频换人”，能力标签是 `video_replica`，不是泛化 `video_generate`。 |
| 协议 / endpoint | 异步 DashScope：公共 `dashscope.aliyuncs.com` 或合法 workspace 专属域名上的 `POST /api/v1/services/aigc/image2video/video-synthesis`，Bearer、`X-DashScope-Async: enable`；配置只有精确模型 `wan2.2-animate-mix` 才通过，输入 `image_url`/`video_url`/`watermark`，参数 `mode=wan-std|wan-pro`；状态查询 `GET /api/v1/tasks/{task_id}`。 |
| 环境变量 | `ALIYUN_VIDEO_REPLICATION_API_KEY`、`ALIYUN_VIDEO_REPLICATION_ENDPOINT`、`ALIYUN_VIDEO_REPLICATION_MODEL`、`ALIYUN_VIDEO_REPLICATION_CREDITS`、`ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN`、`DOMESTIC_OUTBOUND_ALLOWLIST`。当前 service 为避免模型漂移固定使用官方 ID `wan2.2-animate-mix`。 |
| 入口 | Web 内容系统 → `/viral-video-replication/quote` → 可选 `/files` 上传 → `/viral-video-replication/confirm` → job/status 接口。完整链见第 5 节。 |
| 超时 / 恢复 / 降级 | submit/query HTTP attempt 为 15 秒；无 Provider retry、fallback 或熔断。API 已有 tenant-scoped 单 job GET 的按需查询恢复、callback 归一和必要时官方 task query；没有后台 reconciler，页面也未接单 job 刷新/轮询。 |
| 计费 | 产品按预先配置的固定积分报价；当前硬门禁下不会建单或扣分。门禁未来打开后，余额条件更新、job 与 consume 在同一事务；终态失败/取消用 `billingStatus=reserved` 的原子认领只退款一次。官方华北 2 按成功输出秒计费，处理失败不计供应商费用。 |
| 租户 / 幂等 | job、积分交易、文件归属按 tenant；唯一键 `(tenantId, requestKey)`，列表和单 job 查询都限制 tenant。Provider 请求携带 request key，但供应商是否把它当强幂等键未证实。 |
| 证据 | `apps/api/src/services/viral-video-replication.ts:47-154`、`apps/api/src/routes/viral-video-replication.ts:38-94,133,200-278,312-501,577`、`packages/db/prisma/schema.prisma:1042-1069`。 |

### 2.9 MiniMax / `MiniMax-M3`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **本次新增 / 文本 Challenger / Eval-only / 默认关闭**；未注入产品路由。 |
| 官方能力 | 文本与 Agent 模型，1M 总上下文；官方确认流式/非流式、图片/视频理解、function tools。当前官方 Chat schema 未列原生 strict JSON Schema，必须保留为未证实。 |
| 已实现协议 | 新 adapter 使用 OpenAI-compatible `POST https://api.minimaxi.com/v1/chat/completions`。官方另支持 `/v1/responses` 和 Anthropic-compatible，但本次没有实现这两条协议。 |
| 环境变量 / 门禁 | `MODEL_CHALLENGER_EVAL_ENABLED=false`、`MINIMAX_TEXT_ENABLED=false`、`MINIMAX_API_KEY`、`MINIMAX_BASE_URL`、`MINIMAX_MODEL=MiniMax-M3`、`MINIMAX_TEXT_SUPPORTS_STRUCTURED_OUTPUT=false`、`MINIMAX_TEXT_SUPPORTS_TOOL_CALLS=true`。还需把精确模型加入 `LLM_ALLOWED_MODELS`，并把 `api.minimaxi.com` 加到出站 allowlist。 |
| 路由 / 降级 | 离线同输入比较统一用服务端固定的 `billingMode=internal_eval + evaluationModelRef`；未来 shadow 才可用 `challenger_eval + challengerModelRef`。正式 tenant 请求不能指定任一 Eval 目标，Eval factory 也拒绝 tenant 模式。 |
| 安全响应 | 固定 `reasoning_split=true`；tool-call 续轮可内存透传 `reasoning_details`。非流与 SSE 都不向正文暴露 `<think>`；SSE 当前先缓冲并验证 `base_resp` 与 sensitive 标记，再交付正文。业务错误、敏感结果和不完整 reasoning 均 fail closed。 |
| 弹性 / 用量 | Eval gateway 提供 attempt/total timeout、指数退避、`Retry-After`、明确错误重试、熔断、取消、内存幂等；adapter 解析 input/cached-input/output/total token。显式选择有效 price band 时可估算 input/output/cache-read；Eval 的过期/缺失快照会在外呼前阻断。这些均未接产品和持久账本。 |
| 账号状态 | 官方公开可用已证实；项目账号 entitlement、TPS、延迟、成功率、5xx/超时结算均未证实。没有 key/live call。 |
| 证据 | `apps/api/src/services/minimax-model-provider.ts`、`apps/api/src/services/model-gateway-factory.ts:15-65`、`apps/api/src/config/env.ts:48-58,152-173`。 |

### 2.10 MiniMax / `MiniMax-H3`

| 字段 | 已审计事实 |
| --- | --- |
| 状态 | **候选 / flag-off / 未实现 adapter / 不可调用**。`MINIMAX_VIDEO_ENABLED=true` 会被 runtime config 明确拒绝。 |
| 官方能力 | 通用多模态视频生成，文本/图片/视频/音频输入，768P/2K、4–15 秒；不是文本对话模型。 |
| 官方协议 | Bearer + 异步 task：`POST https://api.minimaxi.com/v2/video_generation` 返回 `task_id`；查询 `GET /v2/query/video_generation/{task_id}`，终态 `succeeded|failed|cancelled`，成功结果 `task.content.url`。不要复用旧 Hailuo V1 契约。 |
| 环境变量 | `MINIMAX_VIDEO_ENABLED=false`、`MINIMAX_VIDEO_ENDPOINT`、`MINIMAX_VIDEO_MODEL=MiniMax-H3`、`MINIMAX_API_KEY`。 |
| 与视频复刻关系 | H3 支持“全能参考生成”，但没有同一输入/授权/原声/动作保持 Eval 证据，当前不能冒充 `video_replica`，不能替代 `wan2.2-animate-mix`。 |
| 账号状态 | 模型 ID、协议和公开价已证实；项目账号 entitlement、回调可靠性、稳定性、accepted 后 failed/cancelled 是否收费均未证实。 |
| 证据 | `apps/api/src/config/env.ts:56-58,171-173`、`config/model-gateway.json`、`packages/agent/evals/model-champion-challenger-cases.json:80-100`。 |

### 2.11 仅在策略白名单、未形成独立接入的模型 ID

`deepseek-v4pro`、`qwen3-max`、`qwen3-235b-a22b`、`qwq-plus` 只出现在高能力模型允许列表；仓库没有证明它们当前被任何环境选中、做过 live smoke 或具有独立价格/能力路由。证据：`apps/api/src/services/llm-model-policy.ts:1-8`。

## 3. 能力覆盖与重叠

| 能力标签 | 当前已证实模型 | 重叠 / 缺口 | 决定 |
| --- | --- | --- | --- |
| `text_standard` | DeepSeek V4 Pro；可选百炼 qwen-max | M3 可做 Challenger；V4 Flash 与低成本 Qwen 可能重复 | 保留 DeepSeek；qwen-max 保留可选；M3 只 Eval；Flash 暂不接 |
| `text_quality` | DeepSeek V4 Pro；可选 qwen-max | 高风险经营诊断不能按价格选路 | DeepSeek Champion，任何变更先同一 Eval |
| `text_long_context` | DeepSeek V4 Pro / qwen-max 代码路径 | M3 官方 1M，但项目未实测 | M3 Challenger，flag-off |
| `vision_analyze` | 百炼 qwen-vl-max | 同时承担 OCR 式提取，但不是独立 OCR | 保留，后续补 usage/tenant/task/timeout |
| `speech_to_text` | 百炼 qwen3-asr-flash、filetrans | 两条路径分别适合短 base64 与长文件异步 | 保留，不重复建设 |
| `video_replica` | 百炼 wan2.2-animate-mix | H3 任务语义不同 | 百炼保持 Champion，无自动 fallback |
| `video_generate` | 无产品接入 | H3 仅候选 | 账号/计费/稳定性确认前 flag-off |
| `image_generate` | 未发现 | qwen-vl 是分析，不是生成 | 暂不接 |
| `text_to_speech` | 未发现 | 无 | 暂不接 |
| `embedding` | 未发现 | 当前知识库是数据库/文本逻辑，不等于向量 Provider | 暂不接 |
| `rerank` | 未发现 | 无 | 暂不接 |

Pexels、Pixabay 是素材检索源，不是模型 Provider，不计入本模型台账。

## 4. 当前横切能力对照

| 项目 | 旧通用文本运行时（产品现状） | 百炼直接媒体路径（产品现状） | 新统一网关（Eval-only） |
| --- | --- | --- | --- |
| 流式 | adapter 有真实 SSE；`/chat/stream` 实际先非流式完成再按 32 字切片 | 无 | generic adapter 有 SSE；M3 为终态安全校验采用缓冲 SSE；用户可见 delta 后失败禁止 fallback |
| 结构化输出 | 无原生 contract，靠 prompt + repair | 靠 prompt/JSON 解析 | contract 按格式声明；Eval DeepSeek 仅 `json_object`，Aliyun/M3 默认 false；M3 strict JSON 未证实 |
| 工具调用 | 无 | 无 | contract/解析含 assistant/tool 续轮、允许工具名和 JSON 参数校验；Eval DeepSeek/M3=true，Aliyun=false |
| 超时 | transport 180s + Agent 分步超时 | qwen-vl/短 ASR 无 fetch timeout；filetrans 有动态轮询超时 | 文本 attempt 120/180/240s + total 180/240/300s；AbortController |
| 重试 / fallback | 无 Provider retry/failover；业务确定性 fallback | 多为 warning/fallback analysis；不切模型 | 仅明确网络/408/429/5xx/timeout 退避重试；高风险 quality/long-context 无自动 fallback，standard 可用已登记 qwen-max |
| 熔断 | 无 | 无 | 默认连续 3 次可重试失败打开 30s；仅进程内 |
| 幂等 | 正式 Agent DB requestId；推理前无跨进程锁 | 多数无；视频 job 有 tenant/requestKey 唯一约束 | tenant+task+key 的 in-flight promise 去重，执行中不淘汰、成功后保留 5 分钟；流重放拒绝；仍非跨进程、非持久 |
| 取消 | 部分正式 Agent/MCP 路由传 signal；旧 stream 和直接路由不一致 | 基本无 | 父 signal + route timeout；仅 Eval |
| usage / 成本 | 不解析；固定积分 | 不解析；视频按固定积分报价 | 解析 input/cached-input/output/total token；Eval 价格/band/有效期缺失会 fail closed；只估最终结果，尚无 retry 总成本或持久账本 |
| 观测 / 脱敏 | 只有 provider 名写 AgentRun，原始错误可能透传 | 原始错误片段可能进 warning | 100ms 有界 observer 只发 HMAC 化 tenant/task/request/idempotency/provider-request ref 和安全 code；attempt 不标用户可扣费；尚未持久化 |

## 5. “视频复刻”完整调用链

### 5.1 用户到供应商

1. 页面入口在 `apps/web/src/pages/AgentProductsApp.tsx` 的内容系统；`ContentSystemWorkbench.tsx` 维护素材、四项授权、模型模式、报价和确认状态。
2. “查看报价”调用 `POST /viral-video-replication/quote`。API 解析 tenant，验证 `aliyun_strict`、原视频/人物图、HTTPS 直链或本租户文件、四项授权；Seedance 模式明确不开放。
3. 站内上传先调用 `POST /files`。文件保存在 `UPLOAD_DIR/{tenantId}/...`，`UploadedFile` 写入 `tenantId/userId/storagePath/sha256`；后续按 `tenantId + fileId` 校验归属。证据：`apps/api/src/routes/files.ts:10-50`、`apps/api/src/services/file-storage.ts:16-35`、`packages/db/prisma/schema.prisma:1025-1039`。
4. 目前站内文件没有安全转成供应商可读临时 URL；确认接口必须在该能力就绪前拒绝只传 fileId 的付费任务。直接 URL 也必须通过后端 URL/出站/素材约束，不能接受抖音、小红书等播放页。
5. 报价只有在专用 key、官方 endpoint、`ALIYUN_VIDEO_REPLICATION_CREDITS > 0` 和持久结果存储就绪时才可确认；预览/报价本身不得扣分或调用供应商。当前持久存储门禁固定为未就绪，因此 `canConfirm=false`。
6. 当前“确认生成”调用 `POST /viral-video-replication/confirm` 后，会在建单、扣分和外呼前返回 `durable_output_storage_required`。这条 fail-closed 行为保证当前缺存储时不会产生用户积分或供应商费用。
7. 门禁未来就绪后，下游已实现页面 UUID/`X-Idempotency-Key`、`(tenantId, requestKey)` 重放、余额大于等于费用的原子条件扣减、同事务 job/consume，以及向官方 endpoint 提交固定模型 `wan2.2-animate-mix`。submit 未接受或终态失败/取消时，以原子 billing claim 保证最多退款一次；真实 DB 并发仍未做集成实证。
8. API 已实现 tenant-scoped 单 job GET，按需查询官方 task 并归一 `PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED/CANCELLED/UNKNOWN`；callback 可接收归一化 EventBridge `data`，成功但缺 URL 时再查 task，查询失败保留可恢复错误。尚无后台 reconciler，页面也未调用单 job GET 做刷新/轮询。
9. 百炼成功 URL 和 task ID 只保留 24 小时。源码明确持久转存尚未实现；新任务因此被硬阻断，旧 job 即使有 supplier URL 也只会标为临时结果，不能当永久成片。
10. 页面目前完成 quote/confirm 卡片与弹窗，但尚未展示 jobs/error/retry，也未接状态恢复、退款和持久成片下载 E2E。

### 5.2 任务、文件和计费状态

`ViralVideoReplicationJob` 当前持久化 tenant/user/requestKey/model/status、输入引用、授权快照、creditCost/billingStatus、providerTaskId/status、output/error/completedAt，并以 `(tenantId, requestKey)` 唯一。证据：`packages/db/prisma/schema.prisma:1042-1069`。

必须维持以下状态不变量：

- quote/draft：不调用供应商、不扣积分；
- reserved/submitted/processing：最多一笔用户 consume/reserve；重试或轮询不再扣；
- succeeded：供应商 usage 可审计、结果已持久转存后才 capture/charged；
- failed/cancelled/expired：只执行一次退款；供应商若因边缘计费产生费用由系统成本承担，不能二次扣用户；
- 同一 tenant + requestKey 重放返回原 job；跨 tenant 不得命中或读取；
- Eval/内部对照永不创建正式租户积分交易。

### 5.3 P1 缺口与放行条件

以下任一未关闭时，不应开放真实付费视频复刻：

1. **持久结果存储缺失**：源码明确 `isDurableReplicationOutputStorageReady() === false`；百炼结果 24 小时过期。必须实现租户隔离下载/转存、失败恢复和 E2E。
2. **站内文件供应商暂存缺失**：`/files` 只有租户本地路径，不能直接给百炼；在受控临时 URL/OSS 上传完成前，文件 ID 路径必须 fail closed 且不扣费。
3. **自动恢复与 UI 未闭环**：API 已有单 job 按需 task query、状态归一和 callback 后补查，但没有后台 reconciler；页面未调用单 job GET，无法在刷新/回调丢失后向用户展示恢复、错误或重试。还需覆盖 UNKNOWN、进程重启和临时 URL 到期。
4. **扣退原子逻辑缺真实 DB 并发实证**：源码已有余额条件 `updateMany` 和 refund claim，但并发同 requestKey、重复失败 callback/轮询、成功后迟到失败事件及 A/B 租户必须用真实 DB 集成测试证明只扣或退一次。
5. **真实页面 E2E 未完成**：quote、授权缺失、持久存储硬阻断、余额不足、重复点击、刷新恢复、失败可见、退款、结果下载、A/B 租户隔离尚未在真实页面与真实 API 配置下验证。
6. **没有供应商账号 live smoke**：本轮禁止付费媒体调用，故账号 entitlement、workspace/地域 endpoint、实际限流和账单仍未证实。只能在用户批准预算和测试环境后做最小 smoke。

已有测试：`scripts/viral-video-replication-smoke.ts` 已冻结官方模型/endpoint/body/header、task 状态归一、tenant 单 job 查询、持久存储 fail-closed，并以注入式 Fastify quote/confirm 证明不外呼、不扣分；`package.json` 提供 `content-system:viral-replication-smoke`。它仍不能替代 live API、真实 DB 并发、后台恢复、存储和页面 E2E。

## 6. 官方价格快照

所有行均为 `observedAt=2026-08-14`。不得把本表复制进业务逻辑；配置至少保存 currency、region、tier/context band、unit、effectiveFrom、observedAt、sourceUrl、verification。

| Provider / 模型 | 地域 / 生效时间 | 官方公开价 | 状态 / 来源 |
| --- | --- | --- | --- |
| DeepSeek `deepseek-v4-pro` | 中国区；2026-08-14 至 2026-08-16 | cache-hit 输入 ¥0.025/M；cache-miss 输入 ¥3/M；输出 ¥6/M | 当前快照；[DeepSeek 中国区官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) |
| DeepSeek `deepseek-v4-flash` | 中国区；2026-08-14 当前 | ¥0.02/M；¥1/M；¥2/M（顺序同上） | 未接入；同上 |
| DeepSeek `deepseek-v4-pro` | 2026-08-17 00:00 Asia/Shanghai 起 | 空闲 ¥0.15/4.5/13.5；高峰 ¥0.30/9/27 | **未来价，不得提前生效**；同上 |
| DeepSeek `deepseek-v4-flash` | 2026-08-17 00:00 Asia/Shanghai 起 | 空闲 ¥0.05/1.5/4.5；高峰 ¥0.10/3/9 | **未来价，未接入**；同上 |
| 百炼 `qwen-max` | 华北 2（北京） | 输入 ¥2.4/M；输出 ¥9.6/M | [百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing) |
| 百炼 `qwen-vl-max` | 华北 2（北京） | 输入 ¥1.6/M；输出 ¥4/M | 同上；当前代码未采集 usage |
| 百炼 `wan2.2-animate-mix` | 华北 2（北京） | `wan-std` ¥0.6/成功输出秒；`wan-pro` ¥0.9/成功输出秒；处理失败不计费 | [百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[视频换人 API](https://help.aliyun.com/zh/model-studio/wan-animate-mix-api) |
| MiniMax `MiniMax-M3` | 中国区 standard；输入 ≤512K | 输入 ¥2.10/M；输出 ¥8.40/M；cache read ¥0.42/M | Challenger，账号未证实；[MiniMax 按量计费](https://platform.minimaxi.com/docs/guides/pricing-paygo) |
| MiniMax `MiniMax-M3` | 中国区 standard；输入 >512K | 输入 ¥4.20/M；输出 ¥16.80/M；cache read ¥0.84/M | 同上 |
| MiniMax `MiniMax-M3` | 中国区 priority；≤512K / >512K | ¥3.15/12.60/0.63；¥6.30/25.20/1.26 | 官方说明为 standard 1.5 倍；同上 |
| MiniMax `MiniMax-H3` | 中国区 | 输出 768P ¥0.50/秒、2K ¥0.80/秒；输入视频按同分辨率/秒计；音频免费；前 5 图免费，超出 ¥0.20/张 | flag-off；失败/取消计费 `unknown`；[MiniMax 按量计费 - 视频](https://platform.minimaxi.com/docs/guides/pricing-paygo#视频) |
| MiniMax `MiniMax-H3-Regeneration` | 中国区 | 768P→2K 输出 ¥0.30/秒；原输入重新计费 | 非当前接入范围；同上 |
| MiniMax `MiniMax-H3-Context-IR` | 中国区 | 输入 ¥5.80/M；输出 ¥23/M | 非当前接入范围；同上 |

`qwen3-asr-flash`、`qwen3-asr-flash-filetrans` 的项目实际价格、免费额度和账号合同本轮未核对到足以硬编码的粒度，保持 `account_contract_required`，只链接[百炼统一价格目录](https://help.aliyun.com/zh/model-studio/model-pricing)。

## 7. 最小接入建议

| 分类 | 模型 / 路径 | 决定 |
| --- | --- | --- |
| 保留 | DeepSeek V4 Pro | 经营诊断和高质量文本 Champion；无同一 Eval 不切换 |
| 保留 | 百炼 qwen-vl-max、两条 ASR、wan2.2-animate-mix | 现有视觉、语音与视频复刻能力，不重复建设 |
| 保留可选 | 百炼 qwen-max | 现有国内文本路径；是否成为正式 fallback 必须经同一 Eval 和计费验证 |
| 补充 Challenger | MiniMax M3 | 仅 Eval；feature flag 默认关闭，不进用户端模型选择 |
| 暂不接 | DeepSeek V4 Flash | 与百炼低成本文本潜在重复，先证明需求 |
| 暂不接 | MiniMax H3 | 仅登记 `video_generate` 候选；权限、失败计费、稳定性未确认，且不能替代 video replica |
| 暂不建设 | image_generate、TTS、embedding、rerank | 当前源码没有明确已用需求，不为标签完整而造空 adapter |
| 退役候选 | 无 | 没有 Eval 和迁移证据，不删除任何现有 Provider |
