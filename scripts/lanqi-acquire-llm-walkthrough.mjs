#!/usr/bin/env node
/**
 * 兰琪美业「公域获客」文本类子能力的真实大模型端到端走查脚本。
 *
 * 覆盖：短视频文案改稿 / AI 运营顾问 / 直播话术（计划 + 分批稿）/ 文案转片（分镜）。
 * 走真实 HTTP（免登录 dev-login 取会话），验证真实 Provider 输出、结构门禁与模型中立。
 *
 * 用法：
 *   node scripts/lanqi-acquire-llm-walkthrough.mjs
 *   （--api 覆盖 API 根地址；--out 覆盖报告输出目录）
 *
 * 仅用于本地 / 内测环境验收，不进入生产运行路径。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const apiBase = argValue("--api", "http://localhost:3011").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(os.tmpdir(), "lanqi-acquire-llm-walkthrough"));

/** UI / 日志 / 报错里严禁出现的厂商与模型名（模型中立铁律）。 */
const FORBIDDEN_TOKENS = [
  "seedance",
  "doubao",
  "豆包",
  "百炼",
  "dashscope",
  "deepseek",
  "可灵",
  "kling",
  "通义",
  "qwen",
  "wan2.",
  "wanx",
  "minimax",
  "hailuo",
  "gpt-",
  "claude",
  "gemini",
];

/** 「参考方法标签」不得被写成平台官方出处（我们没有接入平台官方资料库）。 */
const OFFICIAL_SOURCE_CLAIM = /官方|公告|通知|白皮书|算法文档|规则文档|内部资料|内部文件|红头|政策原文|平台文件/;

const results = [];
const samples = {};
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function findForbidden(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const lower = text.toLowerCase();
  return FORBIDDEN_TOKENS.filter((token) => lower.includes(token));
}

