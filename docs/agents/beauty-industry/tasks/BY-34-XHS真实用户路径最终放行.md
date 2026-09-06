# BY-34 XHS 真实用户路径最终放行

状态：QA-20260828-006 safety-v2.8 零Provider检测召回闭环已完成；未自动开启新的3/3付费终验（2026-08-28）

## 归属

- 产品：美业智能体｜门店 AI 经营大脑（兰琪品牌包验收租户）
- 层级：美业通用核心；品牌、主题和知识授权继续由服务端租户品牌上下文派生
- 风险：高（真实文本/媒体、积分、租户、幂等、历史恢复）
- 预计修改热点：XHS 媒体批次状态机、同页工作台、受控真实验收脚本与产品质量文档
- 是否允许并行：否；BY-19/BY-20 继续 PAUSED

## 用户结果

用户可在同一小红书图文页面填写本次需求、得到正式文字并显式确认一个三图批次；三图合格后可查看下载，新文字任务与同任务重新报价均不被旧批次锁死。

## 本次范围

- 建立“成功批次后修改图片要求并重新报价”的零 Provider 红灯；报价不自动生成或扣费。
- 核对并启用一次性受控真实文字与一个三图批次，合计人民币硬上限 1 元。
- 真实页面验证本次需求不回写经营档案、唯一批次、三图交付、刷新/历史、重复点击、跨租户和账本。
- 成功后撤销旧未使用邀请并创建 beauty-industry/lanqi、24 小时、最多 1 次的新邀请。

## 本次不做

- 不自动重试、修复、换模、补图、追加、第 4 张或第二个付费图片批次。
- 不调用除 `deepseek-v4-pro` 与 `aliyun_bailian/wan2.7-image` 外的 Provider。
- 不恢复 BY-19/BY-20，不部署生产，不覆盖其他任务改动。

## 验收条件

1. 正常路径：正式文字成功或安全恢复；首次图片确认仅创建一个三图批次，3/3 质量通过后可查看和逐图下载。
2. 状态恢复：新文字任务不受旧历史批次影响；成功批次后只有修改本次图片要求并重新查看 300 积分，才获得唯一新批次确认资格，本轮不提交第二批。
3. 幂等/账本：重复点击不重复调用或扣费；文字一次结算、图片单批一次预留/结算，跨租户资产 404。
4. 任务事实：页面本次需求是任务快照，不自动修改长期经营档案；Web/WorkBuddy 合同一致。
5. 不应发生：mock 冒充真实、旧成功/失败批次锁死新任务、未确认生成、超过 1 元、未授权 Provider、候选 Skill 运行引用。
6. 可观测：记录脱敏模型/次数/tokens/费用、图片角色/任务数/SHA/质量、AgentRun/账本和环境身份，不保存 Prompt、正文、原始响应或密钥。

## 基线与失败证据

- 环境基线：PostgreSQL 55434 / API 3016 / Web 5176 的正式身份门禁通过；真实调用前 source/runtime=`007D26165CF0E0D526228F598FA2F8A046B13DF41332DCDE1D5A73B12798D330`、`source_fresh=true`、ready/database=true，兰琪品牌、entitlement、500 测试积分和一次性 grant 均完成预检。
- 修复前红灯：当前 `succeeded` 最新批次固定返回 `batch_already_succeeded/retryEligible=false`，即使本次图片要求已修改也无法只重新报价。
- 根因：成功批次只被建模为终态，没有“修改本次图片要求后重新报价、再次显式确认”的独立状态；旧历史与新任务隔离已由 BY-33 完成，本次补齐成功批次的安全再报价语义。
- 真实终验：第一张封面图 Provider 技术成功并原子落盘，768×1024、SHA `60f2ea68…68bb8d`；safety-v2.6 以 `qr_or_barcode_like`、confidence `0.953` 拒绝。人工只读仅见清水玻璃碗、白毛巾和绿叶静物，未识别二维码/条码/文字/品牌/UI，但没有覆盖自动门禁。第 2/3 张未提交，整批 `quality_failed`、客户资产/下载 0。
- 伴随验收器红灯：BY-32 已替换 XHS DOM 层级，旧 live runner 仍使用旧 customer/media selector，前 3 次均在 grant/Provider 前失败关闭；修复后才进入唯一真实批次。该问题没有产生重复付费调用。

## 实现记录

