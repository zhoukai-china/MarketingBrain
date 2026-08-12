import { runAgent } from "../packages/agent/src/index.js";

const input = [
  "请完整读取我上传的视频后台数据文件，生成专业复盘报告和下一轮选题方向。",
  "【本次用户上传/粘贴的附件】",
  "附件名：视频号动态数据明细.csv",
  "【业务文件解析结果】",
  "作品标题,播放量,完播率,平均播放时长,点赞,评论,分享,新增关注",
  "AI案例应该看实施过程还是结果,1280,22%,9.6秒,45,8,12,5",
  "老板做AI改造最容易踩的坑,860,31%,12.4秒,38,11,9,7",
  "企业AI流程如何验收,420,16%,6.8秒,12,2,1,0"
].join("\n");

async function main() {
let providerCalled = false;
const startedAt = Date.now();
const result = await runAgent({
  tenantId: "video-review-direct-smoke",
  userId: "video-review-direct-smoke-user",
  role: "owner",
  planCode: "local_standard",
  requestedSkillId: "baolu_review_engine",
  capabilityId: "video_review",
  input,
  tenantProfile: {
    tenantId: "video-review-direct-smoke",
    tenantName: "视频数据复盘测试",
    tenantType: "personal_ip",
    industry: "企业AI"
  },
  channel: "h5"
}, {
  name: "video-review-direct-smoke-provider",
  async complete() {
    providerCalled = true;
    throw new Error("direct table review must not call the model provider");
  }
});

const elapsedMs = Date.now() - startedAt;
const required = [
  "短视频复盘报告",
  "AI案例应该看实施过程还是结果",
  "1280",
  "22%",
  "老板做AI改造最容易踩的坑",
  "860",
  "31%",
  "企业AI流程如何验收",
  "420",
  "下周期选题建议",
  "证据边界"
];
const missing = required.filter((term) => !result.answer.includes(term));

if (providerCalled) throw new Error("视频表格复盘仍调用了慢模型");
if (elapsedMs > 3_000) throw new Error(`视频表格复盘耗时过长：${elapsedMs}ms`);
if (missing.length > 0) throw new Error(`视频表格复盘缺少：${missing.join("、")}`);
if (!result.qualityFlags.includes("video_table_review_direct")) {
  throw new Error(`未命中直出引擎：${result.qualityFlags.join(",")}`);
}

console.log(`VIDEO_REVIEW_DIRECT_SMOKE_OK ${elapsedMs}ms ${result.answer.length}chars`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
