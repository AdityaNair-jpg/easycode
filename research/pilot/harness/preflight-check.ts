// Runs the pre-run checks for a list of models without calling any model,
// and saves the outcome as evidence. Usage, from the repo root:
//   bun research/pilot/harness/preflight-check.ts <label> <model,model,...>
import { stamp, writeEvidence } from "./evidence.ts";
import { repoRel } from "./paths.ts";
import { preflight } from "./run.ts";

if (import.meta.main) {
  const label = process.argv[2] ?? "unlabelled";
  const models = (process.argv[3] ?? "gemini-2.5-flash").split(",");
  let outcome: Record<string, unknown>;
  try {
    outcome = { ok: true, checks: await preflight(models) };
  } catch (err) {
    outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const path = writeEvidence("m1", `preflight_${label}_${stamp()}.json`, JSON.stringify({ label, models, ...outcome }, null, 2));
  console.log(`${outcome.ok ? "ok" : `REFUSED: ${outcome.error}`}\nevidence: ${repoRel(path)}`);
}
