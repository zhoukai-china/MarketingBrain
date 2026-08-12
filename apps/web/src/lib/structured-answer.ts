function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return parseTableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isRichTable(lines: string[]): boolean {
  return lines.slice(2).some((line) => {
    const cells = parseTableCells(line);
    return cells.some((cell) =>
      cell.length > 150
      || /\*\*|(?:^|\s)\d{1,2}[.、]\s+|\s+-\s+/.test(cell)
    );
  });
}

function richTableToCards(lines: string[]): string {
  const headers = parseTableCells(lines[0]);
  const rows = lines.slice(2).filter((line) => !isTableSeparator(line));

  return rows.map((line) => {
    const cells = parseTableCells(line);
    const title = cells[0] || "补充信息";
    const details = cells.slice(1).map((value, index) => {
      if (!value) return "";
      const label = headers[index + 1] || "补充信息";
      if (value.length > 150 || /(?:^|\s)\d{1,2}[.、]\s+/.test(value)) {
        return `**${label}**\n\n${value}`;
      }
      return `- **${label}：** ${value}`;
    }).filter(Boolean);
    return [`### ${title}`, ...details].join("\n");
  }).join("\n\n");
}

function normalizeRichMarkdownTables(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line.startsWith("|") || index + 1 >= lines.length || !isTableSeparator(lines[index + 1])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const tableLines = [lines[index], lines[index + 1]];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      tableLines.push(lines[index]);
      index += 1;
    }

    output.push(isRichTable(tableLines) ? richTableToCards(tableLines) : tableLines.join("\n"));
    // GFM treats the immediately following paragraph as another table row.
    // Keep narrative text, notes and checklists outside the preceding table.
    output.push("");
  }

  return output.join("\n");
}

function normalizeBrokenMarkdownEmphasis(content: string): string {
  return content.split(/\r?\n/).map((line) => {
    let normalized = line
      // The model occasionally emits "**唯一动作:** **正文". The final
      // opener has no closer, so ReactMarkdown displays the stars verbatim.
      .replace(/\*\*([^*\n：:]{1,24})[：:]\s*\*\*\s*\*\*/g, "**$1：** ")
      .replace(/\*\*([^*\n：:]{1,24})[：:]\s*\*\*/g, "**$1：**");

    // Never expose Markdown stars to the customer. The output cards already
    // supply their own visual hierarchy, so plain text is more reliable than
    // preserving model-generated emphasis with an uncertain closing marker.
    if ((normalized.match(/\*\*/g) || []).length % 2 !== 0) {
      normalized = normalized.replace(/\*\*/g, "");
    }
    return normalized.replace(/\*\*/g, "");
  }).join("\n");
}

export function formatStructuredSectionMarkdown(content: string): string {
  // Do not let model Markdown markers leak into the operator-facing result.
  // This also catches full-width stars and one-off single markers.
  const starFreeContent = content.replace(/[＊*]/g, "");
  const expanded = normalizeBrokenMarkdownEmphasis(normalizeRichMarkdownTables(starFreeContent))
    // Models sometimes put an entire diagnosis in one physical line, for
    // example "1. **结论** - 证据 - 问题 2. **建议**". Markdown then renders
    // it as one dense paragraph. Restore the intended list boundaries before
    // handing the content to the renderer.
    .replace(/[ \t]+(?=(?:\d{1,2}[.、])\s*(?:\*\*)?[^*\n]{2,48}(?:\*\*)?[：:])/g, "\n")
    .replace(/[ \t]+(?=(?:\d{1,2}[.、])\s*(?:\*\*)?[\u4e00-\u9fffA-Za-z])/g, "\n")
    .replace(/[ \t]+-\s+(?=(?:\*|[\u4e00-\u9fffA-Za-z0-9“"【]))/g, "\n- ")
    .replace(/\s+(?=(?:[SCALE]\s*[｜|]|镜头\d+|标题\d+|置顶评论|私信首次回复|线索分层|主选题|内容角度|开头\d*秒|\d+到\d+秒)[：:（(])/g, "\n")
    .trim();
  const lines = expanded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1 || lines.some((line) => /^(?:[-*+]\s|#{1,6}\s|>\s|\|)/.test(line))) return expanded;
  return lines.map((line) => {
    const labeled = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    if (labeled) return `- **${labeled[1]}：** ${labeled[2]}`;
    return `- ${line}`;
  }).join("\n");
}
