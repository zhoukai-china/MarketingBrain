# BY51 用量审计与定价隔离（beauty-usage-v1）

## 已实现边界

唯一运行接线是BY50默认关闭的视频受控执行。复用AuditLog（主键、tenant/user、时间和resource索引），不新增表/迁移/队列/账本，不改变CreditReservation/CreditTransaction。通用token/image/video_second事件合同仅用离线fixture验证；没有把全部Agent/媒体入口迁移，也没有恢复XHS/ASR/问答或新建客户报表页。

既有证据：AgentRun.tokenEstimate是估计且失败可能无AgentRun；domestic provider的onUsage是回调/日志而非逐attempt持久表；视觉/ASR已有MediaProviderObservation；BY50有外部预算/次数和观察费用，但missing usage直接return，费用update不能替代不可覆写明细。本项只修已在先行范围的视频链，不扩大共享巨型runtime。

## 复用与身份

- traceId=版本+服务端tenant/user/store+不可重放permit id的SHA256；同动作恢复继承、不同动作不同。callId=trace+固定step+attempt；Provider task仅存SHA256。所有派生来自已校验签名scope，不读客户端tenant/brand/trace覆盖。
- 每次真正generation提交之前，在同一Serializable事务提交permit计数、原audit和started事件。审计失败则counter回滚，Provider未发出；原业务失败一次释放积分。
- 提交ack、状态及用量只追加observation。轮询不是新的generation；其每次HTTP继续用原permit pollCount/audit，不冒充新模型任务。已开始但回执不明为pending/unknown，进程重启不重发。
- AuditLog主键由call和规范事件派生。完全重复事件P2002后核对绑定/正文同一才视幂等；同start改变模型/价格/单位失败关闭。不同结果证据保留，不last-write-wins。
- 内部read按tenant+user+trace及store hash过滤；月份读取亦由可信actor限定。没有注册HTTP quota/usage/consume，不新增普通用户查询内部成本的权限。调用这些内部函数前仍须现有session/产品/门店授权，不把类型当鉴权。

## 单位、缺失、成本

| 数据 | 正式含义 |
|---|---|
| token: prompt/completion/cache_hit/cache_miss/reasoning | 独立来源桶；cache可能是prompt子集、reasoning可能是completion子集，绝不把这些桶相加成total |
| image: output | 图张数，不折算token |
| video_second: output | 视频秒，保留最多6位小数，不用估计时长冒充Provider usage |
| quantity/source | 缺失为null/unknown，明确Provider usage才provider_usage；本地实测必须measured_asset，不能伪装供应商证据 |
| priceVersion/unitPriceMicros/currency | 服务端版本化价格快照；null表示未配置，不等于免费/无限额度；不决定客户报价 |
| estimatedCostMicros | 数量×单价，整数BigInt向上到1微货币单位；BY50价格表派生仅估计，不是Provider发票 |
| observedCostMicros/billingSource | 仅有provider_bill直接证据才有值；没有即null；视频当前没有账单接口，所以观察账单始终unknown |
| mode | controlled_mock与real分组隔离，合成数量/估价不计为本轮真实费用 |

聚合按provider/model/mode/unit/meter/currency/priceVersion/unitPrice分组；不输出一项混合“总用量”。knownQuantity/knownEstimated/knownObserved是已有证据小计；只要任何call缺数据或冲突，对应完整quantity/cost为null且unknownCalls可见。不因失败/用户积分释放清掉Provider消费。

v1接收每次call的完整终态usage快照（或缺失值），不把流式delta相加。中途断流保存unknown，最终同一call回执迟到可补；两个不同的已知数值或相反终态保留全部证据且标conflicting，不猜哪个正确。后续若接真实流式累计/修订协议，须按具体Provider版本先归一化，不能直接塞多个变化累计值并声称支持。没有自动“修正成本后追扣客户”。

月份固定Asia/Shanghai：[月初00:00,下月00:00)，由UTC减8小时计算、跨年/闰月覆盖。当前视图按call开始月份归属，迟到回执跨月仍归原call；一个跨月动作的不同attempt可分别归属各月，不盲归回执月。单次最多5000事件，超过精确报usage_read_limit，不静默截断；没有新订阅额度配置，未知额度保持未配置（没有对外造quota默认值）。

## 安全字段与位置

| 位置 | 允许字段 | 禁止 |
|---|---|---|
| AuditLog基础列 | 内部tenant/user外键、resource、trace hash、事件id、createdAt | 不复制客户正文到detail |
| AuditLog.detail | version、trace/call/store/Provider request hash、固定step/attempt/provider/model/mode、kind/status/code、数值与来源/币种/价格版本 | Prompt、笔记/模型正文、Authorization、secret、完整URL、可逆响应 |
| 内部read.timeline | eventId、数据库recordedAt | 不将其延迟误称精确Provider耗时；本轮只提供可重建阶段时间 |
| 客户原job DTO | 原有状态与用户积分字段 | 本项不加入unitPrice/内部明细/用量trace |

严格schema拒绝额外字段。并发相同event只追加一次，冲突不吞。start已落库后DB不可用会保留未决，不声称有完整终态证据；需要独立审计恢复，不追加调用。

旧任务/旧permit不反向补造历史started证据、不会因上线计量重算历史或改变积分。完整历史原GET不变；若未来旧未决真实任务需要跨版本继续执行，先明确恢复/补证合同，本项不自动迁移或重发。

## 定价与候选判定

候选G提供了分层计量和多单位方向，可采纳；不采纳“最后chunk必含usage”“失败/重试一律免费即可解决计费”“cache优惠不传导”“固定月费/订阅升级”作为正式规则。客户成功逻辑动作仍由既有幂等账本结算一次；若未来允许内部重试，重试消费要记录，最终成功不得因attempt重试标记而错误免单。当前视频禁止重提/自动重试，专项验证失败/迟到用量不改一次性账本。

不采用FastAPI3007/旧/v1/billing复制、tenant query选择租户、公开任意consume。商业“280→80”“FAQ40–80”未获批准，本次不动CREDIT_PRICING或现有报价。

## 回归、回退与局限

新增usage-metering-smoke三轮：混合单位/模型/缓存、重复与冲突、缺usage/缺price、断流模拟/迟到、跨租户/用户/店、月边界、三进程append竞争、事件重建、无积分写入。原video-execution-smoke真实handler接线：unknown提交、DB故障、退款后迟到、审计前阻断、单次成功/失败账本以及不泄露客户DTO。全部使用合成transport，不访问真实云。

无数据库迁移；回退时关闭execution，保留AuditLog、permit和原账本，不删历史事件。没有DOM/路由/客户输出改动，不重复Chrome；不声称浏览器/真实云/真实模型测量通过。真实对账、全平台入口采集及客户报表仍非本卡交付。成本不是定价授权，默认disabled和暂停范围不变。
