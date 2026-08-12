import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface EvalCase {
  id: string;
  agentSlug: "acquisition" | "sales";
  plan: "chain_premium" | "local_premium";
  industry: string;
  city: string;
  capabilityIds: string[];
  input: string;
  mustInclude: string[];
  minimumLength: number;
}

interface AgentRunResponse {
  status?: string;
  deliveryStatus?: "completed" | "needs_input" | "failed";
  answerText?: string;
  qualityFlags?: string[];
  execution?: {
    mode?: string;
    steps?: Array<{
      capabilityId?: string;
      skillId?: string;
      status?: string;
      durationMs?: number;
      error?: { code?: string; retryable?: boolean };
    }>;
  };
  error?: string;
  message?: string;
}

const cases: EvalCase[] = [
  {
    id: "zhenshui-new-store-growth",
    agentSlug: "acquisition",
    plan: "chain_premium",
    industry: "中式快餐外卖连锁",
    city: "杭州",
    capabilityIds: ["industry_hotspots", "content_plan", "live_script"],
    minimumLength: 2_000,
    mustInclude: ["枕水江南", "7家", "外卖", "7天", "直播", "口播", "复盘"],
    input: [
      "行业：中式快餐外卖连锁。",
      "客户：枕水江南，共7家外卖店；目前新开门店外卖销售额不理想，希望提升真实下单。",
      "请同时完成以下三项，并整合为一套可直接执行的增长方案：",
      "1. 结合近期中式快餐和外卖行业热点，提出3个与新店增长相关的内容主题；",
      "2. 制定未来7天短视频获客计划，至少交付3条可直接拍摄的完整口播稿、镜头安排、标题、评论区承接；",
      "3. 输出一场45分钟直播的开场留人、产品讲解、互动、下单转化与收尾话术。",
      "请明确每天动作、负责人角色、核心指标和复盘方式。只能使用上述已知事实，不得虚构历史业绩、客户评价或提升比例；缺失的菜品、客单价、优惠信息用【待补】标注。"
    ].join("\n")
  },
  {
    id: "sanhe-franchise-growth",
    agentSlug: "acquisition",
    plan: "chain_premium",
    industry: "餐饮糖水连锁",
    city: "杭州",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    minimumLength: 2_000,
    mustInclude: ["三禾糖水铺", "30家", "加盟", "直播", "私域", "线索", "待补"],
    input: [
      "客户：三禾糖水铺，餐饮连锁，目前约30家门店，当前核心问题是招商加盟扩张慢。",
      "请同时完成招商获客、招商直播和私域承接三项交付，形成一套从公域曝光到加盟商留资、筛选、邀约考察的完整方案。",
      "具体要求：给出招商卖点结构、目标加盟商画像、7天获客内容主题；输出一场60分钟招商直播的开场、信任建立、项目介绍、异议处理、留资话术；再给出朋友圈7天内容与私聊跟进SOP。",
      "门店盈利、加盟费、投资回收期、供应链政策、成功案例数据目前均未提供，必须用【待补】标注，不能编造。请补充线索分级、负责人角色、每日动作、转化指标和复盘表。"
    ].join("\n")
  },
  {
    id: "chuyan-consumer-store-growth",
    agentSlug: "acquisition",
    plan: "chain_premium",
    industry: "美业皮肤管理",
    city: "杭州",
    capabilityIds: ["topic_inspiration", "content_plan", "private_domain"],
    minimumLength: 1_500,
    mustInclude: ["初颜秘集", "3家", "消费者", "预约", "到店", "复购", "7天", "待补"],
    input: [
      "客户：初颜秘集，美业皮肤管理连锁，共3家店。当前要提升本地消费者的有效咨询、预约、实际到店和复购。",
      "请同时完成：1. 给出10个面向附近消费者的到店获客选题；2. 制定未来7天短视频内容计划，至少包含3条可直接拍摄的口播稿；3. 设计朋友圈与私聊承接，覆盖咨询、预约、到店提醒、到店后回访和复购。",
      "真实城市、商圈、项目、价格、案例、账号数据、预约率、到店率和复购数据暂未提供，必须标记【待补】，不得编造效果。",
      "不得转成培训招生、招店长合伙人或合伙人培养。请给出每天动作、负责人、核心指标和30天复盘框架。"
    ].join("\n")
  }
];

const baseUrl = process.env.SITONG_API_URL?.trim() || "http://127.0.0.1:3011";
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve("reports", "complex-agent-live-evals", runStamp);
const internalLeakTerms = ["多技能联合任务", "用户这次补充", "Skill 的完整标准", "内部提示词"];

async function main(): Promise<void> {
await mkdir(outputDir, { recursive: true });
const results: Array<Record<string, unknown>> = [];

for (const item of cases) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/agents/${item.agentSlug}/runs`, {
    method: "POST",
    signal: AbortSignal.timeout(15 * 60_000),
    headers: {
      "content-type": "application/json",
      "x-sitong-tenant-id": `live-eval-${item.id}`,
      "x-sitong-user-id": "live-eval-owner",
      "x-sitong-plan": item.plan,
      "x-sitong-profile": encodeURIComponent(JSON.stringify({ industry: item.industry, city: item.city }))
    },
    body: JSON.stringify({
      requestId: `live-eval-${item.id}-${Date.now()}`,
      input: item.input,
      capabilityIds: item.capabilityIds,
      capabilitySelectionMode: "explicit",
      deviceScope: "desktop"
    })
  });
  const payload = await response.json() as AgentRunResponse;
  const answer = payload.answerText ?? "";
  const steps = payload.execution?.steps ?? [];
  const actualCapabilities = steps.map((step) => step.capabilityId).filter(Boolean);
  const checks = {
    httpSuccess: response.ok,
    agentSuccess: payload.status === "success",
    deliveryCompleted: payload.deliveryStatus === "completed",
    answerLength: answer.length >= item.minimumLength,
    expectedCapabilities: item.capabilityIds.every((id) => actualCapabilities.includes(id)),
    everyStepSucceeded: steps.length === item.capabilityIds.length && steps.every((step) => step.status === "success"),
    requiredTerms: item.mustInclude.every((term) => answer.includes(term)),
    noInternalPromptLeak: internalLeakTerms.every((term) => !answer.includes(term)),
    noPartialFailure: !(payload.qualityFlags ?? []).includes("partial_skill_delivery")
  };
  const result = {
    id: item.id,
    passed: Object.values(checks).every(Boolean),
    durationMs: Date.now() - startedAt,
    httpStatus: response.status,
    answerLength: answer.length,
    executionMode: payload.execution?.mode,
    steps,
    qualityFlags: payload.qualityFlags ?? [],
    checks,
    missingTerms: item.mustInclude.filter((term) => !answer.includes(term)),
    internalLeaks: internalLeakTerms.filter((term) => answer.includes(term)),
    error: payload.error,
    message: payload.message
  };
  results.push(result);
  await writeFile(
    path.join(outputDir, `${item.id}.md`),
    [
      `# ${item.id}`,
      "",
      "## Automated checks",
      "```json",
      JSON.stringify(result, null, 2),
      "```",
      "",
      "## Input",
      item.input,
      "",
      "## Raw answer",
      answer || JSON.stringify(payload, null, 2)
    ].join("\n"),
    "utf8"
  );
  console.log(JSON.stringify(result));
}

const summary = {
  ok: results.every((item) => item.passed === true),
  outputDir,
  caseCount: results.length,
  passed: results.filter((item) => item.passed === true).length,
  failed: results.filter((item) => item.passed !== true).length,
  results
};
await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
