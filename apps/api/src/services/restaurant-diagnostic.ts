import * as XLSX from "xlsx";

export interface RestaurantDiagnosticSummary {
  recognized: boolean;
  version?: "restaurant_diagnostic_v1";
  dataQuality?: {
    level: "ready" | "partial" | "insufficient";
    score: number;
    issues: string[];
  };
  facts?: {
    storeCount: number;
    platforms: string[];
    dailyRows: number;
    dateRange?: string;
    totalPaidOrders?: number;
    totalNetRevenue?: number;
  };
  contextText?: string;
}

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

const REQUIRED_SHEETS = ["门店主数据", "日经营漏斗"];
const DAILY_REQUIRED_FIELDS = ["日期*", "门店编码*", "平台*", "实付订单数*"];

export function analyzeRestaurantDiagnosticWorkbook(buffer: Buffer): RestaurantDiagnosticSummary {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  if (!REQUIRED_SHEETS.every((name) => workbook.SheetNames.includes(name))) return { recognized: false };

  const storeRows = dataRows(workbook.Sheets["门店主数据"], "门店编码*");
  const dailyRows = dataRows(workbook.Sheets["日经营漏斗"], "日期*");
  const issues: string[] = [];
  const stores = new Set<string>();
  const platforms = new Set<string>();
  const dates: string[] = [];
  const identities = new Set<string>();
  let totalPaidOrders = 0;
  let totalNetRevenue = 0;
  let validDailyRows = 0;

  for (const row of storeRows) {
    const storeCode = text(row.values["门店编码*"]);
    const platform = text(row.values["平台*"]);
    if (storeCode) stores.add(storeCode);
    if (platform) platforms.add(platform);
  }

  for (const row of dailyRows) {
    const date = normalizeDate(row.values["日期*"]);
    const storeCode = text(row.values["门店编码*"]);
    const platform = text(row.values["平台*"]);
    const paidOrders = number(row.values["实付订单数*"]);
    const impression = number(row.values["曝光人数"]);
    const visits = number(row.values["店铺访问人数"]);
    const checkout = number(row.values["结算人数"]);
    const completed = number(row.values["完成订单数"]);
    const cancelled = number(row.values["取消订单数"]);
    const refunds = number(row.values["退款订单数"]);

    if (!date || !storeCode || !platform || paidOrders === undefined) {
      issues.push("日经营漏斗存在缺少日期、门店编码、平台或实付订单数的记录。");
      continue;
    }
    validDailyRows += 1;
    stores.add(storeCode);
    platforms.add(platform);
    dates.push(date);
    const identity = `${date}|${storeCode}|${platform}`;
    if (identities.has(identity)) issues.push("日经营漏斗存在相同日期、门店、平台的重复记录。");
    identities.add(identity);
    if (impression !== undefined && visits !== undefined && visits > impression) issues.push("存在店铺访问人数大于曝光人数的漏斗记录，请确认指标口径。");
    if (checkout !== undefined && paidOrders > checkout) issues.push("存在实付订单数大于结算人数的漏斗记录，请确认指标口径。");
    if (completed !== undefined && cancelled !== undefined && completed + cancelled > paidOrders) issues.push("存在完成订单与取消订单合计大于实付订单数的记录。");
    if (refunds !== undefined && completed !== undefined && refunds > completed) issues.push("存在退款订单数大于完成订单数的记录，请确认退款口径。");
    if (paidOrders < 0) issues.push("存在负数实付订单，请检查导出或填表。");
    totalPaidOrders += paidOrders;
    const netRevenue = number(row.values["商家实际入账*"]);
    if (netRevenue !== undefined) totalNetRevenue += netRevenue;
  }

  if (storeRows.length === 0) issues.push("尚未填写门店主数据，无法按门店关联经营数据。");
  if (dailyRows.length === 0) issues.push("尚未填写日经营漏斗，当前只能输出待验证假设。");
  if (validDailyRows > 0 && dates.length < 7) issues.push("有效经营数据不足7天，只适合做初步核对，不宜下增长结论。");
  if (validDailyRows > 0 && !dailyRows.some((row) => number(row.values["店铺访问人数"]) !== undefined)) issues.push("缺少店铺访问人数，无法定位曝光到进店环节。");
  if (validDailyRows > 0 && !dailyRows.some((row) => number(row.values["商家实际入账*"]) !== undefined)) issues.push("缺少商家实际入账，无法评估纯收护栏。");

  const uniqueIssues = [...new Set(issues)];
  const score = Math.max(0, Math.min(100, 100 - uniqueIssues.length * 12 - (validDailyRows === 0 ? 35 : 0)));
  const level = validDailyRows >= 7 && score >= 76 ? "ready" : validDailyRows > 0 ? "partial" : "insufficient";
  const dateRange = dates.length ? `${dates.sort()[0]} 至 ${dates.sort().at(-1)}` : undefined;
  const facts = {
    storeCount: stores.size,
    platforms: [...platforms].sort(),
    dailyRows: validDailyRows,
    dateRange,
    totalPaidOrders: validDailyRows ? totalPaidOrders : undefined,
    totalNetRevenue: validDailyRows ? totalNetRevenue : undefined
  };

  return {
    recognized: true,
    version: "restaurant_diagnostic_v1",
    dataQuality: { level, score, issues: uniqueIssues.slice(0, 8) },
    facts,
    contextText: buildContextText({ level, score, issues: uniqueIssues, facts })
  };
}

function dataRows(sheet: XLSX.WorkSheet | undefined, firstHeader: string): Array<{ values: Record<string, Cell> }> {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
  const headerIndex = rows.findIndex((row) => row.map(text).includes(firstHeader));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(text);
  return rows.slice(headerIndex + 1)
    .map((row) => ({ values: Object.fromEntries(headers.map((header, index) => [header, row[index]])) }))
    .filter((row) => Object.values(row.values).some((value) => text(value) !== ""));
}

function text(value: Cell): string {
  return String(value ?? "").trim();
}

function number(value: Cell): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDate(value: Cell): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const source = text(value);
  if (!source) return undefined;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function buildContextText(params: {
  level: "ready" | "partial" | "insufficient";
  score: number;
  issues: string[];
  facts: RestaurantDiagnosticSummary["facts"];
}): string {
  const facts = params.facts!;
  const dataFacts = [
    `数据质量：${params.level}（${params.score}/100）`,
    `门店数：${facts.storeCount}`,
    `平台：${facts.platforms.join("、") || "待补"}`,
    `有效日记录：${facts.dailyRows}`,
    facts.dateRange ? `覆盖周期：${facts.dateRange}` : undefined,
    facts.totalPaidOrders !== undefined ? `周期实付订单：${facts.totalPaidOrders}` : undefined,
    facts.totalNetRevenue !== undefined ? `周期商家实际入账：${facts.totalNetRevenue}` : undefined
  ].filter(Boolean);
  return [
    "【餐饮经营诊断表解析】以下为系统从本轮上传协作表中计算的事实；数据质量不足时只能输出待验证假设，不得把缺口补成结论。",
    ...dataFacts.map((item) => `- ${item}`),
    ...(params.issues.length ? ["数据核对项：", ...params.issues.slice(0, 6).map((item) => `- 【待核对】${item}`)] : ["- 数据核对项：当前未发现结构性缺口。"])
  ].join("\n");
}
