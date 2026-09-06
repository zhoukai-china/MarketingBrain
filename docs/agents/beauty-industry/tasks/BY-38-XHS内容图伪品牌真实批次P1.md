# BY-38 XHS 内容图伪品牌真实批次 P1

状态：已完成（确定性品牌视觉交付已关闭产品 3/3 P1，范围内 P0/P1=0）

## 归属

- 产品：美业智能体（兰琪品牌验收实例，共用 beauty-industry 核心）
- 层级：产品任务含通用图片 Provider payload 子改动
- 风险：高（已执行一次获授权真实批次，禁止追加调用）
- 预计修改热点：XHS 三图 role→plan→Provider prompt、离线回归、受控浏览器恢复
- 是否允许并行：否

## 用户结果

目标是用户显式确认三图后，内容角色能稳定生成符合合同的单一摄影场景，不再把瓶罐包装、标签或拼贴版式带入客户交付；任何不合格批次继续整体失败关闭、退回积分且不会自动重试。当前真实证据尚未达到该结果。

## 本次范围

- 只读审计用户最新文字 Run、图片批次、技术/质量/落盘/合成状态、积分和 Provider 次数。
- 固化内容图伪品牌的脱敏 Champion，先零 Provider 修复内容角色构图合同。
- 保留正式文字/Logo/UI/水印/QR/人物门禁，不用人工覆盖自动门禁。

## 本次不做

- 不要求用户再次点击，不自动重试、补图、换模、追加或创建第4张。
- 零费用闭环前不创建真实 grant、不调用文本或媒体 Provider。
- 不恢复 BY-19/BY-20，不部署生产，不修改客户原始输入或历史资产。

## 验收条件

1. 正常路径：内容角色 Provider payload 明确避开任何包装、瓶罐、标签面和品牌承载物，封面/互动既有合同无无关变化。
2. 失败路径：真实伪文字/品牌图继续被安全合同拒绝；内容角色的拼贴版式明确拒绝，物体语义无法在本地可靠核验时进入人工复核且客户不可见，批次整体失败并一次释放300积分。
3. 不应发生：不得降低检测阈值、按SHA放行、自动重试或把部分成功冒充3/3。
4. 可观测结果：批次、任务、质量原因、版本、积分和 Provider 数均有脱敏证据；用户内容、Prompt、图片正文和密钥不写公共文档。

## 基线与失败证据

- 最新批次：脱敏 tenant/run/batch 指纹=`1b2973a52cb8/3d42d026eaa2/0fda39fbdb2c`，同批恰好创建3个任务记录、实际提交2个 Provider 任务。
- 封面：技术成功、safety-v2.12 PASS、composition-v1.1完成；内容：技术成功并原子落盘，但SHA `9f217ea5…bc2e1`命中`visible_text_or_brand_like`，肉眼只读确认瓶身存在伪品牌/乱码；互动未提交。
- 账本：300积分一次预留、一次等额释放，reservation released/actual0，净0；没有客户可用资产。
- 分类结论：不是Provider技术失败、检测误报、落盘/URL/页面恢复或账本状态机错误；是底图真实不合格，需修内容角色构图合同。
- 修复前红灯：`beauty-industry:image-content-packaging-p1-smoke` 稳定证明 prompt-v1.3 的内容角色仍允许包装、瓶罐、标签面和品牌承载物，未形成专属单场景合同。

## 实现记录

