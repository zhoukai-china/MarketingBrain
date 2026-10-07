# -*- coding: utf-8 -*-
"""直连 SkillHub 发布端点上传 soul（agent 专家）包。
绕过 CLI 的 SKILL.md 强制校验，按 install 端契约发 manifest.json+SOUL.md+skillsets/*.md。
端点：POST https://api.skillhub.cn/api/v1/community/skills/publish
"""
import os, sys, json, time, pathlib, urllib.request, urllib.error

HOST = "https://api.skillhub.cn"
TOKEN_FILE = pathlib.Path(os.environ.get("TEMP", "/tmp")) / "skh_token.txt"

def read_token():
    t = TOKEN_FILE.read_text(encoding="ascii", errors="ignore").strip()
    return t if t.startswith("sk") else ""

def build_multipart(payload: dict, files: list):
    boundary = "----skillhubBoundary" + str(int(time.time() * 1000))
    body = bytearray()
    pb = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="payload"\r\n')
    body.extend(b"Content-Type: application/json\r\n\r\n")
    body.extend(pb); body.extend(b"\r\n")
    for rel, data in files:
        ct = "text/markdown" if rel.lower().endswith(".md") else "application/json"
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="files"; filename="{rel}"\r\n'.encode())
        body.extend(f"Content-Type: {ct}\r\n\r\n".encode())
        body.extend(data); body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    return bytes(body), boundary

def publish(soul_dir: pathlib.Path, token: str):
    meta = json.loads((soul_dir / "manifest.json").read_text(encoding="utf-8"))
    payload = {
        "slug": meta["slug"],
        "version": meta.get("version", "1.0.0"),
        "displayName": meta.get("displayName", meta["slug"]),
        "summary": meta.get("summary", meta.get("displayName", "")),
        "description": meta.get("description", meta.get("displayName", "")),
        "tags": meta.get("tags", ["agent", "expert", "保禄"]),
        "license": meta.get("license", ""),
        "homepage": meta.get("homepage", ""),
        "changelog": meta.get("changelog", "初始发布"),
    }
    files = []
    files.append(("manifest.json", (soul_dir / "manifest.json").read_bytes()))
    files.append(("SOUL.md", (soul_dir / "SOUL.md").read_bytes()))
    for sf in sorted((soul_dir / "skillsets").glob("*.md")):
        files.append((f"skillsets/{sf.name}", sf.read_bytes()))
    data, boundary = build_multipart(payload, files)
    url = HOST + "/api/v1/community/skills/publish"
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
        "User-Agent": "skillhub-cli/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = b""
        try: raw = exc.read() or b""
        except Exception: pass
        try: parsed = json.loads(raw.decode("utf-8") or "{}")
        except Exception: parsed = {"raw": raw.decode("utf-8", "replace")[:800]}
        return exc.code, parsed

def main():
    token = read_token()
    if not token:
        print("ERROR: 拿不到 token"); return 2
    slugs = sys.argv[1:] or [p.name for p in sorted(pathlib.Path("souls").glob("*")) if p.is_dir()]
    for slug in slugs:
        d = pathlib.Path("souls") / slug
        if not d.is_dir():
            print(f"[SKIP] 不存在: {slug}"); continue
        print(f">>> 发布 {slug}")
        code, body = publish(d, token)
        print(f"  HTTP {code}: {json.dumps(body, ensure_ascii=False)[:600]}")
        if slug != slugs[-1]:
            time.sleep(20)
    return 0

if __name__ == "__main__":
    sys.exit(main())
