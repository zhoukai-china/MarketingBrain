# BY-35 XHS 无字底图确定性合成交付

状态：完成；QA-20260829-006已关闭，修复后真实文字、页面、账本、租户与邀请放行

## QA-20260829-006 修复后真实文字最终放行（2026-08-30，PASS）

- 修复前红灯与根因：同一脱敏事实快照证明live runner把`project/audience/city/storeFacts/contentAngle/tone/visualStyle`错误铺在WorkBuddy顶层，而公开MCP只读取嵌套`professionalOptions`；API与独立postflight又对`25-45岁女性`和`25至45岁女生`采取不同语义，且年龄缺失被误分为contradiction。固定route与Skill映射本身正确。
- 最小修复：runner改为嵌套专业字段；`packages/agent/src/index.ts`和`apps/api/src/products/beauty-industry/xhs-task-facts.ts`统一年龄范围规范化、女性同义词和missing/contradiction分类。合理同义改写通过，漏年龄继续事实缺失，男性或错误年龄继续事实矛盾；事实、第一人称、行业污染、合规、Schema和图片安全门禁均未降低。
- 唯一真实终验：新不可重放grant `by35-xhs-text-live-20260830-once-8075931360b1`锁定`deepseek-v4-pro`1次、thinking disabled、25KB/5120 tokens和¥0.13硬上限。实际stop/fallback=false、tokens `3685/841/0/4526`、保守费用`¥0.018677`；自动重试/repair/换模/追加0，媒体/文件Provider0。
- 质量与账本：固定`beauty_xiaohongshu_package / acquisition:xhs / wechat-xhs-content-line@1.0.3`及美业差异/合规链的adapter、Schema/Eval、事实回执、矛盾、第一人称、污染、合规和`rubric_not_boss_usable`全部PASS。唯一succeeded AgentRun；8积分一次预留一次结算、refund0；同requestId重复调用复用结果且没有第二次Provider/交易。Web/WorkBuddy同一结构一致。
- 页面与隔离：真实Chrome仓库runner验证1440与390px、兰琪/默认品牌、刷新/历史、跨租户、overflow0、console0；浏览器阶段新增Provider0。三图quote和300积分显式确认入口可用但没有点击，故本任务图片Provider0。
- 环境与邀请：PG55434/PID18040、API3016/PID18264、Web5176/PID16748，source/runtime完整指纹`8AFCF24A01DE712999557B5F74EDA044095D85A3467B03EBD2DD24A67CB97B9B`一致，fresh/ready/database=true；text configured provider，media real/max3且只在用户显式确认后调用。邀请记录`cmtf6eazt0000bwjtawywed06`绑定beauty-industry/lanqi，24小时、最多1次、usedCount0，只存hash，明文只在最终交接显示一次。
- 门禁与结论：`beauty-industry:xhs-fact-retention-p1-smoke`、provider结构、fixed-route、客户交付、用户路径、品牌浏览器、API/Web/Agent typecheck及`qa:fast/regression/full`（含build）、`git diff --check`全部PASS。QA-20260829-006关闭，当前范围P0/P1=0；BY-19/BY-20保持PAUSED，不部署。

## QA-20260829-006 第三次修复后真实文字终验（2026-08-30，FAIL-CLOSED）

- 换行P1红绿：`beauty-industry:xhs-provider-structure-p1-smoke`先稳定失败`image_direction_1_post_text_multiline`；最小修复只在`xhs-provider-output.ts`对制作元数据`postProductionText`做NFKC与连续空白折叠，完整保留词序和语义。正文、标题、标签、事实、合规、行业污染与图片安全规则均未放宽。
- 调用前门禁：XHS provider结构/safe trace/事实/fixed-route、API/Agent typecheck、`qa:fast`与`qa:regression`PASS。正式stop/start后source/runtime完整指纹`AA6BD5D1A04C29E66511E954AE0F77747887E44A1438D88DD99C4EA4CCE82605`一致，fresh/ready/database=true；text configured provider、media disabled/max0，最坏成本`¥0.122635`≤授权`¥0.13`。
- 唯一调用：新grant `by35-xhs-text-live-20260830-once-3d7a1f9c8b42`已原子消费；`deepseek-v4-pro`恰好1次，stop/fallback=false、tokens `3640/931/0/4571`、thinking0，保守费用`¥0.019147`。自动重试/repair/换模/追加0，图片/视频/ASR/文件Provider0。
- 精确失败：结构适配与确定性渲染已通过，独立正式质量复验命中`rubric_fact_contradiction / target_audience`。只保留脱敏回执特征：line hash、6 bytes、`女生=true`、正式女性别名=false、男性=false、25–45岁范围=false；没有保存或输出Provider正文、Prompt、客户原文或凭据。当前可证实的两个缺口是同义词分类过窄、年龄事实未被保留；API预持久化与runner postflight为何使用不同判定仍需零Provider红灯定位。
- 账本/历史安全关闭：API曾先创建1条succeeded AgentRun并settle 8积分；postflight拒绝后调用正式`compensateSettledCreditReservation`恰好一次，reservation=`compensated`、actual=0、1 consume+1 refund、净0。该Run保留审计ID但已改为`failed`、output=null、creditCost=0、error=`postflight_rubric_fact_contradiction`，不让不可交付结果进入用户历史。
- 回归与环境：调用后`pnpm.cmd qa:full`（qa:fast+qa:regression+build）和`git diff --check`PASS，新增外部Provider0。正式stop/start后PG55434/PID3300、API3016/PID17500、Web5176/PID7544在线；source/runtime=`AA6BD5D1`、fresh/ready/database=true，text controlled_mock、media disabled/max0。
- 放行结论：没有成功文字结果，故不做成功DOM/图片报价/300积分入口验收，不创建邀请。P0=0、P1=1。下一唯一零Provider恢复点：用相同脱敏事实结构建立API真实执行→Eval→持久化/账本红灯，统一API/postflight事实源；`25-45岁`必须保留，`女生/女性`可合理归一化，缺年龄与男性替换必须分别判missing/contradiction。不得追加真实调用、恢复BY-19/BY-20或部署。

## QA-20260829-006 修复后真实文字终验（2026-08-30，FAIL-CLOSED）

