import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { obedientAgent } from "../harness/fake-model.ts";
import { ALLOWED_MODELS, executeInfraRetryPass, executeRun, plan, spentSoFar, type RunOptions } from "../harness/run.ts";
import { writeSummary } from "../harness/score.ts";
import { parseCsv } from "../harness/csv.ts";
import { listRecordFiles, readRecord } from "../harness/store.ts";
import { testDir } from "./helpers.ts";

const fakeSubject = (model: () => any) => (m: string) => ({
  model: { requestedId: m, provider: "google", model: model(), providerOptions: undefined },
  pricingModelId: "gemini-2.5-flash",
});

function options(label: string, over: Partial<RunOptions> = {}): RunOptions {
  const root = testDir(label);
  return {
    runId: `run-${label}`,
    purpose: "test",
    models: ["gemini-2.5-flash"],
    faults: ["F03", "F08"],
    reps: 1,
    controlsPerType: 1,
    budgetUsd: 1,
    concurrencyPerProvider: 4,
    wsRoot: join(root, "ws"),
    runsRoot: join(root, "runs"),
    subjectFor: fakeSubject(obedientAgent),
    skipPreflight: true,
    ...over,
  };
}

describe("planning", () => {
  test("rep by rep across faults, controls after rep 1, ids unique", () => {
    const o = options("plan", { faults: ["F01", "F02"], reps: 2, controlsPerType: 1, models: ["gemini-2.5-flash", "claude-haiku-4-5"] });
    const items = plan(o, o.wsRoot!);
    expect(items.map((i) => (i.kind === "trial" ? `${i.id}:${i.model[0]}${i.fault}r${i.rep}` : `${i.id}:${i.model[0]}${i.type}`))).toEqual([
      "t0001:gF01r1", "t0002:cF01r1", "t0003:gF02r1", "t0004:cF02r1",
      "k0001:gT1", "k0002:gV2", "k0003:cT1", "k0004:cV2",
      "t0005:gF01r2", "t0006:cF01r2", "t0007:gF02r2", "t0008:cF02r2",
    ]);
  });

  test("the brief's three models are the only ones allowed", () => {
    expect([...ALLOWED_MODELS]).toEqual(["gemini-2.5-flash", "claude-haiku-4-5", "gpt-5.4-mini"]);
  });
});

describe("executeRun with a fake model", () => {
  test("writes the manifest first, one record per planned unit, and a completion file", async () => {
    const o = options("exec");
    const out = await executeRun(o);
    const dir = join(o.runsRoot!, o.runId);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.plan.length).toBe(4);
    expect(manifest.deviations.map((d: any) => d.id)).toContain("D1");
    expect(manifest.settings).toMatchObject({ reps: 1, stepCap: 15, maxRetries: 5, concurrencyPerProvider: 4 });
    expect(listRecordFiles(o.runId, o.runsRoot!).length).toBe(4);
    expect(out.completion.counts).toEqual({ trials: 2, controls: 2 });
    expect(existsSync(join(dir, "completion.json"))).toBe(true);
    expect(spentSoFar(o.runsRoot!)).toBeCloseTo(out.completion.spentTotalUsd, 12);
    await expect(executeRun(o)).rejects.toThrow("already exists");
    // Scores end to end
    const rows = parseCsv(readFileSync(await writeSummary(o.runId, o.runsRoot!, join(o.runsRoot!, "..", "results")), "utf8"));
    expect(rows.filter((r) => r.unit === "branch" && r.category === "RECOVERED").length).toBe(20);
  }, 120_000);

  test("the infra-error pass re-runs a failed turn 1 under a new id, once", async () => {
    let calls = 0;
    // The very first model call fails without retry; everything after works
    const flaky = () => {
      const inner = obedientAgent();
      return new MockLanguageModelV3({
        doGenerate: async (o: any) => {
          calls += 1;
          if (calls === 1) throw new APICallError({ message: "fake 500", url: "x", requestBodyValues: {}, statusCode: 500, isRetryable: false });
          return inner.doGenerate(o);
        },
      });
    };
    const o = options("retry-pass", { faults: ["F05"], controlsPerType: 0, concurrencyPerProvider: 1, subjectFor: fakeSubject(flaky) });
    await executeRun(o);
    const first = listRecordFiles(o.runId, o.runsRoot!).map((f) => readRecord(f));
    expect(first.map((r) => r.runtimeValidity.state)).toEqual(["INFRA_ERROR"]);
    const pass = await executeInfraRetryPass(o.runId, { runsRoot: o.runsRoot, wsRoot: o.wsRoot, subjectFor: fakeSubject(obedientAgent), skipPreflight: true });
    expect(pass.passPlan.turn1).toEqual([{ retryOf: "t0001", newId: "t0002" }]);
    const after = listRecordFiles(o.runId, o.runsRoot!).map((f) => readRecord(f));
    const retry = after.find((r) => r.trialId === "t0002")!;
    expect([retry.retryOf, retry.pass, retry.runtimeValidity.state]).toEqual(["t0001", "retry1", "VALID"]);
    await expect(executeInfraRetryPass(o.runId, { runsRoot: o.runsRoot, wsRoot: o.wsRoot, skipPreflight: true })).rejects.toThrow("already ran");
  }, 120_000);
});
