# 美业智能体契约

## BY54 beauty-seedance-execution-v1

独立签名绑定tenant/user/store/request/hash、Ark账号/用途/两份review版本、completion上限108000/微货币预算/最多1POST+20GET+1download、原积分报价版本；复用原permit/job/积分/AuditLog，不迁Schema。`beauty-seedance-manual-review-v1`显式人工控制台证据，不是已接自动官方审核API。`local_only`测试许可不能进入真实HTTPS；默认所有新配置为空/disabled/报价0。详情、故障恢复、下载授权、日志和唯一真实缺口见[SEEDANCE_EXECUTION](SEEDANCE_EXECUTION.md)。下方BY53“无live factory/未持久计费”为当时边界，本项已补内部可配置factory，但仍无公开开放或真实调用。

## BY53 beauty-seedance-adapter-v1

固定`doubao-seedance-2-0-260128`，首profile2图/5s/720p/9:16；严格reference Schema、服务器审核purpose/account/tenant/owner/store/hash/version/expiry，不接客户端URL或authority。默认disabled且无live factory；用量复用BY51，completion单桶、total不叠加、unknown不免费。GET状态/URL并非已持久成品，真实执行/授权/计费尚未接线。详细边界、状态机、安全字段、价格版本和下一缺口见[SEEDANCE_ADAPTER](SEEDANCE_ADAPTER.md)。

## BY52 已拥有目录显示

`GET /agents/me`的美业卡要求既有Agent entitlement与当前beauty-industry产品权限同时有效；显示name由既有服务端brand config派生。新增只含productCode/name/description/path的productEntries，目前仅为具备独立lanqi产品授权的旧兼容入口，不含知识引用/正文。客户端名称/query/header不能决定品牌或权限，仍由签名会话的tenant上下文和产品表决定；目标route继续逐请求授权，前端卡片不是访问许可。公共catalog/allAgents结构与商业价格不改，DB异常不回退专属卡。

## BY51 beauty-usage-v1

复用AuditLog不可覆写事件与主键幂等，server actor/permit派生trace、step+attempt派生call、Provider task只存hash；多单位/缓存/价格版本/整数微货币与unknown/冲突明确。仅BY50视频接正式内部链，不把通用token/image fixture说成所有Provider已迁移。客户账本只按原成功逻辑动作结算，不存在任意consume/新月费或未知配额0。完整安全字段、迟到/月份/成本/回退与限制见[USAGE_METERING](USAGE_METERING.md)。

## BY-50 beauty-video-controlled-execution-v1

持久`BeautyVideoExecutionPermit`绑定tenant/user/store/requestKey/requestHash、模型/地域/模式/素材hash/授权版本/expiry、提交1/poll≤240/download1/storage20–40、最大时长及人民币承诺额度。HMAC可信服务端签发，无普通Web/WorkBuddy签发或覆盖参数；local_only夹具不能用于真实runtime。单次claim/每次外部请求计数先落库，storage最后8次仅清理；失败释放内部积分但不归还外部调用额度，observedProviderCost与committedCost分开。默认disabled，严格要求当前模型/安全URL/存储价格审核hash和上限；该hash不等于本轮验证了实际云价格。完整配置、审计字段、故障恢复与真实前置见[VIDEO_CONTROLLED_EXECUTION](VIDEO_CONTROLLED_EXECUTION.md)。新增表为可加迁移，不更改旧任务/账本记录。

## BY-49 beauty-oss-private-staging-v1

正式固定SDK`ali-oss@6.23.0`；cn-beijing/精确bucket-origin/prefix、private+阻断公共访问/Standard/无版本控制/无CRR/1天prefix生命周期；STS.短期三元组，拒绝SDK debug。PUT禁止覆盖/MD5+sha256绑定/AES256+HEAD核验，签名GET≤15分钟且只传服务端执行口；DELETE需同绑定HEAD与删除后404，失败保留lease恢复。HTTPS无代理/重定向/重试，DNS全IPv4校验并固定地址，20秒/64KiB上限。

正式route通过服务端配置factory接入，但默认disabled、费用上限0、没有付费execution；body无brand/driver/origin/credential/budget覆盖入口。offlineTransport始终local_only，不能伪装真实云链。撤权按tenant+auth id清理未建job的lease，任务/账本继续CAS，原文件不删除。局部代码修复不改变BY46声明的法律含义，不放行视频或暂停产品。

完整字段/官方依据/失败语义/云bearer限制/后续外部验收计划见[VIDEO_PRIVATE_OSS_STAGING.md](VIDEO_PRIVATE_OSS_STAGING.md)。BY46下文“尚无远程driver”为历史状态：已被本项本地实现覆盖，但不等于真实OSS验证完成。

## BY-48 共享Word临时导出安全边界

- `POST /exports/docx`及`GET /exports/docx/:id`均须已签名有效session；不接受unsigned tenant/user header替代凭据，数据库模式逐次重验active membership。无效会话401、撤权403、授权存储异常503；不返回底层错误正文。
- 临时buffer绑定tenantId+userId。同租户他人404，异租户保持403；均不能消耗创建者文件。下载lookup与delete在异步鉴权后连续执行，一次有效下载即消费，所有响应private/no-store。旧10分钟TTL/新建随机id不变；进程重启丢失临时buffer需要从原保存正文重新导出，不代表业务历史丢失。
- 不新增报告结构、分享权限、持久导出队列、AgentRun查询、积分扣除或模型。前端继续原content/title→已认证GET blob合同。共享导出不提供品牌/素材知识授权，不改变beauty core/品牌边界。

