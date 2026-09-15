// 兰琪「公域获客 · 美业文案十件套」（LQ-33）离线回归（确定性，不连网、不调真实模型、不花钱）。
//
// 覆盖：
//   ① 合同同源：提示词与结构校验都来自 `copy-ten-contract.ts`（与货架「文案智能体」共用同一份）；
//   ② 正常路径：十件套齐全 → ready；
//   ③ 失败路径：信息不足 / 模型回【需补充信息】/ 结构不合格 / 出现违禁词 → 一律不 ready（上层不扣积分）；
//   ④ 独立计费口径：默认 40 积分，env `LANQI_COPY_KIT_CREDITS` 可覆盖；
//   ⑤ 幂等与租户隔离：同键同输入可复用、跨租户读不到、坏键直接拒绝。
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LlmMessage, LlmProvider } from "@baolu/agent";

// 结果缓存要落盘：这里指到一个临时目录，绝不写仓库的 uploads/。
process.env.UPLOAD_DIR = mkdtempSync(path.join(os.tmpdir(), "lq-copy-kit-"));

async function main(): Promise<void> {
const contractModule = await import("../apps/api/src/products/beauty-industry/copy-ten-contract.js");
const copyKit = await import("../apps/api/src/products/lanqi/copy-kit-service.js");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const BRIEF =
  "主推 399 元水光深层补水体验课，想吸引同城 25-35 岁皮肤干燥暗沉的女生到店；顾客最怕被推销、怕办卡，我们全程不办卡，先做肤质检测再决定。";

/** 一份结构合格的十件套样例（只用于离线校验；不是给用户看的内容）。 */
const GOOD_TEN = `**一、选题策划**
- 内容类型：获客型
- 选题角度：讲清「做完深层清洁第二天反而更干」这件事
- 爆款元素：反常识开场 + 真实顾客提问
- 漏斗层级：同城曝光 → 到店体验

**二、口播逐字稿**
【0-3秒｜动作：手指轻按脸颊】
>B-roll：顾客躺床做肤质检测
很多人做完深层清洁，第二天反而觉得脸更干。
【3-15秒｜动作：打开检测灯】
这不是做坏了。
是清洁带走了角质层的水分，屏障还没缓过来。
【15-30秒｜动作：指向屏幕上的水分值】
所以我们先做一次肤质检测。
看清楚你现在的状态，再决定做什么项目。
【30-45秒｜动作：拿起补水精华】
缺水的先补水。
出油多的先稳住水油平衡。
【45-55秒｜动作：示意门店环境】
到店这一步不办卡。
体验完你觉得合适，再考虑下一步。
【55-60秒｜动作：看向镜头】
想看自己现在的水分值，就来店里做一次检测。
检测这一步不收费。
先看清自己的皮肤状态，再决定接下来做什么项目。

**三、访谈话术**
【问·情境式】我做完清洁第二天更干了，怎么回事？
【答】先做检测看屏障状态，再决定补水还是先修护。
【问·情感式】我怕一进门就被推销办卡。
【答】到店只做检测和体验，办不办卡你自己决定。
【问·转折式】别人家都说做完立刻变好，你们怎么还说要等？
【答】皮肤有恢复节奏，我们按你的状态排项目。
【问·引导式】那我现在适合做哪个项目？
【答】先测水分和油脂，再给你两套可选方案。
【问·回顾式】上次体验完我该注意什么？
【答】按检测结果调整作息和护肤步骤，两周后再复测。

**四、拍摄脚本**
固定场景：门店前台 + 检测区，自然光，主机位拍半身。
移动场景：从门口走向检测床，跟拍顾客入座。
B-roll 清单：检测仪屏幕、精华滴在手背、门店走廊。

**五、拍摄注意事项**
- 着装：浅色工作服，避免夸张配饰。
- 场景：台面清空，只留检测仪与两条毛巾。
- 收音：领夹麦，避开空调出风口。
- 灯光：面部补光，不要逆光。
- 状态：语速放慢，句子短，像跟顾客聊天。
- 禁忌：用描述性表达，避免医疗承诺与绝对化用语。

**六、剪辑EDL**
| 段落 | 画面 | 配乐 | 字幕特效 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 开场轻按脸颊 | 轻快钢琴 | 关键词描边 | 0-3 秒强钩子 |
| 2 | 检测灯特写 | 轻快钢琴 | 数据高亮 | 交代原因 |
| 3 | 检测仪屏幕 | 节奏加强 | 数值放大 | 给到店理由 |
| 4 | 门店环境收尾 | 柔和收尾 | 结束语 | BGM 渐弱，字幕规范统一字号 |

**七、发布标题与话题**
📌 主标题：做完清洁第二天更干？先看这张水分表
🔁 备选1：皮肤干不干，别猜，测一次就知道
🔁 备选2：不办卡也能做肤质检测，同城姐妹看过来
话题：大流量 #护肤日常 #同城探店；精准 #皮肤管理 #补水护理；行业 #美业门店

**八、最佳发布时间**
推荐：工作日 11:30-12:30、19:00-21:00。
备选：周末上午 10:00-11:00。
策略：先按推荐时段各发两条，比较同城曝光再固定。

**九、评论区引导**
置顶评论：想测水分值的姐妹扣「检测」，我按顺序回位置。
前 10 条回复风格：先回答问题，再补一句到店建议。
意向转化话术：你说个方便的时间，我把检测档期留给你。

**十、投流建议**
主渠道：本地推（获客型）。
前置指标：同城曝光与到店预约。
设置：同城 5 公里、25-35 岁女性。
日预算公式：到店成本目标 × 预约人数 ÷ 预估到店率。`;

function fakeProvider(reply: string, counter: { calls: number }): LlmProvider {
  return {
    name: "fake-lanqi-copy-kit",
    async complete(_messages: LlmMessage[]): Promise<string> {
      counter.calls += 1;
      return reply;
    }
  } as LlmProvider;
}

// ① 合同同源
check("共享合同导出 10 个章节", contractModule.COPY_TEN_SECTIONS.length === 10, JSON.stringify(contractModule.COPY_TEN_SECTIONS));
check(
  "兰琪章节常量与共享合同逐条一致",
  JSON.stringify(copyKit.LANQI_COPY_KIT_SECTIONS) === JSON.stringify(contractModule.COPY_TEN_SECTIONS)
);
const systemMessage = copyKit.buildLanqiCopyKitMessages({ request: { brief: BRIEF, storeName: "西湖体验店" } })[0];
check("system 提示词就是共享合同（没有第二份副本）", systemMessage.content === contractModule.COPY_TEN_SYSTEM_PROMPT);
const userMessage = copyKit.buildLanqiCopyKitMessages({ request: { brief: BRIEF, platform: "xhs", goal: "franchise", storeName: "西湖体验店" } })[1];
check("user 壳带上门店名", userMessage.content.includes("西湖体验店"));
check("user 壳带上平台口径", userMessage.content.includes("小红书（种草）"));
check("user 壳带上目标口径", userMessage.content.includes("招商 / 加盟"));
check("user 壳原样带上老板原话", userMessage.content.includes(BRIEF));
check("user 壳要求缺的信息写「待补充」", userMessage.content.includes("待补充"));

// ② 正常路径
{
  const counter = { calls: 0 };
  const generation = await copyKit.generateLanqiCopyKit({
    request: { brief: BRIEF, storeName: "西湖体验店" },
    provider: fakeProvider(GOOD_TEN, counter)
  });
  check("正常路径：十件套齐全 → ready", generation.result.status === "ready", JSON.stringify(generation.result).slice(0, 200));
  check("正常路径：只调一次模型", counter.calls === 1, `calls=${counter.calls}`);
  check(
    "正常路径：正文原样交付",
    generation.result.status === "ready" && generation.result.content === GOOD_TEN.trim()
  );
  check("正常路径：合同版本为 copy_ten_v5", generation.contractVersion === "copy_ten_v5", generation.contractVersion);
}

// ③ 失败路径一：信息不足（连模型都不调）
{
  const counter = { calls: 0 };
  const generation = await copyKit.generateLanqiCopyKit({
    request: { brief: "111" },
    provider: fakeProvider(GOOD_TEN, counter)
  });
  check("信息不足：直接 needs_input", generation.result.status === "needs_input", JSON.stringify(generation.result));
  check("信息不足：不调用模型（不花钱）", counter.calls === 0, `calls=${counter.calls}`);
}

// ③ 失败路径二：模型回【需补充信息】
{
  const reply = "【需补充信息】\n- 需要补充：主推哪个项目 / 套餐\n- 需要补充：想吸引哪一类人群";
  const generation = await copyKit.generateLanqiCopyKit({
    request: { brief: BRIEF },
    provider: fakeProvider(reply, { calls: 0 })
  });
  check("模型说信息不够：转为 needs_input", generation.result.status === "needs_input", JSON.stringify(generation.result));
  check(
    "模型说信息不够：不清洗掉具体缺什么",
    generation.result.status === "needs_input" && generation.result.message.includes("想吸引哪一类人群")
  );
}

// ③ 失败路径三：结构不合格 / 违禁词
{
  const broken = GOOD_TEN.replace("**四、拍摄脚本**", "**镜头脚本**").replace("很多人做完深层清洁，第二天反而觉得脸更干。", "想变美的姐妹加微信找我，我帮你安排。");
  const generation = await copyKit.generateLanqiCopyKit({
    request: { brief: BRIEF },
    provider: fakeProvider(broken, { calls: 0 })
  });
  check("结构不合格：必须是 invalid（上层不扣积分）", generation.result.status === "invalid", JSON.stringify(generation.result).slice(0, 200));
  const failures = generation.result.status === "invalid" ? generation.result.failures.join("\n") : "";
  check("结构不合格：点名缺章节", failures.includes("缺少「四、」章节"), failures);
  check("结构不合格：点名违规引导词", failures.includes("违规引导词"), failures);
  check(
    "结构与货架同源：兰琪校验结果 == 共享合同校验结果",
    generation.result.status === "invalid" &&
      JSON.stringify(generation.result.failures) === JSON.stringify(contractModule.parseCopyTenContract(broken).failures)
  );
}

// ④ 独立计费口径
{
  const original = process.env.LANQI_COPY_KIT_CREDITS;
  delete process.env.LANQI_COPY_KIT_CREDITS;
  check("计费：默认 40 积分（与货架「文案智能体」同档）", copyKit.lanqiCopyKitPriceCredits() === 40, String(copyKit.lanqiCopyKitPriceCredits()));
  process.env.LANQI_COPY_KIT_CREDITS = "88";
  check("计费：env 可覆盖（老板拍板不用发版）", copyKit.lanqiCopyKitPriceCredits() === 88, String(copyKit.lanqiCopyKitPriceCredits()));
  if (original === undefined) delete process.env.LANQI_COPY_KIT_CREDITS;
  else process.env.LANQI_COPY_KIT_CREDITS = original;
}

// ⑤ 幂等与租户隔离
{
  const requestKey = "smoke-key-000000000001";
  const hashA = copyKit.lanqiCopyKitInputHash({ brief: BRIEF, platform: "all", goal: "visit", storeName: "西湖体验店" });
  const hashB = copyKit.lanqiCopyKitInputHash({ brief: BRIEF, platform: "xhs", goal: "visit", storeName: "西湖体验店" });
  const hashC = copyKit.lanqiCopyKitInputHash({ brief: BRIEF, platform: "all", goal: "visit", storeName: "西湖体验店" });
  check("输入指纹：同输入稳定", hashA === hashC);
  check("输入指纹：换平台即换指纹（同键不同输入要冲突）", hashA !== hashB);

  await copyKit.writeLanqiCopyKitCache({
    tenantId: "tenant-A",
    requestKey,
    entry: {
      inputHash: hashA,
      content: GOOD_TEN,
      contractVersion: "copy_ten_v5",
      promptHash: "deadbeefdeadbeef",
      creditCost: 40,
      createdAt: new Date().toISOString()
    }
  });
  const sameTenant = await copyKit.readLanqiCopyKitCache({ tenantId: "tenant-A", requestKey });
  const otherTenant = await copyKit.readLanqiCopyKitCache({ tenantId: "tenant-B", requestKey });
  check("幂等：同租户同键读回同一份结果", sameTenant?.content === GOOD_TEN);
  check("租户隔离：别的租户读不到这份结果", otherTenant === undefined, JSON.stringify(otherTenant)?.slice(0, 80));
  const keys = await copyKit.listLanqiCopyKitKeys({ tenantId: "tenant-A" });
  const otherKeys = await copyKit.listLanqiCopyKitKeys({ tenantId: "tenant-B" });
  check("租户隔离：键列表只列本租户", keys.includes(requestKey) && otherKeys.length === 0, JSON.stringify({ keys, otherKeys }));
  let rejected = false;
  try {
    await copyKit.readLanqiCopyKitCache({ tenantId: "tenant-A", requestKey: "../escape" });
  } catch {
    rejected = true;
  }
  // 路径穿越键在读取侧被吞掉（返回 undefined），但写入侧必须显式拒绝。
  let writeRejected = false;
  try {
    await copyKit.writeLanqiCopyKitCache({ tenantId: "tenant-A", requestKey: "../escape", entry: { inputHash: hashA, content: "x", contractVersion: "v", promptHash: "p", creditCost: 1, createdAt: "" } });
  } catch {
    writeRejected = true;
  }
  check("非法请求键：写入侧显式拒绝（不能写出租户目录）", writeRejected, `readRejected=${rejected}`);
}

console.log(`\nlanqi_copy_kit_smoke: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed / ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
