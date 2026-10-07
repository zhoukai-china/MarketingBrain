"""
通用薄壳技能路由
=================

POST /skills/gen/tasks          body: {skill_id, inputs:{...}} → {task_id}
GET  /skills/gen/tasks/{id}     → 进度/结果
GET  /skills/gen/packs          → 已上线技能清单（调试用）
"""
import json
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import get_settings
from db import get_db, get_or_create_key
from gen_engine import create_task, get_task, get_pack, list_packs, normalize_inputs

settings = get_settings()
router = APIRouter()

TWIN_SKILL_PREFIX = "twin_"


def resolve_twin_pack(db: Session, skill_id: str, api_key: str) -> Optional[dict]:
    """用户专属数字分身解析：twin_* 技能不在 skill_packs 文件里，存 DB。

    归属校验：分身仅限主人本人调用（分身只在思潼平台内可用）。
    命中时顺手累计调用次数。解析出的 pack 与文件 pack 同构，
    后续校验/计费/退款全部复用 gen 引擎链路。
    """
    if not skill_id.startswith(TWIN_SKILL_PREFIX):
        return None
    from twin_models import DigitalTwin
    t = db.scalar(select(DigitalTwin).where(DigitalTwin.twin_skill_id == skill_id))
    if not t or t.status != "ready":
        raise HTTPException(status_code=404, detail=f"分身不存在或已下架：{skill_id}")
    if t.owner_api_key != api_key:
        raise HTTPException(status_code=403, detail="这不是你的分身（数字分身仅限主人在思潼平台使用）")
    try:
        pack = json.loads(t.pack or '{}')
    except Exception:
        raise HTTPException(status_code=500, detail="分身配置损坏，请联系客服")
    if not pack.get("system_prompt"):
        raise HTTPException(status_code=500, detail="分身配置损坏，请联系客服")
    t.call_count = (t.call_count or 0) + 1
    db.commit()
    return pack


class GenTaskCreate(BaseModel):
    skill_id: str
    inputs: Dict[str, Any] = {}


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


@router.get("/skills/gen/packs")
def packs():
    return {"packs": list_packs()}


@router.post("/skills/gen/tasks")
def create(req: GenTaskCreate, authorization: str = Header(default=""),
           db: Session = Depends(get_db)):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")

    pack = get_pack(req.skill_id)
    if pack is None and req.skill_id.startswith(TWIN_SKILL_PREFIX):
        # 用户专属数字分身：DB 解析 + 归属校验
        pack = resolve_twin_pack(db, req.skill_id, api_key)
    if not pack:
        raise HTTPException(status_code=404, detail=f"技能不存在：{req.skill_id}")
    if not pack.get("enabled", True):
        raise HTTPException(status_code=403, detail="该技能已下架维护中")

    try:
        values = normalize_inputs(pack, req.inputs or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cost = int(pack.get("points", 5))
    key_obj = get_or_create_key(db, api_key)
    if key_obj.balance < cost:
        raise HTTPException(status_code=402, detail="余额不足，请先充值")

    task_id = create_task(api_key, pack, values)
    return {
        "task_id": task_id,
        "status": "running",
        "progress": 0,
        "skill_id": pack.get("skill_id"),
        "points": cost,
    }


@router.get("/skills/gen/tasks/{task_id}")
def poll(task_id: str):
    res = get_task(task_id)
    if res is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return res
