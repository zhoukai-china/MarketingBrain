# BY-48 Word导出创建者授权隔离

状态：已完成 / idle（2026-09-05，清单F既有共享导出技术安全子范围；不放行产品页面）

## 归属与唯一用户结果

- 美业任务含公共平台安全子改动，高风险，仅此任务串行。用户自己的临时Word文件不能被同租户其他人下载或消耗；创建和下载均验证会话及当前成员权限。
- 不恢复XHS/经营问答/BY19/20/43/BY44外部接入，不新增报表、指标、模板或Skill，不扩大授权，不调用Provider、不部署、不创建邀请码。
- 已有调用：内容系统、通用内容工作区及聊天结果先POST content/title再携带原headers GET blob。现有10分钟/一次下载/无持久导出作业保持，不把临时Map当跨实例持久化。

## 红灯与验收条件

- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/export-owner-isolation-smoke.ts`修复前FAIL：真实注册Fastify handler、真实签名会话校验、仅membership存储替换为合成fixture；同租户另一user GET=200且返回DOCX，期望404。无网络/客户文档/真实DB写入。证据`F:/思潼AI增长os/test-environments/by48-export-owner-offline-20260905/red.log`。
- 根因：ExportRecord只绑定tenantId；下载检查tenant后即删除，没有user边界。route直接resolveRequestContext，未独立要求签名会话；unsigned身份header可进入该共享resolver。后者用专项阻断验证，不扩大修改整个resolver。
- 三轮：owner正常文件、同租户非owner404/异租户403且不消耗原文件；缺失/伪造/过期token401且DB查询0；撤权403、DB故障503，故障不泄密/不吞成成功；重复下载只有一次200，其余404；TTL/空输入/文件名/Content-Type/私有缓存。
- 实际产品生成的合成Word必须渲染查看；不改变版式以迎合通用文档模板，不用XML存在性冒充视觉PASS。

## 精确文件归属与保护

- `apps/api/src/routes/exports.ts`：本轮只新增会话准入、userId归属与安全响应。原有未提交tenant隔离10新增/1删除保留，品牌/解析/版式不改。
- `scripts/export-owner-isolation-smoke.ts`：新回归，合成数据，不落token/正文日志。
- `package.json`：只增加专项并接入qa:regression，既有所有脚本保留。
- 本卡及STATUS/TEST_MATRIX/tasks README/BUG_REGRESSIONS/CONTRACTS/PRE_FINAL只更新对应条目；不整体提交其他改动。

## 验证与交接

- `pnpm.cmd export:owner-isolation-smoke`（同等直接tsx命令）三轮PASS；正式注册HTTP handler/签名token/数据库context resolver，membership存储为合成端口，无真实PG。跨用户404、跨租户403均不能消耗owner文件；匿名/假token/过期401在DB之前，撤权403与DB故障503后owner可恢复下载；并发仅一份200/一份404，10分钟过期404，私有no-store与中文附件名正常。
- `pnpm.cmd branding:smoke`、`pnpm.cmd delivery:smoke` PASS。`pnpm.cmd qa:full` exit0，实际包含qa:fast（全仓API/Web/Agent/Shared等typecheck）、qa:regression（含新增导出专项与相邻领域）及build；没有把未执行的独立命令写为额外PASS。`git diff --check` exit0。
- 真实产品handler下载合成Word=11473 bytes，SHA256=`63BC29AB9CD118017CC82208299EB4EB07CE519D490204D492061A7759A16156`。本机WPS 12.1.0.28505实际打开1/1页，在160%及100%查看中文、章节、表格与页眉页脚，无缺字、重叠或截断；没有修改源DOCX，关闭后hash仍一致。只查看本轮合成文件，未上传/云转换/AI排版。
- 文档技能标准`render_docx.py`已尝试，因本机未安装可执行soffice而WinError2，未产出规范page PNG/PDF；以现有WPS只读实际渲染补足本轮视觉检查，不能宣称LibreOffice兼容回归PASS。原版式/页长不改；复杂长表、分页、大文件排版没有在本轮全覆盖。
- 没有页面/DOM/下载调用方变化；既有前端POST/GET均传原认证headers并将blob本地下载。没有启动Chrome1440/390或旧产品环境；HTTP注入与WPS检查不冒充浏览器端到端。没有建立跨实例导出持久化，临时Map/进程重启后需重新导出是现有边界，保存的业务正文不改。
- 所有证据在`F:/思潼AI增长os/test-environments/by48-export-owner-offline-20260905`：red.log、green.log、qa-full.log、diff-check.log、git-status-before.txt、git-diff-before.txt及合成Word。正文仅合成fixture/测试文件，不进业务日志；错误事件仅event/code，不记录token/DB错误正文。文档工具截图只在工具结果中查看，不保留无关桌面内容。
- 源码hash：exports.ts=`A2F2AB055EC831512842367DE53EC589F739E140A67BAD249B9B71D63F969073`；专项=`F56025C4FCBC5E02A32A997DC4DC4B5ACBF9407830F476D5456FDFE95B776321`；package.json=`07AF506DFFB37A37133E916850C29B5E54FF4420FE719C36934B122DBDD8B823`。
- Provider/业务外网/积分/费用/真实DB写入均0；没有API/Web/PG runtime，不声明source_fresh。最终3016/5176/55434/55446无监听；Fastify实例close、qa命令完成，本轮WPS文档窗口已关闭。WPS原生后台进程不强杀、不视为受控API环境。
- 此权限P1关闭，范围P0/P1=0；标准LibreOffice渲染工具缺失如上单列。全部暂停项保持原状，不创建用户邀请码/不称产品可测试。共享其他路由身份机制不在本项放行范围。
- 无Schema/账本/持久数据变化；旧无owner记录必须失败关闭，不能为兼容匿名下载回退。
- 回滚：仅本卡标记的exports局部hunks可独立回退，但不能恢复已证实的越权路径；紧急回滚应禁用导出入口。既有tenant隔离、其他脏改与合成审计文件保留，不删除/整体提交。
- 下一步：见PRE_FINAL_FOUNDATIONS四类收口。未证实新的可直接编码缺口，不为填满清单造报表/云driver；建议停止本轮先行开发并等原型/明确云存储合同与外部验收窗口，不自动接续。
