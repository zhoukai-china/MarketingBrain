# 视频受控执行与单批预算合同（BY-50）

版本`beauty-video-controlled-execution-v1`。本项是通用美业核心接线，不改变品牌、Skill、积分商业规则或视频能力范围。**本地HTTP/隔离PG/协议注入已验收；真实OSS、真实视频和用户页面未验收，默认仍disabled。**

## 正式组装与默认失败关闭

`viral-video-replication`正式route → `createControlledVideoIntegration` → BY49配置/私有OSS driver → BY46素材授权/lease → BY45 runtime/provider/MP4 store。没有新增另一队列或用户积分账本。

| 配置 | 语义 |
|---|---|
| BEAUTY_VIDEO_EXECUTION_MODE | 默认disabled；controlled仅安装代码，不授予执行许可 |
| BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY | 独立服务端签名信任根，≥32bytes，不等于Provider key；无默认值 |
| ALIYUN_VIDEO_REPLICATION_MODEL | 必须显式为wan2.2-animate-mix，旧wan-animate-mix配置拒绝 |
| ALIYUN_VIDEO_REPLICATION_ENDPOINT | 固定北京DashScope video-synthesis原协议，其他地域/路径拒绝 |
| ALIYUN_VIDEO_REPLICATION_API_KEY | 服务端视频专用凭据，仅格式预检不等于云端有效性/费用授权 |
| ALIYUN_VIDEO_REPLICATION_CREDITS | 沿用已有正式服务端积分报价，默认0继续拒绝；本轮不制定新商业价格 |
| BEAUTY_VIDEO_RESULT_HOSTS | 显式批准的精确OSS结果hostname，不接受客户端结果域；不能开放所有域 |
| BY49 OSS字段 | 必須完整、受权、STS有效且满足原私有桶合同；配置不足不得退回公开素材URL |

正式结果存储在UPLOAD_DIR下`.beauty-video-results`，沿用租户/门店/job散列私有路径、ffprobe/H264验证、原子rename/hash和授权下载。用户看到的是正式任务与本地下载URL，不是Provider URL/secret。回调仍不能直接宣布成功。

本轮**不提供公开签发许可的Web/WorkBuddy/API入口**。后续经过明确素材/费用授权的运维流程须向专用表保存审核并签名的精确scope。客户端只能提交既有严格schema的素材fileId/requestKey等；grant、金额、次数、tenant/store或driver额外字段400，不能自行扩大许可。

## 服务端单批许可与版本钉死

专用`BeautyVideoExecutionPermit`保存scope/signature/不可重放状态与外部请求计数，不保存密钥、Prompt或原始视频正文。scope经strict Zod解析后按该schema字段顺序JSON编码、HMAC-SHA256签名，验证使用constant-time比较。没有目录扫描、动态候选或旧图文grant兼容。

scope绑定：permitId、tenant/user/store、既有requestKey与整个严格request的SHA256、purpose=video_replacement、provider=aliyun_bailian、model=wan2.2-animate-mix、region=cn-beijing、contract版本、mode/template、两个素材fileId/hash/evidenceId/authorizationVersion/角色、maxOutputSeconds、issuedAt/expiresAt（最多24小时）、priceVersion、maxCostFen、storageCostUpperFen和storageCostEvidenceHash、提交/轮询/暂存/下载上限。

scope access必须匹配transport。三个注入transport（OSS、Provider、结果下载）必须同时存在且只接受`local_only`签名scope；混合真实与fixture拒绝。真实安装只接受`provider_https`scope。本轮所有许可均为合成/local_only，**不是可用于真实Provider的有效grant**。

私有表唯一键tenant/user/requestKey，状态默认approved；claim使用Serializable事务+conditional update，原子变为claimed并承诺本批最坏成本。claim前重验当前membership/entitlement/素材授权/version/hash、签名、期限和积分余额；预算或余额不足时云HTTP0/预留0，不能先上传再提示缺钱。实际积分预留仍由BY45在stage后事务完成，余额预检与真正扣减分开。

## 次数、成本与积分不是同一件事

