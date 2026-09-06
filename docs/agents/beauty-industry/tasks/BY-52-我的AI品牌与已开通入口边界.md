# BY-52 我的AI品牌与已开通入口边界

状态：已完成 / idle（2026-09-05 15:28 +08:00；本地范围P0/P1=0）

## 归属与唯一结果

美业任务含共享目录平台子改动；中风险，禁止并行。默认/其他品牌租户从美业Shell返回`/my-ai`只看到已授权入口；兰琪品牌美业仍进入同一美业核心，旧lanqi产品入口仅对该产品授权有效。

## 范围与不做

仅目录显示、服务端当前产品权限/品牌派生、加载/错误未知余额；不改公开推荐/购买目录、后端私有业务授权、积分价格、Skill、视频/ASR/AI剪辑、跨PowerShell指纹。暂停范围不恢复，Provider/外网/费用/邀请/生产0。

## 红灯与现象

- 全新专用AcceptanceRoot `F:/思潼AI增长os/test-environments/by52-directory-20260905`，正式setup/start；PG55434/API3016/Web5176，未复用旧库。DOTENV_CONFIG_PATH指向本根不存在的no-provider.env，不读取apps/api/.env真实secret；仅随机合成测试凭据。
- 正式`/agents/me`返回owned agents且另有allAgents；公开推荐为`/agents/catalog`与`/p/:slug`，不能把无条件私有“进入兰琪”卡视作公开购买推荐。
- `scripts/beauty-directory-browser-e2e.mjs`独立PG+真实HTTP+Chrome1440/390：默认、其他、无权限、过期、兰琪美业均显示无权旧lanqi卡；兰琪美业自身卡不显示其服务端品牌。共20失败，console0；证据`reports/red-1788592099179/evidence.json`及截图。旧lanqi接口无授权403，授权200，**未证明数据越权**。
- 源因：MyAiPage加载后无条件附加品牌卡，绕过catalog；美业品牌没有传至owned catalog呈现。原品牌/导航E2E没覆盖返回MyAi路径。初次ready断言把database对象当boolean为测试自身问题，已修正，非产品Bug。

## 验收条件

默认/其他/无权限/过期无专属卡；服务端品牌兰琪美业有正确核心入口；独立旧lanqi授权保留旧入口；不能凭租户名或客户端brand推导；loading/error无旧卡、未知余额为—；新旧直达权限不变；刷新/返回/apiBase/1440/390/console；三轮同批，业务请求/扣费0；专项、qa:full含build、diff。

## 修改归属与恢复

实际归属：

- `apps/api/src/services/owned-product-directory.ts`：共享目录适配层；服务端tenantProductEntitlement active/expiry与品牌注册表决定显示，独立旧lanqi产品不等于lanqi美业品牌。无知识/客户事实。
- `apps/api/src/routes/agents.ts`：只增加import及`GET /agents/me`的产品过滤/品牌name/productEntries；原公开catalog/allAgents、推荐购买页与旧私有route授权不变，其他既有脏改保留。
- `apps/web/src/pages/AgentProductsApp.tsx`：只扩目录response类型和MyAiPage；删除无条件旧卡，渲染服务端已开通产品，未知余额—，加载/失败无卡。兰琪名称来自服务端包，不从displayName判权限；普通目录仍使用平台视觉。
- `scripts/owned-product-directory-smoke.ts`、`scripts/beauty-directory-browser-e2e.mjs`：专属离线/独立PG+真实Chrome回归；没有候选运行依赖。`package.json`只在品牌/导航现有专项串入本新回归，因此qa:full内能执行。
- 本卡、STATUS、TEST_MATRIX、A3_NAVIGATION_AUDIT、BUG_REGRESSIONS、PRODUCT/CONTRACTS/WORKFLOW及tasks README：状态/显示合同与证据。

保护根基线git status479项与既有BY/FIP等修改，无提交/回退/整包覆盖。回滚只撤销上述目录hunk及新增adapter/test接线，保留旧业务/数据库/历史；没有schema/迁移/客户数据变更。新PG仅合成fixture，数据库持久保留用于审计。

## 验证记录

