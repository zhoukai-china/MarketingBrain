#!/usr/bin/env bash
# 思潼 AI 增长 OS — 本地开发一键启动脚本 (macOS)
#
# 用法:
#   ./scripts/dev-local.sh            启动 PostgreSQL + API(3011) + Web(5174)
#   ./scripts/dev-local.sh status     查看三个服务状态
#   ./scripts/dev-local.sh stop       停止 API + Web（PostgreSQL 会保留）
#   ./scripts/dev-local.sh restart    重启 API + Web
#
# 说明: PostgreSQL 由 micromamba(conda-forge) 安装，数据目录在 ~/.local/pgdata/sitong_os_v2。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$HOME/.local/mamba/envs/pg17/bin}"
PGDATA="${PGDATA:-$HOME/.local/pgdata/sitong_os_v2}"
PGPORT="${PGPORT:-5432}"
API_PORT="${API_PORT:-3011}"
WEB_PORT="${WEB_PORT:-5174}"
LOGDIR="${LOGDIR:-/tmp/baolu-dev}"

mkdir -p "$LOGDIR"

# 双击 .command 时 Terminal 给的是 launchd 最小 PATH（不含 Homebrew），这里补齐。
# 注意：顺序是反着 prepend 的 —— 最后 prepend 的排最前，所以 /opt/homebrew/bin 必须放最后才能排第一，
# 否则 /usr/local/bin 里可能存在的老 node（如 v20）会盖掉 Homebrew 的新 node。
for d in /usr/local/bin /opt/homebrew/sbin /opt/homebrew/bin; do
  case ":$PATH:" in
    *":$d:"*) ;;
    *) [ -d "$d" ] && PATH="$d:$PATH" ;;
  esac
done
export PATH

