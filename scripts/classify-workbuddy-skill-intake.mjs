import fs from 'node:fs';
import path from 'node:path';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) throw new Error('Usage: node scripts/classify-workbuddy-skill-intake.mjs <audit-json> <output-json>');

const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const platformOrSemanticReview = new Set([
  'skill-distiller',
  'wechat-xhs-content-line',
  'xiaodian-growth',
  'api-multisource-adapter',
  'baolu-dou-plus',
]);

for (const skill of report.skills) {
  const risks = new Set(skill.riskCodes);
  if (risks.has('P0_secret_pattern') || risks.has('P1_possible_pii')) {
    skill.decision = { action: '不应入库', lifecycle: 'desktop_quarantined_sensitive', reason: '疑似密钥或个人信息；先脱敏并完成来源审计。' };
  } else if (skill.id === 'dou-plus-ads' || risks.has('P2_existing_skill_overlap')) {
    skill.decision = { action: '合并候选', lifecycle: 'desktop_overlap_review', reason: '与已有 Codex/仓库专项能力重叠；只允许差异评审，不得双注册。' };
  } else if (platformOrSemanticReview.has(skill.id)) {
    skill.decision = { action: '保留待平台审计', lifecycle: 'desktop_platform_review', reason: '不是纯行业能力或与现有通用能力语义接近；需独立产品/平台评审。' };
  } else if (risks.has('P1_unverifiable_factual_claims') || risks.has('P1_external_action_boundary_missing')) {
    skill.decision = { action: '修改后保留', lifecycle: 'desktop_p1_hold', reason: '先补可追溯来源/有效日期或预览与确认边界；未完成前不迁移。' };
  } else {
    skill.decision = { action: '修改后保留', lifecycle: 'candidate_p2_quality_debt', reason: '无 P0/P1 敏感命中，已迁入非运行时候选区；仍须补 contract/sample/Eval。' };
  }
}
report.decisionPolicy = 'Decision reflects this 2026-08-20 intake only. No decision implies production registration or authorization.';
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ candidateCount: report.skills.length, outputPath }, null, 2));
