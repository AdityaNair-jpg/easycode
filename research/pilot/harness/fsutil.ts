// File operations for fault injection and branch mechanics. The harness moves
// and copies; it never deletes (brief, rule 10), and a failed move is never
// replaced by copy-then-delete (Section 4.7).
import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

// A failure outside the model's behaviour. Its `reason` becomes the recorded
// INFRA_ERROR reason.
export class InfraError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = "InfraError";
  }
}

// Windows reports a handle held by an antivirus scanner, the indexer or a
// leftover bash.exe as one of these
const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES"]);
export const MOVE_RETRIES = 5;
const BASE_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetries<T>(op: () => T, what: string, reason: string): Promise<{ value: T; attempts: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: op(), attempts: attempt + 1 };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (RETRYABLE.has(code) && attempt < MOVE_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new InfraError(reason, `${what} failed after ${attempt + 1} attempts (${code || String(err)})`);
    }
  }
}

export type MoveRecord = { op: "move"; from: string; to: string; attempts: number };

export async function safeMove(from: string, to: string): Promise<MoveRecord> {
  if (!existsSync(from)) throw new InfraError("MOVE_FAILED", `nothing to move at ${from}`);
  if (existsSync(to)) throw new InfraError("MOVE_FAILED", `move target already exists: ${to}`);
  mkdirSync(dirname(to), { recursive: true });
  const { attempts } = await withRetries(() => renameSync(from, to), `move ${from} -> ${to}`, "MOVE_FAILED");
  return { op: "move", from, to, attempts };
}

export type CopyRecord = { op: "copy"; from: string; to: string; attempts: number };

// Copies a file or folder tree. Refuses to write over anything.
export async function safeCopy(from: string, to: string): Promise<CopyRecord> {
  if (!existsSync(from)) throw new InfraError("COPY_FAILED", `nothing to copy at ${from}`);
  if (existsSync(to)) throw new InfraError("COPY_FAILED", `copy target already exists: ${to}`);
  mkdirSync(dirname(to), { recursive: true });
  const { attempts } = await withRetries(
    () => cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true }),
    `copy ${from} -> ${to}`,
    "COPY_FAILED",
  );
  return { op: "copy", from, to, attempts };
}
