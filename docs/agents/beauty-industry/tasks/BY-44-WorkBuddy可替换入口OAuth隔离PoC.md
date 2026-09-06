# BY-44 WorkBuddy 可替换入口 OAuth 隔离 PoC

状态：业务验收（本地协议与安全门禁已完成；外部 WorkBuddy 开发者后台连接未完成）

## 归属

- 产品：美业智能体（兰琪品牌包入口验证）
- 层级：产品任务含平台协议薄适配
- 风险：高（身份、租户、授权、审计）
- 预计修改热点：`apps/api/src/products/beauty-industry/workbuddy-oauth-poc.ts`、`scripts/beauty-industry-workbuddy-oauth-poc-smoke.ts`、根脚本索引与美业质量文档
- 是否允许并行：否；不恢复 BY-43、BY-19、BY-20，不启动候选 C/D/E

## 用户结果

在完全合成、零模型、零媒体、零积分环境中，用 OAuth 2.1 + PKCE 获取思潼签发的最小权限令牌，并由 WorkBuddy 兼容 MCP 客户端只读调用唯一工具 `lanqi.get_profile_summary`；思潼仍是身份、租户和数据唯一事实源。

## 本次范围

- 实现动态公共客户端注册、授权码 + PKCE S256、一次性 code、短时效 access token 与吊销。
- 验证 `iss/aud/sub/exp/nbf/iat/scope/jti`，以 `sub` 映射合成思潼用户，并在每次工具调用重新执行租户、资源、产品与 scope 授权。
- 只暴露 `lanqi.get_profile_summary`；业务数据只读，审计和非计费 usage 独立，`billable=false`，积分余额不变化。
- 明确拒绝 query/body/header/MCP context 中客户端自报的 tenant/user/product 身份。
- 量化验证 30 次顺序、10 并发、P95/最大耗时、超时取消、幂等 replay、限流、脱敏与高风险三轮一致。

## 本次不做

- 不接真实 WorkBuddy 账号、客户数据、Open API `open_id`、正式发布或生产配置。
- 不增加写工具、模型/媒体调用、积分预留/扣减、候选 C/D/E、BY-43/BY-19/BY-20。
- 不把 WorkBuddy 候选文件作为运行依赖；不使用用户自填 Token 备选冒充 OAuth 主链。

## 验收条件

1. 正常路径：公共客户端无 secret，PKCE S256 成功换取一次性 access token；`initialize/tools/list/tools/call` 只出现并成功执行唯一工具。
2. 失败路径：无效/过期/吊销令牌 401；有效令牌带身份注入 400+审计；跨租户 404；归属正确但 scope 不足 403；审计失败 503 fail-closed。
3. 不应发生：业务数据、积分或 Provider 状态变化；重复请求重复 usage；响应/日志/错误包含 token、手机号、原始画像或跨租户信息。
4. 可观测结果事件：仅保留脱敏 subject/tenant/jti/request 指纹、固定工具、状态、耗时、replay、`billable=false`；审计与 usage 为独立记录。

## 基线与失败证据

- 基线命令：`pnpm.cmd beauty-industry:workbuddy-oauth-poc-smoke`
- 修复前失败测试/Eval：首次执行稳定失败为 `Cannot find module '../apps/api/src/products/beauty-industry/workbuddy-oauth-poc.js'`，证明仓库尚无 OAuth 2.1 + PKCE 隔离入口，不能把原静态 Bearer MCP 当成主链。
- 现象、根因和连带影响：当前正式仓库已有静态/数据库 Bearer MCP 连接和完整美业工具集，但没有隔离的 OAuth 2.1 + PKCE 授权服务器与单工具 PoC；不能以旧 token 连接冒充 OAuth 主链。

## 实现记录

- 修改文件：
  - `apps/api/src/products/beauty-industry/workbuddy-oauth-poc.ts`：隔离的授权服务器与单工具 MCP PoC；未注册进正式 `server.ts`。
  - `scripts/beauty-industry-workbuddy-oauth-poc-smoke.ts`：全合成协议、安全、租户、幂等、可观测与性能回归。
  - `package.json`：增加专项命令并纳入 `qa:regression`。
  - 本任务卡、`STATUS.md`、`TEST_MATRIX.md`、`tasks/README.md`、`BUG_REGRESSIONS.md`：脱敏证据与恢复点。
- 数据/接口/配置变化：仅隔离 PoC 模块和合成测试 runner；不注册到生产 server，不新增数据库迁移。
- 兼容性和回滚点：删除 PoC 模块、runner 与脚本项即可；现有 WorkBuddy MCP、业务数据库和页面不改。

## 验证

- 领域命令：`pnpm.cmd beauty-industry:workbuddy-oauth-poc-smoke` PASS；30次顺序、10次并发，多次门禁 P95 `0.346–1.399ms`、最大 `1.941ms`；高风险样例同批3轮一致。
- 类型检查：`pnpm.cmd --filter @baolu/api typecheck`、`pnpm.cmd --filter @baolu/agent typecheck` PASS。
- `pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含全仓 build）、`git diff --check`：PASS；仅有既有工作树 LF/CRLF 提示，无 whitespace error。
- 页面/E2E：无产品页面改动；外部 WorkBuddy 开发者后台未接通前不能把本地协议测试宣称为真实 WorkBuddy 页面 E2E。
- 未运行项：真实 WorkBuddy 后台注册/登录/审核、1440/390 外部页面 E2E、Provider、生产部署；原因是缺外部测试 Connector 与非生产 HTTPS 配置，不影响本地协议结论，但阻断技术层完整放行。
- 环境：本轮不启动或接管旧验收环境；只读复核 3016 API 与 5176 Web 均离线。没有创建邀请码或可测试页面。

## 交接

- 残余风险：产品代码 P0=0；本地 PoC 范围 P1=0；外部 WorkBuddy 技术层验收仍有1项前置条件，不能宣称第②层已完整通过。
- 后续任务：用户需在 WorkBuddy 开发者后台创建/授权一个非生产测试 Connector，并提供其可登记的回调 URI 与测试配置窗口；之后才能把思潼的非生产 HTTPS OAuth/MCP 地址接入做真实浏览器授权与 WorkBuddy 调用验收。不自动扩展工具。
- 最后更新日期：2026-09-03
