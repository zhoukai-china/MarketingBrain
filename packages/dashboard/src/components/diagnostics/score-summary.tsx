import type { GapAnalysis } from "./comparison-matrix-data";

const RATING_LABELS: Record<number, string> = {
  0: "起步期",
  25: "认知期",
  50: "成长期",
  70: "优化期",
  85: "领先期",
};

function getRating(score: number): string {
  if (score >= 85) return RATING_LABELS[85];
  if (score >= 70) return RATING_LABELS[70];
  if (score >= 50) return RATING_LABELS[50];
  if (score >= 25) return RATING_LABELS[25];
  return RATING_LABELS[0];
}

function scoreColor(score: number): string {
  if (score >= 70) return "#2bd0bd";
  if (score >= 50) return "#5b8def";
  if (score >= 25) return "#d9b875";
  return "#f2a2a2";
}

export function ScoreSummary({ overallScore, gaps }: { overallScore: number; gaps: GapAnalysis[] }) {
  const criticalCount = gaps.filter((g) => g.severity === "critical").length;
  const warningCount = gaps.filter((g) => g.severity === "warning").length;
  const worstGap = gaps.reduce((a, b) => (a.gapToAverage > b.gapToAverage ? a : b));

  return (
    <div>
      <div className="matrixScoreRow">
        <span className="matrixScoreBig" style={{ color: scoreColor(overallScore) }}>{overallScore}</span>
        <span className="matrixScoreUnit">/ 100 综合得分</span>
      </div>
      <div className="matrixScoreMeta">
        <span className="matrixRating" style={{ color: scoreColor(overallScore) }}>{getRating(overallScore)}</span>
        <span className="matrixRatingHint">
          {criticalCount > 0
            ? `${criticalCount} 项严重短板需优先解决`
            : warningCount > 0
            ? `${warningCount} 项需关注，建议提前规划`
            : "各维度表现均衡"}
        </span>
      </div>

      <div className="matrixMiniCards">
        {gaps.map((g) => (
          <div key={g.tag} className="matrixMiniCard">
            <div className="matrixMiniCardLabel">{g.label}</div>
            <div className="matrixMiniCardScore">{g.myScore}</div>
            <div className="matrixMiniCardAvg">行业 {g.industryAvg}</div>
          </div>
        ))}
      </div>

      <div className="matrixWorstGap">
        <span className="matrixWorstIcon">⚠</span>
        <span className="matrixWorstText">
          最大短板：{worstGap.label} — 与行业均值差 {Math.abs(worstGap.gapToAverage)} 分
        </span>
      </div>
    </div>
  );
}
