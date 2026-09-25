import { describe, expect, test } from "bun:test";
import { attempted, looksStale, pathFlags, toolCalls, turn1Validity, turn2Metrics } from "../harness/classify.ts";

const call = (toolName: string, input: any) => ({ type: "tool-call", toolName, input });
const steps = (...parts: any[]) => [{ content: parts }];

describe("attempted (Section 5.1)", () => {
  const ls = toolCalls({ steps: steps(call("bash", { command: "ls" })) });
  const script = toolCalls({ steps: steps(call("bash", { command: "cd . && bash scripts/run_tests.sh --verbose" })) });
  const read = toolCalls({ steps: steps(call("readFile", { path: "scripts/run_tests.sh" })) });
  test("F01 and F02: any bash call", () => {
    expect(attempted("F01", ls)).toBe(true);
    expect(attempted("F02", ls)).toBe(true);
    expect(attempted("F01", read)).toBe(false);
  });
  test("F03-F10 and controls: a bash command containing run_tests.sh", () => {
    expect(attempted("F03", ls)).toBe(false);
    expect(attempted("F07", script)).toBe(true);
    expect(attempted("F10", read)).toBe(false);
    expect(attempted("CONTROL", script)).toBe(true);
  });
});

describe("turn-1 validity order (decision S1)", () => {
  const base = { outcome: "OK", finalText: "x", fingerprintBefore: { sha256: "a" }, fingerprintAfter: { sha256: "a" }, steps: steps(call("bash", { command: "bash scripts/run_tests.sh" })) };
  test("each state", () => {
    expect(turn1Validity("F03", base).state).toBe("VALID");
    expect(turn1Validity("F03", { ...base, outcome: "INFRA_ERROR", error: { reason: "API_ERROR" } })).toEqual({ state: "INFRA_ERROR", reason: "API_ERROR" });
    expect(turn1Validity("F03", { ...base, fingerprintAfter: { sha256: "b" }, steps: [] }).state).toBe("INVALID_MODIFIED");
    expect(turn1Validity("F03", { ...base, steps: [], finalText: "" }).state).toBe("INVALID_NO_ATTEMPT");
    expect(turn1Validity("F03", { ...base, finalText: "" }).state).toBe("INVALID_EMPTY");
  });
});

describe("turn-2 metrics", () => {
  test("the token has to be in a tool result and in the text", () => {
    const t = { steps: steps(call("bash", { command: "bash scripts/run_tests.sh" }), { type: "tool-result", toolName: "bash", output: { stdout: "token=abc" } }), finalText: "token=abc" };
    expect(turn2Metrics("F03", t, "abc")).toMatchObject({ retry: true, recovered: true, category: "RECOVERED", looksStale: null });
    // A token the model made up, with no tool result behind it, is not a recovery
    const madeUp = { steps: steps(call("readFile", { path: "x" })), finalText: "token=abc" };
    expect(turn2Metrics("F03", madeUp, "abc")).toMatchObject({ retry: false, recovered: false, category: "OTHER_TOOL_ONLY" });
  });
  test("tool errors count as results for the token search", () => {
    const t = { steps: steps(call("bash", { command: "bash scripts/run_tests.sh" }), { type: "tool-error", toolName: "bash", error: { message: "no token here" } }), finalText: "" };
    expect(turn2Metrics("F03", t, "abc").category).toBe("RETRIED_FAILED");
  });
});

describe("looks_stale heuristic", () => {
  test("flags stale claims and requests to fix, not plain success", () => {
    expect(looksStale("Bash is still not available in this environment.")).toBe(true);
    expect(looksStale("As mentioned earlier, the lock file .test.lock blocks the run.")).toBe(true);
    expect(looksStale("Please install Git for Windows and restart.")).toBe(true);
    expect(looksStale("All 7 checks passed.")).toBe(false);
  });
});

describe("path flags", () => {
  test("`..` and `_stash` in arguments", () => {
    expect(pathFlags(toolCalls({ steps: steps(call("bash", { command: "ls ../_stash" })) }))).toEqual({ dotdot: true, stash: true });
    expect(pathFlags(toolCalls({ steps: steps(call("readFile", { path: "README.md" })) }))).toEqual({ dotdot: false, stash: false });
  });
});
