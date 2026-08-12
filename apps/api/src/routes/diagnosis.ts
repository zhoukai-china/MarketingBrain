import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider } from "@baolu/agent";
import type { SkillId } from "@baolu/shared";
import { loadSkillPrompt } from "@baolu/skills";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";

const diagnosisStartSchema = z.object({
  role: z.enum(["personal_ip", "local_business", "chain_brand"]),
  tenantName: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  city: z.string().optional().default(""),
  source: z.enum(["login", "re_diagnose"]).default("login"),
  eventCode: z.string().min(3).max(80).optional()
});

const diagnosisAnswerSchema = z.object({
  conversationId: z.string().min(1),
  answer: z.string().min(1),
  questionIndex: z.number().int().min(0).default(0)
});

const diagnosisGenerateReportSchema = z.object({
  conversationId: z.string().min(1)
});

const diagnosisHistorySchema = z.object({
  tenantId: z.string().optional(),
  userId: z.string().optional()
});

const flywheelDiagnosisSchema = z.object({
  mode: z.enum(["quick", "deep"]),
  category: z.string().optional().default(""),
  profile: z.object({
    businessName: z.string().optional().default(""),
    role: z.string().optional().default(""),
    industry: z.string().optional().default(""),
    city: z.string().optional().default(""),
    monthlyRevenue: z.string().optional().default("")
  }),
  answers: z.array(z.string()).default([])
});

interface DiagnosisSession {
  id: string;
  tenantRole: string;
  tenantName: string;
  industry: string;
  city: string;
  questions: string[];
  answers: string[];
  currentIndex: number;
  totalRounds: number;
}

const sessions: Map<string, DiagnosisSession> = new Map();

function maskPlanForDemo(planCode: string): string {
  const map: Record<string, string> = { local_standard: "local_standard", local_premium: "local_premium", ip_standard: "ip_standard", ip_premium: "ip_premium", chain_standard: "chain_standard", chain_premium: "chain_premium" };
  return map[planCode] ?? "local_standard";
}

const ROLE_LABELS: Record<string, string> = {
  personal_ip: "个人IP/知识付费",
  local_business: "本地生活商家",
  chain_brand: "连锁品牌"
};

const FLYWHEEL_DIAGNOSIS_SKILLS: Record<string, SkillId[]> = {
  short_video_ip: ["enterprise_diagnosis_orchestrator", "industry_benchmark_diagnosis", "ip_positioning", "baolu_content_creator", "baolu_review_engine", "moments_generator"],
  store_acquisition: ["enterprise_diagnosis_orchestrator", "industry_benchmark_diagnosis", "customer_acquisition_diagnosis", "store_data_analyst", "promotion_planner", "sales_growth_advisor"],
  team_management: ["enterprise_diagnosis_orchestrator", "industry_benchmark_diagnosis", "hr_director_consultant", "management_consultant", "delivery_standardization"],
  franchise: ["enterprise_diagnosis_orchestrator", "industry_benchmark_diagnosis", "franchise_recruitment_system", "franchise_compliance_checker", "customer_acquisition_diagnosis", "baolu_shangxueyuan"],
  revenue: ["enterprise_diagnosis_orchestrator", "industry_benchmark_diagnosis", "baolu_finance_advisor", "store_data_analyst", "menu_optimizer", "promotion_planner"],
  deep: [
    "enterprise_diagnosis_orchestrator",
    "industry_benchmark_diagnosis",
    "customer_acquisition_diagnosis",
    "store_data_analyst",
    "baolu_finance_advisor",
    "hr_director_consultant",
    "supply_chain_diagnosis",
    "delivery_standardization",
    "franchise_recruitment_system"
  ]
};

function selectFlywheelSkills(mode: string, category: string): SkillId[] {
  if (mode === "deep") return FLYWHEEL_DIAGNOSIS_SKILLS.deep;
  return FLYWHEEL_DIAGNOSIS_SKILLS[category] ?? FLYWHEEL_DIAGNOSIS_SKILLS.store_acquisition;
}

const INSUFFICIENT_DIAGNOSIS_ANSWERS = new Set([
  "不知道",
  "不清楚",
  "不确定",
  "没有",
  "无",
  "暂时没有",
  "还没想好",
  "说不清",
  "随便",
  "测试",
  "瞎写",
  "乱写",
  "test"
]);

