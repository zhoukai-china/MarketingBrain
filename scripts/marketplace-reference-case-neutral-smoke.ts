// 通用「输出参考案例」行业词守护（方案②：通用样例中性化，用户 2026-09-10 拍板）
//
// 背景（生产红灯证据）：前端 MarketplaceApp 用 coreSkuCode(skuCode) 取参考案例，
// 所以「创始人IP专区（通用）」和行业专区会看到同一条通用内核案例。一旦通用案例里写了
// 某个行业的词（例如美业「不破皮」），别的专区用户就会看到不属于自己行业的样例。
//
// 规则：只要一个内核同时上架在「通用专区」和至少一个行业专区，它的参考案例就不得出现
// 这些行业专区的行业词（专区 prefix + lexicon + 人工兜底词表）。
// 行业专属样例属于各行业专区自己的内核，不要塞回通用案例。
import {
  INDUSTRY_REFERENCE_CASES,
  REFERENCE_CASES,
  referenceCaseForSku,
  type ReferenceCase
} from "../apps/web/src/marketplace/reference-cases.js";
import {
  MARKETPLACE_INDUSTRIES,
  MARKETPLACE_V3_SKU_SEEDS
} from "../apps/api/src/services/marketplace-catalog.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const CORE_SEPARATOR = "__";

// 行业专区的兜底行业词表（prefix / lexicon 之外的常见行业名词）。
// 新增行业专区且它和通用专区共用内核时，必须补一份；缺失会在下面直接判 FAIL。
const INDUSTRY_GUARD_WORDS: Record<string, string[]> = {
  meiye: [
    "美业",
    "美容",
    "医美",
    "护肤",
    "皮肤管理",
    "美甲",
    "美睫",
    "破皮",
    "护理",
    "床位",
    "耗卡",
    "升单"
  ],
  canyin: [
    "餐饮",
    "堂食",
    "外卖",
    "菜品",
    "菜单",
    "翻台",
    "出餐",
    "食客",
    "快餐",
    "火锅",
    "烧烤",
    "奶茶",
    "小吃",
    "后厨"
  ]
};

// 历史红灯样例：2026-09-10 生产上 `ipzone__copy` 弹窗实际渲染的美业样例。
// 守护必须先能识别它，否则「通过」没有意义（能识别 → 改回旧文案必然 FAIL）。
const KNOWN_BAD_SAMPLE = [
  "输入：美业门店 · 卖点=不破皮项目 · 目标=引流到店",
  "「做了 16 年美容，我最怕客人进门就问一句：你们这个会不会破皮？」",
  "#美业老板 #不破皮 #皮肤管理 #美容院经营"
].join("\n");

function splitSkuCode(skuCode: string): { zone: string; core: string } {
  const separator = skuCode.indexOf(CORE_SEPARATOR);
  if (separator < 0) return { zone: skuCode, core: skuCode };
  return { zone: skuCode.slice(0, separator), core: skuCode.slice(separator + CORE_SEPARATOR.length) };
}

function textOf(entry: ReferenceCase): string {
  const rows = (entry.rows ?? []).flatMap((row) => [row.k, row.v]);
  const html = entry.html ? entry.html.replace(/<[^>]*>/g, " ") : "";
  return [entry.title, entry.input, ...rows, html].join(" ");
}

function termsForZone(zoneKey: string): string[] {
  const industry = MARKETPLACE_INDUSTRIES[zoneKey];
  assert(industry, `${zoneKey} 必须是 marketplace-v3.json 里声明过的专区`);
  const terms = new Set<string>();
  if (industry.prefix) terms.add(industry.prefix);
  for (const word of industry.lexicon ?? []) terms.add(word);
  for (const word of INDUSTRY_GUARD_WORDS[zoneKey] ?? []) terms.add(word);
  return [...terms].filter((word) => word.length > 0);
}

function hitsIn(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(term));
}

