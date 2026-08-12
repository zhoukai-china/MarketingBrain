import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../apps/api/src/config/env.js";
import { runDailyImprovementCycle } from "../apps/api/src/services/continuous-improvement.js";

const args = new Set(process.argv.slice(2));
const persist = args.has("--persist");
const requestedDate = valueAfter("--date");
const targetDate = requestedDate ?? previousShanghaiDate();
const periodStart = new Date(`${targetDate}T00:00:00+08:00`);
const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1_000);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      null,
      2
    )
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(periodStart.getTime())) {
    throw new Error("--date must use YYYY-MM-DD and represent a valid Asia/Shanghai calendar day");
  }
  if (env.DATA_MODE !== "database") {
    throw new Error("Daily quality analysis requires DATA_MODE=database; demo data is never treated as learning evidence");
  }
  if (persist) {
    if (env.CONTINUOUS_IMPROVEMENT_ENABLED !== "true") {
      throw new Error("Persistence requires CONTINUOUS_IMPROVEMENT_ENABLED=true");
    }
    if (env.CONTINUOUS_IMPROVEMENT_AUTO_PERSIST !== "true") {
      throw new Error("Persistence requires CONTINUOUS_IMPROVEMENT_AUTO_PERSIST=true");
    }
    if (env.CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE !== "false") {
      throw new Error("CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE must remain false");
    }
  }

  const result = await runDailyImprovementCycle({
    periodStart,
    periodEnd,
    scopeKey: "global",
    persist,
    minimumRunSample: env.CONTINUOUS_IMPROVEMENT_MIN_SAMPLE
  });
  const outputDir = path.join(workspaceRoot, "reports", "continuous-improvement", targetDate);
  await mkdir(outputDir, { recursive: true });

  const safeReport = {
    generatedAt: new Date().toISOString(),
    targetDate,
    timezone: "Asia/Shanghai",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    persisted: result.persisted,
    snapshotId: result.snapshotId ?? null,
    snapshot: result.snapshot,
    clusters: result.clusters.map(({ sampleRunIds: _sampleRunIds, ...cluster }) => cluster),
    candidates: result.candidates,
    evalDrafts: result.evalDrafts.map((item) => ({
      caseKey: item.caseKey,
      clusterFingerprint: item.clusterFingerprint,
      agentId: item.agentId,
      skillId: item.skillId,
      status: item.status
    })),
    privacy: "Report excludes raw prompts, raw outputs, feedback notes and customer identifiers."
  };

  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(safeReport, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "summary.md"), renderMarkdown(safeReport), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: persist ? "persist" : "dry-run",
        targetDate,
        runCount: result.snapshot.runCount,
        averageScore: result.snapshot.averageScore,
        hardGateFailureCount: result.snapshot.hardGateFailureCount,
        clusterCount: result.clusters.length,
        candidateCount: result.candidates.length,
        evalDraftCount: result.evalDrafts.length,
        outputDir
      },
      null,
      2
    )
  );
}

function valueAfter(name: string): string | undefined {
  const values = process.argv.slice(2);
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function previousShanghaiDate(now = new Date()): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(yesterday);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function renderMarkdown(report: {
  targetDate: string;
  persisted: boolean;
  snapshot: {
    runCount: number;
    averageScore: number;
    failedCount: number;
    negativeCount: number;
    hardGateFailureCount: number;
  };
  clusters: Array<{ category: string; severity: string; occurrenceCount: number; evidenceSummary: string }>;
  candidates: Array<{ type: string; targetKey: string; status: string; rationale: string }>;
}): string {
  const clusterRows = report.clusters.length
    ? report.clusters
        .map((item) => `| ${item.severity} | ${item.category} | ${item.occurrenceCount} | ${item.evidenceSummary} |`)
        .join("\n")
    : "| - | - | 0 | 当日没有形成失败聚类 |";
  const candidateRows = report.candidates.length
    ? report.candidates
        .map((item) => `| ${item.type} | ${item.targetKey} | ${item.status} | ${item.rationale} |`)
        .join("\n")
    : "| - | - | - | 样本不足或没有需要改进的重复问题 |";

  return `# 智能体每日质量复盘：${report.targetDate}

- 模式：${report.persisted ? "已写入质量库" : "只读演练"}
- 运行数：${report.snapshot.runCount}
- 平均分：${report.snapshot.averageScore}
- 运行失败：${report.snapshot.failedCount}
- 低质量：${report.snapshot.negativeCount}
- 硬门禁失败：${report.snapshot.hardGateFailureCount}

## 失败聚类

| 严重度 | 类别 | 次数 | 证据摘要 |
| --- | --- | ---: | --- |
${clusterRows}

## 改进候选

| 类型 | 目标 | 状态 | 原因 |
| --- | --- | --- | --- |
${candidateRows}

> 本报告不包含用户原始输入、模型原始输出、反馈备注或客户标识。候选不会自动上线，必须经过离线评测、人工批准、灰度和回滚检查。
`;
}
