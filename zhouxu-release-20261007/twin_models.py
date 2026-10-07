"""
数字分身工厂数据模型
====================

挂在 db.Base 上，init_db() 自动建表，无需迁移脚本。

- TwinMaterial  用户为「造分身」上传的素材（文本 / 链接 / 文件 / 图片 / 音频）
- DigitalTwin   造好的用户专属数字分身（SOUL + 可调用的 pack 配置，仅限本平台调用）
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime

from db import Base


class TwinMaterial(Base):
    __tablename__ = 'twin_materials'

    id = Column(Integer, primary_key=True, index=True)
    material_id = Column(String(40), unique=True, index=True, nullable=False)  # mat_<hex>
    owner_api_key = Column(String(64), index=True, nullable=False)
    kind = Column(String(16), nullable=False)          # text / link / file / image / audio / video
    name = Column(String(200), default='')             # 展示名（文件名 / 链接域名 / 用户起的名）
    content = Column(Text, default='')                 # 解析出的文本（图片/音频可能为空）
    raw_path = Column(String(400), default='')         # 原始文件落盘路径（仅文件/图片/音频）
    status = Column(String(16), default='parsed')      # parsed / stored / failed
    note = Column(String(300), default='')             # 解析说明（给技能转述用户）
    created_at = Column(DateTime, default=datetime.utcnow)


class DigitalTwin(Base):
    __tablename__ = 'digital_twins'

    id = Column(Integer, primary_key=True, index=True)
    twin_skill_id = Column(String(40), unique=True, index=True, nullable=False)  # twin_<hex>
    owner_api_key = Column(String(64), index=True, nullable=False)
    name = Column(String(60), default='')              # 分身名（如「王律师分身」）
    role = Column(String(60), default='')              # 主人身份（老板 / 律师 / 医生…）
    industry = Column(String(60), default='')
    audience = Column(String(200), default='')         # 服务对象
    status = Column(String(16), default='ready')       # ready / disabled
    soul = Column(Text, default='')                    # SOUL JSON（人设卡/方法论/语言指纹/交付格式…）
    pack = Column(Text, default='')                    # 可调用 pack JSON（inputs/system_prompt/计费…）
    points_per_call = Column(Integer, default=12)      # 每次调用扣点
    call_count = Column(Integer, default=0)            # 累计被调用次数
    version = Column(Integer, default=1)               # 当前 SOUL 版本（精调/回滚递增）
    build_task_id = Column(String(40), default='')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MaterialCard(Base):
    """素材卡片化提炼：四类卡（fact 事实 / method 方法 / gold 金句 / dialogue 对话样例）。"""
    __tablename__ = 'twin_material_cards'

    id = Column(Integer, primary_key=True, index=True)
    owner_api_key = Column(String(64), index=True, nullable=False)
    material_id = Column(String(40), index=True, default='')   # 出处素材（可溯源、随素材删除）
    draft_id = Column(String(40), index=True, default='')      # 所属画像草稿
    card_type = Column(String(16), nullable=False)             # fact / method / gold / dialogue
    content = Column(Text, default='')                         # 卡片内容（一句话）
    created_at = Column(DateTime, default=datetime.utcnow)


class TwinFeedback(Base):
    """越用越像闭环：主人对分身交付的评价回流。"""
    __tablename__ = 'twin_feedbacks'

    id = Column(Integer, primary_key=True, index=True)
    twin_skill_id = Column(String(40), index=True, nullable=False)
    owner_api_key = Column(String(64), index=True, nullable=False)
    run_id = Column(String(40), default='')                    # 对应 gen 任务 id
    rating = Column(String(8), nullable=False)                 # like / unlike
    note = Column(String(300), default='')                     # 哪里不像、该怎么改
    processed = Column(Integer, default=0)                     # 0=未处理 1=已并入某次精调
    created_at = Column(DateTime, default=datetime.utcnow)


class TwinVersion(Base):
    """分身 SOUL 版本历史：造分身=v1，每次精调+1，可回滚。"""
    __tablename__ = 'twin_versions'

    id = Column(Integer, primary_key=True, index=True)
    twin_skill_id = Column(String(40), index=True, nullable=False)
    owner_api_key = Column(String(64), index=True, nullable=False)
    version = Column(Integer, nullable=False)
    soul_json = Column(Text, default='')
    refine_note = Column(String(500), default='')              # 本次版本改了什么（给主人看）
    created_at = Column(DateTime, default=datetime.utcnow)
