import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ModelMessage } from "ai";
import { EASYCODE_SOURCES } from "../harness/easycode.ts";
import { buildNote } from "../harness/copied.ts";
import { BRANCHES, RULE5_PREFIX, T1, VARIANTS, removeRule5, systemPrompts, turn1Messages, turn2 } from "../harness/history.ts";
import { prepareShell } from "../harness/shell-env.ts";

const CWD = "D:\\easycode\\research\\pilot\\ws\\t0001\\project";

describe("system prompts", () => {
  test("P_norule is P_full minus exactly the rule-5 line", () => {
    const p = systemPrompts(CWD);
    const full = p.pFull.split("\n");
    const norule = p.pNoRule.split("\n");
    expect(full.length - norule.length).toBe(1);
    const removed = full.filter((l) => !norule.includes(l));
    expect(removed.length).toBe(1);
    expect(removed[0]!.trimStart().startsWith(RULE5_PREFIX)).toBe(true);
    expect(p.pNoRule.includes("Earlier failures are not permanent")).toBe(false);
    expect(p.pFull).toContain(`The user's project directory is: ${CWD}`);
    expect(p.pFull).toContain("Run a shell command in Git Bash");
    expect(p.pFullSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.pFullSha256).not.toBe(p.pNoRuleSha256);
  });

  test("the rule text removed is the one on system-prompt.ts line 78", () => {
    const line78 = readFileSync(EASYCODE_SOURCES.systemPrompt, "utf8").replace(/\r\n/g, "\n").split("\n")[77]!;
    expect(line78.trimStart().startsWith(RULE5_PREFIX)).toBe(true);
    const p = systemPrompts(CWD);
    expect(p.pFull.split("\n").some((l) => l === line78.replace(/`\);$/, ""))).toBe(true);
  });

  test("removal refuses zero or two occurrences", () => {
    expect(() => removeRule5("no rule here")).toThrow("found 0");
    expect(() => removeRule5(`    ${RULE5_PREFIX} a\n    ${RULE5_PREFIX} b`)).toThrow("found 2");
  });
});

describe("turn-2 messages", () => {
  const prompts = systemPrompts(CWD);
  const a1Text = "Bash is not available here.";
  const a1Msgs: ModelMessage[] = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "bash", input: { command: "bash scripts/run_tests.sh" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "bash", output: { type: "json", value: { error: "x" } } }] },
    { role: "assistant", content: [{ type: "text", text: a1Text }] },
  ];
  const note = "[NOTE]";
  const x = (variant: "V1" | "V2") => ({ prompts, a1Text, a1Msgs, variant, note });

  test("C1: P_norule, [user T1, assistant A1_text, user V]", () => {
    expect(turn2("C1", x("V1"))).toEqual({
      system: prompts.pNoRule,
      messages: [
        { role: "user", content: T1 },
        { role: "assistant", content: a1Text },
        { role: "user", content: VARIANTS.V1 },
      ],
    });
  });

  test("C2: P_norule, [user T1, ...A1_msgs, user V], trace untouched", () => {
    const r = turn2("C2", x("V2"));
    expect(r.system).toBe(prompts.pNoRule);
    expect(r.messages).toEqual([{ role: "user", content: T1 }, ...a1Msgs, { role: "user", content: VARIANTS.V2 }]);
    expect(r.messages[1]).toBe(a1Msgs[0]!);
  });

  test("C3: C1 with V + blank line + NOTE", () => {
    const r = turn2("C3", x("V1"));
    expect(r.system).toBe(prompts.pNoRule);
    expect(r.messages.at(-1)).toEqual({ role: "user", content: `${VARIANTS.V1}\n\n${note}` });
    expect(r.messages.slice(0, 2)).toEqual(turn2("C1", x("V1")).messages.slice(0, 2));
  });

  test("C4: P_full with C1's messages", () => {
    expect(turn2("C4", x("V2"))).toEqual({ system: prompts.pFull, messages: turn2("C1", x("V2")).messages });
  });

  test("C5: P_full with C3's messages", () => {
    expect(turn2("C5", x("V2"))).toEqual({ system: prompts.pFull, messages: turn2("C3", x("V2")).messages });
  });

  test("C3 and C5 refuse to run without the NOTE", () => {
    expect(() => turn2("C3", { ...x("V1"), note: undefined })).toThrow("needs the NOTE");
  });

  test("turn 1 is one user message, and there are 10 branches", () => {
    expect(turn1Messages()).toEqual([{ role: "user", content: T1 }]);
    expect(BRANCHES.map((b) => b.id)).toEqual([
      "V1_C1", "V1_C2", "V1_C3", "V1_C4", "V1_C5", "V2_C1", "V2_C2", "V2_C3", "V2_C4", "V2_C5",
    ]);
  });
});

describe("NOTE", () => {
  test("built from the real checkShell(): Git Bash on Windows", async () => {
    prepareShell();
    const { note, check } = await buildNote();
    expect(check.ok).toBe(true);
    expect(note).toBe(
      `[Environment check, run just now: the bash tool works (${process.platform === "win32" ? "Git Bash" : "bash"}). Any bash errors earlier in this conversation are out of date.]`,
    );
  });
});
