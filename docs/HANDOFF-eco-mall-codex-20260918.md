# 思潼AI生态商城 · /agents 数字员工商城 — Codex 交接文档

- **生成时间**：2026-09-18
- **来源**：WorkBuddy 在 Codex worktree（`codex/sitong-ai-platform-expression`）内直接迭代，已本地预览验证
- **目的**：把本次 `/agents` 首页"商城化"重构完整交给 Codex 评审、合并与上线
- **范围**：仅前端展示层（文案 + 样式 + 路由 + 数据名），**未动**数据 / 计费 / 后端逻辑

---

## 0. 一句话任务话术（给 Codex）

> 评审并合并 `codex/sitong-ai-platform-expression` 工作树上 `/agents` 数字员工商城的本次改动；先在测试环境（api.lcppch.top 测试实例 / chat-test，免登录）跑通，确认 6 导航切换、头像弹窗行业 Tab、品牌工作台兰琪 demo 跳转、AI 课程占位、商城/商品文案一致无回归后，再走 `scripts/deploy-linux.sh` 上线。

---

## 1. 背景与目标

- 思潼AI生态商城定位：所有"AI 相关"放进一个商城——数字员工、数字咨询师、智能体、品牌工作台、AI硬件、AI课程。
- 痛点：原"智能体"用词用户看不懂、用不起来。本次把 `/agents` 首页重做成「商城货架 + 人物大图 + 极简卡片 + 详情弹窗」形态，对外表达拟人化、高职级化。
- 本次不涉及后端 SKU 数据落地；详情页在本地无后端时显示"智能体不存在或已下架"兜底，属预期行为（见 §7）。

---

## 2. 产品决策（必须保留的硬约束）

1. **数字员工 = 同岗位同脸、行业切专精皮肤**：每个岗位一个固定真人形象，切「通用 / 美业专精 / 餐饮专精」只换内容不改脸。餐饮专精暂未开放（`employeeSkuCode` 返回 `null`，按钮置灰）。
2. **数字咨询师 = 每人独立真人孪生脸**：目前先放保禄（`baolu-chief.jpg`），后续接其他咨询师。
3. **"智能体"降为内部词**：对外一律称「数字员工 / AI员工 / 岗位名」。详情弹窗、对话页不再出现"智能体"字样（后台运营侧除外）。
4. **一级导航 6 项（无二级导航）**：`数字员工 | 数字咨询师（真人孪生） | 智能体 | 品牌工作台 | AI硬件 | AI课程`。点开数字员工头像 → 弹窗内用行业 Tab 选行业（不另设专区二级导航）。
5. **"货架"→"商城"（用户侧）/ "商品"（后台运营侧）**：因导航已有"商城"，左侧品牌名去掉"生态商城"只留"思潼AI"，避免撞词。
6. **品牌工作台 = 兰琪 demo 实景**：6 张模块卡（私域营销 / 经营驾驶舱 / 门店诊断 / 内容工作室 / AI绘图 / 公域获客）+ 顶部「进入兰琪 demo 首页 ›」链接，直达 `/lanqi` 系列真实 demo 路由。
7. **AI课程 = "智能体开发课程 · 即将上线"占位**；智能体 / AI硬件 / AI课程 三个一级项目前是 `SoonShelf` 规划中占位。
8. **头像无白框**：卡片头像 `.eco-ava` 已彻底去 border / box-shadow / 描边；弹窗头像 `.eco-m-ava` 仍保留 2px 橙框（待确认是否也去，见 §7）。

---

## 3. 改动文件清单

### 新增（未跟踪）
| 文件 | 说明 |
|---|---|
| `apps/web/src/marketplace/EcoMallHomePage.tsx` | `/agents` 商城首页主组件（6 导航、卡片、弹窗、品牌工作台、SoonShelf） |
| `apps/web/src/marketplace/eco-mall-data.ts` | 8 个数字员工数据 + 行业皮肤 + skuCode 生成 + 头像路径 + 旧名→新名映射 |
| `apps/web/src/styles/eco-mall.css` | 商城全套样式（深蓝 + 橙品牌色，深浅主题通用） |
| `apps/web/public/avatars/*.png`（8 张） | 高端商务顾问真人头像：`ip-position` / `topic` / `copywriter` / `video-diag` / `live-host` / `live-coach` / `sales-coach` / `private` |

### 修改
| 文件 | 改动 |
|---|---|
| `apps/web/src/main.tsx` | +3 行：引入 `eco-mall.css`、`lazy` 引入 `EcoMallHomePage`、在 `/agents` 路由渲染 |
| `apps/web/src/marketplace/shell.tsx` | 顶栏品牌去"生态商城"只留"思潼AI"；导航"货架"→"商城" |
| `apps/web/src/marketplace/AgentDetailPage.tsx` | "‹ 返回货架"→"‹ 返回商城" |
| `apps/web/src/marketplace/AgentChatPage.tsx` | "去货架挑已上线的智能体"→"去商城挑已上线的智能体" |
| `apps/web/src/marketplace/HomePage.tsx` | "正在加载货架…"→"正在加载商城…" |
| `apps/web/src/marketplace/MyAgentsPage.tsx` | 空态"翻货架 / 去货架逛逛"→"翻商城 / 去商城逛逛"（replace_all） |
| `apps/web/src/marketplace/MinePage.tsx` | "智能体"→"AI员工 / 数字员工"措辞 + 引入 `eco-mall-data` |
| `apps/web/src/marketplace/RechargePage.tsx` | 导航"货架"→"商城"（2 处） |
| `apps/web/src/pages/LoginPage.tsx` | "货架上的行业智能体"→"商城上的行业数字员工" |
| `apps/web/src/marketplace/AdminConsolePage.tsx` | 后台"智能体与货架 / 货架概览 / 货架SKU"→"智能体与商品 / 商品概览 / 商品SKU" |

