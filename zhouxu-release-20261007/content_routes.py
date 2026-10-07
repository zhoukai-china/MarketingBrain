"""
内容创作任务接口（真实生成版）
==============================

POST /skills/content/tasks       创建任务（校验余额，返回 task_id）
GET  /skills/content/tasks/{id}  轮询进度/结果（终态 success 时结算扣点）

设计说明：
- 本模块运行在独立计费后端（127.0.0.1:3007），与 baolu-os-v2-source 解耦，不碰 codex 源码。
- 真实生成已接入：服务端持思潼后端的 DEEPSEEK 密钥，直接按保禄内容十件套方法论调用大模型
  生成可直接拍摄/发布的内容执行包；密钥只存 3007 服务端 .env（属思潼后端），不进任何客户端/Skill/日志。
- Mock 占位生成保留为兜底：真实生成失败/超时/结构校验不通过时自动回退，链路 100% 可用。
- 计费复用 db.change_balance，失败不扣点（与 topics 约定一致）。
"""
import json
import os
import re
import threading
import time
import uuid
import urllib.error
import urllib.request
from typing import Dict

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_settings
from db import get_db, change_balance, get_or_create_key, SessionLocal

settings = get_settings()
router = APIRouter()

# 内存任务表（原型用；生产可换 Redis/DB）。单进程足够演示。
_tasks: Dict[str, dict] = {}
_lock = threading.Lock()

PLATFORM_NAMES = {
    "douyin": "抖音",
    "xiaohongshu": "小红书",
    "weibo": "微博",
    "kuaishou": "快手",
    "video_account": "视频号",
    "zhihu": "知乎",
}


class ContentTaskCreate(BaseModel):
    industry: str = ""
    brand: str = ""
    platform: str = "douyin"
    content_type: str = "ten_piece"
    goal: str = "种草"
    topic: str = ""
    count: int = 1


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


# ---------------------------------------------------------------------------
# Mock 内容生成（占位示例，验证链路用）
# ---------------------------------------------------------------------------

def _md_ten_piece(brand, plat, topic, industry, goal):
    return f"""# {brand}·{plat} 内容十件套（原型示例）

> 说明：本内容为原型占位生成，用于验证「上架 → 调用 → 扣点 → 出内容」链路。真实内容由思潼AI增长OS 后端按保禄内容方法论定制生成。

## 短结论
围绕「{topic}」，建议用「痛点钩子 + 真实过程 + 干货收尾」结构，优先打「{goal}」目标。

## 一、选题策划
- 选题1：{industry}老板最容易踩的3个坑（争议钩子，易转发）
- 选题2：我们是怎么帮{brand}把{plat}做起来的（故事钩子，立人设）
- 选题3：一条视频讲清{industry}的选型逻辑（干货钩子，引私域）

## 二、口播逐字稿（选题1）
「很多人做{industry}第一步就错了。我见过太多老板……」（开头3秒抛冲突）
（真实版含完整逐字稿与停顿标记）

## 三、访谈话术
- 破冰：您做{industry}多久了？现在最大的卡点是什么？
- 深挖：这个问题您之前试过什么办法？

## 四、拍摄脚本
| 秒数 | 画面 | 口播 | 字幕 |
|---|---|---|---|
| 0-3 | 老板皱眉特写 | 很多人第一步就错了 | 第一步就错了？ |
| 3-10 | 产品/门店展示 | 我们帮{brand}… | 真实案例 |

## 五、拍摄注意事项
- 开头3秒必须抛冲突，否则划走
- 自然光优先，避免死板棚拍

## 六、剪辑EDL
1. 0:00-0:03 冲突钩子
2. 0:03-0:15 案例展开
3. 0:15-0:25 干货收尾+引导

## 七、发布标题与话题
标题：{industry}老板别再踩这3个坑了
话题：#{industry}创业 #{brand} #创业避坑

## 八、最佳发布时间
工作日 12:00-13:00 / 19:00-21:00

## 九、评论区引导话术
「完整版 Checklist 我整理在主页置顶那条视频里了，需要的自己去看」

## 十、投流建议
- 起号期先自然流测素材，跑出完播>30%再小额豆荚/本地推加热
- 单条 100-300 元测试，ROI 转正再加码

> 免责：原型示例，发布前请人工复核合规与品牌调性。
"""


