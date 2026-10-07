"""
数字分身工厂路由
================

POST   /skills/twin/materials          上传素材（multipart 文件，图片OCR/音视频ASR自动解析）
POST   /skills/twin/materials/json     提交素材（JSON：链接 / 直接口述文本）
GET    /skills/twin/materials          我的素材清单（最近 50 条）
DELETE /skills/twin/materials/{mid}    删除素材（含落盘文件）
GET    /skills/twin/precheck           素材体检（同步，启发式）
POST   /skills/twin/drafts             画像草稿（蒸馏 A-D，不扣费）
POST   /skills/twin/builds             发起造分身（可带 draft_id 确认后开工；扣制作费，失败返还）
GET    /skills/twin/builds/{task_id}   轮询任务（b_造分身 / d_画像草稿 / r_精调 通用）
GET    /skills/twin/mine               我的分身列表
GET    /skills/twin/mine/{tid}         分身详情（带预览）
GET    /skills/twin/mine/{tid}/versions  版本历史
POST   /skills/twin/mine/{tid}/feedback  使用反馈（越用越像的原料）
POST   /skills/twin/mine/{tid}/refine    免费精调（新版本热更新）
POST   /skills/twin/mine/{tid}/rollback   回滚到指定版本
POST   /skills/twin/mine/{tid}/disable  下架自己的分身

上线清单（运维）：
- nginx 对应 location 建议 client_max_body_size 8m（素材上限 5MB）
- 服务器可选装 python-docx / pypdf 提升 docx/pdf 解析率
- OCR/ASR：.env 配 TWIN_OCR_API_URL/KEY、TWIN_ASR_API_URL/KEY 即自动启用，留空降级存档
"""
import json
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db, get_or_create_key
from twin_engine import (
    TWIN_DEV_FEE_POINTS,
    TWIN_CALL_POINTS_DEFAULT,
    TWIN_REFINE_TRIGGER,
    create_build_task,
    create_draft_task,
    create_refine_task,
    get_build_task,
    get_materials_text,
    parse_file_material,
    pending_feedback_count,
    precheck_materials,
    save_material,
    _fetch_link_text,
)
from twin_models import DigitalTwin, TwinFeedback, TwinMaterial, TwinVersion

router = APIRouter()


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


def _require_key(db: Session, authorization: str) -> str:
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    get_or_create_key(db, api_key)
    return api_key


def _mat_out(m: TwinMaterial) -> dict:
    return {
        "material_id": m.material_id,
        "kind": m.kind,
        "name": m.name,
        "chars": len(m.content or ''),
        "status": m.status,
        "note": m.note,
        "created_at": m.created_at.isoformat() if m.created_at else '',
    }


# ---------------------------------------------------------------------------
# 素材
# ---------------------------------------------------------------------------

@router.post("/skills/twin/materials")
async def upload_material_file(
    file: UploadFile = File(...),
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
):
    api_key = _require_key(db, authorization)
    raw = await file.read()
    try:
        mat = parse_file_material(db, api_key, file.filename or '', raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"素材保存失败：{e}")
    return _mat_out(mat)


class MaterialJson(BaseModel):
    kind: str                      # link / text
    value: str
    name: str = ''


@router.post("/skills/twin/materials/json")
def create_material_json(req: MaterialJson, authorization: str = Header(default=""),
                         db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    kind = (req.kind or '').strip().lower()
    value = (req.value or '').strip()
    if kind not in ('link', 'text'):
        raise HTTPException(status_code=400, detail="kind 只支持 link / text")
    if not value:
        raise HTTPException(status_code=400, detail="value 不能为空")

    if kind == 'text':
        if len(value) < 20:
            raise HTTPException(status_code=400, detail="文字素材太短（至少 20 字），多说说干货")
        mat = save_material(db, api_key, 'text', req.name or '口述素材', value)
        return _mat_out(mat)

    # link：抓正文
    if not value.startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="链接必须以 http(s):// 开头")
    try:
        text = _fetch_link_text(value)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"链接抓取失败：{e}；可把文章正文复制成文字素材")
    if len(text) < 50:
        raise HTTPException(status_code=400, detail="该链接抓不到有效正文（可能是视频/图片页），请把内容复制成文字素材")
    name = req.name or value.split('//', 1)[-1].split('/')[0]
    mat = save_material(db, api_key, 'link', name, text)
    return _mat_out(mat)


