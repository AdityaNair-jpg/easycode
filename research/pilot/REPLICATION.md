# Replication

How to regenerate every number in this pilot from the raw files. All commands run from the repo
root, in Git Bash on Windows (see `NOTEBOOK.md`, deviation D4).

## Environment

- Windows with Git for Windows (Git Bash). The runs so far used Windows 11 10.0.26200, Git 2.49.0,
  bash 5.2.37 and Bun 1.4.2; each run's `manifest.json` records its own values.
- Bun, with the repo's dependencies installed from the committed `bun.lock` (`bun install` at the
  repo root). The harness adds no dependencies of its own; it imports `ai`, `ai/test`, `zod` and
  easycode's packages, all pinned by `bun.lock`.
- easycode itself at commit `4f126f9`. The harness refuses a real run if `packages/` differs from it.
- API keys in the repo-root `.env`, only for steps that call a model.

## What can be rebuilt offline, and what can't

| Step | Needs | Deterministic |
|---|---|---|
| Tests, fault validation, tool smoke test, fake-model trials | Git Bash, Bun | yes, apart from the random nonces and timestamps |
| Scoring, report, figure, renders, review sample (`rebuild.ts`) | the committed raw records | yes |
| Model runs (`run.ts`) | API keys, network, money | **no**: provider sampling differs from call to call. The raw records are the frozen outputs; rebuild from them rather than re-running |

Trial workspaces (not needed to rebuild any number) live outside the repo, at the roots recorded in
each manifest (`settings.workRoot`, default `D:\work`, and `settings.arcRoot`, default `D:\work-arc`).
Set `PILOT_WORK_ROOT` and `PILOT_ARC_ROOT` to use other roots.

The scripts that write evidence take an evidence-folder argument (default `m1`); the re-validation
after changes A and B used `cp1-changes`.

## Scripts

| Script | Reads | Writes | Backs |
|---|---|---|---|
| `harness/precommit.ts` | staged files, `.env` values | nothing (exit code) | rule 15 scan, run by `.git/hooks/pre-commit` |
| `harness/smoke-tools.ts <label>` | nothing | `evidence/m1/smoke_<label>_<time>.json` | tool smoke test |
| `harness/validate-faults.ts` | nothing | `evidence/m1/fault_validation_<time>.{json,md}` | fault validation |
| `harness/fake-trial.ts` | nothing | `evidence/m1/fake_trials_<time>.json`, `fake_trial_*.json.gz`, `condition_examples_*.md` | longest path, example prompts and messages |
| `bun test research/pilot/tests` | the harness | test output | every module |
| `harness/run.ts --run-id <id> ...` | `.env`, the models | `runs/<id>/manifest.json`, `trials/*.json.gz`, `completion.json` | raw data (not deterministic) |
| `harness/run.ts --retry-infra <id>` | `runs/<id>/` | `runs/<id>/retry1.json`, retry records | the one infra-error pass |
| `harness/score.ts <id>` | `runs/<id>/manifest.json`, `runs/<id>/trials/*.json.gz` | `results/<id>/summary.csv` | every number |
| `harness/report.ts <id> [seed]` | `summary.csv`, the manifest, the raw records | `results/<id>/REPORT.md`, `retry_by_condition.svg`, `renders/*.md`, `review_sample.csv` | the report |
| `harness/rebuild.ts [id ...]` | all of the above | all of the above | one command to rebuild every offline output |
| `harness/project-cost.ts <id>` | `results/<id>/summary.csv`, the manifest | `results/<id>/cost_projection.md` | measured and projected cost |
| `harness/check-tokens.ts <id>` | the raw records | `results/<id>/token_accounting_check.md` | Gemini token accounting check |

`score.ts` and `report.ts` never overwrite a changed output. An older version is moved to
`results/<id>/_superseded/<time>/`. An existing `review_sample.csv` is never touched, since it may
hold human labels.

## Runs

Each run adds a row here. The raw records of every run are committed under `runs/<run_id>/`, and
`bun research/pilot/harness/rebuild.ts <run_id>` regenerates its results offline.

| run_id | purpose | command | report |
|---|---|---|---|
| m2-dryrun-20260925 | Milestone 2 dry run (gemini-2.5-flash; F01, F03, F07; 1 rep; 10 controls per type) | see NOTEBOOK.md, 2026-09-25 | `results/m2-dryrun-20260925/REPORT.md`, `cost_projection.md` |
