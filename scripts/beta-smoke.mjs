const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") continue;
  if (arg.startsWith("--")) {
    const next = process.argv[index + 1];
    args.set(arg, next && !next.startsWith("--") ? next : "true");
    if (next && !next.startsWith("--")) index += 1;
  }
}

const baseUrl = String(args.get("--base") ?? process.env.BETA_SMOKE_BASE_URL ?? "http://localhost:3011").replace(
  /\/$/,
  ""
);
const planCode = String(args.get("--plan") ?? "local_premium");
const includeChat = args.has("--include-chat");
const includeWorkbench = args.has("--include-workbench");
const includeWechatPay = args.has("--include-wechat-pay");
const inputToken = args.get("--token")
  ? String(args.get("--token"))
  : process.env.BETA_SMOKE_TOKEN ?? "";
const inviteCode = args.get("--invite-code")
  ? String(args.get("--invite-code"))
  : process.env.BETA_SMOKE_INVITE_CODE ?? "";
const secondInviteCode = args.get("--second-invite-code")
  ? String(args.get("--second-invite-code"))
  : process.env.BETA_SMOKE_SECOND_INVITE_CODE ?? "";
const opsToken = args.get("--ops-token") ? String(args.get("--ops-token")) : process.env.OPS_TOKEN ?? "";
const adminToken = args.get("--admin-token")
  ? String(args.get("--admin-token"))
  : process.env.ADMIN_TOKEN ?? "";
const wechatRedirectUri = String(
  args.get("--wechat-redirect-uri") ??
    process.env.WECHAT_AUTH_REDIRECT_URI ??
    process.env.VITE_WECHAT_AUTH_REDIRECT_URI ??
    "http://localhost:5174/"
);

const state = {
  token: inputToken,
  dataMode: "unknown",
  tenantId: "",
  userId: "",
  lastAgentRunId: "",
  conversationId: ""
};
const results = [];

await step("health", async () => {
  const body = await request("GET", "/health");
  assert(body.ok === true, "health ok should be true");
});

await step("readiness snapshot", async () => {
  const body = await request("GET", "/ready", { allowedStatuses: [200, 503] });
  if (body.ok !== true) {
    return warning("ready is not fully green yet; this is acceptable for local demo but blocks customer launch");
  }
});

if (!state.token && inviteCode) {
  await step("invite beta login", async () => {
    const body = await request("POST", "/auth/beta-login", {
      body: {
        tenantRole: "local_business",
        tenantName: "内测冒烟商家",
        industry: "本地生活服务",
        city: "杭州",
        nickname: "内测检查",
        inviteCode
      }
    });
    assert(body.token, "invite beta login should return token");
    state.token = body.token;
    state.dataMode = body.dataMode ?? "unknown";
    state.tenantId = body.tenantId ?? "";
    state.userId = body.userId ?? "";
  });
}

if (!state.token) {
  await step("dev login", async () => {
    const body = await request("POST", "/auth/dev-login", {
      allowedStatuses: [200, 404],
      body: {
        planCode,
        tenantName: "内测冒烟商家",
        industry: "本地生活服务",
        city: "杭州",
        nickname: "内测检查"
      }
    });
    if (body.error === "not_found") {
      throw new Error("production disables dev-login; rerun with --token <customer_or_test_token> or --invite-code <beta_invite>");
    }
    assert(body.token, "dev login should return token");
    state.token = body.token;
    state.dataMode = body.dataMode ?? "unknown";
    state.tenantId = body.tenantId ?? "";
    state.userId = body.userId ?? "";
  });
}

await step("account status", async () => {
  const body = await authed("GET", "/account/status");
  assert(body.plan?.code, "account status should include plan");
  assert(typeof body.creditBalance === "number", "account status should include credit balance");
  state.dataMode = body.dataMode ?? state.dataMode;
  state.tenantId = body.tenantId ?? state.tenantId;
  state.userId = body.userId ?? state.userId;
});

await step("beta agent entitlement", async () => {
  const body = await authed("GET", "/agents/me");
  assert(Array.isArray(body.agents), "agent access response should include agents");
  assert(
    body.agents.some((agent) => agent.slug === "acquisition" && agent.entitled === true),
    "beta account should include the brand acquisition agent"
  );
});

await step("tenant profile update", async () => {
  const body = await authed("PATCH", "/tenant/current/profile", {
    body: {
      industry: "美容美业",
      city: "杭州",
      profile: {
        mainProduct: "皮肤管理、老客复购项目",
        targetCustomer: "25-40岁本地女性，重视效果和信任感",
        priceRange: "客单价 398-1980 元",
        channels: "微信朋友圈、抖音本地生活、小红书",
        currentProblem: "新增微信不少，但私聊跟进和成交转化不稳定",
        teamStatus: "老板负责经营，2名销售/运营，员工执行标准不统一"
      }
    }
  });
  assert(body.profile || body.tenant, "tenant profile update should return profile or tenant");
});

