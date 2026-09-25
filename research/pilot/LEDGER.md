# Project ledger: Stage 1 pilot
_Last updated: 2026-09-25 · Index of every file, reference and search in this study. Read it before starting work._

The file-reference-logging skill asks for this ledger at the project root. The brief confines the
study to `research/pilot/`, so the ledger lives here and indexes this folder only.

## 1. Files and artifacts

| Path | Type | Status | Purpose / contents | Date | Origin |
|---|---|---|---|---|---|
| PILOT_BRIEF.md | instructions | current | the brief, verbatim (sha256 `73a0ff65…`) | 2026-09-25 | Prompt 1 |
| PREREGISTRATION.md | prereg | current, date blank | Section 10 verbatim, confirmation date for the human | 2026-09-25 | Prompt 1 |
| NOTEBOOK.md | lab notebook | current | commands, commits, settings, spend, anomalies, deviations | 2026-09-25 | Prompt 1 |
| REPLICATION.md | replication | current | how to rebuild every output | 2026-09-25 | Prompt 1 |
| DATA_MANIFEST.md | manifest | current | files over 45MB (none) | 2026-09-25 | Prompt 1 |
| swapneel-prompts.md | prompt log | current | prompts and change log (coding-agent skill) | 2026-09-25 | Prompt 1 |
| scratchpad/tasks_2026-09-25_1552.md | task plan | current | Milestone 1 checklist and evidence log | 2026-09-25 | Prompt 1 |
| .gitignore, .gitattributes | config | current | ignore `ws/`; LF on checkout | 2026-09-25 | Prompt 1 |
| harness/paths.ts | code | current | repo-anchored paths, trial layout | 2026-09-25 | Prompt 1 |
| harness/easycode.ts | code | current | the only imports of easycode product code | 2026-09-25 | Prompt 1 |
| harness/secrets.ts, harness/shell-env.ts | code | current | `.env` parsing, shell-env scrub, git ceiling, redaction | 2026-09-25 | Prompt 1 |
| harness/precommit.ts, harness/hooks/pre-commit | code | current | secret and size scan; hook copy in `.git/hooks` | 2026-09-25 | Prompt 1 |
| harness/fixture.ts | code | current | fixture files as string constants, git setup, nonce and token | 2026-09-25 | Prompt 1 |
| harness/faults.ts | code | current | F01-F10 injection and fixes | 2026-09-25 | Prompt 1 |
| harness/fsutil.ts, harness/fingerprint.ts | code | current | moves and copies with retry, workspace fingerprint | 2026-09-25 | Prompt 1 |
| harness/tools.ts | code | current | logging wrapper over easycode's tools, F01 stand-in | 2026-09-25 | Prompt 1 |
| harness/copied.ts | code | current | verbatim copies from chat.ts (history, content join, NOTE) | 2026-09-25 | Prompt 1 |
| harness/history.ts | code | current | prompts, P_full and P_norule, C1-C5 messages | 2026-09-25 | Prompt 1 |
| harness/cost.ts | code | current | token billing per provider, budget guard | 2026-09-25 | Prompt 1 |
| harness/turn.ts | code | current | one model turn: retries, timeout, kill, record | 2026-09-25 | Prompt 1 |
| harness/trial.ts | code | current | trial, branches, controls, branch re-runs | 2026-09-25 | Prompt 1 |
| harness/classify.ts | code | current | turn-1 validity and turn-2 metrics | 2026-09-25 | Prompt 1 |
| harness/run.ts, harness/ids.ts, harness/deviations.ts | code | current | planning, preflight, concurrency, infra-error pass | 2026-09-25 | Prompt 1 |
| harness/score.ts, harness/report.ts, harness/render.ts, harness/rebuild.ts | code | current | summary.csv, REPORT.md, figure, renders, review sample | 2026-09-25 | Prompt 1 |
| harness/stats.ts, harness/csv.ts | code | current | Wilson, exact McNemar, seeded sampling, CSV | 2026-09-25 | Prompt 1 |
| harness/fake-model.ts, harness/fake-trial.ts | code | current | scripted mock models, Milestone 1 fake trials | 2026-09-25 | Prompt 1 |
| harness/environment.ts, harness/evidence.ts | code | current | machine and code state, timestamped evidence files | 2026-09-25 | Prompt 1 |
| harness/smoke-tools.ts, harness/validate-faults.ts | code | current | Milestone 1 checks | 2026-09-25 | Prompt 1 |
| tests/*.test.ts, tests/helpers.ts, tests/synthetic.ts | tests | current | unit and integration tests; synthetic run with hand-worked answers | 2026-09-25 | Prompt 1 |
| evidence/m1/smoke_gitbash-launch_20260925T102744Z.json | evidence | current | 7/7 tools ok, launched from Git Bash | 2026-09-25 | Prompt 1 |
| evidence/m1/smoke_windows-path-launch_20260925T102755Z.json | evidence | current | grep fails with a plain Windows PATH | 2026-09-25 | Prompt 1 |
| evidence/m1/fault_validation_20260925T102827Z.{json,md} | evidence | superseded by 102935Z | first validation, before the git ceiling (shows anomaly A2) | 2026-09-25 | Prompt 1 |
| evidence/m1/fault_validation_20260925T102935Z.{json,md} | evidence | current | 10/10 faults, with the git ceiling | 2026-09-25 | Prompt 1 |
| evidence/m1/fake_trials_20260925T104330Z.json, fake_trial_x000*.json.gz | evidence | current | two full fake-model trials, archives, longest path | 2026-09-25 | Prompt 1 |
| evidence/m1/condition_examples_x0002_20260925T104330Z.md | evidence | current | exact system prompts and C1-C5 messages from a fake turn 1 | 2026-09-25 | Prompt 1 |
| evidence/m1/test_results_*.txt, *.junit.xml | evidence | current | full test run | 2026-09-25 | Prompt 1 |
| evidence/m1/synthetic_report/ | evidence | current | REPORT.md (two generations), figure, summary and review sample from the synthetic run | 2026-09-25 | Prompt 1 |
| evidence/m1/preflight_*_20260925T1104*.json | evidence | current | pre-run checks: ok for Gemini from Git Bash; refused for missing keys and for a plain Windows PATH | 2026-09-25 | Prompt 1 |
| harness/preflight-check.ts | code | current | runs the pre-run checks and saves the outcome | 2026-09-25 | Prompt 1 |

## 2. References

| Citation | URL / DOI | Verified | Local copy | Used in | Bucket |
|---|---|---|---|---|---|
| AI SDK 6.0.191 source (`node_modules/ai/dist`) | local package | ✅ 2026-09-25 | node_modules | turn.ts (retries, usage), fake-model.ts (MockLanguageModelV3) | code |
| @ai-sdk/google 2.0.74 source | local package | ✅ 2026-09-25 | node_modules | cost.ts (thinking tokens, anomaly A3) | code |

## 3. Activity log

| Date | What was done | Result / where it landed |
|---|---|---|
| 2026-09-25 | Read chat.ts, system-prompt.ts, shell.ts, bash.ts, tools/*, models.ts, shared/models.ts at 4f126f9 | design in harness/; copies in harness/copied.ts |
| 2026-09-25 | Checked how ai 6 adapts v2 providers' usage | Gemini thinking tokens sit outside outputTokens; NOTEBOOK A3 |
| 2026-09-25 | Grep smoke test under two PATHs | NOTEBOOK A1, question Q1 |
| 2026-09-25 | Probed git under F07 | NOTEBOOK A2, deviation D2 |

### Added 2026-09-25, after Checkpoint 1 (changes A and B)

| Path | Type | Status | Purpose / contents | Date | Origin |
|---|---|---|---|---|---|
| PREREGISTRATION.md | prereg | current, confirmed 2026-09-25 | Section 10 verbatim, change-A definitions, the human's message quoted | 2026-09-25 | Prompt 4 |
| evidence/cp1-changes/test_results_20260925T132051Z.{txt,junit.xml} | evidence | current | 100 tests, 0 failures, after A and B | 2026-09-25 | Prompt 4 |
| evidence/cp1-changes/fault_validation_20260925T132348Z.{json,md} | evidence | current | 10/10 faults at D:\work, ceiling D:\work | 2026-09-25 | Prompt 4 |
| evidence/cp1-changes/fake_trials_20260925T132415Z.json, fake_trial_x0003/x0004 | evidence | superseded by 132504Z | first run; over-strict layout check (NOTEBOOK A10) | 2026-09-25 | Prompt 4 |
| evidence/cp1-changes/fake_trials_20260925T132504Z.json, fake_trial_x0005/x0006, condition_examples_x0006_* | evidence | current | 10/10 branches each, longest path 91, only project\ in work folders | 2026-09-25 | Prompt 4 |
| evidence/cp1-changes/smoke_gitbash-launch_20260925T132437Z.json | evidence | current | 7/7 tools at the new roots | 2026-09-25 | Prompt 4 |
| D:\work, D:\work-arc | workspaces (outside the repo) | current | trial workspaces and archives, never deleted | 2026-09-25 | Prompt 4 |
| harness/project-cost.ts, harness/check-tokens.ts | code | current | cost projection; Gemini token accounting check | 2026-09-25 | Prompt 4 |
| runs/m2-dryrun-20260925/ | raw data | current | manifest, 23 records, completion (Milestone 2) | 2026-09-25 | Prompt 4 |
| results/m2-dryrun-20260925/ | results | current | summary.csv, REPORT.md, figure, 23 renders, review_sample.csv, cost_projection.md, token_accounting_check.md | 2026-09-25 | Prompt 4 |