- 调用前门禁：正式status证明source/runtime完整指纹`2E5A2C56A319D0E6178931B7F19857F4298323B9832A92125655E731A6E7E400`一致，fresh/ready/database=true；一次性grant绑定相同脱敏输入hash、`deepseek-v4-pro`、25KB/5120 tokens、thinking disabled、最多1次和`¥0.13`硬上限。验收runner修复前红灯证明使用默认品牌/100积分且未复验幂等；最小修复后仅用兰琪`controlled_acceptance`品牌指派、精确8积分和同requestId复用断言，不添加私有经营事实。
- 真实终验：`deepseek-v4-pro`恰好1次，`finish=stop`、fallback=false、tokens=`3640/885/0/4525`，thinking/reasoning=0，保守费用`¥0.018827`≤`¥0.13`；自动重试/repair/换模/追加=0，图片/视频/ASR/文件Provider=0。
- 精确失败点：脱敏诊断为`beauty-xhs-provider-output-v1 / field_validation / image_direction_1_post_text_multiline`；响应hash=`9607e1b2…c721f45a`、bytes=3662、无代码围栏、是7键JSON对象，标题3、标签7、图方向3、事实回执6键。封面`postProductionText`含换行，违反当前单行字段合同，因此在正式workflow Schema/Eval和`rubric_not_boss_usable`之前fail-closed；未保存模型正文、Prompt、密钥或客户原文。
- 账本/安全postflight：AgentRun=0；恰好1条8积分预留，一次consume与一次等额refund，reservation=`released`、actualAmount=0、净积分0；临时WorkBuddy凭据、product/agent entitlement均撤销，合成租户仅保留兰琪品牌指派审计，无经营档案事实。grant已原子改名为consumed记录，禁止复用。
- 回归：live failed postflight、XHS provider结构/safe trace/fixed-route/WorkBuddy/Web全矩阵专项均PASS；`pnpm.cmd qa:full`（qa:fast + qa:regression + build）PASS，追加Provider=0。真实产品路径没有成功文字任务，因此不得执行成功DOM/图片报价验收或创建邀请，也不以controlled_mock冒充放行。
- 最终环境：正式stop/start后PG55434/PID2076、API3016/PID17280、Web5176/PID7912在线；source/runtime=`2E5A2C56`、fresh/ready/database=true，文字已恢复controlled_mock，媒体disabled/max0。下一唯一零Provider恢复点：固化该安全结构诊断为脱敏replay，对`postProductionText`单行运输指令与确定性空白归一化做一次一变量红绿闭环；不降低字段完整性，不模板覆盖客户正文，不追加付费调用。

## QA-20260829-006 真实文字结果被正式合同拒绝

- 用户路径：兰琪租户在同页填写本次主题、目标顾客、项目、城市、门店事实、角度、语气与视觉要求后，文字结果未保存、最近任务为0，8积分预留均正确释放；图片报价/确认和万相Provider尚未进入。
- 脱敏运行证据：两次独立终态请求均正确锁定`beauty_xiaohongshu_package / acquisition:xhs / wechat-xhs-content-line@1.0.3 + beauty-industry-xhs@1.1.0 + beauty-industry-compliance@1.0.0`。`deepseek-v4-pro`均正常`finish_reason=stop`、fallback=false；第一次命中`xhs_deliverables_负向提示词_count`，第二次命中`missing_contract_terms_负向提示词`。AgentRun均为0；每次恰好一次8积分预留与等额释放，余额未变。
- 修复前红灯：`beauty-industry:xhs-provider-structure-p1-smoke`用同一脱敏字段组合稳定证明，配置Provider提示只有自然语言Markdown要求，没有机器可校验的单次输出传输合同，结构合格的正文仍可能遗漏三套独立负向提示词。
- 精确根因：固定route、Skill版本、Provider网络、解析入口和账本均正确；缺口位于配置Provider输出传输层。模型被要求直接自由生成长Markdown，正式合同只能在调用后拒绝缺失制作字段，且禁止repair调用，因此一次调用成功率不足。
- 最小修复方向：新增`beauty-xhs-provider-output-v1`，要求配置DeepSeek一次返回严格JSON，并在服务端确定性渲染为既有正式Markdown结构；原Schema/Eval、事实保留、第一人称、行业污染、合规、租户、账本和一次调用限制全部保持，不用模板补写客户正文。
- WorkBuddy候选诊断拒绝矩阵：拒绝“万相被当同步OpenAI接口/F盘无真实出图源码/去线上工程找”的判断。权威源码已有DashScope异步submit/task_id/轮询链，且BY-35已保留三图终验与SHA；本次DOM失败发生在文字生成保存前，图片报价、确认和Provider调用均为0。不得修改万相异步链、访问线上旧工程或碰`web-app-v2`。
- 零费用修复与门禁：新增`beauty-xhs-provider-output-v1`严格JSON传输和服务端确定性Markdown渲染；相同脱敏字段、缺字段/污染、事实、第一人称、fixed-route、Web/WorkBuddy与25KB预算专项均PASS。API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）和`git diff --check`通过。
- 唯一真实复验：`deepseek-v4-pro`恰好1次，`finish_reason=stop`、tokens=`3585/937/0/4522`、保守费用约`¥0.018997`，媒体Provider=0。Provider终态之后、正式workflow合同之前，结构化适配器失败；API返回500，当前通用provider错误映射只留下`provider_failure:unknown`，没有保存模型正文，无法从现有证据安全推断具体JSON字段，因此禁止猜测式放宽Schema或追加调用。
- 失败后postflight：AgentRun=0；8积分恰好一次预留、一次等额释放，净0；临时WorkBuddy凭据与产品/Agent entitlement均撤销，合成空档案租户最终余额0。此次授权已消费，不创建邀请码，不开放图片确认。
- 最终安全环境：正式身份门禁stop/start后PG55434/PID9680、API3016/PID17412、Web5176/PID17396在线；source/runtime完整指纹`8110A3E2AB1670FFE32603E1F49158D54D157C825F9AB8341BD7B2D880AA31BE`一致，fresh/ready/database=true。文字已恢复`controlled_mock`、媒体`disabled/max0`，不得作为真实质量验收入口。
- 下一唯一零费用恢复点：在结构化适配器中增加不含正文的字段级拒绝码可观测性，并用离线adversarial JSON覆盖合法JSON、代码围栏、额外键、角色/负向词/事实回执缺失；只有重新取得明确真实文本授权后才能验证一次调用成功率，不得修改万相异步链。

