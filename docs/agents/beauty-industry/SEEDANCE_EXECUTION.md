# Seedance持久授权与受控执行 v1（BY54）

本地后端工程合同，不是视频产品放行。默认 `SEEDANCE_EXECUTION_MODE=disabled`、密钥/签名根/账号/积分报价版本为空、积分报价0。没有注册公开Seedance route/tool/button，不替换wan，不恢复任何PAUSED功能。正式来源见[官方核验](SEEDANCE_ROUTE_REVIEW.md)，协议见[BY53](SEEDANCE_ADAPTER.md)。

## 单一执行链与边界

`server actor + requestKey → signed BeautyVideoExecutionPermit → 当前门店membership/beauty entitlement → signed Ark asset review + 原始文件/依据hash → BY53 payload → 原积分预留+permit claim+BY51 started同事务 → 单次POST → 持久journal/usage → 有限GET → 单次私有下载 → ffprobe/原子MP4与恢复回执 → 原积分finish事务 → owner下载`。

执行工厂在 `beauty-seedance-execution.ts`，不是新队列。复用 `BeautyVideoExecutionPermit`、`ViralVideoReplicationJob`、`CreditAccount/Reservation/Transaction`、`AuditLog` 和原视频保存器，无Schema/迁移、第二账本或平台重构。请求只允许正式BY53输入；grant/tenant/provider/model/预算/URL/素材审核不能由请求体覆盖。签名绑定tenant/user/store、用途、账号、请求hash、两个file/review/version/hash、价格/成本/次数和积分报价。

工厂不读取 `.env` 文件、不创建真实许可或审核。宿主显式传配置；真实默认HTTPS实现已存在，但缺有效签名范围时在外部访问前拒绝。测试必须同时注入API及结果transport，签名 `access=local_only` 只能用于该模式，绝不转换为 `provider_https`。不同签名根保护执行许可和素材人工审核，不能与Provider key复用。

## 素材授权不是客户端声明

没有已独立证明的Ark审核查询API，因此明确使用 `beauty-seedance-manual-review-v1` 人工控制台核对契约，不声称自动查询已完成。

- 专用审核者核对账号、官方asset接收状态、肖像/场景用途、许可依据后，形成受控签名审核记录；本轮只测试合成记录，不提供公开签发端点或拿测试资料当真实权利。
- 存既有AuditLog：action=`seedance.asset_review`，resource=审核版本；审核者标识/时间、依据file/hash、控制台证据hash、asset ID/账号、用途、owner/store、有效期、版本和撤销状态。不存控制台页面、凭据或媒体正文。
- 逐次取最新有效签名版本；同版本冲突、超过100条待判记录、签名错误、撤销或版本变化均拒绝。不能拿旧approval绕过新revocation。
- 原始UploadedFile与依据文件都须同tenant/user，服务端实际读取私有文件校验hash、MIME、尺寸/字节和路径；声明不能替代字节证据。
- 首次执行进一步收窄为**两个已被Ark接收的reference_image asset**、5s/720p/9:16；双方都要求 `asset://`，不暗造HTTPS上传/staging。复用私有文件读取器限制单图≤5MB、尺寸300–4096且满足BY53比例；这不是官方全格式/30MB能力已接通。多视频/音频协议shape仍未开放执行。
- 下载要求当前membership/entitlement、创建者、店、资产最新审核/hash仍有效；跨租户/用户/门店不可读。执行许可到期禁止新云操作，不把它当Provider已取消或免费。

## 成本与积分严格分离

型号 `doubao-seedance-2-0-260128`；独立用途 `seedance_multireference`；定价版本 `seedance-2-0-standard-720p-cn-20260905`。首profile108000 completion tokens、46微人民币/token，模型估算¥4.968。

许可必须包含独立 `maxCompletionTokens=108000`、微人民币预算及正数存储/传输留量与其依据hash，不能复用wan按秒scope或旧图文¥1授权。提交前承诺整个签名预算（兼容旧permit字段按分向上取整，同时snapshot保留精确微单位）；每批POST≤1、GET≤20、下载≤1。观测completion超上限，即使估算费用仍低于总预算，也拒绝交付。模型token及存储报价是**应用限制/估算，不是云账单硬封顶**；无法证明上游真实账单不会超出，真实执行前仍需明确预算与残余风险批准。

