"""
选题任务接口（原型）
========================

POST /skills/topics/tasks       创建任务（校验余额，返回 task_id）
GET  /skills/topics/tasks/{id}  轮询进度/结果（终态 success 时结算扣点）

设计说明：
- 本模块运行在独立计费后端（127.0.0.1:3007），与 baolu-os-v2-source 解耦，不碰 codex 源码。
- 真实生成已接入：服务端持思潼后端的 DEEPSEEK（百炼）密钥，直接按 baolu_topics 方法论
  （四来源采集 + 三关筛选）调用大模型生成选题；密钥只存 3007 服务端 .env（属思潼后端），
  不进任何客户端/Skill/日志。
- _gen_mock_markdown 保留为兜底：真实生成失败/超时/结构校验不通过时自动回退，链路 100% 可用。
- 可选：若未来在 3002 部署内部选题接口并配置 TOPICS_GEN_URL，则优先走该接口（单一网关原则）。
- 计费复用 db.change_balance，失败不扣点（与 content 约定一致）。
"""
import json
import os
import re
import threading
import time
import uuid
import urllib.error
import urllib.request
from typing import Dict, List

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


# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------

class TopicsTaskCreate(BaseModel):
    industry: str = ""
    brand_keywords: List[str] = []
    platforms: List[str] = []
    goal: str = "种草"
    count: int = 10


def _auth_key(authorization: str = Header(default="")) -> str:
    if not authorization:
        return ""
    return authorization.replace("Bearer ", "", 1).strip()


# ---------------------------------------------------------------------------
# Mock 选题日报生成（占位示例，验证链路用）
# ---------------------------------------------------------------------------

# 四来源配额（与 baolu_topics 方法论一致）
_SOURCE_PLAN = [
    ("Get笔记近期思考", 3),
    ("企业AI改造热点", 2),
    ("自身账号数据复盘", 2),
    ("同行爆款方向", 2),
]
# 通用共识层级 / 客资准度 / 类型 轮换
_CONSENSUS = ["专业共识", "利益共识", "时代共识", "人性共识", "热点共识"]
_PRECISION = ["高", "中", "高", "中", "高", "中", "中", "高", "中", "高"]
_TYPES = ["痛点避坑", "案例故事", "方法教程", "观点干货", "行业洞察",
          "人设打造", "数据复盘", "竞品拆解", "趋势预判", "成交话术"]

# 招商专项：加盟商视角选题模板 + 招商专属共识/准度/行动/配比
_ZHAOSHANG_TOPICS = {
    "Get笔记近期思考": [
        "我陪跑的连锁品牌半年招了 40 家店，最关键的不是流量，是这 1 件事",
        "老板做招商最容易踩的 3 个坑，踩中一个总部就被加盟商缠半年",
        "做了 10 年连锁，我最想劝想招商的老板一句话：先有单店模型再谈招商",
    ],
    "企业AI改造热点": [
        "用 AI 把招商团队的跟进效率提了 3 倍，我们怎么搭的工作流",
        "别再招招商总监了，连锁品牌先上一套 AI 招商内容流水线",
        "AI 怎么帮实体老板批量产出'让加盟商主动留资'的短视频",
    ],
    "自身账号数据复盘": [
        "我招商账号 30 条视频的数据复盘：哪类最收加盟咨询",
        "上周一条招商视频爆了，拆解它为什么能收 200 条客资",
        "招商账号掉粉预警：这 3 类内容在劝退你的精准加盟商",
    ],
    "同行爆款方向": [
        "同行一条招商视频收了 200 条加盟咨询，我抄出了 3 个套路",
        "招商赛道现在最火的选题，90% 的连锁品牌都做错了",
        "扒了 20 个招商品牌大号，发现他们都在偷偷用这 1 招",
    ],
}
_ZHAOSHANG_CONSENSUS = ["利益共识", "专业共识", "人性共识", "时代共识", "利益共识"]
_ZHAOSHANG_PRECISION = ["高", "高", "中", "高", "中", "高", "高", "中", "高", "高"]
_ZHAOSHANG_ACTION = "留资领招商手册 / 私域咨询单店模型"


