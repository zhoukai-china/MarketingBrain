# BY-40 XHS 必填资料提交前提示 P1

状态：已完成

## 归属

- 产品：美业智能体
- 层级：产品任务含 Web / WorkBuddy 共用服务端合同
- 风险：中
- 预计修改热点：XHS 本次任务快照、提交前资料校验、工作台字段提示、错误映射与浏览器回归
- 是否允许并行：否

## 用户结果

用户在生成小红书文案前能看见并补齐真正必需的本次主题、项目和目标顾客；缺失时系统逐项提示且不会调用模型或预留积分。

## 本次范围

- 以 2026-08-31 用户真实失败的脱敏运行证据建立红灯。
- 经营档案允许提供项目/目标顾客默认值；本次页面可覆盖，且不回写长期档案。
- Web 与 WorkBuddy 共用服务端提交前校验；任务事实清单与持久化任务快照使用同一有效事实源。
- 城市、门店事实、内容角度、语气、视觉要求、补充事实和禁用内容保持选填。

## 本次不做

- 不放宽正式 Schema/Eval、事实保留、矛盾、污染或合规门禁。
- 不调用文本、图片、视频或 ASR Provider；费用必须为 ¥0。
- 不恢复 BY-19/BY-20，不部署生产。

## 验收条件

1. 正常路径：主题、项目和目标顾客由本次字段或经营档案补齐后，可进入既有固定 XHS 链；事实清单与任务快照一致。
2. 失败路径：任一必填项缺失时，Web 逐项显示缺什么；API/WorkBuddy 返回 422 preflight，Provider、AgentRun、积分预留均为 0。
3. 不应发生：不得要求填写城市、门店、价格、疗效、案例或图片要求；不得从自由文本改路由或把本次字段写回经营档案。
4. 可观测结果事件：只记录缺失字段键、固定 capability/Skill 和 preflight 终态，不记录客户原文或 Prompt。

## 基线与失败证据

- 真实脱敏证据：固定 `beauty_xiaohongshu_package / acquisition:xhs / wechat-xhs-content-line@1.0.3`；请求参数只有 `questionPresent=true/questionBytes=48/professionalOptionKeys=[imageCount]`。Provider `finish=stop`、结构适配 3 标题/7 标签/3 配图方向成功，随后被 `rubric_fact_retention_weak` 拒绝；AgentRun=0，8 积分一次预留一次释放、净 0。
- 根因：Web 只校验主题长度且不标必填；服务端任务快照可回退经营档案，但事实清单只读取本次 professionalOptions/自由文本，两套事实源不一致，导致缺失资料仍进入付费链并可能在保存前被事实门禁拒绝。
- 修复前红灯：`pnpm.cmd beauty-industry:xhs-input-preflight-p1-smoke`。

## 实现记录

- 新增统一 `BeautyXhsTaskReadiness`：真正必需项固定为本次主题与目的、本次项目/服务、目标顾客。项目与顾客允许由当前租户已确认经营档案提供默认值，本次页面字段优先覆盖；城市、门店事实、角度、语气、视觉、补充事实和禁用内容继续选填。
- Web 在提交前逐项标红并显示“还不能生成文案”，缺失时禁用主按钮；补齐后恢复既有固定生成路径。页面不会把本次编辑写回经营档案。
- API/WorkBuddy 共用执行层在任何积分预留和 Provider 调用前执行同一 preflight；HTTP 返回 `422/beauty_xhs_information_required` 和精确 `missingFields`。任务事实清单与持久化快照改用同一有效项目/顾客来源，消除档案默认值与事实门禁不一致。
- 既有固定 route、Skill 1.0.3、Schema/Eval、事实/矛盾/污染/合规、账本、幂等和租户边界均未放宽。
- 文件归属：`xhs-task-snapshot.ts`、`execution.ts`、`beauty-industry.ts` 为通用美业服务端合同；`BeautyXhsWorkbench.tsx`、`BeautyIndustryAcquisitionPage.tsx`、`beauty-industry.css` 为通用美业 Web；两个 smoke、`package.json` 与本任务文档为回归/交接。未修改兰琪知识包、品牌事实或正式 Skill。

## 验证

- 红灯：新增专项在修复前稳定报 `assessBeautyXhsTaskReadiness is not a function`；真实 2026-08-31 脱敏运行证明只传主题和 `imageCount` 时仍发生一次 DeepSeek 调用，最终 `rubric_fact_retention_weak`、AgentRun=0、8积分净0。
- 绿灯：`pnpm.cmd beauty-industry:xhs-input-preflight-p1-smoke` PASS；运行时缺项目/顾客时 Provider 调用0。真实 API 返回422并列出“本次项目、目标顾客”，该合成租户 AgentRun=0、CreditReservation=0。
- 相邻：XHS fact-retention/provider-structure/customer-delivery/workbench、fixed-route、user-path专项全部PASS；固定路由错误输出夹具补齐合法前置资料后继续验证输出合同拒绝。
- 页面：`node scripts/beauty-industry-local-entry-auth-browser-e2e.mjs` PASS，真实 Chromium 1440/390px覆盖三项缺失提示、按钮禁用、补齐后启用、刷新/任务中心返回、双租户、overflow0、console/网络0，业务提交0、Provider0。
- 工程：API/Web/Agent typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含build）、`git diff --check`全部PASS。
- 环境：PG55434/PID10296、API3016/PID18312、Web5176/PID4632；source/runtime=`4A8B91E5`、fresh/ready/database=true；text configured，media disabled/max0。本任务未调用 Provider，费用¥0。

## 交接

- 残余风险：范围内P0/P1=0。
- 后续任务：仅本任务收口；BY-19/BY-20 继续 PAUSED。
- 最后更新日期：2026-08-31。
