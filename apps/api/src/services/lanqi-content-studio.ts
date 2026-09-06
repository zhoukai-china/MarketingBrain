import type { LanqiStoreProfileFacts } from "./lanqi-store-profile.js";

export interface LanqiContentBrief { topic: string; audience: string; goal: string; }
export interface LanqiContentCopy {
  title: string;
  titleCandidates: string[];
  selectedTitle: string;
  body: string;
  tags: string[];
  callToAction: string;
  disclosure: string;
}
export interface LanqiContentDraftOutput { copyDraft: LanqiContentCopy; imagePrompt: string; videoPrompt: string; sourceMode: "store_facts_only" | "store_facts_with_xiaohongshu_skill" | "controlled_draft"; }

function text(value: string | string[] | undefined): string { return Array.isArray(value) ? value.join("、") : value?.trim() || "待补"; }

export function buildLanqiContentDraft(brief: LanqiContentBrief, facts: LanqiStoreProfileFacts): LanqiContentDraftOutput {
  const store = text(facts.storeName); const city = text(facts.city); const services = text(facts.mainServices); const topic = brief.topic.trim();
  return {
    copyDraft: {
      title: `${topic}｜${store === "待补" ? "本店" : store}的小红书草案`,
      titleCandidates: [
        `${topic}｜${store === "待补" ? "本店" : store}的小红书草案`,
        `${topic}到店前，可以先确认这些信息`,
        `${topic}怎么选？先看这份准备清单`,
      ],
      selectedTitle: `${topic}｜${store === "待补" ? "本店" : store}的小红书草案`,
      body: `这是一份基于本店已提供资料生成的内容草案。\n\n${topic}\n\n我们目前提供：${services}。面向${brief.audience}，希望完成${brief.goal}。如在${city}，欢迎先通过门店官方渠道了解服务详情和预约方式。\n\n发布前请核对服务名称、适用人群与实际到店承接信息；未提供的案例、价格和效果不在本草案中。`,
      tags: ["#小红书笔记", "#门店日常", "#到店体验", "#内容草案"],
      callToAction: "如需了解，请通过门店官方渠道咨询；以实际服务说明为准。",
      disclosure: "当前为基于门店自身资料的通用草案，尚未加载兰琪方法论、案例、内部定价或效果承诺。",
    },
    imagePrompt: `小红书竖版封面，真实门店服务场景，主题：${topic}；主体：${services}；城市氛围：${city}；干净自然光、留出标题区域、不含价格、疗效承诺、品牌案例或虚构文字。`,
    videoPrompt: `9:16 竖版短视频草案，主题：${topic}。镜头一：真实门店环境；镜头二：服务准备或过程细节；镜头三：门店官方咨询引导。面向${brief.audience}，目标是${brief.goal}。不展示价格、疗效承诺或未经证实案例，画面保留 AI 生成标识。`,
    sourceMode: "store_facts_only",
  };
}

