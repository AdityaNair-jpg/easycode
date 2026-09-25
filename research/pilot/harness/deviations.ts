// Where the harness departs from, or has to interpret, the brief. Copied
// into every run manifest so each report lists them. The reasons are in
// NOTEBOOK.md under the same ids.
export const DEVIATIONS = [
  { id: "D1", text: "The script prints token = first 16 hex digits of SHA-256(NONCE), not NONCE itself, so reading run_tests.sh (readFile, cat) can't reveal the token; only running it can. Metrics search for this token." },
  { id: "D2", text: "The bash tool's environment gets GIT_CEILING_DIRECTORIES = research/pilot/ws (absolute), so git in a project with no .git (F07) can't reach the easycode repo and show the study branch. run_tests.sh also sets a ceiling of its own." },
  { id: "D3", text: "The workspace fingerprint also hashes directory paths, so a created empty folder counts as a modification." },
  { id: "D4", text: "The harness must be launched from a shell whose PATH has grep (Git Bash). With a plain Windows PATH, easycode's grep tool fails (the known easycode bug); the preflight refuses to run then. Awaiting the human's decision on the launch environment." },
  { id: "D5", text: "Layout beyond the brief: turn-1 snapshot at ws/_snap/<trial_id>/ (project and stash), archived stash at ws/_stash/<trial_id>/arc/<branch>/, event log at ws/_logs/<trial_id>.jsonl, all outside the trial folder." },
  { id: "D6", text: "After a turn timeout, besides processes whose command line holds the trial path, the harness kills a bash.exe it started whose command line holds one of this trial's still-running commands, when no other trial runs the same command." },
  { id: "D7", text: "Each turn stores the provider request body in full for its first step only; later steps store the body's SHA-256 and length." },
  { id: "D8", text: "States not in the brief: NOT_RUN (budget or run stop) and MISSING_RECORD (planned, no record written). Branch states are RAN, INFRA_ERROR, PROVIDER_REJECTED, NOT_RUN." },
  { id: "D9", text: "Controls use P_norule as the system prompt, the same as turn 1." },
  { id: "D10", text: "Branches run in the fixed order V1_C1..V1_C5, V2_C1..V2_C5. Trials run rep by rep across faults, with controls after rep 1, so an early stop leaves every fault covered." },
  { id: "S1", text: "Decision: when several turn-1 states apply, the order is INFRA_ERROR, INVALID_MODIFIED, INVALID_NO_ATTEMPT, INVALID_EMPTY." },
  { id: "S2", text: "Decision: category order is RECOVERED, then RETRIED_NOT_REPORTED (retry, token in a result), then RETRIED_FAILED (retry, no token), then OTHER_TOOL_ONLY, then NO_TOOL, so the category always agrees with `retry`. For F01/F02 a bash call that isn't the script is a retry and lands in RETRIED_FAILED with script_run = 0." },
  { id: "S3", text: "Decision: H1's \"valid paired branches\" is read as C1 branches that ran." },
  { id: "S4", text: "Decision: \"5 retries with exponential backoff\" is the AI SDK's own retry (maxRetries: 5; 2 s initial delay, doubling). Only a 4xx the SDK won't retry counts as a provider rejection, and it stops the run." },
] as const;
