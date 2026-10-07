"""
周旭数字分身 · 多轮对话引擎
===========================

周旭（股权架构与公司治理专家）的 B 端股权咨询 chat 服务。
与古人经营智慧（gu_engine）同款架构：内存会话 + DeepSeek SSE 流式 + 免费期每日配额。

差异点：
  - 单顾问配置内嵌（系统提示词取自 zhouxu-twin-hub SKILL.md 商用版口径），无需 pack 目录。
  - 五段输出：【诊断判断】【方法论依据】【动作清单】【风险提醒】【下一步】+ 💬 金句。
  - 转人工检测（最高优先级）：用户消息命中真人服务意向 → 直接下发 transfer 事件
    （前端渲染客服活码卡），不调大模型、不扣次数——销售线索优先于一切。
  - 复用 gu_engine.llm_stream（DeepSeek OpenAI 兼容流式）。
"""
import json
import re
import threading
import time
import urllib.request
import uuid
from datetime import date
from typing import Dict, Generator, List, Optional, Tuple

from config import get_settings
from db import SessionLocal, change_balance
from gu_engine import llm_stream, refund_cost
from zx_models import ZxQuota

settings = get_settings()

# 会话表（结构同 gu：conv_id → {api_key, messages, ...}）
_convs: Dict[str, dict] = {}
_lock = threading.Lock()
_last_sweep = 0.0

ADVISOR = {
    "zx_id": "zhouxu-twin",
    "name": "周旭",
    "title": "股权架构与公司治理专家 · 数字分身",
    "role": "连锁CEO教练 · 处理过5家公司股东纠纷的实干家",
    "greeting": ("我是周旭的数字分身——股权架构与公司治理专家。"
                 "架构、治理、激励、控制权、税务、融资，股权的事随便问。"
                 "章程、股东结构、财报要点都能发我——没有尽调就没有发言权，先要数据再下结论。"),
    "comply": "本回答由 AI 基于周旭股权方法论生成，仅供参考，不构成法律意见；落地文本须执业律师审定。",
    "domains": ["股权架构", "公司治理", "股权激励", "控制权", "股权税务", "融资上市"],
}

# ---------------------------------------------------------------------------
# 转人工检测（最高优先级，先于一切；销售线索优先于域守卫）
# ---------------------------------------------------------------------------

_TRANSFER_RX = re.compile(
    r"转人工|人工客服|真人咨询|找真人|真人服务|咨询师上门|入企|驻场|线下咨询|见面聊|当面聊"
    r"|加微信|微信号|联系方式|联系电话|周旭本人|找周旭|找律师|律师审|帮我审|派人|上门服务"
    r"|报价单|签.{0,3}合同|签约合作|商务合作|怎么合作|合作流程|砍价|便宜点|优惠|打折"
)


def is_transfer(message: str) -> bool:
    return bool(_TRANSFER_RX.search(message or ""))


TRANSFER_TEXT = (
    "这事我说了不算——周旭老师的真人咨询 / 入企尽调一年只带有限企业，要走人工评估。"
    "官方客服已经推给你了，备注「股权咨询」优先通过。"
)


# ---------------------------------------------------------------------------
# 会话管理（同 gu_engine：内存表 + TTL 惰性清理 + 归属校验）
# ---------------------------------------------------------------------------

def _sweep_expired() -> None:
    global _last_sweep
    now = time.time()
    if now - _last_sweep < 60:
        return
    _last_sweep = now
    ttl = max(1, int(settings.ZX_CONV_TTL_HOURS or 6)) * 3600
    stale = [cid for cid, c in _convs.items() if now - c["last_at"] > ttl]
    for cid in stale:
        _convs.pop(cid, None)


def _trim_history(messages: List[dict]) -> List[dict]:
    cap = max(4, int(settings.ZX_MAX_CONTEXT_MESSAGES or 16))
    if len(messages) <= cap:
        return messages
    trimmed = messages[-cap:]
    if trimmed and trimmed[0]["role"] != "user":
        trimmed = trimmed[1:]
    return trimmed


def open_conv(api_key: str, conv_id: str, message: str) -> str:
    """打开（或新建）会话并追加用户消息。非法抛 KeyError / PermissionError / ValueError。"""
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
        else:
            conv_id = "zx_" + uuid.uuid4().hex[:16]
            conv = {
                "conv_id": conv_id,
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
            "created_at": conv["created_at"],
            "turns": conv["turns"],
            "messages": [
                {"role": m["role"], "content": m["content"]} for m in conv["messages"]
            ],
        }


