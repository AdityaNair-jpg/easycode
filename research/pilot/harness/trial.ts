// One trial: fixture, fault, turn 1, then ten turn-2 branches from the same
// turn 1 (brief, Section 4.4). Also the no-fault controls and the branch
// re-runs of the infra-error pass.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelMessage } from "ai";
import { buildNote } from "./copied.ts";
import { BudgetExceeded, type Budget } from "./cost.ts";
import { createFixture, newNonce, tokenFor } from "./fixture.ts";
import { FAULTS, applyFix, type FaultId, type FileOp, type FixRecord } from "./faults.ts";
import { fingerprint } from "./fingerprint.ts";
import { InfraError, safeCopy, safeMove, type CopyRecord, type MoveRecord } from "./fsutil.ts";
import { BRANCHES, T1, VARIANTS, systemPrompts, turn1Messages, turn2, type Condition, type SystemPrompts, type Variant } from "./history.ts";
import { turn1Validity, type Turn1State } from "./classify.ts";
import { repoRel, trialPaths, type Roots, type TrialPaths } from "./paths.ts";
import { jsonSafe, runTurn, type ModelHandle, type TurnRecord } from "./turn.ts";

export type Versions = { easycodeCommit: string; harnessCommit: string; harnessDirty: boolean };

// Shared by every trial in a run
export type RunContext = {
  runId: string;
  roots: Roots;
  budget: Budget;
  versions: Versions;
  // Set when the run must stop: provider rejection or budget
  stop: { requested: boolean; reason?: string; detail?: string };
  timeoutMs?: number;
};

export type Subject = { model: ModelHandle; pricingModelId?: string };

export type BranchState = "RAN" | "INFRA_ERROR" | "PROVIDER_REJECTED" | "NOT_RUN";

export type BranchRecord = {
  id: string;
  variant: Variant;
  condition: Condition;
  state: BranchState;
  reason?: string;
  fix?: FixRecord;
  shellCheck?: unknown;
  note?: string;
  turn?: TurnRecord;
  archive: MoveRecord[];
  restore: CopyRecord[];
  error?: string;
};

export type TrialRecord = {
  kind: "trial";
  schema: 1;
  runId: string;
  trialId: string;
  pass: string | null;
  retryOf?: string;
  modelRequested: string;
  provider: string;
  fault: FaultId;
  rep: number;
  versions: Versions;
  roots: Roots;
  cwd: string;
  projectRel: string;
  nonce0: string;
  token0: string;
  inject: FileOp[];
  prompts: SystemPrompts;
  turn1?: TurnRecord;
  runtimeValidity: { state: Turn1State; reason?: string };
  snapshot: CopyRecord[];
  branches: BranchRecord[];
  startedAt: string;
  endedAt: string;
  wallMs: number;
  error?: string;
};

