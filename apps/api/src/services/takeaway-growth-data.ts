import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { Prisma, prisma } from "@baolu/db";
import { env } from "../config/env.js";

export type TakeawaySourceKind = "orders" | "funnel" | "products" | "campaigns" | "catalog";

type Cell = string | number | boolean | Date | null | undefined;

export interface TakeawayNormalizedRow {
  kind: TakeawaySourceKind;
  sheetName: string;
  rowNumber: number;
  date?: string;
  city?: string;
  platform?: string;
  storeName?: string;
  orderKey?: string;
  orderStatus?: string;
  productName?: string;
  productItems?: Array<{ name: string; quantity: number; unitPrice?: number }>;
  productCategory?: string;
  quantity?: number;
  originalAmount?: number;
  paidAmount?: number;
  merchantSubsidy?: number;
  platformSubsidy?: number;
  refundAmount?: number;
  isNewCustomer?: boolean;
  prepMinutes?: number;
  costAmount?: number;
  meituanPrice?: number;
  flashPrice?: number;
  discountedPrice?: number;
  campaignPrice?: number;
  discountRate?: number;
  benchmarkPrice?: number;
  portion?: string;
  listingNote?: string;
  updateNote?: string;
  exposure?: number;
  visits?: number;
  orderCount?: number;
  effectiveOrders?: number;
  campaignName?: string;
  budget?: number;
  spend?: number;
  clicks?: number;
  gmv?: number;
  salesQuantity?: number;
}

export interface ParsedTakeawayImport {
  filename: string;
  sha256: string;
  sourceKind: TakeawaySourceKind | "mixed";
  platform?: string;
  storeName?: string;
  dateFrom?: string;
  dateTo?: string;
  rowCount: number;
  duplicateCount: number;
  qualityScore: number;
  fieldMappings: Record<string, string>;
  missingFields: string[];
  warnings: string[];
  normalizedRows: TakeawayNormalizedRow[];
  detectedSheets: Array<{ name: string; kind?: TakeawaySourceKind; rowCount: number }>;
}

export interface StoredTakeawayImport extends Omit<ParsedTakeawayImport, "dateFrom" | "dateTo"> {
  id: string;
  tenantId: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  createdAt: string;
}

