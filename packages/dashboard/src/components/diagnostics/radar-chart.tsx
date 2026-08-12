type Props = { size: number; benchmarks: Array<{ label: string; myScore: number; industryAvg: number; topQuartile: number }> };

const COLORS = { myScore: "#2bd0bd", industryAvg: "#7f8b9b", topQuartile: "#d9b875" };
const MAX = 100;
const AXES = 3;
const ANGLE = (2 * Math.PI) / AXES;

function polar(cx: number, cy: number, radius: number, i: number, value: number, max: number): [number, number] {
  const r = (value / max) * radius;
  const a = Math.PI / 2 - i * ANGLE;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function pathPoints(cx: number, cy: number, radius: number, values: number[], max: number): string {
  return values.map((v, i) => {
    const [x, y] = polar(cx, cy, radius, i, v, max);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

export function RadarChart({ size, benchmarks }: Props) {
  const cx = size / 2, cy = size / 2, r = size * 0.34;
  const rings = [25, 50, 75, 100];
  const myScores = benchmarks.map(b => b.myScore);
  const avgScores = benchmarks.map(b => b.industryAvg);
  const topScores = benchmarks.map(b => b.topQuartile);

  const ringPaths = rings.map(ring => {
    const pts = [0, 1, 2].map(i => polar(cx, cy, r, i, ring, MAX));
    return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L ${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)} L ${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)} Z`;
  });

  const axisLines = [0, 1, 2].map(i => `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${polar(cx, cy, r, i, MAX, MAX)[0].toFixed(1)} ${polar(cx, cy, r, i, MAX, MAX)[1].toFixed(1)}`);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      {ringPaths.map((d, i) => (
        <path key={`ring-${i}`} d={d} fill="none" stroke="rgba(226,232,240,0.15)" strokeWidth="1" />
      ))}
      {axisLines.map((d, i) => {
        const parts = d.split(" ");
        return (
          <line key={`axis-${i}`} x1={cx} y1={cy} x2={parts[4]} y2={parts[5]} stroke="rgba(226,232,240,0.15)" strokeWidth="1" />
        );
      })}
      <path d={pathPoints(cx, cy, r, avgScores, MAX)} fill={COLORS.industryAvg} fillOpacity="0.12" stroke={COLORS.industryAvg} strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={pathPoints(cx, cy, r, topScores, MAX)} fill={COLORS.topQuartile} fillOpacity="0.08" stroke={COLORS.topQuartile} strokeWidth="1.5" strokeDasharray="2 3" />
      <path d={pathPoints(cx, cy, r, myScores, MAX)} fill={COLORS.myScore} fillOpacity="0.18" stroke={COLORS.myScore} strokeWidth="2.5" />
      {benchmarks.map((b, i) => {
        const [lx, ly] = polar(cx, cy, r + 30, i, MAX, MAX);
        const [px, py] = polar(cx, cy, r, i, b.myScore, MAX);
        return (
          <g key={`label-${i}`}>
            <circle cx={px} cy={py} r="4" fill={COLORS.myScore} stroke="#070a0f" strokeWidth="2" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="#eef4f8" fontSize="13" fontWeight="500">{b.label}</text>
            <text x={lx} y={ly + 15} textAnchor="middle" dominantBaseline="middle" fill="#2bd0bd" fontSize="11" fontWeight="600">{b.myScore}</text>
          </g>
        );
      })}
    </svg>
  );
}