- 修改文件：`apps/api/src/products/beauty-industry/media-batch.ts`、`apps/api/src/routes/beauty-industry-media.ts`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx`、`scripts/beauty-industry-xhs-media-retry-p1-smoke.ts`、`scripts/beauty-industry-xhs-image-live-acceptance.mjs`及本任务质量文档。
- 数据/接口/配置变化：quote/confirm 新增成功批次后的显式 regeneration 状态和旧 job 关联；未迁移数据库。一次性 grant 已消费并改名为 revoked 审计记录；最终运行恢复 text=controlled_mock、media=disabled/max0。旧未使用邀请码 `cmtcln3nv00006l2z42sh9hwd` 已停用，未创建新邀请。
- 兼容性和回滚点：不迁移数据库；旧批次与历史 AgentRun 继续按记录版本只读展示。

## 验证

- 领域命令：`beauty-industry:xhs-media-retry-p1-smoke`、same-page image、real-media、generation-success、image-quality、persistence/media-observability、brand-package 与 API/Web typecheck 均 PASS；`node --check scripts/beauty-industry-xhs-image-live-acceptance.mjs`、`git diff --check` PASS。
- `pnpm.cmd qa:fast` / `qa:regression` / `qa:full`（含 build）：真实调用前同一源码全部 PASS；终验后只修改验收 runner 和文档，最终复跑结果见下方收口记录。
- 页面/E2E：正式 Chrome 已证明历史真实文字恢复、兰琪品牌、300 积分 quote、唯一 confirm、失败后停止、单次预留/释放。因第一张质量拒绝，没有继续声称 3/3、下载、第二文字任务或再报价完成。
- Provider/账本：`wan2.7-image` 1 次，保守 ¥0.20；DeepSeek 0 次，其他 Provider 0，重试/修复/换模/补图/追加 0。300 积分一次 consume、一次等额 refund，reservation=`released/actualAmount=0`，余额净变化 0。

## 交接

- 当前风险：QR/条码精度子范围 P0=0、P1=0。真实 3/3 客户图用户放行没有在本轮执行；未创建邀请、不让用户验收旧runtime。
- 下一恢复点：只有总调度后续明确安排时，才以独立一次性grant执行safety-v2.7真实3/3终验；不复用历史grant，不自动开启付费任务。
- 当前环境：只读status为ready/database/Web正常、text=controlled_mock、media=disabled/max0；source=`2E63C34F`、旧runtime=`3DF58C40`、`source_fresh=false`。本轮按边界未刷新环境，旧runtime不冒充v2.7。
- 最后更新日期：2026-08-28

## QA-20260828-004 QR/条码检测精度收口

- 修复前红灯：用真实安全资产 SHA `60f2ea68…68bb8d`作只读脱敏负例，safety-v2.6 稳定返回 `qr_or_barcode_like/qr_finder_pattern`；三个 finder 中心的一维截面平均比例误差 `0.283`、直角分 `0.74`，但无可解码结果。
- 根因：旧检测器只验证横纵 `1:1:3:1:1` 截面与三中心几何，没有验证 QR finder 必须具备的二维 7×7 黑白结构；清水玻璃碗边缘与水滴恰好凑出了三组一维序列。
- 单变量 Challenger：safety 升级为 `beauty-image-safety-v2.7`，仅为 QR finder 三点组合增加二维模式平均一致度 `>=0.72`；不修改条码、glyph、corner-watermark、UI、人物或总 fail-closed 逻辑，不使用 SHA/路径白名单。
- 可解释证据：真实安全图的平均一致度 `0.510`、最低 `0.469`，新门禁通过；合成QR风险例平均一致度 `0.878`并继续以 `qr_finder_pattern`拒绝。
- 绿灯：25 个安全负例与 54 个真实/合成风险正例用同一批 Eval 连续 3 次，precision/recall 均为 `1.000/1.000`；真实文字、Logo、QR、条码、UI/水印和人物仍全部拒绝。
- 版本与历史：正式新任务、real-media smoke 和 live runner 钉死 v2.7；历史 v2.6 批次只读保留，不事后重判。
- 验证命令：`beauty-industry:image-quality-precision-p1-smoke` 连续3次，`image-quality-p1-smoke`、`image-generation-success-p1-smoke`、`real-media-smoke`、`image-persistence-observability-p1-smoke`、`image-asset-url-policy-p1-smoke`、`media-observability-smoke`、`xhs-same-page-image-p1-smoke`、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`均 PASS。
- 费用与环境：Provider/外网/grant 调用 `0`，费用 `¥0`，media 未启用。本次无 DOM/路由/数据库变化，故不重复桌面/390px E2E；历史页面状态不因检测器升级被重算。最终只读status：ready/database/Web正常、media=disabled/max0，source=`2E63C34F`、旧runtime=`3DF58C40`、`source_fresh=false`；未通过正式stop/start刷新，旧runtime不冒充v2.7。
- 本原子范围：P0=0、P1=0。真实 3/3 客户图用户放行未在本轮执行，未创建邀请，不自动启动下一次付费终验。

## safety-v2.7 独立真实终验（2026-08-28）