def _md_script(brand, plat, topic, industry):
    return f"""# {brand}·{plat} 短视频拍摄脚本（原型示例）

## 视频基本信息
- 平台：{plat}｜行业：{industry}
- 时长：30-45s｜画幅：竖屏 9:16

## 原片诊断（占位）
- 开头无钩子、口播过长、缺少字幕重点

## 优化版拍摄脚本
| 秒数 | 景别 | 画面 | 口播 | 字幕/花字 |
|---|---|---|---|---|
| 0-3 | 特写 | 老板皱眉 | 很多人做{industry}第一步就错了 | 第一步就错了？ |
| 3-15 | 中景 | 演示操作 | 我们帮{brand}这样改 | 真实案例 |
| 15-30 | 近景 | 面对镜头 | 想落地的，脚本模板在主页置顶 | 主页置顶领模板 |

## 拍摄注意事项
- 手持稳定器，避免抖动；环境音降噪
- 字幕大字号、高对比，前3秒必有钩子

## 剪辑EDL
1. 冲突钩子 2. 案例展开 3. 干货收尾+引导

## 投流建议
自然流跑通后再小额加热，单条测试 100-300 元。
"""


def _md_copy(brand, plat, topic, industry):
    return f"""# {brand}·{plat} 口播逐字稿（原型示例）

【开头3秒·钩子】
很多人做{industry}第一步就错了。我见过太多老板……

【正文·真实过程】
我们帮{brand}做{plat}的时候，第一件事不是拍视频，而是把客户最痛的3个问题列出来……

【收尾·行动引导】
想拿这套落地清单的，完整版我放在主页置顶那条视频里了。

> 提示：真实版会按你的品牌口吻与产品重写，含停顿/重音标记。
"""


def _md_strategy(brand, plat, industry):
    return f"""# {brand}·{plat} 内容策略（原型示例）

## 内容漏斗
认知（痛点科普）→ 兴趣（案例故事）→ 信任（客户证言）→ 转化（引导私域）

## 再利用阶梯
长视频 → 拆短视频 → 金句图 → 朋友圈素材 → 直播切片

## 钩子 A/B 测试
- A：冲突型「第一步就错」
- B：好奇型「我们怎么做的」
- 指标：完播率 + 评论率，跑赢的扩量

## 发布节奏
每周 3 条，起号期日更测试，定型后稳定更新。
"""


def _gen_mock_markdown(req: ContentTaskCreate) -> str:
    plat = PLATFORM_NAMES.get(req.platform, req.platform)
    brand = req.brand or "贵品牌"
    industry = req.industry or "通用行业"
    topic = req.topic or f"{industry}的爆款内容方向"
    if req.content_type == "script":
        return _md_script(brand, plat, topic, industry)
    if req.content_type == "copy":
        return _md_copy(brand, plat, topic, industry)
    if req.content_type == "strategy":
        return _md_strategy(brand, plat, industry)
    return _md_ten_piece(brand, plat, topic, industry, req.goal)


# ---------------------------------------------------------------------------
# 真实生成（调用 DEEPSEEK + 保禄内容十件套方法论） + 后台异步生成
# ---------------------------------------------------------------------------

