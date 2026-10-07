# -*- coding: utf-8 -*-
"""批量发布 SkillHub 技能包。

用法：
    python tools/publish_all.py                 # 发布 packages/ 下全部 zip
    python tools/publish_all.py <slug> [...]    # 只发布指定的
    python tools/publish_all.py --dry-run       # 只预检不上传

token 读取顺序：
    1. 环境变量 SKILLHUB_TOKEN
    2. %TEMP%/skh_token.txt（由 tools/getclip.py 从剪贴板写入）
    3. 现场读取系统剪贴板
"""
import os
import re
import subprocess
import sys
import time
import pathlib

# 平台限流：连续发布会被拒（发布频率过高）。间隔 + 指数退避重试。
GAP = 20          # 每个包之间的基础间隔（秒）
RETRY = 6         # 限流最多重试次数
BACKOFF = 30      # 退避基数（秒）
RATE_LIMIT_RE = re.compile(r"频率过高|过于频繁|rate.?limit|too many", re.I)

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "packages"
CLI = r"C:\Users\book\.local\bin\skillhub"
# skillhub 是 bash wrapper，内部执行 `python3 ~/.skillhub/skills_store_cli.py`
CLI_PY = pathlib.Path.home() / ".skillhub" / "skills_store_cli.py"
TOKEN_FILE = pathlib.Path(os.environ.get("TEMP", r"C:\Windows\Temp")) / "skh_token.txt"


def read_token() -> str:
    t = os.environ.get("SKILLHUB_TOKEN", "").strip()
    if t.startswith("sk"):
        return t
    if TOKEN_FILE.exists():
        t = TOKEN_FILE.read_text(encoding="ascii", errors="ignore").strip()
        if t.startswith("sk"):
            return t
    # 兜底：现场读剪贴板
    try:
        sys.path.insert(0, str(ROOT / "tools"))
        import getclip  # noqa
        t = (TOKEN_FILE.read_text(encoding="ascii", errors="ignore").strip()
             if TOKEN_FILE.exists() else "")
    except Exception:
        pass
    return t if t.startswith("sk") else ""


def main():
    args = [a for a in sys.argv[1:]]
    dry = "--dry-run" in args
    args = [a for a in args if not a.startswith("--")]

    token = read_token()
    if not token and not dry:
        print("ERROR: 拿不到 token。把 skh_ 开头的 token 复制进剪贴板，"
              "或设置环境变量 SKILLHUB_TOKEN。")
        return 1

    if args:
        zips = [PACKAGES / f"{a}.zip" for a in args]
    else:
        zips = sorted(PACKAGES.glob("*.zip"))

    if not zips:
        print("packages/ 下没有 zip")
        return 1

    ok, fail = [], []
    for z in zips:
        if not z.exists():
            print(f"[SKIP] 不存在：{z.name}")
            fail.append((z.name, "文件不存在"))
            continue
        cmd = [sys.executable, str(CLI_PY), "publish", str(z)]
        if not dry:
            cmd += ["--token", token]
        if dry:
            cmd += ["--dry-run"]
        print(f"\n{'='*60}\n>>> {'预检' if dry else '发布'} {z.name}\n{'='*60}")
        r, out = None, ""
        for attempt in range(RETRY if not dry else 1):
            r = subprocess.run(cmd, capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            if r.returncode == 0:
                break
            if not RATE_LIMIT_RE.search(out):
                break
            wait = BACKOFF * (attempt + 1)
            print(f"[限流] {attempt + 1}/{RETRY} 次，{wait}s 后重试…", flush=True)
            time.sleep(wait)
        print(out[-1500:])
        if r is not None and r.returncode == 0:
            ok.append(z.name)
        else:
            fail.append((z.name, out[-300:]))
        if not dry and z != zips[-1]:
            time.sleep(GAP)

    print(f"\n{'='*60}\n结果：成功 {len(ok)} / 失败 {len(fail)}")
    for n in ok:
        print(f"  OK   {n}")
    for n, e in fail:
        print(f"  FAIL {n} :: {e}")
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
