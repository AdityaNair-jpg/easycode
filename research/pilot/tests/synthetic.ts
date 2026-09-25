// Builds synthetic raw records in the runner's format from a compact
// description, so scorer and report tests can use hand-worked answers
import { BRANCHES } from "../harness/history.ts";

// Branch behaviours:
//   R  runs the script, gets the token, quotes it           -> RECOVERED
//   Q  runs the script, gets the token, doesn't quote it    -> RETRIED_NOT_REPORTED
//   F  runs the script, no token in the result              -> RETRIED_FAILED; rechecked, not a retry
//   L  bash `ls` only (rechecked on F01/F02, not a retry)   -> OTHER_TOOL_ONLY
//   O  readFile only                                        -> OTHER_TOOL_ONLY
//   N  no tools, says bash is still not available           -> NO_TOOL, looks_stale
//   X  infra error (API)
export type Behaviour = "R" | "Q" | "F" | "L" | "O" | "N" | "X";

const USAGE: Record<string, any> = {
  google: { inputTokens: 1000, outputTokens: 100, outputTokenDetails: { reasoningTokens: 50 } },
  anthropic: { inputTokens: 1000, outputTokens: 100, outputTokenDetails: { reasoningTokens: 0 } },
};

const call = (toolName: string, input: any) => ({ type: "tool-call", toolCallId: "c", toolName, input });
const result = (toolName: string, output: any) => ({ type: "tool-result", toolCallId: "c", toolName, input: {}, output });
const text = (t: string) => ({ type: "text", text: t });

export function turn(b: Behaviour | "T1", token: string, provider: string, opts: { modified?: boolean } = {}) {
  const base = {
    label: "synthetic",
    system: "SYSTEM",
    systemSha256: "0".repeat(64),
    messages: [{ role: "user", content: "synthetic" }],
    toolNames: [],
    fingerprintBefore: { sha256: "a" },
    fingerprintAfter: { sha256: opts.modified ? "b" : "a" },
    hitStepCap: false,
    modelReturned: [provider === "google" ? "gemini-2.5-flash" : "claude-haiku-4-5-20251001"],
    wallMs: 1000,
    billed: {},
  };
  if (b === "X") return { ...base, outcome: "INFRA_ERROR", error: { reason: "API_ERROR", summary: { name: "APICallError", message: "fake" } }, steps: [], toolEvents: [], finalText: "", finishReason: null, usage: undefined };
  const bash = (command: string, output: any, said: string) => ({
    steps: [{ content: [call("bash", { command }), result("bash", output)] }, { content: [text(said)] }],
    toolEvents: [{ toolName: "bash" }],
    finalText: said,
  });
  const pass = { stdout: `RESULT: PASS 7/7 token=${token}\n`, stderr: "", exitCode: 0 };
  const parts =
    b === "T1" ? bash("bash scripts/run_tests.sh", { error: "No bash shell is available." }, "Bash is not available.")
    : b === "R" ? bash("bash scripts/run_tests.sh", pass, `It passed: RESULT: PASS 7/7 token=${token}`)
    : b === "Q" ? bash("bash scripts/run_tests.sh", pass, "It passed.")
    : b === "F" ? bash("bash scripts/run_tests.sh", { stdout: "", stderr: "ERROR: x", exitCode: 1 }, "It failed.")
    : b === "L" ? bash("ls", { stdout: "README.md\n", stderr: "", exitCode: 0 }, "Listed the files.")
    : b === "O"
      ? { steps: [{ content: [call("readFile", { path: "README.md" }), result("readFile", { content: "# Fixture" })] }, { content: [text("I read the README.")] }], toolEvents: [{ toolName: "readFile" }], finalText: "I read the README." }
      : { steps: [{ content: [text("Bash is still not available, so I can't run it.")] }], toolEvents: [], finalText: "Bash is still not available, so I can't run it." };
  return { ...base, outcome: "OK", ...parts, finishReason: "stop", usage: USAGE[provider] };
}

