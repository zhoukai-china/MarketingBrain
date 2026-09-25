#!/usr/bin/env python3
import json, re, html

DATA = "/Users/zhoukai/code/MarketingBrain/copy_io_array.json"
OUT = "/Users/zhoukai/code/MarketingBrain/copy_io_report.html"

SYS_PROMPT = (
"你是思潼AI行业智能体平台的「文案智能体」。按「内容十件套 V5」完整交付一套：一、选题策划；二、口播逐字稿；三、访谈话术；四、拍摄脚本；五、拍摄注意事项；六、剪辑EDL；七、发布标题与话题；八、最佳发布时间；九、评论区引导；十、投流建议。"
"整体交付一份 Markdown，每章用『一、』…『十、』作为章节标题（独占一行，可用加粗如 **一、选题策划** 或 Markdown 标题），顺序与字段名严格按本约定。不要把所有章节塞进同一个表格；章节内部可使用小表格 / 列表 / 代码块："
"一、选题策划（选题角度/爆款元素/脚本类型/漏斗层级/内容类型：获客型/人设型/流量型）；"
"二、口播逐字稿（默认60秒，按 0-3/3-15/15-30/30-45/45-55/55-60 六段，含【动作/情绪】与 >B-roll 切换点，每句≤40字）；"
"三、访谈话术（招商/获客型：必须给出 5-6 组问答，每组单独一行，开头写【问·情境式/情感式/转折式/引导式/回顾式】+ 问题，下一行【答】+ 答复；人设/流量型可显式标 不适用）；"
"四、拍摄脚本（固定场景+移动场景+B-roll清单，按场景段落不逐字卡秒）；"
"五、拍摄注意事项（着装/场景/收音/灯光/状态/禁忌六类清单）；禁忌 用描述性语言（如避免医疗承诺、绝对化用语、诱导私信），不要逐字写出被禁止的词；"
"六、剪辑EDL（段落/画面/配乐/字幕特效/备注，不写秒区间，≥4段，含 BGM 与字幕规范）；"
"七、发布标题与话题（必须 3 行标题：『📌 主标题：…』『🔁 备选1：…』『🔁 备选2：…』；三层话题：大流量1-2/精准2-3/行业1-2）；"
"八、最佳发布时间（推荐+备选+策略）；"
"九、评论区引导（置顶评论+前10条回复风格+意向转化话术）；"
"十、投流建议（按内容类型定主渠道：获客型→本地推；流量型→DOU+；人设型→DOU+测爆款+私域。给前置指标/设置/日预算公式）。"
"严禁在 口播/标题/话题/置顶评论/意向转化话术 中出现：私信、加微信、电话、联系我、找我、留个、扫码领、加我；以及 唯一/保证/100%/根治/彻底/永久；包回本/稳赚/月入过万/零风险/躺赚。"
"先判断信息是否够用：若「行业/产品卖点」或「目标人群」缺失、敷衍，或明显无法理解，则不要猜测、不要编造、也不要输出十件套；只输出固定格式【需补充信息】。"
"十件套里的客户名、门店名、案例、数据、资质、价格等，凡用户未明确提供的，一律写「待补充」，严禁编造或套用任何真实品牌/客户名称。"
"输出必须一、…十、十节齐全、每节独立成段；标题必须正好 3 行；若为获客/招商型，访谈话术必须 5-6 组【问·…】，且第十节主投本地推。只输出这套十件套 Markdown，不要输出任何说明、推导或内部评估。"
)

def parse_copy_ten(text):
    failures=[]; sections=["一、","二、","三、","四、","五、","六、","七、","八、","九、","十、"]
    for s in sections:
        if not re.search(r'(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|?\s*\*{1,2}\s*)?'+re.escape(s), text):
            failures.append(f"缺「{s}」")
    m=re.search(r'二、[\s\S]*?(?=(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|)?\s*三、|$)', text)
    script=m.group(0) if m else ''
    clean=re.sub(r'【[^】]*】','',script); clean=re.sub(r'>B-roll[^\n]*','',clean); clean=clean.replace('```','')
    words=len(re.findall(r'[\u4e00-\u9fa5a-zA-Z0-9]',clean))
    if words<150: failures.append(f"口播过短({words}<150)")
    long=None
    for s in re.split(r'[。！？；\n]',clean):
        s=s.strip()
        if len(s)>40 and not re.match(r'^[0-9]+[-\s]*[0-9]*\s*秒',s) and not s.startswith('【') and not s.startswith('>') and not s.startswith('|') and not s.startswith('#') and not s.startswith('-') and not re.match(r'.*[|].*[|]',s):
            long=s; break
    if long: failures.append(f"口播>40字单句")
    tc=len(re.findall(r'^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:📌\s*)?主标题|^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:🔁\s*)?备选',text,re.M))
    if tc<3: failures.append(f"标题不足({tc}<3)")
    for layer in ["大流量","精准","行业"]:
        if layer not in text: failures.append(f"缺话题「{layer}」")
    edl=0; lines=text.split('\n')
    for i,l in enumerate(lines):
        c=[x.strip() for x in l.strip().strip('|').split('|')] if l.strip().startswith('|') else []
        if c and c[0]=="段落":
            for j in range(i+1,len(lines)):
                c2=[x.strip() for x in lines[j].strip().strip('|').split('|')] if lines[j].strip().startswith('|') else []
                if not lines[j].strip().startswith('|'): break
                if all(re.match(r'^:?-{2,}:?$',x) for x in c2): continue
                edl+=1
            break
    if edl<4: failures.append(f"EDL不足({edl}<4)")
    return failures,words,tc,edl

