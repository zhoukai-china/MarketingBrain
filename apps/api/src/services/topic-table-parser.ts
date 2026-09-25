// 选题策略官 · 交付物表格校验器（纯函数，独立于路由层，便于单测）
//
// 从 routes/marketplace.ts 抽出：原来是该路由文件内的私有函数，
// 但它是选题生成链路的核心闸门（LLM 产出 10 行 7 列表格 → 结构化校验），
// 必须可单测。抽成独立模块后，marketplace.ts 改为 import 本文件。

export interface TopicRow {
  id: string;
  title: string;
  type: string;
  source: string;
  consensus: string;
  precision: string;
  advice: string;
}

// 共识层级 → 应绑定的客资准度星数（来源：HANDOFF 选题策略官三关筛选口径）
const CONSENSUS_BINDING: Record<string, number> = {
  "人性共识": 1,
  "时代共识": 3,
  "利益共识": 4,
  "热点共识": 3,
  "专业共识": 5
};

// 把一行 markdown 表格拆成单元格（去首尾竖线后按 | 切分）
export function splitRow(line: string): string[] {
  const l = line.trim();
  if (!l.startsWith("|") || !l.endsWith("|")) return [];
  return l.slice(1, -1).split("|");
}

// 解析 LLM 交付的选题表，返回结构化行 + 校验失败项。
// 失败项非空时，上游会判定本次生成不合格、触发重试。
export function parseTopicTable(text: string): { rows: TopicRow[]; failures: string[] } {
  const failures: string[] = [];
  const lines = text.split(/\r?\n/);
  const rows: TopicRow[] = [];
  let idx = 0;
  // 找到主表格（表头含 选题 的 7 列表）
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length >= 7 && cells[0].trim() === "#" && (cells[1] ?? "").trim() === "选题") {
      idx = i + 1;
      break;
    }
  }
  if (idx === 0) {
    return { rows, failures: ["未找到符合 7 列（# / 选题 / 类型 / 来源 / 共识层级 / 客资准度 / 创作建议）的主表格"] };
  }
  for (; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line.startsWith("|")) break;
    const cells = splitRow(line).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells.length < 7) {
      failures.push(`第 ${rows.length + 1} 行字段不足（应为 7 列，实际 ${cells.length}）`);
      rows.push({ id: cells[0] ?? "", title: cells[1] ?? "", type: cells[2] ?? "", source: cells[3] ?? "", consensus: cells[4] ?? "", precision: cells[5] ?? "", advice: cells[6] ?? "" });
      continue;
    }
    rows.push({ id: cells[0], title: cells[1], type: cells[2], source: cells[3], consensus: cells[4], precision: cells[5], advice: cells[6] });
  }
  if (rows.length < 10) failures.push(`选题不足 10 条（实际 ${rows.length} 条）`);
  rows.forEach((r, i) => {
    const expected = CONSENSUS_BINDING[r.consensus];
    const stars = (r.precision.match(/★/g) ?? []).length;
    if (expected === undefined) failures.push(`第 ${i + 1} 条共识层级非法：${r.consensus}`);
    else if (stars !== expected) failures.push(`第 ${i + 1} 条「${r.consensus}」应绑定 ${"★".repeat(expected)}，实际 ${r.precision}`);
    if (!r.title || !r.type || !r.source || !r.advice) failures.push(`第 ${i + 1} 条存在空字段`);
  });
  if (!/配比校验/.test(text)) failures.push("缺少「配比校验」块");
  if (/私信|电话|找我|留个|加我|扫码领/.test(text)) failures.push("CTA 含违禁词（私信/电话/找我/留个/加我/扫码领）");
  return { rows, failures };
}
