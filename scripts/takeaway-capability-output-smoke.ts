import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.SKILL_MCP_ENABLED = "false";
process.env.SKILL_MCP_REQUIRED = "false";

type Scenario = {
  capabilityId: string;
  required: string[];
  forbidden?: string[];
};

const scenarios: Scenario[] = [
  { capabilityId: "takeaway_data_foundation", required: ["数据是否可用", "已经读到什么", "当前可判断范围", "还缺什么数据", "下一步"], forbidden: ["AI发现的异常", "本轮唯一变量", "进入“数据门槛”任务"] },
  { capabilityId: "takeaway_data_audit", required: ["审计结论", "已通过检查", "发现的问题", "可开展的分析", "下一步"], forbidden: ["老店基线", "菜单数据结论"] },
  { capabilityId: "mature_store_growth", required: ["老店基线", "异常发生在哪里", "当前最值得检查", "完成标准", "下一步"], forbidden: ["新店基线", "钱花在哪里"] },
  { capabilityId: "new_store_breakthrough", required: ["新店基线", "目标差距", "首要断点", "7天、14天、30天阶段目标", "现在请执行"], forbidden: ["老店基线", "AI发现的异常"] },
  { capabilityId: "takeaway_growth", required: ["已确认事实", "跨维度关联", "详细问题清单", "完整原因地图", "优先验证候选", "推荐进入哪个任务"], forbidden: ["已导入数据", "本轮唯一变量", "7天执行", "14天执行"] },
  { capabilityId: "takeaway_menu_profit", required: ["菜单数据结论", "菜品与套餐问题", "利润风险", "现在只做这一件事", "待补数据"], forbidden: ["钱花在哪里", "平台提供了什么线索"] },
  { capabilityId: "takeaway_campaign_roi", required: ["证据等级", "钱花在哪里", "目前能否判断回报", "现在只做这一件事", "待补数据"], forbidden: ["菜单数据结论", "可能流失到哪里"] },
  { capabilityId: "takeaway_competitor_loss", required: ["平台提供了什么线索", "可能流失到哪里", "哪些不能当成事实", "现在只做这一件事", "待补数据"], forbidden: ["钱花在哪里", "本轮是否有效"] },
  { capabilityId: "takeaway_problem_validation", required: ["待验证问题", "支持证据与反证", "验证设计", "成立标准", "验证后去向"], forbidden: ["增长方案已执行", "本轮是否有效"] },
  { capabilityId: "takeaway_experiment", required: ["已验证问题", "增长动作", "执行目标", "逐日执行清单", "每天回填", "停止条件", "第1天", "第7天"], forbidden: ["AI发现的异常", "本轮是否有效"] },
  { capabilityId: "takeaway_execution", required: ["待执行方案", "今日执行", "每日回填", "异常与停止", "提交反馈"], forbidden: ["已确认增长", "本轮是否有效"] },
  { capabilityId: "takeaway_effect_evaluation", required: ["数据是否可比", "增长结果", "风险与副作用", "效果判断", "进入周期复盘"], forbidden: ["逐日执行清单", "已沉淀标准方法"] },
  { capabilityId: "takeaway_review", required: ["本轮是否有效", "判断依据", "本轮决定", "下一步"], forbidden: ["逐日执行清单", "新店基线"] }
];

