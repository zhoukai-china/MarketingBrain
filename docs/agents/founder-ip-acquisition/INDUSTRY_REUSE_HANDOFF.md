# 创始人 IP 获客能力向行业智能体复用交接

状态：只读交接完成（2026-08-21）；未修改共享 Agent、Skill、MCP、鉴权、计费或账本代码。

## 交接结论

- 当前 FIP 验收任务已完成。创始人 IP 独立产品扩展暂停，不启动此前排队的 FIP WorkBuddy MCP v1。
- 下一产品应先建立“美业行业通用智能体获客 MVP”，再按真实产品验证决定哪些能力下沉为公共平台组件；不得直接把 FIP、兰琪品牌或门店获客提示词复制成新产品。
- 可优先复用的是现有 Skill 的输入输出、事实边界、失败契约和 Eval。产品 Agent、行业知识、获客目标、权限与页面仍应由新行业产品专属适配。

## 能力清单

| 能力 | 当前 Agent / capability | 当前 Skill 与版本 | 当前成熟度 | 创始人 IP / 品牌假设 | 向美业行业通用 MVP 的处理 |
|---|---|---|---|---|---|
| 选题 | `agent_acquisition` / `topic_inspiration`；FIP 页面另有权威获客目标简报与证据门禁 | `baolu_topics` `2.1.2` | FIP 四来源、目标隔离、最终 TOP10、零证据拒绝和页面恢复已验收 | Prompt 与产品契约默认“创始人身份、四类获客目标、AI 录音卡、自己账号复盘” | 复用候选生成、三关筛选、来源可追溯和无证据不编造；把身份、目标、行业、项目和证据筛选改为美业行业参数，不沿用 FIP 四目标作为唯一枚举 |
| 文案 | FIP `content_plan`；运行交接为 `agent_founder_ip_acquisition` | `founder_ip_content_creator` `1.0.0` | 真实 Pro 四目标 12/12、保存/恢复、失败/取消和租户隔离已验收 | Skill scope、tenant type、章节与 CTA 均明确绑定创始人 IP 和四目标 | 不直接通用化原 Skill ID；复用“选题逐字保持、证据/事实边界、目标 CTA、缺资料待补、禁止自动执行”的契约，为美业建立专属内容适配与 Eval |
| 小红书图文 | 当前在门店获客能力 `xiaohongshu_copy`，不是 FIP 主链能力 | `xiaohongshu_ops` `1.0.0` | 标题、正文、标签、互动承接和发布前核对契约已存在 | 名称、Prompt、知识启用说明和回归目前绑定“兰琪”或门店本地消费者 | 只复用小红书输出结构、事实核对和不发布边界；必须移除兰琪品牌假设，把知识、项目、服务、目标人群与转化动作改为当前美业租户授权上下文 |
| 投流 | FIP `paid_traffic`；另有 `dou_plus_traffic` | `optimize_local_push_ads` `1.0.0`；`dou_plus_ads` `1.0.0` | 诊断、单变量测试、预算/止损/回退和 `PREVIEW_ONLY` 契约已存在；FIP-05 端到端页面未开发 | FIP capability Prompt 仍限定品牌招商；本地推 Skill 偏本地生活线索，DOU+ 偏内容加热 | 行业化为“渠道 + 获客目标 + 门店/项目 + 预算 + 承接 + 真实数据”输入；v1 只做判断与预览，禁止创建计划、充值、付款、扣费重试或修改线上投放 |
| 直播话术 | FIP `live_script` | `live_script_planner` `3.0.0` | 招商、到店带货、知识付费场景、缺资料追问、完整时长和话术包回归已存在 | 核心 Skill 可跨场景，但 FIP capability Prompt 仅写品牌招商 | 复用场景识别、事实门禁、时长、轮播、互动和场控契约；由美业目标决定到店、课程、合作或招商承接，不得串场，不自动开播/发送/发布 |
| 短视频复盘 | FIP `video_review` | `baolu_review_engine` `2.0.0` | 快速诊断、表格深度复盘、数据质量、缺字段和下一轮选题回流已覆盖 | Skill 契约本身基本通用；FIP 只在路由层增加当前项目与获客目标口径 | 可直接复用复盘内核，但行业适配必须定义美业内容分类、业务转化字段和目标口径；无视频/数据证据时只列待补，不得与直播复盘互相替代 |
| 直播复盘 | FIP `live_review` | `baolu_live_review_engine` `3.0.0` | 八模块、数据/转写/原话术证据、缺资料、失败和连续追问回归已存在 | Skill 契约本身基本通用；FIP capability Prompt 使用创始人 IP 当前目标 | 可直接复用八模块和证据边界，行业化人货场、互动与转化字段；必须保持独立于短视频复盘，资料类型不明时先确定性路由或追问 |

