// Reads results/<run_id>/summary.csv, the manifest and the raw records, and
// writes REPORT.md, the figure and review_sample.csv (brief, Section 7).
// Every number in the report is computed here from those inputs.
// Usage, from the repo root: bun research/pilot/harness/report.ts <run_id> [seed]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CATEGORIES } from "./classify.ts";
import { parseCsv, toCsv } from "./csv.ts";
import { stamp } from "./evidence.ts";
import { FAULT_IDS, FAULTS } from "./faults.ts";
import { safeMove } from "./fsutil.ts";
import { CONDITIONS, CONDITION_NAMES } from "./history.ts";
import { RESULTS_DIR, RUNS_DIR, repoRel } from "./paths.ts";
import { renderRun } from "./render.ts";
import { runDir } from "./store.ts";
import { mcnemarExact, mulberry32, sample, wilson, type Interval } from "./stats.ts";

export const DEFAULT_SEED = 20260925;
type R = Record<string, string>;
type Audit = { section: string; numbers: string; how: string };

const yes = (v: string | undefined) => v === "1";
const pct = (x: number) => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ciText = (w: Interval) => (w.n === 0 ? "n/a (n = 0)" : `${pct(w.p)} [${pct(w.lo)}, ${pct(w.hi)}]`);
const usd = (x: number) => `$${x.toFixed(4)}`;
const pval = (p: number) => (p >= 0.001 ? p.toFixed(3) : p.toExponential(2));
const table = (head: string[], rows: (string | number)[][]) => [
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
];

function rate(rows: R[], field = "retry"): Interval {
  return wilson(rows.filter((r) => yes(r[field])).length, rows.length);
}

// Writes a generated file; an older, different version is moved aside
async function writeGenerated(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === content) return;
    await safeMove(path, join(path, "..", "_superseded", stamp(), basename(path)));
  }
  writeFileSync(path, content);
}

