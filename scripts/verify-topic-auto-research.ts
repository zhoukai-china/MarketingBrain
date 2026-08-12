import {
  buildCompetitorSignalSources,
  buildIpCapabilityIntelContext,
  extractCompetitorAccountQueries
} from "../apps/api/src/routes/chat.js";

async function main() {
  const multiAccountInput = [
    "【来源二｜对标账号】",
    "1. 抖音｜陈厂长｜https://example.com/chen",
    "2. 小红书｜王老师",
    "只能使用能够确认归属的公开账号和公开内容。",
    "【来源三｜AI录音卡】"
  ].join("\n");
  const accounts = extractCompetitorAccountQueries(multiAccountInput);
  if (accounts.join("|") !== "陈厂长|王老师") throw new Error("多个对标账号没有被逐个识别");
  const accountSources = buildCompetitorSignalSources(multiAccountInput, "企业AI服务");
  if (!accountSources.some((item) => item.label.includes("陈厂长")) || !accountSources.some((item) => item.label.includes("王老师"))) {
    throw new Error("多个对标账号没有分别进入公开抓取队列");
  }
  const result = await buildIpCapabilityIntelContext(
    "topic_inspiration",
    `${multiAccountInput}\n【选题系统自动运行】请自动扫描四大来源`,
    "企业AI服务"
  );
  if (!result?.includes("四大来源自动采集")) throw new Error("自动采集上下文缺失");
  if (!result.includes("行业与用户热点")) throw new Error("行业与用户热点采集段缺失");
  if (!result.includes("同行与对标内容")) throw new Error("同行与对标内容采集段缺失");
  if (!result.includes("对标账号“陈厂长”") || !result.includes("对标账号“王老师”")) {
    throw new Error("对标账号的抓取归属没有回传给用户");
  }
  if (!result.includes("互动数据未读取") && !result.includes("未发现可回溯")) {
    throw new Error("同行证据边界缺失");
  }
  console.log(result);
  console.log(`Multi-account source coverage: ${accounts.join("、")}`);
  console.log("Topic automatic public research verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