### QA-20260829-006 字段级安全可观测闭环（零 Provider）

- 修复前红灯：结构化适配器拒绝代码围栏或顶层额外键时，异常没有正式`providerFailure`，会被通用运行时压缩为`provider_failure:unknown`；无法区分JSON解析、顶层形状、字段校验或渲染阶段。新增脱敏replay Champion `scripts/fixtures/beauty-xhs-provider-output-qa-20260829-006.json`，只记录固定路由/版本、终态token计数、失败边界、账本计数和正文未持久化事实，不含用户原文、Prompt或Provider原始响应。
- 最小修复：`beauty-xhs-provider-output-v1`现在把适配器失败稳定映射为`invalid_response`，并输出`json_parse / top_level_shape / field_validation / render`阶段、安全合同规则、响应SHA-256、字节数、代码围栏布尔值、顶层类型/键数及标题/标签/三图/事实回执数量；字段值和正文始终不记录。回调本身失败也不能覆盖正式fail-closed语义。
- 三层边界复核：`xhs-provider-output.ts`负责结构化JSON适配，`output-contract.ts`继续负责规范Markdown的正式合同，`inspectProviderOutputsAgainstPrimaryContract`位于适配后的observed provider；适配器失败时observed outputs必为0，不能把它描述为对原始JSON的第三次复验。固定route、Skill与万相异步链均未修改。
- WorkBuddy候选采纳/拒绝矩阵：采纳本地三阶段审计、脱敏阶段/结构指标、replay Champion与只改XHS并回归相邻能力；拒绝保存原始模型输出或客户原文、访问`api.lcppch.top`/生产、未经证据断言“DeepSeek JSON不稳定”“8能力共用”或某个代码围栏/标签/编号/negativePrompt必为根因，也拒绝软化文字、Logo、二维码、水印或UI门禁。候选仅为参考，运行引用为0。
- 红绿与门禁：修复前`pnpm.cmd beauty-industry:xhs-provider-structure-p1-smoke`因缺少安全`invalid_response`诊断而FAIL；修复后该专项及XHS事实保留、controlled contract、客户交付、fixed-route、workflow composition、Web/WorkBuddy平台合同、API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）全部PASS，`git diff --check`PASS。Provider/外网/grant调用0，费用¥0。
- 状态边界：本轮零费用可观测子范围P0/P1=0，但QA-20260829-006产品P1仍为1。历史真实响应按安全规则未持久化，无法事后确定具体字段；在用户当前禁止重复真实调用且没有新授权时，不猜根因、不创建邀请、不开放图片确认。下一唯一恢复点是在新的明确真实文本授权下，用相同脱敏输入执行至多一次DeepSeek复验；若再次失败，新事件会给出可审计字段阶段与规则。
- 环境交接：全量门禁后按正式双重身份流程刷新同一受控AcceptanceRoot；PostgreSQL `55434/PID18140`、API `3016/PID16544`、Web `5176/PID16108`在线，source/runtime=`2437A3892735E521930AECEC099D3396A7779116B2BC4532C6A4936536D9E9B9`一致，`source_fresh=true`、ready/database=true。文字保持`controlled_mock`、媒体`disabled/max0`；该环境只用于零费用恢复验证，不是正式文字质量验收入口。

### QA-20260829-006 `rubric_not_boss_usable` 零Provider根因闭环（2026-08-30）

- 最新脱敏Champion：`scripts/fixtures/beauty-xhs-boss-usable-qa-20260829-006.json`只记录一次真实调用的模型/终态/usage/费用、适配成功结构边界、唯一blocking rubric、AgentRun和账本计数。实际调用为`deepseek-v4-pro`一次、stop、fallback=false、tokens `3585/801/0/4386`、约¥0.018051；适配器成功且正式结构满足3标题、5–8标签、3图方向、6键事实回执，随后只命中`rubric_not_boss_usable`。原始客户输入、模型正文、Prompt、凭据均未持久化。
- 修复前红灯：合法合成结构原先靠正文偶然出现“文案”躲过通用探针；移除该非合同必需词后，`beauty-industry:xhs-provider-structure-p1-smoke`稳定`true !== false`命中`rubric_not_boss_usable`，而JSON适配、标题/标签/三图/事实结构均未改变。
- 根因与单变量修复：`packages/agent/src/index.ts`的通用直接可用资产规则只认识话术、脚本、文案、清单、SOP等旧资产。新增XHS专属分支，仅当固定capability=`beauty_xiaohongshu_package`且Skill=`wechat-xhs-content-line/beauty-industry-xhs`时，按客户层的3标题、正文≥60、5–8标签、互动非空和无内部术语判定；通用关键词和其他能力行为不变。缺标题、4标签、缺互动三种adversarial仍命中同一rubric。
- 安全结构化追踪矩阵：

| 阶段 / 日志位置 | 允许字段 | 明确禁止 |
|---|---|---|
| `beauty_xhs_route_selected`（API NDJSON） | request/tenant指纹、固定route code、tool/capability/scope、Skill/版本、参数字段名/存在/数量、输入hash/bytes | 原始输入、经营资料字段值 |
| `domestic_provider_request_started/finished` + `domestic_provider_usage`（API NDJSON） | provider/model、请求指纹、host/path哈希、HTTP状态、开始/结束耗时、response hash/bytes、tokens、finish | URL查询、Authorization、Prompt、完整响应 |
| `beauty_xhs_provider_output_adapted/rejected`（API NDJSON） | adapter版本/阶段、合同规则、响应hash/bytes、顶层类型/键数、标题/标签/三图/事实键计数 | 标题、正文、提示词、字段值 |
| `beauty_workflow_output_rejected`（API NDJSON） | parser、精确contract/rubric、三层存在性/计数、blocking flags、response hash/bytes | 规范Markdown正文 |
| `CreditReservation/CreditTransaction/AgentRun` + postflight（隔离DB/脱敏报告） | 预留/结算/释放次数与金额、最终状态、run计数、结果码 | 客户输入/output、凭据 |

- 用户5条直述生图文本零Provider replay：

