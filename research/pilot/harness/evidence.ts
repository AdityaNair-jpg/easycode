// Writes timestamped evidence files so a rerun never overwrites an older one.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, repoRel } from "./paths.ts";

export function stamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function writeEvidence(milestone: string, name: string, content: string): string {
  const dir = join(EVIDENCE_DIR, milestone);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  if (existsSync(path)) throw new Error(`Evidence file already exists: ${repoRel(path)}`);
  writeFileSync(path, content);
  return path;
}