## BY-47 共享音视频上传准入边界

- `/media/analyze`没有绑定产品用途、服务端租户权限与ASR预算的执行合同。音视频分类命中时统一503 `asr_authorization_required`，stage=`asr_admission`，retryable=false，providerCalls=0，creditCost=0；客户端Authorization字符串、tenant/store/file/approval字段均不能开启外发。
- 不建立job、ASR结果或积分预留，不把元数据、缺授权或同步失败伪装成转写完成。密钥存在只代表连接配置，不代表客户文件用途许可。
- CSV/Excel/文本原本地解析保留；视频内容官方preflight仅元数据，已有转写必须由用户合法提供并走正式证据合同。未来接入自动ASR须独立完成文件用途、服务端授权、预算、存储/失败/恢复合同，不开放请求体布尔开关。
- 未改其他产品clip-asr的异步协议/模型/分段时间戳；本条不等于已完成全部共享视觉/PDF或其他ASR产品的权限审计。

## BY-46 beauty-video-asset-authorization-v1（2026-09-05）

- `POST /viral-video-replication/material-authorizations`只接收fileId/basisFileId/subjectRole/purpose/expiresAt/requestKey/rightsDeclared。tenant/store/user来自服务端Membership及有效beauty-industry entitlement；owner/admin或有store绑定的manager可登记，staff不可登记，不新增角色权限。文件和依据均要求本人上传；多门店但无当前store返回409。
- 持久模型`BeautyVideoAssetAuthorization`固定文件与依据hash、角色reference/owner/kol、用途video_replacement、声明者、expiry、revokedAt、version、合同版本及元数据。唯一tenant/requestKey、唯一file、唯一tenant/store/hash防重复与角色混用。最长声明366天，不能以同hash重传把老板授权当达人授权；当前没有隐式续期或覆盖已有声明接口。
- `assurance=user_declared_not_independently_verified`，状态declaration_recorded/expired/revoked；仅保存声明与依据引用，不验证法律真实性。依据只接受本地PDF/text且不回传正文。素材读既有UploadedFile私有目录，拒绝跨目录/链接、hash变化、类型/字节/实际尺寸时长不一致；以捕获bytes做ffprobe或本地图像解码，不读取客户自报URL。
- `POST .../:id/revoke`仅允许空body，重复撤销同版本不重复AuditLog；未来暂存读取、提交和成片下载重新鉴权。未结算任务通过既有CAS释放一次，已外部提交则终态未知且不能宣称撤回；已成功账本不重写。
- `BeautyVideoStagingLease`先存creating及精确对象key/hash/auth version再写文件；TTL为授权剩余时间和15分钟的较小者，active/releasing/released/cleanup_failed均可审计。签名绑定origin/object/expiry/purpose，签名URL不落任务、日志或客户端；release先禁读再删临时副本，清理失败可显式sweep，原素材不删除。
- `local-private-staging-v1`只供受控本地测试，127.0.0.1随机空闲端口，访问每次重查授权与hash。它不能配真实Provider执行器。未来远程driver需独立实现并验证HTTPS精确origin/对象、DNS/IP/重定向、TTL和云端删除；当前origin语法校验不等同完整远程SSRF与真实存储验收。
- 默认正式route已接声明服务，但不装载任何staging/execution真实driver且人民币授权上限0；`quote`不可确认或精确前置错误，`confirm`任务/预留0。无新grant/env旁路、无新WorkBuddy工具；租户同源核心不含兰琪字符串或候选Skill运行引用。
- BY-45授权快照附加stagingLeaseId；重放任务先查tenant/user/request fingerprint，再决定是否暂存，已清理lease不触发重传或第二任务。列表先按tenant/user过滤，再逐个核验素材，资源撤销/缺失仅隐藏对应项；DB/审计/产品权限错误仍失败关闭。

## BY-45 beauty-video-replication-v1（2026-09-05）

- 复用`/viral-video-replication`与既有`ViralVideoReplicationJob/CreditReservation/CreditTransaction`，不新增队列、Schema或通用Skill。固定`wan2.2-animate-mix`与北京异步API；提交`input.image_url/video_url/watermark=true`、`parameters.mode/check_image=true`。只读取返回的精确task ID进行同地域poll，无付费重试。
- 客户body为strict Schema，不接受tenant/brand/授权对象注入。四项consent仅表达用户确认；执行权由服务端tenant/user/product/store/file ID/hash/role/rights/expiry、尺寸/类型/时长、积分和人民币上限提供。BY-45交付时server未绑定素材授权/staging；BY-46补齐持久声明及本地暂存，真实执行仍默认fail-closed；不可用公网文件URL绕过。
- 单tenant/requestKey/input fingerprint对应一个任务及一笔预留；冲突409，余额不足402，缺前置422。跨用户/店/租户的任务或下载404。callback只作为不可信提示，不改变状态、不接收远程URL为成功证据。
- 状态：queued→submitting→submitted/processing→succeeded；失败/取消/提交结果不明分别failed/canceled/terminal_unknown。仅queued可取消；中断提交不重发，已知task只可恢复查询。查询间隔15s、最多240次、24h截止，过期未知释放测试/客户积分，不伪称Provider退款。
- 成片必须通过严格HTTPS结果host、大小/MIME、MP4容器、ffprobe H264/时长/尺寸、私有本地原子落盘和hash后才结算；失败只释放一次。客户端只收到本地鉴权下载路径，不返回远程临时URL/存储key；旧无版本任务不以新规则重算或假装可下载。
- 后续真实staging适配必须绑定同一文件hash与授权，精确批准host，禁止私网DNS/重定向，并有受控TTL及终态清理。BY-46把本地实现TTL收窄到15分钟并实现授权撤销/可审计清理，但未上传/公开真实私有素材；不得设置`stagingReady=true`冒充云端接入完成。
- 费用只做静态保守预算：北京std60分/秒、pro90分/秒，至少2秒；不得复用旧单批1元图片授权。本项真实Provider请求0，未申请或物化视频grant。

