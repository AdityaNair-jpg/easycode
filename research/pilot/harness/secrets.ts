// Keeps API keys out of transcripts and commits (brief, rules 13-15).
// Nothing here ever prints a secret value; callers get names only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths.ts";
import { resolveShell, type Shell } from "./easycode.ts";

export const DOTENV_PATH = join(REPO_ROOT, ".env");

// Names removed from the shell env even when they didn't come from .env
export const SECRET_NAME_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CLERK|DATABASE_URL/i;

export type DotenvEntry = { name: string; value: string };

// Enough of the dotenv format for this repo's .env: NAME=value lines,
// optional `export`, optional matching quotes, # comments
export function parseDotenv(text: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2]!;
    const quoted = value.match(/^(['"`])(.*)\1$/);
    if (quoted) value = quoted[2]!;
    entries.push({ name: match[1]!, value });
  }
  return entries;
}

export function readDotenv(path = DOTENV_PATH): DotenvEntry[] {
  return existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : [];
}

export function isSecretName(name: string, dotenvNames: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return dotenvNames.some((n) => n.toLowerCase() === lower) || SECRET_NAME_PATTERN.test(name);
}

// Removes secret variables in place. Windows env names are case-insensitive,
// so the match is too. Returns the names removed.
export function scrubEnv(
  env: Record<string, string | undefined>,
  dotenvNames: readonly string[],
): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (isSecretName(key, dotenvNames)) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed.sort();
}

// The values a commit must never contain: every non-empty .env value whose
// name looks secret. API_URL-style settings are left out so they don't
// flag ordinary text.
export function secretValues(entries: readonly DotenvEntry[] = readDotenv()): {
  name: string;
  value: string;
}[] {
  return entries.filter((e) => e.value.length > 0 && SECRET_NAME_PATTERN.test(e.name));
}

// Last line of defence for anything stored from outside the harness (API
// error bodies, messages): replaces any secret value with its name
export function redact(text: string, secrets = secretValues()): string {
  let out = text;
  for (const s of secrets) if (s.value.length >= 4) out = out.split(s.value).join(`[REDACTED ${s.name}]`);
  return out;
}

let scrubbed: { shell: Shell; removed: string[] } | null = null;

// easycode's bash tool spawns every command with resolveShell().env, a copy of
// the server's environment that resolveShell() caches on first call
// (packages/server/src/lib/shell.ts:58-65, bash.ts:42). Scrubbing that cached
// object once covers every later bash call and checkShell().
export function scrubShellEnv(): { shell: Shell; removed: string[] } {
  if (scrubbed) return scrubbed;
  const shell = resolveShell();
  if (!shell) {
    throw new Error("resolveShell() returned null: no Git Bash found. Stop and ask the human.");
  }
  const removed = scrubEnv(shell.env, readDotenv().map((e) => e.name));
  scrubbed = { shell, removed };
  return scrubbed;
}

// Guard for anything that runs a tool: the scrub must already be in place
export function assertShellScrubbed(): void {
  const shell = resolveShell();
  if (!scrubbed || !shell || shell !== scrubbed.shell) {
    throw new Error("scrubShellEnv() must run before any tool call");
  }
  const dotenvNames = readDotenv().map((e) => e.name);
  const leaked = Object.keys(shell.env).filter((k) => isSecretName(k, dotenvNames));
  if (leaked.length > 0) {
    throw new Error(`Shell env still holds secret names: ${leaked.join(", ")}`);
  }
}