| case / 输入指纹 | 到达阶段 | 结果 / 原因 |
|---|---|---|
| poster / `b05f844501340dbb` | 固定XHS文字任务preflight | 需先保存文字任务并显式确认图片；没有直接图片工具 |
| vertical_beauty / `f611fea211d02608` | 固定XHS文字任务preflight | 同上 |
| minimal / `71c9cf3da9ea6ea5` | Web请求Schema | 仅4字符，低于question minLength=6，Provider前拒绝 |
| detailed_wallpaper / `17fcda287969b764` | 固定XHS文字任务preflight | 需先保存文字任务并显式确认图片；不把自由文本当图片Provider参数 |
| nail_ratio / `492ab31827ab4cba` | 固定XHS文字任务preflight | 需先保存文字任务并显式确认图片；不绕过300积分确认 |

  五次文本/图片Provider均0、费用¥0；这些只证明正式路由边界，不冒充当前同页任务的客户生成结果。
- 回归：XHS provider结构、safe trace replay、controlled contract、事实保留、客户交付、同页图片、fixed-route、WorkBuddy平台与workflow composition专项均PASS；API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）和`git diff --check`全部PASS。无DOM、路由或用户状态机变化，因此不重复1440/390浏览器E2E；当前端口离线，本轮未启动或刷新环境。
- 放行：本零Provider子范围P0/P1=0，但QA-006产品P1仍须最多1次修复后真实DeepSeek相同输入复验。成功门禁仍为正式Schema/Eval、事实/矛盾/第一人称/污染/合规全过、唯一AgentRun、8积分一次结算、Web/WorkBuddy一致；未成功前不创建邀请、不进入图片确认。

## 归属

- 产品：美业智能体通用核心（兰琪品牌包验收租户）
- 层级：产品任务含服务端媒体交付子改动
- 风险：高（真实媒体、客户资产、积分、租户与幂等）
- 预计修改热点：XHS 图片计划、媒体资产持久化、服务端确定性合成、同页下载与验收环境授权
- 是否允许并行：否；BY-19/BY-20 继续 PAUSED

## 用户结果

受邀用户在小红书图文同页填写本次需求并确认一次三图费用后，获得经过底图安全门禁、服务端确定性中文排版的三张最终成品，可逐张查看、下载并在刷新后恢复。

## 本次范围

- 文字任务与三图计划继续固定正式 Skill/plan/prompt；图片模型只生成无字底图。
- 底图先做安全门禁，通过后由服务端确定性合成渐变与已确认短句，最终成品独立原子落盘。
- 下载和页面预览只读取最终成品；底图保留为租户内审计资产，不进入客户下载路径。
- 图片确认资格由数据库租户、产品 entitlement、积分、服务端费用上限和幂等共同推导，不依赖一次性测试 grant 残留。
- 零 Provider 闭环后，在既有单批不超过人民币 1 元授权内最多执行一个 `wan2.7-image` 三图批次。

## 本次不做

- 历史 safety-v2.8 批次不事后重判；新任务钉死 safety-v2.9，不按 SHA 放行，不遮挡/移除第三方水印。
- 不调用 WorkBuddy 候选原件，不复制其旧页面/品牌硬编码/单图自动重试设计。
- 不恢复 BY-19/BY-20，不部署生产，不自动重试、换模、补图、追加或生成第 4 张。

## 验收条件

1. 正常路径：三张无字底图顺序技术成功、原子落盘和 safety-v2.8 通过；封面叠选中标题，内容/互动图叠合同内短句；三张最终 PNG 可查看、逐张下载、刷新/历史恢复。
2. 失败路径：底图水印/Logo/伪文字、合成字体缺失、存储失败、越权、余额不足、预算关闭或 Provider 终态不明均失败关闭，不创建客户成品、不重复扣费。
3. 不应发生：不把后期叠字仅留作元数据；不让客户下载底图；不把兰琪名称/颜色/知识写入通用合成器；不让前端请求体绕过品牌、权限或费用。
4. 可观测结果事件：记录底图质量状态、合成版本/角色/字体/尺寸/最终 SHA、客户资产状态、批次与账本终态；不记录 Prompt、密钥或 Provider 原始响应。

## 基线与失败证据

- 修复前红灯一：正式链只在图片计划中保存“后期叠字”策略和 `linkedTitleHash`，客户资产仍直接读取 Provider 文件；没有 sharp/canvas 或等价服务端最终合成步骤。
- 修复前红灯二：`resolveReadiness()` 同时要求 `BEAUTY_MEDIA_REAL_EXECUTION_APPROVED=true` 和 `BEAUTY_MEDIA_EXECUTION_MODE=real`；BY-34 撤销一次性 grant 后运行时为 media disabled/max0，受邀用户的确认按钮必然不可用。
- 候选审查：采纳“底图交模型、文字交代码、水印只拒绝不遮挡”、纯画面和三状态信息层级；拒绝旧 `BeautyStoreAiApp` 架构、品牌硬编码、候选的单图自动重生成/再次扣费、旧模型/环境变量命名与运行时依赖。

## 实现记录

- 通用核心新增 `apps/api/src/services/beauty-image-compositor.ts`：以 `@napi-rs/canvas` 在原图同尺寸绘制暗色渐变与 CJK 字体白字；本轮把版本升级并钉死为 `beauty-image-composition-v1.1`，不含兰琪品牌名称、知识或色值。
- `media-contract.ts` 从正式结构化文案生成封面/内容/互动三角色叠字合同；前端把用户所选正式标题传入 quote/confirm，服务端验证标题属于正式候选。
- `beauty-media-assets.ts` 分离 Provider 底图与 `.final.png` 客户成品：底图保持不可变审计证据，客户预览/下载优先读取租户内最终合成文件；跨租户继续拒绝。
- `beauty-industry-media.ts` 固定执行顺序为 Provider 底图落盘 → safety-v2.9 → 服务端合成 → 最终资产落盘；新任务必须 `composition.status=completed` 才可客户交付。图片就绪由服务端产品开关、entitlement、租户、预算、积分和幂等推导，不依赖开发者手工保留的一次性媒体批准位。
- 新增 `beauty-industry:image-composition-p1-smoke` 并加入 `qa:fast`；API 包显式声明仓库已有的 `@napi-rs/canvas` 依赖。
- WorkBuddy参考仅采纳“模型出无字底图、程序叠字、水印只拒绝”的方法；候选运行引用为0，未复制旧App、品牌硬编码、自动付费重试或前端合成。
- 兼容性和回滚点：没有数据库迁移；历史批次按持久版本只读，旧资产没有合成回执时仍走历史兼容读取，本任务新批次要求合成完成。