## 小红书真实文案合同（wechat-xhs-content-line@1.0.3）

- 生成前的最小资料合同固定为：`本次主题与目的`、`本次项目/服务`、`目标顾客`。项目和目标顾客可由当前租户已确认经营档案提供默认值，本次字段优先且只属于当前任务；城市、门店事实、内容角度、语气、三图视觉、补充事实和禁用内容均为选填。任一必填缺失必须在Provider、AgentRun和积分预留前返回精确preflight，不得先生成再让事实门禁兜底。
- 任务事实directive、Provider结构适配、正式Eval和持久化任务快照必须读取同一份有效任务事实；不得让经营档案预填只显示在页面而不进入正式事实清单。Web与WorkBuddy共用该服务端合同。

- 客户图片合成合同固定为 `beauty-image-composition-v1.1`：Provider只生成纯画面底图；通过持久化plan/prompt/safety版本和当前safety后，服务端先在任何积分预留或Provider调用前用真实CJK字形测量验证三角色叠字，再以仓库版本化CJK字体与确定性布局生成同尺寸最终PNG。只移除编号等非语义展示前缀；重复语义、无法完整容纳或含不可靠符号的文字精确失败关闭，不自动改写、不以省略号截断。底图与最终成品分别原子持久化，客户资产接口只返回最终成品，底图仅限同租户内部审计。
- 内容角色 post-generation 合同固定为 `beauty-image-content-role-contract-v1`：通用 safety PASS 后仍要拒绝多分区拼贴；包装、瓶罐、容器、标签和品牌承载物只有在可重复的本地语义证据通过时才可自动交付。当前语义能力不足时必须返回 `manual_review_required/content_semantics_unverified` 并保持客户不可见，不得以人工目视、SHA白名单或Prompt承诺替代自动门禁。新任务必须持久化角色合同版本，历史任务按记录版本只读恢复。
- 封面叠字来自用户在正式标题候选中明确选择的标题；内容/互动叠字只能来自正式结构化合同的短句。客户端不能传任意自由文本绕过事实或版本。合成状态、版本、字体别名、文本hash、尺寸和最终hash必须进入脱敏回执，Prompt、密钥和Provider原始响应不得进入。
- 图片执行资格由服务端的beauty-industry产品开关、tenant/product entitlement、积分、人民币预算和幂等共同推导；不得依赖开发者手工留下的一次性媒体批准。受控验收grant只做额外的调用/费用上限，不成为普通Web/WorkBuddy可伪造参数。

- 固定`capability=beauty_xiaohongshu_package`、`scope=acquisition:xhs`，主Skill为`wechat-xhs-content-line@1.0.3`，美业差异与合规约束版本不变；客户端文本不得切模型、Skill或品牌知识。
- 标题、客户正文、制作说明与审核回执任何一层都不得写入用户输入或授权资料未提供的第一人称体验，包括“我做过”“亲测”“做完后”等；没有可核验第一人称经历时只能使用门店中性说明。违规继续在保存前fail-closed并释放积分，禁止模板覆盖、repair或降级模型。
- 正式页面只显示用户可理解的“正式文案生成已就绪”，不得暴露模型、Provider、Skill、capability、Prompt、参数或技术验收文案；图片必须在文案成功和报价/授权/租户/预算门禁通过后由用户另行确认，最多3张，不自动重试、补图或追加。
- XHS Web工作台是同一正式合同的客户呈现层：标题候选可选择，客户复制只含选中标题、正文与5–8个话题；productionNotes/auditReceipt保持结构化供Web/WorkBuddy审核，但不得混入客户复制或主结果。图片仍关联同一已保存文字任务与持久化plan版本，客户端标题选择不得改写服务端事实、Skill或媒体合同。

## 品牌包与租户归属合同（v1）

- 版本：`beauty-industry-brand-v1`。合法运行品牌为默认 `default` 与已注册 `lanqi`；未知、被移除或版本不匹配的持久值只能回退默认核心，不能加载模糊别名或候选资产。
- 服务端品牌来源仅限 beauty-industry 产品邀请码和租户档案。客户端提交 `brand`、`brandCode`、`knowledgePackRef` 必须在Provider、AgentRun和积分预留前以 `beauty_brand_override_forbidden` 失败关闭。
- Web公开上下文只含显示配置和知识状态，不返回内部 `knowledgePackRef`、知识正文、邀请明文或凭据。WorkBuddy `tools/list` 和正式结果返回同一脱敏brandContext；credential必须与当前tenant/product/operatingEntity一致。
- 兰琪显示包为 `displayName=兰琪`、`theme.tokenName=lanqi-orange`、文字logo、共享现有域名；`knowledgePackRef=null`、`customBrandKnowledge=false`、`authorized=false`。这些字段不得改变 capability/scope/workflow/Skill/Schema/Eval/账本。
- 品牌知识只有在来源授权、provenance、租户隔离、脱敏Eval和正式版本全部通过后才可进入第三组合层。当前任何候选WorkBuddy知识、客户经营数字、价格、疗效、案例、去水印能力均不在合同内。
- `InviteCode.brandCode` 是可空服务端字段；仅 beauty-industry 的受控邀请码允许 `lanqi`。默认邀请码/开发租户不写品牌归属，默认核心独立运行。即使环境配置为邀请非必填，只要客户端显式提交邀请码，服务端仍必须校验数据库记录并采用其brand authority；只有完全未提交邀请码时才允许走可选邀请分支。