- `maxSubmit`固定1，不是可由用户增加的3次或无限次数；已发送/未知是否送达均不恢复额度。一个新有效许可需独立审核，不自动签发。
- maxPoll为1–240；每次显式refresh对同task ID最多一次GET，先持久消费再网络；15秒间隔/任务CAS继续原BY45。poll错误可显式刷新已知task，但不能再POST创建。用尽额度/执行许可过期或撤销后任务`terminal_unknown`并释放用户积分，不能声称外部失败/已取消。
- maxStorageHttp为20–40；上传、bucket preflight、签名HEAD与删除HEAD均在每次SDK HTTP前持久消费。保留最后8次只供清理，前向操作不能使用；清理允许在许可到期/撤销后进行，但仍受同一有限quota约束。用尽额度保留cleanup_failed，不无限请求；已签URL和1天生命周期限制沿用BY49。
- maxDownload固定1（本系统从Provider结果URL获取MP4），用户之后读取本地成片不消耗Provider下载额度。下载失败/中断不可自动重新外网下载。
- 每次外部请求前重验当前成员、产品、素材声明；清理只使用原对象/许可绑定，不因成员撤销而阻止删除。数据库/audit写入失败则不发该次请求。权限在请求已经原子承诺之后被撤销无法追回在途外部动作，仍无外部取消承诺。
- 已核实BY45报价版本`wan2.2-animate-mix-cn-beijing-20260905`：std60分/秒、pro90分/秒，最短2秒、最高30秒。硬预算要求`maxCostFen >= maxOutputSeconds×模式单价 + storageCostUpperFen`，缺价格版本/正数存储上限/成本审核hash或签名一律拒绝。
- `storageCostEvidenceHash`必须对应后续运维已核实的OSS请求/字节/TTL/出网成本依据；本轮合成hash和10分上限只测门禁，**不是已经证实真实OSS费用≤0.10元**。没有真实计价证据不得签真实许可。云端实际账单不由本地程序控制，第三方超时/异常计费仍需独立核账，不能把本地计数冒充退款或云账单硬限额。
- `committedCostFen`是保守承诺的最大暴露，不是实际支出。由0一次变为scope.maxCostFen，不因任何失败、取消、积分退款或重启回到0。`observedProviderCostFen`是协议usage时长×固定报价的观测值；异常超上限仍记录，不发布结果，不掩盖已发生外部成本。
- 用户积分仍是现有CreditAccount/CreditReservation/CreditTransaction。成功一次结算，失败/未知/取消一次等额释放；测试每批100积分是fixture，不是商业变价。没有新增收费订单/对客户人民币扣款。

## 崩溃和失败恢复

1. claim已提交但尚未job：重启/重复confirm返回409，不重新stage/submit。lease有持久身份，由原sweep清理；资金承诺保留，需人工核对该批为何中断。不能将“未见job”当作外部额度可重置证据。
2. Provider已接受但job update失败：若DB恢复能落终态则terminal_unknown并补偿；若失败结算也写不进DB，原submitting job保留。60秒后显式refresh只终止本地并释放/清理，不再submit。可能丢失Provider task ID时只能凭受控审核向上游核账，程序不扫描任务或再次创建。
3. 响应丢失、5xx/429等：提交次数保留1，未知不重发；原始error/响应不出日志。发现成功usage但落盘/视频验证失败：积分释放、外部观测成本保留。
4. cancel仅允许queued（尚未提交）；已提交不能假取消。素材声明撤销同样重验/补偿，旧成功的历史账本不改写。
5. 清理失败后任务/账本状态仍真实，用户不会收到虚假成片；显式sweep只消耗清理quota，不能产生新Provider任务。中断/超限早退路径亦必须立即尝试cleanup，BY50新增红灯已覆盖原漏清理。

## 观测与证据边界

AuditLog `beauty_video.execution.claim/submit/poll/storage/cleanup/download/usage`：固定版本、phase/code、tenant与permit短指纹，资源ID保留在私有审计DB；表内有精确计数/状态/金额。BY49 HTTP日志继续只记操作、状态、耗时、对象指纹。不得记录scope的客户信息、完整URL/签名、HMAC key、Provider key、Authorization、输入bytes、SDK XML或Provider raw response。

本地测试三轮使用真实注册handler、实际SDK、实际MP4 ffprobe/持久化及隔离PG；所有OSS/Provider/结果下载transport均合成。三个独立Node进程对同一PG许可竞态恰好1个CLAIMED，其余BLOCKED。代码的本地协议/数据库结论不等于真实云端成功；无DOM/导航修改，不新增或宣称1440/390页面通过。

## 运维/真实测试下一边界（本轮不执行）

