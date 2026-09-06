# BY-37 XHS 本机真实验收配置持久恢复 P1

状态：已完成

## 归属

- 产品：美业智能体（兰琪本机验收实例）
- 层级：产品验收环境维护脚本；不改变生产产品能力
- 风险：中
- 修改热点：`scripts/acceptance/beauty-industry/*`、XHS 真实 Chrome quote-only runner
- 是否允许并行：否

## 用户结果

本机受邀用户在服务重启后仍进入已经放行的真实 XHS 验收模式：文案固定正式 DeepSeek，图片只在文案成功且用户显式确认 300 积分后允许最多三张；页面不会因维护重启退回 mock 或把确认按钮无解释置灰。

## 本次范围

- 把已经批准的本机 XHS 用户验收模式记录为 AcceptanceRoot 内无密钥、可撤销的显式 profile。
- 正式启动时重新校验文本/媒体 approval、模型、单批张数、积分、本地存储和人民币上限；不符合则 fail-closed。
- runtime 记录和 API 复用决策增加非敏感的完整验收 profile 与媒体模式身份。
- 用既有真实成功文字 Run 做 quote-only 桌面/390px、刷新、跨租户验收；严禁调用确认接口或 Provider。

## 本次不做

- 不调用 DeepSeek、图片、视频、ASR 或其他 Provider，不产生费用。
- 不点击图片确认，不创建媒体任务，不部署生产，不恢复 BY-19/BY-20。
- 不修改历史 AgentRun 的 Skill/preview 记录，不把本机 dev-login 或真实媒体配置扩散到生产。

## 验收条件

1. 正常路径：正式 stop/start 后 status 为 `runtime_profile=xhs_user_acceptance_v1`、文本 configured、媒体 real/max3；已有正式文案显示可点击的三图 300 积分确认。
2. 失败路径：未知 profile、缺 approval、错误模型、超 3 张、超人民币边界或非本地存储均在 API 启动前失败关闭。
3. 不应发生：不得仅因源码/文本模式相同而复用错误媒体配置；不得调用 confirm、创建 Provider usage、泄露密钥或改变生产配置。
4. 可观测结果：runtime 只记录非敏感模式字段；1440/390px、刷新、跨租户、console、Provider0 均有机器证据。

## 基线与失败证据

- 修复前 status：source/runtime=`E037402C`且 fresh，但 `text=controlled_mock`、`media=disabled/max0`，与 BY-35 已放行的本机用户验收模式不一致。
- 修复前自动红灯：相同源码与 configured 文本下，runtime profile 从 `safe_default` 切换到 `xhs_user_acceptance_v1` 时旧 `Resolve-ApiStartDecision` 仍返回 Reuse；`offline-source-freshness-regression.ps1` 为 `PASS=56/FAIL=1`。
- 根因：启动脚本只把文本模式写入 runtime 并参与复用决策；媒体模式没有记录，且维护脚本默认不会恢复已批准的本机 XHS 验收 profile。`status.ps1` 又从调用者 shell 而非运行进程记录推断媒体状态。

## 实现记录

- `start.ps1`：增加 AcceptanceRoot 内 `xhs_user_acceptance_v1` 持久标记解析、未知值 fail-closed；启动时只在进程内读取 DeepSeek 密钥，并校验固定模型、三图、300积分、本地存储和人民币上限。
- runtime/启动决策：记录并比较 `runtimeProfile`、`mediaExecutionMode`、`mediaProductEnabled`、`maxRealImages`；模式不一致必须受控重启。
- `status.ps1`：只从受控 runtime record 报告实际文本/媒体身份，不再读取调用者 shell 的默认值冒充运行状态。
- `beauty-industry-xhs-image-live-acceptance.mjs`：新增严格 quote-only 路径，必须复用已保存正式 Run、不得携带 grant/approval，不点击 confirm，并核对 Provider usage 事件为 0。
- 数据变化：为既有合成正式 Run 的隔离验收租户续期 24 小时 beauty-industry entitlement，并通过既有幂等脚本发放 500 测试积分，仅用于 quote/页面状态验收；没有业务 Provider 或客户数据写入。
- 回滚：正式停止后移除 AcceptanceRoot 的 profile 标记与 approval 文件，再默认启动；代码回滚只涉及本卡列出的脚本。

## 验证

- 修复前红灯：`offline-source-freshness-regression.ps1` 为 `PASS=56/FAIL=1`；修复后为 `PASS=60/FAIL=0`，覆盖完整 profile 漂移、未知 profile 和安全默认值。
- 领域专项：XHS 同页图片、workbench-v2、real-media、media-observability、API/Web/Agent typecheck 全部 PASS。
- 仓库门禁：`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）和 `git diff --check` 全部 PASS；diff 仅有既有 CRLF 提示。
- 二次正式 stop/start：PG55434/PID4664、API3016/PID8544、Web5176/PID20456；source/runtime=`E037402C`、`source_fresh=true`、ready/database=true，profile=`xhs_user_acceptance_v1`、text configured、media real/max3。
- 页面/E2E：真实 Chrome 1440/390px quote-only PASS；300 积分确认按钮可用，刷新/返回/跨租户/overflow/console PASS，确认请求0、Provider调用0。
- 费用与数据：外部 Provider 0、费用¥0；隔离合成租户续期24小时并幂等发放500测试积分，仅用于quote状态验收。
- 未运行项：真实文案/图片调用（本任务明确禁止且 BY-35 已有真实放行证据）。

## 交接

- 残余风险：范围内 P0/P1=0；本机验收 profile 不扩散到生产，BY-19/BY-20继续 PAUSED。
- 后续任务：无；BY-19/BY-20继续 PAUSED。
- 最后更新日期：2026-08-30。
