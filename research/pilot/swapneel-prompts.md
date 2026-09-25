# Prompt log

Prompts for this study and what each one changed (coding-agent skill). The log lives in
`research/pilot/` because the brief keeps the study's files there.

### Prompt 1 — 2026-09-25
The prompt was the Stage 1 pilot brief, pasted in full with no other text. Its raw text is saved
verbatim as `research/pilot/PILOT_BRIEF.md` (SHA-256 `73a0ff6541f83544975ee018b7226557c70a56382f0e3f0c369d8e14c8cf7f06`)
and is not repeated here.

**TL;DR:** Did Milestone 1: branch, fixture, ten faults with validation, tool smoke tests, the trial
runner with fake-model tests, C1-C5 history builders with verbatim-copy tests, scorer, report,
figure, secret scrub and pre-commit scan. Stopped at Checkpoint 1 with no model calls and USD 0 spent.

**Files changed:**
- `research/pilot/**` — [NEW] everything listed in `research/pilot/LEDGER.md`, register 1.
- `.git/hooks/pre-commit` — [NEW, local, not committed] a copy of `research/pilot/harness/hooks/pre-commit`; it acts only on `research/stage1-pilot`.
- Nothing under `packages/`, and not the root `package.json`.

**Key decisions:** The token is derived from the nonce by SHA-256 (D1). A git ceiling goes into the
bash env (D2). Directories count in the fingerprint (D3). Grep needs a Git Bash launch (D4, still
open). The layout, the kill rule, request-body storage, extra states, the control prompt and the run
order are D5 to D10, and S1 to S4 are scoring decisions. All are listed in `NOTEBOOK.md` for the human.

**Errors encountered:** The Write tool stripped trailing spaces from a verbatim copy; a test caught
it and `sed` restored them. One copied line had `fullStream` where chat.ts has `result.fullStream`;
fixed. A float assertion was loosened to 12 decimals. My hand-worked synthetic cost counted 38 turns
instead of 37; fixed before the test ran. One scratch file went to `/tmp` by mistake; it was left in
place (rule 10).

### Prompt 2 — 2026-09-25
where are we now? whats the status?

**TL;DR:** Reported the Checkpoint 1 status. No files changed.

### Prompt 3 — 2026-09-25
please commit and push to remote

**TL;DR:** Checked; everything was already committed and pushed (`ec34a29` local and remote). No files changed.

### Prompt 4 — 2026-09-25
The human's Checkpoint 1 answers and changes A and B, quoted in full in `research/pilot/PREREGISTRATION.md`.

**TL;DR:** Changed the primary metric to "re-ran the script", with the old definition kept as "rechecked" (A). Moved the workspaces to D:\work and D:\work-arc (B). Recorded the pre-registration confirmation, re-ran the tests, fault validation, fake trials and smoke test, then ran Milestone 2.

**Files changed:**
- `research/pilot/harness/{paths,shell-env,ids,trial,run,classify,score,report,render,deviations,fake-trial,validate-faults,smoke-tools}.ts` — changes A and B.
- `research/pilot/tests/{helpers,classify,trial,run,faults,report,synthetic}` — new tests for A and B; synthetic answers recomputed by hand.
- `research/pilot/PREREGISTRATION.md`, `NOTEBOOK.md`, `REPLICATION.md`, `LEDGER.md` — the confirmation, the log entries, and the layout.

**Key decisions:** Categories no longer depend on the fault (S2 revised). Controls use the same retry and rechecked definitions. Test scratch moved under the git ceiling.

**Errors encountered:** A fake-trial layout check was too strict for F02, whose work folder is empty at the end of a trial. I fixed the check and re-ran; NOTEBOOK A10 has the details. A sed edit split a REPLICATION table; I fixed it.
