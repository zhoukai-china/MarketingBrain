#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
周旭数字分身 · 本地端到端自测
============================

不联网、不调真模型：DeepSeek 流式打桩，其余走真实 FastAPI 链路（含 SSE 解析）。
与古人智慧团（tools/test_gu_ren.py）同款打法，独立数据库、独立配额表，互不干扰。

覆盖：
  1. 分身档案 /skills/zhouxu/profile：字段齐全、红线在场、免费期口径
  2. 免费体验期（ZX_POINTS_PER_CALL=0）：问答成功全链路（meta/delta/done SSE 事件解析、五段全文）
  3. 多轮会话：同一 conv_id 续聊历史累计；会话归属校验 403；不存在会话 404
  4. 入参校验：缺 Key 401 / 空消息 400 / 超长消息 400
  5. 转人工检测：引擎正则单测 + 全链路 transfer 事件（不调 LLM、不扣点、不扣次数）
  6. 按次计费开关（ZX_POINTS_PER_CALL=15）：余额不足 402 → 成功扣点 → LLM 失败全额返还
  7. 计费关闭回归 + 空回复 error
  8. 每日免费配额（限额 2 次）：计次 / 429 / 转人工不计次 / 失败返还次数
  9. 系统提示词组装：五段段标记 + 💬金句 + 商用红线 + 转人工禁词 + 寒暄规则
 10. 上下文截断
 11. 前端产物静态检查：真 API 调用点在场、demo 假数据不在场
 12. 语音转写 /skills/zhouxu/voice：打桩 ASR（200/503/400/401/502）+ 不扣次不留台账 + 前端 🎤 在场

