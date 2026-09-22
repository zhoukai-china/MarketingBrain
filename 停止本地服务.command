#!/bin/bash
# 双击运行：停止思潼 OS 本地前后端服务（PostgreSQL 保留）
# 本质是对 scripts/dev-local.sh stop 的包装。

cd "$(dirname "$0")" || { echo "无法进入脚本所在目录"; read -r -p "按回车键关闭本窗口..."; exit 1; }

echo "=================================================="
echo "  停止思潼 OS · 本地前后端服务"
echo "=================================================="
echo

if [ ! -x "./scripts/dev-local.sh" ]; then
  chmod +x "./scripts/dev-local.sh" 2>/dev/null
fi

if [ -x "./scripts/dev-local.sh" ]; then
  ./scripts/dev-local.sh stop
else
  echo "找不到 ./scripts/dev-local.sh，改用端口直接停止 ..."
  for port in 3011 5174; do
    pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null && echo "已停止端口 $port (PID $pid)"
    else
      echo "端口 $port 未在运行"
    fi
  done
fi

echo
echo "PostgreSQL 仍在后台运行（数据目录 ~/.local/pgdata/sitong_os_v2）。"
echo "如需连数据库一起停："
echo "  ~/.local/mamba/envs/pg17/bin/pg_ctl -D ~/.local/pgdata/sitong_os_v2 stop"
echo
read -r -p "按回车键关闭本窗口..."
exit 0
