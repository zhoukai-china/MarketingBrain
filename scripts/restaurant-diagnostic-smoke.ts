import * as XLSX from "../apps/api/node_modules/xlsx/xlsx.mjs";
import { analyzeRestaurantDiagnosticWorkbook } from "../apps/api/src/services/restaurant-diagnostic.js";

function main() {
  const workbook = XLSX.utils.book_new();
  const stores = XLSX.utils.aoa_to_sheet([
    ["门店编码*", "门店名称*", "城市*", "平台*"],
    ["S001", "测试店", "沈阳", "美团"]
  ]);
  const daily = XLSX.utils.aoa_to_sheet([
    ["日期*", "门店编码*", "平台*", "曝光人数", "店铺访问人数", "结算人数", "实付订单数*", "完成订单数", "取消订单数", "退款订单数", "商家实际入账*"],
    ["2026-07-01", "S001", "美团", 1000, 120, 30, 24, 22, 2, 1, 960],
    ["2026-07-02", "S001", "美团", 1100, 130, 32, 25, 23, 2, 1, 1000],
    ["2026-07-03", "S001", "美团", 980, 100, 28, 21, 20, 1, 0, 840],
    ["2026-07-04", "S001", "美团", 1200, 150, 36, 29, 27, 2, 1, 1160],
    ["2026-07-05", "S001", "美团", 1150, 140, 34, 26, 24, 2, 1, 1040],
    ["2026-07-06", "S001", "美团", 1250, 155, 38, 30, 28, 2, 1, 1200],
    ["2026-07-07", "S001", "美团", 1300, 160, 40, 32, 30, 2, 1, 1280]
  ]);
  XLSX.utils.book_append_sheet(workbook, stores, "门店主数据");
  XLSX.utils.book_append_sheet(workbook, daily, "日经营漏斗");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const result = analyzeRestaurantDiagnosticWorkbook(buffer);
  const failures: string[] = [];
  if (!result.recognized) failures.push("未识别协作表结构");
  if (result.dataQuality?.level !== "ready") failures.push(`预期数据状态 ready，实际 ${result.dataQuality?.level}`);
  if (result.facts?.storeCount !== 1 || result.facts.dailyRows !== 7 || result.facts.totalPaidOrders !== 187) failures.push("汇总事实与合成样例不一致");
  if (!result.contextText?.includes("周期实付订单：187")) failures.push("未生成可供 Agent 使用的诊断上下文");
  const ordinaryWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(ordinaryWorkbook, XLSX.utils.aoa_to_sheet([["普通表格"], ["不应触发餐饮诊断"]]), "Sheet1");
  const unrecognized = analyzeRestaurantDiagnosticWorkbook(XLSX.write(ordinaryWorkbook, { type: "buffer", bookType: "xlsx" }));
  if (unrecognized.recognized) failures.push("普通工作簿不应被误识别为餐饮诊断表");
  if (failures.length) throw new Error(`Restaurant diagnostic smoke failed:\n${failures.join("\n")}`);
  console.log("Restaurant diagnostic smoke passed: template recognition, quality gating and factual summary are valid.");
}

main();
