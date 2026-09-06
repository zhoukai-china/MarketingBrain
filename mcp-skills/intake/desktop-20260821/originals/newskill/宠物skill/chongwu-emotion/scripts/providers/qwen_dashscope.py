"""DashScope（国际版）OpenAI 兼容模式。

控制台：https://dashscope.console.aliyun.com（2026 报告下线状态）
endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
model:    qwen-vl-max (推荐) / qwen-vl-plus
鉴权：    Authorization: Bearer {DASHSCOPE_API_KEY}
"""

import json
import urllib.request
import urllib.error
from .base import Provider


class QianwenDashScopeProvider(Provider):
    name = "qwen-dashscope"
    display_name = "阿里 DashScope"
    env_var = "DASHSCOPE_API_KEY"
    config_key = "dashscope_api_key"
    default_base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    default_model = "qwen-vl-max"

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
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            raise RuntimeError(
                f"DashScope HTTP {e.code}（控制台可能已下线，建议切到 qwen-bailian 或 modelscope）: {body}"
            ) from e