## 产品与身份

- 稳定 `productCode=beauty-industry`；不得借用 `lanqi`。
- 可见产品识别固定为主名称“美业智能体”和副标题“门店 AI 经营大脑”；租户、城市、环境状态必须独立显示。
- 凭据随机、一次显示、服务端只存 hash，绑定 tenant/user/product/operatingEntity/scopes；支持到期、撤销、轮换、限流、审计和最后使用时间。
- MCP 请求参数不能自报 tenantId、userId、productCode 或 operatingEntity 绕过令牌身份。
- 一个行业产品一个连接可使用其已授权的多个 tools；不为每个 Skill 发一把密钥。
- 邀请制内测的 active scope 固定为 8 个：选题、内容系统（当前交付十件套）、小红书图文、直播话术、视频数据复盘、视频内容复盘、直播复盘、美业销售。凭据列出、轮换和 WorkBuddy `tools/list` 必须保持同一授权范围。
- 人工测试积分必须已有 active 产品 entitlement，使用唯一 grant id 幂等记账；不得创建支付订单或模拟充值。

## 导航与独立页面

- 工作台、日报、知识问题、美业获客、美业销售、美业专属交付、美业专属经营、任务中心、经营档案和 WorkBuddy 连接各自拥有唯一稳定 URL、页面标题、主内容和选中态。
- 图文、视频、直播获客拥有各自稳定子路由；选题、内容系统、复盘系统及两个复盘子页、直播话术、直播复盘和销售既有深链继续兼容，不改变 capability/Skill/tool 映射。
- 已开放模块必须读取服务端 entitlement/tool 清单；无权限时不得显示执行表单。规划中页面必须可访问，但只能显示用途、开放状态、前置条件和能力边界，不得包含伪按钮、假数据或执行调用。
- 所有导航必须支持直接深链、刷新、浏览器前进后退、桌面和 390px；未知美业路径进入产品内 404。导航、规划页和 404 不创建 AgentRun、媒体任务、积分流水或 Provider 调用。

## 知识与品牌

- 通用美业只加载通过 Eval 的美业行业 Skill 和购买方获授权知识。
- 兰琪品牌版以后使用兰琪凭据，额外加载兰琪品牌配置和专属智库；通用美业、其他品牌和其他租户不可读取。
- 通用输出不得出现兰琪名称、配色、内部定价、A/B 验收店、tenantKey 或测试租户标签。
- 缺少门店、价格、资质、功效证据、案例或真实数据时明确待补；不能由模型常识补成当前门店事实。

## Get笔记同步任务合同

- `POST /knowledge-base/connections/:id/sync` 对 Get笔记固定返回 202 持久任务，不等待外部列表、详情和数据库写入；`GET /knowledge-base/connections/:id/sync` 与 `GET /knowledge-base/sync-jobs/:id` 只允许当前租户 owner/admin 查询。
- 同一 `tenantId + connectionId` 只能存在一个 queued/running 任务；重复点击返回同一任务。任务状态为 queued/running/succeeded/failed/interrupted，阶段至少包含 listing、details、throttling、backoff、parsing、persisting、binding 和 terminal；刷新不得丢失。
- 增量水位只从当前租户当前连接文档读取。列表更新时间可证明不新于本地时跳过详情；详情 hash 相同时跳过写入。部分详情失败可保存成功项，但不得推进 cursor；列表缺失不等于远端删除，不删除本地知识。
- Get笔记 350ms 详情节流、429/5xx 最多 4 次单请求指数退避保持。授权失败不可重试；限流/临时失败可重试；进程失去心跳进入 interrupted 并从最后成功 cursor 恢复，不伪造完成。
- 观测只记录阶段、计数、耗时、退避、脱敏请求指纹和租户内技术标识；禁止记录笔记标题/正文、API Key、Client ID、Prompt、客户数据。连接建立和内容同步完成是两个独立状态。

## MCP 产品包

- 用户交付物是美业行业 MCP 连接，不是 Skill 压缩包。
- `tools/list` 只返回当前 product/scopes 已开放的工具；不返回 Skill 路径、Prompt 或内部注册信息。
- 网页与 MCP 必须复用同一 Agent/Skill/知识、entitlement、钱包和 usage ledger；每次调用记录 credential/run/capability/channel/provider/积分。
- 余额不足必须在 Provider 调用前拒绝；相同 credential + idempotency key 不得重复调用或扣费。
- 超时、取消和 Provider 失败不得自动重试、自动降模型或用固定模板冒充结果。

## 美业 AI 日报合同

当前准入状态（2026-08-26）：合同已实现但 live 准入未通过。首次固定白名单采集 36 HTTP 后只有 1 条候选；用户明确授权的不可重放同日人工 grant 再执行 29 HTTP 后仍为 0 条严格候选，`providerCallCount=0`、费用 ¥0。两次均未发布，正式 09:00/导航/WorkBuddy/生产继续 fail-closed。