## 验证

- 零Provider：composition、same-page、persistence/observability、generation-success、real-media、image-quality、asset-url、media-observability、XHS workbench/retry 专项全部 PASS；safety-v2.8 安全25/25、风险55/55连续3次 precision/recall=`1.000/1.000`。
- 工程门禁：API/Web/Agent typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含build）和 `git diff --check` PASS。live runner末尾的当前任务计数/DOM文字断言修正后，`beauty-industry:real-media-smoke` 与 `qa:fast` 再次 PASS。
- 真实终验：一次性grant固定 `aliyun_bailian/wan2.7-image`、最多3个顺序任务、总额≤¥0.60、重试/修复/换模/补图/追加=0。实际仅第1个Provider任务成功，底图通过safety-v2.8并完成服务端合成；最终PNG为768×1024、SHA `2e7b888d…cea52`、871988 bytes。
- 客户人工门禁：最终封面叠字存在重复语义且超长省略，未达到老板可直接使用标准，立即拒绝并停止第2/3图。客户资产/下载0；300测试积分一次消费、一次等额退回，净0；实际Provider任务1、保守费用¥0.20，其他Provider0。
- 页面/E2E：真实Chrome完成受控登录、兰琪品牌租户、正式历史文字恢复、报价与首次显式确认；因第1图客户质量失败，未继续执行成功态390px/三图下载/邀请流程。
- 环境：隔离API3017/Web5177已按双重身份stop；共享受控PostgreSQL55434保留。旧3016身份不一致环境未接管、未修改。一次性grant已消费封存，媒体授权已撤销。

## 交接

- P0=0；P1=1。程序合成链、权限和账本已完成，但选中标题缺少客户可读性/排版适配预检，导致过长、重复标题在付费底图生成后才暴露并被省略号截断。
- 下一唯一零费用恢复点：为封面叠字建立通用的“用户确认文本”合同，覆盖长度、重复片段、分行可容纳性和无省略号；不合格标题必须在Provider/积分前要求用户选择或编辑，内容/互动短句同样做版面预检。不得硬编码本次标题，不得自动改写客户文案或追加付费调用。
- 未达到3/3客户可用和P0/P1=0，因此没有创建邀请码，也没有保持半成品验收环境在线。
- 最后更新日期：2026-08-28

## QA-20260828-007 零Provider可读性闭环

