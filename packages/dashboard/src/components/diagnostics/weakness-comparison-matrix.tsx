import type { WeaknessTag } from "@baolu/shared";
import type { ComparisonMatrixData, GapAnalysis } from "./comparison-matrix-data";
import { buildComparisonMatrix } from "./comparison-matrix-data";
import { RadarChart } from "./radar-chart";
import { GapTable } from "./gap-table";
import { ScoreSummary } from "./score-summary";

interface WeaknessComparisonMatrixProps {
  tenantName: string;
  tenantRole: string;
  scores: Record<WeaknessTag, number>;
  className?: string;
}

export function WeaknessComparisonMatrix({
  tenantName,
  tenantRole,
  scores,
  className = "",
}: WeaknessComparisonMatrixProps) {
  const matrix = buildComparisonMatrix(tenantName, tenantRole, scores);

  return (
    <div className={`matrixRoot ${className}`}>
      <div className="matrixHeader">
        <h2 className="matrixTitle">三大核心能力对比矩阵</h2>
        <p className="matrixSubtitle">
          你的得分 vs 行业平均值 vs 行业前25%水平
        </p>
      </div>

      <div className="matrixBody">
        <div className="matrixChartCol">
          <RadarChart benchmarks={matrix.benchmarks} size={360} />
          <div className="matrixLegend">
            <span className="matrixLegendItem"><span className="matrixLegendDot matrixDotMine" /> 你的得分</span>
            <span className="matrixLegendItem"><span className="matrixLegendDot matrixDotAvg" /> 行业均值</span>
            <span className="matrixLegendItem"><span className="matrixLegendDot matrixDotTop" /> 头部水平</span>
          </div>
        </div>

        <div className="matrixDataCol">
          <ScoreSummary overallScore={matrix.overallScore} gaps={matrix.gaps} />
          <GapTable gaps={matrix.gaps} />
        </div>
      </div>

      <div className="matrixFooter">
        <p>
          数据基于行业基准值（2026年中小企业AI化成熟度报告），仅供参考。得分越高表示该维度能力越强。
        </p>
      </div>
    </div>
  );
}

export { buildComparisonMatrix };
export type { ComparisonMatrixData, GapAnalysis, WeaknessBenchmark } from "./comparison-matrix-data";