export interface TakeawayDashboard {
  generatedAt: string;
  filters: {
    stores: string[];
    platforms: string[];
    selectedStore?: string;
    selectedPlatform?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  dataStatus: {
    importCount: number;
    rowCount: number;
    latestImportedAt?: string;
    latestDataDate?: string;
    qualityScore: number;
    level: "ready" | "partial" | "insufficient";
    productEvidence: "sales" | "catalog_only" | "none";
    campaignEvidence: "detail" | "summary" | "none";
    missingFields: string[];
    warnings: string[];
  };
  summary: {
    effectiveOrders?: number;
    paidAmount?: number;
    averageOrderValue?: number;
    refundAmount?: number;
    refundRate?: number;
    merchantSubsidy?: number;
    platformSubsidy?: number;
    contributionAmount?: number;
    contributionRate?: number;
    averagePrepMinutes?: number;
  };
  funnel: Array<{
    platform: string;
    exposure?: number;
    visits?: number;
    orders?: number;
    effectiveOrders?: number;
    entryRate?: number;
    orderRate?: number;
    completionRate?: number;
    paidAmount?: number;
    averageOrderValue?: number;
    refundAmount?: number;
    refundRate?: number;
    adSpend?: number;
    adGmv?: number;
    adRoi?: number;
    transactionEvidence: "detail" | "funnel" | "aligned" | "conflicting" | "none";
    campaignEvidence: "detail" | "summary" | "none";
  }>;
  trend: Array<{ date: string; effectiveOrders: number; paidAmount: number; refundAmount: number }>;
  products: Array<{ name: string; quantity: number; paidAmount: number; refundAmount: number; contributionAmount?: number }>;
  catalog: Array<{
    name: string;
    category?: string;
    costAmount?: number;
    meituanPrice?: number;
    flashPrice?: number;
    campaignPrice?: number;
    referencePrice?: number;
    costRate?: number;
    portion?: string;
  }>;
  campaigns: Array<{
    name: string;
    platform: string;
    spend: number;
    orders: number;
    gmv: number;
    roi?: number;
    evidence: "detail" | "summary";
    costType: "ad_spend" | "merchant_activity_cost";
  }>;
  anomalies: Array<{
    id: string;
    dimension: "trend" | "funnel" | "product" | "profit" | "campaign" | "fulfillment";
    severity: "high" | "medium" | "notice";
    confidence: "high" | "medium";
    title: string;
    evidence: string;
    comparison: string;
    verification: string;
  }>;
  recentImports: Array<Omit<StoredTakeawayImport, "normalizedRows" | "fieldMappings">>;
}

const demoImports = new Map<string, StoredTakeawayImport>();

const fieldAliases: Record<string, RegExp[]> = {
  date: [/^(订单|下单|支付|统计|营业)?(日期|时间)$/, /^日期$/, /^date$/i],
  city: [/^(所在)?城市(名称)?$/, /^city$/i],
  platform: [/^平台$/, /^(渠道|来源平台)$/, /^platform$/i],
  storeName: [/^(门店|店铺)(名称)?$/, /^门店名$/, /^store(name)?$/i],
  orderId: [/^订单(编号|号|单号|id)$/, /^交易(编号|号)$/, /^orderid$/i],
  orderStatus: [/^订单状态$/, /^状态$/, /^orderstatus$/i],
  productName: [/^(菜品|商品|产品)(名称|名)?$/, /^品名$/, /^product(name)?$/i],
  productItems: [/^(菜品|商品)(信息|明细|详情)$/, /^product(items?|details?)$/i],
  productCategory: [/^(菜品|商品|产品)?(类别|品类|分类)$/, /^category$/i],
  quantity: [/^(商品|菜品)?数量$/, /^购买数量$/, /^份数$/, /^qty$/i],
  originalAmount: [/^(订单|商品)?原价$/, /^原价金额$/, /^original(amount|price)$/i],
  paidAmount: [/^(顾客|用户|订单|商品|商家)?实付(金额|总额)?$/, /^(营业|经营)?收入$/, /^支付金额$/, /^成交金额$/, /^paid(amount)?$/i],
  merchantSubsidy: [/^商家(承担|补贴|优惠)(金额)?$/, /^商家活动(支出|成本)/, /^商家活动支出$/, /^merchantsubsidy$/i],
  platformSubsidy: [/^平台(承担|补贴|优惠)(金额)?$/, /^(平台|饿了么|淘宝闪购)补贴$/, /^platformsubsidy$/i],
  refundAmount: [/^退款(金额)?$/, /^退单(金额|费用)$/, /^refund(amount)?$/i],
  newCustomer: [/^新老客(标识)?$/, /^顾客类型$/, /^是否新客$/, /^newcustomer$/i],
  prepMinutes: [/^(配送)?出餐(时长|时间)$/, /^单均出餐时长$/, /^备餐时长$/, /^preptime$/i],
  costAmount: [/^(商品|菜品|订单)?成本(金额)?$/, /^食材成本$/, /^cost(amount)?$/i],
  meituanPrice: [/^美团(价|价格|售价)$/, /^meituanprice$/i],
  flashPrice: [/^(淘宝)?闪购(价|价格|售价)$/, /^(饿了么)(价|价格|售价)$/, /^flashprice$/i],
  discountedPrice: [/^折后(价|价格)$/, /^discountedprice$/i],
  campaignPrice: [/^(神枪手|超枪手|活动)(价|价格)$/, /^campaignprice$/i],
  discountRate: [/^折扣率$/, /^discountrate$/i],
  benchmarkPrice: [/^(团餐)?基准(价|价格)$/, /^benchmarkprice$/i],
  portion: [/^(售卖信息)?(份量设置|份量|分量|规格)$/, /^portion$/i],
  listingNote: [/^上架备注$/, /^listingnote$/i],
  updateNote: [/^更新备注$/, /^updatenote$/i],
  exposure: [/^曝光(量|人数|次数)?$/, /^展现(量|人数|次数)?$/, /^impressions?$/i],
  visits: [/^(进店|入店|访问)(人数|量|次数)?$/, /^店铺访问人数$/, /^visits?$/i],
  orderCount: [/^(有效)?下单(人数|量|次数)?$/, /^订单(量|数)$/, /^成交订单数$/, /^orders?$/i],
  effectiveOrders: [/^有效(完成)?订单(量|数)?$/, /^完成订单(量|数)?$/, /^有效完成单$/, /^effectiveorders?$/i],
  campaignName: [/^(活动|计划|推广)(名称|名)$/, /^campaign(name)?$/i],
  budget: [/^(活动|计划)?预算$/, /^budget$/i],
  spend: [/^(活动|投放|计划)?(消耗|花费|支出)$/, /^spend$/i],
  clicks: [/^点击(量|人数|次数)?$/, /^clicks?$/i],
  gmv: [/^(成交额|交易额|gmv)$/, /^活动成交额$/i],
  salesQuantity: [/^(销售|售出|销量)(数量|量)?$/, /^sales(quantity)?$/i]
};

/**
 * Normal Chinese headers used by the delivery platforms and by the merchant's
 * menu-maintenance workbooks. Kept independently from legacy aliases so a
 * malformed historical alias cannot prevent a normal Chinese export matching.
 */
const reliableChineseFieldAliases: Record<string, RegExp[]> = {
  date: [/^(订单|下单|支付|统计|营业)?(日期|时间)$/],
  city: [/^(所在)?城市(名称)?$/],
  platform: [/^平台$/, /^(渠道|来源平台)$/],
  storeName: [/^(门店|店铺)(名称)?$/, /^门店名$/],
  orderId: [/^订单(编号|号|单号|id)$/, /^交易(编号|号)$/],
  orderStatus: [/^订单状态$/, /^状态$/],
  productName: [/^(菜品|商品|产品)(名称)?$/, /^品名$/],
  productItems: [/^(菜品|商品)(信息|明细|详情)$/],
  productCategory: [/^(菜品|商品|产品)?(类别|品类|分类)$/, /^类别$/],
  quantity: [/^(商品|菜品)?数量$/, /^购买数量$/, /^份数$/],
  originalAmount: [/^(订单|商品)?原价$/, /^原价金额$/],
  paidAmount: [/^(顾客|用户|订单|商品|商家)?实付(金额|总额)?$/, /^(营业|经营)?收入$/, /^支付金额$/, /^成交金额$/],
  merchantSubsidy: [/^商家(承担|补贴|优惠)(金额)?$/, /^商家活动(支出|成本)$/],
  platformSubsidy: [/^平台(承担|补贴|优惠)(金额)?$/],
  refundAmount: [/^退款(金额)?$/, /^退单(金额|费用)?$/],
  newCustomer: [/^新老客(标识)?$/, /^顾客类型$/, /^是否新客$/],
  prepMinutes: [/^(配送)?出餐(时长|时间)$/, /^单均出餐时长$/, /^备餐时长$/],
  costAmount: [/^(商品|菜品|订单)?成本(金额)?$/, /^食材成本$/],
  meituanPrice: [/^美团(价|价格|售价)$/],
  flashPrice: [/^(淘宝)?闪购(价|价格|售价)$/, /^(饿了么)?(价|价格|售价)$/],
  discountedPrice: [/^折后(价|价格)$/],
  campaignPrice: [/^(神枪手|超枪手|活动)(价|价格)$/],
  discountRate: [/^折扣率$/],
  benchmarkPrice: [/^(团餐)?基准(价|价格)$/],
  portion: [/^(售卖信息)?(份量设置|份量|分量|规格)$/],
  listingNote: [/^上架备注$/],
  updateNote: [/^更新备注$/],
  exposure: [/^曝光(量|人数|次数)?$/, /^展现(量|人数|次数)?$/],
  visits: [/^(进店|入店|访问)(人数|量|次数)?$/, /^店铺访问人数$/],
  orderCount: [/^(有效)?下单(人数|量|次数)?$/, /^订单(量|数)$/, /^成交订单数$/],
  effectiveOrders: [/^有效(完成)?订单(量|数)?$/, /^完成订单(量|数)?$/],
  campaignName: [/^(活动|计划|推广)(名称)?$/],
  budget: [/^(活动|计划)?预算$/],
  spend: [/^(活动|投放|计划)?(消耗|花费|支出)$/],
  clicks: [/^点击(量|人数|次数)?$/],
  gmv: [/^(成交额|交易额|gmv)$/],
  salesQuantity: [/^(销量|售出|销售量)(数量|量)?$/]
};

const criticalFields: Record<TakeawaySourceKind, string[]> = {
  orders: ["date", "orderId", "orderStatus", "paidAmount", "refundAmount"],
  funnel: ["date", "exposure", "visits", "orderCount"],
  products: ["date", "productName", "salesQuantity", "paidAmount"],
  campaigns: ["date", "campaignName", "spend", "exposure", "clicks", "orderCount", "gmv"],
  catalog: ["productName", "costAmount"]
};

function readTakeawayWorkbook(buffer: Buffer, filename: string): XLSX.WorkBook {
  const readOptions = { type: "buffer" as const, cellDates: true, dense: true };
  if (/\.json$/i.test(filename)) return readJsonWorkbook(buffer);
  if (!/\.(csv|tsv|txt)$/i.test(filename)) return XLSX.read(buffer, readOptions);
  const candidates = [undefined, 936].map((codepage) => {
    const workbook = XLSX.read(buffer, codepage ? { ...readOptions, codepage } : readOptions);
    return { workbook, score: workbookHeaderScore(workbook) };
  });
  return candidates.sort((a, b) => b.score - a.score)[0]!.workbook;
}

function readJsonWorkbook(buffer: Buffer): XLSX.WorkBook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw Object.assign(new Error("JSON 文件无法解析，请上传对象数组、二维数组，或包含 data/rows/items 数组的文件。"), { statusCode: 400 });
  }
  const workbook = XLSX.utils.book_new();
  const append = (name: string, value: unknown): boolean => {
    if (!Array.isArray(value) || value.length === 0) return false;
    const sheet = Array.isArray(value[0])
      ? XLSX.utils.aoa_to_sheet(value as Cell[][])
      : XLSX.utils.json_to_sheet(value as Record<string, unknown>[]);
    XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31) || "数据");
    return true;
  };
  if (append("数据", parsed)) return workbook;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const preferred = ["data", "rows", "items", "records"];
    for (const key of preferred) {
      if (append(key, record[key])) return workbook;
    }
    let count = 0;
    for (const [key, value] of Object.entries(record)) {
      if (append(key, value)) count += 1;
      if (count >= 20) break;
    }
    if (count > 0) return workbook;
  }
  throw Object.assign(new Error("JSON 中未找到可导入的数据数组；支持对象数组、二维数组及 data/rows/items/records。"), { statusCode: 400 });
}

function workbookHeaderScore(workbook: XLSX.WorkBook): number {
  return workbook.SheetNames.reduce((score, sheetName) => {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: false });
    const sheetScore = rows.slice(0, 20).reduce((highest, row) => Math.max(highest, Object.keys(mapHeaders(row.map(text))).length), 0);
    return score + sheetScore;
  }, 0);
}