export function figureSvg(panels: { model: string; points: { condition: string; w: Interval }[] }[]): string {
  const pw = 250, ph = 210, left = 56, top = 92, gap = 24, bottom = 58;
  const width = left + panels.length * pw + (panels.length - 1) * gap + 16;
  const height = top + ph + bottom;
  const y = (v: number) => top + ph - v * ph;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    "<style>",
    ".bg{fill:#fcfcfb}.ink{fill:#0b0b0b}.ink2{fill:#52514e}.grid{stroke:#e4e3de;stroke-width:1}.axis{stroke:#8f8e89;stroke-width:1}",
    ".mark{fill:#2a78d6;stroke:#fcfcfb;stroke-width:2}.bar{stroke:#2a78d6;stroke-width:2;stroke-linecap:round}",
    "@media (prefers-color-scheme: dark){.bg{fill:#1a1a19}.ink{fill:#ffffff}.ink2{fill:#c3c2b7}.grid{stroke:#34332f}.axis{stroke:#6f6e69}.mark{fill:#3987e5;stroke:#1a1a19}.bar{stroke:#3987e5}}",
    "</style>",
    `<rect class="bg" width="${width}" height="${height}"/>`,
    `<text class="ink" x="${left}" y="22" font-size="15" font-weight="600">Turn-2 retry rate by condition</text>`,
    `<text class="ink2" x="${left}" y="41" font-size="12">Pooled over faults and variants; bars are 95% Wilson intervals.</text>`,
    `<text class="ink2" x="${left}" y="57" font-size="12">V1 and V2 share a turn 1, so the intervals are too narrow.</text>`,
    `<text class="ink2" font-size="12" transform="translate(16 ${top + ph / 2}) rotate(-90)" text-anchor="middle">Retry rate</text>`,
  ];
  panels.forEach((panel, i) => {
    const x0 = left + i * (pw + gap);
    const step = pw / panel.points.length;
    parts.push(`<text class="ink" x="${x0 + pw / 2}" y="${top - 16}" font-size="13" font-weight="600" text-anchor="middle">${panel.model}</text>`);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      parts.push(`<line class="grid" x1="${x0}" x2="${x0 + pw}" y1="${y(t)}" y2="${y(t)}"/>`);
      if (i === 0) parts.push(`<text class="ink2" x="${x0 - 6}" y="${y(t) + 4}" font-size="11" text-anchor="end">${t * 100}%</text>`);
    }
    parts.push(`<line class="axis" x1="${x0}" x2="${x0 + pw}" y1="${y(0)}" y2="${y(0)}"/>`);
    panel.points.forEach((pt, j) => {
      const cx = x0 + step * (j + 0.5);
      parts.push(`<text class="ink2" x="${cx}" y="${y(0) + 17}" font-size="11" text-anchor="middle">${pt.condition}</text>`);
      parts.push(`<text class="ink2" x="${cx}" y="${y(0) + 31}" font-size="10" text-anchor="middle">n=${pt.w.n}</text>`);
      if (pt.w.n === 0) {
        parts.push(`<text class="ink2" x="${cx}" y="${y(0.5)}" font-size="10" text-anchor="middle">no data</text>`);
        return;
      }
      parts.push(
        `<g><title>${panel.model} ${pt.condition}: ${ciText(pt.w)}, ${pt.w.k}/${pt.w.n}</title>`,
        `<line class="bar" x1="${cx}" x2="${cx}" y1="${y(pt.w.lo)}" y2="${y(pt.w.hi)}"/>`,
        `<line class="bar" x1="${cx - 5}" x2="${cx + 5}" y1="${y(pt.w.lo)}" y2="${y(pt.w.lo)}"/>`,
        `<line class="bar" x1="${cx - 5}" x2="${cx + 5}" y1="${y(pt.w.hi)}" y2="${y(pt.w.hi)}"/>`,
        `<circle class="mark" cx="${cx}" cy="${y(pt.w.p)}" r="5.5"/></g>`,
      );
    });
  });
  parts.push(`<text class="ink2" x="${left}" y="${height - 10}" font-size="10">C1 narration · C2 full trace · C3 + note · C4 + rule · C5 rule + note (shipped)</text>`);
  parts.push("</svg>");
  return parts.join("\n") + "\n";
}

export type ReportOutputs = { report: string; figure: string; reviewSample: string | null; audit: Audit[] };

