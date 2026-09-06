import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { LlmMessage } from "@baolu/agent";
import type { DomesticProviderUsageObservation } from "../apps/api/src/services/domestic-chat-provider.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({
  path: path.join(REPO_ROOT, "apps", "api", ".env"),
  override: false,
  quiet: true,
});

const MODEL = "qwen3.8-flash";
const MAX_CALLS = 3;
const MAX_OUTPUT_TOKENS = 2_048;
const APPROVED_MAX_COST_YUAN = 0.05;
const INPUT_COST_PER_MILLION = 0.8;
const OUTPUT_COST_PER_MILLION = 2.7;
const ALLOWED_HOSTS = new Set([
  "dashscope.aliyuncs.com",
  "ws-gws91avluml5mkau.cn-beijing.maas.aliyuncs.com",
]);

const messages: LlmMessage[] = [
  {
    role: "system",
    content: [
      "你是兰琪美业经营智能体的低风险文本整理器。",
      "你只做意图分类、事实提取、标签去重、合规标记和格式转换；不得补充输入中不存在的门店、价格、疗效或客户事实。",
      "只输出一个合法 JSON 对象，不要 Markdown、解释或额外字段。",
    ].join(""),
  },
  {
    role: "user",
    content: JSON.stringify({
      task: "把以下6条脱敏合成输入整理为固定结构",
      outputSchema: {
        items: [{
          id: "string",
          intent: "customer_question | price_question | fact_extract | tag_normalize | compliance_review | numbered_format",
          tags: ["string"],
          normalized: "string",
          needsReview: "boolean",
        }],
      },
      rules: [
        "items必须恰好6项，id和intent必须与输入逐项一致",
        "除risk-1外needsReview都为false；risk-1为true",
        "price-1没有价格，必须写待确认或待补，禁止编造数字",
        "fact-1只保留烟台、基础皮肤管理、25-45岁女性，并注明价格待补",
        "tag-1标签去重后仅保留夏季补水和皮肤管理",
        "risk-1明确三天祛痘和保证有效需要合规复核，不得把承诺改写成事实",
        "format-1整理为1到3的编号清单",
      ],
      inputs: [
        { id: "intent-1", intent: "customer_question", text: "我想了解补水护理，先问哪些问题？" },
        { id: "price-1", intent: "price_question", text: "顾客问价格，本次没有提供价格。" },
        { id: "fact-1", intent: "fact_extract", text: "城市烟台；项目基础皮肤管理；目标顾客25-45岁女性；价格未提供。" },
        { id: "tag-1", intent: "tag_normalize", text: "夏季补水、皮肤管理、夏季补水" },
        { id: "risk-1", intent: "compliance_review", text: "宣传语：三天祛痘，保证有效。" },
        { id: "format-1", intent: "numbered_format", text: "项目流程；适用边界；到店准备" },
      ],
    }),
  },
];

type EvalItem = {
  id: string;
  intent: string;
  tags: string[];
  normalized: string;
  needsReview: boolean;
};

type EvalOutput = { items: EvalItem[] };

const expectedIntents = new Map<string, string>([
  ["intent-1", "customer_question"],
  ["price-1", "price_question"],
  ["fact-1", "fact_extract"],
  ["tag-1", "tag_normalize"],
  ["risk-1", "compliance_review"],
  ["format-1", "numbered_format"],
]);

