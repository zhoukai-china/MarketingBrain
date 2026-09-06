import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , sourceRootArg, reportPathArg] = process.argv;
if (!sourceRootArg || !reportPathArg) {
  throw new Error('Usage: node scripts/audit-workbuddy-skill-intake.mjs <source-root> <report-path>');
}

const sourceRoot = path.resolve(sourceRootArg);
const reportPath = path.resolve(reportPathArg);
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.py', '.js', '.ts', '.ps1', '.sh', '.csv']);
const secretPattern = /gk_live_[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|api[_-]?key\s*[:=]\s*["'][^"']{8,}/gi;
const piiPattern = /(?<!\d)1[3-9]\d{9}(?!\d)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(fullPath) : [fullPath];
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const redactFingerprints = (content, pattern) => [...content.matchAll(pattern)].map((match) => sha256(match[0]).slice(0, 16));
const frontmatter = (content, key) => content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null;
const normalizeId = (id) => id.replace(/-/g, '_');
const repoSkillIds = new Set([
  ...fs.readdirSync(path.join(process.cwd(), 'packages/skills/skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  ...fs.readdirSync(path.join(process.cwd(), 'mcp-skills/skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
]);
const codexSkillIds = new Set(fs.readdirSync('C:/Users/book/.codex/skills', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));

const skills = walk(sourceRoot).filter((file) => path.basename(file).toLowerCase() === 'skill.md').map((skillPath) => {
  const skillDir = path.dirname(skillPath);
  const files = walk(skillDir);
  const skillContent = fs.readFileSync(skillPath, 'utf8');
  const aggregate = files.reduce((result, file) => {
    const stat = fs.statSync(file);
    result.bytes += stat.size;
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      const content = fs.readFileSync(file, 'utf8');
      result.secretFingerprints.push(...redactFingerprints(content, secretPattern));
      result.piiFingerprints.push(...redactFingerprints(content, piiPattern));
    }
    return result;
  }, { bytes: 0, secretFingerprints: [], piiFingerprints: [] });
  const id = frontmatter(skillContent, 'name') ?? path.basename(skillDir);
  const hasSources = /来源|source|参考|reference|官方|法规|文献/i.test(skillContent);
  const hasVersionDate = /20\d{2}[-/.年]|版本|version/i.test(skillContent);
  const hasBoundaries = /不得|禁止|仅限|不执行|未经.*确认|待补/i.test(skillContent);
  const hasInputs = /输入|需要.*信息|事实/i.test(skillContent);
  const hasOutputs = /输出|交付|格式/i.test(skillContent);
  const hasEval = /eval|评测|测试用例|验收/i.test(skillContent);
  const hasContract = /contract|契约|schema|字段/i.test(skillContent);
  const externalActions = /充值|付款|自动投放|发布|下单|提交计划|执行投放/i.test(skillContent);
  const factualClaims = (skillContent.match(/\d+(?:\.\d+)?(?:%|元|万|亿|天|条|倍)/g) ?? []).length;
  const exactDuplicates = [id, normalizeId(id)].filter((candidate) => repoSkillIds.has(candidate) || codexSkillIds.has(candidate));
  let score = 30 + (frontmatter(skillContent, 'name') ? 8 : 0) + (frontmatter(skillContent, 'description') ? 8 : 0)
    + (hasInputs ? 6 : 0) + (hasOutputs ? 6 : 0) + (hasBoundaries ? 8 : 0) + (hasSources ? 8 : 0) + (hasVersionDate ? 4 : 0)
    + (hasContract ? 8 : 0) + (hasEval ? 8 : 0) - (externalActions ? 8 : 0) - (factualClaims > 3 && !hasSources ? 10 : 0);
  score = Math.max(0, Math.min(100, score));
  const risks = [];
  if (aggregate.secretFingerprints.length) risks.push('P0_secret_pattern');
  if (aggregate.piiFingerprints.length) risks.push('P1_possible_pii');
  if (!hasSources && factualClaims > 0) risks.push('P1_unverifiable_factual_claims');
  if (externalActions && !hasBoundaries) risks.push('P1_external_action_boundary_missing');
  if (!hasContract || !hasEval) risks.push('P2_missing_contract_or_eval');
  if (exactDuplicates.length) risks.push('P2_existing_skill_overlap');
  return {
    id,
    sourcePath: skillDir,
    relativeSourcePath: path.relative(sourceRoot, skillDir).replaceAll('\\', '/'),
    modifiedAt: fs.statSync(skillPath).mtime.toISOString(),
    skillMdSha256: sha256(skillContent),
    fileCount: files.length,
    totalBytes: aggregate.bytes,
    description: frontmatter(skillContent, 'description'),
    staticQuality: { score, hasSources, hasVersionDate, hasBoundaries, hasInputs, hasOutputs, hasContract, hasEval, factualClaims, externalActions },
    riskCodes: risks,
    duplicateIds: exactDuplicates,
    secretFingerprints: [...new Set(aggregate.secretFingerprints)],
    piiFingerprints: [...new Set(aggregate.piiFingerprints)],
    filePaths: files.map((file) => path.relative(skillDir, file).replaceAll('\\', '/')).sort(),
  };
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoot,
  candidateCount: skills.length,
  safeForCopyCount: skills.filter((skill) => skill.secretFingerprints.length === 0 && skill.piiFingerprints.length === 0 && skill.riskCodes.every((risk) => !risk.startsWith('P0_') && !risk.startsWith('P1_'))).length,
  skills: skills.sort((a, b) => a.relativeSourcePath.localeCompare(b.relativeSourcePath)),
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ candidateCount: report.candidateCount, safeForCopyCount: report.safeForCopyCount, reportPath }, null, 2));
