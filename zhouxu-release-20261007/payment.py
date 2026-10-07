"""
支付层：支持 Mock 模式（默认，无需微信商户配置）和真实微信支付模式。
"""
import io
import base64
from datetime import datetime
from typing import Tuple, Optional

import qrcode
from sqlalchemy.orm import Session

from config import get_settings
from db import change_balance, Order

settings = get_settings()


def _generate_mock_qr_url(order_id: str, amount_cny: int) -> str:
    """Mock：生成一个 data URL 的二维码，扫描后显示订单号与金额。"""
    content = f"订单 {order_id} | 金额 ¥{amount_cny/100:.2f} | 支付后自动到账"
    img = qrcode.make(content, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


class PaymentBackend:
    def create_order(self, db: Session, order: Order) -> Tuple[str, str]:
        """
        返回 (pay_url, qr_url)。
        mock 模式下二者相同，都是 data URL 二维码。
        """
        amount = order.price_cny
        if settings.WECHAT_PAY_MOCK:
            qr = _generate_mock_qr_url(order.order_id, amount)
            return qr, qr
        return self._create_wechat_order(db, order)

    def _create_wechat_order(self, db: Session, order: Order) -> Tuple[str, str]:
        """真实微信支付：Native 支付，返回 code_url（可转成二维码）。"""
        try:
            from wechatpayv3 import WeChatPay, WeChatPayType
        except ImportError as e:
            raise RuntimeError("wechatpayv3 未安装，请先 pip install -r requirements.txt") from e

        wx = WeChatPay(
            wechatpay_type=WeChatPayType.NATIVE,
            mchid=settings.WECHAT_PAY_MCHID,
            private_key=settings.WECHAT_PAY_PRIVATE_KEY,
            cert_serial_no=settings.WECHAT_PAY_CERT_SERIAL_NO,
            apiv3_key=settings.WECHAT_PAY_APIV3_KEY,
            appid=settings.WECHAT_PAY_APPID,
            notify_url=settings.WECHAT_PAY_NOTIFY_URL,
        )
        amount_obj = {'total': order.price_cny}
        code, resp = wx.pay(
            description=settings.WECHAT_PAY_DESCRIPTION,
            out_trade_no=order.order_id,
            amount=amount_obj,
        )
        if code != 200 or not resp.get('code_url'):
            raise RuntimeError(f"微信支付下单失败: {resp}")
        code_url = resp['code_url']
        qr = _generate_mock_qr_url(order.order_id, order.price_cny)
        # 真实场景下前端也可以直接把 code_url 转成二维码；这里保持接口一致
        return code_url, qr

    def handle_notify(self, db: Session, body: bytes, headers: dict) -> dict:
        """处理微信支付回调；mock 模式不应被外部调用。"""
        if settings.WECHAT_PAY_MOCK:
            return {'code': 'FAIL', 'message': 'mock mode does not accept notify'}
        try:
            from wechatpayv3 import WeChatPay, WeChatPayType
        except ImportError as e:
            raise RuntimeError("wechatpayv3 未安装") from e

        wx = WeChatPay(
            wechatpay_type=WeChatPayType.NATIVE,
            mchid=settings.WECHAT_PAY_MCHID,
            private_key=settings.WECHAT_PAY_PRIVATE_KEY,
            cert_serial_no=settings.WECHAT_PAY_CERT_SERIAL_NO,
            apiv3_key=settings.WECHAT_PAY_APIV3_KEY,
            appid=settings.WECHAT_PAY_APPID,
            notify_url=settings.WECHAT_PAY_NOTIFY_URL,
        )
        result = wx.callback(headers=headers, body=body)
        if not result:
            return {'code': 'FAIL', 'message': 'invalid signature'}

        out_trade_no = result.get('out_trade_no')
        transaction_id = result.get('transaction_id')
        trade_state = result.get('trade_state')

        order = db.query(Order).filter(Order.order_id == out_trade_no).first()
        if not order:
            return {'code': 'FAIL', 'message': 'order not found'}
        if trade_state == 'SUCCESS' and order.status != 'paid':
            order.status = 'paid'
            order.transaction_id = transaction_id or ''
            order.paid_at = datetime.utcnow()
            db.add(order)
            change_balance(
                db, order.api_key, order.points, '充值',
                note=f"微信支付-{order.package}", order_id=order.order_id,
            )
            db.commit()
        return {'code': 'SUCCESS', 'message': 'OK'}


payment_backend = PaymentBackend()