- 修复前红灯：脱敏Champion仅保留失败成品短SHA `2e7b888d…cea52`和重复标题分布；新增专项在修复前因缺少`preflightBeautyImageOverlay`稳定失败。根因链为“正式标题候选验证通过 → 叠字元数据原样进入composition-v1 → 固定字号/最大行数后追加省略号”，不是固定route、Skill或标题数组拼接错误。
- 最小修复：`beauty-image-composition-v1.1`在quote与confirm两条HTTP路径、积分预留和Provider提交前，对封面/内容/互动三角色执行相同预检。它用仓库CJK字体真实测量字宽，按画布逐级缩放字号，完整换行并校验行高、安全边距与最大行数；任何字符都不以省略号截断。仅清理“标题1：”等非语义展示前缀；语义重复、过长或emoji/不可靠符号精确422并要求用户修改或另选，不暗改用户标题。
- 持久化与恢复：最终合成回执新增`fontSize/lineHeight/lineCount/maxLines/horizontalPadding`，与composition版本一起落盘；下载与刷新仍读取同一最终PNG，历史v1回执只读保留、不事后重算。
- 绿灯：脱敏重复Champion、超长、emoji均在Provider/积分前失败；短标题、中英混排、标点以及内容/互动短句在768×1024和390×520画布完整保留、无重复、无省略号。composition同批连续3次PASS，三角色最终PNG/原子持久化/租户资产路径PASS，Provider/外网/grant=0、费用¥0。
- 页面回归：仓库真实Chrome runner连续3次PASS。桌面1440与390px均完成本次主题+结构化顾客/项目输入、受控图文生成、图片计划、保存/刷新与双租户；重复标题分布在移动页面显示精确422，图片资产0。双击只有1个文字任务，未处理console错误0、外部Provider请求0。浏览器扩展未连接时按40秒超时失败关闭，未无限等待，最终证据来自仓库Chrome DevTools runner。
- 全量门禁：API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`均PASS。图片precision全历史脚本本轮未重复执行：其两个已登记历史资产当前不在受控文件系统；本轮没有修改safety-v2.8，沿用BY-34已登记的25安全/55风险连续3次1.000/1.000证据，并补跑image-quality/real-media零调用/资产URL/持久化/媒体观测专项。
- 最终受控环境：PG55434、API3016、Web5176在线；source/runtime短指纹=`928D36F9`、source_fresh=true、ready/database=true；text=controlled_mock、media=disabled/max0。该环境只用于零费用流程回归，不冒充真实文本或图片质量。
- 本原子文件归属：通用核心`apps/api/src/services/beauty-image-compositor.ts`、`apps/api/src/products/beauty-industry/media-contract.ts`、`apps/api/src/routes/beauty-industry-media.ts`、`apps/api/src/services/beauty-media-assets.ts`；回归`scripts/beauty-industry-image-composition-p1-smoke.ts`；本任务及状态/合同/测试/回归文档。没有兰琪品牌包源码改动，WorkBuddy候选运行引用0。
- 本原子范围P0=0、P1=0，QA-20260828-007关闭。没有创建grant或调用Provider；BY-35三张真实客户成品仍须后续按既有单批边界独立终验，本轮不创建邀请码、不恢复BY-19/BY-20、不部署生产。

## QA-20260829-001 顶部低对比伪文字召回闭环

- 修复前红灯：上一轮底图SHA `e91ef4af…aa331`在safety-v2.8稳定返回passed；脱敏Champion证明旧edge-component分组没有顶部glyph候选，顶部连续17行却存在高密度横向明暗转换（峰值98）。
- 单变量Challenger：safety-v2.9只在既有字形候选均不成立时增加顶部高密度笔画带证据，联合要求顶部20%、连续行、每行转换密度、水平覆盖20%–85%与亮度差；无SHA/路径白名单，不改变既有QR/条码、文字Logo、UI水印、人物或总fail-closed。
- 绿灯：同一真实底图现以`glyph_sequence/visible_text_or_brand_like`拒绝；25安全/56风险同批连续3次precision/recall=`1.000/1.000`。图片质量、generation-success、real-media零调用、持久化、URL、media-observability、XHS同页和composition专项均PASS。
- 安全验收编排：live runner在人工逐图审核模式下强制要求显式`UPLOAD_DIR`，避免Provider后因验收进程缺少资产根目录而产生不可审计终态；这不改变产品运行合同。
- Provider/外网/grant=0、费用¥0。本检测子范围P0/P1=0；紧接执行唯一受控三图终验，任何失败立即停止，不恢复BY-19/BY-20、不部署。

## 2026-08-29 safety-v2.9 / composition-v1.1 最终受控三图终验

- 授权与执行：一次性不可重放grant固定`aliyun_bailian/wan2.7-image`、plan-v2、prompt-v1.2、safety-v2.9、composition-v1.1，最多3个顺序任务、保守总额不超过¥0.60、重试/修复/换模/补图/追加=0。grant仅消费一次并封存，结束后媒体恢复`disabled/max0`。
- 第1图：Provider技术成功，底图SHA `103b2d58…80537`、768×1024，自动质量PASS；最终合成PNG SHA `627524bf…b3ed`，标题完整、无重复、无省略号、人工只读客户可用性PASS。
- 第2图：Provider技术成功并原子落盘，底图SHA `df997146…f04c`、768×1024；safety-v2.9以`interface_or_watermark_like`和`visible_text_or_brand_like`拒绝。脱敏证据分别来自右下角`corner_watermark/edge_components`和中部`glyph_sequence`；人工只读只见无字瓶罐、毛巾、绿植和浅色木质家具，但人工没有覆盖自动fail-closed。
- 停止语义：第2图拒绝后第3图未提交；实际Provider任务2、保守费用¥0.40，其他Provider0，无第4个任务。整批`quality_failed`、客户资产/下载0；300测试积分一次预留、一次全额释放，净0。
- postflight：审计脚本现按精确`batchRequestId`隔离同一文字任务的历史批次，并读取Provider底图而非客户合成图校验quality SHA；重复审计不创建Provider任务、不改资产、不新增账本交易。结果为Provider任务2、技术成功2、质量拒绝1、未提交1、客户可用0、净积分0。
- 页面与环境：桌面1440与390px均展示真实失败关闭，无横向溢出；刷新/历史、owner/跨租户404、console=0通过。PG55434/API3016/Web5176在线，source/runtime完整指纹`6EF8938C96F541ACED6D7C30A2FBFEA972D3B996FD3320A480E61F36318D3C7C`、source_fresh=true、ready/database=true；text=controlled_mock、media=disabled/max0。
- 回归：顶部伪文字修复的25安全/56风险连续3次precision/recall=`1.000/1.000`、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`已PASS；真实批次后image-quality、generation-success、real-media零调用、composition、XHS同页、持久化、URL、media-observability及live postflight再次PASS。
- 结论：P0=0、P1=1。QA-20260829-001保持关闭；新开QA-20260829-002，唯一恢复点是以`df997146…f04c`固化零Provider精度Champion，定位自然毛巾/台面/瓶罐几何为何同时命中corner/glyph证据，在风险召回不下降前不得修改生产或再次付费终验。未创建邀请码，不恢复BY-19/BY-20，不部署。

## 2026-08-29 QA-20260829-002 safety-v2.10精度闭环与最终真实终验

