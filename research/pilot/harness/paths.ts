// Every path the harness uses, anchored at this file so scripts run from any clone.
import { join, relative, resolve, sep } from "node:path";

export const PILOT_DIR = resolve(import.meta.dir, "..");
export const REPO_ROOT = resolve(PILOT_DIR, "..", "..");
export const WS_DIR = join(PILOT_DIR, "ws");
export const RUNS_DIR = join(PILOT_DIR, "runs");
export const RESULTS_DIR = join(PILOT_DIR, "results");
export const EVIDENCE_DIR = join(PILOT_DIR, "evidence");

// The easycode commit this study is pinned to (brief, Section 2)
export const PINNED_EASYCODE_COMMIT = "4f126f9";

export type TrialPaths = {
  // The canonical project folder: the cwd the model is given
  project: string;
  // Where injected faults put things; outside the project, so listing it can't find them
  stash: string;
  // Turn-1 snapshot of the project and the stash, copied back before each branch
  snapProject: string;
  snapStash: string;
  // Finished branch workspaces
  arc: (branch: string) => string;
  arcStash: (branch: string) => string;
  // Append-only event log for the trial
  log: string;
};

export function trialPaths(wsRoot: string, trialId: string): TrialPaths {
  const trialDir = join(wsRoot, trialId);
  return {
    project: join(trialDir, "project"),
    stash: join(wsRoot, "_stash", trialId, "live"),
    snapProject: join(wsRoot, "_snap", trialId, "project"),
    snapStash: join(wsRoot, "_snap", trialId, "stash"),
    arc: (branch) => join(trialDir, "arc", branch),
    arcStash: (branch) => join(wsRoot, "_stash", trialId, "arc", branch),
    log: join(trialDir, "events.jsonl"),
  };
}

// Repo-relative, forward slashes: the form paths take in records and reports
export function repoRel(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

// Harness entry points rely on Bun loading the repo-root .env from the working
// directory, which is how easycode's server gets its keys (`bun run dev:server`
// from the repo root). Fail loudly instead of running without keys.
export function assertRunFromRepoRoot(): void {
  if (resolve(process.cwd()).toLowerCase() !== REPO_ROOT.toLowerCase()) {
    throw new Error(
      `Run the harness from the repo root (${REPO_ROOT}); the working directory is ${process.cwd()}`,
    );
  }
}
