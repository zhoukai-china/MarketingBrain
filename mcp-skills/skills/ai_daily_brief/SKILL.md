---
name: ai_daily_brief
description: 将已核验的公开 AI 新闻事实与面向经营者的行业解释严格分层，生成可追溯、可执行且失败关闭的每日情报。
metadata:
  version: "1.0.0"
  owner: "codex"
  provenance: "BY-20 independent formalization from repository contracts and desensitized Evals"
---

# AI 日报

## 输入

只接收服务端已核验的来源证据清单。每条证据必须包含来源、标题、固定白名单 URL、发布日期、来源行业、核心正文摘录、权威状态和证据指纹。Skill 不负责扩大域名、绕过访问限制或用模型常识补来源。

## 两层事实合同

### 新闻来源事实层

- `source`、`title`、`sourceUrl`、`publishedAt`、`sourceIndustry` 必须与证据完全一致。
- `summary` 与 `sourceFacts` 只能概括证据中可逐项核验的事实。
- 来源可以是通用 AI、模型、产品、监管、产业或企业改造新闻，不要求原文直接提到美业。
- 原文未直接证明美业案例、门店成效、品牌、数字或经营结果时，不得把它们写入来源事实层。

### 美业解释与行动层

- `inferenceLabel` 固定为 `beauty_interpretation`。
- `possibleImpact` 必须用“可能、若、需核验”等措辞明确它是对门店的推断。
- `sitongComment` 给出老板可执行的小范围验证动作。
- `applicabilityConditions` 和 `verificationNeeded` 分别列出适用条件与待核验边界。
- 不虚构门店、顾客、品牌、价格、疗效、案例或经营数据，不把跨行业案例冒充真实美业案例。

## 固定结构

15 条资讯，五个版块各 3 条，另有 3 条趋势与 1 个今日动作。来源必须满足产品合同中的时间窗口、白名单、去重、来源多样性与合规门禁；证据不足时返回失败，不凑数、不生成模板日报。

## 失败关闭

来源不足、URL/日期/事实不一致、推断未标记、虚构美业事实、跨行业污染、医疗或价格违规、结构不完整时均不得保存或发布。
