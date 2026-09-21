// 数字员工人名契约（用户 2026-09-21：图1 数字员工卡片、图2 智能体详情页、图3 对话页
// 都要显示各自的数字员工名字，「不能都叫思潼」）。
//
// 2026-09-21 追加口径：不要都叫「思什么」，要按岗位起名——人名 = 常见单字姓 + 岗位关键字一个字，
// 所以这里额外拦两类回退：④ 名字又变回带品牌字「思」；⑤ 8 个人名共用同一个姓。
// 2026-09-21 再追加：对话页头像要是**这个数字员工自己的形象**，不能一律用品牌形象「思潼」，
// 所以这里还拦：⑥ 对话页头像又写回 `sitongAvatar`；⑦ 新增数字员工时忘了登记形象。
//
// 离线源码契约，毫秒级，防三类回退：
// ① 有人把某个数字员工的名字改回「思潼」或改成重名；
// ② 新增数字员工时忘了登记人名（卡片/详情/气泡会回退成「思潼」）；
// ③ 行业专区欢迎语（apps/api/src/data/marketplace-v3.json 的 ov）又退回清一色「思潼」。
import { existsSync, readFileSync } from "node:fs";

const namesPath = "apps/web/src/marketplace/employee-names.ts";
const dataPath = "apps/web/src/marketplace/eco-mall-data.ts";
const chatFlowsPath = "apps/web/src/marketplace/chat-flows.ts";
const catalogPath = "apps/api/src/data/marketplace-v3.json";

const namesSrc = readFileSync(namesPath, "utf8");
const dataSrc = readFileSync(dataPath, "utf8");
const chatFlowsSrc = readFileSync(chatFlowsPath, "utf8");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

let failed = 0;
function check(ok, label) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

/** 取人名表条目（键可带引号也可不带）：`"ip-pos": "沈定"` / `topic: "何策"` → [能力核, 人名]。 */
const nameEntries = [...namesSrc.matchAll(/^\s*"?([a-z-]+)"?:\s*"([^"]+)"/gm)]
  .map(([, capability, name]) => ({ capability, name }))
  .filter((entry) => entry.capability !== "ip-pack");
const names = new Map(nameEntries.map((entry) => [entry.capability, entry.name]));

// ① 8 个数字员工各自有人名，且互不重复、都不叫「思潼」（品牌名只做兜底）。
const capabilities = [...dataSrc.matchAll(/capability:\s*"([a-z-]+)"/g)].map(([, capability]) => capability);
check(capabilities.length === 8, `数字员工共 8 个（实际 ${capabilities.length}）`);
check(capabilities.every((capability) => names.has(capability)), "每个数字员工都登记了人名");
check(new Set(nameEntries.map((entry) => entry.name)).size === nameEntries.length, "数字员工人名互不重复");
check(nameEntries.every((entry) => entry.name !== "思潼"), "数字员工人名不再是品牌名「思潼」");

// ①B 2026-09-21 追加：按岗位起名，不能都叫「思什么」。
check(nameEntries.every((entry) => !entry.name.startsWith("思")), "人名不带品牌字「思」（不再叫「思某」）");
check(nameEntries.every((entry) => entry.name.length === 2), "人名格式为「姓 + 岗位关键字」两个字");
check(
  new Set(nameEntries.map((entry) => entry.name[0])).size === nameEntries.length,
  "8 个人名的姓互不重复（一眼能区分谁是谁）"
);