function stripFlywheelAnswerPrefix(answer: string): string {
  const index = answer.indexOf("：");
  return (index >= 0 ? answer.slice(index + 1) : answer).replace(/\s+/g, " ").trim();
}

function isObviouslyInvalidFlywheelAnswer(answer: string): boolean {
  const value = stripFlywheelAnswerPrefix(answer);
  if (value.length < 2) return true;
  if (/^(.)\1{2,}$/.test(value)) return true;
  if (/^(test|asdf|qwer|demo|xxx|瞎写|乱写|随便|哈哈|呵呵)$/i.test(value)) return true;
  if (/^[0-9\s.,，。！？!?'"]{1,10}$/.test(value)) return true;
  return false;
}

function isMeaningfulFlywheelAnswer(answer: string): boolean {
  const value = stripFlywheelAnswerPrefix(answer);
  if (!value || isObviouslyInvalidFlywheelAnswer(value)) return false;
  if (INSUFFICIENT_DIAGNOSIS_ANSWERS.has(value)) return false;
  const chineseChars = value.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const digitChars = value.match(/\d/g)?.length ?? 0;
  const businessSignals = /营收|客流|客单|毛利|利润|成本|现金流|客户|成交|私信|加微|到店|复购|转介绍|门店|团队|员工|老板|岗位|投流|内容|视频|账号|主页|定位|案例|价格|供应链|库存|招商|加盟|线索|行业|城市|产品|服务|数据|转化|来源|投诉|好评/.test(value);
  const concreteSignals = /第|个|家|年|月|天|%|％|万|w|W|元|人|单|条|次|店|城/.test(value);
  return chineseChars >= 4 && value.length >= 10 && (businessSignals || digitChars > 0 || concreteSignals || value.length >= 22);
}

function inspectFlywheelAnswerQuality(data: z.infer<typeof flywheelDiagnosisSchema>) {
  const filledCount = data.answers.filter((answer) => stripFlywheelAnswerPrefix(answer)).length;
  const meaningfulCount = data.answers.filter(isMeaningfulFlywheelAnswer).length;
  const requiredCount = Math.max(data.mode === "deep" ? 5 : 4, Math.ceil(data.answers.length * 0.65));
  return {
    filledCount,
    meaningfulCount,
    requiredCount,
    enough: meaningfulCount >= requiredCount
  };
}

function sliceSkillSection(prompt: string, startTitle: string, endTitle?: string): string {
  const start = prompt.indexOf(startTitle);
  if (start < 0) return "";
  const end = endTitle ? prompt.indexOf(endTitle, start + startTitle.length) : -1;
  return prompt.slice(start, end > start ? end : undefined).trim();
}

function buildEnterpriseDiagnosisContext(prompt: string): string {
  const coreRules = prompt.slice(0, 9000);
  const deepDiagnosis = sliceSkillSection(prompt, "## 第五章 全企业深度诊断Skill", "## 第六章 诊断报告输出模板");
  const reportTemplates = sliceSkillSection(prompt, "## 第六章 诊断报告输出模板", "## 第七章 闯关解锁映射关系");
  const unlockBoundary = sliceSkillSection(prompt, "## 第七章 闯关解锁映射关系", "## 附录");

  return [coreRules, deepDiagnosis, reportTemplates, unlockBoundary]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 42000);
}

async function loadFlywheelSkillContext(skillIds: SkillId[]): Promise<string> {
  const snippets = await Promise.all(
    skillIds.slice(0, 7).map(async (skillId) => {
      try {
        const prompt = await loadSkillPrompt(skillId);
        const snippet =
          skillId === "enterprise_diagnosis_orchestrator"
            ? buildEnterpriseDiagnosisContext(prompt)
            : prompt.slice(0, 2400);
        return `【内部方法论：${skillId}】\n${snippet}`;
      } catch {
        return "";
      }
    })
  );
  return snippets.filter(Boolean).join("\n\n");
}

function generateConversationId(): string {
  return `diag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildDiagnosisQuestionPrompt(session: DiagnosisSession): string {
  const roleLabel = ROLE_LABELS[session.tenantRole] ?? "企业";
  const history = session.answers
    .map((a, i) => `Q${i + 1}: ${session.questions[i]}\nA${i + 1}: ${a}`)
    .join("\n");

  return [
    "你是思潼，企业AI增长飞轮的首席经营诊断顾问。",
    "你的任务是一次只问一个问题，像微信一对一聊天一样自然，最多25个汉字。",
    "",
    `用户角色：${roleLabel}`,
    `企业名称：${session.tenantName || "未提供"}`,
    `行业：${session.industry || "未提供"}`,
    `城市：${session.city || "未提供"}`,
    "",
    `当前是第${session.currentIndex + 1}轮，共${session.totalRounds}轮。`,
    "",
    history ? `已有问答：\n${history}\n` : "",
    "",
    "问题规则：",
    "- 一次只问一个核心问题，不要写Q1-Q5，不要让用户一次回答很多。",
    "- 问题要像真人聊天一样自然，不要像问卷。",
    "- 诊断顺序自然覆盖：新客来源→内容入口→咨询到成交→交付体验→复购口碑→团队执行→老板时间消耗→最想先用AI代劳的动作。",
    "- 问题必须匹配用户角色：个人IP、本地商家、连锁品牌的问法要不同。",
    "- 不要重复已经问过或用户已经回答过的信息。",
    "- 如果用户上一次回答含混，要追问具体事实；如果已经具体，就进入下一个关键事实。",
    "- 如果用户回答不知道、不确定、不清楚，不要继续问抽象问题，要换成能回答的具体场景。",
    "- 不要出现Markdown符号、序号。",
    "",
    "请输出下一句提问（纯文本，不超过25个汉字）："
  ].join("\n");
}

function buildDiagnosisReportPrompt(session: DiagnosisSession): string {
  const roleLabel = ROLE_LABELS[session.tenantRole] ?? "企业";
  const history = session.questions
    .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${session.answers[i] ?? "（未回答）"}`)
    .join("\n");

  return [
    "你是思潼，企业AI增长飞轮的首席经营诊断顾问。",
    `你刚完成了对${session.tenantName || "一家企业"}（${roleLabel}，${session.industry || "未指定行业"}，${session.city || "未指定城市"}）的${session.totalRounds}轮经营诊断。`,
    "",
    "以下是完整问答记录：",
    history,
    "",
    "请基于以上诊断结果，输出一份JSON格式的诊断报告。严格按以下JSON schema输出（不要输出任何JSON之外的内容）：",
    "",
    `{
      "summary": "企业现状一句话总结（30字以内）",
      "businessStatus": ["经营现状1", "经营现状2"],
      "coreIssues": ["现存漏洞1", "现存漏洞2", "现存漏洞3"],
      "profitGap": "盈利缺口或无法量化原因",
      "potentialRisks": ["潜在经营风险1", "潜在经营风险2"],
      "industryGap": ["行业差距1", "行业差距2"],
      "riskLevel": "低风险 | 中风险 | 高风险",
      "weaknessTags": ["acquisition", "delivery", "management"]
    }`,
    "",
    "weaknessTags说明（根据诊断结果打标签，可以有1-3个，按严重程度排序）：",
    "- acquisition：获客有问题（新客来源单一/线索转化率低/不会做内容/依赖老客复购）",
    "- delivery：交付有问题（服务标准不统一/加盟商培训不到位/客户体验不稳定/缺少SOP）",
    "- management：管理有问题（老板太累离不开/团队执行力差/决策靠个人经验/无法规模化复制）",
    "",
    "强制边界：",
    "- 诊断报告永久免费，不得写任何付费门槛、扣积分、消耗额度的话术。",
    "- 只客观陈列现状、漏洞、盈利缺口、潜在风险和行业差距。",
    "- 禁止输出执行步骤、活动方案、落地优化方法、路线图、任务清单、文案模板、人员分工、Agent解锁建议。",
    "- 不要输出 recommendedPlan、roadmap、actions、aiConsultants、onboardingChecklist 等字段。",
    "",
    "只输出JSON，不要有任何额外文字："
  ].join("\n");
}

