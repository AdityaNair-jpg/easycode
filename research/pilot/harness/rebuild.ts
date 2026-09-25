// Rebuilds every offline output of one run, or of all runs, from the raw
// records: summary.csv, REPORT.md, the figure, the renders and (if absent)
// review_sample.csv. No API calls. Usage, from the repo root:
//   bun research/pilot/harness/rebuild.ts [run_id ...]
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, repoRel } from "./paths.ts";
import { writeReport } from "./report.ts";
import { writeSummary } from "./score.ts";

if (import.meta.main) {
  const runs = process.argv.slice(2).length
    ? process.argv.slice(2)
    : existsSync(RUNS_DIR)
      ? readdirSync(RUNS_DIR).filter((r) => existsSync(join(RUNS_DIR, r, "manifest.json")))
      : [];
  if (runs.length === 0) console.log("No runs to rebuild.");
  for (const run of runs) {
    const summary = await writeSummary(run);
    const out = await writeReport(run);
    console.log(`${run}: ${repoRel(summary)}, ${repoRel(out.report)}, ${repoRel(out.figure)}`);
  }
}
