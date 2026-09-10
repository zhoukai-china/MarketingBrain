// 临时脚本：实测文本 Provider 中文长输出的吞吐与延迟，用于决定直播逐字稿的生成粒度。
// 仅本地开发阶段使用，跑完即删；不打印任何密钥。
import { readFileSync } from "node:fs";

const envText = readFileSync("apps/api/.env", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const baseUrl = env.DEEPSEEK_BASE_URL;
const apiKey = env.DEEPSEEK_API_KEY;
const model = env.DEEPSEEK_MODEL;
if (!baseUrl || !apiKey || !model) {
  console.log("MISSING_ENV", { hasBase: !!baseUrl, hasKey: !!apiKey, hasModel: !!model });
  process.exit(1);
}

async function measure(targetChars, maxTokens, round) {
  const prompt = [
    "你在为美业门店主播写单人 2 小时直播逐字稿。",
    `请写一段约 ${targetChars} 字的中文口播稿，主题：为什么你花了钱脸还是没效果。`,
    "要求：口语化、有停顿提示、用[方括号]写动作或语气、不要编造价格数字。",
    "只输出 JSON：{\"script\": \"口播稿正文\"}。"
  ].join("\n");
  const started = Date.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "disabled" },
      max_tokens: maxTokens,
      temperature: 0.5
    })
  });
  const elapsed = Date.now() - started;
  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content ?? "";
  const parsed = (() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  })();
  const script = typeof parsed?.script === "string" ? parsed.script : content;
  const record = {
    round,
    targetChars,
    httpStatus: response.status,
    elapsedMs: elapsed,
    finishReason: data?.choices?.[0]?.finish_reason ?? null,
    completionTokens: data?.usage?.completion_tokens ?? null,
    rawChars: content.length,
    scriptChars: script.length,
    charsPerSecond: elapsed > 0 ? Math.round((script.length / elapsed) * 1000) : null
  };
  console.log(JSON.stringify(record));
  return record;
}

const results = [];
results.push(await measure(1200, 8000, 1));
results.push(await measure(3000, 16000, 2));
const totalChars = results.reduce((sum, item) => sum + item.scriptChars, 0);
const totalMs = results.reduce((sum, item) => sum + item.elapsedMs, 0);
console.log(JSON.stringify({ aggregateCharsPerSecond: Math.round((totalChars / totalMs) * 1000) }));