function assertEvalOutput(raw: string): EvalOutput {
  assert(!raw.includes("```"), "输出不得包含 Markdown code fence");
  const value = JSON.parse(raw) as Partial<EvalOutput>;
  assert(Array.isArray(value.items), "items 必须为数组");
  assert.equal(value.items.length, expectedIntents.size, "items 必须恰好6项");

  const seen = new Set<string>();
  for (const item of value.items) {
    assert(item && typeof item === "object", "每个 item 必须为对象");
    assert.equal(expectedIntents.get(item.id), item.intent, `${item.id} intent 不匹配`);
    assert(!seen.has(item.id), `${item.id} 重复`);
    seen.add(item.id);
    assert(Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string"), `${item.id} tags 非法`);
    assert(typeof item.normalized === "string" && item.normalized.trim().length > 0, `${item.id} normalized 为空`);
    assert.equal(typeof item.needsReview, "boolean", `${item.id} needsReview 非法`);
    assert.equal(item.needsReview, item.id === "risk-1", `${item.id} needsReview 不符合门禁`);
  }
  assert.deepEqual([...seen].sort(), [...expectedIntents.keys()].sort(), "存在缺失或额外 id");

  const byId = new Map(value.items.map((item) => [item.id, item]));
  assert.match(byId.get("intent-1")!.normalized, /补水护理/);
  assert.match(byId.get("price-1")!.normalized, /待确认|待补|未提供/);
  assert.doesNotMatch(byId.get("price-1")!.normalized, /\d/);
  assert.match(byId.get("fact-1")!.normalized, /烟台/);
  assert.match(byId.get("fact-1")!.normalized, /基础皮肤管理/);
  assert.match(byId.get("fact-1")!.normalized, /25\s*[-—至到]\s*45\s*岁?女性|25-45岁女性/);
  assert.match(byId.get("fact-1")!.normalized, /价格.*(?:待确认|待补|未提供)/);
  assert.deepEqual([...new Set(byId.get("tag-1")!.tags)].sort(), ["夏季补水", "皮肤管理"].sort());
  assert.match(byId.get("risk-1")!.normalized, /三天祛痘/);
  assert.match(byId.get("risk-1")!.normalized, /保证有效/);
  assert.match(byId.get("risk-1")!.normalized, /复核|不得|风险/);
  assert.match(byId.get("format-1")!.normalized, /1[.、]/);
  assert.match(byId.get("format-1")!.normalized, /2[.、]/);
  assert.match(byId.get("format-1")!.normalized, /3[.、]/);

  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /青岛|北京|上海|299|399|499|治愈|百分之百/);
  return value as EvalOutput;
}

function costYuan(usage: DomesticProviderUsageObservation): number {
  return (
    usage.promptTokens * INPUT_COST_PER_MILLION
    + usage.completionTokens * OUTPUT_COST_PER_MILLION
  ) / 1_000_000;
}

function runContractSmoke(): void {
  const validFixture = {
    items: [
      { id: "intent-1", intent: "customer_question", tags: ["补水护理"], normalized: "想了解补水护理应先询问哪些问题", needsReview: false },
      { id: "price-1", intent: "price_question", tags: ["价格"], normalized: "待确认", needsReview: false },
      { id: "fact-1", intent: "fact_extract", tags: ["门店事实"], normalized: "烟台；基础皮肤管理；25-45岁女性；价格待补", needsReview: false },
      { id: "tag-1", intent: "tag_normalize", tags: ["夏季补水", "皮肤管理"], normalized: "夏季补水、皮肤管理", needsReview: false },
      { id: "risk-1", intent: "compliance_review", tags: ["合规复核"], normalized: "三天祛痘、保证有效属于需复核的承诺风险", needsReview: true },
      { id: "format-1", intent: "numbered_format", tags: ["清单"], normalized: "1. 项目流程\n2. 适用边界\n3. 到店准备", needsReview: false },
    ],
  };
  assert.doesNotThrow(
    () => assertEvalOutput(JSON.stringify(validFixture)),
    "合同明确允许 price-1 用待确认表达未知价格，不应强制重复价格二字",
  );
  const inventedPriceFixture = structuredClone(validFixture);
  inventedPriceFixture.items[1]!.normalized = "399元";
  assert.throws(
    () => assertEvalOutput(JSON.stringify(inventedPriceFixture)),
    "未知价格仍必须拒绝模型编造数字",
  );
  console.log("Lanqi Qwen3.8-Flash live Eval contract smoke passed: price shorthand accepted without weakening unknown-price or no-invention gates.");
}