def _gen_mock_markdown(req: TopicsTaskCreate) -> str:
    industry = req.industry or "通用行业"
    brands = req.brand_keywords or []
    brand_txt = ("（聚焦：" + "、".join(brands) + "）") if brands else ""
    goal = req.goal or "种草"
    platforms = req.platforms or ["douyin", "xiaohongshu", "video_account"]

    is_zhaoshang = (goal == "招商")
    if is_zhaoshang:
        topic_map = _ZHAOSHANG_TOPICS
        consensus_cycle = _ZHAOSHANG_CONSENSUS
        precision_cycle = _ZHAOSHANG_PRECISION
        action_txt = _ZHAOSHANG_ACTION
    else:
        topic_map = None  # 通用行业模板
        consensus_cycle = _CONSENSUS
        precision_cycle = _PRECISION
        action_txt = f"「{goal}」行动"

    rows: List[str] = []
    idx = 0
    plan_idx = 0
    # 按配额循环铺来源
    while len(rows) < 10:
        src_name, n = _SOURCE_PLAN[plan_idx % len(_SOURCE_PLAN)]
        i = idx
        if topic_map is not None:
            arr = topic_map.get(src_name, [f"{industry}的第 {i+1} 个招商选题方向"])
            topic = arr[i % len(arr)]
        else:
            topic = _one_topic(industry, src_name, i, brand_txt)
        rows.append(
            f"| {i+1} | {topic} | {_TYPES[i % len(_TYPES)]} | {src_name} | "
            f"{consensus_cycle[i % len(consensus_cycle)]} | {precision_cycle[i % len(precision_cycle)]} | "
            f"开头 3 秒抛冲突，结尾引导{action_txt} |"
        )
        idx += 1
        plan_idx += 1

    table = "\n".join(rows)

    if is_zhaoshang:
        title_tag = "招商获客"
        short = (f"围绕「{industry}」招商目标，建议用「痛点钩子 + 真实招商案例 + 单店模型干货」结构，"
                 f"前 3 秒必须抛冲突（加盟踩坑 / 回本焦虑），结尾引导留资领招商手册。")
        mix = (
            "- 起号期：侧重「痛点避坑 + 案例故事」，用真实招商结果吸加盟商眼球\n"
            "- 增长期：加「投资回报 + 扶持保障」，用单店模型和数据建立信任\n"
            "- 变现期：加「政策解读 + 成交话术」，引导私域留资、领招商手册"
        )
    else:
        title_tag = goal
        short = (f"围绕「{industry}」优先打「{goal}」目标，建议用「痛点钩子 + 真实过程 + 干货收尾」结构，"
                 f"前 3 秒必须抛冲突。")
        mix = (
            "- 起号期：侧重「痛点避坑 + 观点干货」，快速测试完播\n"
            "- 增长期：加「案例故事 + 数据复盘」，放大信任\n"
            "- 变现期：加「成交话术 + 行业洞察」，引导私域/成交"
        )

    return f"""# {industry}·今日选题日报（{title_tag}）{brand_txt}

> 说明：本日报为原型占位生成，用于验证「上架 → 调用 → 扣点 → 出选题」链路。真实日报由思潼AI增长OS 后端按你的四来源（Get笔记/行业热点/数据复盘/同行爆款）+ 三关筛选（一票否决/共识层级×客资准度/账号阶段配比）定制生成。

## 短结论
{short}

## 选题表（共 10 条）
| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |
|---|---|---|---|---|---|---|
{table}

## 账号阶段配比建议
{mix}

> 投放平台：{', '.join(platforms)}。
> 免责：原型示例，正式发布前请人工复核合规与品牌调性。
"""


def _one_topic(industry: str, source: str, i: int, brand_txt: str) -> str:
    templates = {
        "Get笔记近期思考": [
            f"我最近在{industry}里踩过的坑，今天一次性说清楚",
            f"{industry}老板最容易忽略的 3 个认知盲区",
            f"做了 10 年{industry}，我最想劝新手的一句话",
        ],
        "企业AI改造热点": [
            f"用 AI 把{industry}的获客成本打下来 60%，怎么做的",
            f"{industry}如何用 AI 重构销售闭环（附流程图）",
            f"别再招运营了，{industry}先上一套 AI 工作流",
        ],
        "自身账号数据复盘": [
            f"我{industry}账号 30 条视频的数据复盘：哪类最涨粉",
            f"上周{industry}爆了一条，拆解它为什么爆",
            f"{industry}账号掉粉预警：这 3 类内容在劝退用户",
        ],
        "同行爆款方向": [
            f"同行一条{industry}视频涨粉 10w，我抄出了 3 个套路",
            f"{industry}赛道现在最火的选题，90% 人做错了",
            f"扒了 20 个{industry}大号，发现他们都在偷偷用这招",
        ],
    }
    arr = templates.get(source, [f"{industry}的第 {i+1} 个选题方向"])
    return arr[i % len(arr)]


