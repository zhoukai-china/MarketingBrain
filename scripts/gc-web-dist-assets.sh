#!/usr/bin/env bash
# 思潼 AI 增长 OS：回收 web 构建垃圾（dist/assets 里已不被任何页面引用的历史产物）
#
# 背景：/opt/baolu-* 的发布是「只叠加、不删除」，Vite 每次构建都会产出新的
# contenthash 文件名，于是 dist/assets 会一直累积旧包。2026-09-12 生产实测：
# 浏览器真正会加载的只有 53 个文件，但目录里躺着 2253 个历史文件 / 123.8 MB，
# 其中 14 个还带着已被 PLAT-19 推翻的「≈ ¥」旧文案，让发布后校验出现误导性红灯。
# 这些文件不被 index.html 及其 import 图引用，删掉对用户零影响；为可回滚仍先
# 移动到 /opt/baolu-backups（随后由 scripts/prune-baolu-backups.sh 的保留策略清理）。
#
# 用法:
#   gc-web-dist-assets.sh <app-dir>              # 干跑，只报告
#   gc-web-dist-assets.sh <app-dir> --apply      # 实际移动到备份区
set -euo pipefail

APP="${1:?app dir}"
MODE="${2:-dry-run}"
DIST="$APP/apps/web/dist"
BACKUP_ROOT="/opt/baolu-backups"

case "$APP" in /opt/baolu-*) ;; *) echo "unexpected APP=$APP" >&2; exit 1 ;; esac
case "$MODE" in dry-run|--apply) ;; *) echo "unexpected mode=$MODE (dry-run|--apply)" >&2; exit 1 ;; esac
test -f "$DIST/index.html" || { echo "missing $DIST/index.html" >&2; exit 1; }
test "$(readlink -f "$APP")" = "$APP"

MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

python3 - "$DIST" "$MANIFEST" <<'PY'
import os, re, sys

dist, manifest = sys.argv[1], sys.argv[2]
assets = os.path.join(dist, "assets")
index = open(os.path.join(dist, "index.html"), encoding="utf-8", errors="ignore").read()

# 从 index.html 出发走 import 图：html -> 入口 js/css -> 动态 chunk。
# 这个闭包就是真实浏览器会请求的文件集，其余一律是历史垃圾。
reach = set(re.findall(r"assets/([A-Za-z0-9_.\-]+)", index))
queue = list(reach)
while queue:
    name = queue.pop()
    if not name.endswith((".js", ".css")):
        continue
    path = os.path.join(assets, name)
    if not os.path.exists(path):
        continue
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    for found in re.findall(r"assets/([A-Za-z0-9_.\-]+)", text):
        if found not in reach:
            reach.add(found)
            queue.append(found)

# 安全闸：entry 图至少要包含入口 js/css。图算崩了（例如 index.html 读成空）
# 会让「可达集」缩水到几乎为空，那样下面就会把在用的文件全判成垃圾。
if len([n for n in reach if n.endswith((".js", ".css"))]) < 10:
    raise SystemExit("refusing to run: import graph only resolved %d files" % len(reach))

present = set(os.listdir(assets))
stale = sorted(present - reach)
with open(manifest, "w", encoding="utf-8") as fh:
    for name in stale:
        fh.write(name + "\n")

total = 0
for name in stale:
    try:
        total += os.path.getsize(os.path.join(assets, name))
    except OSError:
        pass
print("reachable_assets=%d" % len(reach))
print("stale_assets=%d" % len(stale))
print("stale_bytes=%d" % total)
print("stale_megabytes=%.1f" % (total / 1048576.0))
PY

if [ ! -s "$MANIFEST" ]; then
  echo "NOTHING_TO_DO: no stale assets"
  exit 0
fi

if [ "$MODE" != "--apply" ]; then
  echo "DRY_RUN: nothing moved. Re-run with --apply to quarantine them."
  echo "sample (first 10):"
  head -10 "$MANIFEST" | sed 's/^/  /'
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
QUARANTINE="$BACKUP_ROOT/web-dist-assets-gc-${STAMP}-$(basename "$APP")"
case "$QUARANTINE" in "$BACKUP_ROOT"/*) ;; *) echo "unexpected QUARANTINE=$QUARANTINE" >&2; exit 1 ;; esac
mkdir -p "$QUARANTINE/assets"
cp "$MANIFEST" "$QUARANTINE/stale-files.txt"

while IFS= read -r name; do
  case "$name" in
    ""|*/*|.*) echo "skip suspicious entry: $name" >&2; continue ;;
  esac
  [ -f "$DIST/assets/$name" ] || continue
  mv "$DIST/assets/$name" "$QUARANTINE/assets/$name"
done < "$MANIFEST"

echo "quarantined_into=$QUARANTINE"
echo "remaining_assets=$(ls -1 "$DIST/assets" | wc -l)"
echo "GC_OK"
