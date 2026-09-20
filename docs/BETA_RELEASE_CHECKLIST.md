# v2 老客户内测上线清单

目标：先让 3-5 个熟悉的老客户进入思潼AI增长OS v2 内测，老版本继续兜底，不做一次性全量迁移。

## 1. 上线前准备

- 备份旧版 nginx 配置、旧版服务目录和旧版数据库。
- 确认 v2 使用独立目录、独立端口、独立数据库。
- 确认域名 ICP 备案已可用，v2 先挂 `/os-v2/`，不要抢占旧系统使用过的 `/v2/`。
- 准备服务器环境文件：`/etc/Sitong-secrets/Sitong-os-v2.env`。
- 确认生产配置不出现 OpenAI、ChatGPT、Anthropic、Gemini 等海外模型节点。

## 2. 必填生产配置

可以先复制模板：

```bash
sudo mkdir -p /etc/Sitong-secrets
sudo cp docs/Sitong-os-v2.env.template /etc/Sitong-secrets/Sitong-os-v2.env
sudo chmod 600 /etc/Sitong-secrets/Sitong-os-v2.env
sudo nano /etc/Sitong-secrets/Sitong-os-v2.env
```

```text
NODE_ENV=production
DATA_MODE=database
DATABASE_URL=...
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-pro
JWT_SECRET=...
ADMIN_TOKEN=...
OPS_TOKEN=...
DOMESTIC_NETWORK_ONLY=true
DOMESTIC_OUTBOUND_ALLOWLIST=api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,api.weixin.qq.com,api.mch.weixin.qq.com,api.lcppch.top
WECHAT_AUTH_REQUIRED=false
WECHAT_AUTH_APPID=
WECHAT_AUTH_SECRET=
WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
WECHAT_PAY_REQUIRED=false
WECHAT_PAY_APPID=...
WECHAT_PAY_MCH_ID=...
WECHAT_PAY_API_V3_KEY=...
WECHAT_PAY_CERT_SERIAL_NO=...
WECHAT_PAY_PRIVATE_KEY=...
WECHAT_PAY_NOTIFY_URL=https://api.lcppch.top/os-v2/api/billing/wechat/notify
WECHAT_PAY_PLATFORM_PUBLIC_KEY=...
UPLOAD_DIR=/opt/Sitong-os-v2/uploads
VITE_BASE_PATH=/os-v2/
VITE_API_BASE_URL=https://api.lcppch.top/os-v2/api
VITE_WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
```

## 3. 部署命令

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
bash scripts/deploy-linux.sh
```

部署脚本会执行：

- 静态生产配置检查
- 安装依赖
- Prisma client 生成
- 数据库迁移
- 构建
- 重启 systemd 服务
- `/health` 和 `/ready` 检查

### 3.1 Web 前端必须「双入口同步发布」（必做，缺一即视为发布未完成）

生产有**两个**互相独立的前端产物目录，由 nginx 分别指向，**不能只发一个**：

| 入口 | 域名 / 路径 | nginx root | 构建脚本 | `VITE_BASE_PATH` |
| --- | --- | --- | --- | --- |
| ai-root | `https://ai.lcppch.top/`（含 `/agents`） | `/opt/baolu-os-v2/apps/web/dist-ai-root` | `bash scripts/build-ai-root.sh` | `/` |
| os-v2 | `https://api.lcppch.top/os-v2/`（含 `/os-v2/agents`） | `/opt/baolu-os-v2/apps/web/dist` | `bash scripts/build-os-v2-web.sh` | `/os-v2/` |

```bash
# 生产机上，两个都要跑（顺序无关，但两个都跑才算发完）
bash /opt/baolu-os-v2/scripts/build-os-v2-web.sh
bash /opt/baolu-os-v2/scripts/build-ai-root.sh
```

发布后**必须逐条复验**（只验一个域名等于没验）：

1. 两个入口都返回新入口 chunk 名：`https://ai.lcppch.top/agents` 与 `https://api.lcppch.top/os-v2/agents` 的 `index.html` 里 `<script src>` 指向本次构建产物。
2. 静态资源在**两个域名**下都可直取且 `Content-Type` 正确，尤其是 `avatars/*.png`：
   `https://ai.lcppch.top/avatars/ip-position.png` 与 `https://api.lcppch.top/os-v2/avatars/ip-position.png` 必须都是 `200 image/png`。
   **只看到 200 不算过**——SPA 兜底会把缺失文件也返回 200，但 `Content-Type` 是 `text/html`、字节数等于 `index.html`。必须同时核对 `Content-Type` 与字节数。
3. 打开两个 `/agents` 页面人工确认数字员工形象（头像）正常显示，而不是只剩 emoji。

原因：2026-09-20 的事故是只重建了 `dist`（os-v2）而 `dist-ai-root` 停在旧产物，且旧产物里**没有 `avatars/` 目录**，`/avatars/*.png` 被 `try_files` 兜底成 `index.html`，用户看到「数字员工没有形象」并以为「又回退了」。参见 `docs/BUG_REGRESSIONS.md` QA-20260920-001。

## 4. 创建内测邀请码

```bash
set -a
source /etc/Sitong-secrets/Sitong-os-v2.env
set +a

INVITE_CODE="线下发给客户的明文邀请码" \
pnpm invite:create -- --label "首批老客户内测-客户A" --plan local_premium --max-uses 1
```

注意：明文邀请码只线下发给客户，不写进仓库。数据库只保存哈希和预览。

## 5. 上线后检查

```bash
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/ready
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/launch-check
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/llm-smoke
curl -H "x-Sitong-ops-token: $OPS_TOKEN" "http://127.0.0.1:3002/ops/wechat-auth-check?redirectUri=https%3A%2F%2Fapi.lcppch.top%2Fos-v2%2Fwechat-callback"
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/wechat-pay-check
```

完整内测冒烟：

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

## 6. 内测当天人工验证

- 微信登录能进入 v2。
- 邀请码能创建商家/品牌工作区。
- 客户资料页能保存经营画像。
- 聊天能输出专业咨询方案，不出现通用 AI 口吻。
- 历史会诊能读取，继续追问不会串到别的客户。
- 高级版能上传文件、分析文件、提交录音卡、生成经营报告。
- 创建订单后能生成微信支付二维码。
- 支付成功后订单、订阅、积分到账。
- 运营页能查看客户列表、客户详情、质量反馈、账务复核。

## 7. 每天内测巡检

```text
GET /ops/launch-check
GET /admin/ops/summary
GET /admin/billing/audit
GET /admin/quality/summary
GET /admin/customers
GET /admin/security/isolation-audit
```

发现 `billing/audit` 有 critical issue 时，先暂停继续放量，人工核对订单、订阅和积分流水。

发现 `security/isolation-audit` 有 issue 时，先暂停继续放量，人工核对对应客户数据，确认没有客户看到其他商家的聊天、文件、订单或积分记录。

发现质量反馈集中在“不准、太空泛、无法执行”时，优先修复对应 Skill 提示词和客户画像字段，不急着加新功能。

## 8. 放量节奏

- 第 1 天：内部账号完整跑通。
- 第 2-3 天：3-5 个熟悉老客户内测。
- 第 4-7 天：修复高频问题，只保留老版本兜底。
- 稳定后：扩到 20-30 个老客户。
- 新客户默认进入 v2，老客户按意愿灰度迁移。
