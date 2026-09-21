// PLAT-62：对话式智能体「步骤序号」契约回归（用户 2026-09-16 报障）。
//
// 现场：文案智能体进度条渲染成「① ① 行业 / 产品卖点  ② ② 目标人群 …」——
// 进度条徽标本来就自带 1/2/3…，而 slot.label 里又写了 ①/②，序号出现两遍；
// 同一份 label 还会被拼进提问气泡（`**label**：q`），于是气泡也变成「① 行业 / 产品卖点：① 你的行业…」。
//
// 口径（本用例守护）：**序号只由进度条徽标输出，label 一律不带序号**；
// 提问正文里的 ①/② 允许保留，但必须与槽位顺序一致（第 2 步不能写 ③），否则用户看到的编号会错位。
// 覆盖面：所有走对话式的智能体（CHAT_FLOWS 全量），不只文案；新增智能体自动纳入。
//
// 红/绿证：对修复前的 `chat-flows.ts`（git 026682a^）运行本用例 → FAIL；
// 对当前版本运行 → PASS。可用 `node <tsx> scripts/...-smoke.ts <chat-flows.ts 路径>` 复现红灯。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const target = process.argv[2] ?? "apps/web/src/marketplace/chat-flows.ts";
const pagePath = "apps/web/src/marketplace/AgentChatPage.tsx";

/** 圈号 ①–⑳：进度条徽标已占用这一层语义，label 里再出现就是重复。 */
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

async function main() {
  const mod = (await import(pathToFileURL(resolve(target)).href)) as {
    CHAT_FLOWS: Record<string, { name: string; slots: { key: string; label: string; q: string }[] }>;
  };
  const flows = mod.CHAT_FLOWS;
  let slots = 0;

  check(Boolean(flows) && Object.keys(flows).length > 0, `读到 CHAT_FLOWS（${Object.keys(flows ?? {}).length} 个智能体）`);

  for (const [flowKey, flow] of Object.entries(flows ?? {})) {
  const who = `${flowKey}（${flow.name}）`;
  const keys = new Set<string>();
  const labels = new Set<string>();

  flow.slots.forEach((slot, idx) => {
    slots += 1;
    const pos = idx + 1;
    const label = String(slot.label ?? "");

    // ① label 不得为空，且不得带首尾空格（进度条里会原样渲染）。
    check(label.trim().length > 0 && label === label.trim(), `${who} 第 ${pos} 步 label 非空且无首尾空格：${JSON.stringify(label)}`);

    // ② label 不得含圈号——进度条徽标已输出序号，重复即用户报障的那一屏。
    const circled = [...label].filter((ch) => CIRCLED.includes(ch));
    check(circled.length === 0, `${who} 第 ${pos} 步 label 不带序号（进度条徽标自带 ${pos}）：${JSON.stringify(label)}${circled.length ? ` 命中 ${circled.join("")}` : ""}`);

    // ③ label 不得以「1.」/「第2轮」这类序号开头，同样会和徽标撞车。
    check(!/^\s*(\d+[.、)]|第\s*\d+\s*轮)/.test(label), `${who} 第 ${pos} 步 label 不以「1.」/「第N轮」开头：${JSON.stringify(label)}`);

    // ④ 提问正文里的圈号必须与槽位顺序一致（顺序调整后忘了改序号 = 用户看到的编号错位）。
    const head = String(slot.q ?? "").trim()[0] ?? "";
    if (CIRCLED.includes(head)) {
      const n = CIRCLED.indexOf(head) + 1;
      check(n === pos, `${who} 第 ${pos} 步提问正文序号一致（q 开头「${head}」= 第 ${n} 步）`);
    }

    // ⑤ 同一条流程内 key / label 必须唯一（重复会让进度条和答案回填指错槽位）。
    check(!keys.has(slot.key), `${who} 槽位 key 唯一：${slot.key}`);
    check(!labels.has(label), `${who} 槽位 label 唯一：${label}`);
    keys.add(slot.key);
    labels.add(label);
  });
  }

  // ⑥ 页面契约：序号只能来自进度条徽标；气泡只能拼 `**label**：q`，不得再自己加一遍序号。
  const page = readFileSync(pagePath, "utf8");
  check(
    /chat-prog[^>]*>\s*<i>\{state === "done" \? "✓" : idx \+ 1\}<\/i>\s*<b>\{slot\.label/.test(page),
    "进度条仍是「徽标序号 + label」结构（序号唯一来源）"
  );
  /**
   * 2026-09-21：对话页把 flow.slots 解构成局部 `slots` 之后，这两条断言还写着 `flow.slots`，
   * 从那时起一直是红的（哑断言）。这里只对齐变量名，语义不变：序号只能来自进度条徽标。
   */
  check(
    !/text: `\*\*\$\{slots\[[^\]]+\]\.label\}\*\*：\$\{idx/.test(page),
    "提问气泡未在 label 前再拼一次序号"
  );
  check(
    /\*\*\$\{slots\[0\]\.label\}\*\*：\$\{slots\[0\]\.q\}/.test(page),
    "提问气泡文案 = `**label**：q`（label 不带序号，正文自带序号）"
  );

  console.log(`marketplace_chat_slot_numbering_contract_smoke: 覆盖 ${Object.keys(flows ?? {}).length} 个智能体 / ${slots} 个步骤`);
  if (failed > 0) {
    console.error(`marketplace_chat_slot_numbering_contract_smoke: FAIL (${failed} failed)`);
    process.exit(1);
  }
  console.log("marketplace_chat_slot_numbering_contract_smoke: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
