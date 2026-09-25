// Where the harness departs from, or has to interpret, the brief. Copied
// into every run manifest so each report lists them. The reasons are in
// NOTEBOOK.md under the same ids. "Approved" means the human approved it in
// writing at Checkpoint 1 (2026-09-25).
export const DEVIATIONS = [
  { id: "D1", text: "Approved. The script prints token = first 16 hex digits of SHA-256(NONCE), not NONCE itself, so reading run_tests.sh (readFile, cat) can't reveal the token; only running it can. Metrics search for this token." },
  { id: "D2", text: "Approved. The bash tool's environment gets GIT_CEILING_DIRECTORIES = the work root (D:\\work by default), so git in a project with no .git (F07) can't reach a repository above the trial folder. run_tests.sh also sets a ceiling of its own." },
  { id: "D3", text: "The workspace fingerprint also hashes directory paths, so a created empty folder counts as a modification." },
  { id: "D4", text: "Approved. The harness is launched from Git Bash, whose PATH has grep. With a plain Windows PATH, easycode's grep tool fails (the known easycode bug); the preflight refuses to run then." },
  { id: "D5", text: "Superseded by D11: the snapshot, stash, archives and event log for a trial sit under the archive root, not under the work root." },
  { id: "D6", text: "After a turn timeout, besides processes whose command line holds the trial path, the harness kills a bash.exe it started whose command line holds one of this trial's still-running commands, when no other trial runs the same command." },
  { id: "D7", text: "Each turn stores the provider request body in full for its first step only; later steps store the body's SHA-256 and length." },
  { id: "D8", text: "States not in the brief: NOT_RUN (budget or run stop) and MISSING_RECORD (planned, no record written). Branch states are RAN, INFRA_ERROR, PROVIDER_REJECTED, NOT_RUN." },
  { id: "D9", text: "Controls use P_norule as the system prompt, the same as turn 1." },
  { id: "D10", text: "Branches run in the fixed order V1_C1..V1_C5, V2_C1..V2_C5. Trials run rep by rep across faults, with controls after rep 1, so an early stop leaves every fault covered." },
  { id: "D11", text: "Human's change B (2026-09-25). Trial workspaces are outside the repo, at <work root>\\<trial_id>\\project (default D:\\work). Snapshot, stash, branch archives and event log are under <archive root>\\<trial_id>\\ (default D:\\work-arc), so nothing sits next to project\\. Both roots are recorded in each manifest and can be set with PILOT_WORK_ROOT and PILOT_ARC_ROOT." },
  { id: "D12", text: "Human's change A (2026-09-25). Primary metric `retry` = re-ran the script: a turn-2 bash command contains run_tests.sh AND a turn-2 tool result holds the new token. The brief's original definition is kept as the secondary metric `rechecked`. `recovered` = retry and the token in the final text. Controls use the same definitions with the fixture's token." },
  { id: "S1", text: "Decision: when several turn-1 states apply, the order is INFRA_ERROR, INVALID_MODIFIED, INVALID_NO_ATTEMPT, INVALID_EMPTY. Turn-1 validity still uses the brief's \"attempted\"." },
  { id: "S2", text: "Decision, revised with D12: categories don't depend on the fault. RECOVERED = retry with the token in the text; RETRIED_NOT_REPORTED = retry without it; RETRIED_FAILED = a run_tests.sh bash command but no tool result with the token (a failed run, or a read such as `cat`); OTHER_TOOL_ONLY = tool calls, none a run_tests.sh command; NO_TOOL = no tool calls." },
  { id: "S3", text: "Decision: H1's \"valid paired branches\" is read as C1 branches that ran." },
  { id: "S4", text: "Decision: \"5 retries with exponential backoff\" is the AI SDK's own retry (maxRetries: 5; 2 s initial delay, doubling). Only a 4xx the SDK won't retry counts as a provider rejection, and it stops the run." },
] as const;