- `apps/api/src/products/beauty-industry/media-contract.ts`：新增 `beauty-image-provider-prompt-v1.4`；只收紧内容角色为无包装/无瓶罐/无容器/无标签面的中性材质单场景，封面与互动角色保持既有语义。
- `apps/api/src/routes/beauty-industry-media.ts`：正式图片链钉死 prompt-v1.4；既有 plan-v2、safety-v2.12、composition-v1.1、账本与租户合同不变。
- `apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`：修复历史/刷新/重新报价并发时旧 quote 响应覆盖当前任务的竞态；旧失败批次不能污染新文字任务或当前重生成报价。
- `scripts/beauty-industry-image-content-packaging-p1-smoke.ts` 与脱敏 fixture：固化 Champion/Challenger，断言内容角色不再携带包装语义，封面/互动无无关变化，未知/版本漂移失败关闭。
- `scripts/beauty-industry-xhs-image-live-acceptance.mjs` 与相邻 smoke：quote-only 真实 Chrome 按产品路径完成“修改本次图片要求→重新报价”，并拒绝历史批次、过期响应和重复确认。
- 数据/接口/配置变化：无数据库 Schema 变化；历史批次和不可变资产不重判、不覆盖；WorkBuddy 候选运行引用仍为 0。
- 兼容性和回滚点：prompt 版本独立；若回滚代码不得把旧 v1.3 用于新正式批次。

## 获授权真实批次（2026-08-30）

- 新的一次性不可重放 grant 固定 `aliyun_bailian/wan2.7-image`、plan-v2、prompt-v1.4、safety-v2.12、composition-v1.1；最多3个顺序任务、保守上限¥0.60、自动重试/repair/换模/补图/追加均为0。
- 实际 Provider 任务=2：封面底图与最终成品通过；内容底图技术成功但被 `qr_or_barcode_like` 拒绝，第三图未提交。批次=`quality_failed`，客户可用资产=0。
- 内容底图 SHA=`e9af2a0e…2a803`。自动证据为 `barcode_stripes`（仅脱敏几何/置信指标）；人工只读同时确认图片实际为三联拼贴且多处出现护肤品瓶罐，独立违反 prompt-v1.4 的无包装、单场景合同。因此不能因条码检测可能误报而放行该图，也不能把 prompt-only 视为成功率闭环。
- 账本：300测试积分一次预留、一次全额释放/补偿，settled=0、净额=0；保守外部费用¥0.40；文本/视频/ASR及其他 Provider=0。
- grant 已消费，不得复用；没有第三次或追加调用。

## 零 Provider post-generation 与条码精度闭环（2026-08-30）

- 修复前红灯一：同一内容底图在 safety-v2.12 仅凭自然竖线组合命中 `barcode_stripes`；脱敏 Champion 为 `edgeGroups=11`、`edgeGroupDensity=0.058`、`directionConsistency=1`、`quietZoneScore=0.967`、`decoded=false`。这只能证明旧条纹启发式误报，不能推翻图片另有三联拼贴的真实合同失败。
- 单变量 Challenger：safety-v2.13 只增加最小条纹边缘组密度 `0.080`，不改 QR finder、文字/Logo、UI/水印、人物或总 fail-closed。真实自然线条连续3次不再命中；三种确定性条码变体连续3轮共9/9仍拒绝，precision/recall=`1.000/1.000`。没有SHA/路径白名单。
- 修复前红灯二：正式链此前没有内容角色 post-generation 合同，因而三联拼贴即使绕过通用安全检测也可能进入合成。新增 `beauty-image-content-role-contract-v1` 并钉死到 job、route、live runner：可解释地拒绝多分区拼贴；内容图在通用安全通过后仍必须经过角色合同。
- 本地能力边界：仓库当前没有可重复、离线且经过正负样本验证的物体语义检测器，不能可靠区分“完整无包装场景”与“瓶罐/容器/标签/品牌承载物”。因此 `9f217ea5…bc2e1` 和真实安全场景都返回 `manual_review_required / content_semantics_unverified`，客户不可见。没有用人工目视冒充自动 PASS，也没有声称本地理解画面物体。
- 结果：该零费用原子修复关闭了条码误报与拼贴漏拦截，但尚不能证明三图一次成功率提高到可再次付费终验；本轮 Provider/网络/grant=0、费用¥0，不申请或执行重复真实批次。

## 验证

