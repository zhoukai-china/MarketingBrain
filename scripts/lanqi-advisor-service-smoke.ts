// 公域获客 · AI 运营顾问服务契约冒烟（确定性分支，不调用真实 Provider）
import {
  ADVISOR_MAX_ATTEMPTS,
  ADVISOR_SERVICE_VERSION,
  answerAdvisorQuestion,
  normalizeAdvisorAnswer,
  resolveAdvisorPlatform,
  runAdvisorAnswer
} from "../apps/api/src/products/beauty-industry/advisor-service.js";
import { detectTopics } from "../apps/api/src/products/beauty-industry/advisor-rules.js";

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

function throws(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
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

const goodPayload = {
  summary: "你这家店最该先修承接页，不是先加预算。",
  steps: [
    { title: "先停掉转化差的计划", detail: "把最近七天点击高但没有到店核销的计划全部暂停，避免继续消耗预算。" },
    { title: "前三秒补城市和项目", detail: "开场第一句话里写清楚城市和主推项目，只投有自然互动基础的素材。" },
    { title: "投流页换成体验团购", detail: "把挂载商品换成低价体验团购，价格锚点要明显低于正价项目。" },
    { title: "留资后五分钟跟进", detail: "安排一个人专门盯留资提醒，五分钟内完成第一次接待话术沟通。" }
  ],
  followUps: ["预算一天给多少合适？", "体验团购定价怎么定？"],
  sources: ["本地推投放要点", "抖音起号要点"],
  needInfo: []
};

async function main() {
  assert("服务版本已声明", ADVISOR_SERVICE_VERSION === "advisor_service_v2");

  // 1. 门店隔离：必须带 store_id
  const noStore = await rejects(() => answerAdvisorQuestion({ storeId: "  ", question: "视频号发了没人转，问题在哪？" }));
  assert("缺 store_id 拒绝", (noStore ?? "").includes("缺少门店标识"));

  // 2. 输入门禁
  const empty = await rejects(() => answerAdvisorQuestion({ storeId: "store_1", question: "" }));
  assert("空问题拒绝", (empty ?? "").includes("请先描述"));
  const tooShort = await rejects(() => answerAdvisorQuestion({ storeId: "store_1", question: "怎么办" }));
  assert("过短问题拒绝", (tooShort ?? "").includes("具体一点"));

  // 3. 平台识别不出来：先反问确认，不产动作清单、不调 Provider
  const askBack = await answerAdvisorQuestion({ storeId: "store_1", question: "新门店预算少，该从哪个平台开始？" });
  assert("识别不出平台时 needPlatform 为真", askBack.needPlatform === true);
  assert("识别不出平台时不产动作清单", askBack.answer === undefined);
  assert("反问话术已给出", Boolean(askBack.askBack && /抖音/.test(askBack.askBack)));
  assert("识别不出平台时不带平台标识", askBack.platform === null && askBack.platformLabel === "");

  // 4. 平台判定：显式指定 > 本轮问句 > 上文（上一轮确认后继续追问的场景不该再反问）
  assert("显式指定平台时不再反问", resolveAdvisorPlatform("新门店预算少，该从哪个平台开始？", "dy", []) === "dy");
  assert("本轮问句能识别时就用本轮", resolveAdvisorPlatform("视频号发了没人转", "auto", []) === "sph");
  assert("本轮识别不出时回看上文", resolveAdvisorPlatform("那具体先做哪一步？", "auto", [{ role: "user", content: "抖音本地推没转化" }]) === "dy");
  assert("都没有时返回 null 走反问", resolveAdvisorPlatform("那具体先做哪一步？", "auto", []) === null);

  // 5. 结构门禁：动作不足 3 条 / 结论缺失 / 细节过短 都要被拦
  const topics = detectTopics("抖音投了本地推没转化，怎么调？");
  assert("识别到投放话题", topics.length > 0);

  const tooFew = throws(() => normalizeAdvisorAnswer({ ...goodPayload, steps: goodPayload.steps.slice(0, 2) }, topics));
  assert("少于 3 条动作被拦下", (tooFew ?? "").includes("结构不完整"));
  const noSummary = throws(() => normalizeAdvisorAnswer({ ...goodPayload, summary: "" }, topics));
  assert("缺结论被拦下", (noSummary ?? "").includes("缺少结论"));
  const thinDetail = throws(() =>
    normalizeAdvisorAnswer({ ...goodPayload, steps: [{ title: "停投", detail: "太短" }, ...goodPayload.steps.slice(1)] }, topics)
  );
  assert("动作细节过短被拦下", (thinDetail ?? "").includes("结构不完整"));

  // 6. 合规硬拦截：违规引导词 / 绝对化词 / 外平台都不能进最终回答
  const banned = throws(() =>
    normalizeAdvisorAnswer(
      { ...goodPayload, steps: [{ title: "加微信", detail: "让客户加微信以后继续在私域里沟通转化。" }, ...goodPayload.steps.slice(1)] },
      topics
    )
  );
  assert("违规引导词被拦下", (banned ?? "").includes("违规引导词"));
  const abs = throws(() =>
    normalizeAdvisorAnswer(
      { ...goodPayload, summary: "按这套做保证七天见效。", steps: goodPayload.steps },
      topics
    )
  );
  assert("绝对化/疗效词被拦下", (abs ?? "").includes("绝对化"));
  const foreign = throws(() =>
    normalizeAdvisorAnswer(
      { ...goodPayload, summary: "建议同步把内容发到小红书。", steps: goodPayload.steps },
      topics
    )
  );
  assert("外平台被拦下", (foreign ?? "").includes("不支持的平台"));

  // 复盘回归（0909 顾问整段被门禁拦下）：模型讲「不要引导私下联系」时会复述被拦词，
  // 描述在平台内回复顾客消息时也会出现「私信」，这两种都不是导流违规。
  const metaMention = throws(() =>
    normalizeAdvisorAnswer(
      {
        ...goodPayload,
        steps: [
          {
            title: "视频结尾只引导到店",
            detail: "每条视频最后一句统一说点左下角定位到店，不引导私信或评论留联系方式，不引导加微信。"
          },
          {
            title: "每天回复评论和私信一次",
            detail: "固定一人每天花十五分钟回复评论和私信，只回复营业时间、项目价格、门店位置。"
          },
          ...goodPayload.steps.slice(1)
        ]
      },
      topics
    )
  );
  assert("劝阻语境复述不触发合规门禁", metaMention === null);

  // 7. 正常路径：结构与来源标签都收敛到可展示形态
  const ok = normalizeAdvisorAnswer(goodPayload, topics);
  assert("正常回答通过门禁", ok.steps.length === 4);
  assert("追问最多 3 条", ok.followUps.length <= 3);
  assert("来源最多 3 条且带话题补齐", ok.sources.length === 3);
  assert("来源含模型给的标签", ok.sources.includes("本地推投放要点"));
  assert("needInfo 默认空数组", Array.isArray(ok.needInfo));

  const withNeed = normalizeAdvisorAnswer({ ...goodPayload, needInfo: ["门店所在城市", "主推项目", "客单价"] }, topics);
  assert("needInfo 最多 3 条", withNeed.needInfo.length === 3);

  // 8. 合规修复重写：第一次被拦，带原因回灌后第二次通过
  assert("重写上限为 3 次", ADVISOR_MAX_ATTEMPTS === 3);

  const violating = JSON.stringify({
    ...goodPayload,
    summary: "先让顾客加微信再慢慢转化。"
  });
  const seenPrompts: string[] = [];
  let callCount = 0;
  const repaired = await runAdvisorAnswer("抖音投了本地推没转化，怎么调？", "dy", topics, [], {
    complete: async (messages) => {
      callCount += 1;
      const userTurn = messages[messages.length - 1];
      seenPrompts.push(typeof userTurn.content === "string" ? userTurn.content : "");
      return callCount === 1 ? violating : JSON.stringify(goodPayload);
    }
  });
  assert("被拦后重试一次即产出可用答案", callCount === 2 && repaired.steps.length === 4);
  assert("首次提问不带修复说明", !seenPrompts[0].includes("被系统的合规与结构门禁拦截"));
  assert("重试时回灌了拦截原因", seenPrompts[1].includes("违规引导词"));
  assert("重试时要求不要复述被拦词", seenPrompts[1].includes("不要复述这些被拦截的词"));

  // 9. 两次都不合规：失败关闭，不把违规内容兜给门店
  const alwaysBad = await rejects(() =>
    runAdvisorAnswer("抖音投了本地推没转化，怎么调？", "dy", topics, [], {
      complete: async () => violating
    })
  );
  assert("始终不合规时失败关闭", (alwaysBad ?? "").includes("未通过合规与结构门禁"));

  // 9b. 复盘回归（0911 顾问 422）：连续两次被拦、第三次纠正后仍要给出答案，不让门店看到「没答出来」
  let flakyCalls = 0;
  const flaky = await runAdvisorAnswer("抖音投了本地推没转化，怎么调？", "dy", topics, [], {
    complete: async () => {
      flakyCalls += 1;
      return flakyCalls < 3 ? violating : JSON.stringify(goodPayload);
    }
  });
  assert("软违规重写两次后仍产出可用答案", flakyCalls === 3 && flaky.steps.length === 4);

  // 10. 结构不合法（不是 JSON）：同样走重试，重试仍坏则失败关闭
  const badJsonCalls: number[] = [];
  const badJson = await rejects(() =>
    runAdvisorAnswer("视频号发了没人转，问题在哪？", "sph", topics, [], {
      complete: async () => {
        badJsonCalls.push(1);
        return "好的，我建议你先这样做。";
      }
    })
  );
  assert("非法 JSON 重写到上限", badJsonCalls.length === 3);
  assert("非法 JSON 始终坏时失败关闭", (badJson ?? "").includes("未通过合规与结构门禁"));

  console.log(`\nadvisor-service: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
