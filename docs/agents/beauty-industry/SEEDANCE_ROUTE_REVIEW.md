# Seedance多参考路线：一页结论（2026-09-05）

**结论：优先接官方火山方舟 `doubao-seedance-2-0-260128`，不把人物+新场景硬塞进万相换人。** 这是一份公开文档核验与小样草案，不是接通/质量实测/上传或费用授权；不建空代码卡。2.0已满足所需参考模态，暂不查可灵、不自动升级文档新出现的2.5。

## 官方已核实 / 尚未核实

2026-09-05以浏览器实际展开官方参数正文（创建页更新2026-09-04），不是只依赖搜索摘要。browser-skill检查扩展连接0，改用独立in-app临时页，未登录/调试/上传，读完关闭。来源：[创建API](https://docs.volcengine.com/docs/82379/1520757)、[查询API](https://docs.volcengine.com/docs/82379/1521309)、[模型清单](https://docs.volcengine.com/docs/82379/1330310)、[价格](https://docs.volcengine.com/docs/82379/1544106)、[肖像入库](https://docs.volcengine.com/docs/82379/2315856)、[出账说明](https://docs.volcengine.com/docs/82379/1544681)。

| 项目 | 核验结论（仅2.0，不混用2.5字段） |
|---|---|
| 地址/鉴权/型号 | POST `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`，API Key服务端Bearer；返回id后GET同路径`/{id}`。官方型号`doubao-seedance-2-0-260128`，可用账户Endpoint ID另核验，不凭别名猜型号。 |
| 参考字段 | `content[]`内text；image_url.url+role=reference_image最多9张；video_url.url+reference_video最多3段/合计≤15秒，每段2–15秒；audio_url.url+reference_audio最多3段/合计≤15秒，每段2–15秒。音频不能独立，至少有图或视频；首帧/首尾帧与全模态参考互斥。未在API正文确认跨模态“总12文件”硬限制，不照抄即梦/代理手册；首批仅2图。 |
| 素材/输出 | 图URL/Base64/asset URI，图300–6000px、宽高比0.4–2.5、单图<30MB、请求≤64MB；视频MP4/MOV≤200MB、24–60fps，音频WAV/MP3≤15MB。2.0输出4–15秒、24fps、MP4，480p/720p/1080p/4k，9:16的720p为720×1280。首批不用seed/camera_fixed/draft/flex、2.5专属omni_reference_task_type/output_format。 |
| 人物/声音 | 不可直接上传含真人人脸参考图/视频。控制台体验中心→我的→真人人像→创建资产组/设有效期→授权人扫码登录、本人认证和授权→接收有效Asset ID，API使用`asset://…`；声纹/原话另核用途。资产列表出现不等于已通过一致性校验。人物一致性与口型仅能力目标，不保证效果。 |
| 账号/限额 | 开通条件之一：余额>¥200，或≥¥200指定节省计划，或有效系列资源包。不是本小样消耗，也不授权充值/购买。非4k官方RPM企业600/个人180、并发10/3；当前账户是否已开通/实际额度/素材资格未登录核实。 |
| 恢复/幂等 | id保存7天，结果URL有效24小时。queued/running/succeeded/failed/expired；服务端超时execution_expires_after最小3600秒。所读创建合同未见可依赖的Provider幂等key或POST安全重放保证，禁止把SDK重试当保证：本地先持久claim；已知id只查询；创建超时且无id保留unknown，不再POST。应用等待超时不等于云端取消/免费。 |
| 价格/计量 | 2.0的480/720p：无参考视频¥46/百万token，有参考视频¥28/百万token，但后者有最低token量，不能以低单价推断更便宜。5秒720p无视频输入官方示例¥4.97。估算token=(输入视频秒+输出秒)×宽×高×24/1024；准确usage.completion_tokens与最终账单区分。只对Provider成功视频计费，产品质量拒绝不等于Provider退款；30秒出账周期仍可能延迟。 |

## 产品映射、非发送请求、成功判据

- `owner_promo`：已授权人物形象+已授权场景，生成讲解镜头，再用现有FFmpeg叠已确认字幕/AI标识；不虚构价格、疗效、门店事实。`kol_visit`：虚拟介绍镜头+场景参考，明确AI演绎，不能冒充真人实际到访。实拍AI剪辑仍优先裁切/字幕/授权配音与BGM，不整体重生成。
- 以下是字段可构造的**草案**，占位素材不能发送；人物须平台可用授权asset，场景由本租户声明/hash/用途核验，URL签名不得落日志。老板与虚拟介绍仅更换获权角色和镜头文字，不自由文本切模型。

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {"type":"text","text":"以@图像1的已授权成年角色为主体，以@图像2的授权场景布局为参考，拍摄5秒自然介绍镜头。人物轻转身指向接待区域，说：\"这里是空间演示。\"保持面部服饰及场景位置一致，不新增门牌、价格、顾客或效果声明，无画面内文字。"},
    {"type":"image_url","image_url":{"url":"asset://REPLACE_WITH_AUTHORIZED_ASSET_ID"},"role":"reference_image"},
    {"type":"image_url","image_url":{"url":"https://example.invalid/authorized-scene.png"},"role":"reference_image"}
  ],
  "resolution":"720p", "ratio":"9:16", "duration":5,
  "generate_audio":true, "watermark":false, "execution_expires_after":3600
}
```

成功：技术succeeded+实际MP4/时长尺寸/音轨/hash原子落盘；逐段人物五官服饰稳定、无变形，场景与预先列出的布局/家具事实相符，无新增经营事实；动作自然、口播逐字正确/口型可用、无额外人声，原片无伪字/品牌水印，字幕来自批准文本并可控。原片质量失败不得用后期遮盖或删第三方水印。预览/下载/刷新同hash、owner/跨租户、重复确认/一次结算通过才交付；官方案例不作以上证据。

## 最小工程改动与集中小样草案（均未执行）

1. 下一唯一零调用交付：独立Seedance submit/get adapter+固定2.0多参考输入Schema/状态映射/usage token映射与合成HTTP红灯（超时无id、重复确认、过期asset、撤权、URL过期、预算未知）。先默认disabled，不改页面、不接通云端。保留现有wan driver；不得把新模型写进wan字段。
2. 复用BY45–51的tenant/owner/声明hash+版本、lease/幂等任务/CAS/积分预留释放、原子下载与AuditLog用量基础。**不可原样复用**`beauty-video-execution-permit.ts`的aliyun_bailian/video_replacement/wan-std/pro签名、人民币按秒常量、wan响应；新许可必须绑定ark模型/资产ID有效期/token单价和调用上限。OSS安全暂存可作为场景URL来源，先核实Ark读取兼容性；真人用官方asset不能靠OSS URL绕过授权。BY51计量按known/estimated/unknown/pending_reconciliation记录，total不与completion重复计价。
3. 集中一次批次建议：**同型号2次创建上限**，分别owner_promo/kol_visit各5秒720p，共用审核通过的最多2个人物asset+1张无真实经营信息合成场景；不传参考视频/音频，不用文本/ASR/BGM/搜索Provider。前一输出技术与人物/事实安全通过才做后一镜头；不以失败为由补做。模型估算2×4.968=¥9.936，建议**整个应用批次¥12**（含模型估算余量及暂存/下载预留；不含未核实的账号充值或肖像入库/权益包费用，若需要这些费用先集中重报）。不是第三方账单绝对保证，提交前按现价与账户适用项确认，结算按usage/账单对账。
4. 一次批次覆盖查询网络可恢复错误，不逐次求批：每task GET≤30次（含重试）、10→20→30秒有上限退避，429尊重Retry-After且总等待≤15分钟；总GET≤60，下载每结果≤2次（同一id网络中断才重取）、暂存HTTP≤40。POST最多2次、不同计划各1；POST不明/鉴权/素材审核/质量/费用超界立即止余下创建；只查询已知任务，不自动换模/付费重试。超15分钟保留unknown，可在原查询额度内恢复，不伪称取消/退款。结束默认关闭，审计保留，临时场景按已有lease清理，已授权人像库不擅删。
5. 最少外部前置合并一次确认：非生产Ark账号是否满足开通/可用asset、两角色与场景许可及传至火山用途、上述批次预算和查询/停止策略。现在不索取secret、不登录/创建grant/上传/付费；可以先独立完成第1项零调用adapter，余下外部步骤再集中授权。

验证：本轮仅公开文档只读与源代码引用审查，`git diff --check`和本文件/恢复链接检查；无源码变更所以不重复qa:full/typecheck/产品E2E。BY52环境仍停止，Provider/业务API/费用/邀请/部署0；暂停范围不变。
