# 美业智能体测试矩阵

## BY54 Seedance持久执行（2026-09-05，默认关闭）

- 红灯：缺持久factory断言FAIL；新增token cap fixture证明108001 completion、费用尚低于许可时旧Challenger错误charged，`logs/token-cap-red.log`保留。最小修复将独立token上限置于下载前，超限退款且无下载；历史下载重新核验最新素材审核。
- `beauty-industry:seedance-execution-smoke`三轮PASS（每轮注入POST10/GET8/download4，外部0）。覆盖签名/默认关闭/local_only不可云用/跨账号/余额/entitlement/参数注入、同key并发、缺usage/迟到/超token、HTTP429/退避/耗尽、无效MP4临时文件清理、POST响应丢失及观察DB故障不重发、积分/permit/usage事务回滚、落盘后finish故障lease恢复不重复下载、最新撤销/owner与跨tenant/user/store、安全日志。
- 独立PG同批三轮PASS，每轮三OS进程争抢仅一个额外注入POST；合计每轮11个合成POST（父进程10+worker1），并非真实云请求。root=`F:/思潼AI增长os/test-environments/by54-offline-a15b4321c8794337bfc9f9ebe6f5dc59`，PG55454/PID25812已停止。测试HTTP为专用Fastify inject边界，不是公开生产route或Chrome。最后补61s未覆盖ffprobe的租约红灯，改120s并三轮复跑，详见persist-lease-red.log。
- `pnpm.cmd qa:full`含新专项、BY53、原wan/BY45–51/权限/账本/用量/OSS/品牌/WorkBuddy及全仓API/Web/Agent/Shared等typecheck/build；`git diff --check`PASS。最终日志`F:/思潼AI增长os/test-environments/by54-evidence-20260905/logs/qa-full-final.log`，之前qa-full.log亦exit0。无DOM/公开路由变化，不重复桌面/390px，不读真实key、不访问云、不注册入口、不造商业报价。默认disabled、真实授权/视频质量/云TLS均未验，不冒称全部产品放行。

## BY53 Seedance协议层（2026-09-05，默认关闭）

- 缺专属adapter红灯（`logs/red.log`）后新增独立Schema/submit/get/usage，不改wan；`beauty-industry:seedance-adapter-smoke`连续三轮PASS，global fetch禁止，Provider/外网/费用0。覆盖字段/格式/视频音频时长、审核授权/跨tenant/user/store/撤销/expiry/version/account、POST并发/无id/超时/中断不可重放、GET状态/ID/model/URL/重定向/429/5xx/Retry-After/20次/1小时/lease恢复、signed URL脱敏、BY51 completion/total/cache/缺usage与估算不等于账单。
- `pnpm.cmd qa:full` exit0，含qa:fast/regression、新专项、API/Web/Agent/Shared等typecheck/build；相邻wan/权限/账本/计量/OSS/MCP不退化，diff PASS。证据根`F:/思潼AI增长os/test-environments/by53-offline-20260905/logs`。测试只在合成事务port，没有PG或真实网络；不是产品HTTP/E2E/视频质量实测。不改DOM/路由、不启已停环境，因此不重复桌面/390px浏览器；旧`seedance_creative`公开入口仍拒绝。范围P0/P1=0，真实接线默认disabled。

## Seedance路线官方核验（2026-09-05，仅文档）

官方API浏览器展开读取PASS（此前web抽取JS壳不当参数）；2.0型号/多参考字段/肖像asset流程/价格/查询时效有直接证据，当前账号和实际质量未验证，Provider0/费用0。详见SEEDANCE_ROUTE_REVIEW。无代码/页面变化，不运行新qa/typecheck/E2E、不启动已停环境；仅链接/可读/diff校验，不把BY52门禁当新模型实测。

## BY52 我的AI品牌与已开通入口（2026-09-05，本地完成）

- 红：独立PG+HTTP+Chrome默认/兰琪/其他/无权/过期/旧lanqi授权六身份，20项失败；旧私有API无权403/有权200，问题为目录显示，非已证实数据泄露。
- 绿：`scripts/owned-product-directory-smoke.ts`三轮；品牌包/导航/branding专项PASS。最终`reports/release-final-1788592949330/evidence.json`六身份×1440/390×三轮PASS，console0/Provider0/AgentRun0/CreditTransaction0。Shell返回、apiBase、刷新/后退、空/加载/503/未知余额、品牌伪造/权限撤销/旧入口和截图对比度已验。
- `pnpm.cmd qa:full`最终`logs/qa-full-release.log`exit0，含qa:fast/regression/API/Web/Agent/Shared等typecheck/build；`git diff --check`PASS。证据根`F:/思潼AI增长os/test-environments/by52-directory-20260905`。中止release浏览器由测试context关闭竞态导致，不计PASS；修复后最终三轮通过。
- 本轮独立Chrome，不借用个人会话；正式身份stop后PG/API/Web/Chrome退出，审计DB保留。未测生产、付费生成，不创建邀请，暂停功能不放行。残余P0/P1=0（本范围），既有P2及清理限制见BY52。

## BY51 用量审计与定价隔离（2026-09-05，本地完成）

- `beauty-industry:usage-metering-smoke`及`video-execution-smoke`正式HTTP新增红→绿；每call immutable start/observation，缺usage/断流模拟/迟到/冲突、重复/跨租户/店/用户、多模型token/image/video_second和缓存分桶/价格/币种，费用null不等于0、无计量积分写入。
- 独立PG三轮/三进程追加竞争、重建恢复、真实transaction审计故障注入、原视频一次结算/失败释放/迟到不追扣PASS。最终root`by51-offline-275f0c542fc9499fbb7f3d6033394dc7`：PG55451/PID25160已停止；每轮合成submit8/poll4/download3/storage177、真实Provider0、费用0。无新schema/迁移/第二账本。
- 最终`qa:full`（qa-full-release.log）exit0，包含fast/regression/API/Web/Shared/Agent typecheck/build；`git diff --check`PASS。相邻BY45–50/WorkBuddy/品牌/媒体/XHS离线回归保留；暂停模块未恢复业务。完整命令/文件hash/PG及过程失败纠偏见BY51。
- 无DOM/公开路由或客户页面变更，不重复Chrome/1440/390，不冒称UI或真实Provider成功；token/image仅离线合同、尚未迁移真实流式入口。正式同WindowsPowerShell5.1 source/runtime=`E12B1C24…153CCA7`一致；PowerShell7组合hash不同作为P2记录，不混用口径。

## BY50后续前置核查（仅文档）

2026-09-05读取官方模型/API/OSS计费/权限文档，复核代码字节/次数/超时边界；确认3秒std¥1.80及有条件存储估算，记录北京动态价格、非生产资源、素材许可未核实与云账单非绝对封顶。仅更新VIDEO_CONTROLLED_EXECUTION/STATUS/BY50卡/tasks README/本节；验证路径、官方链接可读与diff-check。无源码/DOM变化，不重跑qa:full/浏览器/数据库或真实业务网络；原BY50全绿证据不冒充本轮新执行。没有Provider/grant/费用/邀请。

## BY-50 受控执行/预算/恢复（2026-09-05）

- 红灯：正式route无受控执行组装；真实handler中断提交恢复退款后仍遗留2暂存对象（期望0）。修复后终态早返回也释放lease，清理错误仍可恢复，不谎报云取消。
- `pnpm.cmd beauty-industry:video-execution-smoke`：三轮正式Fastify注入/实际SDK和Provider适配器注入/ffprobe原子MP4/权限/账本PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/beauty-industry/video-foundation-db.ps1 -Suite BY50 -Port 55450`：独立PG三轮PASS，每轮合成submit8/poll4/download3/storage159、真实Provider/外网0/费用0，净测试积分200来自两条成功任务（不是商业报价）。
- 覆盖HMAC篡改/版本/过期/撤销、body覆盖拒绝、余额不足云前拒绝、跨user/store/tenant、双handler/三独立进程抢claim、持久计数耗尽、未知提交不重发、DB更新和finish失败恢复、结果格式失败、删除失败sweep、已撤权清理保留额度、queued取消、迁移新增表/保留记录回退；历史不能选别的permit。每次云请求前先持久消费，退款不重置次数。
- 最终`pnpm.cmd qa:full`exit0，包含qa:fast、qa:regression、API/Web/Shared/Agent typecheck和build；相邻BY45–49、XHS/WorkBuddy/品牌/租户/媒体观测由回归覆盖。`git diff --check`通过后收口。日志见BY50卡。无DOM/URL/UI变更，不重复1440/390 Chrome，不冒称真实OSS/Provider/页面E2E；无实际云定价/凭据验收。

## BY-49 私有OSS暂存SDK与正式接线（2026-09-05）

- 红灯：driver/配置组装缺失；stage后未建job撤权仍留2对象；合法STS.被正则误拒。后两者分别先自动FAIL后最小修复，不绕过业务/云权限。
- `beauty-industry:video-oss-staging-smoke`同批3轮PASS，每轮124次注入SDK请求/2次合成执行handoff，云端/Provider0、积分净0。官方V4 header/GET签名、private/MD5/AES/forbid-overwrite/hash绑定、精确host/path/expiry、STS/debug/预算/缺配置/缺execution、DNS纯校验、302/307/403/429/5xx、部分PUT失败清理、delete失败恢复、过期/revoke/no-job lease、幂等/重建handler/未知终态、跨tenant/user/store与body注入、安全日志全部覆盖。
- 最终qa:full exit0（fast/regression/全仓API/Web/Shared/Agent typecheck/build），含BY45/46/47/48与相邻WorkBuddy/品牌/路由回归；diff-check0。Schema hash与BY46不变；新增JSON array_contains只在事务fixture验收，真实PG/OSS/DNS/TLS/视频未跑，不假报云端成功。
- 无DOM/路由URL变化，不重复1440/390Chrome；不启动环境/创建邀请。正式route默认disabled、maxCostFen0/无execution。真实业务外网/费用0（仅官方文档/SDK/包元数据读取）；精确日志、hash、配置与下一接线边界见BY49及VIDEO_PRIVATE_OSS_STAGING。

## BY-48 临时Word创建者隔离（2026-09-05）

- 红灯：owner生成、同租户另一user下载200且DOCX返回；本轮合成membership，不读取客户内容。
- `export:owner-isolation-smoke`三轮PASS：合法签名owner生成/下载；匿名/伪造header/无效过期token401且DB0；同租户非owner404、跨租户403、spoof不覆盖token；撤权403/DB故障503不泄密且恢复后可下载；并发GET恰好200+404，消费后/10分钟过期404，空输入400、中文文件名与私有no-store。
- `branding:smoke`、`delivery:smoke`及`qa:full`（fast/regression/全仓typecheck/build）PASS；diff-check0。测试走真实handler/session/context resolver，只有membership存储合成，不冒称真实PG/浏览器。
- DOCX 11473bytes、SHA=`63BC29AB…A16156`在WPS100%实际查看1/1页中文/表格/页眉页脚无截断，关闭hash不变。`render_docx.py`缺soffice失败已记录；没有修改版式，未覆盖全部长表分页。没有DOM变化/新UI故未跑1440/390Chrome，无API/Web/PG环境刷新或邀请。详见BY-48。

## 清单E 多客户端同源审计（2026-09-05，非新增业务卡）

- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-video-multiclient-audit.ts` PASS：两独立handler+重建handler/共享事务fixture，三轮不可变声明与409/400冲突、撤销版本、旧状态/旧updatedAt租约拒绝、等额退款一次、断开实例后最新GET、成员/产品撤销、跨用户/店/租户、DB故障503不伪称成功。
- 没有新P1红灯或生产源码修改；未运行PG/真实手机/390px/推送SLA，不把API inject或重建内存handler称为真实浏览器/DB进程恢复。`pnpm.cmd qa:full`（实际fast/regression/typecheck/build）与diff-check全部exit0。
- 完整事实/待定义/外部前置矩阵：[MULTI_CLIENT_ENTITY_AUDIT.md](MULTI_CLIENT_ENTITY_AUDIT.md)。Provider/客户/费用0，XHS等暂停不变。

## BY-47 共享ASR准入（2026-09-05）

| 项目 | 结果与边界 |
|---|---|
| 红灯 | 匿名WAV，配置合成key，正式Fastify handler注入200/拦截transport1；真实网络0 |
| 绿灯3轮 | 共31次缺授权拒绝；伪Bearer/tenant/store/file/approval、音频扩展与MIME错配、损坏video、伪长时metadata、frame附带、4并发重放均503，不转码/不外发 |
| 文件边界 | 不支持格式415，测试multipart上限超出413；不是声明已完成受权音频内容/时长检验 |
| 相邻解析 | CSV、TXT、XLSX共9次200，真实字段存在、transcript不存在、providerTrace为空 |
| 观测 | 仅event/stage/code/providerCalls与框架reqId等；正文/凭据/客户字段不进入自定义日志；usage/任务/积分没有启动 |
| 既有合同 | 元数据预检/手工转写、美业视频数据/内容workflow及媒体失败/取消/超时相邻专项PASS；不是受权真实ASR成功证明 |
| 全量 | qa:full exit0（实际包含qa:fast、API/Web/Agent/Shared等typecheck、qa:regression与build）；diff-check exit0 |
| 未运行 | 无DOM变化，无正式美业ASR页面/保存任务、未开数据库或浏览器；不把inject当桌面/390px PASS，不测试真实客户/外部Provider |

专项：`pnpm.cmd beauty-industry:asr-admission-smoke`（已纳入qa:regression）。证据根见BY-47卡。

## BY-46 持久授权与私有暂存（2026-09-05）

| 验收 | 结果/边界 |
|---|---|
| 初始红灯 | 缺持久授权模块/Schema；后续集成红灯为同租户其他用户任务使history返回404 |
| 声明/权限 | 角色、本人文件、服务端store、entitlement、同hash不可变角色、strict tenant/store/version/rights注入、expiry/revoke/hash变化均PASS；声明不等于法律核验 |
| 文件读取 | 私有目录/实测bytes/hash、伪MIME、错误尺寸、越界与依据篡改拒绝；捕获bytes后ffprobe/本地图像解码PASS |
| 暂存 | 先持久lease、local签名/精确对象/TTL、错签名404、撤销失效、过期与清理失败恢复、local→real错组装拒绝；不表示真实云端PASS |
| HTTP/DB/时序 | Fastify正式handler注入 + 实际loopback私有服务HTTP15次；内存与独立PG各3轮，提交前撤权、重复确认/清理后幂等、跨用户/店/租户下载、有效历史恢复PASS |
| 账本 | 每轮合成1000→900；settled1/released2，失败等额释放一次；外部已提交合成状态撤销后unknown而非伪称取消/退款 |
| Schema | 新空合成库应用新增迁移PASS；已有声明记录后rename/计数/还原表名数据保留PASS；无生产迁移/旧版部署回滚 |
| 全仓 | API/Web/Agent等typecheck、qa:fast、qa:regression、qa:full（含build）、diff-check PASS；BY45/BY46已纳入regression |
| 未运行 | Provider/真实客户/云端存储/外网业务0、费用0；无DOM变更，无桌面/390px实际页面PASS，不绕过先前原型file URL拒绝 |

命令：`pnpm.cmd beauty-industry:video-material-authorization-smoke`；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/beauty-industry/video-foundation-db.ps1 -Suite BY46 -Port 55446`。最终独立PG root=`F:/思潼AI增长os/test-environments/by46-offline-15ee41e6563e402491854932191c73ba`，55446/PID23856已停止；完整qa/红绿日志另根见BY-46卡。未开放业务，不新建邀请。

## BY-45 授权素材视频底层（2026-09-05）

| 验收 | 结果/证据 |
|---|---|
| 协议红灯→绿灯 | 旧模型/字段builder失败；固定wan2.2-animate-mix、异步header、精确task ID与results.video_url通过 |
| 输入/授权/预算 | strict身份注入、不支持背景/台词/字幕、KOL/老板角色、跨租户门店、到期/rights、类型/尺寸/时长/人民币不足、staging不安全均拒绝 |
| HTTP与事务 | Fastify真实handler注入+独立PG；3轮并发确认、刷新、失败/未知、部分持久化失败、轮询恢复、单预留/结算/等额释放PASS |
| 成片 | 本地合成2秒240×320 H264 MP4，经ffprobe/原子保存/hash；owner下载相同bytes、跨租户404；失败不可下载 |
| 零费用边界 | 全局外部fetch陷阱，注入仅合成transport，external/provider=0，费用0 |
| 全仓 | qa:fast/qa:regression/qa:full含build及diff-check全部PASS |
| 未运行 | 真实视频Provider/staging/肖像素材0；原型浏览器无连接且file URL被策略拒绝，未绕过；无DOM改动、桌面/390未放行 |

命令：`pnpm.cmd beauty-industry:video-foundation-smoke`；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/beauty-industry/video-foundation-db.ps1`。独立PG55445/PID15840已按runtime/命令/监听身份安全停止；证据根见BY-45卡。

## BY-44 WorkBuddy OAuth 2.1 + PKCE 隔离 PoC（2026-09-03）

| 验收项 | 状态 | 证据 |
|---|---|---|
| 修复前红灯 | PASS | 专项稳定失败为缺少 `workbuddy-oauth-poc` 模块；原静态 Bearer 全工具路由不能冒充 OAuth 主链 |
| 公共客户端与 PKCE | PASS | 动态注册不返回 secret；授权码一次性、S256 verifier、精确 redirect/state、短 access/refresh rotation/revoke |
| claims 与身份 | PASS | 校验 iss/aud/sub/exp/nbf/iat/scope/jti/client_id/azp；每次 tools/call 重新解析思潼用户、租户、产品、brand 与资源归属 |
| 客户端身份注入 | PASS | query/header/body/MCP context 自报 tenant/user/product 均400+审计；无效token优先401；跨租户404早于scope403 |
| 单工具与只读 | PASS | tools/list只有 `lanqi.get_profile_summary`；未知工具403；响应无tenant/user/product/手机号/raw画像 |
| 审计/usage/账本 | PASS | 审计失败503 fail-closed；usage独立、billable=false、creditDelta=0；重放不重复usage |
| 幂等与韧性 | PASS | 同jti/tool/requestId同输入复用；冲突输入409；撤销/过期401；限流429；超时/取消504 |
| 稳定性/性能 | PASS | 30顺序、10并发；多次P95 0.346–1.399ms、最大1.941ms；高风险样例连续3轮一致 |
| 外部调用/费用 | PASS | WorkBuddy后端、模型、媒体、数据库写入均0；费用¥0 |
| 全仓门禁 | PASS | 专项、API/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`含build、`git diff --check`均通过 |
| WorkBuddy真实E2E | BLOCKED | 未有开发者后台测试Connector、公开非生产HTTPS OAuth/MCP地址和真实登录回调；不得宣称技术层完整通过 |
| 页面1440/390 | NOT RUN | 本任务没有产品页面/DOM变更；外部WorkBuddy浏览器E2E需上述前置条件，不能用本地inject伪造 |
| 当前本机入口 | BLOCKED | 3016/5176只读探测均离线；本任务不负责启动XHS环境，也未创建邀请 |


## BY-43 / QA-20260901-005 窗帘与窗框竖纹条码误报（2026-09-01，检测子范围已关闭）

| 验收项 | 状态 | 证据 |
|---|---|---|
| 真实链身份 | PASS | source/runtime短指纹`8DAAF013`一致，source_fresh=true，ready/database=true；固定plan-v2/prompt-v1.7/safety-v2.15/composition-v1.1 |
| 顺序调用与成本 | PASS | 仅第1个`wan2.7-image`任务，技术成功1；第2/3张未提交，无重试/换模/补图/第4任务；保守¥0.20 |
| 真实场景质量 | PASS（人工只读） | SHA`3d8fe077…84cd`为768×1024完整暖色门店咨询空间，含帘布/窗框、木格栅、座椅、绿植和空置木桌；不是空白底图 |
| 自动质量门禁 | FAIL-CLOSED | 左侧窗帘/窗框自然竖纹被`barcode_stripes`拒绝；decoded=false、edgeGroups14、intervalVariation0.451、confidence0.892；人工未覆盖 |
| 客户资产与账本 | PASS（失败语义） | customerUsable=0、下载0；300积分一次预留后全额释放，净0；唯一批次不可重放 |
| 页面失败路径 | PASS | 1440/390、刷新、重复确认、owner/跨租户、console0均PASS |
| 回归门禁 | PASS | 图片质量/generation-success/real-media/persistence/URL/media-observability/XHS同页与`qa:full`含build、diff-check通过 |
| 产品放行 | BLOCKED | P0=0、P1=1；media disabled/max0，不创建邀请；下一步仅零Provider联合证据精度修复 |
| 修复前稳定红灯 | PASS | v2.15真实安全底图连续命中：edgeGroups14、density0.136、intervalVariation0.451、minorQuietZone0、edgePersistence1 |
| 拒绝的首个Challenger | PASS（未合入） | 单纯把edgeGroups提高到16会使相邻伪文字/Logo风险样例漏检；没有以降低风险召回换取安全图通过 |
| v2.16单变量 | PASS | 仅新增`encodedStripeBoundaryEvidence`，要求足够横向静区或非整段贯穿；保留低密度伪标记分支，无SHA/路径白名单 |
| 窗帘专项精度 | PASS | 18个安全/12个风险全部正确；Provider/网络0 |
| 建筑条纹专项精度 | PASS | 12个安全/18个风险全部正确；相邻伪文字、QR、条码、UI/水印继续拒绝 |
| 全量精度连续3次 | PASS | 每轮30个安全/58个风险，precision/recall=`1.000/1.000` |
| 零Provider仓库门禁 | PASS | 图片/XHS/composition/persistence/URL/观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`含build、diff-check |
| 页面E2E | NOT RUN | 本轮无DOM/路由变化，且按边界不刷新/启用媒体环境；沿用上一真实批次1440/390失败路径证据 |
| 当前环境身份 | BLOCKED | source=`B13FB306`、runtime=`8DAAF013`、source_fresh=false；ready/database/Web正常但仍为safe_default/controlled_mock/media disabled/max0 |
| 最新产品放行 | BLOCKED | 检测Bug已关闭，仍缺v2.16新runtime及真实三图3/3；P0=0、产品P1=1，不创建邀请 |

## BY-43 / QA-20260901-004 木格栅条码误报（2026-09-01，检测子范围已关闭）