export function buildLanqiContentDraftFromSkill(
  brief: LanqiContentBrief,
  facts: LanqiStoreProfileFacts,
  skillAnswer: string,
): LanqiContentDraftOutput {
  const answer = skillAnswer.trim();
  if (!answer) throw new Error("content_skill_empty_output");
  const titleSection = extractSection(answer, "标题候选", ["正文", "话题标签", "互动与承接", "发布前核对"]);
  const bodySection = extractSection(answer, "正文", ["话题标签", "互动与承接", "发布前核对"]);
  const interactionSection = extractSection(answer, "互动与承接", ["发布前核对"]);
  const disclosureSection = extractSection(answer, "发布前核对", []);
  const parsedTitles = titleSection
    .split(/\r?\n/)
    .map(item => item.replace(/^\s*(?:[-*]|\d+[.、）)])\s*/, "").trim())
    .filter(Boolean)
    .filter(item => !isRiskyClaim(item))
    .map(item => item.slice(0, 80));
  const extractedTags = Array.from(new Set(answer.match(/#[\u4e00-\u9fa5A-Za-z0-9_-]{2,24}/g) ?? []))
    .filter(tag => !isRiskyClaim(tag))
    .slice(0, 8);
  const tags = Array.from(new Set([
    ...extractedTags,
    ...buildSafeTags(facts),
  ])).slice(0, 8);
  const titleCandidate = (parsedTitles[0] || brief.topic).slice(0, 80);
  const title = isRiskyClaim(titleCandidate) ? buildSafeTitle(facts) : titleCandidate;
  const titleCandidates = Array.from(new Set([
    title,
    ...parsedTitles,
    `${brief.topic}到店前，可以先确认这些信息`,
    `${brief.topic}怎么选？先看这份准备清单`,
  ])).filter(item => item && !isRiskyClaim(item)).slice(0, 3);
  const callToAction = buildSafeInteraction(interactionSection, facts);
  const body = sanitizePublicCopy(bodySection || answer, facts);
  const safeDisclosure = sanitizePublicCopy(disclosureSection, facts);
  const disclosure = [
    safeDisclosure,
    "发布前必须核对门店事实；未确认的价格、优惠、疗效、案例、客户评价、平台数据和经营结果不得写成事实。",
    "本稿仅依据门店已确认资料，未引用未激活的兰琪专属方法论或内部定价。",
  ].filter(Boolean).join(" ");
  return {
    copyDraft: {
      title,
      titleCandidates,
      selectedTitle: title,
      body,
      tags,
      callToAction,
      disclosure,
    },
    // Kept empty only for compatibility with the existing database columns.
    // LQ-09 never returns or consumes media prompts.
    imagePrompt: "",
    videoPrompt: "",
    sourceMode: "store_facts_with_xiaohongshu_skill",
  };
}

export function normalizeLanqiContentCopy(value: unknown): LanqiContentCopy {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "未命名小红书草稿";
  const candidates = Array.isArray(raw.titleCandidates)
    ? raw.titleCandidates.filter((item): item is string => typeof item === "string").map(item => item.trim().slice(0, 80)).filter(Boolean)
    : [];
  const titleCandidates = Array.from(new Set([title, ...candidates])).slice(0, 3);
  const selectedTitle = typeof raw.selectedTitle === "string" && titleCandidates.includes(raw.selectedTitle)
    ? raw.selectedTitle
    : title;
  return {
    title: selectedTitle,
    titleCandidates,
    selectedTitle,
    body: typeof raw.body === "string" ? raw.body : "",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    callToAction: typeof raw.callToAction === "string" ? raw.callToAction : "承接方式待确认。",
    disclosure: typeof raw.disclosure === "string" ? raw.disclosure : "发布前请核对门店事实。",
  };
}

function buildSafeTitle(facts: LanqiStoreProfileFacts): string {
  const confirmedServices = stringValues(facts.mainServices);
  return confirmedServices.length > 0
    ? `${confirmedServices[0]}到店前，先确认这些信息`
    : "这项门店服务，发布前先确认这些信息";
}

function buildSafeInteraction(interaction: string, facts: LanqiStoreProfileFacts): string {
  const question = interaction
    .split(/(?<=[？?])/)
    .map(item => item.replace(/^\s*(?:互动与承接[：:]\s*)?(?:评论互动[：:]\s*)?/, "").trim())
    .find(item => /[？?]/.test(item) && !isRiskyClaim(item));
  const confirmedChannels = stringValues(facts.primaryChannels);
  const engagement = question || "你最想先确认这项服务的哪个信息？";
  const handoff = confirmedChannels.length > 0
    ? `可通过门店已确认渠道（${confirmedChannels.join("、")}）进一步了解，具体方式以门店确认信息为准。`
    : "承接方式待确认。";
  return `评论互动：${engagement} 承接动作：${handoff}`;
}

function sanitizePublicCopy(value: string, facts: LanqiStoreProfileFacts): string {
  const confirmedServices = stringValues(facts.mainServices);
  const confirmedCities = stringValues(facts.city);
  const confirmedChannels = stringValues(facts.primaryChannels);
  const storeNames = stringValues(facts.storeName);
  const serviceBoundary = confirmedServices.length > 0
    ? `门店已确认的主营服务包括：${confirmedServices.join("、")}；本轮提到的其他具体项目名称需另行确认。`
    : "门店具体服务名称和是否当前提供，需另行确认。";
  const riskBoundary = "价格、优惠、疗效、案例和效果数据均待确认，本稿不作承诺。";
  const locationBoundary = confirmedCities.length > 0
    ? `门店已确认所在城市为${confirmedCities.join("、")}；其他地点信息需另行确认。`
    : "门店所在城市尚未确认。";
  const channelBoundary = confirmedChannels.length > 0
    ? `门店已确认的承接渠道包括：${confirmedChannels.join("、")}；具体联系方式仍需门店确认。`
    : "门店咨询与承接方式待确认。";
  const sanitized = value
    .split(/(?<=[。！？\n])/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .map(sentence => {
      const namesStore = storeNames.some(storeName => sentence.includes(storeName));
      if (/(?:门店|本店|我们|这家店)[^。！？\n]{0,48}(?:提供|主营|开展|设有|现有|可做|能做)/.test(sentence)
        || (namesStore && /(?:提供|主营|开展|设有|现有|可做|能做)/.test(sentence))) return serviceBoundary;
      if (/(?:门店|本店|我们|这家店)[^。！？\n]{0,24}(?:位于|坐落|目前在|在)[^。！？\n]{1,24}/.test(sentence)
        || (namesStore && /(?:位于|坐落|目前在|在)[^。！？\n]{1,24}/.test(sentence))) return locationBoundary;
      if (confirmedChannels.length === 0 && (
        /(?:通过)?门店已确认的(?:咨询|预约|承接|联系)(?:方式|渠道|路径)?/.test(sentence)
        || /(?:通过|可通过)[^。！？\n]{0,12}已确认的(?:咨询|预约|承接|联系)(?:方式|渠道|路径)?/.test(sentence)
      )) return channelBoundary;
      if (isRiskyClaim(sentence)) return riskBoundary;
      if (/(?:系统提示|提示词|API\s*Key|密钥|供应商|模型名称|其他租户)/i.test(sentence)) return "";
      return sentence;
    })
    .filter(Boolean);
  return Array.from(new Set(sanitized)).join("\n").trim();
}

function isRiskyClaim(value: string): boolean {
  return /\d+(?:\.\d+)?\s*(?:元|折|%|％|名|例|单|万|次)|根治|治愈|保证|必定|包好|真实案例|顾客都说|客户都说|月销|销量|成交|手机号|加微|加V|扫码/i.test(value);
}

function stringValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(item => item.trim()).filter(Boolean);
  return value?.trim() ? [value.trim()] : [];
}

function extractSection(answer: string, heading: string, nextHeadings: string[]): string {
  const lines = answer.split(/\r?\n/);
  const headings = [heading, ...nextHeadings];
  const headingPattern = new RegExp(
    `^\\s*(?:#{1,4}\\s*)?(${headings.map(escapeRegExp).join("|")})\\s*(?:[：:]\\s*(.*))?$`,
  );
  let start = -1;
  let firstLine = "";
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(headingPattern);
    if (match?.[1] === heading) {
      start = index + 1;
      firstLine = match[2]?.trim() ?? "";
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index]?.match(headingPattern);
    if (match?.[1] && nextHeadings.includes(match[1])) {
      end = index;
      break;
    }
  }
  return [firstLine, ...lines.slice(start, end)].filter(Boolean).join("\n").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSafeTags(facts: LanqiStoreProfileFacts): string[] {
  const factValues = [
    ...(Array.isArray(facts.mainServices) ? facts.mainServices : facts.mainServices ? [facts.mainServices] : []),
    ...(facts.city ? [`${Array.isArray(facts.city) ? facts.city[0] : facts.city}生活`] : []),
  ];
  const normalizedFacts = factValues
    .map(value => `#${String(value).replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]/g, "")}`)
    .filter(value => value.length >= 3 && value.length <= 25);
  return [...normalizedFacts, "#小红书笔记", "#门店日常", "#到店体验", "#本地生活", "#美业门店"];
}