- 固定 `product=beauty-industry`、`capability=beauty_daily_brief`、`tool=beauty.daily_brief`、`scope=operations:daily-brief`、`contractVersion=1.0.0`、`timezone=Asia/Shanghai`、计划时间 09:00；自由文本不得改路由。
- 唯一任务/结果键至少为 `product + 北京时间业务日期 + contractVersion`。正常任务、错过 09:00 的补跑和受权人工重试共享该键、数据库租约、调用计数和账本；同日同版本只能有一个成功快照和一次结算。
- 日报是公开资讯产品快照，可在获权租户间复用；不得读取租户私有经营档案或跨租户共享任何私有水位、内容、凭据。GET/历史/POST 和 WorkBuddy 均先校验 beauty-industry entitlement，生成/重试只允许 owner/admin。
- 结构严格为 15 条、5 个固定版块（模型动态、产品发布、行业风云、企业改造案例、趋势洞察）、每版块 3 条、3 条趋势、1 个今日动作。每条来源事实层至少包含 `source/title/summary/sourceFacts/sourceIndustry/sourceLabel/sourceUrl/publishedAt/verificationStatus`；美业解释层至少包含 `inferenceLabel=beauty_interpretation/sitongComment/possibleImpact/applicabilityConditions/verificationNeeded/beautySegments`。`summary` 70–120 字，`sitongComment` 50–90 字。
- `verified_hotspot` 需要可访问的一手/权威 URL、日期和标题摘要事实一致证据；`trend_observation` 只能作为明确标记的趋势观察，不能补位冒充当日新闻。来源层接受六域内真实通用 AI、模型、产品、监管、产业或企业改造新闻，不再要求原文直接出现美业词；但原文没有直接美业证据时，`summary/sourceFacts` 禁止声称美业案例、门店成效、品牌、数字或经营结果。企业/零售/本地服务案例须保留原行业身份，美业可借鉴点只能写入已标记推断层。
- 来源先使用截至业务日 09:00 的 24h 窗口，不足才扩至 72h；72h 仍不足、非 AI、URL/日期/可访问证据缺失、重复、事实不符、推断未标记、医疗/疗效/价格违规或跨产品污染均失败关闭，不准静态 fallback、旧闻或模型常识凑数。
- 六域各自有显式 adapter 绑定授权列表入口与来源分类；共享 parser 只承载 RSS/Atom、JSON-LD、meta、time 和语义正文能力。发布日期只能来自文章元数据、语义正文时间或同列表条目的最近日期，缺失时不得默认为当天；正文必须排除导航/页眉/页脚/侧栏/表单，列表摘要和站点模板不得冒充文章事实。详情失败必须区分标题、日期、72h窗口、正文、AI事实与合规原因，并按域记录脱敏计数。
- 六个白名单域的详情候选必须按域分桶、域内按美业相关性与截止日前新鲜度排序，再轮询调度。首轮每个有候选域最多 5 个逻辑详情，全部有候选域完成首轮后才能重分配；单域逻辑详情绝对上限 10。逻辑列表最多 6，详情和详情跳转实际 HTTP 最多 30，全部列表/详情/跳转总 HTTP 最多 36。
- 只允许同一白名单域或六域之间最多 2 跳的规范跳转；每个实际跳转请求都在发送前计入日/月预算，最终 URL 重新检查 HTTPS、精确白名单、无凭据、端口和 IP literal。站外、循环、超限或无效 Location 立即阻断；412 归为来源适配器不可访问，不得伪造 Cookie/登录态、绕过反爬或自动重试。
- 15 条日报必须具备来源多样性：候选池至少 4 域并含监管、研究、行业媒体三类；正式结果任一域最多 6 条、每个版块至少 2 个来源域。来源不足时失败关闭，不得为配额或多样性放宽事实、时间、美业相关性、医疗合规或去重门禁。
- 任务状态至少区分 queued、collecting、verifying、generating、validating、succeeded、source_insufficient、failed、terminal_unknown；同时记录业务日期、截止时间、触发类型 scheduled/catchup/manual、24h/72h 窗口、来源计数、最后成功和下次 09:00。Prompt、来源正文、模型原文、密钥和客户数据不得进入日志。
- 08:59 不运行；09:00 只入队一次；服务恢复且已过 09:00、当天无成功/活动任务时只补跑一次。多实例通过数据库唯一键和有期限租约仲裁；租约过期仅在 Provider 调用数为 0 时可恢复，已调用/终态不明不得自动重试、换模或追加付费。
- controlled mock 只允许全合成来源并显著标示“测试结果，非实时资讯/非真实模型质量”。正式来源、模型、scheduler、导航/WorkBuddy 工具开放和部署均受独立配置与持续运行授权门禁；默认请求/模型/费用上限为 0，未授权 live 配置必须 fail-closed。
- 同日人工验收例外只能由仓库 CLI runner 以创建即消费的独立 grant/task 承载，并关联原日键与旧计数；不得暴露成普通 Web/WorkBuddy 参数，不得清零旧计数、伪造日期或改合同版本。该 grant 的 72 次同日审计上限不属于产品运行合同，生产常规预算仍为 36 HTTP/业务日。

## 选题 2/4 来源与错误分类

