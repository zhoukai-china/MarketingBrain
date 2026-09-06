"""第三方 API 多源适配 —— 可复用 Provider 基类 + OpenAI 兼容示例。

这是「api-multisource-adapter」方法论的可执行模板。
任何需要调外部视觉 / LLM / 多模态 API 的 skill，都可以直接复制这个文件，
只改 build_prompt() 和 parse_response() 两个函数，其余不用动。

核心洞察：阿里百炼 / DashScope 的 Key 本质是 OpenAI 兼容网关，
所以 OpenAICompatibleProvider 这套代码能直接接百炼（改 base_url 即可）。

用法见文件末尾的 demo / 见 api-multisource-adapter/SKILL.md。
"""

import base64
import json
import os
import urllib.request
import urllib.error
from pathlib import Path


# === 配置加载（优先级：环境变量 > config 文件） ===

def _load_config(skill_name):
    """读 ~/.workbuddy/config/<skill_name>.json。"""
    paths = [
        os.path.expanduser(f"~/.workbuddy/config/{skill_name}.json"),
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def _cfg_base_url(cfg, provider_cls):
    name = getattr(provider_cls, "name", "")
    for key in (f"{name}_base_url", f"{getattr(provider_cls, 'config_key', '')}_base_url"):
        if key and isinstance(cfg.get(key), str) and cfg[key].strip():
            return cfg[key].strip()
    return ""


def _cfg_model(cfg, provider_cls):
    name = getattr(provider_cls, "name", "")
    for key in (f"{name}_model", f"{getattr(provider_cls, 'config_key', '')}_model"):
        if key and isinstance(cfg.get(key), str) and cfg[key].strip():
            return cfg[key].strip()
    return ""


# === 公共工具 ===

MIME_MAP = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png",
            ".webp": "webp", ".bmp": "bmp", ".gif": "gif"}


def encode_image(image_path):
    """图片 → base64 data URL。"""
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"图片不存在: {image_path}")
    ext = path.suffix.lower()
    mime = MIME_MAP.get(ext, "jpeg")
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return f"data:image/{mime};base64,{data}"


# === 业务函数（这两个函数由具体 skill 改写） ===

def build_prompt():
    """构造发给模型的 prompt。视觉类通常是：文字指令 + 图片 URL。"""
    raise NotImplementedError("请替换为你的业务 prompt")


def parse_response(api_result):
    """把 OpenAI 兼容格式的返回，解析成你的业务结构体。"""
    raise NotImplementedError("请替换为你的业务解析逻辑")


# === Provider 抽象基类 ===

class Provider:
    name: str = ""
    display_name: str = ""      # 给用户看的中文名（报告 footer / 自检展示用）
    env_var: str = ""           # 优先从这个环境变量找 api_key
    config_key: str = ""        # 备选：从 config 文件找
    default_base_url: str = ""
    default_model: str = ""
    is_free: bool = False

    def __init__(self, api_key, base_url=None, model=None, **kwargs):
        if not api_key:
            raise ValueError(f"{self.name} 需要 API Key，但未提供")
        self.api_key = api_key
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.model = model or self.default_model
        self.extra = kwargs

    def _call_api(self, payload):
        """发请求、返回 OpenAI 兼容格式的 chat completion JSON。子类覆盖。"""
        raise NotImplementedError

    def analyze(self, image_path):
        """主入口：拿图片、调 API、解析为业务结果。"""
        image_data_url = encode_image(image_path)
        payload = {
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                    {"type": "text", "text": build_prompt()},
                ],
            }],
            "temperature": 0.1,
            "max_tokens": 800,
        }
        try:
            api_result = self._call_api(payload)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"{self.name} 调用失败: {e}") from e
        result = parse_response(api_result)
        result["provider"] = self.name
        result["provider_display"] = self.display_name or self.name
        result["provider_model"] = self.model
        return result


# === 通用 OpenAI 兼容 Provider（可直接接百炼网关） ===

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
            raise RuntimeError(f"HTTP {e.code}: {body}") from e


# === 百炼 Provider（复用 OpenAI 兼容逻辑，只改默认网关） ===

class QianwenBailianProvider(OpenAICompatibleProvider):
    name = "qwen-bailian"
    display_name = "阿里百炼"
    env_var = "BAILIAN_API_KEY"
    config_key = "bailian_api_key"
    # 默认公网网关；私有网关请在 config 里用 qwen-bailian_base_url 覆盖
    default_base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    default_model = "qwen-vl-max"


# === 自动选源工厂 ===

def _find_key_for_provider(provider_cls, cfg):
    inst = provider_cls.__dict__.get("env_var")
    if inst:
        k = os.environ.get(inst, "").strip()
        if k:
            return k, "env", _cfg_base_url(cfg, provider_cls), _cfg_model(cfg, provider_cls)
    inst_cfg = provider_cls.__dict__.get("config_key")
    if inst_cfg and isinstance(cfg.get(inst_cfg), str) and cfg[inst_cfg].strip():
        return cfg[inst_cfg].strip(), "config", _cfg_base_url(cfg, provider_cls), _cfg_model(cfg, provider_cls)
    return "", "", "", ""


def get_available_providers(skill_name="pet_store_emotion", candidates=None):
    """按「免费→付费」顺序列出能找到 key 的 provider。"""
    if candidates is None:
        candidates = [QianwenBailianProvider, OpenAICompatibleProvider]
    cfg = _load_config(skill_name)
    available = []
    for cls in candidates:
        key, source, base_url, model = _find_key_for_provider(cls, cfg)
        if key:
            available.append((cls, key, source, base_url, model))
    return available


def get_provider_by_name(name, skill_name="pet_store_emotion", api_key=None, **kwargs):
    """按名字取 provider 实例。api_key=None 时自动找。"""
    table = {
        "qwen-bailian": QianwenBailianProvider,
        "bailian": QianwenBailianProvider,
        "openai": OpenAICompatibleProvider,
    }
    cls = table.get(name.lower())
    if not cls:
        raise ValueError(f"未知的 provider: {name}。可选: {list(table.keys())}")
    cfg = _load_config(skill_name)
    if not api_key:
        api_key, _, base_url, model = _find_key_for_provider(cls, cfg)
    else:
        base_url = _cfg_base_url(cfg, cls)
        model = _cfg_model(cfg, cls)
    kwargs.setdefault("base_url", base_url)
    kwargs.setdefault("model", model)
    return cls(api_key=api_key, **kwargs)


if __name__ == "__main__":
    # 自检：列出当前可用源
    avail = get_available_providers()
    if not avail:
        print("❌ 没找到任何可用 provider。请配置 key（环境变量或 ~/.workbuddy/config/*.json）")
    else:
        print(f"✅ 找到 {len(avail)} 个可用源：")
        for cls, key, src, base_url, model in avail:
            masked = key[:6] + "…" + key[-4:] if len(key) > 12 else "***"
            print(f"  - {cls.display_name} ({cls.name})  {masked}  ({src})")
