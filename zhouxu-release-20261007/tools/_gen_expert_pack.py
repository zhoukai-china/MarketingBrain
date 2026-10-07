#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成创始人IP获客增长专家（自包含后端编排版）的两个 pack JSON。
- 普通版 baolu-founder-ip-expert-hub：用户用思潼点数，单次扣 points
- Pay版 baolu-founder-ip-expert-pay：平台付费后放行，不扣思潼点数
两者 routing 完全一致，子技能用后端真实 skill_id（无 -hub 后缀）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "skill_packs"

BRIEF = "以下是创始人/企业主的真实情况描述，请据此输出针对性方案：\n{brief}"

ROUTING = [
    {
        "skill_id": "ip-positioning",
        "label": "一、IP定位全案",
        "user_prompt": "你是创始人IP定位专家。基于以下创始人情况，用七步定位法输出完整IP定位全案（行业赛道选择、目标人群画像、人设标签金字塔、内容主线三条、差异化买点、表达风格、起号节奏与首月内容规划）：\n" + "{brief}",
    },
    {
        "skill_id": "ip-four-piece",
        "label": "二、账号门面四件套",
        "user_prompt": "你是账号门面设计专家。基于以下创始人情况，输出抖音/视频号账号四件套方案（名字、签名档、头像、背景图），每个给2-3个选项+选择理由+避坑：\n" + "{brief}",
    },
    {
        "skill_id": "acquisition-diagnosis",
        "label": "三、获客成交链路诊断",
        "user_prompt": "你是获客链路诊断专家。基于以下创始人情况，做获客成交链路体检（曝光→兴趣→咨询→留资→到店/成交各环健康度、卡点定位、优先级修复动作）：\n" + "{brief}",
    },
    {
        "skill_id": "video-review-engine",
        "label": "四、短视频复盘方法论",
        "user_prompt": "你是短视频复盘专家。基于以下创始人情况，输出短视频内容复盘方法论与日常自查清单（爆款共性、4象限复盘框架、数据看板指标、内容迭代节奏）：\n" + "{brief}",
    },
    {
        "skill_id": "live-script-planner",
        "label": "五、直播话术母版",
        "user_prompt": "你是直播话术策划专家。基于以下创始人情况，输出一场2小时直播的逐字稿母版（开场留人、信任建立、价值输出、产品/招商钩子、逼单、转粉），标注节奏与情绪点：\n" + "{brief}",
    },
    {
        "skill_id": "ad-delivery-plan",
        "label": "六、投流计划（抖加/本地推/视频号）",
        "user_prompt": "你是投放策略专家。基于以下创始人情况与预算，输出投流计划（优先自然流量闭环；如确有放量需求，给出抖加/巨量本地推/视频号微信豆的分别打法、出价、素材方向、预算分配、数据监控红线）：\n" + "{brief}",
    },
    {
        "skill_id": "baodian-boost",
        "label": "七、爆店体系与矩阵",
        "user_prompt": "你是爆店体系专家。基于以下创始人情况，输出精准流量做高转化的打法（买点思维、矩阵营销、代运营vs自运营建议、职人号矩阵搭建步骤）：\n" + "{brief}",
    },
    {
        "skill_id": "moments-planner",
        "label": "八、私域朋友圈日历",
        "user_prompt": "你是私域朋友圈专家。基于以下创始人情况，输出21天朋友圈内容日历（七柱内容体系：工作现场/客户问题/方法论/案例证据/价值观/生活温度/软邀约），每天1条带文案示例：\n" + "{brief}",
    },
    {
        "skill_id": "sales-advisor",
        "label": "九、销售话术与跟单SOP",
        "user_prompt": "你是销售转化专家。基于以下创始人情况，输出销售话术与跟单sop（从公域咨询到私域成交的转化路径、异议处理话术、逼单节奏、复购裂变）：\n" + "{brief}",
    },
    {
        "skill_id": "yanglan-interview",
        "label": "十、创始人深度访谈脚本",
        "user_prompt": "你是深度访谈专家。基于以下创始人情况，输出一份创始人深度访谈提问脚本（挖掘个人故事、创业历程、价值观，作为IP内容素材库），含10个主线问题+追问设计：\n" + "{brief}",
    },
]

SYS = ("你是「创始人IP获客增长专家」，由思潼AI增长OS 出品。下面这份交付物是你后端自动编排10个专项技能后汇总而成的「创始人IP获客增长全案」。\n"
       "阅读时请按顺序：先定IP定位（一），再搭门面（二），诊断获客现状（三），然后内容（四）、直播（五）、投流（六）、矩阵（七）、私域（八）、销售（九），最后用访谈（十）沉淀素材。\n"
       "所有内容均为模型基于方法论生成的参考方案，正式对外使用前请人工复核合规、数据与品牌调性。")

USER_P = "创始人情况：\n{brief}"

def make(skill_id, slug, display, points, version):
    return {
        "skill_id": skill_id,
        "slug": slug,
        "name": "创始人IP获客增长专家",
        "displayName": display,
        "version": version,
        "points": points,
        "timeout": 600,
        "enabled": True,
        "compliance": False,
        "max_tokens": 6000,
        "temperature": 0.7,
        "description": "创始人IP获客增长专家·云端版【思潼AI增长OS·出品】。聚焦创始人个人IP打造到全渠道获客增长，后端自动编排10个专项技能（IP定位/门面四件套/获客诊断/短视频复盘/直播话术/投流/爆店矩阵/私域/销售/深度访谈）汇总成一份全案。自包含：只需安装本专家，无需另行安装子技能。",
        "intro": "本技能为**自包含云端版**：只需安装本专家一个，后端会自动串联10个专项方法论技能，一次性产出《创始人IP获客增长全案》。不用再单独安装任何子技能。",
        "deliverable": "产出一份结构化 Markdown 全案，含十个模块：IP定位全案、账号门面四件套、获客成交链路诊断、短视频复盘方法论、直播话术母版、投流计划、爆店体系与矩阵、私域朋友圈日历、销售话术与跟单SOP、创始人深度访谈脚本。",
        "inputs": [
            {"key": "brief", "label": "创始人/企业主情况描述", "required": True, "default": "", "max": 3000}
        ],
        "validate": {"min_chars": 1500},
        "system_prompt": SYS,
        "user_prompt": USER_P,
        "routing": ROUTING,
    }

hub = make(
    "baolu-founder-ip-expert-hub",
    "baolu-founder-ip-expert-hub",
    "创始人IP获客增长专家「思潼·出品」",
    30,
    "2.0.0",
)
pay = make(
    "baolu-founder-ip-expert-pay",
    "baolu-founder-ip-expert-pay",
    "创始人IP获客增长专家·Pay版「思潼·出品」",
    0,
    "2.0.0",
)

for pack in (hub, pay):
    PACKS.mkdir(exist_ok=True)
    p = PACKS / f"{pack['skill_id']}.json"
    p.write_text(json.dumps(pack, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[gen] wrote {p} ({len(json.dumps(pack, ensure_ascii=False))} bytes, routing={len(pack['routing'])} steps)")
