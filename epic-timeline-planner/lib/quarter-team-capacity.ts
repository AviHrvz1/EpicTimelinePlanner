/**
 * Split a quarter-level capacity total (sum of months) into per-month values.
 * Each month is capped at `perMonthMax` (default 20-day month × 10 = 200 in UI).
 */
export function splitQuarterTotalAcrossMonths(
  quarterTotal: number,
  monthCount: number,
  perMonthMax = 200,
): number[] {
  const n = Math.max(1, monthCount);
  const maxTotal = perMonthMax * n;
  const clamped = Math.max(0, Math.min(maxTotal, Math.round(Number(quarterTotal) || 0)));
  const base = Math.floor(clamped / n);
  const result = Array.from({ length: n }, () => Math.min(base, perMonthMax));
  let rem = clamped - result.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (rem > 0 && guard < n * (perMonthMax + 1)) {
    for (let i = 0; i < n && rem > 0; i++) {
      if (result[i]! < perMonthMax) {
        result[i]!++;
        rem--;
      }
    }
    guard++;
  }
  return result;
}
