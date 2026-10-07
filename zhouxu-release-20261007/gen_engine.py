"""
通用薄壳技能引擎（generic skill engine）
=========================================

设计目标：新增一个云端变现技能，只需要在 skill_packs/ 下放一份 JSON 配置，
不需要再写 Python 路由、不需要再改 main.py。

统一任务接口：
  POST /skills/gen/tasks          创建任务（校验余额，返回 task_id）
  GET  /skills/gen/tasks/{id}     轮询进度/结果（终态 success 时结算扣点）

配置驱动的要素：
  - skill_id / 展示名 / 扣点数 / 超时
  - inputs 输入字段（必填、默认值、长度限制）
  - system_prompt / user_prompt（user_prompt 用 {字段名} 占位渲染）
  - validate 结构校验（最小字数、必须出现的关键词、最少表格行数）
  - compliance 合规检测（默认开：平台违规引导词）

计费复用 db.change_balance，失败不扣点。
"""
import json
import os
import re
import threading
import time
import uuid
import urllib.request
from typing import Dict, List, Optional

from config import get_settings
from db import change_balance, SessionLocal

settings = get_settings()

PACKS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill_packs")

_tasks: Dict[str, dict] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# 配置加载
# ---------------------------------------------------------------------------

_packs_cache: Dict[str, dict] = {}
_packs_mtime: float = 0.0


def _load_packs(force: bool = False) -> Dict[str, dict]:
    """从 skill_packs/*.json 加载配置（带 mtime 热更新，改配置不用重启）。"""
    global _packs_cache, _packs_mtime
    try:
        latest = max(
            (os.path.getmtime(os.path.join(PACKS_DIR, f)) for f in os.listdir(PACKS_DIR)
             if f.endswith(".json")),
            default=0.0,
        )
    except FileNotFoundError:
        return _packs_cache
    if not force and latest <= _packs_mtime and _packs_cache:
        return _packs_cache
    packs: Dict[str, dict] = {}
    for fn in sorted(os.listdir(PACKS_DIR)):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(PACKS_DIR, fn)
        try:
            with open(path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"[gen] 配置 {fn} 解析失败：{e}", flush=True)
            continue
        sid = cfg.get("skill_id")
        if not sid:
            print(f"[gen] 配置 {fn} 缺 skill_id，跳过", flush=True)
            continue
        cfg["_file"] = fn
        packs[sid] = cfg
    _packs_cache = packs
    _packs_mtime = latest
    print(f"[gen] 已加载 {len(packs)} 个技能配置", flush=True)
    return packs


def get_pack(skill_id: str) -> Optional[dict]:
    return _load_packs().get(skill_id)


def list_packs() -> List[dict]:
    packs = _load_packs()
    return [
        {
            "skill_id": p.get("skill_id"),
            "name": p.get("name"),
            "points": p.get("points", 5),
            "enabled": p.get("enabled", True),
        }
        for p in packs.values()
    ]


# ---------------------------------------------------------------------------
# 输入校验 & Prompt 渲染
# ---------------------------------------------------------------------------

def normalize_inputs(pack: dict, raw: dict) -> dict:
    """按 pack 的 inputs 定义做校验与默认值填充；非法抛 ValueError。"""
    values: Dict[str, str] = {}
    for field in pack.get("inputs", []):
        key = field["key"]
        label = field.get("label", key)
        default = field.get("default", "")
        maxlen = int(field.get("max", 500))
        val = (raw.get(key) or "").strip() if isinstance(raw.get(key), str) else str(raw.get(key) or "")
        if not val:
            val = str(default or "")
        if field.get("required") and not val:
            raise ValueError(f"缺少必填项：{label}（{key}）")
        if val and len(val) > maxlen:
            raise ValueError(f"{label} 过长（最多 {maxlen} 字）")
        values[key] = val
    # 允许额外传入未在 inputs 声明的字段（不写 prompt，仅留痕）
    return values


