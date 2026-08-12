import type { FastifyInstance } from "fastify";
import { PLANS } from "@baolu/shared";
import { getAllowedSkills, SKILL_MANIFESTS } from "@baolu/skills";

const ACTIVE_SKILL_IDS = new Set([
  "general_qa",
  "customer_acquisition_diagnosis",
  "ip_positioning",
  "baolu_content_creator",
  "baolu_dreamina_video",
  "baolu_finance_advisor",
  "baolu_live_review_engine",
  "baolu_review_engine",
  "baolu_shangxueyuan",
  "delivery_standardization",
  "hr_director_consultant",
  "live_script_planner",
  "moments_generator",
  "sales_growth_advisor",
  "yuanshen_factory",
  "ai_daily_brief",
  "brand_consultant",
  "digital_twin_factory",
  "franchise_compliance_checker",
  "franchise_recruitment_system",
  "management_consultant",
  "menu_optimizer",
  "multi_store_dashboard",
  "opc_client_education",
  "opc_delivery_system",
  "opc_pricing_model",
  "promotion_planner",
  "store_data_analyst"
]);
export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/plans", async () => ({
    plans: Object.values(PLANS)
  }));

  app.get("/skills", async () => ({
    skills: Object.values(SKILL_MANIFESTS).filter((skill) => ACTIVE_SKILL_IDS.has(skill.id))
  }));

  app.get<{
    Params: { planCode: keyof typeof PLANS };
  }>("/plans/:planCode/skills", async (request, reply) => {
    const plan = PLANS[request.params.planCode];
    if (!plan) {
      return reply.code(404).send({ error: "plan_not_found" });
    }
    return {
      plan,
      skills: getAllowedSkills(plan.code).filter((skill) => ACTIVE_SKILL_IDS.has(skill.id))
    };
  });
}
