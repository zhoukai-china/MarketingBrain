# BY-54 Seedance持久授权与受控执行接线

状态：本地后端工程完成 / idle（2026-09-05）；公开入口/真实云仍未放行

## 归属与唯一结果

美业通用核心含最小原子存储扩展，高风险，串行。将BY53协议port接入现有BeautyVideoExecutionPermit/ViralVideoReplicationJob/积分事务/AuditLog及原子视频保存；新Ark模型/用途/微货币预算独立签名，不把wan许可或声明升级成Ark审核。默认disabled，不新增公开UI/route，不改商业积分报价。

## 边界

仅独立PG、合成凭据/素材/人工审核证据和注入网络。真实Provider/外网/上传/登录/充值/邀请/生产/真实grant/费用0；不读.env真实secret，不处理BY52已停或未知环境；XHS/经营问答/BY19/20/43/BY44外部保持PAUSED。不造第二账本/队列，不扩成全平台重构。

## 验收与红灯

1. 无持久审核/许可/账户/预算证据，云前拒绝；tenant/user/store/purpose/hash/version/account绑定，撤销/过期逐请求重验。
2. POST不可重放，GET有限退避/计数；独立PG重启、三进程claim、DB失败/响应丢失/迟到usage不丢证据、不重置预算。
3. HTTPS严格origin、DNS公共IP与连接绑定、TLS证书核验、禁止重定向；安全错误不含凭据/原文。
4. 原积分预留/结算/释放与permit/usage同事务；缺usage未知、Ark token价不与total双计、不伪造Provider退款。
5. MP4原子落盘/元数据/owner下载、部分保存及租约恢复；无DOM不宣称浏览器E2E。三轮专项+相邻qa:full含build/diff。

基线：BY53三轮PASS，`F:/思潼AI增长os/test-environments/by54-evidence-20260905/logs/baseline.log`。开始git status484条，全部保护，不整体提交。新持久组装缺口assert红灯见`logs/red.log`；新增独立token cap精度红灯见`logs/token-cap-red.log`，期望refunded实际charged，已最小修复且全绿。不是已发生线上付费错误。

## 文件归属/最终交接

### 实际修改归属

- 美业通用核心新增：`apps/api/src/services/beauty-seedance-execution.ts`（签名scope/manual review/原事务/usage/恢复）；`beauty-seedance-https.ts`（固定origin/DNS连接绑定/TLS/限额）。无品牌字符串或知识注入。
- 既有BY53文件最小扩展：`apps/api/src/services/beauty-seedance-adapter.ts`仅导出安全Error、controlled服务端key注入口；不改原模型/Schema/状态/GET协议。
- 既有BY45保存器：`apps/api/src/services/viral-video-replication-assets.ts`增加显式URL validator和默认off恢复回执/partial清理；wan默认URL政策保留。没有改原runtime积分finish逻辑或数据库Schema。
- 配置共享热点：`apps/api/src/config/env.ts`及`.env.example`仅追加SEEDANCE七项，disabled/空key/报价0；`package.json`仅增加专项命令与qa:regression入口。这些文件的此前未提交改动不属于BY54，不整体提交。
- 测试：`scripts/beauty-seedance-execution-smoke.ts`、`scripts/fixtures/seedance-execution-worker.ts`；正式`video-foundation-db.ps1`/`video-foundation-stop.ps1`只增加BY54独立目录/Suite支持，不放宽PID/绝对命令/listener/data身份门禁。
- 文档：本卡、`SEEDANCE_EXECUTION.md`、`SEEDANCE_ADAPTER.md`接续说明、STATUS/TEST_MATRIX/PRODUCT/WORKFLOW/CONTRACTS/tasks README、`docs/TEST_PLAN.md`、`docs/BUG_REGRESSIONS.md`的QA-20260905-010。无DOM/Skill/WorkBuddy候选/生产包修改；候选运行引用0。

### 测试命令与证据

