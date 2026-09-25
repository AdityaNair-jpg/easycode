// Shared test helpers. Test workspaces go under ws/_tests and are never deleted.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { WS_DIR } from "../harness/paths.ts";

const SESSION = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${process.pid}`;
let counter = 0;

export function testDir(label: string): string {
  counter += 1;
  const dir = join(WS_DIR, "_tests", SESSION, `${String(counter).padStart(3, "0")}-${label}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function run(cmd: string[], cwd: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
}
