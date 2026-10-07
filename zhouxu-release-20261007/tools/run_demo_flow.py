# -*- coding: utf-8 -*-
"""驱动 run.py 走完 7 步交互全流程，抓取真实终端输出。"""
import json
import os
import re
import subprocess
import sys
import urllib.request

BASE = "http://127.0.0.1:3999"
RUN = r"F:/baolu-skill-billing/src_experts/baolu-twin-factory-hub/scripts/run.py"
PY = r"C:/Users/book/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

steps = []


def http(method, path, body=None, token=None, admin=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    if admin:
        req.add_header('admin-token', 'demo_admin')
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=60) as r:
        return json.loads(r.read().decode())


def run_py(args, key):
    env = dict(os.environ, BAOLU_API_KEY=key, BAOLU_API_BASE=BASE)
    p = subprocess.run([PY, RUN] + args, capture_output=True, text=True,
                       encoding='utf-8', env=env, timeout=120)
    return p.stdout + (('\n[stderr] ' + p.stderr.strip()) if p.stderr.strip() else '')


def poll(task_id, key):
    out = ''
    for _ in range(20):
        out = run_py(['--poll-task', task_id, '--twin-build'], key)
        if 'TWIN_STATUS=success' in out or 'TWIN_STATUS=failed' in out:
            break
    return out


# 0) 开户
KEY = http('POST', '/skills/keys', {"name": "阿凯", "contact": "demo"})['api_key']
http('POST', f'/admin/add-points?api_key={KEY}&points=10000', admin=True)

# 临时改写技能 config.json 指向演示服务（结束后还原），避免打到生产
CFG = r'F:/baolu-skill-billing/src_experts/baolu-twin-factory-hub/config.json'
_cfg_bak = open(CFG, encoding='utf-8').read()
json.dump({"BAOLU_API_KEY": KEY, "BAOLU_API_BASE": BASE}, open(CFG, 'w', encoding='utf-8'))

import atexit
def _restore():
    open(CFG, 'w', encoding='utf-8').write(_cfg_bak)
atexit.register(_restore)

steps.append(("开户：申请 Key + admin 补点（真实接口）", "（账户就绪，余额 10000 点）"))

# 1) 收素材
out1 = run_py(['--mode', 'material',
               '--text', '我叫阿凯，剪了8年短视频，带过3个人的剪辑组，主要剪知识类和剧情类。最擅长把一条平平无奇的片子救成爆款。',
               '--text', '客户最常问：哥我片子数据不好怎么办？我的答案永远是：先看完播率曲线，掉在最前面就是开头的问题，别老怪内容。',
               '--text', '我的原则：节奏是用删减做出来的，删到心疼就对了。观众只给你3秒，别浪费在片头上。我最烦客户说「我感觉还行吧」，完播率不会骗人，人才会。'], KEY)
steps.append(("① 收口述素材（3 段，含「客户问→我怎么答」原话）", out1))

# 2) 上传文件素材（剪辑讲稿）
doc = "爆款剪辑内训讲稿：\n钩子-展开-反转，三段缺一不可。前3秒是生死线，logo片头全删。\nBGM是第二叙事线，卡点不是为了帅，是为了留人。\n字幕是保命绳，关键句必须上大字，观众经常静音刷。"
open(r'F:/baolu-skill-billing/tools/_demo_script.txt', 'w', encoding='utf-8').write(doc)
out2 = run_py(['--mode', 'material', '--upload', r'F:/baolu-skill-billing/tools/_demo_script.txt'], KEY)
steps.append(("② 传文件素材（剪辑内训讲稿，自动解析）", out2))

# 3) 链接素材
out3 = run_py(['--mode', 'material', '--link', 'https://mp.weixin.qq.com/s/demo-jiegou'], KEY)
steps.append(("③ 传链接素材（公众号拆解文章，自动抓正文）", out3))

mats = http('GET', '/skills/twin/materials', token=KEY)['materials']
mat_ids = ','.join(m['material_id'] for m in mats if m['status'] == 'parsed')

