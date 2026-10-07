"""
古人智慧团 · 路由层
====================

GET  /skills/gu/advisors              → 顾问清单 + 场景路由 + 计费口径（system_prompt 不下发）
POST /skills/gu/route                 → 大厅自由提问 AI 荐人（关键词未命中时 LLM 挑人，不扣次数）
POST /skills/gu/chat                  → SSE 流式问答（免费体验期不扣点；GU_POINTS_PER_CALL>0 按次扣）
GET  /skills/gu/conversations/{cid}   → 会话历史（归属校验）

SSE 事件格式（data: JSON）：
  meta  {conv_id, gu_id, name, head, comply, cost}
  delta {text}                      （多次）
  done  {conv_id, chars, cost}
  error {message}
"""
import json
from typing import Generator

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_settings
from db import change_balance, get_db, get_or_create_key
import gu_engine

settings = get_settings()
router = APIRouter()


class GuChatCreate(BaseModel):
    gu_id: str
    message: str
    conversation_id: str = ""


class GuRouteIn(BaseModel):
    message: str


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


def _sse(events: Generator[tuple, None, None]) -> Generator[str, None, None]:
    for event, data in events:
        yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/skills/gu/advisors")
def advisors():
    enabled = [a for a in gu_engine.list_gu() if a["enabled"]]
    return {
        "advisors": enabled,
        "routing": gu_engine.get_routing(),
        "billing": {
            "mode": "per_call" if int(settings.GU_POINTS_PER_CALL or 0) > 0 else "free_trial",
            "points_per_call": int(settings.GU_POINTS_PER_CALL or 0),
            "daily_free": int(settings.GU_DAILY_FREE_CALLS or 0),
            "routing_version": gu_engine.routing_version(),
        },
    }


@router.post("/skills/gu/route")
def gu_route(req: GuRouteIn):
    """大厅自由提问 AI 荐人：关键词路由未命中时，LLM 挑一位最对路的先生。

    不扣次数不留痕（荐人不是问答）；滥用面靠 500 字上限 + 30s 超时 + max_tokens=80 控制。
    选不出（模型失手/未配置 DEEPSEEK）返回 502，前端回落到「点下方场景问题」提示。
    """
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="先说说你的难处")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="问题太长了，先一句话说说难处")
    gu_id, reason = gu_engine.route_once(message)
    if not gu_id:
        raise HTTPException(status_code=502, detail="荐人暂时失手，请直接选一位先生")
    pack = gu_engine.get_gu(gu_id) or {}
    return {"gu_id": gu_id, "name": pack.get("name", gu_id), "reason": reason}


@router.post("/skills/gu/chat")
def gu_chat(req: GuChatCreate, authorization: str = Header(default=""),
            db: Session = Depends(get_db)):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")

    pack = gu_engine.get_gu(req.gu_id)
    if not pack or not pack.get("enabled", True):
        raise HTTPException(status_code=404, detail=f"顾问不存在：{req.gu_id}")

    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="消息不能为空")
    max_chars = int(settings.GU_MAX_MESSAGE_CHARS or 500)
    if len(message) > max_chars:
        raise HTTPException(status_code=400, detail=f"消息过长（最多 {max_chars} 字）")

    # 计费开关：0=免费体验期（每日限 GU_DAILY_FREE_CALLS 次）；>0=按次扣点，流式失败由引擎全额返还
    cost = int(settings.GU_POINTS_PER_CALL or 0)
    quota_used = False
    quota_left = None
    get_or_create_key(db, api_key)
    if cost > 0:
        rec = change_balance(db, api_key, -cost, "消费", note=f"古人经营智慧·{pack.get('name')}")
        if not rec:
            raise HTTPException(status_code=402, detail="余额不足，请先充值")
    else:
        try:
            quota_left = gu_engine.consume_daily_quota(api_key)
            quota_used = quota_left != -1  # -1 = 不限次
        except gu_engine.QuotaExceeded as e:
            raise HTTPException(status_code=429, detail=str(e))

    try:
        conv_id = gu_engine.open_conv(api_key, req.gu_id, req.conversation_id or "", message)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return StreamingResponse(
        _sse(gu_engine.chat_stream(pack, conv_id, cost, quota_used=quota_used)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 透传 SSE 不缓冲（仍建议配 proxy_buffering off）
        },
    )


@router.get("/skills/gu/conversations/{conv_id}")
def conversation(conv_id: str, authorization: str = Header(default="")):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    try:
        return gu_engine.get_history(api_key, conv_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
