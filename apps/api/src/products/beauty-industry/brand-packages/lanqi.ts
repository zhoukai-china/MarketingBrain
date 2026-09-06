import type { BeautyIndustryBrandConfig } from "../brand-config.js";

/**
 * Display-only Lanqi package. It intentionally contains no customer knowledge,
 * Skill, prompt, credential, domain override, or business rule.
 */
export const LANQI_BEAUTY_BRAND_PACKAGE: BeautyIndustryBrandConfig = Object.freeze<BeautyIndustryBrandConfig>({
  version: "beauty-industry-brand-v1",
  brandCode: "lanqi",
  displayName: "兰琪",
  productSubtitle: "门店 AI 经营大脑",
  theme: {
    tokenName: "lanqi-orange",
    primary: "#B94E0A",
    primaryDark: "#7A2D00",
    primaryLight: "#FBE7D5",
    surface: "#FFF8F2",
    text: "#3B1A0E",
    textOnPrimary: "#FFFFFF"
  },
  logo: { kind: "text", text: "兰琪" },
  domain: { mode: "shared_current_entry", hostname: null },
  pageCopy: { workspaceKicker: "兰琪门店经营工作台", connectionLabel: "兰琪美业专属连接" },
  knowledgePackRef: null,
  featureFlags: { customBrandKnowledge: false }
});