| 命令/检查 | 实际结果 |
|---|---|
| `pnpm.cmd beauty-industry:seedance-adapter-smoke`基线 | PASS，三轮、真实网络0 |
| 缺持久factory断言、新token cap专项 | 修复前FAIL，分别保存red.log/token-cap-red.log；绿灯不降低规则 |
| `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-seedance-execution-smoke.ts` | PASS，连续三轮；每轮合成POST10/GET8/download4、Provider/外网0 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/beauty-industry/video-foundation-db.ps1 -Suite BY54 -Port 55454` | PASS，独立PG同批三轮，每轮三OS进程抢唯一POST；父10+worker1实际合成POST，不是真实模型 |
| API typecheck | PASS；首轮3处TS narrowing错误修正后通过 |
| `pnpm.cmd qa:full` | 包含qa:fast、qa:regression、新/相邻专项、API/Web/Agent/Shared等typecheck及全仓build；第一轮qa-full.log exit0；最终日志qa-full-final.log |
| `git diff --check`/新增文本检查 | PASS；LF→CRLF提示不是测试失败 |

最后审查新增`persist-lease-red.log`：原61s只覆盖下载而未覆盖30s ffprobe，时长断言FAIL。最小改为120s下载/校验/提交租约，原terminal/CAS仍阻止超时旧writer覆盖终态；内存及独立PG重新三轮PASS，最终全仓门禁重新执行，不复用旧源码结果。不是任意慢盘或断电耐久SLA。

过程纠偏：测试HTTP handler提前设置video/mp4再发送拒绝JSON导致500，修正后跨租户404；nullable差异由内存undefined/PG null引起，仅测试修正。第一次PS5.1脚本入口被默认策略拒绝，没有启动DB；随后只为正式脚本子进程设置Bypass，无系统策略修改。以上不冒称产品Bug或PASS。

内存与PG均覆盖余额/权限/签名/模型与scope注入、同key幂等、POST响应丢失及观察DB失败不重发、用量缺失/迟到/独立token上限、429退避/耗尽、失败释放一次、私有MP4实际ffprobe、partial清理、落盘后DB失败重建服务由回执恢复、owner/跨租户/店/用户拒绝、最新审核撤销后不能下载、日志安全。HTTPS为注入底层DNS/request检查证书选项和连接IP，不伪称真实TLS握手通过。

### 环境、hash和停止点

- 最终独立根：`F:/思潼AI增长os/test-environments/by54-offline-a15b4321c8794337bfc9f9ebe6f5dc59`，runtime/test/schema/stop日志保留；PG55454/PID25812于16:43:17 +08:00经绝对postgres命令/data/runtime/listener一致后正式停止，端口已无监听。前轮root `by54-offline-f20c4ac41c704b4cb0fd453760fefbe7` / PID22080及`by54-offline-ea2782fad0a54a56aef0e1ec9e4e3994` / PID21264亦已正式停止，不复用审计。
- source/runtime指纹（同WindowsPowerShell5.1）：`558DCC7A06AAC60511C607C59D03938F5E4E6047FAEC57143E42892CD75A1770`。最终环境创建后仅文档更新，不将旧宿主组合hash混用；原跨PowerShell口径P2不在本项修。
- execution SHA256=`B0C45FA4B2D9893FA33FBF9398C449F31AE200D4486880AEE6941AECE94D0F85`；HTTPS=`0EA690C49760F256E07F34D5B5975DC7A4B24DD2787ED8E9B3394AF2ABF37C35`；smoke=`28597F6EE3E51CD1A4EA694532251DAC86180414D6825533ED8C07F8FE885567`。
- 证据根：`F:/思潼AI增长os/test-environments/by54-evidence-20260905/logs`。初始484条status，最终487条（Git折叠目录非文件总数）；保留其他所有脏改，不提交/回退。独立合成数据库和临时fixture不删除，无持久用户数据操作。API3016/Web5176/PG55434没有本轮启动，BY52环境不动；无新浏览器/邀请码/真实grant。

### 未运行/风险与下一唯一恢复点

- Provider/外网/真实上传/真实审核/登录/充值/生产/费用=0；测试签名均local_only，全合成账号/图像/依据，不等同用户外部授权。无DOM/公开route变化，不重复1440/390 Chrome，也不声称已验真实用户页面。
- 本地范围P0/P1=0；真实端到端前置缺口1：核验专用非生产Ark账号、两份已授权且官方接收的素材、适用价/新单批预算及云账单估算残余风险。具体人工审核/配置/费用边界见SEEDANCE_EXECUTION；没有独立官方自动审核API证据，不自行编造接口。
- 真实first profile模型估算¥4.968+存储/流量，旧图文¥1与wan许可不得复用；100积分仅fixture，不提出已批准商业售价。不因代码完成自动创建许可、登录或调用。下一只做上述前置合并核验，等待总调度接力；不自行开新卡或恢复PAUSED范围。
- 回滚/停止：执行配置保持disabled/空key/报价0、无公开注册即可保持不可调用；若未来本项独立PG遗留，只能用 `video-foundation-stop.ps1 -AcceptanceRoot <本次精确root>` 经身份门禁停止，不能停未知PID。不删除原账本、审核、MP4或旧合同。