await step("tenant profile read", async () => {
  const body = await authed("GET", "/tenant/current");
  assert(body.profile?.industry || body.profile?.tenantName, "tenant current should include profile");
  assert(body.plan?.code, "tenant current should include plan");
});

await step("billing catalog", async () => {
  const body = await authed("GET", "/billing/catalog");
  assert(Array.isArray(body.plans) && body.plans.length >= 6, "catalog should include all active plans");
  assert(Array.isArray(body.creditPacks) && body.creditPacks.length === 3, "catalog should include three credit packs");
});

let orderId = "";
await step("create credit order", async () => {
  const body = await authed("POST", "/billing/orders", {
    body: {
      type: "credit_pack",
      creditPackCode: "starter_500"
    }
  });
  assert(body.order?.id, "order should be created");
  orderId = body.order.id;
  assert(body.order?.amountCny === 30, "starter credit pack should be 30 CNY");
});

await step("read order", async () => {
  const body = await authed("GET", `/billing/orders/${orderId}`);
  assert(body.order?.id === orderId, "order detail should match created order");
});

if (includeWechatPay) {
  await step("wechat prepay", async () => {
    const body = await authed("POST", `/billing/orders/${orderId}/wechat-prepay`, {
      allowedStatuses: [200, 503]
    });
    if (body.error === "wechat_pay_not_configured") {
      return warning(`WeChat Pay is not configured: ${(body.issues ?? []).join("; ")}`);
    }
    assert(body.codeUrl, "wechat prepay should return codeUrl");
  });
} else {
  results.push({
    step: "wechat prepay",
    status: "skipped",
    note: "pass --include-wechat-pay after WeChat Pay config is ready"
  });
}

await step("mock pay or production pay guard", async () => {
  const body = await authed("POST", `/billing/orders/${orderId}/mock-pay`, {
    allowedStatuses: [200, 404]
  });
  if (body.error === "not_found") {
    return warning("mock-pay is disabled, as expected in production");
  }
  assert(body.applied === true, "mock payment should apply order benefits");
});

await step("credit transactions", async () => {
  const body = await authed("GET", "/credits/transactions?limit=10");
  assert(typeof body.creditBalance === "number", "credit transaction response should include balance");
  assert(Array.isArray(body.transactions), "credit transaction response should include list");
});

await step("workbench permission", async () => {
  const body = await authed("GET", "/workbench/summary", { allowedStatuses: [200, 403] });
  if (planCode.endsWith("_premium")) {
    assert(body.enabled === true, "premium plan should access workbench");
    return;
  }
  assert(body.error === "plan_requires_premium", "standard plan should be blocked from workbench");
});

if (includeChat) {
  await step("chat agent", async () => {
    const body = await authed("POST", "/chat", {
      body: {
        input: "帮我给一家本地美容院做明天的朋友圈和销售话术",
        skillId: "sales_growth_advisor"
      }
    });
    assert(body.answer && body.answer.length > 20, "chat should return an answer");
    assert(body.skillId === "sales_growth_advisor", "chat should use requested skill");
    state.lastAgentRunId = body.agentRunId ?? state.lastAgentRunId;
    state.conversationId = body.conversationId ?? state.conversationId;
  });
} else {
  results.push({
    step: "chat agent",
    status: "skipped",
    note: "pass --include-chat to exercise the LLM path"
  });
}

if (state.conversationId) {
  await step("conversation history", async () => {
    const list = await authed("GET", "/conversations");
    const found =
      Array.isArray(list.conversations) &&
      list.conversations.some((conversation) => conversation.id === state.conversationId);
    assert(found, "conversation list should include the new chat");

    const messages = await authed("GET", `/conversations/${state.conversationId}/messages`);
    assert(Array.isArray(messages.messages), "conversation messages should include list");
    assert(messages.messages.length >= 2, "conversation should include user and assistant messages");
  });
} else {
  results.push({
    step: "conversation history",
    status: "skipped",
    note: "requires database persistence"
  });
}

if (state.lastAgentRunId) {
  await step("quality feedback", async () => {
    const body = await authed("POST", `/agent-runs/${state.lastAgentRunId}/feedback`, {
      body: {
        rating: 5,
        issueType: "smoke_test",
        note: "内测冒烟自动反馈"
      }
    });
    assert(body.feedback || body.saved === false, "feedback endpoint should return feedback payload");
  });
} else {
  results.push({
    step: "quality feedback",
    status: "skipped",
    note: "requires a persisted chat agent run"
  });
}

