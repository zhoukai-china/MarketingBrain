import type { GapAnalysis } from "./comparison-matrix-data";

const BADGE_CLASS: Record<GapAnalysis["severity"], string> = {
  critical: "matrixBadgeCritical",
  warning: "matrixBadgeWarning",
  moderate: "matrixBadgeModerate",
  good: "matrixBadgeGood",
};
const LABEL_MAP: Record<GapAnalysis["severity"], string> = {
  critical: "严重短板",
  warning: "需关注",
  moderate: "轻微差距",
  good: "达标",
};

function barWidth(score: number): string {
  return `${Math.max(4, score)}%`;
}

export function GapTable({ gaps }: { gaps: GapAnalysis[] }) {
  return (
    <div>
      <h4 className="matrixSubTitle">维度差距明细</h4>
      <div className="matrixGapStack">
        {gaps.map((g) => (
          <div key={g.tag}>
            <div className="matrixGapLabelRow">
              <span className="matrixGapLabel">{g.label}</span>
              <span className="matrixGapScores">
                你 <span className="matrixScoreMine">{g.myScore}</span> / 行业 <span className="matrixScoreAvg">{g.industryAvg}</span> / 头部 <span className="matrixScoreTop">{g.topQuartile}</span>
              </span>
            </div>
            <div className="matrixBarTrack">
              <div className="matrixBarMine" style={{ width: barWidth(g.myScore) }} />
              <div className="matrixBarSpacer" />
              <div className="matrixBarAvg" style={{ width: barWidth(Math.max(0, g.industryAvg - g.myScore)) }} />
              <div className="matrixBarSpacer" />
              <div className="matrixBarTop" style={{ width: barWidth(Math.max(0, g.topQuartile - g.industryAvg)) }} />
            </div>
            <div className="matrixGapBadgeRow">
              <span className={`matrixBadge ${BADGE_CLASS[g.severity]}`}>
                {LABEL_MAP[g.severity]}
              </span>
              <span className="matrixGapDelta">
                {g.gapToAverage > 0 ? `落后行业均值 ${Math.abs(g.gapToAverage)} 分` : `高于行业均值 ${Math.abs(g.gapToAverage)} 分`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
