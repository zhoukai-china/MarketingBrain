const fs = require("fs");
const diff = fs.readFileSync("_full_diff.sql", "utf8");

// Find all CREATE TYPE statements using a manual search
const typeRe = /CREATE TYPE "([^"]+)" AS ENUM \(([^;]+)\);/g;
const typeMatches = [];
let m;
while ((m = typeRe.exec(diff)) !== null) {
  typeMatches.push({ name: m[1], values: m[2] });
}
console.log("All types found:");
for (const t of typeMatches) {
  console.log("  " + t.name + ": " + t.values);
}

// Find ALTER TABLE ADD COLUMN
const alterRe = /ALTER TABLE "([^"]+)" ADD COLUMN/g;
const alterMatches = [];
while ((m = alterRe.exec(diff)) !== null) {
  alterMatches.push(m[1]);
}
console.log("\nALTER TABLE ADD COLUMN found:");
const unique = [...new Set(alterMatches)];
for (const t of unique) {
  console.log("  " + t);
}