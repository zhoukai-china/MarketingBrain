const fs = require("fs");
const diff = fs.readFileSync("_full_diff.sql", "utf8");

const newTables = [
  "Distributor", "DistroCustomer", "DistroOrder", "DistroCommissionLog",
  "DistroWithdrawal", "CommissionRule", "ShareLink", "RiskRule", "RiskEvent",
  "AuditLog", "Role", "Permission", "RolePermission", "UserRoleAssignment",
  "AccessPolicy", "RolePolicy", "SsoConfig"
];

// Split the diff into logical blocks (CREATE TABLE + its indexes + ALTER TABLE FK)
const blocks = [];
let currentBlock = [];
let reading = false;

const lines = diff.split("\n");

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  
  // Start of CREATE TABLE
  if (/^CREATE TABLE /.test(l)) {
    if (currentBlock.length > 0) blocks.push(currentBlock.join("\n"));
    currentBlock = [l];
    reading = true;
    continue;
  }
  
  // Start of CREATE UNIQUE INDEX / CREATE INDEX
  if (/^CREATE (UNIQUE )?INDEX /.test(l)) {
    if (currentBlock.length > 0 && reading) {
      currentBlock.push(l);
      // Read until semicolon
      while (i < lines.length && !lines[i].trim().endsWith(";")) {
        i++;
        currentBlock.push(lines[i]);
      }
    }
    continue;
  }
  
  // Start of ALTER TABLE (FK constraints)
  if (/^ALTER TABLE /.test(l) && reading) {
    if (currentBlock.length > 0) blocks.push(currentBlock.join("\n"));
    currentBlock = [l];
    // Read until semicolon
    while (i < lines.length && !lines[i].trim().endsWith(";")) {
      i++;
      currentBlock.push(lines[i]);
    }
    if (lines[i].trim().endsWith(";")) {
      // already included
    }
    continue;
  }
  
  if (reading && currentBlock.length > 0) {
    currentBlock.push(l);
    if (l.trim() === ");") {
      // End of CREATE TABLE
      reading = false;
    }
  }
}

// Push last block
if (currentBlock.length > 0) blocks.push(currentBlock.join("\n"));

// Now filter blocks to only those containing new tables
const output = [];
for (const block of blocks) {
  let include = false;
  for (const t of newTables) {
    if (block.includes('"' + t + '"')) {
      include = true;
      break;
    }
  }
  if (include) {
    output.push("-- ==========================================");
    output.push(block);
    output.push("");
  }
}

// Now filter for AlterTable blocks that reference new tables
// Re-parse diff for ALTER TABLE
const alterBlocks = [];
let alterCurrent = null;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^ALTER TABLE /.test(l)) {
    if (alterCurrent) alterBlocks.push(alterCurrent);
    alterCurrent = [l];
    while (i < lines.length && !lines[i].trim().endsWith(";")) {
      i++;
      alterCurrent.push(lines[i]);
    }
  }
}
if (alterCurrent) alterBlocks.push(alterCurrent.join("\n"));

for (const block of alterBlocks) {
  let include = false;
  for (const t of newTables) {
    if (block.includes('"' + t + '"')) {
      include = true;
      break;
    }
  }
  if (include) {
    output.push("-- FK Constraint");
    output.push(block);
    output.push("");
  }
}

const final = output.join("\n");
fs.writeFileSync("prisma/migrations/202607010003_distribution_rbac/migration.sql", final, "utf8");
console.log("Wrote migration.sql (" + output.length + " blocks)");
console.log("");
console.log("First 80 lines:");
console.log(final.split("\n").slice(0, 80).join("\n"));
