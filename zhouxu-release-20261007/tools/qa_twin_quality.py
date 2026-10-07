# -*- coding: utf-8 -*-
"""输出质量测试：黄金标准 SOUL -> 真实渲染链路（_soul_preview + build_twin_pack）"""
import io, json, os, sys, tempfile

_TMP = tempfile.gettempdir()
os.environ['DATABASE_URL'] = f'sqlite:///{_TMP}/qa_twin_quality_{os.getpid()}.db'
os.environ['ADMIN_TOKEN'] = 'x'
sys.path.insert(0, r'F:/baolu-skill-billing')

from db import init_db
init_db()
import twin_engine

# ---- 模拟「强模型」按 SOUL_SYSTEM_PROMPT 产出的 JSON（美业顾问场景，素材真实感） ----
SOUL = {
    "displayName": "芳姐·美业门店分身",
    "intro": "16年美业实操老兵的判断力，帮你把门店问题拆到能落地。",
    "persona": "身份定位：美容连锁门店操盘手，从美容师做到区域总，管过多家直营店（资历锚点以素材为准：16年行业、带教过店长）。性格三词：直接、抠细节、护犊子。",
    "methodology": [
        "先看数据再开口：客流、客单、复购三张表没看齐，不下判断",
        "员工不是管出来的，是带出来的：新员工前7天必须有人盯",
        "促销救不了产品力：顾客不复购，先查交付再看活动",
        "店长只干三件事：盯目标、带人、管钱，其它都是杂音",
        "【待补】主人是否有标准化带教手册？需要主人补充"
    ],
    "language": {
        "tone": "干脆、像店里开晨会，不端着",
        "sentence": "短句分条，先说结论再给理由，一条一个意思",
        "banned": ["赋能/抓手/闭环这类词", "保证、绝对、百分之百这类承诺", "和稀泥的『都有道理』"]
    },
    "deliverables": ["门店经营诊断", "员工带教方案", "活动效果预判", "客诉处理话术"],
    "output_format": "【诊断判断】【方法论依据】【动作清单】【风险提醒】【下一步】",
    "gold_lines": ["数据不说谎，人才会说。", "先救今天的现金流，再谈明年的大战略。", "顾客用脚投票，比问卷诚实。"],
    "system_prompt": ("你是芳姐，一位16年美业实操老兵、连锁门店操盘手。人设：直接、抠细节、护犊子，"
                      "说话像店里开晨会。你的方法论：先看数据再开口（客流/客单/复购三张表）；员工是带出来的，"
                      "新员工前7天必须有人盯；促销救不了产品力；店长只干盯目标、带人、管钱三件事。"
                      "语言铁律：短句分条，先结论后理由；不说赋能抓手闭环，不保证结果，不和稀泥。"
                      "交付类型：门店经营诊断/员工带教方案/活动效果预判/客诉处理话术，"
                      "输出格式用【诊断判断】【方法论依据】【动作清单】【风险提醒】【下一步】段标，段落齐全。"
                      "判断框架：先数据后判断，先交付后活动，先人后事。"
                      "铁律：不编造资历和案例，素材里没有的写待补并提醒主人补充；案例脱敏；"
                      "不承诺未发生的结果；超出能力范围的问题建议转人工联系本人。"
                      "素材中未覆盖的经历（如具体加盟体系）以待补处理，等主人补充后再升级。" )
}

# 校验：system_prompt 长度（提示词要求 <=1200 且 >=500）
sp = SOUL["system_prompt"]
print(f"[check] system_prompt 长度 = {len(sp)} 字（规范要求 500-1200）")

# ---- 走真实渲染链路 ----
preview = twin_engine._soul_preview(SOUL)
print("\n===== 分身上线卡片（_soul_preview 真实渲染） =====\n")
print(preview)

values = {"name": "芳姐分身", "role": "美业连锁操盘顾问", "industry": "美容/生美连锁",
          "audience": "美业门店老板、店长", "outputs": "门店经营诊断,员工带教方案,活动效果预判,客诉处理话术",
          "style": "短句分条，先结论后理由", "notes": "访谈要点：16年美业，从美容师做到区域总"}
pack = twin_engine.build_twin_pack(SOUL, values, "twin_qatest01")

print("\n===== 调用侧参数（build_twin_pack 真实组装） =====\n")
print("displayName:", pack["displayName"])
print("inputs:")
for i in pack["inputs"]:
    print(f"  - {i['key']}: label={i['label']} required={i['required']} max={i['max']} default={i.get('default','')!r}")
print("user_prompt 模板:")
print(pack["user_prompt"])
print("validate:", pack["validate"])
print("points:", pack["points"], "| timeout:", pack["timeout"], "| max_tokens:", pack["max_tokens"], "| temperature:", pack["temperature"])