- 领域专项：内容包装红绿、XHS media retry、generation-success、engagement prompt、real-media、same-page image、image quality、persistence、URL policy、media observability 全部 PASS。
- 新增专项：`beauty-industry:image-barcode-stripes-p1-smoke`、`beauty-industry:image-content-role-contract-p1-smoke` PASS；完整图片精度集26安全/58风险、条码三轮子集均 precision/recall=`1.000/1.000`，Provider0。
- 类型与全仓：API/Web/Agent typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）全部 PASS；`git diff --check` 仅既有 CRLF 警告，无 whitespace error。
- 本轮无 DOM、路由或客户文案变化，且安全环境保持 media disabled/max0，未重复浏览器 E2E；既有页面失败态、刷新、租户和账本行为未改，后端角色合同由 route/real-media/persistence/XHS 专项覆盖。
- 零 Provider Chrome：1440/390px、刷新、历史、重新报价、owner/跨租户、重复确认、console0 全部 PASS；确认请求0、Provider0。
- 真实批次 Chrome/postflight：1440/390px、刷新、历史、重复确认、跨租户404、console0和账本语义 PASS；产品交付因内容底图不合格而 FAIL-CLOSED。
- 环境收口：正式 stop/start 后 PG55434、API3016/PID21472、Web5176/PID20636；source/runtime=`842B5645`、fresh/ready/database=true。profile=`safe_default`、text=`controlled_mock`、media=`disabled/max0`，不会再次产生费用。

## 交接

- 残余风险：P0=0、P1=1。三联拼贴已可自动阻断，条码误报已关闭；但包装/瓶罐/标签/品牌承载物的可靠本地语义核验尚无可验证实现，内容角色只能保持人工复核/客户不可见。当前不是用户验收入口，不创建邀请码。
- 下一唯一恢复点：本地物体语义可行性审计已经完成，当前离线资产不能形成可靠 Challenger。需由用户在“调整内容图视觉策略”与“另行授权明确的语义审核 Provider/本地模型专项”之间选择；决策前保持 `manual_review_required`、客户不可见，不再重复三图终验。
- 已停止/未运行：第三张真实图片未调用；没有新增文本、视频、ASR、部署或生产变更。
- 最后更新日期：2026-08-31。

## 本地物体语义可行性审计（2026-08-31，零网络）

### 修复前 Champion 与结论

- 新增 `beauty-industry:local-object-semantics-feasibility-smoke`，对同一批3个安全样本与3个风险样本连续运行3次：安全自动通过 `0/3`、风险确定性拒绝 `1/3`、其余 `5/6` 均为 `manual_review_required`。唯一能确定拒绝的是已有多分区拼贴；瓶罐/包装风险与完整安全场景都无法被当前本地合同可靠区分。
- 样本只保留 SHA、类别、状态、计数和聚合耗时。3个受控不可变资产不复制、不改写；2个安全合成样本由脚本确定性生成。没有保存客户图片字节、绝对客户路径、Prompt、Provider响应或凭据。
- 当前确定性合同实测约 `39.404–44.872ms/图`，单进程首轮 RSS 增量约 `20.156–48.516MiB`（受Node内存状态影响）。该数据仅反映现有像素/版式合同，语义模型不存在，所以不能据此估算不存在模型的启动、CPU或内存成本。

### 运行资产、许可证与资源边界

