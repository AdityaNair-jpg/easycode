// Scorer and report on a synthetic run whose answers were worked out by hand.
//
// gemini-2.5-flash (G), branch behaviours in order V1 C1-C5, V2 C1-C5:
//   t0001 F01 valid            N R R N R | R R R R R
//   t0002 F03 valid            N O R Q R | N R F R R
//   t0003 F03 no attempt
//   t0004 F01 infra error, replaced by t0005 (retry of t0004):
//   t0005 F01 valid            L R R R R | X R R R N   (V2_C1 retried in retry1 -> R)
// claude-haiku-4-5 (H):
//   t0006 F01 valid            N R N N R | N R R O R
//   t0007 F03 modified
//   t0008 F03 planned, no record
// Retry (change A) = a run_tests.sh bash command AND the new token in a tool
// result: R and Q retry; F (script failed) and L (`ls` on F01) don't.
// Rechecked (the brief's old definition) = R, Q, F, and L on F01.
// So for G, retry, in the order t1V1, t1V2, t2V1, t2V2, t5V1, t5V2:
//   C1: 0 1 0 0 0 1 -> 2/6   C2: 1 1 0 1 1 1 -> 5/6   C3: 1 1 1 0 1 1 -> 5/6
//   C4: 0 1 1 1 1 1 -> 5/6   C5: 1 1 1 1 1 0 -> 5/6
// G rechecked: C1 3/6 (L counts), C2 5/6, C3 6/6 (F counts), C4 5/6, C5 5/6
// H retry (and rechecked): C1 0/2, C2 2/2, C3 1/2, C4 0/2, C5 2/2
// Wilson, z = 1.959964, z^2 = 3.841459:
//   2/6: denom 1.640243, centre (0.333333+0.320122)/1.640243 = 0.398390,
//        half 1.959964*sqrt(0.037037+0.026677)/1.640243 = 0.301618 -> [9.7%, 70.0%]
//   3/6: centre 0.5, half 1.959964*sqrt(0.041667+0.026677)/1.640243 = 0.312383 -> [18.8%, 81.2%]
//   5/6: centre 1.153455/1.640243 = 0.703223, half 1.959964*sqrt(0.023148+0.026677)/1.640243 = 0.266724 -> [43.6%, 97.0%]
//   6/6: centre 0.804833, half 0.195167 -> [61.0%, 100%]
//   0/2: denom 2.920729, centre 0.328810, half 0.328810 -> [0%, 65.8%]
//   1/2: centre 0.5, half 1.959964*sqrt(0.125+0.240091)/2.920729 = 0.405469 -> [9.5%, 90.5%]
// Pairs on retry for G, C1 vs C5: (0,1) (1,1) (0,1) (0,1) (0,1) (1,0):
//   both 1, neither 0, b 1, c 4; p = 2 * (1 + 5)/32 = 0.375
// C1 vs C2: (0,1) (1,1) (0,0) (0,1) (0,1) (1,1): both 2, neither 1, b 0, c 3; p = 2 * 1/8 = 0.25
// Categories, G C1: RECOVERED 2 (t1V2, t5V2), OTHER_TOOL_ONLY 1 (L), NO_TOOL 3. RETRIED_FAILED overall: 1 (t2 V2_C3).
// H1: G stale 4/6 = 66.7% over 6, H 100% over 2; neither has n >= 40 -> not met
// H2: G |33.3% - 83.3%| = 50.0 points -> met
// H3: pooled C1 2/8 = 25.0%, C3 6/8 = 75.0%, difference 50.0 points -> met
// Cost: Gemini turn = 1000*0.3/1e6 + (100+50)*2.5/1e6 = 0.000675; Haiku turn = 1000*1/1e6 + 100*5/1e6 = 0.0015
//   G priced turns: 4 turn-1 (t4 infra has no usage) + 29 branches (t5 V2_C1 infra has none) + 1 retry branch + 3 controls = 37 -> 0.024975
//   H: 2 turn-1 + 10 branches + 1 control = 13 -> 0.0195; all 0.044475
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../harness/csv.ts";
import { writeReport } from "../harness/report.ts";
import { writeSummary } from "../harness/score.ts";
import { recordPath, writeJsonOnce, writeRecord } from "../harness/store.ts";
import { branchRetryRecord, controlRecord, trialRecord } from "./synthetic.ts";
import { testDir } from "./helpers.ts";