> ⚠️ 工作树里还有 `index.html`、`package.json`、`docs/agents/platform-tasks.md`、`scripts/*.mjs` 等**未提交改动**，属本分支其他在途工作，**不属本次商城功能**，上线前请单独评审，勿一并带入本次提交。

---

## 4. 8 个数字员工（最终命名 + 状态）

| key | 角色（对外名） | 头像 | skuCode 格式 | 状态 |
|---|---|---|---|---|
| `ip-position` | 首席定位官 | `ip-position.png` | `ipzone__ip-pos` / `meiye__ip-pos` | ok |
| `topic` | 选题策略官 | `topic.png` | `ipzone__topic` / `meiye__topic` | dev |
| `copywriter` | 金牌文案主笔 | `copywriter.png` | `ipzone__copy` / `meiye__copy` | ok |
| `video-diag` | 流量诊断官 | `video-diag.png` | `ipzone__vidrev` / `meiye__vidrev` | ok |
| `live-host` | 直播操盘总监 | `live-host.png` | `ipzone__livescript` / `meiye__livescript` | dev |
| `live-coach` | 直播复盘导师 | `live-coach.png` | `ipzone__liverev` / `meiye__liverev` | dev |
| `sales-coach` | 首席成交官 | `sales-coach.png` | `ipzone__sales` / `meiye__sales` | dev |
| `private` | 私域增长顾问 | `private.png` | `ipzone__moments` / `meiye__moments` | dev |

数字咨询师：`baolu`（保禄真人孪生，`baolu-chief.jpg`，status dev）。

skuCode 生成规则见 `eco-mall-data.ts` 的 `employeeSkuCode`：`餐饮专精` 返回 `null`；其余 `通用`→`ipzone__<capability>`，`美业专精`→`meiye__<capability>`。

---

## 5. 验证结果（本地预览 http://127.0.0.1:5174/agents）

- 6 个一级导航逐项点击：无 vite 报错、无白屏。
- 点数字员工头像 → 弹窗正常弹出，行业 Tab（通用 / 美业专精 / 餐饮专精）在弹窗内切换。
- 品牌工作台 → 6 张兰琪 demo 模块卡渲染正常，「进入兰琪 demo 首页 ›」链接 `href=/lanqi`。
- AI课程 → 标题"智能体开发课程 · 即将上线"正确。
- 头像白框：卡片头像已无边框（computed style 实测 `border:0 / box-shadow:none / outline:none`）；弹窗头像保留 2px 橙框。
- dev server 编译通过（HMR 实时热更，无 TS 编译错误）。

---

## 6. 上线 Runbook（铁律：先测试环境，后生产；用户已确认上线）

> 本沙箱无法直连阿里云 ECS，server 端 `scripts/deploy-linux.sh` 需由 Codex / 运维在服务器侧执行。

1. **提交**：将 §3「新增 + 修改」文件作为一次 `feat` 提交（已含本次改动）。
2. **推送**：推到 `codex/sitong-ai-platform-expression`。
3. **测试环境**：在 api.lcppch.top 测试实例（免登录）打开 `/agents`，按 §5 checklist 回归。
4. **生产部署（服务器侧）**：
   ```bash
   APP_DIR=/opt/Sitong-os-v2 \
   ENV_FILE=/etc/Sitong-secrets/Sitong-os-v2.env \
   SERVICE_NAME=Sitong-os-v2 \
   bash scripts/deploy-linux.sh
   ```
   部署后：`curl http://127.0.0.1:3002/ready` 应全绿；`/ready` 会校验生产配置、数据库、DeepSeek。
5. **静态资源部署检查**会拦截海外模型域名（`DOMESTIC_NETWORK_ONLY=true` 不可关），上线前务必：
   ```bash
   pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
   ```

---

## 7. 已知遗留 / 待确认（务必在 PR 里跟进）

- 智能体 / AI硬件 / AI课程 三个一级项是 `SoonShelf` 占位，待保禄确认放什么内容（智能体放哪些 SKU）。
- 弹窗头像 `.eco-m-ava` 的 2px 橙框是否也去掉（卡片已去）。
- 品牌工作台顶部未加"演示数据"小标注，避免与外部真实客户数据混淆（保禄未确认）。
- 兰琪 demo 链接目前用站内 `/lanqi`（本地免登录实例能直接进）；若发布后需指向已上线外部 demo 真实 URL，待保禄提供。
- 详情页落地依赖后端 `/market/skus/:skuCode`：本地无后端时显示"智能体不存在或已下架"兜底——这是预期行为（测试 / 生产环境有真实 SKU 数据即正常），非 bug。
- 后台"商品"命名是否统一（保禄未最终确认，可回退"货架"）。

