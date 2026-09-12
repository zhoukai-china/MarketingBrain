## 最新发布：20260911-lq19-test-splash-fix-test2（2026-09-11，测试实例；生产由同期另一条工作线全量包带上）— 兰琪内测实例「正在进入体验工作区」中间页消除

发布包：`release-20260911-lq19-test-splash-fix.tar.gz`（**7573234 B**，sha256 `f77268f71df52e453f5bc08a31efb640772e071f0544b19e2d4929423eafd900`，**1277 个文件**）。增量包只含工作区当前源码集，`docs/` 与临时脚本不进包；服务器 `/tmp` 实测 sha256 与本机一致。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-lq19-test-splash-fix-test2` | `DEPLOY_OK` + `health=200 (after 12s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | （本轮不单独发）由 `20260911-mobile-topbar-prod1` 全量包带上同一份 `main.tsx` | 该包 `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200`（18:23:47 重启） |

- 改动：`apps/web/src/lib/direct-test-session.ts`（新增零网络 `hasDirectTestSession()`；`ensureDirectTestSession()` 由 `Promise<void>` 改 `Promise<boolean>`）、`apps/web/src/main.tsx`（内测免登录门已有会话时直接渲染，后台静默校验+15 秒节流刷新）。Bug 台账见 `docs/BUG_REGRESSIONS.md` **QA-20260911-013**。
- 发布前验证：`pnpm.cmd --filter @baolu/web build` 通过（先在本地拦住上一轮 `Cannot find module './pages/MarketplaceApp.js'` 那类源码集不自洽的包）、`pnpm.cmd qa:fast` PASS（含新契约 smoke 14/14）、`pnpm.cmd lanqi:acquire-ui-contract-smoke` 45/0。
- 发布后复验（测试实例真实浏览器，只读）：`node scripts/lanqi-test-instance-splash-browser-e2e.mjs --base https://api.lcppch.top/lanqi-test` → **PASS (0 failed)**：桌面 1440 首屏中间页出现一次（@2460ms，首次建会话）后，点侧栏导航与刷新子页均 `splash=false`；移动 390 同口径全 PASS；两侧 console/page error 为 0，截图 `%TEMP%\lanqi-test-splash-e2e\desktop-1440.png` 与 `mobile-390.png`。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`。
- 备份与回滚：测试实例备份 `/opt/baolu-backups/20260911-lq19-test-splash-fix-test2-before-baolu-os-v2-test/`（180M），日志 `/tmp/deploy-run-20260911-lq19-test-splash-fix-test2.log` 与 `/tmp/deploy-20260911-lq19-test-splash-fix-test2-baolu-os-v2-test.log`。回滚＝还原该备份目录并 `systemctl restart baolu-os-v2-test`。
- 生产交付路径说明：生产 `VITE_DIRECT_TEST_LOGIN` 未开（`/api/auth/dev-login` = 404，测试实例 = 200），内测免登录门在生产不渲染，本修复对生产用户零可见差异；**该文件的生产投放由同期 `20260911-mobile-topbar-prod1` 的「工作区在途改动」包一并完成**（实测生产 `apps/web/src/main.tsx` 已含 `hasDirectTestSession`）。生产复验：`pnpm.cmd auth:login-entry-production-check` **PASS**（`root_to_home` / `legacy_market_redirect` / `login_page` / `open_registration_no_invite_code` / `mobile_login_button=301x46` / `legacy_paths` / `console_clean`）。
- 磁盘：本次发布前 `/` 已用 25G / 30G，期间两条并行发布（本包 + `mobile-topbar`）后剩余约 2.3G（92%）。下一次发布前若低于约 2G，先清理 `/opt/baolu-stage/2026090*` 纯 scratch 暂存目录（回滚资产在 `/opt/baolu-backups`，不受影响）。
