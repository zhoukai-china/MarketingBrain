// 公域获客 · 直播逐字稿服务契约冒烟（注入 fake Provider，不调用真实模型）
import {
  LIVE_BATCHES,
  LIVE_FILLER_CATEGORIES,
  generateLiveFiller,
  generateLiveSegments,
  type LiveInput
} from "../apps/api/src/products/beauty-industry/live-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const baseInput: LiveInput = {
  storeId: "store_1",
  host: "美肌研 · 创始人晓曼",
  carries: ["团购券", "居家产品"],
  main: "水光深层补水",
  sell: "做完当天就能上妆，不闷痘",
  price: "团购价参考 199",
  card: "储值 2000 送 300",
  platforms: ["抖音"]
};

/** 违反铁律：UI/提示词/日志里都不允许出现厂商名与模型名。 */
const FORBIDDEN_VENDOR_TOKENS = [
  "seedance",
  "Seedance",
  "豆包",
  "百炼",
  "deepseek",
  "DeepSeek",
  "可灵",
  "通义",
  "wan2.2",
  "minimax",
  "MiniMax"
];

type FakeProvider = {
  name: string;
  isConfigured: () => boolean;
  getModel: () => string;
  complete: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;
};

function fakeProvider(scripted: (call: number, prompt: string) => string, configured = true): {
  provider: FakeProvider;
  prompts: string[];
  calls: () => number;
} {
  const prompts: string[] = [];
  let call = 0;
  const provider: FakeProvider = {
    name: "fake",
    isConfigured: () => configured,
    getModel: () => "fake-model",
    complete: async (messages) => {
      call += 1;
      const prompt = messages.map((item) => item.content).join("\n");
      prompts.push(prompt);
      return scripted(call, prompt);
    }
  };
  return { provider, prompts, calls: () => call };
}

function segText(no: number): { script: string; fill: string[]; interact: string; rhythm: string } {
  return {
    script: `第 ${no} 段先跟刚进来的朋友打个招呼，今天讲的是补水这件事，手上事情先放一放。[停顿] 我们店的做法是先把皮肤状态看清楚，再决定做什么项目，顺序比花钱多少更重要。`,
    fill: [
      "这段还没讲完，我再补一句，很多客人一开始都以为花钱多才有效，其实先把顺序理顺更关键。",
      "刚进来的朋友可能没听到前面那一段，我再重复一遍，今天我们主要讲补水和后续怎么维持。",
      "不着急下单，你先把这一段听完，听完你就知道自己到底需不需要做这一步。"
    ],
    interact: "在评论区打个 1，让我看看有多少人想听这一段。",
    rhythm: "语速放慢，念完停两秒看评论，再往下走。"
  };
}

function batchPayload(batchNo: number): string {
  const batch = LIVE_BATCHES.find((item) => item.no === batchNo)!;
  return JSON.stringify({ segments: batch.segNos.map((no) => ({ no, ...segText(no) })) });
}

function fillerPayload(): string {
  return JSON.stringify({
    groups: LIVE_FILLER_CATEGORIES.map((cat) => ({
      cat: cat.split("（")[0],
      items: Array.from({ length: 6 }, (_, index) =>
        `${cat.split("（")[0]}第 ${index + 1} 句：刚进来的朋友稍等一下，我先把这一段讲完，马上回答你的问题，你可以先在评论区说一句。`
      )
    }))
  });
}