export function parseTakeawayWorkbook(params: {
  filename: string;
  buffer: Buffer;
  tenantId: string;
  platformHint?: string;
  storeNameHint?: string;
}): ParsedTakeawayImport {
  const workbook = readTakeawayWorkbook(params.buffer, params.filename);
  const normalizedRows: TakeawayNormalizedRow[] = [];
  const warnings: string[] = [];
  const detectedSheets: ParsedTakeawayImport["detectedSheets"] = [];
  const fieldMappings: Record<string, string> = {};
  const observedCanonicalFields = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    const header = findHeader(rows);
    if (!header) {
      detectedSheets.push({ name: sheetName, rowCount: 0 });
      warnings.push(`工作表“${sheetName}”未识别到经营数据表头，已跳过。`);
      continue;
    }
    const mapping = mapHeaders(header.values);
    const kind = inferSourceKind(mapping);
    if (!kind) {
      detectedSheets.push({ name: sheetName, rowCount: 0 });
      warnings.push(`工作表“${sheetName}”字段不足，无法判断是订单、漏斗、商品还是活动数据。`);
      continue;
    }
    Object.entries(mapping).forEach(([canonical, original]) => {
      fieldMappings[`${sheetName}.${canonical}`] = original;
      observedCanonicalFields.add(canonical);
    });
    const parsedRows = rows.slice(header.index + 1)
      .map((row, index) => normalizeRow({
        row,
        rowNumber: header.index + index + 2,
        sheetName,
        kind,
        headers: header.values,
        mapping,
        tenantId: params.tenantId,
        platformHint: params.platformHint ?? inferPlatformFromText(`${params.filename} ${sheetName}`),
        storeNameHint: params.storeNameHint
      }))
      .filter((row): row is TakeawayNormalizedRow => Boolean(row));
    normalizedRows.push(...parsedRows);
    detectedSheets.push({ name: sheetName, kind, rowCount: parsedRows.length });
  }

  if (normalizedRows.length === 0) {
    throw Object.assign(new Error("文件可以打开，但未识别出支持的业务表。当前可识别：订单明细、经营漏斗、菜品销量、菜品成本/价格货盘、活动投放；允许标题行位于表头上方。"), { statusCode: 400 });
  }

  const kinds = [...new Set(normalizedRows.map((row) => row.kind))];
  const missingFields = [...new Set(kinds.flatMap((kind) => criticalFields[kind].filter((field) => !observedCanonicalFields.has(field))))];
  const orderKeys = normalizedRows.filter((row) => row.kind === "orders" && row.orderKey).map((row) => row.orderKey!);
  const duplicateCount = orderKeys.length - new Set(orderKeys).size;
  if (duplicateCount > 0) warnings.push(`识别到 ${duplicateCount} 条重复订单/商品行；订单指标将按订单号去重。`);
  validateRows(normalizedRows, warnings);
  const dates = normalizedRows.map((row) => row.date).filter((value): value is string => Boolean(value)).sort();
  const platforms = [...new Set(normalizedRows.map((row) => row.platform).filter((value): value is string => Boolean(value)))];
  const stores = [...new Set(normalizedRows.map((row) => row.storeName).filter((value): value is string => Boolean(value)))];
  const requiresDate = kinds.some((kind) => kind !== "catalog");
  const penalty = missingFields.length * 8 + Math.min(24, warnings.length * 5) + (requiresDate && dates.length === 0 ? 20 : 0);

  return {
    filename: params.filename,
    sha256: createHash("sha256").update(params.buffer).digest("hex"),
    sourceKind: kinds.length === 1 ? kinds[0] : "mixed",
    platform: platforms.length === 1 ? platforms[0] : params.platformHint,
    storeName: stores.length === 1 ? stores[0] : params.storeNameHint,
    dateFrom: dates[0],
    dateTo: dates.at(-1),
    rowCount: normalizedRows.length,
    duplicateCount,
    qualityScore: Math.max(0, Math.min(100, 100 - penalty)),
    fieldMappings,
    missingFields,
    warnings: [...new Set(warnings)].slice(0, 12),
    normalizedRows,
    detectedSheets
  };
}

export async function saveTakeawayImport(params: {
  tenantId: string;
  userId?: string;
  parsed: ParsedTakeawayImport;
}): Promise<{ record: StoredTakeawayImport; duplicateFile: boolean }> {
  if (env.DATA_MODE === "demo") {
    const existing = [...demoImports.values()].find((item) => item.tenantId === params.tenantId && item.sha256 === params.parsed.sha256);
    if (existing) {
      const refreshed = { ...existing, ...params.parsed, userId: params.userId ?? existing.userId };
      demoImports.set(existing.id, refreshed);
      return { record: refreshed, duplicateFile: true };
    }
    const record: StoredTakeawayImport = {
      id: randomUUID(),
      tenantId: params.tenantId,
      userId: params.userId,
      ...params.parsed,
      createdAt: new Date().toISOString()
    };
    demoImports.set(record.id, record);
    return { record, duplicateFile: false };
  }

  const existing = await prisma.takeawayDataImport.findUnique({
    where: { tenantId_sha256: { tenantId: params.tenantId, sha256: params.parsed.sha256 } }
  });
  if (existing) {
    const refreshed = await prisma.takeawayDataImport.update({
      where: { id: existing.id },
      data: {
        userId: params.userId ?? existing.userId,
        filename: params.parsed.filename,
        sourceKind: params.parsed.sourceKind,
        platform: params.parsed.platform,
        storeName: params.parsed.storeName,
        dateFrom: params.parsed.dateFrom ? new Date(`${params.parsed.dateFrom}T00:00:00.000Z`) : null,
        dateTo: params.parsed.dateTo ? new Date(`${params.parsed.dateTo}T00:00:00.000Z`) : null,
        rowCount: params.parsed.rowCount,
        duplicateCount: params.parsed.duplicateCount,
        qualityScore: params.parsed.qualityScore,
        fieldMappings: params.parsed.fieldMappings as Prisma.InputJsonValue,
        missingFields: params.parsed.missingFields as Prisma.InputJsonValue,
        warnings: params.parsed.warnings as Prisma.InputJsonValue,
        normalizedRows: JSON.parse(JSON.stringify(params.parsed.normalizedRows)) as Prisma.InputJsonValue
      }
    });
    return { record: databaseRecord(refreshed), duplicateFile: true };
  }
  const created = await prisma.takeawayDataImport.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      filename: params.parsed.filename,
      sha256: params.parsed.sha256,
      sourceKind: params.parsed.sourceKind,
      platform: params.parsed.platform,
      storeName: params.parsed.storeName,
      dateFrom: params.parsed.dateFrom ? new Date(`${params.parsed.dateFrom}T00:00:00.000Z`) : undefined,
      dateTo: params.parsed.dateTo ? new Date(`${params.parsed.dateTo}T00:00:00.000Z`) : undefined,
      rowCount: params.parsed.rowCount,
      duplicateCount: params.parsed.duplicateCount,
      qualityScore: params.parsed.qualityScore,
      fieldMappings: params.parsed.fieldMappings as Prisma.InputJsonValue,
      missingFields: params.parsed.missingFields as Prisma.InputJsonValue,
      warnings: params.parsed.warnings as Prisma.InputJsonValue,
      normalizedRows: JSON.parse(JSON.stringify(params.parsed.normalizedRows)) as Prisma.InputJsonValue
    }
  });
  return { record: databaseRecord(created), duplicateFile: false };
}