用法：cd F:/baolu-skill-billing && python tools/test_zhouxu.py
"""
import json
import os
import sys
import tempfile

# 先设环境再 import app（db/config 在 import 时读配置）
_TMP = tempfile.gettempdir()
os.environ['DATABASE_URL'] = f'sqlite:///{_TMP}/test_zx_{os.getpid()}.db'
os.environ['ADMIN_TOKEN'] = 'test_admin_token'
os.environ['TRIAL_POINTS'] = '0'
os.environ['WELCOME_POINTS'] = '0'
os.environ['ZX_POINTS_PER_CALL'] = '0'   # 默认免费体验期；计费用例内动态切换
os.environ['ZX_DAILY_FREE_CALLS'] = '0'  # 默认不限次（避免干扰既有用例）；配额用例内动态切换

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

import zx_engine  # noqa: E402
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
    "【诊断判断】\n"
    "先泼冷水：没有章程和股东会记录，我只能说大概率是治理失灵，不是股权比例问题。\n"
    "【方法论依据】\n"
    "公司治理才是核心，不是架构；出资≠股份≠表决权。\n"
    "【动作清单】\n"
    "① 把章程、股东结构、近三年财报发我\n"
    "② 先董事会后股东会，程序正义走一遍\n"
    "③ 真干落地，签字画押\n"
    "【风险提醒】\n"
    "经营问题与侵占问题打法不同，先分清再动手。\n"
    "【下一步】\n"
    "今天就把章程要点发过来。\n"
    "💬 没有尽调就没有发言权"
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


def fake_llm_stream_spy(messages, **kw):
    """记录收到的 messages，便于验证上下文。"""
    fake_llm_stream_spy.seen = [dict(m) for m in messages]
    yield from fake_llm_stream_ok(messages, **kw)


fake_llm_stream_spy.seen = []
orig_llm_stream = zx_engine.llm_stream
zx_engine.llm_stream = fake_llm_stream_spy  # 默认成功桩（带记录）


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


def chat(message='大股东从不分红，小股东没有话语权，怎么办？', key='sk_test_key_A', conv_id=''):
    return client.post(
        '/skills/zhouxu/chat',
        headers={'Authorization': f'Bearer {key}'},
        json={'message': message, 'conversation_id': conv_id},
    )


def balance_of(key):
    r = client.get('/skills/balance', params={'api_key': key})
    return r.json()['balance']


# ---------------------------------------------------------------------------
# 1. 分身档案
# ---------------------------------------------------------------------------

print('\n== 1. 分身档案 / 计费口径 ==')
r = client.get('/skills/zhouxu/profile')
d = r.json()
adv = d.get('advisor', {})
check('profile 返回 200', r.status_code == 200)
check('advisor 字段齐全', all(f in adv for f in
      ['zx_id', 'name', 'title', 'role', 'greeting', 'comply', 'domains']), str(list(adv)))
check('周旭本人', adv.get('name') == '周旭' and adv.get('zx_id') == 'zhouxu-twin')
check('六大域入口', set(adv.get('domains', [])) == {'股权架构', '公司治理', '股权激励', '控制权', '股权税务', '融资上市'})
check('五条红线在场', len(d.get('redlines', [])) == 5)
check('免费体验期口径', d.get('billing', {}).get('mode') == 'free_trial'
      and d.get('billing', {}).get('points_per_call') == 0)
check('每日免费次数字段在场', 'daily_free' in d.get('billing', {}))
check('greeting 非空且是周旭口吻', bool(adv.get('greeting')) and '数字分身' in adv.get('greeting', ''))

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
check('meta 带 conv_id/name/comply/cost=0',
      bool(meta.get('conv_id')) and meta.get('name') == '周旭' and '执业律师' in meta.get('comply', '') and meta.get('cost') == 0)
text = ''.join(dd.get('text', '') for e, dd in events if e == 'delta')
check('流式拼回全文 = 桩回复', text == FAKE_REPLY, f'len={len(text)}')
done = [dd for e, dd in events if e == 'done'][0]
check('done 带字数与会话', done.get('chars') == len(FAKE_REPLY) and done.get('conv_id') == meta['conv_id'])

CONV_A = meta['conv_id']

# ---------------------------------------------------------------------------
# 3. 多轮会话 / 归属校验
# ---------------------------------------------------------------------------

print('\n== 3. 多轮会话与归属校验 ==')
r = chat(key='sk_test_key_A', conv_id=CONV_A, message='那我守多久？')
events2 = parse_sse(r.text)
check('续聊成功', r.status_code == 200 and [e for e, _ in events2][-1] == 'done')
h = client.get(f'/skills/zhouxu/conversations/{CONV_A}', headers={'Authorization': 'Bearer sk_test_key_A'})
hd = h.json()
check('历史累计 4 条（2 轮）', len(hd.get('messages', [])) == 4, f'got {len(hd.get("messages", []))}')
check('历史角色交替 user/assistant',
      [m['role'] for m in hd['messages']] == ['user', 'assistant', 'user', 'assistant'])
check('第二轮送入模型的历史带首问',
      any(m['role'] == 'user' and m['content'] == '大股东从不分红，小股东没有话语权，怎么办？'
          for m in fake_llm_stream_spy.seen))

r = chat(key='sk_test_key_B', conv_id=CONV_A, message='偷会话')
check('他人会话 403', r.status_code == 403, str(r.status_code))
r = chat(key='sk_test_key_A', conv_id='zx_not_exist', message='幽灵会话')
check('不存在会话 404', r.status_code == 404, str(r.status_code))
r = client.get('/skills/zhouxu/conversations/zx_not_exist', headers={'Authorization': 'Bearer sk_test_key_A'})
check('不存在会话查历史 404', r.status_code == 404)
r = client.get(f'/skills/zhouxu/conversations/{CONV_A}', headers={'Authorization': 'Bearer sk_test_key_B'})
check('他人查历史 403', r.status_code == 403)

# ---------------------------------------------------------------------------
# 4. 入参校验
# ---------------------------------------------------------------------------

print('\n== 4. 入参校验 ==')
check('缺 Key 401', client.post('/skills/zhouxu/chat', json={'message': 'x'}).status_code == 401)
check('空消息 400', chat(message='   ').status_code == 400)
check('超长消息 400', chat(message='压' * 501).status_code == 400)
check('边界 500 字可过', chat(message='压' * 500).status_code == 200)

# ---------------------------------------------------------------------------
# 5. 转人工检测（最高优先级：不调 LLM、不扣点、不扣次数）
# ---------------------------------------------------------------------------

print('\n== 5. 转人工检测 ==')
for kw in ['转人工', '想要周旭老师真人咨询', '你们能派人上门吗', '加微信聊聊', '报个价单，砍砍价', '怎么跟你们签合同合作']:
    check(f'命中转人工：{kw[:12]}', zx_engine.is_transfer(kw), kw)
for kw in ['股权架构怎么搭', '大股东不分红怎么办', '激励方案怎么定数量', '我占股45%能不能控制公司']:
    check(f'不误伤股权问题：{kw[:12]}', not zx_engine.is_transfer(kw), kw)

client.post('/skills/keys', json={'name': '转人工用户', 'contact': 'tr-001', 'usage': 'test'})
r = chat(key='sk_test_key_TR', message='我想要周旭老师团队真人入企咨询，怎么合作？')
check('转人工请求 200', r.status_code == 200, str(r.status_code))
ev = parse_sse(r.text)
kinds = [e for e, _ in ev]
check('转人工事件序列 meta→transfer→done', kinds == ['meta', 'transfer', 'done'], str(kinds))
td = [dd for e, dd in ev if e == 'transfer'][0]
check('transfer 带话术（真人/人工评估）', bool(td.get('message')) and '真人' in td.get('message', ''))
check('转人工 meta.cost=0', [dd for e, dd in ev if e == 'meta'][0].get('cost') == 0)
check('转人工 done 无 quota 消耗', [dd for e, dd in ev if e == 'done'][0].get('transfer') is True)

# 转人工进历史（作为 assistant 应答），且不调 LLM
h = client.get('/skills/zhouxu/conversations/' + [dd for e, dd in ev if e == 'meta'][0]['conv_id'],
               headers={'Authorization': 'Bearer sk_test_key_TR'})
hd = h.json()
check('转人工会话入库 2 条（user+assistant）', len(hd.get('messages', [])) == 2)
check('转人工应答为分身话术（非 LLM）', '真人' in hd['messages'][-1]['content'])

# ---------------------------------------------------------------------------
# 6. 按次计费开关（ZX_POINTS_PER_CALL=15）
# ---------------------------------------------------------------------------

print('\n== 6. 按次计费开关（15 点/次） ==')
settings.ZX_POINTS_PER_CALL = 15

# 6.1 余额不足
r = chat(key='sk_test_key_Poor', message='问一句')
check('余额不足 402', r.status_code == 402, str(r.status_code))
check('余额不足仍开户留痕', balance_of('sk_test_key_Poor') == 0)

# 6.2 成功扣点
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

# 6.3 计费模式下转人工依然免费
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='我要找真人客服')
ev = parse_sse(r.text)
check('计费模式转人工不扣点', balance_of('sk_test_key_A') == before and ev[-1][0] == 'done')

# 6.4 LLM 失败全额返还
zx_engine.llm_stream = fake_llm_stream_fail
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='必失败一问')
events3 = parse_sse(r.text)
check('失败流 200 + error 事件', r.status_code == 200 and events3[-1][0] == 'error')
check('error 带原因', '打桩' in events3[-1][1].get('message', ''))
check('失败全额返还', balance_of('sk_test_key_A') == before, f'{before}→{balance_of("sk_test_key_A")}')
recs = client.get('/skills/records', params={'api_key': 'sk_test_key_A'}).json()['records']
check('返还记录在场', any(x['type'] == '返还' and x['delta'] == 15 for x in recs))

# ---------------------------------------------------------------------------
# 7. 计费关闭回归 + 空回复
# ---------------------------------------------------------------------------

print('\n== 7. 免费回归 / 空回复 ==')
settings.ZX_POINTS_PER_CALL = 0
zx_engine.llm_stream = fake_llm_stream_spy
before = balance_of('sk_test_key_A')
r = chat(key='sk_test_key_A', message='免费再问一次')
check('免费期不扣点', r.status_code == 200 and balance_of('sk_test_key_A') == before)
recs = client.get('/skills/records', params={'api_key': 'sk_test_key_A'}).json()['records']
check('免费期无新增消费记录', not any(x['type'] == '消费' and x['delta'] == -0 for x in recs))

zx_engine.llm_stream = fake_llm_stream_empty
r = chat(key='sk_test_key_A', message='空回复一问')
ev = parse_sse(r.text)
check('空回复 → error 事件', ev[-1][0] == 'error' and '空内容' in ev[-1][1].get('message', ''))
zx_engine.llm_stream = fake_llm_stream_spy

# ---------------------------------------------------------------------------
# 8. 每日免费配额（限时免费：每 Key 每天限 N 次，失败自动返还，转人工不计次）
# ---------------------------------------------------------------------------

print('\n== 8. 每日免费配额（限额 2 次） ==')
settings.ZX_DAILY_FREE_CALLS = 2
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
check('429 文案含额度说明', '免费额度' in r.json().get('detail', '') or '免费额度' in r.json().get('message', ''),
      r.text[:80])

# 转人工不计次：超限后转人工依然 200
r = chat(key='sk_test_quota_1', message='帮我转人工，找真人')
ev = parse_sse(r.text)
check('超限后转人工仍 200（不计次）', r.status_code == 200 and ev[-1][0] == 'done', str(r.status_code))

# 失败返还次数
zx_engine.llm_stream = fake_llm_stream_fail
zx_engine.refund_daily_quota('sk_test_quota_1')  # 手动返还一次再验证失败返还链路
check('手动返还后剩 1 次', zx_engine.quota_left('sk_test_quota_1') == 1,
      f"left={zx_engine.quota_left('sk_test_quota_1')}")
r = chat(key='sk_test_quota_1', message='流式失败一问')
evf = parse_sse(r.text)
check('失败流走 error 且返还次数', evf[-1][0] == 'error' and zx_engine.quota_left('sk_test_quota_1') == 1,
      f"left={zx_engine.quota_left('sk_test_quota_1')}")
zx_engine.llm_stream = fake_llm_stream_spy
r = chat(key='sk_test_quota_1', message='返还后再问')
check('返还次数后可再成功', r.status_code == 200 and zx_engine.quota_left('sk_test_quota_1') == 0)
settings.ZX_DAILY_FREE_CALLS = 0  # 还原不限次，避免影响后续用例

# 计费模式不受配额影响
settings.ZX_POINTS_PER_CALL = 15
r = chat(key='sk_test_key_A', message='计费模式不受配额限制')
check('计费模式不限次', r.status_code == 200, str(r.status_code))
settings.ZX_POINTS_PER_CALL = 0

# ---------------------------------------------------------------------------
# 9. 系统提示词组装
# ---------------------------------------------------------------------------

print('\n== 9. 系统提示词组装 ==')
sp = zx_engine.build_system_prompt()
for m in ['【诊断判断】', '【方法论依据】', '【动作清单】', '【风险提醒】', '【下一步】']:
    check(f'五段段标记在场：{m}', m in sp)
check('💬 金句规则在场', '💬' in sp and '金句' in sp)
check('商用红线（不出协议全文/法律意见书）', '协议全文' in sp and '法律意见书' in sp and '执业律师' in sp)
check('红线（不承诺结果）', '保证上市' in sp and '极限词' in sp)
check('红线（不出现引导词/转人工由系统处理）', '私信' in sp and '[TRANSFER_HUMAN]' in sp)
check('域外守卫在场', '只答股权' in sp and '建议直接问周旭本人' in sp)
check('寒暄不输出五段规则在场', '感谢、认可、寒暄' in sp and '绝对不要输出五段段标记' in sp)
check('动作清单 ①②③ 规则在场', '①②③' in sp)
check('方法论基线在场（四件事/六步法/10定/67号公告）',
      '架构 / 激励 / 融资 / 治理' in sp and '六步法' in sp and '10 定模型' in sp and '67 号公告' in sp)

# ---------------------------------------------------------------------------
# 10. 上下文截断
# ---------------------------------------------------------------------------

print('\n== 10. 上下文截断 ==')
long_msgs = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': f'm{i}'} for i in range(30)]
trimmed = zx_engine._trim_history(long_msgs)
check('截到上限 16 条', len(trimmed) == 16, f'got {len(trimmed)}')
check('截断后以 user 开头', trimmed[0]['role'] == 'user')
check('保留最近内容', trimmed[-1]['content'] == 'm29')

# ---------------------------------------------------------------------------
# 11. 前端产物静态检查
# ---------------------------------------------------------------------------

print('\n== 11. 前端产物静态检查 ==')
web = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'zhouxu-twin-app-20261007.html')
check('前端文件存在', os.path.exists(web))
if os.path.exists(web):
    with open(web, 'r', encoding='utf-8') as f:
        html = f.read()
    check('调用真 API（/zhouxu/chat）', '/zhouxu/chat' in html and '/zhouxu/profile' in html)
    check('有 SSE 解析（ReadableStream）', 'getReader' in html)
    check('有 Key 管理（/keys 申请）', "'/keys'" in html)
    check('无 demo 假对话数据', 'playDialog' not in html and 'DLG' not in html)
    check('限时免费徽标 + 每日次数', '限时免费' in html and 'updateQuota' in html)
    check('五段渲染器在场（parseFive）', 'parseFive' in html and '【诊断判断】' in html)
    check('转人工客服卡在场（qcard + 企微码）', 'qcard' in html and 'QR_IMG' in html)
    check('红线客户端拦截在场（PROMISE/AGREEMENT）', 'PROMISE' in html and 'AGREEMENT' in html)
    check('文件卡交付在场（FDATA + 导出 .docx）',
          'FDATA' in html and 'exportWord' in html and '/zhouxu/export' in html and '.docx' in html)
    check('多模态诚实降级（即将上线 + 语音已上线）', '图片 / 视频 / 文件解析即将上线' in html and '语音已上线' in html)
    check('AI 声明渲染', 'comply' in html)
    check('虚标月卡文案已移除', '¥980' not in html and '月卡 ¥' not in html)
    check('头像单常量注入', html.count('AVATAR=') == 1 and 'data-avatar' in html)

# ---------------------------------------------------------------------------
# 12. 语音转写 /skills/zhouxu/voice（打桩 ASR；免费期不扣点不扣次数不留台账）
# ---------------------------------------------------------------------------

print('\n== 12. 语音转写（打桩 ASR） ==')

from db import SessionLocal  # noqa: E402
from zx_models import ZxQuota  # noqa: E402

_ORIG_ASR_AVAILABLE = zx_engine.asr_available
_ORIG_ASR_TRANSCRIBE = zx_engine.asr_transcribe
_FAKE_VOICE_TEXT = '大股东从不分红，小股东没有话语权，怎么办？'


def _zx_quota_rows(key):
    db = SessionLocal()
    try:
        return db.query(ZxQuota).filter(ZxQuota.api_key == key).all()
    finally:
        db.close()


try:
    zx_engine.asr_available = lambda: True
    zx_engine.asr_transcribe = lambda raw, ext: _FAKE_VOICE_TEXT
    _quota_before = _zx_quota_rows('sk_voice_key')

    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.webm', b'RIFFxxxxWEBM', 'audio/webm')},
                    headers={'Authorization': 'Bearer sk_voice_key'})
    check('转写 200 + 文本回传', r.status_code == 200 and r.json().get('text') == _FAKE_VOICE_TEXT,
          f'{r.status_code} {r.text[:120]}')
    _quota_after = _zx_quota_rows('sk_voice_key')
    check('转写不留台账（无配额行）', not _quota_before and not _quota_after)

    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.webm', b'', 'audio/webm')},
                    headers={'Authorization': 'Bearer sk_voice_key'})
    check('空录音 400', r.status_code == 400)

    _old_mb = settings.ZX_MAX_VOICE_MB
    settings.ZX_MAX_VOICE_MB = 1
    try:
        r = client.post('/skills/zhouxu/voice',
                        files={'file': ('voice.webm', b'x' * (1024 * 1024 + 100), 'audio/webm')},
                        headers={'Authorization': 'Bearer sk_voice_key'})
        check('录音超限 400', r.status_code == 400)
    finally:
        settings.ZX_MAX_VOICE_MB = _old_mb

    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.exe', b'x', 'application/octet-stream')},
                    headers={'Authorization': 'Bearer sk_voice_key'})
    check('坏扩展名 400', r.status_code == 400)

    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.webm', b'x', 'audio/webm')})
    check('缺 API Key 401', r.status_code == 401)

    def _asr_boom(raw, ext):
        raise RuntimeError('ASR 请求失败：boom')

    zx_engine.asr_transcribe = _asr_boom
    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.webm', b'RIFFxxxx', 'audio/webm')},
                    headers={'Authorization': 'Bearer sk_voice_key'})
    check('ASR 失败 502', r.status_code == 502)

    zx_engine.asr_available = lambda: False
    r = client.post('/skills/zhouxu/voice',
                    files={'file': ('voice.webm', b'RIFFxxxx', 'audio/webm')},
                    headers={'Authorization': 'Bearer sk_voice_key'})
    check('未配置 ASR 503', r.status_code == 503)

    check('前端 🎤 真录音（MediaRecorder + toggleRec）',
          'MediaRecorder' in html and 'toggleRec' in html and 'voiceBtn' in html)
    check('前端走 /zhouxu/voice 转写', '/zhouxu/voice' in html and 'uploadVoice' in html)
finally:
    zx_engine.asr_available = _ORIG_ASR_AVAILABLE
    zx_engine.asr_transcribe = _ORIG_ASR_TRANSCRIBE

# ---------------------------------------------------------------------------
# 13. 交付导出 /skills/zhouxu/export（真 .docx，手机端可预览）
# ---------------------------------------------------------------------------

print('\n== 13. 交付导出（真 .docx） ==')

import io as _io  # noqa: E402
import zipfile as _zf  # noqa: E402

r = client.post('/skills/zhouxu/export',
                json={'title': '股权尽调清单', 'frame': '先索证后结论',
                      'items': [['章程', '要最新版'], ['股东结构', '穿透到自然人']]},
                headers={'Authorization': 'Bearer sk_voice_key'})
check('导出 200 + PK 魔数（zip）', r.status_code == 200 and r.content[:2] == b'PK', str(r.status_code))
check('Content-Disposition 带 .docx', '.docx' in r.headers.get('content-disposition', ''))
if r.status_code == 200:
    _z = _zf.ZipFile(_io.BytesIO(r.content))
    _doc = _z.read('word/document.xml') if 'word/document.xml' in _z.namelist() else b''
    check('docx 结构完整 + 标题/条目在正文',
          bool(_doc) and '股权尽调清单'.encode('utf-8') in _doc and '章程'.encode('utf-8') in _doc)
r = client.post('/skills/zhouxu/export', json={'title': 'x'})
check('缺 API Key 401', r.status_code == 401)

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
