#!/usr/bin/env node

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") continue;
  if (!arg.startsWith("--")) continue;
  const next = process.argv[index + 1];
  args.set(arg, next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) index += 1;
}

const baseUrl = String(args.get("--base") ?? "http://localhost:3012").replace(/\/$/, "");
const inviteCode = String(args.get("--invite-code") ?? process.env.INVITE_CODE ?? "").trim();

if (!inviteCode) {
  console.error("Pass --invite-code or set INVITE_CODE.");
  process.exit(1);
}

const body = {
  tenantRole: "chain_brand",
  planCode: "chain_premium",
  tenantName: "邀请码并发测试",
  industry: "餐饮连锁",
  city: "沈阳",
  nickname: "并发测试"
};

const responses = await Promise.all(
  ["A", "B"].map(async (suffix) => {
    const response = await fetch(`${baseUrl}/auth/beta-login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...body,
        tenantName: `${body.tenantName}${suffix}`,
        inviteCode
      })
    });
    const text = await response.text();
    return {
      status: response.status,
      body: parseJson(text)
    };
  })
);

const successful = responses.filter((response) => response.status === 200);
const rejected = responses.filter(
  (response) =>
    response.status === 403 &&
    response.body?.error === "invite_code_exhausted"
);
const ok = successful.length === 1 && rejected.length === 1;

console.log(
  JSON.stringify(
    {
      ok,
      baseUrl,
      successfulRequests: successful.length,
      exhaustedRequests: rejected.length,
      statuses: responses.map((response) => ({
        status: response.status,
        error: response.body?.error ?? null
      })),
      nextAction: ok
        ? "One-time invite concurrency protection passed."
        : "Fix invite redemption transaction before issuing customer beta codes."
    },
    null,
    2
  )
);

process.exit(ok ? 0 : 1);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}