- 修复前红灯：`df997146…f04c`在v2.9连续稳定命中右下`corner_watermark/edge_components`与中部`glyph_sequence`。Champion仅保存bbox、active rows/columns、ink density、glyph count/ratio、coverage及`readableSequenceRecovered=false`，不保存Prompt、Provider响应、凭据或客户内容。
- 根因与单变量语义：两条误拒都缺少“显式文字结构一致”证据。v2.10移除没有字形/解码支撑的corner bright-ink兜底，并要求通用glyph序列全部组件满足字形几何；既有QR/条码、真实文字/Logo、UI/水印、人物和fail-closed均不变，无SHA/路径白名单。26安全/56风险同批连续3次precision/recall=`1.000/1.000`。
- 批次恢复P1：旧`quality_failed`批次在用户要求未变时一律返回409，导致安全合同升级也无法重验。现在只有“失败批次且plan/prompt/safety/composition任一版本确已变化”可再次显式确认；成功批次仍必须修改本次要求。回归覆盖不变版本阻断、升级版本放行、同一请求幂等。live runner同时强制确认响应成功且新批次job ID不得来自历史批次。第一份grant在HTTP409前置处消费但新job/Provider/积分/业务写入均0，已封存`preflight-revoked`；替代grant未扩大用户授权。
- 真实执行：替代grant固定`aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.2/safety-v2.10/composition-v1.1，最多3个顺序任务、¥0.60、重试/修复/换模/补图/追加0。确认接口合法返回204后批次唯一创建3个新job；验收器修正为接受200/204成功语义，不再把旧批次当新结果。
- 结果：封面底图SHA `15721cea…5b3f`、最终PNG `90602fe2…eef93`；内容底图SHA `4cdeb649…0c90`、最终PNG `67f1f51b…6c19`。两张均768×1024，技术、原子落盘、v2.10、composition-v1.1与人工只读客户可用性PASS。互动底图SHA `350b1f39…b994a`包含手持手机与界面设备构图，违反纯摄影静物、无人、无UI合同；自动以`visible_text_or_brand_like`拒绝，未创建客户合成图。
- 账本与停止：恰好3个Provider任务，无第4张；保守费用¥0.60，其他Provider0。整批`quality_failed`、客户资产/下载0，300测试积分一次预留一次全额释放、净0；postflight重复审计不改资产、不新增Provider或交易。
- 工程与环境：图片/XHS/composition/持久化/URL/媒体观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）及`git diff --check`PASS。PG55434/PID14152、API3016/PID13624、Web5176/PID10208在线，source/runtime=`171DCB4C`、fresh/ready/database=true，media disabled/max0。
- 放行：QA-20260829-002关闭；新开QA-20260829-003/P1，下一唯一零Provider恢复点是把互动图固化为手持手机/空白屏幕/局部手部/UI设备风险正例，并同时验证engagement payload禁止项和显式detector理由，不能依赖木纹glyph偶然拒绝。P0=0、P1=1，未创建邀请码，不恢复BY-19/BY-20、不部署。

## 2026-08-29 QA-20260829-003 手持设备显式门禁零Provider闭环

- 修复前红灯：真实互动底图短SHA `350b1f39…b994a`虽然包含手持手机、空白屏幕与局部手部，safety-v2.10却只在木纹区域给出`glyph_sequence`，`readableSequenceRecovered=false`，没有任何人物或设备显式证据；正式engagement payload也未列出手掌、手指、手持手机、屏幕和设备边框的角色专属禁止项。
- 根因与单变量Challenger：固定route、Skill、plan-v2和composition均未错；缺口位于engagement的Provider适配和底图安全证据。`beauty-image-provider-prompt-v1.3`仅为互动角色新增纯摄影静物、无人、无手部、无手机/屏幕/UI设备约束；封面/内容payload哈希保持不变。`beauty-image-safety-v2.11`新增可解释的`person_device_geometry/person_or_device_like`联合证据，必须同时满足亮色竖屏、暗色设备框、边缘密度及邻近肤色区域，不以单个矩形、木纹或SHA/路径判定。
- 精度与稳定性：同一真实手持设备资产和合成手持设备均得到显式拒绝；真实封面/内容安全图继续PASS。26个安全样本、57个文字/Logo/UI/水印/QR/条码/人物/设备风险样本同批连续3次precision/recall=`1.000/1.000`，Provider/网络调用0、费用¥0。
- 浏览器回归补口：旧runner按整个AgentRun累计历史批次，两个三图批次被误计为6个Provider任务。回归现按持久化`batchRequestId`只读隔离最新批次，未放宽单批最多3张；真实Chrome桌面1440、390px、刷新/历史、owner/跨租户404、console0、外部请求0、账本变化0均PASS。
- WorkBuddy候选审查：完整只读审查`poster-wiring.md`及其引用的旧`BeautyStoreAiApp.tsx`。采纳“服务端异步编排、租户内持久化、服务端确定性中文叠字、前端只读成品URL”的方法原则；这些能力已由正式BY-35链独立实现。拒绝旧`poster → content_nine_piece/baolu_content_creator`映射、通用文本框、前端二次图片请求、Markdown拼图、占位标题、503静默降级、兰琪硬编码及任何WorkBuddy运行依赖。候选运行引用0。
- 完整门禁：图片/XHS/composition/持久化/URL/媒体观测专项、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`均PASS。受控环境PG55434/PID14152、API3016/PID220、Web5176/PID10208在线，source/runtime=`3739754F`、fresh/ready/database=true；text=controlled_mock、media=disabled/max0。
- 文件归属：通用核心为`media-contract.ts`、媒体route和XHS通用失败原因文案；回归为两个脱敏fixture、新人物设备专项、精度池与按批次浏览器runner。没有兰琪品牌包业务事实/主题硬编码，没有修改正式Skill映射。
- 放行结论：QA-20260829-003关闭，本零费用原子范围P0/P1=0；BY-35客户交付仍未获得修复后真实3/3证据，产品范围残余P1=1，因此不创建邀请码、不让用户验收半成品。下一唯一恢复点是在既有单批≤¥1边界下对prompt-v1.3/safety-v2.11执行一次受控三图终验；本轮不调用Provider，不恢复BY-19/BY-20，不部署。

## 2026-08-29 prompt-v1.3 / safety-v2.11 真实终验与QA-20260829-004

