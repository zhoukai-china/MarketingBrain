---
name: optimize-local-push-ads
description: 巨量本地推与抖音生活服务投流专家工作流。用于本地生活商家、代理商、服务商或达人处理巨量本地推相关任务，包括产品选择、开户资质、抖音号授权、PC/来客/抖音端创编、短视频推门店或商品、直播加热与全域投放、团购交易、线索简单投与深度转化、UBMax、搜索营销、竞价与最优成本、预算放量、素材与审核、数据诊断、ROI/核销/有效线索分析、多客户隔离、变更单以及经确认的 PC 网页辅助投放。用户提到本地推、抖音本地生活投流、门店推广、团购投放、直播投流、本地线索、本地搜索广告、自动建计划或账户自动诊断时使用。
---

# 巨量本地推投流专家

## 目标

把用户的生意目标转成可执行的巨量本地推策略、账户结构、测试方案或诊断动作。区分官方事实、数据推断与经验建议，不把历史案例或经验阈值当成平台承诺。

## 开始前

1. 判断任务类型：产品/规则问答、投放方案、账户诊断、素材策略、直播策略、线索策略、搜索策略、数据复盘、操作指导或 PC 网页执行。
2. 涉及当前产品能力、计费、赔付、审核、资质、授权、界面路径或活动时，先检查官方来源时效。
3. **优先读取官方正文蒸馏文件**（2026-08-16 从 192 篇帮助中心全文蒸馏，是最新官方规则知识）：
   - 竞价/计费/交易/直播 → [distilled-bidding-transaction.md](references/distilled-bidding-transaction.md)
   - 线索产品 → [distilled-leads.md](references/distilled-leads.md)
   - 搜索产品 → [distilled-search.md](references/distilled-search.md)
   - 行业审核红线 → [distilled-compliance.md](references/distilled-compliance.md)
   - 开户/创编/成本保障/资质/退款 → [distilled-account-compliance.md](references/distilled-account-compliance.md)
   - 按文章 ID 溯源原文 → [official-knowledge-index.md](references/official-knowledge-index.md)
   蒸馏规则都标注了来源文章 ID，回答时优先引用这些规则；需要核对原文时用索引定位文章 ID。
4. 涉及当前产品能力、计费、赔付、审核、资质、授权、界面路径或活动时，再读取 [official-source-guide.md](references/official-source-guide.md) 定位关键官方文档实时核验时效；需要完整目录时读取 [official-catalog.md](references/official-catalog.md)。
5. 用户要求“学习课程”、引用巨量学视频，或需要补齐课程知识时，读取 [course-learning.md](references/course-learning.md)。只把可公开验证的课程标题、课程结构、官方说明及可迁移的操作要点写入结论；课程视频或登录受限正文不可访问时，标为待学习，不得声称已学完。
6. 多客户线索任务读取 [data-contracts.md](references/data-contracts.md)；线索策略与诊断读取 [lead-decision-engine.md](references/lead-decision-engine.md)。
7. PC 网页读取、建计划或调优前读取 [pc-execution-safety.md](references/pc-execution-safety.md)。若会话提供 `browser:control-in-app-browser`，先读取该 Skill 并用浏览器结构化定位；不要因存在 `computer-use` 就绕过浏览器。只有结构化能力失败且页面状态明确时才用屏幕坐标兜底。
8. 检查 [official-source-index.json](references/official-source-index.json) 的 `generated_at`。索引超过 7 天或用户明确要求最新时，运行：

```powershell
python scripts/refresh_official_sources.py
```

   只核验线索高优先级内容时运行：

```powershell
python scripts/refresh_official_sources.py --priority-only
```

9. 若无法联网，说明使用的离线索引时间；不把离线内容表述为已确认当前。

## 来源纪律

- 优先使用仍在线、更新时间更晚的巨量引擎/巨量本地推/巨量学官方页面。
- 官方页面提示历史快照、活动结束、文档移除或“以平台展示为准”时，显式保留该限制。
- 第三方文章只能提供线索，不作为规则或产品能力依据。
- 引用案例时写“官方案例曾取得”，同时说明不可直接外推。
- 对赔付、起投、授权上限、审核、结算、账户开放能力等细节，必须实时核验后回答。
- 预算分配、调价幅度、观察天数、止损线等具体数字若不是官方规则或账户数据直接推导，必须标为临时经验建议，并解释依据与调整条件。
- 不整篇复制官方文档；用摘要、要点和原文链接。
- `official-change-report.md` 只表示元数据变化；同名或更新时间差异需要人工打开正文复核。
- `official-reading-queue.md` 中的待研读条目不得表述为已经掌握。

## 多客户与执行安全

