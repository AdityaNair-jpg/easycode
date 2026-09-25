// Reads only the raw records of a run and writes results/<run_id>/summary.csv
// (brief, Section 7). Every state and metric is re-derived here from the raw
// record, so a scorer fix re-scores old data. Usage, from the repo root:
//   bun research/pilot/harness/score.ts <run_id>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attempted, toolCalls, toolResultTexts, turn1Validity, turn2Metrics } from "./classify.ts";
import { billedTokens, costUsd } from "./cost.ts";
import { toCsv, type Row } from "./csv.ts";
import { findSupportedChatModel } from "./easycode.ts";
import { stamp } from "./evidence.ts";
import { safeMove } from "./fsutil.ts";
import { RESULTS_DIR, RUNS_DIR, repoRel } from "./paths.ts";
import { listRecordFiles, readRecord, runDir } from "./store.ts";

export const SUMMARY_COLUMNS = [
  "unit", "run_id", "id", "trial_id", "source", "pass", "retry_of", "effective",
  "model_requested", "model_returned", "provider", "fault", "rep", "control_type",
  "branch", "variant", "condition", "state", "state_reason", "runtime_state", "state_mismatch",
  "retry", "recovered", "any_tool", "category", "looks_stale", "script_run", "token_in_result", "token_in_text",
  "tool_calls", "tool_log_mismatch", "flag_dotdot", "flag_stash", "hit_step_cap", "finish_reason", "steps",
  "input_tokens", "output_tokens", "reasoning_tokens", "billed_output_tokens", "cost_usd", "priced",
  "turn_wall_ms", "trial_wall_ms",
] as const;

type SummaryRow = Row & { unit: string; id: string; effective: boolean; state: string };

function usageCols(modelId: string, provider: string, turn: any) {
  const b = billedTokens(provider, turn?.usage);
  const priced = Boolean(findSupportedChatModel(modelId));
  return {
    input_tokens: b.inputTokens,
    output_tokens: b.outputTokens,
    reasoning_tokens: b.reasoningTokens,
    billed_output_tokens: b.billedOutputTokens,
    cost_usd: priced && turn?.usage ? costUsd(modelId, provider, turn.usage) : 0,
    priced,
  };
}

function turnCols(turn: any) {
  const calls = turn?.steps ? toolCalls(turn) : [];
  const executed = (turn?.steps ?? []).flatMap((s: any) => s.content).filter((p: any) => p.type === "tool-call" && !p.invalid).length;
  return {
    tool_calls: calls.length,
    // Every call the model made should appear in the harness's own tool log
    tool_log_mismatch: turn?.steps ? executed !== (turn.toolEvents?.length ?? 0) : false,
    flag_dotdot: calls.some((c) => c.argsText.includes("..")),
    flag_stash: calls.some((c) => c.argsText.includes("_stash")),
    hit_step_cap: Boolean(turn?.hitStepCap),
    finish_reason: turn?.finishReason ?? "",
    steps: turn?.steps?.length ?? 0,
    model_returned: (turn?.modelReturned ?? []).join("|"),
    turn_wall_ms: turn?.wallMs ?? "",
  };
}

function branchRow(runId: string, source: string, trial: any, b: any, pass: string | null): SummaryRow {
  const ran = b.state === "RAN";
  const m = ran ? turn2Metrics(trial.fault, b.turn, b.fix.token) : null;
  return {
    unit: "branch",
    run_id: runId,
    id: `${trial.trialId}/${b.id}`,
    trial_id: trial.trialId,
    source,
    pass: pass ?? "",
    retry_of: "",
    effective: false,
    model_requested: trial.modelRequested,
    provider: trial.provider,
    fault: trial.fault,
    rep: trial.rep,
    branch: b.id,
    variant: b.variant,
    condition: b.condition,
    state: b.state,
    state_reason: b.reason ?? "",
    retry: m?.retry ?? "",
    recovered: m?.recovered ?? "",
    any_tool: m?.anyTool ?? "",
    category: m?.category ?? "",
    looks_stale: m?.looksStale ?? "",
    script_run: m?.scriptRun ?? "",
    token_in_result: m?.tokenInResult ?? "",
    token_in_text: m?.tokenInText ?? "",
    ...turnCols(b.turn),
    ...usageCols(trial.modelRequested, trial.provider, b.turn),
  };
}

// Marks the one row per key that counts: the first that isn't an infra
// error, else the last attempt. Rows arrive in pass order.
function markEffective(rows: SummaryRow[], key: (r: SummaryRow) => string, failed: (r: SummaryRow) => boolean): void {
  const groups = new Map<string, SummaryRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  for (const g of groups.values()) (g.find((r) => !failed(r)) ?? g.at(-1)!).effective = true;
}

const passOrder = (p: unknown) => (p ? Number(String(p).replace(/\D/g, "")) || 1 : 0);

