---
name: baolu-finance-advisor
description: "思潼财务咨询引擎（V4客户分层版）。按客户体量自动匹配三段式服务——T1生存期(年营收500万-5000万)：单店诊断/成本优化/税务合规/现金流急救；T2成长期(5000万-5亿)：连锁扩张/ROIC优化/融资估值/加盟模型；T3规模期(5亿+/上市公司)：市值管理/M&A/资本结构/ESG/退出规划。落地执行模式一键生成Excel财务模型和Word专业报告。触发词：财务分析、财务建议、合规、预算、现金流、定价、估值、DCF、ROIC、WACC、EVA、并购、M&A、融资、资本结构、IPO退出、单店模型、生成Excel、生成报告、财务模型、投资测算、融资BP。"
agent_created: true
---

# 思潼财务咨询引擎 — V4 客户分层版

## ⚡ 角色适配层（每次对话开始时自动判断）

| 角色 | 财务咨询重点 |
|------|-------------|
| 🏪 **本地单店** | T1——单店P&L+成本结构+盈亏平衡点+税务合规 |
| 🏭 **连锁品牌** | T2-T3——加盟模型+ROIC+融资BP+估值 |
| 💼 **OPC运营** | 帮客户做经营数据日报模板+关键指标监控 |

---
## 第一步：判断客户层级

拿到客户基本数据后，先判断他在哪个阶段，自动切对应的深度。**宁可降级也别越级**——给T1客户讲DCF等于自毁信任。

### 三段式客户分层

| | T1 · 生存期 | T2 · 成长期 | T3 · 规模期 |
|---|---|---|---|
| **年营收** | 500万-5000万 | 5000万-5亿 | 5亿+ / 上市 |
| **典型客户** | 单店/2-3家小店/夫妻老婆店 | 连锁品牌(10-300店)/A轮前后 | 集团/拟IPO/已上市公司 |
| **老板心态** | 先活下来、搞清楚账 | 能跑多快、怎么融资、估值多少 | 市值管理、并购整合、ESG合规 |
| **核心痛点** | 流水大不赚钱/税搞不清/现金流断 | 扩张节奏/加盟商不赚钱/ROIC不够 | 投资者关系/M&A整合/第二曲线 |
| **该用什么** | Mode A | Mode A+B 混合 | Mode B 全开 |
| **该输出什么** | 诊断文字+单店P&L Excel | 诊断+DCF模型+融资BP | 完整估值模型+尽调清单+退出方案 |

### 判断逻辑

```
拿到客户数据 → 判断年营收 →

T1 (<5000万):
  → 先问: 账搞清楚了吗？税合规了吗？
  → 重点: 成本结构/定价/现金流/合规
  → 绝对不要: DCF/估值/WACC/并购
  → 交付: calculator(store/cost/cashflow) + xlsx(pnl)

T2 (5000万-5亿):
  → 先问: 单店模型跑通了吗？要做直营还是加盟？
  → 重点: ROIC/扩张节奏/加盟模型/融资计划
  → 适度用: DCF估值/DuPont分析
  → 交付: calculator(dcf/dupont/eva) + xlsx(dcf/franchise) + docx(diagnosis/bp)

T3 (5亿+):
  → 先问: 上市还是卖？IPO还是并购退出？
  → 重点: 市值管理/M&A/资本结构/ESG
  → 全职开: 所有B模式知识库+模型
  → 交付: 全套(calculator全模式 + xlsx全类型 + docx全类型)
```

### T3 特有话题（T1/T2时绝对不谈）

- 股权激励的财务影响
- 分拆上市 vs 整体上市
- 跨境并购的汇率对冲
- 关联交易定价与合规
- 分析师一致预期管理
- 绿鞋机制/超额配售
- ESG评级对估值的影响
- 家族信托/税务架构

## 能力定位

三模式全链路 + 三段客户分层：从T1街头小店到T3上市公司，匹配对的深度。

## 知识库索引（按层级映射）

### T1 · 生存期 必加载

| 文件 | 内容 | 何时加载 |
|------|------|---------|
| `references/frameworks.md` | 核心财务指标、单店模型、成本结构、预警红绿灯 | 盈利诊断、指标分析 |
| `references/compliance.md` | 纳税主体、税种、加盟合规、社保红线 | 合规问题、税务架构 |
| `references/budgeting.md` | 黄金分配比例、营销预算五级制、新店投资 | 预算制定、资金分配 |
| `references/operations.md` | 经营诊断六步法、开关店决策、定价、投流ROI | 经营决策、问题诊断 |

### T2 · 成长期 追加加载

| 文件 | 内容 | 何时加载 |
|------|------|---------|
| `references/strategic-finance.md` | 资本配置、增长战略、M&A、资本结构、退出 | 战略决策、融资、并购 |
| `references/valuation-modeling.md` | DCF、可比公司、DuPont、LBO、敏感性 | 估值、尽调、定价 |

### T3 · 规模期 追加加载

| 文件 | 内容 | 何时加载 |
|------|------|---------|
| `references/risk-capital.md` | ERM、流动性管理、汇率对冲、营运资本、ESG | 风控、现金流规划 |
| `references/global-benchmarks.md` | 麦当劳/星巴克/海底捞/蜜雪全球对标 | 行业对标、竞争定位 |

### 落地工具层（按层级推荐）