def render_user_prompt(pack: dict, values: dict) -> str:
    tpl = pack.get("user_prompt", "")
    vals = dict(values)
    cid = pack.get("calculator")
    if cid:
        from calculators import CALCULATORS, FORMATTERS, format_computed
        fn = CALCULATORS.get(cid)
        if not fn:
            raise ValueError(f"未注册的计算器：{cid}")
        try:
            result = fn(vals)
        except Exception as e:
            raise ValueError(f"计算器执行失败：{e}")
        fmt = FORMATTERS.get(cid, format_computed)
        vals["computed"] = fmt(result)
    try:
        return tpl.format(**vals)
    except KeyError as e:
        raise ValueError(f"配置 user_prompt 引用了未定义字段：{e}")


# ---------------------------------------------------------------------------
# 合规检测（平台违规引导词）
# ---------------------------------------------------------------------------

_BANNED_GUIDE_WORDS = [
    "私信", "私聊", "私我", "私你",
    "加微", "加微信", "加V", "加v", "加好友",
    "电话联系", "联系我", "联系客服", "打给我",
    "找我聊", "来找你", "留言给我", "留个", "留下你的",
    "评论区扣", "评论区打", "扣1", "扣 1", "扣「", "扣'",
    "截图找我", "扫码加",
]

# 行级安全标记：含这些词的行是「合规声明/自查清单」，本身在提醒禁用，不算违规
_SAFE_LINE_MARKERS = ("合规", "自查", "禁用", "红线", "禁止", "严禁",
                      "避免", "不出现", "不引导", "不诱导", "注意")


# 机械兜底替换表（顺序敏感：长词在前，短词在后）
_SANITIZE_MAP = [
    ("私信咨询", "主页咨询"), ("私信沟通", "主页沟通"), ("私信问我", "主页问我"),
    ("私信留言", "主页留言"), ("发私信", "看主页"), ("走私信", "走主页"),
    ("评论区扣", "看主页置顶"), ("评论区打", "看主页置顶"),
    ("电话联系", "主页咨询"), ("联系客服", "看主页简介"),
    ("扫码加", "看主页简介"), ("截图找我", "看主页置顶"),
    ("留言给我", "看主页置顶"), ("留言给", "看主页置顶"),
    ("找我聊", "看主页内容"), ("来找你", "看主页内容"),
    ("联系我", "看主页简介"), ("打给我", "看主页简介"),
    ("留下你的", "自己判断"), ("留个", "自己判断"),
    ("加微信", "看主页简介"), ("加微", "看主页简介"), ("加好友", "看主页"),
    ("加V", "看主页简介"), ("加v", "看主页简介"),
    ("扣1", "看主页置顶"), ("扣 1", "看主页置顶"),
    ("私聊", "主页咨询"), ("私我", "主页咨询"), ("私你", "主页咨询"),
    ("私信", "主页"),
]


def sanitize(md: str, exempt: tuple = ()) -> tuple:
    """合规兜底：把命中违规引导词的行做机械替换，保证交付物零违规。

    返回 (新文本, 替换次数)。只改命中行，合规声明行、自查表格行、
    以及命中 pack 豁免术语的行不动。
    """
    if not md:
        return md, 0
    out_lines = []
    fixed = 0
    for line in md.splitlines():
        s = line.strip()
        if any(m in s for m in _SAFE_LINE_MARKERS):
            out_lines.append(line)
            continue
        if s.startswith("|") and any(
            k in s for k in ("| 无 ", "| 无|", "|无|", "| 未", "| 否", "|未|", "|否|")
        ):
            out_lines.append(line)
            continue
        if _exempt_line(s, exempt):
            out_lines.append(line)
            continue
        new_line = line
        changed = False
        for bad, good in _SANITIZE_MAP:
            if bad in new_line:
                new_line = new_line.replace(bad, good)
                changed = True
        if changed:
            fixed += 1
        out_lines.append(new_line)
    return "\n".join(out_lines), fixed


def _exempt_line(s: str, exempt: tuple) -> bool:
    """专业术语豁免：命中 pack 配置的行业术语时整行跳过（如投放产品「私信留资」）。"""
    return bool(exempt) and any(t in s for t in exempt)