- 正式产品依赖只有 `@napi-rs/canvas@0.1.80`、`pngjs@5.0.0`、`qrcode@1.5.4`，均为 MIT；分别只能做确定性绘制、像素读取与QR夹具，不提供物体语义。
- 仓库及 lock 中没有 OpenCV、ONNX Runtime、Transformers、TensorFlow、Torch/TorchVision、Ultralytics 或 MediaPipe；仓库内 `.onnx/.pt/.pth/.safetensors/.tflite/.pb/.weights/.mlmodel/.ort` 语义模型资产数为0。
- Codex 工作区运行时虽有 `sharp@0.35.4`（Apache-2.0）和 `tesseract.js@7.0.0`（Apache-2.0），但它们不是产品依赖；前者只做图像变换，后者只做OCR且本地 traineddata 数为0，均不能提供包装/瓶罐语义。客户端运行时不能成为产品隐式依赖。
- Python 仅发现 `numpy@2.3.5` 与 `Pillow@12.3.0`；`cv2/onnxruntime/torch/torchvision/transformers/tensorflow/ultralytics/mediapipe/skimage` 均不可导入。缓存仅有不完整ASR/口型同步片段，无物体语义权重或本地许可证包。
- MIT/Apache-2.0 包许可证允许在履行通知义务后复用软件代码，但不自动授予模型权重、训练数据或品牌识别数据权利；当前又不存在相应模型及许可证，因此不能把“包许可证可用”误报为“语义模型可上线”。本记录是工程合规边界，不替代法律意见。

### 集成边界与未实施理由

- `beauty-image-content-role-contract-v1 → safety-v2.13 → composition-v1.1` 的输入、租户存储、版本钉死和失败状态保持不变；审计脚本只读取PNG字节并输出不可逆SHA、状态和原因标识，不增加上传、日志正文或跨租户缓存。
- 未新增依赖、未下载模型、未改产品运行代码，也未用更多几何启发式冒充物体理解。不存在可审计许可证、离线权重和正负样本表现的情况下，实施 Challenger 会违反“可靠区分完整场景与包装承载物”的验收条件。
- 结论为 `not_feasible_with_current_offline_assets`。P0=0、P1=1；QA-20260830-003继续打开。Provider/外网/grant=0、费用¥0，环境不刷新、无邀请码。

### 审计验证

- `pnpm.cmd beauty-industry:local-object-semantics-feasibility-smoke`：PASS，6例×3轮一致，`providerCalls=0/externalNetwork=0`。
- `pnpm.cmd beauty-industry:image-content-role-contract-p1-smoke`、`pnpm.cmd beauty-industry:image-barcode-stripes-p1-smoke`：PASS，已有拼贴/条码硬门禁未回退。首次漏传受控资产环境变量的命令入口失败不属于产品失败；补齐显式只读路径后同一脚本PASS。
- API/Web/Agent typecheck：PASS；`pnpm.cmd qa:full`：PASS，已包含 `qa:fast + qa:regression + build`；`git diff --check`：退出码0，仅报告仓库既有CRLF提示，无空白错误。
- 未运行浏览器E2E：本原子仅增加审计脚本、脱敏证据和文档，没有修改产品运行代码、DOM、路由、租户、账本或环境；既有页面仍保持manual-review失败关闭。

### 需要用户选择的最小方向

1. 推荐零持续费用方向：调整内容图视觉合同，改为确定性可控的抽象材质/水光/空间细节，或要求用户上传已授权实景图；继续本地合成与硬门禁。优点是隐私、本地、低延迟和无新增费用，代价是内容图不再追求自由生成的产品摄影物体语义。
2. 语义审核方向：另行授权明确的视觉审核 Provider，在每张底图生成后、客户可见前做包装/瓶罐/标签/多面板语义判定。需单独确认 Provider/模型、最多3张上传、调用次数、保存/删除边界和人民币硬上限；当前未授权，不得调用。
3. 本地模型专项：先批准外部候选研究、下载和许可证审查，再按候选模型实测启动时间、CPU/RAM、召回和部署包影响。当前没有可评估的权重，不能承诺性能或可商用性。

## 确定性品牌视觉最终闭环（2026-08-31）

