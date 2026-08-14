// Suggested cash-tender amounts for a total: the exact amount plus the next round
// hundred / 500 / 1000 above it (e.g. 690 → 690, 700, 1000).
export const quickCashOptions = (total: number): number[] => {
  const t = Math.ceil(total);
  if (t <= 0) return [];
  const nm = (step: number) => Math.ceil(t / step) * step;
  return [...new Set([t, nm(100), nm(500), nm(1000)])]
    .filter((v) => v >= t)
    .sort((a, b) => a - b);
};
