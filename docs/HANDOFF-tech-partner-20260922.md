# 交接文档：思潼 AI 增长 OS（baolu-os-v2）— 2026-09-22

> 交接人：原开发（AI 辅助开发，本人不再写代码）
> 接手人：北京技术合伙人
> 本文档 = 当前系统状态 + 已上线内容 + 在途分支 + 发布纪律 + 运维手册入口。读完即可接手。

---

## 一、系统全景（5 分钟版）

- **服务器**：阿里云 `39.96.80.54`（admin 用户，SSH key 在原开发者本机 `C:\Users\book\.ssh\sales_copilot_20260618`，请更换为你的凭据）
- **生产**：`/opt/baolu-os-v2`，systemd 服务 `baolu-os-v2.service`（Node API，端口 3002）
- **测试**：`/opt/baolu-os-v2-test`，`baolu-os-v2-test.service`（端口 3010）
- **双入口前端**（必须同步发布，缺一会白屏/回退）：
  - `https://api.lcppch.top/os-v2/` → `/opt/baolu-os-v2/apps/web/dist`（构建脚本 `scripts/build-os-v2-web.sh`）
  - `https://ai.lcppch.top/` → `/opt/baolu-os-v2/apps/web/dist-ai-root`（构建脚本 `scripts/build-ai-root.sh`）
  - 两脚本均为「临时目录构建 → `cp -rn` 叠加发布（保留旧 chunk，不白屏在途用户）→ 自检」
- **nginx**：`/etc/nginx/conf.d/qiwx-bot.conf`（api.lcppch.top）+ `/etc/nginx/conf.d/ai.lcppch.top.conf`（ai.lcppch.top）+ `/etc/nginx/snippets/*.conf`（各测试实例）。改完必须 `sudo nginx -t` 再 `sudo nginx -s reload`。
- **本地代码**：`F:\思潼AI增长os\baolu-os-v2-source\`（Windows 工作区，注意 LF/CRLF：上传前文本需归一为 LF）
- **部署台账（必读）**：`docs/CURRENT_DEPLOYMENT_STATUS.md`——每次发布都有记录、备份路径、回滚方法。**从最上面往下读就是一部部署史。**

## 二、2026-09-22 已上线内容（今天全部完成，均已验收）

| 发布标记 | 环境 | 内容 |
|---|---|---|
| `20260922-ls-layout-test1` | lanqi-test | 直播话术排版升级（结构化卡片渲染） |
| `20260922-ls-layout-prod1` | 生产双入口 | 同上排版升级上生产 |
| `20260922-ls-timeout-prod1` | 生产双入口 + nginx | **直播话术 150s 超时 bug 修复**：前端等待 25 分钟、超时友好文案、每 30s 轮询 `/market/me/deliverables` 自动找回交付（45 分钟硬上限）、502/503/504 专属提示、settled 去重；nginx 为 4 个 API 入口的 `market/skus/{code}/run` 路由加 1800s regex location（其余接口仍 120s） |
| `20260922-footer-oneline` | 生产双入口 + lanqi-test | 页脚「思潼 AI 行业智能体平台 + 辽ICP备2025069273号」由两行合并为单行（仅 `index.html` 静态改动，入口 JS 未变） |

验收方式与结果见台账顶部条目。备份均在 `/opt/baolu-backups/<发布标记>-before-<目录>/`。

**本地 = 生产**：`AgentChatPage.tsx` 已同步（sha256 `d53a6e7d…`，93,330 字节）。

## 三、当前三方漂移状态（本地 / lanqi-test / 生产）

核心纪律：**`AgentChatPage.tsx` 不在 git 上，服务器是事实源**。该文件历史上被并行发布回灌过 3 次，任何发布前必须逐字节比对三方差异，「现网文件为基线 + 定向补丁」，绝不整文件覆盖。

### 3.1 AgentChatPage.tsx（本次发布后）
- 本地 == 生产（`d53a6e7d…`）
- lanqi-test 版 = 生产 + **B 组 14 处头像改动**（agentAvatar / marketplaceAgentAvatar，测试版独有的智能体头像功能）——在途功能，未上线，是否上生产由你决策。

### 3.2 其他已知漂移（h1 盘点结论，未处理，非本次范围）
- **本地独有/与生产不同的前端文件**：`main.tsx`、`AgentDetailPage.tsx`、`chat-flows.ts`、`eco-mall-data.ts`、`HomePage.tsx`、`MinePage.tsx`、`shell.tsx`、`RechargePage.tsx`
- **本地缺失**：`apps/web/src/lib/pending-partner.ts`（仅存在于测试实例）
- **生产独有**：`employee-names.ts`
- **lanqi-test 在途分支（market-partner 市场合伙人功能）**：4 个 API service + `pending-partner.ts` + `waimai-growth/contract.json` + 多个前端文件差异。**不属于已上线内容**，是否继续开发/上线由你决策。
- 处理建议：接手后第一件事 `sha256sum` 三方全量比对建基线，把关键文件纳入 git 管理，终结「服务器为事实源」的漂移模式。

## 四、发布纪律（血泪教训，务必遵守）

1. **双入口必须同步发布**：`build-os-v2-web.sh` 和 `build-ai-root.sh` 都要跑。
2. **发布前**：`sha256sum` 比对本地 vs 生产目标文件；不一致时以现网为基线做定向补丁（参考 `scripts/tmp/stage-release.mjs` 的「回填生产版」逻辑）。
3. **上传前**：Windows 文本归一 LF（BOM 去除）。
4. **发布后断言**：线上 MarketplaceApp chunk 必须命中「重新开始」等纪律标记（防止发错版本）；验收用 `curl -o 文件 + grep -c 文件`，**不要用 bash 变量 `grep -q` 中文（有假阴性 bug）**。
5. **API 改动**：走 `/tmp/deploy-release.sh` 标准发布脚本（服务器上有），含构建、重启、健康检查。
6. **nginx 改动**：改前备份 conf，`nginx -t` 过了才 reload；regex location 的 `proxy_pass` 不能带字面 URI，用捕获组 `$1`（本次 run 路由补丁是现成范例）。
7. **每次发布写台账**：`docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部插入，含备份路径与回滚步骤。

