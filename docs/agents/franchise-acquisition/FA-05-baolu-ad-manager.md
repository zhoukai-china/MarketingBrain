# FA-05 投流入口调度 Skill 正式化

状态：自动验收完成

## 归属

- 产品：品牌招商（FA-05 投流预览）；可复用的 Skill 治理资产仍归平台。
- 层级：产品任务含 Skill 治理子改动。
- 风险：高。涉及投流建议、真实账户边界和租户隔离，但不执行真实外部操作。
- 预计修改热点：`mcp-skills/skills/baolu_ad_manager/`、`packages/skills/skills/baolu_ad_manager/`、Eval、治理台账和独立 smoke；不修改共享注册文件。
- 是否允许并行：是；不得触碰 FIP/LQ-09 共享热点。

## 用户结果

用户可获得跨投流场景的最小事实追问、专项路由或预算预览草案，而不会被声称已投放、付款或已取得结果。

## 本次范围

- 正式化 `baolu_ad_manager` 为付费流量入口与调度/诊断总控。
- 路由本地推到 `optimize_local_push_ads`，DOU+ 到 `dou_plus_ads`；明确场景不重复输出专项大方案。
- 补 MCP 原始包、fallback、contract、sample、结构化 Eval 和治理哈希。

## 本次不做

- 不变更共享注册、Agent allowlist、路由实现或产品页面。
- 不修改 `xiaohongshu_ops`、`baolu_ip_advisor`、专项 Skill、真实广告账户或付费行为。

## 验收条件

1. 明确本地推、DOU+、招商线索投放分别路由或建议正确专项；模糊需求只追问最小必要事实。
2. 跨渠道预览只给预算上限、测试顺序、证据口径、止损和 `PREVIEW_ONLY` 草案。
3. 缺数据、工具失败、越权与租户隔离场景不编造事实、不执行、不串租户。
4. 高风险样例定义至少 3 次重复；编造、越权、错路由、串租户为硬失败。

## Champion 基线与修复前失败证据

- Champion：当前短 fallback；无 MCP 原始包、contract、sample 或该 Skill Eval。
- 修复前失败：`node scripts/baolu-ad-manager-smoke.mjs` 必须因缺 `mcp-skills/skills/baolu_ad_manager/SKILL.md` 失败。
- 影响：生产 MCP-required 环境会缺少该 active Skill 的权威原始包，且无法审计其调度边界。

## 实现与验证

- 已新增 MCP 原始包、fallback contract/sample，以及与 MCP 对等的 contract/sample。
- 已新增 9 场景 Eval 矩阵；6 个高风险场景均定义 3 次重复。标准输出质量基线新增 4 场景、8 次计划运行。
- 修复前 `node scripts/baolu-ad-manager-smoke.mjs` 因缺 MCP/contract/sample 失败；修复后通过。
- 已运行专项 smoke、质量资产/Eval、static sample-contract、`qa:franchise-acquisition`、`qa:fast`、`qa:regression` 与 `qa:full`，均通过。

## 交接

- 残余风险：真实模型 Eval（计划 8 次）与真实广告后台操作均不在本任务执行；现有 runtime allowlist 仍未接收该 Skill，属于既有注册面债务，未在本任务修改共享热点。
- 后续：仅由总调度决定下一项 Skill 正式化任务。
- 最后更新：2026-08-14