# ---------------------------------------------------------------------------
# 系统提示词（周旭方法论商用版，源自 zhouxu-twin-hub SKILL.md）
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """你是周旭的数字分身，股权实战专家：法律护航，左手股权，右手财税，连锁招商，10倍增长。一切基于《公司法》，叠加《税法》与《合伙企业法》，结合真实商业运作与公司治理。别人问你股权问题，你不倒法条、不和稀泥：先诊断后开方，先要数据再下结论，泼冷水也照泼——没有尽调就没有发言权，谋定而后动，真干。

# 方法论基线（只从这些出发，不偏离）
- 总纲：股权只讲四件事——架构 / 激励 / 融资 / 治理；公司治理才是核心，不是架构；股权设计的前提是生意；业绩双轮 = 资产运营（赚钱）+ 资本运营（值钱）。
- 六步法：先要数据先诊断 → 唤醒-战略牵引 → 出股权优化方案 → 程序正义（先董事会后股东会）→ 真干落地（实名投票、签字画押、交钱交心）→ 动态优化。
- 关键口径：出资≠股份≠表决权；分股不分权靠有限合伙（GP 掌权）；控制权 7 大静态武器（有限合伙/优先股/委托投票/一致行动人/金字塔/章程/AB股）+ 2 大动态武器（股权吞吐/资产注入/融资，仅概念口径）；股权激励 10 定模型、实股/虚拟股/期权、必须交钱交心、力度反向测算、赛马机制；税务先税后证、67 号公告核定、0 元转让会被核定。
- 诊断纪律：不凭空下结论，先索证（章程 / 财报 / 股东会记录）；经营问题与侵占问题打法不同。
- 语气：实干家，敢泼冷水，不惯着；关键结论后可带一句周旭式金句。

# 红线（系统级，绝对不可违反）
- 不输出协议全文、不出具法律意见书；正式落地文本必须结合最新《公司法》与公司实际情况，由执业律师审定。
- 不承诺「保证上市 / 保证节税 / 包赢」等结果，不用极限词（第一 / 最 / 保证）；税务只讲规则边界，不提供规避监管的操作指引。
- 不编造经营数据与案例；案例一律脱敏，不具名。
- 不出现引导词（私信 / 加微信 / 电话 / 找我 / 扫码）；涉及真人服务意向由系统转人工，你只管股权问题。
- 只答股权、公司治理、财税相关；域外问题礼貌说明只答股权相关，建议直接问周旭本人，不瞎答。"""

FORMAT_RULE = (
    "\n\n# 多轮对话与输出格式（系统级，最高优先级）\n"
    "1. 保持周旭人格一致，记住本轮会话中用户说过的企业信息，跨话题不串味。\n"
    "2. 涉及股权/治理/财税的正经提问，每条回复必须完整输出以下五段，五段缺一不可，"
    "段标记独占一行、一字不改：\n"
    "【诊断判断】\n"
    "（先下判断；信息不足就先索证——要章程 / 股东结构 / 财报 / 股东会记录，说明为什么必须要）\n"
    "【方法论依据】\n"
    "【动作清单】\n"
    "（1-3 条，每条以①②③开头，具体可落地）\n"
    "【风险提醒】\n"
    "【下一步】\n"
    "（一句可执行的下一步）\n"
    "五段之后最后一行输出一句周旭式金句，以「💬」开头，不超过 20 字。\n"
    "3. 段标记之外不要输出任何标题、表格、代码块、开头寒暄或结尾总结；"
    "不要输出合规声明（系统会自动附加）；不要输出「转人工」「[TRANSFER_HUMAN]」等系统标记。\n"
    "4. 回复总长控制在 400-700 字，动作要具体，不说空话。\n"
    "5. 用户表示感谢、认可、寒暄（如「谢谢」「说得好」「辛苦了」「在吗」）："
    "直接用一句周旭口吻的话回应（可顺势追问一个股权问题），"
    "绝对不要输出五段段标记，也不要输出空标记。\n"
    "6. 与股权、治理、财税无关的问题：一句话说明只答股权相关，建议直接问周旭本人，"
    "不要输出五段段标记。"
)


def build_system_prompt() -> str:
    return SYSTEM_PROMPT + FORMAT_RULE


# ---------------------------------------------------------------------------
# 每日免费配额（免费体验期生效；ZX_DAILY_FREE_CALLS=0 表示不限次）
# ---------------------------------------------------------------------------

class QuotaExceeded(Exception):
    """当日免费次数已用完。"""

    def __init__(self, limit: int):
        self.limit = limit
        super().__init__(f"今日 {limit} 次免费额度已用完，明天再来")


def _quota_row(db, api_key: str, today: str) -> ZxQuota:
    row = (db.query(ZxQuota)
             .filter(ZxQuota.api_key == api_key, ZxQuota.quota_date == today)
             .first())
    if not row:
        row = ZxQuota(api_key=api_key, quota_date=today, used_count=0)
        db.add(row)
        db.flush()
    return row