async function post(pathname, body, token) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应保留原文 */
  }
  return { status: response.status, ok: response.ok, json, text, result: json?.result ?? json };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // 1. 免登录会话（与内测实例 VITE_DIRECT_TEST_LOGIN 同一条链路）
  const login = await post("/auth/dev-login", {
    productCode: "beauty-industry",
    tenantRole: "local_business",
    tenantName: "兰琪美业 LLM 走查",
    industry: "美业",
  });
  const token = login.json?.token;
  record("dev-login 取得会话", Boolean(token), `HTTP ${login.status}`);
  if (!token) {
    await dump();
    process.exit(1);
  }

  // 2. 门店列表（所有接口都要求 store_id）
  const storesRes = await fetch(`${apiBase}/beauty-industry/stores`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const storesJson = await storesRes.json().catch(() => ({}));
  const storeId = storesJson?.stores?.[0]?.id;
  record("门店列表返回 store_id", Boolean(storeId), `HTTP ${storesRes.status} · ${storesJson?.stores?.length ?? 0} 店`);
  if (!storeId) {
    await dump();
    process.exit(1);
  }

  // 3. 短视频文案改稿（真实大模型）
  const copy = await post(
    "/beauty-industry/acquire/copywriter",
    {
      storeId,
      raw: "大家好，我们是兰琪美业。最近好多姐妹问，为什么做完护理当天感觉很水润，过两天又干回去了。其实不是产品不行，是你没做居家维护。我们店现在有个皮肤管理体验，做完会给你一份三天居家方案。",
      purpose: "deal",
      goal: "conversion",
      extra: "说人话，别太官方",
    },
    token
  );
  const copyBody = copy.result ?? {};
  const copyText = JSON.stringify(copyBody);
  record(
    "文案改稿返回真实成稿",
    copy.ok && typeof copyBody?.finalDraft === "string" && copyBody.finalDraft.length > 60,
    `HTTP ${copy.status} · finalDraft ${copyBody?.finalDraft?.length ?? 0} 字 · ${copyBody?.traceId ?? "无 traceId"}`
  );
  record(
    "文案改稿输出结构完整（多个开头 + 正文 + 标题 + 封面 + 检查项）",
    Array.isArray(copyBody?.openings) && copyBody.openings.length >= 2
      && typeof copyBody?.body === "string" && copyBody.body.length > 40
      && Array.isArray(copyBody?.titles) && copyBody.titles.length >= 1
      && Boolean(copyBody?.cover?.title)
      && Array.isArray(copyBody?.checks) && copyBody.checks.length >= 3,
    `openings=${copyBody?.openings?.length ?? 0} titles=${copyBody?.titles?.length ?? 0} checks=${copyBody?.checks?.length ?? 0}`
  );
  const copyForbidden = findForbidden(copyText);
  record("文案改稿输出现出模型/厂商名", copyForbidden.length === 0, copyForbidden.join(",") || "无");
  samples.copywriter = {
    intent: copyBody?.intent,
    opening: copyBody?.openings?.[0]?.text,
    body: copyBody?.body,
    titles: (copyBody?.titles ?? []).map((t) => t?.text ?? t),
    checks: copyBody?.checks,
  };

  // 4. AI 运营顾问
  const advisor = await post(
    "/beauty-industry/acquire/advisor",
    {
      storeId,
      question: "我在抖音发了十几条视频都没什么人看，也没人来店里，第一周应该先做什么？",
      platform: "dy",
    },
    token
  );
  const advisorBody = advisor.result ?? {};
  record(
    "AI 运营顾问返回动作清单",
    advisor.ok && JSON.stringify(advisorBody).length > 120,
    `HTTP ${advisor.status} · keys=${Object.keys(advisorBody).slice(0, 12).join(",")}`
  );
  const advisorForbidden = findForbidden(advisorBody);
  record("顾问输出现模型/厂商名", advisorForbidden.length === 0, advisorForbidden.join(",") || "无");
  const advisorAnswer = advisorBody.answer ?? {};
  const advisorSources = Array.isArray(advisorAnswer.sources) ? advisorAnswer.sources : [];
  const officialSourceHits = advisorSources.filter((label) => OFFICIAL_SOURCE_CLAIM.test(String(label)));
  record(
    "顾问参考方法标签为 2~3 条且不含官方/公告/内部资料口径",
    advisorBody.needPlatform !== true && advisorSources.length >= 2 && advisorSources.length <= 3 && officialSourceHits.length === 0,
    `count=${advisorSources.length} · ${advisorSources.join(" / ")} · official=${officialSourceHits.join(",") || "无"}`
  );
  samples.advisor = { summary: advisorAnswer.summary, sources: advisorSources };

  // 5. 直播话术：计划 + 分批 + 垫场
  const liveInput = {
    storeId,
    host: "小雅",
    carries: ["团购券", "会员卡"],
    main: "补水护理体验",
    sell: "深层补水+舒缓，做完当天就能上妆，适合熬夜脸、换季干皮。",
    price: "体验价 99 元，原价 398 元，限今天直播间。",
    card: "办卡送 2 次面部护理",
    platforms: ["抖音"],
  };
  const livePlan = await post("/beauty-industry/acquire/live/plan", liveInput, token);
  const livePlanBody = livePlan.result ?? {};
  record(
    "直播话术计划返回批次结构",
    livePlan.ok && JSON.stringify(livePlanBody).length > 80,
    `HTTP ${livePlan.status} · keys=${Object.keys(livePlanBody).slice(0, 12).join(",")}`
  );

  const liveSegments = await post("/beauty-industry/acquire/live/segments", { ...liveInput, batchNo: 1 }, token);
  const liveSegBody = liveSegments.result ?? {};
  const liveSegText = JSON.stringify(liveSegBody);
  record(
    "直播话术第 1 批返回逐字稿",
    liveSegments.ok && liveSegText.length > 200,
    `HTTP ${liveSegments.status}`
  );
  const liveForbidden = findForbidden(liveSegText);
  record("直播话术输出现模型/厂商名", liveForbidden.length === 0, liveForbidden.join(",") || "无");
  samples.live = liveSegBody;

  const liveFiller = await post("/beauty-industry/acquire/live/filler", { ...liveInput, batchNo: 1 }, token);
  record(
    "直播话术垫场返回内容",
    liveFiller.ok && JSON.stringify(liveFiller.result ?? {}).length > 40,
    `HTTP ${liveFiller.status}`
  );

  // 6. 文案转片：分镜
  const storyboard = await post(
    "/beauty-industry/acquire/video/storyboard",
    {
      storeId,
      script:
        "很多人做完护理，第二天又干。问题不在产品，在你回家以后什么都没做。我们店做完护理，会给你一份按天写的居家方案。先把脸养稳，再谈抗老。想知道自己的皮肤该配什么方案，评论区留个「方案」。",
      splitMode: "auto",
    },
    token
  );
  const sbBody = storyboard.result ?? {};
  record(
    "文案转片返回分镜脚本",
    storyboard.ok && JSON.stringify(sbBody).length > 120,
    `HTTP ${storyboard.status} · keys=${Object.keys(sbBody).slice(0, 12).join(",")}`
  );
  const sbForbidden = findForbidden(sbBody);
  record("分镜输出现模型/厂商名", sbForbidden.length === 0, sbForbidden.join(",") || "无");
  samples.storyboard = sbBody;

  // 7. 失败路径：素材不足必须 fail closed，给出精确补充提示且不产生模型调用结果
  const badCopy = await post("/beauty-industry/acquire/copywriter", { storeId, raw: "太短" }, token);
  const badCopyResult = badCopy.result ?? {};
  record(
    "失败路径：素材不足 fail closed，提示补充且不编造文案",
    badCopy.status === 200
      && badCopyResult?.needsInput === true
      && !badCopyResult?.finalDraft
      && /请补充|还缺/.test(String(badCopyResult?.body ?? "")),
    `HTTP ${badCopy.status} · needsInput=${badCopyResult?.needsInput} · ${String(badCopyResult?.body ?? "").slice(0, 40)}`
  );
  samples.needsInput = badCopyResult;

  // 7b. 参数非法（缺 store_id）必须 400
  const noStore = await post("/beauty-industry/acquire/copywriter", { raw: "这是一段足够长的口播稿，用来验证缺少门店标识会被拒绝。" }, token);
  record(
    "失败路径：缺 store_id 返回 400",
    noStore.status === 400,
    `HTTP ${noStore.status}`
  );

  // 8. 不应发生：跨门店串数据（换一个不存在的 store_id 必须被拒）
  const foreignStore = await post(
    "/beauty-industry/acquire/copywriter",
    { storeId: "store_not_belong_to_tenant", raw: "这是一段足够长的口播稿，用来验证跨门店访问会被拒绝。" },
    token
  );
  record(
    "门店隔离：非本租户 store_id 被拒",
    foreignStore.status >= 400,
    `HTTP ${foreignStore.status}`
  );

  await dump({ token: undefined });
  process.exit(failures ? 1 : 0);
}

async function dump(extra = {}) {
  const report = {
    generatedAt: new Date().toISOString(),
    apiBase,
    total: results.length,
    passed: results.length - failures,
    failed: failures,
    results,
    samples,
    ...extra,
  };
  const file = path.join(outDir, "lanqi-acquire-llm-walkthrough.json");
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nreport: ${file}`);
  console.log(`summary: ${results.length - failures}/${results.length} PASS`);
}

main().catch(async (error) => {
  console.error(error);
  await dump({ fatal: String(error?.message ?? error) });
  process.exit(1);
});
