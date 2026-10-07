"""
周旭数字分身 · 路由层
====================

GET  /skills/zhouxu/profile              → 分身档案 + 计费口径
POST /skills/zhouxu/chat                 → SSE 流式问答（免费体验期不扣点；ZX_POINTS_PER_CALL>0 按次扣）
GET  /skills/zhouxu/conversations/{cid}  → 会话历史（归属校验）

SSE 事件格式（data: JSON）：
  meta     {conv_id, name, comply, cost, quota_left}
  delta    {text}                                    （多次）
  transfer {message}                                 （转人工：渲染客服活码卡，替代 delta）
  done     {conv_id, chars, cost, transfer?, quota_left}
  error    {message}

转人工判定在扣次数之前：命中真人服务意向不消耗当日额度（销售线索不收费）。
"""
import io
import json
import zipfile
from typing import Generator
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_settings
from db import change_balance, get_db, get_or_create_key
import zx_engine

settings = get_settings()
router = APIRouter()


class ZxChatCreate(BaseModel):
    message: str
    conversation_id: str = ""


class ZxExport(BaseModel):
    title: str = "交付文件"
    frame: str = ""
    items: list = []
    note: str = "本文件由 AI 生成，仅供参考，不构成法律意见，落地文本须执业律师审定。"


def _docx(title: str, frame: str, items: list, note: str) -> bytes:
    """手工打包最小 OOXML .docx（Word/WPS/手机预览都能开，不依赖 python-docx）。"""
    def esc(s):
        return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def para(text, bold=False, size=""):
        rpr = ""
        if bold or size:
            rpr = "<w:rPr>" + ("<w:b/>" if bold else "") + (
                f'<w:sz w:val="{size}"/>' if size else "") + "</w:rPr>"
        return ('<w:p><w:r>' + rpr +
                f'<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>')

    body = [para("周旭数字分身 · " + title, bold=True, size="32")]
    if frame:
        body.append(para("判断框架：" + frame))
    for it in (items or []):
        if isinstance(it, (list, tuple)) and len(it) >= 2:
            body.append(para(f"{it[0]}：{it[1]}"))
        else:
            body.append(para(str(it)))
    body.append(para(""))
    body.append(para(note, size="18"))
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body>' + "".join(body) + "</w:body></w:document>")
    ctypes = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
              '<Default Extension="xml" ContentType="application/xml"/>'
              '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
              "</Types>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


def _sse(events: Generator[tuple, None, None]) -> Generator[str, None, None]:
    for event, data in events:
        yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/skills/zhouxu/profile")
def zhouxu_profile():
    return {
        "advisor": zx_engine.profile(),
        "redlines": [
            "不出协议全文与法律意见书，落地文本由执业律师结合最新《公司法》审定",
            "不承诺「保证上市 / 保证节税 / 包赢」，不用极限词",
            "税务只讲规则边界，不提供规避监管指引",
            "案例一律脱敏，不具名",
            "只答股权、治理、财税相关，域外建议直接问周旭本人",
        ],
        "billing": {
            "mode": "per_call" if int(settings.ZX_POINTS_PER_CALL or 0) > 0 else "free_trial",
            "points_per_call": int(settings.ZX_POINTS_PER_CALL or 0),
            "daily_free": int(settings.ZX_DAILY_FREE_CALLS or 0),
        },
    }


@router.post("/skills/zhouxu/chat")
def zhouxu_chat(req: ZxChatCreate, authorization: str = Header(default=""),
                db: Session = Depends(get_db)):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")

    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="消息不能为空")
    max_chars = int(settings.ZX_MAX_MESSAGE_CHARS or 500)
    if len(message) > max_chars:
        raise HTTPException(status_code=400, detail=f"消息过长（最多 {max_chars} 字）")

    # 转人工检测（最高优先级）：命中则不扣点不扣次数，SSE 只发 transfer
    transfer = zx_engine.is_transfer(message)

    # 计费开关：0=免费体验期（每日限 ZX_DAILY_FREE_CALLS 次）；>0=按次扣点，流式失败由引擎全额返还
    cost = 0 if transfer else int(settings.ZX_POINTS_PER_CALL or 0)
    quota_used = False
    get_or_create_key(db, api_key)
    if cost > 0:
        rec = change_balance(db, api_key, -cost, "消费", note="周旭数字分身")
        if not rec:
            raise HTTPException(status_code=402, detail="余额不足，请先充值")
    elif not transfer:
        try:
            left = zx_engine.consume_daily_quota(api_key)
            quota_used = left != -1  # -1 = 不限次
        except zx_engine.QuotaExceeded as e:
            raise HTTPException(status_code=429, detail=str(e))

    try:
        conv_id = zx_engine.open_conv(api_key, req.conversation_id or "", message)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return StreamingResponse(
        _sse(zx_engine.chat_stream(conv_id, cost, quota_used=quota_used, transfer=transfer)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 透传 SSE 不缓冲（仍建议配 proxy_buffering off）
        },
    )


@router.get("/skills/zhouxu/conversations/{conv_id}")
def zhouxu_conversation(conv_id: str, authorization: str = Header(default="")):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    try:
        return zx_engine.get_history(api_key, conv_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# 语音转写（免费期纪律：不扣点、不扣每日次数、不留台账——语音只是输入方式）
# ---------------------------------------------------------------------------

_VOICE_EXTS = {"webm", "mp4", "m4a", "wav", "mp3", "aac", "ogg", "amr"}


@router.post("/skills/zhouxu/voice")
async def zhouxu_voice(file: UploadFile = File(...), authorization: str = Header(default=""),
                       db: Session = Depends(get_db)):
    """录音 → 文本（前端回填输入框，用户确认后自己点发送）。"""
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    if not zx_engine.asr_available():
        raise HTTPException(status_code=503, detail="语音输入尚未开通")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="录音为空，请重录")
    max_bytes = int(settings.ZX_MAX_VOICE_MB or 8) * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"录音过大（上限 {settings.ZX_MAX_VOICE_MB}MB）")
    name = file.filename or ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "webm"
    if ext not in _VOICE_EXTS:
        raise HTTPException(status_code=400, detail="不支持的录音格式")
    get_or_create_key(db, api_key)  # 留户；免费配额行在真正问答时才建
    try:
        text = zx_engine.asr_transcribe(raw, ext)
    except zx_engine.AsrNotConfigured:
        raise HTTPException(status_code=503, detail="语音输入尚未开通")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"语音转写失败：{e}")
    return {"text": text}


@router.post("/skills/zhouxu/export")
def zhouxu_export(req: ZxExport, authorization: str = Header(default="")):
    """交付文件导出：真 .docx（手机端预览/下载可用；HTML 伪装 .doc 在手机上判损坏）。"""
    if not _auth_key(authorization):
        raise HTTPException(status_code=401, detail="缺 API Key")
    title = (req.title or "交付文件").strip()[:60]
    data = _docx(title, req.frame, req.items, req.note)
    fname = quote(f"周旭数字分身-{title}.docx")
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )
