#!/usr/bin/env python3
"""Validate local-lead inputs and generate a preview-only diagnostic change order."""

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


def number(value: Any, name: str, *, allow_none: bool = True) -> float | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{name} must be a finite number")
    if float(value) < 0:
        raise ValueError(f"{name} must be >= 0")
    return float(value)


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def cost(spend: float | None, count: float | None) -> float | None:
    return ratio(spend, count)


def pct(value: float | None) -> float | None:
    return None if value is None else round(value * 100, 2)


def money(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def validate_bundle(bundle: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    brief = require_object(bundle.get("client_brief"), "client_brief")
    snapshot = require_object(bundle.get("account_snapshot"), "account_snapshot")
    required_brief = ("client_id", "client_name", "industry", "service")
    required_snapshot = ("client_id", "account_id", "account_name", "date_range", "attribution_window")
    missing = [f"client_brief.{key}" for key in required_brief if not brief.get(key)]
    missing += [f"account_snapshot.{key}" for key in required_snapshot if not snapshot.get(key)]
    if missing:
        raise ValueError("missing required fields: " + ", ".join(missing))
    if str(brief["client_id"]) != str(snapshot["client_id"]):
        raise ValueError("client_id mismatch: refuse cross-client diagnosis")
    allowed_accounts = brief.get("allowed_account_ids")
    if isinstance(allowed_accounts, list) and allowed_accounts:
        if str(snapshot["account_id"]) not in {str(item) for item in allowed_accounts}:
            raise ValueError("account_id is not authorized for this client")
    date_range = require_object(snapshot["date_range"], "account_snapshot.date_range")
    for key in ("start", "end", "timezone"):
        if not date_range.get(key):
            raise ValueError(f"account_snapshot.date_range.{key} is required")
    for key in (
        "spend",
        "impressions",
        "clicks",
        "leads",
        "valid_leads",
        "appointments",
        "store_visits",
        "deals",
        "revenue",
    ):
        if key in snapshot:
            number(snapshot.get(key), f"account_snapshot.{key}")
    for key in (
        "daily_budget",
        "average_order_value",
        "contribution_margin_rate",
        "target_lead_cost",
        "target_effective_lead_cost",
        "target_valid_rate",
        "expected_lead_to_deal_rate",
        "collection_rate",
    ):
        if key in brief:
            number(brief.get(key), f"client_brief.{key}")
    for key in ("contribution_margin_rate", "target_valid_rate", "expected_lead_to_deal_rate", "collection_rate"):
        value = brief.get(key)
        if value is not None and float(value) > 1:
            raise ValueError(f"client_brief.{key} must be between 0 and 1")
    if snapshot.get("valid_leads") is not None and snapshot.get("leads") is not None:
        if float(snapshot["valid_leads"]) > float(snapshot["leads"]):
            raise ValueError("valid_leads cannot exceed leads")
    return brief, snapshot


def action(
    *,
    priority: str,
    field: str,
    current: Any,
    proposed: Any,
    reason: str,
    evidence: list[str],
    strength: str,
    metric: str,
    observation: str,
    stop_loss: str,
    rollback: str,
    classification: str = "数据结论",
) -> dict[str, Any]:
    return {
        "priority": priority,
        "classification": classification,
        "root_cause_strength": strength,
        "field": field,
        "current": current,
        "proposed": proposed,
        "reason": reason,
        "evidence": evidence,
        "expected_metric": metric,
        "observation_condition": observation,
        "stop_loss": stop_loss,
        "rollback": rollback,
    }


def diagnose(bundle: dict[str, Any]) -> dict[str, Any]:
    brief, snapshot = validate_bundle(bundle)
    values = {
        key: number(snapshot.get(key), f"account_snapshot.{key}")
        for key in (
            "spend",
            "impressions",
            "clicks",
            "leads",
            "valid_leads",
            "appointments",
            "store_visits",
            "deals",
            "revenue",
        )
    }
    spend = values["spend"] or 0.0
    impressions = values["impressions"]
    clicks = values["clicks"]
    leads = values["leads"]
    valid_leads = values["valid_leads"]
    deals = values["deals"]
    metrics = {
        "cpm": money(None if not impressions else spend / impressions * 1000),
        "ctr_pct": pct(ratio(clicks, impressions)),
        "cpc": money(cost(spend, clicks)),
        "click_to_lead_rate_pct": pct(ratio(leads, clicks)),
        "lead_cpa": money(cost(spend, leads)),
        "valid_rate_pct": pct(ratio(valid_leads, leads)),
        "effective_lead_cpa": money(cost(spend, valid_leads)),
        "appointment_rate_pct": pct(ratio(values["appointments"], valid_leads)),
        "store_visit_rate_pct": pct(ratio(values["store_visits"], values["appointments"])),
        "lead_to_deal_rate_pct": pct(ratio(deals, leads)),
        "roas": None if not spend else round((values["revenue"] or 0.0) / spend, 4),
    }

    observed_deal_rate = ratio(deals, leads)
    expected_deal_rate = number(
        brief.get("expected_lead_to_deal_rate"), "client_brief.expected_lead_to_deal_rate"
    )
    use_observed_rate = observed_deal_rate is not None and (deals or 0) > 0
    assumed_deal_rate = observed_deal_rate if use_observed_rate else expected_deal_rate
    order_value = number(brief.get("average_order_value"), "client_brief.average_order_value")
    margin_rate = number(brief.get("contribution_margin_rate"), "client_brief.contribution_margin_rate")
    collection_rate = number(brief.get("collection_rate", 1), "client_brief.collection_rate")
    break_even = None
    if order_value is not None and margin_rate is not None and assumed_deal_rate is not None:
        break_even = order_value * margin_rate * assumed_deal_rate * (collection_rate or 0.0)
    metrics["break_even_lead_cost"] = money(break_even)
    metrics["break_even_basis"] = (
        "observed_lead_to_deal_rate" if use_observed_rate else "brief_expected_lead_to_deal_rate"
    ) if break_even is not None else None

    actions: list[dict[str, Any]] = []
    evidence_scope = (
        f"{snapshot['date_range']['start']}至{snapshot['date_range']['end']}，"
        f"归因窗口：{snapshot['attribution_window']}"
    )

    if not impressions or spend == 0:
        actions.append(
            action(
                priority="P0",
                field="delivery_eligibility",
                current="无稳定展示或消耗",
                proposed="依次核验审核/资质/余额/排期/账户开放能力/地域与出价限制",
                reason="尚未进入有效竞价，不能先用素材或承接解释",
                evidence=[evidence_scope, f"展示={impressions or 0}，消耗={spend}"],
                strength="强推断",
                metric="开始获得稳定展示与消耗",
                observation="所有平台状态检查完成后重新读取同口径数据",
                stop_loss="未找到明确阻塞项时停止自动修改并请求人工核验",
                rollback="不产生账户变更",
            )
        )

    target_lead_cost = number(brief.get("target_lead_cost"), "client_brief.target_lead_cost")
    lead_cpa = metrics["lead_cpa"]
    if target_lead_cost is not None and lead_cpa is not None and lead_cpa > target_lead_cost:
        actions.append(
            action(
                priority="P0",
                field="lead_cost_diagnosis",
                current=lead_cpa,
                proposed="先分解点击成本与点击到线索转化，再只调整一个主变量",
                reason="当前线索成本高于客户明确目标，需定位流量成本或承接环节",
                evidence=[evidence_scope, f"线索成本={lead_cpa}，目标={target_lead_cost}"],
                strength="数据结论",
                metric="线索成本及有效线索成本",
                observation="保持归因、地域和转化事件一致，获得可比较样本后判断",
                stop_loss="下游有效率继续恶化时停止扩量或回退本次变更",
                rollback="恢复变更前素材/地域/出价/转化事件，只回退本次单一变量",
            )
        )

    target_valid_rate = number(brief.get("target_valid_rate"), "client_brief.target_valid_rate")
    valid_rate = ratio(valid_leads, leads)
    target_effective = number(
        brief.get("target_effective_lead_cost"), "client_brief.target_effective_lead_cost"
    )
    implied_effective_target = None
    if target_lead_cost is not None and target_valid_rate not in (None, 0):
        implied_effective_target = target_lead_cost / target_valid_rate
        metrics["implied_effective_lead_cost_target"] = money(implied_effective_target)
    if (
        target_effective is not None
        and implied_effective_target is not None
        and abs(target_effective - implied_effective_target) > 0.01
    ):
        actions.append(
            action(
                priority="P0",
                field="goal_consistency",
                current={
                    "target_lead_cost": target_lead_cost,
                    "target_valid_rate": target_valid_rate,
                    "target_effective_lead_cost": target_effective,
                },
                proposed="确认哪一项是主目标，并使 CPL ÷ 有效率 = 有效线索成本",
                reason="客户提供的三项目标无法同时成立",
                evidence=[
                    f"按目标 CPL 和有效率推导的有效线索成本={money(implied_effective_target)}，"
                    f"客户另给目标={target_effective}"
                ],
                strength="数据结论",
                metric="目标线索成本、目标有效率、目标有效线索成本",
                observation="投放调整前由业务负责人确认一致目标",
                stop_loss="目标未统一前不修改成本目标、预算或出价",
                rollback="不产生账户变更",
            )
        )
    if target_valid_rate is not None and valid_rate is not None and valid_rate < target_valid_rate:
        actions.append(
            action(
                priority="P0",
                field="lead_quality",
                current=round(valid_rate, 4),
                proposed="核验地域/服务范围、素材承诺、表单筛选、销售首响与有效事件回传",
                reason="有效率低于客户定义的目标，不能仅按浅层线索成本优化",
                evidence=[evidence_scope, f"有效率={pct(valid_rate)}%，目标={pct(target_valid_rate)}%"],
                strength="数据结论",
                metric="有效率、有效线索成本、预约率",
                observation="统一有效定义并完成无效原因枚举后复盘",
                stop_loss="线索量增加但有效率继续下降时停止扩量",
                rollback="恢复变更前的定向/素材/表单，仅回退本轮变化",
            )
        )

    effective_cpa = metrics["effective_lead_cpa"]
    if target_effective is not None and effective_cpa is not None and effective_cpa > target_effective:
        actions.append(
            action(
                priority="P1",
                field="effective_lead_cost",
                current=effective_cpa,
                proposed="以有效线索事件和无效原因作为优化与素材筛选依据",
                reason="有效线索成本高于客户目标",
                evidence=[evidence_scope, f"有效线索成本={effective_cpa}，目标={target_effective}"],
                strength="数据结论",
                metric="有效线索成本",
                observation="有效定义、回传和销售处理时效稳定后判断",
                stop_loss="回传异常或样本口径变化时暂停决策",
                rollback="恢复原优化事件并修复回传后再测试",
            )
        )

    optimization_event = str(snapshot.get("optimization_event") or "")
    feedback_status = str(snapshot.get("feedback_status") or "unknown").lower()
    if any(term in optimization_event for term in ("有效", "预约", "到店", "成交", "深度")):
        deep_count = next(
            (value for value in (deals, values["store_visits"], values["appointments"], valid_leads) if value),
            0.0,
        )
        if feedback_status not in {"healthy", "正常", "ok"} or deep_count == 0:
            actions.append(
                action(
                    priority="P0",
                    field="optimization_event",
                    current=optimization_event,
                    proposed="先核验事件定义、回传延迟与漏传；不足时评估暂退到更浅但可靠的事件",
                    reason="深层优化需要稳定且一致的回传信号",
                    evidence=[evidence_scope, f"回传状态={feedback_status}，可见深层事件量={deep_count}"],
                    strength="强推断",
                    metric="回传成功率、深层事件量、起量与有效线索成本",
                    observation="完成回传 QA 且事件口径一致后再迁移",
                    stop_loss="切换事件后仍无量或质量下降时停止继续变更",
                    rollback="恢复原事件并保留回传修复记录",
                )
            )

    search = snapshot.get("search")
    if isinstance(search, dict):
        irrelevant_share = number(search.get("irrelevant_query_share"), "account_snapshot.search.irrelevant_query_share")
        max_irrelevant = number(brief.get("max_irrelevant_query_share"), "client_brief.max_irrelevant_query_share")
        if irrelevant_share is not None and max_irrelevant is not None and irrelevant_share > max_irrelevant:
            actions.append(
                action(
                    priority="P0",
                    field="search_intent",
                    current=round(irrelevant_share, 4),
                    proposed="按品牌/品类/场景/地域/痛点拆解真实搜索词并收紧不相关意图",
                    reason="不相关搜索占比高于客户设定上限",
                    evidence=[evidence_scope, f"不相关占比={pct(irrelevant_share)}%，上限={pct(max_irrelevant)}%"],
                    strength="数据结论",
                    metric="不相关搜索占比、有效率、有效线索成本",
                    observation="使用同一搜索词分类口径比较",
                    stop_loss="流量骤降且有效线索未改善时回退",
                    rollback="恢复变更前的搜索流量选择或词包",
                )
            )

    if not actions:
        actions.append(
            action(
                priority="P1",
                field="monitoring",
                current="未发现由已提供目标直接触发的异常",
                proposed="维持现状并补齐下游有效、预约、到店、成交与回款数据",
                reason="缺少明确偏差时不主动改账户",
                evidence=[evidence_scope],
                strength="待验证假设",
                metric="有效线索成本、到店成本、成交获客成本",
                observation="补齐与媒体同口径的销售漏斗",
                stop_loss="发现数据口径或回传异常时停止优化",
                rollback="不产生账户变更",
            )
        )

    result = {
        "schema_version": 1,
        "status": "PREVIEW_ONLY",
        "requires_confirmation": True,
        "client_id": brief["client_id"],
        "client_name": brief["client_name"],
        "account_id": snapshot["account_id"],
        "account_name": snapshot["account_name"],
        "data_scope": {
            "date_range": snapshot["date_range"],
            "attribution_window": snapshot["attribution_window"],
        },
        "metrics": metrics,
        "actions": actions,
        "execution_policy": {
            "allowed_without_confirmation": ["read_page", "calculate", "draft_change_order"],
            "forbidden_without_confirmation": [
                "submit_campaign",
                "change_budget",
                "change_bid",
                "change_optimization_event",
                "pause_or_enable_campaign",
            ],
        },
    }
    confirmation_payload = {
        key: result[key]
        for key in ("client_id", "account_id", "data_scope", "metrics", "actions")
    }
    result["change_order_hash"] = hashlib.sha256(
        json.dumps(confirmation_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return result


def self_test() -> None:
    bundle = {
        "client_brief": {
            "client_id": "client-a",
            "client_name": "示例客户",
            "industry": "家装",
            "service": "装修咨询",
            "average_order_value": 50000,
            "contribution_margin_rate": 0.2,
            "target_lead_cost": 120,
            "target_effective_lead_cost": 300,
            "target_valid_rate": 0.5,
            "expected_lead_to_deal_rate": 0.05,
        },
        "account_snapshot": {
            "client_id": "client-a",
            "account_id": "account-1",
            "account_name": "示例账户",
            "date_range": {"start": "2026-08-01", "end": "2026-08-07", "timezone": "Asia/Shanghai"},
            "attribution_window": "平台当前口径",
            "spend": 2400,
            "impressions": 80000,
            "clicks": 1200,
            "leads": 12,
            "valid_leads": 4,
            "appointments": 1,
            "store_visits": 0,
            "deals": 0,
            "revenue": 0,
            "optimization_event": "有效线索",
            "feedback_status": "异常",
        },
    }
    result = diagnose(bundle)
    assert result["status"] == "PREVIEW_ONLY"
    assert result["requires_confirmation"] is True
    assert result["metrics"]["lead_cpa"] == 200.0
    assert any(item["field"] == "lead_quality" for item in result["actions"])
    assert any(item["field"] == "goal_consistency" for item in result["actions"])
    try:
        broken = json.loads(json.dumps(bundle, ensure_ascii=False))
        broken["account_snapshot"]["client_id"] = "client-b"
        diagnose(broken)
    except ValueError as exc:
        assert "cross-client" in str(exc)
    else:
        raise AssertionError("cross-client mismatch must fail")
    print("lead diagnosis self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="JSON file containing client_brief and account_snapshot")
    parser.add_argument("--output", type=Path, help="Optional path for the preview-only change order JSON")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.input:
        raise SystemExit("--input is required unless --self-test is used")
    bundle = json.loads(args.input.read_text(encoding="utf-8"))
    result = diagnose(require_object(bundle, "root"))
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
