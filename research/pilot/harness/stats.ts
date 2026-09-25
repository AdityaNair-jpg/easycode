// Statistics for the report, implemented here rather than pulled in as a
// dependency (brief, rule 12). Checked against hand-worked values in
// tests/stats.test.ts.

export const Z95 = 1.959963984540054;

export type Interval = { k: number; n: number; p: number; lo: number; hi: number };

// Wilson score interval for k successes out of n
export function wilson(k: number, n: number, z = Z95): Interval {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) {
    throw new Error(`wilson: bad counts k=${k} n=${n}`);
  }
  if (n === 0) return { k, n, p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, p, lo: k === 0 ? 0 : Math.max(0, center - half), hi: k === n ? 1 : Math.min(1, center + half) };
}

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  if (m === -Infinity) return -Infinity;
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
}

// P(X <= k) for X ~ Binomial(n, 1/2), computed in log space
export function binomCdfHalf(k: number, n: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  const logs: number[] = [];
  let logPmf = -n * Math.LN2;
  for (let i = 0; i <= k; i++) {
    logs.push(logPmf);
    logPmf += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.min(1, Math.exp(logSumExp(logs)));
}

// Exact McNemar test: two-sided binomial test on the discordant pairs.
// b = pairs where only the first condition retried, c = only the second.
export function mcnemarExact(b: number, c: number): { b: number; c: number; n: number; p: number } {
  const n = b + c;
  if (n === 0) return { b, c, n, p: 1 };
  return { b, c, n, p: Math.min(1, 2 * binomCdfHalf(Math.min(b, c), n)) };
}

// Small seeded PRNG for the human review sample (mulberry32)
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// First `count` items of a seeded Fisher-Yates shuffle of `items`
export function sample<T>(items: readonly T[], count: number, rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, count);
}