- 固定 `topic_inspiration / acquisition:topics / baolu_topics@2.1.2 + beauty-industry-content-diff@1.1.0 + beauty-industry-compliance@1.0.0`；Web 与 WorkBuddy 共用结构化 `topicWorkflow`，自由文本不得改变路由。
- 正式最低条件为获客目标、目标顾客、细分赛道和至少一个真实可用来源；满足时即使只有 2/4 也生成第一版 TOP10，逐项标明已用来源和待补/待核验来源。零来源或最低业务字段不足在 Provider 和账本前返回 422，说明缺什么、在哪里补和影响什么。
- controlled mock 只可根据同一正式来源合同产生确定性流程夹具，必须显示测试环境，不代表真实模型质量；不得写入不存在的平台数据、热点、顾客、案例、疗效、价格或经营事实。
- 版本化美业选题的 Provider 输出不得被共享 Agent 确定性模板替换。污染、事实矛盾、跨行业和结构缺失继续由正式 postflight 失败关闭，AgentRun 不保存、积分释放。
- API 安全错误类别固定区分 `preflight`、`pollution`、`structure`、`provider`、`timeout`、`cancelled` 和 `validation`；响应只给稳定 code/category 与可操作提示，不返回 Prompt、原始输出或客户内容，也不得把非资料问题统一解释为“补来源”。

## 获客外部动作

- 内容、直播、销售和复盘只生成草稿或诊断；投流、DOU+ 与巨量本地推不属于当前美业产品工具清单。
- 发布、投放、付款、充值、消息发送和真实媒体生成必须有独立授权与幂等计费。
- 文生视频、图生视频只有实际 Provider、存储、费用、授权和 Eval 全部就绪后才开放工具。

## 美业获客三分支

- 美业获客首页只保留“图文获客、视频获客、直播获客”三张一级卡；不存在获客问答或独立直播策划。视频获客页允许“爆款复刻”规划卡，但不得创建任务或伪结果。
- 图文获客固定路由 `beauty.xiaohongshu_package`：交付标题、正文、标签、互动承接与 1/3 张配图方向；真实图片与文字必须同任务、同页面、同历史。未获媒体授权时只交付文字和专业配图方向，并明确没有可下载资产。
- 图文正式主 Skill 为 `wechat-xhs-content-line@1.0.2`。服务端须从当前任务/专业字段锁定时点、服务项目、地理范围、目标顾客、平台和交付形式；Web 与 WorkBuddy 共用同一事实清单。正式输出必须先有逐项“任务事实回执”，再交付至少 3 个标题、完整正文、5–8 个标签、互动与承接、事实与合规待补，以及三套各自的正向视觉提示词、负向提示词、后期叠字和供应商无关视觉参数。标题、正文、标签和相关配图必须与回执事实一致；合理同义表达可归一化，漏项或矛盾均在保存前失败关闭。生产配图 parser 以 `负向提示词` 为正式字段，并只为历史结果兼容 `负向视觉提示词`；任一方向缺字段都不得创建媒体确认入口。
- 三图媒体交付合同为完整合格交付：每个 Provider 任务保留独立 `technicalStatus` 与 `qualityStatus`，只有风险筛查 `passed` 才能设置 `customerUsable=true` 和客户资产 URL。可核验的二维码/条形码样式、可见文字/乱码/品牌样式、界面/水印样式为 `visual_quality_rejected`；本地证据不足为 `manual_review_required`，两者都保持客户读取/下载404。每项证据只含 detector/confidence/bbox/有限几何指标，不声称理解全部画面。三张任一未自动PASS则 batch=`quality_failed`、不自动重试/补图/换模；客户/测试积分不结算，既有 settled 通过一次幂等补偿净退，历史 consume 与 Provider 真实成本不可改写。
- 小红书同页图片关联合同当前版本为 `beauty-xhs-image-plan-v2`：由同一已通过正式 Schema/Eval 的XHS AgentRun派生默认标题、封面/内容/互动角色、3:4构图和中文后期叠字边界；历史plan-v1仅按其持久版本只读恢复，不重算。互动角色必须生成与正文主题一致的完整纯摄影静物或环境细节，不得预留/暗示文案排版区，不得生成海报、卡片、清单、信息图、社交UI、按钮、对话框或标题栏；中文互动文案仅作为网页交付或后期叠字元数据，不进入Provider画面。媒体job持久plan版本、Provider prompt版本、标题hash、文字Skill版本、role和ratio。客户quote只返回图片数量、积分、可确认状态与安全计划，不返回正负提示词、Provider、模型或人民币估算；客户复制只含标题/正文/话题。内部制作说明仍供服务端构造payload与WorkBuddy结构化审计，但不得拼入客户正文。
- Provider 技术成功后的资产链必须分段记录 `storage_preflight/url_validation/download_request/download_response/content_type/payload_size/path_resolution/directory_prepare/image_write/metadata_write/image_commit/metadata_commit/asset_verify/quality_screen`。任务只允许保存稳定错误码、阶段、有限HTTP状态和retryable判断，不得保存Provider URL/查询参数、响应正文、Prompt、密钥或绝对路径；图片与元数据均经临时文件原子提交。任一资产阶段失败均为客户不可见的终态，不自动重新查询Provider、重试、补图或追加扣费；历史合并码只读兼容，不得用当前链重算。
- `controlled_mock` 必须通过与 configured Provider 完全相同的 Skill/Schema/Eval、事实、污染、保存前和账本门禁；页面必须明确它只验证路由、权限、合同、积分、保存和恢复，不代表真实模型质量或客户最终内容。相同进行中 requestId 只能形成一个 AgentRun/结算；终态失败后的用户显式重试使用新 requestId，不得自动重试或按内容指纹永久阻断合法重试。
- 视频获客一级页固定为选题系统、内容系统、复盘系统、爆款复刻（规划）、文生视频（规划）、图生视频（规划）。内容系统的当前正式交付仍是十件套：选题、口播逐字稿、访谈话术、拍摄脚本、拍摄注意事项、剪辑 EDL、发布标题与话题、最佳发布时间、评论区引导话术、投流建议；旧 `/content-ten` 仅作不丢 query 的兼容别名。复盘系统独立页只选择既有数据复盘与内容复盘；规划页不得创建任务、扣费或调用 Provider。
- 视频数据复盘只接播放、完播、互动、转化等结构化指标；视频内容复盘只接受控视频文件并分析画面、口播、节奏、拍摄、剪辑和字幕。两者的文件类型、字段和结果不得互换。数据复盘的正式报告和事实 Eval 必须使用同一标题摘要规则，并同时核验有效记录数、代表作品与已提供的播放/完播/3秒留存/平均时长/互动/咨询及业务转化汇总；长标题显示摘要不能被误判为事实丢失，也不能借摘要放过核心数值缺失。
- 直播获客固定为直播话术和直播复盘；直播材料不能路由到视频复盘。
- 美业销售固定路由 `beauty.sales_advice`，两阶段合同版本为 `beauty-sales-two-stage-v1`。快速模式返回 `quick_response`：最短有效异议可在不补造项目事实的前提下生成一条自然、简短、可发送的初步回复，并给出 3–5 个结构化补充方向；复制默认只包含可发送回复。专业模式返回 `professional_advice`：项目、已确认价格/优惠边界、顾客原话或主要顾虑、沟通阶段、允许的下一步动作均为必要字段，缺失时必须在 Provider/积分预留前精确 422，补齐后才可输出当前判断、异议、核心破局点、推荐回复话术、客户可能回复与预判应对、下一步动作。两种模式都不得虚构顾客资料、医疗适用性、疗效、价格、案例、名额或已成交结果。
- 每个工具只接受自己的专业参数集合。显式 `toolName` 锁定 capability/Skill，自由文本不得重路由。
- 下一步运行必须校验同租户、同用户、同产品的 `sourceRunId` 和允许的任务转移；旧结果只作为 AI 草稿上下文，不自动晋升为门店事实。

