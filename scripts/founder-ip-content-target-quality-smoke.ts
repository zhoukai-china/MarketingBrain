import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFounderIpContentPrompt,
  finalizeFounderIpGeneratedContent,
  validateFounderIpGeneratedContent,
  validateFounderIpGeneratedSemantics
} from "../apps/api/src/services/founder-ip-content-generation.ts";
import type { FounderIpContentDraft } from "../apps/api/src/services/founder-ip-content-drafts.ts";

const dedicatedPrompt = readFileSync(new URL("../packages/skills/skills/founder_ip_content_creator/prompt.md", import.meta.url), "utf8");
const dedicatedContract = readFileSync(new URL("../packages/skills/skills/founder_ip_content_creator/contract.json", import.meta.url), "utf8");
const dedicatedMcpSkill = readFileSync(new URL("../mcp-skills/skills/founder_ip_content_creator/SKILL.md", import.meta.url), "utf8");

assert.ok(dedicatedPrompt.length <= 900, `FIP 专属 Prompt 必须保持精简，当前 ${dedicatedPrompt.length} 字符会放大 Pro 高推理耗时`);
assert.ok(dedicatedContract.length <= 900, `FIP 专属质量契约必须保持精简，当前 ${dedicatedContract.length} 字符会稀释最终答案预算`);
assert.ok(dedicatedMcpSkill.length <= 520, `FIP MCP Skill 必须保持精简，当前 ${dedicatedMcpSkill.length} 字符`);
for (const source of [dedicatedPrompt, dedicatedMcpSkill]) {
  assert.match(source, /最终答案优先/, "FIP 专属上下文必须明确最终答案优先，避免高推理耗尽 final content");
  assert.match(source, /600.{0,4}900/, "FIP 内容成品必须有明确而可交付的长度预算");
}

const targetRules = {
  franchise: { label: "招商加盟", cta: "了解加盟条件并申请加盟评估" },
  store_visit: { label: "C端团购到店", cta: "领取团购后预约到店体验" },
  student: { label: "学员招募", cta: "咨询课程并预约试听" },
  partner: { label: "合作方招募", cta: "提交合作意向并进行资格判断" }
} as const;

function draft(target: keyof typeof targetRules, suffix: string): FounderIpContentDraft {
  return {
    id: `draft-${target}-${suffix}`, subjectId: "subject-a", target, identity: "测试创始人", targetCustomer: `${target}目标客户${suffix}`,
    acquisitionGoal: `${target}线索${suffix}`, offer: "已确认的服务条件", accountStage: "稳定更新", industry: "本地生活服务",
    topic: "为什么做决定前要先问清3个条件", audience: `${target}目标客户${suffix}`, sourceEvidence: `真实录音证据${suffix}`,
    factBoundary: "待核验的案例、数字和政策不得写成事实", goalRelation: `${targetRules[target].label}要先建立信任再承接线索`,
    content: "", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z"
  };
}

function validContent(current: FounderIpContentDraft): string {
  const rule = targetRules[current.target];
  return [
    `# ${current.topic}`,
    `目标人群：${current.audience}。本轮获客目标：${current.acquisitionGoal}。`,
    `来源依据与事实边界：${current.sourceEvidence}；${current.factBoundary}。`,
    `与获客目标的关系：${current.goalRelation}。`,
    "3秒开场：别急着做决定，先把与你有关的三个条件问清楚。",
    `核心表达：站在${rule.label}的真实决策场景里，先说明判断顺序，再用已确认的服务条件解释为什么要先核对边界；没有证据的案例、收益和数字一律不加入。`,
    `承接动作：${rule.cta}。`,
    "一次性待补项：可公开的案例、数字和政策需要先核验。"
  ].join("\n\n");
}

for (const target of Object.keys(targetRules) as Array<keyof typeof targetRules>) {
  for (const suffix of ["a", "b"]) {
    const current = draft(target, suffix);
    assert.match(buildFounderIpContentPrompt(current), new RegExp(targetRules[target].label), `${target} 必须进入专属生成契约`);
    assert.equal(validateFounderIpGeneratedContent(current, validContent(current)), undefined, `${target}/${suffix} 的合格内容必须通过最终校验`);
  }
}

const sameTopic = (Object.keys(targetRules) as Array<keyof typeof targetRules>).map((target) => validContent(draft(target, "same")));
assert.equal(new Set(sameTopic).size, 4, "同一选题切换四目标后，CTA、受众与承接必须不同");
assert.match(validateFounderIpGeneratedContent(draft("franchise", "x"), validContent(draft("store_visit", "x"))) ?? "", /当前选题|目标人群|招商加盟|其他获客目标/, "跨目标内容不得通过招商加盟最终校验");
assert.match(validateFounderIpGeneratedContent(draft("student", "x"), `${validContent(draft("student", "x"))}\n已经帮助30人报名`) ?? "", /未经证实的案例、效果或数字/, "待核验来源不得被扩写成数字案例");

const paraphrasedEvidenceDraft = draft("franchise", "anchor");
const paraphrasedEvidenceModelContent = [
  `# ${paraphrasedEvidenceDraft.topic}`,
  `目标人群：${paraphrasedEvidenceDraft.audience}，也就是${paraphrasedEvidenceDraft.targetCustomer}。`,
  "3秒开场：做决定之前，真正要问的不是宣传口号，而是与你经营能力相关的三个条件。",
  "核心表达：先看自己的经营经验、可投入精力和真实承接能力，再判断项目条件是否值得进一步了解。创始人已经说明，具体条件仍需在沟通中确认，不能把未核验案例和数字写成事实。",
  "这条内容帮助创业者形成咨询前的判断顺序，而不是催促用户立即签约。",
  "承接动作：了解加盟条件并申请加盟评估。",
  "待补/待核验：公开案例、数字和政策均待核验；当前不作收益承诺。",
  "下一步：在内容系统继续编辑，确认后再进入投流方案预览。"
].join("\n\n");
assert.equal(validateFounderIpGeneratedSemantics(paraphrasedEvidenceDraft, paraphrasedEvidenceModelContent), undefined, "模型正文保留选题、人群、CTA 与事实边界时，语义门禁应通过");
assert.match(validateFounderIpGeneratedContent(paraphrasedEvidenceDraft, paraphrasedEvidenceModelContent) ?? "", /来源依据或与获客目标的关系/, "模型改写证据原文时，严格最终契约必须先失败");
const finalized = finalizeFounderIpGeneratedContent(paraphrasedEvidenceDraft, paraphrasedEvidenceModelContent);
assert.equal(validateFounderIpGeneratedContent(paraphrasedEvidenceDraft, finalized), undefined, "服务端重建已确认字段后，最终交付必须满足精确可追溯契约");
assert.ok(finalized.includes(paraphrasedEvidenceDraft.sourceEvidence) && finalized.includes(paraphrasedEvidenceDraft.goalRelation), "最终交付必须逐字保留来源依据与目标关系");
assert.match(finalized, /真正要问的不是宣传口号/, "服务端补齐结构化字段时不得替换真实模型正文");
assert.match(validateFounderIpGeneratedSemantics(paraphrasedEvidenceDraft, `${paraphrasedEvidenceModelContent}\n团购核销后到店`) ?? "", /其他获客目标/, "确定性字段补齐不得掩盖模型正文的跨目标错误");

console.log("founder_ip_content_target_quality_smoke:PASS");