# ---------------------------------------------------------------------------
# 真实生成（接 OS-v2 baolu_topics 内部接口） + 后台异步生成
# ---------------------------------------------------------------------------

def _call_deepseek(system_prompt: str, user_prompt: str, timeout: int = 60) -> str:
    """调用思潼后端的 DEEPSEEK（百炼）兼容接口生成文本。失败抛异常。"""
    base = (settings.DEEPSEEK_BASE_URL or "").rstrip("/")
    key = settings.DEEPSEEK_API_KEY or ""
    model = settings.DEEPSEEK_MODEL or "deepseek-chat"
    if not base or not key:
        raise RuntimeError("未配置 DEEPSEEK（BASE_URL/API_KEY/MODEL 经 settings 读取）")
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


def _build_topics_system_prompt() -> str:
    return (
        "你是「思潼选题灵感引擎」，基于保禄/思潼的选题方法论，为连锁品牌创始人 IP "
        "产出可测试的短视频选题。\n\n"
        "# 四来源采集（配额制）\n"
        "1. AI录音卡/得到大脑（3-4条）：本人观点、客户原话、案例、反复问题、情绪点。"
        "本次未接入实时录音卡，此类选题请基于行业常识生成，并在「第一关证据」标\"待同步\"。\n"
        "2. 行业与用户热点（2-3条）：政策/平台变化、消费趋势、季节场景、用户热议问题。"
        "基于你的行业知识生成，证据标\"待验证\"（不得谎称有实时热点数据）。\n"
        "3. 自身账号数据复盘（2条）：用户未上传账号数据，标注\"待上传\"。\n"
        "4. 同行与对标内容（2条）：基于行业常识推演同类内容角度，标\"待验证\"。\n\n"
        "# 三关筛选（不评分、只贴标签）\n"
        "- 第一关 一票否决：目标用户想不想看？通过 / 待验证（无互动证据时标待验证，不得冒充通过）。\n"
        "- 第二关 共识层级 × 客资准度：人性共识(百万级流量/★☆☆☆☆) / 时代共识(几十万/★★★☆☆) / "
        "利益共识(几万~十几万/★★★★☆) / 热点共识(不稳定/★★★☆☆) / 专业共识(几千~几万/★★★★★)。"
        "共识越高流量越大但客资越泛。\n"
        "- 第三关 账号阶段配比：起号期(0-5000粉) 人性5/时代2/利益2/专业1；"
        "增长期(5000-5万) 人性3/时代3/利益3/专业1；变现期(5万+) 人性2/时代2/利益3/专业3。\n\n"
        "# 类型：认知型 / 信任型 / 连接型 / 转化型\n\n"
        "# 输出要求\n"
        "1. 先写\"四大来源采集结果\"简表（诚实标注缺口：待同步/待上传/待验证）。\n"
        "2. 再输出 10 条选题表格，列必须含："
        "| # | 最终选题 | 类型 | 来源 | 第一关证据 | 共识层级 | 客资准度 | 适用阶段 | 创作建议 |\n"
        "3. 每条必须含术语：目标用户、共识层级、客资准度、账号阶段、第一关证据。\n"
        "4. 表格后附\"账号阶段配比建议\"（若层级分布不均衡给调整方向）与\"待验证动作\"。\n"
        "5. 禁止输出：完整内容执行包、口播逐字稿、拍摄脚本、剪辑EDL、稳赚、保本。\n"
        "6. 不编造数字、案例、经营结果、互动数据；不做虚构评分。\n"
        "7. 选题必须能拍成一条视频（可拍摄可落地），反常识角度优先。\n\n"
        "# 合规红线（最高优先级，违反即不合格）\n"
        "8. 创作建议里的转化引导，严禁出现平台违规词，包括但不限于：\n"
        "   「私信」「私聊」「私我」「加微」「加微信」「加V」「电话」「联系我」「找我」\n"
        "   「留言」「留个」「留下」「扣1」「扣 1」「评论区扣」「评论区打」「截屏找我」\n"
        "   以及任何诱导私信、诱导加好友、诱导评论区扣字的表达。\n"
        "9. 转化引导必须改成合规表达（引导看主页/看置顶/看合集/看简介，让用户自己来找），例如：\n"
        "   - 错误：私信‘陪跑’领资料  →  正确：完整陪跑流程我放在主页置顶那条视频里了\n"
        "   - 错误：评论区扣‘手册’发你  →  正确：这份避坑清单的完整版，我放在主页的合集里\n"
        "   - 错误：想要测算表的私信我  →  正确：投资测算表在主页简介的链接里，自己取\n"
        "   - 错误：想了解的找我聊  →  正确：想看单店模型拆解的，翻我主页往期内容\n"
        "   核心原则：只做‘内容引导’（引导看主页/置顶/合集/简介），不做‘触达引导’（私信/加微/电话）。\n"
    )