- 调用前门禁：正式 stop/start 后 source/runtime=`B3509750…`、fresh/ready/database=true；兰琪测试租户、entitlement、余额484、300积分预留能力、plan-v2/prompt-v1.2/safety-v2.7、wan2.7-image、最多3任务和¥0.60上限全部通过。旧未消费grant因源码变化分别保留为revoked审计；最终grant一次消费、不可重放。
- 前置P1：固定正式历史文字任务在controlled-mock运行环境被错误标成preview，导致三图按钮被锁。根因是history/replay按当前Provider模式重建`structuredDelivery.preview`。现把preview/formal模式写入AgentRun质量标记，history/replay优先读取每任务证据，旧任务只保留兼容回退；历史选择改为稳定run-id，专项红灯转绿。
- 真实结果：仅封面图创建1个Provider task，技术成功并原子落盘，768×1024、SHA `66b9a75b…f199`。自动safety-v2.7返回passed，但人工只读看到画面顶部有明显中文展示文字，按正式客户可用性门禁reject；第2/3图未提交，无第4张、重试、修复、换模、补图或追加。
- 账本/资产：整批`quality_failed`，客户可用/下载0；300积分一次consume、一次等额refund，reservation=`released/actualAmount=0`，净积分0。wan2.7-image实际1次、保守费用¥0.20，文本/视频/ASR/其他Provider0。审计原图仅保留在隔离租户内部，owner与跨租户客户资产均404。
- 浏览器与环境：只读Chrome桌面1440/390px、刷新、历史、三卡失败态、owner/跨租户404、console0、external provider0通过。一次性grant已消费封存，media/operator gate恢复disabled/max0；最终PG55434/PID25008、API3016/PID8500、Web5176/PID8468，source/runtime=`AB888453…`、fresh/ready/database=true、text=controlled_mock。
- 回归：图片质量/generation-success/real-media零调用/持久化/URL/media-observability/XHS同页与工作台、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）及`git diff --check`均PASS。live postflight确认ProviderTasks=1、technical=1、rejected=1、unsubmitted=2、customerUsable=0、netTestCredits=0。
- 放行结论：P0=0、P1=1，不创建邀请码、不让用户验收不合格图片。下一唯一恢复点是QA-20260828-006：用该脱敏真实资产建立“明显展示文字未被safety-v2.7自动拒绝”的零Provider红灯，定位文字检测漏报；不得复用本次grant或追加付费调用。BY-19/BY-20继续PAUSED，不部署。

## QA-20260828-006 safety-v2.8 零Provider收口（2026-08-28）

- 修复前红灯：把真实风险图SHA `66b9a75b…f199`加入正式精度脚本；v2.7稳定返回passed/reasons空，证明人工门禁此前正确兜底但自动召回缺失。
- Champion证据：旧`glyph_sequence`只读取按组件数排序的rank1候选；rank1 glyph=10、gap variation=2.422、width coverage=0.135、edge density=0.028，不合格后直接返回。实际顶部展示文字是rank10，glyph=3、glyph-like ratio=1、baseline deviation=0、height variation=0.022、width coverage=0.469、edge density=0.323、max aspect=1；只保存这些脱敏指标，不保存OCR正文、Prompt、Provider响应、凭据或租户标识。
- 单变量Challenger：升级`beauty-image-safety-v2.8`，仅在rank1不合格时补选“高置信顶部展示文字”候选，联合要求位于上部、宽度合理、edge density>=0.25、baseline<=1.25、height variation<=0.12、glyph-like ratio=1且max aspect<=2.4；无SHA/路径白名单，不放宽任何既有门禁。
- 绿灯：该真实图现以`glyph_sequence/visible_text_or_brand_like`、confidence=0.896拒绝，bbox仅记录`(256,42,260,44)`。同批25安全/55风险连续3次precision/recall=`1.000/1.000`，历史QR/条码、真实/合成文字与Logo、UI/水印、人物风险继续全部拒绝。
- 工程验收：图片quality/generation-success/real-media零调用/persistence/URL/media-observability/XHS同页专项、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`通过。Provider/外网/grant=0、费用¥0；无DOM/路由/数据库变化，按范围未重复桌面/390px E2E，也未刷新或启用媒体环境。只读status为PG55434可连接、API3016 ready/database、Web5176=200、PID/listener一致、text=controlled_mock、media=disabled/max0；source=`D5060C4E`、旧runtime=`AB888453`、`source_fresh=false`，旧runtime不代表v2.8。
- 状态：QA-20260828-006关闭，本零Provider原子范围P0/P1=0。历史v2.7批次保留只读、不事后重判；未创建邀请码、未自动开启下一次付费三图。BY-19/BY-20继续PAUSED，不部署。
