# 交接文档：市场合伙人管理后台开发 — 2026-09-23

> 交接人：思潼AI（产品侧，设计原型已完成）
> 接手人：北京技术合伙人
> 一句话需求：给思潼AI商城配套做一个**独立的市场合伙人管理后台**——合伙人生成专属推广链接，通过链接注册的用户永久归属该合伙人，其积分充值 / 积分消耗 / 月度订阅按 **20%** 计佣，AI 硬件 / AI 课程预留分佣（比例待定、每商品独立配置），合伙人可查看客户与佣金明细并**自主提现**。
> **UI 一律以原型 demo 为准**：`docs/prototypes/market-partner-admin-demo-20260923.html`（自包含单文件，双击可开，浏览器实测 9 项交互全部通过）。

---

## 一、用户已拍板的产品口径（2026-09-23，不要改）

| # | 口径 | 内容 |
|---|---|---|
| 1 | 计佣范围 | 智能体相关消费：**积分充值、积分消耗、月度订阅**，当前统一 **20%** |
| 2 | 比例粒度 | **每个商品的分佣比例独立配置**（未来可能各不相同），比例配置表按「商品 SKU」维度设计，不要只按能力维度 |
| 3 | AI 硬件 / AI 课程 | 分佣比例**待定**，先留位；商城 F3（AI 硬件）/ F4（AI 课程）楼层已是占位状态，商品上架后合伙人端「分佣产品」卡自动点亮，无需合伙人操作 |
| 4 | 归属规则 | 通过合伙人链接注册即**永久归属**（首触归因，之后点别人的链接不变更归属） |
| 5 | 合伙人身份 | 统一显示「**思潼AI市场合伙人**」，**暂不做分级**（无金牌/战略等级、无升级进度条），首版比例固定 20% |
| 6 | 提现 | 合伙人**自主提现**（原型口径：满 ¥100 可提、1-3 个工作日审核打款、微信零钱/支付宝/银行卡，可调整） |
| 7 | 数据合规 | 合伙人端只看**脱敏**客户信息（如「美**姐」「138****2261」），不下发完整手机号、聊天内容、工作文件 |
| 8 | 入账口径建议 | 原型按「实际消费计佣、退款扣回」设计；充值未消耗部分不计佣，防退款刷单。若你评估按充值计佣更合理，先和老板确认再动 |

## 二、原型文件（UI 与交互的验收基准）

- 路径：`docs/prototypes/market-partner-admin-demo-20260923.html`
- 自包含单文件、无外部依赖，双击打开即可，也可微信直接发给任何人看。
- 已在浏览器实测通过的交互（可直接当验收脚本用）：
  1. 五个页签切换（工作台/推广/客户/佣金/我的），移动端底部 tab + ≥900px 桌面侧边栏自动切换；
  2. 推广页：专属链接 `https://ai.lcppch.top/r/LQ8888` 一键复制（toast）、示意二维码、4 条渠道链接（朋友圈/抖音简介/社群/线下物料，各带点击/注册/转化率）、**新建渠道**即增一行；
  3. 客户页：脱敏列表 + 活跃/沉睡筛选 + 点行开详情弹窗（充值/消耗/订阅/贡献佣金四方块 + 时间线）；
  4. 佣金页：12 条明细（订单号、基数 × 20% = 佣金、待结算/已入账）、按类型筛选、AI 硬件/AI 课程为锁定空态、计佣规则卡；
  5. 提现：< ¥100 红字拦截；提交后记录顶部插入「审核中」一条、可提现余额联动减少（¥1,288.60 → ¥1,088.60）、toast 反馈。
- 页面内所有数字均为演示数据，顶部有「原型演示」标注，上线版本接真实接口后移除该标注条。

## 三、原型页面 → 功能需求对照

| 原型页签 | 需实现的后台功能 |
|---|---|
| 工作台 | 余额总览（可提现/提现中/本月佣金/待结算）、4 指标卡（累计客户/累计佣金/本月计佣流水/客户转化率）、近 14 天佣金趋势（按日聚合佣金）、分佣产品卡（含比例与上线状态）、实时动态（注册/入账事件流） |
| 推广链接 | 专属推广链接 + 二维码 + 海报（海报可后置）、**多渠道子链接**（每渠道独立短码，独立统计点击/注册/转化）、新建/禁用渠道 |
| 我的客户 | 归属客户列表（脱敏、搜索、分页、按活跃/沉睡/渠道筛选）、客户详情（充值/消耗/订阅/贡献佣金/归因时间线） |
| 佣金明细 | 佣金流水列表（可追溯订单号、基数、比例、金额、状态）、按类型筛选（积分消耗/月度订阅/AI硬件/AI课程）、计佣规则展示 |
| 我的 | 合伙人资料、提现管理（余额、提现记录、申请提现弹窗）、收款方式管理、规则/联系运营入口 |