- 产品决策：采用零持续外部费用的确定性品牌视觉。正式 XHS 文字 Skill 与三角色视觉计划不变；服务端依据租户品牌配置生成抽象材质、光影和空间细节底图，再以 Canvas 确定性合成已确认中文标题/短句。该能力不再把自由生成的产品摄影或瓶罐语义作为交付承诺。
- 修复前红灯：正式链不存在确定性视觉服务；controlled text 预览会把图片确认一并禁用；验收库尚未应用已提交的 `brandCode` 迁移；浏览器同步双击会发出两个确认请求。四项均有独立失败证据，未通过放宽安全门禁、伪造 Provider 成功或硬编码兰琪名称解决。
- 最小实现：新增 `beauty-deterministic-visual-v1`，固定 768×1024 三角色无字、无 Logo、无包装物底图；主题只接收服务端从 tenant/product 派生的通用品牌 token 和色阶。底图先经过既有 safety，再经 `beauty-image-composition-v1.1` 合成并原子持久化；无效版本、角色、尺寸、哈希、主题回执均失败关闭。
- 账本与幂等：一次显式确认创建唯一三图批次并预留 300 积分，3/3 完成后一次结算；双击只产生一个确认请求。外部图片 Provider 调用 0、外部费用 ¥0；历史 Provider job 仅按其记录版本只读恢复，不用新链重算。
- 品牌边界：beauty-industry 核心没有兰琪字符串、色值或知识硬编码；兰琪验收租户由品牌配置提供 `lanqi-orange` 色阶，默认租户仍独立运行，跨租户资产返回 404。WorkBuddy 候选运行引用为 0。
- 候选审查：采纳 `poster-wiring.md` 的后端编排、服务端持久化和 Canvas 中文合成思想；拒绝候选自建端点、720×960 尺寸、Markdown 图片拼接、静默 fallback、占位标题、Provider 依赖和任何运行时引用。
- 数据库：仅受控本地验收库按正式迁移流程应用既有 `202608270001_beauty_industry_brand_packages`，无清库、无破坏性迁移、无生产变更。
- 浏览器放行：真实 Chromium 1440px/390px 均 PASS；3 张 768×1024 最终 PNG 可预览和逐张下载，刷新/历史恢复、owner 访问、跨租户 404、双击幂等、console 0、external Provider 0。积分总变化为文字 8 + 图片 300，图片账本仅一笔 300 结算。
- 验收环境：PostgreSQL55434/PID19452、API3016/PID7128、Web5176/PID9496；source/runtime=`89E2FD86`、fresh/ready/database=true。环境保持 `safe_default / text=controlled_mock / media=disabled/max0`，其中 controlled text 明确是流程预览；确定性品牌视觉不依赖媒体 Provider 开关。停止方式仍为同一 AcceptanceRoot 的正式 `stop.ps1`，不得直接终止PID。
- 精确文件归属：通用核心为 `apps/api/src/services/beauty-deterministic-visual.ts`、`apps/api/src/products/beauty-industry/media-contract.ts`、`apps/api/src/services/beauty-media-assets.ts`、`apps/api/src/routes/beauty-industry-media.ts`、XHS 通用页面与两份验收脚本；兰琪只通过既有品牌配置提供主题值，没有复制页面、Skill、路由、账本或存储逻辑。
- 测试：确定性视觉、图片 URL、generation-success、composition、XHS 同页、real-media、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）和浏览器 E2E 全部 PASS；Provider/网络费用 ¥0。
- 收口：QA-20260830-003 由产品视觉合同调整关闭；新增 QA-20260831-001 固化“验收图片不得依赖一次性 Provider grant、未知能力不得落旧 fallback”的回归。BY-38 范围 P0=0、P1=0；BY-19/BY-20 继续 PAUSED，不部署生产。

### 最终用户验收环境（2026-08-31）

- 正式受控 start 仅启用已配置 `deepseek-v4-pro`，图片仍走确定性本地交付；media Provider=`disabled/max0`，不会因页面打开或文字生成自动调用图片 Provider。
- Chromium 1440/390px 只读 smoke 验证真实文案提示、填写任务后文字按钮、三图300积分确认入口和console0；生成请求0、Provider0、费用¥0。启动后数据库新增 AgentRun/媒体任务/积分流水均为0。
- 在线身份：PG55434/PID19452、API3016/PID14860、Web5176/PID9496，source/runtime=`89E2FD86`且fresh，ready/database=true。本机验收不需要邀请码。
