"""Provider 子包——多源视觉 API 适配。

支持：
- qwen-dashscope  (旧）DashScope 控制台 OpenAI 兼容接口
- qwen-bailian    (新）阿里百炼新版控制台（接替 dashscope）
- modelscope       魔塔社区 API-Inference（免费额度足够测试）
- openai           通用 OpenAI 兼容（可接 GPT-4o/Claude/Gemini 转发）

设计要点：
- 统一返回结构化 dict（与原脚本 parse_response 输出兼容）
- 自动根据环境变量/配置文件挑可用源
- 单一提示词函数（build_prompt）供所有 provider 共用，保证输出风格统一
"""
from .base import Provider, EMOTION_FIELDS, get_available_providers, get_provider_by_name

__all__ = ["Provider", "EMOTION_FIELDS", "get_available_providers", "get_provider_by_name"]
