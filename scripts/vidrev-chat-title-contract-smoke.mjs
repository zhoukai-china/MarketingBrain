// PLAT-25B：视频复盘 chat 页「标题体系」回归（WorkBuddy QA 2026-09-12 剩余 P2 第 5/6 条）。
// 离线源码契约，毫秒级：防「浏览器 <title> 又退回通用平台名」和「页内标题又拼出
// 『视频复盘 · 视频复盘智能体』这种重复段」，并守护 PLAT-25A 的美业欢迎语顺序不被回退。
import { readFileSync } from "node:fs";

const appPath = "apps/web/src/marketplace/AgentChatPage.tsx";
const dataPath = "apps/api/src/data/marketplace-v3.json";
const app = readFileSync(appPath, "utf8");
const data = JSON.parse(readFileSync(dataPath, "utf8"));

let failed = 0;
function check(ok, label) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

// ① chat 页浏览器 <title> 必须带智能体名 + 专区名（锚点注释 + 赋值表达式）。
const titleAssign = app.match(/document\.title\s*=\s*industry\?\.title\s*\?\s*`\$\{runSku\.name\}\s*·\s*\$\{industry\.title\}`/);
check(Boolean(titleAssign), "chat 页浏览器 <title> = 智能体名 · 专区名（含 runSku.name 与 industry.title）");
check(app.includes("PLAT-25B：chat 页浏览器 <title> 带上智能体名与专区名"), "PLAT-25B 锚点注释存在，防止整块被删");

// ② 页内标题不再拼 flow.name · runSku.name 的重复段；改为 智能体名 + 可选专区名。
check(!/flow\.name\}\s*·\s*\{runSku\?\.name/.test(app), "页内标题不再出现「{flow.name} · {runSku?.name}」重复拼法");
check(app.includes('{runSku?.name ?? flow.name ?? "智能体"}{industry?.title ? ` · ${industry.title}` : ""}'), "页内标题 = 智能体名（兜底 flow.name）+ 可选专区名");

// ③ PLAT-25A：美业欢迎语必须先引导选模式，行业口径（POI/团购）只能挪位置不能删。
const meiyeWelcome = data.industries?.meiye?.ov?.vidrev?.welcome ?? "";
check(typeof meiyeWelcome === "string" && meiyeWelcome.includes("选复盘模式"), "meiye 欢迎语先引导「选复盘模式」，与进度条第 1 步一致");
check(meiyeWelcome.includes("POI") && meiyeWelcome.includes("团购"), "meiye 欢迎语仍保留 POI / 团购行业口径（未删，只是挪到数据/描述步）");
check(!/<b>第 1 轮<\/b>：这条视频挂了 POI/.test(meiyeWelcome), "meiye 欢迎语不再抢先问「第 1 轮 POI/团购」");

if (failed > 0) {
  console.error(`vidrev_chat_title_contract_smoke: FAIL (${failed} failed)`);
  process.exit(1);
}
console.log("vidrev_chat_title_contract_smoke: PASS (6 passed / 0 failed)");