| 场景 | 结果 | 证据 |
|---|---|---|
| prompt-v1.7真实场景 | PASS | 第1张768×1024为暖色咨询空间，含帘布、木格栅、座椅、绿植和空置木桌；不是几何/空白底图 |
| 自动质量门禁 | FAIL-CLOSED | safety-v2.14以`qr_or_barcode_like / barcode_stripes`拒绝；人工只读未覆盖自动结果，第2/3张未提交 |
| 脱敏检测证据 | RED | SHA `2cf4738e…c205`；bbox=`528,180,144,64`落在空白竖向木格栅；decoded=false、edgeGroups=27、stripeScore=1、quietZone=0.6、density=0.38、directionConsistency=1 |
| 调用与费用 | PASS | Provider1、技术成功1、客户可用0、保守¥0.20；重试/补图/第4任务/其他Provider0 |
| 账本与幂等 | PASS | 300测试积分一次预留、一次全额释放，净额0；唯一run/batch，未保存客户资产 |
| 页面失败路径 | PASS | runner覆盖1440/390、刷新、重复确认、owner/跨租户、console0；失败批次不提供下载 |
| 安全撤权 | PASS | grant已消费不可重放，approval删除；环境恢复fresh的safe_default、controlled_mock、media disabled/max0 |
| 原失败批次 | FAIL-CLOSED | P1当时阻断；该批grant已消费且不可追加，保持客户资产0和积分全额释放 |
| v2.15单变量 | PASS | `barcode_stripes`新增edge interval variation范围`0.35–0.62`；木格栅`0.232`放行，QR`0.619`/条码`0.365`仍拒绝；无SHA/路径白名单 |
| 专属精度 | PASS | 12个安全/18个风险样例连续3轮precision/recall=`1.000/1.000`，Provider/网络0 |
| 全量精度 | PASS | 28个安全/58个风险样例precision/recall=`1.000/1.000`；全部历史硬风险继续REJECT |
| 仓库门禁 | PASS | 图片/XHS/持久化/URL/观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`含build、diff-check |
| 产品放行 | BLOCKED | 检测P1已关闭；尚缺v2.15修复后新单批3/3真实客户可用证据，media disabled/max0，不创建邀请 |

## BY-43 / QA-20260901-003 XHS高级感真实图片链（2026-09-01，P1 OPEN）

| 场景 | 结果 | 证据 |
|---|---|---|
| 几何底图质量红灯 | PASS | BY-41确定性场景可辨识但缺商业摄影光影/材质/空间层次，撤回客户质量放行 |
| active chain | PASS | 新批次固定`real_provider_composed / wan2.7-image / prompt-v1.7 / safety-v2.14 / composition-v1.1`，历史deterministic只读 |
| 必填提示 | PASS | 主题、项目、目标顾客缺失时Web逐项提示且API/WorkBuddy在Provider/积分前422；其他任务字段选填 |
| 预算精度 | PASS | 整数分计价，3张精确¥0.60；1440/390 quote按钮可用，旧浮点越界红灯关闭 |
| 唯一真实批次 | FAIL-CLOSED | 第1张技术成功；伪英文、Logo、人像/QR样式桌牌、包装文字被人工拒绝，自动safety-v2.13曾passed；第2/3未提交 |
| 调用/账本 | PASS | Provider任务1、保守¥0.20、客户资产0；300积分一次预留一次全额释放，重试/补图/第4任务0 |
| 漏检红灯 | PASS | 真实底图短SHA `aadedfc9…e1f`在v2.13稳定错误PASS；中段伪英文由现有顶部文字带和碎片化glyph候选共同漏掉 |
| safety-v2.14 | PASS | 仅新增中部双行对齐高密度展示文字联合证据；真实失败图REJECT，7张真实安全图PASS、6张风险图REJECT，连续3次precision/recall=`1.000/1.000` |
| v2.14真实批次 | FAIL-CLOSED | 报价预检先发现底层`LANQI_MEDIA_EXECUTION_MODE`未随上层real启用并补启动硬校验；放行后仅第1张技术成功，真实门店接待场景墙面含清晰伪英文，v2.14正确拒绝并停止第2/3张 |
| v2.14调用/账本 | PASS | Provider任务1、保守¥0.20、客户资产0；300积分一次预留一次全额释放，重试/补图/第4任务0；approval/grant删除后media disabled/max0 |
| prompt-v1.5构图红灯 | PASS | 两张真实失败图均为封面角色；旧三角色payload虽禁止文字，却继续保留正面中央接待墙/展示面，构成稳定招牌载体；Champion保存不可逆SHA、质量原因和payload哈希 |
| prompt-v1.6单变量 | PASS | 三角色统一采用侧向机位、打断式材质墙并排除中央品牌墙、招牌墙、海报框、价目牌、展示板、台牌、屏幕和产品标签；角色差异、英文纯画面、3:4、safety-v2.14均不变 |
| prompt-v1.6验收路径 | PASS | 付费前稳定发现旧runner没有填写BY-40新增的项目/目标顾客必填项，并仍查找旧测试横幅；修正后同一Web路径可进入报价/确认，Provider0、积分0 |
| prompt-v1.6真实批次 | FAIL-CLOSED | 第1张768×1024为完整暖色门店接待场景，但前台含细小伪文字/二维码样式展示台牌，safety-v2.14以`qr_or_barcode_like`拒绝；第2/3未创建，客户资产0 |
| prompt-v1.6调用/账本 | PASS | Provider1、保守¥0.20；300积分一次预留后全额释放，重试/补图/第4任务0；grant消费、approval删除，环境恢复media disabled/max0 |
| prompt-v1.6桌牌红灯 | PASS | 真实底图SHA `13211c9d…144b`为完整暖色门店空间，但接待台独立展示牌含伪文字/二维码样式；v1.6只有负向物件禁令，正向接待区/圆桌仍提供承载面 |
| prompt-v1.7单变量 | PASS | `empty_horizontal_surface_composition`仅把封面改为无前台柜台的侧向空间构图，并要求角色必需桌面完全空置；显式排除桌牌、立牌、菜单/传单、二维码收款牌、设备、产品与包装，三角色完整商业摄影及safety-v2.14不变 |
| prompt-v1.7稳定性 | PASS | 同一Champion/Challenger连续3次PASS，三角色payload互异、英文纯画面、3:4、非几何/非空白；Provider/网络/grant0、费用¥0 |
| 零费用门禁 | PASS | 高级感/XHS/图片/账本/租户专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check通过，Provider0/费用¥0 |
| 用户验收 | BLOCKED | P1=1；零Provider prompt-v1.7已闭环但尚无修复后3/3客户合格图，不能把质量拒绝图或旧空白底图交给用户；媒体保持disabled/max0 |

## BY-41 / QA-20260901-002 XHS通用美业门店场景（2026-09-01，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 抽象底图红灯 | PASS | v1仅有soft light/material flow/spatial ripple；真实三图无接待、护理或承接空间元素 |
| 三角色场景 | PASS | v2新批次分别为接待咨询区、护理空间、到店承接空间，3张768×1024最终PNG，元素计数与哈希入回执 |
| 非本店实景声明 | PASS | 页面明确通用场景、非本店实景、默认不含人物；客户区不显示Provider/模型/Prompt |
| 未授权要求 | PASS | 本店还原+人物请求confirm=422，job0、积分不变，发生在任务创建/预留之前 |
| 交付与幂等 | PASS | 3/3、逐图下载、刷新/历史、双击单confirm、300积分单次结算，Provider0/费用¥0 |
| 用户可测余额 | PASS | 合成验收租户正式幂等grant 308测试积分，页面余额500；不是人民币充值或Provider费用 |
| 租户/品牌 | PASS | owner可读、跨租户404；主题只取tenant brand config，默认核心无兰琪硬编码，候选引用0 |
| 桌面/移动 | PASS | 真实Chromium新批次1440/390px、overflow0、console/网络0 |
| 全量门禁 | PASS | 场景/图片/XHS/观测专项、API/Web/Agent typecheck、qa:fast/regression/full含build、diff-check |

## BY-42 / QA-20260901-001 本机免邀请码入口重启恢复（2026-09-01，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 环境红灯 | PASS | 55434/3016/5176均无listener，ready/Web connection refused；旧runtime指纹存在但PID/listener不匹配，禁止事后认领 |
| 受控恢复 | PASS | 仅正式AcceptanceRoot start恢复；PG14652/API1484/Web6116，绝对命令与当前仓库/pgdata一致 |
| 运行身份 | PASS | source/runtime=`5C879173…72EB`、source_fresh=true、PID/listener一致、ready ok/database=true、Web200 |
| 无会话/失效会话 | PASS | 真实Chromium两种状态均进入本机开通并返回原XHS深链，apiBase不丢失 |
| 桌面/移动/历史 | PASS | 1440/390px、刷新/返回、主内容与生成按钮、overflow0；双租户不共享会话 |
| 控制台/副作用 | PASS | 新鲜页面console warn/error0、关键网络错误0、业务提交0、Provider0、费用¥0 |
| 自动门禁 | PASS | auth专项、local-entry真实浏览器、API/Web typecheck、qa:fast/regression/full含build、diff-check全部PASS |


## BY-40 / QA-20260831-003 XHS必填资料提交前提示（2026-08-31，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 真实失败根因 | PASS | 脱敏运行只有主题+imageCount，结构适配成功后被fact-retention拒绝；不是单纯主题长度，也不是图片链 |
| 必填语义 | PASS | 主题、项目/服务、目标顾客必填；项目/顾客允许经营档案默认，本次覆盖不回写；其余资料选填 |
| 提交前失败关闭 | PASS | runtime Provider0；真实HTTP 422精确列出缺失项，合成租户AgentRun0、CreditReservation0 |
| Web/WorkBuddy一致 | PASS | Web提示/按钮与服务端执行层共用有效任务快照；WorkBuddy不能绕过preflight或自报品牌 |
| 桌面/移动 | PASS | Chromium 1440/390px：三项缺失、补齐启用、刷新/返回、双租户、overflow0、console/网络0 |
| 相邻与全仓门禁 | PASS | XHS/fixed-route/user-path专项、API/Web/Agent typecheck、qa:fast/regression/full含build、diff-check |
| 最终环境 | PASS | PG55434/PID10296、API3016/PID18312、Web5176/PID4632；source/runtime=`4A8B91E5`且fresh/ready/database=true |

## BY-39 / QA-20260831-002 本机失效会话入口恢复（2026-08-31，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 无会话直达 | PASS | `/agents/beauty-industry/acquisition/xhs?apiBase=...` 进入美业登录，点击仅本机开通后返回原深链 |
| 失效 token 红灯 | PASS | 修复前真实 Chromium 稳定停在“当前页面暂时没有加载成功/请先完成微信登录和账号绑定”，不会跳登录 |
| 401 最小恢复 | PASS | 先单请求鉴权；仅401清旧 token、保存完整深链并登录恢复，登录后无4xx/5xx；403/404/500不改写 |
| 桌面/移动 | PASS | 1440与390px工作台、填写本次需求后主按钮、overflow0；刷新和任务中心返回均恢复XHS |
| 租户/网络 | PASS | 两个隔离浏览器上下文获得不同tenant；跨上下文不共享会话，登录后console/网络0 |
| 副作用 | PASS | 浏览器POST仅两次本机`/auth/dev-login`；业务提交0、Provider0、费用¥0 |
| 自动门禁 | PASS | auth/login、navigation shell/browser、Web typecheck、qa:fast/regression/full含build、diff-check全部PASS |
| 最终环境 | PASS | PG55434/PID15720、API3016/PID7124、Web5176/PID3064；source/runtime=`6DDF9C2B`、fresh/ready/database=true |

## BY-38 确定性品牌视觉交付（2026-08-31，PASS）

- 红灯：缺少确定性视觉服务、controlled text 误禁图片确认、品牌迁移缺失和同步双击重复确认均先稳定失败；修复后分别由服务/合同、页面状态、正式迁移和 client+server 幂等关闭。
- 交付合同：三角色均为 768×1024 无字、无 Logo、无包装物的品牌抽象底图；服务端租户品牌 token → safety → composition-v1.1 → 原子持久化。无效版本/角色/尺寸/哈希/主题失败关闭，历史 Provider job 不重算。
- 浏览器：真实 Chromium 1440/390px，3图预览/逐张下载、刷新/历史、返回、双击单确认、owner、跨租户404、console0、external0；文字8积分与图片300积分一次结算。
- 门禁：`beauty-industry:deterministic-visual-delivery-p1-smoke`、`beauty-industry:deterministic-visual-browser-e2e`、图片URL/generation/composition/XHS同页/real-media、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`含build全部PASS。
- 状态：QA-20260830-003由确定性视觉产品合同关闭；QA-20260831-001关闭。P0/P1=0，Provider0、费用¥0，WorkBuddy候选引用0。

## BY-38 / QA-20260830-003 XHS 内容图伪品牌真实批次（2026-08-30，历史红灯，已由确定性视觉合同关闭）

| 场景 | 结果 | 证据 |
|---|---|---|
| prompt-v1.3 Champion | PASS | 修复前专项稳定证明内容角色未排除包装、瓶罐、容器、标签面和品牌承载物 |
| prompt-v1.4 Challenger | PASS | 只改变内容角色构图合同；封面/互动快照不变，版本漂移/未知能力失败关闭 |
| quote竞态与历史隔离 | PASS | 旧异步quote不能覆盖当前任务；失败批次→修改本次要求→重新报价，刷新/历史后按钮可用 |
| 零Provider页面 | PASS | Chrome 1440/390px、刷新、历史、owner/跨租户、重复确认、console0；confirm0、Provider0 |
| 全仓自动门禁 | PASS | 内容包装/XHS媒体/质量/持久化/URL/观测专项、API/Web/Agent typecheck、qa:fast/regression/full含build、diff PASS |
| 真实封面 | PASS | 技术、落盘、safety、composition与只读客户可用性通过；批次失败后不单独交付 |
| 真实内容图 | FAIL-CLOSED | SHA `e9af2a0e…2a803`被条码风险拒绝；人工只读还确认三联拼贴和多处瓶罐，独立违反无包装/单场景合同 |
| 条码误报 Champion | PASS | safety-v2.12 的自然线条 `edgeGroups=11/density=0.058/decoded=false` 稳定误报；v2.13 单变量要求 density≥0.080 后连续3轮安全3/3、条码9/9拒绝，precision/recall=1.000/1.000 |
| 内容角色 post-generation | PASS/FAIL-CLOSED | `beauty-image-content-role-contract-v1`拒绝真实三联拼贴；包装/瓶罐/标签物体语义本地不可靠，风险图与安全场景均进入人工复核且客户不可见，不伪称自动理解 |
| 本地物体语义资产审计 | PASS/NOT FEASIBLE | 正式依赖仅canvas/pngjs/qrcode；语义runtime与模型权重0。workspace-only sharp无语义、tesseract.js无traineddata且仅OCR；Python无cv2/onnxruntime/torch/transformers |
| 语义 Champion 3轮 | PASS/FAIL-CLOSED | 3安全+3风险连续3次一致：安全自动通过0/3、风险确定性拒绝1/3、manual review 5/6；Provider/外网0，证明当前资产不能构成可靠Challenger |
| 许可证/资源边界 | PASS | 记录MIT/Apache依赖与notice边界；不存在模型许可证。现有确定性合同约39–45ms/图、Node首轮RSS增量约20–49MiB；不存在模型的CPU/RAM/启动成本不伪估 |
| 审计与全量门禁 | PASS | feasibility/content-role/barcode专项、API/Web/Agent typecheck、qa:full（含fast/regression/build）、diff-check全部通过；无运行代码/DOM变化故不重复浏览器E2E |
| 角色合同版本/历史 | PASS | 新job、route、live runner钉死 safety-v2.13 + content-role-v1；旧历史按持久版本只读，不用当前合同重算 |
| 零费用总门禁 | PASS | 新增专项、26安全/58风险精度集、图片/XHS/持久化/URL/观测、API/Web/Agent typecheck、qa:fast/regression/full含build均PASS，Provider/网络0 |
| 顺序/费用/账本 | PASS | 实际Provider任务2，第三图未调用；保守¥0.40；300积分一次预留一次全额释放，客户资产0 |
| 最终环境 | PASS | source/runtime=`842B5645` fresh；PG55434、API3016/PID21472、Web5176/PID20636；safe_default、media disabled/max0 |
| 产品放行 | HISTORICAL / SUPERSEDED | 当时P1等待方向；现已由上方确定性视觉合同关闭，不再重复付费终验 |

## BY-37 / QA-20260830-002 XHS 本机真实验收配置持久恢复（2026-08-30，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| profile 漂移红灯 | PASS | 同源码/同文本模式下 `safe_default` → `xhs_user_acceptance_v1` 旧逻辑错误Reuse；修复前 `PASS=56/FAIL=1` |
| 完整 profile 决策 | PASS | runtime profile、媒体模式、产品开关、max3任一不一致都必须Restart；未知profile fail-closed；修复后 `PASS=60/FAIL=0` |
| 启动安全边界 | PASS | 固定DeepSeek、media real/max3、300积分、本地存储、人民币边界和approval逐项校验；密钥只进目标进程，不写runtime/日志 |
| 二次维护重启 | PASS | 默认正式stop/start后仍为`xhs_user_acceptance_v1`、text configured、media real/max3，source/runtime=`E037402C`且fresh |
| 真实页面quote | PASS | Chrome 1440/390px三图300积分确认可点击，refresh/back/overflow/console均PASS；confirm0、Provider0 |
| 租户与账本 | PASS | owner页面正常、跨租户404；隔离合成租户24h entitlement和500测试积分只用于quote，无媒体任务/结算 |
| 自动门禁 | PASS | XHS/媒体专项、API/Web/Agent typecheck、qa:fast/regression/full含build、diff全部PASS |
| 最终环境 | PASS | PG55434/PID4664、API3016/PID8544、Web5176/PID20456；ready/database/Web200，费用¥0 |

## BY-36 / QA-20260830-001 本机免邀请码深链恢复（2026-08-30，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 环境身份红灯/恢复 | PASS | 修复前55434/3016/5176均未监听、HTTP连接拒绝；仅用正式 AcceptanceRoot start/status 恢复 |
| 登录回跳红灯 | PASS | 环境恢复后真实Chrome稳定复现本机直接开通未回到XHS深链 |
| 同产品深链 | PASS | XHS pathname/search/hash安全保留，点击后返回原XHS工作台并保留本机apiBase |
| 跨产品/外部回跳 | PASS | 仅当前product前缀可保留；`//`、外部或其他产品路径回落到当前产品首页 |
| 桌面/移动/历史 | PASS | Chrome 1440/390px，刷新、前进后退、overflow0、工作台DOM均PASS |
| 租户/控制台/费用 | PASS | 两独立浏览器上下文租户不串；console0、Provider0、费用¥0 |
| 自动门禁 | PASS | product-login、navigation shell/browser、Web typecheck、qa:fast、qa:regression、qa:full含build、diff全部PASS |
| 最终环境 | PASS | PG55434/PID19292、API3016/PID15496、Web5176/PID16212；source/runtime=`E037402C`、fresh/ready/database=true、Web200 |

## BY-35 / QA-20260829-006 修复后真实文字最终放行（2026-08-30，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前事实链红灯 | PASS | live runner旧参数没有嵌套`professionalOptions`；API与postflight对`25-45岁女性`、`25至45岁女生`、缺年龄和男性替换分类不一致，新增专项修复前稳定FAIL |
| 零Provider最小修复 | PASS | WorkBuddy只传嵌套专业字段；API/Agent统一年龄范围与女性同义词语义，缺失继续missing，男性/错误年龄继续contradiction；没有扩大通用rubric |
| 唯一真实Provider | PASS | `deepseek-v4-pro`1次，thinking0、stop、fallback=false、tokens `3685/841/0/4526`、约¥0.018677；重试/repair/换模/追加0，媒体0 |
| 固定合同与质量门 | PASS | capability/scope/Skill1.0.3固定；provider适配、Schema/Eval、事实回执、矛盾、第一人称、污染、合规、`rubric_not_boss_usable`全部通过 |
| AgentRun与账本 | PASS | 唯一succeeded AgentRun；8积分一次预留一次结算、refund0；同requestId重放没有第二次Provider或交易；临时WorkBuddy凭据/验收entitlement已撤销 |
| Web/WorkBuddy与历史 | PASS | 同一持久化结构一致、历史可恢复；成功文字任务没有模板重算 |
| 桌面/移动/品牌/租户 | PASS | 真实Chrome 1440/390px、兰琪与默认品牌隔离、刷新、跨租户、overflow0、console0；浏览器额外Provider0 |
| 图片确认边界 | PASS（未调用） | 正式三图quote与300积分显式确认入口可用；测试没有点击确认，图片Provider0 |
| 全量门禁 | PASS | XHS结构/事实/fixed-route/客户交付/用户路径、API/Web/Agent typecheck、`qa:fast/regression/full`含build、`git diff --check` |
| 环境/邀请 | PASS | PG55434/API3016/Web5176，source/runtime=`8AFCF24A`、fresh/ready/database=true；邀请`cmtf6eazt0000bwjtawywed06`为lanqi/beauty-industry、24h、max1、used0 |

## BY-35 / QA-20260829-006 第三次修复后真实文字终验（2026-08-30，FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 后期叠字换行红灯/修复 | PASS | 修复前稳定`image_direction_1_post_text_multiline`；仅对`postProductionText`做语义不变的空白归一化，规范输出保留全部文字且为单行 |
| 调用前零Provider门禁 | PASS | XHS结构/safe trace/事实/fixed-route、API/Agent typecheck、qa:fast/regression通过；source/runtime=`AA6BD5D1`、ready/database=true、media disabled/max0 |
| 唯一真实调用 | FAIL-CLOSED | `deepseek-v4-pro`1次、stop/fallback=false、3640/931/0/4571 tokens、约¥0.019147；retry/repair/换模/追加0，媒体0 |
| 结构适配 | PASS | JSON适配和确定性渲染通过，没有再次命中后期叠字换行 |
| 事实/正式质量 | FAIL | postflight精确为`rubric_fact_contradiction / target_audience`；安全指标为回执6 bytes、女生同义词=true、男性=false、年龄范围=false |
| 持久化/账本fail-closed | PASS（补偿后） | 发现API先保存/结算差异；正式幂等补偿后Run=`failed/output null/credit0`、reservation=`compensated/actual0`、1 consume+1 refund、净0 |
| Web/WorkBuddy/页面 | BLOCKED | 未形成正式可交付文字；不做成功DOM、图片300积分入口或邀请验收，不将mock冒充真实质量 |
| 调用后全仓门禁 | PASS | `pnpm.cmd qa:full`含build、`git diff --check`通过；后续外部Provider0 |
| 环境 | PASS（安全停点） | PG55434/API3016/Web5176在线，source/runtime=`AA6BD5D1`且fresh；text controlled_mock、media disabled/max0 |
| 下一恢复点 | P1 | 零Provider统一API/postflight事实源；年龄事实必须保留，同义词只作语义归一化，缺失与矛盾不可混判；持久化/结算前必须执行同一合同 |

## BY-35 / QA-20260829-006 修复后真实文字终验（2026-08-30，FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 环境/授权预检 | PASS | source/runtime=`2E5A2C56`、fresh/ready/database=true；兰琪合成租户仅品牌指派、8积分；text real、media disabled/max0；grant绑定输入hash/模型/1次/¥0.13 |
| 唯一真实文字调用 | FAIL-CLOSED | `deepseek-v4-pro`1次、stop/fallback=false、3640/885/0/4525 tokens、约¥0.018827；retry/repair/换模/追加0，媒体0 |
| 结构安全诊断 | PASS | `field_validation / image_direction_1_post_text_multiline`；response hash/bytes、JSON类型和3/7/3/6结构计数可审计，无字段正文/Prompt/密钥 |
| 正式Schema/Eval/boss usable | NOT REACHED | 适配器在单行制作元数据校验阶段拒绝，未进入workflow正式合同；不冒充旧rubric已真实放行 |
| AgentRun/账本 | PASS（失败语义） | AgentRun0；1预留+1 consume+1等额refund，reservation released/actual0，8积分净0 |
| WorkBuddy/临时权限 | PASS | 临时MCP credential已revoked并保留hash审计；product/agent entitlements revoked；grant consumed不可复用 |
| 后续零Provider回归 | PASS | live failed postflight、XHS provider/safe-trace/fixed-route/WorkBuddy/Web全矩阵、`qa:full`含build通过；追加Provider0 |
| 页面/邀请放行 | BLOCKED | 无成功文字AgentRun，不做成功DOM/图片报价验收，不创建邀请；环境恢复controlled_mock/media disabled |
| 下一恢复点 | P1 | 零Provider闭环`postProductionText`单行运输/确定性空白归一化；不追加真实调用 |

## BY-35 / QA-20260829-006 老板可用性误判零Provider闭环（2026-08-30）

| 场景 | 结果 | 证据 |
|---|---|---|
| 最新真实Champion | PASS（脱敏固化） | DeepSeek 1次、stop/fallback=false、3585/801/0/4386 tokens、约¥0.018051；适配成功，唯一阻断`rubric_not_boss_usable`；AgentRun0、8积分净0、媒体0 |
| 修复前红灯 | PASS | 同一正式JSON结构去掉正文中的冗余“文案”字样后，结构/计数仍合法但旧通用探针稳定命中`rubric_not_boss_usable` |
| 精确根因 | PASS | 通用探针不认识XHS正式“标题候选/正文/话题标签/互动与承接”，结果是否通过错误依赖正文偶然出现“文案” |
| XHS专属Challenger | PASS | 仅固定capability/Skill链按正式客户层判定3标题、正文、5–8标签、互动及无内部污染；不全局扩大关键词 |
| 不完整交付 | PASS | 缺1标题、仅4标签、缺互动均继续命中`rubric_not_boss_usable` |
| 事实/矛盾/第一人称/污染/合规 | PASS | 既有XHS事实、controlled contract、客户交付和跨行业/第一人称adversarial回归保持fail-closed |
| 安全全链路追踪 | PASS | route/参数schema+存在/计数/hash、HTTP/耗时/响应hash+bytes/usage/finish、adapter阶段/结构计数、rubric、账本和用户结果码；无原文/Prompt/密钥/完整响应 |
| 五条直述生图replay | PASS（零Provider） | 4条进入固定XHS文字preflight后停在“保存文字+显式图片确认”边界；1条在Web question minLength失败；不存在直接图片工具，文本/图片调用0 |
| 工程门禁 | PASS | XHS/相邻专项、API/Web/Agent typecheck、qa:fast、qa:regression、qa:full含build、git diff-check全部通过 |
| DOM/页面E2E | NOT RUN | 本轮无DOM、路由或用户状态机变化；不启动离线验收环境，不以旧页面冒充当前源码 |
| 产品放行 | BLOCKED | 离线根因已关闭，但仍需最多1次修复后真实DeepSeek相同输入复验；本轮不创建grant/邀请，不调用Provider |