## 四、现有代码资产（务必复用，不要重造）

以下均为当前源码 `baolu-os-v2-source` 中已存在的内容：

1. **归因链路**
   - `packages/db/prisma/schema.prisma` 已有 `ReferralCode` / `ReferralBinding`（推荐码 + 绑定关系）；
   - `MarketPartnerGrant` 表已存在（`userId` 主键 + `grantedBy`），合伙人身份授权表；迁移见 `packages/db/prisma/migrations/202609180001_market_partner_grant/`。
   - 建议：推广链接 `/r/:code` 落地商城首页并写入推广码 → 注册时写绑定；签发推广码时校验 owner 持有 `MarketPartnerGrant`。
2. **分佣计算**
   - `apps/api/src/services/billing-cost-model.ts` 已预留 `PARTNER_SHARE_PERCENT`（当前全 `null` 待拍板）与 `splitPartnerShare()`：`partnerCredits = round(chargedCredits × percent ÷ 100)`。
   - 积分定价唯一事实源：`packages/shared` 的 `CREDIT_PRICING`（**1 元 = 20 积分，即 ¥0.05/积分**）。
   - 本次拍板后：智能体相关 SKU 的比例填 20；因要求「每商品独立比例」，建议把配置从「按能力 Record<BillingCapability, number|null>」扩展为「按商品 SKU」的表（如 `PartnerShareRule`），`splitPartnerShare` 改为查表 + 能力表兜底。
3. **消费流水（计佣事件源）**
   - 钱包双桶：`Wallet` / `WalletLedger`（充值、消耗、订阅相关流水都在）；商城计费流水另有 `marketplaceLedgerEntry`（`ppu_consume` 等，见 `apps/api/src/routes/admin.ts` 的聚合用法）。
   - 订阅：`RechargeOrder`（充值订单）+ 现有订阅计费链路（`/market` 货架、`marketplace.ts`）。
4. **商城楼层占位**
   - 商城 F3（AI 硬件）/ F4（AI 课程）已上线占位楼层（`20260922-mall-v3`），商品上架后按 SKU 比例自动进分佣。

## 五、需要新增 / 开发的内容（建议清单，实现细节由你定）

### 5.1 数据模型（Prisma 新表）

```text
PartnerShareRule     商品维度分佣比例：skuId、ratePercent、effectiveFrom、enabled
PartnerCommission    佣金流水：partnerId、customerId、sourceType(credit_consume|recharge|subscription|hardware|course)、
                     refOrderId、baseAmountCny、ratePercent、commissionCny、
                     status(pending→settled→withdrawable→paid / clawback 退款扣回)、settledAt
PayoutOrder          提现单：partnerId、amountCny、method(wechat|alipay|bank)、payeeInfo、
                     status(applying→reviewing→paid / rejected)、reviewedBy、paidAt、voucher
```

（命名随意，职责对齐即可；`ReferralBinding` 上如缺渠道维度，加 `channelCode`。）

### 5.2 后端接口（挂在现有 API 服务，Fastify）

- `GET /partner/me`（鉴权 + `MarketPartnerGrant` 校验，403 则前端引导联系平台开通）
- `GET /partner/overview`（余额四件套 + 指标卡 + 14 天趋势）
- `GET/POST/PATCH /partner/channels`（渠道短码 CRUD + 点击/注册统计）
- `GET /partner/customers`、`GET /partner/customers/:id`（**只返回脱敏字段**）
- `GET /partner/commissions`（分页 + 类型筛选）
- `GET /partner/commission-rules`（按 SKU 的比例 + 生效状态）
- `POST /partner/payouts`（提现申请，服务端校验 ≥¥100 且 ≤ 可提现余额）、`GET /partner/payouts`
- 计佣引擎：在扣费/充值/订阅成功的事务路径上写 `PartnerCommission(pending)`；T+1 定时任务（服务里已有 scheduler，见 `docs/agents/SCHEDULER.md`）把 pending → settled 并入可提现余额；退款事务写 clawback 扣回。
- 平台侧审核后台（管理员接口 + 简单页面）：提现审核/打款登记、合伙人授权管理（写 `MarketPartnerGrant`）。