export async function listTakeawayImports(tenantId: string): Promise<StoredTakeawayImport[]> {
  if (env.DATA_MODE === "demo") {
    return [...demoImports.values()].filter((item) => item.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const records = await prisma.takeawayDataImport.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
  return records.map(databaseRecord);
}

export async function buildTakeawayDashboard(params: {
  tenantId: string;
  storeName?: string;
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<TakeawayDashboard> {
  const imports = await listTakeawayImports(params.tenantId);
  const allRows = imports.flatMap((record) => record.normalizedRows);
  const stores = [...new Set(allRows.map((row) => row.storeName).filter((value): value is string => Boolean(value)))].sort();
  const platforms = [...new Set(allRows.map((row) => row.platform).filter((value): value is string => Boolean(value)))].sort();
  const rows = allRows.filter((row) => {
    if (params.storeName && row.storeName !== params.storeName) return false;
    if (params.platform && row.platform !== params.platform) return false;
    if (params.dateFrom && (!row.date || row.date < params.dateFrom)) return false;
    if (params.dateTo && (!row.date || row.date > params.dateTo)) return false;
    return true;
  });
  const selectedImports = imports.filter((record) => record.normalizedRows.some((row) => rows.includes(row)));
  const orderRows = rows.filter((row) => row.kind === "orders");
  const uniqueOrders = new Map<string, TakeawayNormalizedRow>();
  orderRows.forEach((row, index) => {
    const key = row.orderKey ?? `${row.sheetName}|${row.rowNumber}|${index}`;
    if (!uniqueOrders.has(key)) uniqueOrders.set(key, row);
  });
  const orderValues = [...uniqueOrders.values()];
  const effectiveOrderRows = orderValues.filter(isEffectiveOrder);
  const funnelRowsAll = rows.filter((row) => row.kind === "funnel");
  const paidAmountFromOrders = sum(effectiveOrderRows.map((row) => row.paidAmount));
  const reportedEffectiveOrders = optionalSum(funnelRowsAll.map((row) => row.effectiveOrders ?? row.orderCount));
  const reportedPaidAmount = optionalSum(funnelRowsAll.map((row) => row.gmv ?? row.paidAmount));
  const effectiveOrdersTotal = orderValues.length ? effectiveOrderRows.length : reportedEffectiveOrders;
  const paidAmount = orderValues.length ? paidAmountFromOrders : reportedPaidAmount;
  const refundAmount = sum(orderValues.map((row) => row.refundAmount));
  const merchantSubsidy = sum(orderValues.map((row) => row.merchantSubsidy));
  const platformSubsidy = sum(orderValues.map((row) => row.platformSubsidy));
  const costRows = effectiveOrderRows.filter((row) => row.costAmount !== undefined);
  const productMetricRows = rows.filter((row) => row.kind === "products");
  const catalogRows = rows.filter((row) => row.kind === "catalog" && row.productName);
  const productRowsWithCost = productMetricRows.filter((row) => row.costAmount !== undefined && row.paidAmount !== undefined);
  const contributionAmount = costRows.length
    ? sum(costRows.map((row) => (row.paidAmount ?? 0) - (row.refundAmount ?? 0) - (row.merchantSubsidy ?? 0) - (row.costAmount ?? 0)))
    : productRowsWithCost.length
      ? sum(productRowsWithCost.map((row) => (row.paidAmount ?? 0) - (row.refundAmount ?? 0) - (row.costAmount ?? 0)))
      : undefined;
  const prepRows = effectiveOrderRows.map((row) => row.prepMinutes).filter((value): value is number => value !== undefined);

  const trendMap = new Map<string, { effectiveOrders: number; paidAmount: number; refundAmount: number }>();
  orderValues.forEach((row) => {
    if (!row.date) return;
    const current = trendMap.get(row.date) ?? { effectiveOrders: 0, paidAmount: 0, refundAmount: 0 };
    if (isEffectiveOrder(row)) {
      current.effectiveOrders += 1;
      current.paidAmount += row.paidAmount ?? 0;
    }
    current.refundAmount += row.refundAmount ?? 0;
    trendMap.set(row.date, current);
  });
  if (trendMap.size === 0) {
    funnelRowsAll.forEach((row) => {
      if (!row.date) return;
      const current = trendMap.get(row.date) ?? { effectiveOrders: 0, paidAmount: 0, refundAmount: 0 };
      current.effectiveOrders += row.effectiveOrders ?? row.orderCount ?? 0;
      current.paidAmount += row.gmv ?? row.paidAmount ?? 0;
      current.refundAmount += row.refundAmount ?? 0;
      trendMap.set(row.date, current);
    });
  }

  const productMap = new Map<string, { quantity: number; paidAmount: number; refundAmount: number; costAmount: number; hasCost: boolean }>();
  const productSourceRows = productMetricRows.length ? productMetricRows : rows.filter((row) => row.kind === "orders");
  productSourceRows.forEach((row) => {
    const items = row.productItems?.length
      ? row.productItems
      : row.productName
        ? [{ name: normalizeProductName(row.productName), quantity: row.quantity ?? row.salesQuantity ?? 0, unitPrice: undefined }]
        : [];
    const listedTotal = sum(items.map((item) => item.unitPrice === undefined ? undefined : item.unitPrice * item.quantity));
    const quantityTotal = sum(items.map((item) => item.quantity));
    items.forEach((item) => {
      const current = productMap.get(item.name) ?? { quantity: 0, paidAmount: 0, refundAmount: 0, costAmount: 0, hasCost: false };
      const weight = listedTotal > 0 && item.unitPrice !== undefined
        ? item.unitPrice * item.quantity / listedTotal
        : quantityTotal > 0 ? item.quantity / quantityTotal : 0;
      current.quantity += item.quantity;
      current.paidAmount += row.productItems?.length ? (row.paidAmount ?? 0) * weight : row.paidAmount ?? 0;
      current.refundAmount += row.productItems?.length ? (row.refundAmount ?? 0) * weight : row.refundAmount ?? 0;
      if (row.costAmount !== undefined && items.length === 1) { current.costAmount += row.costAmount; current.hasCost = true; }
      productMap.set(item.name, current);
    });
  });

  const funnelPlatforms = [...new Set(rows.map((row) => row.platform).filter((value): value is string => Boolean(value)))];
  let funnel: TakeawayDashboard["funnel"] = funnelPlatforms.map((platform) => {
    const platformRows = rows.filter((row) => row.platform === platform);
    const funnelRows = platformRows.filter((row) => row.kind === "funnel");
    const exposure = optionalSum(funnelRows.map((row) => row.exposure));
    const visits = optionalSum(funnelRows.map((row) => row.visits));
    const reportedOrders = optionalSum(funnelRows.map((row) => row.orderCount));
    const platformOrders = orderValues.filter((row) => row.platform === platform);
    const orders = reportedOrders ?? platformOrders.length;
    const effectiveOrders = optionalSum(funnelRows.map((row) => row.effectiveOrders))
      ?? (platformOrders.length ? platformOrders.filter(isEffectiveOrder).length : undefined);
    return {
      platform,
      exposure,
      visits,
      orders,
      effectiveOrders,
      entryRate: ratio(visits, exposure),
      orderRate: ratio(orders, visits),
      completionRate: ratio(effectiveOrders, orders),
      transactionEvidence: "none" as const,
      campaignEvidence: "none" as const
    };
  });

  const detailedCampaignRows = rows.filter((row) => row.kind === "campaigns");
  const campaignSummaryRows = rows.filter((row) => row.kind !== "campaigns" && row.merchantSubsidy !== undefined);
  const campaignMap = new Map<string, {
    name: string;
    platform: string;
    spend: number;
    orders: number;
    gmv: number;
    evidence: "detail" | "summary";
    costType: "ad_spend" | "merchant_activity_cost";
  }>();
  detailedCampaignRows.forEach((row) => {
    const name = row.campaignName || "未命名活动";
    const platform = row.platform || "未识别平台";
    const key = `${platform}|${name}`;
    const current = campaignMap.get(key) ?? { name, platform, spend: 0, orders: 0, gmv: 0, evidence: "detail", costType: "ad_spend" };
    current.spend += row.spend ?? 0;
    current.orders += row.orderCount ?? 0;
    current.gmv += row.gmv ?? row.paidAmount ?? 0;
    campaignMap.set(key, current);
  });
  if (detailedCampaignRows.length === 0) {
    campaignSummaryRows.forEach((row) => {
      const name = "平台活动成本汇总（非广告消耗）";
      const platform = row.platform || "未识别平台";
      const key = `${platform}|${name}`;
      const current = campaignMap.get(key) ?? { name, platform, spend: 0, orders: 0, gmv: 0, evidence: "summary", costType: "merchant_activity_cost" };
      current.spend += row.merchantSubsidy ?? 0;
      current.orders += row.effectiveOrders ?? row.orderCount ?? 0;
      campaignMap.set(key, current);
    });
  }

  const missingFields = [...new Set(selectedImports.flatMap((record) => record.missingFields))];
  const warnings = [...new Set(selectedImports.flatMap((record) => record.warnings))];
  let criticalFunnelAnomalies = 0;
  funnel.forEach((item) => {
    const detailedOrderCount = orderValues.filter((row) => row.platform === item.platform).length;
    if (detailedOrderCount > 0 && item.orders !== undefined && item.orders !== detailedOrderCount) {
      warnings.push(`${item.platform}漏斗订单量为 ${item.orders}，逐单明细去重后为 ${detailedOrderCount}；请确认文件周期和订单口径是否一致。`);
    }
    if (item.orders !== undefined && item.effectiveOrders !== undefined && item.effectiveOrders > item.orders) {
      criticalFunnelAnomalies += 1;
      warnings.push(`${item.platform}有效完成单 ${item.effectiveOrders} 高于下单量 ${item.orders}，漏斗发生倒挂；可能存在周期或指标口径不一致，修正前不得用于增长归因。`);
    }
  });
  const baseQualityScore = selectedImports.length ? Math.round(sum(selectedImports.map((record) => record.qualityScore)) / selectedImports.length) : 0;
  const qualityScore = Math.max(0, baseQualityScore
    - Math.max(0, warnings.length - selectedImports.flatMap((record) => record.warnings).length) * 8
    - criticalFunnelAnomalies * 15);
  const latestDataDate = rows.map((row) => row.date).filter((value): value is string => Boolean(value)).sort().at(-1);
  const trend = [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value }));
  const products = [...productMap.entries()]
    .map(([name, value]) => ({
      name,
      quantity: value.quantity,
      paidAmount: value.paidAmount,
      refundAmount: value.refundAmount,
      contributionAmount: value.hasCost ? value.paidAmount - value.refundAmount - value.costAmount : undefined
    }))
    .sort((a, b) => b.paidAmount - a.paidAmount)
    .slice(0, 10);
  const catalog = catalogRows
    .map((row) => {
      const referencePrice = row.campaignPrice ?? row.discountedPrice ?? row.meituanPrice ?? row.flashPrice ?? row.benchmarkPrice;
      return {
        name: row.productName!,
        category: row.productCategory,
        costAmount: row.costAmount,
        meituanPrice: row.meituanPrice,
        flashPrice: row.flashPrice,
        campaignPrice: row.campaignPrice,
        referencePrice,
        costRate: referencePrice && row.costAmount !== undefined ? row.costAmount / referencePrice : undefined,
        portion: row.portion
      };
    })
    .sort((a, b) => (b.costRate ?? -1) - (a.costRate ?? -1))
    .slice(0, 20);
  const campaigns = [...campaignMap.values()]
    .map((value) => ({ ...value, roi: value.evidence === "detail" && value.spend > 0 ? value.gmv / value.spend : undefined }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 10);
  const campaignByPlatform = new Map<string, { spend: number; gmv: number; evidence: "detail" | "summary" }>();
  campaignMap.forEach((campaign) => {
    const current = campaignByPlatform.get(campaign.platform);
    campaignByPlatform.set(campaign.platform, {
      spend: (current?.spend ?? 0) + campaign.spend,
      gmv: (current?.gmv ?? 0) + campaign.gmv,
      evidence: current?.evidence === "detail" || campaign.evidence === "detail" ? "detail" : "summary"
    });
  });
  funnel = funnel.map((item) => {
    const platformOrders = orderValues.filter((row) => row.platform === item.platform);
    const effectivePlatformOrders = platformOrders.filter(isEffectiveOrder);
    const hasDetailedOrders = platformOrders.length > 0;
    const hasFunnelRows = rows.some((row) => row.platform === item.platform && row.kind === "funnel");
    const transactionEvidence = hasDetailedOrders && hasFunnelRows
      ? (item.orders === platformOrders.length && item.effectiveOrders === effectivePlatformOrders.length ? "aligned" : "conflicting")
      : hasDetailedOrders ? "detail" : hasFunnelRows ? "funnel" : "none";
    const paid = effectivePlatformOrders.length ? sum(effectivePlatformOrders.map((row) => row.paidAmount)) : undefined;
    const refunds = platformOrders.length ? sum(platformOrders.map((row) => row.refundAmount)) : undefined;
    const refundRate = platformOrders.length
      ? platformOrders.filter((row) => (row.refundAmount ?? 0) > 0 || /退款|退单/.test(row.orderStatus ?? "")).length / platformOrders.length
      : undefined;
    const campaign = campaignByPlatform.get(item.platform);
    const hasDetailedCampaign = campaign?.evidence === "detail" && campaign.spend > 0;
    return {
      ...item,
      paidAmount: paid,
      averageOrderValue: effectivePlatformOrders.length && paid !== undefined ? paid / effectivePlatformOrders.length : undefined,
      refundAmount: refunds,
      refundRate,
      transactionEvidence,
      adSpend: hasDetailedCampaign ? campaign.spend : undefined,
      adGmv: hasDetailedCampaign ? campaign.gmv : undefined,
      adRoi: hasDetailedCampaign ? campaign.gmv / campaign.spend : undefined,
      campaignEvidence: campaign?.evidence ?? "none"
    };
  });
  const anomalies = detectTakeawayAnomalies({
    trend,
    funnel,
    products,
    catalog,
    campaigns,
    averagePrepMinutes: prepRows.length ? sum(prepRows) / prepRows.length : undefined
  });
  return {
    generatedAt: new Date().toISOString(),
    filters: { stores, platforms, selectedStore: params.storeName, selectedPlatform: params.platform, dateFrom: params.dateFrom, dateTo: params.dateTo },
    dataStatus: {
      importCount: selectedImports.length,
      rowCount: rows.length,
      latestImportedAt: selectedImports.map((record) => record.createdAt).sort().at(-1),
      latestDataDate,
      qualityScore,
      level: qualityScore >= 80 && rows.length > 0 ? "ready" : rows.length > 0 ? "partial" : "insufficient",
      productEvidence: productMap.size > 0 ? "sales" : catalogRows.length > 0 ? "catalog_only" : "none",
      campaignEvidence: detailedCampaignRows.length > 0 ? "detail" : campaignSummaryRows.length > 0 ? "summary" : "none",
      missingFields,
      warnings: [...new Set(warnings)].slice(0, 8)
    },
    summary: {
      effectiveOrders: effectiveOrdersTotal,
      paidAmount,
      averageOrderValue: effectiveOrdersTotal && paidAmount !== undefined ? paidAmount / effectiveOrdersTotal : undefined,
      refundAmount: orderValues.length ? refundAmount : undefined,
      refundRate: orderValues.length ? orderValues.filter((row) => (row.refundAmount ?? 0) > 0 || /退款|退单/.test(row.orderStatus ?? "")).length / orderValues.length : undefined,
      merchantSubsidy: orderValues.length ? merchantSubsidy : undefined,
      platformSubsidy: orderValues.length ? platformSubsidy : undefined,
      contributionAmount,
      contributionRate: contributionAmount !== undefined ? ratio(contributionAmount, paidAmount) : undefined,
      averagePrepMinutes: prepRows.length ? sum(prepRows) / prepRows.length : undefined
    },
    funnel,
    trend,
    products,
    catalog,
    campaigns,
    anomalies,
    recentImports: imports.map(({ normalizedRows: _rows, fieldMappings: _mappings, ...record }) => record)
  };
}

function detectTakeawayAnomalies(input: {
  trend: TakeawayDashboard["trend"];
  funnel: TakeawayDashboard["funnel"];
  products: TakeawayDashboard["products"];
  catalog: TakeawayDashboard["catalog"];
  campaigns: TakeawayDashboard["campaigns"];
  averagePrepMinutes?: number;
}): TakeawayDashboard["anomalies"] {
  const anomalies: TakeawayDashboard["anomalies"] = [];
  const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatNum = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
  const average = (values: number[]) => values.length ? sum(values) / values.length : 0;

  if (input.trend.length >= 10) {
    const recent = input.trend.slice(-7);
    const prior = input.trend.slice(-14, -7);
    const recentOrders = average(recent.map((item) => item.effectiveOrders));
    const priorOrders = average(prior.map((item) => item.effectiveOrders));
    if (prior.length >= 3 && priorOrders >= 5) {
      const change = recentOrders / priorOrders - 1;
      if (change <= -0.12) {
        anomalies.push({
          id: "recent-order-drop",
          dimension: "trend",
          severity: change <= -0.25 ? "high" : "medium",
          confidence: prior.length >= 7 ? "high" : "medium",
          title: "最近7天有效订单明显下降",
          evidence: `最近7天日均 ${formatNum(recentOrders)} 单，之前7天日均 ${formatNum(priorOrders)} 单，下降 ${formatPct(Math.abs(change))}。`,
          comparison: `同一数据范围内的相邻7天对比；最近日期为 ${recent.at(-1)?.date ?? "待识别"}。`,
          verification: "先按平台拆分最近14天曝光、进店、下单和有效订单，找到最早下降的环节，再排除节假日、缺货和停业日。"
        });
      }
    }
    const positiveDays = input.trend.filter((item) => item.effectiveOrders > 0);
    const orderMedian = median(positiveDays.map((item) => item.effectiveOrders));
    const lowest = [...positiveDays].sort((a, b) => a.effectiveOrders - b.effectiveOrders)[0];
    if (lowest && orderMedian >= 5 && lowest.effectiveOrders <= orderMedian * 0.65) {
      anomalies.push({
        id: `order-outlier-${lowest.date}`,
        dimension: "trend",
        severity: "medium",
        confidence: positiveDays.length >= 14 ? "high" : "medium",
        title: `${lowest.date.slice(5)} 出现订单低谷`,
        evidence: `当天 ${formatNum(lowest.effectiveOrders)} 单，低于有订单日期中位数 ${formatNum(orderMedian)} 单 ${formatPct(1 - lowest.effectiveOrders / orderMedian)}。`,
        comparison: `在 ${positiveDays.length} 个有订单日期中寻找低位异常。`,
        verification: "核对当天平台、时段、缺货、配送范围、营业状态和活动变更，确认是经营异常还是特殊日期。"
      });
    }

    const recentAov = average(recent.filter((item) => item.effectiveOrders > 0).map((item) => item.paidAmount / item.effectiveOrders));
    const priorAov = average(prior.filter((item) => item.effectiveOrders > 0).map((item) => item.paidAmount / item.effectiveOrders));
    if (priorAov > 0 && recentAov > 0) {
      const orderChange = priorOrders > 0 ? recentOrders / priorOrders - 1 : 0;
      const aovChange = recentAov / priorAov - 1;
      if (aovChange <= -0.1 && orderChange <= -0.05) {
        anomalies.push({
          id: "compound-order-aov-drop",
          dimension: "trend",
          severity: orderChange <= -0.2 ? "high" : "medium",
          confidence: prior.length >= 7 ? "high" : "medium",
          title: "近期订单与客单价同步走弱",
          evidence: `最近7天日均有效订单 ${formatNum(recentOrders)} 单（较前7天下降 ${formatPct(Math.abs(orderChange))}），客单价 ${formatNum(recentAov)} 元（下降 ${formatPct(Math.abs(aovChange))}）。`,
          comparison: "同一门店、相邻两个7天周期，同时比较订单量和每单实付金额。",
          verification: "按平台和菜品拆分最近14天的订单、客单、套餐占比与优惠，核对是否同一轮调价、货盘或活动变化后同时发生。"
        });
      }
    }

    const weekdayBuckets = new Map<number, typeof input.trend>();
    for (const item of input.trend) {
      const weekday = new Date(`${item.date}T00:00:00`).getDay();
      if (Number.isNaN(weekday)) continue;
      const bucket = weekdayBuckets.get(weekday) ?? [];
      bucket.push(item);
      weekdayBuckets.set(weekday, bucket);
    }
    const weekdayAverages = Array.from(weekdayBuckets.entries())
      .filter(([, rows]) => rows.length >= 3)
      .map(([weekday, rows]) => ({ weekday, orders: average(rows.map((item) => item.effectiveOrders)), samples: rows.length }));
    const weakWeekday = [...weekdayAverages].sort((a, b) => a.orders - b.orders)[0];
    const strongWeekday = [...weekdayAverages].sort((a, b) => b.orders - a.orders)[0];
    if (weakWeekday && strongWeekday && strongWeekday.orders >= 5 && weakWeekday.orders <= strongWeekday.orders * 0.7) {
      const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      anomalies.push({
        id: "compound-recurring-weekday-gap",
        dimension: "trend",
        severity: "medium",
        confidence: weekdayAverages.length >= 4 ? "high" : "medium",
        title: `${weekdayNames[weakWeekday.weekday]}重复出现订单偏低`,
        evidence: `${weekdayNames[weakWeekday.weekday]}的 ${weakWeekday.samples} 个样本日均 ${formatNum(weakWeekday.orders)} 单，低于${weekdayNames[strongWeekday.weekday]}日均 ${formatNum(strongWeekday.orders)} 单 ${formatPct(1 - weakWeekday.orders / strongWeekday.orders)}。`,
        comparison: "按同一门店的星期维度聚合，而非只取单日最低值。",
        verification: `连续两个${weekdayNames[weakWeekday.weekday]}分别记录平台曝光、进店、缺货、营业时段和活动，判断是固定时段承接问题还是偶发特殊日期。`
      });
    }
  }

  const comparableFunnel = input.funnel.filter((item) => item.entryRate !== undefined && item.orderRate !== undefined);
  if (comparableFunnel.length >= 2) {
    const entrySorted = [...comparableFunnel].sort((a, b) => (a.entryRate ?? 0) - (b.entryRate ?? 0));
    const low = entrySorted[0]!;
    const high = entrySorted.at(-1)!;
    if ((high.entryRate ?? 0) > 0 && (low.entryRate ?? 0) <= (high.entryRate ?? 0) * 0.85) {
      anomalies.push({
        id: "platform-entry-gap",
        dimension: "funnel",
        severity: "medium",
        confidence: "high",
        title: `${low.platform}进店效率落后于${high.platform}`,
        evidence: `${low.platform}进店率 ${formatPct(low.entryRate ?? 0)}，${high.platform}为 ${formatPct(high.entryRate ?? 0)}。`,
        comparison: "同一筛选周期、同一门店范围的平台横向对比。",
        verification: `保持价格和活动不变，先核查${low.platform}搜索排名、主图、配送范围与营业时长；连续7天记录曝光和进店率。`
      });
    }
    const orderSorted = [...comparableFunnel].sort((a, b) => (a.orderRate ?? 0) - (b.orderRate ?? 0));
    const lowOrder = orderSorted[0]!;
    const highOrder = orderSorted.at(-1)!;
    if ((highOrder.orderRate ?? 0) > 0 && (lowOrder.orderRate ?? 0) <= (highOrder.orderRate ?? 0) * 0.85) {
      anomalies.push({
        id: "platform-order-gap",
        dimension: "funnel",
        severity: "medium",
        confidence: "high",
        title: `${lowOrder.platform}下单转化明显偏低`,
        evidence: `${lowOrder.platform}下单转化 ${formatPct(lowOrder.orderRate ?? 0)}，${highOrder.platform}为 ${formatPct(highOrder.orderRate ?? 0)}。`,
        comparison: "同一筛选周期、同一门店范围的平台横向对比。",
        verification: `检查${lowOrder.platform}货盘、价格带、优惠表达和必选项；一次只改一个入口，观察7天进店到下单转化。`
      });
    }
    if (low.platform === lowOrder.platform && (high.entryRate ?? 0) > 0 && (highOrder.orderRate ?? 0) > 0
      && (low.entryRate ?? 0) <= (high.entryRate ?? 0) * 0.85 && (lowOrder.orderRate ?? 0) <= (highOrder.orderRate ?? 0) * 0.85) {
      anomalies.push({
        id: "compound-platform-funnel-break",
        dimension: "funnel",
        severity: "high",
        confidence: "high",
        title: `${low.platform}存在“流量到下单”双断点`,
        evidence: `${low.platform}进店率 ${formatPct(low.entryRate ?? 0)}，低于${high.platform}的 ${formatPct(high.entryRate ?? 0)}；下单转化 ${formatPct(lowOrder.orderRate ?? 0)}，也低于${highOrder.platform}的 ${formatPct(highOrder.orderRate ?? 0)}。`,
        comparison: "同一门店、同一周期的双平台漏斗对比；两个相邻环节同时落后。",
        verification: `先保持${low.platform}价格和活动不变，核对搜索排名、主图、配送范围、货盘和优惠表达；连续7天分别记录曝光→进店→下单，确认先改善哪一环。`
      });
    }
  }

  if (input.products.length >= 3) {
    const totalPaid = sum(input.products.map((item) => item.paidAmount));
    const top = input.products[0];
    if (top && totalPaid > 0 && top.paidAmount / totalPaid >= 0.35) {
      anomalies.push({
        id: "product-concentration",
        dimension: "product",
        severity: top.paidAmount / totalPaid >= 0.5 ? "high" : "notice",
        confidence: "high",
        title: "成交额过度集中在单一菜品",
        evidence: `${top.name}占已识别TOP菜品成交额 ${formatPct(top.paidAmount / totalPaid)}。`,
        comparison: `已识别 ${input.products.length} 个主要菜品的成交额结构。`,
        verification: "观察该菜品缺货或排名变化时总订单是否同步波动，并测试一个同价格带替代套餐承接流量。"
      });
    }
  }

  const highCostItem = input.catalog.find((item) => (item.costRate ?? 0) >= 0.55);
  if (highCostItem?.costRate !== undefined) {
    anomalies.push({
      id: "high-product-cost-rate",
      dimension: "profit",
      severity: highCostItem.costRate >= 0.7 ? "high" : "medium",
      confidence: "medium",
      title: "部分菜品成本率可能挤压利润",
      evidence: `${highCostItem.name}按当前参考售价计算的成本率为 ${formatPct(highCostItem.costRate)}。`,
      comparison: "系统阈值为55%；尚未计入平台扣点、包装、配送和退款。",
      verification: "先核对成本和实际成交价，再补齐平台费用、包装和活动成本，确认单品真实贡献额后再决定是否改价。"
    });
  }

  const priceGapItem = input.catalog
    .map((item) => ({ ...item, priceGap: item.meituanPrice !== undefined && item.flashPrice !== undefined && Math.max(item.meituanPrice, item.flashPrice) > 0 ? Math.abs(item.meituanPrice - item.flashPrice) / Math.max(item.meituanPrice, item.flashPrice) : 0 }))
    .sort((a, b) => b.priceGap - a.priceGap)[0];
  if (priceGapItem && priceGapItem.priceGap >= 0.08 && priceGapItem.meituanPrice !== undefined && priceGapItem.flashPrice !== undefined) {
    anomalies.push({
      id: "compound-cross-platform-price-gap",
      dimension: "product",
      severity: "medium",
      confidence: "medium",
      title: "同一菜品双平台价格策略存在明显差异",
      evidence: `${priceGapItem.name}在美团 ${formatNum(priceGapItem.meituanPrice)} 元、淘宝闪购 ${formatNum(priceGapItem.flashPrice)} 元，价差 ${formatPct(priceGapItem.priceGap)}。`,
      comparison: "同一菜品、同一货盘中的平台横向价格比较，不把不同套餐当作同一商品。",
      verification: "结合两平台该菜品的曝光、点击、下单和补贴后实收核对；先确认规格、配送费和平台活动一致，再决定是否做单平台价格测试。"
    });
  }

  const weakCampaign = input.campaigns.find((item) => item.evidence === "detail" && item.roi !== undefined && item.roi < 1.5);
  if (weakCampaign?.roi !== undefined) {
    anomalies.push({
      id: "weak-campaign-roi",
      dimension: "campaign",
      severity: weakCampaign.roi < 1 ? "high" : "medium",
      confidence: "medium",
      title: "有投放计划的成交回收偏低",
      evidence: `${weakCampaign.platform}“${weakCampaign.name}”成交ROI为 ${weakCampaign.roi.toFixed(2)}。`,
      comparison: "仅使用计划级消耗和成交额计算，尚未扣除履约和商品成本。",
      verification: "先保持预算不变，核对7天计划级曝光、点击、进店、下单和退款；若成交与贡献额均无改善，再停投复核。"
    });
  }

  if (input.averagePrepMinutes !== undefined && input.averagePrepMinutes > 16) {
    anomalies.push({
      id: "slow-prep",
      dimension: "fulfillment",
      severity: input.averagePrepMinutes > 22 ? "high" : "medium",
      confidence: "high",
      title: "平均出餐时间超过目标",
      evidence: `平均出餐 ${formatNum(input.averagePrepMinutes)} 分钟，高于16分钟目标。`,
      comparison: "按有效订单的出餐时间计算。",
      verification: "按小时和菜品拆分出餐时间，锁定最慢时段或菜品；连续7天观察超时订单、退款和差评是否同步变化。"
    });
  }

  const order = { high: 0, medium: 1, notice: 2 } as const;
  return anomalies.sort((a, b) => {
    const compoundDelta = Number(b.id.startsWith("compound-")) - Number(a.id.startsWith("compound-"));
    return compoundDelta || order[a.severity] - order[b.severity];
  }).slice(0, 8);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function findHeader(rows: Cell[][]): { index: number; values: string[] } | undefined {
  const candidates = rows.slice(0, 20).map((row, index) => ({ index, values: row.map(text) }));
  return candidates
    .map((candidate) => ({ ...candidate, score: Object.keys(mapHeaders(candidate.values)).length }))
    .filter((candidate) => candidate.score >= 3)
    .sort((a, b) => b.score - a.score)[0];
}

function mapHeaders(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;
    for (const [canonical, aliases] of Object.entries(reliableChineseFieldAliases)) {
      if (!result[canonical] && aliases.some((pattern) => pattern.test(normalized))) {
        result[canonical] = header;
        break;
      }
    }
    for (const [canonical, aliases] of Object.entries(fieldAliases)) {
      if (!result[canonical] && aliases.some((pattern) => pattern.test(normalized))) {
        result[canonical] = header;
        break;
      }
    }
  }
  return result;
}

function inferSourceKind(mapping: Record<string, string>): TakeawaySourceKind | undefined {
  const fields = new Set(Object.keys(mapping));
  if (fields.has("orderId") || (fields.has("orderStatus") && fields.has("paidAmount"))) return "orders";
  if (fields.has("campaignName")) return "campaigns";
  if (fields.has("exposure") && fields.has("visits") && fields.has("orderCount")) return "funnel";
  if (fields.has("spend") && (fields.has("clicks") || fields.has("exposure"))) return "campaigns";
  if (fields.has("productName") && ["costAmount", "meituanPrice", "flashPrice", "discountedPrice", "campaignPrice", "benchmarkPrice"].some((field) => fields.has(field))) return "catalog";
  if (fields.has("productName") && (fields.has("salesQuantity") || fields.has("quantity") || fields.has("paidAmount"))) return "products";
  return undefined;
}

function normalizeRow(params: {
  row: Cell[];
  rowNumber: number;
  sheetName: string;
  kind: TakeawaySourceKind;
  headers: string[];
  mapping: Record<string, string>;
  tenantId: string;
  platformHint?: string;
  storeNameHint?: string;
}): TakeawayNormalizedRow | undefined {
  const values = Object.fromEntries(Object.entries(params.mapping).map(([canonical, original]) => {
    const index = params.headers.indexOf(original);
    return [canonical, index >= 0 ? params.row[index] : undefined];
  }));
  return normalizeMappedValues({ ...params, values });
}

function normalizeMappedValues(params: {
  row: Cell[];
  rowNumber: number;
  sheetName: string;
  kind: TakeawaySourceKind;
  headers: string[];
  mapping: Record<string, string>;
  tenantId: string;
  platformHint?: string;
  storeNameHint?: string;
  values: Record<string, Cell>;
}): TakeawayNormalizedRow | undefined {
  const values = params.values;
  if (Object.values(values).every((value) => text(value) === "")) return undefined;
  // Menu-maintenance sheets often alternate a sellable SKU row with one or
  // more option-description rows. Keep only actual SKU rows in the catalog so
  // option text never becomes a product in the operating dashboard.
  if (params.kind === "catalog" && (
    !text(values.productName) ||
    [values.costAmount, values.meituanPrice, values.flashPrice, values.discountedPrice, values.campaignPrice, values.benchmarkPrice]
      .every((value) => number(value) === undefined)
  )) return undefined;
  const rawOrderId = text(values.orderId);
  return {
    kind: params.kind,
    sheetName: params.sheetName,
    rowNumber: params.rowNumber,
    date: normalizeDate(values.date),
    city: text(values.city) || undefined,
    platform: normalizePlatform(text(values.platform) || params.platformHint),
    storeName: text(values.storeName) || params.storeNameHint,
    orderKey: rawOrderId ? createHash("sha256").update(`${params.tenantId}|${rawOrderId}`).digest("hex") : undefined,
    orderStatus: text(values.orderStatus) || undefined,
    productName: text(values.productName) || undefined,
    productItems: parseTakeawayProductItems(text(values.productItems)),
    productCategory: text(values.productCategory) || undefined,
    quantity: number(values.quantity),
    originalAmount: number(values.originalAmount),
    paidAmount: number(values.paidAmount),
    merchantSubsidy: number(values.merchantSubsidy),
    platformSubsidy: number(values.platformSubsidy),
    refundAmount: number(values.refundAmount),
    isNewCustomer: booleanValue(values.newCustomer),
    prepMinutes: number(values.prepMinutes),
    costAmount: number(values.costAmount),
    meituanPrice: number(values.meituanPrice),
    flashPrice: number(values.flashPrice),
    discountedPrice: number(values.discountedPrice),
    campaignPrice: number(values.campaignPrice),
    discountRate: number(values.discountRate),
    benchmarkPrice: number(values.benchmarkPrice),
    portion: text(values.portion) || undefined,
    listingNote: text(values.listingNote) || undefined,
    updateNote: text(values.updateNote) || undefined,
    exposure: number(values.exposure),
    visits: number(values.visits),
    orderCount: number(values.orderCount),
    effectiveOrders: number(values.effectiveOrders),
    campaignName: text(values.campaignName) || undefined,
    budget: number(values.budget),
    spend: number(values.spend),
    clicks: number(values.clicks),
    gmv: number(values.gmv),
    salesQuantity: number(values.salesQuantity)
  };
}

function validateRows(rows: TakeawayNormalizedRow[], warnings: string[]): void {
  if (rows.some((row) => row.kind !== "catalog") && !rows.some((row) => row.date)) warnings.push("未识别到日期，无法生成趋势和周期复盘。 ");
  if (rows.some((row) => row.exposure !== undefined && row.visits !== undefined && row.visits > row.exposure)) warnings.push("存在进店量大于曝光量的记录，请核对平台指标口径。 ");
  if (rows.some((row) => row.visits !== undefined && row.orderCount !== undefined && row.orderCount > row.visits)) warnings.push("存在订单量大于进店量的记录，请核对平台指标口径。 ");
  if (rows.some((row) => row.orderCount !== undefined && row.effectiveOrders !== undefined && row.effectiveOrders > row.orderCount)) warnings.push("存在有效完成单大于下单量的记录，漏斗口径倒挂；请核对统计周期和指标定义。 ");
  if (rows.some((row) => [row.paidAmount, row.refundAmount, row.spend, row.gmv].some((value) => value !== undefined && value < 0))) warnings.push("存在负数金额，请确认是否为冲销记录。 ");
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))];
  if (dates.length > 0 && dates.length < 7) warnings.push("数据不足 7 个自然日，只适合做初步核对，不宜直接下增长结论。 ");
  const catalogRows = rows.filter((row) => row.kind === "catalog");
  if (catalogRows.length > 0 && catalogRows.some((row) => row.costAmount === undefined)) warnings.push("部分菜品缺少成本，相关毛利暂不计算。 ");
  if (catalogRows.length > 0 && catalogRows.some((row) => [row.meituanPrice, row.flashPrice, row.discountedPrice, row.campaignPrice, row.benchmarkPrice].every((value) => value === undefined))) warnings.push("部分菜品未识别到可用售价，请核对价格列或“不售卖”状态。 ");
}

