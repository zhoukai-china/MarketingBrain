import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.ts";

const provider = {
  name: "founder-ip-topic-final-delivery-fallback",
  async complete(): Promise<string> {
    throw new Error("force_final_topic_delivery_fallback");
  }
};

const input = [
  "【选题系统自动运行】【选题系统四源运行】",
  "本轮服务主体：脱敏创始人IP验收主体",
  "【本轮创始人IP获客目标简报】",
  "获客目标：招商加盟",
  "创始人身份/项目：连锁餐饮加盟顾问",
  "目标人群：准备评估餐饮加盟项目的城市合伙人",
  "本轮线索目标：获取加盟咨询",
  "主推项目/真实承接：加盟诊断沟通",
  "账号与内容阶段：稳定更新期",
  "本轮明确行业：连锁餐饮加盟服务",
  "【来源一｜行业热点】本轮未选择，不得检索或使用行业热点。",
  "【来源二｜对标账号】本轮未选择。",
  "【来源三｜AI录音卡】已选择。录音转写：客户原话：加盟商最怕交了钱没有陪跑，先看真实门店巡检记录，再谈合作条件。",
  "【来源四｜自己账号真实数据复盘】本轮未选择。"
].join("\n");

function assertFinalTopicDelivery(answer: string): void {
  for (const field of ["选题/钩子", "目标人群", "来源依据", "与获客目标的关系", "下一步生成内容"]) {
    assert.ok(answer.includes(field), `final delivery lost required field: ${field}\n${answer}`);
  }
  assert.ok(answer.includes("交了钱没有陪跑"), `final delivery lost selected recording evidence\n${answer}`);
  assert.equal((answer.match(/^\|\s*(?:[1-9]|10)\s*\|/gm) ?? []).length, 10, `final delivery must include ten topic rows\n${answer}`);
  assert.doesNotMatch(answer, /门店明厨巡检新规/, `disabled industry source leaked into final delivery\n${answer}`);
}

async function assertHttpFinalDelivery(): Promise<void> {
  const origin = process.env.FIP_TOPIC_API_ORIGIN ?? "http://127.0.0.1:3012";
  const login = await fetch(`${origin}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantRole: "personal_ip",
      tenantName: "脱敏创始人IP验收主体",
      planCode: "ip_standard",
      industry: "连锁餐饮加盟服务"
    })
  });
  if (login.status !== 200) throw new Error(`dev login failed: ${await login.text()}`);
  const loginBody = await login.json() as { token?: string };
  assert.ok(loginBody.token, "dev login did not return a token");
  const run = await fetch(`${origin}/agents/acquisition/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      input,
      routingInput: "从四大来源生成创始人IP选题",
      capabilityId: "topic_inspiration",
      capabilitySelectionMode: "explicit",
      topicSystemRun: true,
      topicSourceSelection: { industry: false, benchmark: false, transcript: true, videoReview: false },
      deviceScope: "desktop"
    })
  });
  if (run.status !== 200) throw new Error(`topic run failed: ${await run.text()}`);
  const body = await run.json() as { answerText?: string; capabilityId?: string; skillId?: string };
  assert.equal(body.skillId, "baolu_topics");
  assert.equal(body.capabilityId, "topic_inspiration");
  assertFinalTopicDelivery(body.answerText ?? "");
}

async function main(): Promise<void> {
  const intermediate = await runAgent({
    tenantId: "fip-final-delivery-a",
    userId: "fip-final-delivery-user",
    role: "owner",
    planCode: "ip_standard",
    requestedSkillId: "baolu_topics",
    capabilityId: "topic_inspiration",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    channel: "workbench",
    input,
    routingInput: "从四大来源生成创始人IP选题",
    tenantProfile: {
      tenantId: "fip-final-delivery-a",
      tenantName: "脱敏创始人IP验收主体",
      tenantType: "personal_ip",
      industry: "连锁餐饮加盟服务"
    }
  }, provider);

  assertFinalTopicDelivery(intermediate.answer);
  if (process.argv.includes("--api")) await assertHttpFinalDelivery();
  console.log("founder_ip_topic_final_delivery_smoke:PASS");
}

void main();
