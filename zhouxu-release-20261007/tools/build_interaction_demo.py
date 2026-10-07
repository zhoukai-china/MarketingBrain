# -*- coding: utf-8 -*-
"""用真实 transcript 生成 V1.1 交互过程演示页"""
import html as H
import json

d = json.load(open(r'F:/baolu-skill-billing/tools/_demo_transcript.json', encoding='utf-8'))
S = [o for _, o in d['steps']]


def term(txt):
    # 高亮协议行
    lines = []
    for ln in txt.split('\n'):
        e = H.escape(ln)
        if ln.startswith('==='):
            lines.append(f'<span class="k">{e}</span>')
        elif any(ln.startswith(p) for p in ('MAT_', 'PRECHECK_', 'DRAFT_', 'TWIN_', 'GEN_', 'FB_')):
            lines.append(f'<span class="k">{e}</span>')
        elif ln.startswith('$'):
            lines.append(f'<span class="dim">{e}</span>')
        elif ln.startswith(('【', '0-', '3-', '15秒', '1.', '2.', '3.', '- ')):
            lines.append(e)
        else:
            lines.append(e)
    return '\n'.join(lines)


def preview_md(txt):
    # 把 TWIN/DRAFT_PREVIEW 之间的 markdown 渲染成简单 HTML
    body = txt.split('=== TWIN_PREVIEW_START ===\n')[-1].split('=== DRAFT_PREVIEW_START ===\n')[-1]
    body = body.split('=== TWIN_PREVIEW_END ===')[0].split('=== DRAFT_PREVIEW_END ===')[0]
    out = []
    in_fidelity = False
    for ln in body.split('\n'):
        e = H.escape(ln)
        if ln.startswith('## '):
            out.append(f'<h2>{e[3:]}</h2>')
        elif ln.startswith('**') and ln.endswith('**'):
            out.append(f'<h3>{ln.strip("*")}</h3>')
        elif ln.startswith('- '):
            if '待主人补充' in ln:
                out.append(f'<li class="pending">{e[2:]}</li>')
            elif 'AI 依你的语言风格拟写' in ln:
                out.append(f'<p class="hint">{e[2:]}</p>')
            else:
                out.append(f'<li>{e[2:]}</li>')
        elif ln.startswith('> '):
            out.append(f'<p class="fid">{e[2:]}</p>')
        elif ln.startswith('*（'):
            out.append(f'<p class="hint">{e.strip("*")}</p>')
        elif ln.strip():
            out.append(f'<p class="kv">{e}</p>')
    return '\n'.join(out)


def card(title, body_html):
    return f'<div class="card">{title}{body_html}</div>'


PHASES = []


def phase(no, title, dialogue=None, terminal=None, card_html=None, note=None, dialogue_after=None):
    b = []
    for who, txt in (dialogue or []):
        cls = 'me' if who == 'u' else 'skill'
        name = '用户 · 阿凯' if who == 'u' else '分身架构师（技能）'
        b.append(f'<div class="row {cls}"><div><div class="who">{name}</div><div class="bub">{txt}</div></div></div>')
    if terminal:
        b.append(f'<div class="term">{term(terminal)}</div>')
    if card_html:
        b.append(card_html)
    for who, txt in (dialogue_after or []):
        cls = 'me' if who == 'u' else 'skill'
        name = '用户 · 阿凯' if who == 'u' else '分身架构师（技能）'
        b.append(f'<div class="row {cls}"><div><div class="who">{name}</div><div class="bub">{txt}</div></div></div>')
    if note:
        b.append(f'<div class="note">{note}</div>')
    PHASES.append(f'<div class="phase"><div class="no">{no}</div><div class="t">{title}</div><div class="ln"></div></div>' + '\n'.join(b))


# 0 产品
phase(1, '首次接触 · 三句话讲清产品', [
    ('u', '听说你们能造「数字分身」？我天天被客户追着问片子问题，回不过来。'),
    ('s', '好东西，三句话给您讲清楚：\n<span class="q">是什么</span>：给您造一位「数字分身」——用您的经验、您的说话方式在线干活的数字咨询师。您忙不过来的判断、方案、初稿，先让 TA 出，您把关后就能用。\n<span class="q">怎么做</span>：花几分钟聊聊 + 把您的素材丢给我，工厂蒸馏后先给您看「我们理解的你」，您确认再上线。\n<span class="q">怎么收费</span>：制作费一次性（开工前给您看准数，失败全额返还）+ 日常按次扣点 + 以后觉得不像随时说，攒够反馈<b>免费精调</b>，越用越像。'),
])

