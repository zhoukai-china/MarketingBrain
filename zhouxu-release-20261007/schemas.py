"""
Pydantic 请求/响应模型
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class KeyApplyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, description="称呼/姓名")
    contact: str = Field(..., min_length=1, max_length=120, description="微信/手机号")
    usage: Optional[str] = Field(default='', max_length=500, description="主要用途")


class KeyApplyResponse(BaseModel):
    api_key: str
    points: int
    balance: int
    message: str = '申请成功'


class BalanceResponse(BaseModel):
    balance: int
    mask: str
    total_recharged: int


class RechargeRequest(BaseModel):
    api_key: str = Field(..., min_length=8)
    package: str = Field(..., pattern=r'^(starter|pro|team)$')
    pay_method: str = Field(default='wechat', pattern=r'^(wechat|alipay)$')


class RechargeResponse(BaseModel):
    order_id: str
    pay_url: str = ''
    qr_url: str = ''
    amount_cny: int  # 分
    points: int
    status: str = 'pending'
    message: str = '订单创建成功，请扫码支付'
    mock: bool = False  # true 表示当前为 mock 模式，前端可显示模拟支付按钮


class RechargeStatusResponse(BaseModel):
    order_id: str
    status: str  # pending / paid / failed / closed
    points: int
    paid_at: Optional[str] = None


class RecordItem(BaseModel):
    time: str
    type: str
    delta: int
    balance: int
    note: str


class RecordsResponse(BaseModel):
    records: List[RecordItem]


class MockPayRequest(BaseModel):
    order_id: str = Field(..., min_length=8)


class MockPayResponse(BaseModel):
    order_id: str
    status: str
    points: int
    balance: int
    message: str = '模拟支付成功'


class WechatNotifyResponse(BaseModel):
    code: str = 'SUCCESS'
    message: str = 'OK'


class ConsumeRequest(BaseModel):
    api_key: str = Field(..., min_length=8)
    points: int = Field(..., gt=0, description='本次消费点数')
    reason: str = Field(default='技能消费', max_length=200, description='消费原因')


class ConsumeResponse(BaseModel):
    balance: int
    consumed: int


class ErrorResponse(BaseModel):
    code: str
    message: str
