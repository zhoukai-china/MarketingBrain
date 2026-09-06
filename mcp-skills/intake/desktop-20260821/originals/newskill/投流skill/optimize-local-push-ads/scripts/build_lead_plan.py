#!/usr/bin/env python3
"""Build a preview-only Giant Local Push lead campaign draft from verified inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


def require_object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def finite_nonnegative(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{name} must be a finite number")
    if float(value) < 0:
        raise ValueError(f"{name} must be >= 0")
    return float(value)


def normalized_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def build(bundle: dict[str, Any]) -> dict[str, Any]:
    brief = require_object(bundle.get("client_brief"), "client_brief")
    account = require_object(bundle.get("account_identity"), "account_identity")
    for prefix, obj, fields in (
        ("client_brief", brief, ("client_id", "client_name", "industry", "service")),
        ("account_identity", account, ("client_id", "account_id", "account_name")),
    ):
        missing = [f"{prefix}.{field}" for field in fields if not obj.get(field)]
        if missing:
            raise ValueError("missing required fields: " + ", ".join(missing))
    if str(brief["client_id"]) != str(account["client_id"]):
        raise ValueError("client_id mismatch: refuse cross-client plan")
    allowed_accounts = brief.get("allowed_account_ids")
    if isinstance(allowed_accounts, list) and allowed_accounts:
        if str(account["account_id"]) not in {str(item) for item in allowed_accounts}:
            raise ValueError("account_id is not authorized for this client")

    capabilities = {item.lower() for item in normalized_list(account.get("capabilities"))}
    requested_product = str(brief.get("requested_product") or "").strip().lower()
    product_mode: str | None = None
    product_reason = ""
    if requested_product:
        if requested_product in capabilities:
            product_mode = requested_product
            product_reason = "客户指定产品且账户页面已确认开放"
        else:
            product_reason = "客户指定产品尚未在账户能力中确认"
    elif "simple_lead" in capabilities:
        product_mode = "simple_lead"
        product_reason = "默认使用已确认开放的浅层可靠线索能力；后续按回传质量评估迁移"

    optimization_event = str(brief.get("optimization_event") or "").strip()
    cities = normalized_list(brief.get("cities"))
    service_area = normalized_list(brief.get("service_area"))
    creatives = normalized_list(brief.get("creative_assets"))
    conversion_path = str(brief.get("conversion_path") or "").strip()
    schedule = brief.get("schedule")
    daily_budget = brief.get("daily_budget")
    bid_value = brief.get("bid_value")
    if daily_budget is not None:
        daily_budget = finite_nonnegative(daily_budget, "client_brief.daily_budget")
    if bid_value is not None:
        bid_value = finite_nonnegative(bid_value, "client_brief.bid_value")

    missing_fields: list[str] = []
    if not product_mode:
        missing_fields.append("account_identity.capabilities/requested_product")
    if not optimization_event:
        missing_fields.append("client_brief.optimization_event")
    if not cities and not service_area:
        missing_fields.append("client_brief.cities or client_brief.service_area")
    if daily_budget is None:
        missing_fields.append("client_brief.daily_budget")
    if not conversion_path:
        missing_fields.append("client_brief.conversion_path")
    if not creatives:
        missing_fields.append("client_brief.creative_assets")
    if not schedule:
        missing_fields.append("client_brief.schedule")

    draft = {
        "identity": {
            "client_id": brief["client_id"],
            "client_name": brief["client_name"],
            "account_id": account["account_id"],
            "account_name": account["account_name"],
            "advertiser_subject": account.get("advertiser_subject"),
            "stores": normalized_list(account.get("stores")),
            "douyin_accounts": normalized_list(account.get("douyin_accounts")),
        },
        "business": {"industry": brief["industry"], "service": brief["service"]},
        "product_mode": product_mode,
        "product_reason": product_reason,
        "objective": "lead_generation",
        "optimization_event": optimization_event or None,
        "conversion_path": conversion_path or None,
        "geo": {"cities": cities, "service_area": service_area},
        "schedule": schedule,
        "daily_budget": daily_budget,
        "bid_value": bid_value,
        "bid_value_source": "client_brief" if bid_value is not None else None,
        "creative_assets": creatives,
        "qualification_definition": brief.get("qualification_definition"),
        "credentials_status": brief.get("credentials_status"),
    }
    change_fields = (
        "product_mode",
        "objective",
        "optimization_event",
        "conversion_path",
        "geo",
        "schedule",
        "daily_budget",
        "bid_value",
        "creative_assets",
    )
    actions = [
        {
            "field": field,
            "current": None,
            "proposed": draft[field],
            "reason": "来自已核验客户简报和账户身份；提交前需在页面复核",
            "requires_confirmation": True,
        }
        for field in change_fields
        if draft.get(field) not in (None, [], {}, "")
    ]
    hash_payload = {
        "client_id": brief["client_id"],
        "account_id": account["account_id"],
        "draft": draft,
        "actions": actions,
    }
    change_hash = hashlib.sha256(
        json.dumps(hash_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": 1,
        "status": "BLOCKED_MISSING_FIELDS" if missing_fields else "PREVIEW_ONLY",
        "requires_confirmation": True,
        "change_order_hash": change_hash,
        "missing_fields": missing_fields,
        "campaign_draft": draft,
        "actions": actions,
        "safety": {
            "may_fill_before_confirmation": not missing_fields,
            "may_submit_before_confirmation": False,
            "stop_conditions": [
                "account identity mismatch",
                "unverified product capability",
                "ambiguous field",
                "login or captcha",
                "unexpected fee or agreement",
            ],
        },
    }


def self_test() -> None:
    bundle = {
        "client_brief": {
            "client_id": "client-a",
            "client_name": "示例客户",
            "industry": "家装",
            "service": "装修咨询",
            "allowed_account_ids": ["account-1"],
            "optimization_event": "表单提交",
            "cities": ["上海"],
            "daily_budget": 500,
            "conversion_path": "form",
            "creative_assets": ["creative-1", "creative-2"],
            "schedule": {"days": "all", "hours": "09:00-21:00"},
        },
        "account_identity": {
            "client_id": "client-a",
            "account_id": "account-1",
            "account_name": "示例账户",
            "capabilities": ["simple_lead", "lead_search"],
        },
    }
    result = build(bundle)
    assert result["status"] == "PREVIEW_ONLY"
    assert result["campaign_draft"]["product_mode"] == "simple_lead"
    assert result["safety"]["may_submit_before_confirmation"] is False
    assert len(result["change_order_hash"]) == 64
    incomplete = json.loads(json.dumps(bundle, ensure_ascii=False))
    incomplete["client_brief"].pop("daily_budget")
    assert build(incomplete)["status"] == "BLOCKED_MISSING_FIELDS"
    print("lead plan self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="JSON file containing client_brief and account_identity")
    parser.add_argument("--output", type=Path, help="Optional output path")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.input:
        raise SystemExit("--input is required unless --self-test is used")
    result = build(require_object(json.loads(args.input.read_text(encoding="utf-8")), "root"))
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