function main(): void {
  const generalZones = new Set(
    Object.values(MARKETPLACE_INDUSTRIES)
      .filter((industry) => industry.general)
      .map((industry) => industry.key)
  );
  assert(generalZones.size > 0, "必须存在通用专区（general=true），否则本守护无从判断");

  const zonesByCore = new Map<string, Set<string>>();
  for (const sku of MARKETPLACE_V3_SKU_SEEDS) {
    const { zone, core } = splitSkuCode(sku.skuCode);
    const zones = zonesByCore.get(core) ?? new Set<string>();
    zones.add(sku.zone || zone);
    zonesByCore.set(core, zones);
  }

  const checked: string[] = [];
  const issues: string[] = [];
  for (const [core, zones] of zonesByCore) {
    const industryZones = [...zones].filter((zone) => !generalZones.has(zone));
    const onGeneralZone = [...zones].some((zone) => generalZones.has(zone));
    if (!onGeneralZone || industryZones.length === 0) continue;

    const entry = REFERENCE_CASES[core];
    if (!entry) {
      issues.push(`${core}: 通用+行业专区共用，但缺少参考案例（REFERENCE_CASES 里没有这个内核）`);
      continue;
    }

    const terms = new Set<string>();
    for (const zone of industryZones) {
      const zoneTerms = termsForZone(zone);
      assert(
        zoneTerms.length > 0,
        `${zone} 与通用专区共用内核却没有任何行业词表，请补 INDUSTRY_GUARD_WORDS`
      );
      for (const term of zoneTerms) terms.add(term);
    }

    const hits = hitsIn(textOf(entry), [...terms]);
    if (hits.length > 0) {
      issues.push(`${core}: 通用参考案例出现行业词 ${hits.map((hit) => `「${hit}」`).join("、")}`);
    }
    checked.push(core);
  }

  assert(checked.length > 0, "没有任何内核同时上架通用专区和行业专区，拓扑变化需要人工确认");
  assert(
    checked.includes("copy"),
    `文案智能体（copy）必须仍在守护范围内（当前覆盖：${checked.join(", ")}）`
  );

  // 守护自检：历史红灯样例必须被判为命中，证明本检查真的能失败。
  const copyZones = zonesByCore.get("copy") ?? new Set<string>();
  const copyIndustryTerms = [...copyZones]
    .filter((zone) => !generalZones.has(zone))
    .flatMap((zone) => termsForZone(zone));
  assert(
    hitsIn(KNOWN_BAD_SAMPLE, copyIndustryTerms).length > 0,
    "守护自检失败：历史红灯样例（美业文案）没有被判为行业词命中"
  );

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exit(1);
  }

  // 用户实际反馈的那条：创始人IP专区的「文案智能体」详情页必须拿到中性样例。
  const reported = referenceCaseForSku("ipzone__copy");
  assert(reported, "ipzone__copy 必须能取到参考案例");
  const reportedText = textOf(reported);
  assert(reportedText !== KNOWN_BAD_SAMPLE, "ipzone__copy 不得再是那条美业样例");
  assert(
    hitsIn(reportedText, termsForZone("meiye")).length === 0,
    "ipzone__copy 的参考案例不得出现美业行业词"
  );

  // 方案② 的另一半：行业专属样例只能按完整 SKU 命中行业专区，不得被通用专区取到。
  const allIndustryTerms = [...zonesByCore.values()]
    .flatMap((zones) => [...zones])
    .filter((zone) => !generalZones.has(zone))
    .flatMap((zone) => termsForZone(zone));
  const generalZoneSkus = MARKETPLACE_V3_SKU_SEEDS.filter((sku) =>
    generalZones.has(sku.zone || splitSkuCode(sku.skuCode).zone)
  );
  assert(generalZoneSkus.length > 0, "通用专区必须至少有一个上架内核，否则本守护无从判断");
  for (const sku of generalZoneSkus) {
    const entry = referenceCaseForSku(sku.skuCode);
    assert(entry, `${sku.skuCode}（通用专区）必须能取到参考案例`);
    const hits = hitsIn(textOf(entry), allIndustryTerms);
    assert(
      hits.length === 0,
      `${sku.skuCode}（通用专区）的参考案例不得出现行业词 ${hits.map((hit) => `「${hit}」`).join("、")}`
    );
  }

  const scopedSkus = Object.keys(INDUSTRY_REFERENCE_CASES);
  assert(scopedSkus.length > 0, "方案② 要求行业专属样例存放在 INDUSTRY_REFERENCE_CASES，不能为空");
  for (const skuCode of scopedSkus) {
    const { zone } = splitSkuCode(skuCode);
    assert(
      !generalZones.has(zone),
      `${skuCode}：行业专属样例不得挂在通用专区（${zone} 是 general=true）`
    );
    const scopedText = textOf(INDUSTRY_REFERENCE_CASES[skuCode]);
    const scopedHits = hitsIn(scopedText, termsForZone(zone));
    assert(
      scopedHits.length > 0,
      `${skuCode}：行业专属样例必须命中本专区行业词，否则应并回通用中性样例`
    );
    assert(
      referenceCaseForSku(skuCode) === INDUSTRY_REFERENCE_CASES[skuCode],
      `${skuCode} 必须按完整 SKU 命中它自己的行业专属样例`
    );
  }
  assert(
    scopedSkus.includes("meiye__copy"),
    `美业文案智能体必须保留自己的行业专属样例（当前：${scopedSkus.join(", ")}）`
  );
  assert(
    scopedSkus.includes("canyin__copy"),
    `餐饮文案智能体必须保留自己的行业专属样例（当前：${scopedSkus.join(", ")}）`
  );

  console.log(`PASS marketplace-reference-case-neutral-smoke（通用内核 ${checked.length} 个：${checked.join(", ")}）`);
}

main();
