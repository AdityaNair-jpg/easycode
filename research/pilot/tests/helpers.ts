// Shared test helpers. Test workspaces go under <work root>\_tests and
// <archive root>\_tests (so the git ceiling covers them) and are never deleted.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROOTS, type Roots } from "../harness/paths.ts";

const SESSION = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${process.pid}`;
let counter = 0;

function nextName(label: string): string {
  counter += 1;
  return `${String(counter).padStart(3, "0")}-${label}`;
}

export function testDir(label: string): string {
  const dir = join(DEFAULT_ROOTS.work, "_tests", SESSION, nextName(label));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A work root and an archive root for one test, like a real run's pair
export function testRoots(label: string): Roots {
  const name = nextName(label);
  const roots = { work: join(DEFAULT_ROOTS.work, "_tests", SESSION, name), arc: join(DEFAULT_ROOTS.arc, "_tests", SESSION, name) };
  mkdirSync(roots.work, { recursive: true });
  mkdirSync(roots.arc, { recursive: true });
  return roots;
}

export function run(cmd: string[], cwd: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
}