async function buildFlywheelDiagnosisReportPrompt(data: z.infer<typeof flywheelDiagnosisSchema>): Promise<string> {
  const skillContext = await loadFlywheelSkillContext(selectFlywheelSkills(data.mode, data.category));
  const answerText = data.answers.map((answer, index) => `A${index + 1}: ${answer || "暂未确认"}`).join("\n");

  return [
    "你是思潼，企业AI增长飞轮的首席经营诊断顾问。",
    "你正在生成免费诊断报告，只能客观陈列经营现状、漏洞、盈利缺口、经营风险和行业差距。",
    "禁止输出执行步骤、活动方案、优化方法、任务清单、文案模板、人员分工、落地路线图、Agent、skill名称或垂直数字人推荐。",
    "内部专项方法论只用于提高判断深度，绝不能在用户可见报告里暴露。",
    "",
    "企业基础信息：",
    `企业/品牌：${data.profile.businessName || "暂未确认"}`,
    `用户类型：${data.profile.role || "暂未确认"}`,
    `行业：${data.profile.industry || "暂未确认"}`,
    `城市：${data.profile.city || "暂未确认"}`,
    `月营收口径：${data.profile.monthlyRevenue || "暂未确认"}`,
    `诊断模式：${data.mode === "deep" ? "全企业系统深度诊断" : "单项快速诊断"}`,
    `诊断类别：${data.category || "未指定"}`,
    "",
    "用户访谈内容：",
    answerText,
    "",
    "内部参考方法论：",
    skillContext || "无可加载专项方法论，按通用经营诊断框架输出。",
    "",
    "请只输出 JSON，不要输出 JSON 之外的文字。JSON schema 如下：",
    `{
      "summary": "一句话经营结论，40字以内",
      "businessStatus": ["经营现状1", "经营现状2", "经营现状3"],
      "currentLeaks": ["现存漏洞1", "现存漏洞2", "现存漏洞3"],
      "profitGap": "盈利缺口：说明可量化估算或无法量化的原因",
      "potentialRisks": ["潜在风险1", "潜在风险2", "潜在风险3"],
      "industryGap": ["行业差距1", "行业差距2", "行业差距3"],
      "riskLevel": "低风险 | 中风险 | 高风险",
      "weaknessTags": ["最主要短板1", "最主要短板2", "最主要短板3"],
      "scores": [
        { "dimension": "获客", "score": 0, "status": "红灯 | 黄灯 | 绿灯", "evidence": "判断依据" }
      ],
      "missingData": ["还缺少的数据1", "还缺少的数据2"]
    }`,
    "",
    "评分要求：score 为 0-100；深度诊断必须覆盖营收、获客、团队、门店运营、供应链、招商拓店六个维度；单项诊断至少覆盖3个相关维度。",
    "事实铁律：只能根据用户访谈内容判断。没有给出的数据写缺失，不能编造。",
    "报告语言要像专业咨询体检报告：客观、克制、量化、分层；不写“建议、应该、可以尝试”。"
  ].join("\n");
}

