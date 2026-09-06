# 视频私有OSS暂存：实现与接入边界（BY-49）

当前接续：BY-50已完成默认关闭的execution/持久预算接线，下文“尚未安装execution”仅为BY49历史边界；真实云/视频仍未验证。当前合同以[VIDEO_CONTROLLED_EXECUTION.md](VIDEO_CONTROLLED_EXECUTION.md)为准，BY49安全暂存限制不变。

版本：`beauty-oss-private-staging-v1`；2026-09-05。仅通用美业核心，不加载品牌知识或WorkBuddy候选。**本地代码和注入协议验收已实现；真实OSS、真实视频、用户页面尚未验收，默认不开放。**

## 技术选择与复用

在既有BY45/46 `PrivateVideoStagingDriver`、持久lease、authorization、job、账本上增加一个可替换driver，不另建文件表/队列/业务数据库。选择阿里云OSS北京作为默认关闭的工程适配：与现有北京视频协议地域一致；不代表已获建桶、RAM、素材上传或视频付费授权。

仓库原来没有OSS SDK；clip-asr的DashScope POST policy属于另一产品用途，不能复用其身份。新增官方`ali-oss@6.23.0`精确版本，用官方V4签名/请求/XML解析；自定义urllib仅承担受限HTTPS transport。安装使用`--ignore-scripts`。没有复制WorkBuddy代码、手写V4算法或启用SDK自动重试。

配置入口为`createConfiguredVideoMaterialIntegration`，正式video route使用同一入口。只有完整可信配置才构造driver；仅配置存储**不会安装付费execution端口**。正式route当前仍`maxCostFen=0`、无execution，quote不可确认/confirm失败关闭；注入fixture永远`local_only`，不能配`provider_https`执行器。

## 精确配置与安全预检

所有字段只从服务端配置注入，不能来自Web/WorkBuddy body；`.env.example`仅空值说明，禁止填入真实secret后提交。

| 配置 | 要求 |
|---|---|
| BEAUTY_VIDEO_STAGING_DRIVER | 默认disabled；受控接线才为aliyun_oss |
| BEAUTY_VIDEO_OSS_REGION | 仅cn-beijing |
| BEAUTY_VIDEO_OSS_BUCKET | 受权专用桶，合法小写桶名；不能复用客户/生产桶 |
| BEAUTY_VIDEO_OSS_PREFIX | `beauty-industry/video-staging/v1/<3至32位环境命名空间>/` |
| BEAUTY_VIDEO_OSS_APPROVED_ORIGIN | 精确`https://<bucket>.oss-cn-beijing.aliyuncs.com`；不接受CNAME、代理、内网或其他域名 |
| BEAUTY_VIDEO_OSS_ACCESS_KEY_ID / ACCESS_KEY_SECRET / SECURITY_TOKEN | 仅短期STS三元组；ID必须STS.格式，不接DashScope key/长期AK，不自动请求STS或续期 |
| BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT | 有效ISO时间，至少覆盖本次lease到期再加5秒；不完整/过期在网络前503 |

每次上传前用SDK只读核对：桶Name/Location/ExtranetEndpoint精确一致、Standard、private、BlockPublicAccess=true、CRR Disabled；版本控制必须从未启用（Enabled与Suspended均拒绝）。只允许精确prefix的Enabled/1天过期生命周期规则且无Tag/Filter子条件。driver不创建/改ACL、桶策略、生命周期或RAM。

运维准备的最小RAM范围（需后续独立核验，不在本轮授予）：桶级GetBucketInfo/GetBucketVersioning/GetBucketLifecycle；仅上述namespace对象的PutObject/GetObject（HEAD与签名GET）/DeleteObject。不授予ListBuckets、CreateBucket、DeleteBucket、PutBucketPolicy、改生命周期/版本控制、其他产品prefix、KMS或跨区域复制权限。桶及RAM管理员须保证没有并发扩大权限/开启版本控制的操作；driver的只读preflight不是持续IAM审计。

STS配置不是素材用途授权。文件仍经BY46本人上传/租户/门店/角色/依据hash/version/expiry/revoke检查；`declaration_recorded`仍不等于独立法律审查。未授权真人/客户内容不能因有key而上传。

## 字节、签名和清理

1. 持久creating lease及对象身份后，读取BY46已核验bytes；对象名=`prefix/sha256/随机key-role.ext`，不含客户文件名。校验hash、MIME、角色、期限≤15分钟；reference≤200MB、portrait≤5MB。
2. SDK PUT单次发送Content-MD5、private、forbid-overwrite、AES256和sha256/binding摘要metadata。返回ETag和HEAD的hash/binding/MIME/大小必须一致；未知结果不重发PUT。
3. 签名GET由官方V4产生，有效期不超过剩余lease且≤900秒，固定host。signed URL只在服务端内存/执行handoff，不落任务、日志或客户端。原文URL任何query/path/host/binding修改都拒绝。重启恢复须先重验授权并重新签当前有效lease；已终止job的幂等恢复不重新上传。
4. HTTPS限定精确origin，解析全部IPv4并拒绝私网/回环/链路本地/保留段，连接固定解析地址且TLS验证原hostname。不支持IPv6、代理、redirect；请求20秒（含DNS）、响应64KiB、SDK retryMax=0、无refreshSTSToken。SDK debug若启用则在请求前拒绝，避免输出签名header/XML。
5. release先使应用侧lease不可用，再HEAD绑定核验→DELETE→HEAD404。对象不存在可重复清理；绑定不符不得盲删。DELETE返回版本/删除标记或HEAD仍存在均失败，记录cleanup_failed。撤权同时清理关联未结算job及**尚未创建job的lease**。
6. 显式`integration.staging.sweep()`复用原恢复口，每次≤100条，不新造Web setInterval。受控恢复需相同bucket/region/prefix和新有效STS，driver身份含配置hash；配置漂移不能认领旧lease。账本失败释放用既有CAS且不伪造Provider退款。