const RUN = "synthetic";
const G = "gemini-2.5-flash";
const H = "claude-haiku-4-5";

async function build() {
  const root = testDir("synthetic-run");
  const runsRoot = join(root, "runs");
  const resultsRoot = join(root, "results");
  const plan = [
    ...["t0001", "t0002", "t0003", "t0004"].map((id, i) => ({ id, kind: "trial", model: G, fault: i === 0 || i === 3 ? "F01" : "F03", rep: 1 })),
    ...["t0006", "t0007", "t0008"].map((id, i) => ({ id, kind: "trial", model: H, fault: i === 0 ? "F01" : "F03", rep: i === 2 ? 2 : 1 })),
    { id: "k0001", kind: "control", model: G, type: "T1" },
    { id: "k0002", kind: "control", model: G, type: "T1" },
    { id: "k0003", kind: "control", model: G, type: "V2" },
    { id: "k0004", kind: "control", model: H, type: "T1" },
    { id: "k0005", kind: "control", model: H, type: "V2" },
  ];
  writeJsonOnce(join(runsRoot, RUN, "manifest.json"), {
    runId: RUN,
    settings: { models: [G, H], faults: ["F01", "F03"], reps: 2, stepCap: 15, budgetUsd: 75 },
    models: [{ requestedId: G, provider: "google" }, { requestedId: H, provider: "anthropic" }],
    deviations: [{ id: "DX", text: "synthetic deviation" }],
    plan,
  });
  const put = (id: string, rec: unknown, pass: string | null = null) => writeRecord(recordPath(RUN, id, pass, runsRoot), rec);
  put("t0001", trialRecord(RUN, { trialId: "t0001", model: G, provider: "google", fault: "F01", rep: 1, turn1: "VALID", branches: "NRRNRRRRRR" }));
  put("t0002", trialRecord(RUN, { trialId: "t0002", model: G, provider: "google", fault: "F03", rep: 1, turn1: "VALID", branches: "NORQRNRFRR" }));
  put("t0003", trialRecord(RUN, { trialId: "t0003", model: G, provider: "google", fault: "F03", rep: 2, turn1: "INVALID_NO_ATTEMPT" }));
  put("t0004", trialRecord(RUN, { trialId: "t0004", model: G, provider: "google", fault: "F01", rep: 2, turn1: "INFRA_ERROR" }));
  put("t0005", trialRecord(RUN, { trialId: "t0005", model: G, provider: "google", fault: "F01", rep: 2, turn1: "VALID", branches: "LRRRRXRRRN", retryOf: "t0004", pass: "retry1" }));
  put("t0005", branchRetryRecord(RUN, "t0005", "google", "V2_C1", "R"), "retry1");
  put("t0006", trialRecord(RUN, { trialId: "t0006", model: H, provider: "anthropic", fault: "F01", rep: 1, turn1: "VALID", branches: "NRNNRNRROR" }));
  put("t0007", trialRecord(RUN, { trialId: "t0007", model: H, provider: "anthropic", fault: "F03", rep: 1, turn1: "INVALID_MODIFIED" }));
  put("k0001", controlRecord(RUN, "k0001", G, "google", "T1", "R"));
  put("k0002", controlRecord(RUN, "k0002", G, "google", "T1", "N"));
  put("k0003", controlRecord(RUN, "k0003", G, "google", "V2", "R"));
  put("k0004", controlRecord(RUN, "k0004", H, "anthropic", "T1", "R"));
  const summary = await writeSummary(RUN, runsRoot, resultsRoot);
  const out = await writeReport(RUN, { runsRoot, resultsRoot, seed: 7 });
  return { summary, out, rows: parseCsv(readFileSync(summary, "utf8")), report: readFileSync(out.report, "utf8"), runsRoot, resultsRoot };
}

