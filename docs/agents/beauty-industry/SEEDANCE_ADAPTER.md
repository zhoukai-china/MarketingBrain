# Seedance2.0协议适配 v1（BY53）

**2026-09-05 BY54接续说明**：下文是BY53已验收的历史协议层范围；持久permit/journal/usage/原积分/结果保存及独立DNS-pinned HTTPS已由[SEEDANCE_EXECUTION](SEEDANCE_EXECUTION.md)补齐。adapter现在可接受仅服务端执行工厂注入的controlled transport/key，但协议工厂本身仍不授予产品开放权限，无公开route，默认disabled；实际Ark账号/素材授权/云行为未验。不得把本文件历史“未来接线”误读为当前没有实现，也不得把合成测试当真实生成。

状态：默认disabled；仅合成注入式transport可测试。不是可付费执行的产品入口，无live配置/密钥读取/全局fetch/公开route。未替换wan2.2驱动、未修改BY51账本、未启环境。

## 官方依据与范围

参数与报价依据[2026-09-05官方核验](SEEDANCE_ROUTE_REVIEW.md)，锁定`doubao-seedance-2-0-260128`，不复制2.5或wan字段。`beauty-seedance-adapter-v1`：参考图最多9、视频最多3、音频最多3，视频/音频各累计≤15秒；音频不能单独；不混首帧/首尾帧。Schema只构造参考模式，最初submit profile进一步限制恰好2图、5s/720p/9:16，不表示多模态模式全部可以执行。

图片格式/300–6000px/比例0.4–2.5/<30MB；视频MP4/MOV、H264/H265、24–60fps、2–15s、像素/200MB；音频WAV/MP3、2–15s/15MB，输入角色与时长检查来自官方合同。text≤2000字符为本地收窄限制，非宣称官方上限。只发送text、三个*_url及reference_*、model/resolution/ratio/duration/generate_audio/watermark/execution_expires_after。未知模型、first_frame、tools、客户端URL/asset/身份/预算字段被strict Schema拒绝。

## 权限边界（格式不等于授权）

输入只能带内部fileId；服务端注入resolver以actor(tenant/user/store)取得匹配的product、purpose=`seedance_multireference`、模型、sha、authorizationVersion、审核/未撤销/有效期与平台accountBinding。人物必须是已接收且肖像授权有效的Ark asset，不接受人脸HTTPS。音频及视频声音要求授权；BY46的`video_replacement`和`user_declared_not_independently_verified`不能直接升级为此证据。

HTTPS素材仅服务端核准exact origin及公共IPv4解析证据；协议/凭据/端口/IP/内网/同形后缀/fragment拒绝。IPv6尚未独立核验，保守拒绝。**这里仅验证证据，不执行DNS或下载，不证明云端fetch的DNS重绑定防护**；真实接线还须DNS pin、短签名、平台接收/审核查询及用途授权。resolver与journal不是普通请求参数，不能把JSON cast为可信对象。启用需独立受控验收，本任务没有提供可用的live factory。

## 请求、状态与恢复

1. 配置缺失默认报`seedance_disabled`。fixture工厂永远`enabled=false`，只有显式注入transport使用固定合成Bearer，不能传真实API key；没有.env读取或fetch兜底。
2. submit：输入与授权预检→租户/用户/店/requestKey派生key→原子claim稳定输入/资产hash+授权版本→单次POST→保存安全回执。签名URL轮转不改变幂等identity。journal必须未来接持久事务/CAS；当前测试是合成事务内存port，不宣称已实现PG/多实例接线。
3. 任何POST超时/无id/JSON错误/4xx/5xx/未知结果都保留已消费attempt；同key只返回existing，不再POST、不自动释放或重置外部预算。提交前journal失败不调用；提交后保存失败保留unknown，不把它当未提交。
4. get只接受已拥有requestKey，不能传其他taskId。每次重新校验当前entitlement及素材授权/hash/version/account。GET最多20、总观察窗口1小时、每次≤30秒、31秒poll lease；进程中断耗一次查询额度，lease过期可以恢复查询，不能新建POST。指数退避1–64s且不早于Retry-After（秒或HTTP日期），大于剩余窗口就停止，不缩短服务端退避。无隐藏sleep或循环。
5. queued/running/succeeded/failed/expired；未知状态、错误ID/model、成功缺URL/规格不符→unknown。401/404/跳转/协议损坏停止查询；408/429/5xx/传输未知只可在时间/次数边界内恢复GET。应用超时/unknown不等于Provider失败/免费/取消；不在此层结算/退积分。
6. HTTP200只有格式正确id才算accepted；成功需固定model、5s/720p/9:16/24fps及官方精确结果origin、HTTPS MP4。重定向全部拒绝（本层无跟随授权），响应≤64000bytes，卡住body也受总timeout限制。signed result URL仅本次返回给未来私有downloader，journal/遥测只保留hash；URL24h/任务7天的长期恢复及原子落盘需要后续接线。重复GET可在预算内取新URL，不能当永久存储。

## 用量与价格（复用BY51，不建第二账本）

`seedance-2-0-standard-720p-cn-20260905`：无参考视频46微人民币/token，有参考视频28；只以usage.completion_tokens做一条`UsageMeasure(unit=token,meter=completion)`。total_tokens仅诊断，不相加；cache/推算prompt等不新增收费维度。负数/字符串/缺usage/total<completion皆unknown，不能记免费；价格推算estimate与provider_bill分开，未查实际账单永远null。

首profile108000token估算¥4.968；不是可靠云端绝对封顶、不代表执行授权。带视频有最低token规则，未完整验证，不执行该profile也不提供简单5秒低价放行。旧¥1图文授权及wan按秒报价不适用。BY51 smoke证实同一completion观察不重复折算/不改变客户积分；真实begin/observation同事务仍是下一接线范围。

## 安全可观测字段

| 保存 | 不保存 |
|---|---|
| contract/model、stage、精确code/status、HTTP状态、elapsedMs、response hash/bytes、request/任务hash、poll计数/lease/nextPollAt、usage及价格版本 | 客户输入/完整payload、Provider原文、API key/Authorization、签名URL查询参数、Cookie、素材正文 |

服务端私有journal保留taskId及内部fileId以恢复关联，但不进入events；回执为最小字段而非完整Provider JSON。resolver/journal异常统一安全code，不穿透原始错误。范围未生成AgentRun/用户积分交易/真实媒体/邀请。

## 验证与下一唯一缺口

`pnpm.cmd beauty-industry:seedance-adapter-smoke`三轮：正常、输入边界、2图/多模态shape、跨tenant/user/store、权限过期撤销/版本变化、POST未知不可重放、并发claim/重建adapter、GET并发/中断lease/退避/20次/1小时、HTTP/体超时/超限/重定向/SSRF、malformed ID/model/result、usage缺失/缓存/total/BY51折算及异常脱敏。global fetch设置为抛错，真实Provider与外网0。

下一唯一工作是**将该协议接入服务端受控执行许可**：可验证Ark素材授权resolver+现有持久许可/账本事务与DNS-pinned transport；无成熟证据时仍disabled。不得直接接公开按钮或拿“fixture三轮通过”请求生成视频。没有DOM/route变化，不启动浏览器/数据库环境；不宣称真实网络、PG并发、视频质量或最终页面验收通过。
