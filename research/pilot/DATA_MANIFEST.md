# Data manifest

Files over 45MB are never committed. Each one gets a row here with its path, size, SHA-256 and how
to regenerate it. The pre-commit scan (`harness/precommit.ts`) refuses any staged file over 45MB.

**As of 2026-09-25 no file in `research/pilot` is over 45MB.**

| Path | Size | SHA-256 | How to regenerate |
|---|---|---|---|

Not committed at all, by design (gitignored, never deleted by the harness): `research/pilot/ws/`,
which holds trial workspaces, stashes, snapshots, branch archives, event logs and test scratch. No
reported number depends on it. Every number comes from the committed records in `runs/`.
