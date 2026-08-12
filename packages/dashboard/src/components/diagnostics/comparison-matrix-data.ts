import type { WeaknessTag } from "@baolu/shared";
import { WEAKNESS_TAG_CONSULTANTS, getRecommendedConsultants } from "@baolu/shared";

export interface WeaknessBenchmark {
  tag: WeaknessTag;
  label: string;
  myScore: number;
  industryAvg: number;
  topQuartile: number;
  weight: number;
}

export interface GapAnalysis {
  tag: WeaknessTag;
  label: string;
  myScore: number;
  industryAvg: number;
  topQuartile: number;
  gapToAverage: number;
  gapToTop: number;
  severity: "critical" | "warning" | "moderate" | "good";
}

export interface ComparisonMatrixData {
  tenantName: string;
  tenantRole: string;
  benchmarks: WeaknessBenchmark[];
  gaps: GapAnalysis[];
  primaryWeakness: WeaknessTag;
  secondaryWeakness: WeaknessTag | null;
  overallScore: number;
}

const BENCHMARK_DEFAULTS: Record<WeaknessTag, { industryAvg: number; topQuartile: number; weight: number }> = {
  acquisition: { industryAvg: 62, topQuartile: 82, weight: 0.4 },
  delivery: { industryAvg: 68, topQuartile: 85, weight: 0.35 },
  management: { industryAvg: 58, topQuartile: 78, weight: 0.25 },
};

const TAG_LABELS: Record<WeaknessTag, string> = {
  acquisition: "获客能力",
  delivery: "交付能力",
  management: "管理能力",
};

function severityFromGap(gap: number): GapAnalysis["severity"] {
  if (gap >= 15) return "critical";
  if (gap >= 8) return "warning";
  if (gap >= 3) return "moderate";
  return "good";
}

export function buildComparisonMatrix(
  tenantName: string,
  tenantRole: string,
  scores: Record<WeaknessTag, number>
): ComparisonMatrixData {
  const tags: WeaknessTag[] = ["acquisition", "delivery", "management"];

  const benchmarks: WeaknessBenchmark[] = tags.map((tag) => ({
    tag,
    label: TAG_LABELS[tag],
    myScore: Math.min(100, Math.max(0, Math.round(scores[tag] ?? 50))),
    industryAvg: BENCHMARK_DEFAULTS[tag].industryAvg,
    topQuartile: BENCHMARK_DEFAULTS[tag].topQuartile,
    weight: BENCHMARK_DEFAULTS[tag].weight,
  }));

  const gaps: GapAnalysis[] = benchmarks.map((b) => ({
    tag: b.tag,
    label: b.label,
    myScore: b.myScore,
    industryAvg: b.industryAvg,
    topQuartile: b.topQuartile,
    gapToAverage: b.industryAvg - b.myScore,
    gapToTop: b.topQuartile - b.myScore,
    severity: severityFromGap(b.industryAvg - b.myScore),
  }));

  const overallScore = Math.round(
    benchmarks.reduce((sum, b) => sum + b.myScore * b.weight, 0)
  );

  const sortedByGap = [...gaps].sort((a, b) => b.gapToAverage - a.gapToAverage);

  return {
    tenantName,
    tenantRole,
    benchmarks,
    gaps,
    primaryWeakness: sortedByGap[0].tag,
    secondaryWeakness: sortedByGap[1].gapToAverage > 0 ? sortedByGap[1].tag : null,
    overallScore,
  };
}

export function getMatrixRecommendations(matrix: ComparisonMatrixData) {
  const tags: WeaknessTag[] = [matrix.primaryWeakness];
  if (matrix.secondaryWeakness) tags.push(matrix.secondaryWeakness);
  return {
    consultants: getRecommendedConsultants(tags),
    primaryTag: matrix.primaryWeakness,
    secondaryTag: matrix.secondaryWeakness,
  };
}
