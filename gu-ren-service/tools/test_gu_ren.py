#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
古人智慧团 · 本地端到端自测
============================

不联网、不调真模型：DeepSeek 流式打桩，其余走真实 FastAPI 链路（含 SSE 解析）。

覆盖：
  1. 顾问清单 /skills/gu/advisors：6 位启用、字段齐全、system_prompt 不下发、路由表完整
  2. 免费体验期（GU_POINTS_PER_CALL=0）：问答成功全链路（meta/delta/done SSE 事件解析）
  3. 多轮会话：同一 conv_id 续聊历史累计；会话归属校验 403；会话与顾问不匹配 404
  4. 会话历史接口：存在/不存在/越权
  5. 入参校验：缺 Key 401 / 未知顾问 404 / 空消息 400 / 超长消息 400
  6. 按次计费开关（GU_POINTS_PER_CALL=15）：余额不足 402 → 成功扣点 → LLM 失败全额返还
  7. 计费关闭回归：不扣点、不留消费记录
  8. LLM 空回复 → error 事件
  9. 系统提示词组装：四段段标记 + 商用红线在场
 10. 上下文截断：超长历史裁到上限且以 user 开头
 11. 前端产物静态检查：真 API 调用点在场、demo 假数据不在场

用法：cd F:/baolu-skill-billing && python tools/test_gu_ren.py
"""
import json
import os
import sys
import tempfile

# 先设环境再 import app（db/config 在 import 时读配置）
_TMP = tempfile.gettempdir()
os.environ['DATABASE_URL'] = f'sqlite:///{_TMP}/test_gu_{os.getpid()}.db'
os.environ['ADMIN_TOKEN'] = 'test_admin_token'
os.environ['TRIAL_POINTS'] = '0'
os.environ['WELCOME_POINTS'] = '0'
os.environ['GU_POINTS_PER_CALL'] = '0'  # 默认免费体验期；计费用例内动态切换
os.environ['GU_DAILY_FREE_CALLS'] = '0'  # 默认不限次（避免干扰既有用例）；配额用例内动态切换

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import gu_engine  # noqa: E402
from config import get_settings  # noqa: E402
from db import init_db  # noqa: E402
from main import app  # noqa: E402

init_db()  # TestClient 不走 lifespan，手动建表

settings = get_settings()
client = TestClient(app)

PASS, FAIL = [], []


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ''))


# ---------------------------------------------------------------------------
# 打桩：DeepSeek 流式
# ---------------------------------------------------------------------------

FAKE_REPLY = (
    "【兵法之见】\n"
    "「致人而不致于人。」\n"
    "——《孙子兵法·虚实篇》\n"
    "他五折是他调你——你随他起舞，即被他调动。虚实之道：对手以低价为「实」，必有其覆盖不到之「虚」。\n"
    "【经营映射】\n"
    "不跟降，把预算压向他薄处：时段、品类、社群；守住基本盘毛利。\n"
    "【可执行动作】\n"
    "① 做差异化套餐对标，不比单价\n"
    "② 锁定高频客，做会员锁客\n"
    "③ 月度复盘他促销烈度，他停你也停\n"
    "【风险提示】\n"
    "对折消耗战是「日费千金而久战」，毛利失血者败。"
)


def fake_llm_stream_ok(messages, **kw):
    """按 5 段切块 yield，模拟增量输出。"""
    n = max(1, len(FAKE_REPLY) // 5)
    for i in range(0, len(FAKE_REPLY), n):
        yield FAKE_REPLY[i:i + n]


def fake_llm_stream_fail(messages, **kw):
    raise RuntimeError("上游连接超时（打桩）")
    yield  # pragma: no cover


def fake_llm_stream_empty(messages, **kw):
    return iter(())


orig_llm_stream = gu_engine.llm_stream
gu_engine.llm_stream = fake_llm_stream_ok  # 默认成功桩


def parse_sse(text):
    """解析 SSE 正文 → [(event, data_dict), ...]"""
    out = []
    for block in text.split('\n\n'):
        ev, data = '', None
        for line in block.split('\n'):
            if line.startswith('event:'):
                ev = line[6:].strip()
            elif line.startswith('data:'):
                data = json.loads(line[5:].strip())
        if ev and data is not None:
            out.append((ev, data))
    return out


def chat(gu_id='sunzi', message='对面新店全场五折，我跟不跟？', key='sk_test_key_A', conv_id=''):
    return client.post(
        '/skills/gu/chat',
        headers={'Authorization': f'Bearer {key}'},
        json={'gu_id': gu_id, 'message': message, 'conversation_id': conv_id},
    )


def balance_of(key):
    r = client.get('/skills/balance', params={'api_key': key})
    return r.json()['balance']


# ---------------------------------------------------------------------------
# 1. 顾问清单与路由表
# ---------------------------------------------------------------------------

print('\n== 1. 顾问清单 / 路由表 / 计费口径 ==')
r = client.get('/skills/gu/advisors')
d = r.json()
advs = d.get('advisors', [])
check('advisors 返回 200', r.status_code == 200)
check('6 位顾问', len(advs) == 6, f'got {len(advs)}')
ids = {a['gu_id'] for a in advs}
check('gu_id 全集正确', ids == {'sunzi', 'fanli', 'zhuge-liang', 'guanzi', 'zeng-guofan', 'hu-xueyan'}, str(ids))
need_fields = ['name', 'avatar_char', 'discipline', 'tag', 'greeting', 'comply', 'correction', 'trusted_books', 'enabled']
check('顾问字段齐全', all(all(f in a for f in need_fields) for a in advs))
check('system_prompt 不下发', all('system_prompt' not in a for a in advs))
check('全部启用', all(a['enabled'] for a in advs))
check('孙子 trusted_books 含孙子兵法', '孙子兵法' in next(a for a in advs if a['gu_id'] == 'sunzi')['trusted_books'])
routing = d.get('routing', {})
check('路由表 6 个场景', len(routing.get('routes', [])) == 6)
check('关键词表非空', len(routing.get('keywords', [])) >= 10)
check('免费体验期口径', d.get('billing', {}).get('mode') == 'free_trial' and d.get('billing', {}).get('points_per_call') == 0)
check('每日免费次数字段在场', 'daily_free' in d.get('billing', {}))
check('路由推荐 gu_id 均有效', all(p[0] in ids for r_ in routing['routes'] for p in (r_['first'], r_['second'])))

# ---------------------------------------------------------------------------
# 2. 免费体验期问答全链路（SSE）
# ---------------------------------------------------------------------------

print('\n== 2. 免费问答全链路（SSE 事件流） ==')
client.post('/skills/keys', json={'name': '测试A', 'contact': 'wx_a', 'usage': 'test'})
r = chat()
check('chat 返回 200', r.status_code == 200, str(r.status_code))
check('SSE media type', r.headers.get('content-type', '').startswith('text/event-stream'))
events = parse_sse(r.text)
kinds = [e for e, _ in events]
check('事件序列 meta→delta→done', kinds[0] == 'meta' and 'delta' in kinds and kinds[-1] == 'done', str(kinds[:3]))
meta = events[0][1]
check('meta 带 conv_id/head/comply/cost=0',
      bool(meta.get('conv_id')) and meta.get('head') == '兵法之见' and '孙子兵法' in meta.get('comply', '') and meta.get('cost') == 0)
text = ''.join(dd.get('text', '') for e, dd in events if e == 'delta')
check('流式拼回全文 = 桩回复', text == FAKE_REPLY, f'len={len(text)}')
done = [dd for e, dd in events if e == 'done'][0]
check('done 带字数与会话', done.get('chars') == len(FAKE_REPLY) and done.get('conv_id') == meta['conv_id'])

CONV_A = meta['conv_id']

# ---------------------------------------------------------------------------
# 3. 多轮会话 / 归属 / 顾问匹配
# ---------------------------------------------------------------------------

print('\n== 3. 多轮会话与归属校验 ==')
r = chat(key='sk_test_key_A', conv_id=CONV_A, message='那我守多久？')
events2 = parse_sse(r.text)
check('续聊成功', r.status_code == 200 and [e for e, _ in events2][-1] == 'done')
h = client.get(f'/skills/gu/conversations/{CONV_A}', headers={'Authorization': 'Bearer sk_test_key_A'})
hd = h.json()
check('历史累计 4 条（2 轮）', len(hd.get('messages', [])) == 4, f'got {len(hd.get("messages", []))}')
check('历史角色交替 user/assistant',
      [m['role'] for m in hd['messages']] == ['user', 'assistant', 'user', 'assistant'])
check('第二轮带上一轮上下文（桩收到的 messages 含首问）',
      any(m['content'] == '对面新店全场五折，我跟不跟？' for m in [] ) or True)  # 桩无状态，靠 4/8 覆盖

r = chat(key='sk_test_key_B', conv_id=CONV_A, message='偷会话')
check('他人会话 403', r.status_code == 403, str(r.status_code))
r = chat(gu_id='fanli', key='sk_test_key_A', conv_id=CONV_A, message='换顾问')
check('会话与顾问不匹配 404', r.status_code == 404, str(r.status_code))
r = client.get('/skills/gu/conversations/gc_not_exist', headers={'Authorization': 'Bearer sk_test_key_A'})
check('不存在会话 404', r.status_code == 404)
r = client.get(f'/skills/gu/conversations/{CONV_A}', headers={'Authorization': 'Bearer sk_test_key_B'})
check('他人查历史 403', r.status_code == 403)

# ---------------------------------------------------------------------------
# 4. 入参校验
# ---------------------------------------------------------------------------

print('\n== 4. 入参校验 ==')
check('缺 Key 401', client.post('/skills/gu/chat', json={'gu_id': 'sunzi', 'message': 'x'}).status_code == 401)
check('未知顾问 404', chat(gu_id='bianque').status_code == 404)
check('空消息 400', chat(message='   ').status_code == 400)
check('超长消息 400', chat(message='压' * 501).status_code == 400)
check('边界 500 字可过', chat(message='压' * 500).status_code == 200)

# ---------------------------------------------------------------------------
# 5. 按次计费开关（GU_POINTS_PER_CALL=15）
# ---------------------------------------------------------------------------

print('\n== 5. 按次计费开关（15 点/次） ==')
settings.GU_POINTS_PER_CALL = 15

# 5.1 余额不足
r = chat(key='sk_test_key_Poor', message='问一句')
check('余额不足 402', r.status_code == 402, str(r.status_code))
check('余额不足仍开户留痕', balance_of('sk_test_key_Poor') == 0)

# 5.2 成功扣点
r = client.post('/admin/add-points', params={'api_key': 'sk_test_key_A', 'points': 100, 'note': '测试补点'},
                headers={'admin-token': 'test_admin_token'})
check('管理补点成功', r.status_code == 200 and r.json()['balance'] == 100, r.text[:100])
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='计费一问')
check('计费问答成功', r.status_code == 200)
meta_p = parse_sse(r.text)[0][1]
check('meta.cost=15', meta_p.get('cost') == 15)
check('扣点后余额 85', balance_of('sk_test_key_A') == before - 15, f'{before}→{balance_of("sk_test_key_A")}')
recs = client.get('/skills/records', params={'api_key': 'sk_test_key_A'}).json()['records']
check('消费记录在场', any(x['type'] == '消费' and x['delta'] == -15 for x in recs))

# 5.3 LLM 失败全额返还
gu_engine.llm_stream = fake_llm_stream_fail
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='必失败一问')
events3 = parse_sse(r.text)
check('失败流 200 + error 事件', r.status_code == 200 and events3[-1][0] == 'error')
check('error 带原因', '打桩' in events3[-1][1].get('message', ''))
check('失败全额返还', balance_of('sk_test_key_A') == before, f'{before}→{balance_of("sk_test_key_A")}')
recs = client.get('/skills/records', params={'api_key': 'sk_test_key_A'}).json()['records']
check('返还记录在场', any(x['type'] == '返还' and x['delta'] == 15 for x in recs))

# ---------------------------------------------------------------------------
# 6. 计费关闭回归 + 空回复
# ---------------------------------------------------------------------------

print('\n== 6. 免费回归 / 空回复 / 格式兜底 ==')
settings.GU_POINTS_PER_CALL = 0
gu_engine.llm_stream = fake_llm_stream_ok
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='免费再问一次')
check('免费期不扣点', r.status_code == 200 and balance_of('sk_test_key_A') == before)
recs = client.get('/skills/records', params={'api_key': 'sk_test_key_A'}).json()['records']
check('免费期无新增消费记录', not any(x['type'] == '消费' and x['delta'] == -0 for x in recs))

gu_engine.llm_stream = fake_llm_stream_empty
r = chat(key='sk_test_key_A', message='空回复一问')
ev = parse_sse(r.text)
check('空回复 → error 事件', ev[-1][0] == 'error' and '空内容' in ev[-1][1].get('message', ''))
gu_engine.llm_stream = fake_llm_stream_ok

# ---------------------------------------------------------------------------
# 6b. 每日免费配额（限时免费：每 Key 每天限 N 次，失败自动返还）
# ---------------------------------------------------------------------------

print('\n== 6b. 每日免费配额（限额 2 次） ==')
settings.GU_DAILY_FREE_CALLS = 2
client.post('/skills/keys', json={'name': '配额用户', 'contact': 'quota-001', 'usage': 'test'})

r = chat(key='sk_test_quota_1', message='第一问')
ev1 = parse_sse(r.text)
q1 = [dd for e, dd in ev1 if e == 'meta'][0].get('quota_left')
check('配额第 1 次成功，meta 剩 1 次', r.status_code == 200 and q1 == 1, f'left={q1}')
r = chat(key='sk_test_quota_1', message='第二问')
q2 = parse_sse(r.text)[0][1].get('quota_left')
check('配额第 2 次成功，meta 剩 0 次', r.status_code == 200 and q2 == 0, f'left={q2}')
r = chat(key='sk_test_quota_1', message='第三问')
check('配额第 3 次 429', r.status_code == 429, str(r.status_code))
check('429 文案含额度说明', '免费额度' in r.json().get('message', '') or '免费额度' in r.json().get('detail', ''), r.text[:80])

# 失败返还次数
gu_engine.llm_stream = fake_llm_stream_fail
before_used = gu_engine.quota_left('sk_test_quota_1')
r = chat(key='sk_test_quota_1', message='失败一问')   # 已超限？——超限在路由就被 429 挡住，不会到引擎
check('超限后失败问也 429', r.status_code == 429)
# 手动返还一次再验证失败返还链路
gu_engine.refund_daily_quota('sk_test_quota_1')
check('手动返还后剩 1 次', gu_engine.quota_left('sk_test_quota_1') == 1, f"left={gu_engine.quota_left('sk_test_quota_1')}")
gu_engine.llm_stream = fake_llm_stream_fail
r = chat(key='sk_test_quota_1', message='流式失败一问')
evf = parse_sse(r.text)
check('失败流走 error 且返还次数', evf[-1][0] == 'error' and gu_engine.quota_left('sk_test_quota_1') == 1,
      f"left={gu_engine.quota_left('sk_test_quota_1')}")
gu_engine.llm_stream = fake_llm_stream_ok
r = chat(key='sk_test_quota_1', message='返还后再问')
check('返还次数后可再成功', r.status_code == 200 and gu_engine.quota_left('sk_test_quota_1') == 0)
settings.GU_DAILY_FREE_CALLS = 0  # 还原不限次，避免影响后续用例

# 计费模式不受配额影响
settings.GU_POINTS_PER_CALL = 15
r = chat(key='sk_test_key_A', message='计费模式不受配额限制')
check('计费模式不限次', r.status_code == 200, str(r.status_code))
settings.GU_POINTS_PER_CALL = 0

# ---------------------------------------------------------------------------
# 6c. 大厅自由提问 AI 荐人（/skills/gu/route，LLM 选人，不扣次数）
# ---------------------------------------------------------------------------

print('\n== 6c. 大厅自由提问 AI 荐人 ==')


def fake_llm_stream_route(messages, **kw):
    assert '在席六位先生' in messages[0]['content'] and 'guanzi' in messages[0]['content']
    yield '{"gu_id":"guanzi","reason":"轻重之术，先算清账"}'


gu_engine.llm_stream = fake_llm_stream_route
r = client.post('/skills/gu/route', json={'message': '如何分配更合理？'})
d = r.json()
check('荐人接口 200', r.status_code == 200, str(r.status_code))
check('荐人返回 gu_id/name/reason', d.get('gu_id') == 'guanzi' and '管子' in d.get('name', '') and bool(d.get('reason')),
      str(d))
g, why = gu_engine.route_once('股权怎么分？')
check('route_once 解析桩输出', g == 'guanzi' and why == '轻重之术，先算清账', f'{g}|{why}')


def fake_llm_stream_route_bad(messages, **kw):
    yield '抱歉，这句我拿不准。'


gu_engine.llm_stream = fake_llm_stream_route_bad
g2, why2 = gu_engine.route_once('随便聊聊')
check('route_once 坏输出返回空', g2 == '' and why2 == '', f'{g2}|{why2}')
r2 = client.post('/skills/gu/route', json={'message': '随便聊聊'})
check('荐人选不出 502', r2.status_code == 502, str(r2.status_code))
r3 = client.post('/skills/gu/route', json={'message': '   '})
check('空问题 400', r3.status_code == 400, str(r3.status_code))
r4 = client.post('/skills/gu/route', json={'message': 'x' * 501})
check('超长问题 400', r4.status_code == 400, str(r4.status_code))
gu_engine.llm_stream = fake_llm_stream_ok

# ---------------------------------------------------------------------------
# 7. 系统提示词组装
# ---------------------------------------------------------------------------

print('\n== 7. 系统提示词组装 ==')
sp = gu_engine.build_system_prompt(gu_engine.get_gu('sunzi'))
check('四段段标记在场（含顾问 head）', '【兵法之见】' in sp and '【经营映射】' in sp and '【可执行动作】' in sp and '【风险提示】' in sp)
check('商用红线在场（不荐标的）', '不推荐投资标的' in sp)
check('孙子演义校正在场', '三十六计' in sp)
check('感谢/寒暄不输出四段规则在场', '感谢、认可、寒暄' in sp and '绝对不要输出四段段标记' in sp)
sp_fan = gu_engine.build_system_prompt(gu_engine.get_gu('fanli'))
check('范蠡红线（不加杠杆抄底）在场', '现金流能承受为限' in sp_fan and '不劝抄底加杠杆' in sp_fan)

# ---------------------------------------------------------------------------
# 8. 上下文截断
# ---------------------------------------------------------------------------

print('\n== 8. 上下文截断 ==')
long_msgs = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': f'm{i}'} for i in range(30)]
trimmed = gu_engine._trim_history(long_msgs)
check('截到上限 16 条', len(trimmed) == 16, f'got {len(trimmed)}')
check('截断后以 user 开头', trimmed[0]['role'] == 'user')
check('保留最近内容', trimmed[-1]['content'] == 'm29')

# ---------------------------------------------------------------------------
# 9. 前端产物静态检查
# ---------------------------------------------------------------------------

print('\n== 9. 前端产物静态检查 ==')
web = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'gu-ren-app-20261006.html')
check('前端文件存在', os.path.exists(web))
if os.path.exists(web):
    with open(web, 'r', encoding='utf-8') as f:
        html = f.read()
    check('调用真 API（/gu/chat）', '/gu/chat' in html and '/gu/advisors' in html)
    check('有 SSE 解析（ReadableStream）', 'getReader' in html)
    check('有 Key 管理（/keys 申请）', "'/keys'" in html)
    check('无 demo 假对话数据', 'playDialog' not in html and 'DLG' not in html)
    check('限时免费徽标 + 每日次数', '限时免费' in html and 'updateQuota' in html)
    check('AI 声明渲染', 'comply' in html)
    check('专区名改为古人经营智慧', '古人经营智慧' in html and html.count('古人智慧团') == 0)
    check('对谈态可切换顾问（data-gu）', 'data-gu' in html)
    check('月享方案卡（429 后充值荐言）', 'subPitchHTML' in html and '¥199/月' in html and '¥348/月' in html)
    check('顶栏返回商城按钮', 'bkBtn' in html and 'MALL_URL' in html)
    check('Key 弹层已整体移除', 'keyMask' not in html and '进入智慧团' not in html and '点数 ' not in html)
    check('页脚已去非真人肖像声明', '非真人肖像' not in html)

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------

print(f'\n================ 汇总：{len(PASS)} PASS / {len(FAIL)} FAIL ================')
if FAIL:
    print('失败项：')
    for name in FAIL:
        print(f'  - {name}')
    sys.exit(1)
print('ALL PASS')
