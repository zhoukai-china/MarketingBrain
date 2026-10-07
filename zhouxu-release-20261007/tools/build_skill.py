#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
薄壳技能生成器
==============

从 skill_packs/*.json 配置生成可直接打包上传 SkillHub 的技能目录：

    python3 tools/build_skill.py ip-positioning
    python3 tools/build_skill.py --all

产物：dist/<slug>/{SKILL.md, scripts/run.py, config.json}

规则（踩过的坑）：
- 不打包任何 prompt / 方法论原文，核心逻辑全在服务端，客户端只是薄壳
- 不打包 `_` 开头的安装元数据（_icon.png / _meta.json / _skillhub_meta.json）
- 不打包 __pycache__ / .pyc / 根目录其它 md
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS_DIR = ROOT / "skill_packs"
DIST_DIR = ROOT / "dist"
TEMPLATE_RUN = ROOT / "tools" / "run.py"

KEY_PAGE = "https://api.lcppch.top/skill_key"
API_BASE = "https://api.lcppch.top/os-v2/api"


def load_pack(skill_id: str) -> dict:
    path = PACKS_DIR / f"{skill_id}.json"
    if not path.exists():
        raise SystemExit(f"配置不存在：{path}")
    return json.loads(path.read_text(encoding="utf-8"))


def render_inputs_section(pack: dict) -> str:
    rows = []
    for f in pack.get("inputs", []):
        req = "是" if f.get("required") else "否"
        default = f.get("default", "") or "—"
        rows.append(f"| `{f['key']}` {f.get('label', f['key'])} | {req} | {default} |")
    if not rows:
        return "无必填项，直接调用即可。"
    return (
        "| 字段 | 必填 | 默认 |\n|------|------|------|\n" + "\n".join(rows)
    )


def render_example(pack: dict) -> str:
    parts = []
    for f in pack.get("inputs", []):
        if f.get("required") or f.get("example"):
            val = f.get("example") or f.get("default") or "示例"
            parts.append(f'  --input {f["key"]}="{val}"')
    ins = " \\\n".join(parts) if parts else ""
    sid = pack["skill_id"]
    create = f'python3 scripts/run.py --skill-id {sid}'
    if ins:
        create += " \\\n" + ins
    create += " --only-create"
    return (
        f"```bash\n"
        f"# 1) 创建任务（立即拿 task_id，退出码 0）\n{create}\n\n"
        f"# 2) 循环轮询（单次 ≤90s；退出码 13 = 仍在进行中，立刻再跑一次）\n"
        f"python3 scripts/run.py --skill-id {sid} --poll-task <task_id> --out ./交付.md\n"
        f"```"
    )


def render_transfer_human(pack: dict) -> tuple[str, str]:
    """pack 配置 "transfer_human": true 时，返回执行流程第 0 步与独立章节；否则返回空。"""
    if not pack.get("transfer_human"):
        return "", ""
    step0 = (
        "0. **转人工判断（最高优先级，先于一切）**：每轮用户消息先按下方「转人工判断」检查；"
        "命中则立即停止收集/生成流程，输出 `[TRANSFER_HUMAN]` 信号并推送官方客服企微码，本流程终止。\n\n"
    )
    section = (
        "## 转人工判断（最高优先级）\n\n"
        "在对话任意环节，只要用户表达出「找真人 / 线下服务」的意向，立即停止当前收集或生成流程，"
        "输出转人工信号 `[TRANSFER_HUMAN]`，由产品端推送官方客服企微码（客服备注暗号：「入企」）。\n\n"
        "**显式信号（提到即触发）**：找真人 / 真人咨询师 / 人工客服 / 转人工 / 咨询师上门 / 入企 / 驻场 / "
        "线下咨询 / 见面聊 / 当面聊 / 加微信 / 联系方式 / 找保禄本人。\n\n"
        "**隐性信号（结合上下文判断）**：反复议价砍价、要求定制专属方案、强调企业情况特殊、"
        "询问签约合作流程、索要报价单。\n\n"
        "**规则**：\n\n"
        "- 转人工判断**优先于「只答新媒体相关」的域外守卫**——「你们能派人到我们公司吗」不是新媒体问题，"
        "但它是销售线索，必须接住，不得以域外为由拒绝或瞎答。\n"
        "- 本技能**不输出二维码图片**，只输出 `[TRANSFER_HUMAN]` 信号和一句引导话术；"
        "二维码图由产品端（工作台 / 消息卡片）从后台「客服活码配置」读取渲染，换码、分渠道投码均不改本技能。\n"
        "- 推送后补一句「新媒体的问题可以继续问我」，对话不中断；后续消息重新走第 0 步判断。\n\n"
    )
    return step0, section


def render_skill_md(pack: dict) -> str:
    xfer_step0, xfer_section = render_transfer_human(pack)
    slug = pack["slug"]
    name = pack["name"]
    display = pack.get("displayName") or f"{name}「保禄·出品」"
    version = pack.get("version", "1.0.0")
    points = pack.get("points", 5)
    desc = pack["description"]
    intro = pack.get("intro", "")
    deliverable = pack.get("deliverable", "")

    return f"""---
name: {slug}
description: {desc}
displayName: {display}
metadata:
  slug: {slug}
  version: {version}
  author: 保禄
  requires:
    bins:
      - python3
---

# {name} · 云端版【思潼AI增长OS·出品】

> 版本：{version} · 作者：保禄

{intro}

{deliverable}

本技能为**云端版**：全部生成在思潼AI增长OS 后端完成，技能只负责收集需求、调后端、轮询、渲染结果。用户需先到思潼AI增长OS 配置页申请 API Key（即充值入口），按需扣点。

**计费模式：技能免费安装，使用按次扣点。** 每次成功产出一份交付物，后端结算一次点数（默认 {points} 点/次）；任务失败不扣点、已扣即返还。点数为思潼AI增长OS 账户体系通用点数，可在 `{KEY_PAGE}` 充值。

## 执行流程

按以下顺序执行：

{xfer_step0}1. **取 API Key**：读技能目录下 `config.json` 的 `BAOLU_API_KEY`（回退环境变量）。为空则引导用户到配置页（见「鉴权」）申请并写入，再继续。
2. **收集信息**：与用户确认下列输入项，缺非必填项时用默认值。
3. **扣点确认（必做，跳过不得）**：跑脚本**前**向用户说明「本次任务较复杂，预计扣点约 {points} 点，实际扣点视任务复杂程度而定、以最终完成任务时的实际点数为准」，请用户确认后再继续；用户未确认不要运行脚本。
4. **拆分轮询（关键，防会话中断）**：
   a. **创建**：`python3 scripts/run.py ... --only-create`，立即拿 `GEN_TASK_ID` + `GEN_STATUS`（退出码 0）。**创建调用必须用 `--only-create`，不要把轮询塞进同一次调用。**
   b. **告知用户**：用 task_id 诚实告知，例如「任务已提交，任务 ID xxx，约 1～2 分钟。我会持续跟踪进度，有进展同步给你。」
   c. **循环轮询**：立即跑 `python3 scripts/run.py --skill-id {pack['skill_id']} --poll-task <id> --out ...`（单次 ≤90s）。每次返回后**无论结果如何都先给用户一句话进度**，再决定下一步：
      - **退出码 0**（终态成功）：进入「输出交付」。
      - **退出码 13**（仍进行中，**非失败**）：取 stdout 的 `GEN_STATUS` / `GEN_PROGRESS` / `GEN_ELAPSED` 转述，**立刻再跑一次 `--poll-task <id>`** 继续。
      - **退出码 12**（任务真失败）：按「退出码处理」走失败话术 + 可提示重试。
      - **其它退出码**：按「退出码处理」。
5. **进度应答**：用户中途问进度时，取最近一次 `--poll-task` 返回的状态自然转述；距上次轮询过一会儿可再跑一次现查。
6. **交付报告（成功）**：见「输出交付」——把分隔符之间的 Markdown **真正渲染**给用户，告知实际扣点。
7. **失败处理**：见「退出码处理」。

{xfer_section}## 鉴权

Token 取「技能目录」（SKILL.md 所在目录）下 `config.json` 的 `BAOLU_API_KEY` 字段，回退环境变量 `BAOLU_API_KEY`。请求头 `Authorization: Bearer <api_key>` + `X-Appbuilder-From: sitong`。

**用户首次使用未配置 Key 时**：引导其打开配置页（充值入口）申请 Key：
- 配置页地址：`{KEY_PAGE}`
- 拿到 Key 后写入技能目录 `config.json` 的 `BAOLU_API_KEY` 字段（保留 `BAOLU_API_BASE`）。该文件已被忽略，不会泄露。

## 信息收集

{render_inputs_section(pack)}

## 扣点与确认

- **执行前确认（必做）**：信息收集完成、API Key 就绪后，运行脚本**前**向用户说明并请其确认：「本次任务预计扣点约 {points} 点，实际以最终完成任务时的点数为准。是否继续？」等用户明确确认后再运行。
- **成功后回告实际扣点**：把脚本透出的 `GEN_POINTS_USED` 告诉用户。
- **失败后告知点数返还**：任务已发起但未成功产出（退出码 11/12），告知「因网络原因本次任务执行失败，相应点数已返还」。

## 运行方式

{render_example(pack)}

## 输出交付

成功时 stdout 形如：

```text
GEN_POINTS_USED=<本次实际扣点，可能为空>
GEN_REPORT_FILE=<报告文件绝对路径或空>
GEN_TASK_ID=<任务 id>
=== GEN_REPORT_START ===
<完整 Markdown 交付物>
=== GEN_REPORT_END ===
```

交付时按顺序做三件事：

1. **渲染报告（最重要）**：截取两个分隔符之间的 Markdown 正文，**作为 Markdown 渲染呈现给用户**——展示标题、表格、分节等排版，不展示分隔符行与 `GEN_*` 协议行。
2. **告知实际扣点**：非空说「本次实际扣除 N 点」；空说「约 {points} 点（实际以服务端扣点为准，可在账户查看）」。
3. **告知报告查看方式**：报告已渲染在对话中；同时已保存为 MD 文件（路径见 `GEN_REPORT_FILE`）。

## 退出码处理

| 码 | 含义 | 处理 |
|----|------|------|
| 0 | 成功 | 按「输出交付」处理。 |
| 2 | 缺 API Key | 引导用户到配置页申请 Key，写入 config.json 后重试。任务未发起，不涉扣点。 |
| 3 | 参数非法 | 必填项缺失/超长 → 补全后重试。任务未发起，不涉扣点。 |
| 4 | 余额不足 | 引导用户到配置页充值。任务未发起，不涉扣点。 |
| 8 | 401 key 无效 | 重新获取覆盖 config.json 后重试。任务未发起，不涉扣点。 |
| 10 | 404 任务不存在 | 检查 task_id 与 API Key。 |
| 11 | 5xx / 网络错误 | 告知「因网络原因本次任务执行失败，相应点数已返还」，询问是否稍后重试。 |
| 12 | 已发起但任务未成功 | 告知「点数已返还」；可重试。 |
| 13 | 进行中，未到终态（**非失败**） | 取 stdout 进度转述，立即再跑 `--poll-task` 续轮询。 |

## 免责声明

- 本技能输出为模型基于方法论生成的**参考方案/草稿**，不承诺精确，正式对外使用前建议人工复核合规、数据与品牌调性。
- 不编造经营数据与案例；涉及数字处请替换为真实数据。
- 扣点数据以思潼AI增长OS 账户记录为准。
"""


def build(pack: dict) -> Path:
    slug = pack["slug"]
    out = DIST_DIR / slug
    if out.exists():
        shutil.rmtree(out)
    (out / "scripts").mkdir(parents=True, exist_ok=True)

    (out / "SKILL.md").write_text(render_skill_md(pack), encoding="utf-8")
    shutil.copy(TEMPLATE_RUN, out / "scripts" / "run.py")
    (out / "config.json").write_text(
        json.dumps({"BAOLU_API_KEY": "", "BAOLU_API_BASE": API_BASE},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("skill_id", nargs="?", default="")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    DIST_DIR.mkdir(exist_ok=True)
    ids = []
    if args.all:
        ids = [p.stem for p in sorted(PACKS_DIR.glob("*.json"))]
    elif args.skill_id:
        ids = [args.skill_id]
    else:
        raise SystemExit("需要指定 skill_id 或 --all")

    for sid in ids:
        pack = load_pack(sid)
        out = build(pack)
        print(f"[build] {sid} -> {out}")


if __name__ == "__main__":
    main()
