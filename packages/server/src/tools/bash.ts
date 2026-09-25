import { existsSync } from "node:fs";
import { tool } from "ai";
import { z } from "zod";
import { resolveShell } from "../lib/shell";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;

export function createBashTool(cwd: string) {
  return tool({
    description:
      "Execute a shell command in the project directory. Use this for running tests, builds, git operations, package installs, and any other shell commands.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .describe("Timeout in milliseconds (default: 30000)")
        .default(DEFAULT_TIMEOUT),
    }),
    execute: async ({ command, timeout }) => {
      const shell = resolveShell();
      if (!shell) {
        return {
          error:
            "No bash shell is available. On Windows, commands run through Git Bash: install Git for Windows (https://git-scm.com/download/win) and restart the server.",
        };
      }

      // A missing cwd makes spawn report ENOENT for bash.exe itself, which
      // reads as "bash is not installed" when the folder is what's gone
      if (!existsSync(cwd)) {
        return {
          error: `The project folder no longer exists: ${cwd}. It may have been moved or deleted; start a session in the right folder.`,
        };
      }

      try {
        const proc = Bun.spawn([shell.executable, "-c", command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...shell.env, TERM: "dumb" },
        });

        const timer = setTimeout(() => {
          proc.kill();
        }, timeout);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        const exitCode = await proc.exited;
        clearTimeout(timer);

        const truncate = (s: string) =>
          s.length > MAX_OUTPUT
            ? s.slice(0, MAX_OUTPUT) + `\n... (truncated, ${s.length} total chars)`
            : s;

        return {
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to execute command: ${message}` };
      }
    },
  });
};