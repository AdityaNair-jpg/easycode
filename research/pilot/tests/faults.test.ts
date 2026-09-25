import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EASYCODE_SOURCES } from "../harness/easycode.ts";
import { BASH_UNAVAILABLE_ERROR, FAULTS, FAULT_IDS } from "../harness/faults.ts";
import { trialPaths } from "../harness/paths.ts";
import { prepareShell } from "../harness/shell-env.ts";
import { validateFault } from "../harness/validate-faults.ts";
import { testDir } from "./helpers.ts";

describe("faults", () => {
  test("F01's error is the string bash.ts returns, verbatim", () => {
    const source = readFileSync(EASYCODE_SOURCES.bash, "utf8");
    expect(source.includes(`"${BASH_UNAVAILABLE_ERROR}"`)).toBe(true);
  });

  test("the stash sits outside the project folder", () => {
    const p = trialPaths("/ws", "t0001");
    expect(p.stash.startsWith(p.project)).toBe(false);
    expect(p.stash.replace(/\\/g, "/")).toContain("/_stash/t0001/");
  });

  test("every fault fails with its expected error, then passes with a new token after the fix", async () => {
    prepareShell();
    const wsRoot = testDir("faults");
    for (const id of FAULT_IDS) {
      const r = await validateFault(wsRoot, id);
      expect([id, r.failedAsExpected, r.passedWithNewToken, r.verboseOk]).toEqual([id, true, true, true]);
    }
  }, 120_000);

  test("under F07 a model's own git command can't reach the easycode repo", async () => {
    prepareShell();
    const r = await validateFault(testDir("f07-ceiling"), "F07");
    expect((r.probes.gitToplevel as any).stderr).toContain("fatal: not a git repository");
  });

  test("only F01 disables bash", () => {
    expect(FAULT_IDS.filter((id) => FAULTS[id].disablesBash)).toEqual(["F01"]);
  });
});
