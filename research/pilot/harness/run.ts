// Plans and runs a set of trials and controls, or the one infra-error pass
// for a finished run. Usage, from the repo root (launched from Git Bash; see
// deviation D4):
//   bun research/pilot/harness/run.ts --run-id <id> --purpose "<text>" \
//     [--models a,b] [--faults F01,F03] [--reps 5] [--controls 10] [--budget 75]
//   bun research/pilot/harness/run.ts --retry-infra <run_id>
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Budget } from "./cost.ts";
import { DEVIATIONS } from "./deviations.ts";
import { checkShell } from "./easycode.ts";
import { captureEnvironment } from "./environment.ts";
import { FAULT_IDS, isFaultId, type FaultId } from "./faults.ts";
import { createFixture, newNonce } from "./fixture.ts";
import { sha256, systemPrompts } from "./history.ts";
import { nextIds } from "./ids.ts";
import { DEFAULT_ROOTS, RUNS_DIR, assertRunFromRepoRoot, repoRel, type Roots } from "./paths.ts";
import { readDotenv } from "./secrets.ts";
import { prepareShell } from "./shell-env.ts";
import { listRecordFiles, readRecord, recordPath, runDir, writeJsonOnce, writeRecord } from "./store.ts";
import { callTool, instrumentedTools } from "./tools.ts";
import { MAX_RETRIES, STEP_CAP, TURN_TIMEOUT_MS, jsonSafe, realModel } from "./turn.ts";
import { retryBranches, runControl, runTrial, type ControlType, type RunContext, type Subject, type TrialRecord } from "./trial.ts";

// The brief's settings (Settings table). Only these models may run.
export const ALLOWED_MODELS = ["gemini-2.5-flash", "claude-haiku-4-5", "gpt-5.4-mini"] as const;
export const DEFAULTS = { budgetUsd: 75, models: [...ALLOWED_MODELS], reps: 5, controlsPerType: 10, concurrencyPerProvider: 4 };
const KEY_FOR_PROVIDER: Record<string, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export type PlanItem =
  | { id: string; kind: "trial"; model: string; fault: FaultId; rep: number }
  | { id: string; kind: "control"; model: string; type: ControlType };

export type RunOptions = {
  runId: string;
  purpose: string;
  models: string[];
  faults: FaultId[];
  reps: number;
  controlsPerType: number;
  budgetUsd: number;
  concurrencyPerProvider: number;
  roots?: Roots;
  runsRoot?: string;
  timeoutMs?: number;
  // Tests pass fakes; real runs resolve easycode's models
  subjectFor?: (modelId: string) => Subject;
  skipPreflight?: boolean;
};

// Everything that must hold before a paid call (brief, Sections 3 and 4.7)
export async function preflight(models: string[]): Promise<Record<string, unknown>> {
  assertRunFromRepoRoot();
  const shell = prepareShell();
  const check = await checkShell();
  if (!check.ok) throw new Error(`checkShell failed: ${check.reason}`);
  for (const m of models) {
    if (!(ALLOWED_MODELS as readonly string[]).includes(m)) throw new Error(`${m} is not in the brief's MODELS; stop and ask`);
  }
  const missingKeys = [...new Set(models.map((m) => realModel(m).provider))]
    .map((p) => KEY_FOR_PROVIDER[p]!)
    .filter((k) => !process.env[k]);
  if (missingKeys.length) throw new Error(`No API key loaded for: ${missingKeys.join(", ")} (names only; check the repo-root .env)`);
  // The grep tool spawns grep from this process's PATH (deviation D4)
  const probe = join(DEFAULT_ROOTS.arc, "_preflight", `${Date.now()}`, "project");
  createFixture(probe, newNonce());
  const grep = await callTool(instrumentedTools(probe, { disableBash: false }, []), "grep", { pattern: "^alpha$", path: "data" });
  if (!Array.isArray(grep?.matches) || grep.matches.length !== 1) {
    throw new Error(`easycode's grep tool fails in this launch environment (${JSON.stringify(grep)}); stop and ask the human`);
  }
  const env = captureEnvironment();
  if (env.code.harnessDirty) throw new Error("research/pilot has uncommitted changes; commit the harness before a real run");
  if (!env.code.productCodeMatchesPin) throw new Error("packages/ differs from the pinned commit; stop and ask");
  return { shell: { removedEnvNames: shell.removed, gitCeiling: shell.gitCeiling }, shellCheck: check, grepProbe: grep, dotenvNames: readDotenv().map((e) => e.name) };
}

// Spend so far across every run of the pilot, from the raw records
export function spentSoFar(runsRoot = RUNS_DIR): number {
  if (!existsSync(runsRoot)) return 0;
  let total = 0;
  for (const run of readdirSync(runsRoot)) {
    for (const file of listRecordFiles(run, runsRoot)) {
      const rec = readRecord(file);
      const turns = rec.kind === "control" ? [rec.turn] : rec.kind === "trial" ? [rec.turn1, ...rec.branches.map((b: any) => b.turn)] : rec.branches.map((b: any) => b.turn);
      for (const t of turns) total += Number(t?.costUsd) || 0;
    }
  }
  return total;
}