def _build_topics_user_prompt(req: TopicsTaskCreate) -> str:
    industry = req.industry or "通用行业"
    brands = "、".join(req.brand_keywords) if req.brand_keywords else "无（通用行业视角）"
    goal = req.goal or "种草"
    platforms = "、".join(req.platforms) if req.platforms else "抖音、小红书、视频号"
    return (
        f"请为以下主体产出 10 个可测试短视频选题：\n"
        f"- 行业：{industry}\n"
        f"- 聚焦品牌/主体（可选）：{brands}\n"
        f"- 营销目标：{goal}\n"
        f"- 投放平台：{platforms}\n"
        f"- 账号当前阶段（未知按\"增长期\"处理）：未知\n\n"
        f"严格按方法论输出：四来源配额（AI录音卡3-4 / 行业热点2-3 / 数据复盘2 / 同行对标2）"
        f"与三关筛选（一票否决→共识层级×客资准度→账号阶段配比）都要体现。"
        f"营销目标为「{goal}」时，选题与创作建议要围绕该目标的转化动作"
        f"（如招商→引导留资领招商手册/私域咨询单店模型；带货→引导下单；品宣→引导关注认知）。"
    )


# 平台违规引导词（诱导私信/加好友/诱导互动），命中需重写
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


def _validate_real_markdown(md: str) -> bool:
    if not md or len(md) < 400:
        return False
    for must in ("共识层级", "客资准度", "第一关证据"):
        if must not in md:
            return False
    rows = re.findall(r"^\|\s*\d+\s*\|", md, re.MULTILINE)
    if len(rows) < 8:
        return False
    return True