# 1 职业模板 + 聊三句
phase(2, '选职业模板 · 聊三句（骨架访谈）', [
    ('s', '您是哪个行的？律师 / 医生大健康 / 财税 / 咨询师 / 企业运营 / <span class="q">剪辑师</span>…命中了我直接给您预填画像草稿。'),
    ('u', '剪辑师。'),
    ('s', '好，剪辑师模板已备好。三个问题一次答完，不用打草稿：\n① <span class="q">自我介绍</span>：你是谁、干了多少年、最擅长什么？\n② <span class="q">客户最常问什么 + 你怎么答</span>：3-5 个，原话最好。\n③ <span class="q">你怎么说话</span>：口头禅？绝不说什么？'),
    ('u', '我叫阿凯，剪了8年短视频，带过3个人的剪辑组…（口述 3 段，已收进素材）\n有份内训讲稿和一篇公众号拆解，也给你。'),
])

# 2 素材采集
phase(3, '素材采集 · 工厂自动解析（图片识字/音视频转写）', terminal=S[1] + '\n\n' + S[2] + '\n\n' + S[3],
      note='📎 每收一件立即上传返回 MAT_ID；图片/音频/视频由工厂 OCR/ASR 自动解析（本演示环境未配 OCR/ASR 服务，自动降级为存档并提示——生产配好后同一条命令直接出文字）。')

# 3 体检
phase(4, '素材体检（不扣费）· 缺口让用户自己决定补不补', [
    ('s', '素材齐了，先做个免费体检看看成色：'),
], terminal=S[4],
   dialogue_after=[('s', '翻译一下：19 张要点卡，事实和金句都够，就是<b>方法论提炼偏薄</b>——有讲稿课件的话丢上来，判断框架都藏在里面。您的讲稿我已经收到了，这轮够了。要不要看蒸馏结果？')])

# 4 画像确认
phase(5, '画像确认（关键节点）· 「我们理解的你」先过目，点头才花钱', [
    ('s', '蒸馏完了——这是「我们理解的你」，您过目，哪里不像直接说：'),
], terminal=S[5],
   card_html=card('', preview_md(S[5])),
   dialogue_after=[('s', '体检结论：可以开工。确认后开工，制作费 <span class="q">2600 点</span>（失败全额返还）；以后每次派活扣 12 点。要开工吗？'),
                   ('u', '像，就是这个味儿。开工。')])

# 5 开工
phase(6, '开工上线 · 扣制作费 → 保真自检 → 上线', terminal=S[6],
      card_html=card('<div class="badge">思潼 · 数字分身（能力分身）已上线</div>', preview_md(S[6])),
      dialogue_after=[('s', '✅ 分身上线，保真自检 8/10。制作费实收 2600 点。\n<span class="q">怎么用</span>：以后说「用我的分身问问：xxx」，我就派 TA 出交付。\n<span class="q">怎么养</span>：每次用完觉得哪里不像，跟我说「这条不像，因为…」，攒够 3 条免费精调——<b>越用越像</b>，改坏了还能回滚。')])

# 6 分身干活
phase(7, '分身干活 · 唤出交付（按次扣点）', [
    ('u', '用我的分身问问：我这条片子2分钟，数据很差，完播率15%，帮我看看问题在哪'),
], terminal=S[7])

# 7 养分身
phase(8, '养分身 · 反馈 → 免费精调 → 版本', [
    ('u', '说得对但太温和了，我平时说话更冲，直接给改法。'),
    ('s', '记下了。参考做法那块呢？'),
    ('u', '也太虚，还有案例别糊弄我，要具体到结构。'),
    ('s', '都记了，3 条攒够，触发免费精调——' ),
], terminal=S[8] + '\n\n' + S[9])

# 8 版本
phase(9, '越用越像 · 版本历史（随时回滚）', terminal=S[10],
      note='🔍 v1→v2 对比：语言风格从「短句连发，先骂后教」变成「短句连发，一针见血，先给改法再解释」，新增方法论「字幕是保命绳」——这就是「越用越像」的闭环，也是开源静态 SKILL 做不到的部分。')

