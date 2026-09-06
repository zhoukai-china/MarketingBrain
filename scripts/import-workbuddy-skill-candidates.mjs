import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , sourceRootArg, auditPathArg, targetRootArg, approvedPathArg, mode] = process.argv;
if (!sourceRootArg || !auditPathArg || !targetRootArg || !approvedPathArg) {
  throw new Error('Usage: node scripts/import-workbuddy-skill-candidates.mjs <source-root> <audit-json> <target-root> <approved-json> [--verify]');
}

const sourceRoot = path.resolve(sourceRootArg);
const auditPath = path.resolve(auditPathArg);
const targetRoot = path.resolve(targetRootArg);
const approvedPath = path.resolve(approvedPathArg);
const isInside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
if (!isInside(sourceRoot, sourceRoot) || !isInside(path.resolve('mcp-skills/candidates'), targetRoot)) {
  throw new Error('Source and target must be the approved Desktop root and mcp-skills/candidates subtree.');
}

const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const approved = JSON.parse(fs.readFileSync(approvedPath, 'utf8'));
if (!Array.isArray(approved.skillIds) || !approved.skillIds.length) {
  throw new Error('approved-json must contain a non-empty skillIds array.');
}
const byId = new Map(audit.skills.map((skill) => [skill.id, skill]));
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copyTree = (source, target) => {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`Unsupported filesystem entry: ${from}`);
  }
};
const copied = [];

for (const id of approved.skillIds) {
  const skill = byId.get(id);
  if (!skill) throw new Error(`Unknown skill id in approved list: ${id}`);
  if (skill.riskCodes.some((risk) => risk.startsWith('P0_') || risk.startsWith('P1_'))) {
    throw new Error(`Refusing to import unresolved P0/P1 candidate: ${id}`);
  }
  const sourcePath = path.resolve(skill.sourcePath);
  if (!isInside(sourceRoot, sourcePath)) throw new Error(`Source path escapes approved root: ${id}`);
  const targetPath = path.resolve(targetRoot, id);
  if (!isInside(targetRoot, targetPath)) throw new Error(`Target path escapes candidate root: ${id}`);
  if (fs.existsSync(targetPath)) {
    if (mode !== '--verify') throw new Error(`Candidate target already exists: ${targetPath}`);
  } else {
    copyTree(sourcePath, targetPath);
  }
  const targetSkill = path.join(targetPath, 'SKILL.md');
  const copiedHash = sha256File(targetSkill);
  if (copiedHash !== skill.skillMdSha256) {
    throw new Error(`Hash verification failed for ${id}`);
  }
  copied.push({
    id,
    sourcePath,
    relativeSourcePath: skill.relativeSourcePath,
    targetPath,
    skillMdSha256: copiedHash,
    fileCount: skill.fileCount,
    lifecycle: 'candidate_p2_quality_debt',
    productionRegistration: 'not_registered',
    recoveryPath: `C:\\Users\\book\\Documents\\管理场景AI改造\\archive\\workbuddy-skill-intake-20260820\\originals\\${skill.relativeSourcePath.replaceAll('/', '\\')}`,
  });
}

const manifestPath = path.join(targetRoot, 'intake-manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'WorkBuddy Desktop intake 2026-08-20',
  lifecycle: 'candidate_p2_quality_debt',
  productionRegistration: 'not_registered',
  restoreProcedure: 'Copy the matching original from recoveryPath back to originalDesktopPath only after a human review; do not register this candidate directly.',
  skills: copied,
}, null, 2)}\n`);
console.log(JSON.stringify({ copiedCount: copied.length, manifestPath, copied }, null, 2));
