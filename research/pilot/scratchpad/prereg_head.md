# Pre-registration: Stage 1 pilot

Section 10 of `PILOT_BRIEF.md` is copied verbatim below, by `awk` from the saved brief (see NOTEBOOK.md, 2026-09-25).
Its wording is unchanged. The definitions block above it says what its terms mean, as the human confirmed.

**Confirmed by the human on: 2026-09-25**, with "retry rate" meaning the metric from change A.

## Definitions in force (change A, human's instruction of 2026-09-25)

- **Retry** (primary metric; the "retry rate" of Section 10): the model re-ran the script. A turn-2
  bash command contains `run_tests.sh` AND a turn-2 tool result contains the new derived token
  (deviation D1). This applies to every fault.
- **Rechecked** (secondary metric): the brief's original definition applied in turn 2. For F01 and
  F02 it is any bash call; for F03 to F10 it is a bash command containing `run_tests.sh`.
  `cat scripts/run_tests.sh` counts as rechecked but not as a retry (tests: `tests/classify.test.ts`,
  `tests/trial.test.ts`, "change A").
- **Stale rate** = 1 minus the retry rate, as Section 10 defines it.
- Turn-1 validity still uses the brief's Section 5.1 "attempted" definition. It is not changed.

## The human's message, quoted

> Answers to Checkpoint 1:
>
> 1. Grep: approved. Launch the harness from Git Bash and keep it recorded as D4.
> 2. D1 and D2: both approved.
> 3. Controls: 10 of each type in the dry run.
>
> Two more changes before any model call:
>
> A. Primary metric. Redefine "retry" for all faults as "re-ran the script":
>    a turn-2 bash command contains run_tests.sh AND a turn-2 tool result
>    contains the new derived token. Keep the current definition as a
>    secondary metric named "rechecked". Update the classifier,
>    categories, report, tests, and the definitions in PREREGISTRATION.md
>    so "retry rate" in Section 10 refers to the new metric. Add tests
>    showing that `cat scripts/run_tests.sh` counts as rechecked but not
>    as a retry.
>
> B. Workspace location. Move trial workspaces outside the repo to
>    D:\work\<trial_id>\project, and keep snapshots, stashes, and
>    archives under D:\work-arc\ so nothing sits next to project\. Make
>    the root a recorded setting, keep D2 with the ceiling at D:\work,
>    and log both changes as deviations.
>
> After A and B, rerun the full test suite, fault validation, and the two
> fake trials, and commit. If everything passes, go ahead with Milestone 2
> and put the evidence for A and B at the top of the Checkpoint 2
> handback. If anything fails, stop and report.
>
> Pre-registration: I have read Section 10 and confirm it as written, with
> "retry rate" meaning the metric from change A. Record my confirmation
> in PREREGISTRATION.md with today's date, 2026-09-25, quoting this
> message.

---

