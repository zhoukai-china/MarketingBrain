#!/bin/bash
# 双击运行：启动思潼 OS 本地开发环境（PostgreSQL + 后端 3011 + 前端 5174）
# 本质是对 scripts/dev-local.sh start 的包装，只是补上「双击体验」：保持窗口、自动开浏览器。

cd "$(dirname "$0")" || { echo "无法进入脚本所在目录"; read -r -p "按回车键关闭本窗口..."; exit 1; }

echo "=================================================="
echo "  思潼 OS · 本地开发环境"
echo "  目录: $(pwd)"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================="
echo

if [ ! -x "./scripts/dev-local.sh" ]; then
  chmod +x "./scripts/dev-local.sh" 2>/dev/null
  if [ ! -x "./scripts/dev-local.sh" ]; then
    echo "找不到可执行的 ./scripts/dev-local.sh"
    echo "请确认本文件与 scripts/ 目录在同一个项目根目录下。"
    echo
    read -r -p "按回车键关闭本窗口..."
    exit 1
  fi
fi

./scripts/dev-local.sh start
code=$?

echo
if [ "$code" -eq 0 ]; then
  open "http://localhost:5174" >/dev/null 2>&1
  echo "已在浏览器打开前端页面 http://localhost:5174"
  echo
  echo "提示：服务在后台运行，关闭本窗口不会停止它们。"
  echo "      需要停止时，双击同目录下的「停止本地服务.command」。"
  echo "      实时日志：tail -f /tmp/baolu-dev/api.log /tmp/baolu-dev/web.log"
else
  echo "启动未成功。退出码: $code"
  echo "日志位置：/tmp/baolu-dev/api.log   /tmp/baolu-dev/web.log"
  echo
  echo "常见原因："
  echo "  · 没装 pnpm          → corepack enable pnpm  或  npm i -g pnpm@9.15.0"
  echo "  · 依赖未安装         → pnpm install"
  echo "  · workspace 包未构建 → pnpm -r --filter \"./packages/*\" build"
  echo "  · 端口被占用         → ./scripts/dev-local.sh status"
fi

echo
read -r -p "按回车键关闭本窗口..."
exit 0
