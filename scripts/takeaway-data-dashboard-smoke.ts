import * as XLSX from "../apps/api/node_modules/xlsx/xlsx.mjs";

async function main() {
  process.env.DATA_MODE = "demo";
  const { buildTakeawayDashboard, parseTakeawayProductItems, parseTakeawayWorkbook, saveTakeawayImport } = await import("../apps/api/src/services/takeaway-growth-data.js");
  const meituanProductItems = parseTakeawayProductItems("现炒本帮浇头面/饭随心配(1人份),单价38.9*数量1/枕水餐具包【汤品必选】,单价0*数量2");
  if (meituanProductItems?.length !== 2 || meituanProductItems[0]?.name !== "现炒本帮浇头面/饭随心配" || meituanProductItems[1]?.quantity !== 2) {
    throw new Error("美团订单商品信息未正确拆分为菜品销量");
  }
  const flashProductItems = parseTakeawayProductItems("红烧小狮子头_1*7.9+套餐[加购:酸辣汤+2.9]_2*39.9");
  if (flashProductItems?.length !== 2 || flashProductItems[1]?.name !== "套餐" || flashProductItems[1]?.quantity !== 2) {
    throw new Error("淘宝闪购订单商品信息未正确拆分为菜品销量");
  }
  const productInfoWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(productInfoWorkbook, XLSX.utils.aoa_to_sheet([
    ["日期", "平台", "订单号", "订单状态", "商品信息", "顾客实付"],
    ["2026-08-01", "美团", "MT-INFO-1", "已完成", "红烧肉套餐,单价49.9*数量1/餐具包,单价0*数量2", 29.9],
    ["2026-08-01", "淘宝闪购", "TB-INFO-1", "订单完结", "红烧小狮子头_1*7.9+能量套餐[主食:A米饭_1]_2*39.9", 52.9]
  ]), "订单商品信息");
  const productInfoParsed = parseTakeawayWorkbook({
    filename: "双平台订单商品信息.xlsx",
    buffer: XLSX.write(productInfoWorkbook, { type: "buffer", bookType: "xlsx" }),
    tenantId: "zhenshui-product-info-smoke"
  });
  await saveTakeawayImport({ tenantId: "zhenshui-product-info-smoke", userId: "owner", parsed: productInfoParsed });
  const productInfoDashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-product-info-smoke" });
  if (productInfoDashboard.dataStatus.productEvidence !== "sales" || !productInfoDashboard.products.some((item) => item.name === "能量套餐" && item.quantity === 2)) {
    throw new Error("订单商品信息已拆分但未进入菜品销量看板");
  }
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["订单时间", "平台", "门店名称", "订单号", "订单状态", "菜品名称", "数量", "原价", "实付", "商家补贴", "平台补贴", "退款金额", "新老客标识", "出餐时长", "成本金额"],
    ["2026-08-01 11:20", "美团", "中街店", "MT-001", "已完成", "上海本帮红烧肉套餐", 1, 59.9, 50, 5, 4.9, 0, "新客", 15, 28],
    ["2026-08-01 11:20", "美团", "中街店", "MT-001", "已完成", "海鲜酸辣汤", 1, 12, 50, 5, 4.9, 0, "新客", 15, 4],
    ["2026-08-01 12:05", "美团", "中街店", "MT-002", "已退款", "黑椒牛肉配时蔬能量套餐", 1, 52, 48, 4, 0, 48, "老客", 17, 25],
    ["2026-08-02 12:15", "淘宝闪购", "中街店", "TB-001", "已完成", "红烧牛肉焖土豆胡萝卜套餐", 1, 52.9, 40, 6, 6.9, 0, "老客", 14, 22]
  ]), "双平台订单明细");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["日期", "平台", "门店名称", "曝光量", "进店人数", "订单量", "有效完成单"],
    ["2026-08-01", "美团", "中街店", 1000, 70, 12, 10],
    ["2026-08-02", "淘宝闪购", "中街店", 900, 90, 20, 19]
  ]), "经营漏斗");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["日期", "平台", "门店名称", "菜品名称", "销量", "实付金额", "退款金额", "成本金额"],
    ["2026-08-01", "美团", "中街店", "上海本帮红烧肉套餐", 20, 1000, 20, 560],
    ["2026-08-02", "淘宝闪购", "中街店", "红烧牛肉焖土豆胡萝卜套餐", 16, 800, 0, 360]
  ]), "菜品经营");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["日期", "平台", "门店名称", "活动名称", "预算", "消耗", "曝光", "点击", "进店", "订单量", "成交额"],
    ["2026-08-01", "美团", "中街店", "神枪手双人小宴", 300, 200, 5000, 300, 120, 20, 1000],
    ["2026-08-02", "淘宝闪购", "中街店", "超枪手一荤一素", 240, 160, 4200, 260, 100, 18, 720]
  ]), "活动投放");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = parseTakeawayWorkbook({ filename: "枕水江南双平台经营数据.xlsx", buffer, tenantId: "zhenshui-smoke" });
  const failures: string[] = [];
  if (parsed.sourceKind !== "mixed") failures.push(`预期识别为 mixed，实际 ${parsed.sourceKind}`);
  if (parsed.normalizedRows.length !== 10) failures.push(`预期 10 行标准化数据，实际 ${parsed.normalizedRows.length}`);
  if (parsed.duplicateCount !== 1) failures.push(`预期识别 1 条订单商品重复行，实际 ${parsed.duplicateCount}`);
  if (parsed.detectedSheets.filter((sheet) => sheet.kind).length !== 4) failures.push("未识别全部四类经营数据工作表");
  if (parsed.normalizedRows.some((row) => row.orderKey && /MT-|TB-/.test(row.orderKey))) failures.push("原始订单号未完成单向哈希");

  const dailyWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(dailyWorkbook, XLSX.utils.aoa_to_sheet([
    ["日期", "城市名称", "门店名称", "营业收入", "顾客实付总额", "有效订单", "商家活动成本（含满减活动）", "曝光人数", "入店人数", "下单人数", "单均出餐时长"],
    ["2026-08-01", "沈阳", "中街店", 1800, 2100, 60, 520, 6800, 420, 60, 12],
    ["2026-08-02", "沈阳", "中街店", 1950, 2250, 65, 580, 7200, 460, 65, 13]
  ]), "美团日汇总");
  const dailyParsed = parseTakeawayWorkbook({
    filename: "美团每天总单总数据-20260801_20260802.csv",
    buffer: XLSX.write(dailyWorkbook, { type: "buffer", bookType: "xlsx" }),
    tenantId: "zhenshui-daily-smoke"
  });
  if (dailyParsed.sourceKind !== "funnel" || dailyParsed.rowCount !== 2 || dailyParsed.platform !== "美团") failures.push("平台日汇总未识别为美团漏斗数据");
  if (dailyParsed.normalizedRows.some((row) => row.city !== "沈阳")) failures.push("平台文件中的城市名称未进入结构化经营数据");
  if (dailyParsed.normalizedRows.some((row) => row.effectiveOrders === undefined || row.exposure === undefined || row.visits === undefined || row.orderCount === undefined)) failures.push("平台日汇总的订单与漏斗字段映射不完整");
  await saveTakeawayImport({ tenantId: "zhenshui-daily-smoke", userId: "owner", parsed: dailyParsed });
  const dailyDashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-daily-smoke" });
  if (dailyDashboard.dataStatus.campaignEvidence !== "summary") failures.push("平台日汇总中的商家活动成本未标记为汇总证据");
  if (dailyDashboard.campaigns.length !== 1 || dailyDashboard.campaigns[0]?.costType !== "merchant_activity_cost" || dailyDashboard.campaigns[0]?.roi !== undefined) failures.push("活动成本汇总被误当作广告消耗或计划级 ROI");

  const anomalyWorkbook = XLSX.utils.book_new();
  const anomalyRows: Array<Array<string | number>> = [["日期", "平台", "门店名称", "曝光人数", "入店人数", "下单人数", "有效订单", "顾客实付总额"]];
  for (let day = 1; day <= 14; day += 1) anomalyRows.push([`2026-07-${String(day).padStart(2, "0")}`, "美团", "异常测试店", 5000, 300, day <= 7 ? 50 : 30, day <= 7 ? 48 : 28, day <= 7 ? 1920 : 840]);
  XLSX.utils.book_append_sheet(anomalyWorkbook, XLSX.utils.aoa_to_sheet(anomalyRows), "14天趋势");
  const anomalyParsed = parseTakeawayWorkbook({ filename: "美团14天经营趋势.xlsx", buffer: XLSX.write(anomalyWorkbook, { type: "buffer", bookType: "xlsx" }), tenantId: "zhenshui-anomaly-smoke" });
  await saveTakeawayImport({ tenantId: "zhenshui-anomaly-smoke", userId: "owner", parsed: anomalyParsed });
  const anomalyDashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-anomaly-smoke" });
  if (!anomalyDashboard.anomalies.some((item) => item.id === "recent-order-drop" && item.evidence.includes("下降"))) failures.push("AI异常扫描未识别最近7天订单下降");
  if (!anomalyDashboard.anomalies.some((item) => item.id === "compound-order-aov-drop" && item.title.includes("订单与客单价同步"))) failures.push("AI异常扫描未识别订单与客单同步走弱的组合信号");
  if (!anomalyDashboard.anomalies.every((item) => item.evidence && item.comparison && item.verification)) failures.push("异常卡缺少证据、比较或验证方法");

  const invertedWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(invertedWorkbook, XLSX.utils.aoa_to_sheet([
    ["日期", "平台", "门店名称", "曝光人数", "入店人数", "下单人数", "有效订单"],
    ["2026-08-01", "美团", "口径异常测试店", 1000, 100, 90, 95],
    ["2026-08-02", "美团", "口径异常测试店", 1100, 105, 92, 99]
  ]), "漏斗倒挂");
  const invertedParsed = parseTakeawayWorkbook({
    filename: "美团漏斗倒挂测试.xlsx",
    buffer: XLSX.write(invertedWorkbook, { type: "buffer", bookType: "xlsx" }),
    tenantId: "zhenshui-inverted-funnel-smoke"
  });
  await saveTakeawayImport({ tenantId: "zhenshui-inverted-funnel-smoke", userId: "owner", parsed: invertedParsed });
  const invertedDashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-inverted-funnel-smoke" });
  if (invertedDashboard.dataStatus.qualityScore >= 80 || invertedDashboard.dataStatus.level !== "partial") failures.push(`漏斗倒挂未降低为部分可信：${invertedDashboard.dataStatus.qualityScore}/${invertedDashboard.dataStatus.level}`);
  if (!invertedDashboard.dataStatus.warnings.some((warning) => warning.includes("漏斗发生倒挂") && warning.includes("不得用于增长归因"))) failures.push("漏斗倒挂缺少阻断归因警告");

  const catalogWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(catalogWorkbook, XLSX.utils.aoa_to_sheet([
    ["2026.7 枕水江南外卖菜品调整明细表（神枪手修改版）"],
    ["类别", "产品名称", "上架备注", "成本", "闪购价", "美团价", "折后价", "折扣率", "神枪手\n价格", "团餐基准价格", "售卖信息\n份量设置", "更新备注"],
    ["神枪手", "上海本帮红烧肉套餐", "上架", 18.96, "闪购不卖", 49.9, "", 0.6, 29.9, 32, "1人份", "主菜微甜"],
    ["超枪手", "红烧牛肉焖土豆胡萝卜套餐", "上架", 20.5, 52.9, "美团不卖", "", 0.58, 35.9, 38, "1人份", "微辣"]
  ]), "Sheet1");
  const catalogParsed = parseTakeawayWorkbook({
    filename: "带成本-2026.7枕水江南外卖菜品调整明细表.xlsx",
    buffer: XLSX.write(catalogWorkbook, { type: "buffer", bookType: "xlsx" }),
    tenantId: "zhenshui-catalog-smoke",
    storeNameHint: "中街店"
  });
  if (catalogParsed.sourceKind !== "catalog" || catalogParsed.rowCount !== 2) failures.push(`标题行+菜品成本价格表识别失败：${catalogParsed.sourceKind}/${catalogParsed.rowCount}`);
  if (!catalogParsed.normalizedRows.some((row) => row.productName?.includes("红烧肉") && row.costAmount === 18.96 && row.meituanPrice === 49.9 && row.campaignPrice === 29.9)) failures.push("菜品成本、平台价和神枪手价格映射失败");
  await saveTakeawayImport({ tenantId: "zhenshui-catalog-smoke", userId: "owner", parsed: catalogParsed });
  const catalogDashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-catalog-smoke" });
  if (catalogDashboard.catalog.length !== 2 || catalogDashboard.catalog.some((item) => item.costRate === undefined)) failures.push("菜品成本/价格货盘看板未生成");
  if (catalogDashboard.dataStatus.productEvidence !== "catalog_only") failures.push("只有菜品货盘时不应误报已识别菜品销量");

  const jsonParsed = parseTakeawayWorkbook({
    filename: "菜品经营.json",
    buffer: Buffer.from(JSON.stringify([
      { date: "2026-08-01", platform: "美团", storeName: "中街店", productName: "红烧肉套餐", salesQuantity: 12, paidAmount: 600 },
      { date: "2026-08-02", platform: "美团", storeName: "中街店", productName: "牛肉套餐", salesQuantity: 8, paidAmount: 400 }
    ]), "utf8"),
    tenantId: "zhenshui-json-smoke"
  });
  if (jsonParsed.sourceKind !== "products" || jsonParsed.rowCount !== 2) failures.push("JSON 对象数组未识别为菜品经营数据");

  const firstSave = await saveTakeawayImport({ tenantId: "zhenshui-smoke", userId: "owner", parsed });
  const secondSave = await saveTakeawayImport({ tenantId: "zhenshui-smoke", userId: "owner", parsed });
  if (firstSave.duplicateFile) failures.push("首次导入不应判定为重复文件");
  if (!secondSave.duplicateFile || secondSave.record.id !== firstSave.record.id) failures.push("相同文件再次导入未正确去重");

  const dashboard = await buildTakeawayDashboard({ tenantId: "zhenshui-smoke" });
  if (dashboard.dataStatus.importCount !== 1 || dashboard.dataStatus.rowCount !== 10) failures.push("看板导入批次或行数对账失败");
  if (dashboard.summary.effectiveOrders !== 2) failures.push(`有效完成单应为 2，实际 ${dashboard.summary.effectiveOrders}`);
  if (dashboard.summary.paidAmount !== 90) failures.push(`有效订单实付应为 90，实际 ${dashboard.summary.paidAmount}`);
  if (dashboard.summary.refundAmount !== 48) failures.push(`退款金额应为 48，实际 ${dashboard.summary.refundAmount}`);
  if (dashboard.funnel.length !== 2) failures.push("双平台漏斗未生成");
  if (dashboard.campaigns.length !== 2 || dashboard.campaigns[0].roi === undefined) failures.push("活动投放 ROI 未生成");
  if (dashboard.dataStatus.campaignEvidence !== "detail") failures.push("计划级活动投放明细可信度未正确标记");
  const meituanComparison = dashboard.funnel.find((item) => item.platform === "美团");
  const flashComparison = dashboard.funnel.find((item) => item.platform === "淘宝闪购");
  if (meituanComparison?.adSpend !== 200 || meituanComparison.adGmv !== 1000 || meituanComparison.adRoi !== 5 || meituanComparison.campaignEvidence !== "detail") failures.push("美团平台投入对比指标未按计划级投放明细汇总");
  if (flashComparison?.adSpend !== 160 || flashComparison.adGmv !== 720 || flashComparison.adRoi !== 4.5 || flashComparison.campaignEvidence !== "detail") failures.push("淘宝闪购平台投入对比指标未按计划级投放明细汇总");
  if (meituanComparison?.paidAmount !== 50 || flashComparison?.paidAmount !== 40 || flashComparison?.averageOrderValue !== 40) failures.push("双平台成交与客单指标未写入投入决策数据");
  if (meituanComparison?.transactionEvidence !== "conflicting" || flashComparison?.transactionEvidence !== "conflicting") failures.push("订单明细与漏斗数量不一致时，平台投入决策未被正确拦截");
  if (!dashboard.products.some((item) => item.name.includes("红烧肉"))) failures.push("菜品经营排行未生成");

  const isolated = await buildTakeawayDashboard({ tenantId: "other-tenant-smoke" });
  if (isolated.dataStatus.rowCount !== 0 || isolated.recentImports.length !== 0) failures.push("外卖经营数据发生租户串读");

  const apiBase = process.env.TAKEAWAY_SMOKE_API_URL?.replace(/\/$/, "");
  if (apiBase) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "枕水江南双平台经营数据.xlsx");
    const headers = {
      "x-sitong-tenant-id": "takeaway-http-smoke",
      "x-sitong-user-id": "owner",
      "x-sitong-plan": "chain_premium"
    };
    const response = await fetch(`${apiBase}/agents/takeaway-growth/imports`, { method: "POST", headers, body: form });
    const payload = await response.json() as { import?: { rowCount?: number }; dashboard?: { dataStatus?: { rowCount?: number } }; message?: string };
    if (!response.ok) failures.push(`HTTP 智能导入失败：${response.status} ${payload.message ?? ""}`);
    if (payload.import?.rowCount !== 10 || payload.dashboard?.dataStatus?.rowCount !== 10) failures.push("HTTP 智能导入响应未与服务层对账");
    const dashboardResponse = await fetch(`${apiBase}/agents/takeaway-growth/dashboard?storeName=${encodeURIComponent("中街店")}`, { headers });
    const httpDashboard = await dashboardResponse.json() as { dataStatus?: { rowCount?: number }; filters?: { selectedStore?: string } };
    if (!dashboardResponse.ok || httpDashboard.dataStatus?.rowCount !== 10 || httpDashboard.filters?.selectedStore !== "中街店") failures.push("HTTP 看板筛选未通过");
  }

  if (failures.length) throw new Error(`Takeaway data dashboard smoke failed:\n${failures.join("\n")}`);
  console.log("外卖智能导入与经营看板烟测通过：订单/漏斗/菜品/成本价格货盘/活动识别、JSON 导入、订单去重及租户隔离均有效。");
}

main();
