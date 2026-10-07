"""
保禄AI增长OS · 通用点数计费后端（独立项目）
与 baolu-os-v2-source 解耦，运行在 127.0.0.1:3003，通过 nginx 反向代理对外暴露 /os-v2/api/skills/*。
"""
import os
from contextlib import asynccontextmanager
from datetime import datetime

import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from config import get_settings
from db import (
    init_db,
    get_db,
    generate_api_key,
    ApiKey,
    Order,
    PointRecord,
    get_or_create_key,
    change_balance,
    create_order,
)
from payment import payment_backend
from content_routes import router as content_router
from topics_routes import router as topics_router
from gen_routes import router as gen_router
from twin_routes import router as twin_router
from gu_routes import router as gu_router
from zx_routes import router as zx_router
from schemas import (
    KeyApplyRequest,
    KeyApplyResponse,
    BalanceResponse,
    RechargeRequest,
    RechargeResponse,
    RechargeStatusResponse,
    MockPayRequest,
    MockPayResponse,
    RecordsResponse,
    RecordItem,
    ConsumeRequest,
    ConsumeResponse,
    WechatNotifyResponse,
    ErrorResponse,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="思潼AI增长OS · 通用点数计费后端",
    description="为 WorkBuddy/SkillHub 云端技能提供 API Key、余额、充值、点数记录服务。",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(',') if o.strip()]
if origins == ['*']:
    origins = ['*']
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# 错误处理
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={'code': 'ERROR', 'message': exc.detail},
    )


# 健康检查
@app.get('/health')
@app.get('/skills/health')
def health():
    return {'status': 'ok', 'service': 'baolu-skill-billing', 'mock': settings.WECHAT_PAY_MOCK}


# 申请 Key（新用户）
@app.post('/skills/keys', response_model=KeyApplyResponse)
def apply_key(req: KeyApplyRequest, db: Session = Depends(get_db)):
    key_value = generate_api_key()
    key_obj = ApiKey(
        key=key_value,
        name=req.name,
        contact=req.contact,
        usage=req.usage or '',
        balance=0,
    )
    db.add(key_obj)
    db.commit()
    db.refresh(key_obj)

    # 赠送体验点
    trial_points = settings.TRIAL_POINTS + settings.WELCOME_POINTS
    if trial_points > 0:
        change_balance(
            db, key_value, trial_points, '赠送',
            note='新用户首次申请 Key 赠送体验点',
        )

    return KeyApplyResponse(
        api_key=key_value,
        points=trial_points,
        balance=trial_points,
    )


# 查询余额
@app.get('/skills/balance', response_model=BalanceResponse)
def get_balance(api_key: str, db: Session = Depends(get_db)):
    key_obj = get_or_create_key(db, api_key)
    return BalanceResponse(
        balance=key_obj.balance,
        mask=key_obj.key[-6:] if len(key_obj.key) >= 6 else key_obj.key,
        total_recharged=key_obj.total_recharged,
    )


# 充值下单
@app.post('/skills/recharge', response_model=RechargeResponse)
def recharge(req: RechargeRequest, db: Session = Depends(get_db)):
    pkg = settings.PACKAGES.get(req.package)
    if not pkg:
        raise HTTPException(status_code=400, detail='套餐不存在')

    # 确保 key 已存在
    get_or_create_key(db, req.api_key)

    order = create_order(
        db,
        api_key=req.api_key,
        package=req.package,
        points=pkg['points'],
        price_cny=pkg['price_cny'],
        pay_method=req.pay_method,
        qr_url='',
    )
    try:
        pay_url, qr_url = payment_backend.create_order(db, order)
    except Exception as e:
        order.status = 'failed'
        db.commit()
        raise HTTPException(status_code=500, detail=f'支付下单失败: {e}')

    order.qr_url = qr_url
    db.commit()

    return RechargeResponse(
        order_id=order.order_id,
        pay_url=pay_url,
        qr_url=qr_url,
        amount_cny=order.price_cny,
        points=order.points,
        status=order.status,
        mock=settings.WECHAT_PAY_MOCK,
    )


# 查询订单状态
@app.get('/skills/recharge/status', response_model=RechargeStatusResponse)
def recharge_status(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail='订单不存在')
    return RechargeStatusResponse(
        order_id=order.order_id,
        status=order.status,
        points=order.points,
        paid_at=order.paid_at.isoformat() if order.paid_at else None,
    )


