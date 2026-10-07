"""
保禄AI增长OS · 通用点数计费后端配置
与 baolu-os-v2-source 完全解耦，独立运行。
"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    # 服务
    HOST: str = '127.0.0.1'
    PORT: int = 3003
    DEBUG: bool = False

    # 数据库
    DATABASE_URL: str = 'sqlite:///./billing.db'

    # 安全
    ADMIN_TOKEN: str = ''  # 用于内部管理接口，如手动补点

    # 计费
    TRIAL_POINTS: int = 0           # 公域不送免费体验点，防撸羊毛；定制客户走 admin 单独加
    WELCOME_POINTS: int = 0         # 额外赠送
    TASK_COST_POINTS: int = 5       # 每次选题任务扣点数
    TOPICS_POINTS: int = 5          # 每次选题日报扣点数（与 TASK_COST_POINTS 对齐）
    CONTENT_POINTS: int = 8         # 每次内容创作任务扣点数（比选题重）

    # 真实生成（接 OS-v2 baolu_topics 内部接口）
    TOPICS_GEN_URL: str = ''          # 3002 内部选题生成接口，留空则服务端直连百炼
    TOPICS_GEN_TOKEN: str = ''        # 服务间鉴权 token（ops token）
    TOPICS_GEN_TIMEOUT: int = 120     # 真实生成请求超时（秒）

    # 真实生成（服务端直连百炼 DEEPSEEK，密钥只存 3007 服务端 .env，属思潼后端）
    DEEPSEEK_API_KEY: str = ''
    DEEPSEEK_BASE_URL: str = ''
    DEEPSEEK_MODEL: str = ''

    # 数字分身工厂（费用动态配置，改这里/改 .env 即全站生效，客户端话术不写死数字）
    TWIN_DEV_FEE_POINTS: int = 2600      # 制作费：造一个分身一次扣，失败全额返还
    TWIN_CALL_POINTS: int = 12           # 调用费：分身每次调用扣点
    TWIN_REFINE_FREE: bool = True        # 精调免费（越用越像闭环不收费）
    TWIN_REFINE_TRIGGER: int = 5         # 未处理反馈攒够 N 条提示精调
    TWIN_FIDELITY_PASS: int = 7          # 保真自检及格线（0-10）
    TWIN_DRAFT_TTL_HOURS: int = 24       # 画像草稿有效时长

    # 古人经营智慧（六顾问 chat）：0 点 = 免费体验期，不扣点；改 >0 即开按次扣点
    GU_POINTS_PER_CALL: int = 0        # 每问一次扣点（10 积分 = 1 元；按次 ¥1-3 对应 10-30）
    GU_DAILY_FREE_CALLS: int = 10      # 免费期每 Key 每日赠送问答次数（0 = 不限次）
    GU_CONV_TTL_HOURS: int = 6         # 会话内存保留时长（超时清理，续聊需新会话）
    GU_MAX_CONTEXT_MESSAGES: int = 16  # 送入模型的最大历史条数（控 token 成本）
    GU_TIMEOUT: int = 90               # 单次问答超时（秒）
    GU_MAX_MESSAGE_CHARS: int = 500    # 用户单条消息最大字数

    # 周旭数字分身（股权咨询 chat）：0 点 = 免费体验期，不扣点；改 >0 即开按次扣点
    ZX_POINTS_PER_CALL: int = 0        # 每问一次扣点（10 积分 = 1 元；按次 ¥1-3 对应 10-30）
    ZX_DAILY_FREE_CALLS: int = 10      # 免费期每 Key 每日赠送问答次数（0 = 不限次；转人工不计次）
    ZX_CONV_TTL_HOURS: int = 6         # 会话内存保留时长（超时清理，续聊需新会话）
    ZX_MAX_CONTEXT_MESSAGES: int = 16  # 送入模型的最大历史条数（控 token 成本）
    ZX_TIMEOUT: int = 90               # 单次问答超时（秒）
    ZX_MAX_MESSAGE_CHARS: int = 500    # 用户单条消息最大字数

    # 语音转写 ASR（DashScope compatible-mode /audio/transcriptions；留空 = 前端🎤提示未开通）
    ZX_ASR_API_URL: str = ''           # 如 https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions
    ZX_ASR_API_KEY: str = ''
    ZX_ASR_MODEL: str = 'qwen3-asr-flash'
    ZX_MAX_VOICE_MB: int = 8           # 录音上传上限（前端限录 60 秒，双保险）

    # 多模态解析（留空 = 图片/音视频降级为存档，走 V1.0 行为）
    TWIN_OCR_API_URL: str = ''           # 图片 OCR 接口（OpenAI 兼容 vision 或自建）
    TWIN_OCR_API_KEY: str = ''
    TWIN_ASR_API_URL: str = ''           # 音频/视频 ASR 接口（Paraformer/whisper 兼容）
    TWIN_ASR_API_KEY: str = ''

    # 套餐配置：points=实际到账点数, price_cny=人民币分（微信支付单位）
    PACKAGES: dict = {
        'starter': {'points': 500,  'price_cny': 1900,  'name': '入门小包'},
        'pro':     {'points': 1950, 'price_cny': 6900,  'name': '进阶推荐包'},
        'team':    {'points': 6400, 'price_cny': 19900, 'name': '旗舰超大包'},
    }

    # 微信支付（真实模式）
    WECHAT_PAY_MOCK: bool = True
    WECHAT_PAY_MCHID: str = ''
    WECHAT_PAY_PRIVATE_KEY: str = ''  # 文件路径或 PEM 内容
    WECHAT_PAY_CERT_SERIAL_NO: str = ''
    WECHAT_PAY_APIV3_KEY: str = ''
    WECHAT_PAY_APPID: str = ''
    WECHAT_PAY_NOTIFY_URL: str = 'https://api.lcppch.top/os-v2/api/skills/recharge/notify'
    WECHAT_PAY_DESCRIPTION: str = '思潼AI增长OS-通用点数充值'

    # CORS
    CORS_ORIGINS: str = '*'  # 生产环境建议改成具体域名


@lru_cache()
def get_settings() -> Settings:
    return Settings()
