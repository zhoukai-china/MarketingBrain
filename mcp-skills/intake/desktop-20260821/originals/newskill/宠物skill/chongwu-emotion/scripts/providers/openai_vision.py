"""通用 OpenAI 兼容接口（可接 GPT-4o、Claude 转发、Gemini 转发 等）。

endpoint: 默认可改 base_url 接任何 OpenAI 兼容服务
model:    gpt-4o / gpt-4o-mini（可被 base_url 对应服务模型覆盖）
鉴权：    Authorization: Bearer {OPENAI_API_KEY}
"""

import json
import urllib.request
import urllib.error
from .base import Provider


class OpenAICompatibleProvider(Provider):
    name = "openai"
    display_name = "OpenAI 兼容"
    env_var = "OPENAI_API_KEY"
    config_key = "openai_api_key"
    default_base_url = "https://api.openai.com/v1"
    default_model = "gpt-4o"

    def _call_api(self, payload):
        url = f"{self.base_url}/chat/completions"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"OpenAI HTTP {e.code}: {body}") from e
