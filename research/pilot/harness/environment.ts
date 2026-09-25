// Captures the machine and code state that every run manifest records
// (brief, Sections 2, 4.7 and 7).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_EASYCODE_COMMIT, REPO_ROOT } from "./paths.ts";
import { resolveShell } from "./easycode.ts";

function capture(cmd: string[], env?: Record<string, string | undefined>): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(cmd, { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", env });
    const out = (p.stdout.toString() + p.stderr.toString()).trim();
    return { ok: p.exitCode === 0, out };
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

function pkgVersion(name: string): string | null {
  const path = join(REPO_ROOT, "node_modules", ...name.split("/"), "package.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).version : null;
}

export type Environment = ReturnType<typeof captureEnvironment>;

export function captureEnvironment() {
  const shell = resolveShell();
  const head = capture(["git", "rev-parse", "HEAD"]).out;
  // Dirty means changed tracked files, or new files in the harness or tests.
  // New evidence and run output don't count: runs write them.
  const dirty = capture(["git", "status", "--porcelain", "--", "research/pilot"])
    .out.split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.startsWith("??") || /research\/pilot\/(harness|tests)\//.test(l))
    .join("\n");
  // The product code must be byte-identical to the pinned commit
  const productDiff = capture(["git", "diff", "--quiet", PINNED_EASYCODE_COMMIT, "--", "packages", "package.json"]);
  const pinnedFull = capture(["git", "rev-parse", PINNED_EASYCODE_COMMIT]).out;

  return {
    capturedAt: new Date().toISOString(),
    windows: {
      ver: process.platform === "win32" ? capture(["cmd.exe", "/c", "ver"]).out : null,
      os: process.platform === "win32"
        ? capture([
            "powershell.exe",
            "-NoProfile",
            "-Command",
            "$o = Get-CimInstance Win32_OperatingSystem; \"$($o.Caption) | $($o.Version) | build $($o.BuildNumber)\"",
          ]).out
        : null,
    },
    platform: process.platform,
    arch: process.arch,
    bun: { version: Bun.version, revision: Bun.revision, execPath: process.execPath },
    shell: shell
      ? {
          executable: shell.executable,
          name: shell.name,
          bashVersion: capture([shell.executable, "--version"]).out.split(/\r?\n/)[0],
          // The git a model's bash commands reach, through Git Bash's PATH
          gitVersionInShell: capture([shell.executable, "-c", "git --version"], { ...shell.env }).out,
        }
      : null,
    gitVersionOnPath: capture(["git", "--version"]).out,
    // easycode's grep tool spawns `grep` from the harness process's PATH
    grepOnProcessPath: Bun.which("grep"),
    repoRoot: REPO_ROOT,
    code: {
      pinnedEasycodeCommit: pinnedFull,
      headCommit: head,
      // Packages identical to the pin means the run used the pinned product code
      productCodeMatchesPin: productDiff.ok,
      easycodeCommitRunAgainst: productDiff.ok ? pinnedFull : `${head} (packages differ from ${PINNED_EASYCODE_COMMIT})`,
      harnessCommit: head,
      harnessDirty: dirty.length > 0,
    },
    packages: {
      ai: pkgVersion("ai"),
      "@ai-sdk/google": pkgVersion("@ai-sdk/google"),
      "@ai-sdk/anthropic": pkgVersion("@ai-sdk/anthropic"),
      "@ai-sdk/openai": pkgVersion("@ai-sdk/openai"),
    },
  };
}