if (includeWorkbench) {
  await runWorkbenchChecks();
} else {
  results.push({
    step: "workbench deep checks",
    status: "skipped",
    note: "pass --include-workbench to test file analysis, audio cards and report generation"
  });
}

if (opsToken) {
  await step("ops launch check", async () => {
    const body = await request("GET", "/ops/launch-check", {
      headers: {
        "x-Sitong-ops-token": opsToken
      },
      allowedStatuses: [200]
    });
    assert(Array.isArray(body.checks), "launch check should return checks");
    if (body.ok !== true) {
      return warning(`launch-check not customer_ready: ${body.nextAction ?? "fix failed checks"}`);
    }
  });

  await step("ops wechat auth check", async () => {
    const body = await request(
      "GET",
      `/ops/wechat-auth-check?redirectUri=${encodeURIComponent(wechatRedirectUri)}`,
      {
        headers: {
          "x-Sitong-ops-token": opsToken
        },
        allowedStatuses: [200]
      }
    );
    assert(typeof body.ok === "boolean", "wechat auth check should include ok");
    if (body.ok !== true) {
      return warning(`WeChat Auth is not ready: ${(body.issues ?? []).join("; ")}`);
    }
    if (body.required !== false) {
      assert(body.authorizeUrl, "wechat auth check should return authorizeUrl when ready");
    }
  });

  await step("ops wechat pay check", async () => {
    const body = await request("GET", "/ops/wechat-pay-check", {
      headers: {
        "x-Sitong-ops-token": opsToken
      },
      allowedStatuses: [200]
    });
    assert(typeof body.ok === "boolean", "wechat pay check should include ok");
    if (body.ok !== true) {
      return warning(`WeChat Pay is not ready: ${(body.issues ?? []).join("; ")}`);
    }
  });
} else {
  results.push({
    step: "ops launch check",
    status: "skipped",
    note: "pass --ops-token or set OPS_TOKEN"
  });
}

if (adminToken) {
  await runAdminChecks();
} else {
  results.push({
    step: "admin checks",
    status: "skipped",
    note: "pass --admin-token or set ADMIN_TOKEN"
  });
}

await runIsolationCheck();

