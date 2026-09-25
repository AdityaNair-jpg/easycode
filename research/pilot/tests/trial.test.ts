// The trial runner with scripted fake models: real tools, real faults, real
// file moves, no API calls
import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { Budget } from "../harness/cost.ts";
import { generateResult, obedientAgent, scriptedModel } from "../harness/fake-model.ts";
import { readNonce } from "../harness/fixture.ts";
import { fingerprint } from "../harness/fingerprint.ts";
import { BRANCHES, VARIANTS } from "../harness/history.ts";
import { turn2Metrics } from "../harness/classify.ts";
import { trialPaths } from "../harness/paths.ts";
import { prepareShell } from "../harness/shell-env.ts";
import { retryBranches, runControl, runTrial, type RunContext } from "../harness/trial.ts";
import { testDir } from "./helpers.ts";

prepareShell();

function context(label: string, budget = new Budget(100), timeoutMs?: number): RunContext {
  return {
    runId: `test-${label}`,
    wsRoot: testDir(label),
    budget,
    versions: { easycodeCommit: "test", harnessCommit: "test", harnessDirty: true },
    stop: { requested: false },
    timeoutMs,
  };
}

const subject = (model: any) => ({
  model: { requestedId: "fake-model", provider: "google", model, providerOptions: undefined },
  pricingModelId: "gemini-2.5-flash",
});

const apiError = (statusCode: number, isRetryable: boolean) =>
  new APICallError({ message: `fake ${statusCode}`, url: "https://example.invalid", requestBodyValues: {}, statusCode, isRetryable });

// Wraps a model so the listed calls (1-based) throw
function failing(inner: MockLanguageModelV3, failOn: Set<number>, err: () => Error): MockLanguageModelV3 {
  let n = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options: any) => {
      n += 1;
      if (failOn.has(n)) throw err();
      return inner.doGenerate(options);
    },
  });
}

describe("a valid trial with a well-behaved fake model", () => {
  test("F03: turn 1 valid, ten branches, each recovered with its own token; archives and snapshot in place", async () => {
    const ctx = context("trial-f03");
    const model = obedientAgent();
    const r = await runTrial(ctx, { trialId: "t0001", fault: "F03", rep: 1, subject: subject(model) });
    expect(r.error).toBeUndefined();
    expect(r.runtimeValidity.state).toBe("VALID");
    expect(r.turn1!.finalText).toContain("No such file or directory");
    expect(r.branches.map((b) => [b.id, b.state])).toEqual(BRANCHES.map((b) => [b.id, "RAN"]));

    const tokens = new Set<string>();
    for (const b of r.branches) {
      const m = turn2Metrics("F03", b.turn!, b.fix!.token);
      expect([b.id, m.category]).toEqual([b.id, "RECOVERED"]);
      tokens.add(b.fix!.token);
      const p = trialPaths(ctx.wsRoot, "t0001");
      // The archived workspace holds that branch's nonce
      expect(readNonce(p.arc(b.id))).toBe(b.fix!.nonce);
    }
    expect(tokens.size).toBe(10);
    expect(tokens.has(r.token0)).toBe(false);

    // Canonical path is back at the turn-1 snapshot, stash included
    const p = trialPaths(ctx.wsRoot, "t0001");
    expect(fingerprint(p.project).sha256).toBe(fingerprint(p.snapProject).sha256);
    expect(fingerprint(p.stash).sha256).toBe(fingerprint(p.snapStash).sha256);
    expect(existsSync(join(p.snapStash, "run_tests.sh"))).toBe(true);
    expect(model.doGenerateCalls.length).toBe(22);
  }, 60_000);

  test("what each condition sends: system prompt, history, NOTE", async () => {
    const ctx = context("trial-conditions");
    const r = await runTrial(ctx, { trialId: "t0002", fault: "F01", rep: 1, subject: subject(obedientAgent()) });
    expect(r.runtimeValidity.state).toBe("VALID");
    const by = Object.fromEntries(r.branches.map((b) => [b.id, b]));
    expect(by.V1_C1!.turn!.system).toBe(r.prompts.pNoRule);
    expect(by.V1_C4!.turn!.system).toBe(r.prompts.pFull);
    expect(by.V1_C1!.turn!.messages).toEqual([
      { role: "user", content: expect.stringContaining("Run the test suite") },
      { role: "assistant", content: r.turn1!.finalText },
      { role: "user", content: VARIANTS.V1 },
    ]);
    expect(by.V1_C2!.turn!.messages.length).toBe(2 + r.turn1!.responseMessages.length);
    expect(by.V1_C2!.turn!.messages.some((m: any) => m.role === "tool")).toBe(true);
    expect(by.V2_C3!.note).toContain("[Environment check, run just now: the bash tool works");
    expect((by.V2_C3!.turn!.messages.at(-1) as any).content).toBe(`${VARIANTS.V2}\n\n${by.V2_C3!.note}`);
    expect(by.V1_C1!.note).toBeUndefined();
    // F01: bash is simulated as missing in turn 1 only
    expect(r.turn1!.toolEvents.every((e) => e.simulated)).toBe(true);
    expect(by.V1_C1!.turn!.toolEvents.every((e) => !e.simulated)).toBe(true);
  }, 60_000);
});

