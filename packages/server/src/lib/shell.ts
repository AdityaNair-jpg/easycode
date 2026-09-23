import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type Shell = {
  executable: string;
  env: Record<string, string | undefined>;
  // How the shell is described to the model
  name: string;
};

let resolvedShell: Shell | null | undefined;

// On Windows, "bash" on PATH is usually System32\bash.exe, the WSL launcher,
// which fails unless a full Linux distribution is installed. Git for Windows
// ships a real bash, so find its install root instead.
function findGitForWindows(): string | null {
  const candidates: string[] = [];

  // git.exe lives in <root>\cmd, <root>\bin or <root>\mingw64\bin
  const git = Bun.which("git");
  if (git) {
    let directory = dirname(git);
    for (let depth = 0; depth < 2; depth++) {
      directory = dirname(directory);
      candidates.push(directory);
    }
  }

  const installBases = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
  ];
  for (const base of installBases) {
    if (base) candidates.push(join(base, "Git"));
  }

  return candidates.find((root) => existsSync(join(root, "usr", "bin", "bash.exe"))) ?? null;
};

export function resolveShell(): Shell | null {
  if (resolvedShell !== undefined) return resolvedShell;

  if (process.platform !== "win32") {
    resolvedShell = { executable: "bash", env: { ...process.env }, name: "bash" };
    return resolvedShell;
  }

  const root = findGitForWindows();
  if (!root) {
    resolvedShell = null;
    return resolvedShell;
  }

  // Git Bash's own terminal puts these on PATH. A bare `bash -c` doesn't,
  // which leaves mkdir, ls, grep and the other tools unresolvable.
  const env: Record<string, string | undefined> = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = [join(root, "usr", "bin"), join(root, "mingw64", "bin"), env[pathKey]]
    .filter(Boolean)
    .join(";");

  resolvedShell = { executable: join(root, "usr", "bin", "bash.exe"), env, name: "Git Bash" };
  return resolvedShell;
};

export type ShellCheck = { ok: true; name: string } | { ok: false; reason: string };

const SHELL_CHECK_TTL_MS = 60_000;
const SHELL_CHECK_TIMEOUT_MS = 5_000;
let lastShellCheck: { at: number; result: ShellCheck } | null = null;

// Actually runs the shell, and checks mkdir resolves too, so the result
// reflects what a real command would hit rather than whether bash exists
async function runShellCheck(): Promise<ShellCheck> {
  const shell = resolveShell();
  if (!shell) return { ok: false, reason: "no bash shell was found (on Windows, install Git for Windows)" };

  try {
    const proc = Bun.spawn([shell.executable, "-c", "command -v mkdir >/dev/null && echo ok"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...shell.env, TERM: "dumb" },
    });
    const timer = setTimeout(() => proc.kill(), SHELL_CHECK_TIMEOUT_MS);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    if ((await proc.exited) === 0 && stdout.trim() === "ok") return { ok: true, name: shell.name };
    return { ok: false, reason: stderr.trim() || `the check exited with code ${proc.exitCode}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
};

export async function checkShell(): Promise<ShellCheck> {
  if (lastShellCheck && Date.now() - lastShellCheck.at < SHELL_CHECK_TTL_MS) {
    return lastShellCheck.result;
  }
  const result = await runShellCheck();
  lastShellCheck = { at: Date.now(), result };
  return result;
};
