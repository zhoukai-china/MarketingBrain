import * as XLSX from "../apps/api/node_modules/xlsx/xlsx.mjs";

process.env.DATA_MODE = "demo";
process.env.SKILL_MCP_ENABLED = "false";

async function main() {
  const { parseTakeawayWorkbook, saveTakeawayImport, buildTakeawayDashboard } = await import("../apps/api/src/services/takeaway-growth-data.js");
  const { runAgent } = await import("../packages/agent/src/index.js");
  const tenantId = "simulated-takeaway-e2e-20260811";
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string | number>> = [["日期", "平台", "门店名称", "曝光量", "进店量", "下单量", "有效完成单", "顾客实付金额"]];
  for (let day = 1; day <= 14; day += 1) {
    const isTestWeek = day > 7;
    rows.push([`2026-08-${String(day).padStart(2, "0")}`, "模拟平台", "模拟老店", 5000, isTestWeek ? 360 : 300, isTestWeek ? 58 : 42, isTestWeek ? 55 : 40, isTestWeek ? 1980 : 1440]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "模拟经营漏斗");
  const parsed = parseTakeawayWorkbook({
    filename: "模拟老店14天经营数据.xlsx",
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    tenantId
  });
  await saveTakeawayImport({ tenantId, userId: "simulated-owner", parsed });
  const dashboard = await buildTakeawayDashboard({ tenantId });
  if (dashboard.dataStatus.rowCount !== 14 || dashboard.dataStatus.importCount !== 1 || dashboard.funnel.length !== 1) {
    throw new Error("模拟数据未形成可用的单文件漏斗看板");
  }

  let providerCalls = 0;
  const provider = { name: "simulated-no-provider", async complete() { providerCalls += 1; throw new Error("workbench_must_not_wait_for_provider"); } };
  const base = {
    tenantId, userId: "simulated-owner", role: "owner" as const, planCode: "chain_standard", requestedSkillId: "takeaway-growth-advisor" as const,
    capabilityLocked: true, deliveryPolicy: "draft_with_placeholders" as const,
    tenantProfile: { tenantId, tenantName: "模拟餐饮", tenantType: "chain_brand", industry: "餐饮外卖", city: "模拟城市" }, channel: "h5" as const
  };
  const facts = "1份文件，14行，更新至2026-08-14；有效完成单665；实付成交额23940元；客单价36元。系统异常扫描：1. 近7天下单量提升；证据：测试期日均58单，高于基线期42单38.1%；对比：两个完整7天窗口；验证：核对唯一变量以外的活动、缺货、营业和配送变化；可信度：高。";
  const diagnosis = await runAgent({
    ...base, capabilityId: "mature_store_growth", routingInput: "工作台第3步｜老店增长 · 不知道问题在哪",
    input: ["【枕水江南外卖增长工作台｜固定模块：mature_store_growth】", "品牌：模拟餐饮；本轮主路径已确认：老店增长。", "以下经营事实来自系统已导入数据：", facts, "本轮人工补充：只验证套餐展示顺序，其他价格、活动和投放不变。", "请严格按以下标题和顺序输出，不得合并、改名或增加其他栏目：", "1. 老店基线", "2. 异常发生在哪里", "3. 当前最值得检查", "4. 完成标准", "5. 下一步"].join("\n")
  }, provider);
  if (providerCalls !== 0 || !diagnosis.answer.includes("老店基线") || !diagnosis.answer.includes("完成标准")) throw new Error("模拟诊断未走受控快速通道");

  const dailyRecords = Array.from({ length: 7 }, (_, index) => `第${index + 1}天：已完成；负责人：模拟运营；指标：曝光5000、进店360、有效完成单55；记录：仅模拟回填，唯一变量为套餐展示顺序，未修改价格、活动或投放。`).join("\n");
  const review = await runAgent({
    ...base, capabilityId: "takeaway_review", routingInput: "工作台第5步｜复盘老店增长本轮实验",
    input: ["【枕水江南外卖增长工作台｜固定模块：takeaway_review】", "品牌：模拟餐饮；本轮主路径已确认：老店增长。", "以下经营事实来自系统已导入数据：", facts, `本轮人工补充：${dailyRecords}`, "请严格按以下标题和顺序输出，不得合并、改名或增加其他栏目：", "1. 这次有效吗", "2. 为什么这么判断", "3. 接下来只做什么"].join("\n")
  }, provider);
  if (providerCalls !== 0 || !review.answer.includes("本轮是否有效") || /已经执行|已在平台完成/.test(`${diagnosis.answer}\n${review.answer}`)) {
    throw new Error("模拟复盘未保留证据边界或错误声称执行外部动作");
  }
  console.log("模拟外卖全流程烟测通过：导入、看板、老店诊断、7天模拟回填与复盘均完成，未调用模型或外部平台。");
}

void main().catch((error) => { console.error(error); process.exit(1); });