## BY-35 / QA-20260829-006 真实文字结构传输（2026-08-29，真实复验FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 真实用户路径 | FAIL（稳定Champion） | 配置DeepSeek正常stop，但两次分别缺三套负向提示词数量/术语；AgentRun0、8积分一次预留一次释放、图片Provider0 |
| 固定路由与版本 | PASS | capability/scope/Skill链和fallback均正确，不是路由、低端模型、解析入口或图片链问题 |
| 修复前自动红灯 | PASS | 精确字段组合在旧prompt缺`beauty-xhs-provider-output-v1`时稳定失败 |
| 单次结构化传输 | PASS（离线）/ FAIL（历史真实） | 严格JSON→服务端规范Markdown的合法、缺字段、污染与一次调用回归PASS；历史真实终态后适配器失败，未进入正式workflow合同 |
| 字段级失败阶段 | PASS（离线） | JSON解析/顶层形状/字段校验/渲染分别映射为`invalid_response`和安全规则；代码围栏与额外键红灯由unknown转为可审计阶段 |
| 脱敏可观测性 | PASS | 仅记录hash、bytes、布尔/计数和租户/请求脱敏指纹；不记录原始输出、客户原文、Prompt、密钥或字段值 |
| 三层执行边界 | PASS | structured adapter → 正式Markdown合同 → observed provider；适配失败时observed outputs=0，未把原始JSON误当第三层输入 |
| WorkBuddy候选隔离 | PASS | 仅采纳本地审计/结构指标/replay思想；生产/远程归因、未证实字段猜测与安全门禁放宽均拒绝，运行引用0 |
| 正式Schema/Eval/事实/污染 | PASS（离线） | 沿用1.0.3正式合同；项目、顾客、城市、本次快照、第一人称和跨行业硬门禁均PASS |
| 全量工程门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full含build与diff-check通过 |
| 唯一真实复验 | FAIL-CLOSED | deepseek-v4-pro 1次、stop、tokens 3585/937/0/4522、约¥0.018997；API500，provider错误仅为unknown，媒体调用0 |
| 账本/保存/临时授权 | PASS（失败语义） | AgentRun0；8积分一次预留一次等额释放，净0；临时WorkBuddy凭据与entitlement撤销 |
| 页面放行/邀请 | BLOCKED | 无成功正式文字结果，不创建新邀请，不允许进入三图确认；字段级可观测子范围已关闭，下一步须新的明确真实文本授权后至多一次复验 |
| 最终受控环境 | PASS（零费用） | PG55434/API3016/Web5176在线；source/runtime=`2437A389…D9E9B9`、fresh/ready/database=true；text=controlled_mock、media=disabled/max0，不冒充真实质量入口 |

## BY-35 / QA-20260829-005 safety-v2.12与最终3/3真实交付（2026-08-29，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前Champion | PASS（稳定红灯） | `e98c0d51…92dc`在v2.11为passed/evidence0；顶部连接文字组件`51×19`超过旧单字宽度上限46，在分组前被排除 |
| 单变量Challenger | PASS | v2.12仅增加顶部连续展示文字块联合证据；无SHA/路径白名单，旧风险路径和正式route/live持久化统一钉死v2.12 |
| Precision/recall | PASS | 26安全/58风险同批连续3次`1.000/1.000`；文字/Logo/UI/水印/QR/条码/人物/设备风险召回无下降 |
| 真实Provider边界 | PASS | `wan2.7-image`恰好3个顺序任务，重试/修复/换模/补图/追加/第4张/其他Provider均0；保守费用¥0.60 |
| 三图最终成品 | PASS | 3张768×1024最终PNG，技术/落盘/safety-v2.12/composition-v1.1/人工只读均PASS；客户可用3、下载3 |
| 页面与恢复 | PASS | runner等待刷新后的真实对象URL加载；桌面1440/390px、预览/逐图下载、刷新/历史、重复确认、console0 |
| 租户与账本 | PASS | owner可读、对照租户404；300积分一次预留并一次结算，重复确认不新增流水或Provider任务 |
| 全量门禁 | PASS | 图片/XHS/composition/persistence/URL/media-observability专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 最终环境 | PASS | PG55434/API3016/Web5176在线，source/runtime=`9245D8AC`且fresh；仅本机邀请验收固定DeepSeek V4 Pro+media real/max3、显式300积分确认、单任务≤¥1、无自动重试/补图/换模，未部署生产 |

结论：QA-20260829-005与BY-35产品P1关闭，范围P0/P1=0。真实3/3只代表本地受控验收批次；生产未开放媒体，BY-19/BY-20继续PAUSED。

## BY-35 / QA-20260829-005 safety-v2.11可见中文漏检（2026-08-29，真实批次FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前门禁 | PASS | source/runtime fresh后执行；兰琪测试租户entitlement与500积分有效；新grant绑定plan-v2/prompt-v1.3/safety-v2.11/composition-v1.1、最多3张/¥0.60、零重试 |
| 精确批次身份 | PASS | 同一幂等键精确恢复3个新job ID；历史批次未参与轮询或人工复核 |
| 第1图技术与落盘 | PASS | 仅1个`wan2.7-image`任务；底图/最终PNG均768×1024，短SHA分别为`e98c0d51…92dc`、`7142a6df…d0f1` |
| 自动质量门 | FAIL（新P1） | 底图顶部存在可见中文，safety-v2.11却返回passed、证据0；人工只读拒绝仅作客户门禁，不覆盖自动漏检 |
| 首失败停止与账本 | PASS | 第2/3图未提交；客户资产/下载0；300积分全额释放、净0；Provider任务1、保守¥0.20，无重试/补图/第4张 |
| 页面与租户 | PASS（失败态） | Chrome 1440/390px、刷新/历史、owner/跨租户404、console0；客户不可见资产0 |
| 零Provider postflight | PASS | quality live postflight、real-media、generation、engagement、composition、same-page、persistence、URL、media-observability均PASS，新增外部请求0 |
| 全量门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、diff-check |
| 最终环境 | PASS（安全态） | media disabled/max0、active grant0；未创建邀请、未部署 |

结论：runner的精确批次恢复已真实验证；产品仍因safety-v2.11可见文字漏检保留P1=1。下一步只做`e98c0d51…92dc`零Provider检测根因与precision/recall闭环，不追加真实图片。

## BY-35 / QA-20260829-004 真实终验批次身份恢复（2026-08-29，FAIL-CLOSED→零Provider PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前门禁 | PASS | 兰琪测试租户entitlement有效、余额500；报价300积分/≤¥0.60；source/runtime=`3739754F`且fresh，grant绑定run输入SHA与plan-v2/prompt-v1.3/safety-v2.11/composition-v1.1 |
| 真实第1图 | PASS | Provider任务1；底图`6b39f1cd…100d9`、最终PNG`0041cfef…87564`，768×1024；技术/落盘/自动安全/合成/人工只读可用性PASS |
| 首个失败停止 | PASS | runner误读历史终态批次后立即停止；第2/3图ProviderTaskId为空，客户资产/下载0，300积分全额释放，保守费用¥0.20，无重试/补图/第4张 |
| 修复前红灯 | PASS | grant要求v1.3/v2.11但源码断言残留v1.2/v2.10；确认后通用`/media/jobs`最新批次推断可返回历史终态并触发job身份断言 |
| 最小修复 | PASS | 源码版本钉死同步；确认后用同一幂等键恢复精确3个job ID，后续只对该集合轮询，历史批次不足3个匹配时继续等待 |
| 失败页面E2E | PASS | 真实Chrome 1440/390px、刷新/历史、owner/跨租户404、客户图片0、下载0、console0、外部请求0、账本变化0 |
| 全量门禁 | PASS | real-media/engagement/person-device/generation/composition/XHS专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 最终环境 | PASS | PG55434/API3016/Web5176在线，fresh/ready/database=true，media disabled/max0，active grant=0 |

结论：QA-004的零Provider runner根因已关闭；真实批次未达到3/3，BY-35产品P1仍为1，不创建邀请码。不得复用已消费grant；下一次只允许在新的受控批次安排下验证修复后的精确batch identity链。

## BY-35 / QA-20260829-003 手持手机/UI显式门禁（2026-08-29，零Provider PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前Champion | PASS（红灯有效） | `350b1f39…b994a`含手持手机/空白屏幕/局部手部，v2.10仅在木纹给出不可读glyph，显式人物/设备证据缺失 |
| engagement payload | PASS | prompt-v1.3明确纯摄影静物、无人、无手部、无手持手机/屏幕/UI设备；封面/内容payload不变 |
| v2.11显式证据 | PASS | `person_device_geometry/person_or_device_like`要求屏幕、暗框、边缘与邻近肤色联合成立；真实与合成手持设备均拒绝 |
| 精度硬门 | PASS | 26安全/57风险，同批连续3次precision/recall=1.000/1.000，Provider/网络0 |
| 图片/XHS相邻专项 | PASS | quality、generation-success、engagement prompt、real-media零调用、composition、persistence、URL、media-observability、same-page、workbench全部PASS |
| Chrome/历史批次 | PASS | runner按batchRequestId隔离最新批次；1440/390px、刷新/历史、单批3任务、owner/跨租户404、console0、ledger change0、external0 |
| WorkBuddy候选隔离 | PASS | `poster-wiring.md`与旧App只读审查；正式运行引用0，未采用旧route/Skill、前端二次请求、Markdown拼图或品牌硬编码 |
| 全量门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、diff-check |
| 环境 | PASS | PG55434/API3016/Web5176，source/runtime=`3739754F`、fresh/ready/database=true，text=controlled_mock、media=disabled/max0 |

结论：QA-20260829-003关闭，零费用原子范围P0/P1=0；BY-35仍缺修复后真实3/3成品，产品残余P1=1，不创建邀请码。下一步仅为既有单批≤¥1下的prompt-v1.3/safety-v2.11受控三图终验。

## BY-35 / QA-20260829-002→003 safety-v2.10 与最终真实终验（2026-08-29）

| 场景 | 结果 | 证据 |
|---|---|---|
| df997 Champion | PASS | v2.9稳定误拒corner/edge-components与glyph-sequence；均无可读字符恢复 |
| v2.10 Challenger | PASS | 删除无显式文字结构的corner bright-ink兜底；glyph-like一致率固定1.000，无SHA/路径白名单 |
| 精度硬门 | PASS | 26安全/56风险，同批连续3次precision/recall=1.000/1.000，Provider0 |
| 失败grant隔离 | PASS | 前一grant在HTTP409处停止；新job/Provider/积分/业务写入0，封存为preflight-revoked，不重放 |
| 新批次唯一性 | PASS | 执行合同v2.9→v2.10时允许旧quality_failed显式重试；确认HTTP204后3个job均为新ID；成功批次仍要求修改图片需求 |
| 封面最终成品 | PASS | 底图SHA `15721cea…5b3f`；最终PNG `90602fe2…eef93`，768×1024、标题完整可读、自动与人工PASS |
| 内容最终成品 | PASS | 底图SHA `4cdeb649…0c90`；最终PNG `67f1f51b…6c19`，768×1024、无伪字/Logo/UI、自动与人工PASS |
| 互动图 | FAIL-CLOSED | 底图SHA `350b1f39…b994a`含手持手机与界面设备构图，违反纯摄影静物/无人/无UI合同；自动拒绝，未合成客户成品 |
| Provider/账本 | PASS | 恰好3个wan2.7-image任务、保守¥0.60；其他Provider0；300积分一次预留一次全额释放、净0 |
| 客户/租户/页面 | PASS（失败语义） | 整批客户资产/下载0；owner/跨租户404、1440/390px、刷新/历史、console0 |
| 工程门禁 | PASS | live postflight、专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check通过 |
| 最终环境 | PASS | PG55434/API3016/Web5176在线，source/runtime=`171DCB4C`且fresh，media disabled/max0 |

结论：QA-20260829-002检测精度P1关闭；三图业务仍未达3/3，新开QA-20260829-003。不得创建邀请码或追加付费调用；下一步仅做手持手机/空白屏幕/局部手部/界面设备风险的零Provider显式门禁和engagement payload回归。

## BY-35 / QA-20260829-002 safety-v2.9真实终验（2026-08-29，FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 一次性授权与顺序调用 | PASS | grant钉死wan2.7-image/plan-v2/prompt-v1.2/safety-v2.9/composition-v1.1；最多3、重试/补图/换模/追加0 |
| 第1图最终合成交付 | PASS | 底图`103b2d58…80537`自动质量PASS；最终PNG`627524bf…b3ed`、768×1024，标题完整无重复无省略号，人工只读PASS |
| 第2图自动质量 | FAIL-CLOSED | 底图`df997146…f04c`命中corner_watermark/edge_components与glyph_sequence；人工未覆盖自动门禁 |
| 第3图与第4图 | PASS | 第2图拒绝后停止；第3图未提交，第4图不存在 |
| Provider与费用 | PASS | 精确2个Provider任务，保守¥0.40≤¥0.60；其他Provider0 |
| 账本/幂等 | PASS | 300积分一次预留一次全额释放，净0；重复postflight不新增交易或任务 |
| 客户资产/租户 | PASS | 整批quality_failed，客户资产/下载0；owner边界与跨租户404通过 |
| 页面 | PASS | 1440/390px失败态、刷新/历史、console0通过 |
| 环境 | PASS | PG55434/API3016/Web5176，source/runtime=`6EF8938C…D3C7C`、fresh/ready/database=true，media disabled/max0 |
| 零Provider/工程门禁 | PASS | 25安全/56风险连续3次1.000/1.000；图片/XHS专项、typecheck、qa:fast/regression/full+build、diff-check通过 |

结论：真实交付未达3/3，BY-35与QA-20260829-002保持P1；不得创建邀请码或追加真实调用。下一步仅做`df997146…f04c`自然场景误报的零Provider根因闭环。

## BY-35 / QA-20260829-001 顶部低对比伪文字召回（2026-08-29，零Provider PASS）

| 类别 | 红灯 / 根因 | 绿灯 | 结果 |
| --- | --- | --- | --- |
| 真实风险正例 | SHA `e91ef4af…aa331`在safety-v2.8稳定返回passed；旧edge-component字形分组没有顶部候选 | safety-v2.9返回`rejected`，reason=`visible_text_or_brand_like`、detector=`glyph_sequence` | PASS |
| 单变量Challenger | 不按SHA或路径放行，不改变既有detector阈值 | 仅新增顶部20%内连续高密度笔画带联合证据：连续行、转换密度、20%–85%水平覆盖与亮度差同时成立 | PASS |
| 安全/风险精度 | 真实自然纹理、空白瓶罐、木架、玻璃碗、棉片等不得新增误报 | 25安全/56风险同批连续3次precision/recall=`1.000/1.000`；真实QR/条码/文字Logo/UI水印/人物继续拒绝 | PASS |
| 调用/版本 | 历史v2.8批次只读，不事后重判 | 正式新任务、real-media与live runner钉死v2.9；Provider/网络/grant0、费用¥0 | PASS |
| 工程门禁 | 不以单个Eval代替相邻回归 | 图片/XHS/持久化/URL/媒体观测/合成专项、API/Web/Agent typecheck、qa:fast/regression通过；qa:full与真实终验紧接执行 | PASS |

结论：QA-20260829-001零Provider检测子范围关闭；BY-35真实3/3客户成品仍以本轮随后唯一受控终验为放行条件。

## BY-35 / QA-20260828-007 叠字可读性预检（2026-08-28，零Provider PASS）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 修复前红灯 | PASS | 脱敏真实分布证明重复超长标题在旧composition-v1被固定行数加省略号；新增专项在实现前因缺少预检函数失败 |
| 根因链 | PASS | 正式标题选择与route映射正确；缺口是标题/短句在进入composition前只校验候选归属，没有重复、完整容纳和字形测量门禁 |
| Provider前阻断 | PASS | quote/confirm都在积分预留和Provider提交前运行三角色预检；重复、过长、emoji分别返回可操作422，Provider/积分均为0 |
| 确定性合成 | PASS | composition-v1.1以实际CJK字宽逐级适配字号、完整换行、行高/边距/最大行数；不以省略号截断，布局回执持久化 |
| 三角色/画布 | PASS | 封面、内容、互动；短标题、中英混排、标点在768×1024与390×520均完整保留；重复、超长、不可靠符号失败关闭 |
| 真实Chrome | PASS | 桌面1440/390px连续3次：结构化本次字段、双击单请求、保存/刷新、双租户、重复标题精确422且图片资产0；console0、外部Provider0 |
| 客户资产/租户 | PASS | Provider底图保持不可变且不进入客户路径；最终成品独立原子落盘，owner读取最终图、跨租户拒绝 |
| 授权/账本/幂等 | PASS | 产品开关+entitlement+租户+预算+积分+批次幂等共同推导；未知/关闭/余额不足失败关闭 |
| WorkBuddy/品牌 | PASS | 候选运行引用0；合成器与通用合同无兰琪名称、知识或色值硬编码 |
| 零Provider门禁 | PASS | composition、same-page、persistence、quality、real-media零调用、URL/观测、XHS专项及precision 25/25安全、55/55风险连续3次全绿 |
| 全量工程门禁 | PASS | API/Web/Agent typecheck、qa:fast/regression/full+build、git diff-check通过 |
| 既有真实批次 | 历史FAIL-CLOSED | 旧唯一批次仍只读保留为失败证据，不用新版本事后重判；本轮没有创建grant或外部调用 |
| 费用/客户结果 | PASS | Provider任务1、保守¥0.20；300积分一次消费一次退回、净0；客户资产/下载0，无重试/补图/第4张 |
| 邀请/环境 | PASS | 未达3/3不创建邀请码；隔离3017/5177正式停止、共享PG55434保留、媒体撤权 |

结论：QA-20260828-007零费用P1关闭，范围P0/P1=0；BY-35真实3/3客户成品需后续独立终验，不在本轮调用Provider或创建邀请码。

## BY-34 明显展示文字召回闭环（2026-08-28，PASS，零Provider）

| 类别 | 红灯 / 根因 | 绿灯 | 结果 |
| --- | --- | --- | --- |
| 真实风险正例 | SHA `66b9a75b…f199`在safety-v2.7稳定返回passed/reasons空 | safety-v2.8返回`rejected`，reason=`visible_text_or_brand_like`、detector=`glyph_sequence` | PASS |
| 精确根因 | 旧分支只看rank1；rank1 gap=2.422、density=0.028失败后结束，rank10真实文字虽ratio=1、baseline=0、density=0.323仍被跳过 | 新分支只补选高置信顶部展示文字：density>=0.25、baseline<=1.25、height variation<=0.12、所有构件均像字形 | PASS |
| 安全/风险精度 | 禁止以SHA白名单或降低硬门禁换召回 | 25安全/55风险同批连续3次precision/recall=`1.000/1.000`；QR、条码、文字/Logo、UI/水印、人物全部继续拒绝 | PASS |
| 版本/调用 | 正式新任务必须钉死版本；历史批次不重判 | detector/real-media/live runner同步v2.8；Provider/外网/grant=0、费用¥0、media未启用 | PASS |
| 工程门禁 | 不以单个Eval替代相邻回归 | 图片/XHS/持久化/URL/媒体观测专项、API/Web/Agent typecheck、qa:fast/regression/full+build通过 | PASS |
| 环境边界 | 零Provider检测任务禁止刷新或启用媒体 | PG55434、API3016 ready/database、Web5176=200；text=controlled_mock、media=disabled/max0，source=`D5060C4E`/旧runtime=`AB888453`不新鲜且不冒充v2.8 | PASS |

结论：QA-20260828-006检测漏报P1关闭，本原子范围P0/P1=0。无DOM/路由变化，未重复桌面/390px E2E；未执行或自动开启下一次付费终验。

## BY-34 safety-v2.7 独立真实终验（2026-08-28，FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 运行身份/授权 | PASS | source/runtime=`B3509750…`后启动真实批次；grant固定plan-v2/prompt-v1.2/safety-v2.7、最多3张、¥0.60≤¥1且不可重放 |
| 正式历史文字恢复 | PASS | preview/formal随AgentRun持久化，history/replay不再被当前controlled-mock模式覆盖；目标run可选且300积分确认按钮可用 |
| 顺序三图 | FAIL-CLOSED | 第1图技术成功/落盘；客户人工门禁拒绝后第2/3图未提交，ProviderTasks=1、unsubmitted=2、无第4张 |
| 客户质量 | FAIL-CLOSED | 768×1024、SHA `66b9a75b…f199`；画面顶部有明显中文展示文字，虽自动v2.7为passed仍不得交付，登记QA-20260828-006 |
| 账本/资产 | PASS | 300积分consume一次/refund一次、reservation released/actual0、净0；客户资产/下载0，owner/跨租户404 |
| 浏览器 | PASS | 真实Chrome桌面1440/390px、刷新/历史、三卡失败态、overflow0、console0、external provider0 |
| 全量门禁 | PASS | 图片/XHS/real-media零调用/持久化/URL/媒体观测、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 最终环境 | PASS | PG55434/API3016/Web5176 source/runtime=`AB888453…` fresh；text controlled_mock、media disabled/max0；grant消费封存 |

结论：P0=0、P1=1；真实3/3未达成，不创建邀请码。下一恢复点只做明显展示文字漏报的零Provider检测根因，禁止追加本批调用。

## BY-34 QR/条码检测精度闭环（2026-08-28，PASS，零Provider）

