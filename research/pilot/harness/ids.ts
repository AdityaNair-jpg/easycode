// Trial ids are unique across every run, because workspaces are never
// deleted: t#### for trials, k#### for controls, x#### for fake-model trials
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function usedNumbers(wsRoot: string, prefix: string): number[] {
  const pattern = new RegExp(`^${prefix}(\\d{4})(\\.jsonl)?$`);
  const dirs = [wsRoot, join(wsRoot, "_stash"), join(wsRoot, "_snap"), join(wsRoot, "_logs")];
  return dirs.flatMap((d) =>
    existsSync(d)
      ? readdirSync(d)
          .map((n) => n.match(pattern)?.[1])
          .filter((m): m is string => Boolean(m))
          .map(Number)
      : [],
  );
}

export function nextIds(wsRoot: string, prefix: string, count: number, alsoUsed: number[] = []): string[] {
  const max = Math.max(0, ...usedNumbers(wsRoot, prefix), ...alsoUsed);
  if (max + count > 9999) throw new Error(`Out of ${prefix} ids`);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, "0")}`);
}
