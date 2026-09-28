// IP 定位智能体（ip-pos）提问轮次契约回归。
// 用户 2026-09-15 的 WorkBuddy 对比报告指出：已部署端把提问压成「4 步 / 一次引导提问」，
// 与 ip-positioning skill 的「前置角色适配 + 5 轮逐维访谈」不一致。
// 本脚本离线守护：CHAT_FLOWS["ip-pos"] 必须是 6 个槽位，覆盖角色适配、项目、竞争、用户、创始人、IP 现状；
// 页面文案不得再出现「4 步 / 一次引导提问」。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const flowsPath = "apps/web/src/marketplace/chat-flows.ts";
const chatPagePath = "apps/web/src/marketplace/AgentChatPage.tsx";
const detailPagePath = "apps/web/src/marketplace/AgentDetailPage.tsx";

function main(): void {
  const flows = readFileSync(resolve(flowsPath), "utf8");
  const chatPage = readFileSync(resolve(chatPagePath), "utf8");
  const detailPage = readFileSync(resolve(detailPagePath), "utf8");

  // 源码级断言：不依赖运行时的动态 import，避免 tsx/ESM 差异。
  const ipPosBlock = flows.match(/"ip-pos"\s*:\s*\{[\s\S]*?\n\s*\},(?=\n\s*topic\s*:)/)?.[0];
  assert(ipPosBlock, "CHAT_FLOWS 必须包含 ip-pos");

  assert.match(ipPosBlock, /"role"/, "ip-pos 必须有角色适配槽位");
  assert.match(ipPosBlock, /"competition"/, "ip-pos 必须有竞争格局槽位");
  assert.match(ipPosBlock, /"project"/, "ip-pos 必须有项目基础槽位");
  assert.match(ipPosBlock, /"user"/, "ip-pos 必须有目标用户槽位");
  assert.match(ipPosBlock, /"founder"/, "ip-pos 必须有创始人 + 目标槽位");
  assert.match(ipPosBlock, /"stage"/, "ip-pos 必须有 IP 现状与能力槽位");

  const keyMatches = ipPosBlock.match(/key:\s*"([^"]+)"/g) ?? [];
  const keys = keyMatches.map((item) => item.replace(/key:\s*"/, "").replace(/"$/, ""));
  assert.deepEqual(
    keys,
    ["role", "project", "competition", "user", "founder", "stage"],
    `ip-pos 槽位顺序必须是 前置角色适配 + 5 轮，实际：${keys.join(",")}`
  );

  // 2026-09-27 欢迎语按原型重写：保留「6 步访谈」口径，新增「一次只问一个维度 / 自动填进右侧简报」承诺。
  assert.match(ipPosBlock, /6 步访谈/, "ip-pos welcome 必须按 6 步访谈推进");
  assert.match(ipPosBlock, /一次只问一个维度/, "ip-pos welcome 必须写明一次只问一个维度");
  assert.match(ipPosBlock, /自动填进右侧/, "ip-pos welcome 必须说明回答自动填进右侧简报");
  assert.doesNotMatch(ipPosBlock, /IP 定位七步法/, "ip-pos welcome 不得再写与槽位不一致的七步法");
  // 新版对话内容：6 问全部带「💡 提示」提示语（对齐 ip-pos-workbench-demo-20260924）。
  for (const key of keys) {
    assert.match(ipPosBlock, new RegExp(`key: "${key}"[\\s\\S]{0,400}?hint: "`), `ip-pos 槽位 ${key} 必须带 hint 提示语`);
  }

  assert.match(
    flows,
    /const items = (?:flow\.slots|effectiveSlots\(flow, answers\))\s*\.map/,
    "最终生成必须按当前 flow 槽位逐槽汇总（effectiveSlots 是 09-25 引入的预填增强版），不能写死旧 4 槽"
  );

  assert.doesNotMatch(chatPage, /我再带你走那 4 步/, "登录引导不得再写 4 步");
  assert.match(chatPage, /逐轮补全信息/, "登录引导必须改成逐轮补全信息");

  assert.doesNotMatch(detailPage, /一次引导提问/, "详情页不得再写一次引导提问");
  assert.match(detailPage, /逐轮主动提问/, "详情页必须写明逐轮主动提问");

  console.log("PASS marketplace-ip-pos-interview-contract-smoke");
}

main();