if [ -t 1 ]; then C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_OFF=""; fi
info() { printf '%s>%s %s\n' "$C_DIM" "$C_OFF" "$*"; }
ok()   { printf '%sOK%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s!!%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
err()  { printf '%sXX%s %s\n' "$C_ERR" "$C_OFF" "$*"; }

# 取监听指定端口的进程 PID
port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

# 轮询直到 url 可访问或超时
wait_http() {
  local url="$1" max="${2:-45}" i=0
  while [ "$i" -lt "$max" ]; do
    if curl -s --noproxy '*' -o /dev/null --max-time 2 "$url" 2>/dev/null; then return 0; fi
    sleep 1; i=$((i+1))
  done
  return 1
}

start_pg() {
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
    ok "PostgreSQL 已在运行 (:$PGPORT)"; return 0
  fi
  [ -x "$PGBIN/pg_ctl" ] || { err "找不到 PostgreSQL: $PGBIN/pg_ctl"; return 1; }
  [ -d "$PGDATA" ]       || { err "找不到数据目录: $PGDATA"; return 1; }
  info "启动 PostgreSQL ..."
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
    -o "-p $PGPORT -k /tmp" start >/dev/null 2>&1
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
    ok "PostgreSQL 已启动 (:$PGPORT)"
  else
    err "PostgreSQL 启动失败，详见 $PGDATA/server.log"; return 1
  fi
}

# start_app <名称> <端口> <pnpm脚本> <健康检查URL>
start_app() {
  local name="$1" port="$2" script="$3" url="$4" log="$LOGDIR/$1.log"
  if [ -n "$(port_pid "$port")" ]; then
    ok "$name 已在运行 (:$port)"; return 0
  fi
  info "启动 $name ..."
  ( cd "$ROOT" && nohup pnpm "$script" >"$log" 2>&1 & )
  if wait_http "$url" 50; then
    ok "$name 已就绪 (:$port)"
  else
    err "$name 启动失败，日志尾部："; tail -15 "$log" 2>/dev/null; return 1
  fi
}

# stop_app <名称> <端口> <pnpm过滤包名>
stop_app() {
  local name="$1" port="$2" pkg="$3" pid
  pid="$(port_pid "$port")"
  if [ -z "$pid" ]; then
    warn "$name 未在运行 (:$port)"
  else
    kill "$pid" 2>/dev/null
    local i=0
    while [ "$i" -lt 10 ]; do [ -z "$(port_pid "$port")" ] && break; sleep 1; i=$((i+1)); done
    if [ -z "$(port_pid "$port")" ]; then ok "$name 已停止 (:$port)"; else err "$name 未能停止 (:$port, PID $pid)"; fi
  fi
  # 清掉可能残留的 pnpm 包装进程
  pkill -f "pnpm --filter $pkg dev" 2>/dev/null
}

status() {
  local pid
  pid="$(port_pid "$PGPORT")";  [ -n "$pid" ] && ok "PostgreSQL  运行中 (:$PGPORT, PID $pid)" || warn "PostgreSQL  未运行 (:$PGPORT)"
  pid="$(port_pid "$API_PORT")"; [ -n "$pid" ] && ok "API         运行中 (:$API_PORT, PID $pid)" || warn "API         未运行 (:$API_PORT)"
  pid="$(port_pid "$WEB_PORT")"; [ -n "$pid" ] && ok "Web         运行中 (:$WEB_PORT, PID $pid)" || warn "Web         未运行 (:$WEB_PORT)"
}

cmd="${1:-start}"

# 确保 node 版本够新（本项目需要 Node 22+：tsx 依赖 process.getBuiltinModule）
ensure_node() {
  command -v node >/dev/null 2>&1 || {
    err "未找到 node。请安装 Node 22+（例如: brew install node）"; return 1; }
  local nv major
  nv="$(node -p 'process.versions.node' 2>/dev/null)"
  major="${nv%%.*}"
  if [ "${major:-0}" -lt 22 ]; then
    err "当前 Node 是 v$nv，过旧（本项目需要 Node 22+）"
    echo "  实际使用: $(command -v node)"
    echo "  v20 缺少 process.getBuiltinModule，tsx 会崩（表现为 DOMMatrix is not defined 等）。"
    echo "  解决（二选一）："
    echo "    A) 让 PATH 中 /opt/homebrew/bin 排在 /usr/local/bin 前面"
    echo "    B) 处理掉旧版本: sudo mv /usr/local/bin/node /usr/local/bin/node.bak"
    return 1
  fi
  return 0
}

# 确保 pnpm 可用；缺失时优先用 corepack 自动补齐（项目已声明 packageManager: pnpm@9.15.0）
ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 && return 0

  local ck node_dir
  ck="$(command -v corepack 2>/dev/null || true)"
  if [ -n "$ck" ]; then
    info "未检测到 pnpm，尝试用 corepack 自动启用 ..."
    node_dir="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)")"
    "$ck" enable --install-directory "$node_dir" pnpm >/dev/null 2>&1
    hash -r 2>/dev/null
    if command -v pnpm >/dev/null 2>&1; then ok "pnpm 已启用（$node_dir/pnpm）"; return 0; fi
  fi

  # 兜底：在常见安装位置找
  local d
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/Library/pnpm"; do
    if [ -x "$d/pnpm" ]; then
      PATH="$d:$PATH"; export PATH; hash -r 2>/dev/null
      ok "找到 pnpm：$d/pnpm"; return 0
    fi
  done

  err "未找到 pnpm。任选一种方式安装后重试："
  echo "   A) corepack（推荐，沿用项目声明的版本）"
  echo "      corepack enable --install-directory \"\$(dirname \$(which node))\" pnpm"
  echo "   B) npm 全局安装"
  echo "      npm i -g pnpm@9.15.0"
  echo "   装完确认：pnpm --version"
  return 1
}

case "$cmd" in
  start)
    echo "== 思潼 OS 本地开发环境 =="
    ensure_node || exit 1
    ensure_pnpm || exit 1
    [ -f "$ROOT/apps/api/.env" ] || warn "缺少 apps/api/.env（后端可能读不到 DATABASE_URL）"
    start_pg || exit 1
    start_app API "$API_PORT" dev:api "http://127.0.0.1:$API_PORT/health" || exit 1
    start_app Web "$WEB_PORT" dev:web "http://127.0.0.1:$WEB_PORT/" || exit 1
    echo
    ok "全部就绪"
    echo "   前端  http://localhost:$WEB_PORT"
    echo "   后端  http://localhost:$API_PORT"
    echo "   日志  $LOGDIR/api.log  $LOGDIR/web.log"
    ;;
  stop)
    stop_app API "$API_PORT" "@baolu/api"
    stop_app Web "$WEB_PORT" "@baolu/web"
    info "PostgreSQL 未停止（如需: $PGBIN/pg_ctl -D $PGDATA stop）"
    ;;
  restart)
    ensure_node || exit 1
    ensure_pnpm || exit 1
    stop_app API "$API_PORT" "@baolu/api"
    stop_app Web "$WEB_PORT" "@baolu/web"
    start_pg || exit 1
    start_app API "$API_PORT" dev:api "http://127.0.0.1:$API_PORT/health" || exit 1
    start_app Web "$WEB_PORT" dev:web "http://127.0.0.1:$WEB_PORT/" || exit 1
    ok "已重启"
    ;;
  status) status ;;
  *) echo "用法: $0 [start|stop|restart|status]"; exit 1 ;;
esac