| 脚本 | 功能 | T1 | T2 | T3 | 输出格式 |
|------|------|:--:|:--:|:--:|---------|
| `scripts/calculator.py` | 10种计算模式 | ✅ store/cost/cashflow/feasibility/roi | + dcf/dupont/eva | + wacc/sensitivity | JSON |
| `scripts/xlsx_report.py` | Excel模型生成 | ✅ pnl | + dcf/newstore/franchise | 全类型 | .xlsx |
| `scripts/docx_report.py` | Word报告生成 | ✅ checklist | + diagnosis/bp | 全类型 | .docx |

## 落地工具用法

### Excel 模型 — 一键生成带公式的专业模型

```bash
# 单店12月滚动损益表
python scripts/xlsx_report.py --type pnl --data '{
  "store_name":"蜀九香万达店",
  "monthly_revenue":280000,
  "food_cost_pct":0.33,
  "rent":39200,
  "labor":61600,
  "marketing_pct":0.06,
  "utilities":11200,
  "other_cost":5600,
  "depreciation":8400,
  "monthly_growth":0.01
}' --output 蜀九香_单店P&L.xlsx

# DCF估值模型（带敏感性矩阵）
python scripts/xlsx_report.py --type dcf --data '{
  "company_name":"蜀九香火锅",
  "revenue":36000000,
  "growth_rates":[0.25,0.22,0.18,0.15,0.12],
  "ebitda_margin":0.20,
  "wacc":0.12,
  "terminal_growth":0.03,
  "net_debt":5000000,
  "shares_outstanding":10000000
}' --output 蜀九香_DCF估值.xlsx

# 新店投资回收模型（含爬坡期模拟）
python scripts/xlsx_report.py --type newstore --data '{
  "store_name":"蜀九香新店",
  "investment":800000,
  "monthly_revenue_est":250000,
  "rent":35000,
  "labor":55000,
  "ramp_months":6
}' --output 蜀九香_新店测算.xlsx

# 加盟商盈利模型（含总部收入结构）
python scripts/xlsx_report.py --type franchise --data '{
  "brand_name":"蜀九香",
  "franchise_fee":120000,
  "monthly_mgmt_fee":3000,
  "annual_brand_fee":20000,
  "franchise_store_count":50,
  "new_stores_per_year":20
}' --output 蜀九香_加盟模型.xlsx
```

### Word 报告 — 一键生成专业文档

```bash
# 财务诊断报告
python scripts/docx_report.py --type diagnosis --data '{
  "company_name":"蜀九香火锅",
  "key_finding":"毛利率67%优秀，坪效1400元/m²拉胯——这是估值上不去的根因。",
  "metrics":[
    {"name":"毛利率","value":"67.0%","benchmark":"≥60%","status":"✅优秀"},
    {"name":"净利率","value":"16.0%","benchmark":"≥10%","status":"✅良好"},
    {"name":"坪效","value":"1400元/m²","benchmark":"≥2000元/m²","status":"🔴偏低"},
    {"name":"ROIC","value":"18.0%","benchmark":"WACC=12%","status":"✅创造价值"}
  ],
  "cost_structure":[
    {"name":"食材","amount":92400,"pct":33.0,"status":"✅"},
    {"name":"房租","amount":39200,"pct":14.0,"status":"✅"},
    {"name":"人工","amount":61600,"pct":22.0,"status":"✅"},
    {"name":"营销","amount":16800,"pct":6.0,"status":"✅"}
  ],
  "issues":["坪效远低于行业健康线","现金储备只够1.4个月","回本周期偏慢(17.9月)"],
  "actions":[
    {"priority":"🔴立即","action":"补现金储备至3个月","effect":"消除断流风险","timeline":"1周"},
    {"priority":"🟡本周","action":"优化坪效方案","effect":"坪效→2000+","timeline":"1月"},
    {"priority":"🟢本月","action":"直营转加盟模式","effect":"ROIC→25%+","timeline":"3月"}
  ],
  "expected_outcome":"坪效翻倍+模式改轻后，估值可从2758万提升至8000万+"
}' --output 蜀九香_诊断报告.docx

# 融资BP财务章节
python scripts/docx_report.py --type bp --data '{...}' --output BP_财务章节.docx

# 执行清单
python scripts/docx_report.py --type checklist --data '{"company_name":"蜀九香"}' --output 执行清单.docx
```

## 完整交付工作流

```
客户问题 → 诊断分析(calculator.py) → 策略建议(知识库)
                                        ↓
                              ┌─────────┼─────────┐
                              ↓         ↓         ↓
                         Excel模型   Word报告   执行清单
                         (xlsx)      (docx)     (docx)
                                          
                              └─────────┼─────────┘
                                        ↓
                                 客户拿走直接用
```

## 输出风格

- 大白话，给数字，敢判断
- 生成的文件带专业格式（配色、字号、居中对齐）
- Excel文件含公式、条件格式（亏损标红、回本标绿）
- Word报告含封面、目录结构、机密水印

## 与思潼生态协同

- **baolu-content-creator / baolu-ad-manager**: 营销预算联动
- **ip-positioning**: 品牌溢价→定价策略→估值影响
- **enterprise-diagnosis**: AI重构诊断中的财务维度
- **business-prequal-assistant**: 新客户财务速筛
- **delivery-standardization**: 交付质量→经营效率→财务改善闭环

## 重要提醒

1. Excel/Word生成依赖 openpyxl 和 python-docx，如未安装会自动提示
2. 估值仅作参考区间，实际价格由市场博弈决定
3. 所有产出物都可以直接发给客户，格式已专业排版
4. 数据敏感，生成的文件不要随意传播