def banned_lines(md: str, exempt: tuple = ()) -> List[str]:
    """返回命中违规词的具体行（供重试 prompt 精准修正）。"""
    lines = []
    if not md:
        return lines
    for line in md.splitlines():
        s = line.strip()
        if any(m in s for m in _SAFE_LINE_MARKERS):
            continue
        if s.startswith("|") and any(
            k in s for k in ("| 无 ", "| 无|", "|无|", "| 未", "| 否", "|未|", "|否|")
        ):
            continue
        if _exempt_line(s, exempt):
            continue
        if any(w in s for w in _BANNED_GUIDE_WORDS):
            lines.append(s[:120])
    return lines[:12]


def has_banned_guide(md: str, exempt: tuple = ()) -> List[str]:
    if not md:
        return []
    hits: List[str] = []
    for line in md.splitlines():
        s = line.strip()
        if any(m in s for m in _SAFE_LINE_MARKERS):
            continue
        if s.startswith("|") and any(
            k in s for k in ("| 无 ", "| 无|", "|无|", "| 未", "| 否", "|未|", "|否|")
        ):
            continue
        if _exempt_line(s, exempt):
            continue
        for w in _BANNED_GUIDE_WORDS:
            if w in s and w not in hits:
                hits.append(w)
    return hits


def pack_exempt(pack: dict) -> tuple:
    return tuple(pack.get("banned_exempt") or ())


COMPLIANCE_RULE = (
    "\n\n# 合规红线（最高优先级，违反即不合格）\n"
    "任何转化引导严禁出现平台违规词，包括但不限于："
    "「私信」「私聊」「私我」「加微」「加微信」「加V」「加好友」「电话联系」「联系我」"
    "「找我聊」「留言给我」「留个」「评论区扣」「评论区打」「扣1」「截图找我」「扫码加」，"
    "以及任何诱导私信、诱导加好友、诱导评论区扣字的表达。\n"
    "转化引导必须改成合规的「内容引导」——只引导用户去看主页 / 置顶视频 / 合集 / 简介链接，"
    "让用户自己来找，不做「触达引导」。\n"
    "注意：改成「看主页 / 置顶 / 合集 / 简介」这类内容引导时，**前提是那个主页内容真实存在**。\n"
    "用户没有提供主页信息时，不要写任何引导句——直接不写，不要自己编造「我放在主页置顶了」。\n"
)

GLOBAL_OUTPUT_RULE = (
    "\n\n# 全局输出禁令（所有技能通用，最高优先级）\n"
    "1. **禁止编造引流话术**：不得出现「完整版/完整清单/模板/资料在某处」「去我主页」「主页置顶」\n"
    "「往期内容」「合集里」「想要的找我」等引导句，更不得编造不存在的视频、文档、链接、二维码、\n"
    "福利活动。用户没提供主页信息，就不写任何引导句。\n"
    "2. **不承诺未发生的事实**：禁止「已上线 / 已验证 / 已服务 X 家 / 已帮助 X 人」等无法核实的表述；\n"
    "禁止给出不存在的案例、数据、客户名。\n"
    "3. **结尾只能是结论、待办动作或风险提示**三选一，不要加「最后一句大实话」式的营销收尾。\n"
    "4. 全文数据只能来自用户输入或服务端计算结果，缺的就是缺的，写成「待补」。\n"
)


# ---------------------------------------------------------------------------
# 大模型调用
# ---------------------------------------------------------------------------

