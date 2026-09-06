#!/usr/bin/env python3
"""Validate UTF-8, local references, metadata, and official source-index integrity."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


TEXT_SUFFIXES = {".md", ".yaml", ".yml", ".json", ".py"}
OFFICIAL_HOSTS = {
    "support.oceanengine.com",
    "localads.chengzijianzhan.cn",
    "school.oceanengine.com",
    "www.oceanengine.com",
}
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
COURSE_FACT_RE = re.compile(r"^###\s+课程：(.+)$", re.MULTILINE)
OFFICIAL_URL_RE = re.compile(r"https://(?:school|support)\.oceanengine\.com/[^\s)>]+")
READ_DATE_RE = re.compile(r"研读日期\s*20\d{2}-\d{2}-\d{2}")


def check_utf8(root: Path, errors: list[str]) -> None:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            errors.append(f"UTF-8 failure: {path.relative_to(root)}: {exc}")
            continue
        if "\ufffd" in text:
            errors.append(f"replacement character found: {path.relative_to(root)}")


def check_local_links(root: Path, errors: list[str]) -> None:
    for path in root.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        for target in LINK_RE.findall(text):
            clean = target.strip().strip("<>")
            if clean.startswith(("https://", "http://", "#", "mailto:")):
                continue
            relative = clean.split("#", 1)[0]
            if not relative:
                continue
            resolved = (path.parent / relative).resolve()
            if not resolved.exists():
                errors.append(f"missing local link: {path.relative_to(root)} -> {clean}")


def check_metadata(root: Path, errors: list[str]) -> None:
    yaml_path = root / "agents" / "openai.yaml"
    if not yaml_path.exists():
        errors.append("missing agents/openai.yaml")
        return
    text = yaml_path.read_text(encoding="utf-8")
    for required in ("display_name:", "short_description:", "default_prompt:"):
        if required not in text:
            errors.append(f"agents/openai.yaml missing {required}")
    if "$optimize-local-push-ads" not in text:
        errors.append("agents/openai.yaml default_prompt must mention $optimize-local-push-ads")


def check_json(root: Path, errors: list[str]) -> None:
    for path in root.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            errors.append(f"invalid JSON: {path.relative_to(root)}: {exc}")


def check_source_index(root: Path, errors: list[str]) -> dict[str, Any]:
    path = root / "references" / "official-source-index.json"
    if not path.exists():
        errors.append("missing official-source-index.json")
        return {}
    index = json.loads(path.read_text(encoding="utf-8"))
    if index.get("schema_version") != 2:
        errors.append("official source index must use schema_version 2")
    articles = [row for row in index.get("nodes") or [] if row.get("mapping_type") == 2]
    if len(articles) != int((index.get("counts") or {}).get("articles") or -1):
        errors.append("official source article count mismatch")
    for row in articles:
        source_url = str(row.get("source_url") or "")
        host = urlparse(source_url).hostname
        if host not in OFFICIAL_HOSTS:
            errors.append(f"non-official or missing article URL: {row.get('mapping_id')} {source_url}")
        for required in ("priority", "reading_status", "requires_live_verification", "content_fingerprint"):
            if required not in row:
                errors.append(f"source index row {row.get('mapping_id')} missing {required}")
    for required_path in (
        root / "references" / "official-change-report.md",
        root / "references" / "official-reading-queue.md",
    ):
        if not required_path.exists():
            errors.append(f"missing generated source artifact: {required_path.name}")
    return index


def check_course_learning_status(root: Path, errors: list[str]) -> None:
    """Require traceability for courses represented as completed reading.

    A catalog title or a partially loaded player is not evidence of learning.
    Every section whose status says “正文已研读” must therefore keep both an
    official source URL and a verification date in that local record.
    """
    path = root / "references" / "course-learning.md"
    if not path.exists():
        errors.append("missing references/course-learning.md")
        return
    text = path.read_text(encoding="utf-8")
    matches = list(COURSE_FACT_RE.finditer(text))
    if not matches:
        errors.append("course-learning.md has no course evidence sections")
        return
    completed = 0
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        section = text[match.start():end]
        title = match.group(1).strip()
        if "状态：正文已研读" not in section:
            continue
        completed += 1
        if not OFFICIAL_URL_RE.search(section):
            errors.append(f"course learning section lacks official URL: {title}")
        if not (READ_DATE_RE.search(section) or re.search(r"核验日期\s*：?\s*20\d{2}-\d{2}-\d{2}", section)):
            errors.append(f"course learning section lacks reading date: {title}")
    if not completed:
        errors.append("course-learning.md has no '正文已研读' evidence sections")
    if "已学完" in text and "不得声称已学完" not in text:
        errors.append("course-learning.md uses '已学完' without an explicit evidence boundary")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    errors: list[str] = []
    check_utf8(root, errors)
    check_local_links(root, errors)
    check_metadata(root, errors)
    check_json(root, errors)
    index = check_source_index(root, errors)
    check_course_learning_status(root, errors)
    summary = {
        "status": "ok" if not errors else "failed",
        "errors": errors,
        "skill": str(root),
        "source_generated_at": index.get("generated_at"),
        "source_counts": index.get("counts"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