export function plan(opts: RunOptions, roots: Roots): PlanItem[] {
  const trialCount = opts.models.length * opts.faults.length * opts.reps;
  const controlCount = opts.models.length * opts.controlsPerType * 2;
  const tIds = nextIds(roots, "t", trialCount);
  const kIds = nextIds(roots, "k", controlCount);
  const items: PlanItem[] = [];
  const controls: PlanItem[] = [];
  for (const model of opts.models) {
    for (let i = 0; i < opts.controlsPerType; i++) {
      for (const type of ["T1", "V2"] as const) controls.push({ id: kIds.shift()!, kind: "control", model, type });
    }
  }
  // Rep by rep across faults, controls after rep 1 (deviation D10)
  for (let rep = 1; rep <= opts.reps; rep++) {
    for (const fault of opts.faults) for (const model of opts.models) items.push({ id: tIds.shift()!, kind: "trial", model, fault, rep });
    if (rep === 1) items.push(...controls);
  }
  if (opts.reps === 0) items.push(...controls);
  return items;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

// Hashes of the two prompts with the literal "<CWD>" as the project folder;
// each record holds the exact hashes for its own cwd
function templateHashes() {
  const p = systemPrompts("<CWD>");
  return { pFullTemplateSha256: p.pFullSha256, pNoRuleTemplateSha256: p.pNoRuleSha256 };
}

export async function executeRun(opts: RunOptions) {
  const roots = opts.roots ?? DEFAULT_ROOTS;
  const runsRoot = opts.runsRoot ?? RUNS_DIR;
  if (existsSync(runDir(opts.runId, runsRoot))) throw new Error(`Run ${opts.runId} already exists; a new run needs a new run_id`);
  const checks = opts.skipPreflight ? { skipped: true } : await preflight(opts.models);
  if (opts.skipPreflight) prepareShell();
  const subjectFor = opts.subjectFor ?? ((m: string) => ({ model: realModel(m) }));
  const env = captureEnvironment();
  const spent = spentSoFar(runsRoot);
  const ctx: RunContext = {
    runId: opts.runId,
    roots,
    budget: new Budget(opts.budgetUsd, spent),
    versions: { easycodeCommit: env.code.easycodeCommitRunAgainst, harnessCommit: env.code.harnessCommit, harnessDirty: env.code.harnessDirty },
    stop: { requested: false },
    timeoutMs: opts.timeoutMs,
  };
  const items = plan(opts, roots);
  const subjects = new Map(opts.models.map((m) => [m, subjectFor(m)]));
  writeJsonOnce(join(runDir(opts.runId, runsRoot), "manifest.json"), jsonSafe({
    runId: opts.runId,
    purpose: opts.purpose,
    createdAt: new Date().toISOString(),
    settings: {
      budgetUsd: opts.budgetUsd,
      models: opts.models,
      faults: opts.faults,
      reps: opts.reps,
      controlsPerType: opts.controlsPerType,
      concurrencyPerProvider: opts.concurrencyPerProvider,
      stepCap: STEP_CAP,
      turnTimeoutMs: opts.timeoutMs ?? TURN_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      spentBeforeRunUsd: spent,
      workRoot: roots.work,
      arcRoot: roots.arc,
    },
    environment: env,
    preflight: checks,
    models: opts.models.map((m) => {
      const s = subjects.get(m)!;
      return { requestedId: m, provider: s.model.provider, providerOptions: s.model.providerOptions ?? null };
    }),
    prompts: templateHashes(),
    deviations: DEVIATIONS,
    plan: items,
  }));

  const byProvider = new Map<string, PlanItem[]>();
  for (const it of items) {
    const p = subjects.get(it.model)!.model.provider;
    byProvider.set(p, [...(byProvider.get(p) ?? []), it]);
  }
  const counts = { trials: 0, controls: 0 };
  await Promise.all([...byProvider.values()].map((queue) => pool(queue, opts.concurrencyPerProvider, async (it) => {
    const subject = subjects.get(it.model)!;
    if (it.kind === "trial") {
      const rec = await runTrial(ctx, { trialId: it.id, fault: it.fault, rep: it.rep, subject });
      writeRecord(recordPath(opts.runId, it.id, null, runsRoot), jsonSafe(rec));
      counts.trials++;
    } else {
      const rec = await runControl(ctx, { controlId: it.id, type: it.type, subject });
      writeRecord(recordPath(opts.runId, it.id, null, runsRoot), jsonSafe(rec));
      counts.controls++;
    }
  })));
  const completion = { finishedAt: new Date().toISOString(), counts, spentThisRunUsd: ctx.budget.spentUsd - spent, spentTotalUsd: ctx.budget.spentUsd, stop: ctx.stop };
  writeJsonOnce(join(runDir(opts.runId, runsRoot), "completion.json"), completion);
  return { ctx, items, completion };
}

// The one logged pass that re-runs infra errors only (brief, rule 5)
export async function executeInfraRetryPass(runId: string, opts: { runsRoot?: string; roots?: Roots; subjectFor?: (m: string) => Subject; skipPreflight?: boolean; timeoutMs?: number } = {}) {
  const runsRoot = opts.runsRoot ?? RUNS_DIR;
  const roots = opts.roots ?? DEFAULT_ROOTS;
  const passFile = join(runDir(runId, runsRoot), "retry1.json");
  if (existsSync(passFile)) throw new Error(`The infra-error pass already ran for ${runId}`);
  const manifest = await Bun.file(join(runDir(runId, runsRoot), "manifest.json")).json();
  const checks = opts.skipPreflight ? { skipped: true } : await preflight(manifest.settings.models);
  if (opts.skipPreflight) prepareShell();
  const subjectFor = opts.subjectFor ?? ((m: string) => ({ model: realModel(m) }));
  const env = captureEnvironment();
  const spent = spentSoFar(runsRoot);
  const ctx: RunContext = {
    runId,
    roots,
    budget: new Budget(manifest.settings.budgetUsd, spent),
    versions: { easycodeCommit: env.code.easycodeCommitRunAgainst, harnessCommit: env.code.harnessCommit, harnessDirty: env.code.harnessDirty },
    stop: { requested: false },
    timeoutMs: opts.timeoutMs,
  };
  const records = listRecordFiles(runId, runsRoot).map((f) => readRecord(f));
  const failedTurn1 = records.filter((r) => r.kind === "trial" && r.runtimeValidity.state === "INFRA_ERROR") as TrialRecord[];
  const failedBranches = records.filter((r) => r.kind === "trial" && r.runtimeValidity.state === "VALID" && r.branches.some((b: any) => b.state === "INFRA_ERROR")) as TrialRecord[];
  const failedControls = records.filter((r) => r.kind === "control" && (r.error || r.turn?.outcome === "INFRA_ERROR"));
  const newT = nextIds(roots, "t", failedTurn1.length);
  const newK = nextIds(roots, "k", failedControls.length);
  const passPlan = {
    runId,
    pass: "retry1",
    startedAt: new Date().toISOString(),
    preflight: checks,
    environment: env,
    turn1: failedTurn1.map((r, i) => ({ retryOf: r.trialId, newId: newT[i] })),
    branches: failedBranches.map((r) => ({ trialId: r.trialId, branches: r.branches.filter((b: any) => b.state === "INFRA_ERROR").map((b: any) => b.id) })),
    controls: failedControls.map((r, i) => ({ retryOf: r.controlId, newId: newK[i] })),
  };
  writeJsonOnce(passFile, jsonSafe(passPlan));
  for (const [i, r] of failedTurn1.entries()) {
    const rec = await runTrial(ctx, { trialId: newT[i]!, fault: r.fault, rep: r.rep, subject: subjectFor(r.modelRequested), retryOf: r.trialId, pass: "retry1" });
    writeRecord(recordPath(runId, newT[i]!, null, runsRoot), jsonSafe(rec));
  }
  for (const r of failedBranches) {
    const rec = await retryBranches(ctx, r, subjectFor(r.modelRequested), "retry1");
    writeRecord(recordPath(runId, r.trialId, "retry1", runsRoot), rec);
  }
  for (const [i, r] of failedControls.entries()) {
    const rec = await runControl(ctx, { controlId: newK[i]!, type: r.controlType, subject: subjectFor(r.modelRequested), retryOf: r.controlId, pass: "retry1" });
    writeRecord(recordPath(runId, newK[i]!, null, runsRoot), jsonSafe(rec));
  }
  const done = { finishedAt: new Date().toISOString(), spentThisPassUsd: ctx.budget.spentUsd - spent, stop: ctx.stop };
  writeJsonOnce(join(runDir(runId, runsRoot), "retry1.completion.json"), done);
  return { passPlan, done };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const retryRun = arg("retry-infra");
  if (retryRun) {
    const out = await executeInfraRetryPass(retryRun);
    console.log(JSON.stringify(out.done, null, 2));
  } else {
    const runId = arg("run-id");
    const purpose = arg("purpose");
    if (!runId || !purpose) throw new Error("--run-id and --purpose are required");
    const faults = (arg("faults")?.split(",") ?? [...FAULT_IDS]).map((f) => {
      if (!isFaultId(f)) throw new Error(`Unknown fault ${f}`);
      return f;
    });
    const out = await executeRun({
      runId,
      purpose,
      models: arg("models")?.split(",") ?? DEFAULTS.models,
      faults,
      reps: Number(arg("reps") ?? DEFAULTS.reps),
      controlsPerType: Number(arg("controls") ?? DEFAULTS.controlsPerType),
      budgetUsd: Number(arg("budget") ?? DEFAULTS.budgetUsd),
      concurrencyPerProvider: DEFAULTS.concurrencyPerProvider,
    });
    console.log(`run ${runId}: ${out.items.length} planned; ${repoRel(runDir(runId))}`);
    console.log(JSON.stringify(out.completion, null, 2));
  }
}
