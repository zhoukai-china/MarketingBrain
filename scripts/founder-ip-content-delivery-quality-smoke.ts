import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFounderIpSafeFallbackDraft, validateFounderIpContentResult, type FounderIpContentDraft } from "../apps/web/src/components/acquisition/founderIpContentDraft.ts";

const contentWorkbench = readFileSync(new URL("../apps/web/src/components/acquisition/ContentSystemWorkbench.tsx", import.meta.url), "utf8");
const draftHelper = readFileSync(new URL("../apps/web/src/components/acquisition/founderIpContentDraft.ts", import.meta.url), "utf8");

assert.match(contentWorkbench, /validateFounderIpContentResult/, "FIP 内容最终交付必须在页面层校验选题、目标、人群和事实边界，不能直接展示通用内容包");
assert.match(draftHelper, /不能作为当前获客目标的内容草稿/, "错目标或待验证信息越界时，必须阻断保存和投流预览");

const draft = (target: FounderIpContentDraft["target"]): FounderIpContentDraft => ({ id: `draft-${target}`, subjectId: "subject-a", target, identity: "测试创始人", targetCustomer: `${target}-人群`, acquisitionGoal: `${target}-线索`, offer: "", accountStage: "", industry: "测试行业", topic: `${target}-选题`, audience: `${target}-人群`, sourceEvidence: "已确认录音", factBoundary: "已核验", goalRelation: `${target}-目标关系`, content: "", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" });

for (const target of ["franchise", "store_visit", "student", "partner"] as const) {
  const current = draft(target);
  const fallback = buildFounderIpSafeFallbackDraft(current);
  const cta = { franchise: "加盟咨询", store_visit: "到店预约", student: "课程咨询", partner: "合作咨询" }[target];
  const valid = [current.topic, current.audience, current.targetCustomer, current.acquisitionGoal, current.sourceEvidence, current.goalRelation, cta, "待补信息保持待确认"].join("\n");
  assert.match(fallback, new RegExp(current.topic), `${target} 待补草稿必须保留选题`);
  assert.match(fallback, new RegExp(current.acquisitionGoal), `${target} 待补草稿必须保留获客目标`);
  assert.equal(validateFounderIpContentResult(current, valid), undefined, `${target} 的匹配交付应通过`);
}

assert.match(validateFounderIpContentResult(draft("franchise"), ["错误选题", "franchise-人群", "franchise-线索"].join("\n")) ?? "", /不能作为当前获客目标的内容草稿/, "错选题必须拦截");
const pendingFranchise = { ...draft("franchise"), factBoundary: "待验证" };
const factSafeComplete = [pendingFranchise.topic, pendingFranchise.audience, pendingFranchise.targetCustomer, pendingFranchise.acquisitionGoal, pendingFranchise.sourceEvidence, pendingFranchise.goalRelation, "加盟咨询", "待核验信息保持待确认", "完整内容执行包"].join("\n");
assert.equal(validateFounderIpContentResult(pendingFranchise, factSafeComplete), undefined, "有待验证来源但保留事实边界的内容成品应允许交付");
assert.match(validateFounderIpContentResult(draft("student"), ["student-选题", "student-人群", "student-线索", "招商加盟"].join("\n")) ?? "", /不能作为当前获客目标的内容草稿/, "跨目标承接动作必须拦截");

console.log("founder_ip_content_delivery_quality_smoke:PASS");