限制必须真实呈现：OSS签名URL是短期bearer，不能像本地每次GET那样实时回查数据库。删除成功使后续OSS读取失败；**删除失败时，已外发URL可能持续有效至≤15分钟期限**，已被外部读取的副本无法追回。1天生命周期仅是非即时清理后备，不是15分钟物理删除保证。清理失败时保留审计并阻止后续业务，不宣称“云端已撤回/已删”。

## 脱敏观测与失败语义

| 位置 | 可记录 | 禁止 |
|---|---|---|
| API结构日志`event=beauty_video.oss` | operation（bucketInfo/versioning/lifecycle/PUT/HEAD/DELETE/contract）、HTTP status、elapsedMs、安全code、对象路径SHA短指纹 | URL/查询签名、对象原名、正文、XML、AK/token、Authorization、SDK raw error |
| 既有AuditLog | tenant短指纹、固定阶段/代码、内部job/lease关系 | 客户输入/授权文件正文、Provider请求或响应正文 |
| BeautyVideoStagingLease / job | 固定对象hash/auth版本、到期、status、幂等/终态 | signed URL、明文凭据、跨租户副本 |

典型code：`oss_staging_configuration_invalid`、`oss_sts_credentials_unavailable`、`oss_debug_logging_forbidden`、`oss_bucket_policy_rejected`、`oss_versioning_not_supported`、`oss_lifecycle_required`、`oss_redirect_blocked`、`oss_http_403/429/500/503`、`oss_transport_unknown`、`oss_object_verification_failed`、`oss_delete_not_confirmed`。403/限流/网络/未知均不自动换桶、续key、重试或触发视频；更改RAM须另行授权。

## 验证分级与下一接线点

- 已实现：正式SDK driver、生产配置组装、授权/lease/job编排和未建job撤权清理；无Schema迁移。
- 已离线验证：三轮实际SDK签名/XML/方法，注入transport每轮124个请求形态、2次合成execution handoff、Provider0、积分净0；同tenant不同user/store、跨tenant、body注入、预算0、默认关闭、缺execution、STS过期、302/307/403/429/5xx、部分上传、清理失败/sweep、lease过期、重复/重建handler恢复、未知终态不重发与安全日志。
- 未验证：真实DNS/TLS/STS/RAM/bucket响应、真实云删除与计费、真实PG的新JSON包含查询（本轮事务fixture验证，原Schema/PG证据仍属BY46）、真实视频和Chrome页面。无DOM/路由URL/UI变化，本轮不重复1440/390，不发用户邀请。
- 下一可独立零费用工程缺口：正式route仍未把BY45真实执行端口、受控服务端单批授权/请求计数/人民币预算安装到组装；必须先明确并测试**一次性服务端执行授权接线**，不能只填key/设置driver就让普通confirm外发。此处是明确代码缺口，不泛称“只缺云合同”；本轮不提前启动下一卡。
- 后续真实存储最小方案（未执行/未授予）：独立受权北京测试桶与精确prefix，1轮、2个完全合成无人物素材各≤1MiB；每素材preflight3+PUT1+HEAD1+签名HEAD1+清理HEAD/DELETE/HEAD3=9，共18 SDK请求，另2次验证签名GET；建议总绝对≤24（含失败清理），无自动重试、不发视频。执行前按当时版本化OSS报价计算并锁定独立存储预算，无法计算即停止，不将“很小”冒称免费。
- 真视频最小2秒/模式费用仍按BY45正式报价预检，不能使用旧图文单批≤1元授权。未来须分别列出2个素材的授权范围、暂存请求/字节/期限、视频单次时长/费用与总上限；当前不申请或创建grant。

## 官方依据（仅公开文档/SDK读取，不是业务云访问）

- [V4签名与SDK建议](https://www.alibabacloud.com/help/en/oss/developer-reference/recommend-to-use-signature-version-4)
- [GET签名URL及到期](https://www.alibabacloud.com/help/en/oss/developer-reference/add-signatures-to-urls)
- [PutObject、权限、禁止覆盖与MD5](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)
- [HeadObject](https://www.alibabacloud.com/help/en/oss/developer-reference/headobject)
- [DeleteObject与版本控制限制](https://www.alibabacloud.com/help/en/oss/developer-reference/deleteobject)
- [GetBucketInfo](https://www.alibabacloud.com/help/en/oss/developer-reference/getbucketinfo)、[GetBucketVersioning](https://www.alibabacloud.com/help/en/oss/developer-reference/getbucketversioning)、[GetBucketLifecycle](https://www.alibabacloud.com/help/en/oss/developer-reference/getbucketlifecycle)
- [STS临时凭据](https://www.alibabacloud.com/help/en/oss/developer-reference/use-temporary-access-credentials-provided-by-sts-to-access-oss)、[官方STS.格式示例](https://www.alibabacloud.com/help/en/oss/developer-reference/configure-access-credentials-using-oss-sdk-for-swift)
- [官方ali-oss源码](https://github.com/ali-sdk/ali-oss)；实际依赖精确6.23.0，不将latest网页等同已安装版本。
