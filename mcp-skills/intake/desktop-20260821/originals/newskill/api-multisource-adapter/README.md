# api-multisource-adapter · 第三方 API 多源适配方法论

把「写死调某一家云」升级成「插什么 key 就用什么源」的可插拔架构。
**核心洞察：阿里百炼 / DashScope 的 Key 本质是 OpenAI 兼容网关**，任何 OpenAI 格式调用代码都能直接接。

## 谁用这个 skill

- 新写任何需要调外部视觉 / LLM / 多模态 API 的 skill → 直接套 Provider 架构，别写死单点
- 已有 skill 因某云下线 / 限流跑不起来 → 用本方法论改造为多源
- 需要国内（百炼）+ 国外（OpenAI/Claude）双栈 → 本架构天然支持

## 目录结构

```
api-multisource-adapter/
├── SKILL.md                       # 方法论全文（架构 / 百炼网关 / 配置约定 / 扩展指引）
├── README.md                      # 本文件
├── scripts/
│   └── provider_template.py       # 可复用 Provider 基类 + OpenAI 兼容 + 百炼 示例
├── references/
│   └── bailian-gateway.md         # 百炼 compatible-mode 网关接法详解（含本机实测）
└── config.example.json            # 配置示例
```

## 快速上手（给开发 / Codex）

1. 复制 `scripts/provider_template.py` 到你的 skill 的 `scripts/providers/` 目录
2. 只改两个函数：
   - `build_prompt()` —— 你的业务指令
   - `parse_response()` —— 把 OpenAI 格式返回映射成你的业务结构体
3. 加新源：复制 `OpenAICompatibleProvider` → 改 `name` / `env_var` / `config_key` / `default_base_url` / `default_model`，在工厂函数里注册
4. 接百炼：`QianwenBailianProvider` 已写好，base_url 换成你的网关即可（公网或私有）

## 关键约定

| 约定 | 说明 |
|------|------|
| 配置路径 | `~/.workbuddy/config/<skill>.json` |
| key 字段 | `{config_key}`（如 `bailian_api_key`） |
| endpoint 字段 | `{name}_base_url`（如 `qwen-bailian_base_url`） |
| model 字段 | `{name}_model`（如 `qwen-bailian_model`） |
| 优先级 | 环境变量 > config 文件 |
| 自动选源 | 免费 → 付费 顺序，第一个有 key 的源 |
| 报告留证 | 输出带 `provider_display` + `model`（如「阿里百炼 qwen-vl-max」） |

## 实测验证（2026-08-19）

本机 `~/.workbuddy/config/pet_store_emotion.json` 已配百炼 Key（取自服务器 `/etc/baolu-secrets/baolu-os-v2.env`），
`python scripts/provider_template.py` 自检显示 `qwen-bailian`，占位图真实调用 qwen-vl-max 成功。
