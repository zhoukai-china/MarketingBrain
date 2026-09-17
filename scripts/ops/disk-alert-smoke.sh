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
CASE_STATE_DIR=""
CASE_NOW_EPOCH=""
CASE_LAST_STATE_DIR=""

# run_case <名称> <小时> <可用GB> <使用率%> [额外 env 赋值…]
# 结果放在 CASE_OUT / CASE_PUSHES / CASE_RC，由调用处断言。
# CASE_STATE_DIR / CASE_NOW_EPOCH 为**粘性**的：设一次之后后续 case 继续用（用来演「同一条告警的时间线」）；
# 不设时每个 case 用独立状态目录，避免互相污染。换场景前记得改或清空。
run_case() {
  local name="$1" hour="$2" avail="$3" pct="$4"
  shift 4
  local log="$WORK/curl-$name.log"
  if [ -n "$CASE_STATE_DIR" ]; then
    CASE_LAST_STATE_DIR="$CASE_STATE_DIR"
  else
    CASE_LAST_STATE_DIR="$WORK/state-$name"
  fi
  : > "$log"
  CASE_OUT="$(env PATH="$FAKE_BIN:$PATH" \
      CURL_LOG="$log" \
      NOW_HOUR="$hour" \
      NOW_EPOCH="${CASE_NOW_EPOCH:-}" \
      STATE_DIR="$CASE_LAST_STATE_DIR" \
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
assert_no_quiet_state() { # 抑制状态文件不应存在
  if [ -f "$CASE_LAST_STATE_DIR/last-warn-push" ]; then
    echo "FAIL: 不应写下抑制状态 $CASE_LAST_STATE_DIR/last-warn-push"
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
}
assert_state_kept() { # 抑制状态文件应原样保留
  if [ -f "$CASE_LAST_STATE_DIR/last-warn-push" ]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: 不应该动抑制状态，但 $CASE_LAST_STATE_DIR/last-warn-push 没了"
    FAIL=$((FAIL + 1))
  fi
}
reset_case_env() {
  CASE_STATE_DIR=""
  CASE_NOW_EPOCH=""
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

# 10) 重复抑制：同一常规告警默认 6 小时内只推一条（用户 2026-09-17 要求「4–6 小时一条」）
T0=1789000000
CASE_STATE_DIR="$WORK/state-timeline"
CASE_NOW_EPOCH=$T0
run_case repeat-first 12 7.0 76
assert_rc 2
assert_pushes 1
assert_contains "state recorded"

CASE_NOW_EPOCH=$((T0 + 3600))            # 1 小时后
run_case repeat-after-1h 12 7.0 76
assert_rc 2
assert_pushes 0
assert_contains "SUPPRESS:"

CASE_NOW_EPOCH=$((T0 + 21599))           # 5h59m59s 后：仍在窗口内
run_case repeat-after-599 13 7.0 76
assert_rc 2
assert_pushes 0
assert_contains "SUPPRESS:"

CASE_NOW_EPOCH=$((T0 + 21600))           # 6 小时整：允许再推
run_case repeat-after-6h 13 7.0 76
assert_rc 2
assert_pushes 1

CASE_NOW_EPOCH=$((T0 + 25200))           # 刚推完又只过 1 小时
run_case repeat-after-6h-plus-1h 14 7.0 76
assert_rc 2
assert_pushes 0
assert_contains "SUPPRESS:"

# 恢复正常要能立刻恢复提醒能力（清掉抑制状态）
CASE_NOW_EPOCH=$((T0 + 25560))
run_case repeat-recovered 15 9.0 70
assert_rc 0
assert_pushes 0

CASE_NOW_EPOCH=$((T0 + 25620))
run_case repeat-after-recovery 15 7.0 76
assert_rc 2
assert_pushes 1
reset_case_env

# 11) 间隔可配：REPEAT_HOURS=4 按 4 小时算；0 = 关闭抑制（回到每小时推）
CASE_STATE_DIR="$WORK/state-r4"
CASE_NOW_EPOCH=$T0
run_case r4-first 12 7.0 76 REPEAT_HOURS=4
assert_rc 2
assert_pushes 1

CASE_NOW_EPOCH=$((T0 + 10799))           # 3 小时内
run_case r4-after-3h 12 7.0 76 REPEAT_HOURS=4
assert_rc 2
assert_pushes 0
assert_contains "SUPPRESS:"

CASE_NOW_EPOCH=$((T0 + 14400))           # 4 小时整
run_case r4-after-4h 12 7.0 76 REPEAT_HOURS=4
assert_rc 2
assert_pushes 1
reset_case_env

CASE_STATE_DIR="$WORK/state-r0"
CASE_NOW_EPOCH=$T0
run_case r0-first 12 7.0 76 REPEAT_HOURS=0
assert_rc 2
assert_pushes 1

CASE_NOW_EPOCH=$((T0 + 3600))
run_case r0-after-1h 12 7.0 76 REPEAT_HOURS=0
assert_rc 2
assert_pushes 1
reset_case_env

# 12) 紧急级不受抑制：推过常规告警后一小时掉到紧急线，必须照推
CASE_STATE_DIR="$WORK/state-crit"
CASE_NOW_EPOCH=$T0
run_case crit-warn-first 12 7.0 76
assert_rc 2
assert_pushes 1

CASE_NOW_EPOCH=$((T0 + 3600))
run_case crit-breakthrough 12 4.5 86
assert_rc 2
assert_pushes 1
assert_contains "磁盘紧急告警"
assert_not_contains "SUPPRESS:"
reset_case_env

# 13) 状态文件坏掉或写不进：宁可重复，不可沉默（不能因为记不住就漏告警）
CASE_STATE_DIR="$WORK/state-corrupt"
mkdir -p "$CASE_STATE_DIR"
printf 'garbage\n' > "$CASE_STATE_DIR/last-warn-push"
CASE_NOW_EPOCH=$T0
run_case corrupt-state 12 7.0 76
assert_rc 2
assert_pushes 1
reset_case_env

CASE_STATE_DIR="/proc/baolu-disk-alert-state-test"
CASE_NOW_EPOCH=$T0
run_case unwritable-state-1 12 7.0 76
assert_rc 2
assert_pushes 1
assert_contains "抑制状态写不进"

CASE_NOW_EPOCH=$((T0 + 3600))
run_case unwritable-state-2 12 7.0 76
assert_rc 2
assert_pushes 1
reset_case_env

# 14) 夜间静默时不写抑制状态：夜里没推过，白天第一次检查就该提醒
CASE_STATE_DIR="$WORK/state-night"
CASE_NOW_EPOCH=$T0
run_case night-no-state 3 7.0 76
assert_rc 2
assert_pushes 0
assert_no_quiet_state
reset_case_env

# 15) --dry-run 是「只看不动」：未越线时也不能顺手删掉抑制状态
CASE_STATE_DIR="$WORK/state-dryrun-readonly"
mkdir -p "$CASE_STATE_DIR"
printf '%s\n' "$T0" > "$CASE_STATE_DIR/last-warn-push"
CASE_NOW_EPOCH=$((T0 + 600))
CASE_EXTRA_ARGS="--dry-run"
run_case dry-run-ok-keeps-state 12 9.0 70
assert_rc 0
assert_pushes 0
assert_contains "OK（未越线，不发告警）"
assert_state_kept

# 非 dry-run 的未越线才清状态（恢复后立刻可提醒）
CASE_EXTRA_ARGS=""
run_case ok-clears-state 12 9.0 70
assert_rc 0
assert_no_quiet_state
reset_case_env

echo
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo "DISK_ALERT_SMOKE_OK ${PASS}/${TOTAL}"
  exit 0
fi
echo "DISK_ALERT_SMOKE_FAILED passed=${PASS} failed=${FAIL} total=${TOTAL}"
exit 1