- 授权与预检：一次性不可重放grant固定`aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.3/safety-v2.11/composition-v1.1，最多3个顺序任务、保守上限¥0.60，重试/修复/换模/补图/追加0。兰琪测试租户entitlement有效、余额500；source/runtime=`3739754F`、fresh/ready/database=true，apps/api百炼密钥预检通过且根目录错误密钥未使用。
- 首张结果：实际只创建封面Provider任务1个。底图SHA `6b39f1cd…100d9`、最终PNG SHA `0041cfef…87564`，768×1024；技术终态、原子落盘、safety-v2.11、composition-v1.1和人工只读客户可用性全部PASS，中文标题完整、无重复、无省略号。
- 首个失败与停止：live runner在页面确认后用通用“最新批次”读取同一AgentRun的历史`quality_failed`终态，触发“本批3个job必须全为新建”断言；这不是图片质量失败。遵守首失败停止边界，第2/3图未提交。为避免崩溃后自动续单，第1图以保守operator拒绝关闭批次；客户资产/下载0，300积分一次预留一次全额释放、净0，保守费用¥0.20，其他Provider0，无第4张。
- 修复前红灯：一是grant已钉死v1.3/v2.11而脚本源码正则仍残留v1.2/v2.10；二是确认后仅按`/media/jobs`“最新批次”轮询，在复用历史AgentRun时会把旧终态当成本批终态。两者均在Provider之外稳定复现。
- 零Provider最小修复：源码版本断言统一到v1.3/v2.11；页面confirm返回后立即以相同幂等键只读恢复精确3个job ID，后续终态/人工复核只接受该集合，匹配不足时等待而不是采用历史终态。重复确认不新建任务、不新增账本或Provider调用。
- 验证：real-media、engagement prompt、person-device、generation-success、composition、XHS同页专项，API/Web/Agent typecheck，`qa:fast`、`qa:regression`、`qa:full`（含build）和`git diff --check`均PASS。真实Chrome按最新批次验证1440/390px、刷新/历史、owner/跨租户404、客户图片/下载0、console0、外部请求0、账本变化0。
- 环境与恢复点：runner修复后已按正式身份门禁刷新；PG55434/PID2612、API3016/PID11384、Web5176/PID18264在线；source/runtime=`03FAE909`且fresh，媒体保持disabled/max0，grant只保留consumed审计且active grant=0。QA-004零费用runner根因关闭；BY-35仍缺修复后真实3/3客户成品，P0=0、产品P1=1，不创建邀请码。下一唯一恢复点是在新的明确受控批次安排下重新验证3/3，不复用本次grant；BY-19/BY-20保持PAUSED，不部署。

## 2026-08-29 精确batch runner真实复验与QA-20260829-005

- Provider前预检：新的一次性grant固定`aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.3/safety-v2.11/composition-v1.1、最多3个顺序任务、保守总额≤¥0.60，重试/修复/换模/补图/追加0；绑定正式文字run输入SHA与本次视觉要求SHA。兰琪测试租户entitlement有效、余额500，百炼密钥仅从`apps/api/.env`进程内加载且未输出。
- runner可审计性补口：受控JSON读取兼容PowerShell BOM；只统计confirm的POST响应而不把OPTIONS预检计为第二响应；确认成功码接受正式202；视觉要求成为grant绑定且必须是客户语言；resume必须提供并只轮询同一幂等键恢复的精确3个job ID。以上红灯均在Provider/积分前复现，real-media smoke已锁定。
- 精确批次：batchRequestId只关联本次3个job；实际仅第1个job产生ProviderTaskId。底图短SHA`e98c0d51…92dc`、最终PNG短SHA`7142a6df…d0f1`，均768×1024。技术成功、底图/最终图原子落盘与composition-v1.1完成。
- 新首失败：底图顶部可见中文，违反无字底图合同；safety-v2.11却返回passed且quality evidence为空。人工只读门禁选择reject，只负责阻止客户交付，没有覆盖或改写自动门禁。这是新的自动召回P1，不是QA-004的批次身份复发。
- 停止与账本：第2/3任务未提交，Provider任务1、保守费用¥0.20，其他Provider0，无重试/补图/第4张。整批quality_failed、客户资产/下载0；300积分一次预留后全额释放、净0。grant已消费封存，active grant0；媒体恢复disabled/max0。
- 页面与postflight：真实Chrome桌面1440/390px失败态、刷新/历史、owner与跨租户404、console0均PASS。live postflight证明Provider任务1、技术成功1、operator质量拒绝1、未提交2、客户可用0、净积分0，重复审计新增Provider/网络0且资产SHA不变。
- 工程门禁：real-media、engagement、generation-success、composition、same-page、persistence、asset-url、media-observability专项，API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）和`git diff --check`全部PASS。错误命令名一次失败仅属命令入口，按`package.json`更正后实际脚本PASS。
- 放行：P0=0、P1=1；没有3/3客户成品，不创建邀请码、不让用户验收。最终按正式身份stop/start后PG55434/PID4788、API3016/PID13364、Web5176/PID17988，source/runtime完整指纹`3739754F797446D53E760E3837BB8FF35B4F01C3D68B9CA03B6524148F56946B`、fresh/ready/database=true，media disabled/max0。下一唯一零费用恢复点是以`e98c0d51…92dc`建立可见文字漏检Champion，保存脱敏候选/几何/笔画特征，与真实安全及文字/Logo/UI/水印/QR/条码/人物风险同批连续3次评估；一次只改一个变量，风险召回不下降前不得再次付费终验。BY-19/BY-20继续PAUSED，不部署。

## 2026-08-29 safety-v2.12零Provider闭环与最终3/3放行

- 修复前红灯与根因：真实底图`e98c0d51…92dc`在v2.11稳定为passed/evidence0。384×512脱敏诊断显示顶部三字符连接为`x166/y28/w51/h19`、pixels571、fill0.589、aspect2.684；旧单字候选最大宽度46，整块在字形分组前被排除，后续stroke-band也未形成证据。
- 单变量修复：`beauty-image-safety-v2.12`只在已有分离字形和顶部笔画带路径都未命中时，增加顶部位置、宽高占比、填充率与长宽比联合成立的`connected_top_display_text_block`。无SHA/路径白名单，不改变二维码、条码、Logo、UI、水印、人物或总fail-closed；正式route、live runner和持久版本统一钉死v2.12。
- 零费用门禁：26安全/58风险同批连续3次precision/recall=`1.000/1.000`；图片质量、generation-success、composition、XHS同页、persistence、URL、media-observability专项、API/Web/Agent typecheck和`qa:fast/regression/full`（含build）全部PASS，Provider/外网/grant0、费用¥0。
- 最终真实批次：新不可重放grant`by35-image-composition-live-20260829-once-9d3f247cd90d`固定`aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.3/safety-v2.12/composition-v1.1。实际恰好3个顺序Provider任务，无重试/修复/换模/补图/追加/第4张；三张最终PNG均768×1024，SHA分别`e17f6576…1b9d0`、`64000e5b…0f0a`、`29b61724…dfb0`，自动质量与人工只读客户可用性均PASS。
- 客户/账本/租户：batch=succeeded，客户资产与逐图下载3；300测试积分由同一reservation一次预留、一次结算，actualAmount=300，重复确认没有新流水或Provider任务。owner读取200，对照租户404；桌面1440/390px、刷新/历史、console0通过。保守Provider费用¥0.60，其他Provider0。
- 验收runner补口：首次完整运行在刷新后只等待固定三张卡片，未等待异步鉴权下载形成对象URL，过早得到图片0/3。新增等待`img.complete && naturalWidth>0`，以已消费grant与精确3个job ID零Provider恢复后桌面/390px均PASS；未创建新任务、未改账本。
- 最终环境：已通过正式stop/start封存一次性开发grant；PG55434/PID19160、API3016/PID3404、Web5176/PID15220在线，source/runtime完整指纹`9245D8AC5FEEB853DC03AFF045044E3986F39363747A375C973D6081D60FD719`、fresh/ready/database=true。本机邀请验收按既有授权启用固定DeepSeek V4 Pro真实文案与media real/max3，密钥仅从`apps/api/.env`进程内加载；用户须显式确认300积分，单个完整任务文本+图片硬上限≤¥1，自动重试/修复/换模/补图/追加仍为0，生产未启用。新邀请记录`cmte16a5e0000sqd70671cpd1`为beauty-industry/lanqi、24小时、最多1次、usedCount0，旧未使用邀请已停用；明文只在本任务最终反馈一次。QA-20260829-005和BY-35关闭，范围P0/P1=0；BY-19/BY-20保持PAUSED。