| 类别 | 红灯 / 根因 | 绿灯 | 结果 |
| --- | --- | --- | --- |
| 真实安全负例 | SHA `60f2ea68…68bb8d` 在 safety-v2.6 稳定命中 `qr_finder_pattern`；平均比例误差0.283、直角分0.74、无可解码证据 | safety-v2.7 增加 QR 7×7 二维模式一致度；安全图平均0.510 < 0.72，正确通过 | PASS |
| QR/条码召回 | 旧逻辑不区分一维偶合与二维 finder 结构 | 合成QR一致度0.878、`qr_finder_pattern`继续拒绝；条码、文字/Logo、UI/水印、人物风险全拒绝 | PASS |
| 稳定性 | 同批 Champion/Challenger 需防止偶然通过 | 25安全/54风险连续3次precision/recall=`1.000/1.000` | PASS |
| 调用与版本 | 不允许候选资产、SHA白名单或史历重判 | 正式新任务/real-media/runner钉死v2.7；历史v2.6只读；Provider/网络/grant=0、¥0 | PASS |
| 相关门禁 | 图片检测器修改不得回归XHS、持久化、URL或媒体观测 | 图片/XHS/real-media零调用/持久化/URL/观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`+build、diff-check全绿 | PASS |

说明：本轮无DOM/路由/数据库变化，按范围不重复桌面/390px E2E；历史页面不用v2.7事后重判。本精度子范围P0/P1=0，真实3/3用户放行未在本轮执行。

## BY-34 XHS真实用户路径最终放行（2026-08-28，历史真实终验 FAIL-CLOSED）

| 场景 | 结果 | 证据 |
|---|---|---|
| 成功批次再报价红灯 | PASS | 修复前`succeeded`固定`batch_already_succeeded/retryEligible=false`；修复后仅图片要求哈希变化且用户显式进入再报价时返回300积分确认，未变化/重复/进行中继续阻断 |
| 当前源码/品牌/权限 | PASS | 真实调用前 source/runtime=`007D2616…D330`；最终按正式流程刷新为 source/runtime=`3DF58C40…`，两阶段均fresh/ready/database；兰琪品牌、entitlement、500测试积分、一次性grant与≤¥1组合成本预检通过 |
| 历史真实文字恢复 | PASS | 持久化Skill1.0.3正式文字通过Web恢复，未新增文字调用；客户层无mock/Schema/Eval/待补/核验污染 |
| 唯一三图确认 | FAIL-CLOSED | 仅第1张创建Provider task；技术成功/原子落盘后被`safety-v2.6 qr_or_barcode_like`拒绝，第2/3图未提交，无第4张 |
| 图片质量 | FAIL-CLOSED | 768×1024、SHA `60f2ea68…68bb8d`、confidence0.953；人工只读未见QR/条码，但自动门禁未被覆盖，客户资产/下载0 |
| 账本/费用 | PASS | 300积分一次consume+一次refund，reservation released/actual0、净0；wan2.7-image 1次/保守¥0.20，DeepSeek/其他Provider0，无重试/修复/换模/补图/追加 |
| 邀请/环境 | PASS | 未达到3/3故未创建新邀请；旧未使用邀请已停用。最终PG55434/API3016/Web5176 fresh，text mock、media disabled/max0 |
| 全量门禁 | PASS | XHS/媒体/持久化/观测/品牌专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check；真实终验严格停止 |

历史结论：该轮真实3/3交付失败关闭；其安全负例已在上方 safety-v2.7 零Provider精度闭环中修复，QA-20260828-004 不再打开。本轮未执行新的付费 3/3 用户放行。

## BY-33 XHS图片批次恢复与本次需求快照（2026-08-28，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS | 脱敏DB证据：旧任务3作业已quality_failed/refunded，第二个成功文字任务0作业却被租户历史`3+3>max3`拒绝；新增专项修复前因缺批次域模块失败 |
| 新文字任务 | PASS | 历史作业不占新批次单批额度；每个成功AgentRun独立quote/一次确认资格，旧失败任务不锁死新任务 |
| 同任务重试 | PASS | quality_failed默认不可再次调用；仅显式选择重试、关联旧job且requirements hash变化后可再次确认；未修改、处理中、已成功均fail-closed |
| 幂等/账本/资产 | PASS | 同一batchRequestId只建3个顺序作业和一笔预留；查询、提交、终态、结算/释放、asset/download均限制在目标批次与owner租户 |
| 本次需求快照 | PASS | 主题/目的、项目、顾客、可选城市/门店事实、角度/语气、视觉要求、事实/禁用内容随任务保存并用于文字+图片计划，历史显示同一快照 |
| 经营档案边界 | PASS | 页面档案摘要保持原值；本次编辑/生成后仍未写回长期档案，只有独立档案页主动保存可改变默认值 |
| 错误/下一步 | PASS | 授权缺失、额度不足、旧批失败、要求未改、生成中、质量失败、服务失败返回不同stateCode/message；按钮不再静默置灰 |
| Web/WorkBuddy/品牌 | PASS | MCP schema/允许字段与Web一致；通用核心无兰琪字符串，brand由服务端租户配置派生，候选路径运行引用0 |
| 浏览器 | PASS | 受控Chrome桌面1440/390px：double_click_run_requests=1、save/refresh/tenant isolation、overflow0、console0、external provider0；应用内浏览器复核字段、快照与不回写 |
| 全量门禁 | PASS | XHS/媒体/持久化/观测/品牌专项、API/Web/Agent typecheck、qa:fast/regression/full+build、git diff--check |
| 外部动作 | PASS | Provider/网络付费调用0、媒体确认点击0、费用¥0、未部署；最终验收环境media=disabled/max0 |

结论：BY-33与QA-20260828-003关闭，范围内P0/P1=0；本机受控入口在线，BY-19/BY-20继续PAUSED。

## BY-32 小红书图文正式工作台（2026-08-28，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS | 专项先稳定失败 `xhs_workbench_v2_component_missing`；证明正式API/Skill存在，但Web仍缺少XHS专属客户呈现边界 |
| 同页客户结果 | PASS | 3标题可选；正文、5–8个话题及整套复制；复制内容仅含选中标题/正文/话题，不含制作说明、审核或内部术语 |
| 图片任务 | PASS | 同一文字任务显示三角色、真实积分quote、显式确认与进度；只有3/3合格才显示逐图下载，未点击确认时Provider0 |
| 固定合同 | PASS | `beauty_xiaohongshu_package/acquisition:xhs/wechat-xhs-content-line@1.0.3`及plan-v2/prompt-v1.2/safety-v2.6未改变 |
| 品牌租户红灯 | PASS | `INVITE_REQUIRED=false`时显式兰琪邀请码曾返回default；修复后显式码校验DB并保留服务端brand authority |
| 品牌隔离 | PASS | 兰琪桌面/390px为`lanqi-orange`与兰琪显示；默认租户为美业智能体/墨绿；伪造/跨租户拒绝，候选路径引用0 |
| 刷新/历史/幂等 | PASS | 合成正式AgentRun通过真实API和Chrome加载、刷新恢复；未触发媒体确认；跨租户结果不可见 |
| 用户界面 | PASS | 无Skill/capability/Prompt/Provider/模型参数/技术验收词；桌面1440与390px overflow=0、consoleErrors=0 |
| Web/WorkBuddy | PASS | 共用正式结构化customerDeliverable/productionNotes/auditReceipt，客户复制层不拼入审核字段 |
| 全量门禁 | PASS | XHS专项、固定路由、品牌包、候选0引用、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 外部动作 | PASS | E2E Provider calls=0、media confirm clicks=0、费用¥0；未部署生产 |

结论：BY-32与QA-20260828-002关闭，范围内P0/P1=0；本机入口可供一次性验收，BY-19/BY-20继续PAUSED。

## BY-31 小红书真实模型本机受控验收（2026-08-28，PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| 当前源码/环境 | PASS | source/runtime一致、fresh=true、ready/database=true；正式启动曾钉死DeepSeek V4 Pro与media max3 |
| 修复前真实文案smoke | FAIL-CLOSED | Provider1次、finish=stop、fallback=false、tokens 3560/1098/0/4658、约¥0.020031；合同正确拒绝`forbidden_我做过`，AgentRun0且8积分全额释放 |
| Skill1.0.3红绿灯 | PASS | 无事实第一人称体验在任何输出层失败；门店中性表述、正式结构、事实/污染fixture通过 |
| 修复后唯一真实smoke | PASS | `deepseek-v4-pro`恰好1次、thinking disabled、finish=stop、fallback=false、usage event1、媒体/文件上传/其他Provider0、约¥0.019404≤¥0.13；授权耗尽即停止 |
| 正式合同/事实 | PASS | Skill1.0.3正式Schema/Eval、任务事实回执、事实矛盾、跨行业污染与第一人称门禁全部通过，未模板覆盖 |
| AgentRun/账本 | PASS | 唯一succeeded AgentRun；8积分一次预留/一次结算/释放0；临时WorkBuddy凭据和测试entitlement撤销，测试余额归零 |
| Web/WorkBuddy分层 | PASS | MCP客户文本等于`customerDeliverable.copyMarkdown`；结构化customer/production/audit三层与持久化run一致，历史刷新恢复PASS |
| Runner假阴性回归 | PASS | 禁止把客户复制稿作为完整workflow合同输入；同一真实run离线复核output hash `196f926ff0aa5ede` PASS |
| Prompt/成本 | PASS | XHS 24997/25000 bytes；文字最坏¥0.122635，三图最坏¥0.60，完整任务预算预检<¥1 |
| 正式资产隔离 | PASS | runtime manifest/正式MCP副本版本和哈希一致；WorkBuddy candidates/intake/quarantine引用0 |
| Web真实模式 | PASS | Chrome桌面1440/390px显示DeepSeek V4 Pro真实文案状态，无mock banner/横向溢出/console错误；页面测试Provider0 |
| 全量门禁 | PASS | 专项、API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、diff-check |
| 用户入口 | PASS | 本机PG55434/API3016/Web5176在线且fresh；beauty-industry邀请码24小时/最多1次、usedCount0，明文不入仓库/日志 |

结论：BY-31真实文本、正式合同、账本、Web/WorkBuddy、浏览器和本机入口全部闭环，范围内P0/P1=0；不部署生产，BY-19/BY-20继续PAUSED。

## BY-26 plan-v2/prompt-v1.2/safety-v2.6 最终真实三图验收（2026-08-27，3/3 PASS）

| 场景 | 结果 | 证据 |
|---|---|---|
| runtime/授权/费用预检 | PASS | source/runtime=`753AC360…EA3D`、fresh/ready/database；一次性grant pin plan-v2/prompt-v1.2/safety-v2.6、max3、¥0.60≤¥1 |
| 封面图 | PASS | 768×1024，SHA `3e4e59ee…fc3a9`；技术/落盘/自动/人工全部PASS |
| 内容图 | PASS | 768×1024，SHA `c8173368…dbe21`；技术/落盘/自动/人工全部PASS |
| 互动图 | PASS | 768×1024，SHA `1c145b97…b2643`；纯摄影静物，无文字/UI/品牌；技术/落盘/自动/人工全部PASS |
| 调用与费用 | PASS | `wan2.7-image`恰好3次，无第4次；重试/修复/换模/补图/追加0，保守¥0.60，其他Provider0 |
| 完整交付/账本 | PASS | batch=succeeded、客户资产/下载3；300积分一次预留/一次结算、释放0；重复确认不新增任务/交易 |
| 租户/历史/Web | PASS | owner200、跨租户404；桌面1440/390px、刷新/历史、3图下载、console0、request failure0 |
| 撤权/环境 | PASS | grant/approval删除；media disabled/max0；PG55434/PID27752、API3016/PID26452、Web5176/PID6828，source_fresh=true |
| 专项/全量 | PASS | 图片/XHS专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |

结论：BY-26三张客户合格图业务P1关闭，范围内P0/P1=0；仅保持本机受控验收环境，不部署，BY-19/BY-20继续PAUSED。

## BY-26 safety-v2.6 `ui_layout`面板网格占用率精度闭环（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| v2.5 Champion红灯 | PASS | SHA `f00d1cb9…f8d8`稳定REJECT；panel=5、横长边4、纵长边14、row=3、column=4、repeatedBars=2 |
| 根因 | PASS | 旧panel-grid未验证规则网格占用；自然轮廓occupancy=`5/(3×4)=0.417`，repeated-bars分支不成立 |
| v2.6单变量 | PASS | 仅增加panel-grid occupancy≥0.60；f00d PASS，无SHA/路径白名单 |
| 安全负例 | PASS | 23/23，包括f00d、历史无字瓶罐/木架/棉片、自然纹理、几何瓶罐与建筑线条 |
| 风险正例 | PASS | 54/54 REJECT，包括真实UI、人物+伪标签、历史二维码/伪品牌及QR/条码/文字Logo/水印/卡片/按钮/弹窗变体 |
| 稳定性 | PASS | 同一批Eval连续3次precision/recall=`1.000/1.000` |
| 正式版本钉死 | PASS | detector、real-media smoke与live runner统一safety-v2.6；历史v2.5批次只读、不重判 |
| Provider/费用 | PASS | Provider calls=0、外部网络=0、grant=0、费用¥0，media保持disabled/max0 |
| 专项/全量 | PASS | precision/quality/generation-success/real-media/persistence/URL/media-observability/XHS、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 页面/环境 | NOT RUN（范围外） | 无Web、DOM、路由或历史资产状态变化，按范围不重复桌面/390px E2E且不刷新；source=`753AC360…`、旧runtime=`67AD10C0…`、source_fresh=false（预期），media disabled/max0、grant0 |

结论：QA-20260827-014检测精度子范围P0/P1=0；BY-26三图完整交付业务P1仍为1。下一恢复点为plan-v2/prompt-v1.2/safety-v2.6受控真实终验。

## BY-26 plan-v2/prompt-v1.2/safety-v2.5 真实三图终验（2026-08-27，安全失败）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前版本/费用门禁 | PASS | grant固定`aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.2/safety-v2.5、max3、¥0.60≤¥1；source/runtime=`67AD10C0…D56`、ready/database、租户/entitlement/300积分PASS |
| 封面图 | PASS | 768×1024、SHA `d53b9885…1de9`，技术/落盘/自动质量/人工只读可用性全部PASS |
| 内容图 | FAIL-CLOSED | 768×1024、SHA `f00d1cb9…f8d8`；技术/落盘成功，`ui_layout`以panel=5、横长边=4、纵长边=14、行组=3、列组=4、repeatedBars=2拒绝；人工未覆盖 |
| 互动图与调用上限 | PASS（未提交） | 第2张拒绝后立即停止，无第3/4次、无重试/修复/换模/补图/追加；实际2任务，保守¥0.40，其他Provider0 |
| 完整交付/账本 | PASS（失败语义） | batch=`quality_failed`、客户资产/下载0；300一次预留、结算0、全额释放一次、净0 |
| postflight/幂等/租户 | PASS | 2个唯一Provider任务、资产SHA不变；重复确认无新增任务/交易，owner/跨租户404 |
| Web | PASS | Chrome桌面1440与390px、刷新/历史、console0、postflight external Provider0 |
| 回归 | PASS | 图片/XHS专项、API/Web/Agent typecheck、precision安全22/22/风险54/54、qa:fast/regression/full+build |
| 撤权与环境 | PASS | grant/approval删除；media disabled/max0；PG55434/API3016/Web5176 source_fresh=true |

结论：P0=0；QA-20260827-014/BY-26三张客户合格图业务P1=1。成功路径的3/3客户下载验收未执行，因为第2张自动门禁失败，禁止将部分成功冒充完整交付。下一恢复点是该内容图`ui_layout`零Providerprecision/recall根因。

## BY-26 safety v2.5 最终真实三图终验（2026-08-27，安全失败）

| 场景 | 结果 | 证据 |
|---|---|---|
| 调用前门禁 | PASS | source/runtime=`A81875C1…`、ready/database、租户/entitlement、300积分、¥0.60服务端上限、prompt-v1.1/safety-v2.5、media max3 |
| 封面图 | PASS | 768×1024、SHA `60d487d0…6948`，技术/落盘/自动质量/人工可用性全部PASS |
| 内容图 | PASS | 768×1024、SHA `1ac75e65…c9d`，技术/落盘/自动质量/人工可用性全部PASS |
| 互动图 | FAIL-CLOSED | 768×1024、SHA `acc26153…385d`，真实存在中文展示文字和卡片UI；v2.5以`visible_text_or_brand_like/glyph_sequence`正确拒绝 |
| 顺序/次数/费用 | PASS | 恰好3个顺序任务、无第4次、重试/修复/换模/补图/追加0，保守费用¥0.60 |
| 完整交付 | PASS（失败语义） | batch=`quality_failed`，客户资产/下载0；两张部分PASS未冒充3/3 |
| 账本/幂等 | PASS | 300一次预留、结算0、全额释放一次、净0；重复确认无新任务/事务 |
| Web与隔离 | PASS | 桌面1440/390px、刷新/历史、owner/跨租户404、console0 |
| postflight/仓库门禁 | PASS | 追加Provider0、资产不变；图片专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check |
| 撤权 | PASS | grant/approval删除，media=disabled/max0，source_fresh=true，不部署 |

结论：P0=0；BY-26三张客户合格图业务P1仍为1。本次是真实风险正确阻断，不修改或放宽safety-v2.5；下一恢复点为互动角色生成成功率的零Provider单变量红灯。

## BY-26 v2.5 `corner_watermark` 精度闭环（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| Champion 红灯 | PASS | SHA `19f36810…d946` 在v2.4稳定被`corner_watermark/edge_components`拒绝；mean component height=4.333、union height=10、ratio=0.433 |
| 可观测根因 | PASS | 6个棉片/织物微小边缘组件满足旧基线/宽度/密度规则，但没有足够垂直占比；与QR/条码/glyph/UI无关 |
| 单变量 Challenger | PASS | v2.5仅要求corner component mean-height/union-height≥0.55并记录指标；无SHA白名单，其他检测器和fail-closed未改 |
| 安全 precision | PASS | 合成安全对照与5份来源明确真实安全图共22/22 PASS |
| 风险 recall | PASS | 真实历史风险、QR/条码、中英文/乱码、Logo、水印/UI/人物及变体共54/54 REJECT |
| 稳定性 | PASS | 相同Eval连续3次precision/recall=`1.000/1.000` |
| 受影响专项 | PASS | precision、quality、generation-success、real-media、persistence、URL、media-observability、XHS同页 |
| 仓库门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、git diff-check |
| 零外部动作 | PASS | grant=0、Provider=0、external network=0、费用=¥0、未部署、未刷新/启用媒体环境 |

结论：QA-20260827-013检测精度子范围P0/P1=0；无页面变化故未重复桌面/390px E2E。BY-26三张客户合格图业务P1仍为1，下一恢复点为按既有≤¥1授权重新物化safety-v2.5真实三图终验；BY-19/BY-20继续PAUSED。

## BY-26 safety v2.4 最终真实三图终验（安全失败，2026-08-27）

| 场景 | 结果 | 证据 |
|---|---|---|
| grant版本钉死红灯 | PASS | 修复前缺少prompt/safety版本断言而稳定失败；现同时钉住prompt-v1.1、safety-v2.4并核对当前源码版本，Provider前fail-closed |
| 调用前门禁 | PASS | source/runtime=`B4F85F79…`、ready/database、全合成租户/entitlement、300积分、¥0.60≤¥1、media max3均通过 |
| 封面图 | FAIL-CLOSED | 1个Provider任务技术成功并原子落盘；768×1024、SHA `19f36810…d946`，自动门禁以`corner_watermark/edge_components`拒绝；人工观察未覆盖门禁 |
| 内容/互动/调用上限 | PASS | 封面拒绝后两图均未提交；总Provider任务1，无重试、修复、换模、补图、追加或第4任务 |
| 完整交付/账本 | PASS（失败语义） | batch=quality_failed、customerUsable/download=0；300积分一次预留一次全额释放，净0；保守¥0.20，其他Provider0 |
| 桌面/移动/租户/幂等 | PASS | 1440/390px、刷新/历史、重复确认、owner与跨租户404、console0、postflight外部请求0 |
| 撤权/环境 | PASS | grant/approval删除；正式stop/start后source_fresh=true、media=disabled/max0、ready/database=true、Web200 |
| 受影响专项与仓库门禁 | PASS | 图片/XHS专项、API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build |

结论：安全失败关闭正确且P0=0；三张客户合格图未达成，QA-20260827-013/BY-26业务P1=1。本批不提供用户入口、不追加付费，下一步只做角落edge-components零Provider精度根因。

## BY-26 v2.4 `visible_text_or_brand_like` 精度闭环（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| Champion 红灯 | PASS | SHA `bc044be3…af61` 在 v2.3 稳定由 `glyph_sequence` 拒绝；5 个组件中仅 3 个 glyph-like，ratio=0.6，max aspect=6.8，readableSequenceRecovered=false |
| 单变量 Challenger | PASS | v2.4 仅要求 glyph-like component ratio≥0.75；无 SHA 白名单，其他检测器和 fail-closed 未改 |
| 安全 precision | PASS | 既有安全集加原始无字瓶罐/木架真实图，共 21/21 PASS |
| 风险 recall | PASS | 真实历史风险、QR/条码、中英文/乱码、Logo、水印/UI/人物及变体共 54/54 REJECT |
| 稳定性 | PASS | 相同 Eval 连续 3 次 precision/recall=`1.000/1.000` |
| 零外部动作 | PASS | grant=0、Provider=0、external network=0、费用=¥0、media=disabled/max0、未部署 |
| 受影响专项 | PASS | precision、quality、generation-success、real-media、persistence、URL、media-observability、XHS 同页 |
| 仓库门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、git diff-check |

结论：QA-20260827-012 检测精度子范围 P0/P1=0；无 UI 改动故未重复桌面/390px E2E。BY-26 三张客户合格图业务 P1 仍为 1，BY-19/BY-20 继续 PAUSED。

## BY-26 v2.3 修复后最终真实三图终验（安全失败，2026-08-27）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前硬门禁 | PASS | 新不可重放grant固定wan2.7-image/prompt-v1.1/safety-v2.3、最多3任务、¥0.60≤¥1；source_fresh、DB、租户/entitlement、积分、成本和media max3通过 |
| 封面图 | PASS | 768×1024、SHA `1de67102…f1c3`；技术、落盘、自动质量和人工只读可用性均PASS |
| 内容图 | FAIL-CLOSED | 768×1024、SHA `bc044be3…af61`；v2.3以`visible_text_or_brand_like`拒绝；人工只读未识别对应文字/品牌，但未覆盖自动门禁，登记QA-20260827-012 |
| 互动图/调用上限 | PASS | 内容图拒绝后停止；互动图未提交，无第3/4任务、重试、修复、换模、补图或追加 |
| 完整交付/账本 | PASS（失败语义） | batch=quality_failed、customerUsable/downloads=0；300积分一次预留一次全额释放，净0；2次图片Provider，保守¥0.40，其他Provider0 |
| 浏览器/租户/幂等 | PASS | 1440/390px、刷新/历史、重复确认、owner/跨租户404、console0；任务/账本未增加，postflight Provider请求0 |
| 撤权/环境 | PASS | approval、consumed grant和临时脚本删除；正式stop/start后source/runtime=`690A35A6…`、source_fresh=true、media=disabled/max0 |
| 仓库门禁 | PASS | 图片/XHS/持久化/URL/媒体观测、API/Web/Agent typecheck、qa:fast/regression/full+build、git diff-check全部通过 |

结论：安全失败语义正确，P0=0；BY-26三张客户合格图与QA-20260827-012仍P1=1。本批不得追加真实调用，下一步只做`visible_text_or_brand_like`零Provider精度根因。

## BY-30 美业核心与兰琪可配置品牌包

- [x] 红灯：原 overview/shell 固定“美业智能体”，不存在服务端品牌配置、品牌邀请码归属、WorkBuddy品牌上下文或客户端伪造阻断。
- [x] 默认租户：显示“美业智能体”、默认绿色主题；响应和页面不含“兰琪”或 `lanqi-orange`。
- [x] 兰琪租户：一次性 beauty-industry 品牌邀请码写入租户归属；桌面1440和390px显示“兰琪”、纯文字标识、`lanqi-orange/#B94E0A`，刷新恢复且无横向溢出。
- [x] 租户/权限：品牌由服务端 tenant/product/credential 推导；伪造 `brand/brandCode/knowledgePackRef` 在Provider/AgentRun/积分预留前失败关闭；第三租户不能读取兰琪配置或知识。
- [x] 知识边界：`knowledgePackRef=null`、`authorized=false`、无候选知识/品牌事实/Prompt注入；移除兰琪注册后默认美业核心仍可运行。
- [x] Web/WorkBuddy：相同兰琪租户返回同一脱敏 brandContext，工具、capability、Skill、账本和历史合同不变；候选/个人Skill运行引用0。
- [x] 邀请/迁移：`InviteCode.brandCode`只允许 beauty-industry 的受控 `lanqi` 值；迁移双次幂等；邀请码明文不写仓库、日志或文档。
- [x] Provider/生产：文本与媒体Provider 0、费用¥0、媒体disabled/max0；未部署、不改DNS。

## BY-26 v2.3 `ui_layout` 精度闭环（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| Champion红灯 | PASS | SHA `63f63a70…3fe9` 在v2.2稳定拒绝；horizontal=0、vertical=7、panels=6、rowGroups=3、columnGroups=3，证明单向自然长边可误入旧panel-grid |
| 单变量Challenger | PASS | v2.3只要求panel-grid的horizontal≥1且vertical≥1；repeated-bars及其他检测分支未改，无SHA白名单 |
| 安全precision | PASS | 真实无字瓶罐/木架、既有安全图、瓶罐货架、建筑线条及变体共20/20通过 |
| 风险recall | PASS | 真实产品UI截图、卡片/按钮/边框、二维码/条码、文字/乱码/Logo、水印/UI及变体共54/54拒绝 |
| 稳定性 | PASS | 同一扩展集连续3次precision/recall=`1.000/1.000`，manual-review/fail-closed语义不变 |
| 相邻专项 | PASS | image-quality、generation-success、real-media零调用、持久化、URL、media-observability、XHS同页均PASS，Provider/网络0 |
| 仓库门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、git diff-check全部通过 |
| 页面/环境 | NOT RUN | 无Web/DOM/路由变化，按范围不重复E2E；受控环境未刷新，未来真实终验需新环境核对source_fresh |

结论：QA-20260827-010检测精度子范围P0/P1=0；BY-26三张客户合格图业务终验仍P1=1，本轮Provider/费用0、不部署。

## BY-26 v2.2 最终真实三图终验（安全失败，2026-08-27）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前硬门禁 | PASS | 新不可重放grant锁定wan2.7-image/prompt-v1.1/safety-v2.2、最多3任务、¥0.60≤¥1；source_fresh、DB、租户/entitlement、积分、成本与media max3通过 |
| 封面图 | PASS | 768×1024、SHA `872166db…e316`；技术、落盘、自动质量和人工只读可用性均PASS |
| 内容图 | FAIL-CLOSED | 768×1024、SHA `63f63a70…3fe9`；v2.2以`ui_layout`联合特征拒绝；人工只读未识别对应UI/水印，但没有覆盖正式门禁，登记QA-20260827-010 |
| 互动图/调用上限 | PASS | 内容图拒绝后立即停止；互动图未提交，无第3/4任务、重试、修复、换模、补图或追加 |
| 完整交付/账本 | PASS（失败语义） | batch=quality_failed、customerUsable/downloads=0；300积分一次预留一次全额释放，净0；2次图片Provider，保守¥0.40，其他Provider0 |
| 浏览器/租户/幂等 | PASS | 1440/390px、刷新/历史、重复确认、owner/跨租户404、console0；无重复任务或账本 |
| Postflight/撤权 | PASS | 2技术成功、1质量PASS、1拒绝、1未提交；资产SHA不变；grant删除，media恢复disabled/max0 |
| 仓库门禁 | PASS | precision 13/13安全、41/41风险；图片/XHS/持久化/URL/媒体观测、API/Web/Agent typecheck、qa:fast/regression/full+build、diff均通过 |