async function main(): Promise<void> {
  if (process.argv.includes("--contract-smoke")) {
    runContractSmoke();
    return;
  }
  assert(process.argv.includes("--execute"), "真实评测必须显式传入 --execute");
  assert.equal(process.env.LANQI_QWEN38_FLASH_LIVE_EVAL_APPROVED, "true", "缺少本次一次性真实评测授权");
  assert.equal(Number(process.env.LANQI_QWEN38_FLASH_LIVE_EVAL_MAX_CALLS), MAX_CALLS, "授权调用上限必须钉死为3");
  assert.equal(Number(process.env.LANQI_QWEN38_FLASH_LIVE_EVAL_MAX_COST_YUAN), APPROVED_MAX_COST_YUAN, "授权费用上限必须钉死为0.05元");

  const apiKey = process.env.ALIYUN_API_KEY;
  const baseUrl = process.env.ALIYUN_BASE_URL;
  assert(apiKey, "apps/api/.env 未配置 ALIYUN_API_KEY");
  assert(baseUrl, "apps/api/.env 未配置 ALIYUN_BASE_URL");
  const endpoint = new URL(baseUrl);
  assert.equal(endpoint.protocol, "https:", "百炼地址必须使用 HTTPS");
  assert(ALLOWED_HOSTS.has(endpoint.hostname), "百炼地址必须固定为已验收的阿里云百炼域名");
  const configuredOutboundHosts = new Set(
    String(process.env.DOMESTIC_OUTBOUND_ALLOWLIST ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  assert(configuredOutboundHosts.has(endpoint.hostname), "百炼地址不在正式国内出口白名单中");

  const promptByteUpperBound = Buffer.byteLength(JSON.stringify(messages), "utf8");
  const worstCaseCostYuan = MAX_CALLS * (
    promptByteUpperBound * INPUT_COST_PER_MILLION
    + MAX_OUTPUT_TOKENS * OUTPUT_COST_PER_MILLION
  ) / 1_000_000;
  assert(worstCaseCostYuan <= APPROVED_MAX_COST_YUAN, "最坏成本超过用户授权上限，禁止调用");

  const usages: DomesticProviderUsageObservation[] = [];
  const { createLanqiTaskLlmProvider } = await import("../apps/api/src/services/llm-provider-factory.js");
  const provider = createLanqiTaskLlmProvider("low_risk_formatting", {
    qwenCandidate: { candidateModel: MODEL, enabled: true, evalApproved: true },
    deepseekApiKey: undefined,
    deepseekBaseUrl: undefined,
    aliyunApiKey: apiKey,
    aliyunBaseUrl: baseUrl,
    timeoutMs: 120_000,
    domesticNetworkOnly: true,
    allowedHosts: [endpoint.hostname],
    onUsage: (usage) => usages.push(usage),
  });
  assert.equal(provider.name, "aliyun");
  assert.equal(provider.getModel(), MODEL);

  const runs: Array<Record<string, unknown>> = [];
  let accumulatedCostYuan = 0;
  for (let index = 0; index < MAX_CALLS; index += 1) {
    const usageCountBefore = usages.length;
    const startedAt = Date.now();
    const raw = await provider.complete(messages, {
      reasoningProfile: "standard",
      thinkingMode: "disabled",
      maxTokens: MAX_OUTPUT_TOKENS,
      responseFormat: "json_object",
    });
    assert.equal(usages.length, usageCountBefore + 1, `第${index + 1}次调用缺少 usage`);
    const usage = usages.at(-1)!;
    assert.equal(usage.finishReason, "stop", `第${index + 1}次 finish_reason 非 stop`);
    assert.equal(usage.reasoningTokens, 0, `第${index + 1}次出现思考 token`);
    const parsed = assertEvalOutput(raw);
    accumulatedCostYuan += costYuan(usage);
    assert(accumulatedCostYuan <= APPROVED_MAX_COST_YUAN, "累计费用超过授权上限，停止评测");
    runs.push({
      run: index + 1,
      passed: true,
      elapsedMs: Date.now() - startedAt,
      finishReason: usage.finishReason,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens,
      outputSha256: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
      estimatedCostYuan: Number(costYuan(usage).toFixed(6)),
    });
  }

  console.log(JSON.stringify({
    result: "PASS",
    provider: provider.name,
    model: provider.getModel(),
    calls: runs.length,
    retries: 0,
    modelSwitches: 0,
    extraCalls: 0,
    worstCaseCostYuan: Number(worstCaseCostYuan.toFixed(6)),
    estimatedActualCostYuan: Number(accumulatedCostYuan.toFixed(6)),
    runs,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    result: "FAIL_CLOSED",
    model: MODEL,
    message: error instanceof Error ? error.message : String(error),
    retries: 0,
    modelSwitches: 0,
    extraCalls: 0,
  }, null, 2));
  process.exitCode = 1;
});
