#!/usr/bin/env bash
# 为 ai.lcppch.top 构建「根路径」前端产物（地址不带 /os-v2 前缀）。
#
# 生产有两套前端产物，**任何 web 发布都必须两边同步**：
#   https://api.lcppch.top/os-v2/  ->  apps/web/dist          （VITE_BASE_PATH=/os-v2/）
#   https://ai.lcppch.top/         ->  apps/web/dist-ai-root  （VITE_BASE_PATH=/，本脚本）
# 2026-09-20 事故：`/agents` 的商城改动只发到 /os-v2 那套，ai.lcppch.top 停在旧产物，
# 用户看到「又回退了」。发 web 后必须跑本脚本，并按下面的自检确认两套入口都更新。
#
# 用法（服务器上执行）：
#   bash /opt/baolu-os-v2/scripts/build-ai-root.sh
#   bash /opt/baolu-os-v2/scripts/build-os-v2-web.sh    # /os-v2/ 那套，逻辑与本脚本相同
#
# 设计要点（都是踩过的坑）：
# 1. 构建到临时目录再**叠加发布**，不用 `--emptyOutDir` 直接清 dist-ai-root：
#    老 chunk 保留，正在浏览的用户不会因为资源被删而白屏；dist-ai-root 里不在构建产物内的
#    文件（例如 /skill_key 指向的 dist/skill_key.html 这类手工恢复文件）也不会被清掉。
# 2. `apps/web/public` 下的静态资源必须一起发布（avatars/、favicon.svg、lanqi-logo.jpg）。
#    2026-09-20 现场就是 dist-ai-root 缺 `avatars/`：`/avatars/*.png` 被 SPA 兜底成
#    index.html（HTTP 200 但 Content-Type 是 text/html），`<img>` onError 后只剩 emoji，
#    表现为「数字员工没有形象」。
# 3. 发布后自检：index.html 必须与本次构建一致，且它引用的每个资源都要真实存在。
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/baolu-os-v2/apps/web}"
# BASE_PATH / DIST_DIR / BUILD_DIR / PUBLIC_BASE_URL 可用环境变量覆盖，默认 = ai.lcppch.top 根路径那套。
BASE_PATH="${BASE_PATH:-/}"
DIST_DIR="${DIST_DIR:-$WEB_DIR/dist-ai-root}"
BUILD_DIR="${BUILD_DIR:-$WEB_DIR/.ai-root-build}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://ai.lcppch.top}"
# 线上自检路径：ai-root 是 /avatars/...，/os-v2/ 那套要带前缀。
PUBLIC_AVATAR_PATH="${PUBLIC_AVATAR_PATH:-/avatars/ip-position.png}"

cd "$WEB_DIR"

echo "[1/4] 构建 VITE_BASE_PATH=$BASE_PATH -> $BUILD_DIR"
env -u VITE_API_BASE_URL VITE_BASE_PATH="$BASE_PATH" node node_modules/vite/bin/vite.js build \
  --outDir "$BUILD_DIR" --emptyOutDir

echo "[2/4] 校验构建产物里的 public 静态资源"
for required in favicon.svg lanqi-logo.jpg avatars/ip-position.png; do
  if [ ! -e "$BUILD_DIR/$required" ]; then
    echo "FAIL: 构建产物缺少 $required（public/ 静态资源没进产物）" >&2
    exit 1
  fi
done

echo "[3/4] 叠加发布到 $DIST_DIR（保留旧 chunk）"
mkdir -p "$DIST_DIR/assets"
cp -rn "$BUILD_DIR/assets/." "$DIST_DIR/assets/"
while IFS= read -r entry; do
  case "$entry" in
    assets|index.html) continue ;;
  esac
  if [ -d "$BUILD_DIR/$entry" ]; then
    mkdir -p "$DIST_DIR/$entry"
    cp -rn "$BUILD_DIR/$entry/." "$DIST_DIR/$entry/"
  else
    cp -f "$BUILD_DIR/$entry" "$DIST_DIR/$entry"
  fi
done < <(cd "$BUILD_DIR" && ls -A)
cp -f "$BUILD_DIR/index.html" "$DIST_DIR/index.html"

echo "[4/4] 自检：入口与引用资源"
if ! cmp -s "$BUILD_DIR/index.html" "$DIST_DIR/index.html"; then
  echo "FAIL: $DIST_DIR/index.html 与本次构建不一致" >&2
  exit 1
fi
entry_file="$(grep -oE 'assets/[A-Za-z0-9_.-]+' "$DIST_DIR/index.html" | head -n 1)"
if [ -z "$entry_file" ] || [ ! -f "$DIST_DIR/$entry_file" ]; then
  echo "FAIL: 入口脚本 $entry_file 在 $DIST_DIR 中不存在" >&2
  exit 1
fi
missing=0
for ref in $(grep -oE 'assets/[A-Za-z0-9_.-]+' "$DIST_DIR/index.html" | sort -u); do
  if [ ! -f "$DIST_DIR/$ref" ]; then
    echo "FAIL: index.html 引用的 $ref 不存在" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

echo "OK: $DIST_DIR（入口 $entry_file，assets $(ls -1 "$DIST_DIR/assets" | wc -l) 个）"
echo "提示：两套入口都要复验 —— /os-v2/ 与 https://ai.lcppch.top/agents 的 index.html 入口名应为本次构建结果。"
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_BASE_URL$PUBLIC_AVATAR_PATH" || true)"
  ctype="$(curl -s -o /dev/null -w '%{content_type}' "$PUBLIC_BASE_URL$PUBLIC_AVATAR_PATH" || true)"
  echo "线上自检 $PUBLIC_BASE_URL$PUBLIC_AVATAR_PATH -> ${code:-?} ${ctype:-?}（应为 200 image/png）"
fi