function databaseRecord(record: any): StoredTakeawayImport {
  return {
    id: record.id,
    tenantId: record.tenantId,
    userId: record.userId ?? undefined,
    filename: record.filename,
    sha256: record.sha256,
    sourceKind: record.sourceKind,
    platform: record.platform ?? undefined,
    storeName: record.storeName ?? undefined,
    dateFrom: record.dateFrom ? new Date(record.dateFrom).toISOString().slice(0, 10) : undefined,
    dateTo: record.dateTo ? new Date(record.dateTo).toISOString().slice(0, 10) : undefined,
    rowCount: record.rowCount,
    duplicateCount: record.duplicateCount,
    qualityScore: record.qualityScore,
    fieldMappings: (record.fieldMappings ?? {}) as Record<string, string>,
    missingFields: Array.isArray(record.missingFields) ? record.missingFields as string[] : [],
    warnings: Array.isArray(record.warnings) ? record.warnings as string[] : [],
    normalizedRows: Array.isArray(record.normalizedRows) ? record.normalizedRows as TakeawayNormalizedRow[] : [],
    detectedSheets: [],
    createdAt: new Date(record.createdAt).toISOString()
  };
}

function isEffectiveOrder(row: TakeawayNormalizedRow): boolean {
  if ((row.refundAmount ?? 0) > 0) return false;
  if (/取消|退款|退单|关闭|无效/.test(row.orderStatus ?? "")) return false;
  return true;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-—:：()（）【】\[\]]+/g, "").trim();
}

