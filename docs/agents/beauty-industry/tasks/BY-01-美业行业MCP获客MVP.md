# BY-01 美业行业 MCP 获客 MVP

状态：已暂停（本地受控验收版已保留；因整体行业智能体版面待用户确认，禁止继续编码）

## 归属

- 产品：美业行业通用智能体
- 层级：产品任务含共享平台 handoff
- 风险：高
- 预计修改热点：美业专属 Skill/Agent/MCP adapter/Eval/页面；共享 product/Agent/MCP 注册只交接不直接覆盖
- 是否允许并行：否

## 用户结果

获授权用户用一条“美业行业 MCP 连接”在 WorkBuddy 发现并调用美业获客工具，得到品牌中立、事实安全、可执行的美业获客结果；同一能力保留简洁网页入口。

## 本次范围

- 稳定 `productCode=beauty-industry` 和产品/凭据/工具契约。
- 首批修订并验收美业合规、内容差异和小红书图文行业 Skill。
- 复用目标/策略、选题、内容、图文、已开放媒体、投流预览、直播话术和复盘能力；实际未就绪项不开放。
- 一个产品凭据发现多个已授权 tools；协议级和真实 WorkBuddy E2E。
- 简洁品牌中立网页入口，调用同一后端能力。

## 本次不做

- 兰琪品牌版、其他行业、销售/交付/诊断/日报/问答正式工具。
- 完整支付退款对账后台、生产部署、真实付费媒体、自动发布或投流。
- 大规模迁移现有 `/lanqi` 源码和数据。

## 验收条件

1. 正常路径：后台受控开通后生成一次显示 secret；WorkBuddy 连接一个 server URL，`tools/list` 看到美业获客工具并完成真实 `tools/call`。
2. 失败路径：缺资料、无 token、错产品、过期/撤销、余额不足、超时/取消、重复请求和 Provider 失败均有明确终态且不重复扣费。
3. 不应发生：兰琪或 A/B 验收店泄露、其他行业污染、跨租户/产品/凭据/知识访问、未确认付费媒体、自动发布投流付款、把 Skill 文件交给用户。
4. 可观测结果事件：`beauty_mcp.connected/tools_listed/tool_called/clarification_required/succeeded/failed/timed_out/canceled/idempotent_replay/credits_rejected`，均关联 credential/run/capability/channel/provider。

## 基线与失败证据

- 基线命令：`workbuddy:selfservice-smoke`、`channel-gateways-smoke`、`qa:regression`。
- 修复前失败测试/Eval：`scripts/beauty-industry-mcp-contract-smoke.ts` 在产品适配器不存在时以 `MODULE_NOT_FOUND` 稳定失败；实现适配器后 PASS。`qa:fast` 首轮还发现 3 个 Skill contract/examples 不符合统一质量资产结构，补齐交付字段、最小长度、评分阈值和样板章节后 `quality:assets` PASS。
- 现象、根因和连带影响：现有共享 WorkBuddy MCP 以 Agent 为连接范围，兰琪图文链和 Skill 含兰琪命名；候选美业 Skill 均未通过生产门禁，不能直接拼成行业产品。

## 实现记录

- 修改文件：产品目录文档与质量资产；共享 product/Skill/Agent 注册；现有 WorkBuddy settings/MCP 路由与 resolver；统一积分预留/结算服务；Prisma schema 与唯一迁移；美业共享执行服务、产品 API、品牌中立网页、产品登录与连接管理；专项协议/页面 smoke 和持久验收脚本。
- 数据/接口/配置变化：`WorkbuddyMcpConnection` 加产品、经营主体、scopes、到期/撤销/轮换/限流字段；`AgentRun`、`CreditTransaction` 增加 product/channel/credential usage 关联；新增 `CreditReservation`。创建接口接受 `productCode=beauty-industry`，轮换仍只返回一次 secret。
- 兼容性和回滚点：字段均为加法且历史连接保持 product 为空的兼容路径；迁移目录含 `rollback.sql`，回滚会删除本次 usage 元数据与 reservation，执行前必须备份。旧 `/lanqi`、FIP、外卖和旧 WorkBuddy 连接回归保持通过。
- 双入口：网页 `channel=web` 与 MCP `channel=mcp` 均调用 `apps/api/src/products/beauty-industry/execution.ts`，共用 Agent、Skill、知识版本、授权、CreditReservation 和 usage ledger；没有复制 Prompt 或另建账本。
- 产品权限：美业产品登录只授予 `beauty-industry` entitlement 及该产品 Agent access；修复后账户页只显示一个美业产品连接，不能看到或创建兰琪、FIP、外卖产品连接。

