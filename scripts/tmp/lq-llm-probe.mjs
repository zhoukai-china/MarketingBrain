// 临时脚本：核对文本 Provider 的真实延迟与输出质量（跑完即删）。
import { readFileSync } from "node:fs";

const envText = readFileSync("apps/api/.env", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const prompt = [
  "你在为美业门店主播写直播口播稿。",
  "请写约 300 字，主题：为什么你花了钱脸还是没效果。",
  '只输出 JSON：{"script": "口播稿正文"}。'
].join("\n");

const started = Date.now();
const response = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
  body: JSON.stringify({
    model: env.DEEPSEEK_MODEL,
    messages: [{ role: "user", content: prompt }],
    thinking: { type: "disabled" },
    max_tokens: 2000,
    temperature: 0.5
  })
});
const data = await response.json();
const content = data?.choices?.[0]?.message?.content ?? "";
console.log("elapsedMs", Date.now() - started, "completionTokens", data?.usage?.completion_tokens);
console.log("HEAD>>>", content.slice(0, 220));