function normalizePlatform(value?: string): string | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  if (/美团/.test(source)) return "美团";
  if (/淘宝|闪购|饿了么/.test(source)) return "淘宝闪购";
  return source;
}

function inferPlatformFromText(value: string): string | undefined {
  return normalizePlatform(value);
}

export function parseTakeawayProductItems(value: string): Array<{ name: string; quantity: number; unitPrice?: number }> | undefined {
  const source = value.trim();
  if (!source) return undefined;
  const meituanItems = [...source.matchAll(/(?:^|\/)(.*?),单价\s*(-?[\d.]+)\s*\*\s*数量\s*([\d.]+)/g)]
    .map((match) => ({ name: normalizeProductName(match[1]!), quantity: Number(match[3]), unitPrice: Number(match[2]) }))
    .filter((item) => item.name && Number.isFinite(item.quantity) && item.quantity > 0 && Number.isFinite(item.unitPrice));
  if (meituanItems.length) return meituanItems;

  const flashItems = splitProductItems(source, "+").map((part) => {
    const match = part.trim().match(/^(.*)_([\d.]+)\*(-?[\d.]+)$/);
    if (!match) return undefined;
    const name = normalizeProductName(match[1]!.replace(/[\[【][\s\S]*$/, ""));
    const quantity = Number(match[2]);
    const unitPrice = Number(match[3]);
    return name && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice)
      ? { name, quantity, unitPrice }
      : undefined;
  }).filter((item): item is { name: string; quantity: number; unitPrice: number } => Boolean(item));
  return flashItems.length ? flashItems : undefined;
}

