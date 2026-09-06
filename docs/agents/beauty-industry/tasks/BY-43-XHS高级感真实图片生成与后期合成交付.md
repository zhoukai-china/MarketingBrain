# BY-43 XHS 高级感真实图片生成与后期合成交付

状态：PAUSED；QA-20260901-005 零Provider检测子范围已关闭，产品P1等待v2.16真实三图3/3终验

## 归属

- 产品：美业智能体 / 兰琪品牌实例
- 层级：产品任务含通用美业核心子改动；兰琪继续只消费服务端品牌配置
- 风险：高（真实图片 Provider、积分、租户资产和客户交付质量）
- 预计修改热点：`apps/api/src/products/beauty-industry/media-contract.ts`、`apps/api/src/routes/beauty-industry-media.ts`、`apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、专项脚本和质量文档
- 是否允许并行：否；BY-19/BY-20继续PAUSED

## 用户结果

用户在同一小红书图文任务中明确确认300积分后，获得三张由真实图片模型生成、经过安全筛查和服务端中文后期合成的商业摄影感成品，并可预览、逐张下载和刷新恢复。

## 本次范围

- 撤回BY-41“确定性几何门店场景已达到最终图片质量”的放行结论；保留其零费用流程证据和历史版本只读恢复。
- 恢复固定 `beauty-xhs-image-plan-v2 → beauty-image-provider-prompt-v1.7 → aliyun_bailian/wan2.7-image → beauty-image-safety-v2.15 → beauty-image-composition-v1.1` 新批次链路。
- 三角色使用英文纯画面商业摄影提示词；中文标题和互动短句只由服务端后期叠加。
- 新批次由租户entitlement、产品媒体开关、本地存储、人民币预算、积分与幂等共同放行；不得把Provider密钥或内部Prompt下发Web。
- 新增高级感前置质量合同：构图完整、真实光影与材质、商业空间摄影语义、主题相关性和三角色差异；输出仍以自动安全门禁和隔离验收人工只读可用性双重确认。

## 本次不做

- 不把WorkBuddy候选作为运行资产，不使用候选前端同步`/images/generations`方案。
- 不生成或伪造本店实景、未授权人物、品牌、Logo、价格、疗效或顾客案例。
- 不自动重试、修复图、换模、补图、追加或生成第4张；不部署生产。
- 不删除历史确定性图片或旧Provider批次。

## 验收条件

1. 正常路径：显式300积分确认后，三角色顺序生成；3/3经过原子落盘、安全、后期合成和客户质量检查才开放预览/下载。
2. 失败路径：媒体未授权、存储未就绪、预算超限、输入要求涉及本店实景/人物、Provider失败、质量拒绝或终态不明时均失败关闭，积分只释放一次。
3. 不应发生：新批次不得再使用`local_deterministic`或几何场景冒充高级感真实图片；不得向客户显示Prompt、Provider、模型参数或内部审计正文；不得调用WorkBuddy候选。
4. 可观测结果事件：记录固定模型/plan/prompt/safety/composition版本、脱敏请求指纹、Provider任务终态、资产SHA/尺寸、质量状态、账本状态、调用次数与保守成本，不记录Prompt或Provider正文。

## 基线与失败证据

- 用户真实验收：BY-41文字与图片均能完成，但三张图呈现简单几何/插画式门店空间，缺少摄影质感、空间层次、材质与光影，用户判定明显低于候选参考的高级感。
- 代码Champion：当前新批次固定`provider=local_deterministic`、`deliveryMode=deterministic_store_scene`、Provider费用0；该实现只保证稳定和可辨识，不能满足真实商业摄影质量。
- 修复前红灯：`pnpm.cmd beauty-industry:xhs-premium-image-delivery-p1-smoke` 应因新批次仍指向本地确定性绘图而失败。

## WorkBuddy候选采纳/拒绝矩阵

| 候选项 | 结论 | 理由 |
|---|---|---|
| 后端异步提交、轮询、临时URL原子落盘 | 采纳思想，复用仓库正式现有实现 | 正式源码已经具备DashScope异步submit/poll和租户资产持久化 |
| 中文标题由服务端Canvas后期叠加 | 采纳 | 与现有composition-v1.1和无字底图合同一致 |
| 前端再请求通用`/api/image/generate` | 拒绝 | 当前产品已有固定XHS媒体路由、租户、积分和幂等合同，不复制第二套入口 |
| 未配置密钥时静默降级为提示词 | 拒绝 | 会把不可交付状态伪装成成功；正式路径必须显式fail-closed |
| WorkBuddy组件/代码成为运行依赖 | 拒绝 | 候选隔离规则要求运行引用0 |

## 实现记录

- 新批次已从`local_deterministic`切换为显式`real_provider_composed`，固定`aliyun_bailian/wan2.7-image + beauty-xhs-image-plan-v2 + beauty-image-provider-prompt-v1.7 + beauty-image-safety-v2.14 + beauty-image-composition-v1.1`；历史确定性任务和旧prompt版本仍按记录只读恢复。
- 三角色Provider输入改为英文纯画面商业摄影合同：接待咨询区、护理空间、咨询承接区，固定3:4、真实光影/材质/景深、无人物/文字/品牌/Logo/QR/条码/水印/UI；中文只由服务端后期合成。
- quote/confirm同时校验租户entitlement、产品媒体开关、local storage、最多3张和人民币硬上限。修复了`3 * 0.2 = 0.6000000000000001`导致¥0.60错误越界的浮点预算Bug，改用整数分计价。
- Web改为“商业摄影感配图/确认真实生成三张图片”，不再把几何门店场景描述为最终质量；主题、项目、目标顾客仍在Provider与积分前逐项提示，城市/门店事实/语气/视觉为可选项。
- WorkBuddy候选只读审查；正式运行引用0，未复制候选路由或组件。

## 验证

- 修复前红灯：高级感专项先因active chain仍为本地几何图失败；全仓`qa:fast`再捕获Provider payload缺3:4；真实quote-only又捕获¥0.60浮点误判导致按钮disabled。三项均已最小修复并转绿。
- 零Provider：XHS高级感、输入preflight、同页图片、结构/客户交付、real-media合同、composition、persistence、URL、media-observability、API/Web typecheck、`qa:fast`、`qa:regression`、`qa:full`含build和`git diff --check`PASS。桌面1440/390px quote、刷新、跨租户、console0、confirm0、Provider0 PASS。
- 唯一真实终验：一次性grant `by43-premium-delivery-live-20260901-once-76788010a781`已消费。只创建`wan2.7-image`第1个顺序任务，技术成功并形成768×1024最终PNG；人工只读发现墙面伪英文、设备Logo、带人像/QR样式桌牌及包装文字，立即reject并停止第2/3任务。Provider任务1、保守费用¥0.20；客户资产0，300积分一次预留后全额释放，未创建第4任务、未重试/修复/换模/补图。
- 该真实图暴露`safety-v2.13`假阴性：自动状态曾为passed但多类明显风险未被检出。不能以人工拒绝替代自动门禁，故产品未达到用户验收线。
- 零Provider根因红灯：真实底图SHA短值`aadedfc9…e1f`在v2.13稳定返回passed。既有顶部展示文字带只覆盖画面上方20%，而墙面两行伪英文位于采样图约38%–44%高度；通用glyph分组又把其碎片化，最终没有形成可拒绝证据。
- 最小修复：`beauty-image-safety-v2.14`仅在画面中段要求两条水平对齐、间距受限、中心漂移受限且笔画转换密度足够的展示文字带，输出`visible_text_or_brand_like / center_display_text_stroke_band`。没有SHA/路径白名单，也未降低二维码、条码、Logo、UI、水印或人物召回。
- 绿灯：真实失败图现REJECT；7张历史真实安全图继续PASS、含本图在内6张历史风险图继续REJECT，同批连续3次precision/recall=`1.000/1.000`。图片质量、条码、人物设备、generation-success、real-media、XHS高级交付、API/Web/Agent typecheck及`qa:fast/regression/full`含build、diff-check全部PASS；Provider/外网/grant0、费用¥0。
- 结束后删除临时media approval并用正式stop/start恢复`safe_default / controlled_mock / media disabled/max0`；source/runtime=`DAC42685…6E2C`、fresh、ready/database=true、Web200。
- v2.14修复后真实批次的报价预检先稳定复现`media_provider_blocked`：上层`BEAUTY_MEDIA_EXECUTION_MODE=real`已写入runtime，但底层`LANQI_MEDIA_EXECUTION_MODE`仍继承disabled。最小修复仅在受控启动校验与approval中要求底层Provider=`real`、asset storage=`local`；未改产品权限、账本或Provider实现。
- 新不可重放grant随后只创建第1个顺序任务。底图SHA短值`b2fd41ed…3133`、768×1024，已生成真实门店接待空间，但墙面清晰出现`BEAUTH / HOU-MEDICAL SKINCARE ...`伪英文招牌；safety-v2.14正确拒绝`qr_or_barcode_like / visible_text_or_brand_like`，第2/3任务未创建。Provider1、保守¥0.20、客户资产0；300积分一次预留后全额释放，无重试/补图/第4任务。
- 一次性grant/approval已删除，正式stop/start恢复`safe_default / controlled_mock / media disabled/max0`；source/runtime=`EC43DB1E…004C`、fresh、ready/database=true、Web200。
- prompt构图Champion：以真实失败底图`aadedfc9…e1f`、`b2fd41ed…3133`的脱敏SHA、角色、质量原因和v1.5三角色payload哈希固定红灯；证据证明旧prompt虽禁止文字，却仍给模型中央接待墙、正面品牌墙和展示区域等稳定招牌载体。
- 单变量Challenger：`beauty-image-provider-prompt-v1.6`只增加无招牌承载面构图——侧向机位、墙面由帘布/木格栅/绿植/阴影打断，显式排除中央品牌墙、招牌墙、海报/菜单/价目/展示板、台牌、屏幕和产品标签。封面/内容/互动业务语义、英文纯画面、3:4、safety-v2.14、composition-v1.1、账本与租户合同均未改变。
- 零费用绿灯：新增`beauty-industry:image-signage-carrier-prompt-p1-smoke`并纳入`qa:fast`；三角色payload均命中新约束、保持互异且不含中文，v1.5 Champion哈希均发生变化。图片生成、包装、互动、人物设备、高级交付、质量、real-media和同页专项PASS；API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`含build与`git diff --check`PASS。Provider/网络/grant0、费用¥0。
- prompt-v1.6真实验收的两次付费前红灯均没有外部调用：第一处为BY-40已把主题、项目/服务、目标顾客设为真正必填，而旧runner只填写主题；第二处为页面当前以“流程预览/正式发布内容”标示受控文字，旧runner仍只查找已移除的旧横幅。runner已按标签填写三项必填并兼容当前用户可见预览提示，没有绕过任何产品preflight。
- 新不可重放grant `by43-premium-delivery-live-20260901-once-15cfaef0e2a2`随后只创建第1个顺序任务。底图为768×1024完整暖色门店接待场景（窗帘、木格栅、绿植、前台、座椅），证明真实场景链已生效；但前台仍出现带细小伪文字/二维码样式的展示台牌，safety-v2.14正确以`qr_or_barcode_like`拒绝。第2/3任务未创建，客户资产0，300积分一次预留后全额释放，保守费用¥0.20，无重试/补图/第4任务。
- 展示台牌Champion：以该真实底图SHA `13211c9d…144b`、封面角色、`qr_or_barcode_like`和v1.6三角色payload哈希固化红灯，不保存Prompt、Provider响应或图片正文。v1.6虽在负向词中禁止`countertop sign`，但正向接待区/圆桌仍提供可放独立展示物的水平承载面。
- 单变量Challenger：`beauty-image-provider-prompt-v1.7`只新增`empty_horizontal_surface_composition`。封面从座椅、地面、帘布、木格栅和绿植组织完整空间，不出现前台柜台；角色确需桌面时整面必须空置且斜向拍摄，正负约束共同排除桌牌、立牌、展示牌、价目/菜单/传单、二维码收款牌、屏幕、设备、产品和包装。三角色差异、商业摄影、暖色光影材质、3:4、safety-v2.14、composition-v1.1、账本与租户均未改变。
- 零费用绿灯：新Champion/Challenger专项连续3次PASS；图片生成/包装/互动/高级交付/质量、real-media、persistence、URL、media-observability、XHS同页、用户路径与WorkBuddy专项PASS；API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`含build及`git diff --check`PASS。Provider/网络/grant0、费用¥0；无DOM/路由变化，未重复浏览器E2E。
- prompt-v1.7真实终验：新一次性grant `by43-premium-delivery-live-20260901-once-db1d9aa5c635`只创建第1个`wan2.7-image`顺序任务。底图SHA `2cf4738e…c205`、768×1024，为完整暖色门店咨询空间，包含帘布、木格栅、座椅、绿植和空置木桌；说明旧“文字+空白底图”问题不再成立。
- 新质量失败：人工只读未见文字、Logo、QR、水印、UI、人物或设备，但safety-v2.14在空白木格栅框`x=528,y=180,w=144,h=64`触发`qr_or_barcode_like / barcode_stripes`，confidence=0.98、decoded=false、edgeGroups=27、stripeScore=1、quietZoneScore=0.6、edgeGroupDensity=0.38、directionConsistency=1。自动门禁保持fail-closed，人工没有覆盖；第2/3张未提交。
- 本批审计：Provider任务1、技术成功1、质量通过0、客户资产0，保守费用¥0.20；300测试积分一次预留后全额释放，重试/repair/换模/补图/追加/第4任务及其他Provider均0。postflight、1440/390失败路径、刷新、重复确认、owner/跨租户、console0均PASS；调用后图片质量、real-media、persistence、URL、media-observability专项及`qa:fast`、`qa:regression`、`qa:full`含build、`git diff --check`全部PASS。
- 安全停点：一次性grant已消费不可重放，临时approval已删除；受控AcceptanceRoot经正式stop/start恢复`safe_default / controlled_mock / media disabled/max0`，source/runtime短指纹`28184266`一致且source_fresh=true、ready/database=true、Web200。
- QA-20260901-004 修复前红灯：同一真实安全底图`2cf4738e…c205`在v2.14稳定命中木格栅框；条纹间隔变化系数仅`0.232`。原检测只要求边缘密度、方向一致和弱静区，无法区分等距建筑格栅与真实编码条纹。
- 单变量Challenger：`beauty-image-safety-v2.15`仅给`barcode_stripes`增加条纹边缘间隔变化范围`0.35–0.62`。真实/合成QR为`0.619`、条码为`0.365`，继续REJECT；建筑木格栅`0.232`和房间其他非编码长边组合不再构成条码证据。无SHA/路径白名单，不改变文字、Logo、UI、水印、人物或设备硬门禁。
- 绿灯：专属同批12个安全样例、18个风险样例连续3轮precision/recall=`1.000/1.000`；全量图片精度集28个安全样例、58个风险样例同样为`1.000/1.000`。图片质量、generation-success、real-media零调用、persistence、URL、media-observability、XHS同页、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`含build与`git diff --check`全部PASS。Provider/网络/grant0、费用¥0。
- v2.15真实终验：新不可重放grant `by43-premium-delivery-live-20260901-once-191946a639b5`只创建第1个顺序任务。底图SHA `3d8fe077…84cd`、768×1024，为完整暖色门店咨询空间，包含落地帘布/窗框、木质格栅、座椅、绿植和空置木桌；人工只读未见文字、Logo、二维码、条码、水印、UI、人物、设备或包装。
- QA-20260901-005：safety-v2.15仍在`x=0,y=320,w=208,h=64`把左侧窗帘/窗框自然竖纹判为`qr_or_barcode_like / barcode_stripes`，`confidence=0.892`、`decoded=false`、edgeGroups=14、stripeScore=0.765、quietZone=1、density=0.136、directionConsistency=0.662、edgeIntervalVariation=0.451。该组合落在v2.15新增范围内，说明只靠条纹间隔变化不足以区分编码条纹与建筑/帘布纹理。自动门禁保持fail-closed，人工没有覆盖；第2/3张未提交。
- 本批审计：Provider任务1、技术成功1、质量通过0、客户资产0，保守费用¥0.20；300测试积分一次预留后全额释放，重试/repair/换模/补图/追加/第4任务及其他Provider均0。live postflight、1440/390失败路径、刷新、重复确认、owner/跨租户、console0均PASS。
- 调用后门禁：图片质量、generation-success、real-media零调用、persistence、URL、media-observability、XHS同页以及`qa:full`含build和`git diff --check`PASS。临时approval已删除，grant仅保留不可重放消费审计；AcceptanceRoot经正式stop/start恢复`safe_default / controlled_mock / media disabled/max0`，source/runtime短指纹`8DAAF013`一致、source_fresh=true、ready/database=true、Web200。
- QA-20260901-005修复前红灯：v2.15真实安全底图在同一窗口稳定命中，且新增诊断显示`minorQuietZone=0`、`edgePersistence=1`；自然帘布/窗框边缘贯穿整个窗口，没有编码标记常见的横向静区或终止边界。
- 首个Challenger仅提高最小edgeGroups到16，虽然让本图转绿，却令相邻伪文字/Logo风险样例漏检；该方案被拒绝且未进入正式版本，避免以降低安全召回换取precision。
- 最终单变量Challenger为`beauty-image-safety-v2.16`的`encodedStripeBoundaryEvidence`：条纹必须有足够横向静区或不能贯穿整段边界，同时保留低密度伪标记证据分支。没有SHA/路径白名单，QR、条码、文字/Logo、UI、水印、人物和设备门禁不变。
- 零费用绿灯：窗帘专项18安全/12风险、建筑条纹专项12安全/18风险全部正确；全量30安全/58风险连续3次precision/recall=`1.000/1.000`。图片质量、generation-success、real-media零调用、persistence、URL、media-observability、XHS同页、composition、API/Web/Agent typecheck、`qa:fast/regression/full`含build与`git diff --check`PASS；Provider/网络/grant0、费用¥0。
- 本轮无DOM/路由变化且明确不得刷新/启用媒体环境，因此未重复浏览器E2E；上一真实批次1440/390失败路径、刷新、幂等、跨租户与console0证据继续有效。当前source=`B13FB306`、runtime=`8DAAF013`、source_fresh=false；ready/database/Web正常但仍是`safe_default / controlled_mock / media disabled/max0`，不能冒充v2.16已上线。

## 交接

- 用户暂停停点（2026-09-01）：立即停止后续编码、测试、Provider调用、环境刷新和下一任务。当前没有active media grant或`.env.media-approval`，只保留历史已消费grant审计；media保持disabled/max0。source=`B13FB306`、旧runtime=`8DAAF013`、source_fresh=false原样保留，未删除、未回退、未覆盖工作树。恢复时不得跳过受控runtime刷新与真实3/3门禁。
- 残余风险：P0=0、产品P1=1。真实门店场景链已经成立，当前不是“文字+空白底图”；QA-20260901-005检测Bug已关闭，但v2.16尚未进入受控runtime，也没有新的3/3真实客户交付证据，图片功能保持disabled，不创建邀请、不对外宣称可验收。
- 后续任务：下一唯一恢复点为单独受控刷新当前源码并按既有精确预算边界执行一次新真实三图终验；本轮不得复用已消费grant、不得追加调用。只有3/3最终成品、账本、下载、刷新、租户和1440/390全部PASS才可创建验收邀请。
- 最后更新日期：2026-09-01
