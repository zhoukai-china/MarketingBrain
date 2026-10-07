"""
服务端计算器（数值类技能专用）
================================

为什么需要：大模型做多步算术不可靠，且会把「自我修正过程」写进交付物
（出现过：表格写 57,800，下面明细算 59,050，两套数字打架）。
凡是涉及金额、回本周期、ROI、占比的技能，一律服务端算好，
把结果注入 prompt，模型只负责解读与排版，不负责算数。

计算器注册在 CALCULATORS 字典，key 与 skill_packs/*.json 的 calculator 字段对应。
"""
import re
from typing import Dict

# 行业默认参数（用户未提供时使用）
# goods_rate: 货品/食材成本占营收比；rent_rate/labor_rate/misc_rate: 各项占营收比
INDUSTRY_DEFAULTS = {
    "美业": {"goods_rate": 25, "rent_rate": 12, "labor_rate": 22, "misc_rate": 3, "marketing_rate": 5},
    "美容": {"goods_rate": 25, "rent_rate": 12, "labor_rate": 22, "misc_rate": 3, "marketing_rate": 5},
    "皮肤": {"goods_rate": 25, "rent_rate": 12, "labor_rate": 22, "misc_rate": 3, "marketing_rate": 5},
    "餐饮": {"goods_rate": 38, "rent_rate": 10, "labor_rate": 20, "misc_rate": 4, "marketing_rate": 5},
    "快餐": {"goods_rate": 38, "rent_rate": 10, "labor_rate": 20, "misc_rate": 4, "marketing_rate": 5},
    "火锅": {"goods_rate": 40, "rent_rate": 10, "labor_rate": 20, "misc_rate": 4, "marketing_rate": 5},
    "茶饮": {"goods_rate": 35, "rent_rate": 12, "labor_rate": 18, "misc_rate": 3, "marketing_rate": 5},
    "烘焙": {"goods_rate": 35, "rent_rate": 12, "labor_rate": 20, "misc_rate": 4, "marketing_rate": 5},
    "零售": {"goods_rate": 62, "rent_rate": 12, "labor_rate": 12, "misc_rate": 3, "marketing_rate": 4},
    "便利": {"goods_rate": 70, "rent_rate": 10, "labor_rate": 10, "misc_rate": 3, "marketing_rate": 3},
    "教培": {"goods_rate": 5, "rent_rate": 18, "labor_rate": 32, "misc_rate": 4, "marketing_rate": 6},
    "汽修": {"goods_rate": 45, "rent_rate": 12, "labor_rate": 22, "misc_rate": 3, "marketing_rate": 4},
    "健身": {"goods_rate": 5, "rent_rate": 18, "labor_rate": 30, "misc_rate": 5, "marketing_rate": 6},
}
GENERIC_DEFAULT = {"goods_rate": 40, "rent_rate": 12, "labor_rate": 20, "misc_rate": 4, "marketing_rate": 5}


def _num(v, default=0.0) -> float:
    """把用户输入转成数字，支持「12万」「1.2w」「120000」等写法。"""
    if v is None:
        return default
    s = str(v).strip().replace(",", "").replace("，", "")
    if not s:
        return default
    mult = 1.0
    if s.endswith("万") or s.lower().endswith("w"):
        mult = 10000.0
        s = s[:-1]
    elif s.endswith("k") or s.lower().endswith("k"):
        mult = 1000.0
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return default


