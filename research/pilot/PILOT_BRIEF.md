# Stage 1 Pilot Brief: Do agents trust their own stale failure reports?

**Agent: start here.** This whole file is your instruction set.

1. If this file is not already saved at `research/pilot/PILOT_BRIEF.md`, save a verbatim copy there. Commit it on the branch named in rule 8.
2. Do Milestone 1 (Section 8), then stop at Checkpoint 1.
3. Never go past a checkpoint until the human replies "go" in writing.

**Platform: Windows only.** On Windows, easycode runs its bash tool through Git Bash (Git for Windows). Read Section 4.7, which covers what that changes, before you write any code.

### Settings

Use these defaults unless the human gives you different values. Record the values you used in every run manifest.

| Setting | Default | Notes |
|---|---|---|
| `BUDGET_USD` | 75 | Hard cap for all API spend in this pilot. Stop when projected spend would exceed it. |
| `MODELS` | `gemini-2.5-flash`, `claude-haiku-4-5`, `gpt-5.4-mini` | easycode's default model plus the cheap tier from the other two providers. |
| `REPS` | 5 | Repetitions per fault per model. |

---

## 1. Your job

You will build and run a small experiment. It answers one question:

> After a tool failure has been fixed, how often does a coding agent skip retrying because its conversation history says the tool is broken?

You will reuse easycode's real tools, system prompt, and model settings. You will inject faults, fix them between turns, and measure what the model does next. You return evidence: raw transcripts, a scoring script, and a generated report. You never return numbers without that evidence.

You do not decide whether the research continues. You report the numbers against the pre-registered thresholds in Section 10. The human decides.

## 2. Background you need

easycode pins this study to commit `4f126f9`. Record the commit you actually run against in every run manifest.

These are the pieces of easycode that matter:

- **`packages/server/src/routes/chat.ts`, `buildConversationHistory` (line 36).** It builds the history the model sees on later turns. It keeps only the text of past assistant messages and drops all tool calls and tool results. It skips `ERROR` messages and assistant messages with empty text.
- **How `content` is built (same file, `streamAIResponse`).** easycode stores an assistant message's `content` as all text parts of the response joined with `""`, with no separator. Consecutive text deltas merge into one part until a tool call interrupts them.
- **`withShellCheck` (line 81).** In BUILD mode it runs a real shell check. It then appends this note to the latest user message, visible only to the model:
  `[Environment check, run just now: the bash tool works (Git Bash). Any bash errors earlier in this conversation are out of date.]`
  The word in parentheses is `check.name`, which is `Git Bash` on Windows. `withShellCheck` is not exported, but `checkShell()` in `packages/server/src/lib/shell.ts` is. Build the note by calling the real `checkShell()` and filling in the template string copied verbatim from `chat.ts`. Assert `check.ok` before every C3 and C5 branch.
- **`packages/server/src/system-prompt.ts`, `buildSystemPrompt({ cwd, mode })`.** The BUILD prompt contains rule 5 (line 78), which starts `5. **Earlier failures are not permanent.**`. This rule is itself a mitigation for the behavior we study.
- **`packages/server/src/tools/index.ts`, `createTools(cwd, mode)`.** These are the real tools. In BUILD mode they are readFile, listDirectory, grep, glob, writeFile, editFile, and bash.
- **`packages/server/src/lib/models.ts`, `resolveChatModel(modelId)`.** It returns the model object plus easycode's provider options, including thinking settings.
- **`packages/shared/src/models.ts`, `SUPPORTED_CHAT_MODELS`.** Per-model pricing lives here. Use it for cost tracking.

The phenomenon: in turn 1 a tool fails and the model writes something like "bash is not available." The user fixes the problem. In turn 2 the model sees only its own sentence, not the original error. It may then answer from that stale sentence instead of trying again.

## 3. Hard rules

Break none of these. If a rule blocks you, stop and ask.

**Data integrity**

1. Every number in any report comes from a script that reads the raw trial files. Never type a number into a report by hand.
2. Never drop a trial silently. Every trial ends in exactly one recorded state: valid, invalid with a reason, or infra error. Reports show counts for every state.
3. After Checkpoint 1 you must not change fault definitions, prompts, conditions, models, reps, or scoring rules without approval. If you think a change is needed, write the proposal in `NOTEBOOK.md` and stop. An approved change gets a new `run_id`. Keep the old data.
4. If you find a scorer bug after data exists, fix it and re-score every run. Log the bug, the fix, and what changed in `NOTEBOOK.md`.
5. Never re-run a trial because its result looks odd. Re-run only infra errors, in a separate logged pass.
6. Write no placeholder, estimated, or example numbers anywhere. An honest partial result beats a complete invented one.
7. Report failures in plain words at the top of your handback, not buried at the end.