1. 准备**非生产、专用**测试桶/STS最小权限与OSS成本证据；只核对被授权配置，不让用户提供生产secret。BY49默认关闭工程配置已完成。
2. 明确1个参考视频与1张人物照片的真实授权范围/角色/hash/version、模式和最大时长。合成色块/无人物fixture不能证明真实换人输出成功或合法肖像授权。
3. 只为这一个请求签`provider_https`scope并设置精确结果host、单次提交、有限poll/存储/下载、有效期及人民币上限。std最短2秒模型成本已为1.20元，再加核实存储上限，因此**旧图文≤1元授权不足**，须取得新的精确素材/视频预算授权；不能强行改成1秒或借图片grant。
4. 真实终验限1批1POST，无自动重试/换模/补做；任何失败停止。结束撤销许可、默认disabled，保留计数/账本/证据；完成原lease清理核对，不drop表、不删历史。
5. 当前仍没有用户页面定稿/真实OSS/视频E2E或生产放行。下一唯一步骤为受控外部前置与真实计划审查；本项没有另一个已经复现的本地P1可自动接力，不为“持续开发”新造模块。未授权前不执行真实网络。

## 2026-09-05 真实验收前置只读核查（不是执行授权）

### 后续控制台核查停点：登录/非生产身份尚缺

用户“继续推进”仅授权只读核查，不是本节¥2测试/建桶/改RAM/上传许可。执行browser-skill：`bsk status`显示connected browsers=0、active sessions=0，无bsk控制会话创建；改用应用内浏览器只读入口。CUA初始只有in-app浏览器且无标签，打开官方`https://home.console.aliyun.com/`导航30秒超时后，inventory显示标题“阿里云登录页”、目标host为`account.aliyun.com`。获取该页可访问性状态再次30秒超时；按两次无进展停止，未截取凭据页面、未读取Cookie/storage/剪贴板、未尝试自动登录。仅保留本次官方登录标签供用户操作，不接管其他浏览器或进程。

| 核查项 | 已证实 / 未证实 | 最少下一动作 / 执行者 |
|---|---|---|
| 可用控制台登录 | 已到官方登录页；未取得已登录的非生产身份 | 用户在本任务内置浏览器完成非生产测试账号登录，并确认测试账号/资源组或精确桶范围；不发送任何密钥 |
| 北京桶、origin/prefix、私有/公共阻断、版本/复制/生命周期 | 全部未证实；未列桶或对象 | 身份范围确认后由Codex只读核对已指定资源；不能凭名称猜生产属性 |
| RAM/STS、适用单价/资源包、结果host | 全部未证实；未签STS或新token、未看AK/secret | 登录后Codex只读元数据/权限和价格；缺权限就报告精确缺项，不自行扩大 |
| 原创3D素材 | 现有说明是建议而非资产清单；仅检索仓库`scripts/fixtures`文件名，没有blend/fbx/glb/gltf/obj或avatar/rig/provenance许可清单命中；这不证明整台电脑不存在素材 | Codex在取得明确候选路径/已授权来源后核对素材与许可；当前不读取客户目录、不下载/生成、不冒称素材就绪 |
| 本次费用/资源变更 | Provider0、费用0、建资源/改权限/上传/许可0 | 真实批次与新资源操作仍需新批准，不能用此次继续推进代替 |

本次只更新本说明和STATUS停点，路径/可读性与diff校验；未改代码、未重复qa/数据库/浏览器产品E2E。资源核查未完成，不把登录阻塞登记成产品代码P1，BY50本地完成和所有PAUSED边界不变。最少用户动作只有一次登录并说明获授权非生产范围，随后Codex接手其余技术核查。

BY50代码/三轮独立PG与全仓门禁已完成，本次只补官方依据和可批准方案，不新建BY51、不重复qa:full。仅访问公开官方说明；真实secret/云账号/桶/素材/Provider未访问，费用0。实际资源是否存在、RAM/STS是否可用、账号适用计价及素材许可均**未核实**，不能称“已准备好”。

### 规格与核价证据

核查日期2026-09-05，价格在执行前仍须复核；不计免费额度、优惠券或既有资源包。

