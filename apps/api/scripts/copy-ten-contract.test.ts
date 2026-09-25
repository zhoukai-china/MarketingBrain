// 文案十件套 · 后置校验回归测试（mock 驱动，只测程序逻辑）
// 运行：cd apps/api && npm test   （即 tsx scripts/copy-ten-contract.test.ts）
//
// 设计原则：输入全部为手写 mock 文本，不依赖真实大模型输出——本测试验证的是
// 校验器（parseCopyTenContract）的程序行为，而非模型生成质量。
//
// 背景：规则9（违禁词子串扫描 /唯一|保证|100%|.../）会误杀正常表达
// （如「保证画面通透」），且 prompt 红线已指引，故于 2026-09-25 从
// copy-ten-contract.ts 移除整个分支。本测试验证移除效果：
//   ① 含正常「保证」用法的十件套，不再被「绝对化用语」误杀；
//   ② 引导类 / 绝对化 / 承诺类三类均不再被程序兜底拦截（副作用确认）。

import assert from "node:assert";
import { parseCopyTenContract } from "../src/products/beauty-industry/copy-ten-contract";

// ---- mock 1：结构齐全的十件套，口播含正常「保证」用法（非营销绝对化承诺）----
const MOCK_OK = `# 内容十件套

一、选题策划
内容类型：获客型

二、口播逐字稿
【动作】主播微笑面对镜头】保证画面通透干净，让观众一眼看清产品细节。今天给大家推荐这款好物，性价比超高，闭眼入不踩雷。我们门店老客回购率很高，口碑一直在线。欢迎到店体验，专业顾问一对一服务。活动限时三天，错过等一年。库存不多手慢无，点下方链接直接拍。真实反馈很多，用过都说好。保证信息干净透明，没有任何套路。咱们主打一个真诚，不玩虚的。老粉都知道我们品质稳。新朋友先领券再下单更划算。日常保养要坚持，效果才看得出来。选对方法比盲目跟风重要。

三、访谈话术
【问·情境式】您平时怎么护肤？
【答】根据肤质选产品，别盲目跟风。

四、拍摄脚本
固定场景加移动镜头，B-roll 清单见下。

五、拍摄注意事项
着装整洁，灯光柔和，收音清晰，状态在线。

六、剪辑EDL
| 段落 | 画面 | 配乐 |
| --- | --- | --- |
| 1 | 开场 | BGM1 |
| 2 | 产品特写 | BGM2 |
| 3 | 口播 | BGM1 |
| 4 | 结尾 | BGM2 |

七、发布标题与话题
📌 主标题：夏日必备好物
🔁 备选1：闭眼入不踩雷
🔁 备选2：门店口碑之选
大流量话题：#好物推荐
精准话题：#护肤推荐
行业话题：#美业好物

八、最佳发布时间
晚八点发布，备选午间。

九、评论区引导
置顶评论引导互动，意向转化话术温和。

十、投流建议
获客型主投本地推，日预算公式按转化测算。`;

// ---- mock 2：故意违规样本（引导类 / 绝对化 / 承诺类三类都踩）----
const MOCK_BANNED = `一、选题策划
加微信领优惠，保证 100% 根治，包回本稳赚躺赚。`;

// ① 含正常「保证」用法的十件套，不应被「绝对化用语」误杀
const ok = parseCopyTenContract(MOCK_OK);
const okAbsolute = ok.failures.filter((f) => f.includes("绝对化"));
console.log("[mock 1 · 含正常'保证'用法的十件套]");
console.log("  全部失败项:", ok.failures.length ? ok.failures : "（无）");
if (okAbsolute.length) {
  console.log("  ❌ 被绝对化误杀:", okAbsolute);
} else {
  console.log("  ✅ 已不再被绝对化误杀");
}
assert.strictEqual(
  okAbsolute.length,
  0,
  "规则9移除后，正常'保证'用法不应被判绝对化:\n" + okAbsolute.join("\n")
);

// ② 三类违禁词兜底均已移除（副作用确认）
const banned = parseCopyTenContract(MOCK_BANNED);
const stillBanned = banned.failures.filter((f) =>
  /违规引导词|绝对化用语|承诺类表述/.test(f)
);
console.log(
  "\n[mock 2 · 故意违规样本(加微信/保证100%/根治/包回本)]失败项:",
  stillBanned.length ? stillBanned : "（无）"
);
assert.strictEqual(
  stillBanned.length,
  0,
  "规则9整体应已移除，三类违禁词不再被程序拦截"
);
console.log("  ✅ 规则9整体已移除（引导/绝对化/承诺类均不再拦截）");

console.log("\n==== 全部断言通过 ✅ ====");