`SEEDANCE_CREDIT_COST`与`SEEDANCE_CREDIT_QUOTE_VERSION`默认0/空；签名还需quote依据hash并与服务端配置一致。本轮100积分仅合成fixture，不是批准的商业售价。成功按原reservation结算一次；失败/未知释放一次，消费记录不修改、Provider成本不假退款。BY51按completion独立计量，total不双计，缺usage/账单为null不是0；同call观察追加且去重，积分释放不重置外部次数或预算。

## 超时、故障与恢复

- submit claim/积分预留/started同串行事务，数据库失败三者一起回滚；只对已回滚P2034/P2002最多重做两次SQL，绝不包住网络重试。
- POST响应不明或提交后数据库观察失败：保留submitCount=1，重启只读原记录，不再POST。不假称未发生费用。已知task可在原次数/期限内GET；未知taskId无补建。
- GET每次重新授权、原子claim计数/31s lease；30s总超时，1–64s退避不早于Retry-After，最多签名次数且≤20、总1小时。无内部循环sleep/无限重试，下一次受权refresh才推进。
- 失败/expired或不可恢复协议结果停止并释放；缺usage的success不下载/结算，允许原界限内后续GET补用量；到期/撤销/超过1小时在refresh时释放为terminal_unknown，外部额度保留。没有本轮新增后台回收worker，不把“下次refresh恢复”说成自动定时完成。
- 下载前签名/资产再核对，计数与persisting lease同事务；私有MP4下载≤200MB/60s，H264且严格720×1280/5s。失败不再下载，积分释放。
- MP4临时文件→ffprobe→hash命名原子rename→hash核对→元数据result.json原子rename。DB finish失败保留回执；120s lease覆盖60s下载+30s ffprobe及本地提交余量，过期后cleanup仅本job UUID.partial文件，验证回执/文件实际hash/ffprobe后恢复结算，不GET/下载第二次。旧writer即使超时返回也不能以原finish CAS覆盖终态或重复结算；未完成回执则terminal_unknown。不从孤立MP4猜任务成功，不声称任意慢盘SLA或已验证断电fsync耐久性。
- 原资产与审核证据不删除；本轮测试保留独立合成DB审计。只清本次生成的partial，不能清其他目录或历史成品。

## HTTPS与日志

API固定 `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`；GET只追加校验taskId。结果固定 `https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com` 下MP4。HTTPS/精确origin、无userinfo/fragment/非标准端口/API query，所有重定向拒绝；不复用Cookie、代理或连接池。

DNS所有答案必须公共IPv4，IPv6保守拒绝；lookup固定到已核验IP，socket remoteAddress一致；SNI、默认CA链和hostname核验保持启用。总timeout覆盖DNS与body；API64KB/结果200MB限制；不接受结果请求Authorization。注入测试验证这些实际https.request选项及失败分支，但**没有完成真实TLS握手/Ark账号/API兼容性终验**。

协议审计只保存stage/code/status/HTTP状态/耗时、模型/版本、请求及task指纹、response hash/bytes、计数/lease与usage价格。私有DB任务保留恢复必需taskId/fileId，审核保留受控asset ID，不向客户输出；不存Prompt、原始Provider JSON、结果签名URL查询、密钥/Authorization或素材正文。异常转安全code；DB终结失败保留可恢复状态，不泄露数据库错误细节。

## 本轮验收与下一恢复点

专项 `pnpm.cmd beauty-industry:seedance-execution-smoke`：三轮事务fixture；独立PostgreSQL同批三轮+每轮三个OS进程争抢唯一POST；测试专用HTTP注入覆盖确认/恢复/owner下载，不代表公开route或Chrome。合成故障含缺许可/假签名/跨账号/不足余额/权限撤销、超token、POST断线/DB观察失败、GET429/预算、缺及迟到usage、无效MP4、finish数据库故障与lease恢复、旧审核不可绕过、跨owner隔离、日志不含敏感字段。全局fetch禁止，真实网络与Provider0。

下一唯一缺口是**真实非生产Ark账号、两个已授权且官方接收的素材及本profile报价/预算的合并核验**：需人工控制台证据而非猜测API；真实生成还要单独授权。当前不登录、不读secret、不上传、不建真实许可、不启用户按钮或生产，不创建邀请码。完成代码不等于真实视频质量已通过。