结论：安全失败语义正确，P0=0；三张客户合格图与QA-20260827-010仍P1=1。禁止追加真实调用，下一步只做ui-layout零Provider精度根因。

## BY-26 v2.2 边缘序列精度闭环（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| Champion 红灯 | PASS | SHA `fa9e11f9…2846` 在v2.1稳定命中corner edge-components与glyph-sequence；脱敏中间特征密度分别0.077/0.042，均无可读字符恢复 |
| 单变量 Challenger | PASS | v2.2仅为三类edge sequence增加像素密度≥0.09；无SHA白名单、无理由删除、无全局放宽 |
| 安全 precision | PASS | 真实安全瓶罐/自然纹理与合成安全负例13/13通过；原图已包含正式768×1024→384×512采样路径 |
| 风险 recall | PASS | 真实伪品牌/二维码样式、人物+伪标签及合成QR/条码/中文/英文/乱码/Logo/水印/UI共41/41拒绝 |
| 稳定性 | PASS | 精度专项连续3次 precision/recall=`1.000/1.000`，结果一致；manual-review/fail-closed语义不变 |
| 相邻合同 | PASS | 图片质量、generation-success、real-media、持久化、URL、media-observability、XHS同页均为零Provider PASS |
| 仓库门禁 | PASS | API/Web/Agent typecheck、qa:fast、qa:regression、qa:full+build、diff-check全部通过 |
| 页面/环境 | NOT RUN | 无Web、DOM、路由或环境配置变化；不重判历史批次、不刷新验收环境，既有客户资产仍保持原状态 |

结论：QA-20260827-009检测精度子范围P0/P1=0；BY-26三张客户合格图业务终验仍P1=1，本轮没有grant、Provider、费用或部署。

## BY-26 v1.1 最新真实三图终验（安全失败，2026-08-27）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前硬门禁 | PASS | 新不可重放grant锁定wan2.7-image/v1.1、3任务、¥0.60≤¥1；source_fresh、database、租户、entitlement、积分与media max3通过 |
| 封面图 | PASS | 768×1024，SHA `b51b92f0…f572`；技术、原子落盘、自动质量、人工只读可用性均通过 |
| 内容图 | FAIL-CLOSED | 768×1024，SHA `fa9e11f9…2846`；检测器以corner_watermark/edge_components和glyph_sequence拒绝；人工只读未识别出对应违规，登记QA-20260827-009，不以人工覆盖门禁 |
| 互动图与调用上限 | PASS | 第2张拒绝后立即停止；第3张未提交，无第3/4任务、重试、修复、换模、补图或追加 |
| 完整交付/账本 | PASS（失败语义） | 整批quality_failed、customerUsable/downloads=0；300积分一次预留一次全额释放，净0；2次图片Provider，保守¥0.40，其他Provider0 |
| 浏览器/租户 | PASS | 1440/390px、刷新/历史、重复确认、owner/跨租户404、console0、external0；数据库快照比较固定排序后复测PASS |
| 仓库门禁 | PASS | 图片质量/precision、generation-success、real-media、持久化、media-observability、XHS、API/Web/Agent typecheck、qa:fast/regression/full+build、diff |
| 撤权/停点 | PASS | 3017/5177按身份停止；approval/consumed grant删除；共享环境source_fresh、media disabled/max0 |

结论：三张客户合格图未达成，BY-26业务P1=1、P0=0；本轮授权耗尽，下一恢复点为SHA `fa9e11f9…2846` 的零Provider精度红灯。

## BY-26 一次生成成功率 Challenger（2026-08-27，零 Provider）

| 场景 | 结果 | 证据 |
|---|---|---|
| Champion 固化 | PASS | `beauty-image-provider-prompt-v1` 仅保存 SHA、角色、拒绝类型和合同布尔量，不保存客户输入、Prompt、Provider正文或任务ID |
| 修复前红灯 | PASS | 新专项稳定得到 `providerPromptVersion=undefined`，证明旧链无独立版本且产品/瓶罐正向主体缺少无标签包装面约束 |
| 单变量 Challenger | PASS | `v1.1` 仅对包装语义追加无标签中性容器/纯色哑光空白表面；非包装画面不追加，负向词结构逐字保持 |
| 版本与隐私 | PASS | job `promptVersion`/parameters钉死图片提示版本，文字Skill单独保留；客户页面不包含内部包装约束、提示版本、模型、Provider或成本 |
| 安全召回 | PASS | 安全12/12、风险40/40，precision/recall=`1.000/1.000`；真实二维码、伪品牌、乱码、UI/水印硬门禁未放宽 |
| 全量门禁 | PASS | 图片/XHS/持久化/媒体观测、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）、diff；Provider/网络0、费用¥0 |
| 本机环境 | PASS | 正式stop/start后3016/5176 source/runtime=`41E3B4BC…`、source_fresh=true、ready database/Web200、media disabled/max0 |

边界：离线测试证明提示合同的包装风险面已被确定性收紧，不等于已证明 `wan2.7-image` 的真实一次生成成功率；BY-26业务P1继续打开，未经新授权不做真实调用。

## BY-26 最新受控真实终验（2026-08-27）

| 场景 | 结果 | 证据 |
|---|---|---|
| Provider前费用门禁 | PASS | real模式要求正的人民币硬上限；3图预估按分精度为¥0.60，超限在积分预留/Provider前返回`media_cost_budget_blocked` |
| 顺序真实调用 | PASS（失败关闭） | 第1张完整质量PASS后才创建第2张；第2张真实伪品牌/可见文字被拒绝后第3张未提交，无第4张、无重试/补图/换模 |
| 三图客户完整交付 | FAIL（业务P1继续） | 仅第1张合格，第2张拒绝；整批quality_failed、customerUsable/下载0，不把部分成功冒充3/3 |
| 账本/幂等 | PASS | 300测试积分一次预留一次全额释放，净0；重复确认/postflight不新增任务、交易或余额 |
| 资产/租户 | PASS | 两个技术成功资产SHA保持不变；失败批次owner与另一个已获美业权限租户均404 |
| 页面 | PASS | live runner及只读Chrome桌面1440/390px、刷新/历史、无溢出、console0、external0 |
| 全量门禁 | PASS | 图片/XHS/持久化/URL/媒体观测、API/Web/Agent typecheck、qa:fast/regression/full、build、diff |

真实费用：`wan2.7-image` 2次，保守¥0.40；文本/视频/ASR/其他Provider0。本批授权已消费并撤销，BY-26业务P1仍为1。

## BY-29 小红书同页文生图交付合同（2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| 修复前红灯 | PASS | 新专项初始稳定失败 `buildBeautyImageDeliveryPlan is not a function`；页面曾暴露模型/制作提示词且文字运行与图片批次没有版本化安全关联计划 |
| 固定文字合同 | PASS | `beauty_xiaohongshu_package / acquisition:xhs / wechat-xhs-content-line@1.0.2` 链不变；标题/正文/5–8标签与图片仍来自同一 AgentRun |
| 图片关联计划 | PASS | `beauty-xhs-image-plan-v1` 固定标题关联、封面/内容/互动角色、3:4、纯画面与中文后期叠字；job保存 plan版本、标题hash、文字Skill版本、role/ratio |
| 客户输出隔离 | PASS | Web复制仅标题/正文/话题；主结果与quote DTO不含正负提示词、模型、Provider、人民币估算或Schema/Eval；WorkBuddy保持三层结构化合同且客户正文不拼内部审计 |
| 美业事实/版权合规 | PASS | payload逐图强制无人物/肖像、品牌/Logo、特定门店、文字/二维码/水印/UI、价格/疗效/案例；缺失授权不由模型补造 |
| 媒体与账本 | PASS（零调用） | 既有顺序最多3图、完整批次才结算、失败释放/补偿、原子持久化、客户资产授权和跨租户404门禁保持；Provider/外网0、费用¥0 |
| WorkBuddy候选隔离 | PASS | workflows/mcp-adapter 对 candidates/intake/quarantine 运行引用0；候选参考未复制或执行 |
| 真实浏览器 | PASS | 当前3016/5176真实Chrome桌面+390px：生成、同页计划、复制、保存、刷新、双击单请求、双租户、console0、external0 |
| 图片安全回归 | PASS | 登记真实安全/风险资产与合成变体：安全12/12、风险40/40、manual review边界PASS，precision/recall=1.000/1.000 |
| 全量门禁 | PASS | API/Web/Agent typecheck、XHS/媒体/WorkBuddy专项、qa:fast/regression/full+build、git diff --check |

## BY-26 官方资产URL修复后最终真实终验（质量硬失败，2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| URL/运行配置红灯 | PASS | 修复前缺少独立策略模块；实际 `apps/api/.env` 显式allowlist无 `oss-accelerate.aliyuncs.com`，旧专项替换validator，稳定复现“默认安全配置正确但受控runtime漂移” |
| URL安全绿灯 | PASS | `beauty-provider-asset-url-v1`接受官方accelerate/北京OSS；拒绝HTTP、凭据、非标准端口、IP、伪后缀、站外跳转；最多2跳逐跳复验；real启动漏域在Provider前阻断 |
| Provider顺序/预算 | PASS（边界） | `wan2.7-image`实际task=2、技术成功2；第2张质量拒绝后第3张未提交，无第4张、自动重试/修复/换模/补图/追加=0；保守¥0.40≤¥1 |
| 图片1 | PASS | 768×1024，SHA `d2af33e6…ebf3d`；自动安全PASS、人工可用性批准；因整批失败仍不形成客户资产 |
| 图片2 | REJECT（正确失败关闭） | 768×1024，SHA `229661b3…1ed9f`；`interface_or_watermark_like`，人工只读复核见伪文字/伪品牌标签及人物照片 |
| 图片3 | NOT RUN | 前图硬失败后无Provider task id，符合顺序停止合同 |
| 账本/幂等 | PASS | 300测试积分一次预留一次全额释放、净0；重复确认/两次postflight不新增Provider task、交易或余额变化 |
| 客户资产/租户 | PASS（失败态） | batch=`quality_failed`、customerUsable/download=0；owner与跨租户均404，两个审计资产保持SHA不变 |
| Web E2E | PASS（失败态） | 真实Chrome桌面1440与390px、刷新、重复确认、无横向溢出、console0 |
| 全量门禁 | PASS | URL策略、持久化13夹具、质量/precision、real-media、media-observability、API/Web/Agent typecheck、qa:fast/regression/full+build；调用后postflight补强后复跑PASS |

## BY-26 v2.1 密钥恢复后的最终真实三图终验（资产URL失败关闭，2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| 凭据/环境预检 | PASS | 仅 `apps/api/.env` 进程内注入；双变量非空、同值、`sk-`形态；根`.env`无回退；3017/5177、DB55434、绝对bootstrap、PID/listener、source/runtime=`77382065…`一致 |
| Provider与顺序 | PASS（安全边界） | `wan2.7-image` task=1，终态`SUCCEEDED`；第2/3张未提交，无第4张、无重试/修复/换模/补图/追加；其他Provider=0 |
| 资产持久化 | FAIL-CLOSED | 首图 `beauty_media_asset_url_rejected`，stage=`url_validation`，retryable=false；文件0、SHA/尺寸不可用，未进入自动质量或人工审批 |
| 客户交付 | FAIL-CLOSED | batch=`quality_failed`、customerUsable=0、预览/下载0；3/3客户合格图未形成，成功态选择/保存/下载不得宣称通过 |
| 账本/费用 | PASS | 图片300测试积分一次预留一次全额释放、净0；图片Provider保守¥0.20≤¥1；controlled_mock文本Provider=0（前置测试运行按既有合同结算8测试积分） |
| Web/租户/幂等 | PASS（失败态） | 真实Chrome桌面/390px、刷新、重复确认、双租户404、console0；Provider task总数保持1 |
| 调用后回归 | PASS | 图片质量、precision/recall、持久化、real-media、media-observability、workspace API/Web/Agent typecheck、qa:fast/regression/full+build、diff全绿；新增外部请求0 |
| 撤权/停机 | PASS | approval与consumed grant删除；隔离API/Web及共享DB环境正式停止，3016/3017/5176/5177/55434监听0 |
| 业务放行 | P1 OPEN | 三图交付未达成；先做零Provider的Provider资产URL/严格白名单可观测与适配，不重查旧task、不追加调用 |

## BY-26 v2.1 最终真实三图终验（Provider前凭据阻断，2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| v2.1精度/召回 | PASS | 真实自然纹理负例与安全变体12/12；风险正例40/40；历史风险资产继续拒绝；precision/recall=1.000/1.000 |
| 逐图人工前置 | PASS | 修复前real-media红灯命中缺少operator gate；默认关闭的隔离验收门禁要求自动质量+人工可用性后才提交下一任务，拒绝即整批失败 |
| Provider预检 | FAIL-CLOSED | 受控配置与进程/用户环境均无非空`ALIYUN_API_KEY`/`DASHSCOPE_API_KEY`；隔离API/Web未启动，grant未消费 |
| 调用/费用/账本 | PASS | Provider任务0、图片0、文本/视频/ASR0、费用¥0、测试积分预留/结算/释放均0 |
| 自动门禁 | PASS | 图片质量/持久化/real-media/media-observability、API/Web/Agent typecheck、qa:fast/regression/full（含build）PASS |
| 页面成功态 | NOT RUN | 无Provider配置，不能合法产生三张；桌面/390px、下载/刷新/跨租户成功态不得伪报 |
| 撤权/停机 | PASS | approval与未消费grant删除；正式stop后3016/3017/5176/5177/55434监听0；未部署 |
| 业务放行 | P1 OPEN | 三张真实客户合格图仍未形成；需正式受控百炼媒体密钥后恢复同一授权边界 |

## BY-26 角落自然纹理误报精度闭环（零 Provider，2026-08-27）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（预期失败） | SHA `5181dade…653a` 只命中右下 `corner_watermark`；组件覆盖率0.072，亮点密度0.043/每活跃行约4.5像素，证明自然叶片被两个弱证据串联误报 |
| 安全负例 | PASS | 真实自然纹理原图/缩放/低对比、既有安全瓶罐与合成空白标签/矩形/自然高光共12/12 PASS |
| 风险召回 | PASS | QR、条码、文字/乱码、Logo、暗/亮水印、界面角标、UI及缩放/旋转/低对比共40/40 REJECT；历史三风险资产3/3 REJECT |
| 精度与稳定性 | PASS | precision/recall=`1.000/1.000`，修复后专项连续3次一致；不确定证据仍 `manual_review_required` 且客户不可见 |
| 交付与隔离 | PASS | real-media、持久化11阶段、质量状态/客户资产404、租户/账本/幂等合同未放宽；Provider/外网0、费用¥0 |
| 浏览器只读恢复 | PASS | 当前源码隔离3017/5177，桌面1440、390px、刷新/历史、客户下载0、owner/cross-tenant404、账本变化0、console0、external request0；验收后受控停止 |
| 全量门禁 | PASS | API/Web/Agent typecheck、图片/媒体专项、美业全专项、`qa:fast`、`qa:regression`、`qa:full`（build）与 `git diff --check` |

## BY-26 BY-27 后最终真实三图终验（安全失败，2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| 授权/报价 | PASS | 用户本次硬上限¥1；runner锁定更严格的`wan2.7-image`最多3张/¥0.60、300测试积分、其他Provider0、重试/修复/换模/补图/追加0；一次性grant已消费并删除 |
| 顺序/调用 | PASS | Provider task=1；首图质量失败后后两图未提交，无第2/3/4次调用；保守费用¥0.20 |
| 持久化 | PASS | 首图完成BY-27原子落盘和校验，768×1024、SHA `5181dade…653a`；postflight两次复核资产不变 |
| 真实客户质量 | FAIL-CLOSED | v2命中`corner_watermark/interface_or_watermark_like`，confidence0.96、bbox `(416,966,304,14)`；batch=quality_failed、customerUsable/download=0。人工目视不能覆盖门禁 |
| 提示词/事实/合规 | PASS | 同一全合成皮肤管理产品/附近女性顾客任务；纯画面及无文字/Logo/品牌/二维码/条码/水印/UI负向payload保持；未出现价格、疗效、门店、顾客或案例事实 |
| 账本/幂等 | PASS | 300一次预留、一次release；consume300+refund300、净0；重复确认/postflight不新增任务、交易或余额变化 |
| Web/租户 | PASS（失败态） | 真实Chrome桌面/390px、刷新/历史、重复确认、双租户404、console0；失败批次无选择/保存/下载入口。三图成功态不能宣称已真实通过 |
| 全量门禁 | PASS | precision/recall、质量、持久化、real-media、media-observability、API/Web/Agent typecheck、qa:fast/regression/full+build、diff全绿 |
| 撤权/环境 | PASS | grant与`.env.media-approval`删除；media disabled/max0；source/runtime=`9134655C…`、source_fresh=true，不部署 |
| 业务放行 | P1 OPEN | 三张真实客户合格图未达成；新首图暴露角落纹理/水印检测误报风险，需先零Provider红灯，授权耗尽不得追加调用 |

## BY-28 直播复盘验收目标漂移 P1（完成，2026-08-27）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 修复前红灯 | PASS（红灯有效） | Web默认命令连续3次在租户前连接旧3017失败；WorkBuddy稳定ECONNREFUSED；显式3016则产品全路径连续3次PASS |
| 默认目标/静态门禁 | PASS | Web与WorkBuddy默认3016，显式环境覆盖保留；专项禁止3017再次成为默认值 |
| API失败关闭 | PASS | `/ready ok/database`在租户、浏览器、业务运行前核验；不可用39999精确stage=connect，租户/浏览器/Provider0 |
| Web真实路径 | PASS | 默认命令连续3次：桌面1440、390px、CSV解析、八模块、刷新、返回、第二租户隔离、console0、external0 |
| WorkBuddy/账本/幂等 | PASS | 正式live_review Schema、scope、唯一AgentRun、重复requestId单结算、缺合同/伪造身份失败关闭、controlled mock、付费Provider0 |
| 相邻与全量门禁 | PASS | 全结果矩阵、视频内容复盘、导航、MCP platform、API/Web/Agent typecheck、qa:fast/regression/full（含build）、diff全绿 |
| 费用/环境 | PASS | 外网与真实Provider0、费用¥0；产品运行源码未改，受控环境继续source_fresh=true、media disabled |

## BY-27 图片资产持久化分段可观测 P1（完成，2026-08-27）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 修复前红灯 | PASS（红灯有效） | 旧资产服务缺显式阶段合同，路由压平为 `asset_persistence_failed` 并把终态设为可恢复；新增专项稳定 FAIL |
| 合成成功链 | PASS | PNG、元数据各写临时文件并各自原子提交；不直写客户最终文件，外网/Provider0 |
| 分段失败矩阵 | PASS | URL、请求、HTTP、类型、大小、路径、目录、图片写、元数据写、图片提交、元数据提交共11夹具逐项返回稳定stage/code/retryable；503仅保留HTTP状态 |
| 失败关闭/隐私 | PASS | 任务参数只保留stage/code/retryable/httpStatus；不保存URL/查询参数/正文/Prompt/原始响应/密钥/路径；旧终态不重查、不重试、不补图 |
| 账本/幂等/租户 | PASS | 历史真实失败批次只读恢复，Provider task与3个job均无变化、credit transaction无变化；客户资产owner/cross-tenant均404 |
| 页面/E2E | PASS | 当前源码真实API+DB+Chrome桌面1440与390px、刷新、历史终态、无下载/恢复按钮、无横向溢出、console0、external0 |
| 全量门禁 | PASS | 美业Web合同矩阵、real-media、媒体观测、API/Web/Agent typecheck、qa:fast/regression/full（含build）、diff全绿 |
| 费用/环境 | PASS | Provider/外网0、费用¥0；media disabled/max0；source/runtime=`45531B29…`且source_fresh=true |

## BY-26 v2 检测器授权后真实三图终验（资产失败关闭，2026-08-27）

| 领域 | 结果 | 证据 |
| --- | --- | --- |
| 授权/报价 | PASS | 新不可重放grant、同一全合成XHS任务、`wan2.7-image`、最多3张/¥0.60；300测试积分；重试/修复/换模/补图/追加=0 |
| 顺序与上限 | PASS | Provider子任务=1；前一任务未形成客户可用资产后立即停止，后两项`providerTaskId`为空，无第2/3/4次调用 |
| Provider/存储终态 | FAIL-CLOSED | 首任务 Provider=`SUCCEEDED`，本地任务=`failed/asset_persistence_failed`、资产=`unavailable`；没有文件可供v2质量筛查。下载安全校验/下载/类型/大小/写盘的具体子原因未被当前日志保留，证据不足时不猜测 |
| 客户交付 | PASS（安全）/ FAIL（业务） | batch=`quality_failed`，customer assets/download=0；没有把技术成功冒充客户可用，也没有人工目视放行 |
| 账本/幂等 | PASS | reservation=`released`、amount300/actual0；consume300+refund300、净0；重复确认不新增任务或交易 |
| Web/移动端/租户 | PASS | runner覆盖桌面、390px、刷新、重复确认、双租户404、console0；客户图片0 |
| 费用/外部调用 | PASS | 图片Provider任务1，保守¥0.20≤¥0.60；文本/视频/ASR/其他Provider=0；postflight Provider调用0 |
| 撤权 | PASS | grant和`.env.media-approval`删除；正式stop/start恢复media disabled/max0，不部署 |
| 业务放行 | P1 OPEN | 三张真实客户合格图未达成；先零费用补资产持久化分段可观测与失败夹具，旧任务不得重查/重试 |

## BY-26 本地图片质量检测误报精度闭环（零 Provider，2026-08-27）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 修复前真实误报 | PASS（红灯有效） | SHA `f408e29e…f24e` 的无可见文字瓶罐静物被旧通用对比度/transition规则同时误判三类风险；局部 bbox 落在瓶罐、托盘和自然纹理 |
| 真实资产 precision/recall | PASS | 安全首图 PASS；指定坏图 `0e70f36a…a0ae86` REJECT；三张历史风险资产 3/3 REJECT 且不改文件/SHA |
| 合成负例 | PASS | 9/9：几何瓶罐、空白标签、矩形色块、自然高光及缩放/低对比，误报0，precision=1.000 |
| 合成风险正例 | PASS | 32/32：QR、条码、英文/中文样式/乱码、Logo、水印、UI及缩放/轻旋转/低对比，漏报0，recall=1.000 |
| 不确定证据 | PASS | 模糊字形夹具=`manual_review_required`；API/UI不把它称为确定违规，但客户预览/下载仍关闭 |
| 可观测/隐私 | PASS | detector/confidence/bbox/有限几何指标持久化并在折叠审核展示；无正文、Prompt、密钥、Provider原始响应 |
| 媒体/账本/隔离 | PASS | 三图完整交付、顺序停止、无重试、质量失败补偿、整批成功才下载、跨租户404合同未放宽；Provider=0、费用¥0 |
| 门禁 | PASS | 图片精度/历史资产/real-media/媒体观测/fixed-route/XHS交付、API/Web/Agent typecheck、qa:fast/regression/full+build、diff 全绿 |

## BY-26 修复后真实三图终验（安全失败，2026-08-27）

| 领域 | 结果 | 证据 |
|---|---|---|
| 授权/报价 | PASS | 新不可重放grant已消费；官方北京地域版本化报价¥0.20/张，最多3张/¥0.60；重试/修复/换模/追加0 |
| 顺序调用 | PASS | Provider task=1；首图技术成功后立即质量拒绝，后两图Provider task id为空并本地终止，无第2/3/4次调用 |
| 真实质量门 | FAIL-CLOSED | 1张768×1024，SHA `f408e29e…f24e`；风险码为QR/条码样式、文字/品牌样式、界面/水印样式；customerUsable=0、批次quality_failed |
| 账本/幂等 | PASS | reservation released/actual0；consume300+refund300、净0；重复审计/确认不新增任务、交易或余额变化 |
| 资产/租户 | PASS | 原图SHA前后不变；客户预览/下载0，owner与cross-tenant均404；仅内部审计资产保留 |
| Web/移动端 | PASS | 真实API+DB+Chrome桌面/390px、刷新、折叠审核、无横向溢出、console0、external request0 |
| 媒体恢复 | PASS | 一次性授权材料已消费，`.env.media-approval`删除；环境media=disabled/max0，不能再次点击调用 |
| 业务放行 | P1 OPEN | 安全门禁正确阻断，但三张客户可用结果未达成；本地筛查存在偏保守/误报风险，未经新授权不再调用 |

