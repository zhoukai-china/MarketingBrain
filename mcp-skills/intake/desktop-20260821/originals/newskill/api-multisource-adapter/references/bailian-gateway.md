# 阿里百炼（DashScope）compatible-mode 网关接法详解

## 核心洞察

**阿里百炼 / DashScope 的 Key，本质是 OpenAI 兼容网关。**
你不需要装阿里专属 SDK（dashscope 包），也不需要写阿里专属请求格式。
任何能发 `POST /chat/completions` + `Authorization: Bearer {key}` 的代码，都能直接调百炼。

## Key 字段

取名叫 `DASHSCOPE_API_KEY`（不叫 BAILIAN）。格式 `sk-` 开头的一长串。

- 控制台：https://bailian.console.aliyun.com （新版，独立域名，**没下线**）
- 旧 dashscope.console.aliyun.com 控制台已显示「下线」，但 **Key 本身还能用**（走网关）

## Base URL 两种

| 类型 | Base URL | 说明 |
|------|----------|------|
| 公网 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 任何人可用 |
| 企业私有网关 | `https://ws-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | 阿里云 MaaS 私有部署，本机已配这个 |

## 请求格式（标准 OpenAI 兼容）

```
POST {BASE_URL}/chat/completions
Authorization: Bearer {DASHSCOPE_API_KEY}
Content-Type: application/json

{
  "model": "qwen-vl-max",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,...."}},
        {"type": "text", "text": "你的指令"}
      ]
    }
  ],
  "temperature": 0.1,
  "max_tokens": 800
}
```

## 响应格式（标准 OpenAI 兼容）

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"emotion\":\"放松\",\"confidence\":0.88,...}"
      }
    }
  ]
}
```

解析就是 `result["choices"][0]["message"]["content"]`，和 OpenAI 一模一样。

## 本机实测记录（2026-08-19）

- 服务器：`39.96.80.54`（= api.lcppch.top / ai.lcppch.top），SSH 私钥 `sales_copilot_20260618` 直连 root
- 真实 Key 路径：`/etc/baolu-secrets/baolu-os-v2.env`（⚠️ 旧文档写的 `/etc/Sitong-secrets/` 已过时，实际不存在）
- 网关：`https://ws-gws91avluml5mkau.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- 模型：qwen-vl-max
- 结果：占位图 → qwen-vl-max → 返回结构化情绪判断，全链路跑通 ✅

## 常见坑

1. **别用 dashscope Python SDK**：装包麻烦，且旧版行为不一致。直接 urllib/requests 发 HTTP 最稳。
2. **base_url 要带 `/v1`**：缺了会 404。
3. **key 别进 git**：存 `~/.workbuddy/config/<skill>.json`，加进 .gitignore。
4. **私有网关有区域**：`cn-beijing` 的网关，换区域要换地址。
5. **qwen-vl-max 是视觉模型**：纯文本任务用 `qwen-plus` / `qwen-max`，别混。
