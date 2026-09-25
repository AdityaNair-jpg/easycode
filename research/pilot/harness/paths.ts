// Every path the harness uses. Repo paths are anchored at this file so scripts
// run from any clone; trial workspaces live outside the repo (deviation D11).
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const PILOT_DIR = resolve(import.meta.dir, "..");
export const REPO_ROOT = resolve(PILOT_DIR, "..", "..");
export const RUNS_DIR = join(PILOT_DIR, "runs");
export const RESULTS_DIR = join(PILOT_DIR, "results");
export const EVIDENCE_DIR = join(PILOT_DIR, "evidence");
// Milestone 1 workspaces, before they moved out of the repo. Gitignored, kept.
export const LEGACY_WS_DIR = join(PILOT_DIR, "ws");

// The easycode commit this study is pinned to (brief, Section 2)
export const PINNED_EASYCODE_COMMIT = "4f126f9";

// Where trial workspaces go, a recorded setting (deviation D11). The work root
// holds only <trial_id>\project; everything else for a trial sits under the
// archive root, so nothing is next to project\. Override with the
// PILOT_WORK_ROOT and PILOT_ARC_ROOT environment variables.
export type Roots = { work: string; arc: string };
export const DEFAULT_ROOTS: Roots = {
  work: resolve(process.env.PILOT_WORK_ROOT ?? "D:\\work"),
  arc: resolve(process.env.PILOT_ARC_ROOT ?? "D:\\work-arc"),
};

export type TrialPaths = {
  // The canonical project folder: the cwd the model is given
  project: string;
  // Where injected faults put things
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

export function trialPaths(roots: Roots, trialId: string): TrialPaths {
  const arcDir = join(roots.arc, trialId);
  return {
    project: join(roots.work, trialId, "project"),
    stash: join(arcDir, "stash"),
    snapProject: join(arcDir, "snap", "project"),
    snapStash: join(arcDir, "snap", "stash"),
    arc: (branch) => join(arcDir, "arc", branch),
    arcStash: (branch) => join(arcDir, "arc-stash", branch),
    log: join(arcDir, "events.jsonl"),
  };
}

// The form paths take in records and reports: repo-relative with forward
// slashes inside the repo, absolute with forward slashes outside it
export function repoRel(path: string): string {
  const rel = relative(REPO_ROOT, path);
  if (rel.startsWith("..") || isAbsolute(rel)) return resolve(path).split(sep).join("/");
  return rel.split(sep).join("/");
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