## BY-26 真实图片客户质量门禁 P1（完成，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 先命中缺少 `assessBeautyImageSafety`，随后命中路由缺少 `visual_quality_rejected`；证明旧链只有 Provider/尺寸/持久化技术成功，没有客户视觉质量状态 |
| 离线图片风险筛查 | PASS | 合成纯画面通过、QR fixture 拒绝；历史三资产逐图检查 assets=3/rejected=3，指定 SHA `0e70f36a…e86` 命中；边界固定为确定性风险筛查，Provider/网络0 |
| Prompt/Provider payload | PASS | 三套制作说明均注入纯画面正向约束、完整文字/字母/数字/Logo/品牌/二维码/条形码/水印/UI负向词；`negativePrompt` 真正进入百炼 payload，`watermark=false` |
| 状态机/客户资产 | PASS | 技术状态3/3 succeeded、质量状态3/3 rejected、customerUsable=0、batch=`quality_failed`；同租户资产与下载404，跨租户404；原三文件SHA前后一致 |
| 账本/幂等 | PASS | settled 300测试积分新增一次 compensation refund，reservation=`compensated/actualAmount=0`，净测试积分0；两次审计及两次恢复不新增交易/任务，不伪造Provider退款 |
| Web/历史/移动端 | PASS | 隔离Chrome桌面+390px、刷新恢复、三张隔离卡、审核默认折叠、图片0、下载0、无横向溢出、console=0、external requests=0 |
| 零调用门禁 | PASS | 媒体仍 disabled/max=0；本修复Provider/外网0、费用¥0；历史3个Provider任务与保守成本¥0.60仅保留审计事实 |
| 全量门禁 | PASS | real-media、media-observability、Web合同、API/Web/Agent typecheck、qa:fast/regression/full（含build）、diff PASS |
| 环境 | PASS / ONLINE | PostgreSQL55434/PID11256、API3016/PID33508、Web5176/PID13852；source/runtime=`A572415B…`、source_fresh=true、ready database=true、Web200、text controlled_mock、media disabled |

## BY-25 视频数据复盘与美业销售真实用户路径 P1（完成，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 用户失败复现 | PASS（红灯有效） | 新鲜 runtime 先命中视频 `rubric_fact_retention_weak`、销售 `missing_contract_terms_话术`；用户同一 CSV 复测又命中 `foreign_industry_or_internal`。脱敏 DB 审计均为一次预留/一次等额释放、AgentRun 0 |
| 视频真实文件链 | PASS | 用户同一 CSV SHA `c87b4306…d1f`（15列/122行）走上传→解析receipt→新requestId→API→DB→DOM；只允许 direct report 引用当前事实源逐字支撑的行业词，仍阻断内部/模板污染；12个正式报告段与核心数值完整，Provider 0 |
| 销售两阶段合同 | PASS | 快速模式返回 `quick_response` 与默认只复制的可发送回复；专业模式缺 project/priceBoundary/customerConcern/communicationStage/allowedNextAction 时在 reservation 前 422，补齐后返回 `professional_advice` 完整策略；不补造项目、价格、顾客或预约信息 |
| HTTP/DB/幂等/租户 | PASS | 真实页面 POST 形成唯一 succeeded AgentRun 与 settled reservation；双击仍 1 请求/1任务/1结算；第二租户历史为空 |
| WorkBuddy | PASS | platform + 隔离 DB smoke；视频和销售复用同一执行/结果合同，销售显式区分 quick_response/professional_advice；XHS 三层结构保持不变 |
| 浏览器矩阵 | PASS | XHS/选题/内容系统/视频数据/视频内容/直播话术/直播复盘/销售，桌面+390px、深链、保存/刷新/历史/返回，console=0、external requests=0 |
| 图片真实技术链 | PASS / 客户质量 FAIL-CLOSED | 授权内 `wan2.7-image` 3/3技术成功、768×1024、无第4任务、300积分一次结算、保守费用¥0.60；第二张含二维码样式与伪品牌文字，媒体恢复 disabled，残余 P1=1，不追加调用 |
| 全量门禁 | PASS | API/Web/Agent typecheck、qa:fast/regression/full（含 build）、相关专项和 diff PASS |
| 环境 | PASS / ONLINE | PostgreSQL55434/PID5628、API3016/PID30828、Web5176/PID30888；source/runtime=`2E4C2715…`、source_fresh=true、ready database=true、Web200、text controlled_mock、media disabled |

## BY-21/BY-23/BY-24 系统性输出、视频信息架构与运行资产治理（完成，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 受控输出矩阵 | PASS（自动） | 8 个固定 workflow 各有独立 controlled fixture 并通过自己的正式 output contract；未知固定美业 capability 抛 `controlled_beauty_capability_fixture_missing`，不进入旧九件套 |
| 用户结果分层 | PASS（自动） | XHS/选题/内容系统区分客户成品、制作/策略说明、默认折叠审核；当前事实保留、复制污染、Markdown管道、mock/待补/Schema/Eval内部词均有红绿灯 |
| 数据/媒体/直播能力 | PASS（自动） | 视频数据、视频内容、直播复盘与销售专项覆盖正式字段、证据边界、结构、历史/刷新、失败关闭和Provider0；未降低BY-13/15/16合同 |
| 视频获客信息架构 | PASS（静态） | 六卡、内容 canonical/旧别名、复盘二级页、爆款复刻规划页、两个复盘旧深链、query/apiBase、390px与规划页零副作用均有专项 |
| 运行资产唯一映射 | PASS | 8 capability 唯一 tool/scope/workflow/Skill chain/output contract/renderer；10 正式 Skill 的 manifest/contract版本与双目录SHA-256由 `runtime-assets.json` 锁定 |
| WorkBuddy隔离/部署包 | PASS | 运行源码和现有 build 对 candidates/intake/quarantine、个人 `.codex/skills` 引用0；`ORIGINAL_SKILL_ROOT` 默认只指 `mcp-skills/skills` |
| 历史与去旧 | PASS（非破坏） | AgentRun/Step按记录skill/version/output只读，旧content-ten仅URL别名；日报1.0.0保持PAUSED；无物理删除，safeCandidates空 |
| 兰琪四样例质量门禁 | PASS | 修复前 `quality:assets` 8条缺段错误；只规范四份正式sample-grade标题后PASS，未改运行Prompt/合同/样例正文 |
| 本机环境身份 | PASS / ONLINE | 旧状态源码`8F36BA23`、runtime`56957C79`、`source_fresh=false`红灯已关闭；正式stop/start后PostgreSQL55434/PID33996、API3016/PID14984、Web5176/PID35148，source=runtime=`DDA04BBF…`、source_fresh=true、ready database=true、Web200 |
| 最终门禁 | PASS | API/Web/Agent typecheck、qa:fast/regression/full（含build）、governance、diff PASS；真实Chrome XHS/选题/内容系统/视频数据/内容/直播复盘/导航桌面与390px PASS，保存/刷新/历史/返回/双击/跨租户、console=0、external provider=0 |

## BY-20 美业 AI 日报第一阶段（最后一次真实来源终验 fail-closed，PAUSED，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 六域 parser 修复前红灯 | PASS（红灯有效） | 旧实现把整页导航 AI 词与页脚日期拼入证据，普通会议通知被误判为合格文章；专项首跑稳定 FAIL。旧 `article_contract_rejected` 又无法拆分日期/正文/AI原因 |
| 六域显式 adapter | PASS（离线） | 六个授权域均绑定唯一列表入口与 regulator/research/industry_media 分类；未增加域名、selector、Cookie、登录或反爬；CAICT 412 继续 `adapter_required` |
| 日期/正文/AI精确解析 | PASS（离线） | RSS/Atom、属性顺序无关 meta、JSON-LD headline/datePublished/articleBody、time datetime、article/itemprop/main、剔除导航后的body、相对链接/最近日期/同域canonical覆盖；缺日期/正文/AI/过期/未来/合规逐类失败 |
| 六域结构变体矩阵 | PASS（零网络） | 每域正常、空、变体、缺日期、缺正文、站内302、412、404；历史0/2候选分布fixture固定29 HTTP与精确拒绝。注入 fetch，外网/Provider/费用0 |
| 三轮真实 parser 归因 | PARTIAL（证据不足） | 第三轮候选 `0/1/0/0/85/114`、逻辑详情 `0/1/0/0/10/10`、合格 `0/0/0/0/2/0`；旧日志只有通用拒绝，日期/正文/AI占比未知，禁止猜测真实供给或承诺必达15 |
| 最后一次终验 | FAIL-CLOSED（已消费） | grant `by20-manual-20260826-28a0f3febeb14695` 新增HTTP29、同日累计123/130；72h合格1，模型/AgentRun/账本/费用0。绝不第五次，BY-20=PAUSED |
| 本机免邀请码入口 | PASS（真实Chrome） | localhost开发入口一键创建全合成beauty-industry租户；刷新会话恢复、390px无溢出、console error=0、Provider请求=0，token未输出或进入URL |
| 既有功能集成 | PASS（美业范围） | BY-13/14/15/16/17/18统一Web/运行时专项PASS；导航、XHS、视频内容、直播真实Chrome PASS，选题2/4与视频数据合同/路由/390px覆盖PASS；API/Web/Agent typecheck、qa:regression、build、diff PASS |
| 全仓快速/完整门禁 | BLOCKED（既有独立资产） | `quality:assets`/qa:fast/full被4份未提交兰琪总部正式包sample-grade缺“用户输入/样板输出”阻断；不属当前美业范围，本轮未混改，不能标PASS |
| 本机环境身份 | PASS / ONLINE | PostgreSQL55434/PID22092、API3016/PID24184、Web5176/PID10556；runtime=listener，指纹`56957C79…`，controlled_mock/媒体disabled/日报disabled，费用¥0 |
| 修复前红灯 | PASS（红灯有效） | 新专项首跑稳定命中 `AssertionError: 美业日报仍使用旧规划名称`；源码审计锁定通用日报静态 fallback、Web 离线造日报、假历史和缺少美业唯一日键/调度合同 |
| 两层事实合同红灯 | PASS（红灯有效） | 六域通用 AI 模型新闻具备 URL/日期/AI 事实但无美业词时旧 parser 返回 `undefined`；与同日真实终验 21 个详情均 `article_contract_rejected` 一致 |
| 新闻来源事实层 | PASS（合成） | 21/21 通用 AI 详情进入来源池；非 AI 仍拒绝。保留 `sourceFacts/sourceIndustry/directBeautyEvidence`；虚构美业事实、无来源数字、事实不接地失败关闭 |
| 美业解释/行动层 | PASS（合成） | 固定 `inferenceLabel=beauty_interpretation`、思潼点评、可能影响、适用条件、建议验证；未标记推断、跨行业冒充美业案例失败关闭 |
| RSS/Atom/HTML parser | PASS（离线） | RSS item、Atom entry、通用 `<a>`/邻近日期进入同一六域公平调度和预算；无隐藏请求、无新域名、真实网络0 |
| 正式结构/Eval | PASS（合成） | 严格 15 条/5 版块/每版块 3 条、3 趋势、1 动作；逐条 URL/日期/状态/美业标签、70–120 摘要、50–90 点评；缺字段、重复、跨行业、事实不符、医疗/疗效污染失败关闭 |
| 来源窗口 | PASS（合成） | 截至北京时间 09:00 优先 24h；不足扩到 72h；72h 仍不足返回 `source_insufficient`，不凑数；404/不可访问、无日期、过期、无权威证据分别被拒绝 |
| 时区/调度 | PASS | 08:59 不运行、09:00 scheduled、09:01 catchup；成功/活动任务不补跑；跨月、跨年、闰日和 UTC→Asia/Shanghai 业务日期断言通过，下次计划时间明确 |
| 多实例/恢复/账本 | PASS（PostgreSQL） | 5 并发排队仅 1 snapshot/task，2 worker 仅 1 claim；过期且 Provider=0 租约可恢复，终态不明不自动重试；controlled mock reservation/model/network/cost 均为 0 |
| API/Web/WorkBuddy | PASS | entitlement + owner/admin、固定 capability/scope/tool、同一服务/状态；加载、空、排队/核验/生成、来源不足、错误/重试、历史/刷新恢复；disabled 模式不公开工具或执行入口 |
| 页面/E2E | PASS | 当前源码 3022/5177：桌面 15 条/5 版块/15 来源链接，controlled notice，刷新历史，390px 无横向溢出/移动导航，双租户复用公开快照且无租户名泄漏，console errors=0 |
| 全量门禁 | PARTIAL | 日报合同/DB/浏览器专项、fixed-route、API/Web/Agent typecheck、`qa:regression`、独立 build、`git diff --check` PASS；当前 `qa:fast/full` 被四份独立兰琪总部样例格式阻断，不得标全绿 |
| 真实来源终验 | FAIL-CLOSED | 首次36 HTTP得1条；前一人工新增29后0条；两层合同修复后的新grant再新增29后72h仅2条，三轮累计94/101。三轮DeepSeek=0、AgentRun/账本=0、费用¥0、未发布/部署 |
| 域名配额/错误归因 | PASS（合成+真实计数）/来源仍不足 | 修复前六域 `30/0/0/0/0/0`；同日真实复验 per-domain HTTP=`1/2/1/1/13/11`，逻辑详情 miit/leiphone/tmtpost=`1/10/10`，单域上限10生效；caict 412=`adapter_required`，白名单内302逐跳计数 |
| 来源多样性 | PASS（合成）/待真实终验 | 候选池至少4域且含监管/研究/行业媒体；正式15条任一域≤6、每版块≥2域。单媒体垄断、缺监管或研究来源均失败关闭，不放宽事实/时间/美业/合规门禁 |
| WorkBuddy Skill 候选隔离 | PASS（静态） | BY-20 产品/路由/server/Agent/Skill/专项对 `mcp-skills/candidates|intake` 与 `candidates/workbuddy` 引用为0；正式 `mcp-skills/skills/ai_daily_brief` 和包内副本均为普通目录、无软链。未迁移历史候选 |
| 费用/开放状态 | PASS（费用门禁）/来源终验失败 | 同日人工 grant Provider/媒体=0、费用 ¥0；live scheduler/nav/WorkBuddy 正式工具/生产部署继续禁用。QA-20260826-003 未关闭，BY-20 P0=0、残余 P1=1 |
| 同日人工 grant | PASS（安全） | 新grant `by20-manual-20260826-11987f9de6ee476a` 创建即消费；运行前数据库核对既有累计65/模型0，每次新请求以全日预留原子计数，新增29、累计94≤101。未清零/覆盖旧审计，无Web/WorkBuddy参数，生产36 HTTP/日不继承101次例外 |
| 全量门禁（本次） | PARTIAL | grant/live/API typecheck与diff PASS；真实来源失败后按停止条件未进入四份兰琪质量资产修复、qa:fast/full、集成部署或公网验收 |
| 页面/E2E（本次新字段） | PARTIAL | Web typecheck/静态合同/build PASS；浏览器脚本已补异步加载等待，但当前审计库同日失败快照+disabled runtime不能在不删除证据/改授权时生成受控15条，故未冒充桌面/390px绿灯 |
| 环境停点 | PASS | 指纹短值 `0FA06D60`；正式 stop 前 API `3016/PID30200`、Web `5176/PID20652`、PostgreSQL `55434/PID26804` 身份一致；stop exit 0 后三个端口监听与三个 PID 均为 0，审计数据库保留 |
| 第三次环境停点 | PASS | 新受控根指纹 `4CCA349B`；正式stop前API `3016/PID18504`、Web `5176/PID29920`、PostgreSQL `55434/PID6492` 身份一致；stop exit0后端口监听与PID均0，第三次审计数据库保留 |

## BY-19 Get笔记同步性能与可观测性（真实基线范围预检 fail-closed，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | `beauty-industry:getnote-sync-p1-smoke` 首跑因不存在 `KnowledgeSyncJob` 稳定 FAIL；既有现场同步 POST 约 53.616 秒后才返回，且无阶段/计数 |
| 非阻塞/单飞/恢复 | PASS（离线） | POST 202；PostgreSQL partial unique index 限定 tenant+connection 的 queued/running 唯一；P2002 竞态复用；90 秒无心跳进入 interrupted；GET connection/job 状态恢复 |
| 增量/幂等 | PASS（合成） | 同更新时间跳过详情；变化项读取详情；同 hash 跳过持久化；文档 unique(connectionId,externalId)；部分详情失败不推进 cursor；远端缺失不删除 |
| 限流/失败 | PASS（合成） | 350ms 详情节流保留；429 首次 500ms 指数退避；5xx 最多 4 次；不可重试 400 只请求 1 次；授权/限流/临时/未知分类保持 |
| 可观测/脱敏 | PASS | accepted + listing/details/throttling/backoff/parsing/persisting/binding/terminal；扫描、处理、新增、更新、无变化、跳过、失败、请求/重试/节流/退避和耗时；请求 ID 仅保存 16 位 SHA-256 指纹，合成正文/凭证不进观测 |
| Web 入口/刷新 | PASS（代码+页面） | KnowledgeBase、EnterpriseKnowledgeBase、AgentProducts drawer、TopicSystemWorkbench 共用 `knowledge-sync.ts`；轮询稳定任务 URL，刷新恢复；桌面/390px真实空连接入口、无横向溢出、console error=0 |
| 性能目标 | PASS（确定性）/待真实基线 | 20 次无变化合成同步详情请求=0，P95≤5秒；POST 架构在外部读取前返回 202。真实 Get笔记网络与服务限流已获授权，但因测试账号范围无法在网络前证明而未验证 |
| 真实范围预检 | FAIL-CLOSED（无网络） | 用户已授权，但本地只找到 3 条各 99 文档的既有连接；CLI 凭据与它们不同却没有测试账号标签或最多 10 条合成 note id/hash 清单，无法在远端读取前证明授权范围。同步任务 0、Get笔记请求 0、正文读取 0 |
| 全量门禁 | PASS | 专项、Get笔记 credential/classification、API/Web typecheck、Prisma generate、`qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` |
| 费用/环境 | PASS（零费用） | Get笔记真实请求 0；文本/图片/视觉/视频/ASR/媒体 Provider 0；费用 ¥0；本轮只启动已识别的验收 PostgreSQL 55434/PID19436 做本地预检，完成后按正式 `pg_ctl` 停止；API/Web/浏览器均未启动；未部署 |

## BY-18 选题 2/4 来源合同与错误归因闭环（完成，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 指纹 `4e78048f026175e8` 现场为 2/4、路由正确却命中 foreign/internal；新增专项先证明 API 缺 pollution 分类，再以合成 `验收A店` 锁定 raw categories=0、postprocess=`acceptance_tenant_marker`；数据库链另证明共享模板把 2/4 改成 0/4 |
| 2/4 与 4/4 合同 | PASS | controlled mock 经正式 `baolu_topics@2.1.2` Schema/Eval；2/4 输出 10 行正式表格、只标真实可用来源，缺失两项明确待补；4/4 全部已启用；零来源 Provider 前 422 |
| 污染/结构门禁 | PASS | 内部/历史/合成 identity 中和为“本店”，不改真实业务字段；污染、矛盾、跨行业、结构缺失仍失败关闭；残缺 Provider 结果不再由共享模板覆盖 |
| 错误归因 | PASS | `preflight/pollution/structure/provider/timeout/cancelled/validation` 各有稳定安全 code/category 和可操作提示；不返回 Prompt/原始输出/客户内容，不再把污染、结构、Provider 统一误报补来源 |
| Web/WorkBuddy/账本 | PASS | 两入口共用结构化 topicWorkflow；数据库专项覆盖 scope、租户、权限、撤销、幂等、唯一结算、失败/取消/超时释放；历史与刷新恢复保持 |
| 页面/E2E | PASS | 独立 3021/5176 controlled mock：桌面 2/4 TOP10、保存、刷新/历史；390px 宽度 375=375、移动导航展开/关闭；console warning/error 0 |
| 全量门禁 | PASS | topic/evidence/facts/workbench/fixed-route/composition/web-contract、API/Web typecheck、MCP database、`qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` |
| 费用/环境 | PASS（零费用） | 真实文本/图片/视频/ASR/媒体 Provider 0、费用 ¥0、未部署；最终源码指纹 `3F5615DA…` 的 3021/PID13868、5176/PID10332 按 BY-18-v2 独立 runtime 双重身份停止，端口与相关 Node 进程清零，PostgreSQL55434/PID2992 保留 |

## BY-17 小红书受控验收输出与正式合同闭环（完成，2026-08-26）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 指纹 `2132b435a0a829a1` 首跑稳定 FAIL：缺 `后期叠字、待补、互动与承接、事实与合规待补、负向提示词、视觉参数`，并触发事实保留/老板可用性硬失败 |
| 正式 Skill/Schema/Eval | PASS | 固定 capability/scope/Skill 三段链不变；controlled mock 经与正式模型相同的 `beauty-workflow-output-v1`，完整交付通过，缺字段和餐饮污染样例失败关闭 |
| 配图合同 | PASS | 三套方向各含正向视觉提示词、负向提示词、后期叠字、供应商无关视觉参数；生产 parser 支持正式字段名并兼容旧字段名，3/3 可解析 |
| 环境标识 | PASS | 页面明确 `controlled mock` 为确定性流程验收、不调用真实文本模型、不产生文本模型费用、不代表客户最终内容；真实媒体仍单独授权 |
| 重复提交/账本 | PASS | 前端同步锁先于 fetch；真实 Chrome 双击只发 1 个 POST；服务端同 requestId 复放同 run，数据库为 AgentRun=1、settled reservation=1、consume=1、8 积分 |
| Web/WorkBuddy/租户权限 | PASS | 两入口共用固定执行/合同；MCP 数据库专项覆盖 scope、租户、权限、撤销、幂等、失败/取消/超时释放；浏览器双租户互不见历史 |
| 页面/E2E | PASS | 3018 当前源码验收时：桌面、390px、深链、正常生成、保存、历史/刷新、双击、跨租户、无横向溢出；console error=0、失败请求=0、外部请求=0；关机停点后 3018 已由正式脚本停止 |
| 相邻与全仓门禁 | PASS | fixed-route、workflow composition ×3、journey、web-contract、API/Web typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）PASS |
| 费用与环境 | PASS（零费用） | 验收时隔离 3018/PID9464 身份/指纹/ready/database 一致；关机停点再次通过 listener/PID/runtime/session/指纹门禁后，3017/PID8268 与 3018/PID9464 均由各自正式脚本停止并释放端口；3016/PID31024、55434/PID12564、5176/PID25232 按安全边界保持在线；文本/图片/视频/ASR/媒体 Provider=0、费用 ¥0、未部署生产 |
| 唯一真实文本终验 | FAIL（安全失败） | `deepseek-v4-pro` 1 次、thinking disabled、重试/修复/换模/追加=0；`stop`，tokens `3525/1032/0/4557`，24.389 秒，估算 ¥0.019450≤¥0.13；正式 Eval 命中 `rubric_fact_retention_weak`，未达到保存门禁 |
| 真实失败账本与清理 | PASS | AgentRun=0；reservation=`released/actualAmount=0`；1 consume + 1 同额 refund，净积分 0；临时凭据/entitlement 撤销、余额 0；3019/PID17104 受控停止；最终关机停点再受控停止 3017/PID8268、3018/PID9464 |
| 调用后零 Provider 回归 | PASS | live postflight、XHS 合同、text budget、fixed-route、Web contract、`qa:fast`、`qa:regression` PASS；后续真实 Provider/媒体调用 0 |
| 修复后唯一真实验收 | PASS | `deepseek-v4-pro` 1 次、thinking disabled、重试/修复/换模/追加=0；`stop`，tokens `3241/1039/0/4280`，23.146 秒，估算 ¥0.018510≤¥0.13；文件/媒体/图片/视频/ASR=0 |
| 正式成功门禁 | PASS | Skill 1.0.1 三段链、全部正式栏目、任务事实回执、标题/标签/三套配图、事实保留/矛盾/污染、`fallbackUsed=false`、`providerOutputVerified=true`；输出正文不写入验证记录 |
| 成功账本/恢复 | PASS | 唯一 succeeded AgentRun、唯一 settled reservation、1 consume/0 refund；Web 历史与 WorkBuddy 输出哈希一致并可恢复；临时凭据和 entitlement 撤销、余额 0 |
| 验收脚本假阴性回归 | PASS | 通用 Eval 不再要求方法论描述/整句 deliverable 逐字进入客户正文；全部正式栏目和字面术语仍由通用 Eval 检查，描述性交付继续由产品 postflight 的确定性字段/事实校验，不降低合同 |
| 2026-08-26 隔离环境清理 | PASS | 3020/PID4068 listener/PID/runtime/session/指纹双重门禁通过后由正式脚本停止，端口已释放且无测试/浏览器残留；共享 PostgreSQL55434/PID2992 保持在线 |