**Repository safety**

8. Work only on a new branch named `research/stage1-pilot`. Never commit to `main`.
9. Never force-push, never hard reset, never rewrite history. Normal pushes of your branch are fine.
10. Never delete any file, anywhere. The harness moves and copies files; it never deletes them. Trial workspaces pile up under a gitignored folder. The human cleans them up later.
11. Do not modify anything under `packages/` or the root `package.json`. Where you need a function that easycode does not export, copy it verbatim into the harness. Add a comment citing the source file, line, and commit, and a test showing it matches. If you truly cannot avoid a product change, stop and ask.
12. Add no new dependencies without asking. Implement the statistics yourself (Section 7) and test them.

**Secrets**

13. API keys come from the repo-root `.env`, loaded the way easycode loads it. Never print, log, or commit a key.
14. easycode's bash tool passes the server's full environment to every command (`shell.ts` line 46, `bash.ts` line 42). In the harness that would leak API keys into transcripts whenever a model runs `env`. Stop that from happening without editing `packages/`. One approach: call `resolveShell()` once at startup, then remove secret variables from the `env` object it returns, since the bash tool reuses that cached object. Windows environment variable names are case-insensitive, so match names case-insensitively. Remove every variable loaded from `.env`, plus any name matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CLERK`, or `DATABASE_URL`. Add a test that runs `env` through the real bash tool and asserts that no secret name or value appears.
15. Before every commit, scan all staged files for the literal key values and fail the commit if any appear.

**Scope**

16. Use only the models listed in Settings. If a provider rejects a model id, stop and ask. Do not substitute another model.
17. Do not start the server or connect to the database, and do not use Clerk. The harness calls the AI SDK directly. Do not import `routes/*`, `server/src/index.ts`, `lib/auth.ts`, or `@easycode/database/client`.

If you have the `coding-agent`, `replication-doc`, or `file-reference-logging` skills installed, follow them too. Where they conflict with this brief, this brief wins for this study.

## 4. The frozen design

### 4.1 Fixture project

Build a small, pure-bash fixture project with no network use and no language runtime beyond bash and coreutils. Each trial gets a fresh copy at a fixed path inside `research/pilot/ws/<trial_id>/project/`. The fixture contains:

- `scripts/run_tests.sh`: the test entry point. It sources `lib/assert.sh`, reads `config/test.env`, and checks that `data/fixtures.txt` uses LF line endings. It calls `bash bin/fixturetool --version`, requiring version 2.0 or newer; calling it through `bash` avoids depending on Windows executable bits. It checks that `.test.lock` is absent and runs `git rev-parse --show-toplevel`. Then it runs 7 checks.
  - On success it prints this last line: `RESULT: PASS 7/7 token=<NONCE>`.
  - With `--verbose` it also prints one line per check before the result.
  - The nonce sits in a single line of the script (`NONCE=...`) so the harness can rewrite it.
  - On each failure it prints the error listed in 4.2 to stderr and exits 1.
- `lib/assert.sh`, `config/test.env`, `data/fixtures.txt`, `bin/fixturetool` (prints `fixturetool 2.1.0`), and a `README.md` of one or two lines.
- A git repository: the setup step runs `git init` inside the workspace, sets `core.autocrlf=false` and a local `user.name` and `user.email` for that repository only, and makes one commit.
- Generate every fixture file from string constants in the harness code, written with LF line endings. Never commit fixture files as templates in the repo, because Git for Windows may convert them to CRLF on checkout. Add a test that asserts no generated file contains a carriage return.

**Stash location.** Keep the fault stash outside the project folder, in `research/pilot/ws/_stash/<trial_id>/`. The model must not find a stashed file by listing its own project.

### 4.2 Faults

The harness injects each fault before turn 1. The fix runs after turn 1, before turn 2. Every fix also rewrites `NONCE` in `run_tests.sh` to a new random value. Only a run of the script after the fix can produce the correct token.

| ID | Fault | Kind | Injection | Error the model sees | Fix |
|---|---|---|---|---|---|
| F01 | Bash unavailable | tool-level, simulated | The harness wraps the bash tool so it returns exactly `{ error: "No bash shell is available. On Windows, commands run through Git Bash: install Git for Windows (https://git-scm.com/download/win) and restart the server." }` (the string from `bash.ts`) | that string | Remove the wrapper for turn 2 |
| F02 | Project folder missing | tool-level, real | Move `project/` to the stash | easycode's real "project folder no longer exists" error; file tools fail with ENOENT | Move it back |
| F03 | Test script missing | command-level | Move `scripts/run_tests.sh` to the stash | bash: No such file or directory | Move it back |
| F04 | Helper library missing | command-level | Move `lib/assert.sh` to the stash | `ERROR: cannot load lib/assert.sh` | Move it back |
| F05 | Windows line endings | command-level | Overwrite `data/fixtures.txt` with the same content using CRLF line endings | `ERROR: data/fixtures.txt has Windows (CRLF) line endings; tests need LF` | Overwrite it with the LF version |
| F06 | Config missing | command-level | Move `config/test.env` to the stash | `ERROR: config/test.env not found` | Move it back |
| F07 | Not a git repo | command-level | Move `.git` to the stash | `fatal: not a git repository` | Move it back |
| F08 | Stale lock file | command-level | Create `.test.lock` | `ERROR: another test run is in progress (.test.lock exists)` | Move the lock to the stash |
| F09 | Tool too old | command-level | Overwrite `bin/fixturetool` to print `fixturetool 1.4.0` | `ERROR: fixturetool 1.4.0 is too old; version 2.0 or newer is required` | Overwrite it back to 2.1.0 |
| F10 | Malformed config | command-level | Overwrite `config/test.env` with an invalid line 3 | `ERROR: config/test.env line 3: invalid entry` | Overwrite it with the valid file |

**Fault validation (Milestone 1, no model calls).** For each fault, run the test command through the real easycode bash tool after injection. Record that it fails with the expected error. Then apply the fix, run it again, and record that it prints `RESULT: PASS` with the new nonce. Save this output as evidence. If any fault does not reproduce, stop and report. Do not substitute a different fault.

### 4.3 Turn prompts

All trials run in BUILD mode.

- **Turn 1 (every trial):** `Run the test suite with bash scripts/run_tests.sh and tell me whether it passes. Quote the last line of output. Don't modify any files.`
- **Turn 2, variant V1 (retry):** `Please try again.`
- **Turn 2, variant V2 (new task):** `Now run bash scripts/run_tests.sh --verbose and tell me how many checks passed. Quote the last line of output. Don't modify any files.`

### 4.4 Conditions

Every trial runs one turn 1. From that single turn 1, the harness branches into 2 variants × 5 conditions = 10 turn-2 runs. This paired design keeps turn 1 identical across conditions.

Definitions:

- **T1** is the turn-1 user message.
- **A1_text** is the turn-1 assistant text, built exactly as easycode builds `content`.
- **A1_msgs** is the AI SDK `response.messages` from turn 1, which holds the assistant tool-call messages and the tool-result messages.
- **P_full** is `buildSystemPrompt({ cwd, mode: "BUILD" })`.
- **P_norule** is P_full with the rule-5 line removed. Assert that the line appears exactly once before removal. Store the SHA-256 of both prompts in the manifest.
- **NOTE** is the attestation string from Section 2, verbatim.

| Condition | Turn-2 system prompt | Turn-2 messages | What it tests |
|---|---|---|---|
| C1 NARRATION | P_norule | `[user T1, assistant A1_text, user V]` | easycode's history with no mitigation; the core measurement |
| C2 FULL_TRACE | P_norule | `[user T1, ...A1_msgs, user V]` | the same, but the model sees the real error |
| C3 NARRATION_NOTE | P_norule | C1, with `V + "\n\n" + NOTE` | the attestation alone |
| C4 NARRATION_RULE | P_full | C1 | the system-prompt rule alone |
| C5 SHIPPED | P_full | C1, with `V + "\n\n" + NOTE` | approximately what easycode ships today |

Turn 1 always uses P_norule, so all five branches share one identical turn 1. As a result, C5 approximates shipped easycode rather than reproducing it exactly. State this in the report.

If a provider rejects the replayed trace in C2, record the provider's error. Do not edit the trace. Stop and report.

**Branch mechanics.** Run the branches of one trial one after another at the same workspace path, so the `cwd` in the system prompt never changes.

1. After turn 1, copy the workspace to a snapshot.
2. For each branch:
   1. Apply the fix.
   2. Run turn 2.
   3. Move the finished workspace to `ws/<trial_id>/arc/<variant>_<condition>/`.
   4. Copy the snapshot back to the canonical path.

Nothing gets deleted.

**Controls.** For each model, run 10 fresh single-turn sessions with the turn-1 prompt and 10 with the V2 prompt, with no fault and no history. These show whether the model runs the script and quotes the token when nothing has gone wrong.

### 4.5 Model call settings

- Use `generateText` from the `ai` package, with the real tools from `createTools(cwd, "BUILD")`, the system prompt above, and `resolveChatModel(modelId)` for the model and `providerOptions`.
- Set `stopWhen: stepCountIs(15)`. easycode uses 50. This is a documented deviation to bound cost. Record whether each run hit the cap.
- Leave temperature and other sampling settings at the provider defaults, as easycode does. Record whatever the SDK reports.
- Record the model id the provider returns in the response, not just the one you requested.
- Wrap every tool so the harness logs each call and its result with timestamps. The wrapper must pass arguments and results through unchanged, except for the F01 fault.

### 4.6 Scale

For each model: 10 faults × `REPS` = 50 turn-1 runs. Each valid turn 1 produces 10 turn-2 runs, and the controls add 20 more.

With the default settings, the whole pilot is 150 turn-1 runs, at most 1,500 turn-2 runs, and 60 control runs.

Run at most 4 concurrent trials per provider.

### 4.7 Windows specifics

- **Git Bash.** easycode's `resolveShell()` finds Git for Windows and runs `bash.exe` from it. In Milestone 1, record:
  - the resolved `bash.exe` path
  - the output of `bash --version` and `git --version`
  - the Windows version

  If `resolveShell()` returns null, stop and ask.
- **Smoke-test all seven tools.** Before any model call, run each tool from `createTools` once on a fresh fixture and save the results.
  - The grep tool spawns `grep` from the Windows `PATH`, not from Git Bash's environment. On many machines `grep.exe` is not on that `PATH`, so the tool fails. An unplanned tool failure would contaminate the experiment. If grep fails, stop and ask the human. Do not change the tool's code.
  - This grep behavior is also a real easycode bug. Note it in `NOTEBOOK.md`.
- **File moves.** On Windows, a move can fail with `EBUSY` or `EPERM` while another process holds a handle, such as an antivirus scanner, the search indexer, an editor, or a leftover `bash.exe`.
  - Retry a failed move up to 5 times with backoff. If it still fails, mark the trial `INFRA_ERROR` with the reason.
  - Never fall back to copy-then-delete.
- **Hung commands.** easycode's bash timeout calls `proc.kill()`. On Windows that may not kill child processes, which keep the pipes open, so the tool call never returns.
  - Enforce a 5-minute wall-clock limit per turn in the harness and record `TURN_TIMEOUT` as an infra error.
  - After a timeout, find leftover processes whose command line contains the trial path, for example with PowerShell's `Get-CimInstance Win32_Process`. Kill them with `taskkill /T /F`, and log what you killed.
- **Path length.** Keep every path under 200 characters. Use short trial ids such as `t0001` and the short root `research/pilot/ws/`. In Milestone 1, create one full trial including archives and report the longest path. If the repo sits too deep on disk, stop and ask.
- **Permission bits.** Windows ignores Unix permissions, so the workspace fingerprint leaves them out.
- **Security settings.** Antivirus scanning may slow file-heavy steps. Record wall time per trial. Never change security settings yourself.
- **Scope of results.** Every result from this pilot comes from Windows with Git Bash. The system prompt tells the model it is on Windows and should use POSIX commands. State this scope in the report.

## 5. Validity and outcomes

### 5.1 Turn-1 validity

Record exactly one state for every turn 1:

- **VALID:** the model attempted the operation and the workspace fingerprint did not change. "Attempted" means:
  - for F01 and F02, any bash call
  - for F03 to F10, a bash call whose command contains `run_tests.sh`
- **INVALID_NO_ATTEMPT:** the model never attempted the operation.
- **INVALID_MODIFIED:** the workspace fingerprint changed during turn 1.
- **INVALID_EMPTY:** the final assistant text was empty. easycode drops such messages from history, so the branches would be meaningless.
- **INFRA_ERROR:** an API error that survived 5 retries with exponential backoff, or a harness crash.

The **workspace fingerprint** is a SHA-256 over every file's relative path and content, plus whether `.git` and `.test.lock` exist. It excludes the contents of `.git`.

Only VALID turn-1 runs get branches. Also flag, without excluding, any turn-1 or turn-2 tool call whose arguments contain `..` or `_stash`.

### 5.2 Turn-2 metrics

Record all four for every branch:

- **retry** (primary): the model re-attempted the failed operation, using the same definition as "attempted" above.
- **recovered:** retry happened, some turn-2 tool result contains the new nonce, and the final text contains the new nonce.
- **any_tool:** turn 2 made at least one tool call of any kind.
- **category:** exactly one of the following.

| Category | Meaning |
|---|---|
| RECOVERED | as defined above |
| RETRIED_NOT_REPORTED | the script ran and printed the new nonce, but the answer does not quote it |
| RETRIED_FAILED | the script ran but did not print the new nonce. This points to a harness bug: flag it at the top of the report |
| OTHER_TOOL_ONLY | tool calls happened, but none re-attempted the operation |
| NO_TOOL | no tool calls at all |

For NO_TOOL branches, also add a heuristic flag `looks_stale`. Set it when the text claims the earlier failure still holds or asks the user to fix it. This flag never feeds a headline number. It only helps the human review.

## 6. Files and layout

```
research/pilot/
  PILOT_BRIEF.md          this file
  PREREGISTRATION.md      Section 10 copied verbatim, plus the date the human confirmed it
  NOTEBOOK.md             dated lab notebook: every command, commit, setting, cost, and anomaly
  REPLICATION.md          how to regenerate every number from the raw files
  DATA_MANIFEST.md        any file over 45MB: path, size, sha256, how to regenerate
  harness/                TypeScript on Bun, repo-relative paths only
  tests/                  unit tests for every module
  runs/<run_id>/          manifest.json and trials/*.json.gz (raw, committed if under 45MB)
  results/<run_id>/       generated summary.csv, REPORT.md, review_sample.csv, figures
  ws/                     gitignored scratch space and archives, never deleted
```

**Trial record.** Each trial's JSON holds everything needed to rebuild what the model saw and did:

- ids: run, trial, model requested, model returned, provider, fault, rep
- versions: easycode commit and harness commit
- for turn 1 and each branch:
  - the full system prompt text and its hash
  - the full messages sent and the tool names offered
  - every step, with its tool calls and results
  - the final text, token usage (including reasoning tokens), finish reason, and whether the step cap was hit
  - workspace fingerprints before and after, and timings
- the validity state, outcome fields, flags, and any errors

**Transcripts.** Write a render script that turns any trial into readable Markdown: each turn, each tool call with its result, and the final text. The human reviews transcripts through these renders.

## 7. Scoring and the report

`harness/score.ts` reads only the raw trial files and writes `summary.csv`. `harness/report.ts` reads `summary.csv` and the raw files and writes `REPORT.md`. The report contains, in this order:

1. **Problems first:** any RETRIED_FAILED, infra errors, flagged tool calls, provider rejections, and deviations from this brief.
2. **Manifest:** commits, date, Windows version, Bun version, Git Bash path and version, Git version, models requested and returned, provider options, and prompt hashes. State that all results come from Windows with Git Bash.
3. **Accounting:** turn-1 counts by state, for each model and fault.
4. **Primary table:** retry rate with a 95% Wilson interval for each model and condition. Show it pooled across faults and variants, and split by variant.
5. **Paired comparisons,** for each model:
   - pairs: C1 vs C2, C1 vs C3, C1 vs C4, C1 vs C5
   - count the discordant pairs
   - report an exact McNemar p-value (a two-sided binomial test on the discordant pairs)
   - label every p-value exploratory
6. **Per-fault retry rates in C1,** for each model.
7. **Controls:** retry-equivalent and recovered-equivalent rates.
8. **Outcome categories:** the distribution for each model and condition.
9. **Cost:** actual spend for each model and condition, from token usage and the pricing table.
10. **Threshold check:** each Section 10 threshold beside the observed value, marked met or not met. Give no recommendation.
11. **Number audit:** a table mapping every number in the report to the script and input file that produced it.

**Statistics.** Test Wilson and exact McNemar against hand-checked values in `tests/`. The V1 and V2 branches of one trial share a turn 1, so they are not independent. State this under the pooled tables.

**One figure:** retry rate by condition, one panel per model, with 95% intervals. Open the rendered image and check it before calling it done.

**Human review sample.** For each model and condition, pick 5 random NO_TOOL branches and 5 random other branches, using a recorded seed. Write `review_sample.csv` with trial id, branch, auto category, `looks_stale`, the path to the render, and an empty `human_label` column. Do not fill in `human_label`.

## 8. Milestones and checkpoints

### Milestone 1: build and validate, with no model calls

- Create the branch, folder layout, `NOTEBOOK.md`, and `.gitignore` entry for `ws/`.
- Record the Windows environment details and run the tool smoke tests from Section 4.7.
- Build the fixture, fault injection, fixes, and nonce rotation. Save the fault-validation output for all 10 faults.
- Run one full trial's file operations with a fake model, including all ten branch archives. Report the longest path.
- Build the history builders for C1 to C5, with tests:
  - C1 matches easycode's `buildConversationHistory` and `content` join on sample data.
  - Rule removal asserts exactly one occurrence.
  - NOTE matches the string in `chat.ts`.
- Build the trial runner, branch mechanics, fingerprinting, logging, budget guard, and infra-error handling. Use a fake model in tests: the AI SDK ships mock language models for this.
- Build the scorer and report on synthetic trial files whose correct answers you worked out by hand.
- Build the secret-scrubbing test and the pre-commit secret and size scan.
- Copy Section 10 into `PREREGISTRATION.md`, leaving the confirmation date blank.

**CHECKPOINT 1. Stop.** Hand back:
- Windows environment details, tool smoke-test results, and the longest path
- fault-validation evidence
- test results
- the exact system prompts and one example of each condition's messages, built from a fake turn 1
- any deviation from this brief

Wait for "go". The human also fills in the `PREREGISTRATION.md` confirmation date at this point.

### Milestone 2: dry run with real model calls

- Run `gemini-2.5-flash` on F01, F03, and F07, with 1 rep each, all branches, and both control types.
- Render every transcript.
- Measure tokens and cost per turn-1 run and per branch. Project the full pilot cost from those measurements.

**CHECKPOINT 2. Stop.** Hand back:
- the renders
- measured and projected cost against `BUDGET_USD`
- anything surprising in how the model behaved or how the harness recorded it

Wait for "go". If the projection exceeds the budget, propose fewer reps or fewer faults and wait.

### Milestone 3: full pilot

- Run the full design from Section 4.6 under a new `run_id`. Stop early if spend reaches `BUDGET_USD`, and report what finished.
- Run one logged pass that retries infra errors only.
- Score the runs, generate the report, figure, and review sample, and commit.

**CHECKPOINT 3. Stop.** Hand back the report and the review sample, using the template in Section 9. This ends Stage 1.

## 9. Handback template for every checkpoint

```
## Checkpoint N handback
Problems and deviations: (first, in plain words, or "none")
What I built or ran: (commands, run_id, commits)
Evidence: (paths to files the human can open)
Numbers: (only ones generated by scripts, each with its source file)
Spend so far: USD x of BUDGET_USD
What I need from you: ("go", or a specific decision)
```

## 10. Pre-registration (the human confirms before Milestone 3)

These thresholds decide whether Stage 2 is worth doing. They are not claims for a paper. The pilot is too small for confident statistical claims.

A **stale rate** is 1 minus the retry rate.

- **H1, the phenomenon exists:** in C1, at least one model has a stale rate of 20% or more, over at least 40 valid paired branches.
- **H2, narration differs from raw evidence:** for at least one model, the C1 and C2 retry rates differ by 10 percentage points or more. The direction is not predicted.
- **H3, the attestation helps:** pooled across models, the C3 retry rate exceeds C1 by 10 percentage points or more.

How the human plans to read the outcome:

| Result | Reading |
|---|---|
| H1 fails | Stop, or rethink the question. |
| H1 holds, H2 fails | The phenomenon is real, but the narration-versus-evidence angle is weak. Reframe before Stage 2. |
| H1 and H2 hold | Proceed to Stage 2. |

In every case, the human reads the transcripts before deciding.

## 11. Things you will be tempted to do: don't

- Adding reps, faults, or models to get a cleaner result.
- Rewording a prompt because a model misread it. Record the misreading instead.
- Dropping a fault because it behaves strangely.
- Hand-correcting a category the scorer got wrong. Fix the scorer and re-score everything.
- Using an LLM judge for any headline number.
- Summarizing results without the accounting table.
- Cleaning up workspaces or old runs.
- Changing easycode's code to make the harness easier.
- Continuing past a checkpoint because the next step seems obvious.
