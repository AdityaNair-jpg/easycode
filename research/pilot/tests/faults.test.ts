import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EASYCODE_SOURCES } from "../harness/easycode.ts";
import { BASH_UNAVAILABLE_ERROR, FAULTS, FAULT_IDS } from "../harness/faults.ts";
import { trialPaths } from "../harness/paths.ts";
import { prepareShell } from "../harness/shell-env.ts";
import { validateFault } from "../harness/validate-faults.ts";
import { testRoots } from "./helpers.ts";

describe("faults", () => {
  test("F01's error is the string bash.ts returns, verbatim", () => {
    const source = readFileSync(EASYCODE_SOURCES.bash, "utf8");
    expect(source.includes(`"${BASH_UNAVAILABLE_ERROR}"`)).toBe(true);
  });

  test("change B layout: only project\\ under the work root; stash, snapshot, archives and log under the archive root", () => {
    const roots = { work: "D:\\work", arc: "D:\\work-arc" };
    const p = trialPaths(roots, "t0001");
    const slash = (s: string) => s.replace(/\\/g, "/");
    expect(slash(p.project)).toBe("D:/work/t0001/project");
    for (const other of [p.stash, p.snapProject, p.snapStash, p.arc("V1_C1"), p.arcStash("V1_C1"), p.log]) {
      expect(slash(other).startsWith("D:/work-arc/t0001/")).toBe(true);
      expect(slash(other).startsWith("D:/work/")).toBe(false);
    }
  });

  test("every fault fails with its expected error, then passes with a new token after the fix", async () => {
    prepareShell();
    const roots = testRoots("faults");
    for (const id of FAULT_IDS) {
      const r = await validateFault(roots, id);
      expect([id, r.failedAsExpected, r.passedWithNewToken, r.verboseOk]).toEqual([id, true, true, true]);
    }
  }, 120_000);

  test("under F07 a model's own git command can't reach the easycode repo", async () => {
    prepareShell();
    const r = await validateFault(testRoots("f07-ceiling"), "F07");
    expect((r.probes.gitToplevel as any).stderr).toContain("fatal: not a git repository");
  });

  test("only F01 disables bash", () => {
    expect(FAULT_IDS.filter((id) => FAULTS[id].disablesBash)).toEqual(["F01"]);
  });
});
