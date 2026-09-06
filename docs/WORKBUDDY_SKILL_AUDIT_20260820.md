# WorkBuddy 行业 Skill 候选入库与质量审计（2026-08-20）

状态：完成候选入库；**零项生产注册**。

## 范围与可复查台账

只读扫描桌面明确的 WorkBuddy 导出根目录 `C:\Users\book\Desktop\新skill`（最近两天其根目录仍有修改）。共发现 102 个含 `SKILL.md` 的包。逐项路径、修改时间、文件数、大小、SHA-256、静态质量维度、风险指纹和精确重复关系在 [intake JSON](WORKBUDDY_SKILL_INTAKE_20260820.json)；其中不记录任何敏感值。

| 结果 | 数量 | 状态 |
| --- | ---: | --- |
| 已复制到非运行时候选区并归档桌面原件 | 38 | `candidate_p2_quality_debt`；未注册、不可路由 |
| 保留在桌面，待专项质量/来源审计 | 55 | 含 P1：事实来源不可验证或外部动作边界不足 |
| 保留在桌面，安全隔离 | 3 | 1 个 P0 疑似密钥；2 个 P1 疑似个人信息 |
| 保留在桌面，语义/运行时重叠或非行业能力 | 6 | 5 项平台/语义评审、1 项既有能力重叠；不复制、不覆盖 |

复制后的完整清单、原路径、目标路径、恢复路径和哈希见 [candidate manifest](../mcp-skills/candidates/workbuddy-20260820/intake-manifest.json)。归档后桌面剩余 64 项、候选区 38 项，和原始 102 项守恒；复核报告见 [remaining JSON](WORKBUDDY_SKILL_DESKTOP_REMAINING_20260820.json)。

## 质量结论

所有 102 项都具备 `name`/`description`，但 101 项缺独立 contract 或 Eval；仅 `meiye-content-line` 静态得分达到 86，仍没有仓库质量资产和已执行行为 Eval。因此所有复制项均只作为开发素材，不能进入 MCP、fallback、catalog 或 Agent 路由。

| 分类 | 代表项 | 分数范围 | 结论 |
| --- | --- | ---: | --- |
| 行业合规/差异卡/经营模块 | `meiye-*`、`canyin-*`、`chongwu-*` 等 38 项 | 50–86 | 修改后保留：补来源日期、输入输出、事实边界、contract/sample/Eval 后才能按产品逐项正式化 |
| 通用/平台工作流 | `skill-distiller`、`wechat-xhs-content-line`、`xiaodian-growth`、`api-multisource-adapter` | 56–78 | 不进入行业候选区；以后作为平台能力单独做重叠与安全审计 |
| 投流重叠 | `dou-plus-ads`、`baolu-dou-plus` | 78 | 前者与本机/仓库 DOU+ 能力精确重叠；后者语义重叠。保留桌面，后续只做差异合并评审 |
| 高风险 | `chongwu-emotion`；`baolu-shipinhao-weixin-dou`；`optimize-local-push-ads` | 54、70、78 | 分别为疑似密钥、疑似个人信息、疑似个人信息（后者还与现有本地推能力重叠）；不复制、不移动。仅脱敏指纹在 JSON 中留证 |

静态审计发现 38 项不可验证的数字/法规事实、24 项外部动作边界不足。它们不等同于已发生模型错误，但按生产门禁均是 P1：必须提供可追溯官方/授权来源、有效日期和 `PREVIEW_ONLY`/确认边界。未执行真实模型调用：候选不具备运行时 contract 与 Eval，不能把静态检查伪报为模型质量通过。

## 分层与产品映射

| 层级 | 本轮归类 | 使用边界 |
| --- | --- | --- |
| A 平台通用 | `skill-distiller`、内容/小店/多源 adapter、投流候选 | 保留桌面；待独立评估，不能与现有 DOU+/本地推重复注册 |
| B 行业能力 | 已复制的美业、餐饮、本地服务、宠物、儿童乐园、产康、减肥、汽后、手机后市场、新疆特产模块 | 仅候选素材；适合沉淀稳定术语、合规边界、指标与决策框架 |
| C 产品工作流 | 无 | 创始人 IP、兰琪的端到端编排仍归各自产品，不从候选自动生成 |
| D 租户专属知识 | 无可提升项 | 兰琪方法论、品牌/定价/视觉规则、客户案例与授权资料仍放租户受控知识区 |

| 产品 | 拟使用候选 | 触发与输入 | 输出与硬门禁 | 禁止事项 / Eval |
| --- | --- | --- | --- | --- |
| 创始人 IP 获客 | 按租户行业选择的 `*-compliance`、`*-content-diff`、`*-content-line` | 用户已声明行业；授权事实母版、资质/功效证据、渠道目标 | 选题/内容的行业约束与待补清单；不得改变创始人 IP 四目标契约 | 无来源或证据则不写功效/案例/数字；合规、编造、跨租户为硬失败 |
| 兰琪美业 | `meiye-compliance`、`meiye-content-diff`、`meiye-content-line`（均候选） | 已授权的品牌事实、资质、项目、功效证据、渠道素材 | 合规扫描、三方向内容预览、待核资质清单 | 不读取/提升兰琪内部定价、视觉规则和知识库；无确认不发布；功效虚构、医疗越界、串租户为硬失败 |

## 恢复、入库与下一步

桌面原件已移动（非删除）到 `C:\Users\book\Documents\管理场景AI改造\archive\workbuddy-skill-intake-20260820\originals\`，按原相对路径保存；将对应目录复制回原路径即可恢复。候选副本和原件均以 `SKILL.md` SHA-256 复核一致。

建议生产改造的最小清单：先只选择 `meiye-compliance` 和 `meiye-content-line`，逐条核验法规来源与日期、去除固定处罚/规则断言、补 MCP+fallback 一致版本、contract/sample、正常/缺数据/编造/越权/串租户的三次高风险 Eval；之后再由兰琪 owner 评审是否注册。其余 36 项按行业有真实产品需求时再开独立任务。