### QA-20260825-009 零费用根因修复

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 同一指纹证明输入四事实完整到后端，但事实清单/回执缺失；结构完整的漏事实/矛盾输出可过产品合同，合理同义表达被字面 rubric 拒绝 |
| 正式 Skill/Schema | PASS | `wechat-xhs-content-line@1.0.1` 新增任务事实回执；固定 capability/scope、beauty 差异/合规链不变，标题/正文/标签/配图共享锁定事实 |
| 事实 Eval | PASS | 完整保留 PASS；漏季节/项目/地理/人群任一 FAIL；矛盾、餐饮污染、结构缺失 FAIL；夏天/周边女性客群/日常补水护理 PASS；第二条秋季/舒缓/上班族用例 PASS |
| controlled mock | PASS | 根据锁定事实动态形成完整回执与正式交付，不把诊断句硬编码为所有 XHS 结果；明确仅验流程，不代表真实模型质量 |
| Prompt 预算 | PASS | 含事实清单的正式组合 `23,434/25,000 bytes`，输出 `5,120`，零重试/修复/换模路径保持 |
| Web/WorkBuddy/租户/账本/幂等 | PASS | 两入口共用 execution；MCP 隔离库 scope、权限、跨租户、撤销、失败/取消/超时释放、复放与一次结算 PASS |
| 全量门禁 | PASS | XHS 两专项、fixed-route、composition、journey、Web contract、MCP platform/database、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）、diff PASS |
| 费用/残余 | PASS | 修复阶段 Provider 0、真实验收 Provider 1、费用约 ¥0.018510；P0/P1=0，P1-A 已关闭，未部署生产 |

未运行：生产部署、媒体 Provider、P1-B/P1-C/日报；均不属于本轮。昨晚 `qa:full`/build PASS 按批准规则复用，本次运行 live postflight、XHS/事实/固定路由、MCP 数据库、完整 Web contract 与 diff；没有新增产品实现。

## BY-16 直播复盘 Skill 驱动专属页面（完成，2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 新专项首次因 `BeautyLiveReviewWorkbench.tsx` 不存在以 `ENOENT` 退出 1；证明旧稳定路由仍是通用文本区，没有正式三证据旅程 |
| 固定 Skill/Schema/Eval | PASS | `live_review_workflow_v1` 固定 capability/scope/tool/Skill/合规约束；严格字段、至少数据或转写、真实数值记录、文件回执绑定和固定八模块断言均通过 |
| 证据核验与降级 | PASS | 数据/转写/计划分别显示就绪、缺失、补充位置和影响；全缺、坏表、空表、无数值在 Provider 前失败；部分缺失只降级对应模块，不伪造录屏、话术或指标 |
| Web/WorkBuddy | PASS | 两入口共用导出 Schema 与执行函数；网页字段真实进入请求/幂等指纹；隔离库覆盖 scope、租户、账本、重复键、失败/取消/超时释放、撤销与轮换 |
| 页面/E2E | PASS | 桌面与 390px：深链、返回、CSV 解析、缺失提示、加载/错误/重试、重复点击、八模块结果、历史、刷新、跨租户；console error 0、外部 Provider 请求 0 |
| 相邻兼容 | PASS | 首页、共享导航、直播模块页/话术、选题、内容十件套、视频数据/内容复盘、固定路由与旧深链专项保持通过 |
| 全量门禁 | PASS | workbench/runtime/workbuddy、fixed-route、web-contract、MCP platform/数据库、API/Web typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` PASS |
| 费用与环境 | PASS | 所有收费 Provider 和媒体上传 0 次、新增费用 ¥0；既有 55434/3016/5176 进程未处理，临时 3017 当前源码 mock API 验收后释放；未部署生产 |

未运行：真实收费文本/视觉/ASR/媒体链和生产部署，均未经 BY-16 授权且不是正式页面零费用验收的必要条件。旧 `verify-live-skills.ts` 强制 Provider 抛错的 fallback 诊断与本次正式失败关闭语义冲突，未放宽产品门禁；正式 Schema/Eval 由 BY-16 runtime 和全仓质量门禁覆盖。

## BY-15 视频内容复盘 Skill 驱动专属页面（完成，2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 新 BY-15 专项首次因正式 `video-content-workflow.ts` 不存在以 `ENOENT` 退出 1；证明当前页面没有正式输入合同/独立旅程 |
| 固定 Skill 合同 | PASS | `video_content_review_workflow_v1` 固定 `shooting_editing`/主 Skill/双约束版本和十段正式输出；结构化平台、视频识别、目标、转写、视觉、时间轴、内容结构、事实边界与预检字段不允许自由文本切路由 |
| 上传、格式与缺失资料 | PASS | API 权限前置；MP4/MOV/M4V/WebM、大小、空文件、损坏容器、精确时长/分辨率、视频/音频 codec、采样率和声道均由服务端 ffprobe 校验；临时文件删除；刷新不保留媒体/回执；页面逐项说明需补资料与影响 |
| 视觉与 ASR 准入 | PASS（真实） | 固定哈希双流资产仅上传一次；qwen-vl-max 1 次命中全部登记画面事实，qwen3-asr-flash 1 次逐字命中合成句，两证据进入正式字段且 `fallbackUsed=false`；无重试/换模/追加调用 |
| Web/WorkBuddy、权限与租户 | PASS | 两入口共用导出的版本化 Schema；网页专属字段真实进入预检；产品访问权在 multipart 解析前校验；隔离库覆盖凭据 scope、租户绑定、账本、幂等、失败释放、撤销与轮换 |
| 费用与可观测性 | PASS | 页面预检固定 Provider/积分 0；获批准入总调用 2 次（每模型 1 次），精确 usage 813 + 223 tokens/8 秒音频。官方账单未在本地生成，保守预计约 ¥0.10、最坏 ¥0.20；安全报告无媒体正文/完整原始响应 |
| 页面与状态 | PASS | 桌面和 390×844：结构化输入、真实脱敏视频预检、证据门禁、错误/重试、重复点击保护、返回/后退、刷新清除媒体回执但保留文字、跨租户、无横向溢出；console error 0、额外模型请求 0 |
| 相邻兼容 | PASS | 首页、导航、视频模块、选题、内容十件套、视频数据复盘、邀请 scope、固定路由/输出和旧深链专项均保持通过；没有启动直播复盘 |
| 恢复门禁 | PASS | workbench/runtime/activation、8 workflow composition × 高风险 3 次、fixed-route/output、real-media、observability、MCP platform/隔离库、权限/租户/账本/幂等、Web/API typecheck、`qa:fast`、`qa:regression`、`qa:full`、根 build、diff 全部 PASS |
| 双流固定资产 | PASS（零费用） | `beauty-video-content-av.mp4` 为本地合成 8.000 秒、63,191 bytes、360×640、H.264 + AAC mono 22050 Hz；SHA-256 固定；0/4/7 秒画面均为浅绿背景/深绿矩形/金色矩形且无人物/文字；唯一语音源为 manifest 中的中性合成句 |
| 真实成功判定 | PASS | 视觉全部事实、ASR 合成句、正式 `visualEvidence/transcript` 与 `fallbackUsed=false` 均真实命中；`QA-20260823-002` 已关闭，精确 scope/tool/capability 已恢复 |

未运行：生产部署、直播复盘、额外 Provider 调用。正式业务文本链只在受控 mock/合同回归运行，未产生额外付费。

## BY-14 全局命名、导航与独立子页面框架（2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 新专项首次以 `shared beauty navigation shell is missing` FAIL；同期 BY-12 首页专项 PASS，证明问题是导航壳层/独立页面缺失而非旧首页基线破坏 |
| 全局命名 | PASS | 侧栏、顶部、页面标题和 meta 统一“美业智能体｜门店 AI 经营大脑”；当前租户、城市和本地验收环境独立显示，旧产品总名称不再作为品牌识别 |
| 主导航与独立页 | PASS | 10 个可见项分别有唯一 URL、独立标题/主内容和 `aria-current` 选中态；日报、知识、交付、经营规划页只展示用途、状态、前置条件和能力边界 |
| 获客模块与旧深链 | PASS | 美业获客模块首页、图文/视频/直播分支页可深链；图文、选题、内容十件套、视频数据复盘、直播话术、直播复盘、销售旧路由和固定 Skill 映射保持兼容 |
| 权限、404 与失败 | PASS | 服务端工具清单决定开放/未开通；无权限不展示表单；未知美业路径进入产品内 404；3999 网络错误显示安全终态和重新加载，失败不自动调用/扣费 |
| 刷新与浏览器历史 | PASS | 主导航点击、直接深链、刷新、返回、浏览器前进/后退恢复 URL、标题、主内容和选中态 |
| 桌面与 390px | PASS | 桌面逐页真实操作；390×844 真实 Chrome `innerWidth=390`、`overflow=0`、菜单可见，展开后焦点进入首项，Escape 关闭并把焦点还给菜单 |
| 租户隔离与控制台 | PASS | 两个独立浏览器上下文各自显示自己的受控测试租户；数据库 MCP 的 scope/租户/账本/幂等/撤销回归 PASS；主路径控制台 error/warning 0 |
| 费用边界 | PASS | 导航、规划页、404 和浏览器 E2E 不创建业务运行；文本/图片/视频/ASR Provider 调用 0，新增人民币费用 ¥0 |
| 门禁 | PASS | BY-14 静态/浏览器专项、美业首页/Web/MCP 数据库专项、Web/API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含全仓 build）、`git diff --check` PASS |

未运行：生产部署、生产配置预检、正式邀请码和收费 Provider；均不在 BY-14 范围。

## BY-13 视频数据复盘 Skill 驱动专属页面（2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 专属页面专项先因组件不存在 FAIL；运行时专项随后分别捕获结构化证据位于 Agent 可见区之外、Provider 被误调用、“有效咨询”未计入转化以及仅表头文件可通过 |
| 正式 Skill 输入 | PASS | `video_data_review_workflow_v1` 明确平台、周期、目标、转化定义、观察窗口与后台 CSV/XLS/XLSX；固定 `video_data_review → baolu_review_engine@2.0.0`，不存在自由文本切换 Skill |
| 文件与缺失资料 | PASS | 受控后端解析后才可运行；错类型、仅表头、无数值记录、解析失败均在预留/Provider 前失败关闭；缺日期与自然/付费字段显示影响和补数位置，不把缺失当 0 |
| 指标与正式结果 | PASS | 脱敏 2 行后台数据得到总播放 2060、平均完播率 36.5%、业务转化 7；结果包含数据边界、核心指标、表现诊断、行动建议、下轮观察，不输出画面/口播等无证据结论 |
| Web/WorkBuddy 同合同 | PASS | 网页专属 `professionalOptions` 真正进入后端和幂等指纹；隔离库 MCP 用同一文件/口径得到相同报告，Provider 调用 0，同键重放不重复结算 |
| 权限、租户与账本 | PASS | 当前用户/租户/product/scope 绑定，跨租户、错 scope、撤销/轮换、余额、预留/结算/释放、失败和幂等回归 PASS；首次未提供隔离库授权变量时脚本按设计拒绝，显式加载验收 env 后 PASS |
| 状态与导航 | PASS | 加载、成功、错误/重试、重复点击保护、历史、刷新恢复、直接深链、返回视频获客均 PASS；文件不做浏览器持久化，新一轮需真实重选 |
| 页面与控制台 | PASS | 1440×1000 双栏与 390×844 单栏实际操作；移动首屏直接进入专属页，无旧通用工作台遮挡；主路径 console error/warning 0 |
| 费用边界 | PASS | 未调用文本/图片/视频/ASR Provider，新增人民币费用 ¥0；两次确定性页面验收共 30 个内部验收积分，另一次失败预留已释放 |
| 门禁 | PASS | BY-13 静态/运行时/直连专项、美业 Web/隔离 MCP、Web/API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` PASS |

未运行：生产部署、生产配置预检、正式邀请码和任何收费 Provider；均不在 BY-13 范围。

## BY-12 美业智能体工作台正式首页（2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | `beauty-industry:home-p1-smoke` 在旧页面稳定命中缺少正式首页壳层、真实连接卡、任务中心和子工作区深链；同期既有 `beauty-industry:web-contract-smoke` 全绿 |
| 真实租户数据 | PASS | 本机受控租户页面显示真实 488 积分、0% 档案、1 条最近任务、无有效 WorkBuddy 连接；无 `2680/12条/2个` 等原型数字，档案完整度由当前 profile 字段计算 |
| 权限与规划状态 | PASS | 首页卡和工作区入口读取 `/beauty-industry/acquisition.tools`；获客三卡与销售按真实权限开放，日报/知识问答/交付/诊断保持 disabled“规划中” |
| 导航与深链 | PASS | 档案 `/profile`、任务中心 `/tasks`、WorkBuddy 独立页及图文/视频选题/内容十件套/视频数据复盘/直播话术/直播复盘/销售深链；刷新、后退和从最近任务恢复均 PASS |
| 加载、错误、重试与空状态 | PASS | 初始加载状态明确；3999 端口失败显示中文安全终态与“重新加载”；档案、连接和任务均有真实空状态，不创建伪数据 |
| 桌面与移动页面 | PASS | 1440px 与 390×844 实际页面；390px 实测 `scrollWidth=clientWidth=375`，三张业务卡、横向主导航和所有真实卡片可用；主路径/错误路径 console error/warning 0 |
| 租户隔离 | PASS | 首页复用现有 tenant/user/product scoped overview/history/profile/connections；隔离数据库 profile A/B 与 WorkBuddy 凭据、工具、账本、幂等、撤销和跨租户回归 PASS |
| Skill/费用边界 | PASS | 未改 Skill 或工具映射，未引入自由文本路由；未创建新 AgentRun、媒体任务或积分流水；文本/图片/视频/ASR Provider 调用 0，费用 ¥0 |
| 门禁 | PASS | 首页专项、美业 Web/MCP 专项、Web typecheck/build、隔离数据库专项、`qa:fast`、`qa:regression`、`qa:full`（含全仓 build）、`git diff --check` PASS |

未运行：生产部署、生产配置预检、正式邀请码和任何 Provider；均不在 BY-12 范围。

## BY-11 内容十件套专属工作区（2026-08-25）

| 领域 | 结果 | 证据 |
|---|---|---|
| 修复前红灯 | PASS（红灯有效） | 旧页面缺专属组件、结构化 `contentWorkflow`、追问卡、十件套卡片、Word 与历史收纳；首次修复又由指纹断言捕获 workflow 版本未进入幂等键 |
| Skill 驱动输入 | PASS | 页面字段逐项对应 V5 本次任务/目标/人群/平台/形式/时长/主体/项目事实/素材约束；缺必填项在 Provider 前追问且按钮 disabled |
| TOP10 承接 | PASS | BY-10 选择的选题、来源证据、事实边界和目标关系进入同一 `contentWorkflow`；只导航承接、不重新调用选题、不重复扣费 |
| Web/MCP 固定合同 | PASS | 两入口均要求版本化 `contentWorkflow`；固定 `content_plan → baolu_content_creator@5.0.0 → beauty-industry-content-diff@1.1.0 → beauty-industry-compliance@1.0.0`，其他工具误传合同 fail closed |
| 十件套交付 | PASS | 正式 Web 2 次 + MCP 1 次均包含 V5 十项、顺序完整、fallback 0、餐饮/招商/客户名/演示数字命中 0；同键 replay 未重复调用 |
| 费用与账本 | PASS | 单次最坏 ¥0.279569、三次最坏 ¥0.838707≤¥1；实际 21,953 input + 7,553 output token，估算 ¥0.128965；无自动重试，临时凭据已撤销 |
| 复制/Word | PASS | 复制只含用户交付正文；DOCX 受鉴权下载并绑定租户，转为 4 页 PDF 逐页检查无裁切/乱码/空白/内部字段 |
| 保存/恢复/竞态 | PASS | 同一秒重复点击仅 1 请求；结果与工作区刷新恢复、历史收纳、取消、预期断网与恢复均验证；失败不自动重试 |
| 页面 | PASS | 1440×1000 真实生成/复制/Word/历史/断网；390×844 恢复与十卡浏览；两者横向溢出 0，恢复 E2E console error 0 |
| 全量门禁 | PASS | content/display/composition/fixed-route/MCP/web 专项、`qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` PASS |

未运行：生产部署、正式邀请码、图片/视频/ASR Provider；均不在 BY-11 范围。BY-11 完成后本任务进入 idle，正式首页由第二阶段另建任务卡。

## BY-10 固定入口路由与输出合同 P1

| 领域 | 当前结果 | 证据 |
|---|---|---|
| 七能力固定映射 | PASS（离线） | 7 个 workflow 的 scope/capability/primary Skill/约束顺序；正常、对抗、模糊、混合表达各 3 次，路由 100% 固定 |
| 最终输出合同 | PASS（离线/协议） | 原始 Provider 输出、最终输出、正式 Skill 版本、错模块/错行业、fallback、clarification、replay 全部前置校验；失败不持久化、不结算 |
| Web/MCP 共链 | PASS | 两入口共用 `executeBeautyIndustryProductTool`；MCP 身份只来自凭据；route receipt 包含脱敏 request/tenant 指纹 |
| MCP 数据库链 | PASS | initialize/tools/list/tools/call、错 scope、余额不足、成功结算、重复键、Provider失败/取消/超时释放、轮换/撤销与跨租户 |
| 输入事实边界 | PASS | `用户这次说` 与系统注入档案/模式/动作边界分隔；系统说明不再误判为用户事实 |
| FIP 相邻回归 | PASS | 美业正式 `baolu_topics` 合同不再被 FIP 扩展列重建；FIP 原扩展交付仍保持 |
| 真实文本 Provider | PASS | `deepseek-v4-pro` 的选题、内容十件套、小红书文本包、直播话术、直播复盘、美业销售均取得明确 `stop`、reasoning=0；错合同尝试失败关闭并释放预留，无自动重试 |
| 付费媒体/外部动作 | PASS（未执行） | 图片、视频、ASR、发布、投流、充值、部署均为 0 |
| 桌面/390px 页面 | PASS | Chrome 1440×1000 与 390×844 覆盖三分支、对抗输入、失败/重试、断网、取消晚到、刷新恢复和 WorkBuddy 专属入口；控制台与非预期请求错误 0 |
| 全量门禁 | PASS | `beauty-industry:fixed-route-output-p1-smoke`、`beauty-industry:web-contract-smoke`、隔离库 MCP、FIP 相邻回归、`qa:fast`、`qa:regression`、`qa:full` |
| 2026-08-25 正常选题复验 | PASS | 同一皮肤管理选题 MCP 正式模型连续 3 次；Web 正式生成、保存、刷新恢复；缺来源标待补，固定 `baolu_topics@2.1.2` 与双约束链，fallback 0 |
| Mock/正式 Provider 边界 | PASS | 简短 mock 合同红灯已保留；非 mock 且 Provider 未配置时在调用前失败，不再静默返回受控结果 |
| 390px 宽表 | PASS | 九列 TOP10 表格限制在结果卡内横向滚动；实测 document width 不超过 390px viewport |
| 完整四来源页面流程（用户二次验收） | PASS | 修复前 `beauty-industry-topic-workbench-p1-smoke.mjs` 稳定 FAIL 25 项；修复后页面显示获客目标、四来源资料卡/状态、来源候选与证据、三关筛选、TOP10 和内容承接，Web/MCP 共享 `topicWorkflow` 合同 |
| 1/2/3/4 来源与全缺失 | PASS | 服务端重取当前租户已确认转写和最近视频复盘；部分来源可生成并标待补，全缺失在 Provider 前阻止；错租户、未确认、错行业证据 fail closed |
| 选题事实/交付后置门禁 | PASS | 服务端把已验证目标简报写回固定章节；合法“进入内容系统后生成拍摄脚本”边界说明可通过，真实跨模块章节仍拒绝 |
| 正式模型高风险稳定性 | PASS | `deepseek-v4-pro` MCP 连续 3 次 + Web 1 次，固定 Skill/约束链、fallback 0、TOP10 与来源/三关完整；最终稳定批估算 ¥0.131944 |
| 四来源真实页面 E2E | PASS | 1440×1000 与 390×844：真实生成、保存、刷新恢复、重复点击、断网、TOP10 选择并进入内容系统；内容承接未新增 Provider 调用，控制台/非预期请求错误 0 |

## BY-09 首轮用户反馈与固定路由（2026-08-24，进行中）

