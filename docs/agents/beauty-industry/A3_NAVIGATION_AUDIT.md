# A3正式导航只读差距审计（2026-09-05）

## 后续结论：BY52已关闭目录显示P1

以下为最初只读历史。随后独立PG/HTTP/Chrome确证20项品牌目录显示失败，并由[BY52](tasks/BY-52-我的AI品牌与已开通入口边界.md)最小修复；六身份×1440/390×三轮和qa:full含build/diff全绿。服务端owned产品/品牌决定入口，公开推荐与旧私有权限不变。充值缺口不是本轮P1，未擅自开放充值/改价。新视频路线仅按STATUS登记官方Seedance多参考优先、可灵备选及实拍剪辑分离，不在本轮启动。

范围：BY51之后仅审共享导航、我的、积分入口与视频壳层；不改代码/价格/权限、不运行新测试、不启动环境，不恢复暂停模块。候选来源与SHA见[PRE_FINAL_FOUNDATIONS](PRE_FINAL_FOUNDATIONS.md)；冻结候选与单独获授权下午附件仅作需求证据，候选11处修复/779链接零死链不代表正式源码已验证。

## 候选逐项映射

| A3问题 | 正式文件/路由与当前事实 | 已有证据/本次结论 |
|---|---|---|
| mine余额HTML破损 | `apps/web/src/components/beauty-industry/BeautyIndustryShell.tsx:148`用React输出creditBalance或“—”；`pages/AgentProductsApp.tsx:3633`为`/my-ai`，余额来自catalog | 不存在候选同一坏标签/1,280硬编码。MyAi加载时用0兜底与美业壳层不同，是待体验核实项，不直接定P1 |
| automation重复我的/缺余额 | 正式有`components/automation/AutomationView.tsx`组件，但美业十项导航没有候选独立automation.html路由 | 不适用同页修复；不能把其他产品组件当候选页面复制 |
| moments重复我的/缺余额 | `main.tsx`正式路由未注册候选moments.html | 页面不存在于本次正式美业导航，不为审计新建功能 |
| goal-detail缺积分入口 | 美业路由解析未注册候选goal-detail.html | 页面不存在；不复制11项混合导航 |
| video缺余额/我的入口 | `/agents/beauty-industry/acquisition/video`由BeautyIndustryAcquisitionPage使用共享Shell，已有余额与唯一返回我的AI链接 | 候选缺失未在源码复现。正式是选题/内容/复盘/爆款复刻规划/文生规划/图生规划六卡，不是候选三模式已上线 |
| crm复购率链接充值 | 当前美业导航/路由无候选crm.html和58%假指标；正式销售是`/agents/beauty-industry/sales` | 不适用，不能把指标链接修复当作真实CRM已存在 |
| sales-sim坏引号 | 当前无候选sales-sim独立页；正式sales页面不等同模拟训练 | 不存在同一页面，后续训练方向不在本轮 |
| sales-sim280→80、FAQ40→40–80 | 正式billing/积分合同不采用候选价格；没有points-recharge.html正式路由 | 不采纳商业改价，未修改任何报价/账本 |
| 各页直接充值 | Shell积分是显示值而不是按钮；`/my-ai`可到`/account`，AccountCenter展示余额/订单，营销页另用`/billing/catalog/orders` | **未发现统一直接充值入口**，不可写“充值路径已通过”。是否增加统一入口属于产品/计费设计差距，非据候选即可判定的核心P1 |

正式主导航10条稳定URL在Shell注册，`main.tsx:264–277`选择正式美业与MyAi页面；`lib/api.ts:25`在本机DEV保留合法apiBase。视频旧content-ten与新content别名均保留；复盘二级review、旧data/content-review独立路由保持。以上为源码证据，不代替运行时结果。

## 新发现：返回“我的AI”的品牌显示边界（优先待复现）