---

## 8. 验收口径（PR 合并前）

- [ ] 6 导航切换无报错
- [x] 数字员工卡片 = 头像 + 名字（2026-09-21 补齐「岗位名 + 人名」，见 §9），点开弹窗含行业 Tab
- [ ] 品牌工作台 6 模块卡 + demo 首页链接可达
- [ ] AI课程占位文案正确
- [ ] 全站"货架"已无残留（用户侧 = 商城，后台 = 商品）
- [ ] 头像无白框（卡片）；弹窗橙框按决策处理
- [ ] 类型检查 / 构建通过；`/ready` 全绿

---

## 9. 数字员工人名（2026-09-21 用户口径：每个数字员工要有自己的名字，不能都叫「思潼」；按岗位起名，不要都叫「思什么」）

此前卡片只有岗位名（首席定位官…）、详情页和对话页只有智能体名，用户侧看不出「这是谁」。现在
三个入口共用同一张人名表 `apps/web/src/marketplace/employee-names.ts`，按能力核（`capability`）取名：

| 能力核 | 岗位名（对外） | 人名 | 名字里的岗位关键字 |
|---|---|---|---|
| `ip-pos` | 首席定位官 | 沈定 | 定（定位） |
| `topic` | 选题策略官 | 何策 | 策（策略） |
| `copy` | 金牌文案主笔 | 秦文 | 文（文案） |
| `vidrev` | 流量诊断官 | 江流 | 流（流量） |
| `livescript` | 直播操盘总监 | 罗盘 | 盘（操盘） |
| `liverev` | 直播复盘导师 | 许复 | 复（复盘） |
| `sales` | 首席成交官 | 易成 | 成（成交） |
| `moments` | 私域增长顾问 | 周域 | 域（私域） |

起名规则：常见单字姓（8 个互不重复）+ 岗位关键字各取一个字；名字里**不带品牌字「思」**，
避免人名和品牌名「思潼」混在一起。契约测试会拦住「又改回思某」和「重名」。

- 商城卡片：岗位名下方加人名名牌（`.eco-name`），点开弹窗的标签是「AI 数字员工 · 人名 · 皮肤」。
- 智能体详情页：标题为「人名 · 智能体名」（如「沈定 · IP定位智能体」）。
- 对话页：页头 / 页签标题 / AI 气泡标签 / 头像 `alt` 都用该人名；开场欢迎语同步为「你好，我是沈定 · IP 定位智能体…」。
- **对话页头像 = 这个员工自己的形象（2026-09-21 第二轮用户口径）**：页头与每条 AI 气泡的头像**不再一律用品牌形象「思潼」**，改成该数字员工的形象。
  映射只写一处：`eco-mall-data.ts` 的 `EMPLOYEE_AVATAR_BY_CAPABILITY` + `employeeAvatarPath(skuCodeOrCapability)`（未知 / 套装 `ip-pack` 返回 `null`），`EMPLOYEE_IMAGE_PATHS` 由它派生——商城卡片、弹窗、对话页共用同一张「能力核 → 形象」表。
  `AgentChatPage.tsx` 用 `employeeAvatarPath(sku?.skuCode ?? skuId) ?? sitongAvatar`，6 处 `chat-avatar-img` 全部改用该值，品牌形象只作套装兜底。
  形象图在 `apps/web/public/avatars/`（`ip-position / topic / copywriter / video-diag / live-host / live-coach / sales-coach / private`，各 1.3–1.5MB，属于**已入库**资产）。
  路径必须经 `lib/api.ts` 的 `getPublicAssetPath()` 拼 `BASE_URL`：生产 base 是 `/os-v2/`，裸写 `/avatars/*.png` 会打到域名根目录 404。
- **专区名 = 餐饮 / 美业 / 通用行业（没有「创始人IP专区」）**：发布文件 `marketplace-v3.json` 的 `industries.ipzone.title` 已改为「通用行业」，`key` / 路由 `ipzone` 不动（已发出的链接不失效）。
  专区展示名以**发布文件**为准：库里 `marketplace_industry_profile` 的 `title` / `tag` 从此只是留档，改这两列不生效（见 `docs/BUG_REGRESSIONS.md` QA-20260921-001）。
  改名不降搜索：`ipzone` 带 `searchAlias`（`创始人IP / 个人IP / 老板IP / IP获客 / IP增长`），只进 SKU 关键词、不进详情页标签。
- 套装 `ip-pack` 是 7 大能力的入口、不是某一个人，仍用品牌名「思潼」，代码里显式回退。

> 人名已按保禄 2026-09-21「按岗位起名」的口径定稿（第一版「思衡/思敏/…」因都带品牌字「思」被否）。
> 再改名只需动 `employee-names.ts` 一张表和 `apps/api/src/data/marketplace-v3.json` 里 16 条专区欢迎语（本文件 §4 的岗位名不动）。
