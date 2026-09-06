const fs = require("fs");
const diff = fs.readFileSync("_full_diff.sql", "utf8");

const newTables = [
  "Distributor", "DistroCustomer", "DistroOrder", "DistroCommissionLog",
  "DistroWithdrawal", "CommissionRule", "ShareLink", "RiskRule", "RiskEvent",
  "AuditLog", "Role", "Permission", "RolePermission", "UserRoleAssignment",
  "AccessPolicy", "RolePolicy", "SsoConfig"
];
const newEnums = [
  "DistributorStatus", "DistroOrderStatus", "CommissionStatus",
  "WithdrawalStatus", "RiskLevel", "RiskEventType", "ShareLinkType"
];

const lines = diff.split("\n");
const out = [];
let inTarget = false;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  
  // Match CREATE TYPE
  const tm = l.match(/^CREATE TYPE "([^"]+)"/);
  if (tm && newEnums.includes(tm[1])) {
    inTarget = true;
    out.push("");
    out.push("-- CreateEnum " + tm[1]);
    out.push(l);
    continue;
  }
  
  // Match CREATE TABLE
  const tbl = l.match(/^CREATE TABLE "([^"]+)"/);
  if (tbl) {
    inTarget = newTables.includes(tbl[1]);
    if (inTarget) {
      out.push("");
      out.push("-- CreateTable " + tbl[1]);
      out.push(l);
    }
    continue;
  }
  
  if (inTarget) {
    out.push(l);
    if (l.trim() === ");") {
      inTarget = false;
    }
  }
}

fs.writeFileSync("migration_new.sql", out.join("\n"), "utf8");
console.log("Extracted " + out.length + " lines");
console.log(out.slice(0, 60).join("\n"));
console.log("---");
console.log(out.slice(-20).join("\n"));
