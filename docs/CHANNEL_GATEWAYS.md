# 思潼 AI 三入口统一调用架构

## 结论

三个入口彼此独立，但必须复用同一个 Agent Gateway：

1. WorkBuddy：`WorkBuddy -> /integrations/workbuddy/mcp -> Agent Gateway -> internal Skill MCP`
2. 微信用户：`微信客服 -> /integrations/wechat-kf/callback -> Agent Gateway -> internal Skill MCP`
3. 自研前端：`/os-v2/my-ai -> /agents/... -> Agent Gateway -> internal Skill MCP`

统一层负责 Agent 授权、成员权限、Skill 白名单与版本、知识库、积分、幂等、会话和审计。WorkBuddy 与微信都不能直接访问内部 `/mcp`，也不能提交 `tenantId`、`userId`、`auth` 或 `skipEntitlement`。

## WorkBuddy MCP

外部地址：`https://api.lcppch.top/os-v2/api/integrations/workbuddy/mcp`

WorkBuddy 中使用 HTTP MCP、Bearer Token，提供两个工具：

- `sitong.ask`：调用当前连接绑定的思潼 Agent。
- `sitong.skills`：查看该 Agent 已绑定的 Skill 和版本。

生产环境只需要启用外部 MCP 地址；每个用户在“思潼 AI -> 企业账户 -> WorkBuddy 调用思潼 AI”中自行生成连接：

```dotenv
WORKBUDDY_MCP_ENABLED=true
WORKBUDDY_MCP_PUBLIC_URL=https://api.lcppch.top/os-v2/api/integrations/workbuddy/mcp
```

每个 WorkBuddy 连接使用独立 Token，并在数据库中固定映射租户、用户和 Agent；Token 明文只展示一次，服务端只保存 SHA-256 哈希。`WORKBUDDY_MCP_CONNECTIONS_JSON` 仅保留为紧急运维兼容方式，普通用户不使用。不要把 `SKILL_MCP_TOKEN` 配到 WorkBuddy。

## 微信直接调用思潼 AI（图二对应的推荐形态）

图二这种“像联系人一样直接聊天”的形态使用企业微信的“微信客服”官方 API，不经过 WorkBuddy。回调使用企业微信 AES 加密协议，收到事件后通过 `kf/sync_msg` 拉取消息，再通过 `kf/send_msg` 返回结果。

企业微信“微信客服 -> 通过 API 管理”回调地址：

`https://api.lcppch.top/os-v2/api/integrations/wechat-kf/callback`

生产配置：

```dotenv
WECHAT_KF_ENABLED=true
WECHAT_KF_CORP_ID=企业微信CorpID
WECHAT_KF_SECRET=微信客服Secret
WECHAT_KF_TOKEN=回调配置Token
WECHAT_KF_ENCODING_AES_KEY=回调配置的43位EncodingAESKey
WECHAT_KF_DEFAULT_AGENT_ID=agent_acquisition
WECHAT_KF_BIND_URL=https://api.lcppch.top/os-v2/login
```

企业微信后台还需要把用于思潼登录的公众号/小程序绑定到“微信客服”，并绑定到同一个微信开放平台。系统用微信客服 `external_userid -> unionid -> 思潼用户` 完成账号关联；未绑定用户会收到登录提示。

当前第一期处理文字消息。重复 `msgid` 会复用同一幂等请求，避免重复扣积分。微信客服规定：用户主动发消息后的 48 小时内最多可下发 5 条消息，因此处理中提示与结果拆分会占用 2 条额度。

仓库同时保留 `/integrations/wechat/messages` 作为“公众号消息窗口”备选通道，但它不是图二对应的主方案。

## 上线检查

- WorkBuddy `/status`：`/integrations/workbuddy/status`
- 微信客服 `/status`：`/integrations/wechat-kf/status`
- 本地协议测试：`pnpm channels:smoke`
- API 类型检查：`pnpm --filter @baolu/api typecheck`
- 全量构建：`pnpm build`