`AgentProductsApp.tsx:3641`在loading结束分支无条件渲染`lanqiAgentEntry`，带固定“兰琪 AI”与`/lanqi/store-profile`按钮；该section不以owned产品或tenant品牌作条件。Shell的`/my-ai`链接可到此分支。**静态确认品牌入口无条件展示；尚未运行合成默认租户DOM，不断言数据越权。**

建议下一单一P1候选：“默认美业租户返回我的AI时品牌入口按授权过滤”。最小红灯：隔离默认品牌合成租户加载catalog成功→美业页点击返回我的AI→断言无兰琪专属卡；兰琪授权租户应有正确入口；其他品牌不得得到兰琪入口/数据；刷新、apiBase、390px、加载失败同时验证。先复现，再决定独立卡编号，不在本次审计提前修复或创建空卡。

现有`beauty-industry-navigation-shell-p1-smoke.mjs`检查10条唯一链接、移动键盘/样式及WorkBuddy复用；`beauty-industry-navigation-browser-e2e.mjs`检查美业页面租户/品牌/overflow；两个品牌package专项和导航browser源码未发现MyAiPage或/my-ai路径断言。TEST_MATRIX的BY14/BY23/BY30历史PASS不能覆盖上述目录页缺口，也不能当作本轮新执行。

## AI剪辑最小稳定合同与复用审查（仅候选下一步）

- 输入：当前用户/租户/店铺拥有并获用途授权的多段raw_video文件ID+hash+授权版本；四用途、目标时长15/30/60、清理/字幕/音乐/片头尾选项需版本化。不能从勾选推定肖像/音乐商用许可。
- 计划：可核验的源片段起止、转写引用、排序/裁切/字幕、音乐资产授权与片头尾文本；先校验时间轴范围，不编造口误删除/字幕准确率。缺ASR证据只允许明确降级或阻断，不能称已听懂。
- 任务：复用已有UploadedFile/门店授权/lease、幂等job、积分预留释放、BY51按call计量，不另建孤立队列/账本。字幕ASR和模型外发需独立scope/预算/请求上限；BY50许可只覆盖既定视频换人，不能原样作为剪辑授权。
- 输出：真实MP4、hash/时长/来源与剪辑报告、owner授权下载、历史/刷新、部分失败与中断恢复；报告只能计算实际处理数据。
- 可复用技术：`clip-renderer.ts`已有ffprobe、FFmpeg裁切/拼接/ASS字幕；`clip-planner.ts`/`persona-clip-planner.ts`有片段计划，需先核对固定产品合同；不能直接复制ClipLabApp品牌/带货业务。
- **禁止直接接入旧clip路由/存储**：server.ts:141顶层注册clip-lab，与146行美业entitlement钩子不同；`clip-temp-storage.ts`接口只有id/kind/路径/24hTTL，无tenant/user归属字段；route用sampleId读取，不具备美业安全复用证明。这里只记录复用缺口，不触碰其他产品、不声称已完成全局安全审计。
- ASR外发正式授权缺口已在BY47记录；BGM不能把候选库当已授权商用素材。`/v1/media/autoclip`仅候选，不新增路由、不联网。建议先处理MyAi品牌显示红灯，再由调度安排剪辑合同审查，不自动实施。

## 执行与限制

本轮只读源码、候选既有记录、测试断言及历史矩阵；`git status --short`479项基线，保护全部既有改动。3016/5176/55434无监听，未启动API/Web/DB/浏览器，**桌面/390px、console、登录/充值/跨租户动态路径未运行**；不借此报告用户可验收。没有新qa:full/typecheck/E2E，原因是仅文档审计且禁止新测试；此前BY51全量PASS仍仅为此前范围证据。仅校验本文件/状态可读、链接目标和git diff --check。

Provider/外网/费用/业务写入/邀请/部署=0；未调用候选运行资产。云端仍停在登录和资源授权前置；XHS、问答、BY19/20/43、BY44外部继续暂停。当前不新增已关闭P1，品牌显示为优先待动态复现项；PowerShell跨宿主指纹P2保持原记录。