export async function registerDiagnosisRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.post("/diagnosis/flywheel-report", async (request, reply) => {
    const parsed = flywheelDiagnosisSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const quality = inspectFlywheelAnswerQuality(parsed.data);
    if (!quality.enough) {
      return reply.code(422).send({
        error: "diagnosis_information_insufficient",
        message: `有效经营信息不足，当前只有${quality.meaningfulCount}/${quality.requiredCount}条，至少补齐到${quality.requiredCount}条真实业务事实后才能生成专业诊断报告。`,
        quality
      });
    }

    try {
      const reportPrompt = await buildFlywheelDiagnosisReportPrompt(parsed.data);
      const llmResponse = await provider.complete([{ role: "user", content: reportPrompt }]);
      const rawContent = llmResponse ?? "";
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { report: buildFallbackFlywheelReport(parsed.data) };
      }
      return { report: JSON.parse(jsonMatch[0]) };
    } catch {
      return { report: buildFallbackFlywheelReport(parsed.data) };
    }
  });

  // Start a new diagnosis session
  app.post("/diagnosis/start", async (request, reply) => {
    const parsed = diagnosisStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const conversationId = generateConversationId();
    const session: DiagnosisSession = {
      id: conversationId,
      tenantRole: data.role,
      tenantName: data.tenantName,
      industry: data.industry,
      city: data.city,
      questions: [],
      answers: [],
      currentIndex: 0,
      totalRounds: 8
    };

    // Generate first question via LLM
    const firstQuestionPrompt = buildDiagnosisQuestionPrompt(session);

    try {
      const llmResponse = await provider.complete([{ role: "user", content: firstQuestionPrompt }]);
      const firstQuestion = (llmResponse ?? "你好！请先简单介绍一下你的业务情况吧？").trim();
      session.questions.push(firstQuestion);
      sessions.set(conversationId, session);

      return {
        conversationId,
        question: firstQuestion,
        questionIndex: 0,
        totalRounds: session.totalRounds,
        role: data.role,
        tenantName: data.tenantName
      };
    } catch {
      // Fallback: use template questions
      const fallbackQuestion = "欢迎！先简单介绍一下你的业务情况吧？";
      session.questions.push(fallbackQuestion);
      sessions.set(conversationId, session);
      return {
        conversationId,
        question: fallbackQuestion,
        questionIndex: 0,
        totalRounds: session.totalRounds,
        role: data.role,
        tenantName: data.tenantName
      };
    }
  });

  // Answer a question and get next question
  app.post("/diagnosis/answer", async (request, reply) => {
    const parsed = diagnosisAnswerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const session = sessions.get(parsed.data.conversationId);
    if (!session) {
      return reply.code(404).send({ error: "session_not_found", message: "诊断会话已过期，请重新开始" });
    }

    // Record answer
    session.answers[parsed.data.questionIndex] = parsed.data.answer;

    // Check if diagnosis is complete
    if (session.answers.length >= session.totalRounds && session.answers.every(a => a?.trim())) {
      sessions.set(parsed.data.conversationId, session);
      return {
        conversationId: session.id,
        complete: true,
        totalRounds: session.totalRounds,
        message: "诊断完成，正在生成报告..."
      };
    }

    // Generate next question
    session.currentIndex = session.answers.length;
    const nextPrompt = buildDiagnosisQuestionPrompt(session);

    try {
      const llmResponse = await provider.complete([{ role: "user", content: nextPrompt }]);
      const nextQuestion = (llmResponse ?? "还有哪些具体信息可以告诉我？").trim();
      session.questions.push(nextQuestion);
      sessions.set(parsed.data.conversationId, session);

      return {
        conversationId: session.id,
        question: nextQuestion,
        questionIndex: session.questions.length - 1,
        totalRounds: session.totalRounds,
        progress: { current: session.answers.length, total: session.totalRounds }
      };
    } catch {
      const fallbackQuestion = "好的，还有哪些具体信息可以补充？";
      session.questions.push(fallbackQuestion);
      sessions.set(parsed.data.conversationId, session);
      return {
        conversationId: session.id,
        question: fallbackQuestion,
        questionIndex: session.questions.length - 1,
        totalRounds: session.totalRounds,
        progress: { current: session.answers.length, total: session.totalRounds }
      };
    }
  });

  // Generate final diagnosis report
  app.post("/diagnosis/generate-report", async (request, reply) => {
    const parsed = diagnosisGenerateReportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const session = sessions.get(parsed.data.conversationId);
    if (!session) {
      return reply.code(404).send({ error: "session_not_found", message: "诊断会话已过期" });
    }

    try {
      // Ensure all questions have answers
      const filledAnswers = session.questions.map((_, i) => session.answers[i] ?? "（未回答）");
      session.answers = filledAnswers;

      const reportPrompt = buildDiagnosisReportPrompt(session);

      const llmResponse = await provider.complete([{ role: "user", content: reportPrompt }]);
      const rawContent = llmResponse ?? "";
      // Extract JSON from response (may contain markdown code fences)
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Fallback report
        return {
          conversationId: session.id,
          report: buildFallbackReport(session)
        };
      }

      const report = JSON.parse(jsonMatch[0]);

      // Save report to DB if in database mode
      try {
        const context = await resolveRequestContext(request.headers).catch(() => null);
        if (context && env.DATA_MODE === "database") {
          // TODO: Save diagnosis report to DB when DiagnosisReport model is added
          void context;
        }
      } catch {
        // non-critical
      }

      return {
        conversationId: session.id,
        report: {
          ...report,
          tenantRole: session.tenantRole,
          tenantName: session.tenantName,
          industry: session.industry,
          city: session.city,
          questions: session.questions,
          answers: session.answers
        }
      };
    } catch {
      return {
        conversationId: session.id,
        report: buildFallbackReport(session)
      };
    } finally {
      sessions.delete(parsed.data.conversationId);
    }
  });

  // Get diagnosis history for a tenant
  app.get("/diagnosis/history", async (request, reply) => {
    if (env.DATA_MODE === "demo") {
      return { dataMode: "demo", reports: [] };
    }

    const context = await resolveRequestContext(request.headers).catch(() => null);
    if (!context) {
      return reply.code(401).send({ error: "login_required" });
    }
    const reports: Array<Record<string,unknown>> = [];
    // TODO: support database mode query once DiagnosisReport model is added

    return {
      dataMode: "database",
      reports
    };
  });
}