PH = '\n'.join(PHASES)

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>数字分身工厂 V1.1 · 交互过程实录</title>
<style>
  :root{{--bg:#0d1526;--panel:#132038;--panel2:#182a47;--line:#24365a;--orange:#F47920;--orange2:#ff9a4d;--text:#e8edf6;--muted:#8fa3c4;--muted2:#5f7396}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:var(--bg);color:var(--text);font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.7;padding:32px 16px 64px}}
  .wrap{{max-width:900px;margin:0 auto}}
  h1{{font-size:22px;margin-bottom:6px}} h1 .em{{color:var(--orange)}}
  .sub{{color:var(--muted);font-size:13px;margin-bottom:26px}}
  .phase{{display:flex;align-items:center;gap:10px;margin:32px 0 14px}}
  .phase .no{{width:26px;height:26px;border-radius:50%;background:var(--orange);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}}
  .phase .t{{font-size:15px;font-weight:700;color:var(--orange2);letter-spacing:1px}}
  .phase .ln{{flex:1;height:1px;background:var(--line)}}
  .row{{display:flex;margin:12px 0}} .row.me{{justify-content:flex-end}}
  .bub{{max-width:80%;padding:12px 16px;border-radius:14px;font-size:14px;white-space:pre-wrap}}
  .skill .bub{{background:var(--panel2);border:1px solid var(--line);border-top-left-radius:4px}}
  .me .bub{{background:linear-gradient(135deg,#2a4a86,#1d3560);border:1px solid #35558f;border-top-right-radius:4px}}
  .who{{font-size:11px;color:var(--muted2);margin:0 6px 4px;letter-spacing:1px}}
  .me .who{{text-align:right}}
  .q{{color:var(--orange2);font-weight:600}}
  .note{{background:rgba(244,121,32,.08);border:1px dashed rgba(244,121,32,.4);border-radius:10px;padding:10px 14px;font-size:12.5px;color:#f0b98a;margin:10px 4px}}
  .term{{background:#0a0f1c;border:1px solid var(--line);border-radius:10px;padding:12px 16px;font-family:Consolas,monospace;font-size:12px;color:#b8ccb8;margin:10px 0;overflow-x:auto;white-space:pre-wrap}}
  .term .dim{{color:#5f7396}} .term .k{{color:#ffd28a}}
  .card{{background:linear-gradient(160deg,#152543,#101c33);border:1px solid #2c4270;border-radius:16px;padding:20px 24px;margin:14px 0;box-shadow:0 8px 30px rgba(0,0,0,.35)}}
  .card h2{{font-size:18px;margin-bottom:4px}} .card h3{{font-size:13px;color:var(--orange2);margin:12px 0 4px;letter-spacing:1px}}
  .card p,.card li{{font-size:13.5px;color:#d5deee}} .card ul{{padding-left:20px}}
  .card .kv{{margin:2px 0}} .card .hint{{font-size:12px;color:#8fa3c4}} .card .pending{{color:#8fa3c4;font-style:italic}}
  .card .fid{{color:#7ee2a8;font-size:13px;margin-top:10px}}
  .foot{{color:var(--muted2);font-size:12px;margin-top:36px;border-top:1px solid var(--line);padding-top:14px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>数字分身工厂 V1.1 · <span class="em">交互过程实录</span></h1>
  <div class="sub">人物：剪辑师「阿凯」 ｜ 终端输出为<b>真实链路</b>（本地 FastAPI 服务 + 真实 run.py 客户端协议，LLM 打桩为高质量内容）｜ 89 项回归测试全绿同代码</div>
  {PH}
  <div class="foot">说明：对话话术按 SKILL.md 1.1.0 推演；素材上传/体检/画像草稿/开工/调用/反馈/精调/版本 共 11 次真实命令执行输出原样收录。真模型端到端待 DEEPSEEK 配置进测试环境后实测。</div>
</div>
</body>
</html>"""

open(r'F:/baolu-skill-billing/tools/twin_factory_v11_interaction_demo.html', 'w', encoding='utf-8').write(html)
print('written', len(html))