rows=json.load(open(DATA,encoding='utf-8'))
# normalize input to find identical-input clusters
for r in rows:
    r['_norm']=re.sub(r'\s+','',r.get('input') or '')
from collections import defaultdict
groups=defaultdict(list)
for idx,r in enumerate(rows):
    groups[r['_norm']].append(idx)
clusters={k:v for k,v in groups.items() if len(v)>1}
# tag each row with cluster id
cluster_of={}
for cid,(k,v) in enumerate(sorted(clusters.items(),key=lambda x:-len(x[1])),1):
    for idx in v: cluster_of[idx]=cid
# metrics
for r in rows:
    f,w,t,e=parse_copy_ten(r.get('answer') or '')
    r['_fail']=f; r['_words']=w; r['_title']=t; r['_edl']=e
    r['_topic']=("✓" if all(k in (r.get('answer') or '') for k in ["大流量","精准","行业"]) else "✗")

def esc(x): return html.escape(x or "")

# identical clusters detail
cluster_detail=""
for cid in sorted(set(cluster_of.values())):
    members=sorted([i for i,c in cluster_of.items() if c==cid])
    rep=rows[members[0]]
    cluster_detail+=f"<h3>同输入簇 #{cid}：用户 {esc(rep.get('userId','')[:12])} · 输入完全相同 · {len(members)} 条连生成</h3>"
    cluster_detail+=f"<p class='muted'>输入预览：{esc((rep.get('input') or '')[:80])}…</p>"
    cluster_detail+="<table class='mini'><tr><th>#</th><th>时间</th><th>SKU</th><th>口播字数</th><th>标题</th><th>EDL</th><th>话题</th><th>结论</th></tr>"
    for i in members:
        r=rows[i]
        cluster_detail+=f"<tr><td>{i+1}</td><td>{esc(r.get('createdAt','')[:19])}</td><td>{esc(r.get('skuCode',''))}</td><td>{r['_words']}</td><td>{r['_title']}</td><td>{r['_edl']}</td><td>{r['_topic']}</td><td>{'通过' if not r['_fail'] else '不通过'}</td></tr>"
    ws=[rows[i]['_words'] for i in members]
    cluster_detail+=f"</table><p class='muted'>同输入下口播字数：{ws} → 极差 {max(ws)-min(ws)} 字（system prompt 与输入完全一致，差异纯来自模型）。</p>"

# master table
master="<table class='main'><tr><th>#</th><th>时间</th><th>SKU</th><th>用户</th><th>输入预览</th><th>输入长</th><th>口播字数</th><th>标题</th><th>EDL</th><th>话题</th><th>簇</th><th>结论</th></tr>"
for i,r in enumerate(rows):
    master+=f"<tr><td>{i+1}</td><td>{esc(r.get('createdAt','')[:19])}</td><td>{esc(r.get('skuCode',''))}</td><td>{esc((r.get('userId') or '')[:10])}</td><td class='inprev'>{esc((r.get('input') or '')[:46])}…</td><td>{len(r.get('input') or '')}</td><td>{r['_words']}</td><td>{r['_title']}</td><td>{r['_edl']}</td><td>{r['_topic']}</td><td>{cluster_of.get(i,'—')}</td><td>{'通过' if not r['_fail'] else '不通过'}</td></tr>"
master+="</table>"

# details
details=""
for i,r in enumerate(rows):
    tag=f" · 同输入簇{cluster_of.get(i,'')}" if i in cluster_of else ""
    details+=f"<details><summary>#{i+1} {esc(r.get('createdAt','')[:19])} · {esc(r.get('skuCode',''))} · 用户{esc((r.get('userId') or '')[:10])}{tag}</summary>"
    details+=f"<p class='lbl'>① LLM 固定输入（system prompt，全部记录共用）</p><pre class='sys'>{esc(SYS_PROMPT)}</pre>"
    details+=f"<p class='lbl'>② 本条 LLM 变量输入（MarketplaceDeliverable.input）</p><pre class='in'>{esc(r.get('input') or '')}</pre>"
    details+=f"<p class='lbl'>③ LLM 输出（MarketplaceDeliverable.answer）— 口播{r['_words']}字 / 标题{r['_title']} / EDL{r['_edl']} / 话题{r['_topic']} / {'通过' if not r['_fail'] else '不通过:'+';'.join(r['_fail'])}</p><pre class='out'>{esc(r.get('answer') or '')}</pre>"
    details+="</details>"

