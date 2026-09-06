"""Provider 抽象基类 + 公共函数。

所有视觉 API provider 都继承 BaseProvider，只需要实现：
- name (类属性)
- env_var / config_key (类属性)
- default_base_url / default_model (类属性)
- _call_api (实例方法，发送请求拿回原始 JSON)
"""

import base64
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

# --- 公共常量（与原脚本保持完全一致，保证报告渲染不破坏） ---
EMOTIONS = ["快乐", "悲伤", "愤怒", "恐惧", "放松", "警觉"]
EMOTION_EMOJI = {
    "快乐": "😊", "悲伤": "😢", "愤怒": "😠",
    "恐惧": "😨", "放松": "😌", "警觉": "🧐"
}
EMOTION_COLORS = {
    "快乐": "#4CAF50", "悲伤": "#2196F3", "愤怒": "#F44336",
    "恐惧": "#FF9800", "放松": "#8BC34A", "警觉": "#9C27B0"
}
EMOTION_TO_LEVEL = {
    "快乐": "green", "放松": "green",
    "警觉": "yellow", "恐惧": "yellow", "悲伤": "yellow",
    "愤怒": "red",
}
LEVEL_LABEL = {
    "green": "🟢 绿灯 · 可服务",
    "yellow": "🟡 黄灯 · 先安抚再操作",
    "red": "🔴 红灯 · 拒接/转诊",
}
LEVEL_COLOR = {
    "green": "#4CAF50", "yellow": "#FF9800", "red": "#F44336",
}
MIME_MAP = {
    ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png",
    ".webp": "webp", ".bmp": "bmp", ".gif": "gif"
}

EMOTION_FIELDS = [
    "species", "emotion", "confidence", "safety_level",
    "reason", "service_advice", "sales_advice",
    "soothe_script", "risk_warning"
]


def build_prompt():
    """门店版分析 prompt——所有 provider 共用，保证输出风格统一。"""
    return """你是一位专业的宠物门店服务顾问兼宠物行为分析师。请分析这张照片中宠物的情绪状态，并给宠物门店（洗澡/美容/寄养/商品销售）的经营建议。

分析步骤：
1. 先判断图片中是否有猫或狗（没有则 species=unknown）
2. 观察面部表情（眼睛、耳朵、嘴巴）和身体姿态（尾巴、背部、四肢）
3. 判断情绪状态
4. 根据情绪给出门店经营建议

情绪分类（6选1）：
- 快乐：放松愉悦，摇尾巴、瞒眼、张嘴似笑
- 悲伤：耷拉耳朵、蜷缩、无精打采、回避镜头
- 愤怒：龇牙、竖毛、耳朵后压、身体僵硬
- 恐惧：夹尾、躲藏、瞳孔放大、身体低伏
- 放松：瞒眼打盹、肚皮朝上、完全舒展
- 警觉：竖耳凝视、身体紧绷、尾巴直立

情绪→门店安全灯号映射：
- 快乐、放松 → green（绿灯，可正常服务）
- 警觉、恐惧、悲伤 → yellow（黄灯，先安抚再操作）
- 愤怒 → red（红灯，拒接/转诊，安全第一）

请严格返回以下JSON格式，不要包含任何其他内容：
{"species":"dog|cat|unknown","emotion":"快乐|悲伤|愤怒|恐惧|放松|警觉","confidence":0.0-1.0,"safety_level":"green|yellow|red","reason":"判断依据（20字内）","service_advice":"服务建议：能否洗护/寄养/美容，怎么操作（30字内）","sales_advice":"销售机会：现在能不能推、推什么（30字内）","soothe_script":"安抚话术：对主人说的一句话（30字内）","risk_warning":"风险提示：红灯时必填，其他填无"}"""


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


