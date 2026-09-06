#!/usr/bin/env python3
"""宠物门店情绪识别 —— AI 驱动的宠物进店情绪 + 门店经营建议分析器。

从「宠物情绪识别」原技能蒸馏改造：把输出从「给主人的互动建议」
升级为「给宠物门店的：安全灯号 + 服务建议 + 销售机会 + 安抚话术 + 风险提示」。

多源视觉 API 设计（2026-08 改造）：
- 默认按"免费 → 付费"顺序自动挑选可用的 provider
- 可通过 --provider xxx 强制指定
- 不再依赖 DashScope 单点（其控制台已下线）

Usage:
    # 自动选源（推荐）
    python pet_store_emotion.py --image pet.jpg
    # 指定 provider
    python pet_store_emotion.py --image pet.jpg --provider modelscope
    # 看当前可用的 provider
    python pet_store_emotion.py --list-providers
    # 自检（不调 API，只验证 Key 拿得到）
    python pet_store_emotion.py --check
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

# --- 全部从 providers.base 导入常量，保证报告渲染与解析逻辑单一来源 ---
sys.path.insert(0, str(Path(__file__).parent))
from providers.base import (
    EMOTIONS, EMOTION_EMOJI, EMOTION_COLORS, EMOTION_TO_LEVEL,
    LEVEL_LABEL, LEVEL_COLOR, MIME_MAP, encode_image,
    get_available_providers, get_provider_by_name,
    Provider,
)
# 重新导出（保留对外 API 兼容，方便旧调用方）
parse_response = None  # 实际由 Provider 调用，这里仅占位
__all__ = [
    "EMOTIONS", "EMOTION_EMOJI", "EMOTION_COLORS", "EMOTION_TO_LEVEL",
    "LEVEL_LABEL", "LEVEL_COLOR", "MIME_MAP",
    "encode_image", "get_available_providers", "get_provider_by_name", "Provider",
    "generate_html_report", "generate_summary", "main",
]


# --- 兼容旧调用方式的顶层函数（旧脚本可能直接 import） ---

def find_api_key():
    """兼容旧 API：返回第一个找到的 key 字符串。
    ⚠️ 多源体系下不再推荐用这个，建议改用 get_available_providers() / get_provider_by_name()。
    """
    for cls, key, _src in get_available_providers():
        return key
    return ""


def call_dashscope(api_key, image_data_url, model="qwen-vl-max"):
    """兼容旧 API：直接调 DashScope。
    ⚠️ 后续请改用 get_provider_by_name(\"qwen-dashscope\").analyze(image_path)。
    """
    from providers.qwen_dashscope import QianwenDashScopeProvider
    p = QianwenDashScopeProvider(api_key=api_key, model=model)
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_data_url}},
                {"type": "text", "text": "请分析图中宠物情绪，返回 JSON。"},
            ],
        }],
        "temperature": 0.1,
        "max_tokens": 800,
    }
    return p._call_api(payload)


# --- 报告生成（与原脚本完全相同，保证 HTML 输出不破坏） ---

def generate_html_report(result, image_path, output_path):
    """生成门店版 HTML 报告。"""
    template_path = Path(__file__).parent.parent / "assets" / "report_template.html"
    if template_path.exists():
        with open(template_path, encoding="utf-8") as f:
            html = f.read()
    else:
        html = _get_default_template()

    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    ext = Path(image_path).suffix.lower()
    mime = MIME_MAP.get(ext, "jpeg")
    img_src = f"data:image/{mime};base64,{img_b64}"

    emotion_distribution = []
    for e in EMOTIONS:
        if result["emotion"] != "未知":
            val = result["confidence"] if e == result["emotion"] else round((1 - result["confidence"]) / (len(EMOTIONS) - 1), 2)
        else:
            val = round(1 / len(EMOTIONS), 2)
        emotion_distribution.append({
            "name": e,
            "value": val,
            "color": EMOTION_COLORS.get(e, "#999"),
            "emoji": EMOTION_EMOJI.get(e, "❓")
        })

    html = html.replace("{{IMAGE_SRC}}", img_src)
    html = html.replace("{{SPECIES}}", result.get("species", "unknown"))
    html = html.replace("{{SPECIES_LABEL}}", {"dog": "🐕 狗狗", "cat": "🐈 猫咪"}.get(result.get("species"), "❓ 未知"))
    html = html.replace("{{EMOTION}}", result.get("emotion", "未知"))
    html = html.replace("{{EMOTION_EMOJI}}", result.get("emoji", "❓"))
    html = html.replace("{{CONFIDENCE}}", str(int(result.get("confidence", 0) * 100)))
    html = html.replace("{{CONFIDENCE_DECIMAL}}", str(result.get("confidence", 0)))
    html = html.replace("{{LEVEL_LABEL}}", result.get("level_label", ""))
    html = html.replace("{{LEVEL_COLOR}}", result.get("level_color", "#FF9800"))
    html = html.replace("{{REASON}}", result.get("reason", ""))
    html = html.replace("{{SERVICE_ADVICE}}", result.get("service_advice", ""))
    html = html.replace("{{SALES_ADVICE}}", result.get("sales_advice", ""))
    html = html.replace("{{SOOTHE_SCRIPT}}", result.get("soothe_script", ""))
    html = html.replace("{{RISK_WARNING}}", result.get("risk_warning", ""))
    html = html.replace("{{COLOR}}", result.get("color", "#999"))
    html = html.replace("{{TIMESTAMP}}", time.strftime("%Y-%m-%d %H:%M:%S"))
    html = html.replace("{{PROVIDER}}", result.get("provider", "unknown"))
    html = html.replace("{{PROVIDER_DISPLAY}}", result.get("provider_display", result.get("provider", "未知")))
    html = html.replace("{{PROVIDER_MODEL}}", result.get("provider_model", ""))
    html = html.replace("{{EMOTION_DISTRIBUTION}}", json.dumps(emotion_distribution, ensure_ascii=False))
    html = html.replace("{{RESULT_JSON}}", json.dumps({
        "reason": result.get("reason", ""),
        "service_advice": result.get("service_advice", ""),
        "sales_advice": result.get("sales_advice", ""),
        "soothe_script": result.get("soothe_script", ""),
        "risk_warning": result.get("risk_warning", ""),
        "emotion": result.get("emotion", ""),
        "color": result.get("color", "#999"),
        "level_color": result.get("level_color", "#FF9800")
    }, ensure_ascii=False))

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    return output_path


def _get_default_template():
    """兜底模板（无 assets/report_template.html 时使用）。"""
    return """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>宠物门店情绪识别报告</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:linear-gradient(135deg,#f5f7fa,#c3cfe2);min-height:100vh;margin:0;display:flex;justify-content:center;padding:20px}
.card{background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.12);max-width:600px;width:100%;overflow:hidden}
.header{background:linear-gradient(135deg,{{LEVEL_COLOR}} 0%,{{LEVEL_COLOR}}dd 100%);color:#fff;padding:30px;text-align:center}
.header .emoji{font-size:64px;display:block;margin-bottom:10px}
.header h1{font-size:22px;margin-bottom:8px}
.header .confidence-bar{background:rgba(255,255,255,.25);border-radius:10px;height:8px;margin-top:10px;overflow:hidden}
.header .confidence-fill{background:#fff;height:100%;border-radius:10px}
.image-section{padding:20px 30px;text-align:center}
.image-section img{max-width:100%;max-height:300px;border-radius:12px}
.info-section{padding:10px 30px 20px}
.info-card{padding:14px 16px;background:#f8f9fa;border-radius:12px;margin-bottom:10px;border-left:4px solid {{LEVEL_COLOR}}}
.footer{text-align:center;padding:15px;color:#bbb;font-size:12px}
</style></head><body>
<div class="card">
<div class="header">
<span class="emoji">{{EMOTION_EMOJI}}</span>
<h1>{{SPECIES_LABEL}} · {{EMOTION}}</h1>
<div style="font-size:15px;font-weight:600;margin-bottom:8px">{{LEVEL_LABEL}}</div>
<div class="confidence-bar"><div class="confidence-fill" style="width:{{CONFIDENCE}}%"></div></div>
</div>
<div class="image-section"><img src="{{IMAGE_SRC}}"></div>
<div class="info-section" id="infoSection"></div>
<div class="footer">🐱🐶 宠物门店情绪识别 · {{TIMESTAMP}} · provider: {{PROVIDER}}</div>
</div>
<script>
var r={{RESULT_JSON}},info=[];
if(r.reason)info.push({i:'🔍',l:'判断依据',v:r.reason});
if(r.service_advice)info.push({i:'🛁',l:'服务建议',v:r.service_advice});
if(r.sales_advice)info.push({i:'💰',l:'销售机会',v:r.sales_advice});
if(r.soothe_script)info.push({i:'🤝',l:'安抚话术',v:r.soothe_script});
if(r.risk_warning)info.push({i:'⚠️',l:'风险提示',v:r.risk_warning});
document.getElementById('infoSection').innerHTML=info.map(function(c){return '<div class="info-card"><div style="font-size:13px;color:#999">'+c.l+'</div><div style="font-size:14px;color:#333;margin-top:4px">'+c.v+'</div></div>';}).join('');
</script></body></html>"""


def generate_summary(result):
    """生成对话文本摘要。"""
    species_label = {"dog": "🐕 狗狗", "cat": "🐈 猫咪"}.get(result.get("species"), "宠物")
    lines = [
        f"## {result['emoji']} 宠物门店情绪识别结果",
        "",
        f"| 项目 | 详情 |",
        f"|------|------|",
        f"| 物种 | {species_label} |",
        f"| 情绪 | {result['emoji']} **{result['emotion']}** |",
        f"| 安全灯号 | **{result.get('level_label', '')}** |",
        f"| 置信度 | **{int(result['confidence'] * 100)}%** |",
        f"| Provider | `{result.get('provider', '?')}` |",
    ]
    if result.get("reason"):
        lines.append(f"| 判断依据 | {result['reason']} |")
    if result.get("service_advice"):
        lines.append(f"| 服务建议 | {result['service_advice']} |")
    if result.get("sales_advice"):
        lines.append(f"| 销售机会 | {result['sales_advice']} |")
    if result.get("soothe_script"):
        lines.append(f"| 安抚话术 | {result['soothe_script']} |")
    if result.get("risk_warning"):
        lines.append(f"| ⚠️ 风险提示 | {result['risk_warning']} |")
    return "\n".join(lines)


# --- CLI 主入口 ---

def _print_providers():
    """列出当前可用的 provider。"""
    avail = get_available_providers()
    print("📡 当前可用的视觉 API 源：\n")
    if not avail:
        print("  ❌ 一个可用源都没找到。")
        print()
        print("  请配置以下任一环境变量（或写入 ~/.workbuddy/config/pet_store_emotion.json）：")
        print("    MODELSCOPE_API_KEY     — 魔搭社区免费 token（推荐）https://modelscope.cn 我的中心")
        print("    BAILIAN_API_KEY        — 阿里百炼新版 https://bailian.console.aliyun.com")
        print("    DASHSCOPE_API_KEY      — 阿里百炼旧版（控制台 2026-09 已下线）")
        print("    OPENAI_API_KEY         — OpenAI / 任意兼容服务")
    else:
        for cls, key, src, base_url, model in avail:
            masked = key[:6] + "…" + key[-4:] if len(key) > 12 else "***"
            free_tag = " 🆓 免费" if getattr(cls, "is_free", False) else ""
            print(f"  ✅ {cls.name:<20} {masked}  （{src}）{free_tag}")
    print()
    print("可用 provider 列表（完整）：")
    from providers.qwen_dashscope import QianwenDashScopeProvider
    from providers.modelscope import ModelScopeProvider
    from providers.qwen_bailian import QianwenBailianProvider
    from providers.openai_vision import OpenAICompatibleProvider
    for c in [ModelScopeProvider, QianwenBailianProvider, QianwenDashScopeProvider, OpenAICompatibleProvider]:
        free = " 🆓" if getattr(c, "is_free", False) else ""
        print(f"   - {c.name}{free}  default_model={c.default_model}  base={c.default_base_url}")
    print()


def main():
    parser = argparse.ArgumentParser(description="宠物门店情绪识别（多源视觉 API）")
    parser.add_argument("--image", help="宠物照片路径")
    parser.add_argument("--output", default=None, help="HTML报告输出路径")
    parser.add_argument("--provider", default=None,
                        help="指定 provider：modelscope | qwen-bailian | qwen-dashscope | openai")
    parser.add_argument("--model", default=None, help="覆盖默认模型名")
    parser.add_argument("--base-url", default=None, help="覆盖默认 endpoint")
    parser.add_argument("--list-providers", action="store_true", help="列出可用 provider 并退出")
    parser.add_argument("--check", action="store_true", help="自检：检查是否能找到可用 Key")
    args = parser.parse_args()

    if args.list_providers:
        _print_providers()
        return

    if args.check:
        avail = get_available_providers()
        if avail:
            print(f"✅ 自检通过：找到 {len(avail)} 个可用 provider")
        for cls, key, src, base_url, model in avail:
            print(f"   - {cls.name} ({src})")
            return 0
        else:
            print("❌ 自检失败：没找到任何可用的 API Key")
            print("   配置任一环境变量后重试")
            return 1

    if not args.image:
        parser.print_help()
        sys.exit(1)

    # --- 自动或指定 provider ---
    if args.provider:
        try:
            provider = get_provider_by_name(
                args.provider,
                api_key=None,
                model=args.model,
                base_url=args.base_url,
            )
        except (ValueError, RuntimeError) as e:
            print(f"ERROR: {e}")
            sys.exit(1)
    else:
        avail = get_available_providers()
        if not avail:
            print("ERROR: 未找到任何可用 provider。请：")
            print("  1) 设置环境变量（如 set MODELSCOPE_API_KEY=你的token），或")
            print("  2) 把 key 写入 ~/.workbuddy/config/pet_store_emotion.json")
            print("  3) 或临时用 --provider modelscope --api-key xxx 指定")
            print()
            print("推荐（免费）: 去 https://modelscope.cn → 我的中心 → 访问令牌")
            sys.exit(1)
        cls, key, src, base_url, model = avail[0]
        provider = cls(api_key=key, model=args.model or model, base_url=args.base_url or base_url)
        print(f"🔍 自动选用 provider: {cls.name} ({src})")

    # --- 输出路径 ---
    if args.output is None:
        img_stem = Path(args.image).stem
        args.output = f"pet_store_emotion_{img_stem}.html"

    if not Path(args.image).exists():
        print(f"ERROR: 图片不存在: {args.image}")
        sys.exit(1)

    print(f"🐱🐶 宠物门店情绪识别中...")
    print(f"   图片: {args.image}")
    print(f"   provider: {provider.name}  model: {provider.model}")

    try:
        result = provider.analyze(args.image)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    if result["species"] == "unknown" and result["emotion"] == "未知":
        print("⚠️ 未能识别到宠物，请确认上传的是猫/狗的清晰照片")
        print(f"   原始返回: {result.get('raw', {})}")
        sys.exit(1)

    output_path = generate_html_report(result, args.image, args.output)

    print()
    print(generate_summary(result))
    print()
    print(f"📄 报告已生成: {output_path}")
    print(f"REPORT_PATH: {os.path.abspath(output_path)}")


if __name__ == "__main__":
    main()
