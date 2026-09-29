/** 算力数字展示：千分位（10000 → 10,000）。null/undefined → "—"。 */
export function fmtCredits(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}
