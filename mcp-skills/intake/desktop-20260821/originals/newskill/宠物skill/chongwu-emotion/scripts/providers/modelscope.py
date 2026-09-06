"""魔塔社区 ModelScope API-Inference（推荐给个人/测试用，免费额度够用）。

入口：https://modelscope.cn  → 个人中心 → 访问令牌 (Access Token)
endpoint: https://api-inference.modelscope.cn/v1/chat/completions
model:    Qwen/Qwen2.5-VL-72B-Instruct (推荐，免费档可用)
          Qwen/Qwen2.5-VL-7B-Instruct (更轻量)
鉴权：    Authorization: Bearer {MODELSCOPE_API_KEY}
注意：    ModelScope token 不是 API Key 而叫"访问令牌"，格式 ms-xxx 或直接字符串。
"""

import json
import urllib.request
import urllib.error
from .base import Provider


class ModelScopeProvider(Provider):
    name = "modelscope"
    display_name = "魔搭 ModelScope"
    env_var = "MODELSCOPE_API_KEY"
    config_key = "modelscope_api_key"
    default_base_url = "https://api-inference.modelscope.cn/v1"
    default_model = "Qwen/Qwen2.5-VL-72B-Instruct"
    is_free = True  # 标注免费，仅用于 select_provider 时优先级提示

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
            if e.code in (401, 403):
                raise RuntimeError(
                    f"ModelScope HTTP {e.code}（访问令牌无效，到 https://modelscope.cn 我的中心查看）: {body}"
                ) from e
            raise RuntimeError(f"ModelScope HTTP {e.code}: {body}") from e