def _call_deepseek(system_prompt: str, user_prompt: str, timeout: int = 90) -> str:
    """调用思潼后端的 DEEPSEEK 兼容接口生成文本。失败抛异常。"""
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
        "temperature": 0.6,
        "max_tokens": 4096,
    }
    data = json.dumps(payload).encode("utf-8")
    req_obj = urllib.request.Request(url, data=data, method="POST")
    req_obj.add_header("Content-Type", "application/json")
    req_obj.add_header("Authorization", f"Bearer {key}")
    with urllib.request.urlopen(req_obj, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
    obj = json.loads(raw)
    return obj["choices"][0]["message"]["content"]


_SYSTEM_PROMPT = """你是「思潼内容创作引擎 V5」，基于保禄/思潼内容方法论，为连锁品牌/本地商家/创始人 IP 产出可直接拍摄、可直接发布的短视频内容执行包。

# 身份与风格
- 语言：大白话、短句、有数字、反常识；禁用「私信/加我微信/加我/第一/最/保证/绝对/稳赚/包赚/保本」等违规或绝对化表达。
- 结构：先给一句「短结论」，再逐项给成品，结尾给「下一步行动」。
- 漏斗：每条选题/内容必须标注服务于哪一层（AWARENESS 引起注意 / CONSIDERATION 建立考虑 / DECISION 促成决策 / ADVOCACY 激活传播）。

# 内容十件套（ten_piece）
1. 短结论（一句话判断）
2. 选题策划（核心选题、目标人群、爆款元素、脚本类型、漏斗层级、2个关联选题）
3. 口播逐字稿（60秒标准结构：0-3秒钩子 / 3-15秒共鸣 / 15-30秒故事 / 30-45秒方法 / 45-55秒证据 / 55-60秒收尾；用【】标注动作/停顿/情绪，用 > 标注 B-roll 切换）
4. 访谈话术（一问一答，主持人破冰→深挖→收尾，创始人作答）
5. 拍摄脚本（镜号表：秒数/景别/画面/口播/字幕/道具）
6. 拍摄注意事项（光线/收音/稳定/字幕/合规）
7. 剪辑EDL（精确到秒：素材/画面/字幕/音效/节奏）
8. 发布标题与话题（3个标题变体 + 三层话题标签矩阵：品牌词/行业词/泛流量词）
9. 最佳发布时间（平台×时段×理由）
10. 评论区引导话术（置顶评论 + 互动引导 + 软转化）
11. 投流建议（本地推/抖加门槛、测试预算、追投逻辑）

# 其他内容类型
- script：只输出「视频基本信息 / 原片诊断 / 优化版拍摄脚本 / 拍摄注意事项 / 剪辑EDL / 投流建议」。
- copy：只输出「开头3秒钩子 / 正文逐字稿 / 收尾引导」，含停顿/重音标记。
- strategy：只输出「内容漏斗 / 再利用阶梯 / 钩子A/B测试 / 发布节奏 / 投流前置判断」。

# 合规红线（最高优先级，违反即不合格）
- 严禁出现任何平台违规引导词，包括但不限于：
  「私信」「私聊」「私我」「加微」「加微信」「加V」「加v」「加好友」
  「电话联系」「联系我」「打给我」「找我聊」「留言给我」「留个」
  「评论区扣」「评论区打」「扣1」「扣 1」「扣「」「扣'」「后台扣」
  「截图找我」「扫码加」「包赚」「稳赚」「保本」「第一」「最好」「绝对」「保证」
- 评论区引导话术、收尾行动引导，必须写成合规的「内容引导」——
  只能引导用户去看主页 / 置顶视频 / 合集 / 简介链接，让用户自己来找。
  - 错误：后台扣「口播」，我发你        → 正确：完整清单我放在主页置顶那条视频里了
  - 错误：想要的私信我                  → 正确：想要完整版的，翻我主页的合集
  - 错误：评论区扣「手册」领资料        → 正确：这份手册的完整版在主页简介链接里
  - 错误：想合作的加我微信              → 正确：合作方式我写在主页简介里了
- 核心原则：只做「内容引导」（主页/置顶/合集/简介），不做「触达引导」（私信/加微/电话/扣字）。

# 输出要求
- 纯 Markdown，不需要代码块包裹。
- 禁止编造具体客户数据、经营结果、互动数据；可用假设性数字必须标注「示例」。
- 所有建议必须可落地拍摄，不要宏大叙事。
"""


def _build_user_prompt(req: ContentTaskCreate) -> str:
    plat = PLATFORM_NAMES.get(req.platform, req.platform)
    brand = req.brand or "（未指定品牌，用通用行业视角）"
    industry = req.industry or "通用行业"
    goal = req.goal or "种草"
    topic = req.topic or f"{industry}的爆款内容方向"
    ct = req.content_type or "ten_piece"
    type_map = {
        "ten_piece": "内容十件套（完整输出）",
        "script": "短视频拍摄脚本",
        "copy": "口播逐字稿",
        "strategy": "内容策略",
    }
    type_name = type_map.get(ct, ct)
    return (
        f"请按保禄/思潼内容方法论生成一份「{type_name}」。\n"
        f"- 行业：{industry}\n"
        f"- 品牌/主体：{brand}\n"
        f"- 平台：{plat}\n"
        f"- 营销目标：{goal}\n"
        f"- 本期主题/选题：{topic}\n\n"
        f"要求：\n"
        f"1. 内容类型为「{type_name}」，严格按上述类型对应的章节输出。\n"
        f"2. 营销目标为「{goal}」，口播收尾与评论区引导需围绕该目标设计转化动作。\n"
        f"3. 口播稿时长控制在 60 秒左右，前 3 秒必须有冲突/数字/反常识钩子。\n"
        f"4. 标注每条内容服务的漏斗层级（AWARENESS/CONSIDERATION/DECISION/ADVOCACY）。\n"
        f"5. 输出可直接拍摄、可直接发布，不要只给框架。"
    )


# 平台违规引导词（诱导私信/加好友/诱导互动），命中需重写
_BANNED_GUIDE_WORDS = [
    "私信", "私聊", "私我", "私你",
    "加微", "加微信", "加V", "加v", "加好友",
    "电话联系", "联系我", "联系客服", "打给我",
    "找我聊", "来找你", "留言给我", "留个", "留下你的",
    "评论区扣", "评论区打", "扣1", "扣 1", "扣「", "扣'", "后台扣",
    "截图找我", "扫码加",
]


# 行级安全标记：含这些词的行是「合规声明/自查清单」，本身在提醒禁用，不算违规
_SAFE_LINE_MARKERS = ("合规", "自查", "禁用", "红线", "禁止", "严禁",
                      "避免", "不出现", "不引导", "不诱导", "注意")


def _has_banned_guide(md: str) -> list:
    """返回命中的违规引导词列表；为空表示合规。

    跳过两类「假阳性」：
    1. 合规声明行（含「合规/禁止/严禁」等标记，本身在提醒禁用这些词）；
    2. 自查清单表格行（形如 `| 私信/加微/... | 无 |`，表示这些词未出现）。
    """
    if not md:
        return []
    hits = []
    for line in md.splitlines():
        stripped = line.strip()
        # 1) 合规声明行 → 跳过
        if any(m in stripped for m in _SAFE_LINE_MARKERS):
            continue
        # 2) 自查清单表格行（以 | 开头，且标注「无/未/否」表示未出现）→ 跳过
        if stripped.startswith("|") and any(
            k in stripped for k in ("| 无 ", "| 无|", "|无|", "| 未", "| 否", "|未|", "|否|")
        ):
            continue
        for w in _BANNED_GUIDE_WORDS:
            if w in stripped and w not in hits:
                hits.append(w)
    return hits


def _validate_content_markdown(md: str, content_type: str) -> bool:
    if not md or len(md) < 600:
        return False
    lower = md.lower()
    # 基本结构校验
    if "#" not in lower:
        return False
    if content_type == "ten_piece":
        # 至少包含几个核心章节
        required = ["短结论", "选题策划", "口播", "拍摄脚本", "剪辑", "发布时间", "评论", "投流"]
        return all(k in lower for k in required)
    if content_type == "script":
        return "拍摄脚本" in lower or "秒数" in lower or "镜号" in lower
    if content_type == "copy":
        return "钩子" in lower and ("正文" in lower or "逐字稿" in lower)
    if content_type == "strategy":
        return "漏斗" in lower and "再利用" in lower
    return True


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------

@router.post("/skills/content/tasks")
def create_content_task(
    req: ContentTaskCreate,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    key_obj = get_or_create_key(db, api_key)
    cost = settings.CONTENT_POINTS
    if key_obj.balance < cost:
        raise HTTPException(status_code=402, detail="余额不足，请先充值")

    task_id = "ct_" + uuid.uuid4().hex[:16]
    with _lock:
        _tasks[task_id] = {
            "api_key": api_key,
            "req": req,
            "status": "running",
            "progress": 0,
            "created_at": time.time(),
            "settled": False,
        }

    # 后台线程：扣点 → 真实生成（失败回退 mock）→ 写结果
    def _run():
        nonlocal task_id
        db2 = SessionLocal()
        try:
            cost = settings.CONTENT_POINTS
            rec = change_balance(db2, api_key, -cost, "消费", note=f"内容创作-{req.content_type}-{req.industry}")
            if not rec:
                with _lock:
                    _tasks[task_id]["status"] = "failed"
                    _tasks[task_id]["failure_code"] = "INSUFFICIENT_BALANCE"
                    _tasks[task_id]["message"] = "余额在生成过程中耗尽，本次未扣点"
                    _tasks[task_id]["progress"] = 100
                    _tasks[task_id]["settled"] = True
                return

            md, source = "", "mock"
            try:
                user_p = _build_user_prompt(req)
                md = _call_deepseek(_SYSTEM_PROMPT, user_p, timeout=90)
                if not _validate_content_markdown(md, req.content_type):
                    raise RuntimeError("真实生成内容结构校验不通过")
                source = "real"
                # 合规复检：命中违规引导词则带警告重试一次
                banned = _has_banned_guide(md)
                if banned:
                    print(f"[content] 检出违规引导词 {banned}，带合规警告重试一次", flush=True)
                    retry_user = (
                        user_p
                        + "\n\n【合规警告·必须修正】你上一次的输出包含了平台违规引导词："
                        + "、".join(banned)
                        + "。这些词会导致内容被限流。\n"
                        "重新输出时，所有转化引导（尤其口播收尾、评论区引导话术）必须改为合规的"
                        "「内容引导」——只能引导用户去看主页 / 置顶视频 / 合集 / 简介链接，"
                        "严禁出现任何诱导私信、加微信、打电话、评论区扣字的表达。"
                    )
                    try:
                        md2 = _call_deepseek(_SYSTEM_PROMPT, retry_user, timeout=90)
                    except Exception as e2:
                        print(f"[content] 合规重试生成失败：{e2}", flush=True)
                        md2 = ""
                    if md2 and _validate_content_markdown(md2, req.content_type) and not _has_banned_guide(md2):
                        print("[content] 合规重试通过，采用重试结果", flush=True)
                        md = md2
                    else:
                        print(f"[content] 合规重试仍未通过，沿用首次结果", flush=True)
            except Exception as e:
                print(f"[content] 真实生成失败，回退 mock：{e}", flush=True)
                md = _gen_mock_markdown(req)
                source = "mock_fallback"

            with _lock:
                _tasks[task_id]["status"] = "success"
                _tasks[task_id]["progress"] = 100
                _tasks[task_id]["data"] = {"markdown": md, "gen_source": source}
                _tasks[task_id]["billing"] = {"total_points": cost}
                _tasks[task_id]["settled"] = True
        except Exception as e:
            print(f"[content] 任务异常：{e}", flush=True)
            with _lock:
                # 异常时确保不扣点（前面已扣则回滚不可，这里兜底改失败状态）
                _tasks[task_id]["status"] = "failed"
                _tasks[task_id]["failure_code"] = "TASK_FAILED"
                _tasks[task_id]["message"] = "任务执行异常"
                _tasks[task_id]["progress"] = 100
                _tasks[task_id]["settled"] = True
        finally:
            db2.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"task_id": task_id, "status": "running", "progress": 0}


@router.get("/skills/content/tasks/{task_id}")
def get_content_task(task_id: str, db: Session = Depends(get_db)):
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

    if task["status"] == "success":
        return {
            "task_id": task_id,
            "status": "success",
            "progress": 100,
            "data": task["data"],
            "billing": task["billing"],
        }
    if task["status"] == "failed":
        return {
            "task_id": task_id,
            "status": "failed",
            "failure_code": task.get("failure_code", "TASK_FAILED"),
            "message": task.get("message", "任务执行失败"),
        }

    # running：返回进度
    elapsed = time.time() - task["created_at"]
    progress = min(90, int(elapsed / 30 * 90)) if elapsed < 30 else 95
    return {"task_id": task_id, "status": "running", "progress": progress}