## 验证

- `quick_validate.py`：3 个新 Skill 均 PASS。
- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-industry-mcp-contract-smoke.ts`：PASS。
- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-industry-policy-eval.ts`：PASS，8 类×3，24 个硬检查，硬失败 0。
- `pnpm quality:assets`：PASS，issues 0、warnings 0。
- `scripts/beauty-industry-workbuddy-platform-smoke.ts`：修复前稳定 FAIL（缺产品注册），共享合入后 PASS，并纳入 `qa:regression`。
- `scripts/beauty-industry-workbuddy-mcp-smoke.ts`：隔离 PostgreSQL + mock Provider PASS；覆盖握手、工具过滤、错误产品、跨租户、伪造身份、成员/entitlement 重查、过期/撤销/轮换、余额不足、成功结算、重复键、Provider 失败、超时和取消。
- 迁移：`202608210001_beauty_industry_mcp_credentials` 在隔离库全量升级 PASS、幂等复跑 PASS；独立回滚夹具 rollback/reapply PASS；未执行生产迁移。
- `pnpm qa:fast`、`pnpm qa:regression`、`pnpm qa:full`、`git diff --check`：PASS；使用仓库声明的 `pnpm@9.15.0` 合法入口。
- 协议 E2E：`scripts/verify-beauty-industry-live-mcp.ts` 对真实 HTTP server 完成 `initialize/tools/list/tools/call`，3 个工具调用、1 个网页调用；覆盖 scope、错产品、跨租户、伪造身份、撤销、过期、轮换旧 secret、重复 idempotency、余额不足与失败释放。结果 `tools=8;mcp_calls=3;web_calls=1;paid_provider_calls=0`；secret 未进入输出、报告或截图。
- 页面/E2E：品牌中立网页在桌面与 390×844 实际浏览器完成登录、空态、正常生成、阶段/取消、复制、历史保存与刷新恢复、断网和恢复、账户连接页产品隔离；控制台和关键请求无新增产品错误。断网文案从原始 `Failed to fetch` 修为中文可恢复提示。
- 持久验收环境：`F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821`；PostgreSQL `127.0.0.1:55434`、API `127.0.0.1:3016`、Web `127.0.0.1:5176`。迁移首跑、二次幂等与状态脚本 PASS；当前 `database=true`、`web_status=200`。
- `pnpm.cmd qa:full`：2026-08-21 原始命令 PASS，包含 `qa:fast`、`qa:regression` 和全仓 build；`git diff --check` 在文档收口后复跑。
- 未运行项：WorkBuddy 桌面应用原生配置（以等价真实 HTTP MCP 客户端完成协议验收）、真实 Provider、生产迁移、部署、支付和付费媒体；受控 mock 页面明确标识不代表正式内容质量。本轮费用 0。

## 交接

- 暂停原因：用户要求先重新规划并确认整体行业智能体版面设计；在确认前不得继续网页、MCP、品牌版或共享热点开发。
- 准确恢复点：BY-01 品牌中立网页、共享执行链、真实 HTTP MCP 协议 E2E、桌面/390px E2E 和 `qa:full` 已完成并保留；恢复时先读取用户确认后的整体版面契约，以当前代码和本任务卡为基线复核，不重复实现已通过的共享底层。
- 保留/回退边界：保留 `beauty-industry` product、3 个美业 Skill、Agent/MCP 产品凭据、CreditReservation/usage ledger、品牌中立网页和持久本地验收环境；不得把未确认的新导航、一级板块、兰琪品牌层或生产配置混入现状。若新版面要求改变既有已验收主链，必须先建立独立任务卡和修复前回归，不直接覆盖。
- 残余风险：当前是本机受控验收，不是公网生产；WorkBuddy 原生客户端仍需用户按一次性 secret 领取流程做最终连接确认。正式 Provider 内容质量、支付、退款、充值与生产部署仍需独立任务和授权。
- 共享依赖：已解除。本地验收 MCP URL 为 `http://127.0.0.1:3016/integrations/workbuddy/mcp`；公网 URL 未在本轮验证，禁止宣称上线。
- secret 领取：获授权用户在产品登录会话中调用 `POST /integrations/workbuddy/connections`，body 只传 `productCode=beauty-industry`、允许的 scopes 和可选到期天数；响应中的 secret 只显示一次，之后列表仅返回 prefix。不得复制到聊天、任务卡、日志或仓库。
- 后续任务：保持暂停；只有整体行业智能体版面经用户明确确认后，才从上述恢复点建立下一张单一任务卡。不得自动开始兰琪品牌版。
- 最后更新日期：2026-08-21
