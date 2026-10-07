# -*- coding: utf-8 -*-
"""查询已发布技能的审核状态与 CDN 可见性。

用法：
    python tools/check_status.py baolu-franchise-support-hub baolu-sales-funnel-hub ...
    python tools/check_status.py @user_xxx/slug        # 带命名空间的写法也可以

注意（踩过的坑）：
- host 是 https://api.skillhub.cn，不是 www.skillhub.cn（www 会返回 HTML）。
- 按 **slug** 查，不按 skillId 查：/api/v1/skills/{slug}；按 skillId 查会 404。
- 返回字段是嵌套的：d["namespace"]["canonicalName"]、d["skill"]["displayName"]、
  d["latestVersion"]["version"]、d["securityReports"]["keen"]["statusText"]
- 不是 d["canonicalName"] 这种平铺结构
"""
import json
import pathlib
import sys
import urllib.request

BASE = "https://api.skillhub.cn/api/v1/skills"
ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKEN_FILE = pathlib.Path.home() / ".skillhub" / "token.txt"

sys.path.insert(0, str(ROOT / "tools"))
from publish_all import read_token  # noqa: E402


def query(skill_id: str, token: str) -> dict:
    req = urllib.request.Request(f"{BASE}/{skill_id}", method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def brief(d: dict) -> str:
    data = d.get("data") or d
    ns = data.get("namespace") or {}
    sk = data.get("skill") or {}
    lv = data.get("latestVersion") or {}
    sec = ((data.get("securityReports") or {}).get("keen")) or {}
    return (f"  slug={ns.get('canonicalName')}\n"
            f"  名称={sk.get('displayName')}\n"
            f"  版本={lv.get('version')}\n"
            f"  审核={sec.get('statusText') or sec.get('status') or '未知'}")


def main():
    ids = sys.argv[1:]
    if not ids:
        print("用法: python tools/check_status.py <slug> [...]")
        return 1
    token = read_token()
    if not token:
        print("ERROR: 拿不到 token")
        return 1
    for sid in ids:
        print(f"\n=== {sid} ===")
        try:
            print(brief(query(sid, token)))
        except Exception as e:
            print(f"  查询失败: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
