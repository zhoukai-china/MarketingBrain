// 临时脚本：从 demo live.html 抽取 2 小时直播逐字稿的段骨架（round/time/mins/theme/loop）。
// 仅用于工程化对齐，抽取完成后即删除。
import { readFileSync } from "node:fs";

const src = readFileSync(
  "C:/Users/book/WorkBuddy/sitong-outsourcing/beauty-xhs-prototype-20260827/live.html",
  "utf8"
);

const blocks = [];
const re = /add\(\{/g;
let m;
while ((m = re.exec(src)) !== null) {
  // 从 add({ 起，按大括号配对截取整段
  let depth = 0;
  let i = m.index + 3;
  const start = i;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  blocks.push(src.slice(start, i + 1));
}

function pick(block, key, kind) {
  const patterns =
    kind === "string"
      ? [new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)]
      : [new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*([A-Za-z0-9_.]+)`)];
  for (const p of patterns) {
    const hit = block.match(p);
    if (hit) return kind === "string" ? hit[1] : hit[1];
  }
  return null;
}

const rows = blocks.map((b, index) => ({
  index,
  round: pick(b, "round", "num"),
  time: pick(b, "time", "string"),
  mins: pick(b, "mins", "num"),
  theme: pick(b, "theme", "string"),
  loop: pick(b, "loop", "num"),
  hasFill: /(?:^|[,{\s])fill\s*:/.test(b),
  hasInteract: /(?:^|[,{\s])interact\s*:/.test(b),
  hasRhythm: /(?:^|[,{\s])rhythm\s*:/.test(b)
}));

console.log("TOTAL=" + rows.length);
for (const r of rows) {
  console.log(
    `${r.index + 1}\tround=${r.round}\t${r.time}\t${r.mins}min\tloop=${r.loop}\ttheme=${r.theme}\tfill=${r.hasFill} interact=${r.hasInteract} rhythm=${r.hasRhythm}`
  );
}

const byRound = {};
for (const r of rows) byRound[r.round] = (byRound[r.round] ?? 0) + 1;
console.log("ROUND_COUNTS=" + JSON.stringify(byRound));

// round 字段可能写成变量；如果是 d.xxx 形式则提示
const suspicious = rows.filter((r) => r.round === null || /[A-Za-z]/.test(String(r.round)));
console.log("SUSPICIOUS=" + JSON.stringify(suspicious.map((r) => r.round)));
