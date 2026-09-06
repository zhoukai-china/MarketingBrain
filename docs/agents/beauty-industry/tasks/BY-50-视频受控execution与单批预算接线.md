# BY-50 视频受控execution与单批预算接线

状态：本地工程完成/idle；2026-09-05 11:08 +08:00开工，编号已核对未占用。真实云/视频/客户页面未验收，默认disabled。

## 后续有界交付：真实前置只读核查（2026-09-05）

不新增代码卡、不重复已完成门禁；补充[VIDEO_CONTROLLED_EXECUTION](../VIDEO_CONTROLLED_EXECUTION.md)核价/预算/输入与最小RAM步骤。专用API最短2秒但总览严格大于2，选3秒避边界；北京std¥0.60/秒，建议1创建/20poll/40应用存储/1下载、2素材≤11MiB、应用预算¥2.00。OSS测算有明确单价/读取/容量假设，北京账户现价与资源未核实；不能把签名URL第三方读取或云账单称绝对封顶。

原创3D虚构成人方案优先且未准备资产；不拿客户/老板/官方示例当已授权素材，不以无人色块证明换人成功。只有非生产权限、实际素材许可、核价与新预算齐全后才可能签真实许可。当前只是可批准文本草案，Provider/云账号/secret/素材上传/grant/费用0，无环境变动。

本子项修改仅上述合同说明、本卡、STATUS、TEST_MATRIX、tasks README；文档路径/官方链接只读核对及`git diff --check`，没有新Bug代码、不改BUG已关闭结论；无DOM/源码变化不重跑qa:full/E2E。停止并向调度报告3项最少缺失，不自动进入真实测试。

## 归属与唯一结果

美业通用核心的高风险视频执行接线，唯一编码任务，不并行。复用BY45协议/job/积分/原子MP4、BY46授权与lease、BY49私有OSS driver；安装默认关闭的服务端可信单批许可与持久化外部预算/次数门禁，使合成transport能沿正式HTTP完成上传、提交、轮询、落盘与结算/恢复。

## 边界

不恢复XHS/经营问答/BY19/20/43/BY44外部；不扩背景/口播/模板业务，不改商业积分报价，不建第二套账本或泛用授权平台。只用合成素材/凭据/许可和注入transport；无真实有效grant、云HTTP、Provider、生产secret/桶/服务器/RAM/部署/邀请码，费用0。

## 验收与基线

1. 正式route当前只有staging factory、无execution且maxCostFen0，先红灯证明可信许可不能进入完整链。
2. 许可绑定tenant/store/user/request、模型/地域/模式/时长、文件hash/授权版本、expiry/revoke、单批提交与成本；客户端不得选择或覆盖。缺许可/配置/成本在云上传和积分前拒绝。
3. 持久事务单次claim与请求计数；重启/多进程争抢不重发。提交超时或DB写入丢失不能退外部额度后重试，积分释放不代表Provider退款。
4. 真实HTTP+独立PG高风险3轮：正常、跨租户/角色、过期/撤销/篡改、预算边界、并发、重复确认、poll与submit分离、存储/DB失败、未知终态恢复/清理与脱敏日志。
5. BY45-49相邻、专项、API/Web/Agent typecheck、qa:full含build、diff；无DOM变化则不创建页面或冒称Chrome通过。

## 文件归属/恢复

全部是通用美业核心，不新增品牌知识或WorkBuddy候选运行依赖。不提交、不回退、不覆盖BY11–49及其他任务脏改。以下仅列本项追加的语义，不宣称整个文件归本项：

