# Synthetic report (Milestone 1)

Copied from the test run `research/pilot/ws/_tests/20260925T110033-29748/020-synthetic-run/results/synthetic/`,
the one that `tests/report.test.ts` builds (gitignored scratch, so it is copied here to be opened).
The records are synthetic, written by `tests/synthetic.ts`. The expected numbers were worked out by
hand in the header comment of `tests/report.test.ts`, and the test checks the report against them.

- `REPORT_first_generation.md`: the report as first written, with the review-sample line.
- `REPORT.md`: the same report regenerated with another seed. It shows that an existing
  `review_sample.csv` is left alone and that the older report was moved to `_superseded/`, not lost.
- `summary.csv`, `retry_by_condition.svg`, `review_sample.csv`: the scorer's output, the figure and the sample.

These numbers are test fixtures, not results.
