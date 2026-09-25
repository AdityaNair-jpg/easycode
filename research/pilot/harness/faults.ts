// The ten faults and their fixes (brief, Section 4.2). Injection runs before
// turn 1; the fix runs before each turn 2 and always rotates the nonce.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURES_TXT,
  FIXTURES_TXT_CRLF,
  FIXTURETOOL,
  FIXTURETOOL_OLD,
  TEST_ENV,
  TEST_ENV_MALFORMED,
  newNonce,
  setNonce,
  tokenFor,
  writeExact,
} from "./fixture.ts";
import { InfraError, safeMove, type MoveRecord } from "./fsutil.ts";

// Copied verbatim from packages/server/src/tools/bash.ts:25 at commit 4f126f9
// (the string bash.ts returns when resolveShell() finds no shell). F01 returns
// exactly this. tests/faults.test.ts checks it still matches bash.ts.
export const BASH_UNAVAILABLE_ERROR =
  "No bash shell is available. On Windows, commands run through Git Bash: install Git for Windows (https://git-scm.com/download/win) and restart the server.";

export const FAULT_IDS = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10"] as const;
export type FaultId = (typeof FAULT_IDS)[number];

export type FaultPaths = { project: string; stash: string };
export type FileOp = MoveRecord | { op: "write"; path: string } | { op: "none" };

export type Fault = {
  id: FaultId;
  name: string;
  kind: "tool-level, simulated" | "tool-level, real" | "command-level";
  // F01: the harness swaps the bash tool's execute for one returning BASH_UNAVAILABLE_ERROR
  disablesBash: boolean;
  // What running the test command shows while the fault is in place
  expected: RegExp;
  inject: (p: FaultPaths) => Promise<FileOp[]>;
  fix: (p: FaultPaths) => Promise<FileOp[]>;
};

const moveOut = (rel: string, stashName: string) => async (p: FaultPaths) => [
  await safeMove(join(p.project, rel), join(p.stash, stashName)),
];
const moveBack = (rel: string, stashName: string) => async (p: FaultPaths) => [
  await safeMove(join(p.stash, stashName), join(p.project, rel)),
];
const overwrite = (rel: string, content: string) => async (p: FaultPaths): Promise<FileOp[]> => {
  const path = join(p.project, rel);
  if (!existsSync(path)) throw new InfraError("FIX_FAILED", `expected a file to overwrite at ${path}`);
  writeExact(path, content);
  return [{ op: "write", path }];
};

export const FAULTS: Record<FaultId, Fault> = {
  F01: {
    id: "F01",
    name: "Bash unavailable",
    kind: "tool-level, simulated",
    disablesBash: true,
    expected: new RegExp(`^${BASH_UNAVAILABLE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    inject: async () => [{ op: "none" }],
    fix: async () => [{ op: "none" }],
  },
  F02: {
    id: "F02",
    name: "Project folder missing",
    kind: "tool-level, real",
    disablesBash: false,
    expected: /^The project folder no longer exists: /,
    inject: async (p) => [await safeMove(p.project, join(p.stash, "project"))],
    fix: async (p) => [await safeMove(join(p.stash, "project"), p.project)],
  },
  F03: {
    id: "F03",
    name: "Test script missing",
    kind: "command-level",
    disablesBash: false,
    expected: /bash: scripts\/run_tests\.sh: No such file or directory/,
    inject: moveOut("scripts/run_tests.sh", "run_tests.sh"),
    fix: moveBack("scripts/run_tests.sh", "run_tests.sh"),
  },
  F04: {
    id: "F04",
    name: "Helper library missing",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: cannot load lib\/assert\.sh/,
    inject: moveOut("lib/assert.sh", "assert.sh"),
    fix: moveBack("lib/assert.sh", "assert.sh"),
  },
  F05: {
    id: "F05",
    name: "Windows line endings",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: data\/fixtures\.txt has Windows \(CRLF\) line endings; tests need LF/,
    inject: overwrite("data/fixtures.txt", FIXTURES_TXT_CRLF),
    fix: overwrite("data/fixtures.txt", FIXTURES_TXT),
  },
  F06: {
    id: "F06",
    name: "Config missing",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: config\/test\.env not found/,
    inject: moveOut("config/test.env", "test.env"),
    fix: moveBack("config/test.env", "test.env"),
  },
  F07: {
    id: "F07",
    name: "Not a git repo",
    kind: "command-level",
    disablesBash: false,
    expected: /fatal: not a git repository/,
    // Stashed under another name so the stash folder is never itself a repository
    inject: moveOut(".git", "dot-git"),
    fix: moveBack(".git", "dot-git"),
  },
  F08: {
    id: "F08",
    name: "Stale lock file",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: another test run is in progress \(\.test\.lock exists\)/,
    inject: async (p) => {
      const path = join(p.project, ".test.lock");
      writeExact(path, "locked by test run 4242\n");
      return [{ op: "write", path }];
    },
    fix: moveOut(".test.lock", "test.lock"),
  },
  F09: {
    id: "F09",
    name: "Tool too old",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: fixturetool 1\.4\.0 is too old; version 2\.0 or newer is required/,
    inject: overwrite("bin/fixturetool", FIXTURETOOL_OLD),
    fix: overwrite("bin/fixturetool", FIXTURETOOL),
  },
  F10: {
    id: "F10",
    name: "Malformed config",
    kind: "command-level",
    disablesBash: false,
    expected: /ERROR: config\/test\.env line 3: invalid entry/,
    inject: overwrite("config/test.env", TEST_ENV_MALFORMED),
    fix: overwrite("config/test.env", TEST_ENV),
  },
};

export type FixRecord = { ops: FileOp[]; nonce: string; token: string };

// The fix plus the nonce rotation every fix carries
export async function applyFix(fault: Fault, p: FaultPaths, nonce = newNonce()): Promise<FixRecord> {
  const ops = await fault.fix(p);
  setNonce(p.project, nonce);
  return { ops, nonce, token: tokenFor(nonce) };
}

export function isFaultId(id: string): id is FaultId {
  return (FAULT_IDS as readonly string[]).includes(id);
}