- 新增`apps/api/src/services/beauty-video-execution-permit.ts`：严格签名scope、当前权限/素材版本、余额与成本预检、唯一claim、持久次数与脱敏audit。
- 新增`apps/api/src/services/beauty-video-controlled-execution.ts`：默认关闭配置factory；组装既有Provider/结果落盘/OSS，不允许半注入夹具与真实链混用。
- `apps/api/src/services/viral-video-replication.ts`新增授权版本/permit admission字段；`beauty-video-asset-authorization.ts`携带实际授权version；`viral-video-replication-runtime.ts`保存request/permit恢复快照、control hook及中断终态cleanup；`beauty-video-material-integration.ts`转接control。
- `beauty-video-private-staging.ts`、`beauty-video-oss-staging.ts`、`beauty-video-staging-config.ts`（均在上述services目录）仅追加server permit关联/每个实际SDK请求的计数hook和cleanup预算分类；BY49不可覆写/权限/URL/STS限制保留。
- `apps/api/src/routes/viral-video-replication.ts`改用受控factory和本地结果root；`apps/api/src/config/env.ts`、`.env.example`新增默认disabled配置，密钥仍仅服务端，无客户端grant字段。
- `packages/db/prisma/schema.prisma`仅追加25行permit模型；新增`packages/db/prisma/migrations/202609050002_beauty_video_execution_permit/migration.sql`表/unique/index/非负CHECK。不改旧账本数据和商业价格。
- 新增`scripts/beauty-video-execution-smoke.ts`、`scripts/fixtures/video-permit-worker.ts`；`scripts/fixtures/replication-test-db.ts`补事务permit夹具；`scripts/beauty-video-oss-staging-smoke.ts`只适配正式factory断言；`scripts/acceptance/beauty-industry/video-foundation-db.ps1`及`video-foundation-stop.ps1`只增加BY50隔离root/套件白名单，保留双身份门禁。
- `package.json`新增专项并加入qa:regression。无新依赖，BY49 ali-oss版本不变。
- 文档：本卡、STATUS/TEST_MATRIX/tasks README/PRODUCT/WORKFLOW/CONTRACTS/PRE_FINAL_FOUNDATIONS、VIDEO_PRIVATE_OSS_STAGING的BY50接续说明、新增VIDEO_CONTROLLED_EXECUTION，以及docs/BUG_REGRESSIONS的QA-20260905-006。

## 红绿灯和验收结果

1. 初始factory/正式route接线缺失红灯（`red.log`）；补齐默认关闭的明确受控assembly，不自动签发许可。
2. 中断提交同时DB update/finish失败→恢复时已退款但仍2对象，`interrupted-red.log`期望0失败。定位refresh早返回跳过cleanup，最小修复后0对象，未知终态与额度不重置，登记QA-20260905-006。
3. 缺许可、过期/撤销/篡改/错误版本/不足预算/余额、body试图覆盖、跨tenant/store/user、素材hash/授权版本变化均云前或下一请求前拒绝；默认disabled与配置不全安全关闭。
4. 同一许可多handler/三独立进程争抢仅1胜者。submit1、poll有界、download1、storage有界且留8次清理；每次请求先持久消费，未知提交/进程中断/DB故障不重发；低余额不claim不上传。
5. 合成MP4经实际ffprobe、原子持久化、owner下载hash、跨租户404、历史恢复；失败一次释放，两条合成成功分别结算100测试积分（沿用fixture，不是新商业报价）。删除失败不改已成功账本，后续sweep清理。
6. 独立PG新增迁移应用、保留记录的可回退探针、三轮故障/竞争均PASS；真实客户DB不读写。

## 实际测试命令 / 证据

