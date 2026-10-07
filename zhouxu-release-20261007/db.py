"""
SQLite 数据层：API Keys、余额、订单、点数记录。
"""
import os
import secrets
import string
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    DateTime,
    Text,
    select,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from config import get_settings

settings = get_settings()
Base = declarative_base()


def _sqlite_url() -> str:
    url = settings.DATABASE_URL
    # 兼容 Windows 路径：把 sqlite:///./ 解析到当前工作目录
    if url.startswith('sqlite:///./'):
        db_name = url.replace('sqlite:///./', '')
        abs_path = os.path.abspath(db_name)
        return f'sqlite:///{abs_path}'
    return url


engine = create_engine(_sqlite_url(), connect_args={'check_same_thread': False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class ApiKey(Base):
    __tablename__ = 'api_keys'
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(120), default='')
    contact = Column(String(120), default='')
    usage = Column(Text, default='')
    balance = Column(Integer, default=0, nullable=False)
    total_recharged = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)


class Order(Base):
    __tablename__ = 'orders'
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(64), unique=True, index=True, nullable=False)
    api_key = Column(String(64), index=True, nullable=False)
    package = Column(String(32), nullable=False)
    points = Column(Integer, nullable=False)
    price_cny = Column(Integer, nullable=False)  # 分
    status = Column(String(20), default='pending')  # pending / paid / failed / closed
    pay_method = Column(String(20), default='wechat')
    qr_url = Column(Text, default='')  # mock 二维码或真实 pay_url
    transaction_id = Column(String(80), default='')
    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PointRecord(Base):
    __tablename__ = 'point_records'
    id = Column(Integer, primary_key=True, index=True)
    api_key = Column(String(64), index=True, nullable=False)
    delta = Column(Integer, nullable=False)      # 正为增加，负为扣减
    balance = Column(Integer, nullable=False)    # 变动后余额
    type = Column(String(32), nullable=False)    # 充值 / 赠送 / 消费 / 退款
    note = Column(Text, default='')
    order_id = Column(String(64), default='')
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def generate_api_key() -> str:
    """生成 sk- 开头的 API Key。"""
    token = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32))
    return f'sk-{token}'


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_or_create_key(db: Session, key_value: str) -> ApiKey:
    obj = db.scalar(select(ApiKey).where(ApiKey.key == key_value))
    if not obj:
        obj = ApiKey(key=key_value, balance=0)
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def change_balance(
    db: Session,
    api_key: str,
    delta: int,
    type_: str,
    note: str = '',
    order_id: str = '',
) -> Optional[PointRecord]:
    """原子性余额变更。delta 正为加，负为减。余额不足时返回 None。"""
    key_obj = db.scalar(select(ApiKey).where(ApiKey.key == api_key))
    if not key_obj:
        return None
    if delta < 0 and key_obj.balance < abs(delta):
        return None
    key_obj.balance += delta
    key_obj.last_used_at = datetime.utcnow()
    rec = PointRecord(
        api_key=api_key,
        delta=delta,
        balance=key_obj.balance,
        type=type_,
        note=note,
        order_id=order_id,
    )
    db.add(key_obj)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def create_order(
    db: Session,
    api_key: str,
    package: str,
    points: int,
    price_cny: int,
    pay_method: str,
    qr_url: str,
) -> Order:
    order_id = 'ORD' + datetime.utcnow().strftime('%Y%m%d%H%M%S') + secrets.token_hex(4).upper()
    order = Order(
        order_id=order_id,
        api_key=api_key,
        package=package,
        points=points,
        price_cny=price_cny,
        pay_method=pay_method,
        qr_url=qr_url,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order
