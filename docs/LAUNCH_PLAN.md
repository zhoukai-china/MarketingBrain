# 上线计划

目标是尽快上线一版可给客户使用的思潼AI增长OS v2，同时保留老版本服务老客户。

## 版本策略

- 老版本继续服务现有老客户，暂不主动扩新客户。
- 老版本只做必要 bug 修复，不再叠加新功能。
- 如果老版本出现数据串号、支付异常、文件错读等严重问题，立即关闭对应高风险功能，只保留人工可控入口。
- 新版本先走 `/os-v2/` 内测，稳定后灰度迁移老客户；不要抢占旧系统使用过的 `/v2/`。
- v2 首批内测必须使用邀请码，不开放公开注册。
- 新客户优先进入 v2，避免继续扩大老系统技术债。

## v2 首版必须可用

- 邀请码登录和首次创建商家/品牌工作区；微信登录资料齐后再打开 `WECHAT_AUTH_REQUIRED=true`。
- 内测邀请码准入，方便分批放量。
- 套餐、积分、余额、积分流水。
- 账户页可创建套餐订单、积分包订单；第一版内测可先手动支付/人工开通，微信支付资料齐后再打开正式预下单和回调。
- 标准版聊天、选题、文案、朋友圈、销售话术。
- 高级版工作台：文件分析、录音卡分析、经营建议报告。
- 微信支付预下单、支付回调、订单发放在支付资料齐后联调；内测期可用手动开通兜底。
- 国内网络策略：生产环境禁止海外模型节点，禁止 OpenAI 等外部地址。
- 管理后台能查看质量反馈和关键运营指标。

## 当前剩余收口

按当前代码状态，离 3-5 个老客户小范围内测还差约 20%-30%，主要不是大功能，而是生产联调和上线兜底：

- 阿里云测试环境部署一次完整 v2。
- 配置真实 PostgreSQL、DeepSeek；第一版可用邀请码登录和手动开通兜底，微信登录/微信支付资料齐后再切到 required=true。
- 跑通生产 `/ops/launch-check`、`/ready`、`/ops/llm-smoke`。
- 执行生产数据库迁移 `pnpm --filter @baolu/db prisma:deploy`，并用 `pnpm invite:create` 生成首批数据库邀请码。
- 如 `WECHAT_AUTH_REQUIRED=true`，跑通真实微信登录回调。
- 如 `WECHAT_PAY_REQUIRED=true`，跑通微信支付预下单和支付回调。
- 在 `DATA_MODE=database` 下做一次数据隔离冒烟测试：两个商家账号互相看不到聊天、文件、订单、积分。
- 找 1 个内部账号完整走：入驻、聊天、反馈、购买、文件分析、报告。
- 再放 3-5 个老客户。

当前最小后台接口：

```text
GET /admin/billing/audit
GET /admin/ops/summary
GET /admin/quality/summary
```

## 上线步骤

1. 在阿里云部署 v2 测试环境，老版本入口保持不动。
2. 配置生产环境变量、数据库、上传目录、国内模型；微信登录/支付可在第一版内测中保持 required=false。
3. 执行 `pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env`。
4. 执行 `/ready`、`/ops/launch-check`、`/ops/llm-smoke`、微信支付回调、数据隔离冒烟测试。
5. 内部账号测试：本地商家标准版、高级版、连锁品牌标准版、高级版各跑一遍。
6. 给 3-5 个熟悉客户发放内测邀请码，试用 v2，不迁移全部老客户。
7. 修复 3-7 天内出现的高频问题。
8. 扩到 20-30 个客户灰度。
9. 新客户默认进入 v2，老客户按意愿迁移。

客户说明文档：`docs/CUSTOMER_BETA_GUIDE.md`。

## 暂不上线的能力

- 小程序。
- 真正的桌面端自动投流/视频发布执行器。
- Word/PDF 完整排版导出。
- 多角色复杂组织权限。
- 算法自动训练闭环。

这些能力放到 v2.1/v2.2，首版先保证客户能登录、能付费、能稳定获得专业输出。

## 开发额度建议

- 如果目标是先给 3-5 个老客户内测，继续使用 Plus 也可以，只是开发会被额度恢复节奏切开。
- 如果目标是连续冲刺，把 v2 首版尽快部署到阿里云并修完内测阻塞问题，建议临时开 Pro 一个月。
- 当前策略是先上线小范围内测，功能先收敛，Plus 可以继续推进；一旦进入部署、支付、微信登录、真实模型联调的密集阶段，Pro 会更稳。

## 每日内测巡检

内测期间每天至少检查一次：

```text
GET /ops/launch-check
GET /admin/ops/summary
GET /admin/billing/audit
GET /admin/quality/summary
```

发现 `billing/audit` 有 critical issue 时，先暂停继续放量，人工核对订单、订阅、积分流水后再恢复。

客户在聊天结果下方可以提交质量反馈：

- 有帮助
- 不准
- 太空泛
- 无法执行

每天查看 `GET /admin/quality/summary`，优先修复高频 `issueType` 对应的 Skill 提示词和业务规则。内测阶段不追求功能数量，先把老客户最常用的 3-5 个场景输出质量打磨稳定。

## 一键内测冒烟

本地或测试环境启动 API 后，先跑：

```bash
pnpm beta:smoke -- --base http://localhost:3011
```

需要把模型链路也跑进去时：

```bash
pnpm beta:smoke -- --base http://localhost:3011 --include-chat
```

需要把高级版工作台也跑进去时：

```bash
pnpm beta:smoke -- --base http://localhost:3011 --include-chat --include-workbench
```

需要同时检查后台巡检接口时：

```bash
pnpm beta:smoke -- --base http://localhost:3011 \
  --include-chat \
  --include-workbench \
  --ops-token "$OPS_TOKEN" \
  --admin-token "$ADMIN_TOKEN"
```

微信支付商户配置完成后，再单独把预下单链路跑进去：

```bash
pnpm beta:smoke -- --base http://localhost:3011 \
  --include-chat \
  --include-workbench \
  --include-wechat-pay \
  --wechat-redirect-uri "https://api.lcppch.top/os-v2/wechat-callback" \
  --ops-token "$OPS_TOKEN" \
  --admin-token "$ADMIN_TOKEN"
```

生产环境 `/auth/dev-login` 会关闭，内测可以直接用测试邀请码跑：

```bash
pnpm beta:smoke -- --base https://api.lcppch.top/os-v2/api \
  --invite-code "<测试邀请码>" \
  --second-invite-code "<第二个测试邀请码，用于数据隔离检查，可选>" \
  --include-chat \
  --include-workbench \
  --wechat-redirect-uri "https://api.lcppch.top/os-v2/wechat-callback" \
  --ops-token "$OPS_TOKEN" \
  --admin-token "$ADMIN_TOKEN"
```

该脚本会检查健康状态、账户、客户画像保存/读取、套餐目录、订单、微信登录配置、微信支付配置、微信支付预下单、模拟支付/生产支付保护、积分流水、工作台权限、聊天、历史会诊、文件上传/分析、录音卡分析、报告生成、`/ops/launch-check`、`/ops/wechat-auth-check`、`/ops/wechat-pay-check`、`/admin/ops/summary`、`/admin/billing/audit`、`/admin/security/isolation-audit`、`/admin/quality/summary`、`/admin/invites`。`DATA_MODE=database` 且使用开发登录时，还会创建第二个测试工作区，确认订单不会跨租户串数据。