def parse_response(api_result):
    """统一解析 OpenAI 兼容格式的 chat completion 返回。"""
    try:
        content = api_result["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        result = json.loads(content)

        species = result.get("species", "unknown")
        emotion = result.get("emotion", "未知")
        confidence = float(result.get("confidence", 0.5))
        safety_level = result.get("safety_level", EMOTION_TO_LEVEL.get(emotion, "yellow"))
        if emotion not in EMOTIONS:
            emotion = "未知"
            safety_level = "yellow"

        return {
            "species": species,
            "emotion": emotion,
            "confidence": min(max(confidence, 0.0), 1.0),
            "safety_level": safety_level,
            "reason": result.get("reason", "无法判断"),
            "service_advice": result.get("service_advice", ""),
            "sales_advice": result.get("sales_advice", ""),
            "soothe_script": result.get("soothe_script", ""),
            "risk_warning": result.get("risk_warning", ""),
            "emoji": EMOTION_EMOJI.get(emotion, "❓"),
            "color": EMOTION_COLORS.get(emotion, "#999"),
            "level_label": LEVEL_LABEL.get(safety_level, LEVEL_LABEL["yellow"]),
            "level_color": LEVEL_COLOR.get(safety_level, "#FF9800"),
            "raw": result,
        }
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        raw_text = api_result.get("choices", [{}])[0].get("message", {}).get("content", str(api_result))
        return {
            "species": "unknown",
            "emotion": "未知",
            "confidence": 0.0,
            "safety_level": "yellow",
            "reason": f"解析失败: {str(e)[:50]}",
            "service_advice": "",
            "sales_advice": "",
            "soothe_script": "",
            "risk_warning": "",
            "emoji": "❓",
            "color": "#999",
            "level_label": LEVEL_LABEL["yellow"],
            "level_color": "#FF9800",
            "raw": {"error": str(e), "raw_text": raw_text[:200]},
        }


class Provider:
    """所有视觉 API provider 的抽象基类。"""

    name: str = ""
    display_name: str = ""      # 给用户看的中文名（报告 footer / 自检展示用）
    env_var: str = ""           # 优先从这个环境变量找 api key
    config_key: str = ""        # 备选：从 ~/.workbuddy/config/pet_store_emotion.json 找
    default_base_url: str = ""
    default_model: str = ""
    is_free: bool = False       # 是否标注免费（仅用于提示）

    def __init__(self, api_key, base_url=None, model=None, **kwargs):
        if not api_key:
            raise ValueError(f"{self.name} 需要 API Key，但未提供")
        self.api_key = api_key
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.model = model or self.default_model
        self.extra = kwargs  # 子类用，如 modelscope 的 chinese_template

    # --- 子类必须实现：实际 HTTP 调用 ---
    def _call_api(self, payload):
        """发请求、返回 OpenAI 兼容格式的 chat completion JSON。子类覆盖。"""
        raise NotImplementedError

    def analyze(self, image_path):
        """主入口：拿图片、调 API、解析为门店经营结构化结果。"""
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
        result["provider"] = self.name  # 标记用了哪个 provider
        result["provider_display"] = self.display_name or self.name
        result["provider_model"] = self.model
        return result


# --- 自动挑选 provider（核心逻辑） ---

def _load_config():
    """读 ~/.workbuddy/config/pet_store_emotion.json。"""
    config_paths = [
        os.path.expanduser("~/.workbuddy/config/pet_store_emotion.json"),
        os.path.expanduser("~/.workbuddy/config/dashscope.json"),
    ]
    for p in config_paths:
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def _cfg_base_url(cfg, provider_cls):
    """从配置读指定 provider 的 endpoint（约定字段：{name}_base_url）。"""
    name = getattr(provider_cls, "name", "")
    for key in (f"{name}_base_url", f"{getattr(provider_cls, 'config_key', '')}_base_url"):
        if key and isinstance(cfg.get(key), str) and cfg[key].strip():
            return cfg[key].strip()
    return ""


def _cfg_model(cfg, provider_cls):
    """从配置读指定 provider 的模型（约定字段：{name}_model）。"""
    name = getattr(provider_cls, "name", "")
    for key in (f"{name}_model", f"{getattr(provider_cls, 'config_key', '')}_model"):
        if key and isinstance(cfg.get(key), str) and cfg[key].strip():
            return cfg[key].strip()
    return ""


def _find_key_for_provider(provider_cls):
    """按优先级给指定 provider 类找 key：环境变量 → 配置文件 → 空字符串。
    同时返回配置文件里的 base_url / model（如有）。"""
    cfg = _load_config()
    inst = provider_cls.__dict__.get("env_var")
    if inst:
        k = os.environ.get(inst, "").strip()
        if k:
            return k, "env", _cfg_base_url(cfg, provider_cls), _cfg_model(cfg, provider_cls)
    inst_cfg = provider_cls.__dict__.get("config_key")
    if inst_cfg and isinstance(cfg.get(inst_cfg), str) and cfg[inst_cfg].strip():
        return cfg[inst_cfg].strip(), "config", _cfg_base_url(cfg, provider_cls), _cfg_model(cfg, provider_cls)
    if inst and isinstance(cfg.get(inst), str) and cfg[inst].strip():
        return cfg[inst].strip(), "config", _cfg_base_url(cfg, provider_cls), _cfg_model(cfg, provider_cls)
    return "", "", "", ""


def get_available_providers():
    """按"免费→付费"顺序列出能找到 key 的 provider。"""
    from .qwen_dashscope import QianwenDashScopeProvider
    from .modelscope import ModelScopeProvider
    from .qwen_bailian import QianwenBailianProvider
    from .openai_vision import OpenAICompatibleProvider

    candidates = [
        ModelScopeProvider,      # 免费，优先
        QianwenDashScopeProvider,
        QianwenBailianProvider,
        OpenAICompatibleProvider,
    ]
    available = []
    for cls in candidates:
        key, source, base_url, model = _find_key_for_provider(cls)
        if key:
            available.append((cls, key, source, base_url, model))
    return available


def get_provider_by_name(name, api_key=None, **kwargs):
    """按名字取 provider 实例。api_key=None 时自动找。"""
    from .qwen_dashscope import QianwenDashScopeProvider
    from .modelscope import ModelScopeProvider
    from .qwen_bailian import QianwenBailianProvider
    from .openai_vision import OpenAICompatibleProvider

    table = {
        "qwen-dashscope": QianwenDashScopeProvider,
        "dashscope": QianwenDashScopeProvider,         # 兼容旧名
        "qwen-bailian": QianwenBailianProvider,
        "bailian": QianwenBailianProvider,
        "modelscope": ModelScopeProvider,
        "openai": OpenAICompatibleProvider,
    }
    cls = table.get(name.lower())
    if not cls:
        raise ValueError(f"未知的 provider: {name}。可选: {list(table.keys())}")
    cfg = _load_config()
    if not api_key:
        api_key, _, base_url, model = _find_key_for_provider(cls)
    else:
        base_url = _cfg_base_url(cfg, cls)
        model = _cfg_model(cfg, cls)
    kwargs.setdefault("base_url", base_url)
    kwargs.setdefault("model", model)
    return cls(api_key=api_key, **kwargs)