## 五、常用命令速查

```bash
# SSH
ssh -i <你的key> admin@39.96.80.54

# 前端发布（生产双入口）
cd /opt/baolu-os-v2 && sudo bash scripts/build-os-v2-web.sh
cd /opt/baolu-os-v2 && sudo bash scripts/build-ai-root.sh

# API 服务
sudo systemctl status baolu-os-v2        # 生产（3002）
sudo systemctl status baolu-os-v2-test   # 测试（3010）

# 健康检查
curl -s https://api.lcppch.top/os-v2/api/health
curl -s https://ai.lcppch.top/api/health

# 回滚（以本次为例）
# 1) 还原源文件：/opt/baolu-backups/20260922-ls-timeout-prod1-before-baolu-os-v2/src-original/
# 2) 还原 dist：解包同目录 web-dist.tgz / web-dist-ai-root.tgz（或重跑构建脚本）
# 3) 还原 nginx：cp 同目录两份 conf 回 /etc/nginx/conf.d/ && nginx -t && nginx -s reload
```

## 六、直播话术智能体（本次修复对象）要点

- 入口：`https://ai.lcppch.top/agent/ipzone__livescript/chat`（生产）
- 生成链路：前端 `POST /market/skus/ipzone__livescript/run` → 后端串行 9 段 + 4 附属件共 10 次模型调用 → 实测 5-10 分钟
- 超时配置三处联动（改任一都要核对另两处）：
  - 前端：`AgentChatPage.tsx` 的 `LIVESCRIPT_RUN_TIMEOUT_MS = 1_500_000`（25 分钟）
  - nginx：run 路由 regex location `proxy_read_timeout 1800s`（4 个入口）
  - 后端：无 per-route 超时限制（靠 nginx 兜底）
- 找回机制：前端每 30s 查 `GET /market/me/deliverables?skuCode=...`，45 分钟硬上限
- 排版渲染：`renderLiveScriptHtml()`（AgentChatPage.tsx 约 1665 行起）+ `sitong-design.css` 的 `ls-*` 样式块（约 626-662 行）

## 七、选题策略官（新智能体）— 设计定稿，待开发

**原型（视觉 + 交互稿，已完成并经老板逐条确认）**：
`docs/prototypes/topic-strategist-demo-20260922.html` — 单文件 HTML，浏览器直接打开即可，含「动态演示模型」面板（约 20 秒自动播放完整运行流程）。

**已敲定的产品决策（以原型 v0.4 为准，勿再改动方向）**：
- 定位：每天自动给用户产出 10 条可拍选题，带证据状态 + 创作建议
- 四大来源（每个来源都有用户配置区，交互见原型）：
  1. 私有知识库 = 大脑笔记（记录工作生活日常：客户往来/成交案例/心得灵感/评论私信/销售客服记录）
  2. 行业热点 —— **后台只抓抖音**（前端文案不强调平台）
  3. 对标账号 —— 用户粘贴**抖音账号主页链接**，检索该号近期动态
  4. 数据复盘 —— 用户上传抖音/视频号视频数据，由「视频数据复盘智能体」分析，**本模块只取推荐选题，不显示复盘报告等其他内容**
  - 另支持用户自填选题入池
- 三关筛选**全程自动完成，无需用户配置**：①一票否决（来源证据/500赞+）②贴标签（人性/时代/利益/热点/专业）③按账号阶段配比（起号/增长/变现三套）
- **缺源降级不阻塞**：任一来源缺失/关闭时配额自动重分配，选题照常生成，缺口如实标注

**技术可行性结论（已调研）**：
- 抖音/视频号官方均无站内内容搜索 API。行业热点可行方案：网页聚合 + 抖音热榜/巨量算数公开数据；对标账号取数需第三方数据服务（飞瓜/新抖/蝉妈妈，按账号付费）或用户自助提供——这是本智能体唯一的重大外部依赖，开发前先做选型验证
- 建议复用现有智能体框架注册为 `ipzone__topic`，头像 `https://ai.lcppch.top/avatars/topic.png`（原型 hero 已内嵌同图）

**下一步**：按原型实现真实智能体（来源采集 → 候选池 → 三关 → 交付），交互与视觉以原型为验收基准。

## 八、待办建议（优先级排序）

1. **建 git 基线**：把服务器生产目录全量拉回，与本地合并去漂移，纳入版本控制（当前 AgentChatPage.tsx 等关键文件不在 git 上，是最大风险点）。
2. **实现选题策略官**（见第七节，设计已定稿）。
3. **决策 lanqi-test 在途分支**：market-partner（市场合伙人）功能是否继续；B 组头像改动是否上生产。
4. **更换服务器凭据**：SSH key 曾在原开发者本机，交接后应轮换。
5. 日常开发参考 `docs/DEVELOPMENT.md`、`docs/ALIYUN_DEPLOYMENT.md`、`docs/PARALLEL_DEVELOPMENT.md`。