const built = build();

describe("scorer on synthetic records", () => {
  test("one effective turn-1 row per planned trial; the infra error is replaced; the missing one is reported", async () => {
    const { rows } = await built;
    const t1 = rows.filter((r) => r.unit === "turn1");
    const eff = t1.filter((r) => r.effective === "1").map((r) => [r.id, r.state]);
    expect(eff.sort()).toEqual([
      ["t0001", "VALID"], ["t0002", "VALID"], ["t0003", "INVALID_NO_ATTEMPT"], ["t0005", "VALID"],
      ["t0006", "VALID"], ["t0007", "INVALID_MODIFIED"], ["t0008", "MISSING_RECORD"],
    ]);
    expect(t1.find((r) => r.id === "t0004")!.effective).toBe("0");
    expect(t1.every((r) => r.state_mismatch !== "1")).toBe(true);
  });

  test("branch categories and the retried branch", async () => {
    const { rows } = await built;
    const br = (id: string) => rows.filter((r) => r.unit === "branch" && r.id === id);
    expect(br("t0005/V2_C1").map((r) => [r.pass, r.state, r.effective, r.category])).toEqual([
      ["", "INFRA_ERROR", "0", ""],
      ["retry1", "RAN", "1", "RECOVERED"],
    ]);
    const one = (id: string) => br(id)[0]!;
    expect([one("t0005/V1_C1").category, one("t0005/V1_C1").retry, one("t0005/V1_C1").script_run]).toEqual(["RETRIED_FAILED", "1", "0"]);
    expect([one("t0002/V2_C3").category, one("t0002/V2_C3").script_run]).toEqual(["RETRIED_FAILED", "1"]);
    expect(one("t0002/V1_C4").category).toBe("RETRIED_NOT_REPORTED");
    expect(one("t0002/V1_C2").category).toBe("OTHER_TOOL_ONLY");
    expect([one("t0001/V1_C1").category, one("t0001/V1_C1").looks_stale]).toEqual(["NO_TOOL", "1"]);
    expect(one("t0001/V1_C2").looks_stale).toBe("");
  });

  test("controls, including the missing one", async () => {
    const { rows } = await built;
    const c = rows.filter((r) => r.unit === "control" && r.effective === "1").map((r) => [r.id, r.state, r.retry, r.recovered]);
    expect(c.sort()).toEqual([
      ["k0001", "OK", "1", "1"], ["k0002", "OK", "0", "0"], ["k0003", "OK", "1", "1"], ["k0004", "OK", "1", "1"], ["k0005", "MISSING_RECORD", "", ""],
    ]);
  });

  test("cost per row from usage and the pricing table", async () => {
    const { rows } = await built;
    const g = rows.find((r) => r.id === "t0001/V1_C2")!;
    expect([g.input_tokens, g.output_tokens, g.reasoning_tokens, g.billed_output_tokens]).toEqual(["1000", "100", "50", "150"]);
    expect(Number(g.cost_usd)).toBeCloseTo(0.000675, 12);
    expect(Number(rows.find((r) => r.id === "t0006/V1_C2")!.cost_usd)).toBeCloseTo(0.0015, 12);
  });

  test("re-scoring the same raw files gives the same summary", async () => {
    const { summary, runsRoot, resultsRoot } = await built;
    const before = readFileSync(summary, "utf8");
    await writeSummary(RUN, runsRoot, resultsRoot);
    expect(readFileSync(summary, "utf8")).toBe(before);
  });
});

