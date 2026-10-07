"""
周旭数字分身 · 数据模型
========================

挂在 db.Base 上，init_db() 自动建表，无需迁移脚本。

- ZxQuota  免费体验期的每日免费问答配额（每 Key 每天 ZX_DAILY_FREE_CALLS 次；
           按天计次、跨天自然重置；计费模式 ZX_POINTS_PER_CALL>0 时不走此表）
           与古人经营智慧 GuQuota 分表：同一条 API Key 在两个产品各享各的每日额度。
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from db import Base


class ZxQuota(Base):
    __tablename__ = 'zx_quotas'
    __table_args__ = (UniqueConstraint('api_key', 'quota_date', name='uq_zx_quota_key_day'),)

    id = Column(Integer, primary_key=True, index=True)
    api_key = Column(String(64), index=True, nullable=False)
    quota_date = Column(String(10), index=True, nullable=False)   # 'YYYY-MM-DD'（服务器本地日期）
    used_count = Column(Integer, default=0)                       # 今日已用次数
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