// Under the archive root, so nothing sits next to project\
function logEvent(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

function notRunTurn(label: string, reason: string): TurnRecord {
  return { label, outcome: "NOT_RUN", error: { reason, summary: { name: "NotRun", message: reason } } } as unknown as TurnRecord;
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function snapshot(p: TrialPaths): Promise<CopyRecord[]> {
  const ops: CopyRecord[] = [];
  if (existsSync(p.project)) ops.push(await safeCopy(p.project, p.snapProject));
  ops.push(await safeCopy(p.stash, p.snapStash));
  return ops;
}

// Moves the finished branch workspace (and the stash) to the archive, then
// copies the turn-1 snapshot back to the canonical path
async function archiveAndRestore(p: TrialPaths, archiveName: string, b: BranchRecord): Promise<void> {
  if (existsSync(p.project)) b.archive.push(await safeMove(p.project, p.arc(archiveName)));
  b.archive.push(await safeMove(p.stash, p.arcStash(archiveName)));
  if (existsSync(p.snapProject)) b.restore.push(await safeCopy(p.snapProject, p.project));
  b.restore.push(await safeCopy(p.snapStash, p.stash));
}

type BranchInputs = {
  ctx: RunContext;
  subject: Subject;
  fault: FaultId;
  trialId: string;
  paths: TrialPaths;
  prompts: SystemPrompts;
  a1Text: string;
  a1Msgs: ModelMessage[];
};

async function runBranch(x: BranchInputs, branch: (typeof BRANCHES)[number], archiveName: string): Promise<BranchRecord> {
  const b: BranchRecord = { id: branch.id, variant: branch.variant, condition: branch.condition, state: "NOT_RUN", archive: [], restore: [] };
  if (x.ctx.stop.requested) {
    b.reason = x.ctx.stop.reason;
    return b;
  }
  const faultPaths = { project: x.paths.project, stash: x.paths.stash };
  try {
    b.fix = await applyFix(FAULTS[x.fault], faultPaths);
    logEvent(x.paths.log, { event: "fix", branch: archiveName, nonce: b.fix.nonce });
    let note: string | undefined;
    if (branch.condition === "C3" || branch.condition === "C5") {
      const built = await buildNote();
      b.shellCheck = built.check;
      note = b.note = built.note;
    }
    const { system, messages } = turn2(branch.condition, { prompts: x.prompts, a1Text: x.a1Text, a1Msgs: x.a1Msgs, variant: branch.variant, note });
    try {
      b.turn = await runTurn({
        label: archiveName,
        cwd: x.paths.project,
        system,
        messages,
        disableBash: false,
        model: x.subject.model,
        pricingModelId: x.subject.pricingModelId,
        budget: x.ctx.budget,
        trialDir: dirname(x.paths.project),
        timeoutMs: x.ctx.timeoutMs,
      });
      b.state = b.turn.outcome === "OK" ? "RAN" : b.turn.outcome === "PROVIDER_REJECTED" ? "PROVIDER_REJECTED" : "INFRA_ERROR";
      if (b.state !== "RAN") b.reason = b.turn.error?.reason;
      if (b.state === "PROVIDER_REJECTED") {
        x.ctx.stop.requested = true;
        x.ctx.stop.reason = "PROVIDER_REJECTED";
        x.ctx.stop.detail = `in ${x.trialId} ${archiveName}`;
      }
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      x.ctx.stop.requested = true;
      x.ctx.stop.reason = "BUDGET_STOP";
      x.ctx.stop.detail = err.message;
      b.state = "NOT_RUN";
      b.reason = "BUDGET_STOP";
    }
  } catch (err) {
    b.state = "INFRA_ERROR";
    b.reason = err instanceof InfraError ? err.reason : "HARNESS_CRASH";
    b.error = errText(err);
  }
  // Archive and restore even after a failure, so the next branch starts from
  // the snapshot; if that fails, later branches can't run
  try {
    await archiveAndRestore(x.paths, archiveName, b);
  } catch (err) {
    b.state = "INFRA_ERROR";
    b.reason = err instanceof InfraError ? err.reason : "HARNESS_CRASH";
    b.error = `${b.error ? `${b.error}; ` : ""}archive/restore: ${errText(err)}`;
    throw Object.assign(new InfraError("WORKSPACE_UNRESTORED", errText(err)), { branch: b });
  }
  logEvent(x.paths.log, { event: "branch", branch: archiveName, state: b.state, reason: b.reason });
  return b;
}

export type TrialSpec = { trialId: string; fault: FaultId; rep: number; subject: Subject; retryOf?: string; pass?: string | null };

export async function runTrial(ctx: RunContext, spec: TrialSpec): Promise<TrialRecord> {
  const started = Date.now();
  const paths = trialPaths(ctx.roots, spec.trialId);
  const fault = FAULTS[spec.fault];
  const nonce0 = newNonce();
  const record: TrialRecord = {
    kind: "trial",
    schema: 1,
    runId: ctx.runId,
    trialId: spec.trialId,
    pass: spec.pass ?? null,
    retryOf: spec.retryOf,
    modelRequested: spec.subject.model.requestedId,
    provider: spec.subject.model.provider,
    fault: spec.fault,
    rep: spec.rep,
    versions: ctx.versions,
    roots: ctx.roots,
    cwd: paths.project,
    projectRel: repoRel(paths.project),
    nonce0,
    token0: tokenFor(nonce0),
    inject: [],
    prompts: systemPrompts(paths.project),
    runtimeValidity: { state: "NOT_RUN" },
    snapshot: [],
    branches: [],
    startedAt: new Date(started).toISOString(),
    endedAt: "",
    wallMs: 0,
  };

  try {
    if (ctx.stop.requested) {
      record.turn1 = notRunTurn("turn1", ctx.stop.reason ?? "STOPPED");
      record.runtimeValidity = { state: "NOT_RUN", reason: ctx.stop.reason };
      return record;
    }
    createFixture(paths.project, nonce0);
    mkdirSync(paths.stash, { recursive: true });
    logEvent(paths.log, { event: "fixture", fault: spec.fault, nonce: nonce0 });
    record.inject = await fault.inject({ project: paths.project, stash: paths.stash });

    try {
      record.turn1 = await runTurn({
        label: "turn1",
        cwd: paths.project,
        system: record.prompts.pNoRule,
        messages: turn1Messages(),
        disableBash: fault.disablesBash,
        model: spec.subject.model,
        pricingModelId: spec.subject.pricingModelId,
        budget: ctx.budget,
        trialDir: dirname(paths.project),
        timeoutMs: ctx.timeoutMs,
      });
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      ctx.stop.requested = true;
      ctx.stop.reason = "BUDGET_STOP";
      ctx.stop.detail = err.message;
      record.turn1 = notRunTurn("turn1", "BUDGET_STOP");
    }
    if (record.turn1.outcome === "PROVIDER_REJECTED") {
      ctx.stop.requested = true;
      ctx.stop.reason = "PROVIDER_REJECTED";
      ctx.stop.detail = `in ${spec.trialId} turn1`;
    }
    record.runtimeValidity = turn1Validity(spec.fault, record.turn1);
    logEvent(paths.log, { event: "turn1", state: record.runtimeValidity.state });
    if (record.runtimeValidity.state !== "VALID") return record;

    record.snapshot = await snapshot(paths);
    const inputs: BranchInputs = {
      ctx,
      subject: spec.subject,
      fault: spec.fault,
      trialId: spec.trialId,
      paths,
      prompts: record.prompts,
      a1Text: record.turn1.finalText,
      a1Msgs: record.turn1.responseMessages,
    };
    for (const branch of BRANCHES) {
      try {
        record.branches.push(await runBranch(inputs, branch, branch.id));
      } catch (err) {
        record.branches.push((err as any).branch);
        // The workspace is no longer at the snapshot: the rest can't run
        for (const rest of BRANCHES.slice(record.branches.length)) {
          record.branches.push({ id: rest.id, variant: rest.variant, condition: rest.condition, state: "INFRA_ERROR", reason: "WORKSPACE_UNRESTORED", archive: [], restore: [] });
        }
        break;
      }
    }
  } catch (err) {
    record.error = errText(err);
    if (record.runtimeValidity.state === "NOT_RUN" || !record.turn1) {
      record.runtimeValidity = { state: "INFRA_ERROR", reason: err instanceof InfraError ? err.reason : "HARNESS_CRASH" };
    }
  } finally {
    record.endedAt = new Date().toISOString();
    record.wallMs = Date.now() - started;
  }
  return record;
}

// Infra-error pass for a valid trial: re-runs only the branches that ended
// in INFRA_ERROR, from the snapshot still at the canonical path
export async function retryBranches(ctx: RunContext, original: TrialRecord, subject: Subject, pass: string) {
  const paths = trialPaths(ctx.roots, original.trialId);
  const started = Date.now();
  const out = {
    kind: "branch-retry" as const,
    schema: 1,
    runId: ctx.runId,
    trialId: original.trialId,
    pass,
    versions: ctx.versions,
    branches: [] as BranchRecord[],
    precondition: {} as Record<string, unknown>,
    startedAt: new Date(started).toISOString(),
    endedAt: "",
    wallMs: 0,
  };
  const targets = BRANCHES.filter((b) => original.branches.find((x) => x.id === b.id)?.state === "INFRA_ERROR");
  const atSnapshot =
    existsSync(paths.snapStash) &&
    fingerprint(paths.project).sha256 === fingerprint(paths.snapProject).sha256 &&
    fingerprint(paths.stash).sha256 === fingerprint(paths.snapStash).sha256;
  out.precondition = { workspaceAtSnapshot: atSnapshot, targets: targets.map((t) => t.id) };
  const inputs: BranchInputs = {
    ctx,
    subject,
    fault: original.fault,
    trialId: original.trialId,
    paths,
    prompts: original.prompts,
    a1Text: original.turn1!.finalText,
    a1Msgs: original.turn1!.responseMessages,
  };
  for (const t of targets) {
    if (!atSnapshot) {
      out.branches.push({ id: t.id, variant: t.variant, condition: t.condition, state: "INFRA_ERROR", reason: "WORKSPACE_NOT_AT_SNAPSHOT", archive: [], restore: [] });
      continue;
    }
    try {
      out.branches.push(await runBranch(inputs, t, `${t.id}.${pass}`));
    } catch (err) {
      out.branches.push((err as any).branch);
      break;
    }
  }
  out.endedAt = new Date().toISOString();
  out.wallMs = Date.now() - started;
  return jsonSafe(out);
}

export type ControlType = "T1" | "V2";

export async function runControl(
  ctx: RunContext,
  spec: { controlId: string; type: ControlType; subject: Subject; retryOf?: string; pass?: string | null },
) {
  const started = Date.now();
  const paths = trialPaths(ctx.roots, spec.controlId);
  const nonce0 = newNonce();
  const record = {
    kind: "control" as const,
    schema: 1,
    runId: ctx.runId,
    controlId: spec.controlId,
    pass: spec.pass ?? null,
    retryOf: spec.retryOf,
    controlType: spec.type,
    modelRequested: spec.subject.model.requestedId,
    provider: spec.subject.model.provider,
    versions: ctx.versions,
    roots: ctx.roots,
    cwd: paths.project,
    projectRel: repoRel(paths.project),
    nonce0,
    token0: tokenFor(nonce0),
    prompts: systemPrompts(paths.project),
    turn: undefined as TurnRecord | undefined,
    error: undefined as string | undefined,
    startedAt: new Date(started).toISOString(),
    endedAt: "",
    wallMs: 0,
  };
  try {
    if (ctx.stop.requested) {
      record.turn = notRunTurn("control", ctx.stop.reason ?? "STOPPED");
    } else {
      createFixture(paths.project, nonce0);
      mkdirSync(paths.stash, { recursive: true });
      const message = spec.type === "T1" ? T1 : VARIANTS.V2;
      try {
        record.turn = await runTurn({
          label: `control_${spec.type}`,
          cwd: paths.project,
          system: record.prompts.pNoRule,
          messages: [{ role: "user", content: message }],
          disableBash: false,
          model: spec.subject.model,
          pricingModelId: spec.subject.pricingModelId,
          budget: ctx.budget,
          trialDir: dirname(paths.project),
          timeoutMs: ctx.timeoutMs,
        });
        if (record.turn.outcome === "PROVIDER_REJECTED") {
          ctx.stop.requested = true;
          ctx.stop.reason = "PROVIDER_REJECTED";
          ctx.stop.detail = `in ${spec.controlId}`;
        }
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        ctx.stop.requested = true;
        ctx.stop.reason = "BUDGET_STOP";
        ctx.stop.detail = err.message;
        record.turn = notRunTurn("control", "BUDGET_STOP");
      }
    }
  } catch (err) {
    record.error = errText(err);
  } finally {
    record.endedAt = new Date().toISOString();
    record.wallMs = Date.now() - started;
  }
  return record;
}
