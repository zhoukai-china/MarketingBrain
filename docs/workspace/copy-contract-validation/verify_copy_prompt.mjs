import fs from "node:fs";

// ===== 真实 parseCopyTenContract（从 copy-ten-contract.ts:54-131 逐字搬，含原 bug）=====
function countTableRows(text, headerCell) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.trim());
    if (cells.some((c) => c === headerCell)) {
      for (let j = i + 1; j < lines.length; j++) {
        const c2 = splitRow(lines[j]).map((x) => x.trim());
        if (!lines[j].trim().startsWith("|")) break;
        if (c2.every((x) => /^:?-{2,}:?$/.test(x))) continue;
        count++;
      }
      break;
    }
  }
  return count;
}
function splitRow(line) {
  const l = line.trim();
  if (!l.startsWith("|") || !l.endsWith("|")) return [];
  return l.slice(1, -1).split("|");
}
function parseCopyTenContract(text) {
  const failures = [];
  const sections = ["一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、"];
  sections.forEach((s) => {
    if (!new RegExp(`(?:^|\\n)(?:#{0,3}\\s*)?(?:[*_]{1,2}\\s*)?(?:\\s*\\|\\s*\\*\\*?\\s*)?${s}`).test(text)) {
      failures.push(`缺少「${s}」章节`);
    }
  });
  const scriptMatch = /二、[\s\S]*?(?=(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:\s*\|)?\s*三、|$)/.exec(text);
  const scriptText = scriptMatch ? scriptMatch[0] : "";
  const cleanScript = scriptText.replace(/【[^】]*】/g, "").replace(/>B-roll[^\n]*/g, "").replace(/```/g, "");
  const words = (cleanScript.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) ?? []).length;
  if (words < 150) failures.push(`口播稿过短（${words} 字 < 150）`);
  const longSentence = cleanScript.split(/[。！？；\n]/).map((s) => s.trim()).find((s) => s.length > 40 && !/^[0-9]+[-\s]*[0-9]*\s*秒/.test(s) && !/^【/.test(s) && !/^>/.test(s) && !/^\|/.test(s) && !/^[#-]/.test(s) && !/[|].*[|]/.test(s));
  if (longSentence) failures.push(`口播存在 >40 字单句（${longSentence.slice(0, 24)}…）`);
  const titleCount = (text.match(/^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:📌\s*)?主标题|^(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:🔁\s*)?备选/gm) ?? []).length;
  if (titleCount < 3) failures.push(`标题不足（${titleCount} < 3，需主标题+2备选）`);
  ["大流量", "精准", "行业"].forEach((layer) => {
    if (!new RegExp(layer).test(text)) failures.push(`话题缺少「${layer}」层级`);
  });
  const edlRowCount = countTableRows(text, "段落");
  if (edlRowCount < 4) failures.push(`剪辑EDL 段落不足（${edlRowCount} < 4）`);
  const contentType = (/(内容类型|content_type)[\s\S]{0,12}?[：:][\s\S]{0,6}?((?:获客型|人设型|流量型))/.exec(text)?.[1]) ?? "";
  if (contentType === "获客型") {
    const qaCount = (text.match(/(?:【问·?|问·)/g) ?? []).length;
    if (qaCount < 5) failures.push(`访谈话术问答不足（${qaCount} < 5）`);
  }
  if (contentType === "获客型" && !/本地推/.test(text)) failures.push("获客型应主投本地推，缺失本地推建议");
  if (contentType === "流量型" && !/DOU\+/.test(text)) failures.push("流量型应主投 DOU+，缺失 DOU+ 建议");
  const scanText = text
    .replace(/十、[\s\S]*$/m, "")
    .split(/\r?\n/)
    .filter((line) => !/严禁|禁忌|违禁|医疗承诺|避免[^，。]{0,12}承诺|绝对化用语|合规提示/.test(line))
    .join("\n");
  if (/私信|加微信|电话|联系我|找我|留个|扫码领|加我/.test(scanText)) failures.push("文案区含违规引导词（私信/加微信/电话/联系我/找我/留个/扫码领/加我）");
  if (/唯一|保证|100%|根治|彻底|永久/.test(scanText)) failures.push("文案区含绝对化用语（唯一/保证/100%/根治/彻底/永久）");
  if (/包回本|稳赚|月入过万|零风险|躺赚/.test(scanText)) failures.push("文案区含承诺类表述（包回本/稳赚/月入过万/零风险/躺赚）");
  return { failures };
}

// ===== 配置（与 marketplace.ts 文案生成一致）=====
const API_KEY = "sk-5b9357b1518742b690def070d0f10ff4";
const BASE_URL = "https://api.deepseek.com/v1";
const MODEL = "deepseek-v4-flash";
const TEMP = 0.3;
const MAX_TOKENS = 8000;

const prompt = fs.readFileSync("copy_ten_prompt_v5.1_test.txt", "utf8");
const data = JSON.parse(fs.readFileSync("copy_io_array.json", "utf8"));

function sectionTitles(text) {
  const re = /(?:^|\n)(?:#{0,3}\s*)?(?:[*_]{1,2}\s*)?(?:[|]\s*)?(?:[*_]{1,2}\s*)?(?:一|二|三|四|五|六|七|八|九|十)、([^\n]*)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim().slice(0, 12));
  return out;
}

async function callLLM(input) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 150000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: input },
        ],
        temperature: TEMP,
        max_tokens: MAX_TOKENS,
      }),
    });
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(t);
  }
}

const results = [];
for (let i = 0; i < 2; i++) {
  const rec = data[i];
  const input = rec.input;
  console.log(`\n========== 记录${i + 1} ==========`);
  console.log("输入长度:", input.length, "| 内容类型片段:", (input.match(/内容类型[：:][^\n]*/) ?? ["(无)"])[0]);

  // 1) 原始库内答案的校验（sanity check）
  const orig = parseCopyTenContract(rec.answer ?? "");
  console.log("【原始库内答案】结构章节数:", sectionTitles(rec.answer ?? "").length, "| 校验失败:", orig.failures.length ? orig.failures : "✅ 通过");

  // 2) 用修改后的 prompt 重新生成
  console.log("→ 调用 DeepSeek(" + MODEL + ") 生成中…");
  let gen = "";
  try {
    gen = await callLLM(input);
  } catch (e) {
    console.log("!! API 调用失败:", e.message);
  }
  if (gen) {
    fs.writeFileSync(`copy_verify_out_${i + 1}.md`, gen, "utf8");
    const v = parseCopyTenContract(gen);
    console.log("【新生成】结构章节数:", sectionTitles(gen).length, "| 校验失败:", v.failures.length ? v.failures : "✅ 通过");
    console.log("【新生成】章节标题:", sectionTitles(gen).join(" / "));
    results.push({ i: i + 1, originalFail: orig.failures, newFail: v.failures, newSections: sectionTitles(gen) });
  }
}
console.log("\n==== DONE ====");
