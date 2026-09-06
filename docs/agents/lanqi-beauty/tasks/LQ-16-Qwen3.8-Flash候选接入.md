# LQ-16 Qwen3.8-Flash 候选接入

状态：已完成

## 归属

- 产品：兰琪美业经营增长智能体平台
- 层级：产品任务含平台子改动
- 风险：中
- 预计修改热点：兰琪模型策略、国内模型网关请求参数、环境配置、Eval 与产品契约
- 是否允许并行：否；本次只交付一个默认关闭的候选模型通道

## 用户结果

在不改变兰琪现有 DeepSeek V4 Pro 专业输出的前提下，系统具备可审计、可关闭、可回滚的 Qwen3.8-Flash 低风险候选通道。

## 本次范围

- 将阿里云百炼 `qwen3.8-flash` 登记为兰琪低风险分类、标签和格式转换候选。
- 候选只有“显式启用 + 同套 Eval 批准”同时成立时才可被选中。
- 为百炼 OpenAI 兼容调用补齐 Qwen 非思考模式与 JSON 输出参数。
- 建立不联网、不计费的模型选择、请求合同和失败关闭 Eval。
- 按用户 2026-09-03 明确授权，以同一批脱敏低风险 Eval 对 `qwen3.8-flash` 最多真实调用 3 次；无重试、换模或追加，费用硬上限 ¥0.05。

## 本次不做

- 不替换 `deepseek-v4-pro`，不改变小红书文案、知识综合、专业图片提示词或视觉修改模型。
- 除本次明确授权的 3 次 `qwen3.8-flash` Challenger 外，不调用其他真实模型；不依赖免费额度判断成本。
- 不将候选沉入全平台默认模型，也不宣称已通过真实业务质量对比。
- 不接入图片生成；Qwen3.8-Flash 输出为文本，图片仍由已批准媒体模型执行。

## 验收条件

1. 正常路径：低风险任务在显式启用且 Eval 批准时选择 `qwen3.8-flash`，请求显式关闭思考并支持 JSON 输出。
2. 失败路径：未启用、未批准、未知模型或缺少密钥时在网络请求前失败关闭或继续使用 Pro。
3. 不应发生：专业任务不得切到 Flash；现有高能力模型门禁不得把 Qwen Flash 当作 Pro；不得发起真实 Provider 调用。
4. 可观测结果事件：模型策略可返回选定模型、推理档位；Provider 日志沿用脱敏的 provider/model、请求指纹、状态和 usage 事件。

## 基线与失败证据

- 基线命令：`pnpm.cmd lanqi:runtime-model-policy-eval`
- 修复前失败测试/Eval：`pnpm.cmd lanqi:qwen38-flash-candidate-eval`
- 现象、根因和连带影响：现有策略仅登记 DeepSeek V4 Flash，且共享 Provider 会拒绝所有 Flash；百炼请求也未显式关闭 Qwen3.8 默认思考或发送 JSON 输出参数，因此不能安全接入为低风险候选。

## 实现记录

- 修改文件：`lanqi-runtime-model-policy.ts`、`llm-provider-factory.ts`、`domestic-chat-provider.ts`、`env.ts`、`.env.example`、`prelaunch-check.mjs`、新候选 Eval、兰琪契约/工作流/测试矩阵/状态与任务索引。
- 数据/接口/配置变化：新增 `LANQI_LOW_RISK_TEXT_MODEL`、`LANQI_LOW_RISK_TEXT_ENABLED`、`LANQI_LOW_RISK_TEXT_EVAL_APPROVED`；默认值分别为 `qwen3.8-flash / false / false`，无数据库迁移和用户 API 变化。
- 兼容性和回滚点：默认关闭；删除候选配置和专用工厂即可回滚，不影响现有 Pro 路径。

## 验证

- 领域命令：`pnpm.cmd lanqi:qwen38-flash-candidate-eval` 连续 3/3 PASS；`pnpm.cmd lanqi:runtime-model-policy-eval`、`pnpm.cmd qa:lanqi-foundation` PASS。
- `pnpm.cmd qa:fast`：PASS；`pnpm.cmd qa:regression` PASS；`pnpm.cmd qa:full`（含 build）PASS。
- 页面/E2E：未运行；本次没有页面、DOM、路由、数据库或客户运行路径变化，现有小红书图文专项由领域和全仓门禁回归通过。
- 未运行项：评测合同修正后的真实三连 Challenger；原授权在 2 次调用后已安全终止且不复用。

### 2026-09-03 真实 Challenger

- 用户授权边界：仅 `qwen3.8-flash`、同一脱敏低风险 Eval、最多 3 次、无重试/换模/追加、费用硬上限 ¥0.05。
- 预检第一次因正式配置使用已验收的阿里云百炼工作空间域名而非公共域名，在网络前失败关闭；Provider 0、费用 ¥0。核对其已存在于正式国内出口白名单和既有 BY-15 受控验收白名单后，仅允许该精确域名继续。
- 实际发起 2 次 Provider 调用后停止：第 1 次 Schema/事实/合规/污染门禁全部 PASS；第 2 次 HTTP 200、`finish_reason=stop`、思考 tokens 0，但评测器错误要求 `price-1` 的 `normalized` 在输出“待确认”之外还必须重复“价格”二字，因此判失败。两次估算总费用 ¥0.002923；第 3 次未调用，重试/换模/追加均为 0。
- 该失败属于评测合同与提示合同不一致，不是百炼 API 故障，也不足以证明 Challenger 质量失败。已以 `待确认` fixture 固化回归并移除多余断言，未知价格、禁止编造数字和其余事实/合规门禁均未放宽。
- 当前结论：真实准入仍为“证据不足”，Qwen 默认关闭且不进入客户路径。若要补足连续 3 次真实准入证据，需要新的精确调用授权；本次授权不复用。
- 修复后验证：`lanqi:qwen38-flash-live-eval-contract-smoke`、候选 Eval、运行时模型策略 Eval、API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）全部 PASS；这些命令未进行额外真实 Provider 调用。
- 第二批授权：用户于 2026-09-03 明确批准全新受控批次；仍仅限 `qwen3.8-flash`、同一份已修正脱敏 Eval、最多 3 次、无重试/换模/追加，费用硬上限 ¥0.05。
- 第二批结果：严格 3 次 Provider 调用全部 PASS；三次均 `HTTP 200 / finish_reason=stop / reasoning_tokens=0`，结构、意图、事实、未知价格、标签去重、合规标记、格式和污染门禁全部通过。用量分别为 `418+400`、`418+369`、`418+409` tokens，估算费用分别 ¥0.001414、¥0.001331、¥0.001439，合计 ¥0.004184；最坏预检 ¥0.021106≤¥0.05。重试/换模/追加/额外调用均为 0。
- 准入结论：`qwen3.8-flash` 已达到兰琪低风险候选的真实准入线。代码与默认环境仍为关闭；只有后续为某个明确低风险能力同时打开 `enabled + evalApproved` 才会承接流量，专业任务继续固定 `deepseek-v4-pro`。

## 交接

- 残余风险：真实准入只覆盖低风险分类、标签、事实整理、合规标记和格式转换，不证明专业知识综合、小红书文案或图片提示词质量。
- 后续任务：在出现明确低风险产品能力时，单独建立该能力的 Champion/Challenger 和流量开关；未经该能力专项验收，不扩大到专业任务。
- 最后更新日期：2026-09-03
