# 服务器存储保留策略（2026-09-15 定稿）

这张纸回答一个问题：**服务器上的东西，哪些会自动清、多久清一次、靠什么清、怎么验证。**

背景是 2026-09-15 的生产 P0（`docs/BUG_REGRESSIONS.md` QA-20260915-001）：磁盘被
发布暂存（8.4G）和历史备份（6.4G）写满，PostgreSQL 写不进文件，内测用户建工作区时看到
「服务不可用」。当天做了紧急清理和第一版防复发；这份文档把保留策略常态化。

## 一、保留策略一览

| 对象 | 位置 | 保留 | 由谁负责 | 频率 |
| --- | --- | --- | --- | --- |
| 发布前回滚快照 | `/opt/baolu-backups/*-before-baolu-os-v2{,-test}` | **每环境最近 8 份** | `scripts/ops/prune-server-backups.sh` | 需要时手动（`--apply`） |
| 发布暂存（本次发布解包目录） | `/opt/baolu-stage/<release-id>` | 发布成功即刻自删；失败保留取证 | 发布脚本 + **新增定时兜底** | 每小时 `:17` |
| 发布包临时副本 | `/tmp/release-*.tar.gz` | **24 小时** | 同上（`scripts/ops/prune-stage.sh`） | 每小时 `:17` |
| 客户上传（图片 / 文档 / 数据表） | `/opt/baolu-os-v2/uploads`、`/opt/baolu-os-v2-test/uploads` | **180 天** | **新增** `scripts/ops/prune-uploads-retention.sh` | 每天 `03:40` |
| 视频复刻暂存（用户拍板 24 小时） | `uploads/.beauty-video-results`、`uploads/lanqi-media/staging` | **24 小时** | `scripts/bs-video-retention.sh`（已有） | 每小时 |
| 磁盘水位告警 | 整盘 | 使用率 ≥85% 或可用 ≤8G 报警 | `scripts/ops/disk-alert.sh`（已有） | 每小时 |
| **已付费交付物**（智能体输入 + 交付正文） | 数据库 `MarketplaceDeliverable` | **7 天**（用户 2026-09-16 拍板） | 读取路径顺带清理（`GET /market/me/deliverables`） | 每次读取 |

一句话口径：**能重建的产物按小时/天清，客户上传按 180 天清，回滚快照永远保留一档（8 份）。**

## 二、永不自动删除的东西

- `/opt/baolu-backups`（发布前回滚快照）：三个清理脚本都显式拒绝任何以 `/opt/baolu-backups`
  开头的路径。注意它和 `/opt/baolu-os-v2-backups`（历史遗留目录，一次性清理对象）名字只差几个字符，
  所以脚本用**整串精确比较**，不做前缀匹配。
- 数据库、生产/测试应用目录、`/etc/baolu-secrets` 密钥、nginx 配置。
- 180 天内的客户上传；隐藏目录（平台自管：`.beauty-video-results`、`.video-inspection` 等）；
  上传根目录第一层的文件（如 `.demo-knowledge-base.json`）。

## 三、怎么装到服务器

```bash
# 1) 只校验，不改系统
DRY_RUN=1 bash scripts/ops/install-storage-retention.sh

# 2) 安装（会把脚本装到 /opt/baolu-ops，unit 装到 /etc/systemd/system，并 enable --now）
sudo bash scripts/ops/install-storage-retention.sh

# 3) 一次性清掉历史遗留垃圾（约 1.5G，脚本自带 dry-run）
bash /opt/baolu-ops/purge-legacy-artifacts.sh          # 先看清单
bash /opt/baolu-ops/purge-legacy-artifacts.sh --apply  # 确认后执行
```

安装脚本先后顺序是：装文件 → `systemctl daemon-reload` → `bash -n` 语法自检 → 两个清理脚本
**dry-run 打印将删清单** → `enable --now` 定时器 → 各跑一次真删 → 打印 `list-timers` 与 `df`。

## 四、怎么验证

```bash
systemctl list-timers --all --no-pager 'baolu-*'   # 应看到 stage-prune / uploads-retention / disk-alert
journalctl -u baolu-stage-prune.service -n 30 --no-pager
journalctl -u baolu-uploads-retention.service -n 30 --no-pager
df -h /                                            # 清理前后对比
```

客户上传清理每次真删都会写一条**不含客户文件名**的汇总日志到
`/var/log/baolu-uploads-retention/<时间>.log`（记录目录、文件数、字节数、删除的空目录数）。
需要看具体清单时用 `--list`（只打印到屏幕，不落日志）。

## 五、怎么改策略

改阈值不用改代码，用环境变量覆盖即可（systemd unit 里也可以直接编辑 `ExecStart`）：

```bash
KEEP_HOURS=48   bash /opt/baolu-ops/prune-stage.sh --apply
RETAIN_DAYS=90  bash /opt/baolu-ops/prune-uploads-retention.sh --list
KEEP=12         bash /opt/baolu-ops/prune-server-backups.sh --apply
```

**回滚整个机制**：`sudo systemctl disable --now baolu-stage-prune.timer baolu-uploads-retention.timer`，
再删掉两个 unit 和 `/opt/baolu-ops/` 下的脚本即可。两个清理脚本默认都是 dry-run，
只有显式 `--apply`（或 timer 的 `ExecStart`）才会真删。

## 六、什么时候该扩容 / 换服务器

当前生产盘 30G。**触发线：可用 < 5G，或「客户上传 + 数据库」月增 > 2G。**
到那时优先给云盘扩容，其次把客户上传和备份挪到 OSS。触发前不需要买更大的服务器。
（发布脚本本身还有一道闸：可用 < 5G 直接拒绝发布，避免把库写死。）

## 七、变更记录

- 2026-09-15：备份保留 8 份/环境、发布脚本空间预检 + 成功后自删暂存、磁盘水位告警上线（QA-20260915-001）。
- 2026-09-15（本次）：新增 24 小时暂存回收定时器、客户上传 180 天保留定时器、过期垃圾一次性清理脚本，
  并把 unit 与脚本一并纳入版本管理（`scripts/ops/systemd/`）。

## 八、上线执行记录（2026-09-15 14:18，生产）

安装：`bash scripts/ops/install-storage-retention.sh`（先 `bash -n` 自检 + 三个脚本 dry-run，再 `enable --now`）。

| 项 | 结果 |
| --- | --- |
| `baolu-stage-prune.timer` | 已启用，每小时 `:17`；首跑 `status=0`，当时无超过 24h 的暂存（4 个目录均为当天 12:22–13:14） |
| `baolu-uploads-retention.timer` | 已启用，每天 `03:40`；首跑 `status=0`，`files=0`（客户上传合计 64M：生产 40M / 内测 24M，均未满 180 天） |
| 过期垃圾清理 `purge-legacy-artifacts.sh --apply` | 删除 4 项：`node_modules.broken-f-links-20260804`(19M)、`_tmp_zhenshui_715_parser_check_20260810`(8M)、`baolu-os-v2-releases`(322M)、`baolu-os-v2-backup-20260811-134303`(413M) |
| 自动跳过 | `/opt/baolu-os-v2-backups`(168M) 被「最新文件 <7 天」规则拦下（内含 `osv2-source-20260909-164327.tgz`），未删 |
| 磁盘 | 可用 **9.2G → 9.5G**（可用率 66–67%；`du` 的 762M 含硬链接/稀疏文件，实际释放小于账面） |
| 回滚资产 | `/opt/baolu-backups` **39 份快照未触碰**（脚本显式拒绝该路径） |