_NUM_PAT = re.compile(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?")


def _sum_num(v, default=0.0) -> float:
    """把「抖音投流4万，展会2万，人力6万」这类复合金额求和。

    单数字场景与 _num 行为一致；多数字场景按各单位换算后求和。
    用于成本、成交额这类用户习惯分项罗列的字段。
    """
    if v is None:
        return default
    s = str(v).strip()
    if not s:
        return default
    hits = _NUM_PAT.findall(s)
    if not hits:
        return default
    total = 0.0
    for raw, unit in hits:
        try:
            val = float(raw)
        except ValueError:
            continue
        if unit in ("万", "w", "W"):
            val *= 10000.0
        elif unit in ("k", "K"):
            val *= 1000.0
        total += val
    return total


def _pick_defaults(industry: str) -> dict:
    for key, val in INDUSTRY_DEFAULTS.items():
        if key in (industry or ""):
            return dict(val), key
    return dict(GENERIC_DEFAULT), "通用"


def calc_invest_return(inputs: Dict[str, str]) -> dict:
    """单店投资回报测算：服务端算数，返回结构化结果。"""
    industry = inputs.get("industry", "") or ""
    defaults, matched = _pick_defaults(industry)

    invest = _num(inputs.get("invest"))
    revenue = _num(inputs.get("revenue"))
    area = inputs.get("area", "") or ""

    # 固定成本：用户给了具体值就用，否则按行业占比推算
    rent_given = _num(inputs.get("rent"), -1)
    labor_given = _num(inputs.get("labor"), -1)
    misc_given = _num(inputs.get("misc"), -1)

    goods_rate = _num(inputs.get("goods_rate"), defaults["goods_rate"])
    marketing_rate = _num(inputs.get("marketing_rate"), defaults["marketing_rate"])

    rent = rent_given if rent_given >= 0 else revenue * defaults["rent_rate"] / 100
    labor = labor_given if labor_given >= 0 else revenue * defaults["labor_rate"] / 100
    misc = misc_given if misc_given >= 0 else revenue * defaults["misc_rate"] / 100

    depreciation = invest / 36.0 if invest else 0.0  # 3 年直线摊销

    assumptions = []
    if rent_given < 0:
        assumptions.append(f"月房租未提供，按行业默认占营收 {defaults['rent_rate']}% 测算")
    if labor_given < 0:
        assumptions.append(f"月人工未提供，按行业默认占营收 {defaults['labor_rate']}% 测算")
    if misc_given < 0:
        assumptions.append(f"水电杂费未提供，按行业默认占营收 {defaults['misc_rate']}% 测算")
    assumptions.append(f"货品/食材成本率 {goods_rate}%（{'用户输入' if inputs.get('goods_rate') else '行业默认'}）")
    assumptions.append(f"营销费率 {marketing_rate}%（占营收）")
    assumptions.append(f"折旧摊销按 3 年直线法：{round(depreciation)} 元/月")
    assumptions.append(f"行业参数匹配：{matched}")

    def scenario(rev_mult: float, name: str) -> dict:
        rev = revenue * rev_mult
        goods = rev * goods_rate / 100
        marketing = rev * marketing_rate / 100
        total_cost = goods + rent + labor + misc + marketing + depreciation
        profit = rev - total_cost
        payback = round(invest / profit, 1) if profit > 0 else None
        roi = round(profit * 12 / invest * 100, 1) if invest > 0 else None
        return {
            "name": name,
            "revenue": round(rev),
            "goods": round(goods),
            "rent": round(rent),
            "labor": round(labor),
            "misc": round(misc),
            "marketing": round(marketing),
            "depreciation": round(depreciation),
            "total_cost": round(total_cost),
            "profit": round(profit),
            "margin": round(profit / rev * 100, 1) if rev else 0,
            "payback_months": payback,
            "roi_annual": roi,
        }

    base = scenario(1.0, "基准")
    return {
        "industry": industry,
        "store_type": inputs.get("store_type", "") or "",
        "area": area,
        "invest_total": round(invest),
        "revenue_month": round(revenue),
        "deposit_suggest": round((base["total_cost"]) * 3),
        "base": base,
        "conservative": scenario(0.8, "保守（-20%营收）"),
        "optimistic": scenario(1.2, "乐观（+20%营收）"),
        "assumptions": assumptions,
        "note": inputs.get("note", "") or "",
    }


# ---------------------------------------------------------------------------
# 通用表格统计器：把用户粘贴的 CSV / TSV / Markdown 表格算成确定性的聚合结果，
# 避免模型对多行数据做心算导致数字前后不一致。
# ---------------------------------------------------------------------------

_DATE_KEYS = ("日期", "时间", "date", "day", "下单时间", "到店日期")
# 每对 = (分母关键词, 分子关键词)，前者是漏斗上游，后者是转化结果
_RATE_HINTS = (
    ("到店", "成交"), ("进店", "成交"), ("咨询", "成交"), ("线索", "成交"),
    ("曝光", "咨询"), ("播放", "咨询"),     ("访问", "下单"), ("加微", "成交"), ("到店组数", "成交单数"),
)


def _split_rows(text: str):
    """把粘贴的表格文本切成二维列表，自动识别分隔符。"""
    lines = [ln.rstrip() for ln in text.strip().splitlines()]
    lines = [ln.strip().strip("|").strip() for ln in lines if ln.strip()]
    # 去掉 Markdown 分隔行
    lines = [ln for ln in lines if not set(ln.replace("|", "").replace("-", "").replace(":", "").strip()) == set()]
    if len(lines) < 2:
        return [], []
    delim = "\t" if lines[0].count("\t") >= 1 else ("|" if "|" in lines[0] else ("," if "," in lines[0] else None))
    if delim is None:
        return [], []
    rows = [[c.strip() for c in ln.split(delim)] for ln in lines]
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    return rows[0], rows[1:]


def _is_num(v: str) -> bool:
    v = (v or "").strip().replace(",", "").replace("¥", "").replace("%", "")
    if not v:
        return False
    try:
        float(v)
        return True
    except ValueError:
        return False


def _f(v: str) -> float:
    return float((v or "0").strip().replace(",", "").replace("¥", "").replace("%", "") or 0)


def calc_table_stats(inputs: Dict[str, str]) -> dict:
    """通用表格统计：列聚合 + 按日期分组 + 常见转化率。"""
    raw = ""
    for key in ("data", "table", "csv", "rows"):
        if inputs.get(key):
            raw = inputs[key]
            break
    header, rows = _split_rows(raw)
    if not header:
        return {"ok": False, "row_count": 0, "columns": [], "reason": "未识别到表格（请用逗号/制表符/竖线分隔，首行为表头）"}

    n = len(rows)
    cols = []
    for i, name in enumerate(header):
        vals = [r[i] if i < len(r) else "" for r in rows]
        nums = [_f(v) for v in vals if _is_num(v)]
        col = {"name": name or f"列{i+1}", "index": i, "numeric": len(nums) >= max(1, n * 0.6), "sample": vals[:3]}
        if col["numeric"] and nums:
            col.update({
                "count": len(nums),
                "sum": round(sum(nums), 2),
                "mean": round(sum(nums) / len(nums), 2),
                "min": round(min(nums), 2),
                "max": round(max(nums), 2),
            })
        cols.append(col)

    # 按日期列分组（若存在）
    daily = []
    date_col = next((c for c in cols if any(k in c["name"].lower() for k in _DATE_KEYS)), None)
    if date_col:
        buckets: Dict[str, list] = {}
        for r in rows:
            d = (r[date_col["index"]] if date_col["index"] < len(r) else "").strip()[:10]
            if not d:
                continue
            buckets.setdefault(d, []).append(r)
        for d in sorted(buckets)[:60]:
            item = {"date": d, "rows": len(buckets[d])}
            for c in cols:
                if c["numeric"] and c["index"] != date_col["index"]:
                    nums = [_f(r[c["index"]]) for r in buckets[d] if c["index"] < len(r) and _is_num(r[c["index"]])]
                    if nums:
                        item[c["name"]] = round(sum(nums), 2)
            daily.append(item)

    # 常见转化率：分子/分母列都存在时计算
    rates = []
    seen = set()
    for den_kw, num_kw in _RATE_HINTS:
        den = next((c for c in cols if den_kw in c["name"] and c["numeric"]), None)
        num = next((c for c in cols if num_kw in c["name"] and c["numeric"]), None)
        if not den or not num or den is num or not den["sum"]:
            continue
        key = (den["index"], num["index"])
        if key in seen:
            continue
        seen.add(key)
        rates.append({
            "name": f"{num['name']}率（{num['name']} ÷ {den['name']}）",
            "numerator": num["sum"],
            "denominator": den["sum"],
            "rate": round(num["sum"] / den["sum"] * 100, 2),
        })

    # 分组统计：低基数文本列（门店/渠道/员工/品类等）逐组聚合，服务多店对比
    groups = []
    for c in cols:
        if c["numeric"] or c is date_col:
            continue
        vals = [r[c["index"]] if c["index"] < len(r) else "" for r in rows]
        keys = [v for v in vals if v]
        distinct = sorted(set(keys))
        if not (2 <= len(distinct) <= 15):
            continue
        numcols = [x for x in cols if x.get("numeric")]
        if not numcols:
            continue
        items = []
        for g in distinct:
            grow = [r for r in rows if (r[c["index"]] if c["index"] < len(r) else "") == g]
            item = {"group": g, "rows": len(grow)}
            for nc in numcols:
                nums = [_f(r[nc["index"]]) for r in grow
                        if nc["index"] < len(r) and _is_num(r[nc["index"]])]
                if nums:
                    item[nc["name"]] = round(sum(nums), 2)
            # 组内转化率
            for den_kw, num_kw in _RATE_HINTS:
                dn = next((x for x in numcols if den_kw in x["name"]), None)
                nm = next((x for x in numcols if num_kw in x["name"]), None)
                if dn and nm and dn is not nm and item.get(dn["name"]):
                    item[f"{nm['name']}率"] = round(item[nm["name"]] / item[dn["name"]] * 100, 2)
                break  # 只算第一个命中的漏斗，避免表格过宽
            items.append(item)
        groups.append({"by": c["name"], "items": items})

    return {"ok": True, "row_count": n, "columns": cols, "daily": daily,
            "rates": rates, "groups": groups}


def format_table_stats(result: dict) -> str:
    lines = []
    if not result.get("ok"):
        return "【服务端统计】" + result.get("reason", "无有效数据")
    lines.append(f"【服务端统计】共识别 {result['row_count']} 行数据，以下为确定性计算结果，直接引用，不要重算。")
    lines.append("")
    lines.append("列聚合：")
    lines.append("| 列名 | 有效数值数 | 合计 | 平均 | 最小 | 最大 |")
    lines.append("|---|---|---|---|---|---|")
    for c in result["columns"]:
        if c.get("numeric"):
            lines.append(f"| {c['name']} | {c['count']} | {c['sum']} | {c['mean']} | {c['min']} | {c['max']} |")
        else:
            lines.append(f"| {c['name']} | — | 文本列（样例：{'/'.join(x for x in c['sample'] if x)[:40]}） | — | — | — |")
    lines.append("")
    if result.get("rates"):
        lines.append("转化率（服务端计算）：")
        for r in result["rates"]:
            lines.append(f"- {r['name']} = {r['numerator']} / {r['denominator']} = {r['rate']}%")
        lines.append("")
    if result.get("groups"):
        for g in result["groups"]:
            items = g["items"]
            keys = [k for k in items[0].keys() if k not in ("group", "rows")]
            lines.append(f"按「{g['by']}」分组（共 {len(items)} 组）：")
            lines.append("| {} | 行数 | {} |".format(g["by"], " | ".join(keys)))
            lines.append("|---|---|" + "---|" * len(keys))
            for item in items:
                lines.append("| {} | {} | {} |".format(
                    item["group"], item["rows"],
                    " | ".join(str(item.get(k, "")) for k in keys)))
            lines.append("")
    if result.get("daily"):
        d = result["daily"]
        lines.append(f"按日期分组（共 {len(d)} 天，最多展示 60 天）：")
        keys = [k for k in d[0].keys() if k not in ("date", "rows")]
        lines.append("| 日期 | 行数 | " + " | ".join(keys) + " |")
        lines.append("|---|---|" + "---|" * len(keys))
        for item in d:
            lines.append("| {} | {} | {} |".format(
                item["date"], item["rows"], " | ".join(str(item.get(k, "")) for k in keys)))
        lines.append("")
        if len(d) >= 3:
            vals = [item["rows"] for item in d]
            first7 = sum(vals[:7]) / 7 if len(vals) >= 7 else sum(vals) / len(vals)
            allavg = sum(vals) / len(vals)
            lines.append(f"- 前期7天日均行数：{round(first7, 2)}；全期日均行数：{round(allavg, 2)}")
            if allavg:
                lines.append(f"- 客流健康度（前7日均 / 全期日均）= {round(first7 / allavg, 3)}（>1.1 上升，0.9-1.1 平稳，<0.9 下降）")
            lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 经营财务体检：单店/连锁通用的 P&L、费用率健康度、盈亏平衡点、现金安全、
# 回本周期与年化 ROI。同样服务端算好，模型只解读。
# ---------------------------------------------------------------------------

# 费用率健康区间（占营收 %）：(优, 良, 黄上限)
_HEALTH_RANGES = {
    "rent": (10, 15, 20),
    "labor": (22, 25, 30),
    "marketing": (8, 12, 16),
    "misc": (3, 5, 8),
}


def _grade(value: float, good: float, ok: float, warn: float, lower_better: bool = True) -> str:
    if lower_better:
        if value <= good:
            return "✅优"
        if value <= ok:
            return "✅良"
        if value <= warn:
            return "🟡偏高"
        return "🔴超标"
    if value >= good:
        return "✅优"
    if value >= ok:
        return "✅良"
    if value >= warn:
        return "🟡偏低"
    return "🔴危险"


def calc_finance_diag(inputs: Dict[str, str]) -> dict:
    industry = inputs.get("industry", "") or ""
    defaults, matched = _pick_defaults(industry)

    revenue = _num(inputs.get("revenue"))
    stores = max(1, int(_num(inputs.get("store_count"), 1) or 1))
    invest = _num(inputs.get("invest"))
    cash = _num(inputs.get("cash"))

    goods_rate = _num(inputs.get("goods_rate"), defaults["goods_rate"]) if inputs.get("goods_rate") else defaults["goods_rate"]
    rent_given = _num(inputs.get("rent"), -1)
    labor_given = _num(inputs.get("labor"), -1)
    marketing_given = _num(inputs.get("marketing"), -1)
    misc_given = _num(inputs.get("misc"), -1)

    goods = revenue * goods_rate / 100
    rent = rent_given if rent_given >= 0 else revenue * defaults["rent_rate"] / 100
    labor = labor_given if labor_given >= 0 else revenue * defaults["labor_rate"] / 100
    marketing = marketing_given if marketing_given >= 0 else revenue * defaults["marketing_rate"] / 100
    misc = misc_given if misc_given >= 0 else revenue * defaults["misc_rate"] / 100
    depreciation = invest / 36.0 if invest else 0.0

    fixed = rent + labor + marketing + misc + depreciation
    gross = revenue - goods
    gross_margin = (gross / revenue * 100) if revenue else 0
    total_cost = goods + rent + labor + marketing + misc + depreciation
    profit = revenue - total_cost
    margin = (profit / revenue * 100) if revenue else 0

    def pct(x: float) -> float:
        return round(x / revenue * 100, 1) if revenue else 0.0

    def scen(mult: float, name: str) -> dict:
        """营收变动情景：货成本随营收同比例变动，其余视为固定。"""
        rev = revenue * mult
        g = rev * goods_rate / 100
        tc = g + rent + labor + marketing + misc + depreciation
        p = rev - tc
        return {
            "name": name,
            "revenue": round(rev),
            "total_cost": round(tc),
            "profit": round(p),
            "margin": round(p / rev * 100, 1) if rev else 0,
            "payback_months": round(invest / p, 1) if (p > 0 and invest) else None,
        }

    base = scen(1.0, "基准")
    healthy_gross = 100 - defaults["goods_rate"]

    checks = [
        {"name": "毛利率", "value": f"{round(gross_margin, 1)}%",
         "benchmark": f"≥{healthy_gross}%（行业默认成本率 {defaults['goods_rate']}%）",
         "status": _grade(gross_margin, healthy_gross, healthy_gross - 5, healthy_gross - 10, False)},
        {"name": "房租占比", "value": f"{pct(rent)}%",
         "benchmark": "≤15%", "status": _grade(pct(rent), *_HEALTH_RANGES["rent"])},
        {"name": "人工占比", "value": f"{pct(labor)}%",
         "benchmark": "≤25%", "status": _grade(pct(labor), *_HEALTH_RANGES["labor"])},
        {"name": "营销占比", "value": f"{pct(marketing)}%",
         "benchmark": "≤12%", "status": _grade(pct(marketing), *_HEALTH_RANGES["marketing"])},
        {"name": "水电杂费占比", "value": f"{pct(misc)}%",
         "benchmark": "≤5%", "status": _grade(pct(misc), *_HEALTH_RANGES["misc"])},
        {"name": "净利率", "value": f"{round(margin, 1)}%",
         "benchmark": "≥10%", "status": _grade(margin, 15, 10, 5, False)},
    ]

    breakeven = round(fixed / (gross_margin / 100), 0) if gross_margin > 0 else None
    cash_months = round(cash / total_cost, 1) if total_cost else None
    cash_months_fixed = round(cash / fixed, 1) if fixed else None
    target_revenue = round((fixed + _num(inputs.get("target_profit"))) / (gross_margin / 100), 0) if (gross_margin > 0 and inputs.get("target_profit")) else None

    assumptions = []
    if not inputs.get("goods_rate"):
        assumptions.append(f"货品/食材成本率未提供，按行业默认 {defaults['goods_rate']}% 测算（行业匹配：{matched}）")
    else:
        assumptions.append(f"货品/食材成本率 {goods_rate}%（用户输入），行业参考 {defaults['goods_rate']}%（{matched}）")
    if rent_given < 0:
        assumptions.append(f"房租未提供，按行业默认占营收 {defaults['rent_rate']}% 测算")
    if labor_given < 0:
        assumptions.append(f"人工未提供，按行业默认占营收 {defaults['labor_rate']}% 测算")
    if marketing_given < 0:
        assumptions.append(f"营销费未提供，按行业默认占营收 {defaults['marketing_rate']}% 测算")
    if misc_given < 0:
        assumptions.append(f"水电杂费未提供，按行业默认占营收 {defaults['misc_rate']}% 测算")
    if invest:
        assumptions.append(f"折旧摊销按 3 年直线法：{round(depreciation)} 元/月")
    assumptions.append("房租/人工/营销/杂费/折旧视为固定成本，货品成本随营收同比例变动")

    return {
        "industry": industry, "store_count": stores,
        "revenue": round(revenue), "invest": round(invest), "cash": round(cash),
        "goods": round(goods), "rent": round(rent), "labor": round(labor),
        "marketing": round(marketing), "misc": round(misc),
        "depreciation": round(depreciation), "fixed": round(fixed),
        "gross": round(gross), "gross_margin": round(gross_margin, 1),
        "total_cost": round(total_cost), "profit": round(profit), "margin": round(margin, 1),
        "pct": {"goods": pct(goods), "rent": pct(rent), "labor": pct(labor),
                "marketing": pct(marketing), "misc": pct(misc),
                "depreciation": pct(depreciation), "cost": pct(total_cost)},
        "checks": checks,
        "breakeven_revenue": breakeven,
        "cash_months": cash_months, "cash_months_fixed": cash_months_fixed,
        "target_revenue": target_revenue,
        "per_store_revenue": round(revenue / stores),
        "per_store_profit": round(profit / stores),
        "payback_months": round(invest / profit, 1) if (profit > 0 and invest) else None,
        "roi_annual": round(profit * 12 / invest * 100, 1) if invest else None,
        "base": base, "conservative": scen(0.8, "保守（-20%营收）"),
        "optimistic": scen(1.2, "乐观（+20%营收）"),
        "assumptions": assumptions,
    }


def format_finance_diag(r: dict) -> str:
    L = []
    L.append("【服务端财务体检】以下数字已由服务端算好，直接引用、照抄进交付物，严禁自行重算或改写。")
    L.append("")
    L.append("一、损益表（月度，单位：元）：")
    L.append("| 科目 | 金额 | 占营收比 |")
    L.append("|---|---|---|")
    L.append(f"| 营业收入 | {r['revenue']} | 100% |")
    L.append(f"| 货品/食材成本 | {r['goods']} | {r['pct']['goods']}% |")
    L.append(f"| 毛利 | {r['gross']} | {r['gross_margin']}% |")
    L.append(f"| 房租 | {r['rent']} | {r['pct']['rent']}% |")
    L.append(f"| 人工 | {r['labor']} | {r['pct']['labor']}% |")
    L.append(f"| 营销 | {r['marketing']} | {r['pct']['marketing']}% |")
    L.append(f"| 水电杂费 | {r['misc']} | {r['pct']['misc']}% |")
    L.append(f"| 折旧摊销 | {r['depreciation']} | {r['pct']['depreciation']}% |")
    L.append(f"| 总成本 | {r['total_cost']} | {r['pct']['cost']}% |")
    L.append(f"| 净利 | {r['profit']} | {r['margin']}% |")
    L.append("")
    L.append("二、健康度体检（服务端判定）：")
    L.append("| 指标 | 实际 | 健康线 | 判定 |")
    L.append("|---|---|---|---|")
    for c in r["checks"]:
        L.append(f"| {c['name']} | {c['value']} | {c['benchmark']} | {c['status']} |")
    L.append("")
    L.append("三、关键结论数字：")
    annual = r["revenue"] * 12
    tier = "T1 生存期（年营收 <5000万，讲成本/现金流/合规）" if annual < 50_000_000 else (
        "T2 成长期（年营收 5000万-5亿，加讲 ROIC/扩张节奏/加盟模型）" if annual < 500_000_000 else
        "T3 规模期（年营收 5亿+，加讲资本结构/并购/退出）")
    L.append(f"- 年化营收（月营收×12）：{annual} 元 → 客户分层：{tier}")
    L.append(f"- 固定成本合计：{r['fixed']} 元/月")
    L.append(f"- 盈亏平衡月营收：{r['breakeven_revenue'] if r['breakeven_revenue'] else '毛利为负，无平衡点'} 元"
             + (f"（当前营收是平衡点的 {round(r['revenue'] / r['breakeven_revenue'], 2)} 倍）" if r["breakeven_revenue"] else ""))
    if r["cash"]:
        L.append(f"- 账上现金 {r['cash']} 元：按全成本可撑 {r['cash_months']} 个月，按固定成本可撑 {r['cash_months_fixed']} 个月")
    if r["store_count"] > 1:
        L.append(f"- 店均月营收 {r['per_store_revenue']} 元，店均月净利 {r['per_store_profit']} 元（共 {r['store_count']} 家店）")
    if r["invest"]:
        L.append(f"- 总投入 {r['invest']} 元，月净利 {r['profit']} 元 → 静态回本 "
                 f"{r['payback_months'] if r['payback_months'] else '不回本'} 个月，年化 ROI "
                 f"{r['roi_annual'] if r['roi_annual'] is not None else '—'}%")
    if r["target_revenue"]:
        L.append(f"- 要做到目标月净利，月营收需达到 {r['target_revenue']} 元")
    L.append("")
    L.append("四、营收敏感性（服务端计算）：")
    L.append("| 情景 | 月营收 | 总成本 | 净利 | 净利率 | 回本周期(月) |")
    L.append("|---|---|---|---|---|---|")
    for key in ("conservative", "base", "optimistic"):
        s = r[key]
        L.append(f"| {s['name']} | {s['revenue']} | {s['total_cost']} | {s['profit']} | {s['margin']}% | "
                 f"{s['payback_months'] if s['payback_months'] else '不回本'} |")
    L.append("")
    L.append("五、测算假设（必须在交付物中如实呈现）：")
    for a in r["assumptions"]:
        L.append(f"- {a}")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# 销售漏斗复盘：逐层转化率、最大漏点、整体健康度、CAC 与 ROI。
# ---------------------------------------------------------------------------

_FUNNEL_LABELS = {
    "招商": ["曝光", "建联", "价值传递", "意向确认", "考察邀约", "签约成交"],
    "加盟": ["曝光", "建联", "价值传递", "意向确认", "考察邀约", "签约成交"],
    "本地": ["曝光", "咨询", "到店体验", "成交", "复购"],
    "到店": ["曝光", "咨询", "到店体验", "成交", "复购"],
}


def _parse_funnel(text: str, scene: str) -> list:
    """把「曝光12000 → 建联800 → 意向210 → 签约32」解析成 [(标签, 数值), ...]。"""
    import re
    tokens = [t for t in re.split(r"[→\->|,，\n;；]+", text or "") if t.strip()]
    out = []
    for t in tokens:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?", t)
        if not m:
            continue
        val = float(m.group(1))
        unit = (m.group(2) or "").lower()
        if unit in ("万", "w"):
            val *= 10000
        elif unit == "k":
            val *= 1000
        label = re.sub(r"\d+(?:\.\d+)?\s*(?:万|w|W|k|K)?", "", t).strip(" ：:==")
        out.append((label, val))
    labels = None
    for key, vals in _FUNNEL_LABELS.items():
        if key in (scene or ""):
            labels = vals
            break
    return [(lab or (labels[i] if labels and i < len(labels) else f"阶段{i + 1}"), v)
            for i, (lab, v) in enumerate(out)]


def calc_funnel(inputs: Dict[str, str]) -> dict:
    scene = inputs.get("scene", "") or ""
    levels = _parse_funnel(inputs.get("funnel", ""), scene)
    if len(levels) < 2:
        return {"ok": False, "reason": "漏斗数据不足两层，无法计算（请用「阶段名数字 → 阶段名数字」的形式填写）"}

    overall = levels[-1][1] / levels[0][1] * 100 if levels[0][1] else 0
    if any(k in scene for k in ("招商", "加盟")):
        good, ok = 3.0, 1.0
    elif any(k in scene for k in ("本地", "到店")):
        good, ok = 15.0, 5.0
    else:
        good, ok = 5.0, 2.0
    health = "🟢健康" if overall >= good else ("🟡注意" if overall >= ok else "🔴危险")

    steps = []
    for i in range(len(levels) - 1):
        cur, nxt = levels[i], levels[i + 1]
        rate = nxt[1] / cur[1] * 100 if cur[1] else 0
        steps.append({
            "step": f"{cur[0]}→{nxt[0]}",
            "before": round(cur[1]), "after": round(nxt[1]),
            "rate": round(rate, 2), "drop": round(cur[1] - nxt[1]),
            "drop_pct": round((1 - nxt[1] / cur[1]) * 100, 2) if cur[1] else 0,
        })

    biggest = max(steps, key=lambda s: s["drop"]) if steps else None
    worst = min(steps, key=lambda s: s["rate"]) if steps else None

    deals = _num(inputs.get("deals")) or levels[-1][1]
    cost = _sum_num(inputs.get("cost"))
    amount = _sum_num(inputs.get("deal_amount"))
    cac = round(cost / deals, 1) if (cost and deals) else None
    revenue = deals * amount if amount else 0
    roi = round(revenue / cost, 2) if (cost and revenue) else None

    return {"ok": True, "scene": scene, "levels": [(l, round(v)) for l, v in levels],
            "steps": steps, "overall": round(overall, 2), "health": health,
            "biggest_leak": biggest, "worst_rate": worst,
            "deals": round(deals), "cac": cac, "roi": roi,
            "cost": round(cost), "amount": round(amount), "revenue": round(revenue)}


def format_funnel(r: dict) -> str:
    if not r.get("ok"):
        return "【服务端漏斗计算】" + r.get("reason", "无有效数据")
    L = ["【服务端漏斗计算】以下为确定性结果，直接引用，不要重算。", ""]
    L.append("| 层级 | 数量 |")
    L.append("|---|---|")
    for name, v in r["levels"]:
        L.append(f"| {name} | {v} |")
    L.append("")
    L.append("| 转化环节 | 进入 | 流出 | 转化率 | 流失量 | 流失率 |")
    L.append("|---|---|---|---|---|---|")
    for s in r["steps"]:
        L.append(f"| {s['step']} | {s['before']} | {s['after']} | {s['rate']}% | {s['drop']} | {s['drop_pct']}% |")
    L.append("")
    L.append(f"- 整体转化率（{r['levels'][0][0]}→{r['levels'][-1][0]}）：{r['overall']}% → {r['health']}")
    if r["biggest_leak"]:
        b = r["biggest_leak"]
        L.append(f"- **最大漏点**：{b['step']}，流失 {b['drop']} 条（占该层 {b['drop_pct']}%）")
    if r["worst_rate"] and r["worst_rate"] is not r["biggest_leak"]:
        w = r["worst_rate"]
        L.append(f"- **转化率最低环节**：{w['step']}，仅 {w['rate']}%")
    if r["cac"] is not None:
        L.append(f"- 总投入 {r['cost']} 元 / 成交 {r['deals']} 单 → CAC = {r['cac']} 元/单")
    if r["revenue"]:
        L.append(f"- 成交总额 = 单笔 {r['amount']} 元 × {r['deals']} 单 = {r['revenue']} 元")
    if r["roi"] is not None:
        L.append(f"- 销售 ROI = 成交总额 {r['revenue']} ÷ 投入 {r['cost']} = {r['roi']} 倍")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# 投流账户诊断：消耗 → 展现 → 点击 → 线索 → 成交 全链路指标与保本线
# ---------------------------------------------------------------------------

def calc_ad_diag(inputs: Dict[str, str]) -> dict:
    spend = _sum_num(inputs.get("spend"))
    imp = _sum_num(inputs.get("impressions"))
    clicks = _sum_num(inputs.get("clicks"))
    leads = _sum_num(inputs.get("leads"))
    deals = _sum_num(inputs.get("deals"))
    aov = _sum_num(inputs.get("aov"))
    gm = _sum_num(inputs.get("gross_margin"), 50.0) or 50.0
    target_roi = _sum_num(inputs.get("target_roi"))

    def div(a: float, b: float):
        return (a / b) if b else None

    ctr = round(div(clicks, imp) * 100, 2) if imp else None
    cpc = round(div(spend, clicks), 2) if clicks else None
    cpm = round(div(spend, imp) * 1000, 2) if imp else None
    c2l = round(div(leads, clicks) * 100, 2) if clicks else None
    cpl = round(div(spend, leads), 1) if leads else None
    l2d = round(div(deals, leads) * 100, 2) if leads else None
    cac = round(div(spend, deals), 1) if deals else None
    revenue = deals * aov
    roi = round(div(revenue, spend), 2) if spend else None

    # 保本线：单客毛利 × 线索成交率 = 单条线索的期望价值（即 CPL 上限）
    profit_per_deal = aov * gm / 100
    be_cpl = round(profit_per_deal * (div(deals, leads) or 0), 1) if leads else None
    be_roi = round(100 / gm, 2) if gm else None
    gross_profit = revenue * gm / 100
    net = round(gross_profit - spend, 1)
    target_rev = round(spend * target_roi, 1) if (spend and target_roi) else None

    def judge_ctr(v):
        if v is None:
            return "数据缺失"
        return "🟢良好" if v >= 2 else ("🟡偏低" if v >= 1 else "🔴过低")

    def judge_c2l(v):
        if v is None:
            return "数据缺失"
        return "🟢良好" if v >= 5 else ("🟡偏低" if v >= 2 else "🔴过低")

    def judge_l2d(v):
        if v is None:
            return "数据缺失"
        return "🟢良好" if v >= 10 else ("🟡偏低" if v >= 5 else "🔴过低")

    if cpl is not None and be_cpl:
        cpl_judge = ("🟢安全（低于保本线）" if cpl <= be_cpl * 0.7
                     else "🟡贴线（接近保本线）" if cpl <= be_cpl
                     else "🔴亏损（高于保本线）")
    else:
        cpl_judge = "数据不足，无法判定"

    if roi is not None and be_roi:
        roi_judge = ("🟢盈利" if roi >= be_roi
                     else "🟡接近保本" if roi >= be_roi * 0.8
                     else "🔴亏损")
    else:
        roi_judge = "数据不足，无法判定"

    # 漏点定位：按全链路逐段找最弱的一环
    leaks = []
    if ctr is not None and ctr < 1:
        leaks.append(("素材/人群", f"点击率 {ctr}% 低于 1%，素材没打动人或人群不准"))
    if c2l is not None and c2l < 2:
        leaks.append(("落地承接", f"点击→线索仅 {c2l}%，落地页/私信承接有问题"))
    if l2d is not None and l2d < 5:
        leaks.append(("销售转化", f"线索→成交仅 {l2d}%，线索质量或跟单有问题"))
    if cpl is not None and be_cpl and cpl > be_cpl:
        leaks.append(("成本失控", f"CPL {cpl} 元 > 保本 {be_cpl} 元，投一笔亏一笔"))
    if roi is not None and be_roi and roi < be_roi:
        leaks.append(("投产倒挂", f"ROI {roi} < 保本 {be_roi}，整体不赚钱"))
    if not leaks:
        leaks.append(("暂无明显漏点", "各段指标均在合理区间，可考虑放量"))

    return {
        "spend": round(spend), "impressions": round(imp), "clicks": round(clicks),
        "leads": round(leads), "deals": round(deals), "aov": round(aov),
        "gross_margin": gm, "ctr": ctr, "ctr_judge": judge_ctr(ctr),
        "cpc": cpc, "cpm": cpm, "click_to_lead": c2l, "c2l_judge": judge_c2l(c2l),
        "cpl": cpl, "lead_to_deal": l2d, "l2d_judge": judge_l2d(l2d),
        "cac": cac, "revenue": round(revenue), "roi": roi,
        "profit_per_deal": round(profit_per_deal, 1),
        "be_cpl": be_cpl, "cpl_judge": cpl_judge,
        "be_roi": be_roi, "roi_judge": roi_judge,
        "gross_profit": round(gross_profit, 1), "net": net,
        "target_roi": target_roi or None, "target_revenue": target_rev,
        "leaks": leaks,
    }


def format_ad_diag(r: dict) -> str:
    L = ["【服务端投流测算】以下为确定性结果，直接引用，不要重算。", ""]
    L.append("| 指标 | 数值 | 判定 |")
    L.append("|---|---|---|")
    L.append(f"| 消耗 | {r['spend']} 元 | — |")
    L.append(f"| 展现 | {r['impressions']} | CPM {r['cpm']} 元 |")
    L.append(f"| 点击 | {r['clicks']} | CTR {r['ctr']}% {r['ctr_judge']} |")
    L.append(f"| 线索 | {r['leads']} | CPL {r['cpl']} 元 · 点击→线索 {r['click_to_lead']}% {r['c2l_judge']} |")
    L.append(f"| 成交 | {r['deals']} | CAC {r['cac']} 元 · 线索→成交 {r['lead_to_deal']}% {r['l2d_judge']} |")
    L.append(f"| 成交金额 | {r['revenue']} 元 | 客单 {r['aov']} × {r['deals']} 单 |")
    L.append("")
    L.append(f"- 点击成本 CPC：{r['cpc']} 元")
    L.append(f"- 单客毛利（客单 {r['aov']} × 毛利率 {r['gross_margin']}%）：{r['profit_per_deal']} 元")
    L.append(f"- **保本线索成本 = 单客毛利 × 线索成交率 = {r['be_cpl']} 元** → 实际 CPL {r['cpl']} 元，{r['cpl_judge']}")
    L.append(f"- **保本 ROI = 1 ÷ 毛利率 = {r['be_roi']} 倍** → 实际 ROI {r['roi']} 倍，{r['roi_judge']}")
    L.append(f"- 毛利额 {r['gross_profit']} 元 − 消耗 {r['spend']} 元 = **净盈亏 {r['net']} 元**")
    if r["target_revenue"]:
        L.append(f"- 要达到目标 ROI {r['target_roi']} 倍，成交金额需做到 {r['target_revenue']} 元")
    L.append("")
    L.append("漏点定位（服务端按阈值判定）：")
    for name, why in r["leaks"]:
        L.append(f"- **{name}**：{why}")
    L.append("")
    L.append("- 公式：CPL=消耗÷线索；CAC=消耗÷成交；ROI=成交金额÷消耗；保本CPL=单客毛利×线索成交率；保本ROI=1÷毛利率")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# 盈亏平衡（小餐饮/小店通用）：固定成本 ÷ 毛利率
# ---------------------------------------------------------------------------

def calc_breakeven(inputs: Dict[str, str]) -> dict:
    rent = _num(inputs.get("rent"))
    labor = _num(inputs.get("labor"))
    utilities = _num(inputs.get("utilities"))
    other = _num(inputs.get("other_fixed"))
    var_rate = _num(inputs.get("var_rate"), 40.0)
    revenue = _num(inputs.get("revenue"))
    target = _num(inputs.get("target_profit"))

    fixed = rent + labor + utilities + other
    gm = 100 - var_rate
    breakeven = fixed / (gm / 100) if gm > 0 else None
    safety = round(revenue / breakeven, 2) if (breakeven and revenue) else None

    def scen(rev: float, name: str) -> dict:
        variable = rev * var_rate / 100
        profit = rev - variable - fixed
        return {"name": name, "revenue": round(rev), "variable": round(variable),
                "profit": round(profit), "margin": round(profit / rev * 100, 1) if rev else 0}

    if safety is None:
        judge = "数据不足，无法判定"
    elif safety >= 1.5:
        judge = "🟢安全（营收是平衡点的 1.5 倍以上）"
    elif safety >= 1.2:
        judge = "🟡偏紧（缓冲不足 20%，掉量就亏）"
    else:
        judge = "🔴危险（贴近或低于平衡点，随时亏损）"

    return {"fixed": round(fixed), "var_rate": var_rate, "gross_margin": round(gm, 1),
            "breakeven": round(breakeven) if breakeven else None,
            "revenue": round(revenue), "safety": safety, "judge": judge,
            "target_revenue": round((fixed + target) / (gm / 100), 0) if (gm > 0 and target) else None,
            "daily_orders": round(breakeven / 30, 1) if breakeven else None,
            "scenarios": [scen(revenue * m, n) for m, n in ((0.8, "保守（-20%）"), (1.0, "基准"), (1.2, "乐观（+20%）"))]
            if revenue else []}


def format_breakeven(r: dict) -> str:
    L = ["【服务端盈亏测算】以下为确定性结果，直接引用，不要重算。", ""]
    L.append(f"- 月固定成本合计：{r['fixed']} 元（房租+人工+水电+其他）")
    L.append(f"- 变动成本率：{r['var_rate']}% → 毛利率：{r['gross_margin']}%")
    if r["breakeven"]:
        L.append(f"- **盈亏平衡月营业额：{r['breakeven']} 元**（折合日均约 {r['daily_orders']} 元/天）")
    if r["safety"]:
        L.append(f"- 当前/预估月营收 {r['revenue']} 元，是平衡点的 {r['safety']} 倍 → {r['judge']}")
    if r["target_revenue"]:
        L.append(f"- 要做到目标月净利，月营业额需达到 {r['target_revenue']} 元")
    if r["scenarios"]:
        L.append("")
        L.append("| 情景 | 月营业额 | 变动成本 | 月净利 | 净利率 |")
        L.append("|---|---|---|---|---|")
        for s in r["scenarios"]:
            L.append(f"| {s['name']} | {s['revenue']} | {s['variable']} | {s['profit']} | {s['margin']}% |")
    L.append("")
    L.append("- 公式：盈亏平衡营业额 = 月固定成本 ÷ 毛利率；安全倍数 = 月营收 ÷ 盈亏平衡营业额")
    return "\n".join(L)


CALCULATORS = {
    "invest_return": calc_invest_return,
    "table_stats": calc_table_stats,
    "finance_diag": calc_finance_diag,
    "funnel": calc_funnel,
    "breakeven": calc_breakeven,
    "ad_diag": calc_ad_diag,
}

FORMATTERS = {
    "table_stats": format_table_stats,
    "finance_diag": format_finance_diag,
    "funnel": format_funnel,
    "breakeven": format_breakeven,
    "ad_diag": format_ad_diag,
}


def format_computed(result: dict) -> str:
    """把计算结果格式化成可直接塞进 prompt 的文本（模型照抄，不需自己算）。"""
    lines = []
    lines.append(f"- 一次性总投资：{result['invest_total']} 元")
    lines.append(f"- 月营业额（基准）：{result['revenue_month']} 元")
    lines.append(f"- 建议备用金（3个月总成本）：{result['deposit_suggest']} 元")
    lines.append("")
    lines.append("月度经营模型（基准档，单位：元）：")
    b = result["base"]
    lines.append(f"| 项目 | 金额 | 占营收比 |")
    lines.append(f"|---|---|---|")
    lines.append(f"| 月营业额 | {b['revenue']} | 100% |")
    lines.append(f"| 货品/食材成本 | {b['goods']} | {round(b['goods']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 房租 | {b['rent']} | {round(b['rent']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 人工 | {b['labor']} | {round(b['labor']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 水电杂费 | {b['misc']} | {round(b['misc']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 营销 | {b['marketing']} | {round(b['marketing']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 折旧摊销 | {b['depreciation']} | {round(b['depreciation']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 月总成本 | {b['total_cost']} | {round(b['total_cost']/b['revenue']*100,1) if b['revenue'] else 0}% |")
    lines.append(f"| 月净利 | {b['profit']} | {b['margin']}% |")
    lines.append("")
    lines.append("三档敏感性分析（服务端计算，直接引用，不要重算）：")
    lines.append("| 档位 | 月营收 | 月总成本 | 月净利 | 净利率 | 回本周期(月) | 年化ROI |")
    lines.append("|---|---|---|---|---|---|---|")
    for key in ("conservative", "base", "optimistic"):
        s = result[key]
        pb = f"{s['payback_months']}" if s["payback_months"] else "不回本"
        roi = f"{s['roi_annual']}%" if s["roi_annual"] is not None else "—"
        lines.append(
            f"| {s['name']} | {s['revenue']} | {s['total_cost']} | {s['profit']} | "
            f"{s['margin']}% | {pb} | {roi} |"
        )
    lines.append("")
    lines.append("核心四行卡（服务端计算）：")
    lines.append(f"- 一次性总投资：{round(result['invest_total']/10000,1)} 万元")
    lines.append(f"- 月净利（基准档）：{round(b['profit']/10000,2)} 万元")
    lines.append(f"- 静态回本周期：{b['payback_months'] if b['payback_months'] else '不回本'} 个月")
    lines.append(f"- 年化 ROI：{b['roi_annual'] if b['roi_annual'] is not None else '—'}%")
    lines.append("")
    lines.append("关键假设（必须在输出中如实呈现）：")
    for a in result["assumptions"]:
        lines.append(f"- {a}")
    return "\n".join(lines)
