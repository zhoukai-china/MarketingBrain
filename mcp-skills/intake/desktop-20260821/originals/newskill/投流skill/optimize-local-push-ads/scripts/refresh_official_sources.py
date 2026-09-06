#!/usr/bin/env python3
"""Refresh the public Giant Local Push knowledge catalog.

This script only reads public Ocean Engine help-center endpoints. It stores
article metadata, source URLs, and short text excerpts when the API exposes
plain content. It intentionally does not mirror full copyrighted articles.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


DEFAULT_SPACE_ID = 174
DEFAULT_GRAPH_ID = 526
DEFAULT_PAGE_ID = 305
API_ROOT = "https://localads.chengzijianzhan.cn/support/backend"
PAGE_ROOT = "https://localads.chengzijianzhan.cn/support/content"
HELP_HOME = "https://support.oceanengine.com/support/?pageId=305&spaceId=174"
SCHOOL_HOME = (
    "https://school.oceanengine.com/page/"
    "%E5%B7%A8%E9%87%8F%E6%9C%AC%E5%9C%B0%E6%8E%A8%E5%AD%A6%E5%A0%82"
)
USER_AGENT = "Codex-local-push-skill-source-refresh/1.0"

P0_TERMS = (
    "线索",
    "搜索",
    "ubmax",
    "深度转化",
    "简单投",
    "竞价",
    "出价",
    "回传",
    "审核",
    "资质",
    "数据",
    "报表",
)
HIGH_RISK_TERMS = (
    "赔付",
    "返赠",
    "起投",
    "审核",
    "资质",
    "开户",
    "计费",
    "出价",
    "预算",
    "授权",
)
HISTORICAL_TERMS = ("历史快照", "活动已结束", "已下线", "文档已移除", "停止使用")


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._ignored_depth += 1
        elif tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1
        elif tag in {"p", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def text(self) -> str:
        value = html.unescape("".join(self.parts))
        value = re.sub(r"[ \t\f\v]+", " ", value)
        value = re.sub(r"\n\s*\n+", "\n", value)
        return value.strip()


def parse_args() -> argparse.Namespace:
    skill_dir = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=skill_dir / "references",
        help="Directory for official-source-index.json and official-catalog.md",
    )
    parser.add_argument("--space-id", type=int, default=DEFAULT_SPACE_ID)
    parser.add_argument("--graph-id", type=int, default=DEFAULT_GRAPH_ID)
    parser.add_argument("--page-id", type=int, default=DEFAULT_PAGE_ID)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--delay-ms", type=int, default=50)
    parser.add_argument(
        "--skip-details",
        action="store_true",
        help="Refresh the hierarchy without querying each article's metadata",
    )
    parser.add_argument(
        "--max-articles",
        type=int,
        default=0,
        help="Limit article detail requests for testing; 0 means all",
    )
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        help="Only refresh article details whose title/category contains this term; repeatable",
    )
    parser.add_argument(
        "--priority-only",
        action="store_true",
        help="Only refresh P0 article details while retaining previous details for other articles",
    )
    parser.add_argument("--self-test", action="store_true", help="Run offline change-detection tests")
    return parser.parse_args()


def fetch_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("code") != 1:
        raise RuntimeError(f"API error for {url}: {payload.get('msg') or payload}")
    return payload


def flatten_tree(
    nodes: Iterable[dict[str, Any]],
    parents: tuple[str, ...] = (),
    depth: int = 0,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for node in nodes:
        row = {
            "node_id": node.get("nodeId"),
            "mapping_id": node.get("mappingId"),
            "mapping_type": node.get("mappingType"),
            "title": node.get("mappingName", ""),
            "publish_sign": node.get("publishSign"),
            "parent_node_id": node.get("parentNodeId"),
            "node_index": node.get("nodeIndex"),
            "create_time_unix": node.get("createTime"),
            "modify_time_unix": node.get("modifyTime"),
            "depth": depth,
            "category_path": list(parents),
        }
        rows.append(row)
        child_parents = parents
        if node.get("mappingType") == 1:
            child_parents = parents + (row["title"],)
        rows.extend(flatten_tree(node.get("subTreeNodes") or [], child_parents, depth + 1))
    return rows


def article_url(article_id: int, graph_id: int, page_id: int, space_id: int) -> str:
    query = urllib.parse.urlencode(
        {
            "graphId": graph_id,
            "mappingType": 2,
            "pageId": page_id,
            "spaceId": space_id,
        }
    )
    return f"{PAGE_ROOT}/{article_id}?{query}"


def clean_excerpt(value: Any, limit: int = 320) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    stripped = value.strip()
    if stripped[:1] in {"{", "["}:
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parsed = None
        if parsed is not None:
            fragments: list[str] = []

            def collect_text(item: Any) -> None:
                if isinstance(item, dict):
                    for key, child in item.items():
                        if key in {"text", "insert"} and isinstance(child, str):
                            fragments.append(child)
                        else:
                            collect_text(child)
                elif isinstance(item, list):
                    for child in item:
                        collect_text(child)

            collect_text(parsed)
            json_text = re.sub(r"\s+", " ", " ".join(fragments)).strip()
            if json_text:
                return json_text if len(json_text) <= limit else json_text[: limit - 1].rstrip() + "…"
    parser = TextExtractor()
    parser.feed(value)
    text = parser.text() or re.sub(r"\s+", " ", value).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def fetch_detail(
    row: dict[str, Any],
    *,
    graph_id: int,
    page_id: int,
    space_id: int,
    timeout: float,
    delay_ms: int,
) -> dict[str, Any]:
    if delay_ms:
        time.sleep(delay_ms / 1000)
    article_id = int(row["mapping_id"])
    query = urllib.parse.urlencode(
        {"spaceId": space_id, "graphId": graph_id, "knowledgeId": article_id}
    )
    endpoint = f"{API_ROOT}/content/knowledge/detail?{query}"
    payload = fetch_json(endpoint, timeout)
    detail = payload.get("data") or {}
    raw_content = detail.get("content") or detail.get("larkContent") or ""
    return {
        **row,
        "source_url": article_url(article_id, graph_id, page_id, space_id),
        "created_at": detail.get("createTime") or "",
        "modified_at": detail.get("modifyTime") or "",
        "content_type": detail.get("contentType") or "",
        "content_available_via_api": bool(raw_content),
        "rendered_document_available": bool(detail.get("feishuDocxToken")),
        "excerpt": clean_excerpt(raw_content),
    }


def timestamp_from_unix(value: Any) -> str:
    if not value:
        return ""
    try:
        return dt.datetime.fromtimestamp(int(value), tz=dt.timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return ""


def normalize_title(value: str) -> str:
    return re.sub(r"[\W_]+", "", value or "").lower()


def searchable_text(row: dict[str, Any]) -> str:
    return " ".join(
        [str(row.get("title") or ""), *[str(item) for item in row.get("category_path") or []]]
    ).lower()


def priority_for(row: dict[str, Any]) -> str:
    haystack = searchable_text(row)
    return "P0" if any(term in haystack for term in P0_TERMS) else "P1"


def classify_article(row: dict[str, Any]) -> dict[str, Any]:
    haystack = f"{searchable_text(row)} {row.get('excerpt') or ''}".lower()
    if row.get("excerpt"):
        reading_status = "summary_available"
    elif row.get("rendered_document_available"):
        reading_status = "pending_rendered_reading"
    else:
        reading_status = "metadata_only"
    fingerprint_source = json.dumps(
        {
            "title": row.get("title"),
            "category_path": row.get("category_path") or [],
            "modified_at": row.get("modified_at") or timestamp_from_unix(row.get("modify_time_unix")),
            "excerpt": row.get("excerpt") or "",
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return {
        **row,
        "priority": priority_for(row),
        "reading_status": reading_status,
        "requires_live_verification": any(term in haystack for term in HIGH_RISK_TERMS),
        "historical_warning": any(term in haystack for term in HISTORICAL_TERMS),
        "content_fingerprint": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest(),
    }


def load_previous_index(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def article_map(index: dict[str, Any]) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for row in index.get("nodes") or []:
        if row.get("mapping_type") == 2 and row.get("mapping_id") is not None:
            result[int(row["mapping_id"])] = row
    return result


def change_signature(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        row.get("title"),
        tuple(row.get("category_path") or []),
        row.get("modified_at") or timestamp_from_unix(row.get("modify_time_unix")),
        row.get("content_fingerprint") or "",
    )


def calculate_changes(
    previous: dict[str, Any], current_nodes: list[dict[str, Any]]
) -> dict[str, Any]:
    before = article_map(previous)
    after = {int(row["mapping_id"]): row for row in current_nodes if row.get("mapping_type") == 2}
    new_ids = sorted(set(after) - set(before))
    removed_ids = sorted(set(before) - set(after))
    modified_ids = sorted(
        article_id
        for article_id in set(before) & set(after)
        if change_signature(before[article_id]) != change_signature(after[article_id])
    )

    title_groups: dict[str, list[dict[str, Any]]] = {}
    for row in after.values():
        key = normalize_title(str(row.get("title") or ""))
        if key:
            title_groups.setdefault(key, []).append(row)
    conflicts = [
        [
            {
                "mapping_id": item.get("mapping_id"),
                "title": item.get("title"),
                "modified_at": item.get("modified_at") or timestamp_from_unix(item.get("modify_time_unix")),
                "source_url": item.get("source_url"),
            }
            for item in group
        ]
        for group in title_groups.values()
        if len(group) > 1 and len({change_signature(item) for item in group}) > 1
    ]

    def summarize(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "mapping_id": row.get("mapping_id"),
            "title": row.get("title"),
            "modified_at": row.get("modified_at") or timestamp_from_unix(row.get("modify_time_unix")),
            "source_url": row.get("source_url"),
        }

    return {
        "baseline_generated_at": previous.get("generated_at") or "",
        "new": [summarize(after[item]) for item in new_ids],
        "modified": [summarize(after[item]) for item in modified_ids],
        "removed": [summarize(before[item]) for item in removed_ids],
        "potential_conflicts": conflicts,
    }


def render_change_report(index: dict[str, Any]) -> str:
    changes = index.get("changes") or {}
    lines = [
        "# 巨量本地推官方知识变更报告",
        "",
        f"> 本次生成：{index['generated_at']}；对比基线：{changes.get('baseline_generated_at') or '无'}。",
        "",
    ]
    for key, title in (("new", "新增"), ("modified", "修改"), ("removed", "下线或移除")):
        rows = changes.get(key) or []
        lines.extend([f"## {title}（{len(rows)}）", ""])
        if not rows:
            lines.append("- 无")
        else:
            for row in rows:
                url = row.get("source_url")
                label = f"[{row['title']}]({url})" if url else row["title"]
                lines.append(f"- {label} — {row.get('modified_at') or '无更新时间'}")
        lines.append("")
    conflicts = changes.get("potential_conflicts") or []
    lines.extend([f"## 潜在同名冲突（{len(conflicts)} 组）", ""])
    if not conflicts:
        lines.append("- 无")
    else:
        for group in conflicts:
            lines.append("- " + "；".join(f"{item['title']}（{item.get('modified_at') or '未知'}）" for item in group))
    lines.extend(
        [
            "",
            "> 同名仅表示需要人工复核，不自动判定规则冲突；高风险规则仍需打开最新官方正文核验。",
            "",
        ]
    )
    return "\n".join(lines)


def render_reading_queue(index: dict[str, Any]) -> str:
    articles = [row for row in index["nodes"] if row.get("mapping_type") == 2]
    pending = sorted(
        (row for row in articles if row.get("reading_status") != "summary_available"),
        key=lambda row: (0 if row.get("priority") == "P0" else 1, str(row.get("title") or "")),
    )
    lines = [
        "# 巨量本地推官方正文研读队列",
        "",
        f"> 生成时间：{index['generated_at']}。队列只记录官方入口和研读状态，不镜像完整正文。",
        "",
        f"- 待研读：{len(pending)} 篇",
        f"- P0 待研读：{sum(1 for row in pending if row.get('priority') == 'P0')} 篇",
        "",
        "## P0：线索、搜索、竞价、回传、审核、资质与数据",
        "",
    ]
    for row in pending:
        if row.get("priority") != "P0":
            continue
        risk = "；执行前实时核验" if row.get("requires_live_verification") else ""
        warning = "；疑似历史内容" if row.get("historical_warning") else ""
        lines.append(f"- [{row['title']}]({row['source_url']}) — {row['reading_status']}{risk}{warning}")
    lines.extend(["", "## P1：其余产品、案例与经营知识", ""])
    for row in pending:
        if row.get("priority") == "P0":
            continue
        lines.append(f"- [{row['title']}]({row['source_url']}) — {row['reading_status']}")
    lines.extend(
        [
            "",
            "## 完成定义",
            "",
            "- 已打开仍在线的官方正文并核对更新时间。",
            "- 已沉淀官方事实、适用条件、操作路径、风险与原文链接。",
            "- 涉及高风险规则时已标记实时核验要求。",
            "- 未取得正文时保持待研读，不把标题建档写成已学完。",
            "",
        ]
    )
    return "\n".join(lines)


def self_test() -> None:
    previous_rows = [
        classify_article(
            {
                "mapping_type": 2,
                "mapping_id": 1,
                "title": "线索旧说明",
                "category_path": ["产品功能", "线索"],
                "modified_at": "2026-01-01",
                "source_url": "https://localads.chengzijianzhan.cn/support/content/1",
                "excerpt": "旧内容",
                "rendered_document_available": False,
            }
        ),
        classify_article(
            {
                "mapping_type": 2,
                "mapping_id": 3,
                "title": "将下线说明",
                "category_path": ["通知"],
                "modified_at": "2026-01-01",
                "source_url": "https://localads.chengzijianzhan.cn/support/content/3",
                "excerpt": "",
                "rendered_document_available": True,
            }
        ),
    ]
    previous = {"generated_at": "2026-01-02", "nodes": previous_rows}
    current = [
        classify_article(
            {
                "mapping_type": 2,
                "mapping_id": 1,
                "title": "线索新说明",
                "category_path": ["产品功能", "线索"],
                "modified_at": "2026-02-01",
                "source_url": "https://localads.chengzijianzhan.cn/support/content/1",
                "excerpt": "新内容",
                "rendered_document_available": False,
            }
        ),
        classify_article(
            {
                "mapping_type": 2,
                "mapping_id": 2,
                "title": "审核历史快照",
                "category_path": ["规则"],
                "modified_at": "2026-02-01",
                "source_url": "https://localads.chengzijianzhan.cn/support/content/2",
                "excerpt": "活动已结束",
                "rendered_document_available": False,
            }
        ),
    ]
    changes = calculate_changes(previous, current)
    assert [item["mapping_id"] for item in changes["new"]] == [2]
    assert [item["mapping_id"] for item in changes["modified"]] == [1]
    assert [item["mapping_id"] for item in changes["removed"]] == [3]
    assert current[0]["priority"] == "P0"
    assert current[1]["requires_live_verification"] is True
    assert current[1]["historical_warning"] is True
    print("official source refresh self-test passed")


def render_catalog(index: dict[str, Any]) -> str:
    lines = [
        "# 巨量本地推官方知识目录",
        "",
        f"> 生成时间：{index['generated_at']}。仅索引公开官方页面；产品规则与界面以实时平台为准。",
        "",
        f"- 官方帮助中心：<{HELP_HOME}>",
        f"- 巨量本地推学堂：<{SCHOOL_HOME}>",
        f"- 公开文章：{index['counts']['articles']} 篇",
        f"- 分类节点：{index['counts']['categories']} 个",
        f"- 抓取失败：{index['counts']['detail_failures']} 篇",
        "",
        "## 目录",
        "",
    ]
    for row in index["nodes"]:
        depth = int(row.get("depth") or 0)
        indent = "  " * depth
        if row.get("mapping_type") == 1:
            lines.append(f"{indent}- **{row['title']}**")
            continue
        updated = row.get("modified_at") or timestamp_from_unix(row.get("modify_time_unix"))
        suffix = f" — 更新 {updated}" if updated else ""
        lines.append(f"{indent}- [{row['title']}]({row['source_url']}){suffix}")
    lines.extend(
        [
            "",
            "## 使用规则",
            "",
            "- 回答具体产品能力、赔付、审核、开户、计费或界面操作时，先打开对应官方文章核对当前版本。",
            "- 目录中的 `modify_time_unix` 和文章 `modified_at` 用于判断新旧；同题冲突时优先采用更新时间更晚且仍在线的官方页面。",
            "- 历史快照、已结束活动与已下线页面只能作为背景，不得当作当前政策。",
            "- 不把经验阈值写成平台保证；投放建议需结合行业、客单、毛利、核销周期和账户样本量。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    args.output.mkdir(parents=True, exist_ok=True)
    index_path = args.output / "official-source-index.json"
    previous_index = load_previous_index(index_path)
    previous_articles = article_map(previous_index)
    tree_query = urllib.parse.urlencode(
        {"spaceId": args.space_id, "graphId": args.graph_id, "level": 0}
    )
    tree_payload = fetch_json(f"{API_ROOT}/content/tree?{tree_query}", args.timeout)
    nodes = flatten_tree(tree_payload.get("data") or [])
    articles = [row for row in nodes if row.get("mapping_type") == 2]
    requested = articles
    if args.priority_only:
        requested = [row for row in requested if priority_for(row) == "P0"]
    if args.query:
        terms = [term.lower() for term in args.query if term.strip()]
        requested = [row for row in requested if any(term in searchable_text(row) for term in terms)]
    requested = requested[: args.max_articles] if args.max_articles else requested

    details: dict[int, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    if not args.skip_details:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {
                pool.submit(
                    fetch_detail,
                    row,
                    graph_id=args.graph_id,
                    page_id=args.page_id,
                    space_id=args.space_id,
                    timeout=args.timeout,
                    delay_ms=args.delay_ms,
                ): row
                for row in requested
            }
            for future in concurrent.futures.as_completed(futures):
                row = futures[future]
                try:
                    detail = future.result()
                    details[int(row["mapping_id"])] = detail
                except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                    failures.append(
                        {
                            "mapping_id": row.get("mapping_id"),
                            "title": row.get("title"),
                            "error": str(exc),
                        }
                    )

    enriched_nodes: list[dict[str, Any]] = []
    for row in nodes:
        if row.get("mapping_type") == 2:
            article_id = int(row["mapping_id"])
            previous = previous_articles.get(article_id) or {}
            enriched = details.get(article_id) or {
                **previous,
                **row,
                "source_url": article_url(article_id, args.graph_id, args.page_id, args.space_id),
                "created_at": previous.get("created_at") or "",
                "modified_at": previous.get("modified_at") or "",
                "content_type": previous.get("content_type") or "",
                "content_available_via_api": bool(previous.get("content_available_via_api")),
                "rendered_document_available": bool(previous.get("rendered_document_available")),
                "excerpt": previous.get("excerpt") or "",
            }
            enriched_nodes.append(classify_article(enriched))
        else:
            enriched_nodes.append(row)

    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    index = {
        "schema_version": 2,
        "generated_at": generated_at,
        "provenance": {
            "publisher": "巨量引擎 / 巨量本地推帮助中心",
            "help_home": HELP_HOME,
            "school_home": SCHOOL_HOME,
            "tree_endpoint": f"{API_ROOT}/content/tree",
            "space_id": args.space_id,
            "graph_id": args.graph_id,
            "page_id": args.page_id,
            "notes": "Public metadata and short excerpts only; full article bodies are not mirrored.",
        },
        "counts": {
            "nodes": len(nodes),
            "categories": sum(1 for row in nodes if row.get("mapping_type") == 1),
            "articles": len(articles),
            "details_requested": len(requested) if not args.skip_details else 0,
            "details_loaded": len(details),
            "details_available_after_merge": sum(
                1
                for row in enriched_nodes
                if row.get("mapping_type") == 2
                and (row.get("content_available_via_api") or row.get("rendered_document_available"))
            ),
            "detail_failures": len(failures),
            "summary_available": sum(
                1 for row in enriched_nodes if row.get("reading_status") == "summary_available"
            ),
            "pending_rendered_reading": sum(
                1 for row in enriched_nodes if row.get("reading_status") == "pending_rendered_reading"
            ),
            "priority_pending": sum(
                1
                for row in enriched_nodes
                if row.get("mapping_type") == 2
                and row.get("priority") == "P0"
                and row.get("reading_status") != "summary_available"
            ),
        },
        "failures": failures,
        "refresh_scope": {
            "mode": "priority" if args.priority_only else ("query" if args.query else "full"),
            "queries": args.query,
            "skip_details": args.skip_details,
            "max_articles": args.max_articles,
        },
        "nodes": enriched_nodes,
    }
    index["changes"] = calculate_changes(previous_index, enriched_nodes)

    catalog_path = args.output / "official-catalog.md"
    change_report_path = args.output / "official-change-report.md"
    reading_queue_path = args.output / "official-reading-queue.md"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    catalog_path.write_text(render_catalog(index), encoding="utf-8")
    change_report_path.write_text(render_change_report(index), encoding="utf-8")
    reading_queue_path.write_text(render_reading_queue(index), encoding="utf-8")
    print(
        json.dumps(
            {
                "index": str(index_path),
                "catalog": str(catalog_path),
                "change_report": str(change_report_path),
                "reading_queue": str(reading_queue_path),
                **index["counts"],
                "new": len(index["changes"]["new"]),
                "modified": len(index["changes"]["modified"]),
                "removed": len(index["changes"]["removed"]),
            },
            ensure_ascii=False,
        )
    )
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
