"""
古人智慧团 · 多轮对话引擎
===========================

六位历史顾问（孙子/范蠡/诸葛亮/管子/曾国藩/胡雪岩）的 B 端经营咨询 chat 服务。

设计要点：
  - 顾问配置驱动：gu_packs/*.json 一顾问一配置（商用版系统提示词取自 skill 包 QA 版），
    改配置热更新，与 gen_engine 同款 mtime 热加载；_routing.json 为场景路由表。
  - 多轮会话：内存会话表（conv_id → 消息历史），TTL 过期惰性清理；
    上下文截断到 GU_MAX_CONTEXT_MESSAGES 条，控制 token 成本。
  - SSE 流式：DeepSeek stream=true 增量输出，前端打字机渲染。
  - 计费开关：GU_POINTS_PER_CALL=0 为免费体验期（不扣点不留痕），>0 按次扣点
    （调用方先扣，流式失败全额返还，与 gen/twin 计费纪律一致）。
  - 回复格式：四段结构（段标记独占一行），段标记由配置 head 字段 + 固定后三段组成，
    前端按段渲染成卡片；服务端自动附加 AI 生成声明（comply），不依赖模型输出。
"""
import json
import os
import re
import threading
import time
import urllib.request
import uuid
from datetime import date
from typing import Dict, Generator, List, Optional, Tuple

from config import get_settings
from db import SessionLocal, change_balance
from gu_models import GuQuota

settings = get_settings()

GU_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gu_packs")

# 会话表
_convs: Dict[str, dict] = {}
_lock = threading.Lock()
_last_sweep = 0.0


# ---------------------------------------------------------------------------
# 配置加载（mtime 热更新，改 JSON 不用重启）
# ---------------------------------------------------------------------------

_packs_cache: Dict[str, dict] = {}
_packs_mtime: float = 0.0
_routing_cache: Optional[dict] = None


def _load_gu(force: bool = False) -> Dict[str, dict]:
    global _packs_cache, _packs_mtime
    try:
        latest = max(
            (os.path.getmtime(os.path.join(GU_DIR, f)) for f in os.listdir(GU_DIR)
             if f.endswith(".json")),
            default=0.0,
        )
    except FileNotFoundError:
        return _packs_cache
    if not force and latest <= _packs_mtime and _packs_cache:
        return _packs_cache
    packs: Dict[str, dict] = {}
    for fn in sorted(os.listdir(GU_DIR)):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        path = os.path.join(GU_DIR, fn)
        try:
            with open(path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"[gu] 配置 {fn} 解析失败：{e}", flush=True)
            continue
        gu_id = cfg.get("gu_id")
        if not gu_id:
            print(f"[gu] 配置 {fn} 缺 gu_id，跳过", flush=True)
            continue
        packs[gu_id] = cfg
    _packs_cache = packs
    _packs_mtime = latest
    print(f"[gu] 已加载 {len(packs)} 位顾问配置", flush=True)
    return packs


def get_gu(gu_id: str) -> Optional[dict]:
    return _load_gu().get(gu_id)


def list_gu() -> List[dict]:
    """公开字段清单（system_prompt 不下发）。顺序按配置名排序，稳定。"""
    out = []
    for p in _load_gu().values():
        out.append({
            "gu_id": p.get("gu_id"),
            "name": p.get("name"),
            "avatar_char": p.get("avatar_char", p.get("name", "?")[0]),
            "discipline": p.get("discipline", ""),
            "tag": p.get("tag", ""),
            "greeting": p.get("greeting", ""),
            "comply": p.get("comply", ""),
            "correction": p.get("correction", ""),
            "trusted_books": p.get("trusted_books", []),
            "enabled": bool(p.get("enabled", True)),
        })
    return out


