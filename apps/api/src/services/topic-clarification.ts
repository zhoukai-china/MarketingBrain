import type { RequestContext } from "./request-context.js";

interface TopicClarificationInput {
  input: string;
  context: RequestContext;
  knowledgeSubject?: { name?: string | null; industry?: string | null } | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  taskCustomerProfile?: {
    name?: string;
    industry?: string;
    targetCustomer?: string;
    growthGoal?: string;
  };
}

const UNFILLED_PLACEHOLDER = /【[^】]*(?:IP\s*\/\s*企业\s*\/\s*客户项目|自己的项目\s*\/\s*客户项目|目标客户|目标人群|转化目标|主营|产品|业务|请填写|待填写|待补|待确认)[^】]*】/;

function profileText(context: RequestContext, key: string): string {
  const value = context.profile.data?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function capturedValue(input: string, pattern: RegExp): string {
  const value = input.match(pattern)?.[1]?.trim() ?? "";
  return /^(?:目标客户|目标人群|客户|人群|请填写|待补|待确认)$/.test(value) ? "" : value;
}

export function buildTopicClarificationPrompt({ input, context, knowledgeSubject, history = [], taskCustomerProfile }: TopicClarificationInput): string | undefined {
  const text = input.replace(/\s+/g, " ").trim();
  const hasUnfilledPlaceholder = UNFILLED_PLACEHOLDER.test(text);
  const userTurns = [...history.filter((message) => message.role === "user").map((message) => message.content), text]
    .map((turn) => turn.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const accumulatedText = userTurns.join("\n");
  const confirmedText = accumulatedText.replace(/【[^】]+】/g, "");
  const externalProjectTask = /(?:替|帮|给|为).{0,12}(?:客户|客户项目|品牌方|项目方)|(?:客户项目|客户品牌)/.test(confirmedText);
  const canUseEnterpriseDefaults = !externalProjectTask && !knowledgeSubject;
  const explicitSubject = capturedValue(confirmedText, /(?:我是|我们是|品牌(?:名)?是|项目(?:名)?是)[：:]?\s*([^，。；;\n【]{2,30})/)
    || capturedValue(confirmedText, /(?:给|为|替)(?!【)\s*([^，。；;\n]{2,24}?)(?:做|写|策划|生成|输出)选题/);
  const subjectKnown = !/【[^】]*(?:IP\s*\/\s*企业\s*\/\s*客户项目|自己的项目\s*\/\s*客户项目|请填写|待确认)[^】]*】/.test(text)
    && Boolean(taskCustomerProfile?.name || knowledgeSubject?.name || explicitSubject || (canUseEnterpriseDefaults && context.profile.tenantName));

  const explicitBusiness = capturedValue(confirmedText, /(?:主营|主推|产品|服务|业务|行业|项目是|做的是)[：:]?\s*([^，。；;\n【]{2,40})/);
  const defaultBusiness = profileText(context, "offer") || context.profile.industry || "";
  const businessKnown = !/【[^】]*(?:主营|产品|业务|行业|项目|请填写|待确认)[^】]*】/.test(text)
    && Boolean(taskCustomerProfile?.industry || explicitBusiness || knowledgeSubject?.industry || (canUseEnterpriseDefaults && defaultBusiness));

  const explicitTarget = capturedValue(confirmedText, /(?:目标客户|目标人群|希望吸引|想吸引|面向)[：:]?\s*([^，。；;\n【]{2,50}?)(?:并|，|。|；|$)/)
    || capturedValue(confirmedText, /目标(?:客户|人群|受众)?不是[^，。；;\n]{1,40}(?:而是|是)\s*([^，。；;\n]{2,60})/)
    || capturedValue(confirmedText, /(?:重点|主要)?(?:吸引|面向|触达)\s*([^，。；;\n]{2,60}?(?:顾客|客户|人群|加盟商|消费者))/);
  const defaultTarget = profileText(context, "customer");
  const targetKnown = !/【[^】]*(?:目标客户|目标人群|请填写|待确认)[^】]*】/.test(text)
    && Boolean(taskCustomerProfile?.targetCustomer || explicitTarget || (canUseEnterpriseDefaults && defaultTarget));

  const explicitGoal = /(?:私信|留资|加微信|预约|到店|咨询|报名|购买|下单|成交|签约|加盟|领取资料|关注|涨粉|获客|引流|增长|外卖订单|有效线索|品牌搜索)/.test(confirmedText);
  const storedGoal = profileText(context, "businessGoal");
  const goalKnown = !/【[^】]*(?:转化目标|业务目标|请填写|待确认)[^】]*】/.test(text)
    && Boolean(taskCustomerProfile?.growthGoal || explicitGoal || (canUseEnterpriseDefaults && storedGoal));

  if (!hasUnfilledPlaceholder && subjectKnown && businessKnown && targetKnown && goalKnown) return undefined;

  const missing = [
    !subjectKnown ? "本次服务主体：是你本人/你的企业，还是哪个客户项目" : "",
    !businessKnown ? "主营业务或本轮项目：具体卖什么产品、服务或合作机会" : "",
    !targetKnown ? "目标客户：最希望吸引哪一类人" : "",
    !goalKnown ? "转化目标：希望用户看完后私信、留资、预约、到店、加盟还是购买" : ""
  ].filter(Boolean);

  return [
    "现在还不能直接生成选题，否则只能得到带占位符的空框架。",
    `请先补充${missing.length}项关键信息：`,
    ...missing.map((item) => `- ${item}`),
    "",
    "你可以直接复制这句话填写：",
    "本次为【本人/企业/客户项目名称】做选题，主营或项目是【具体产品/服务】，目标客户是【具体人群】，希望用户看完后【私信/留资/预约/到店/加盟/购买】。",
    "补充后，我再结合已选知识库资料输出有事实依据的TOP10选题，不会先输出占位框架。"
  ].join("\n");
}
