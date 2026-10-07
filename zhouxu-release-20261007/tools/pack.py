#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包薄壳技能为 SkillHub 上传用 zip

规则（踩过的坑）：
- 排除 `_` 开头的安装元数据（_icon.png / _meta.json / _skillhub_meta.json）——图标在网页单独传
- 排除 __pycache__ / .pyc / 隐藏文件
- 只保留 SKILL.md、scripts/、config.json、references/（如有）
"""
import argparse
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
OUT_DIR = ROOT / "packages"

KEEP_SUFFIX = {".md", ".py", ".json", ".txt", ".yaml", ".yml"}
EXCLUDE_DIRS = {"__pycache__", ".git", ".venv", "node_modules"}


def pack(slug: str) -> Path:
    src = DIST_DIR / slug
    if not src.exists():
        raise SystemExit(f"目录不存在：{src}（先跑 build_skill.py）")
    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / f"{slug}.zip"
    if out.exists():
        out.unlink()

    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(src.rglob("*")):
            if p.is_dir():
                continue
            rel = p.relative_to(src)
            parts = rel.parts
            if any(part in EXCLUDE_DIRS for part in parts):
                continue
            if any(part.startswith("_") or part.startswith(".") for part in parts):
                continue
            if p.suffix.lower() not in KEEP_SUFFIX:
                continue
            z.write(p, f"{slug}/{rel.as_posix()}")
            n += 1
            print(f"  + {rel.as_posix()}")
    print(f"[pack] {slug} -> {out}（{n} 个文件）")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    args = ap.parse_args()
    pack(args.slug)


if __name__ == "__main__":
    main()