describe("report on synthetic records", () => {
  test("problems section counts", async () => {
    const { report } = await built;
    expect(report).toContain("**RETRIED_FAILED branches: 2.**");
    expect(report).toContain("**Infra errors and missing records, all passes: 4** (2 still counted after the infra-error pass; the rest were replaced by a retry).");
    expect(report).toContain("- **DX** synthetic deviation");
    expect(report.indexOf("## 1. Problems first")).toBeLessThan(report.indexOf("## 2. Manifest"));
  });

  test("accounting", async () => {
    const { report } = await built;
    expect(report).toContain("| gemini-2.5-flash | F01 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(report).toContain("| gemini-2.5-flash | F03 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(report).toContain("| claude-haiku-4-5 | F03 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 2 |");
  });

  test("primary table: rates and Wilson intervals", async () => {
    const { report } = await built;
    expect(report).toContain(
      "| gemini-2.5-flash | 50.0% [18.8%, 81.2%] (3/6) | 83.3% [43.6%, 97.0%] (5/6) | 100.0% [61.0%, 100.0%] (6/6) | 83.3% [43.6%, 97.0%] (5/6) | 83.3% [43.6%, 97.0%] (5/6) |",
    );
    expect(report).toContain("| claude-haiku-4-5 | 0.0% [0.0%, 65.8%] (0/2) | 100.0% [34.2%, 100.0%] (2/2) | 50.0% [9.5%, 90.5%] (1/2) | 0.0% [0.0%, 65.8%] (0/2) | 100.0% [34.2%, 100.0%] (2/2) |");
    expect(report).toContain("so they are not independent");
  });

  test("paired comparisons with exact McNemar p", async () => {
    const { report } = await built;
    expect(report).toContain("| gemini-2.5-flash | C1 vs C2 | 6 | 3 | 1 | 0 | 2 | 0.500 (exploratory) |");
    expect(report).toContain("| gemini-2.5-flash | C1 vs C5 | 6 | 2 | 0 | 1 | 3 | 0.625 (exploratory) |");
  });

  test("categories, controls, thresholds, cost", async () => {
    const { report } = await built;
    expect(report).toContain("| gemini-2.5-flash | C1 | 2 | 0 | 1 | 0 | 3 | 3 | 6 |");
    expect(report).toContain("| gemini-2.5-flash | T1 | 2 | 50.0% [9.5%, 90.5%] (1/2) | 50.0% [9.5%, 90.5%] (1/2) |");
    expect(report).toMatch(/\| H1: .* \| not met \|/);
    expect(report).toMatch(/\| H2: .*gemini-2.5-flash: C1 50.0%, C2 83.3%, gap 33.3 points.* \| \*\*met\*\* \|/);
    expect(report).toContain("C1 37.5% (n = 8), C3 87.5% (n = 8), difference 50.0 points | **met** |");
    expect(report).toContain("**$0.0250**");
    expect(report).toContain("**$0.0195**");
    expect(report).toContain("**$0.0445**");
  });

  test("figure, review sample, renders, audit", async () => {
    const { out, report } = await built;
    const svg = readFileSync(out.figure, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("gemini-2.5-flash C1: 50.0% [18.8%, 81.2%], 3/6");
    const sample = parseCsv(readFileSync(out.reviewSample!, "utf8"));
    // G: C1 3+3, C2 0+5, C3 0+5, C4 1+5, C5 1+5 = 28; H: 2+0, 0+2, 1+1, 1+1, 0+2 = 10
    expect(sample.length).toBe(38);
    expect(sample.every((r) => r.human_label === "" && r.seed === "7")).toBe(true);
    expect(sample.every((r) => existsSync(join(import.meta.dir, "..", "..", "..", r.render_path)))).toBe(true);
    expect(report).toContain("## 11. Number audit");
  });

  test("regenerating leaves the report and an existing review sample alone", async () => {
    const { out, runsRoot, resultsRoot, report } = await built;
    const sampleBefore = readFileSync(out.reviewSample!, "utf8");
    const again = await writeReport(RUN, { runsRoot, resultsRoot, seed: 99 });
    expect(again.reviewSample).toBeNull();
    expect(readFileSync(out.reviewSample!, "utf8")).toBe(sampleBefore);
    // The report changed (the sample line), so the old one was moved aside, not overwritten
    expect(readFileSync(again.report, "utf8")).not.toBe(report);
    const superseded = join(resultsRoot, RUN, "_superseded");
    expect(existsSync(superseded)).toBe(true);
  });
});
