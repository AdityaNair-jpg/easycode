// Trial ids are unique across every run, because workspaces are never
// deleted: t#### for trials, k#### for controls, x#### for fake-model trials
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_WS_DIR, type Roots } from "./paths.ts";

function numbersIn(dir: string, prefix: string): number[] {
  const pattern = new RegExp(`^${prefix}(\\d{4})(\\.jsonl)?$`);
  return existsSync(dir)
    ? readdirSync(dir)
        .map((n) => n.match(pattern)?.[1])
        .filter((m): m is string => Boolean(m))
        .map(Number)
    : [];
}

// Ids in use under both roots, and in the Milestone 1 workspace folder inside
// the repo, so a new id never repeats an old one
export function usedNumbers(roots: Roots, prefix: string): number[] {
  const legacy = [LEGACY_WS_DIR, join(LEGACY_WS_DIR, "_stash"), join(LEGACY_WS_DIR, "_snap"), join(LEGACY_WS_DIR, "_logs")];
  return [roots.work, roots.arc, ...legacy].flatMap((d) => numbersIn(d, prefix));
}

export function nextIds(roots: Roots, prefix: string, count: number, alsoUsed: number[] = []): string[] {
  const max = Math.max(0, ...usedNumbers(roots, prefix), ...alsoUsed);
  if (max + count > 9999) throw new Error(`Out of ${prefix} ids`);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, "0")}`);
}