async function main() {
  // 1. 输入保护：批次必须存在、Provider 必须已配置
  const badBatch = await rejects(() => generateLiveSegments(baseInput, 999, fakeProvider(() => batchPayload(1)).provider));
  assert("批次不存在时拒绝", (badBatch ?? "").includes("批次不存在"));
  const unconfigured = await rejects(() =>
    generateLiveSegments(baseInput, 1, fakeProvider(() => batchPayload(1), false).provider)
  );
  assert("Provider 未配置时失败关闭", (unconfigured ?? "").includes("llm_provider_not_configured"));

  // 2. 正常路径：骨架来自规则，正文来自模型，字数由服务端重算
  const happy = fakeProvider(() => batchPayload(1));
  const ok = await generateLiveSegments(baseInput, 1, happy.provider);
  assert("正常路径一次成功", ok.attempts === 1);
  assert("返回本批 2 段", ok.segments.length === 2);
  assert("段落号与本批一致", ok.segments.map((seg) => seg.no).join(",") === "1,2");
  assert("时间段由规则给定", ok.segments[0].time === "0:00–0:04");
  assert("轮次由规则给定", ok.segments[0].round === 0);
  assert("备用话术最多 3 条", ok.segments[0].fill.length === 3);
  assert("字数由服务端重算", ok.segments[0].words > 0);
  assert("质检项已回传", ok.qualityChecks.includes("违规引导词") && ok.qualityChecks.includes("编造数字"));

  // 3. 模型用 ```json 围栏包裹也能解析
  const fenced = fakeProvider(() => "好的，以下是本批内容：\n```json\n" + batchPayload(1) + "\n```\n请查收。");
  const fencedOk = await generateLiveSegments(baseInput, 1, fenced.provider);
  assert("JSON 围栏可解析", fencedOk.segments.length === 2);

  // 4. 漏段 / 空口播稿 / 备用话术不足：回灌重写一次，第二次补齐则通过
  const missingFirst = fakeProvider((call) => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number }> };
    if (call === 1) return JSON.stringify({ segments: [payload.segments[0]] });
    return batchPayload(1);
  });
  const repaired = await generateLiveSegments(baseInput, 1, missingFirst.provider);
  assert("漏段时重试一次", repaired.attempts === 2 && missingFirst.calls() === 2);
  assert("重试时把问题回灌给模型", missingFirst.prompts[1].includes("必须修正的问题"));
  assert("重试时点名漏写段号", missingFirst.prompts[1].includes("第 2 段"));
  assert("首次提问不带修复说明", !missingFirst.prompts[0].includes("必须修正的问题"));

  const emptyScript = fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    payload.segments[1].script = "   ";
    return JSON.stringify(payload);
  });
  const emptyScriptErr = await rejects(() => generateLiveSegments(baseInput, 1, emptyScript.provider));
  assert("空口播稿两次都坏时失败关闭", (emptyScriptErr ?? "").includes("是空的"));

  const thinFill = fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; fill: string[] }> };
    payload.segments[0].fill = ["只给一条"];
    return JSON.stringify(payload);
  });
  const thinFillErr = await rejects(() => generateLiveSegments(baseInput, 1, thinFill.provider));
  assert("备用话术不足 3 条时失败关闭", (thinFillErr ?? "").includes("不足 3 条"));

  const notJson = fakeProvider(() => "好的，我建议你先这样做。");
  const notJsonErr = await rejects(() => generateLiveSegments(baseInput, 1, notJson.provider));
  assert("非法 JSON 也重试一次", notJson.calls() === 2);
  assert("非法 JSON 两次都坏时失败关闭", (notJsonErr ?? "").includes("不是合法 JSON"));

  // 5. 合规硬门禁：违规引导词被拦下，改动后放行
  const violating = fakeProvider((call) => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    if (call === 1) payload.segments[0].script += "想参加的加微信找我。";
    return JSON.stringify(payload);
  });
  const fixedAfterBan = await generateLiveSegments(baseInput, 1, violating.provider);
  assert("违规引导词回灌后重写通过", fixedAfterBan.attempts === 2);
  assert("重试提示点名违规引导词", violating.prompts[1].includes("违规引导词"));

  const alwaysBan = fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    payload.segments[0].script += "想参加的加微信找我。";
    return JSON.stringify(payload);
  });
  const alwaysBanErr = await rejects(() => generateLiveSegments(baseInput, 1, alwaysBan.provider));
  assert("两次都含违规引导词时失败关闭", (alwaysBanErr ?? "").includes("合规门禁"));

  const absErr = await rejects(() =>
    generateLiveSegments(baseInput, 1, fakeProvider(() => {
      const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
      payload.segments[0].script = "这个项目能根治你的皮肤问题。";
      return JSON.stringify(payload);
    }).provider)
  );
  assert("绝对化/疗效词被拦下", (absErr ?? "").includes("绝对化"));

  // 复盘回归：模型把流程写成「第一部分/第二部分」，曾被绝对化词表误拦（直播 422）
  const ordinal = fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    payload.segments[0].script =
      "今天分三部分讲。第一部分讲护理流程，第二部分讲价格，第三部分给大家答疑，第一场直播先讲清楚这些。";
    return JSON.stringify(payload);
  });
  const ordinalErr = await rejects(() => generateLiveSegments(baseInput, 1, ordinal.provider));
  assert("序数用法不触发绝对化门禁", ordinalErr === null);

  const promiseErr = await rejects(() =>
    generateLiveSegments(baseInput, 1, fakeProvider(() => {
      const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
      payload.segments[0].script = "我们保证你做完马上见效，不满意可以再来一次。";
      return JSON.stringify(payload);
    }).provider)
  );
  assert("效果承诺句式被拦下", (promiseErr ?? "").includes("效果承诺"));

  // 6. 价格口径：没给过的价格不许编
  const fabricatedPrice = fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    payload.segments[0].script += "参考价 398，拍下就能用。";
    return JSON.stringify(payload);
  });
  const fabricatedErr = await rejects(() =>
    generateLiveSegments({ ...baseInput, price: "", card: "" }, 1, fabricatedPrice.provider)
  );
  assert("未提供的价格被判编造", (fabricatedErr ?? "").includes("编造价格"));
  const allowedPrice = await generateLiveSegments(baseInput, 1, fakeProvider(() => {
    const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
    payload.segments[0].script += "参考价 199，拍下就能用。";
    return JSON.stringify(payload);
  }).provider);
  assert("已提供的价格可原样使用", allowedPrice.segments.length === 2);

  // 7. 念不动的长句被拦
  const longSentenceErr = await rejects(() =>
    generateLiveSegments(baseInput, 1, fakeProvider(() => {
      const payload = JSON.parse(batchPayload(1)) as { segments: Array<{ no: number; script: string }> };
      payload.segments[0].script = "今天我们要讲的是".repeat(12) + "。";
      return JSON.stringify(payload);
    }).provider)
  );
  assert("超过 90 字的长句被判念不动", (longSentenceErr ?? "").includes("念不动"));

  // 8. 救场话术库
  const filler = await generateLiveFiller(baseInput, fakeProvider(() => fillerPayload()).provider);
  assert("救场库 5 类", filler.groups.length === 5);
  assert("救场库每类 6 条", filler.groups.every((group) => group.items.length === 6));
  const fillerThin = await rejects(() =>
    generateLiveFiller(baseInput, fakeProvider(() => {
      const payload = JSON.parse(fillerPayload()) as { groups: Array<{ items: string[] }> };
      payload.groups[0].items = payload.groups[0].items.slice(0, 2);
      return JSON.stringify(payload);
    }).provider)
  );
  assert("救场库条数不足时失败关闭", (fillerThin ?? "").includes("不足 6 条"));
  const fillerMissing = await rejects(() =>
    generateLiveFiller(baseInput, fakeProvider(() => {
      const payload = JSON.parse(fillerPayload()) as { groups: Array<{ cat: string }> };
      return JSON.stringify({ groups: payload.groups.slice(0, 3) });
    }).provider)
  );
  assert("救场库缺类别时失败关闭", (fillerMissing ?? "").includes("缺少"));
  const fillerBan = await rejects(() =>
    generateLiveFiller(baseInput, fakeProvider(() => {
      const payload = JSON.parse(fillerPayload()) as { groups: Array<{ items: string[] }> };
      payload.groups[2].items[0] = "觉得贵的可以私信我，我给你便宜点。";
      return JSON.stringify(payload);
    }).provider)
  );
  assert("救场库违规引导词被拦下", (fillerBan ?? "").includes("违规引导词"));

  // 9. 铁律：提示词不得出现厂商名 / 模型名
  const probe = fakeProvider((_call, prompt) => (prompt.includes("救场话术库") ? fillerPayload() : batchPayload(1)));
  await generateLiveSegments(baseInput, 1, probe.provider);
  await generateLiveFiller(baseInput, probe.provider);
  const joined = probe.prompts.join("\n");
  const leaked = FORBIDDEN_VENDOR_TOKENS.filter((token) => joined.includes(token));
  assert(`提示词不含厂商/模型名（命中：${leaked.join("、") || "无"}）`, leaked.length === 0);
  assert("提示词要求只写主播单人动作", joined.includes("只写主播单人能做的动作"));
  assert("提示词要求价格带「参考」", joined.includes("参考"));
  assert("提示词带下单引导词", joined.includes("小黄车"));

  console.log(`\nlive-service: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