function buildFallbackReport(session: DiagnosisSession) {
  const roleLabel = ROLE_LABELS[session.tenantRole] ?? "企业";
  return {
    summary: `${session.tenantName || "企业"}已完成${roleLabel}经营信息初筛。`,
    businessStatus: [
      `${roleLabel}，行业：${session.industry || "暂未确认"}，城市：${session.city || "暂未确认"}。`,
      "当前经营数据仍需要进一步结构化沉淀。"
    ],
    coreIssues: ["获客来源和成交转化信息不完整", "团队或流程标准化信息不足", "缺少可持续复盘的数据口径"],
    opportunities: [],
    recommendedPlan: "",
    recommendReason: "",
    profitGap: "当前缺少营收、客流、客单和成本数据，无法准确量化盈利缺口。",
    potentialRisks: ["经营问题可能被误判为单一流量问题", "缺少周期性复盘口径会影响后续判断"],
    industryGap: ["成熟商家通常会持续记录来源、咨询、成交、复购和成本数据", "当前信息沉淀与系统化经营仍有差距"],
    riskLevel: "中风险",
    roadmap: [],
    aiConsultants: [],
    onboardingChecklist: [],
    weaknessTags: ["acquisition", "delivery"],
    tenantRole: session.tenantRole,
    tenantName: session.tenantName,
    industry: session.industry,
    city: session.city,
    questions: session.questions,
    answers: session.answers
  };
}