function splitProductItems(value: string, separator: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if (character === "[" || character === "【") depth += 1;
    if (character === "]" || character === "】") depth = Math.max(0, depth - 1);
    if (character === separator && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function normalizeProductName(value: string): string {
  return value.trim()
    .replace(/[（(]\s*\d+\s*人份\s*[）)]$/, "")
    .replace(/(\d+年销量)W[.。·]?/gi, "$1王·")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: Cell): string {
  return String(value ?? "").trim();
}

function number(value: Cell): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[,，￥¥元人次单份分钟%]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: Cell): boolean | undefined {
  const source = text(value).toLowerCase();
  if (!source) return undefined;
  if (/^(是|新|新客|true|1|yes)$/.test(source)) return true;
  if (/^(否|老|老客|false|0|no)$/.test(source)) return false;
  return undefined;
}

function normalizeDate(value: Cell): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const compactDate = String(value);
    if (/^\d{8}$/.test(compactDate)) return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    const parsed = XLSX.SSF?.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const source = text(value);
  if (!source) return undefined;
  const compactMatch = source.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  const normalized = source.replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function optionalSum(values: Array<number | undefined>): number | undefined {
  return values.some((value) => value !== undefined) ? sum(values) : undefined;
}

function ratio(numerator?: number, denominator?: number): number | undefined {
  return numerator !== undefined && denominator !== undefined && denominator !== 0 ? numerator / denominator : undefined;
}
