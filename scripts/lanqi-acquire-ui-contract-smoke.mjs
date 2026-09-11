#!/usr/bin/env node
/**
 * 兰琪「公域获客」页面前端契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 锁定 WorkBuddy《兰琪公域获客测试报告》（2026-09-11，stage3）复核成立的缺陷，防止回归：
 *  1) P1 直播话术表单把演示门店（美肌研 · 创始人晓曼 / 水光深层补水 / 团购价99…）当默认值预填，
 *     老板不清空就会直接生成别人家门店的逐字稿 → 改为 placeholder + 用户主动点「填入示例」。
 *  2) P3 AI 运营顾问快捷问题「没空拍视频，怎么持续获客）」标点错误 → 改为「？」。
 *  3) P0「直播话术 502」的复核结论是发布重启窗口 + 前端没有可重试提示 → 锁定可读失败文案与有界重试。
 *
 * 同时反向锁定两处「不要顺手改掉」的测试夹具：
 *  - `scripts/lanqi-advisor-rules-smoke.ts` 仍以错标点原样作输入，覆盖「标点错了也能识别话题」；
 *  - `scripts/lanqi-live-service-smoke.ts` 仍用演示门店作输入夹具，覆盖真实生成口径。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const livePage = read("apps/web/src/pages/LanqiAcquireLivePage.tsx");
const methodsPage = read("apps/web/src/pages/LanqiAcquireMethodsPage.tsx");
const advisorRulesSmoke = read("scripts/lanqi-advisor-rules-smoke.ts");
const liveServiceSmoke = read("scripts/lanqi-live-service-smoke.ts");

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function requireMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, hit, hit ? `命中 ${String(pattern)}` : `缺少 ${String(pattern)}`);
}

function forbidMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, !hit, hit ? `仍存在 ${String(pattern)}` : "未出现");
}

// ① 直播话术表单：演示数据不得再作为默认 value
for (const field of ["host", "main", "sell", "price", "card"]) {
  const setter = `set${field[0].toUpperCase()}${field.slice(1)}`;
  requireMatch(
    livePage,
    new RegExp(`const \\[${field}, ${setter}\\] = useState\\(""\\);`),
    `live：${field} 默认值为空（不预填演示门店）`
  );
}
forbidMatch(livePage, /useState\("美肌研/, "live：店名/主播身份仍在默认预填演示门店");
forbidMatch(livePage, /useState\("水光深层补水/, "live：主打项目仍在默认预填演示项目");
forbidMatch(livePage, /useState\("小分子玻尿酸/, "live：真实卖点仍在默认预填演示卖点");
forbidMatch(livePage, /useState\("团购价99/, "live：价格机制仍在默认预填演示价格");
forbidMatch(livePage, /useState\("年度会员/, "live：会员卡项仍在默认预填演示权益");

// ② 直播话术表单：示例改为 placeholder 提示 + 一键填入
for (const id of ["lq-live-host", "lq-live-main", "lq-live-sell", "lq-live-price", "lq-live-card"]) {
  requireMatch(
    livePage,
    new RegExp(`id="${id}"[^>]*placeholder=`),
    `live：${id} 带 placeholder 填写提示`
  );
}
requireMatch(livePage, /const DEMO_INPUT = \{/, "live：演示数据集中声明为 DEMO_INPUT");
requireMatch(livePage, /host: "美肌研 · 创始人晓曼"/, "live：演示数据仍保留（格式参考）");
requireMatch(livePage, /function fillDemo\(/, "live：提供 fillDemo 一键填入示例");
requireMatch(livePage, /填入示例/, "live：表单有「填入示例」入口");

// ③ 直播话术表单：取消预填后必填校验与本地反问必须仍在
requireMatch(livePage, /还差必填/, "live：必填缺失时仍做本地反问（不空跑模型）");
requireMatch(
  livePage,
  /if \(!host\.trim\(\) \|\| !main\.trim\(\) \|\| !sell\.trim\(\) \|\| !carries\.length \|\| !platforms\.length\)/,
  "live：必填校验覆盖店名/主打项目/卖点/带货标的/平台"
);

// ④ 直播话术失败路径：5xx / 网关错误必须讲清「不是输入问题、可以重试」
requireMatch(livePage, /function describeHttpFailure\(/, "live：5xx/网关错误有专门的用户可读文案");
requireMatch(livePage, /502|503|504/, "live：文案区分服务重启/排队（502/503/504）");
requireMatch(livePage, /HTTP \$\{status\}/, "live：失败文案回传 HTTP 状态，便于用户与运维对齐");
requireMatch(livePage, /const RETRY_DELAYS_MS = \[/, "live：分批生成配置了有界重试与退避");
requireMatch(livePage, /attempt < RETRY_DELAYS_MS\.length/, "live：重试次数由退避表界定（不无限重试）");
requireMatch(livePage, /重新生成 2 小时逐字稿/, "live：失败后主按钮引导「重新生成」");
requireMatch(livePage, /重试/, "live：失败面板给出可重试说明");

// ⑤ AI 运营顾问：快捷问题标点修正，其余问题保留
requireMatch(methodsPage, /"没空拍视频，怎么持续获客？"/, "methods：快捷问题标点已改为「？」");
forbidMatch(methodsPage, /获客）/, "methods：快捷问题不再出现「获客）」");
for (const question of [
  "新门店预算少，该从哪个平台开始？",
  "差评多、星级低，怎么救？",
  "视频号发了没人转，问题在哪？",
  "抖音投了本地推没转化，怎么调？",
  "美团团购利润被压，怎么办？"
]) {
  requireMatch(methodsPage, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `methods：保留快捷问题「${question}」`);
}

// ⑥ 反向锁定：两处测试夹具不要被顺手改掉
requireMatch(
  advisorRulesSmoke,
  /没空拍视频，怎么持续获客）/,
  "guard：顾问规则 smoke 仍以错标点原样覆盖「标点错了也能识别话题」"
);
requireMatch(
  liveServiceSmoke,
  /美肌研 · 创始人晓曼/,
  "guard：直播服务 smoke 仍用演示门店作输入夹具"
);

console.log(`\nlanqi_acquire_ui_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${results.length - failures} passed / ${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
