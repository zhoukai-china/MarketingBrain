# 思潼智能体单人开发入口

你只需要告诉 Codex 想实现或修复什么。Codex 会按照本目录的规则自动判断产品、创建任务卡、选择代码位置和测试命令。

| 产品 | 目录 | 一键领域检查 |
|---|---|---|
| 外卖增长智能体 | `takeaway-growth/` | `pnpm.cmd qa:takeaway` |
| 创始人 IP 获客系统 | `founder-ip-acquisition/` | `pnpm.cmd qa:founder-ip-acquisition` |
| 兰琪美业经营增长智能体平台 | `lanqi-beauty/` | `pnpm.cmd qa:lanqi-foundation` |

完整操作说明见 `docs/SOLO_AGENT_DEVELOPMENT.md`。任务模板见 `_templates/TASK_TEMPLATE.md`。
