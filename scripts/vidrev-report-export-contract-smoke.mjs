/**
 * 视频复盘「报告导出」口径回归（用户 2026-09-17 两次现场）。
 *
 * 第一次：「这个下载应该下载 word 或者 wps 吧，csv 格式应该没法展示这么多内容输出吧」
 * 第二次：「下方有下载精美 word，所以这里的输出不用再说输出 markdown 和 csv，
 *          也不需要展开 markdown 原文」
 *
 * 最终口径（报告卡片里**不再出现任何导出按钮**）：
 *   ① 报告的唯一下载入口 = 交付后模板底部那颗「⬇ 下载精美 Word / WPS 报告 · N 积分」；
 *   ② 报告卡片里不得再出现「导出 Markdown / 导出 CSV」按钮（那两种格式装不下十一章长文，
 *      摆在报告里只会让人以为「报告只能导 CSV」）；
 *   ③ 报告卡片里不得再展开 md 原文（`details.vrv-raw`）；
 *   ④ 「加入选题池」的操作反馈仍要保留。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = readFileSync("apps/web/src/marketplace/vidrev-report.tsx", "utf8");
const chatPage = readFileSync("apps/web/src/marketplace/AgentChatPage.tsx", "utf8");
const e2e = readFileSync("scripts/marketplace-vidrev-browser-e2e.mjs", "utf8");

// ① 唯一下载入口是底部那颗 Word / WPS 按钮。
assert.match(
  chatPage,
  /⬇ 下载精美 Word \/ WPS 报告/,
  "交付后的下载入口必须写明 Word / WPS（老板要的是能用 WPS 打开的文档）"
);
assert.match(chatPage, /onClick=\{downloadWord\}/, "Word 下载必须仍接到 downloadWord()");

// ② 报告卡片里不得再有 Markdown / CSV 导出按钮。
assert.ok(
  !report.includes("导出 Markdown") && !report.includes("导出 .md") && !report.includes("导出 CSV"),
  "报告卡片里不得再出现 Markdown / CSV 导出按钮（用户 2026-09-17 明确要求去掉）"
);
assert.ok(
  !/function exportMarkdown|function exportCsv/.test(report),
  "报告卡片里不得再保留 Markdown / CSV 的导出实现（避免又被接回界面）"
);

// ③ 不得再展开 markdown 原文。
assert.ok(
  !report.includes("vrv-raw") && !report.includes("查看报告 Markdown 原文"),
  "报告卡片里不得再展开 md 原文（details.vrv-raw）"
);

// ④ 操作反馈保留：加入选题池后仍要告诉用户已带入。
assert.match(report, /已带入选题池/, "「加入选题池」的反馈不能被一起删掉");

// 浏览器 E2E 必须与这条口径一致（否则线上验收脚本会骗过我们）。
assert.ok(
  !/导出明细 CSV（每条视频一行）/.test(e2e) && !/⬇ 导出 Markdown/.test(e2e),
  "浏览器验收脚本不得再要求报告卡片出现 CSV / Markdown 导出按钮"
);
assert.match(e2e, /下载精美 Word/, "浏览器验收脚本必须断言底部有 Word / WPS 下载入口");

console.log(
  JSON.stringify({
    result: "VIDREV_REPORT_EXPORT_CONTRACT_PASS",
    cardHasNoExportButtons: true,
    cardHasNoRawMarkdown: true,
    wordWpsIsOnlyDownloadEntry: true
  })
);
