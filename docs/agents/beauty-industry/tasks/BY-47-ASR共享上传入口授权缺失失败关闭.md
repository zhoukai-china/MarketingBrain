# BY-47 ASR共享上传入口授权缺失失败关闭

状态：已完成 / idle（2026-09-05，清单C准入安全子范围；ASR业务未开放）

## 归属与用户结果

- 产品：美业任务含公共平台入口安全子改动；风险高；仅本任务串行。
- 用户结果：没有绑定服务端用途、租户权限与预算的音视频上传不会仅因配置了密钥而被外发转写；现有零费用表格解析不退化。
- XHS/BY19/20/43、经营问答、BY44外部接入保持暂停；不新增录音分析、客户记忆、情绪评分、ASR队列、Schema、权限或收费入口。

## 只读已有/不足矩阵

| 路径 | 已有事实 | 本轮判断 |
|---|---|---|
| `BeautyIndustryAcquisitionPage.tsx` → `beauty-industry.ts` `/video-content/preflight` | 元数据预检，转写由用户提供；不是自动ASR任务 | 保留，不制造持久队列 |
| 视频/直播workflow | 手工提供的转写与证据进入正式合同；缺证据失败关闭 | 保留，不能假装读取录音 |
| `server.ts` → `registerMediaRoutes` → `/media/analyze` | 根路由无鉴权；仅用Authorization是否存在改变IP限额；配置密钥即可同步ASR，无任务/账本/文件用途绑定 | 合成HTTP已证明缺少准入；唯一修复点 |
| `media-provider-observation.ts` | 同步transport有安全错误、超时/取消/usage观测，无自动重试 | 保留协议，不因原型写异步而重造 |
| `clip-asr.ts` → clip/persona planner | 另一个产品的filetrans/暂存/轮询/分段缓存 | 不属于本次美业链，禁止迁入其他产品身份或全量改造 |

WorkBuddy能力映射C仅作为候选：采纳分层审计与文件授权检查；拒绝其“直接抄”、新建录音经营分析/情绪/客户记忆写入，以及凭原型新建通用队列。候选运行引用0。

## 红灯与验收

- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-asr-admission-smoke.ts` 修复前FAIL：匿名合成WAV请求200，拦截transport1（真实Provider0），期望503/transport0。没有读取客户录音或真实密钥值。
- 红灯日志：`F:/思潼AI增长os/test-environments/by47-asr-admission-offline-20260905/red.log`。
- 预期：缺少服务端授权统一明确不可执行；假Bearer/客户端tenant/store/approval/replay不能放行；不调用ASR/视觉、转码或账本，不产生伪成功/历史。
- 相邻：CSV/文本解析继续200且Provider0，正式美业元数据预检与转写证据合同不变。高风险三轮并发/重放；安全日志无文件正文、token、客户身份。

## 文件归属与保护

- 本轮：`apps/api/src/routes/media.ts`仅新增ASR准入阻断；`scripts/beauty-asr-admission-smoke.ts`新增；`package.json`仅专项接入；本卡与STATUS/TEST_MATRIX/CONTRACTS/WORKFLOW/PRE_FINAL_FOUNDATIONS/tasks README/BUG_REGRESSIONS仅相应条目。
- `media.ts`修复前已有132新增/51删除，package已有105新增/3删除；这些BY15观测/其他既有改动全部保留。BY45/46授权、存储、Schema与迁移不改，不整体提交。
- 不停止/启动任何已有运行环境、不建grant或邀请码、不部署；本轮所有transport均为注入合成响应。

## 验证与交接

- 修复：仅给共享`/media/analyze`新增音视频503准入阻断，自定义事件`media_analysis.admission_rejected`只记录stage/code/providerCalls；客户端字段不能赋予权限。现有同步ASR协议代码、其他产品adapter、视频预检和业务任务/积分合同未改。
- `pnpm.cmd beauty-industry:asr-admission-smoke` PASS：同批连续3轮，31次授权缺失阻断、9次CSV/TXT/XLSX解析，额外不支持文件415/测试multipart上限413；fake transport最终0。红灯的intercept1不是实际Provider请求。
- `pnpm.cmd beauty-industry:media-observability-smoke`、`beauty-industry:real-media-smoke`（仅合同零调用）、`beauty-industry:video-content-review-runtime-p1-smoke`、`beauty-industry:video-data-review-runtime-p1-smoke`均PASS。
- `pnpm.cmd qa:full` exit0，包含`qa:fast`（API/Web/Agent/Shared等typecheck）、`qa:regression`（已纳入本专项与BY45/46/相邻美业合同）与build全部PASS；`git diff --check` exit0。此次没有单独重复执行相同qa:fast/regression，因为已经由qa:full顺序实际执行，日志包含完整命令与结果。
- 证据根：`F:/思潼AI增长os/test-environments/by47-asr-admission-offline-20260905`，`red.log`/`green.log`/`qa-full.log`/`diff-check.log`/`git-status.txt`/`git-diff-stat.txt`。没有音频正文、密钥、客户身份或签名URL；红灯仅合成静音字节与断言。
- 精确本轮源码hash：`media.ts`=`3FBC43F867D1F9F8B63E00B6EC508B5638DD488E29ABCCAD19086776D443AC16`；专项=`7022A61C7A3E042804EAA436147C914271E68BBDD2A6666A6AE3522B45B75FEF`；package=`783D12CDD8F493E1B3F670D326230647DDC07C8F19AA83D606C16DA4642540BA`。没有runtime，不能报告source_fresh。
- 没有数据库、迁移或账本写入：该阻断位于分析/外发之前，路径没有持久任务/积分操作，因此不是“数据库ASR任务恢复验收通过”。新权限/已撤权文件、受权音频内容/长度、真实ASR4xx/部分输出/保存失败等，须有正式受权任务合同后独立验收。现有observer的合成错误/超时/取消只证明adapter行为，不代替HTTP任务级恢复。
- 无新监听/长驻进程，最终3016/5176/55434/55446均无监听；没有停止未知进程、没有grant/邀请或运行模式变化。仅短时Fastify inject实例全部close，命令会话已完成。
- Provider/外网/新增费用/业务积分均0。此安全缺口P0/P1=0，但ASR业务前置仍缺，不开放页面；所有已暂停产品状态保留。没有修复/放行整个共享视觉/PDF入口，其他产品clip-asr与其持久化也不在范围内。
- 回滚：本条安全阻断不应直接撤回恢复未授权外发；后续需有版本化服务端admission后替换，保留本红灯为门禁。无数据变更/删除需要回退。
- 下一唯一建议：清单E“手机/网页多端同源”的只读实体与版本/权限差距审计，先依据现有合同，有真实缺口才独立卡；不自动创建WebSocket/采用账本last-write-wins、不接外部WorkBuddy。ASR前置需要专门用途/数据授权，不为接力而开放。
- 无页面/DOM/路由目标变化；HTTP inject不是Chrome E2E。没有正式美业ASR页面/任务入口，本轮不新增页面或绕过先前CUA URL安全拒绝。
