// Expected values worked out by hand (arithmetic in the comments) and checked
// against published Wilson tables for n = 10
import { describe, expect, test } from "bun:test";
import { binomCdfHalf, mcnemarExact, mulberry32, sample, wilson } from "../harness/stats.ts";
import { parseCsv, toCsv } from "../harness/csv.ts";

describe("wilson", () => {
  // z^2 = 3.841459, so for n = 10: denom = 1.384146, z^2/2n = 0.192073, z^2/4n^2 = 0.009604
  test("5/10: centre 0.5, half-width 1.959964 * sqrt(0.025 + 0.009604) / 1.384146 = 0.263407", () => {
    const w = wilson(5, 10);
    expect(w.lo).toBeCloseTo(0.236593, 5);
    expect(w.hi).toBeCloseTo(0.763407, 5);
  });
  test("0/10: [0, 2 * 0.192073 / 1.384146] = [0, 0.277533]", () => {
    const w = wilson(0, 10);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeCloseTo(0.277533, 5);
  });
  test("10/10 mirrors 0/10: [0.722467, 1]", () => {
    const w = wilson(10, 10);
    expect(w.lo).toBeCloseTo(0.722467, 5);
    expect(w.hi).toBe(1);
  });
  test("1/10: centre 0.292073 / 1.384146 = 0.211013, half 1.959964 * sqrt(0.009 + 0.009604) / 1.384146 = 0.193136", () => {
    const w = wilson(1, 10);
    expect(w.lo).toBeCloseTo(0.017877, 5);
    expect(w.hi).toBeCloseTo(0.404149, 5);
  });
  test("n = 0 gives NaN, bad counts throw", () => {
    expect(Number.isNaN(wilson(0, 0).p)).toBe(true);
    expect(() => wilson(3, 2)).toThrow();
  });
});

describe("exact McNemar (two-sided binomial on discordant pairs)", () => {
  test("no discordant pairs: p = 1", () => expect(mcnemarExact(0, 0).p).toBe(1));
  test("5 vs 0: 2 * (1/2)^5 = 0.0625", () => expect(mcnemarExact(5, 0).p).toBeCloseTo(0.0625, 12));
  test("6 vs 1: 2 * (1 + 7) / 128 = 0.125", () => expect(mcnemarExact(6, 1).p).toBeCloseTo(0.125, 12));
  test("10 vs 2: 2 * (1 + 12 + 66) / 4096 = 0.03857421875", () => expect(mcnemarExact(10, 2).p).toBeCloseTo(0.03857421875, 12));
  test("2 vs 8: 2 * (1 + 10 + 45) / 1024 = 0.109375, symmetric", () => {
    expect(mcnemarExact(2, 8).p).toBeCloseTo(0.109375, 12);
    expect(mcnemarExact(8, 2).p).toBeCloseTo(0.109375, 12);
  });
  test("3 vs 3: capped at 1", () => expect(mcnemarExact(3, 3).p).toBe(1));
  test("binomCdfHalf edge cases and a large n", () => {
    expect(binomCdfHalf(-1, 5)).toBe(0);
    expect(binomCdfHalf(5, 5)).toBe(1);
    expect(binomCdfHalf(0, 3)).toBeCloseTo(0.125, 12);
    // Symmetry: P(X <= 1499) for n = 2999 is exactly 1/2
    expect(binomCdfHalf(1499, 2999)).toBeCloseTo(0.5, 10);
  });
});

describe("seeded sampling", () => {
  test("same seed, same sample; different seed, different order", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = sample(items, 5, mulberry32(42));
    expect(sample(items, 5, mulberry32(42))).toEqual(a);
    expect(sample(items, 5, mulberry32(43))).not.toEqual(a);
    expect(new Set(a).size).toBe(5);
    expect(sample([1, 2], 5, mulberry32(1)).sort()).toEqual([1, 2]);
  });
});

describe("csv", () => {
  test("round trip with commas, quotes, newlines, booleans and blanks", () => {
    const rows = [{ a: 'x,"y"', b: true, c: null }, { a: "line1\nline2", b: false, c: 3.5 }];
    const text = toCsv(["a", "b", "c"], rows);
    expect(parseCsv(text)).toEqual([{ a: 'x,"y"', b: "1", c: "" }, { a: "line1\nline2", b: "0", c: "3.5" }]);
  });
});