# Mock 模式：模拟支付完成（仅 WECHAT_PAY_MOCK=true 时可用，用于测试完整链路）
@app.post('/skills/recharge/mock-pay', response_model=MockPayResponse)
def mock_pay(req: MockPayRequest, db: Session = Depends(get_db)):
    if not settings.WECHAT_PAY_MOCK:
        raise HTTPException(status_code=403, detail='仅 mock 模式可用')
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail='订单不存在')
    if order.status == 'paid':
        key_obj = get_or_create_key(db, order.api_key)
        return MockPayResponse(
            order_id=order.order_id,
            status='paid',
            points=order.points,
            balance=key_obj.balance,
            message='该订单已支付',
        )
    order.status = 'paid'
    order.paid_at = datetime.utcnow()
    db.add(order)
    rec = change_balance(
        db, order.api_key, order.points, '充值',
        note=f"模拟支付-{order.package}", order_id=order.order_id,
    )
    if not rec:
        raise HTTPException(status_code=500, detail='模拟支付到账失败')
    db.commit()
    return MockPayResponse(
        order_id=order.order_id,
        status='paid',
        points=order.points,
        balance=rec.balance,
        message='模拟支付成功，点数已到账',
    )


# 微信支付回调
@app.post('/skills/recharge/notify', response_model=WechatNotifyResponse)
async def wechat_notify(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    headers = dict(request.headers)
    result = payment_backend.handle_notify(db, body, headers)
    if result.get('code') != 'SUCCESS':
        raise HTTPException(status_code=400, detail=result.get('message', 'FAIL'))
    return WechatNotifyResponse()


# 点数记录
@app.get('/skills/records', response_model=RecordsResponse)
def get_records(api_key: str, db: Session = Depends(get_db)):
    if not api_key:
        raise HTTPException(status_code=400, detail='api_key 不能为空')
    records = (
        db.query(PointRecord)
        .filter(PointRecord.api_key == api_key)
        .order_by(PointRecord.created_at.desc())
        .limit(100)
        .all()
    )
    return RecordsResponse(records=[
        RecordItem(
            time=rec.created_at.strftime('%Y-%m-%d %H:%M') if rec.created_at else '-',
            type=rec.type,
            delta=rec.delta,
            balance=rec.balance,
            note=rec.note or '',
        )
        for rec in records
    ])


# 消费扣点（由云端 skill 后端调用，如 baolu-topics-hub 选题生成后）
@app.post('/skills/consume', response_model=ConsumeResponse)
def consume_points(req: ConsumeRequest, db: Session = Depends(get_db)):
    rec = change_balance(db, req.api_key, -req.points, '消费', note=req.reason)
    if not rec:
        raise HTTPException(status_code=402, detail='余额不足')
    return ConsumeResponse(balance=rec.balance, consumed=req.points)


# 手动补点/管理接口（需 ADMIN_TOKEN）
@app.post('/admin/add-points')
def admin_add_points(
    api_key: str,
    points: int,
    note: str = '管理补点',
    admin_token: str = Header(default=''),
    db: Session = Depends(get_db),
):
    if not settings.ADMIN_TOKEN or admin_token != settings.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail='未授权')
    if points <= 0:
        raise HTTPException(status_code=400, detail='点数必须为正')
    rec = change_balance(db, api_key, points, '赠送', note=note)
    if not rec:
        raise HTTPException(status_code=404, detail='Key 不存在')
    return {'balance': rec.balance, 'added': points}


# 内容创作任务接口（原型）：/skills/content/tasks
app.include_router(content_router)

# 选题任务接口（原型）：/skills/topics/tasks
app.include_router(topics_router)

# 通用薄壳技能引擎（配置驱动）：/skills/gen/tasks
app.include_router(gen_router)

# 数字分身工厂：素材上传 / 造分身 / 我的分身：/skills/twin/*
app.include_router(twin_router)

# 古人智慧团：六顾问多轮 chat（SSE 流式）：/skills/gu/*
app.include_router(gu_router)

# 周旭数字分身：股权咨询多轮 chat（SSE 流式 + 转人工）：/skills/zhouxu/*
app.include_router(zx_router)


if __name__ == '__main__':
    uvicorn.run(
        'main:app',
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