// ② 三个界面都从人名表取名字，而不是各自写死「思潼」。
check(/employeePersonaLabel/.test(readFileSync("apps/web/src/marketplace/EcoMallHomePage.tsx", "utf8")), "数字员工卡片/弹窗用人名表渲染名字");
check(/employeePersonaName/.test(readFileSync("apps/web/src/marketplace/AgentDetailPage.tsx", "utf8")), "智能体详情页标题用人名表渲染名字");
const chatSrc = readFileSync("apps/web/src/marketplace/AgentChatPage.tsx", "utf8");
check(/personaLabel/.test(chatSrc) && !/思潼 · \{sku\?\.name/.test(chatSrc), "对话页标题/气泡标签用人名表，不再写死「思潼 · 智能体名」");
check((chatFlowsSrc.match(/我是\$\{NAME[.[]/g) ?? []).length === 8, "8 个技能欢迎语都用各自数字员工人名");
check(!/我是思潼 · [^。"\n]*智能体/.test(chatFlowsSrc), "技能欢迎语不再写死「我是思潼」（套装 ip-pack 保留品牌名）");

// ③ 行业专区欢迎语：每个技能用自己的数字员工人名，只有套装仍是品牌名。
const ovWelcomes = [];
for (const industry of Object.values(catalog.industries ?? {})) {
  for (const [capability, skill] of Object.entries(industry.ov ?? {})) {
    if (typeof skill?.welcome === "string") ovWelcomes.push({ capability, welcome: skill.welcome });
  }
}
check(ovWelcomes.length > 0, `读到行业专区欢迎语 ${ovWelcomes.length} 条`);
const wrongBrand = ovWelcomes.filter(({ capability, welcome }) => capability !== "ip-pack" && welcome.includes("思潼"));
check(wrongBrand.length === 0, `行业专区欢迎语不再写死「思潼」（越界 ${wrongBrand.length} 条）`);
const namedOk = ovWelcomes
  .filter(({ capability }) => names.has(capability))
  .every(({ capability, welcome }) => welcome.includes(names.get(capability)));
check(namedOk, "行业专区欢迎语都带上了对应数字员工人名");

// ④ 对话页头像：页头、登录态、正常态、AI 气泡、生成中、确认前都用「这个数字员工自己的形象」，
//    只有套装 ip-pack（取不到员工）才回退品牌形象「思潼」。
check(!/src=\{sitongAvatar\}/.test(chatSrc), "对话页不再把品牌形象「思潼」直接当数字员工头像");
check(
  /const personaAvatar = employeeAvatarPath\(sku\?\.skuCode \?\? skuId\) \?\? sitongAvatar;/.test(chatSrc),
  "对话页头像 = 展示 SKU 对应数字员工形象，套装回退品牌形象"
);
check(
  (chatSrc.match(/src=\{personaAvatar\}/g) ?? []).length >= 6,
  `对话页 6 处员工头像都用人名对应形象（实际 ${(chatSrc.match(/src=\{personaAvatar\}/g) ?? []).length} 处）`
);

// ⑤ 人名与形象同一口径：8 个能力核都在 `EMPLOYEE_AVATAR_BY_CAPABILITY` 里有形象文件，且文件真实存在。
const avatarBlockStart = dataSrc.indexOf("EMPLOYEE_AVATAR_BY_CAPABILITY");
const avatarBlock = dataSrc.slice(avatarBlockStart, dataSrc.indexOf("};", avatarBlockStart));
const avatarEntries = [...avatarBlock.matchAll(/"?([a-z-]+)"?:\s*"([^"]+)"/g)].map(([, capability, asset]) => ({
  capability,
  asset
}));
check(avatarEntries.length === 8, `数字员工形象共 8 个（实际 ${avatarEntries.length}）`);
check(capabilities.every((capability) => avatarEntries.some((entry) => entry.capability === capability)), "每个数字员工都登记了形象");
const missingFiles = avatarEntries
  .map((entry) => `apps/web/public/${entry.asset}`)
  .filter((file) => !existsSync(file));
check(missingFiles.length === 0, `形象文件都在 apps/web/public 下（缺失：${missingFiles.join("、")}）`);

// ⑥ 公共图片路径必须带部署 base（生产 base 是 /os-v2/），不能裸写 `/avatars/x.png`（生产会 404）。
check(/getPublicAssetPath/.test(dataSrc), "数字员工形象路径走 getPublicAssetPath（带部署 base）");
check(!/"\/avatars\//.test(dataSrc), "不再裸写根路径「/avatars/...」");

if (failed > 0) {
  console.error(`marketplace_employee_name_contract_smoke: FAIL (${failed} failed)`);
  process.exit(1);
}
console.log("marketplace_employee_name_contract_smoke: PASS");