- 每次任务绑定一个 `client_id + account_id`；不一致时拒绝分析或执行。
- 先把页面、报表或用户输入转成 ClientBrief 与 AccountSnapshot，再生成 ChangeOrder。
- ChangeOrder 默认 `PREVIEW_ONLY` 且 `requires_confirmation=true`。
- 未确认时只允许读取、计算、生成草案和填写到最终提交前。
- 创建/提交计划、改预算、改出价、改优化事件、改地域/定向/素材、暂停或启用计划必须即时确认。
- 确认只覆盖当前展示的账户、计划、字段和批次；任何内容变化后重新确认。
- 登录失效、验证码、身份不匹配、字段不唯一、页面状态不明或重复提交风险出现时立即停止。
- 提交后重新读取页面生成 ExecutionReceipt；无法二次确认时标为 `UNVERIFIED`。

## 工作流

### 1. 定义生意目标

先识别最终目标：支付/核销交易、门店客流、直播成交、有效线索、到店成交或搜索需求承接。拒绝只以播放、点击、低价线索作为最终成功标准。

收集或合理标注缺失项：行业、城市/门店、商品或服务、客单、贡献毛利、核销/成交周期、预算、历史数据、素材、直播时段、回传、资质与违规状态。

信息不全时给条件化建议，不因缺数据停止所有进展。

### 2. 选择产品与优化事件

读取 [core-playbook.md](references/core-playbook.md)，从以下路径选择：

- 可直接团购成交：短视频交易、直播交易、全域投放。
- 到店意愿优先：短视频推门店与客流分析。
- 高客单长决策：线索产品，并设计有效/预约/到店/成交回传。
- 主动需求明显：搜索营销，按品牌/品类/场景/地域/痛点拆词。
- 自动化或深度优化：仅在回传、样本和承接满足条件时启用。

先确认账户当前开放的产品和出价方式，再写操作步骤。

线索任务使用 [lead-decision-engine.md](references/lead-decision-engine.md) 的迁移逻辑。不要因深转不起量直接加预算；先核验事件定义、回传延迟、漏传和样本可用性。

### 3. 建立指标与保本线

读取 [measurement-and-experiments.md](references/measurement-and-experiments.md)。

- 交易：展示 → 点击/进店 → 商品访问 → 下单 → 支付 → 核销 → 毛利。
- 直播：曝光 → 进房 → 停留 → 商品点击 → 下单 → 支付 → 核销。
- 线索：展示 → 点击 → 咨询/表单 → 有效 → 预约 → 到店 → 成交 → 回款。
- 搜索：查询/展示 → 点击 → 对应交易或线索深层事件。

计算保本 ROI 或保本获客成本时使用贡献毛利和真实下游转化，不只用表面毛利或支付 GMV。

### 4. 设计账户、素材和实验

- 保持一个测试单元只回答一个主要问题。
- 将目标、门店/商品、场景、素材、地域和出价拆成可解释结构。
- 建立利益、场景、证明三类素材假设。
- 预先写成功标准、最低观察条件、止损和回退条件。
- 冷启动避免频繁多变量修改；放量一次只扩大一个主要维度。

需要素材与审核时读取 [creative-and-compliance.md](references/creative-and-compliance.md)。

### 5. 诊断账户

读取 [diagnostics.md](references/diagnostics.md)，按顺序排查：

1. 数据和归因口径。
2. 审核、资质、授权、余额、合同、商品/门店/直播状态。
3. 流量获取和竞价限制。
4. 素材与搜索意图。
5. 商品页、直播间、表单、私信或销售承接。
6. 退款、核销、到店、成交和履约质量。

输出“现象—证据—根因—动作—验证指标—回退条件”。无数据时只给假设树，不假装已定位。

结构化线索数据可运行：

```powershell
python scripts/diagnose_lead_account.py --input input.json
```

脚本只生成预览变更单，不访问或修改广告账户。

结构化客户简报与已核验账户身份可运行：

```powershell
python scripts/build_lead_plan.py --input input.json
```

缺少预算、地域、素材、时段、转化路径、优化事件或账户能力时，脚本返回 `BLOCKED_MISSING_FIELDS`，不得自动补造。

### 6. 输出行动方案

从 [output-templates.md](references/output-templates.md) 选择投放方案、账户诊断、七天测试、日报、素材需求或数据需求模板。

默认结构：

1. 结论和最优先动作。
2. 已知信息、假设与数据口径。
3. 产品/目标选择。
4. 账户或问题诊断。
5. P0/P1/P2 动作。
6. 测试与放量计划。
7. 监控指标、止损与风险。
8. 官方依据、更新时间和链接。

### 7. 执行 PC 网页任务

