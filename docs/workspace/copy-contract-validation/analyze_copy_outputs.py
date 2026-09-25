#!/usr/bin/env python3
import json, re, sys

RAW = "/Users/zhoukai/code/MarketingBrain/copy_deliverables_raw.jsonl"
OUT_SUMMARY = "/Users/zhoukai/code/MarketingBrain/copy_outputs_summary.md"
OUT_FULL = "/Users/zhoukai/code/MarketingBrain/copy_outputs_full.md"

def parse_copy_ten(text):
    failures = []
    sections = ["一、","二、","三、","四、","五、","六、","七、","八、","九、","十、"]
    for s in sections:
        if not re.search(r'(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|?\s*\*{1,2}\s*)?' + re.escape(s), text):
            failures.append(f"缺少「{s}」章节")
    m = re.search(r'二、[\s\S]*?(?=(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|)?\s*三、|$)', text)
    script = m.group(0) if m else ""
    clean = re.sub(r'【[^】]*】','',script)
    clean = re.sub(r'>B-roll[^\n]*','',clean)
    clean = clean.replace('```','')
    words = len(re.findall(r'[\u4e00-\u9fa5a-zA-Z0-9]', clean))
    if words < 150:
        failures.append(f"口播稿过短（{words} 字 < 150）")
    long_s = None
    for s in re.split(r'[。！？；\n]', clean):
        s = s.strip()
        if len(s) > 40 and not re.match(r'^[0-9]+[-\s]*[0-9]*\s*秒', s) and not s.startswith('【') and not s.startswith('>') and not s.startswith('|') and not s.startswith('#') and not re.match(r'.*[|].*[|]', s):
            long_s = s; break
    if long_s:
        failures.append(f"口播存在 >40 字单句（{long_s[:24]}…）")
    title_count = len(re.findall(r'^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:📌\s*)?主标题|^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:🔁\s*)?备选', text, re.M))
    if title_count < 3:
        failures.append(f"标题不足（{title_count} < 3）")
    for layer in ["大流量","精准","行业"]:
        if layer not in text:
            failures.append(f"话题缺少「{layer}」层级")
    # EDL rows
    edl = 0
    lines = text.split('\n')
    for i,l in enumerate(lines):
        cells = [c.strip() for c in l.strip().strip('|').split('|')] if l.strip().startswith('|') else []
        if cells and cells[0] == "段落":
            for j in range(i+1,len(lines)):
                c2 = [x.strip() for x in lines[j].strip().strip('|').split('|')] if lines[j].strip().startswith('|') else []
                if not lines[j].strip().startswith('|'): break
                if all(re.match(r'^:?-{2,}:?$', x) for x in c2): continue
                edl += 1
            break
    if edl < 4:
        failures.append(f"剪辑EDL段落不足（{edl} < 4）")
    ct = re.search(r'(内容类型|content_type)[\s\S]{0,12}?[：:][\s\S]{0,6}?((?:获客型|人设型|流量型))', text)
    content_type = ct.group(1) if ct else ""
    if content_type == "获客型":
        qa = len(re.findall(r'(?:【问·?|问·)', text))
        if qa < 5:
            failures.append(f"访谈话术问答不足（{qa} < 5）")
        if "本地推" not in text:
            failures.append("获客型应主投本地推，缺失")
    if content_type == "流量型" and "DOU+" not in text:
        failures.append("流量型应主投DOU+，缺失")
    scan = "\n".join(l for l in re.sub(r'十、[\s\S]*$','',text).split('\n') if not re.search(r'严禁|禁忌|违禁|医疗承诺|避免[^，。]{0,12}承诺|绝对化用语|合规提示', l))
    if re.search(r'私信|加微信|电话|联系我|找我|留个|扫码领|加我', scan):
        failures.append("含违规引导词")
    if re.search(r'唯一|保证|100%|根治|彻底|永久', scan):
        failures.append("含绝对化用语")
    if re.search(r'包回本|稳赚|月入过万|零风险|躺赚', scan):
        failures.append("含承诺类表述")
    return failures, words, title_count, edl

rows = []
with open(RAW, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        rows.append(json.loads(line))

rows.sort(key=lambda r: r.get('createdAt',''))

summary_lines = []
summary_lines.append("# 文案模型输出逐条校验（来自 MarketplaceDeliverable.answer）\n")
summary_lines.append(f"共 {len(rows)} 条（ipzone__copy + meiye__copy）。下表复刻 parseCopyTenContract 的确定性校验。\n")
summary_lines.append("| # | 时间(UTC+8) | sku | 口播字数 | 标题数 | EDL段 | 话题三层 | 结论 | 失败项 |")
summary_lines.append("|---|---|---|---|---|---|---|---|---|")

full_parts = []
for i, r in enumerate(rows, 1):
    ans = r.get('answer') or ""
    failures, words, titles, edl = parse_copy_ten(ans)
    layers = "✓" if all(k in ans for k in ["大流量","精准","行业"]) else "✗"
    ok = "通过" if not failures else "不通过"
    fails = "；".join(failures) if failures else "—"
    summary_lines.append(f"| {i} | {r.get('createdAt','')} | {r.get('skuCode','')} | {words} | {titles} | {edl} | {layers} | {ok} | {fails} |")
    full_parts.append(f"\n\n## #{i}  {r.get('createdAt','')}  [{r.get('skuCode','')}]  requestId={r.get('requestId','')}\n\n**校验结论：{ok}**  （口播{words}字 / 标题{titles} / EDL{edl}段 / 话题{layers}）\n\n```markdown\n{ans}\n```\n")

with open(OUT_SUMMARY, 'w', encoding='utf-8') as f:
    f.write("\n".join(summary_lines) + "\n")
with open(OUT_FULL, 'w', encoding='utf-8') as f:
    f.write("# 文案模型输出完整正文（MarketplaceDeliverable.answer）\n" + "".join(full_parts))

# console summary
print(f"total={len(rows)}")
npass = sum(1 for r in rows if not parse_copy_ten(r.get('answer') or "")[0])
print(f"通过={npass} 不通过={len(rows)-npass}")
for i, r in enumerate(rows,1):
    f,w,t,e = parse_copy_ten(r.get('answer') or "")
    layers = "✓" if all(k in (r.get('answer') or "") for k in ["大流量","精准","行业"]) else "✗"
    print(f"#{i} {r.get('createdAt','')[:19]} {r.get('skuCode',''):14} 字数={w:4} 标题={t} EDL={e} 话题={layers} {'通过' if not f else '不通过: '+';'.join(f)}")
