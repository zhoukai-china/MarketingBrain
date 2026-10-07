# -*- coding: utf-8 -*-
"""Release packer: zip the full source tree, exclude secrets/temp artifacts.

Rules (mechanical, no name guessing):
  - include: root *.py, web/*.html, tools/*.py, requirements.txt (if present)
  - exclude: .env (REAL KEYS), *.db/*.sqlite*, __pycache__, .git, dist,
             probe leftovers (gitprobe*, gz_probe_out.txt), *.log, *.pyc
  - write manifest.txt inside the zip (names + sha256[:12], ascii)
stdout prints only ascii: file count + zip sha256[:12].
"""
import hashlib
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "dist")
OUT_ZIP = os.path.join(OUT_DIR, "zhouxu-release-20261007.zip")

SKIP_DIRS = {"__pycache__", ".git", "dist", "node_modules", ".trae", ".idea", ".vscode"}


def skip_file(name: str) -> bool:
    n = name.lower()
    if n == ".env":
        return True  # REAL DEEPSEEK KEY INSIDE - NEVER PACK
    if n.startswith("gitprobe") or n.startswith("gz_probe_out"):
        return True
    for ext in (".db", ".sqlite", ".sqlite3", ".pyc", ".pyo", ".log", ".zip"):
        if n.endswith(ext):
            return True
    return False


files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    rel_dir = os.path.relpath(dirpath, ROOT)
    parts = [] if rel_dir == "." else rel_dir.split(os.sep)
    if any(p in SKIP_DIRS for p in parts):
        dirnames[:] = []
        continue
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if skip_file(fn):
            continue
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
        top = rel.split("/")[0]
        ext = os.path.splitext(fn)[1].lower()
        if top == "web" and ext == ".html":
            files.append(rel)
        elif top == "tools" and ext == ".py":
            files.append(rel)
        elif top == rel and ext == ".py":
            files.append(rel)
        elif rel in ("requirements.txt", ".env.example", ".gitignore"):
            files.append(rel)

files = sorted(set(files))
manifest = []
for rel in files:
    h = hashlib.sha256(open(os.path.join(ROOT, rel), "rb").read()).hexdigest()[:12]
    manifest.append(h + "  " + rel)

os.makedirs(OUT_DIR, exist_ok=True)
if os.path.exists(OUT_ZIP):
    os.remove(OUT_ZIP)
with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in files:
        z.write(os.path.join(ROOT, rel), rel)
    z.writestr("manifest.txt", "\n".join(manifest) + "\n")

zhash = hashlib.sha256(open(OUT_ZIP, "rb").read()).hexdigest()[:12]
print("FILES=%d" % len(files))
print("ZIP_SHA256_12=%s" % zhash)
print("ZIP_PATH_ASCII=dist/zhouxu-release-20261007.zip")
