# PLAT-SKILL-S2 11 个 active 占位 Skill 受控隔离

状态：已确认，排队等待共享热点交接（FIP/LQ 未提交修改）

## 归属

- 产品：公共平台 Skill 治理；影响招商诊断和顾问目录。
- 风险：高；涉及用户可见 catalog、diagnosis 组合和 Agent runtime 候选。
- 必需热点：`packages/shared/src/index.ts`、`packages/skills/src/index.ts`、`packages/agent/src/index.ts`、`apps/api/src/services/agent-definitions.ts`。

## 修复前失败证据

- `node scripts/placeholder-skill-isolation-regression.mjs` 必须在当前实现失败：11 个占位仍出现在 catalog、6 个仍出现在 diagnosis，且全部仍在 runtime 拒绝的 active 集合。

## 串行合入方案

1. 当前占用基线：主检出区四个热点共 327 行新增、75 行删除。其内容包括 FIP 的 `baolu_ip_advisor`、创始人 IP 产品/路由与能力定义，以及 LQ 的 `xiaohongshu_ops` 注册和小红书能力定义。
   2026-08-14 复核仍为同一未提交基线：四个热点均 dirty，且当前 diff 同时包含 `baolu_ip_advisor`、`fip_franchise`、`xiaohongshu_ops`、`xiaohongshu_copy`。
2. 先等待 FIP/LQ 提交或明确交接这些热点；不从本 worktree 覆盖其工作树，也不将 S2 变更叠加到未提交主检出区。
3. 以其提交后的共同 `HEAD` 建立新的 S2 worktree；逐文件复核 diff，保留上述 FIP/LQ ID、能力绑定和所有外卖能力。
4. 一次性最小变更：从 catalog、diagnosis、Agent 路由候选和 active/manifest 面移除本任务列出的 11 个 ID；保留其源码目录，并在治理基线写入 `quarantined` 与恢复方式。
5. 运行本回归、相关 Agent 路由 smoke、桌面/移动目录 E2E、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`；登记 Bug 回归。

## 不应发生

- 不能删除任何 Skill 源码、影响 `xiaohongshu_ops`、`baolu_ip_advisor`、`baolu_ad_manager`、外卖或其他生产 Skill。
- 不能靠吞异常或假输出掩盖占位；直接调用应返回明确不可用状态。
- 不改变租户隔离语义。