async function main() {
  const { runAgent } = await import("../packages/agent/src/index.js");
  const signatures = new Map<string, string>();
  const provider = {
    name: "takeaway-capability-output-smoke",
    async complete() { throw new Error("forced_provider_failure_for_task_contract_test"); }
  };

  for (const scenario of scenarios) {
    const input = [
      `【枕水江南外卖增长工作台｜固定模块：${scenario.capabilityId}】`,
      "品牌：枕水江南；城市：沈阳；门店阶段：老店增长；平台：美团、淘宝闪购。",
      "本次使用数据：17份文件，12775行，更新至2026-07-31。",
      "有效完成单12140；实付成交额418274.6元；客单价34.5元；平均出餐4.1分钟。",
      "系统异常扫描：",
      "1. 07-14出现订单低谷；证据：当天59单，低于有订单日期中位数134单56.0%；对比：其余91个有订单日；验证：核对当天平台、时段、缺货、配送范围和营业状态；可信度：高。",
      "2. 部分菜品成本率偏高；证据：成本率67.6%，高于55%检查线；对比：其余已识别成本菜品；验证：核对采购成本、份量和售价；可信度：中。",
      "3. 美团存在流量到下单双断点；证据：进店率和下单转化同时落后淘宝闪购；对比：同一门店、同一周期的双平台漏斗对比；验证：保持价格不变，连续7天记录曝光到下单；可信度：高。",
      "数据质量：61/100。",
      "活动数据只有商家活动成本汇总，不是广告计划消耗，不能计算计划级ROI。",
      "退款金额、菜品实际成本、计划级消耗仍待补。",
      ...(scenario.capabilityId === "takeaway_review" ? [
        "本轮人工补充：",
        "【14天回填汇总】",
        "完成情况：14/14天已保存。",
        "数据性质：含模拟测试回填，只用于验证流程，不代表真实经营结果。",
        "负责人：模拟测试-运营A。",
        "已记录指标样例：曝光3200，进店210，有效订单35；曝光3280，进店226，下单44，有效完成42。",
        "执行记录摘要：主图与首屏排序已调整；价格、活动、投放保持不变。",
        "【复盘边界】",
        "尚未提供同星期基线期与测试期的汇总对比；未核对退款、活动消耗和订单口径前，不得判断增长或决定扩大投入。"
      ] : [])
    ].join("\n");
    const result = await runAgent({
      tenantId: "tenant-takeaway-output-smoke",
      userId: "user-owner",
      role: "owner",
      planCode: "chain_standard",
      input,
      routingInput: input,
      requestedSkillId: "takeaway-growth-advisor",
      capabilityId: scenario.capabilityId,
      capabilityLocked: true,
      deliveryPolicy: "draft_with_placeholders",
      tenantProfile: { tenantId: "tenant-takeaway-output-smoke", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
      channel: "h5"
    }, provider);

    for (const text of scenario.required) assert.ok(result.answer.includes(text), `${scenario.capabilityId} 缺少专属内容：${text}`);
    for (const text of scenario.forbidden ?? []) assert.ok(!result.answer.includes(text), `${scenario.capabilityId} 串入其他任务内容：${text}`);
    if (scenario.capabilityId === "takeaway_growth") {
      for (const dimension of ["流量与曝光", "进店转化", "商品点击与货盘", "价格与优惠", "活动与投放", "支付与下单", "履约与出餐", "退款、评价与售后", "时段与供应", "复购与客群", "竞品与品类替代", "数据口径与质量"]) {
        assert.ok(result.answer.includes(dimension), `完整原因地图缺少维度：${dimension}`);
      }
      assert.ok(result.answer.includes("最多突出3个") && result.answer.includes("不是只扫描3个原因"), "优先3项与完整扫描的关系未说清");
      assert.ok(result.answer.includes("每轮只选一个") && (result.answer.includes("本轮只验证") || result.answer.includes("暂无可验证候选")), "诊断后必须每轮只验证一个原因；没有候选时应停止");
      assert.ok(result.answer.includes("订单增长") && result.answer.includes("利润"), "诊断必须分开说明订单增长与利润影响");
      assert.ok(!result.answer.includes("基本排除"), "只有字段覆盖不能写成基本排除");
      assert.ok(result.answer.includes("单点线索") && result.answer.includes("跨维度组合信号"), "AI诊断必须区分单点线索与跨维度组合信号");
    }
    if (scenario.capabilityId === "takeaway_problem_validation") {
      assert.ok(result.answer.includes("去哪里看") && result.answer.includes("必须记录") && result.answer.includes("怎么比较"), "问题验证必须给出可执行的现场核查路径，而不是只复述候选标题");
      assert.ok(result.answer.includes("同星期") && !result.answer.includes("核算真实贡献，不用订单高低代替验证"), "订单低谷验证不得套用成本核算模板");
      assert.ok(result.answer.includes("完成现场核查后，再由负责人填写验证结论"), "验证结论必须在完成核查后填写");
    }
    assert.ok(!/\*\*[^*]+\*\*/.test(result.answer), `${scenario.capabilityId} 仍输出裸星号格式`);
    if (scenario.capabilityId === "takeaway_review") {
      assert.ok(result.answer.includes("流程演练"), "模拟回填必须明确不能当作经营结果");
      assert.ok(result.answer.includes("14/14天回填已保存"), "复盘必须展示回填完成度");
      assert.ok(!result.answer.includes("补齐每日回填"), "全部回填后不得仍提示补齐每日回填");
      assert.ok(!result.answer.includes("负责人：模拟测试-运营A"), "复盘不得把原始逐日回填直接堆进判断依据");
    }

    const signature = Array.from(result.answer.matchAll(/^##\s+\d+\.\s+(.+)$/gm), (match) => match[1]?.trim()).filter(Boolean).join("|");
    assert.ok(signature, `${scenario.capabilityId} 未生成可识别章节`);
    assert.ok(!signatures.has(signature), `${scenario.capabilityId} 与 ${signatures.get(signature)} 使用了相同输出模板`);
    signatures.set(signature, scenario.capabilityId);
  }

  assert.equal(signatures.size, scenarios.length, "13个任务没有形成13套独立输出结构");
  console.log("外卖任务输出烟测通过：13个任务均使用独立输出契约，未发生模板串台。");
  const costValidationInput = [
    "【外卖增长工作台｜固定模块：takeaway_problem_validation】",
    "【经营阶段：稳定经营】",
    "系统异常扫描：",
    "1. 部分菜品成本率偏高；证据：某套餐食材成本显著高于同品类；对比：其余已识别成本菜品；验证：核对采购成本、份量和售价；可信度：高。"
  ].join("\n");
  const costValidationResult = await runAgent({
    tenantId: "tenant-takeaway-output-smoke",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "takeaway_problem_validation",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-takeaway-output-smoke", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
    channel: "h5",
    input: costValidationInput,
    routingInput: costValidationInput
  }, provider);
  assert.ok(costValidationResult.answer.includes("采购/中央厨房") && costValidationResult.answer.includes("实际贡献"), "成本验证必须核算真实贡献，不能复用订单低谷的漏斗模板");
  assert.ok(!costValidationResult.answer.includes("前4个同星期"), "成本验证不得复用订单低谷的同星期漏斗核查步骤");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
