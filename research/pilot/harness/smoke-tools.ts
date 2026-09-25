// Milestone 1: run each of the seven BUILD tools once on a fresh fixture and
// save the results (brief, Section 4.7). No model calls.
// Usage, from the repo root: bun research/pilot/harness/smoke-tools.ts <launch-label> [evidence-folder]
import { join } from "node:path";
import { createFixture, newNonce, tokenFor } from "./fixture.ts";
import { captureEnvironment } from "./environment.ts";
import { stamp, writeEvidence } from "./evidence.ts";
import { DEFAULT_ROOTS, assertRunFromRepoRoot, repoRel } from "./paths.ts";
import { prepareShell } from "./shell-env.ts";
import { callTool, instrumentedTools, type ToolEvent } from "./tools.ts";

type Case = { tool: string; input: Record<string, unknown>; check: (r: any) => boolean; expect: string };

export async function smokeTools(project: string, nonce: string) {
  const events: ToolEvent[] = [];
  const tools = instrumentedTools(project, { disableBash: false }, events);
  const slash = (p: string) => p.replace(/\\/g, "/");
  const cases: Case[] = [
    { tool: "readFile", input: { path: "README.md" }, expect: "README content", check: (r) => r.content?.includes("# Fixture project") },
    {
      tool: "listDirectory",
      input: { path: "." },
      expect: "the five top-level entries",
      check: (r) => ["bin", "config", "data", "lib", "scripts"].every((n) => r.entries?.some((e: any) => e.name === n)),
    },
    { tool: "glob", input: { pattern: "**/*.sh" }, expect: "both .sh files", check: (r) => r.files?.map(slash).join(",") === "lib/assert.sh,scripts/run_tests.sh" },
    {
      tool: "grep",
      input: { pattern: "^alpha$", path: "data" },
      expect: "one match in data/fixtures.txt",
      check: (r) => r.matches?.length === 1 && slash(r.matches[0].file) === "data/fixtures.txt",
    },
    { tool: "writeFile", input: { path: "smoke/written.txt", content: "one\n" }, expect: "success", check: (r) => r.success === true },
    { tool: "editFile", input: { path: "smoke/written.txt", oldString: "one", newString: "two" }, expect: "success", check: (r) => r.success === true },
    {
      tool: "bash",
      input: { command: "bash scripts/run_tests.sh" },
      expect: "exit 0 and the PASS line with the fixture's token",
      check: (r) => r.exitCode === 0 && r.stdout?.trim() === `RESULT: PASS 7/7 token=${tokenFor(nonce)}`,
    },
  ];

  const results = [];
  for (const c of cases) {
    let output: unknown;
    try {
      output = await callTool(tools, c.tool, c.input, `smoke-${c.tool}`);
    } catch (err) {
      output = { thrown: err instanceof Error ? err.message : String(err) };
    }
    results.push({ tool: c.tool, input: c.input, expect: c.expect, ok: Boolean(c.check(output)), output });
  }
  return { results, events };
}

if (import.meta.main) {
  assertRunFromRepoRoot();
  const label = process.argv[2] ?? "unlabelled";
  const set = process.argv[3] ?? "m1";
  const { removed, gitCeiling } = prepareShell();
  const at = stamp();
  const project = join(DEFAULT_ROOTS.work, "_m1", `smoke-${at}-${label}`, "project");
  const nonce = newNonce();
  createFixture(project, nonce);
  const { results, events } = await smokeTools(project, nonce);
  const record = {
    launch: label,
    project: repoRel(project),
    scrubbedEnvNames: removed,
    gitCeiling,
    environment: captureEnvironment(),
    allOk: results.every((r) => r.ok),
    results,
    events,
  };
  const path = writeEvidence(set, `smoke_${label}_${at}.json`, JSON.stringify(record, null, 2));
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.tool}${r.ok ? "" : `: ${JSON.stringify(r.output)}`}`);
  console.log(`evidence: ${repoRel(path)}`);
  process.exit(record.allOk ? 0 : 1);
}
