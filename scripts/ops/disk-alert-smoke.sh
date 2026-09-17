#!/usr/bin/env bash
# `scripts/ops/disk-alert.sh` 的离线回归：夜间静默、边界、紧急线升级与「不误伤」。
#
# 全程不联网、不真发告警：`df` 与 `curl` 都用临时目录里的假实现（curl 只把参数写进日志文件），
# webhook 指向 example.invalid。用 NOW_HOUR 模拟小时，因此任何时间都能跑。
#
# 用法：bash scripts/ops/disk-alert-smoke.sh
set -uo pipefail

SCRIPT="${SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/disk-alert.sh}"
[ -f "$SCRIPT" ] || { echo "找不到被测脚本：$SCRIPT" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "需要 python3（被测脚本用它转义 JSON）" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE_BIN="$WORK/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/df" <<'FAKE_DF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/vda3 31457280 22000000 %s %s%% /\n' "$FAKE_AVAIL_KB" "$FAKE_USED_PCT"
FAKE_DF

cat > "$FAKE_BIN/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
FAKE_CURL

chmod +x "$FAKE_BIN/df" "$FAKE_BIN/curl"

PASS=0
FAIL=0
CASE_OUT=""
CASE_PUSHES=0
CASE_RC=0
CASE_EXTRA_ARGS=""

# run_case <名称> <小时> <可用GB> <使用率%> [额外 env 赋值…]
# 结果放在 CASE_OUT / CASE_PUSHES / CASE_RC，由调用处断言。
run_case() {
  local name="$1" hour="$2" avail="$3" pct="$4"
  shift 4
  local log="$WORK/curl-$name.log"
  : > "$log"
  CASE_OUT="$(env PATH="$FAKE_BIN:$PATH" \
      CURL_LOG="$log" \
      NOW_HOUR="$hour" \
      FAKE_AVAIL_KB="$(awk "BEGIN{printf \"%d\", $avail*1048576}")" \
      FAKE_USED_PCT="$pct" \
      SITONG_ALERT_WEBHOOK="https://example.invalid/robot" \
      "$@" bash "$SCRIPT" ${CASE_EXTRA_ARGS} 2>&1)"
  CASE_RC=$?
  CASE_PUSHES="$(wc -l < "$log" | tr -d '[:space:]')"
  printf '\n=== %s（hour=%s avail=%sG pct=%s%%）rc=%s pushes=%s\n%s\n' \
    "$name" "$hour" "$avail" "$pct" "$CASE_RC" "$CASE_PUSHES" "$CASE_OUT"
}

assert_rc() { # <期望退出码>
  if [ "$CASE_RC" = "$1" ]; then PASS=$((PASS + 1)); else echo "FAIL: 退出码 期望=$1 实际=$CASE_RC"; FAIL=$((FAIL + 1)); fi
}
assert_pushes() { # <期望推送数>
  if [ "$CASE_PUSHES" = "$1" ]; then PASS=$((PASS + 1)); else echo "FAIL: 推送次数 期望=$1 实际=$CASE_PUSHES"; FAIL=$((FAIL + 1)); fi
}
assert_contains() { # <子串>
  case "$CASE_OUT" in
    *"$1"*) PASS=$((PASS + 1)) ;;
    *) echo "FAIL: 输出缺少「$1」"; FAIL=$((FAIL + 1)) ;;
  esac
}
assert_not_contains() { # <子串>
  case "$CASE_OUT" in
    *"$1"*) echo "FAIL: 输出不该出现「$1」"; FAIL=$((FAIL + 1)) ;;
    *) PASS=$((PASS + 1)) ;;
  esac
}

echo "被测脚本：$SCRIPT"

# 1) 未越线：白天/夜里都安静、退出码 0（现状不变）
run_case ok-day 12 9.0 70
assert_rc 0
assert_pushes 0
assert_contains "OK（未越线，不发告警）"

run_case ok-night 3 9.0 70
assert_rc 0
assert_pushes 0

# 2) 白天越线：照旧推送（不改白天行为）
run_case day-warn 12 7.0 76
assert_rc 2
assert_pushes 1
assert_contains "磁盘告警"

# 3) 夜间越线：不再每小时推送，只写 journal，并且日志里明确说了「静默」
run_case night-2300 23 7.0 76
assert_rc 2
assert_pushes 0
assert_contains "QUIET: 夜间"

run_case night-0300 3 7.0 76
assert_rc 2
assert_pushes 0
assert_contains "QUIET: 夜间"

run_case night-0659 6 7.0 76
assert_rc 2
assert_pushes 0

# 4) 静默窗口边界：23:00 起静默、22:00 与 07:00 照推
run_case evening-2200 22 7.0 76
assert_rc 2
assert_pushes 1

run_case morning-0700 7 7.0 76
assert_rc 2
assert_pushes 1

# 5) 夜间紧急：可用 ≤5G 是发布红线，必须照推（不能被静默吞掉）
run_case night-critical 3 4.5 86
assert_rc 2
assert_pushes 1
assert_contains "磁盘紧急告警"
assert_not_contains "QUIET: 夜间"

run_case night-critical-boundary 3 5.0 86
assert_rc 2
assert_pushes 1
assert_contains "磁盘紧急告警"

run_case night-above-critical 3 5.1 86
assert_rc 2
assert_pushes 0
assert_contains "QUIET: 夜间"

# 6) 配置：QUIET_HOURS=off 回到每小时推；自定义窗口；非法值按不静默
run_case quiet-off 3 7.0 76 QUIET_HOURS=off
assert_rc 2
assert_pushes 1

run_case custom-window-in 1 7.0 76 QUIET_HOURS=1-5
assert_rc 2
assert_pushes 0
assert_contains "QUIET: 夜间（1:00-5:00）"

run_case custom-window-out 12 7.0 76 QUIET_HOURS=1-5
assert_rc 2
assert_pushes 1

run_case invalid-window 3 7.0 76 QUIET_HOURS=abc
assert_rc 2
assert_pushes 1
assert_contains "QUIET_HOURS 非法"

# 7) 只按使用率越线也要推（夜间例外只针对常规告警，不针对「不越线」）
run_case pct-only-day 12 9.0 90
assert_rc 2
assert_pushes 1
assert_contains "使用率 90% ≥ 85%"

# 8) --dry-run 永不发送（夜间/白天都不发），退出码 0
CASE_EXTRA_ARGS="--dry-run"
run_case dry-run-night 3 7.0 76
assert_rc 0
assert_pushes 0
assert_contains "QUIET: 夜间"

run_case dry-run-day 12 7.0 76
assert_rc 0
assert_pushes 0
assert_contains "DRY-RUN"
CASE_EXTRA_ARGS=""

# 9) 未配置 webhook：只写 journal，不崩（退出码仍是 2＝越线）
run_case no-webhook 12 7.0 76 SITONG_ALERT_WEBHOOK=
assert_rc 2
assert_pushes 0
assert_contains "not configured"

echo
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo "DISK_ALERT_SMOKE_OK ${PASS}/${TOTAL}"
  exit 0
fi
echo "DISK_ALERT_SMOKE_FAILED passed=${PASS} failed=${FAIL} total=${TOTAL}"
exit 1