def quota_left(api_key: str) -> Optional[int]:
    """今日剩余免费次数；不限次返回 None。"""
    limit = int(settings.ZX_DAILY_FREE_CALLS or 0)
    if limit <= 0:
        return None
    db = SessionLocal()
    try:
        row = (db.query(ZxQuota)
                 .filter(ZxQuota.api_key == api_key,
                         ZxQuota.quota_date == date.today().isoformat())
                 .first())
        used = row.used_count if row else 0
        return max(0, limit - used)
    finally:
        db.close()


def consume_daily_quota(api_key: str) -> int:
    """消耗一次当日免费额度，返回剩余次数；超限抛 QuotaExceeded；-1 = 不限次。"""
    limit = int(settings.ZX_DAILY_FREE_CALLS or 0)
    if limit <= 0:
        return -1
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
        print(f"[zx] 配额计次失败（放行）：{e}", flush=True)
        return -1  # 计次故障不拦用户
    finally:
        db.close()


def refund_daily_quota(api_key: str) -> None:
    """流式失败返还当日次数（与返还点数同款纪律）。"""
    limit = int(settings.ZX_DAILY_FREE_CALLS or 0)
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
        print(f"[zx] 返还配额失败：{e}", flush=True)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 语音转写 ASR（DashScope compatible-mode /audio/transcriptions）
# 免费期纪律：转写不扣点、不扣每日次数、不留台账——语音只是输入方式，不是独立卖点。
# ---------------------------------------------------------------------------

class AsrNotConfigured(Exception):
    """服务端未配置 ASR 接口（前端 🎤 据此提示语音未开通）。"""


def asr_available() -> bool:
    return bool(settings.ZX_ASR_API_URL and settings.ZX_ASR_API_KEY)


def asr_transcribe(raw: bytes, ext: str) -> str:
    """把录音字节流转写为文本。

    DashScope compatible-mode 的 multipart 必须显式带 model 字段；
    失败抛 RuntimeError（路由层转 502），未配置抛 AsrNotConfigured（路由层转 503）。
    """
    if not asr_available():
        raise AsrNotConfigured()
    boundary = "----ZxAsr" + uuid.uuid4().hex
    pre = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="model"\r\n\r\n'
        f"{settings.ZX_ASR_MODEL}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="voice.{ext}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    body = pre + raw + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(settings.ZX_ASR_API_URL, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", "Bearer " + settings.ZX_ASR_API_KEY)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            obj = json.loads(resp.read(1024 * 1024).decode("utf-8", "replace"))
    except Exception as e:
        raise RuntimeError(f"ASR 请求失败：{e}")
    text = str(obj.get("text") or obj.get("result") or "").strip()
    if not text:
        raise RuntimeError("未能识别出语音内容")
    return text


# ---------------------------------------------------------------------------
# 流式问答主流程
# ---------------------------------------------------------------------------

def profile() -> dict:
    """公开档案（给前端首屏/欢迎语/红线展示）。"""
    return dict(ADVISOR)


def chat_stream(conv_id: str, cost: int = 0, quota_used: bool = False,
                transfer: bool = False) -> Generator[Tuple[str, dict], None, None]:
    """生成器：yield (event, data) 事件流。

    event: meta / delta / transfer / done / error
    transfer=True：转人工通道——只发 meta + transfer + done，不调大模型、不扣点不扣次数
    （次数在路由层已按 transfer 分支跳过）。
    """
    api_key = ""
    try:
        with _lock:
            conv = _convs.get(conv_id)
            api_key = conv["api_key"] if conv else ""
            history = [dict(m) for m in (conv["messages"] if conv else [])]

        yield ("meta", {
            "conv_id": conv_id,
            "name": ADVISOR["name"],
            "comply": ADVISOR["comply"],
            "cost": cost,
            "quota_left": quota_left(api_key) if quota_used else None,
        })

        if transfer:
            # 转人工：用户消息不进历史上下文（非股权话题），补一条分身应答
            _append_assistant(conv_id, TRANSFER_TEXT)
            yield ("transfer", {"message": TRANSFER_TEXT})
            yield ("done", {"conv_id": conv_id, "chars": len(TRANSFER_TEXT),
                            "cost": 0, "transfer": True, "quota_left": None})
            return

        messages = [{"role": "system", "content": build_system_prompt()}]
        messages += _trim_history(history)

        full = []
        for piece in llm_stream(
            messages,
            timeout=int(settings.ZX_TIMEOUT or 90),
            temperature=0.7,
            max_tokens=2000,
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
        print(f"[zx] 问答失败：{e}", flush=True)
        if cost > 0 and api_key:
            refund_cost(api_key, cost, note="周旭数字分身失败返还")
        if quota_used and api_key and not transfer:
            refund_daily_quota(api_key)
        yield ("error", {"message": str(e)[:200]})
