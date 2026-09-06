---
summary: "第三方 API 多源适配方法论 —— Provider 模式 + 百炼 compatible-mode 网关接法"
read_when:
  - 任何需要调用外部视觉/LLM/多模态 API 的 skill 要设计「不被单家云钉死」的接入层时
  - 用户说「多源」「换一家 API」「某云控制台下线了」「要兼容 GPT/Claude/百炼」时
  - 给 Codex/子代理做「可插拔 API 适配层」开发任务时
---

# 第三方 API 多源适配方法论（api-multisource-adapter）

> 把「调用某一家云的 API」升级成「插什么 key 就用什么源」的可插拔架构。
> 核心洞察：**阿里百炼（DashScope 的 Key）本质是 OpenAI 兼容网关**，任何支持 OpenAI 格式调用的代码都能直接接，不用写阿里专属 SDK。

---

## 一、为什么需要多源适配

痛点：原版「宠物情绪识别」skill 写死调用 DashScope，2026-09 该控制台显示已下线，整个 skill 直接跑不起来。

原则：**任何外部 API 都不该是单点依赖**。云厂商会下线、会限流、会涨价、会改控制台。把接入层做成「多源可插拔」，skill 才能长期可用、可交付。

---

## 二、架构（Provider 模式）

```
scripts/
├── providers/
│   ├── __init__.py
│   ├── base.py              # 抽象基类 Provider + 公共工具 + 自动选源工厂
│   ├── openai_vision.py     # 通用 OpenAI 兼容（GPT-4o / Claude 转发 / Gemini 转发）
│   ├── qwen_bailian.py      # 阿里百炼（走 compatible-mode 网关）
│   ├── qwen_dashscope.py    # 阿里旧版 DashScope（兼容保留）
│   └── modelscope.py        # 魔搭免费 token（兜底）
└── your_skill.py            # 业务主脚本：只调 Provider，不关心具体云
```

**每个 Provider 只需声明类属性 + 实现一个 `_call_api`**：

```python
class XxxProvider(Provider):
    name = "xxx"                  # 内部标识（报告/日志用）
    display_name = "中文名"        # 给用户看的（报告 footer 展示）
    env_var = "XXX_API_KEY"        # 优先读的环境变量
    config_key = "xxx_api_key"     # 备选：从 config 文件读
    default_base_url = "https://..."   # 默认 endpoint
    default_model = "model-name"
    is_free = False                # 是否免费（仅影响选源优先级提示）

    def _call_api(self, payload):
        # 发 HTTP 请求，返回 OpenAI 兼容格式的 JSON
        ...
```

**关键点**：所有 Provider 共用同一套 prompt + 同一套响应解析（`base.py` 里的 `build_prompt()` / `parse_response()`），保证换源不影响输出风格。

---

## 三、百炼（compatible-mode）网关接法 —— 最关键的洞察

阿里 DashScope 的 Key，**不需要阿里专属 SDK**，它提供了 OpenAI 兼容的 chat/completions 接口：

```
POST {BASE_URL}/chat/completions
Authorization: Bearer {DASHSCOPE_API_KEY}
Content-Type: application/json

{ "model": "qwen-vl-max", "messages": [ ... 同 OpenAI 格式 ... ] }
```

- **Key 字段**：`DASHSCOPE_API_KEY`（取这个名字，不叫 BAILIAN）
- **Base URL 两种**：
  - 公网：`https://dashscope.aliyuncs.com/compatible-mode/v1`
  - 企业私有网关（本机已配的这个）：`https://ws-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- **鉴权**：就是标准 `Authorization: Bearer {key}`
- **结论**：直接用 `openai_vision.py` 那套 urllib/requests 代码，把 `base_url` 改成百炼网关即可，零改造。

> 本机实测：Key 取自服务器 `39.96.80.54`（= api.lcppch.top）的 `/etc/baolu-secrets/baolu-os-v2.env`，走私有网关，qwen-vl-max 调用成功。

---

## 四、配置约定（config 文件优先级）

配置文件路径：`~/.workbuddy/config/<skill>.json`

约定字段（让基类自动识别，**不写死**）：

```json
{
  "bailian_api_key": "sk-xxxx",
  "qwen-bailian_base_url": "https://<网关>/compatible-mode/v1",
  "qwen-bailian_model": "qwen-vl-max",
  "default_provider": "qwen-bailian"
}
```

- `{provider.config_key}` → 找 key（如 `bailian_api_key`）
- `{provider.name}_base_url` → 找 endpoint（如 `qwen-bailian_base_url`）
- `{provider.name}_model` → 找模型名（如 `qwen-bailian_model`）
- **优先级**：环境变量 > config 文件
- **自动选源**：按 `免费 → 付费` 顺序挑第一个有 key 的源；用户也可 `--provider xxx` 强制指定

---

## 五、报告/日志里显示「实际用的源」

永远在输出里带上 `provider_display`（中文名）+ `model`，例如 footer 显示「阿里百炼 qwen-vl-max」。
用途：门店留证、调试溯源、让用户知道跑的是哪朵云。

---

## 六、给 Codex 的「继续开发」指引

要移植这套架构到其他视觉/LLM 任务（换 prompt、换解析字段）：

1. **改 prompt**：只改 `base.py` 里的 `build_prompt()`（或业务脚本里的 prompt 函数），Provider 层不动。
2. **改解析**：只改 `base.py` 的 `parse_response()`，把 JSON 字段映射到你的业务结构体。
3. **加新源**：复制 `openai_vision.py` → 改 `name` / `env_var` / `config_key` / `default_base_url` / `default_model`，在 `base.py` 的 `get_available_providers()` 和 `get_provider_by_name()` 里注册一下即可。
4. **错误处理**：HTTP 401/403 提示 key 无效；超时给清晰报错；解析失败返回兜底结构体，不要 crash。
5. **安全**：key 只存本地 config 文件，不进 git、不外泄、不在日志里打印明文（自检时只显示前 6 位 + 后 4 位）。

---

## 七、何时用这个 skill

- 新写任何需要调外部 AI API 的 skill → 直接套这个 Provider 架构，别再写死单点。
- 已有 skill 因某云下线/限流跑不起来 → 用本方法论改造为多源。
- 需要同时支持国内（百炼）+ 国外（OpenAI/Claude）双栈 → 本架构天然支持。