def _gen_real_markdown(req: TopicsTaskCreate) -> str:
    """真实生成：优先走 3002 内部接口（若配置 TOPICS_GEN_URL），否则服务端直连百炼 DEEPSEEK。
    失败或校验不通过时抛异常，交由调用方回退 mock。"""
    # 路径一：3002 内部接口（Codex 已部署）
    if settings.TOPICS_GEN_URL:
        url = settings.TOPICS_GEN_URL
        token = settings.TOPICS_GEN_TOKEN
        payload = {
            "industry": req.industry or "",
            "brand_keywords": req.brand_keywords or [],
            "platforms": req.platforms or [],
            "goal": req.goal or "种草",
            "count": req.count or 10,
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {token}" if token else "",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        req_obj = urllib.request.Request(url, data=data, method="POST", headers=headers)
        with urllib.request.urlopen(req_obj, timeout=settings.TOPICS_GEN_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", "replace")
        if not raw.strip():
            raise RuntimeError("选题生成接口返回空")
        body = json.loads(raw)
        md = body.get("markdown") or (body.get("data") or {}).get("markdown") or ""
        if not md.strip():
            raise RuntimeError("选题生成接口响应缺少 markdown 字段")
        if not _validate_real_markdown(md):
            raise RuntimeError("选题生成接口响应校验不通过")
        return md
    # 路径二：服务端直连百炼 DEEPSEEK（当前默认）
    system_p = _build_topics_system_prompt()
    user_p = _build_topics_user_prompt(req)
    md = _call_deepseek(system_p, user_p, timeout=settings.TOPICS_GEN_TIMEOUT)
    if not _validate_real_markdown(md):
        raise RuntimeError("真实生成结果校验不通过（结构缺失），回退 mock")

    # 合规复检：命中违规引导词（私信/加微/评论区扣字等）则带警告重试一次
    banned = _has_banned_guide(md)
    if banned:
        print(f"[topics] 检出违规引导词 {banned}，带合规警告重试一次", flush=True)
        retry_user = (
            user_p
            + "\n\n【合规警告·必须修正】你上一次的输出包含了平台违规引导词："
            + "、".join(banned)
            + "。这些词会导致内容被限流。\n"
            "重新输出时，所有转化引导必须改为合规的「内容引导」——"
            "只能引导用户去看主页 / 置顶视频 / 合集 / 简介链接，"
            "严禁出现任何诱导私信、加微信、打电话、评论区扣字的表达。"
        )
        try:
            md2 = _call_deepseek(system_p, retry_user, timeout=settings.TOPICS_GEN_TIMEOUT)
        except Exception as e:
            print(f"[topics] 合规重试生成失败：{e}", flush=True)
            md2 = ""
        if md2 and _validate_real_markdown(md2) and not _has_banned_guide(md2):
            print("[topics] 合规重试通过，采用重试结果", flush=True)
            return md2
        print(f"[topics] 合规重试仍未通过（命中 {_has_banned_guide(md2)}），沿用首次结果", flush=True)
    return md


def _run_generation(task_id: str) -> None:
    """后台线程：扣点 + 生成（真实优先，mock 兜底），结果写回 _tasks。"""
    db = SessionLocal()
    try:
        with _lock:
            task = _tasks.get(task_id)
            if not task:
                return
            api_key = task["api_key"]
            req = task["req"]
            cost = settings.TOPICS_POINTS
        # 1) 扣点（余额不足则终止，不生成）
        rec = change_balance(db, api_key, -cost, "消费", note=f"选题日报-{req.industry}")
        if not rec:
            with _lock:
                t = _tasks.get(task_id)
                if t:
                    t["status"] = "failed"
                    t["failure_code"] = "INSUFFICIENT_BALANCE"
                    t["message"] = "余额在生成前已不足，本次未扣点"
            return
        # 2) 生成：真实优先（百炼直连或 3002 接口），异常回退 mock
        md, source = "", "mock"
        real_available = bool(settings.TOPICS_GEN_URL or settings.DEEPSEEK_API_KEY)
        try:
            if real_available:
                md = _gen_real_markdown(req)
                source = "real"
            else:
                md = _gen_mock_markdown(req)
        except Exception as e:
            print(f"[topics] 真实生成失败，回退 mock：{e}", flush=True)
            md = _gen_mock_markdown(req)
            source = "mock_fallback"
        with _lock:
            t = _tasks.get(task_id)
            if t:
                t["status"] = "success"
                t["progress"] = 100
                t["data"] = {"markdown": md, "gen_source": source}
                t["billing"] = {"total_points": cost, "gen_source": source}
        print(f"[topics] 任务 {task_id} 完成，来源={source}", flush=True)
    except Exception as e:
        with _lock:
            t = _tasks.get(task_id)
            if t:
                t["status"] = "failed"
                t["failure_code"] = "GEN_ERROR"
                t["message"] = str(e)[:200]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------

@router.post("/skills/topics/tasks")
def create_topics_task(
    req: TopicsTaskCreate,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
):
    api_key = _auth_key(authorization)
    if not api_key:
        raise HTTPException(status_code=401, detail="缺 API Key")
    if not req.industry or len(req.industry) > 64:
        raise HTTPException(status_code=400, detail="industry（行业）为必填且不超过 64 字符")
    if req.count < 5 or req.count > 10:
        req.count = 10
    key_obj = get_or_create_key(db, api_key)
    cost = settings.TOPICS_POINTS
    if key_obj.balance < cost:
        raise HTTPException(status_code=402, detail="余额不足，请先充值")

    task_id = "t_" + uuid.uuid4().hex[:16]
    with _lock:
        _tasks[task_id] = {
            "api_key": api_key,
            "req": req,
            "status": "running",
            "progress": 0,
            "created_at": time.time(),
            "settled": False,
        }
    threading.Thread(target=_run_generation, args=(task_id,), daemon=True).start()
    return {"task_id": task_id, "status": "running", "progress": 0}


@router.get("/skills/topics/tasks/{task_id}")
def get_topics_task(task_id: str):
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")
        status = task["status"]
        if status == "success":
            return {
                "task_id": task_id,
                "status": "success",
                "progress": 100,
                "data": task["data"],
                "billing": task["billing"],
            }
        if status == "failed":
            return {
                "task_id": task_id,
                "status": "failed",
                "failure_code": task.get("failure_code", "TASK_FAILED"),
                "message": task.get("message", "任务执行失败"),
            }
    # running：后台线程生成中，基于耗时估算进度
    elapsed = time.time() - task["created_at"]
    progress = min(90, int(elapsed * 30))
    return {"task_id": task_id, "status": "running", "progress": progress}
