import { readFileSync } from "node:fs";

const envPath = process.argv[2] ?? "/etc/Sitong-secrets/Sitong-os-v2.env";
const baseUrl = process.argv[3] ?? "http://127.0.0.1:3002";
const env = readEnvFile(envPath);
const opsToken = env.OPS_TOKEN;

if (!opsToken) {
  console.error("OPS_TOKEN is missing");
  process.exit(1);
}

const checks = [
  ["launch", "/ops/launch-check"],
  ["llm", "/ops/llm-smoke"],
  [
    "wechatAuth",
    `/ops/wechat-auth-check?redirectUri=${encodeURIComponent(
      env.WECHAT_AUTH_REDIRECT_URI ?? "https://api.lcppch.top/os-v2/wechat-callback"
    )}`
  ],
  ["wechatPay", "/ops/wechat-pay-check"]
];

const results = {};
for (const [name, path] of checks) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "x-Sitong-ops-token": opsToken
    }
  });
  const text = await response.text();
  results[name] = {
    ok: response.ok,
    status: response.status,
    body: parseJson(text)
  };
}

console.log(JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((result) => result.ok) ? 0 : 1);

function readEnvFile(filePath) {
  const values = {};
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    values[trimmed.slice(0, equalsIndex)] = trimmed.slice(equalsIndex + 1);
  }
  return values;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