def get_routing() -> dict:
    global _routing_cache
    if _routing_cache is not None:
        return _routing_cache
    path = os.path.join(GU_DIR, "_routing.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            _routing_cache = json.load(f)
    except Exception as e:
        print(f"[gu] 路由表缺失或解析失败：{e}", flush=True)
        _routing_cache = {"routes": [], "keywords": []}
    return _routing_cache


def routing_version() -> str:
    """路由表 mtime，改表即变，前端可据此刷新（预留）。"""
    try:
        return str(int(os.path.getmtime(os.path.join(GU_DIR, "_routing.json"))))
    except OSError:
        return "0"


# ---------------------------------------------------------------------------
# 会话管理
# ---------------------------------------------------------------------------

def _sweep_expired() -> None:
    """惰性清理过期会话（TTL 从 settings 读）。"""
    global _last_sweep
    now = time.time()
    if now - _last_sweep < 60:
        return
    _last_sweep = now
    ttl = max(1, int(settings.GU_CONV_TTL_HOURS or 6)) * 3600
    stale = [cid for cid, c in _convs.items() if now - c["last_at"] > ttl]
    for cid in stale:
        _convs.pop(cid, None)


def _trim_history(messages: List[dict]) -> List[dict]:
    """截断上下文：保留最近 N 条（偶数对齐，避免截半个来回）。"""
    cap = max(4, int(settings.GU_MAX_CONTEXT_MESSAGES or 16))
    if len(messages) <= cap:
        return messages
    trimmed = messages[-cap:]
    if trimmed and trimmed[0]["role"] != "user":
        trimmed = trimmed[1:]
    return trimmed


def open_conv(api_key: str, gu_id: str, conv_id: str, message: str) -> str:
    """打开（或新建）会话并追加用户消息。

    归属校验：会话仅限创建者本人续聊。非法抛异常：
      KeyError  会话不存在 / 顾问不匹配
      PermissionError 不是你的会话
    """
    if not message or not message.strip():
        raise ValueError("消息不能为空")
    with _lock:
        _sweep_expired()
        conv = _convs.get(conv_id or "")
        if conv_id:
            if not conv:
                raise KeyError(f"会话不存在或已过期：{conv_id}")
            if conv["api_key"] != api_key:
                raise PermissionError("这不是你的会话")
            if conv["gu_id"] != gu_id:
                raise KeyError("会话与顾问不匹配，请新开对谈")
        else:
            conv_id = "gc_" + uuid.uuid4().hex[:16]
            conv = {
                "conv_id": conv_id,
                "gu_id": gu_id,
                "api_key": api_key,
                "messages": [],
                "created_at": time.time(),
                "last_at": time.time(),
                "turns": 0,
            }
            _convs[conv_id] = conv
        conv["messages"].append({"role": "user", "content": message.strip()})
        conv["last_at"] = time.time()
        conv["turns"] += 1
        return conv_id


def _append_assistant(conv_id: str, text: str) -> None:
    with _lock:
        conv = _convs.get(conv_id)
        if conv:
            conv["messages"].append({"role": "assistant", "content": text})
            conv["last_at"] = time.time()


def get_history(api_key: str, conv_id: str) -> dict:
    with _lock:
        conv = _convs.get(conv_id or "")
        if not conv:
            raise KeyError(f"会话不存在或已过期：{conv_id}")
        if conv["api_key"] != api_key:
            raise PermissionError("这不是你的会话")
        return {
            "conv_id": conv_id,
            "gu_id": conv["gu_id"],
            "created_at": conv["created_at"],
            "turns": conv["turns"],
            "messages": [
                {"role": m["role"], "content": m["content"]} for m in conv["messages"]
            ],
        }


# ---------------------------------------------------------------------------
# 系统提示词组装
# ---------------------------------------------------------------------------

CHAT_FORMAT_RULE = (
    "\n\n# 多轮对话与输出格式（系统级，最高优先级）\n"
    "1. 保持角色人格一致，记住本轮会话中用户说过的经营信息，跨话题不串味。\n"
    "2. 每条回复必须完整输出以下四段，四段缺一不可，段标记独占一行、一字不改：\n"
    "【{head}】\n"
    "（若引原文：先单独一行写引文，原句用「」包裹，如「知彼知己，百战不殆」；\n"
    "下一行写书名出处，格式如——《孙子兵法·谋攻篇》。不要输出「引文」「出处」等字样标签。"
    "无引文则直接写判断。）\n"
    "【经营映射】\n"
    "【可执行动作】\n"
    "（1-3 条，每条以①②③开头，具体可落地）\n"
    "【风险提示】\n"
    "3. 即使是追问或简短回应，也必须四段俱全，不得省略任何一段；"
    "段标记之外不要输出任何标题、表格、代码块、开头寒暄或结尾总结；"
    "不要输出合规声明（系统会自动附加）。\n"
    "4. 回复总长控制在 350-600 字，动作要具体，不说空话。\n"
    "5. 用户表示感谢、认可、寒暄（如「谢谢」「说得好」「辛苦了」）："
    "直接用一句符合角色的话回应（可顺势追问一个经营问题），"
    "绝对不要输出四段段标记，也不要输出空标记。\n"
    "6. 其他与经营无关或涉敏感话题：礼貌说明只答经营问题，"
    "给一个可问的经营方向，不要输出四段段标记。"
)


def build_system_prompt(pack: dict) -> str:
    return pack.get("system_prompt", "") + CHAT_FORMAT_RULE.format(head=pack.get("head", "顾问之见"))


# ---------------------------------------------------------------------------
# DeepSeek 流式调用（OpenAI 兼容 /chat/completions, stream=true）
# ---------------------------------------------------------------------------

def _llm_url() -> str:
    base = (settings.DEEPSEEK_BASE_URL or "").rstrip("/")
    if not base:
        raise RuntimeError("未配置 DEEPSEEK（BASE_URL/API_KEY/MODEL）")
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def llm_stream(messages: List[dict], timeout: int = 90,
               temperature: float = 0.7, max_tokens: int = 2000) -> Generator[str, None, None]:
    """流式调用 DeepSeek，增量 yield 文本片段；异常直接抛出由调用方处理。"""
    key = settings.DEEPSEEK_API_KEY or ""
    model = settings.DEEPSEEK_MODEL or "deepseek-chat"
    if not key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        _llm_url(), data=json.dumps(payload).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "text/event-stream")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        buf = b""
        while True:
            chunk = resp.read(1024)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode("utf-8", "replace").strip()
                if not text.startswith("data:"):
                    continue
                data = text[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                    delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        yield piece
                except (json.JSONDecodeError, IndexError, AttributeError):
                    continue


# ---------------------------------------------------------------------------
# 大厅自由提问 · AI 荐人（关键词路由未命中时的兜底，不扣次数不留痕）
# ---------------------------------------------------------------------------

_ROUTE_HINT = (
    "你是「古人经营智慧」大厅的知客，只做一件事：把老板的难处指给最对路的一位先生。\n"
    "在席六位先生：\n{roster}\n"
    "只输出一行 JSON：{{\"gu_id\":\"先生ID\",\"reason\":\"不超过20字的说辞\"}}，"
    "不要任何其他文字。"
)


def route_once(message: str) -> Tuple[str, str]:
    """LLM 荐人：返回 (gu_id, reason)；选不出返回 ('','')，由调用方兜底。"""
    packs = _load_gu()
    roster = "\n".join(
        f"- {p.get('gu_id')}｜{p.get('name')}｜{p.get('discipline', '')}｜擅长：{p.get('tag', '')}"
        for p in packs.values() if p.get("enabled", True)
    )
    out = ""
    try:
        for piece in llm_stream(
            [
                {"role": "system", "content": _ROUTE_HINT.format(roster=roster)},
                {"role": "user", "content": (message or "").strip()[:500]},
            ],
            timeout=30, temperature=0.2, max_tokens=512,  # 推理模型思考也要占 token，80 会全部耗在 reasoning 上导致正文为空
        ):
            out += piece
    except Exception as e:
        print(f"[gu] 荐人路由失败：{e}", flush=True)
        return "", ""
    m = re.search(r"\{[^{}]*\}", out)
    if not m:
        return "", ""
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return "", ""
    gu_id = str(obj.get("gu_id") or "").strip()
    reason = str(obj.get("reason") or "").strip()[:60]
    pack = packs.get(gu_id)
    if not pack or not pack.get("enabled", True):
        return "", ""
    return gu_id, reason


# ---------------------------------------------------------------------------
# 计费（GU_POINTS_PER_CALL>0 时启用；免费体验期为 0）
# ---------------------------------------------------------------------------

def refund_cost(api_key: str, cost: int, note: str = "") -> None:
    """流式失败全额返还（独立 db 会话，与 gen_engine 失败返还同款）。"""
    if cost <= 0:
        return
    try:
        db = SessionLocal()
        try:
            change_balance(db, api_key, cost, "返还", note=note or "顾问问答失败返还")
        finally:
            db.close()
    except Exception as e:
        print(f"[gu] 返还点数失败：{e}", flush=True)


# ---------------------------------------------------------------------------
# 每日免费配额（免费体验期生效；GU_DAILY_FREE_CALLS=0 表示不限次）
# ---------------------------------------------------------------------------

class QuotaExceeded(Exception):
    """当日免费次数已用完。"""

    def __init__(self, limit: int):
        self.limit = limit
        super().__init__(f"今日 {limit} 次免费额度已用完，明天再来")


def _quota_row(db, api_key: str, today: str) -> GuQuota:
    row = (db.query(GuQuota)
             .filter(GuQuota.api_key == api_key, GuQuota.quota_date == today)
             .first())
    if not row:
        row = GuQuota(api_key=api_key, quota_date=today, used_count=0)
        db.add(row)
        db.flush()
    return row


def quota_left(api_key: str) -> Optional[int]:
    """今日剩余免费次数；不限次返回 None。"""
    limit = int(settings.GU_DAILY_FREE_CALLS or 0)
    if limit <= 0:
        return None
    db = SessionLocal()
    try:
        row = (db.query(GuQuota)
                 .filter(GuQuota.api_key == api_key, GuQuota.quota_date == date.today().isoformat())
                 .first())
        used = row.used_count if row else 0
        return max(0, limit - used)
    finally:
        db.close()


def consume_daily_quota(api_key: str) -> int:
    """消耗一次当日免费额度，返回剩余次数；超限抛 QuotaExceeded。"""
    limit = int(settings.GU_DAILY_FREE_CALLS or 0)
    if limit <= 0:
        return -1  # 不限次
    db = SessionLocal()
    try:
        row = _quota_row(db, api_key, date.today().isoformat())
        if row.used_count >= limit:
            db.rollback()
            raise QuotaExceeded(limit)
        row.used_count += 1
        db.commit()
        return max(0, limit - row.used_count)
    except QuotaExceeded:
        raise
    except Exception as e:
        db.rollback()
        print(f"[gu] 配额计次失败（放行）：{e}", flush=True)
        return -1  # 计次故障不拦用户
    finally:
        db.close()


def refund_daily_quota(api_key: str) -> None:
    """流式失败返还当日次数（与返还点数同款纪律）。"""
    limit = int(settings.GU_DAILY_FREE_CALLS or 0)
    if limit <= 0:
        return
    db = SessionLocal()
    try:
        row = _quota_row(db, api_key, date.today().isoformat())
        if row.used_count > 0:
            row.used_count -= 1
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[gu] 返还配额失败：{e}", flush=True)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 流式问答主流程
# ---------------------------------------------------------------------------

def chat_stream(pack: dict, conv_id: str, cost: int = 0, quota_used: bool = False) -> Generator[Tuple[str, dict], None, None]:
    """生成器：yield (event, data) 事件流。

    event: meta / delta / done / error
    计费纪律：cost>0 时失败在此处全额返还点数（扣点发生在路由层、流开始前）；
    免费模式下 quota_used=True 时失败返还当日次数。
    """
    gu_id = pack.get("gu_id", "?")
    api_key = ""
    try:
        with _lock:
            conv = _convs.get(conv_id)
            api_key = conv["api_key"] if conv else ""
            history = [dict(m) for m in (conv["messages"] if conv else [])]
        messages = [{"role": "system", "content": build_system_prompt(pack)}]
        messages += _trim_history(history)

        yield ("meta", {
            "conv_id": conv_id,
            "gu_id": gu_id,
            "name": pack.get("name"),
            "head": pack.get("head"),
            "comply": pack.get("comply", ""),
            "cost": cost,
            "quota_left": quota_left(api_key) if quota_used else None,
        })

        full = []
        for piece in llm_stream(
            messages,
            timeout=int(settings.GU_TIMEOUT or 90),
            temperature=float(pack.get("temperature", 0.7)),
            max_tokens=int(pack.get("max_tokens", 2000)),
        ):
            full.append(piece)
            yield ("delta", {"text": piece})

        reply = "".join(full).strip()
        if not reply:
            raise RuntimeError("模型返回空内容")
        _append_assistant(conv_id, reply)
        yield ("done", {"conv_id": conv_id, "chars": len(reply), "cost": cost,
                        "quota_left": quota_left(api_key) if quota_used else None})
    except Exception as e:
        print(f"[gu:{gu_id}] 问答失败：{e}", flush=True)
        if cost > 0 and api_key:
            refund_cost(api_key, cost, note=f"古人经营智慧·{pack.get('name')}失败返还")
        if quota_used and api_key:
            refund_daily_quota(api_key)
        yield ("error", {"message": str(e)[:200]})