export function scoreRun(runId: string, runsRoot = RUNS_DIR): SummaryRow[] {
  const manifest = JSON.parse(readFileSync(join(runDir(runId, runsRoot), "manifest.json"), "utf8"));
  const turn1Rows: SummaryRow[] = [];
  const branchRows: SummaryRow[] = [];
  const controlRows: SummaryRow[] = [];
  const retriesByTrial = new Map<string, any[]>();
  const trials: { rec: any; source: string }[] = [];

  for (const file of listRecordFiles(runId, runsRoot)) {
    const rec = readRecord(file);
    const source = repoRel(file);
    if (rec.kind === "trial") trials.push({ rec, source });
    else if (rec.kind === "branch-retry") retriesByTrial.set(rec.trialId, [...(retriesByTrial.get(rec.trialId) ?? []), { rec, source }]);
    else if (rec.kind === "control") {
      const turn = rec.turn;
      const ok = turn?.outcome === "OK";
      const calls = ok ? toolCalls(turn) : [];
      const retry = ok ? attempted("CONTROL", calls) : "";
      const tokenInResult = ok ? toolResultTexts(turn).some((t) => t.includes(rec.token0)) : "";
      const tokenInText = ok ? turn.finalText.includes(rec.token0) : "";
      controlRows.push({
        unit: "control",
        run_id: runId,
        id: rec.controlId,
        trial_id: rec.controlId,
        source,
        pass: rec.pass ?? "",
        retry_of: rec.retryOf ?? "",
        effective: false,
        model_requested: rec.modelRequested,
        provider: rec.provider,
        control_type: rec.controlType,
        state: rec.error ? "INFRA_ERROR" : turn?.outcome === "OK" ? "OK" : (turn?.outcome ?? "INFRA_ERROR"),
        state_reason: rec.error ? "HARNESS_CRASH" : (turn?.error?.reason ?? ""),
        retry,
        recovered: ok ? Boolean(retry && tokenInResult && tokenInText) : "",
        any_tool: ok ? calls.length > 0 : "",
        token_in_result: tokenInResult,
        token_in_text: tokenInText,
        ...turnCols(turn),
        ...usageCols(rec.modelRequested, rec.provider, turn),
        trial_wall_ms: rec.wallMs,
      });
    }
  }

  trials.sort((a, b) => passOrder(a.rec.pass) - passOrder(b.rec.pass));
  for (const { rec, source } of trials) {
    const v = rec.turn1 ? turn1Validity(rec.fault, rec.turn1) : { state: rec.runtimeValidity.state, reason: rec.runtimeValidity.reason };
    // A harness crash outside the turn is still an infra error
    const state = rec.error && v.state !== "INFRA_ERROR" && !rec.turn1 ? "INFRA_ERROR" : v.state;
    turn1Rows.push({
      unit: "turn1",
      run_id: runId,
      id: rec.trialId,
      trial_id: rec.trialId,
      source,
      pass: rec.pass ?? "",
      retry_of: rec.retryOf ?? "",
      effective: false,
      model_requested: rec.modelRequested,
      provider: rec.provider,
      fault: rec.fault,
      rep: rec.rep,
      state,
      state_reason: v.reason ?? (rec.error ? "HARNESS_CRASH" : ""),
      runtime_state: rec.runtimeValidity.state,
      state_mismatch: rec.runtimeValidity.state !== state,
      ...turnCols(rec.turn1),
      ...usageCols(rec.modelRequested, rec.provider, rec.turn1),
      trial_wall_ms: rec.wallMs,
    });
    for (const b of rec.branches) branchRows.push(branchRow(runId, source, rec, b, null));
    const retries = (retriesByTrial.get(rec.trialId) ?? []).sort((a, b) => passOrder(a.rec.pass) - passOrder(b.rec.pass));
    for (const { rec: rr, source: rs } of retries) for (const b of rr.branches) branchRows.push(branchRow(runId, rs, rec, b, rr.pass));
  }

  // Planned units with no record at all are reported, never dropped
  const seen = new Set([...turn1Rows, ...controlRows].map((r) => String(r.retry_of || r.id)));
  for (const p of manifest.plan ?? []) {
    if (seen.has(p.id)) continue;
    const row: SummaryRow = {
      unit: p.kind === "control" ? "control" : "turn1",
      run_id: runId,
      id: p.id,
      trial_id: p.id,
      source: "",
      effective: false,
      model_requested: p.model,
      fault: p.fault ?? "",
      rep: p.rep ?? "",
      control_type: p.type ?? "",
      state: "MISSING_RECORD",
      state_reason: "planned, but no record was written",
    };
    (p.kind === "control" ? controlRows : turn1Rows).push(row);
  }

  const failed = (r: SummaryRow) => ["INFRA_ERROR", "MISSING_RECORD", "PROVIDER_REJECTED"].includes(r.state);
  markEffective(turn1Rows, (r) => String(r.retry_of || r.id), failed);
  markEffective(controlRows, (r) => String(r.retry_of || r.id), failed);
  markEffective(branchRows, (r) => r.id, (r) => r.state === "INFRA_ERROR");
  // Branches of a turn 1 that a retry replaced don't count
  const effectiveTrials = new Set(turn1Rows.filter((r) => r.effective).map((r) => r.id));
  for (const r of branchRows) if (!effectiveTrials.has(String(r.trial_id))) r.effective = false;

  return [...turn1Rows, ...branchRows, ...controlRows];
}

// Writes summary.csv. An older, different summary is moved aside, never lost.
export async function writeSummary(runId: string, runsRoot = RUNS_DIR, resultsRoot = RESULTS_DIR): Promise<string> {
  const rows = scoreRun(runId, runsRoot);
  const dir = join(resultsRoot, runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "summary.csv");
  const text = toCsv(SUMMARY_COLUMNS, rows);
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === text) return path;
    await safeMove(path, join(dir, "_superseded", stamp(), "summary.csv"));
  }
  writeFileSync(path, text);
  return path;
}

if (import.meta.main) {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: bun research/pilot/harness/score.ts <run_id>");
  const path = await writeSummary(runId);
  console.log(`wrote ${repoRel(path)}`);
}
