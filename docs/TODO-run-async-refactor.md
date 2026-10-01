# 待办：生成任务异步化（run 同步接口 → 202 + 轮询）

> 状态：待排期（2026-10-01 用户拍板「先修 502，异步待办」）
> 背景：直播话术线上 502 排查（docs/DEPLOY-2026-10-01b.md 之后的修复批次）确认——同步请求攥连接 5-10 分钟，全靠 nginx `proxy_read_timeout 1800s` 特例吊着，移动网络/中间代理随时掐断。

## 目标

`POST /market/skus/:sku/run` 从「同步等 5-10 分钟」改为「立即 202 + 前端轮询」，网关超时根除。

## 已有的地基（不用从零建）

| 现有件 | 在异步方案中的角色 |
|---|---|
| `CreditReservation`（requestId 幂等，`apps/api/src/services/credit-reservations.ts`） | 任务启动时预扣算力，防重复计费 |
| `MarketplaceDeliverable`（结果留存 7 天） | 任务完成后落库 |
| 本机找回（workbench payload 本地缓存 + 「稍后可回到页面找回」文案） | 轮询失败兜底 |
| 各 workbench 的 runResultRef / 交付渲染 | 完成态直接复用 |

## 接口设计

```
POST /market/skus/:sku/run
  → 校验/预扣算力（现有 Reservation，requestId 幂等）
  → 立即返回 202 { requestId }（连接只存在 ~1 秒）
  → 进程内后台执行生成（单实例部署够用；未来多实例再上队列）

GET /market/runs/:requestId   （必须登录 + 校验 userId 归属）
  → running:  { status: "running", segment: 4, segmentTotal: 10 }   ← 真实段数进度
  → done:     { status: "done", answer, payload, consumedCredits, balance }
  → failed:   { status: "failed", message, retryable }
```

## 前端改动（四个工作台同构）

1. run 成功拿到 requestId 后进入轮询（4s 间隔，指数退避到 10s）；
2. 进度条用真实 `segment/total` 替换现在的假流式日志（假日志逻辑删除）；
3. 刷新/断网：凭本地存的 requestId 回来接着轮询（替代现在的「稍后找回」文案）；
4. `failed` → 展示 message + 已预扣算力退还提示。

## 注意点

- 后台执行期间进程重启：任务丢失 → 轮询超时后按「未消耗算力」处理并允许重发（Reservation 会被对账释放，已有机制）。
- 旧版同步行为保留一个版本兼容（或灰度按 sku 切换）。
- 直播话术 9 段的截断重试/硬上限（2026-10-01 已修）与异步化正交，先上线。

## 验收

- 直播话术完整跑完：轮询期间无任何 >30s 的 HTTP 连接；进度显示真实段号。
- 生成中刷新页面 → 回来接着看到进度/结果，不重复扣费。
- 断网 30s 恢复 → 轮询自动续上。
