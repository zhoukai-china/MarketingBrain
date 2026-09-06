import assert from "node:assert/strict";
import { splitContentDelivery } from "../apps/web/src/components/acquisition/contentDelivery.ts";

const standardStyleOutput = [
  "完整内容执行包",
  "## 一、选题策划：先确定本轮主线",
  "主选题：AI改造第一步，为什么不是买工具？",
  "用户钩子：老板最怕买完工具没有结果。",
  "## 二、可直接发布的文案（口播逐字稿，约60秒）",
  "【0-3秒】先别急着买工具。",
  "## 三、访谈话术",
  "【问】为什么先看流程？【答】只使用已确认事实，未确认部分待补。",
  "## 四、拍摄脚本",
  "镜头一：正面近景。",
  "## 五、拍摄注意事项",
  "先核实真实信息。",
  "## 六、剪辑EDL文件",
  "0-3秒字幕：先别急着买工具。七、发布标题话题 标题：老板别先买工具。",
  "## 八、最佳发布时间",
  "待按账号数据验证。",
  "## 九、评论区引导话术",
  "评论区写流程。",
  "## 十、投流建议",
  "先小预算测试。"
].join("\n");

const delivery = splitContentDelivery(standardStyleOutput);
assert.deepEqual(delivery.sections.map((section) => section.title), [
  "选题策划", "口播逐字稿", "访谈话术", "拍摄脚本", "拍摄注意事项", "剪辑EDL文件",
  "发布标题与话题标签", "最佳发布时间", "评论区引导话术", "投流建议"
]);
assert.ok(delivery.sections[0]?.lines.some((line) => line.includes("主选题")), "主选题必须留在选题策划正文中");
assert.equal(delivery.sections.filter((section) => section.title === "选题策划").length, 1, "选题策划不得重复切块");
assert.ok(delivery.sections[6]?.lines.some((line) => line.includes("老板别先买工具")), "行尾拼接的第七项必须被恢复为发布标题与话题标签");
console.log("CONTENT_SYSTEM_DISPLAY_SMOKE_OK sections=10 duplicate_topic_section=0");
