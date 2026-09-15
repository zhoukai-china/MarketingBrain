// 兰琪「公域获客 · 美业文案十件套」（LQ-33）真实模型 Eval。
//
// 与 `lanqi:copy-kit-smoke`（离线、假 provider）的区别：这里**真调一次模型**，验证
// 「共享合同 + 兰琪提问壳」在真实生成下能不能稳定拿到结构合格的十件套。
//
// 口径（AGENTS.md 五、智能体行为验收）：同一高风险样例至少重复 3 次，任一次硬失败都不放行。
// 本脚本会花钱（一次 Pro 文本调用），因此**不进 qa:fast**，按需手动跑。
import "dotenv/config";

async function main(): Promise<void> {
const { generateLanqiCopyKit, validateLanqiCopyKitContent } = await import("../apps/api/src/products/lanqi/copy-kit-service.js");
const { COPY_TEN_SECTIONS } = await import("../apps/api/src/products/beauty-industry/copy-ten-contract.js");

const RUNS = Number(process.env.LQ_COPY_KIT_EVAL_RUNS ?? "3");
/** 高风险样例：信息完整、要落地到同城到店的真实门店场景。 */
const SAMPLE = {
  brief:
    "主推 399 元水光深层补水体验课，想吸引同城 25-35 岁皮肤干燥暗沉的女生到店；顾客最怕被推销、怕办卡，我们全程不办卡，先做肤质检测再决定做什么项目。",
  platform: "dy" as const,
  goal: "visit" as const,
  storeName: "兰琪·西湖体验店"
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

/** 演示门店 / 样板数据泄漏检查：合同要求「未提供的事实写待补充」，不得套用别家门店。 */
const LEAK_TERMS = ["美肌研", "晓曼", "示例门店", "某某店"];

for (let run = 1; run <= RUNS; run += 1) {
  const started = Date.now();
  let status = "unknown";
  let failures: string[] = [];
  let content = "";
  try {
    const generation = await generateLanqiCopyKit({ request: SAMPLE, onRaw: (raw) => { content = raw; } });
    status = generation.result.status;
    if (generation.result.status === "ready") content = generation.result.content;
    if (generation.result.status === "invalid") failures = generation.result.failures;
  } catch (error) {
    status = `error:${error instanceof Error ? error.message : String(error)}`;
  }
  const elapsedMs = Date.now() - started;
  check(`第 ${run} 次：结构合格（ready）`, status === "ready", `${status}${failures.length ? ` :: ${failures.join(" / ")}` : ""}（${elapsedMs}ms）`);
  if (status === "invalid" && failures.some((item) => item.includes("违规引导词"))) {
    // 只在本机终端打印触发行的片段，用于判断「模型真写了引导词」还是「校验器误伤合规说明句」。
    const hits = ["私信", "加微信", "电话", "联系我", "找我", "留个", "扫码领", "加我"];
    const lines = content
      .split(/\r?\n/)
      .filter((line) => hits.some((hit) => line.includes(hit)))
      .slice(0, 6)
      .map((line) => `    ${line.slice(0, 90)}`);
    console.error(`  触发行：\n${lines.join("\n") || "    （content 为空：模型没返回正文）"}`);
  }
  if (status === "ready") {
    const missing = COPY_TEN_SECTIONS.filter((section) => !content.includes(section.replace(/^[一二三四五六七八九十]、/, "")));
    check(`第 ${run} 次：十节都在`, missing.length === 0, missing.join(" / "));
    check(`第 ${run} 次：结构校验一致通过`, validateLanqiCopyKitContent(content).length === 0);
    const leaked = LEAK_TERMS.filter((term) => content.includes(term));
    check(`第 ${run} 次：没有套用样板门店 / 他人信息`, leaked.length === 0, leaked.join(" / "));
    check(`第 ${run} 次：正文体量够（≥800 字）`, content.replace(/\s/g, "").length >= 800, `${content.replace(/\s/g, "").length} 字`);
  }
  console.log(`—— 第 ${run} 次耗时 ${elapsedMs}ms，正文 ${content.length} 字符`);
}

console.log(`\nlanqi_copy_kit_live_eval: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed / ${fail} failed, runs=${RUNS})`);
process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