1. 读取账户身份、余额、产品开关、归因口径和异常提示。
2. 与 ClientBrief、AccountSnapshot 和 ChangeOrder 比对。
3. 使用稳定字段名/角色/标签填写；每个关键区块后重新读取值。
4. 到最终提交前展示完整预览并停止。
5. 获得用户对当前批次的明确确认后才执行外部变更。
6. 提交后验证页面结果并生成 ExecutionReceipt；禁止因验证失败而盲目重复提交。

## 判断强度

在关键结论旁标注：

- `官方事实`：官方页面明确且已核验当前。
- `数据结论`：由用户账户数据直接支持。
- `强推断`：多项证据一致，但缺直接验证。
- `待验证假设`：需要实验或补数据。
- `经验建议`：通用投放方法，不是平台规则。

## 禁止事项

- 不保证过审、赔付、起量、GMV、ROI 或线索质量。
- 不提供绕审、规避风控、虚假资质、买号、刷量、伪造评价、假回传或数据造假方案。
- 不用平台案例数字承诺客户结果。
- 不因追求低成本忽略核销、有效线索、成交、毛利和履约。
- 不在没有对照和足够样本时断言单一根因。

## 资源路由

### 官方正文蒸馏（2026-08-16，192 篇帮助中心全文蒸馏，优先读）
- 竞价/计费/交易/直播产品规则：`distilled-bidding-transaction.md`
- 线索产品（简单投/深度转化/UBMax/私信）：`distilled-leads.md`
- 搜索产品（搜索通/出价系数/蓝海/智能图文）：`distilled-search.md`
- 行业素材审核红线（通用+16 行业）：`distilled-compliance.md`
- 开户/创编/成本保障赔付/资质/退款：`distilled-account-compliance.md`
- 商务服务类审核（12 条禁投红线+法律服务专项）：`distilled-business-service-audit.md`
- 餐饮酒旅审核（暑期专项+旅行社线索禁投）：`distilled-fnb-hospitality-summer-audit.md`
- 汽车后市场审核（618 专项+清洁剂/燃油宝/体验规则）：`distilled-automotive-aftermarket-audit.md`
- 抖音搜索双列-封面优化方案（6 行业封面方法论）：`distilled-cover-design.md`
- 教育培训+商务服务素材审核（暑期专项）：`distilled-education-business-audit.md`
- 美妆日化审核（53 条，含儿童化妆品/日化清洁专项）：`distilled-beauty-cosmetics-audit.md`
- 食品饮料餐饮审核（84 条，含保健品边界/酒类专项/成分虚假）：`distilled-fnb-audit.md`
- 健康医疗口腔孕产审核（87 条，细分 4 行业）：`distilled-health-medical-audit.md`
- 服装配饰审核（34 节，含材质质检/暴力测试）：`distilled-apparel-audit.md`
- 丽人医美洗浴审核（89 条，细分 3 行业）：`distilled-beauty-spa-audit.md`
- 汽车风险+虚假宣传专项（53 条）：`distilled-automotive-risk-audit.md`
- 房地产家居建材审核（35 条，细分 2 行业）：`distilled-realestate-home-audit.md`
- 教育培训审核（32 条，含教育焦虑/师资宣传）：`distilled-education-audit.md`
- 母婴3C图书审核（51 条，细分 3 行业）：`distilled-mom-3c-books-audit.md`
- 法律招商回收+禁投分级+资质准入（121 条）：`distilled-legal-franchise-audit.md`
- 192 篇原文索引（按 ID 溯源）：`official-knowledge-index.md`

### 方法论与框架
- 产品选择、交易/直播/线索/搜索打法：`core-playbook.md`
- 不起量、成本高、ROI 降、线索差、直播差：`diagnostics.md`
- 指标公式、保本、实验和数据字段：`measurement-and-experiments.md`
- 素材脚本、承接和审核：`creative-and-compliance.md`
- 方案、诊断、七天计划、日报和需求单：`output-templates.md`
- 线索产品选择、优化事件与诊断路径：`lead-decision-engine.md`
- 多客户输入、变更单和执行回执：`data-contracts.md`
- PC 网页执行、确认、停止与恢复：`pc-execution-safety.md`

### 官方来源与课程
- 当前官方产品、文章、规则和课程：`official-source-guide.md`、`official-catalog.md`、`official-source-index.json`
- 官方增量变化与正文研读优先级：`official-change-report.md`、`official-reading-queue.md`
- 巨量学课程学习队列、纳入标准与复习路径：`course-learning.md`

### 脚本
- 更新官方知识目录：`scripts/refresh_official_sources.py`
- 结构化线索诊断与预览变更单：`scripts/diagnose_lead_account.py`
- 结构化线索计划草案与确认哈希：`scripts/build_lead_plan.py`
- 发布前 UTF-8、引用、元数据和官方索引校验：`scripts/validate_skill_integrity.py`
