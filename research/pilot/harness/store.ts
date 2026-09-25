// Raw records: one gzipped JSON file per trial or control, never overwritten.
import { gunzipSync, gzipSync } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RUNS_DIR } from "./paths.ts";

export function runDir(runId: string, runsRoot = RUNS_DIR): string {
  return join(runsRoot, runId);
}

export function recordPath(runId: string, id: string, pass: string | null, runsRoot = RUNS_DIR): string {
  return join(runDir(runId, runsRoot), "trials", `${id}${pass ? `.${pass}` : ""}.json.gz`);
}

export function writeRecord(path: string, record: unknown): void {
  if (existsSync(path)) throw new Error(`Record already exists, refusing to overwrite: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(record))));
}

export function readRecord<T = any>(path: string): T {
  return JSON.parse(Buffer.from(gunzipSync(readFileSync(path))).toString("utf8"));
}

export function listRecordFiles(runId: string, runsRoot = RUNS_DIR): string[] {
  const dir = join(runDir(runId, runsRoot), "trials");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json.gz"))
    .sort()
    .map((f) => join(dir, f));
}

export function writeJsonOnce(path: string, value: unknown): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