## 视频内容复盘正式合同

- 稳定页面路由为 `/agents/beauty-industry/acquisition/video/content-review`；固定映射为 `beauty.video_content_review / acquisition:video-content-review / shooting_editing / baolu_content_creator@5.0.0 / beauty-industry-content-diff@1.1.0 / beauty-industry-compliance@1.0.0`，自由文本不得改变。
- Web 与 WorkBuddy 共用 `video_content_review_workflow_v1`：平台、账号/视频标识、标题/原文案、业务目标、目标人群、转写、视觉证据、场景时间轴、内容结构、事实边界、服务端媒体预检。请求不得自报租户或伪造成功预检。
- `POST /beauty-industry/video-content/preflight` 必须先校验登录、租户和美业产品访问权，再读取 multipart；只接受 MP4/MOV/M4V/WebM，在服务端校验大小、非空、真实容器、时长和分辨率，临时原件请求后删除，不写数据库或浏览器持久化。
- 预检固定 `providerCalls=0`、`creditCost=0`，不得创建 AgentRun、积分 reservation/ledger 或 Provider trace；失败、超时、取消、错格式、损坏与重复点击都不得自动重试、调用模型或保留旧成功回执。
- 正式结果必须依次包含视频基本信息、现有版本诊断、优化版选题定位、口播逐字稿、拍摄脚本、拍摄注意事项、剪辑 EDL、发布策略、投流建议和核心改进点，并以可核验画面/口播证据为依据；不得把视频数据指标报告换皮，不得编造画面、疗效、价格、顾客案例或平台数据。
- `QA-20260823-002` 已由一次获批的固定双流合成资产验收关闭：qwen-vl-max 命中全部登记画面事实，qwen3-asr-flash 转写命中合成逐字预期，两份证据进入正式 `visualEvidence/transcript` 且 `fallbackUsed=false`。因此仅恢复上述 scope、WorkBuddy 工具与 Agent capability。每个业务视频仍必须提供当前租户可核验的真实口播与画面证据；元数据预检、用户猜测或模板不得冒充本视频的内容理解，缺一即在 Provider/AgentRun 前失败关闭。

## 直播复盘正式合同

