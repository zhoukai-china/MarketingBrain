# 多客户线索投放数据接口

## 基本原则

- 所有对象必须携带 `client_id`；`ClientBrief` 与 `AccountSnapshot` 不一致时拒绝分析。
- 金额使用人民币元，比例使用 0 到 1，日期必须带时区和归因窗口。
- 页面读取、用户上传和手工输入都先转成这些接口，再生成结论。
- 客户数据只在当前任务范围使用，不跨客户复用预算、素材、门店或经验阈值。

## ClientBrief

必填：`client_id`、`client_name`、`industry`、`service`。

建议字段：`allowed_account_ids`、`cities`、`stores`、`daily_budget`、`bid_value`、`average_order_value`、`contribution_margin_rate`、`target_lead_cost`、`target_effective_lead_cost`、`target_valid_rate`、`expected_lead_to_deal_rate`、`collection_rate`、`optimization_event`、`qualification_definition`、`credentials_status`、`creative_assets`、`conversion_path`、`service_area`、`schedule`。

自动建计划还需要 `AccountIdentity`：`client_id`、`account_id`、`account_name`、账户页面已确认的 `capabilities`，以及可选的主体、门店和抖音号。账户不在 `allowed_account_ids` 时拒绝生成可填写草案。

## AccountSnapshot

必填：`client_id`、`account_id`、`account_name`、`date_range.start`、`date_range.end`、`date_range.timezone`、`attribution_window`。

核心字段：`spend`、`impressions`、`clicks`、`leads`、`valid_leads`、`appointments`、`store_visits`、`deals`、`revenue`、`optimization_event`、`feedback_status`。

可选字段：`campaigns`、`creatives`、`search`、`invalid_reasons`、`previous_period`。任何字段缺失都要写进诊断限制，不从模糊页面猜精确值。

## ChangeOrder

必须包含：`status=PREVIEW_ONLY`、`requires_confirmation=true`、客户与账户身份、数据范围、指标、动作列表和执行策略。

每个动作包含：`priority`、`classification`、`root_cause_strength`、`field`、`current`、`proposed`、`reason`、`evidence`、`expected_metric`、`observation_condition`、`stop_loss`、`rollback`。

ChangeOrder 是预览，不等于执行授权。用户确认只覆盖当前展示的账户、字段和批次；内容变化后必须重新确认。

## ExecutionReceipt

提交或变更后记录：`executed_at`、`client_id`、`account_id`、`confirmed_change_order_hash`、`executed_actions`、`page_result`、`failed_actions`、`verification_evidence`、`remaining_risks`。

如果页面结果无法二次读取，回执状态必须为 `UNVERIFIED`，不能声称执行成功。

## 示例输入

```json
{
  "client_brief": {
    "client_id": "client-a",
    "client_name": "示例客户",
    "industry": "家装",
    "service": "装修咨询",
    "daily_budget": 500,
    "average_order_value": 50000,
    "contribution_margin_rate": 0.2,
    "target_lead_cost": 120,
    "target_effective_lead_cost": 300,
    "target_valid_rate": 0.5,
    "expected_lead_to_deal_rate": 0.05
  },
  "account_snapshot": {
    "client_id": "client-a",
    "account_id": "account-1",
    "account_name": "示例账户",
    "date_range": {
      "start": "2026-08-01",
      "end": "2026-08-07",
      "timezone": "Asia/Shanghai"
    },
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
    "feedback_status": "异常"
  }
}
```

使用 `python scripts/diagnose_lead_account.py --input input.json` 生成诊断变更单；使用 `python scripts/build_lead_plan.py --input input.json` 生成计划草案。两个脚本都不会访问或修改广告账户。
