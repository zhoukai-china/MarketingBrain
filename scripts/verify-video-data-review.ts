import { readFile } from "node:fs/promises";
import { runAgent } from "../packages/agent/src/index.js";

async function main() {
const sourcePath = "C:/Users/book/WorkBuddy/2026-07-29-09-15-36/视频号动态数据明细.csv";
const csv = await readFile(sourcePath, "utf8");

const baseRequest = {
  tenantId: "video-review-regression",
  userId: "video-review-regression-user",
  role: "owner" as const,
  planCode: "local_standard" as const,
  requestedSkillId: "baolu_review_engine" as const,
  capabilityId: "video_review",
  input: [
    "请完整读取我上传的视频后台数据文件，做数据复盘并给下一轮选题测试方向。",
    "【本次用户上传/粘贴的附件】",
    "附件名：视频号动态数据明细.csv",
    "【业务文件解析结果】",
    csv
  ].join("\n"),
  tenantProfile: {
    tenantId: "video-review-regression",
    tenantName: "跨行业测试企业",
    tenantType: "personal_ip" as const,
    industry: "餐饮招商"
  },
  channel: "h5" as const
};

const result = await runAgent(baseRequest, {
  name: "video-data-review-regression",
  async complete() {
    throw new Error("force_deterministic_video_data_review");
  }
});

const required = [
  "有效记录：50 条",
  "总播放 9461",
  "平均播放 189.22",
  "播放中位数 175.5",
  "平均完播率 3.23%",
  "平均播放时长 9.37秒",
  "点赞 164",
  "评论 0",
  "分享 115",
  "新增关注 3",
  "高播放高互动 9 条",
  "高播放低互动 16 条",
  "低播放高互动 15 条",
  "低播放低互动 10 条",
  "AI时代的工作方式",
  "6元奶茶逆袭",
  "内容结构健康度",
  "单条深拆",
  "完播率深层归因",
  "互动深度分析",
  "趋势分析",
  "规律总结",
  "方法论沉淀",
  "下周期选题建议",
  "综合诊断结论",
  "证据边界"
];
const missing = required.filter((term) => !result.answer.includes(term));
if (missing.length > 0) {
  throw new Error(`视频数据复盘回归缺少：${missing.join("、")}\n${result.answer}`);
}

const forbidden = [
  /已看到|我看到|画面里|口播说|镜头中/,
  /评论功能(?:已|确认|确定).{0,4}(?:关闭|没开)/,
  /(?:确认|判断|说明|属于).{0,8}(?:限流|违规)/,
  /你的餐饮招商|餐饮招商账号/,
  /完整内容执行包|内容九件套|拍摄脚本|剪辑EDL/
];
const violations = forbidden.filter((pattern) => pattern.test(result.answer));
if (violations.length > 0) {
  throw new Error(`视频数据复盘包含越界内容：${violations.map(String).join("、")}\n${result.answer}`);
}

const sparse = await runAgent({
  ...baseRequest,
  input: [
    "请分析这个小样本文件。",
    "附件名：小样本.csv",
    "标题,播放量,点赞,分享",
    "样本A,100,5,2",
    "样本B,50,1,0"
  ].join("\n")
}, {
  name: "video-data-review-sparse-regression",
  async complete() { throw new Error("force_sparse_fallback"); }
});
if (!sparse.answer.includes("样本少于 8 条") || !sparse.answer.includes("无业务转化字段")) {
  throw new Error(`小样本边界失败：${sparse.answer}`);
}

const invalid = await runAgent({
  ...baseRequest,
  input: "请复盘我上传的数据。附件名：空文件.csv"
}, {
  name: "video-data-review-invalid-regression",
  async complete() { throw new Error("force_invalid_fallback"); }
});
if (!invalid.answer.includes("有效记录 0 条") || !invalid.answer.includes("不推测")) {
  throw new Error(`空文件兜底失败：${invalid.answer}`);
}

console.log(result.answer);
console.log("\nVIDEO_DATA_REVIEW_REGRESSION_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