describe("turn-1 states", () => {
  test("INVALID_NO_ATTEMPT: text only", async () => {
    const r = await runTrial(context("t1-noattempt"), {
      trialId: "t0003", fault: "F04", rep: 1,
      subject: subject(scriptedModel(() => [{ type: "text", text: "I would run it, but won't." }])),
    });
    expect(r.runtimeValidity.state).toBe("INVALID_NO_ATTEMPT");
    expect(r.branches).toEqual([]);
    expect(r.snapshot).toEqual([]);
  });

  test("INVALID_MODIFIED: the model writes a file", async () => {
    let n = 0;
    const model = scriptedModel(() =>
      ++n === 1
        ? [{ type: "tool-call", toolCallId: "w", toolName: "writeFile", input: JSON.stringify({ path: "lib/assert.sh", content: "# new\n" }) }]
        : [{ type: "tool-call", toolCallId: `b${n}`, toolName: "bash", input: JSON.stringify({ command: "bash scripts/run_tests.sh" }) }].slice(0, n === 2 ? 1 : 0).concat(n > 2 ? [{ type: "text", text: "done" } as any] : []) as any,
    );
    const r = await runTrial(context("t1-modified"), { trialId: "t0004", fault: "F04", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity.state).toBe("INVALID_MODIFIED");
  });

  test("INVALID_EMPTY: runs the script, then says nothing", async () => {
    let n = 0;
    const model = scriptedModel(() =>
      ++n === 1 ? [{ type: "tool-call", toolCallId: "b", toolName: "bash", input: JSON.stringify({ command: "bash scripts/run_tests.sh" }) }] : [],
    );
    const r = await runTrial(context("t1-empty"), { trialId: "t0005", fault: "F06", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity.state).toBe("INVALID_EMPTY");
  });

  test("INFRA_ERROR: an API error the SDK won't retry", async () => {
    const model = failing(obedientAgent(), new Set([1]), () => apiError(500, false));
    const r = await runTrial(context("t1-api"), { trialId: "t0006", fault: "F05", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity).toEqual({ state: "INFRA_ERROR", reason: "API_ERROR" });
    expect(r.turn1!.attempts.map((a) => a.ok)).toEqual([false]);
  });

  test("retryable errors are retried with backoff and logged", async () => {
    const model = failing(obedientAgent(), new Set([1, 2]), () => apiError(503, true));
    const ctx = context("t1-retry");
    const r = await runTrial(ctx, { trialId: "t0007", fault: "F05", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity.state).toBe("VALID");
    expect(r.turn1!.attempts.slice(0, 3).map((a) => a.ok)).toEqual([false, false, true]);
    expect(r.turn1!.attempts[0]!.error!.statusCode).toBe(503);
  }, 60_000);

  test("PROVIDER_REJECTED: a 400 stops the run", async () => {
    const ctx = context("t1-rejected");
    const model = failing(obedientAgent(), new Set([1]), () => apiError(400, false));
    const r = await runTrial(ctx, { trialId: "t0008", fault: "F05", rep: 1, subject: subject(model) });
    expect(r.turn1!.outcome).toBe("PROVIDER_REJECTED");
    expect(r.runtimeValidity).toEqual({ state: "INFRA_ERROR", reason: "PROVIDER_REJECTED" });
    expect(ctx.stop.requested).toBe(true);
    const next = await runTrial(ctx, { trialId: "t0009", fault: "F05", rep: 1, subject: subject(obedientAgent()) });
    expect(next.runtimeValidity.state).toBe("NOT_RUN");
  });

  test("TURN_TIMEOUT: a model call that never returns", async () => {
    const model = new MockLanguageModelV3({ doGenerate: () => new Promise(() => {}) });
    const r = await runTrial(context("t1-timeout", new Budget(100), 1500), { trialId: "t0010", fault: "F05", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity).toEqual({ state: "INFRA_ERROR", reason: "TURN_TIMEOUT" });
  }, 30_000);

  test.if(process.platform === "win32")("TURN_TIMEOUT: a hung bash command is found and killed", async () => {
    const marker = `sleep 600 # hung-${Date.now()}`;
    const model = scriptedModel(() => [
      { type: "tool-call", toolCallId: "h", toolName: "bash", input: JSON.stringify({ command: marker, timeout: 3_600_000 }) },
    ]);
    const r = await runTrial(context("t1-hung", new Budget(100), 4000), { trialId: "t0011", fault: "F05", rep: 1, subject: subject(model) });
    expect(r.runtimeValidity.reason).toBe("TURN_TIMEOUT");
    const killed = r.turn1!.killed ?? [];
    expect(killed.some((k) => k.killed && /bash\.exe/i.test(k.name) && k.commandLine.includes("hung-"))).toBe(true);
    const still = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker.split("# ")[1]}*' -and $_.Name -ne 'powershell.exe' }).Count`], { stdout: "pipe" });
    expect(still.stdout.toString().trim()).toBe("0");
  }, 60_000);
});

describe("budget guard", () => {
  test("stops before turn 1 when even one call would pass the budget", async () => {
    const ctx = context("budget-none", new Budget(0.001));
    const r = await runTrial(ctx, { trialId: "t0012", fault: "F05", rep: 1, subject: subject(obedientAgent()) });
    expect(r.runtimeValidity).toEqual({ state: "NOT_RUN", reason: "BUDGET_STOP" });
    expect(ctx.stop.requested).toBe(true);
    expect(ctx.budget.spentUsd).toBe(0);
  });

  test("stops between branches and never passes the limit", async () => {
    // Each fake turn is 2 steps of 1000 input and 50+10 output tokens at
    // Gemini prices: 2 * (1000 * 0.3 + 60 * 2.5) / 1e6 = 0.0009 USD
    const budget = new Budget(0.0045, 0, { input: 2000, output: 120 });
    const ctx = context("budget-mid", budget);
    const r = await runTrial(ctx, { trialId: "t0013", fault: "F05", rep: 1, subject: subject(obedientAgent()) });
    expect(r.runtimeValidity.state).toBe("VALID");
    const states = r.branches.map((b) => b.state);
    expect(states).toEqual(["RAN", "RAN", "RAN", ...Array(7).fill("NOT_RUN")]);
    expect(r.branches.at(-1)!.reason).toBe("BUDGET_STOP");
    expect(budget.spentUsd).toBeCloseTo(0.0036, 10);
    expect(budget.spentUsd).toBeLessThanOrEqual(0.0045);
  }, 60_000);
});

describe("infra errors in branches", () => {
  test.if(process.platform === "win32")("a move blocked by a held handle: INFRA_ERROR, then the rest can't run", async () => {
    const ctx = context("branch-busy");
    const p = trialPaths(ctx.wsRoot, "t0014");
    let fd: number | undefined;
    let n = 0;
    const inner = obedientAgent();
    // Hold README.md open during the first branch's turn, so archiving it fails
    const model = new MockLanguageModelV3({
      doGenerate: async (o: any) => {
        n += 1;
        if (n === 3) fd = openSync(join(p.project, "README.md"), "r");
        return inner.doGenerate(o);
      },
    });
    const r = await runTrial(ctx, { trialId: "t0014", fault: "F05", rep: 1, subject: subject(model) });
    if (fd !== undefined) closeSync(fd);
    expect(r.branches[0]!.state).toBe("INFRA_ERROR");
    expect(r.branches[0]!.reason).toBe("MOVE_FAILED");
    expect(r.branches.slice(1).every((b) => b.reason === "WORKSPACE_UNRESTORED")).toBe(true);
    expect(r.branches.length).toBe(10);
    // The retry pass refuses: the workspace isn't at the snapshot
    const retry = await retryBranches(ctx, r, subject(obedientAgent()), "retry1");
    expect(retry.precondition.workspaceAtSnapshot).toBe(false);
    expect(retry.branches.every((b: any) => b.reason === "WORKSPACE_NOT_AT_SNAPSHOT")).toBe(true);
  }, 60_000);

  test("an API error in one branch; the infra pass re-runs just that branch", async () => {
    const ctx = context("branch-api");
    // Calls 1-2 are turn 1; V1_C1 is 3-4, V1_C2 5-6, V1_C3 starts at 7
    const model = failing(obedientAgent(), new Set([7]), () => apiError(500, false));
    const r = await runTrial(ctx, { trialId: "t0015", fault: "F08", rep: 1, subject: subject(model) });
    expect(r.branches.map((b) => b.state)).toEqual(["RAN", "RAN", "INFRA_ERROR", "RAN", "RAN", "RAN", "RAN", "RAN", "RAN", "RAN"]);
    const retry = await retryBranches(ctx, r, subject(obedientAgent()), "retry1");
    expect(retry.precondition).toEqual({ workspaceAtSnapshot: true, targets: ["V1_C3"] });
    expect(retry.branches.map((b: any) => [b.id, b.state])).toEqual([["V1_C3", "RAN"]]);
    const b = retry.branches[0];
    expect(turn2Metrics("F08", b.turn, b.fix.token).category).toBe("RECOVERED");
    expect(existsSync(trialPaths(ctx.wsRoot, "t0015").arc("V1_C3.retry1"))).toBe(true);
  }, 60_000);
});

describe("controls", () => {
  test("T1 and V2 controls on a clean fixture", async () => {
    const ctx = context("controls");
    for (const type of ["T1", "V2"] as const) {
      const c = await runControl(ctx, { controlId: `k000${type === "T1" ? 1 : 2}`, type, subject: subject(obedientAgent()) });
      expect(c.turn!.outcome).toBe("OK");
      const m = turn2Metrics("CONTROL", c.turn!, c.token0);
      expect([type, m.retry, m.recovered]).toEqual([type, true, true]);
      expect(c.turn!.system).toBe(c.prompts.pNoRule);
    }
  }, 30_000);
});

describe("records", () => {
  test("a trial record survives a JSON round trip unchanged", async () => {
    const r = await runTrial(context("record"), { trialId: "t0016", fault: "F09", rep: 2, subject: subject(obedientAgent()) });
    expect(JSON.parse(JSON.stringify(r))).toEqual(JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(r)))));
    expect(r.turn1!.steps[0].request.body).toBeDefined();
    expect(r.turn1!.steps[1].request.body).toBeUndefined();
    expect(r.turn1!.steps[1].request.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.turn1!.modelReturned).toEqual(["fake-model-returned"]);
    expect(readFileSync(join(trialPaths(r.cwd.replace(/[\\/]t0016[\\/]project$/, ""), "t0016").project, "README.md"), "utf8")).toContain("Fixture");
  }, 60_000);
});