const failed = results.filter((item) => item.status === "failed");
const summary = {
  ok: failed.length === 0,
  baseUrl,
  dataMode: state.dataMode,
  tenantId: maskId(state.tenantId),
  userId: maskId(state.userId),
  results,
  nextAction:
    failed.length === 0
      ? "Beta smoke passed. Continue with WeChat login/pay callback and customer-specific scenarios."
      : "Fix failed steps before inviting beta customers."
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.ok ? 0 : 1;

async function runIsolationCheck() {
  if (inputToken) {
    results.push({
      step: "data isolation",
      status: "skipped",
      note: "token mode cannot safely create a second workspace"
    });
    return;
  }
  if (state.dataMode !== "database") {
    results.push({
      step: "data isolation",
      status: "skipped",
      note: "demo mode uses in-memory demo context; run DATA_MODE=database for real tenant isolation"
    });
    return;
  }
  if (inviteCode && !secondInviteCode) {
    results.push({
      step: "data isolation",
      status: "skipped",
      note: "invite mode needs --second-invite-code to create a second workspace safely"
    });
    return;
  }

  await step("data isolation", async () => {
    const tenantAOrderId = orderId;
    const tenantB = secondInviteCode
      ? await request("POST", "/auth/beta-login", {
          body: {
            tenantRole: "local_business",
            tenantName: "内测冒烟商家B",
            industry: "本地生活服务",
            city: "上海",
            nickname: "内测检查B",
            inviteCode: secondInviteCode
          }
        })
      : await request("POST", "/auth/dev-login", {
          body: {
            planCode,
            tenantName: "内测冒烟商家B",
            industry: "本地生活服务",
            city: "上海",
            nickname: "内测检查B"
          }
        });
    assert(tenantB.token, "second login should return token");
    const body = await request("GET", "/billing/orders", {
      token: tenantB.token
    });
    const leaked = Array.isArray(body.orders) && body.orders.some((item) => item.id === tenantAOrderId);
    assert(!leaked, "second tenant should not see first tenant order");
  });
}

async function runWorkbenchChecks() {
  let fileId = "";
  let audioCardId = "";

  await step("file upload", async () => {
    const form = new FormData();
    form.set(
      "file",
      new Blob(
        [
          [
            "date,new_leads,deals,revenue,notes",
            "2026-06-26,18,2,3980,朋友圈成交弱但老客复购咨询增加",
            "2026-06-27,22,3,5680,短视频私信多但跟进不及时"
          ].join("\n")
        ],
        { type: "text/csv" }
      ),
      "baolu-smoke-经营数据.csv"
    );
    const body = await authed("POST", "/files", {
      form
    });
    assert(body.file?.id, "file upload should return file id");
    fileId = body.file.id;
  });

  await step("file list", async () => {
    const body = await authed("GET", "/files");
    const found = Array.isArray(body.files) && body.files.some((file) => file.id === fileId);
    assert(found, "uploaded file should appear in file list");
  });

  await step("file analysis", async () => {
    const body = await authed("POST", `/files/${fileId}/analyze`, {
      allowedStatuses: [200, 402]
    });
    if (body.error === "insufficient_credits") {
      return warning("file analysis skipped because credits are insufficient");
    }
    assert(body.analysis?.output && body.analysis.output.length > 20, "file analysis should return output");
  });

  await step("audio card create", async () => {
    const body = await authed("POST", "/audio-cards", {
      body: {
        source: "manual",
        staffName: "内测员工",
        storeName: "杭州内测门店",
        workDate: "2026-06-27",
        transcript:
          "今天新增微信22个，成交3单。上午客流少，下午有客户问价格但没有继续追问需求。短视频发了1条，有5个私信，员工还没及时回访。",
        summary: "门店获客有起量，但成交承接和私信回访偏弱。",
        metrics: {
          newLeads: 22,
          deals: 3,
          privateMessages: 5
        }
      }
    });
    assert(body.audioCard?.id, "audio card should return id");
    audioCardId = body.audioCard.id;
  });

  await step("audio card analysis", async () => {
    const body = await authed("POST", `/audio-cards/${audioCardId}/analyze`, {
      allowedStatuses: [200, 402]
    });
    if (body.error === "insufficient_credits") {
      return warning("audio card analysis skipped because credits are insufficient");
    }
    assert(body.answer && body.answer.length > 20, "audio card analysis should return answer");
    state.lastAgentRunId = body.agentRunId ?? state.lastAgentRunId;
  });

  await step("report generation", async () => {
    const body = await authed("POST", "/reports", {
      allowedStatuses: [200, 402],
      body: {
        title: "内测冒烟经营增长建议报告",
        scope: "all",
        format: "markdown"
      }
    });
    if (body.error === "insufficient_credits") {
      return warning("report generation skipped because credits are insufficient");
    }
    assert(body.report?.markdown && body.report.markdown.includes("内测冒烟"), "report should include markdown");
  });
}

async function runAdminChecks() {
  await step("admin ops summary", async () => {
    const body = await request("GET", "/admin/ops/summary", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(body.dataMode, "admin ops summary should include dataMode");
  });

  await step("admin billing audit", async () => {
    const body = await request("GET", "/admin/billing/audit", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(typeof body.ok === "boolean", "billing audit should include ok");
  });

  await step("admin isolation audit", async () => {
    const body = await request("GET", "/admin/security/isolation-audit", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(typeof body.ok === "boolean", "isolation audit should include ok");
    if (body.ok !== true) {
      return warning(`tenant isolation audit found ${body.issues?.length ?? 0} issue(s)`);
    }
  });

  await step("admin quality summary", async () => {
    const body = await request("GET", "/admin/quality/summary", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(body.dataMode, "quality summary should include dataMode");
  });

  await step("admin invite list", async () => {
    const body = await request("GET", "/admin/invites", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(Array.isArray(body.invites), "invite list should include invites array");
  });

  let customerId = "";
  await step("admin customer list", async () => {
    const body = await request("GET", "/admin/customers", {
      headers: {
        "x-Sitong-admin-token": adminToken
      }
    });
    assert(Array.isArray(body.customers), "customer list should include customers array");
    customerId = body.customers[0]?.id ?? state.tenantId;
  });

  await step("admin customer detail", async () => {
    if (!customerId) {
      return warning("no customer id available for detail check");
    }
    const body = await request("GET", `/admin/customers/${customerId}`, {
      headers: {
        "x-Sitong-admin-token": adminToken
      },
      allowedStatuses: [200, 404]
    });
    if (body.error === "customer_not_found") {
      return warning("customer detail not found in current data mode");
    }
    assert(body.customer?.id, "customer detail should include customer");
  });
}

async function step(name, fn) {
  const startedAt = Date.now();
  try {
    const note = await fn();
    results.push({
      step: name,
      status: note?.status ?? "passed",
      note: note?.note,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    results.push({
      step: name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
  }
}

function warning(note) {
  return { status: "warning", note };
}

async function authed(method, path, options = {}) {
  return request(method, path, {
    ...options,
    token: options.token ?? state.token
  });
}

async function request(method, path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {})
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined)
  });
  const text = await response.text();
  const body = text ? parseJson(text) : {};
  const allowedStatuses = options.allowedStatuses ?? [200];
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return body;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function maskId(value) {
  if (!value) return "";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
