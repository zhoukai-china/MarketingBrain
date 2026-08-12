import assert from "node:assert/strict";

const baseUrl = process.env.SITONG_API_BASE_URL || "http://127.0.0.1:3011";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${payload.message || payload.error || text}`);
  return payload;
}

const login = await request("/auth/dev-login", {
  method: "POST",
  body: {
    planCode: "chain_premium",
    tenantName: "选题系统验收",
    industry: "AI企业服务",
    city: "杭州",
    nickname: "选题验收"
  }
});
assert(login.token, "dev login should return token");
const headers = { Authorization: `Bearer ${login.token}` };

const sourceStatus = await request("/agents/acquisition/latest-video-review?deviceScope=desktop", { headers });
assert(Object.hasOwn(sourceStatus, "review"), "latest video review endpoint should return review field");

const transcriptPayload = await request("/knowledge-base/documents?type=transcript&limit=2", { headers });
const knowledgeDocumentIds = (transcriptPayload.documents ?? []).map((document) => document.id);
const run = await request("/agents/acquisition/runs", {
  method: "POST",
  headers,
  body: {
    requestId: `topic-system-${crypto.randomUUID()}`,
    input: [
      "【选题系统自动运行】【选题系统四源运行】",
      "本轮服务主体：选题系统验收企业",
      "【本轮获客 Brief】",
      "我的身份/业务：AI 企业服务顾问，提供企业知识库与智能体落地服务。",
      "目标客户：准备做 AI 改造的中小企业老板。",
      "本轮获客目标：获取留资线索。",
      "主推产品/服务：企业知识库诊断与智能体试点服务。",
      "账号与内容阶段：抖音新号冷启动。",
      "本轮明确行业：AI企业服务",
      "目标客户：准备做AI改造的中小企业老板",
      "本轮转化目标：用选题吸引目标客户私信、留资或业务咨询。",
      "【来源一｜行业热点】围绕AI企业服务检索并核验近期行业变化。",
      "【来源二｜对标账号】待补，不得虚构账号或作品。",
      knowledgeDocumentIds.length
        ? `【来源三｜AI录音卡】已选择 ${knowledgeDocumentIds.length} 条真实录音转写。`
        : "【来源三｜AI录音卡】待补，不得编造IP原话。",
      "【来源四｜视频数据复盘】待补，不得虚构播放、完播、互动或成交数据。",
      "请固定调用选题系统 Skill，只输出10条可测试选题，并标明每条使用的来源。"
    ].join("\n"),
    routingInput: "从四大来源生成选题；身份：AI 企业服务顾问；目标客户：中小企业老板；本轮获客目标：获取留资线索；行业：AI企业服务。",
    capabilityId: "topic_inspiration",
    capabilitySelectionMode: "explicit",
    deviceScope: "desktop",
    knowledgeDocumentIds: knowledgeDocumentIds.length ? knowledgeDocumentIds : undefined
  }
});

assert.equal(run.skillId, "baolu_topics", "topic system must call baolu_topics");
assert.equal(run.capabilityId, "topic_inspiration", "topic system capability should stay locked");
assert.equal(run.analysisMode, "deep", "topic system should use deep analysis");
assert((run.answerText ?? "").length >= 200, "topic output is unexpectedly short");
assert(/选题/.test(run.answerText ?? ""), "topic output should contain topics");

console.log(JSON.stringify({
  passed: true,
  skillId: run.skillId,
  capabilityId: run.capabilityId,
  analysisMode: run.analysisMode,
  knowledgeSources: run.knowledgeSources?.length ?? 0,
  answerChars: run.answerText.length,
  hasVideoReview: Boolean(sourceStatus.review)
}, null, 2));
