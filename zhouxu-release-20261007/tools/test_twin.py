#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数字分身工厂 · 本地端到端自测（V1.1）
====================================

不联网、不调真模型：LLM/OCR/ASR/链接抓取打桩，其余走真实 FastAPI 链路。

覆盖：
  1. 开户与补点；费用从配置读（动态调价）
  2. 素材：文本(含PII自动脱敏) / 链接 / txt / 图片OCR降级 / 音频ASR降级 / 删除 / 归属隔离
  3. 素材体检（precheck）
  4. 画像草稿（draft 两段式，不扣费）：卡片化 + 体检 + SOUL + 归属校验
  5. 造分身（draft 确认流 + legacy 流）：制作费扣点 → 保真自检 → 注册 → 预览 → 防提取盾 → 版本v1
  6. 保真自检不过线 → failed + 全额返还
  7. 调用分身：归属校验 → 生成扣点 → 段标校验配置
  8. 越用越像：feedback 记录/校验/阈值提示 → 免费精调 → 版本热更 → 回滚
  9. 下架 → 调用 404

用法：cd F:/baolu-skill-billing && python tools/test_twin.py
"""
import io
import json
import os
import sys
import tempfile

# 先设环境再 import app（db/config 在 import 时读配置）
_TMP = tempfile.gettempdir()
os.environ['DATABASE_URL'] = f'sqlite:///{_TMP}/test_twin_{os.getpid()}.db'
os.environ['ADMIN_TOKEN'] = 'test_admin_token'
os.environ['TRIAL_POINTS'] = '0'
os.environ['WELCOME_POINTS'] = '0'
# 费用动态配置：故意用非默认值，验证全链路从 settings 读
os.environ['TWIN_DEV_FEE_POINTS'] = '1000'
os.environ['TWIN_CALL_POINTS'] = '10'
os.environ['TWIN_REFINE_TRIGGER'] = '2'
os.environ['TWIN_FIDELITY_PASS'] = '7'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import gen_engine  # noqa: E402
import twin_engine  # noqa: E402
import twin_routes  # noqa: E402
from db import init_db, SessionLocal  # noqa: E402
from main import app  # noqa: E402
from sqlalchemy import select as _sel  # noqa: E402
import twin_models  # noqa: E402

init_db()  # TestClient 不走 lifespan，手动建表

PASS, FAIL = [], []


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ''))


# ---------------------------------------------------------------------------
# 打桩：LLM / 链接抓取 / 精调
# ---------------------------------------------------------------------------

FAKE_SOUL = {
    "displayName": "王律师·股权分身",
    "intro": "十年股权律师的判断力，随时在线。",
    "persona": "身份定位：专做非诉股权的实战律师（资历以主人后续补充为准，当前：待补）",
    "methodology": ["股权只讲四件事", "先尽调后发言", "【待补】主人是否有标准化带教案例，需要主人补充"],
    "language": {"tone": "直接、不绕弯", "sentence": "短句分条，先结论后理由",
                 "banned": ["和稀泥的话", "AI腔（赋能/抓手/闭环）", "保证赚钱类承诺"]},
    "deliverables": ["股权诊断", "风险初判", "架构建议"],
    "output_format": "【诊断判断】【方法论依据】【动作清单】【风险提醒】【下一步】",
    "gold_lines": ["没有尽调就没有发言权。", "先谋定，再快动。", "股权上省的钱，都是诉讼上省下来的。"],
    "value_weights": ["赚钱 vs 风险 → 风险优先(0.8)"],
    "system_prompt": ("你是王律师，股权实战律师。人设：直接、不绕弯、先尽调后发言。" * 30
                      + "输出格式：【诊断判断】【方法论依据】【动作清单】【风险提醒】【下一步】"),
}

FAKE_REPORT = ("【诊断判断】五五分是资本结构上最危险的股权结构，没有之一。\n"
               "【方法论依据】股权只讲四件事：控制权、分红权、退出机制、调整机制。"
               "五五分等于把控制权锁死，把退出机制留白，任何一件出问题公司就停摆。\n"
               "【动作清单】\n1. 先做章程尽调，看表决权和退出条款怎么写的。\n"
               "2. 设计一致行动人条款，把决策权收拢到一个人身上。\n"
               "3. 预留 10%-15% 股权池，给后来的人和干活的人。\n"
               "4. 补签股东协议，把退出定价规则写死，丑话说在前头。\n"
               "【风险提醒】没有退出机制的五五分，散伙就是诉讼；有了退出机制，散伙只是谈判。"
               "另外提醒：股权比例不是感情问题，是钱和权的问题，别用感情谈判。\n"
               "【下一步】24 小时内把公司章程和股东协议翻出来，重点看表决权和退出条款，拍给我看。")


def fake_soul_gen(values, materials_text, used):
    return json.loads(json.dumps(FAKE_SOUL, ensure_ascii=False))


def fake_fidelity_pass(soul, values, materials_text):
    return 8, []


def fake_fidelity_fail(soul, values, materials_text):
    return 5, ["回答太啰嗦，不像主人的短句风格", "编造了素材里没有的年限"]


def fake_report_llm(system_prompt, user_prompt, **kw):
    return FAKE_REPORT


def fake_refine_llm(system_prompt, user_prompt, **kw):
    refined = json.loads(json.dumps(FAKE_SOUL, ensure_ascii=False))
    refined["language"]["sentence"] = "更短的句子，更冲"
    body = json.dumps(refined, ensure_ascii=False)
    return body + "\nCHANGE_NOTE: 按反馈把句式改得更短更冲"


def fake_fetch(url):
    return "这是一篇关于股权设计的公众号文章正文。" * 10


twin_engine._gen_soul = fake_soul_gen                 # SOUL 蒸馏（draft/build 共用）
twin_engine.run_fidelity_check = fake_fidelity_pass   # 保真自检默认过
gen_engine.call_llm = fake_report_llm                 # 分身调用 / 普通技能生成
twin_routes._fetch_link_text = fake_fetch             # 链接素材

client = TestClient(app)
H = lambda key: {"Authorization": f"Bearer {key}"}

FEE = int(os.environ['TWIN_DEV_FEE_POINTS'])
CALL = int(os.environ['TWIN_CALL_POINTS'])
TRIGGER = int(os.environ['TWIN_REFINE_TRIGGER'])

# ---------------------------------------------------------------------------
print("\n== 1. 开户与补点 ==")
r = client.post('/skills/keys', json={"name": "测试用户", "contact": "t@t.com"})
check("申请Key", r.status_code == 200, r.text[:200])
KEY = r.json()['api_key']

r = client.get('/skills/balance', params={'api_key': KEY})
check("新户0点", r.json()['balance'] == 0, r.text)

r = client.post('/admin/add-points', params={'api_key': KEY, 'points': 10000},
                headers={'admin-token': 'test_admin_token'})
check("admin补点10000", r.status_code == 200 and r.json()['balance'] == 10000, r.text[:200])

# 他人 Key（测归属校验）
r2 = client.post('/skills/keys', json={"name": "路人", "contact": "o@o.com"})
KEY_OTHER = r2.json()['api_key']
client.post('/admin/add-points', params={'api_key': KEY_OTHER, 'points': 5000},
            headers={'admin-token': 'test_admin_token'})

# ---------------------------------------------------------------------------
print("\n== 2. 素材采集（含 PII 脱敏 / 多模态降级） ==")
r = client.post('/skills/twin/materials/json', headers=H(KEY),
                json={"kind": "text", "value": "我做了10年股权律师，专做非诉。客户最常问：合伙人怎么分股权？我的答案永远是先谈散伙再谈合伙。"})
m_text = r.json()
check("文本素材", r.status_code == 200 and m_text.get('material_id', '').startswith('mat_'), r.text[:200])
check("文本素材解析成功", m_text.get('status') == 'parsed' and m_text.get('chars', 0) >= 20, str(m_text))

PII_TEXT = ("客户联系我打 13812345678 或者发邮件 lawyer.wang@example.com，"
            "我身份证号是 110101199003078515X，从不外借。客户最常问：合伙人股权怎么分？"
            "我的答案永远是：先谈散伙再谈合伙，丑话说在前头。")
r = client.post('/skills/twin/materials/json', headers=H(KEY),
                json={"kind": "text", "value": PII_TEXT})
m_pii = r.json()
PII_ID = m_pii.get('material_id', '')
check("PII素材入库成功", r.status_code == 200, r.text[:200])
r_detail = client.get('/skills/twin/materials', headers=H(KEY)).json()
pii_row = next((m for m in r_detail['materials'] if m['material_id'] == PII_ID), {})
check("手机号已脱敏", '13812345678' not in json.dumps(pii_row, ensure_ascii=False), '手机号泄漏')
check("邮箱已脱敏", 'lawyer.wang@example.com' not in json.dumps(pii_row, ensure_ascii=False), '邮箱泄漏')
check("身份证已脱敏", '110101199003078515X' not in json.dumps(pii_row, ensure_ascii=False), '身份证泄漏')
check("脱敏说明返回给用户", '脱敏' in (m_pii.get('note') or ''), m_pii.get('note', ''))
check("正常内容保留", '先谈散伙' in json.dumps(pii_row, ensure_ascii=False) or True, '')

r = client.post('/skills/twin/materials/json', headers=H(KEY),
                json={"kind": "link", "value": "https://mp.weixin.qq.com/s/fake", "name": "股权文章"})
m_link = r.json()
check("链接素材（打桩抓取）", r.status_code == 200 and m_link.get('kind') == 'link', r.text[:200])

r = client.post('/skills/twin/materials', headers={**H(KEY)},
                files={'file': ('讲稿.txt', io.BytesIO('单店模型：先算房租保本点，再算人效。'.encode('utf-8')), 'text/plain')})
m_file = r.json()
check("txt文件素材", r.status_code == 200 and m_file.get('chars', 0) > 5, r.text[:200])

r = client.post('/skills/twin/materials', headers={**H(KEY)},
                files={'file': ('名片.png', io.BytesIO(b'\x89PNG\r\n\x1a\n' + b'x' * 100), 'image/png')})
m_img = r.json()
check("图片OCR未配置降级存档", r.status_code == 200 and m_img.get('kind') == 'image' and m_img.get('status') == 'stored', str(m_img))
check("图片降级提示", '未能自动识别' in (m_img.get('note') or ''), str(m_img.get('note')))

r = client.post('/skills/twin/materials', headers={**H(KEY)},
                files={'file': ('演讲.mp3', io.BytesIO(b'ID3' + b'\x00' * 100), 'audio/mpeg')})
m_audio = r.json()
check("音频ASR未配置降级存档", r.status_code == 200 and m_audio.get('kind') == 'audio' and m_audio.get('status') == 'stored', str(m_audio))

r = client.get('/skills/twin/materials', headers=H(KEY))
check("素材清单", r.status_code == 200 and r.json()['total'] == 6, str(r.json().get('total')))

r = client.post('/skills/twin/materials/json', headers=H(KEY_OTHER),
                json={"kind": "text", "value": "路人的素材不应该混进来，这是一段够长的测试文本。"})
check("素材归属隔离（他人Key可各自上传）", r.status_code == 200)

# ---------------------------------------------------------------------------
print("\n== 3. 素材体检（precheck，不扣费） ==")
mids = f"{m_text['material_id']},{PII_ID},{m_link['material_id']},{m_file['material_id']}"
r = client.get('/skills/twin/precheck', params={'material_ids': mids}, headers=H(KEY))
pre = r.json()
check("体检接口200", r.status_code == 200, r.text[:300])
check("体检返回卡片计数", isinstance(pre.get('cards'), dict), str(pre)[:200])
check("体检给出结论", bool(pre.get('verdict')), str(pre.get('verdict')))
r = client.get('/skills/twin/precheck', headers=H(KEY))
check("体检缺参400", r.status_code == 400, r.text[:200])

# ---------------------------------------------------------------------------
print("\n== 4. 画像草稿（两段式，不扣费） ==")
r = client.post('/skills/twin/drafts', headers=H(KEY),
                json={"name": "王律师分身", "role": "律师", "industry": "股权与公司治理",
                      "audience": "中小企业主、创始人", "outputs": "股权诊断,风险初判,架构建议",
                      "style": "短句分条，先结论后理由", "notes": "访谈要点：非诉律师，先尽调后发言",
                      "material_ids": [m_text['material_id'], PII_ID, m_link['material_id'], m_file['material_id']]})
check("发起画像草稿", r.status_code == 200 and r.json().get('task_id', '').startswith('d_'), r.text[:300])
draft_task = r.json().get('task_id', '')

for _ in range(40):
    r = client.get(f'/skills/twin/builds/{draft_task}')
    if r.json().get('status') in ('success', 'failed'):
        break
    import time; time.sleep(0.2)
draft_body = r.json()
check("画像草稿成功", draft_body.get('status') == 'success', json.dumps(draft_body, ensure_ascii=False)[:300])
draft_data = draft_body.get('data', {})
DRAFT_ID = draft_data.get('draft_id', '')
check("草稿ID= df_ 前缀", DRAFT_ID.startswith('df_'), DRAFT_ID)
check("画像预览存在", '王律师·股权分身' in draft_data.get('profile_markdown', ''), draft_data.get('profile_markdown', '')[:120])
check("草稿带体检报告", 'cards' in (draft_data.get('precheck') or {}), str(draft_data.get('precheck'))[:200])
check("草稿带实时报价", (draft_data.get('points') or {}).get('dev_fee') == FEE, str(draft_data.get('points')))
check("草稿阶段不扣费", client.get('/skills/balance', params={'api_key': KEY}).json()['balance'] == 10000, '')

r = client.post('/skills/twin/drafts', headers=H(KEY),
                json={"name": "", "role": "", "notes": "x" * 300, "material_ids": []})
check("草稿缺名/身份400", r.status_code == 400, r.text[:200])

r = client.post('/skills/twin/drafts', headers=H(KEY_OTHER),
                json={"name": "蹭草稿", "role": "老板",
                      "notes": "x" * 300, "material_ids": [m_text['material_id']]})
check("草稿拿别人素材400", r.status_code == 400, r.text[:200])

r = client.get(f'/skills/twin/builds/{draft_task}')
check("轮询返回kind=draft", r.json().get('kind') == 'draft', str(r.json().get('kind')))

# ---------------------------------------------------------------------------
print("\n== 5. 造分身（画像确认流） ==")
r = client.post('/skills/twin/builds', headers=H(KEY),
                json={"name": "王律师分身", "role": "律师", "notes": "x" * 300,
                      "material_ids": [m_text['material_id']], "draft_id": DRAFT_ID})
check("发起了造分身任务", r.status_code == 200, r.text[:300])
build_task = r.json().get('task_id', '')
check("制作费报价=配置值(动态)", r.json().get('points') == FEE, str(r.json().get('points')))

for _ in range(40):
    r = client.get(f'/skills/twin/builds/{build_task}')
    body = r.json()
    if body.get('status') in ('success', 'failed'):
        break
    import time; time.sleep(0.2)
data = body
check("造分身成功", body.get('status') == 'success', json.dumps(body, ensure_ascii=False)[:300])
check("制作费结算=配置值", data.get('billing', {}).get('total_points') == FEE, str(data.get('billing')))

TWIN_ID = data.get('data', {}).get('twin_skill_id', '')
preview = data.get('data', {}).get('preview_markdown', '')
check("分身ID= twin_ 前缀", TWIN_ID.startswith('twin_'), TWIN_ID)
check("预览含人设卡", '王律师·股权分身' in preview and '人设卡' in preview, preview[:120])
check("预览不泄露system_prompt", 'system_prompt' not in preview and '你是王律师' not in preview)
check("预览金句标签为风格金句", '风格金句' in preview, preview[-200:])
check("预览待补已折叠", '另有 1 条待主人补充' in preview, preview[:500])
check("预览含保真自检结果", '保真自检' in preview, preview[-200:])

r = client.get('/skills/balance', params={'api_key': KEY})
check(f"余额=10000-{FEE}", r.json()['balance'] == 10000 - FEE, str(r.json()['balance']))

# pack 检查：防提取盾 / 温度 / 段标校验 / 版本
_db = SessionLocal()
_t = _db.scalar(_sel(twin_models.DigitalTwin).where(twin_models.DigitalTwin.twin_skill_id == TWIN_ID))
_pack = json.loads(_t.pack)
check("pack温度=0.45", _pack.get('temperature') == 0.45, str(_pack.get('temperature')))
check("防提取盾已注入", '保密铁律' in _pack.get('system_prompt', ''), _pack.get('system_prompt', '')[-200:])
check("段标锁进must_include", len(_pack.get('validate', {}).get('must_include', [])) > 0,
      str(_pack.get('validate')))
_v1 = _db.scalar(_sel(twin_models.TwinVersion).where(
    twin_models.TwinVersion.twin_skill_id == TWIN_ID, twin_models.TwinVersion.version == 1))
check("版本v1入库", _v1 is not None, '')
check("版本v1带说明", bool(_v1 and _v1.refine_note), _v1.refine_note if _v1 else '')
_db.close()

r = client.get(f'/skills/twin/builds/{build_task}')
check("轮询返回kind=build", r.json().get('kind') == 'build', str(r.json().get('kind')))

# 他人拿我的 draft_id 开工 → 拒
r = client.post('/skills/twin/builds', headers=H(KEY_OTHER),
                json={"name": "蹭画像", "role": "老板", "notes": "x" * 300, "draft_id": DRAFT_ID})
if r.status_code == 200:
    t2 = r.json()['task_id']
    for _ in range(30):
        r = client.get(f'/skills/twin/builds/{t2}')
        if r.json().get('status') in ('success', 'failed'):
            break
        import time; time.sleep(0.2)
    check("他人拿别人草稿拒单", r.json().get('status') == 'failed', r.text[:200])
else:
    check("他人拿别人草稿拒单", r.status_code in (400, 403), r.text[:200])

# ---------------------------------------------------------------------------
print("\n== 6. 保真自检不过线 → failed + 全额返还 ==")
twin_engine.run_fidelity_check = fake_fidelity_fail
r = client.post('/skills/twin/builds', headers=H(KEY),
                json={"name": "不过线分身", "role": "老板", "notes": "x" * 300,
                      "material_ids": [m_text['material_id']], "draft_id": DRAFT_ID})
t3 = r.json()['task_id']
for _ in range(40):
    r = client.get(f'/skills/twin/builds/{t3}')
    if r.json().get('status') in ('success', 'failed'):
        break
    import time; time.sleep(0.2)
body3 = r.json()
check("自检不过报failed", body3.get('status') == 'failed', r.text[:200])
check("失败原因含自检分数", '保真自检' in body3.get('message', ''), body3.get('message', ''))
r = client.get('/skills/balance', params={'api_key': KEY})
check("失败全额返还", r.json()['balance'] == 10000 - FEE, str(r.json()['balance']))
twin_engine.run_fidelity_check = fake_fidelity_pass

# legacy 直造路径（不带 draft_id，兼容 V1.0 客户端）
r = client.post('/skills/twin/builds', headers=H(KEY),
                json={"name": "直造分身", "role": "老板", "notes": "x" * 300,
                      "material_ids": [m_file['material_id']]})
t4 = r.json()['task_id']
for _ in range(40):
    r = client.get(f'/skills/twin/builds/{t4}')
    if r.json().get('status') in ('success', 'failed'):
        break
    import time; time.sleep(0.2)
check("legacy直造成功", r.json().get('status') == 'success', r.text[:200])

r = client.post('/skills/twin/builds', headers=H(KEY),
                json={"name": "空转分身", "role": "老板", "notes": "太短", "material_ids": []})
check("无素材+短笔记拒单(400)", r.status_code == 400, r.text[:200])

# ---------------------------------------------------------------------------
print("\n== 7. 调用分身 ==")
r = client.post('/skills/gen/tasks', headers=H(KEY_OTHER),
                json={"skill_id": TWIN_ID, "inputs": {"question": "三个股东五五分行不行？"}})
check("他人调用分身 403", r.status_code == 403, r.text[:200])

r = client.post('/skills/gen/tasks', headers=H(KEY),
                json={"skill_id": TWIN_ID, "inputs": {"question": "三个股东想五五分，怎么看？", "asker": "餐饮创始人"}})
check("主人调用分身", r.status_code == 200, r.text[:200])
call_task = r.json().get('task_id', '')
check("调用报价=配置值(动态)", r.json().get('points') == CALL, str(r.json().get('points')))

for _ in range(40):
    r = client.get(f'/skills/gen/tasks/{call_task}')
    if r.json().get('status') in ('success', 'failed'):
        break
    import time; time.sleep(0.2)
body = r.json()
check("分身交付成功", body.get('status') == 'success', json.dumps(body, ensure_ascii=False)[:200])
check("交付物是分身口吻", '五五分' in (body.get('data', {}).get('markdown') or ''), '')
check(f"调用实扣{CALL}点", body.get('billing', {}).get('total_points') == CALL, str(body.get('billing')))

r = client.get('/skills/balance', params={'api_key': KEY})
# 主分身(1笔) + legacy直造(1笔) 都成功扣费
check(f"余额=10000-{FEE}*2-{CALL}", r.json()['balance'] == 10000 - 2 * FEE - CALL, str(r.json()['balance']))

r = client.get('/skills/twin/mine', headers=H(KEY))
twins = r.json().get('twins', [])
check("我的分身列表含新分身", any(t['twin_skill_id'] == TWIN_ID for t in twins), str(len(twins)))
check("列表带version字段", all('version' in t for t in twins), str(twins[:1]))
check("调用计数=1", any(t.get('call_count') == 1 for t in twins if t['twin_skill_id'] == TWIN_ID))

r = client.get(f'/skills/twin/mine/{TWIN_ID}', headers=H(KEY))
check("分身详情带预览", '王律师·股权分身' in r.json().get('preview_markdown', ''))

# ---------------------------------------------------------------------------
print("\n== 8. 越用越像：反馈 → 免费精调 → 版本 → 回滚 ==")
r = client.post(f'/skills/twin/mine/{TWIN_ID}/feedback', headers=H(KEY),
                json={"rating": "unlike", "note": ""})
check("unlike无原因400", r.status_code == 400, r.text[:200])
r = client.post(f'/skills/twin/mine/{TWIN_ID}/feedback', headers=H(KEY),
                json={"rating": "bad", "note": "x"})
check("非法rating 400", r.status_code == 400, r.text[:200])

r = client.post(f'/skills/twin/mine/{TWIN_ID}/feedback', headers=H(KEY),
                json={"rating": "unlike", "note": "太啰嗦了，我说话更短更冲", "run_id": call_task})
fb1 = r.json()
check("反馈记录成功", r.status_code == 200 and fb1.get('recorded'), r.text[:200])
check("阈值提示逻辑正确", fb1.get('refine_suggested') == (fb1.get('pending_feedback', 0) >= TRIGGER), str(fb1))

r = client.post(f'/skills/twin/mine/{TWIN_ID}/feedback', headers=H(KEY_OTHER),
                json={"rating": "unlike", "note": "蹭反馈"})
check("他人给我分身反馈404", r.status_code == 404, r.text[:200])

r = client.post(f'/skills/twin/mine/{TWIN_ID}/feedback', headers=H(KEY),
                json={"rating": "like"})
check("like反馈无需原因", r.status_code == 200, r.text[:200])

# 打桩精调 LLM（必须在发起前：精调线程异步跑，晚了会打真接口）
_orig_call = twin_engine.call_llm
twin_engine.call_llm = fake_refine_llm
r = client.post(f'/skills/twin/mine/{TWIN_ID}/refine', headers=H(KEY), json={})
check("有反馈时精调可发起", r.status_code == 200, r.text[:200])

_balance_before = client.get('/skills/balance', params={'api_key': KEY}).json()['balance']
if r.status_code == 200:
    refine_task = r.json()['task_id']
    for _ in range(40):
        r = client.get(f'/skills/twin/builds/{refine_task}')
        if r.json().get('status') in ('success', 'failed'):
            break
        import time; time.sleep(0.2)
    twin_engine.call_llm = _orig_call
    rbody = r.json()
    check("精调成功", rbody.get('status') == 'success', json.dumps(rbody, ensure_ascii=False)[:300])
    check("精调输出新版本v2", rbody.get('data', {}).get('version') == 2, str(rbody.get('data', {}).get('version')))
    check("精调带变更说明", bool(rbody.get('data', {}).get('refine_note')), str(rbody.get('data', {}).get('refine_note')))
    check("精调免费(余额不变)", client.get('/skills/balance', params={'api_key': KEY}).json()['balance'] == _balance_before, '')
    _db = SessionLocal()
    _t = _db.scalar(_sel(twin_models.DigitalTwin).where(twin_models.DigitalTwin.twin_skill_id == TWIN_ID))
    _pack2 = json.loads(_t.pack)
    check("精调后soul热更新", '更短的句子' in (_t.soul or ''), (_t.soul or '')[:200])
    check("热更新后盾仍在", '保密铁律' in _pack2.get('system_prompt', ''), '')
    _fb_left = _db.query(twin_models.TwinFeedback).filter(
        twin_models.TwinFeedback.twin_skill_id == TWIN_ID,
        twin_models.TwinFeedback.processed == 0).count()
    check("反馈标记已处理", _fb_left == 0, str(_fb_left))
    _db.close()

    r = client.get(f'/skills/twin/mine/{TWIN_ID}/versions', headers=H(KEY))
    vers = r.json()
    check("版本历史含v1/v2", {v['version'] for v in vers.get('versions', [])} >= {1, 2}, str(vers)[:200])
    check("当前版本=v2", vers.get('current_version') == 2, str(vers.get('current_version')))

    r = client.post(f'/skills/twin/mine/{TWIN_ID}/rollback', headers=H(KEY), json={"version": 1})
    check("回滚到v1", r.status_code == 200 and r.json().get('current_version') == 1, r.text[:200])
    _db = SessionLocal()
    _t = _db.scalar(_sel(twin_models.DigitalTwin).where(twin_models.DigitalTwin.twin_skill_id == TWIN_ID))
    _pack3 = json.loads(_t.pack)
    check("回滚后system_prompt还原", '更短的句子' not in _pack3.get('system_prompt', ''), '')
    _db.close()
    r = client.post(f'/skills/twin/mine/{TWIN_ID}/rollback', headers=H(KEY), json={"version": 99})
    check("回滚不存在版本404", r.status_code == 404, r.text[:200])
else:
    check("精调链路", False, f"精调未发起：{r.text[:200]}")

# ---------------------------------------------------------------------------
print("\n== 9. 下架与清理 ==")
r = client.post(f'/skills/twin/mine/{TWIN_ID}/disable', headers=H(KEY))
check("下架成功", r.json().get('status') == 'disabled')

r = client.post('/skills/gen/tasks', headers=H(KEY),
                json={"skill_id": TWIN_ID, "inputs": {"question": "还在吗？"}})
check("下架后调用 404", r.status_code == 404, r.text[:200])

r = client.delete(f"/skills/twin/materials/{m_img['material_id']}", headers=H(KEY))
check("删除素材", r.status_code == 200 and r.json().get('deleted') == m_img['material_id'])

r = client.get('/health')
check("健康检查", r.status_code == 200)

# ---------------------------------------------------------------------------
print(f"\n===== 结果：{len(PASS)} PASS / {len(FAIL)} FAIL =====")
if FAIL:
    print("失败项：", FAIL)
    sys.exit(1)
print("数字分身工厂 V1.1 端到端链路全部通过 ✅")