def call_llm(system_prompt: str, user_prompt: str, timeout: int = 120,
             temperature: float = 0.7, max_tokens: int = 6000) -> str:
    base = (settings.DEEPSEEK_BASE_URL or "").rstrip("/")
    key = settings.DEEPSEEK_API_KEY or ""
    model = settings.DEEPSEEK_MODEL or "deepseek-chat"
    if not base or not key:
        raise RuntimeError("未配置 DEEPSEEK（BASE_URL/API_KEY/MODEL）")
    if base.endswith("/chat/completions"):
        url = base
    elif base.endswith("/v1"):
        url = base + "/chat/completions"
    else:
        url = base + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {key}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
    obj = json.loads(raw)
    try:
        content = obj["choices"][0]["message"]["content"]
    except Exception:
        raise RuntimeError(f"模型返回结构异常：{raw[:300]}")
    if not content or not content.strip():
        raise RuntimeError("模型返回空内容（可能是推理模型，请改用非推理模型）")
    return content


# ---------------------------------------------------------------------------
# 结构校验
# ---------------------------------------------------------------------------

def validate_output(pack: dict, md: str) -> Optional[str]:
    v = pack.get("validate") or {}
    min_chars = int(v.get("min_chars", 600))
    if not md or len(md) < min_chars:
        return f"输出过短（{len(md or '')} < {min_chars}）"
    for kw in v.get("must_include", []) or []:
        if kw not in md:
            return f"缺少必需内容：{kw}"
    min_rows = int(v.get("min_table_rows", 0) or 0)
    if min_rows:
        rows = count_table_rows(md)
        if rows < min_rows:
            return f"表格行数不足（{rows} < {min_rows}）"
    return None


def count_table_rows(md: str) -> int:
    """统计 Markdown 表格行数（含表头，排除分隔行 `|---|---|`）。

    踩过的坑：早期只统计首列为数字的行（选题表），导致首列是文字的
    表格（如「时间段 | 阶段 | ...」）被判为 0 行，误报校验失败。
    """
    n = 0
    for line in (md or "").splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        if re.match(r"^\|[\s:\-|]+\|$", s):
            continue
        n += 1
    return n


def generate(pack: dict, values: dict) -> tuple:
    """返回 (markdown, source)。真实生成优先，失败抛异常由调用方处理。"""
    system_p = pack.get("system_prompt", "你是资深顾问，输出结构化中文方案。")
    if pack.get("compliance", True):
        system_p = system_p + COMPLIANCE_RULE
    system_p = system_p + GLOBAL_OUTPUT_RULE
    user_p = render_user_prompt(pack, values)
    timeout = int(pack.get("timeout", 120))
    max_tokens = int(pack.get("max_tokens", 6000))
    temperature = float(pack.get("temperature", 0.7))
    md = call_llm(system_p, user_p, timeout=timeout,
                  temperature=temperature, max_tokens=max_tokens)

    if pack.get("compliance", True):
        exempt = pack_exempt(pack)
        for attempt in range(1, 3):
            banned = has_banned_guide(md, exempt)
            if not banned:
                break
            print(f"[gen:{pack.get('skill_id')}] 第 {attempt} 次检出违规词 {banned}", flush=True)
            blines = banned_lines(md, exempt)
            retry_user = (
                user_p
                + "\n\n【合规警告·必须修正】你上一次的输出包含平台违规引导词："
                + "、".join(banned)
                + "。这些词会导致内容被限流。\n"
                "以下是命中违规词的具体行，逐行改写它们：\n"
                + "\n".join(f"- {l}" for l in blines)
                + "\n\n改写规则（适用于全文任何位置，包括决策旅程、投流建议、内容矩阵说明）：\n"
                "- 「私信咨询」→「主页咨询」；「私信我」→「看我主页」；凡是「私信」一律换成「主页」\n"
                "- 「加微信/加微/加V」→「看主页简介」；「评论区扣字/扣1」→「看主页置顶」\n"
                "- 「联系我/找我聊/留言给我/留个」→「看主页简介」/「看主页内容」\n"
                "- 投流目标中的「私信咨询」→「主页咨询」；转化路径一律写「看主页→看置顶→看合集」\n"
                "重新完整输出一遍（保持同样的格式与章节结构），确保全文不再出现上述任何一个词。"
            )
            try:
                md2 = call_llm(system_p, retry_user, timeout=timeout,
                               temperature=0.5, max_tokens=max_tokens)
            except Exception as e:
                print(f"[gen] 合规重试失败：{e}", flush=True)
                break
            if md2 and not validate_output(pack, md2) and not has_banned_guide(md2, exempt):
                print("[gen] 合规重试通过，采用重试结果", flush=True)
                md = md2
                break
            if md2 and not validate_output(pack, md2):
                md = md2
            print("[gen] 合规重试仍未通过", flush=True)

        # 硬性兜底：模型仍不改就机械替换，保证交付物零违规
        if has_banned_guide(md, exempt):
            md, fixed = sanitize(md, exempt)
            print(f"[gen] 触发兜底替换，改写 {fixed} 行", flush=True)
    err = validate_output(pack, md)
    if err:
        _dump_failed(pack.get("skill_id", "unknown"), md, err)
        raise RuntimeError(f"结构校验不通过：{err}")
    return md, "real"


