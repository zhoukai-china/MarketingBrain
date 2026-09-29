import re

s = open("docs/prototypes/agent-product-detail-demo-20260923.html", encoding="utf-8").read()

def clean(html: str) -> str:
    t = re.sub(r"<[^>]+>", "|", html)
    t = re.sub(r"\|+", "|", t)
    return "\n".join(x.strip() for x in t.split("|") if x.strip())

for key in ["hwRobot", "courseAgent", "courseWb", "opcLlm", "opcComic"]:
    m = re.search(r'<div class="agent-sec[^"]*" data-agent="' + key + r'"[^>]*>(.*?)</div>\s*<!--\s*/agent-sec\s*' + key + r'\s*-->', s, re.S)
    if not m:
        m = re.search(r'<div class="agent-sec[^"]*" data-agent="' + key + r'"(.*?)<!-- /agent-sec ' + key, s, re.S)
    if m:
        print("==== " + key + " ====")
        print(clean(m.group(1))[:900])
        print()
    else:
        print("==== " + key + " ==== NOT FOUND")
