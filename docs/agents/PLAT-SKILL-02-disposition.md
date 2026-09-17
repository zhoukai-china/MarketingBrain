# PLAT-SKILL-02 孤儿、占位与历史 Skill 精确处置清单

状态：自动验收完成

## 归属

- 产品：公共平台 Skill 治理。
- 风险：高；处置可能改变用户可见能力、生产加载或历史可恢复性。
- 修改边界：仅台账、审计说明和独立检查；禁止删除、移动、隐藏、归档或修改共享注册热点。

## 用户结果

用户可按逐项证据确认哪些 Skill 应保留、正式化、隔离或候选归档，而不会发生未确认的文件或产品能力变更。

## 验收条件

1. 覆盖未注册 package、MCP-only、active 但 runtime 不可调用、活跃占位、外部 Codex/插件和历史归档。
2. 每项包含引用、owner、注册/可调用状态、资产、影响、替代和恢复方式。
3. 所有候选均为建议，直接删除候选必须为空。

## 基线

- 输入：`docs/SKILL_GOVERNANCE_INVENTORY.json` 和 `docs/SKILL_GOVERNANCE_BASELINE.json`。
- 可重复检查：`node scripts/skill-governance-audit.mjs`、`node scripts/check-skill-quality-assets.mjs`。

## 交接

- 未经用户确认不得执行归档、隐藏、删除或共享注册修改。
- 已验证：`node scripts/skill-governance-audit.mjs --write-inventory docs/SKILL_GOVERNANCE_INVENTORY.json`、`node scripts/skill-disposition-smoke.mjs`、`node scripts/skill-governance-smoke.mjs`、质量资产与 Eval 结构检查均通过；`pnpm qa:fast` 结果见本任务最终交付记录。
- 最后更新：2026-08-14。
