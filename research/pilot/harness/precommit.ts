// Pre-commit scan (brief, rule 15, and the 45MB rule from replication-doc).
// Fails when a staged file holds a literal secret value from .env, when .env
// itself is staged, or when a staged file is over 45MB. Gzipped files are
// scanned after decompression too, since trial records are stored as .json.gz.
// Prints file paths and variable names only, never values.
import { gunzipSync } from "bun";
import { REPO_ROOT } from "./paths.ts";
import { secretValues } from "./secrets.ts";

export const MAX_FILE_BYTES = 45 * 1024 * 1024;

type Secret = { name: string; value: string };
export type ScanProblem = { path: string; problem: string };

function git(cwd: string, args: string[]): Buffer {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
  }
  return Buffer.from(proc.stdout);
}

export function stagedPaths(cwd: string): string[] {
  return git(cwd, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function findSecrets(content: Buffer, secrets: readonly Secret[]): string[] {
  return secrets.filter((s) => content.includes(Buffer.from(s.value, "utf8"))).map((s) => s.name);
}

export function scanStaged(
  cwd: string,
  secrets: readonly Secret[],
  maxBytes = MAX_FILE_BYTES,
): ScanProblem[] {
  const problems: ScanProblem[] = [];
  for (const path of stagedPaths(cwd)) {
    if (/(^|\/)\.env$/.test(path)) {
      problems.push({ path, problem: ".env must never be committed" });
      continue;
    }
    const size = Number(git(cwd, ["cat-file", "-s", `:${path}`]).toString().trim());
    if (size > maxBytes) {
      problems.push({ path, problem: `${size} bytes is over the ${maxBytes}-byte limit; list it in DATA_MANIFEST.md instead` });
      continue;
    }
    const blob = git(cwd, ["cat-file", "blob", `:${path}`]);
    const found = new Set(findSecrets(blob, secrets));
    if (path.endsWith(".gz")) {
      try {
        for (const name of findSecrets(Buffer.from(gunzipSync(blob)), secrets)) found.add(name);
      } catch {
        problems.push({ path, problem: "a .gz file that doesn't decompress, so it can't be scanned" });
      }
    }
    for (const name of found) problems.push({ path, problem: `contains the value of ${name}` });
  }
  return problems;
}

if (import.meta.main) {
  const secrets = secretValues();
  const problems = scanStaged(REPO_ROOT, secrets);
  if (problems.length > 0) {
    console.error("pre-commit scan FAILED:");
    for (const p of problems) console.error(`  ${p.path}: ${p.problem}`);
    process.exit(1);
  }
  console.error(
    `pre-commit scan passed: ${stagedPaths(REPO_ROOT).length} staged files, ${secrets.length} secret values checked`,
  );
}
