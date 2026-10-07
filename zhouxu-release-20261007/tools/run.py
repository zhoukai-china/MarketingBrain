#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
思潼AI增长OS · 通用云端技能客户端

职责：薄壳技能与思潼AI增长OS 后端之间的轻客户端。
- 读技能目录下 config.json 的 BAOLU_API_KEY / BAOLU_API_BASE（回退环境变量）
- 创建任务（--only-create）拿到 task_id
- 轮询任务进度（--poll-task）直到终态，输出 Markdown 结果

用法：
  python3 scripts/run.py --skill-id ip-positioning \
      --input name=李总 --input industry=美业连锁 --only-create
  python3 scripts/run.py --skill-id ip-positioning \
      --poll-task <task_id> --out ./交付.md

退出码约定：
  0  = 成功（终态，已产出结果）
  2  = 缺 API Key
  3  = 参数非法
  4  = 余额不足
  8  = 401 key 无效
  10 = 任务不存在
  11 = 5xx / 网络错误（点数已返还）
  12 = 已发起但任务未成功（点数已返还）
  13 = 进行中，未到终态（非失败，需续轮询）
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = SKILL_DIR / "config.json"

KEY_PAGE = "https://api.lcppch.top/skill_key"

CREATE_PATH = "/skills/gen/tasks"
POLL_PATH_TPL = "/skills/gen/tasks/{task_id}"

HTTP_TIMEOUT = 90
POLL_INTERVAL = 5


def load_config():
    api_key = ""
    api_base = ""
    try:
        if CONFIG_PATH.exists():
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            api_key = cfg.get("BAOLU_API_KEY", "") or ""
            api_base = cfg.get("BAOLU_API_BASE", "") or ""
    except Exception:
        pass
    api_key = api_key or os.environ.get("BAOLU_API_KEY", "")
    api_base = api_base or os.environ.get("BAOLU_API_BASE", "")
    return api_key.strip(), api_base.strip().rstrip("/")


def _http_json(method, url, headers, body=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = dict(headers)
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", "replace")
        if not raw.strip():
            return {}
        return json.loads(raw)


def build_headers(api_key):
    return {
        "Authorization": f"Bearer {api_key}" if api_key else "",
        "X-Appbuilder-From": "sitong",
        "Accept": "application/json",
    }


def parse_inputs(pairs):
    out = {}
    for p in pairs or []:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def cmd_only_create(args):
    api_key, api_base = load_config()
    if not api_key:
        print("GEN_STATUS=missing_key")
        print("请先到配置页申请并填入 API Key：", KEY_PAGE, file=sys.stderr)
        return 2
    if not api_base:
        print("GEN_STATUS=missing_base")
        print("请先在 config.json 配置 BAOLU_API_BASE", file=sys.stderr)
        return 3
    if not args.skill_id:
        print("GEN_STATUS=invalid_param")
        print("--skill-id 为必填", file=sys.stderr)
        return 3

    payload = {"skill_id": args.skill_id, "inputs": parse_inputs(args.input)}
    url = f"{api_base}{CREATE_PATH}"
    try:
        resp = _http_json("POST", url, build_headers(api_key), payload)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("GEN_STATUS=unauthorized")
            return 8
        if e.code == 402:
            print("GEN_STATUS=insufficient_balance")
            return 4
        if e.code in (400, 422):
            print("GEN_STATUS=invalid_param")
            try:
                print(e.read().decode("utf-8", "replace"), file=sys.stderr)
            except Exception:
                pass
            return 3
        print(f"GEN_STATUS=http_error_{e.code}")
        return 11
    except Exception as e:
        print("GEN_STATUS=network_error")
        print(str(e), file=sys.stderr)
        return 11

    print(f"GEN_TASK_ID={resp.get('task_id', '')}")
    print(f"GEN_STATUS={resp.get('status', 'pending')}")
    print(f"GEN_PROGRESS={resp.get('progress', 0)}")
    print(f"GEN_POINTS={resp.get('points', '')}")
    return 0


def cmd_poll(args):
    api_key, api_base = load_config()
    if not api_key:
        print("GEN_STATUS=missing_key")
        return 2
    if not api_base:
        print("GEN_STATUS=missing_base")
        return 3

    url = f"{api_base}{POLL_PATH_TPL.format(task_id=args.poll_task)}"
    deadline = time.time() + (args.timeout or HTTP_TIMEOUT)
    while True:
        try:
            resp = _http_json("GET", url, build_headers(api_key))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("GEN_STATUS=unauthorized")
                return 8
            if e.code == 404:
                print("GEN_STATUS=not_found")
                return 10
            print(f"GEN_STATUS=http_error_{e.code}")
            return 11
        except Exception as e:
            print("GEN_STATUS=network_error")
            print(str(e), file=sys.stderr)
            return 11

        status = str(resp.get("status", "")).lower()
        print(f"GEN_STATUS={status}")
        print(f"GEN_PROGRESS={resp.get('progress', 0)}")
        print(f"GEN_ELAPSED={int(time.time() - (args._start or time.time()))}")

        if status in ("success", "succeeded", "done", "completed"):
            data = resp.get("data", {}) or {}
            billing = resp.get("billing", {}) or {}
            markdown = data.get("markdown", "") or resp.get("markdown", "")
            print(f"GEN_POINTS_USED={billing.get('total_points', '')}")
            if markdown:
                print("=== GEN_REPORT_START ===")
                print(markdown)
                print("=== GEN_REPORT_END ===")
                if args.out:
                    try:
                        Path(args.out).write_text(markdown, encoding="utf-8")
                        print(f"GEN_REPORT_FILE={args.out}")
                    except Exception as e:
                        print(f"# warn: 写入报告文件失败 {e}", file=sys.stderr)
            return 0

        if status in ("failed", "error"):
            print(f"GEN_FAILURE_CODE={resp.get('failure_code', '')}")
            print(f"GEN_MESSAGE={resp.get('message', '')}")
            return 12

        if time.time() >= deadline:
            return 13
        time.sleep(args.poll_interval or POLL_INTERVAL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill-id", default="")
    parser.add_argument("--input", action="append", default=[],
                        help="输入参数，形如 key=value，可重复")
    parser.add_argument("--out", default="")
    parser.add_argument("--only-create", action="store_true")
    parser.add_argument("--poll-task", default="")
    parser.add_argument("--timeout", type=int, default=HTTP_TIMEOUT)
    parser.add_argument("--poll-interval", type=int, default=POLL_INTERVAL)
    args = parser.parse_args()
    args._start = time.time()

    if args.only_create:
        sys.exit(cmd_only_create(args))
    if args.poll_task:
        sys.exit(cmd_poll(args))

    print("GEN_STATUS=no_op")
    print("需要 --only-create 或 --poll-task", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
