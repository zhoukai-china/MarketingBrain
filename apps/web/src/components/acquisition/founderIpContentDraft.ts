export type FounderIpContentTarget = "franchise" | "store_visit" | "student" | "partner";

export interface FounderIpContentSelection {
  subjectId: string;
  target: FounderIpContentTarget;
  identity: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer: string;
  accountStage: string;
  industry: string;
  topic: string;
  audience: string;
  sourceEvidence: string;
  factBoundary: string;
  goalRelation: string;
}

export interface FounderIpContentDraft extends FounderIpContentSelection {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export function buildFounderIpSafeFallbackDraft(draft: FounderIpContentDraft): string {
  const cta = {
    franchise: "如需判断是否适合加盟，请通过咨询了解加盟条件与下一步筛选。",
    store_visit: "如需到店体验，请通过预约确认可用时间与到店安排。",
    student: "如需了解课程，请通过咨询确认课程安排或试听条件。",
    partner: "如需评估合作，请通过咨询确认合作方向与资格要求。"
  }[draft.target];
  return ["# 待补素材内容草稿", `## 选题 / 钩子\n${draft.topic}`, `## 目标人群\n${draft.audience}`, `## 本轮线索目标\n${draft.acquisitionGoal}`, `## 与获客目标的关系\n${draft.goalRelation}`, `## 可确认的创作依据\n${draft.sourceEvidence}`, `## 事实边界\n${draft.factBoundary}`, "## 开场表达（可编辑）\n如果你是上述目标人群，在行动前先确认与自己情况直接相关的问题；没有证据的案例、收益、数字和承诺一律不写。", "## 核心内容框架（待补后再完善）\n1. 说明用户当前需要判断的问题。\n2. 只补充已确认的项目条件、流程或事实。\n3. 未核验信息保持待确认，不写成结论。", `## 承接动作\n${cta}`, "## 一次性待补素材\n- 已确认的项目/课程/服务名称与适用条件\n- 可公开引用的真实案例或数据（如有）\n- 不可承诺的边界、价格和可用时间", "> 此草稿由内容服务异常后的受控降级生成：可以编辑、保存和恢复，但尚不是完整成品，不能进入投流预览。"].join("\n\n");
}

export function validateFounderIpContentResult(draft: FounderIpContentDraft, content: string): string | undefined {
  const normalized = content.trim();
  const compact = normalized.replace(/\s+/g, "");
  const required = [draft.topic, draft.audience, draft.targetCustomer, draft.acquisitionGoal, draft.sourceEvidence, draft.goalRelation]
    .every((value) => compact.includes(value.replace(/\s+/g, "")));
  if (!required) return "内容服务没有保留当前选题、目标人群、来源依据或获客目标，不能作为当前获客目标的内容草稿。";
  const expectedCta = { franchise: /加盟(?:咨询|条件|评估|申请|考察)/, store_visit: /(?:团购|预约|到店)/, student: /(?:课程咨询|咨询课程|试听|报名)/, partner: /(?:合作意向|合作咨询|资格判断|方案沟通)/ }[draft.target];
  if (!expectedCta.test(normalized)) return "内容服务没有使用当前获客目标的专属承接动作，不能作为当前获客目标的内容草稿。";
  const forbidden = { franchise: /团购|核销|到店预约|消费者优惠|课程报名|合作意向/, store_visit: /加盟商|加盟咨询|招商加盟|加盟考察|课程报名|合作意向/, student: /加盟商|加盟咨询|招商加盟|团购核销|到店套餐|合作意向/, partner: /加盟商|加盟咨询|招商加盟|团购核销|到店套餐|课程报名|试听/ }[draft.target];
  if (forbidden.test(normalized)) return "内容服务混入了其他获客目标的受众或承接动作，不能作为当前获客目标的内容草稿。";
  if (/待(?:验证|补|核验)|未(?:提供|核验)/.test(draft.factBoundary) && !/(?:待补|待核验|待确认|未提供)/.test(normalized)) return "内容没有保留待确认事实边界，不能作为当前获客目标的内容草稿。";
  return undefined;
}

function cells(line: string): string[] {
  return line.split("|").slice(1, -1).map(value => value.trim().replace(/<br\s*\/?\s*>/gi, "；").replace(/`/g, ""));
}

export function parseFounderTopicSelections(markdown: string): Array<Pick<FounderIpContentSelection, "topic" | "audience" | "sourceEvidence" | "factBoundary" | "goalRelation">> {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => (line.includes("选题/钩子") || line.includes("最终选题")) && (line.includes("来源依据") || line.includes("来源")));
  if (headerIndex < 0) return [];
  const headers = cells(lines[headerIndex]).map(value => value.replace(/^#+\s*/, ""));
  const findAny = (...labels: string[]) => headers.findIndex(value => labels.includes(value));
  const topicIndex = findAny("选题/钩子", "最终选题");
  const audienceIndex = findAny("目标人群", "目标用户");
  const evidenceIndex = findAny("来源依据", "来源");
  const relationIndex = findAny("与获客目标的关系", "创作建议");
  const gateIndex = findAny("第一关证据状态", "第一关证据");
  const suggestionIndex = findAny("创作建议");
  if ([topicIndex, evidenceIndex, relationIndex].some(index => index < 0)) return [];
  const results: Array<Pick<FounderIpContentSelection, "topic" | "audience" | "sourceEvidence" | "factBoundary" | "goalRelation">> = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.includes("|")) break;
    const row = cells(line);
    const topic = row[topicIndex]?.replace(/^\d+[.、]\s*/, "").trim();
    if (!topic || /^[-:]+$/.test(topic)) continue;
    const boundary = [gateIndex >= 0 ? row[gateIndex] : "", suggestionIndex >= 0 ? row[suggestionIndex] : ""].filter(Boolean).join("；");
    results.push({ topic, audience: audienceIndex >= 0 ? row[audienceIndex] || "待补" : "待补", sourceEvidence: row[evidenceIndex] || "待核验", factBoundary: boundary || "未核验信息必须标记待确认", goalRelation: row[relationIndex] || "待补" });
  }
  return results.slice(0, 10);
}
