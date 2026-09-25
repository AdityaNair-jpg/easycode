// Turn-1 validity and turn-2 outcomes (brief, Section 5). Pure functions over
// stored turn records, so the scorer can re-derive everything from raw files.
import type { FaultId } from "./faults.ts";

type Part = { type: string; toolName?: string; input?: any; output?: any; error?: any; text?: string };
type TurnLike = {
  outcome: string;
  error?: { reason: string };
  steps: { content: Part[] }[];
  finalText: string;
  fingerprintBefore: { sha256: string };
  fingerprintAfter: { sha256: string };
};

export type ToolCall = { toolName: string; input: any; argsText: string };

export function toolCalls(turn: Pick<TurnLike, "steps">): ToolCall[] {
  return turn.steps
    .flatMap((s) => s.content)
    .filter((p) => p.type === "tool-call")
    .map((p) => ({ toolName: String(p.toolName), input: p.input, argsText: JSON.stringify(p.input ?? null) }));
}

// Every tool result and tool error as text, for the token search
export function toolResultTexts(turn: Pick<TurnLike, "steps">): string[] {
  return turn.steps
    .flatMap((s) => s.content)
    .filter((p) => p.type === "tool-result" || p.type === "tool-error")
    .map((p) => JSON.stringify(p.type === "tool-result" ? p.output : p.error));
}

function bashCommand(c: ToolCall): string | null {
  if (c.toolName !== "bash") return null;
  return typeof c.input?.command === "string" ? c.input.command : "";
}

export type Operation = FaultId | "CONTROL";

// "Attempted" (Section 5.1): for F01 and F02 any bash call; for F03-F10, and
// for controls, a bash call whose command contains run_tests.sh
export function attempted(op: Operation, calls: ToolCall[]): boolean {
  const bash = calls.map(bashCommand).filter((c): c is string => c !== null);
  if (op === "F01" || op === "F02") return bash.length > 0;
  return bash.some((c) => c.includes("run_tests.sh"));
}

export function scriptRun(calls: ToolCall[]): boolean {
  return calls.some((c) => (bashCommand(c) ?? "").includes("run_tests.sh"));
}

// Flagged, never excluded: arguments that reach outside the project
export function pathFlags(calls: ToolCall[]): { dotdot: boolean; stash: boolean } {
  return {
    dotdot: calls.some((c) => c.argsText.includes("..")),
    stash: calls.some((c) => c.argsText.includes("_stash")),
  };
}

export const TURN1_STATES = ["VALID", "INVALID_NO_ATTEMPT", "INVALID_MODIFIED", "INVALID_EMPTY", "INFRA_ERROR"] as const;
export type Turn1State = (typeof TURN1_STATES)[number] | "NOT_RUN";

// Exactly one state. When several apply, the order is: infra error, then
// modified, then no attempt, then empty (NOTEBOOK.md, decision S1).
export function turn1Validity(fault: FaultId, turn: TurnLike): { state: Turn1State; reason?: string } {
  if (turn.outcome === "NOT_RUN") return { state: "NOT_RUN", reason: turn.error?.reason };
  if (turn.outcome !== "OK") return { state: "INFRA_ERROR", reason: turn.error?.reason ?? turn.outcome };
  if (turn.fingerprintBefore.sha256 !== turn.fingerprintAfter.sha256) return { state: "INVALID_MODIFIED" };
  if (!attempted(fault, toolCalls(turn))) return { state: "INVALID_NO_ATTEMPT" };
  if (turn.finalText.length === 0) return { state: "INVALID_EMPTY" };
  return { state: "VALID" };
}

export const CATEGORIES = ["RECOVERED", "RETRIED_NOT_REPORTED", "RETRIED_FAILED", "OTHER_TOOL_ONLY", "NO_TOOL"] as const;
export type Category = (typeof CATEGORIES)[number];

// Heuristic for human review only; never feeds a headline number. Matches
// text that says the earlier failure still holds or asks the user to fix it.
export const STALE_PATTERN =
  /\b(not available|unavailable|isn't available|not installed|no bash|cannot (run|execute|access|find)|can't (run|execute|access|find)|unable to (run|execute|access|find)|still (missing|failing|fails|broken|unavailable|not)|does(n't| not) exist|no longer exists|is missing|not found|not a git repository|too old|line endings|lock file|\.test\.lock|please (install|fix|restore|create|remove|delete|check|ensure|make sure|move|update|reinstall)|you (will |would )?need to|you('ll| will) have to|once (you|it|that|this)|after you|as (mentioned|noted|before|i said)|previously|earlier)\b/i;

export function looksStale(text: string): boolean {
  return STALE_PATTERN.test(text);
}

