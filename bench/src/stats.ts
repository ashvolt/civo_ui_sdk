/** Order statistics, by the nearest-rank method. Input need not be sorted. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export const median = (values: readonly number[]) => percentile(values, 50);

/** Interquartile range: the spread reported beside every median (R6). */
export function iqr(values: readonly number[]): number {
  return percentile(values, 75) - percentile(values, 25);
}
