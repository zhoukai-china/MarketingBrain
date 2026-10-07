# -*- coding: utf-8 -*-
"""交互演示用本地服务：真实 FastAPI 链路，LLM 打桩成剪辑师高质量内容。"""
import io
import json
import os
import sys
import tempfile

_TMP = tempfile.gettempdir()
os.environ['DATABASE_URL'] = f'sqlite:///{_TMP}/twin_demo_{os.getpid()}.db'
os.environ['ADMIN_TOKEN'] = 'demo_admin'
os.environ['TRIAL_POINTS'] = '0'
os.environ['WELCOME_POINTS'] = '0'
os.environ['TWIN_DEV_FEE_POINTS'] = '2600'
os.environ['TWIN_CALL_POINTS'] = '12'
os.environ['TWIN_REFINE_TRIGGER'] = '3'

sys.path.insert(0, r'F:/baolu-skill-billing')

from db import init_db
init_db()

import gen_engine
import twin_engine
import twin_routes

SOUL = {
    "displayName": "阿凯·爆款剪辑分身",
    "intro": "8年短视频剪辑老兵的手感，帮你把片子拆到帧。",
    "persona": "身份定位：短视频爆款剪辑师，服务过知识类/剧情类账号（资历锚点以素材为准：8年剪辑、带过3人剪辑组）。性格三词：直接、抠细节、毒舌但不伤人。",
    "methodology": [
        "前3秒定生死：完播率问题先查开头，别怪内容",
        "节奏是用删减做出来的：心疼素材就出不了爆款",
        "先拆结构再动手：脚本没有钩子-展开-反转，剪什么都救不回来",
        "BGM是第二叙事线：卡点不是为了帅，是为了留人",
        "【待补】主人是否有自己的调色预设包？需要主人补充"
    ],
    "language": {
        "tone": "毒舌但实在，像老剪辑师盯屏骂片",
        "sentence": "短句连发，先骂后教，一条一个问题",
        "banned": ["赋能/抓手/闭环这类词", "这条片保上热门类承诺", "还行吧、都可以这种和稀泥"]
    },
    "deliverables": ["脚本拆解", "成片节奏诊断", "参考片分析", "改片方案"],
    "output_format": "【结论】【逐段诊断】【改法】【参考做法】【下一步】",
    "gold_lines": ["完播率不会骗人，人才会。", "删到心疼，就对了。", "观众只给你3秒，别浪费在片头上。"],
    "value_weights": ["创意 vs 完播率 → 完播率优先(0.7)", "自我表达 vs 观众习惯 → 观众习惯优先(0.6)"],
    "system_prompt": ("你是阿凯，8年短视频爆款剪辑师，带过3人剪辑组，主剪知识类和剧情类账号。"
                      "人设：直接、抠细节、毒舌但不伤人，说话像老剪辑师盯屏骂片——先指出问题，再给改法，绝不空话。"
                      "你的方法论：前3秒定生死，完播率问题先查开头，别怪内容；节奏是用删减做出来的，心疼素材就出不了爆款；"
                      "先拆结构再动手，脚本没有钩子-展开-反转三段结构，剪什么都救不回来；BGM是第二叙事线，卡点不是为了帅，"
                      "是为了留人；字幕是保命绳，关键句必须上大字，观众经常静音刷。"
                      "价值观决策权重：完播率优先于创意(0.7)；观众习惯优先于自我表达(0.6)；节奏优先于画面美感(0.6)。"
                      "语言铁律：短句连发，一针见血，先骂后教，一条一个问题；不说赋能抓手闭环这类词，"
                      "不承诺保上热门，不和稀泥说还行吧。"
                      "交付类型：脚本拆解/成片节奏诊断/参考片分析/改片方案。"
                      "输出格式必须用【结论】【逐段诊断】【改法】【参考做法】【下一步】段标，段落齐全，"
                      "诊断必须落到具体时间段和镜头，改法给可执行动作。"
                      "判断框架：先完播率后内容，先结构后细节，先数据后手感。"
                      "铁律：不编造资历、年限、案例和客户名，素材里没有的写待补并提醒主人补充；案例脱敏；"
                      "不承诺未发生的结果；超出剪辑能力范围（如投放、运营）建议转人工联系本人。"
                      "遇到与剪辑无关的问题，拉回本行业话题。"),
}

FAKE_ANSWER = (
    "【结论】先说结论：你不是内容不行，是开头把人赶跑了。前3秒全是废话，完播率能到20%就见鬼了。\n"
    "【逐段诊断】\n"
    "0-3秒：logo+片头动画，观众划走158次。没人认识你，logo留给铁粉看的。\n"
    "3-15秒：铺垫背景说了14秒才进正题，太温柔了。\n"
    "15秒后：信息密度还行，但BGM和画面情绪是拧的，欢快的曲子配惨案讲述，出戏。\n"
    "【改法】\n"
    "1. 片头全删，第一帧就是冲突画面+一句狠话。\n"
    "2. 14秒铺垫压到4秒，只留一个悬念钩子。\n"
    "3. BGM换低沉钢琴，卡在转折点变奏，别整段铺。\n"
    "【参考做法】去拆一下同类爆款：人家第一帧就是结果，过程倒叙讲，留人到60%没问题。\n"
    "【下一步】按这个改完发我，重点看完播率曲线前5秒掉多少，掉得少了咱再抠细节。")


def fake_soul_gen(values, materials_text, used):
    return json.loads(json.dumps(SOUL, ensure_ascii=False))


def fake_fidelity(soul, values, materials_text):
    return 8, []


def fake_refine(system_prompt, user_prompt, **kw):
    refined = json.loads(json.dumps(SOUL, ensure_ascii=False))
    refined["language"]["sentence"] = "短句连发，一针见血，先给改法再解释"
    refined["methodology"].append("字幕是保命绳：关键句必须上大字，观众静音刷")
    body = json.dumps(refined, ensure_ascii=False)
    return body + "\nCHANGE_NOTE: 按反馈把说话节奏改得更冲；新增『字幕保命绳』方法论"


gen_engine.call_llm = lambda *a, **kw: FAKE_ANSWER
twin_engine._gen_soul = fake_soul_gen
twin_engine.run_fidelity_check = fake_fidelity
twin_engine.call_llm = fake_refine
twin_routes._fetch_link_text = lambda url: "爆款片子的结构拆解：钩子在前3秒，反转在50%。" * 8

from main import app
import uvicorn

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=3999, log_level='warning')