| 领域 | 结果 | 证据 |
|---|---|---|
| 泄露凭据撤销 | PASS | 联合 product/时间/7 scopes/300 积分/成员/Agent/审计唯一识别 1 条；状态改为 revoked，hash/prefix 与撤销审计保留，不创建新密钥 |
| 生产 P0 根因 | PASS | 6 个生成工具均在 Skill 包装载阶段失败；beta 错继承另一服务的 self-MCP 地址，日志为 `original_skill_not_found`，并非 WorkBuddy 客户端、Provider 或余额根因 |
| 修复前红灯 | PASS | `beauty-industry-beta-self-mcp-config-smoke.mjs` 在旧 unit 因缺少 beta 自身 MCP 地址稳定 AssertionError |
| self-MCP 修复 | PASS（零费用） | beta 有效进程环境指向本机 3004；9 个正式 Skill 包 `sitong_original_skill.load` 9/9 PASS；`/os-v2/` 健康不变 |
| MCP 零费用链 | PASS | 临时 0 积分凭据：initialize 200、tools/list=7；6 工具固定到 `insufficient_credits`，视频数据复盘固定到 `beauty_video_data_not_parsed`；撤销后 initialize/list/call 均 401 |
| Web 零费用链 | PASS | 同一临时租户的 6 个 Web 工具均 402 `insufficient_credits`，数据复盘 422；与 MCP 共用 workflow，reservation/transaction/AgentRun/Provider 均 0 |
| 调用前费用硬界 | PASS | `beauty-text-budget-v1` 固定六项输入/输出/模型边界，Web/self-MCP 预检均在 Provider started 前；批次最坏 ¥0.999456，拒绝路径 Provider/usage/扣费均 0 |
| 真实文本终验 | PASS | 首批六工具各 1 次均 `deepseek-v4-pro + stop + reasoning=0 + settled`，累计估算 ¥0.196888≤¥1；销售修复后按独立授权再 1 次，估算 ¥0.013207≤¥0.12，终态、usage、账本均明确 |
| 销售质量修复 | PASS | 修复前稳定 FAIL；修复后真实 B2C 美业效果咨询完整输出判断、异议、破局点、回复、预判、下一步、待核实；无团购/核销流程、企业预算/决策人话术、疗效承诺或未确认价格 |
| Provider 成功用量观测 | PASS | 修复前专项因成功链无 usage FAIL；新增只记录 Provider/model、脱敏请求指纹、finish reason 与 token 聚合的安全事件，不记录 Prompt/正文/租户/密钥；专项与 API typecheck PASS |
| 临时凭据与账本 | PASS | 临时凭据已撤销且只保留 hash/prefix；临时 product/Agent entitlement 已停用、余额归零。唯一调用预留 10、结算 10、consume 1 条，无重复扣费 |
| 选题四来源修复 | PASS（零费用） | 原始 Skill 与运行时版本漂移红灯稳定复现；最小同步四来源契约，专项、选题相邻回归与 Agent/Skill typecheck PASS；真实复验由内容硬失败变为明确 timeout，但未得到成功结果 |
| Provider 超时分类 | PASS（零费用） | 普通 Error 超时修复前被记为 unknown；专项红灯后统一识别 timed_out/cancelled，固定美业选题采用 180 秒主超时，生产 beta 已部署 |
| 终验日志汇总 | PASS | 修复毫秒 ISO 与 journald `__REALTIME_TIMESTAMP` 字段；fixture PASS，六项 usage/finish/billing 可安全聚合，不记录原文、secret 或租户标识 |
| UI/档案/本地 E2E | PASS | 桌面/390px：登录、经营档案、结构化赛道/渠道、三分支、刷新、断网、取消晚到、WorkBuddy 专属页；控制台和非预期请求 0 |
| 公网子路径 | PASS | 修复前 `/beauty-beta/login/beauty-industry` HTTP 200 却渲染外卖产品；生产内容红灯后改用 Vite base 归一化，桌面/390px 浏览器与三个用户流程 chunk 检查 PASS |
| 最终门禁 | PASS / 可验收 | 销售 P1、`beauty-industry:web-contract-smoke`、MCP platform、桌面/390px、生产刷新、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` PASS；生产 beta/API 与 `/os-v2/` 健康 |


## BY-08 邀请制受控内测（2026-08-24）

| 领域 | 结果 | 证据 |
|---|---|---|
| 产品范围锁定 | PASS | 网页/Web API/MCP/credential 统一为 7 个开放工具；视频内容复盘、视频生成、投流和未开放模块不可发现/不可执行 |
| 邀请与人工积分 | PASS | active `beauty-industry` entitlement 前置；同一 grant id 两次执行只产生一条 ledger、余额只增加一次 |
| 图文契约 | PASS | 修复前 production parser 对 mock 输出稳定 FAIL；修复后 3 套封面/内容/承接正负提示词可解析，页面进入明确图片授权终态，不创建媒体任务 |
| MCP/隔离/账本 | PASS | 数据库 JSON-RPC 覆盖 scope、错产品、跨租户、撤销/轮换、余额不足、幂等、失败/取消/超时释放 |
| 页面 | PASS | 公网 Chrome 桌面 1440×1000 与 390×844：邀请码两阶段、登录、档案、三分支、刷新恢复、WorkBuddy 入口、关闭项；控制台/资源错误 0 |
| 生产安全 | PASS | production dev-login 404；mock pay/mock Provider 禁止；独立 beta 服务/路由未覆盖既有 `/os-v2/`；HTTPS、health、ready 与 Nginx 回滚探针 PASS |
| 数据库/备份 | PASS（生产） | 生产 custom dump 可由 `pg_restore --list` 读取；9 个历史 migration 与数据库 checksum 一致；10 个待处理 migration 首次成功，第二次无待处理 |
| 公网 MCP | PASS | 正式邀请码登录后创建产品凭据；真实公网 JSON-RPC `tools/list` 仅返回 7 个开放工具；撤销后旧 secret 401，数据库只保留 hash/prefix |
| Provider/费用 | PASS | 发布及 smoke 的媒体任务 0；未调用文本、图片、视频、ASR Provider；未创建正式支付或充值，新增费用 ¥0 |
| 全量门禁 | PASS | `qa:fast`、`qa:regression`、原样 `qa:full`（exit 0）、`git diff --check` |

未运行：真实 Provider 质量调用、真实支付/充值/退款、WorkBuddy 桌面应用自动写入 secret。当前内测仅允许人工邀请和人工测试积分；MCP 协议已在真实公网入口完成，不把桌面应用未自动配置冒充为已验证。

## BY-07 最终真实 Provider 验收（2026-08-23）

| 领域 | 结果 | 证据 |
|---|---|---|
| 小红书同页图文 | PASS | 同一网页任务恢复标题/正文/标签和 3 张真实图片；复制文字、3 个下载按钮、刷新恢复均实际操作 |
| 图片 Provider / 幂等 | PASS | `wan2.7-image` 真实任务 3/3 成功，`providerTaskId`/requestKey 各 3 个且未创建第 4 个；资产保存故障后只恢复原任务，不付费重试 |
| 图片账本 | PASS | 300 积分预留后因批次资产故障释放；恢复资产不反向补扣，3 个 job 均 `persisted/refunded`，图片外部成本约 ¥0.60 |
| 视频证据失败关闭 | PASS | 唯一一次 8 秒合成 MP4 无有效画面结论/转写；页面明确失败，生成按钮 disabled，复盘模型调用 0、积分 0，不声称看过视频 |
| 视频真实成功链 | **FAIL / P1** | `/media/analyze` 约 102ms 返回 200，但视觉与 ASR 均无可用证据；授权禁止失败后新增付费调用，未重试 |
| 单次真实复验 | **FAIL / P1** | 同一 8 秒合成视频上一授权下的唯一一次上传约 82ms 聚合失败；页面 disabled、复盘模型/积分/AgentRun 0，无重试。旧 API 复用根因已修复，但尚未取得新的真实复验授权，不能用离线证据替代成功链 |
| 验收源码新鲜度 | PASS（零费用） | `SOURCE_BASELINE` 3/3 一致后语义合并；修复前追加身份复核为 50 PASS / 1 FAIL，单进程启动为 51 PASS / 1 FAIL；修复后源码指纹、PID/端口、旧布局迁移和停止前二次身份核验 53/53 PASS；Windows PowerShell/PowerShell 7 中文路径解析 PASS |
| 验收环境恢复 | PASS（零费用） | `source_fresh=true`，源码/运行指纹一致，API 记录 PID 与 3016 监听 PID 一致，数据库 ready、Web 5176=200；本地受控登录和刷新恢复实际操作，三分支/恢复入口可见，控制台 warning/error 0；Provider 调用 0 |
| Provider 安全终态观测 | PASS（零费用） | 修复前 `real-media-smoke` 因缺阶段/请求指纹/终态/计费状态稳定 FAIL；修复后视觉与 ASR 均记录安全 HTTP/官方码/model/region/media type/timeout/cancel/finish/billing，页面显示安全阶段且不暴露原始响应 |
| 视频离线 Provider 契约 | PASS（零费用） | 纯 fixture 覆盖视觉/ASR 成功、部分失败、全失败、超时、取消、指纹与账本零预留；ASR 不再发送不属于其当前输入契约的 `temperature`；Provider 调用 0 |
| 合成媒体本地预处理 | PASS | 8 秒 MP4 为 H.264 720×1280 + AAC mono 22050Hz；生产等价 FFmpeg 成功抽取 16kHz mono MP3，排除容器、音轨和本地抽取失败 |
| Web/MCP 共用链 | PASS（既有协议证据 + 本轮零费用回归） | 固定 workflows/execution、同一 Skill/档案/账本/幂等保持；`beauty-industry:mcp-platform-smoke` 与 journey contract PASS；未重新运行会产生文本 Provider 费用的 live MCP 脚本 |
| 页面 | PASS（已验证范围） | 桌面刷新恢复；390×844 为 3 图/3 下载按钮，`scrollWidth=375 <= innerWidth=390`，视频失败状态刷新后保持 |
| 自动门禁 | PASS | 53 项离线源码新鲜度回归、observability/real-media/journey、`qa:fast`、`qa:regression`、`qa:full`（含 build）和 `git diff --check` 全部 PASS；本轮 Provider 调用 0、费用 ¥0 |

放行结论：存在真实视频成功链 P1，当前不能标记“可用户验收”；自动门禁和图片成功不能用平均结论覆盖该硬失败。

## BY-07 Skill 准入与固定业务编排

| 领域 | 结果 | 证据 |
|---|---|---|
| Skill 准入 | PASS | 8 组合、正式文件/版本/contract/注册一致，高风险各 3 次；合规护栏实际执行且不暴露为用户工具 |
| 固定路由 | PASS | 8 个显式 workflow 固定 capability/主 Skill/约束 Skill；自由文本含其他分支关键词仍不改路由；controlled mock 8/8 PASS |
| 产品工具清单 | PASS | WorkBuddy 只列 8 个用户工具；无 compliance、投流、DOU+、巨量本地推；文生/图生视频只在页面标规划中 |
| 文件证据 | PASS（门禁）/ BLOCKED（付费 Provider 成功链） | CSV/Excel 真实解析后才运行数据复盘；视频失败时明确终态、按钮禁用、模型/积分 0；未声称已看过视频 |
| Web/MCP 一致 | PASS | 同一 workflows/execution、档案、AgentRun、账本、历史；真实 HTTP 客户端 3 MCP + 1 web 受控调用，幂等/失败释放/身份隔离 PASS |
| 页面 | PASS | 桌面与 390×844：三分支、销售、刷新、返回、断网、取消晚到、文件失败、WorkBuddy 专属页；移动无横向溢出，控制台 warning/error 0 |
| 真实媒体 | BLOCKED | 本轮图片/视频 Provider 0、费用 0；小红书无占位图/假下载，文生/图生视频未开放 |
| 全量门禁 | PASS | admission/composition/routing/web/MCP 专项、`qa:fast`、`qa:regression`、`qa:full`、build PASS |

未运行：用户桌面 WorkBuddy 应用写入 secret、真实付费图片、真实付费视频内容分析、生产迁移/部署/支付。上述项目不标为完成。

## BY-06 美业获客三分支与任务闭环 P1 修复

| 领域 | 结果 | 证据 |
|---|---|---|
| 三分支与路由锁定 | PASS | 首页严格 3 卡；移除获客问答/`beauty.acquisition_plan`；图文、视频、直播各自锁定 tool/capability/Skill，高风险串线路由确定性重复 3 次 |
| 图文与媒体边界 | PASS（文字/提示词）/ BLOCKED（真实图片） | 图文同任务交付小红书文字与 1/3 张配图方向；页面无占位图、无下载假按钮；未获媒体费用授权时真实生图按钮禁用，媒体 Provider 调用 0 |
| 视频与直播流程 | PASS | 视频为选题→内容十件套→投流预览→视频数据复盘；视频内容复盘、数字人文生视频/图生视频明确暂未开放；直播仅话术→直播复盘；桌面/390px 均实测 |
| 表单隔离 | PASS | 图文无 EDL/复盘字段；CSV/结构化指标只进视频数据复盘；视频内容复盘不复用数据表；直播表单无视频字段 |
| 下一步与恢复 | PASS | `sourceRunId` 仅同租户/用户/产品及允许转移可用；真实页面以十件套结果继续生成投流预览，刷新后当前阶段、输入、十件套与投流历史均恢复且没有再次扣费 |
| 资料边界 | PASS | 账号/产品/任务三层可见；任务资料只有“保存到经营档案”并再次确认才持久化，AI 草稿不晋升事实 |
| WorkBuddy | PASS | 产品内进入 `/agents/beauty-industry/workbuddy`，不再跳通用分流页；产品工具、余额/用量、一次密钥、轮换/撤销保持共享底层契约 |
| 失败与竞态 | PASS | 断网显示中文终态且按钮恢复；取消立即恢复，晚到响应不覆盖；重复 requestId 保持服务端幂等；无自动重试或媒体调用 |
| 页面 | PASS | Chrome 桌面 1440×1000 与 390×844：三分支、专业字段、刷新、断网、取消、专属连接页；控制台与非预期失败请求 0 |
| 业务质量回归 | PASS | BY-04 保存结果零费用重放 8/8、硬失败 0、Provider 调用 0；P1 smoke PASS |
| 全量门禁 | PASS | journey/MCP/web contract、浏览器 E2E、`qa:fast`、`qa:regression`、`qa:full`、全仓 build 与 `git diff --check` 均 PASS |

未运行：真实图片/视频 Provider、受控视频上传解析、WorkBuddy 桌面应用原生配置、生产迁移/部署/支付。上述能力不得标为已完成。

## BY-05 美业经营工作台 MVP 增强

| 领域 | 结果 | 证据 |
|---|---|---|
| 门店档案 | PASS | 六类赛道、单店/连锁、经营阶段、项目/人群/渠道/目标/事实边界；来源、确认状态、版本；医疗美容边界 fail-closed |
| 删除与租户隔离 | PASS | 隔离 PostgreSQL 合成 A/B 租户：删除 A 不影响 B，不删除其他 TenantProfile 字段；无 Schema 迁移 |
| 快速/专业模式 | PASS | 同一执行服务、Agent/Skill/账本；专业参数含人群、项目、平台、语气、画面、预算、内容结构、拍摄/EDL、投流预览与配图数量 |
| 今日动作与流转 | PASS | 首页最多 3 项；上次进度/最近结果可见；下一步只切换任务，不执行发布、投流、付款或消息 |
| Web/MCP 一致 | PASS | 真实 HTTP MCP：8 tools 可发现、3 MCP + 1 web 调用；同一档案版本/运行历史，`paid_provider_calls=0`，secret 未输出 |
| 页面 | PASS | 桌面与 390×844、登录、档案、六模块、快速/专业、刷新、断网终态/重载、历史恢复；移动无横向溢出，控制台 warning/error 0 |
| BY-04 质量基线 | PASS | 保存的最终结果零费用重放 8/8、硬失败 0、Provider 调用 0；原 BY-03 失败证据未删除 |
| 全量门禁 | PASS | profile/MCP/web 专项、`qa:fast`、`qa:regression`、一次最终 `qa:full`、`git diff --check` |

未运行：WorkBuddy 桌面应用原生配置、真实 Provider、生产迁移/部署/支付。页面受控 mock 有明显标识，不冒充正式模型质量。

## BY-04 美业 Skill 输出质量 P1 闭环

| 领域 | 结果 | 证据 |
|---|---|---|
| 原 8 案例 | PASS | 当前生产最终化逻辑零费用重放 8/8 PASS、硬失败 0；BY-03 原失败基线未删除或放宽 |
| 选题与图文契约 | PASS | 选题资料充分时非空；不足明确待补；小红书禁止虚构体验并交付文案与 3 张独立配图方向/正负提示词 |
| 子行业与上下文隔离 | PASS | 皮肤管理/生活美容不再误判美甲；直播无餐饮、电商带货污染；品牌/租户中立硬门禁保持 |
| 字段与终态 | PASS | 3 秒留存、私信咨询等已提供字段保留；`finish_reason=length` 失败关闭，不交付截断投流终稿 |
| 动作与事实边界 | PASS | 投流持续 `PREVIEW_ONLY`；未确认目标、平台、地址、私信渠道和资产不会进入可执行结果 |
| 模型与费用 | PASS | 仅 `deepseek-v4-pro` 文本；BY-03+BY-04 累计估算 ¥0.6851≤¥1；媒体调用 0、无充值/外部动作 |
| 自动门禁 | PASS（范围内） | P1 smoke、8×3 policy Eval、美业 MCP/web contract、`qa:fast`、`qa:regression`、`git diff --check` PASS |
| 完整 MVP 门禁 | 待 BY-05 | 本任务未运行 `qa:full`、网页/WorkBuddy 最终 E2E；按额度策略在美业 MVP 最终交付时只执行一次 |

硬门禁继续保留：空结果、截断、静默丢字段、跨子行业、虚构体验/事实、跨租户、越权动作任一出现即 FAIL，不得用平均分掩盖。

## BY-03 美业 Skill 输出质量验收

| 领域 | 结果 | 证据 |
|---|---|---|
| 正式美业 Skill | PASS（结构）/ FAIL（最终质量） | 3 个正式 Skill 的 contract/8×3 policy Eval 通过；真实结果发现选题 fallback、小红书缺段与虚构体验 |
| 美业 MCP 工具包装 | FAIL | 8 个代表场景覆盖获客、内容、投流、直播和复盘；生活美容短视频/直播串入美甲、带货或餐饮字段 |
| 事实与数据 | FAIL | 复盘输入含 3 秒留存和私信咨询，结果丢失字段；小红书新增未确认个人体验与服务结果 |
| 投流安全 | PASS（动作边界）/ FAIL（完整性） | 正确使用专项投流能力并保持 PREVIEW_ONLY、无外部动作；最终止损段因 token 上限截断 |
| 品牌/租户/行业隔离 | PASS（品牌租户）/ FAIL（美业子行业） | 无兰琪、保禄、思潼、A/B 店或 tenant 泄露；但生活美容串入美甲模板 |
| Provider/费用 | PASS | 仅 `deepseek-v4-pro` 文本；10 次两阶段调用，估算 ¥0.2765≤¥1；媒体调用 0、无充值/发布/投流/付款 |
| 用户验收包 | PASS | 8 个脱敏案例含能力、评分、最终输出关键段和用户判断点；失败项明确不放行 |

硬门禁：医疗/疗效承诺、虚构价格案例数据、跨品牌租户、越权外部动作、错误投流执行、子行业污染、已提供字段丢失、固定失败模板和截断终稿均不可由平均分掩盖。

## BY-01 获客 MCP MVP

- 产品中立：网页、MCP 和运行记录不得出现兰琪、验收 A/B 店、tenantKey 或其他行业资料。
- 行业相关：目标、策略、选题、内容和合规必须属于美业，不被 AI 工具、餐饮、招商等资料污染。
- Skill：路由、版本、输入输出、依据、待补和失败边界；高风险样例至少重复 3 次。
- 协议：initialize、tools/list、tools/call、未知工具、无 token、错产品、过期、撤销、限流和结构错误。
- 身份：tenant/product/credential/operatingEntity/知识/会话隔离；参数伪造不能改变令牌身份。
- 计费：余额不足前置拒绝、同幂等键复用、超时/取消/Provider 失败不重复扣费。
- 外部动作：不自动发布、投流、付款、充值或生成未确认付费媒体。
- 双入口：网页与 MCP 对相同输入命中同一 capability/Skill/知识版本和事实边界。
- 页面：桌面与 390px；加载、空态、失败、重试、重复点击、刷新、返回、断网和控制台。
- 协议 E2E：使用 MCP Inspector 或真实协议客户端；可安全配置时再以 WorkBuddy 实际连接。
- 门禁：美业专项、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check`。

### 共享底层验证（2026-08-21）

| 领域 | 结果 | 证据 |
|---|---|---|
| JSON-RPC 协议 | PASS | `initialize`、`notifications/initialized`、`ping`、按 scope 的 `tools/list`、`tools/call` 均由 Fastify 注入协议 smoke 验证 |
| 凭据安全 | PASS | secret 只在创建/轮换响应出现一次；数据库仅存 hash/prefix；过期、撤销、旧轮换 token、非法 product 均 401/fail-closed |
| 身份与授权 | PASS | 每次调用重查成员、Agent access、`beauty-industry` entitlement、经营主体、credential 状态和 scope；伪造 tenant/user/product/agent 等参数拒绝 |
| 租户/产品隔离 | PASS | 另一合成租户不能借参数访问；错误产品不返回美业或通用 tools；`tools/list` 不出现兰琪、内部 Prompt 或 Skill 源码 |
| 计费与幂等 | PASS | 余额不足时 Provider 调用 0；成功请求一条 AgentRun、一次净结算；重复键不重复调用/扣费；失败、取消、超时均释放预留 |
| Provider 边界 | PASS | 失败后同一计费请求不会再次调用上游；无模板、低端模型或其他 Provider 降级 |
| 迁移 | PASS | 27 个迁移在 `beauty_mcp_test_20260821` 全量升级，幂等复跑无待处理；独立回滚夹具回滚/再升级 PASS |
| 质量门禁 | PASS | 美业 8 类×3=24 硬 Eval、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check` |

### BY-01 产品验收（2026-08-21）

| 领域 | 结果 | 证据 |
|---|---|---|
| 双入口一致 | PASS | 网页与 MCP 共用 `beauty-industry/execution.ts`；同一 Skill/capability/知识版本，审计渠道分别为 `web`、`mcp` |
| 真实 MCP 客户端 | PASS | HTTP 客户端完成 initialize、tools/list、3 个 tools/call；scope、错产品、过期/撤销/轮换、跨租户、伪造身份、幂等、余额不足与失败释放 PASS |
| 页面桌面 | PASS | 产品登录、空态、生成、阶段/取消、复制、历史保存、刷新恢复、断网与恢复、返回均实际操作 |
| 页面 390px | PASS | 390×844 布局、工具切换、生成、历史恢复实际操作；无横向核心路径阻断 |
| 产品隔离 | PASS | 美业产品登录后的账户页只显示一个美业 Agent/连接；不能发现其他产品或用参数覆盖产品身份 |
| 内容与费用边界 | PASS | controlled mock 在页面明确标识，不冒充正式 Provider 质量；Provider 配置 false，付费调用 0 |
| 全量门禁 | PASS | 美业 contract、8 类×3 Eval、真实 MCP E2E、原始 `pnpm.cmd qa:full` PASS |

未运行：WorkBuddy 桌面应用原生配置、真实 Provider、生产迁移/部署/支付；本地真实 HTTP MCP 客户端已覆盖协议层，测试 secret 仅通过认证页面一次性领取，不进入文档、聊天或日志。

## 后续一级板块（历史 BY-01 基线）

本段仅保留 BY-01 当时的范围证据。销售已在后续任务开放；日报已由 BY-20 建立受控运行时与页面但正式 live 仍禁用；知识问答、交付、经营诊断继续只保留规划边界。当前状态以本文件顶部最新任务矩阵为准。

## BY-02 统一版面静态原型

- 三路由：工作台首页、获客首页、小红书图文直接打开、互相切换、返回与刷新正确。
- 静态边界：源码无 `fetch/apiPath`；页面持续显示原型/合成标识；无积分、模型、媒体或外部动作。
- 未开放状态：日报、问答、销售、交付、诊断、历史与账户/MCP按规划状态真实 disabled。
- 小红书本地交互：空输入、合成切换、标题选择、复制反馈、SVG下载、保存与刷新恢复。
- 响应式：桌面与 390×844；移动侧栏、横向阶段、单列输入/结果、滚动和返回。
- 产品文案（历史原型验收）：当时使用“美业AI改造日报”；该名称已由 BY-20 的正式“美业 AI 日报”替换，当前产品不得继续显示旧名。
- 小红书多图：默认 3 张合成示例，可在封面图、内容图和互动承接图之间切换；选择 1 张时不显示虚假多图结果。
- 复盘层级：“数据复盘”仍为第六阶段；桌面端“视频数据复盘 / 直播数据复盘”并列，390px 单列且无横向溢出，两个入口均为不可点击的规划状态。
- 门禁：原型专项、Web typecheck、`qa:fast`、`git diff --check`；浏览器控制台 warning/error 0。

## BY-10 内容十件套提示组装与真实双入口回归（2026-08-25）

| 场景 | 结果 | 证据 |
|---|---|---|
| 修复前最终 messages | FAIL（预期红灯） | `beauty-industry-workflow-composition-smoke.ts` 命中跨产品 sample layer、通用 identity/experience 和餐饮招商演示事实 |
| locked product workflow | PASS | 美业 7 工作流 × 高风险 3 次；只保留租户/Skill/结构/事实/安全边界，跨产品 example 为 0 |
| generic/FIP 不变性 | PASS | generic Agent 继续加载自己的 examples；FIP clean branch 结构与推理配置相邻专项 PASS |
| 真实 Web + MCP | PASS | `deepseek-v4-pro` Web 1 次、MCP 2 次；三次十件套完整、禁词 0、fallback 0、同键 replay 未重复调用 |
| 账本/凭据 | PASS | 4 条近期成功记录均 settled；3 枚临时 MCP credential 均 revoked；无悬挂预留 |
| 桌面页面 | PASS | Chrome 1440×1000：真实结果、能力来源、历史、刷新恢复；控制台 0 |
| 移动页面 | PASS | Chrome 390×844：真实结果、历史、刷新恢复、无横向溢出；控制台 0 |
| 全量门禁 | PASS | 美业专项、MCP、FIP 相邻专项、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` |

硬边界：本节只记录内容十件套跨产品提示污染的修复证据；选题四来源专属工作区已在 QA-20260825-001 的二次验收中关闭，后续内容专属工作区证据见 BY-11。
## BY-26 互动图纯摄影构图零 Provider 闭环（2026-08-27）

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 修复前红灯 | PASS | Champion 固定 `acc26153…385d` 的真实中文展示文字/卡片UI风险；初次专项因仍为 plan-v1/prompt-v1.1 稳定 FAIL |
| role→plan→payload 根因 | PASS | 旧 engagement purpose/composition/providerInstruction 同时含互动问题、后期互动短句安全区、下方留白，正向诱导排版，与负向禁卡片约束冲突 |
| 单变量 Challenger | PASS | plan-v2/prompt-v1.2 仅把互动角色改为完整纯摄影静物/环境细节；清除排版诱导词，显式排除海报/卡片/清单/信息图/社交UI/按钮/对话框/标题栏/文案区 |
| 文字边界 | PASS | 中文互动文案只作为网页文字交付或后期叠字元数据，不进入图片生成画面 |
| 封面/内容不回退 | PASS | 两角色 payload 语义 SHA-256 与 v1.1 Champion 相同；purpose/composition/textStrategy 精确钉死 |
| 连续稳定性 | PASS | `beauty-industry:image-engagement-prompt-p1-smoke` 同批连续3次 PASS，Provider/网络0 |
| 图片安全召回 | PASS | safety-v2.5 安全22/22、风险54/54，precision/recall=`1.000/1.000`，真实文字/UI/QR/水印等继续拒绝 |
| 相邻与全仓门禁 | PASS | XHS同页、quality、generation-success、real-media零调用、persistence、URL、media-observability、API/Web/Agent typecheck、qa:fast/regression/full+build、diff |

结论：互动图构图/payload零Provider子范围P0/P1=0；BY-26三张客户合格图业务P1仍为1。无页面/DOM/路由变化，故未重复桌面/390px E2E；没有刷新或启用媒体环境。下一恢复点为按既有单批≤¥1授权重新物化 plan-v2/prompt-v1.2/safety-v2.5 的最多3张真实终验。