def _dump_failed(skill_id: str, md: str, err: str) -> None:
    """校验失败时把原始输出落盘，便于排查（不返回给客户端）。"""
    try:
        path = f"/tmp/gen_fail_{skill_id}_{int(time.time())}.md"
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"<!-- 校验失败原因：{err} -->\n\n")
            f.write(md or "")
        print(f"[gen] 失败输出已落盘：{path}（{len(md or '')} 字）", flush=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 任务调度
# ---------------------------------------------------------------------------

def _run_generation(task_id: str) -> None:
    db = SessionLocal()
    try:
        with _lock:
            task = _tasks.get(task_id)
            if not task:
                return
            api_key = task["api_key"]
            pack = task["pack"]
            values = task["values"]
            cost = int(pack.get("points", 5))
        rec = change_balance(db, api_key, -cost, "消费",
                             note=f"{pack.get('name', pack.get('skill_id'))}")
        if not rec:
            with _lock:
                t = _tasks.get(task_id)
                if t:
                    t["status"] = "failed"
                    t["failure_code"] = "INSUFFICIENT_BALANCE"
                    t["message"] = "余额在生成前已不足，本次未扣点"
            return
        md, source = generate(pack, values)
        with _lock:
            t = _tasks.get(task_id)
            if t:
                t["status"] = "success"
                t["progress"] = 100
                t["data"] = {"markdown": md, "gen_source": source}
                t["billing"] = {"total_points": cost, "gen_source": source}
        print(f"[gen] 任务 {task_id}（{pack.get('skill_id')}）完成，来源={source}", flush=True)
    except Exception as e:
        print(f"[gen] 任务 {task_id} 生成失败：{e}", flush=True)
        with _lock:
            t = _tasks.get(task_id)
            if t:
                t["status"] = "failed"
                t["failure_code"] = "GEN_ERROR"
                t["message"] = str(e)[:200]
        # 失败返还点数
        try:
            change_balance(db, api_key, cost, "返还", note="任务失败返还")
        except Exception:
            pass
    finally:
        db.close()


def create_task(api_key: str, pack: dict, values: dict) -> str:
    task_id = "g_" + uuid.uuid4().hex[:16]
    with _lock:
        _tasks[task_id] = {
            "api_key": api_key,
            "pack": pack,
            "values": values,
            "status": "running",
            "progress": 0,
            "created_at": time.time(),
            "timeout": int(pack.get("timeout", 120)),
        }
    threading.Thread(target=_run_generation, args=(task_id,), daemon=True).start()
    return task_id


def get_task(task_id: str) -> Optional[dict]:
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            return None
        status = task["status"]
        if status == "success":
            return {
                "task_id": task_id, "status": "success", "progress": 100,
                "data": task["data"], "billing": task["billing"],
            }
        if status == "failed":
            return {
                "task_id": task_id, "status": "failed",
                "failure_code": task.get("failure_code", "TASK_FAILED"),
                "message": task.get("message", "任务执行失败"),
            }
        elapsed = time.time() - task["created_at"]
        timeout = float(task.get("timeout", 120) or 120)
        return {
            "task_id": task_id, "status": "running",
            "progress": min(90, int(elapsed / timeout * 90)),
        }