export type TrialSpec = {
  trialId: string;
  model: string;
  provider: string;
  fault: string;
  rep: number;
  turn1: "VALID" | "INVALID_NO_ATTEMPT" | "INVALID_MODIFIED" | "INFRA_ERROR";
  // Ten behaviours in BRANCHES order: V1_C1..V1_C5, V2_C1..V2_C5
  branches?: string;
  retryOf?: string;
  pass?: string;
};

export function trialRecord(runId: string, s: TrialSpec) {
  const t1 =
    s.turn1 === "INFRA_ERROR" ? turn("X", "t0", s.provider)
    : s.turn1 === "INVALID_NO_ATTEMPT" ? turn("N", "t0", s.provider)
    : turn("T1", "t0", s.provider, { modified: s.turn1 === "INVALID_MODIFIED" });
  const bs = (s.branches ?? "").split("");
  return {
    kind: "trial",
    schema: 1,
    runId,
    trialId: s.trialId,
    pass: s.pass ?? null,
    retryOf: s.retryOf,
    modelRequested: s.model,
    provider: s.provider,
    fault: s.fault,
    rep: s.rep,
    versions: { easycodeCommit: "synthetic", harnessCommit: "synthetic", harnessDirty: false },
    cwd: `D:\\ws\\${s.trialId}\\project`,
    projectRel: `ws/${s.trialId}/project`,
    nonce0: "n0",
    token0: "t0",
    inject: [],
    prompts: { pFull: "SYSTEM", pNoRule: "SYSTEM", pFullSha256: "", pNoRuleSha256: "" },
    turn1: t1,
    runtimeValidity: { state: s.turn1, reason: s.turn1 === "INFRA_ERROR" ? "API_ERROR" : undefined },
    snapshot: [],
    branches: bs.map((b, i) => {
      const br = BRANCHES[i]!;
      const token = `tok-${s.trialId}-${br.id}`;
      return {
        id: br.id,
        variant: br.variant,
        condition: br.condition,
        state: b === "X" ? "INFRA_ERROR" : "RAN",
        reason: b === "X" ? "API_ERROR" : undefined,
        fix: { ops: [], nonce: "n", token },
        turn: turn(b as Behaviour, token, s.provider),
        archive: [],
        restore: [],
      };
    }),
    startedAt: "2026-09-25T00:00:00Z",
    endedAt: "2026-09-25T00:01:00Z",
    wallMs: 60000,
  };
}

export function branchRetryRecord(runId: string, trialId: string, provider: string, branchId: string, b: Behaviour) {
  const br = BRANCHES.find((x) => x.id === branchId)!;
  const token = `tok-${trialId}-${branchId}-retry`;
  return {
    kind: "branch-retry",
    schema: 1,
    runId,
    trialId,
    pass: "retry1",
    versions: { easycodeCommit: "synthetic", harnessCommit: "synthetic", harnessDirty: false },
    precondition: { workspaceAtSnapshot: true, targets: [branchId] },
    branches: [{ id: br.id, variant: br.variant, condition: br.condition, state: "RAN", fix: { ops: [], nonce: "n", token }, turn: turn(b, token, provider), archive: [], restore: [] }],
    startedAt: "",
    endedAt: "",
    wallMs: 0,
  };
}

export function controlRecord(runId: string, controlId: string, model: string, provider: string, type: "T1" | "V2", b: Behaviour) {
  return {
    kind: "control",
    schema: 1,
    runId,
    controlId,
    pass: null,
    controlType: type,
    modelRequested: model,
    provider,
    versions: { easycodeCommit: "synthetic", harnessCommit: "synthetic", harnessDirty: false },
    cwd: "",
    projectRel: "",
    nonce0: "n",
    token0: `ctok-${controlId}`,
    prompts: { pFull: "SYSTEM", pNoRule: "SYSTEM" },
    turn: turn(b, `ctok-${controlId}`, provider),
    startedAt: "",
    endedAt: "",
    wallMs: 1000,
  };
}
