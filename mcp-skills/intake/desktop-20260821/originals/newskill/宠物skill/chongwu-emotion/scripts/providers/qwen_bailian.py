"""阿里百炼新版控制台（dashscope 替代品）。

控制台：https://bailian.console.aliyun.com
endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
        （百炼底层也走这套 endpoint，只是 Key 在新控制台申请）
model:    qwen-vl-max / qwen-vl-plus / qwen2.5-vl-72b-instruct
鉴权：    Authorization: Bearer {BAILIAN_API_KEY}
"""

import json
import urllib.request
import urllib.error
from .base import Provider


class QianwenBailianProvider(Provider):
    name = "qwen-bailian"
    display_name = "阿里百炼"
    env_var = "BAILIAN_API_KEY"
    config_key = "bailian_api_key"
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
                f"百炼 HTTP {e.code}（请到 bailian.console.aliyun.com 检查 Key 与模型名）: {body}"
            ) from e