# 4) 素材体检
out4 = run_py(['--precheck', mat_ids], KEY)
steps.append(("④ 素材体检（不扣费，看缺哪层）", out4))

# 5) 画像草稿
out5 = run_py(['--draft',
               '--input', 'name=阿凯分身',
               '--input', 'role=剪辑师',
               '--input', 'industry=短视频/内容',
               '--input', 'audience=短视频创作者、剪辑新手、接片客户',
               '--input', 'outputs=脚本拆解,成片节奏诊断,参考片分析,改片方案',
               '--input', 'style=毒舌但实在，短句连发，先骂后教',
               '--input', 'notes=访谈要点：8年剪辑，3人剪辑组，完播率优先',
               '--materials', mat_ids], KEY)
d_task = re.search(r'DRAFT_TASK_ID=(\S+)', out5).group(1)
out5b = poll(d_task, KEY)
steps.append(("⑤ 画像草稿（蒸馏「我们理解的你」，不扣费）", out5 + "\n-- 轮询 --\n" + out5b))
draft_id = re.search(r'DRAFT_ID=(df_\w+)', out5b) or re.search(r'"draft_id":\s*"(df_\w+)"', '')
m = re.search(r'(df_[0-9a-f]+)', out5b)
draft_id = m.group(1)

# 6) 确认后开工
out6 = run_py(['--mode', 'build', '--draft-id', draft_id,
               '--input', 'name=阿凯分身', '--input', 'role=剪辑师',
               '--input', 'outputs=脚本拆解,成片节奏诊断,参考片分析,改片方案',
               '--materials', mat_ids], KEY)
b_task = re.search(r'TWIN_TASK_ID=(\S+)', out6).group(1)
out6b = poll(b_task, KEY)
steps.append(("⑥ 用户确认画像 → 开工上线（扣制作费，含保真自检）", out6 + "\n-- 轮询 --\n" + out6b))
twin_id = re.search(r'TWIN_TWIN_ID=(twin_\w+)', out6b).group(1)

# 7) 分身干活
out7 = run_py(['--skill-id', twin_id,
               '--input', 'question=凯哥，我这条片子2分钟，数据很差，完播率15%，帮我看看问题在哪',
               '--input', 'asker=短视频创作者', '--only-create'], KEY)
g_task = re.search(r'GEN_TASK_ID=(\S+)', out7).group(1)
out7b = ''
for _ in range(20):
    out7b = run_py(['--poll-task', g_task], KEY)
    if 'GEN_STATUS=success' in out7b or 'GEN_STATUS=failed' in out7b:
        break
steps.append(("⑦ 唤出分身干活（按次扣点，分身口吻交付）", out7 + "\n-- 轮询 --\n" + out7b))

# 8) 反馈 + 精调
out8 = run_py(['--twin-feedback', twin_id, '--rating', 'unlike',
               '--note', '说得对但太温和了，我平时说话更冲，直接给改法', '--run-id', g_task], KEY)
out8b = run_py(['--twin-feedback', twin_id, '--rating', 'unlike',
                '--note', '「参考做法」太虚，直接告诉我去拆哪条爆款'], KEY)
out8c = run_py(['--twin-feedback', twin_id, '--rating', 'unlike',
                '--note', '案例别用「同类爆款」糊弄我，要具体到结构'], KEY)
steps.append(("⑧ 养分身：记 3 条「不像」反馈（攒够触发免费精调）", out8 + out8b + out8c))

out9 = run_py(['--twin-refine', twin_id], KEY)
r_task = re.search(r'TWIN_TASK_ID=(\S+)', out9).group(1)
out9b = poll(r_task, KEY)
steps.append(("⑨ 免费精调（SOUL 热更新出新版本）", out9 + "\n-- 轮询 --\n" + out9b))

out10 = run_py(['--twin-versions', twin_id], KEY)
steps.append(("⑩ 版本历史（可随时回滚）", out10))

json.dump({"key": KEY, "steps": steps}, open(r'F:/baolu-skill-billing/tools/_demo_transcript.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print("DONE", len(steps), "steps")
