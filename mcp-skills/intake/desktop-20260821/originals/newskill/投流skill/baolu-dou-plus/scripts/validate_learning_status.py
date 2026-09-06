#!/usr/bin/env python3
"""Fail closed when DOU+ course-learning records lack reading evidence."""

from __future__ import annotations

import re
import sys
from pathlib import Path


HEADING = re.compile(r"^###\s+正文已研读：(.+)$", re.MULTILINE)
OFFICIAL_URL = re.compile(r"https://(?:school|support)\.oceanengine\.com/[^\s)>]+")
READ_DATE = re.compile(r"研读日期\s*20\d{2}-\d{2}-\d{2}")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    path = root / "references" / "course-learning-status.md"
    text = path.read_text(encoding="utf-8")
    headings = list(HEADING.finditer(text))
    errors: list[str] = []
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        section = text[heading.start():end]
        title = heading.group(1).strip()
        if not OFFICIAL_URL.search(section):
            errors.append(f"missing official URL: {title}")
        if not READ_DATE.search(section):
            errors.append(f"missing reading date: {title}")
    if not headings:
        errors.append("no completed-reading sections found")
    if errors:
        print("DOU+ learning evidence check failed:\n- " + "\n- ".join(errors))
        return 1
    print(f"DOU+ learning evidence check passed: {len(headings)} completed-reading sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
