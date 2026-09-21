// 专区名契约（用户 2026-09-21：「没有创始人IP专区，只有 餐饮 / 美业 / 通用行业」）。
//
// 离线源码契约，毫秒级，防两类回退：
// ① 通用专区的展示名又变回「创始人IP专区」（货架标题 / 详情页 / 对话页页头都会跟着变）；
// ② 专区标题不再齐整（餐饮专区 / 美业专区 / 通用行业），用户分不清有哪些专区。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const catalogPath = "apps/api/src/data/marketplace-v3.json";
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

let failed = 0;
function check(ok, label) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

// ① 专区标题：三大专区口径（餐饮 / 美业 / 通用行业），通用专区不再叫「创始人IP专区」。
const titles = Object.fromEntries(
  Object.entries(catalog.industries ?? {}).map(([key, industry]) => [key, String(industry?.title ?? "")])
);
check(titles.ipzone === "通用行业", `通用专区标题 = 通用行业（实际「${titles.ipzone}」）`);
check(titles.meiye === "美业专区", `美业专区标题 = 美业专区（实际「${titles.meiye}」）`);
check(titles.canyin === "餐饮专区", `餐饮专区标题 = 餐饮专区（实际「${titles.canyin}」）`);
check(
  !Object.values(titles).some((title) => title.includes("创始人IP专区")),
  "专区标题里不再出现「创始人IP专区」"
);

// ② 生产路径（网页 + API 数据）里不再留「创始人IP专区」这个专区名。
//    只看产品源码；`scripts/`、`docs/`、`db/dump` 里的历史记录不算用户可见文案。
const zonesWithOldName = [];
function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scan(full);
      continue;
    }
    if (!/\.(ts|tsx|json|css)$/.test(entry)) continue;
    const source = readFileSync(full, "utf8");
    if (source.includes("创始人IP专区")) zonesWithOldName.push(full);
  }
}
scan("apps/web/src");
scan("apps/api/src");
check(
  zonesWithOldName.length === 0,
  `生产路径里不再出现「创始人IP专区」（越界 ${zonesWithOldName.length} 处：${zonesWithOldName.join("、")}）`
);

// ③ 跟专区名一起出现在用户眼前的兜底文案（充值 / 我的 / 详情页积分卡 / 首页架构说明）同步改成「通用行业」。
const copyFiles = [
  "apps/web/src/pages/RechargePage.tsx",
  "apps/web/src/marketplace/MinePage.tsx",
  "apps/web/src/marketplace/AgentDetailPage.tsx",
  "apps/web/src/marketplace/HomePage.tsx"
];
const copyWithoutNewName = copyFiles.filter((file) => !readFileSync(file, "utf8").includes("通用行业"));
check(copyWithoutNewName.length === 0, `积分/专区说明文案已用「通用行业」（没跟上的：${copyWithoutNewName.join("、")}）`);

// ④ 改名不能降搜索（2026-09-21）：原来专区名「创始人IP专区」本身就命中了「创始人IP」这个搜索词，
//    改名「通用行业」后必须由专区级 searchAlias 兜住，否则用户搜「创始人IP」在货架上再也找不到
//    IP 定位 / 全案套装（`matchesMarketplaceQuery` 的 haystack 只拼 sku 自身字段 + 专区名）。
const alias = catalog.industries?.ipzone?.searchAlias;
check(
  Array.isArray(alias) && alias.includes("创始人IP"),
  `通用行业专区保留了「创始人IP」搜索别名（实际 ${JSON.stringify(alias)}）`
);
const catalogSrc = readFileSync("apps/api/src/services/marketplace-catalog.ts", "utf8");
check(
  /searchAlias: industryValues\(industry\.searchAlias\)/.test(catalogSrc) && /\.\.\.searchAlias/.test(catalogSrc),
  "专区别名被并进 SKU 关键词（搜索 haystack 取 keywords，改名不影响搜到）"
);

// ⑤ 改名必须真的到用户眼前（2026-09-21 实测到的静默失效）：专区展示名在库里 profile 行也存了一份，
//    `loadMarketplaceIndustryProfiles()` 会用库里的值覆盖内存里的文件值，而 `syncMarketplaceIndustryProfiles()`
//    只在首次建行时写入、运维 PATCH 接口又改不到 title —— 库里的旧「创始人IP专区」会把新名字永久盖回去。
//    现象：货架/详情页（读 MARKETPLACE_ZONES）已经是「通用行业」，对话页页头与浏览器标题
//    （读 GET /market/skus/:skuId 返回的 industry.title）仍是「创始人IP专区」。
const loaderStart = catalogSrc.indexOf("export async function loadMarketplaceIndustryProfiles");
check(loaderStart >= 0, "找得到 loadMarketplaceIndustryProfiles（改名回归的落点）");
const loaderBody = loaderStart >= 0 ? catalogSrc.slice(loaderStart, catalogSrc.indexOf("export ", loaderStart + 10)) : "";
check(
  loaderBody.length > 0 && !/title:\s*row\.title|tag:\s*row\.tag/.test(loaderBody),
  "专区展示名不取库里那两列（库里的旧专区名不会盖回货架/对话页）"
);
check(
  /title:\s*current\.title/.test(loaderBody) && /tag:\s*current\.tag/.test(loaderBody),
  "专区展示名固定取发布文件（改名/回滚随发版走）"
);

if (failed > 0) {
  console.error(`marketplace_zone_name_contract_smoke: FAIL (${failed} failed)`);
  process.exit(1);
}
console.log("marketplace_zone_name_contract_smoke: PASS");