@router.get("/skills/twin/materials")
def list_materials(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    rows = (db.query(TwinMaterial)
              .filter(TwinMaterial.owner_api_key == api_key)
              .order_by(TwinMaterial.id.desc())
              .limit(50)
              .all())
    return {"materials": [_mat_out(m) for m in rows], "total": len(rows)}


@router.delete("/skills/twin/materials/{material_id}")
def delete_material(material_id: str, authorization: str = Header(default=""),
                    db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    m = db.scalar(select(TwinMaterial).where(TwinMaterial.material_id == material_id))
    if not m or m.owner_api_key != api_key:
        raise HTTPException(status_code=404, detail="素材不存在")
    if m.raw_path:
        try:
            os.remove(m.raw_path)
        except Exception:
            pass
    db.delete(m)
    db.commit()
    return {"deleted": material_id}


# ---------------------------------------------------------------------------
# 素材体检（同步，不扣费）
# ---------------------------------------------------------------------------

@router.get("/skills/twin/precheck")
def do_precheck(material_ids: str = '', authorization: str = Header(default=""),
                db: Session = Depends(get_db)):
    """素材体检：传入 material_ids（逗号分隔），返回四类卡覆盖与补料建议。"""
    api_key = _require_key(db, authorization)
    ids = [m.strip() for m in (material_ids or '').split(',') if m.strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="material_ids 必填（逗号分隔）")
    return precheck_materials(db, api_key, ids)


# ---------------------------------------------------------------------------
# 画像草稿（两段式：不扣费，确认后再 build）
# ---------------------------------------------------------------------------

class DraftRequest(BaseModel):
    name: str
    role: str
    industry: str = ''
    audience: str = ''
    outputs: str = '决策建议,行动方案'
    style: str = ''
    notes: str = ''
    extra: str = ''
    material_ids: List[str] = []


def _clean_values(req) -> dict:
    return {
        "name": (req.name or '').strip(),
        "role": (req.role or '').strip(),
        "industry": (req.industry or '').strip(),
        "audience": (req.audience or '').strip(),
        "outputs": (req.outputs or '').strip(),
        "style": (req.style or '').strip(),
        "notes": (req.notes or '').strip(),
        "extra": (req.extra or '').strip(),
    }


def _validate_ownership(db, api_key: str, material_ids: List[str]):
    if material_ids:
        owned = (db.query(TwinMaterial)
                   .filter(TwinMaterial.owner_api_key == api_key,
                           TwinMaterial.material_id.in_(material_ids))
                   .count())
        if owned < len(material_ids):
            raise HTTPException(status_code=400, detail="部分素材不存在或不属于你，请用 --my-materials 核对")


@router.post("/skills/twin/drafts")
def create_draft(req: DraftRequest, authorization: str = Header(default=""),
                 db: Session = Depends(get_db)):
    """画像草稿：蒸馏出「我们理解的你」，不扣费。用户确认后带 draft_id 调 /builds 开工。"""
    api_key = _require_key(db, authorization)
    if not (req.name or '').strip() or not (req.role or '').strip():
        raise HTTPException(status_code=400, detail="分身名（name）与主人身份（role）必填")
    if len((req.name or '').strip()) > 30:
        raise HTTPException(status_code=400, detail="分身名过长（最多 30 字）")
    material_ids = [m.strip() for m in req.material_ids if m.strip()]
    _validate_ownership(db, api_key, material_ids)
    values = _clean_values(req)
    draft_id = create_draft_task(api_key, values, material_ids)
    return {
        "task_id": draft_id,
        "status": "running",
        "progress": 0,
        "message": "画像蒸馏已受理，通常 1-2 分钟",
    }


# ---------------------------------------------------------------------------
# 造分身（扣制作费，失败返还；支持 draft_id 两段式）
# ---------------------------------------------------------------------------

class BuildRequest(BaseModel):
    name: str                       # 分身名（如「王律师分身」）
    role: str                       # 主人身份：老板 / 律师 / 医生…
    industry: str = ''
    audience: str = ''              # 服务对象
    outputs: str = '决策建议,行动方案'   # 交付类型，逗号分隔
    style: str = ''                 # 语言风格自述
    notes: str = ''                 # 访谈笔记
    extra: str = ''                 # 其它补充
    material_ids: List[str] = []
    draft_id: str = ''              # 画像草稿 id（确认后开工）


@router.post("/skills/twin/builds")
def create_build(req: BuildRequest, authorization: str = Header(default=""),
                 db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    name = (req.name or '').strip()
    role = (req.role or '').strip()
    if not name or not role:
        raise HTTPException(status_code=400, detail="分身名（name）与主人身份（role）必填")
    if len(name) > 30:
        raise HTTPException(status_code=400, detail="分身名过长（最多 30 字）")

    material_ids = [m.strip() for m in req.material_ids if m.strip()]
    _validate_ownership(db, api_key, material_ids)

    key_obj = get_or_create_key(db, api_key)
    if key_obj.balance < TWIN_DEV_FEE_POINTS:
        raise HTTPException(status_code=402, detail=f"余额不足：本次造分身制作费 {TWIN_DEV_FEE_POINTS} 点，请先充值")

    values = _clean_values(req)
    # 无草稿时才做最低素材校验（草稿路径已在 draft 校验过）
    if not req.draft_id and not material_ids and len(values["notes"]) + len(values["extra"]) < 200:
        raise HTTPException(status_code=400,
                            detail="素材太少：请至少上传 1 件文本素材，或把访谈笔记写足 200 字以上")

    task_id = create_build_task(api_key, values, material_ids, draft_id=(req.draft_id or '').strip())
    return {
        "task_id": task_id,
        "status": "running",
        "progress": 0,
        "points": TWIN_DEV_FEE_POINTS,
        "message": "造分身任务已受理，制作费将在成功后结算、失败全额返还",
    }


@router.get("/skills/twin/builds/{task_id}")
def poll_build(task_id: str):
    res = get_build_task(task_id)
    if res is None:
        raise HTTPException(status_code=404, detail="造分身任务不存在")
    return res


# ---------------------------------------------------------------------------
# 我的分身
# ---------------------------------------------------------------------------

def _twin_out(t: DigitalTwin, with_preview: bool = False) -> dict:
    out = {
        "twin_skill_id": t.twin_skill_id,
        "name": t.name,
        "role": t.role,
        "industry": t.industry,
        "audience": t.audience,
        "status": t.status,
        "points_per_call": t.points_per_call,
        "call_count": t.call_count,
        "version": t.version or 1,
        "created_at": t.created_at.isoformat() if t.created_at else '',
    }
    if with_preview:
        try:
            soul = json.loads(t.soul or '{}')
        except Exception:
            soul = {}
        from twin_engine import _soul_preview
        out["preview_markdown"] = _soul_preview(soul)
    return out


@router.get("/skills/twin/mine")
def my_twins(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    rows = (db.query(DigitalTwin)
              .filter(DigitalTwin.owner_api_key == api_key)
              .order_by(DigitalTwin.id.desc())
              .all())
    return {"twins": [_twin_out(t) for t in rows], "total": len(rows)}


@router.get("/skills/twin/mine/{twin_skill_id}")
def my_twin_detail(twin_skill_id: str, authorization: str = Header(default=""),
                   db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    t = db.scalar(select(DigitalTwin).where(DigitalTwin.twin_skill_id == twin_skill_id))
    if not t or t.owner_api_key != api_key:
        raise HTTPException(status_code=404, detail="分身不存在")
    return _twin_out(t, with_preview=True)


@router.post("/skills/twin/mine/{twin_skill_id}/disable")
def disable_twin(twin_skill_id: str, authorization: str = Header(default=""),
                 db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    t = db.scalar(select(DigitalTwin).where(DigitalTwin.twin_skill_id == twin_skill_id))
    if not t or t.owner_api_key != api_key:
        raise HTTPException(status_code=404, detail="分身不存在")
    t.status = 'disabled'
    db.commit()
    return {"twin_skill_id": twin_skill_id, "status": "disabled"}


# ---------------------------------------------------------------------------
# 越用越像：反馈 / 精调 / 版本 / 回滚
# ---------------------------------------------------------------------------

class FeedbackRequest(BaseModel):
    rating: str                     # like / unlike
    note: str = ''                  # 哪里不像、该怎么改（≤300字）
    run_id: str = ''                # 对应 gen 任务 id


def _own_twin(db, api_key: str, twin_skill_id: str) -> DigitalTwin:
    t = db.scalar(select(DigitalTwin).where(DigitalTwin.twin_skill_id == twin_skill_id))
    if not t or t.owner_api_key != api_key:
        raise HTTPException(status_code=404, detail="分身不存在")
    return t


@router.post("/skills/twin/mine/{twin_skill_id}/feedback")
def add_feedback(twin_skill_id: str, req: FeedbackRequest,
                 authorization: str = Header(default=""), db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    _own_twin(db, api_key, twin_skill_id)
    rating = (req.rating or '').strip().lower()
    if rating not in ('like', 'unlike'):
        raise HTTPException(status_code=400, detail="rating 只支持 like / unlike")
    note = (req.note or '').strip()[:300]
    if rating == 'unlike' and not note:
        raise HTTPException(status_code=400, detail="标「不像」时请带一句原因（note），这是精调的原料")
    db.add(TwinFeedback(
        twin_skill_id=twin_skill_id,
        owner_api_key=api_key,
        run_id=(req.run_id or '').strip()[:40],
        rating=rating,
        note=note,
    ))
    db.commit()
    pending = pending_feedback_count(db, twin_skill_id)
    return {
        "twin_skill_id": twin_skill_id,
        "recorded": True,
        "pending_feedback": pending,
        "refine_suggested": pending >= TWIN_REFINE_TRIGGER,
        "refine_trigger": TWIN_REFINE_TRIGGER,
        "message": (f"已记录，攒够 {TWIN_REFINE_TRIGGER} 条可免费精调" if pending < TWIN_REFINE_TRIGGER
                    else f"已有 {pending} 条反馈，可以精调了（免费）"),
    }


@router.post("/skills/twin/mine/{twin_skill_id}/refine")
def refine_twin(twin_skill_id: str, authorization: str = Header(default=""),
                db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    _own_twin(db, api_key, twin_skill_id)
    if pending_feedback_count(db, twin_skill_id) == 0:
        raise HTTPException(status_code=400, detail="没有待处理的反馈：先记录几条「哪里不像」，再来精调")
    task_id = create_refine_task(api_key, twin_skill_id)
    return {"task_id": task_id, "status": "running", "progress": 0,
            "message": "精调已受理（免费），通常 1-2 分钟"}


@router.get("/skills/twin/mine/{twin_skill_id}/versions")
def list_versions(twin_skill_id: str, authorization: str = Header(default=""),
                  db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    t = _own_twin(db, api_key, twin_skill_id)
    rows = (db.query(TwinVersion)
              .filter(TwinVersion.twin_skill_id == twin_skill_id)
              .order_by(TwinVersion.version.asc())
              .all())
    return {
        "twin_skill_id": twin_skill_id,
        "current_version": t.version or 1,
        "versions": [{"version": v.version,
                      "refine_note": v.refine_note,
                      "created_at": v.created_at.isoformat() if v.created_at else ''} for v in rows],
    }


class RollbackRequest(BaseModel):
    version: int


@router.post("/skills/twin/mine/{twin_skill_id}/rollback")
def rollback_twin(twin_skill_id: str, req: RollbackRequest,
                  authorization: str = Header(default=""), db: Session = Depends(get_db)):
    api_key = _require_key(db, authorization)
    t = _own_twin(db, api_key, twin_skill_id)
    v = db.scalar(select(TwinVersion).where(
        TwinVersion.twin_skill_id == twin_skill_id,
        TwinVersion.version == req.version))
    if not v:
        raise HTTPException(status_code=404, detail=f"版本 v{req.version} 不存在")
    t.soul = v.soul_json
    try:
        soul = json.loads(v.soul_json or '{}')
        pack = json.loads(t.pack or '{}')
        from twin_engine import INJECTION_SHIELD
        pack["system_prompt"] = soul.get('system_prompt', '') + INJECTION_SHIELD
        pack["displayName"] = soul.get('displayName', pack.get("displayName", ""))
        pack["description"] = soul.get('intro', pack.get("description", ""))
        t.pack = json.dumps(pack, ensure_ascii=False)
    except Exception:
        pass
    t.version = req.version
    db.commit()
    return {"twin_skill_id": twin_skill_id, "current_version": req.version,
            "message": f"已回滚到 v{req.version}"}