## 资产入口

### Agent 与产品路由

- FIP 产品与工作地图：`apps/api/src/services/agent-definitions.ts` 中 `agent_acquisition`。
- FIP 内容专属运行隔离：`packages/agent/src/index.ts` 的 `founder_ip_content_creator + content_plan` 分支；现有回归证明不回落到门店 `baolu_content_creator`。
- 门店小红书与行业对照：`apps/api/src/services/agent-definitions.ts` 的 `agent_store_acquisition / xiaohongshu_copy`。

### Skill 与质量契约

- 选题：`packages/skills/skills/baolu_topics/`；原始 Skill：`mcp-skills/skills/baolu_topics/SKILL.md`。
- FIP 文案：`packages/skills/skills/founder_ip_content_creator/`；原始 Skill：`mcp-skills/skills/founder_ip_content_creator/SKILL.md`。
- 小红书图文：`packages/skills/skills/xiaohongshu_ops/`；原始 Skill：`mcp-skills/skills/xiaohongshu_ops/`。
- 投流：`packages/skills/skills/optimize_local_push_ads/` 与 `packages/skills/skills/dou_plus_ads/`；原始 Skill 在同名 `mcp-skills/skills/` 目录。
- 直播话术：`packages/skills/skills/live_script_planner/`；原始 Skill：`mcp-skills/skills/live_script_planner/`。
- 短视频复盘：`packages/skills/skills/baolu_review_engine/`；原始 Skill：`mcp-skills/skills/baolu_review_engine/SKILL.md`。
- 直播复盘：`packages/skills/skills/baolu_live_review_engine/`；原始 Skill：`mcp-skills/skills/baolu_live_review_engine/SKILL.md`。

### Eval 与回归入口

- 选题：`scripts/founder-ip-topic-evidence-guard-smoke.ts`、`scripts/founder-ip-topic-source-quality-smoke.ts`、`scripts/founder-ip-topic-final-delivery-smoke.ts`、`scripts/verify-topic-inspiration.ts`。
- 文案：`scripts/founder-ip-content-context-isolation-smoke.ts`、`scripts/founder-ip-content-target-quality-smoke.ts`、`scripts/founder-ip-content-delivery-quality-smoke.ts`、`scripts/verify-founder-ip-content-live-provider.ts`。
- 小红书图文：`scripts/lanqi-xhs-copy-contract-smoke.mjs`；复用前必须新增去兰琪品牌假设的美业通用 Champion/Eval，现有回归不能直接代表通用产品通过。
- 投流：`scripts/paid-traffic-upload-smoke.ts`、`scripts/agent-orchestrator-smoke.ts`；新行业产品还需补目标/渠道/预算/承接隔离和预览不执行 Eval。
- 直播话术：`scripts/verify-live-script-v3.ts`、`scripts/verify-live-skills.ts`。
- 短视频复盘：`scripts/verify-video-data-review.ts`、`scripts/video-review-direct-smoke.ts`。
- 直播复盘：`scripts/verify-live-skills.ts`。
- 聚合门禁：`pnpm.cmd qa:founder-ip-acquisition`、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`。

## 新行业产品必须重新确认的边界

1. 美业行业目标枚举、目标人群、承接动作和业务结果不能直接继承 FIP 四目标或兰琪品牌口径。
2. 行业知识只能来自当前租户授权的美业资料；FIP 录音、兰琪方法论和其他租户内容不得自动带入。
3. 小红书、投流、直播和复盘仍保持草稿/预览；没有用户确认不得发布、投放、付款、发消息或改生产配置。
4. 所有新适配先建立美业脱敏 Champion 与错误路由、无资料、编造、跨租户、重复请求、失败/超时/取消 Eval，再复用现有 Skill 内核。
5. 本交接只说明可复用资产，不代表这些 Skill 已完成美业行业通用产品验收。
