# 思潼AI增长OS v2 部署资料清单

这份清单只记录需要准备的资料类型，不保存真实密钥。真实生产密钥只放到服务器：

```text
/etc/Sitong-secrets/Sitong-os-v2.env
```

## 1. 服务器资料

- 阿里云 ECS 公网 IP 或 SSH 域名。
- SSH 登录用户名。
- SSH 登录方式：密钥文件或临时密码。
- 当前老版本服务目录、端口、systemd 服务名。
- 当前 nginx 配置文件路径。
- v2 部署目录，默认使用 `/opt/Sitong-os-v2`。
- v2 API 端口，生产建议使用 `3002`，避免碰现有服务。

建议上线方式：老版本保持不动，v2 先挂到 `https://api.lcppch.top/os-v2/` 给老客户内测。服务器现有 `/v2` 已被老系统使用过，第一版不要抢这个路径。

## 2. 数据库资料

- 阿里云 RDS PostgreSQL 地址。
- 数据库名，建议单独建 `sitong_os_v2`。
- 数据库用户名和密码。
- RDS 白名单或安全组是否允许 ECS 内网访问。
- 是否已有备份策略。

v2 必须使用独立数据库，不和老版本混用，避免客户数据串库。

## 3. 国内大模型资料

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL=deepseek-v4-pro`

生产环境只允许中国国内顶级模型或国内合规中转，不允许配置 OpenAI、Anthropic、Gemini 等海外模型节点。当前默认白名单为 `deepseek-v4-pro`、`deepseek-v4pro`、`qwen-max`、`qwen3-max`、`qwen3-235b-a22b`、`qwq-plus`；普通 chat、flash、lite、mini、turbo 等低阶模型会被启动校验拦截。

## 4. 微信登录资料

- 微信网页授权 AppID。
- 微信网页授权 Secret。
- 网页授权回调域名是否已配置。
- v2 回调地址：`https://api.lcppch.top/os-v2/wechat-callback`

## 5. 微信支付资料

- 微信支付 AppID。
- 商户号 `MCH_ID`。
- API v3 密钥。
- 商户证书序列号。
- 商户 API 私钥 PEM。
- 微信支付平台公钥 PEM。
- 支付回调地址：`https://api.lcppch.top/os-v2/api/billing/wechat/notify`

私钥不要发到普通聊天窗口。更稳的方式是在服务器上直接写入 `/etc/Sitong-secrets/Sitong-os-v2.env`。

## 6. 生产随机密钥

这三个可以由代码生成，不需要你手动想：

```bash
pnpm secrets:generate
```

生成后填入服务器环境文件：

```text
JWT_SECRET=...
ADMIN_TOKEN=...
OPS_TOKEN=...
```

## 7. 首批内测资料

- 3-5 个熟悉老客户名单。
- 每个客户对应的商家或品牌名称。
- 计划给他们开的套餐：本地商家标准版、本地商家高级版、连锁品牌标准版、连锁品牌高级版。
- 每个客户的内测邀请码。
- 是否需要先由你们内部代建客户资料。

## 8. 上线前必须跑通

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
bash scripts/deploy-linux.sh
pnpm beta:smoke -- --base https://api.lcppch.top/os-v2/api --include-chat --include-workbench --include-wechat-pay --ops-token "$OPS_TOKEN" --admin-token "$ADMIN_TOKEN"
```

通过后再把 v2 链接发给首批老客户。老版本继续保留作为兜底。