- 专项：`pnpm.cmd beauty-industry:brand-package-p1-smoke`、`pnpm.cmd beauty-industry:navigation-shell-p1-smoke`、`pnpm.cmd branding:smoke` PASS；新adapter测试三轮产品/品牌分离、未知品牌回退、DB错误抛出、无正文/知识与余额占位。
- `BY52_ROOT=<本根> BY52_PHASE=red|green|final|release-final BY52_ROUNDS=3 node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-directory-browser-e2e.mjs`。浏览器以真实Chrome/headless/隔离context操作Shell返回，六合成身份、1440/390、HTTP/PG、loading延迟/503、刷新/后退、旧/新入口点击、身份header/brand query不覆写、membership撤销401，旧私有接口无权403而非伪称404。无Provider/业务POST，AgentRun/CreditTransaction均0。
- 第一绿色`green-1788592373904`和入口补充`final-1788592639320`各3轮PASS，Runtime console warning/error0。截图人工检查发现新增legacy卡误用深色accountCard样式，最小改为现有目录agentProductCard；补样式断言/聚焦截图。不是以DOM通过掩盖对比度问题。
- 两次`pnpm.cmd qa:full`均exit0；最终`logs/qa-full-release.log`覆盖qa:fast、regression（含新目录smoke）、API/Web/Agent/Shared等全仓typecheck与build。首轮后的唯一产品变更是卡片样式，因此重跑一次最终门禁；此后仅测试脚本/文档改动，不再重复全量。
- 测试自身纠偏：TS脚本顶层await在仓库CJS入口不支持，改async main；Chrome context销毁后的Fetch回调曾抛session不存在，严格只对已登记closing session处理，活动session错误仍记FAIL。中止的release-1788592826639不能记PASS；其Chrome PID22760/11324端口随后只读确认已退出。
- 浏览器扩展bsk连接0；使用仓库已有CDP模式的独立Chrome，不借用个人会话。最早red/green临时profile删除命令被工具策略拦截，未绕过；其中只含10分钟有效的合成token、非客户身份。最终runner在确认浏览器退出后自动清理自己新建profile；数据库与截图/证据不删除。运行root凭据仅合成，未读取真实secret。

## 环境与最终停止

最后source/runtime Windows PowerShell5.1完整指纹`15E7B0E91336BF713AF27E434F373310B2EDA18C4117C3A9BAB83231A580373B`；PG55434/PID27436、API3016/PID6256、Web5176/PID27128，ready/database、fresh/同一源码、PID/listener和正式工作目录/TSX bootstrap一致。API/Web是本根正式start创建；不是认领旧PID。DOTENV_CONFIG_PATH禁读真实env，provider_configured=false、controlled_mock、media disabled/max0，费用0。最终停止另补下方记录。

- 最终`release-final-1788592949330/evidence.json`：六身份×1440/390×三轮，failures=[]、consoleEvents=0、providerCalls=0。legacy-readable两尺寸截图人工复核文字对比度和按钮可读；刷新/历史返回、加载/503、空/过期/跨租户、旧授权入口均PASS。没有业务生成，AgentRun/CreditTransaction=0。
- 正式`status.ps1`最终fresh=true/ready与database=true/Web200/PID匹配；精确核对PG executable、-D本根pgdata与55434监听后，Windows PowerShell5.1 `stop.ps1 -AcceptanceRoot <本根>` exit0。15:28:39复核3016/5176/55434无监听，PID27436/6256/27128/Chrome27928均退出；最终Chrome profile不存在。保留数据库、日志、截图；未处理其他进程。
- 无新增用户邀请、无部署、无真实Provider或费用。未运行个人登录浏览器/生产路径/真实付费业务：本次仅目录显示修复；browser-skill扩展连接不可用后采用独立Chrome CDP。既有跨PowerShell指纹P2和最早审计profile清理限制保持记录，不掩盖。

## 下一恢复点（仅登记，不启动）

暂停XHS/经营问答/BY19/20/43/BY44外部不恢复。下一最小路线验证优先官方火山方舟Seedance多参考输入：核实人物/场景/参考视频/声音、实名肖像入口、实际模型/限额/报价；可灵备选，不采用非官方即梦逆向代理。本轮仅收到调度转述，未独立读取API参数正文，官方案例不等于本产品实测。已有实拍剪辑优先裁切/字幕/配音/授权BGM；生成探店不得冒充真人到访。保留BY45–51基础与现有driver，不扩大万相换人，不并接全部模型。新Provider传素材/开通付费/密钥权限仍需独立授权；真实小样采用一次集中批次预算/最大创建/查询与失败停止条件，不把路线许可当费用授权。
