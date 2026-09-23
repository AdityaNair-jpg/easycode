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