html_doc=f"""<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文案 LLM 输入/输出对照表</title>
<style>
body{{font-family:-apple-system,Segoe UI,Roboto,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;background:#f5f6f8;color:#1f2329;}}
.wrap{{max-width:1180px;margin:0 auto;padding:24px;}}
h1{{font-size:22px;margin:0 0 4px;}} h2{{font-size:17px;margin:28px 0 10px;border-left:4px solid #3b7;padding-left:10px;}} h3{{font-size:15px;margin:18px 0 6px;}}
.muted{{color:#8a9099;font-size:12px;}}
.card{{background:#fff;border:1px solid #e6e8eb;border-radius:10px;padding:16px 18px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.04);}}
table{{border-collapse:collapse;width:100%;font-size:12.5px;background:#fff;}}
.main th,.main td{{border:1px solid #e6e8eb;padding:6px 8px;text-align:left;vertical-align:top;}}
.main th{{background:#f0f2f5;position:sticky;top:0;}}
.main tr:nth-child(even){{background:#fafbfc;}}
.inprev{{max-width:240px;color:#445;}}
.mini{{font-size:12px;margin:6px 0;}} .mini th,.mini td{{border:1px solid #e6e8eb;padding:4px 7px;}}
pre{{white-space:pre-wrap;word-break:break-word;background:#f8f9fb;border:1px solid #e6e8eb;border-radius:8px;padding:12px;font-size:12px;line-height:1.55;max-height:420px;overflow:auto;}}
pre.sys{{background:#eef6ff;border-color:#cfe3ff;}}
pre.in{{background:#fff7e6;border-color:#ffe1a8;}}
pre.out{{background:#f0faf0;border-color:#cfe9cf;}}
.lbl{{font-size:12px;font-weight:600;color:#333;margin:12px 0 4px;}}
details{{background:#fff;border:1px solid #e6e8eb;border-radius:10px;padding:10px 14px;margin:8px 0;}}
summary{{cursor:pointer;font-size:13px;font-weight:600;}}
.kpi{{display:inline-block;background:#eef;color:#346;border:1px solid #cdd;border-radius:6px;padding:2px 8px;margin:2px 4px 2px 0;font-size:12px;}}
</style></head><body><div class="wrap">
<h1>文案智能体 · LLM 输入/输出对照表</h1>
<p class="muted">数据源：生产库 baolu_os_v2.public.MarketplaceDeliverable（sku=ipzone__copy / meiye__copy）。仅含"通过校验"的产出（路由校验不过就 422、不落库）。导出时间 {esc(rows[0].get('createdAt','')[:10])}~{esc(rows[-1].get('createdAt','')[:10])} 区间，共 {len(rows)} 条。</p>

<div class="card">
<h2 style="margin-top:0">① 是不是"同一场景同一阶段"？——不是</h2>
<p>这 {len(rows)} 条<b>不是</b>统一场景：</p>
<p>
<span class="kpi">SKU：ipzone__copy（文案智能体）{sum(1 for r in rows if r['skuCode']=='ipzone__copy')} 条</span>
<span class="kpi">meiye__copy（美业文案智能体）{sum(1 for r in rows if r['skuCode']=='meiye__copy')} 条</span>
<span class="kpi">不同用户 {len(set(r.get('userId') for r in rows))} 个</span>
<span class="kpi">跨 {len(set(r.get('createdAt','')[:10] for r in rows))} 天</span>
<span class="kpi">唯一输入 {len(set(r['_norm'] for r in rows))} 种</span>
</p>
<p>也就是说，绝大多数记录是<b>不同用户 + 不同商业输入 + 不同天</b>，输出长度差异里混了大量"输入差异"，不能直接当成"模型波动"。</p>
<p><b>但库里恰好有 2 组"同一用户·同一输入·几秒内连生成"的簇</b>（见第③节），那才是干净的"同场景同阶段"对比——同一 system prompt、同一输入，输出却不同，才是真正的模型波动证据。</p>
</div>

<div class="card">
<h2 style="margin-top:0">② 主表（每条的输入预览 + 输出指标）</h2>
{master}
<p class="muted">"簇"列标了数字的就是同一输入重复生成的组内成员。</p>
</div>

<div class="card">
<h2 style="margin-top:0">③ 同输入簇对比（干净的同场景同阶段证据）</h2>
{cluster_detail}
</div>

<h2>④ 逐条明细（点开看完整 LLM 输入 + 输出）</h2>
{details}

<div class="card">
<h2 style="margin-top:0">附：LLM 固定输入 system prompt（全部记录共用，原文）</h2>
<pre class="sys">{esc(SYS_PROMPT)}</pre>
</div>
</div></body></html>"""

open(OUT,"w",encoding="utf-8").write(html_doc)
print("written",OUT,"rows=",len(rows),"clusters=",len(clusters))
for cid in sorted(set(cluster_of.values())):
    mem=sorted([i for i,c in cluster_of.items() if c==cid])
    ws=[rows[i]['_words'] for i in mem]
    print(f"簇{cid}: {len(mem)}条 口播字数{ws} 极差{max(ws)-min(ws)}")