- `pnpm.cmd --filter @baolu/db exec prisma generate` PASS（生成既有客户端，不访问客户DB、不显示密钥）。
- `pnpm.cmd beauty-industry:video-execution-smoke` 红→绿；最终qa:regression内同批三轮PASS。
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/beauty-industry/video-foundation-db.ps1 -Suite BY50 -Port 55450` 最终PASS。每轮合成submit8/poll4/download3/storage159、Provider0/外网0/费用0、测试积分净200。
- `pnpm.cmd qa:full` 最终exit0，实际含qa:fast、qa:regression、全仓API/Web/Shared/Agent typecheck与build，BY45–49及XHS/品牌/WorkBuddy/媒体观测相邻专项PASS。未将先前或已知失败冒称PASS。
- `git diff --check` 最终收口运行，PASS；精确状态/差异/文件hash附仓库外证据。
- 主证据：`F:/思潼AI增长os/test-environments/by50-execution-offline-20260905`，包含基线git、红绿及`qa-full-final.log`。最终PG：`F:/思潼AI增长os/test-environments/by50-offline-520b250c309943ed8434ddadcaa32e08`，runtime/test/schema/stop日志俱在。

## 环境、停止与回退

- 最终PG55450/PID22760，session`520b250c309943ed8434ddadcaa32e08`，源码指纹`C8F3A9FE8CA6F908F64499506F4DC5FE65630EB366C5BB1D0F6F9B7D3C521A6D`；11:29:49启动、11:30:49按repo/data/runtime/PID/命令/listener双身份停止，合成DB保留。没有API/Web/浏览器或生产进程启动/接管，不宣称在线source_fresh。
- 新表为additive，旧逻辑无需删表即可回退到disabled。生产回退先关闭execution并保留表、已消费额度、job、账本、lease和结果；未知Provider不重发，按原租约清理。独立PG验证了保留记录回退，不允许删除历史许可或清零计数来重试。
- 只停止本轮owned PG；若未来需停止仍运行的同类环境，用正式`video-foundation-stop.ps1 -AcceptanceRoot <精确BY50 root>`并保持身份门禁；当前root已停止，不重复停止或事后认领新PID。最终3016/5176/55434/55450均无监听。

最终关键文件SHA256：permit=`AE1D1DFFEE71196978916BB35E91CEB3B6505D6692F2D1CE14B99ABA01DD88ED`；assembly=`8F3FF77C80D142D0F5E70B64C2BE14C24BAD7D36C2733002FCE22A0C3DFA7D36`；runtime=`8FFAC38C67BC362B960ECC4B2788A1E4260F33C7DB81EB8A8387BA3618537149`；schema=`9B2D1EB3CE21F954D8AC174DC3F0FB9C7F5A8481A9C5EB8669EB817DDE89722A`。工作树477条既有与本轮混合状态，未整体提交；详细前后status/stat和diff-check在主证据根。

## 未运行 / 风险 / 下一恢复点

- 本地范围P0/P1=0，QA-20260905-006关闭；不代表暂停产品P1关闭。真实OSS/STS/RAM/DNS/TLS/视频Provider、外部账单和客户页面均未验收，未建邀请。没有DOM/URL变化，故未重复桌面1440/390Chrome，不将Fastify.inject说成浏览器成功。
- 外网/真实Provider/费用=0。所有scope、素材、凭据和transport只属合成fixture，`local_only`不能进入真实provider_https；无有效付费grant、无生产部署。
- 当前签名存储费用审核hash/上限只是可信审查接口，不等于本轮验证真实OSS单价或账单。真实前置必须包括专用非生产桶/短期最小权限凭据、授权素材/用途、精确时长/模式、Provider+存储价格与总额；2秒std视频已登记估算¥1.20另加存储，不能沿用旧图文≤¥1。
- 下一唯一建议：先审查上述真实外部前置与最小验收计划，未批准前保持disabled；不发明新的零费用P1，不继续ASR/新背景/口播/经营问答。XHS/BY19/20/43/BY44外部保持PAUSED。

## 不超过5步的内部验收清单（非邀请用户测试）

1. 查看执行合同和默认disabled配置，确认没有公共签发/客户端覆盖入口。
2. 查看红灯与三轮专项/PG日志，对照计数和一次性claim。
3. 查看未知终态/DB中断/cleanup和跨租户证据。
4. 查看qa-full-final.log、diff-check及PG停止记录。
5. 若拟真实验收，先审查独立外部权限/素材/价格与预算，不直接打开开关。