- 稳定页面路由为 `/agents/beauty-industry/acquisition/live/review`；固定映射为 `beauty.live_review / acquisition:live-review / live_review / baolu_live_review_engine@3.0.0 / beauty-industry-compliance@1.0.0`，自由文本不得改变。
- Web 与 WorkBuddy 共用严格 `live_review_workflow_v1`：场景、平台、场次标题/时间、业务目标、后台真实数据、录音转写、原话术计划、互动证据、项目证据、转化口径、用户确认画面证据、事实边界及文件解析状态。请求不能自报租户或用文件名冒充已解析内容。
- 数据文件仅接受 CSV/XLS/XLSX，经既有受鉴权媒体解析链读取；只有真实数值记录和绑定的解析回执才可进入正式合同。解析固定 Provider/积分 0，原文件和回执不写浏览器持久化，刷新后须重新选文件。
- 三类核心证据为后台数据、录音转写和原话术计划。数据与转写全缺时在 Provider/账本前失败关闭；部分缺失必须明确补什么、在哪里补和影响哪个模块，允许按正式 Skill 降级，不得用模板补齐或声称看过未连接录屏。
- 结果固定依次包含核心数据速览、流量诊断、转化归因、互动诊断、话术执行对照表、人货场诊断、方法论沉淀和下次直播调整清单；所有因果结论须有时间对齐证据，否则标待核验。不得编造场观、停留、互动、成交、顾客、疗效、价格、话术或画面事实。
- Web/MCP 复用同一执行、权限、租户、AgentRun、账本、幂等与失败释放链；失败、取消、超时不得自动重试、换模型、降级到固定模板或重复扣费。

## 经营档案与任务记忆

- 美业档案固定归属当前 `tenantId + productCode=beauty-industry`，来源只能是 `user_confirmed`；请求参数不能覆盖租户、产品或经营主体身份。
- 档案只含门店级与任务级事实，支持查看、修改、删除、版本和确认时间；不接企微、订单、会员、顾客聊天或顾客级动态记忆。
- 六类细分赛道必须由用户确认；生活美容与医疗美容不能互相推断。医疗美容必须提交可验证的资质/服务范围/禁止承诺边界。
- 快速/专业模式必须进入同一 Agent/Skill 执行链；专业参数只是本次任务补充，不能自动晋升为长期门店事实。
- 网页和 MCP 共享同一档案版本、AgentRun、账本和幂等键。不同租户、产品或经营主体不能读取或修改对方档案与历史。
- 今日动作最多 3 项，只能根据已确认档案和已完成运行给出建议；不能写成已发布、已投放、已付款、已发消息或已产生经营结果。

## 硬失败

跨租户/跨产品泄露、兰琪专属知识进入通用美业、虚构疗效/价格/案例/门店事实、未确认付费调用、重复扣费、越权外部动作、候选 Skill 未经 Eval 直接注册，任一发生即失败。

## BY-38 确定性品牌视觉合同

- 固定版本：`beauty-deterministic-visual-v1`；固定角色：cover/content/engagement；固定尺寸：768×1024 PNG。输入主题只能来自服务端 tenant/product 品牌配置，客户端不能自报 brand 或覆盖租户主题。
- 底图必须无文字、Logo、二维码、条码、水印、UI、包装物和可识别品牌承载物；每张生成回执必须匹配版本、角色、尺寸、内容类型、资产SHA、主题哈希和最小形状计数。任一不符失败关闭。
- 回执不能绕过通用图片安全门禁。通过后才允许 `beauty-image-composition-v1.1` 叠加已确认中文元数据，并将底图/最终图及租户元数据原子持久化。
- 一次确认恰好三张、300积分一次预留与一次结算；不足3张、重复确认、越权、哈希或版本漂移均不得创建客户资产。外部图片Provider调用0、人民币Provider费用0。
- Web 与 WorkBuddy共用同一媒体状态与资产授权；历史Provider批次只按记录版本读取，旧URL/旧任务不能选择当前 fallback 或重算资产。

## BY-43 真实商业摄影三图合同（P1打开）

- 新批次唯一active chain固定为`beauty-xhs-image-plan-v2 / beauty-image-provider-prompt-v1.7 / aliyun_bailian:wan2.7-image / beauty-image-safety-v2.14 / beauty-image-composition-v1.1`；历史`local_deterministic`和旧prompt版本只允许按记录恢复，不得被新任务选择。
- 三角色底图分别是接待咨询、护理空间、咨询承接的3:4商业摄影；Provider输入必须英文纯画面并禁止人物、可识别门店、文字、字母、数字、Logo、品牌、QR、条码、水印和UI，中文只由服务端后期合成。
- 图片费用按整数分计算：单图保守20分，三图60分；与环境人民币硬上限比较不得使用浮点乘法造成合法¥0.60误阻断，也不得通过舍入放行超过预算的调用。
- 真实终验若人工发现自动门禁漏检，必须整批`quality_failed`、客户资产0、停止后续Provider任务并全额释放300积分。人工可拒绝，但不得把人工“可用”覆盖自动拒绝或替代自动安全检测。
- 历史真实证据证明`safety-v2.13`对伪英文、设备Logo、人像/QR样式桌牌及包装文字组合存在假阴性，已由`safety-v2.14`关闭检测缺口；随后真实图仍因v1.5中央接待墙诱发伪招牌并被v2.14正确拒绝。v1.6消除中央招牌墙后仍因接待台水平表面诱发展示牌；v1.7进一步要求封面无前台柜台、角色必需桌面完全空置并排除独立展示物。修复后真实3/3证据完成前，正式验收环境媒体必须保持disabled/max0。

## BY-02 归档静态原型

- 原型固定独立路由，不复用已接后端的 BY-01 页面冒充静态验收。
- 页面必须持续标识“页面原型/合成示例”，不得发起 API、模型、媒体、计费或外部动作。
- 该原型阶段的未开放模块只做不可点击状态说明；正式产品从 BY-14 起以稳定规划页合同为准。原型小红书结果只允许本地合成切换、复制、下载与显式保存。
- 原型确认不等于功能确认；后端接入必须另立任务并重新执行权限、事实、费用和失败路径门禁。
