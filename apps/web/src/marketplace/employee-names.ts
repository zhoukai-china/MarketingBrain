/**
 * 数字员工人名表（用户 2026-09-21 口径：每个数字员工要有自己的名字，不能都叫「思潼」）。
 *
 * key = 货架能力核（`coreSkuCode(skuCode)` 的后缀），与 `ECO_EMPLOYEES[].capability` 一致；
 * 数字员工卡片、智能体详情页、对话页气泡标签都从这里取名字，避免多处各写一份。
 * 套装（`ip-pack`）代表 7 大能力的入口，不是某一个人，所以不在这里登记，展示时回退品牌名「思潼」。
 *
 * 起名规则（用户 2026-09-21 追加：不要都叫「思什么」，按岗位起名）：
 * 姓（常见单字姓，8 个互不重复）+ 岗位关键字（取该岗位职责里的一个字：定 / 策 / 文 / 流 / 盘 / 复 / 成 / 域）。
 * 名字里不带品牌字「思」，避免人名和品牌名混在一起。
 */
export const EMPLOYEE_NAME_BY_CAPABILITY: Record<string, string> = {
  "ip-pos": "沈定",
  topic: "何策",
  copy: "秦文",
  vidrev: "江流",
  livescript: "罗盘",
  liverev: "许复",
  sales: "易成",
  moments: "周域"
};

function capabilityOf(skuCodeOrCapability: string): string {
  return skuCodeOrCapability.includes("__")
    ? skuCodeOrCapability.slice(skuCodeOrCapability.lastIndexOf("__") + 2)
    : skuCodeOrCapability;
}

/** 取数字员工人名（如 `ipzone__ip-pos` / `ip-pos` → 沈定）；套装或未知能力返回 null。 */
export function employeePersonaName(skuCodeOrCapability: string | null | undefined): string | null {
  if (!skuCodeOrCapability) return null;
  return EMPLOYEE_NAME_BY_CAPABILITY[capabilityOf(skuCodeOrCapability)] ?? null;
}

/** 对话页 / 详情页的展示名：有对应数字员工就用它的名字，否则回退品牌名。 */
export function employeePersonaLabel(skuCodeOrCapability: string | null | undefined, fallback = "思潼"): string {
  return employeePersonaName(skuCodeOrCapability) ?? fallback;
}