| 项目 | 官方依据/本次结论 |
|---|---|
| 北京模型 | [百炼价格](https://help.aliyun.com/zh/model-studio/model-pricing)：wan2.2-animate-mix、wan-std仅输出计费，¥0.60/秒；不切wan-pro或其他模型。3秒模型估算¥1.80。 |
| 最短时长 | [专用API](https://help.aliyun.com/zh/model-studio/wan-animate-mix-api)写2–30秒（含边界）；[视频总览](https://help.aliyun.com/zh/model-studio/use-video-generation/)写2秒＜时长＜30秒。记录不一致，最小稳妥测试选**精确3.000秒**，不把2秒夹具直接外发；输出预算上限3秒，实际异常超长不能事后免掉云成本。 |
| 输入 | 专用API要求单张人物图+参考视频；图JPG/JPEG/PNG/BMP/WEBP、200–4096px、≤5MB；视频MP4/AVI/MOV、200–2048px、≤200MB；比例均1:3–3:1。本批进一步限无声H264 MP4 720×1280、3秒、≤10MiB，加PNG人物图720×1280、≤1MiB。check_image=true。 |
| OSS容量 | [计费说明](https://help.aliyun.com/zh/oss/billing-overview)给LRS标准存储示例¥0.12/GB/月，小时计量；[官方案例](https://help.aliyun.com/zh/oss/billing-examples/)给ZRS¥0.15/GB/月。专用北京Standard/LRS拟采用，计算保守使用较高0.15；这仍不是已登录北京账户得到的最终报价。 |
| OSS请求/流出 | 官方案例给PUT/GET ¥0.01/万次、忙时外网流出¥0.50/GB；[请求规则](https://help.aliyun.com/zh/oss/api-operation-calling-fees)说明2xx/3xx计数，4xx/5xx不计；[流量规则](https://help.aliyun.com/zh/oss/traffic-fees/)说明普通外网上传流入不收费、流出收费。本预算保守对所有列入次数按收费算，不开加速/CDN/跨地域/低频取回。 |

上述OSS示例不是北京专用价格选择器的实时合同；[官方价格计算器](https://www.aliyun.com/price/product#/oss/detail/ossbag)本次公开抓取只有动态壳，无法验证地域项。**执行前必须在获授权的非生产账号核对北京LRS实际单价不高于本方案上界，否则重新计算并停止请求批准。** 不以历史PDF/第三方文章或fixture的10分钱代替计价证据。

### 一批次上限与成本测算

- 固定原背景换人、1次POST创建；poll≤20次、间隔≥15秒，单请求沿现有30秒超时，总验收运行≤10分钟；到时/限额/终态未知即停止，不自动重试POST、不换模型、不补做。许可到期使下一执行失败关闭；必须在短期素材URL有效窗口内完成上游读取。
- 应用OSS HTTP≤40，其中最后8次仅清理；正常两素材流程18次（各preflight3/PUT1/HEAD1/签名核验HEAD1/清理HEAD-DELETE-HEAD3）。不额外做签名GET探针；Provider读取素材不经过应用计数器。
- 成片外网下载≤1次，沿代码上限200MiB/60秒并核对H264、时长、原子落盘；用户之后只下载本地文件。应用业务外发上限**62次=1+20+1+40**，不包含前置资源配置API、DNS和Provider自身取素材HTTP。
- 2个素材合计≤11MiB；结束立刻清理，签名≤15分钟；生命周期1天仅兜底，异步删除可能晚于24小时，按48小时存储做估算而非删除保证。数据库许可/hash/账本与合成审计成片本地保留；不写Prompt/原始响应/签名URL/密钥，不删除输入源或其他历史数据。

以下是**建议预算的计算假设，不是已实现的第三方计数限制**：Provider至多完整读取两素材各5次；将200MiB结果下载也按本方付费外网计算（即使实际上不向本方计费）；总收费OSS请求按100次留余量。按十进制GB换算比按GiB略保守：

| 部分 | 保守计算（元） |
|---|---:|
| 视频3秒 | 3×0.60 = 1.80 |
| 11MiB保存48小时 | 11×1048576÷10^9×0.15×2÷30 = 0.00011535 |
| 100次存储请求 | 100÷10000×0.01 = 0.0001 |
| 外网流出预留 | (5×11+200)×1048576÷10^9×0.50 = 0.13369344 |
| 测算合计 | 1.93390879 |
| 建议应用单批授权上限 | **¥2.00：模型180分+存储/流量20分** |

一般一次读素材、输出≤10MiB时约¥1.82。¥2.00高于旧图文单批¥1，必须新授权；不消耗旧grant。100测试积分仅可作为隔离合成账本验收值，必须明确用户无真实扣款，不成为新商业报价；若使用产品真实积分报价，须读取已批准的服务端报价另行核对。

重要：签名URL在有效期内可能被上游重复读取；本系统不能控制其实际读取次数，也不能限制云端实际输出长度/异常计费。读取次数超过上述假设、清理超48小时、实际价格漂移都会影响估算。OSS账单延迟约3–4小时且小额累加，不代表免费；告警不是硬停费。[计费周期依据](https://help.aliyun.com/zh/oss/billing-overview)。**¥2是应用准入/新增动作的硬预算，不是云账单数学绝对封顶。若用户要求第三方实际账单也绝对≤¥2且不接受上述残余风险，当前条件不足，必须停止，不能签发许可。**

### 不使用客户/老板肖像的素材方案

优先由Codex在授权后本地生成两个不同的原创3D虚构成年角色（无生成式Provider），用同一授权rig渲染参考动作3秒和替换人物单帧；无真实人脸/声纹、未成年人、品牌、文字、水印或门店经营事实。素材来源/工具许可/网格纹理授权、两个角色确实不同及可识别人形必须逐项审查，保存hash和授权记录。现有仓库是否有这类可用rig和渲染工具**未核实**，本轮不安装、不下载、不生成。

官方并未保证此模型对原创3D角色达到真人换人质量；首次可能输入审核拒绝，必须一次失败即止。它能证明角色替换/动作及原背景保留的受控技术路径，不等于真实门店老板可用。合成色块/无人物视频只适合离线流程，不可称换人成功。官方示例可公开访问也不等于授予再上传/商用许可，不擅自取来测试。若无合法原创角色资产，再单独取得非客户成年志愿者的明确AI肖像转换与上传许可，不能默认选择用户/员工/顾客照片。

### Codex可执行的非生产准备步骤（全部尚未获执行授权）

1. 用户/管理员只完成必要登录与确认非生产账号/资源组、允许的费用和素材用途；后续SDK选择、文件整理、参数与流程由Codex负责。先核实资源是否存在，禁止扫描生产桶/沿用旧secret。若无资源，先出精确bucket/role/prefix资源清单经批准，再创建，不由本说明自动授予权限。
2. 专用北京Standard/LRS私有桶，阻止公共访问、版本控制从未启用、无CRR/加速/CDN，服务端AES256、仅本批namespace的1天生命周期。配置权限与执行身份分离；配置者只对这一个桶/角色实施已批准设置，不给执行身份建桶/改策略权限。
3. 执行STS仅桶级`oss:GetBucketInfo/GetBucketVersioning/GetBucketLifecycle`，资源`acs:oss:*:*:<专用桶>`；对象级`oss:PutObject/GetObject/DeleteObject`仅`acs:oss:*:*:<专用桶>/beauty-industry/video-staging/v1/<本批namespace>/*`。禁止ListBuckets/ListObjects、其他prefix、配置写入、KMS、其他服务或RAM管理。动作映射见[官方授权表](https://help.aliyun.com/zh/oss/user-guide/authorization-syntax-and-elements)。STS签发者权限仅AssumeRole指定角色，短时凭据经受控进程内传递，不写仓库；生命周期配置者不是运行身份。
4. 独立本地PG/API与全合成租户/门店/entitlement；按原脚本核对source/runtime/端口身份，加载被授权的北京APIkey/STS和独立签名根，不读生产配置。先精确核价及成本依据hash，再绑定本批素材SHA/角色/版本/request、maxSeconds3/maxSubmit1/maxPoll20/maxStorage40/maxDownload1、成本200分和短期expiry。未通过任一预检不PUT、不预留、不提交。
5. 一次显式确认后只执行本批；任一真实失败停止并保留未知语义，积分按正式一次结算/释放。核对动作/身份变化、原背景、MP4/下载/跨租户和账本，完成后撤销许可并关闭execution，清理本批2个暂存对象且确认404；清理失败保留记录/说明期限，不盲删桶或源素材。生产发布、客户页面定稿、扩大背景/口播模板不在本次。

### 最少待确认事项 / 可批准文本草案

当前最少3项：①允许Codex在指定非生产账号核对/准备上述专用资源与短期最小权限（资源ID、账户适用OSS价和结果域尚未核实）；②批准原创虚构角色素材方案并完成实际素材来源/许可核对；③接受上面的云账单残余风险后批准单批应用预算¥2.00。尚缺①②，不能把单独“批准2元”当成可执行真实grant。

建议调度在①②证据齐全后提交：**“批准一次北京wan2.2-animate-mix/wan-std原创虚构角色3秒验收：仅2个已审核素材合计≤11MiB、1次创建、≤20轮询、应用OSS≤40HTTP、1次≤200MiB下载，无重试/补做/换模/其他Provider；应用总预算¥2.00（模型¥1.80+存储流量¥0.20），接受已说明的上游计费/读取及清理延迟风险；仅非生产专用资源，终态后撤权与清理。”** 本段只是请求草案，未消费授权、未构造真实grant。