### 5.3 前端（合伙人后台）

- 独立入口，建议 `/partner-admin`（挂现有 web 包路由，鉴权走现有登录态）；UI 按原型：移动优先 + ≥900px 侧边栏，样式沿用 `sitong-design.css` 的设计令牌（原型 CSS 变量可直接抄）。
- 二维码：上线后用真实二维码库（如 `qrcode`）替代原型示意 SVG，可后置海报生成。
- 移除原型顶部的「演示数据」提示条。

### 5.4 打款通道

- 提现打款建议微信商家转账（商家转账到零钱 API），需企业付款到零钱/商家转账权限与商户号配置；支付宝/银行卡可后置，先上微信零钱即可跑通闭环。

## 六、⚠️ 开工前必读：测试实例已有 market-partner 在途分支

`docs/HANDOFF-tech-partner-20260922.md` 第 3.2 节记录：**lanqi-test 上已存在一个未上线的 market-partner 在途分支**（4 个 API service + `apps/web/src/lib/pending-partner.ts` + `waimai-growth/contract.json` + 多个前端文件差异）。

开工第一天请先：
1. 把 lanqi-test 上该分支的 4 个 API service 与 `pending-partner.ts` 拉下来读懂（`diff` 生产版本）；
2. 决策：**沿用扩展** 还是 **废弃重写**。本交接文档的需求口径（每商品独立比例、无分级、脱敏、自主提现）以本文档为准；旧分支若实现冲突，以旧分支可复用部分为参考、按新口径重做；
3. 处理完在途分支再动手，避免两套 market-partner 逻辑并存。

## 七、验收标准（按原型逐条对照）

正常路径：
1. 合伙人登录后台，五页签数据与真实库一致；推广链接 + 渠道链接可复制、二维码可扫出商城；
2. 新用户经渠道链接注册 → `ReferralBinding` 归属正确（含「点了 A 的链接注册，后来又点 B 的链接」首触不变更）；重复注册/已归属用户不重复计佣；
3. 归属客户完成充值、积分消耗（任一智能体跑一次真实扣费）、月度订阅各一笔 → 佣金明细各生成一条，基数 = 实付金额（消耗 = chargedCredits × ¥0.05），佣金 = 基数 × 20%，状态流转 pending → settled → 可提现；
4. 累计佣金满 ¥100 → 提现申请成功，余额联动减少，平台侧能看到审核单；打款登记后合伙人端显示「已打款」；
5. 客户退款 → 对应佣金 clawback，可提现余额相应扣减（不能提成负数）。

失败路径（必须测）：
6. 无 `MarketPartnerGrant` 的用户访问后台 → 403 + 友好引导，看不到任何数据；
7. 提现金额 < 100、> 余额、非本人收款账户 → 全部拦截；
8. **租户隔离**：合伙人 A 无法通过任何接口看到合伙人 B 的客户、佣金、提现单（跨 partner 越权测试）；
9. 合伙人端接口响应中不含完整手机号（正则断言脱敏格式 `1\d{2}\*\*\*\*\d{4}` 类）。

质量门禁：`pnpm qa:fast` 起步，涉及计费路径补 `pnpm qa:regression`；上线前按 `AGENTS.md` 完整门禁 + 本文档第七节实操验收。

## 八、发布与回滚纪律

沿用 `docs/HANDOFF-tech-partner-20260922.md` 第四节全部纪律，特别强调：
- 双入口同步发布（`build-os-v2-web.sh` + `build-ai-root.sh`）；合伙人后台新路由两个入口都要可达；
- API 改动走 `/tmp/deploy-release.sh`；每次发布先备份、写台账 `docs/CURRENT_DEPLOYMENT_STATUS.md`；
- **涉及钱的表（PartnerCommission / PayoutOrder）上线前先在测试实例（lanqi-test）全流程演练**：注册归因 → 消费计佣 → 提现审核 → 打款 → 退款扣回，五步都过再上生产；
- 数据库迁移先备份生产库（`db/dump/` 已有全量导出先例），迁移脚本可回滚。

## 九、本原型不含 / 后续再议

- 平台运营侧的完整管理后台（本原型只画了合伙人端；提现审核等平台功能先做简版接口 + 页面即可）；
- 推广海报自动生成、话术素材包（原型里是「即将上线」空态）；
- 合伙人分级/晋升体系（已拍板暂不做）；
- 二级分销、团队裂变（未讨论，不要自行加）。

---
附：产品口径如有变更，以用户最新消息为准，并同步更新本文件与原型 demo。
