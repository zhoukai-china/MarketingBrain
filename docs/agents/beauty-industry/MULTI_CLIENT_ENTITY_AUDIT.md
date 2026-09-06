# 清单E：手机/网页同源实体与逐请求权限审计

状态：审计已完成 / idle（2026-09-05 09:21 +08:00）。未发现本选定范围内需修复的P1，不创建BY-48空任务卡。

## 范围与候选处置

- 仅当前恢复范围BY45/46的视频素材声明、撤销、任务元数据及账本；不恢复XHS、经营问答、客户记忆模型、BY19/20或BY44外部OAuth。
- 完整只读参考：`C:/Users/book/WorkBuddy/sitong-outsourcing/beauty-xhs-prototype-20260827/手机端网页端数据打通-工程化对接清单.html`及同目录`手机端网页端数据打通-设计规范.html`。不运行其JS，不复制生产代码，不新增候选运行依赖。
- 采纳：单一后端权威、端只读与提交、逐请求重授权、幂等、离线后重新读取持久态。
- 拒绝：样例1280/200/80数值、静态“已同步”作真实证明、提交成功即另一端收到、通用LWW覆盖、默认WorkBuddy Token可代表当前用户、无正式需求即新建客户/经营实体或WebSocket。
- 待定义/外部前置：手机正式身份映射、可编辑实体字段与冲突交互、消息订阅协议、另端收到的确认语义及≤2秒SLA。当前没有这些正式双端UI，不能以此制造缺陷或擅自实现。

## 当前源码事实与证据

| 实体/路径 | 已有机制 | 验证与限制 |
|---|---|---|
| `UploadedFile` → `beauty-video-asset-authorization.ts` | tenant/user与服务端store绑定、hash；声明不可编辑/续期，tenant/requestKey唯一 | 同key同内容返回同ID；改expiry同key409、注入rev/时间戳400。不存在任意PATCH，因此不新增通用客户端rev字段 |
| `BeautyVideoAssetAuthorization` | `version`持久整数；唯一允许变化是撤销，CAS/revokedAt/version+1、重复撤销不重复审计 | 客户端A/B并发声明、撤销与旧声明重放读到version2/revoked；不能重新启用旧资料 |
| `ViralVideoReplicationJob` → `viral-video-replication-runtime.ts` | 服务端queued/submitting等状态机；status+updatedAt+reserved作为原子更新前提；终态不可覆盖 | 两个独立repository争抢同任务，旧status和同status旧updatedAt均被拒绝；不能用客户端日期覆盖 |
| `CreditReservation/Transaction` | 服务端事务、reservation状态CAS；成功/失败账本不通过通用LWW修改 | 同一合成任务预留100后失败释放100，另一端过期finish不重复释放，1000恢复1000；不是外部费用退款 |
| `/viral-video-replication/jobs` | tenant/user先过滤，再逐任务重新admission；返回数据库最新publicJob，不读本地客户端缓存 | 独立A/B handler读取同ID/状态；第三个新handler读到已提交终态；不能把此项称为PostgreSQL进程重启或实时广播 |
| 身份 → `request-context.ts` → 授权scope | 正式JWT优先于header；DB membership isActive逐请求读取；product entitlement/store和file进一步重新验证 | 审计注入合成会话身份、真实scope检查；成员/产品撤销后旧会话403，换store隐藏原store历史，他人文件404/异租户无产品403。非真实OAuth移动端验证 |
| 现有Web `ContentSystemWorkbench.tsx` | 调用同一quote/confirm，不存在另一套手机业务库 | 当前没有已定稿的素材授权双端UI；不更改暂停产品页面，不声明手机已收到或下载已验收 |
| WorkBuddy工具 | 当前视频授权/换人路径未新增WB工具，BY44本地PoC只读摘要 | 无对应正式双端写入口；外部接入仍暂停，不能凭参考HTML自动加工具 |

## 自动验证

- 新增审计脚本：`scripts/beauty-video-multiclient-audit.ts`；不修改任何生产源码、Schema、配置、依赖或原任务合同。
- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-video-multiclient-audit.ts` PASS，同批连续3轮。每轮2个独立Fastify正式handler+1个重建handler，共享一个事务fixture；验证声明同ID、并发/重放/冲突、旧任务lease不能覆盖、只退款一次、最新历史、成员/entitlement撤销、跨用户/租户/店、后端失败503不返回jobs、恢复后读取当前状态。
- 合成文件reader只提供已知元数据，并未模拟真实解码为PASS；真实本地文件/ffprobe与BY46授权专项仍由全量相邻测试覆盖。业务配置缺staging/runtime时confirm422、预留0；为测试旧worker状态机直接创建一条合成内部任务，不将其视作用户真实确认/生成通过。
- 缓存/草稿：本轮没有可编辑双端草稿合同，未建立离线写缓存或合并器；验证的是失去旧client实例后重新GET，非离线编辑自动合并。
- 本轮没有新增独立PG，脚本使用transactional fixture；不借用BY46历史PG证据冒充本次真实数据库并发。也未测试真实手机/桌面/390px、推送到达或网络时延；没有UI改变或可用双端定稿页面，不绕过CUA本地URL拒绝。
- 证据根：`F:/思潼AI增长os/test-environments/checklist-e-offline-20260905`，`audit.log`/`qa-full.log`/`diff-check.log`/`git-status.txt`。`pnpm.cmd qa:full` exit0（实际执行qa:fast、API/Web/Agent等全仓typecheck、qa:regression含BY45/46相邻、build），`git diff --check` exit0。
- 审计脚本SHA256=`B0CDB7DF1160403DA8E8591C7B50AA6362A585A8B4F4CF65E23D724ACC710C5B`。本轮只新增此脚本与本审计文档，更新STATUS/TEST_MATRIX/tasks README/PRE_FINAL条目。无生产代码/Schema/包配置改动；未登记虚构BUG。BY47的media.ts/hash=`3FBC43F8…43AC16`、package/hash=`783D12CD…2540BA`均保持不变。
- 最终3016/5176/55434/55446无监听，未启动或接管长驻环境，所有Fastify注入实例close，全部测试命令已结束。不存在本轮runtime/PID/source_fresh声明；无需停止脚本，不删除旧资料或任何数据库记录。
- Provider/外网/真实客户/费用0；无grant/邀请码、无旧环境刷新/进程接管、无生产部署。

## 收口与下一恢复点

- 本次没有生产缺陷红灯，不登记新Bug、不占BY48编号、不用“文件更少/新系统更多”冒充交付。新增的是可重复审计测试与本证据文档。
- “已具备”仅指上述后端已有同源/版本/访问基础；“待原型”是手机可编辑实体及冲突展示；“外部前置”是正式身份/多端接入和推送SLA。整体多端产品未放行。
- 下一唯一候选F：既定结构导出/报告的只读差距审计，先核对正式结构、权限、结果持久化/下载与已有测试，有真实缺口才立卡；不新造经营指标、打印布局或报表业务。