function buildFallbackFlywheelReport(data: z.infer<typeof flywheelDiagnosisSchema>) {
  const filledCount = data.answers.filter((answer) => answer.trim()).length;
  const riskLevel = filledCount <= 2 ? "高风险" : filledCount <= 4 ? "中风险" : "低风险";
  const categoryLabel = data.mode === "deep" ? "全企业系统" : "单项";

  return {
    summary: `${data.profile.businessName || "企业"}已完成${categoryLabel}经营信息初筛，当前主要风险来自数据和链路不完整。`,
    businessStatus: [
      `${data.profile.role || "暂未确认用户类型"}，行业：${data.profile.industry || "暂未确认"}，城市：${data.profile.city || "暂未确认"}。`,
      `月营收口径：${data.profile.monthlyRevenue || "暂未确认"}。`,
      `本次已完成${filledCount}轮经营访谈，仍需用真实业务数据校准。`
    ],
    currentLeaks: [
      "获客、咨询、成交、复购之间的连续数据仍不完整。",
      "当前描述偏经营感受，缺少可追踪指标支撑。",
      "关键责任人、检查频率和复盘口径尚未形成稳定闭环。"
    ],
    profitGap: "当前缺少客流、咨询、成交、毛利和成本结构数据，无法准确量化盈利缺口。",
    potentialRisks: [
      "如果继续按经验判断，容易把系统性问题误判为单一流量问题。",
      "缺少统一数据口径会影响后续复盘，导致改动后无法判断效果。",
      "团队执行或承接流程不清晰时，新增流量可能继续漏损。"
    ],
    industryGap: [
      "成熟商家通常按来源、咨询、到店、成交、复购和成本持续记录。",
      "多门店或连锁品牌还会把门店运营、供应链、招商拓店放进同一张经营看板。",
      "当前信息沉淀与可复制经营体系仍有差距。"
    ],
    riskLevel,
    weaknessTags: ["数据口径", "获客成交", "复盘闭环"],
    scores: [
      { dimension: "获客", score: 58, status: "黄灯", evidence: "已有描述，但来源和转化数字不足。" },
      { dimension: "成交", score: 55, status: "黄灯", evidence: "承接和成交断点需要进一步量化。" },
      { dimension: "复盘", score: 42, status: "红灯", evidence: "尚未看到稳定复盘数据口径。" }
    ],
    missingData: ["近30天曝光/咨询/到店/成交数据", "主推产品毛利", "团队执行责任人", "复盘频率"]
  };
}