export async function writeReport(runId: string, opts: { runsRoot?: string; resultsRoot?: string; seed?: number } = {}): Promise<ReportOutputs> {
  const runsRoot = opts.runsRoot ?? RUNS_DIR;
  const resultsRoot = opts.resultsRoot ?? RESULTS_DIR;
  const seed = opts.seed ?? DEFAULT_SEED;
  const outDir = join(resultsRoot, runId);
  const summaryPath = join(outDir, "summary.csv");
  const manifestPath = join(runDir(runId, runsRoot), "manifest.json");
  const rows = parseCsv(readFileSync(summaryPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const summaryRel = repoRel(summaryPath);
  const audit: Audit[] = [];
  const renders = renderRun(runId, runsRoot, resultsRoot);
  const renderOf = (source: string) => (renders.get(source) ? repoRel(renders.get(source)!) : "");

  const eff = rows.filter((r) => yes(r.effective));
  const models: string[] = manifest.settings?.models ?? [...new Set(rows.map((r) => r.model_requested))];
  const turn1 = eff.filter((r) => r.unit === "turn1");
  const branches = eff.filter((r) => r.unit === "branch");
  const ran = branches.filter((r) => r.state === "RAN");
  const controls = eff.filter((r) => r.unit === "control");
  const byModel = (rs: R[], m: string) => rs.filter((r) => r.model_requested === m);
  const byCond = (rs: R[], c: string) => rs.filter((r) => r.condition === c);
  const faultsInRun: string[] = manifest.settings?.faults ?? FAULT_IDS;
  const lines: string[] = [];

  lines.push(`# Stage 1 pilot report: \`${runId}\``, "");
  lines.push(`Generated by \`research/pilot/harness/report.ts\` from \`${summaryRel}\`, \`${repoRel(manifestPath)}\` and the raw records it lists. No number here was typed by hand; section 11 maps each to its source.`, "");

  // 1. Problems
  lines.push("## 1. Problems first", "");
  const retriedFailed = eff.filter((r) => r.category === "RETRIED_FAILED");
  lines.push(`**RETRIED_FAILED branches: ${retriedFailed.length}.** A bash command named \`run_tests.sh\` but no tool result held the new token. The brief reads a failed run as a sign of a harness bug; a command that only reads the script (for example \`cat\`) also lands here, so check the command.`, "");
  if (retriedFailed.length) lines.push(...table(["model", "trial", "branch", "fault", "run_tests.sh commands", "render"], retriedFailed.map((r) => [r.model_requested, r.trial_id, r.branch, r.fault, `\`${r.script_commands.replace(/\|/g, "\\|")}\``, renderOf(r.source)])), "");
  const infra = rows.filter((r) => ["INFRA_ERROR", "MISSING_RECORD", "PROVIDER_REJECTED"].includes(r.state));
  lines.push(`**Infra errors and missing records, all passes: ${infra.length}** (${infra.filter((r) => yes(r.effective)).length} still counted after the infra-error pass; the rest were replaced by a retry).`, "");
  if (infra.length) lines.push(...table(["unit", "id", "model", "state", "reason", "pass", "still counted"], infra.map((r) => [r.unit, r.id, r.model_requested, r.state, r.state_reason, r.pass || "original", yes(r.effective) ? "yes" : "no"])), "");
  const rejected = rows.filter((r) => r.state === "PROVIDER_REJECTED" || r.state_reason === "PROVIDER_REJECTED");
  lines.push(`**Provider rejections: ${rejected.length}.**`, "");
  for (const r of rejected) lines.push(`- ${r.unit} ${r.id} (${r.model_requested}): see \`${r.source}\``);
  if (rejected.length) lines.push("");
  const flagged = rows.filter((r) => yes(r.flag_dotdot) || yes(r.flag_stash));
  lines.push(`**Tool calls with \`..\` or \`_stash\` in their arguments (flagged, not excluded): ${flagged.length} turns.**`, "");
  if (flagged.length) lines.push(...table(["unit", "id", "model", "..", "_stash", "render"], flagged.map((r) => [r.unit, r.id, r.model_requested, yes(r.flag_dotdot) ? "yes" : "", yes(r.flag_stash) ? "yes" : "", renderOf(r.source)])), "");
  const mismatch = rows.filter((r) => yes(r.state_mismatch));
  const toolLog = rows.filter((r) => yes(r.tool_log_mismatch));
  const unpriced = rows.filter((r) => r.priced === "0" && r.state !== "MISSING_RECORD");
  const notRun = rows.filter((r) => r.state === "NOT_RUN");
  const capped = rows.filter((r) => yes(r.hit_step_cap));
  lines.push(
    `- Turn-1 states where the scorer disagrees with the runner: ${mismatch.length}${mismatch.length ? ` (${mismatch.map((r) => r.id).join(", ")})` : ""}`,
    `- Turns whose tool calls don't match the harness tool log: ${toolLog.length}${toolLog.length ? ` (${toolLog.map((r) => r.id).join(", ")})` : ""}`,
    `- Rows without a price in SUPPORTED_CHAT_MODELS: ${unpriced.length}`,
    `- Units not run (budget stop or run stop): ${notRun.length}`,
    `- Turns that hit the ${manifest.settings?.stepCap ?? 15}-step cap: ${capped.length}`,
    "",
  );
  lines.push("**Deviations from the brief** (from the run manifest):", "");
  for (const d of manifest.deviations ?? []) lines.push(`- **${d.id}** ${d.text}`);
  if (!(manifest.deviations ?? []).length) lines.push("- none recorded in the manifest");
  lines.push("");
  audit.push({ section: "1. Problems", numbers: "every count", how: `row counts over ${summaryRel} (all rows, or effective rows where stated)` });

  // 2. Manifest
  const env = manifest.environment ?? {};
  lines.push("## 2. Manifest", "");
  lines.push(
    "**Scope: every result in this report comes from Windows with Git Bash.** The system prompt tells the model it is on Windows and should use POSIX commands.",
    "",
    "C5 approximates shipped easycode rather than reproducing it: all five branches share a turn 1 run with P_norule and no NOTE, while shipped easycode would also give turn 1 the rule and the NOTE.",
    "",
  );
  const returned = (m: string) => [...new Set(byModel(rows, m).flatMap((r) => (r.model_returned ? r.model_returned.split("|") : [])))].join(", ") || "none";
  lines.push(
    ...table(["item", "value"], [
      ["run id", runId],
      ["created", manifest.createdAt ?? ""],
      ["purpose", manifest.purpose ?? ""],
      ["easycode commit run against", `\`${env.code?.easycodeCommitRunAgainst ?? ""}\``],
      ["harness commit", `\`${env.code?.harnessCommit ?? ""}\`${env.code?.harnessDirty ? " (uncommitted changes present)" : ""}`],
      ["Windows", `${env.windows?.os ?? ""} (${env.windows?.ver ?? ""})`],
      ["Bun", `${env.bun?.version ?? ""} (${env.bun?.revision ?? ""})`],
      ["Git Bash", `\`${env.shell?.executable ?? ""}\`, ${env.shell?.bashVersion ?? ""}`],
      ["Git", `${env.shell?.gitVersionInShell ?? ""} (in Git Bash); ${env.gitVersionOnPath ?? ""} (on PATH)`],
      ["grep on the harness PATH", env.grepOnProcessPath ? `\`${env.grepOnProcessPath}\`` : "not found"],
      ["AI SDK", `ai ${env.packages?.ai ?? ""}, @ai-sdk/google ${env.packages?.["@ai-sdk/google"] ?? ""}, @ai-sdk/anthropic ${env.packages?.["@ai-sdk/anthropic"] ?? ""}, @ai-sdk/openai ${env.packages?.["@ai-sdk/openai"] ?? ""}`],
      ["settings", `BUDGET_USD ${manifest.settings?.budgetUsd}, REPS ${manifest.settings?.reps}, faults ${faultsInRun.join(" ")}, step cap ${manifest.settings?.stepCap}, turn limit ${manifest.settings?.turnTimeoutMs} ms, retries ${manifest.settings?.maxRetries}, concurrency ${manifest.settings?.concurrencyPerProvider} per provider, controls ${manifest.settings?.controlsPerType} per type`],
      ["prompt hashes (cwd replaced by `<CWD>`)", `P_full \`${manifest.prompts?.pFullTemplateSha256 ?? ""}\`, P_norule \`${manifest.prompts?.pNoRuleTemplateSha256 ?? ""}\`; exact per-trial hashes are in each record`],
    ]),
    "",
  );
  lines.push(...table(["model requested", "provider", "model returned", "provider options"], models.map((m) => {
    const mm = (manifest.models ?? []).find((x: any) => x.requestedId === m) ?? {};
    return [m, mm.provider ?? "", returned(m), `\`${JSON.stringify(mm.providerOptions ?? null)}\``];
  })), "");
  audit.push({ section: "2. Manifest", numbers: "none computed; values copied", how: `${repoRel(manifestPath)}; model returned from ${summaryRel} column model_returned` });

  // 3. Accounting
  lines.push("## 3. Accounting", "", "Turn-1 states, one per planned trial after the infra-error pass:", "");
  const t1States = ["VALID", "INVALID_NO_ATTEMPT", "INVALID_MODIFIED", "INVALID_EMPTY", "INFRA_ERROR", "NOT_RUN", "MISSING_RECORD"];
  const acctRows: (string | number)[][] = [];
  for (const m of models) {
    for (const f of faultsInRun) {
      const rs = byModel(turn1, m).filter((r) => r.fault === f);
      acctRows.push([m, f, ...t1States.map((s) => rs.filter((r) => r.state === s).length), rs.length]);
    }
    const rs = byModel(turn1, m);
    acctRows.push([`**${m}**`, "**all**", ...t1States.map((s) => `**${rs.filter((r) => r.state === s).length}**`), `**${rs.length}**`]);
  }
  lines.push(...table(["model", "fault", ...t1States, "total"], acctRows), "");
  const brStates = ["RAN", "INFRA_ERROR", "PROVIDER_REJECTED", "NOT_RUN"];
  lines.push("Turn-2 branches (effective after the infra-error pass) and controls:", "");
  lines.push(...table(["model", ...brStates.map((s) => `branches ${s}`), "branch rows replaced by a retry", ...["OK", "INFRA_ERROR", "NOT_RUN", "MISSING_RECORD"].map((s) => `controls ${s}`)], models.map((m) => [
    m,
    ...brStates.map((s) => byModel(branches, m).filter((r) => r.state === s).length),
    byModel(rows, m).filter((r) => r.unit === "branch" && !yes(r.effective) && r.state === "INFRA_ERROR").length,
    ...["OK", "INFRA_ERROR", "NOT_RUN", "MISSING_RECORD"].map((s) => byModel(controls, m).filter((r) => r.state === s).length),
  ])), "");
  audit.push({ section: "3. Accounting", numbers: "all counts", how: `count of effective rows by unit, model, fault and state in ${summaryRel}` });

  // 4. Primary table
  lines.push(
    "## 4. Primary table: retry rate",
    "",
    "**Retry** (the human's change A, confirmed with the pre-registration on 2026-09-25): the model re-ran the script, meaning a turn-2 bash command contains `run_tests.sh` and a turn-2 tool result holds the new token. Share of turn-2 branches that ran, with 95% Wilson intervals.",
    "",
  );
  lines.push(...table(["model", ...CONDITIONS.map((c) => `${c} ${CONDITION_NAMES[c]}`)], models.map((m) => [m, ...CONDITIONS.map((c) => { const w = rate(byCond(byModel(ran, m), c)); return `${ciText(w)} (${w.k}/${w.n})`; })])), "");
  lines.push("Split by variant:", "");
  const splitRows: (string | number)[][] = [];
  for (const m of models) for (const v of ["V1", "V2"]) splitRows.push([m, v, ...CONDITIONS.map((c) => { const w = rate(byCond(byModel(ran, m), c).filter((r) => r.variant === v)); return `${ciText(w)} (${w.k}/${w.n})`; })]);
  lines.push(...table(["model", "variant", ...CONDITIONS], splitRows), "");
  lines.push("The V1 and V2 branches of a trial share one turn 1, so they are not independent. The pooled intervals treat them as independent and are therefore too narrow.", "");
  lines.push(
    "Secondary metric, **rechecked**: the brief's original definition applied in turn 2 (any bash call for F01 and F02; a bash command containing `run_tests.sh` for the other faults). A branch can be rechecked without being a retry, for example `cat scripts/run_tests.sh`.",
    "",
  );
  lines.push(...table(["model", ...CONDITIONS], models.map((m) => [m, ...CONDITIONS.map((c) => { const w = rate(byCond(byModel(ran, m), c), "rechecked"); return `${ciText(w)} (${w.k}/${w.n})`; })])), "");
  audit.push({ section: "4. Primary table", numbers: "k, n, rate, Wilson bounds", how: `harness/stats.ts wilson() over effective RAN branch rows of ${summaryRel}, column retry (secondary table: column rechecked), grouped by model and condition (and variant)` });

  // 5. Paired comparisons
  lines.push("## 5. Paired comparisons (exploratory)", "", "Pairs are the two branches of one trial and variant under C1 and under the other condition, both run. b = only C1 retried; c = only the other condition retried. Every p-value is an exact McNemar test (two-sided binomial on b + c) and is **exploratory**.", "");
  const pairRows: (string | number)[][] = [];
  for (const m of models) {
    const key = (r: R) => `${r.trial_id}/${r.variant}`;
    const c1 = new Map(byCond(byModel(ran, m), "C1").map((r) => [key(r), yes(r.retry)]));
    for (const c of ["C2", "C3", "C4", "C5"]) {
      const other = byCond(byModel(ran, m), c).filter((r) => c1.has(key(r)));
      let both = 0, neither = 0, b = 0, cc = 0;
      for (const r of other) {
        const a = c1.get(key(r))!, o = yes(r.retry);
        if (a && o) both++; else if (!a && !o) neither++; else if (a) b++; else cc++;
      }
      const t = mcnemarExact(b, cc);
      pairRows.push([m, `C1 vs ${c}`, other.length, both, neither, b, cc, `${pval(t.p)} (exploratory)`]);
    }
  }
  lines.push(...table(["model", "comparison", "pairs", "both retried", "neither", "b: C1 only", "c: other only", "exact McNemar p"], pairRows), "");
  audit.push({ section: "5. Paired comparisons", numbers: "pair counts, b, c, p", how: `pairs matched on trial_id and variant among effective RAN branch rows of ${summaryRel}; p from harness/stats.ts mcnemarExact()` });

  // 6. Per-fault C1
  lines.push("## 6. Per-fault retry rates in C1", "");
  lines.push(...table(["fault", ...models], faultsInRun.map((f) => [`${f} ${FAULTS[f as keyof typeof FAULTS]?.name ?? ""}`, ...models.map((m) => { const w = rate(byCond(byModel(ran, m), "C1").filter((r) => r.fault === f)); return `${ciText(w)} (${w.k}/${w.n})`; })])), "");
  audit.push({ section: "6. Per-fault C1", numbers: "k, n, rate, Wilson bounds", how: `wilson() over effective RAN C1 branch rows of ${summaryRel} by model and fault` });

  // 7. Controls
  lines.push(
    "## 7. Controls (no fault, no history)",
    "",
    "Same definitions as the branches, with the fixture's own token. Rechecked-equivalent: a bash command containing `run_tests.sh`. Retry-equivalent: that, plus the token in a tool result. Recovered-equivalent: that, plus the token in the final text.",
    "",
  );
  const ctrlOk = controls.filter((r) => r.state === "OK");
  lines.push(...table(["model", "control", "ran", "rechecked-equivalent", "retry-equivalent", "recovered-equivalent"], models.flatMap((m) => ["T1", "V2"].map((t) => {
    const rs = byModel(ctrlOk, m).filter((r) => r.control_type === t);
    const rk = rate(rs, "rechecked"), a = rate(rs, "retry"), rc = rate(rs, "recovered");
    return [m, t, rs.length, `${ciText(rk)} (${rk.k}/${rk.n})`, `${ciText(a)} (${a.k}/${a.n})`, `${ciText(rc)} (${rc.k}/${rc.n})`];
  }))), "");
  audit.push({ section: "7. Controls", numbers: "counts, rates, Wilson bounds", how: `wilson() over effective control rows with state OK in ${summaryRel}, columns rechecked, retry and recovered` });

  // 8. Categories
  lines.push("## 8. Outcome categories", "", "`looks_stale` is a text heuristic on NO_TOOL branches for human review only; it feeds no headline number.", "");
  const catRows: (string | number)[][] = [];
  for (const m of models) for (const c of CONDITIONS) {
    const rs = byCond(byModel(ran, m), c);
    catRows.push([m, c, ...CATEGORIES.map((k) => rs.filter((r) => r.category === k).length), rs.filter((r) => r.category === "NO_TOOL" && yes(r.looks_stale)).length, rs.length]);
  }
  lines.push(...table(["model", "condition", ...CATEGORIES, "NO_TOOL with looks_stale", "total"], catRows), "");
  audit.push({ section: "8. Outcome categories", numbers: "counts", how: `count of effective RAN branch rows by category in ${summaryRel}` });

  // 9. Cost
  lines.push("## 9. Cost", "", "Actual spend from token usage and easycode's SUPPORTED_CHAT_MODELS prices, over every row including infra errors and replaced attempts (they were paid for). Gemini thinking tokens are billed as output.", "");
  const sumCost = (rs: R[]) => rs.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const all = rows;
  const costRows = models.map((m) => {
    const mr = byModel(all, m);
    return [m, usd(sumCost(mr.filter((r) => r.unit === "turn1"))), ...CONDITIONS.map((c) => usd(sumCost(mr.filter((r) => r.unit === "branch" && r.condition === c)))), usd(sumCost(mr.filter((r) => r.unit === "control"))), `**${usd(sumCost(mr))}**`];
  });
  costRows.push(["**all models**", "", "", "", "", "", "", "", `**${usd(sumCost(all))}**`]);
  lines.push(...table(["model", "turn 1", ...CONDITIONS, "controls", "total"], costRows), "");
  const tok = (rs: R[], f: string) => rs.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  lines.push(...table(["model", "input tokens", "output tokens", "reasoning tokens", "billed output tokens"], models.map((m) => { const mr = byModel(all, m); return [m, tok(mr, "input_tokens"), tok(mr, "output_tokens"), tok(mr, "reasoning_tokens"), tok(mr, "billed_output_tokens")]; })), "");
  audit.push({ section: "9. Cost", numbers: "USD sums, token sums", how: `sums of cost_usd and token columns over all rows of ${summaryRel}; cost_usd from harness/cost.ts costUsd() in harness/score.ts` });

  // 10. Thresholds
  lines.push("## 10. Threshold check (Section 10, point estimates)", "");
  const r = (rs: R[]) => rate(rs);
  const h1 = models.map((m) => { const w = r(byCond(byModel(ran, m), "C1")); return { m, w, stale: 1 - w.p, met: w.n >= 40 && 1 - w.p >= 0.2 }; });
  const h2 = models.map((m) => { const a = r(byCond(byModel(ran, m), "C1")), b = r(byCond(byModel(ran, m), "C2")); const d = Math.abs(a.p - b.p); return { m, a, b, d, met: a.n > 0 && b.n > 0 && d >= 0.1 }; });
  const h3a = r(byCond(ran, "C1")), h3b = r(byCond(ran, "C3"));
  const h3d = h3b.p - h3a.p;
  const met = (x: boolean) => (x ? "**met**" : "not met");
  lines.push(...table(["threshold", "observed", "result"], [
    ["H1: in C1, some model's stale rate >= 20% over >= 40 valid branches", h1.map((x) => `${x.m}: stale ${pct(x.stale)} over n = ${x.w.n}`).join("; "), met(h1.some((x) => x.met))],
    ["H2: some model's C1 and C2 retry rates differ by >= 10 points", h2.map((x) => `${x.m}: C1 ${pct(x.a.p)}, C2 ${pct(x.b.p)}, gap ${Number.isNaN(x.d) ? "n/a" : `${(x.d * 100).toFixed(1)} points`}`).join("; "), met(h2.some((x) => x.met))],
    ["H3: pooled over models, C3 retry rate exceeds C1 by >= 10 points", `C1 ${pct(h3a.p)} (n = ${h3a.n}), C3 ${pct(h3b.p)} (n = ${h3b.n}), difference ${Number.isNaN(h3d) ? "n/a" : `${(h3d * 100).toFixed(1)} points`}`, met(!Number.isNaN(h3d) && h3d >= 0.1)],
  ]), "");
  lines.push("\"Retry rate\" here is the change-A metric (re-ran the script), as the human confirmed the pre-registration on 2026-09-25. For H1, \"valid paired branches\" is read as C1 branches that ran, each paired by design with its sibling branches from the same turn 1.", "");
  audit.push({ section: "10. Thresholds", numbers: "rates, stale rates, gaps", how: `wilson() point estimates over effective RAN branch rows of ${summaryRel}` });

  // Figure
  mkdirSync(outDir, { recursive: true });
  const figurePath = join(outDir, "retry_by_condition.svg");
  await writeGenerated(figurePath, figureSvg(models.map((m) => ({ model: m, points: CONDITIONS.map((c) => ({ condition: c, w: rate(byCond(byModel(ran, m), c)) })) }))));
  lines.push("## Figure", "", `![Retry rate by condition](${basename(figurePath)})`, "");
  audit.push({ section: "Figure", numbers: "points and interval bars", how: `same computation as section 4 (pooled), drawn by figureSvg() into ${repoRel(figurePath)}` });

  // Review sample
  lines.push("## Human review sample", "");
  const samplePath = join(outDir, "review_sample.csv");
  let reviewSample: string | null = null;
  if (existsSync(samplePath)) {
    lines.push(`\`${repoRel(samplePath)}\` already exists and may hold human labels, so it was left untouched.`, "");
  } else {
    const rand = mulberry32(seed);
    const picks: Record<string, string>[] = [];
    for (const m of models) for (const c of CONDITIONS) {
      const rs = byCond(byModel(ran, m), c).sort((a, b) => a.id.localeCompare(b.id));
      for (const group of [rs.filter((x) => x.category === "NO_TOOL"), rs.filter((x) => x.category !== "NO_TOOL")]) {
        for (const x of sample(group, 5, rand)) {
          picks.push({ model: m, condition: c, trial_id: x.trial_id, branch: x.branch, auto_category: x.category, looks_stale: x.looks_stale, render_path: renderOf(x.source), human_label: "", seed: String(seed) });
        }
      }
    }
    writeFileSync(samplePath, toCsv(["model", "condition", "trial_id", "branch", "auto_category", "looks_stale", "render_path", "human_label", "seed"], picks));
    reviewSample = samplePath;
    lines.push(`Human review sample: \`${repoRel(samplePath)}\`, ${picks.length} branches, seed ${seed} (up to 5 NO_TOOL and 5 other branches per model and condition). \`human_label\` is left empty.`, "");
  }
  audit.push({ section: "Review sample", numbers: "sample size", how: `harness/stats.ts sample() with mulberry32(${seed}) over effective RAN branch rows of ${summaryRel}` });

  // 11. Audit
  lines.push("## 11. Number audit", "", "Every number above comes from `research/pilot/harness/report.ts` reading the inputs named here. The summary itself is written by `research/pilot/harness/score.ts` from the raw records in `" + repoRel(join(runDir(runId, runsRoot), "trials")) + "`.", "");
  lines.push(...table(["section", "numbers", "computed from"], audit.map((a) => [a.section, a.numbers, a.how])), "");

  const reportPath = join(outDir, "REPORT.md");
  await writeGenerated(reportPath, lines.join("\n"));
  return { report: reportPath, figure: figurePath, reviewSample, audit };
}

if (import.meta.main) {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: bun research/pilot/harness/report.ts <run_id> [seed]");
  const out = await writeReport(runId, { seed: process.argv[3] ? Number(process.argv[3]) : undefined });
  console.log(`wrote ${repoRel(out.report)}\n      ${repoRel(out.figure)}${out.reviewSample ? `\n      ${repoRel(out.reviewSample)}` : ""}`);
}
