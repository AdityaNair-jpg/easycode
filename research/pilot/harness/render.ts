// Turns a raw trial or control record into readable Markdown for human review
// (brief, Section 6). Usage, from the repo root:
//   bun research/pilot/harness/render.ts <run_id>      renders every record
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { turn2Metrics, turn1Validity } from "./classify.ts";
import { CONDITION_NAMES, type Condition } from "./history.ts";
import { FAULTS } from "./faults.ts";
import { RESULTS_DIR, RUNS_DIR, repoRel } from "./paths.ts";
import { listRecordFiles, readRecord } from "./store.ts";

const MAX_OUTPUT = 4000;

function fence(text: string, lang = ""): string {
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n... (${text.length - MAX_OUTPUT} more chars in the raw record)` : text;
}

function promptName(system: string, prompts: any): string {
  if (system === prompts.pFull) return "P_full";
  if (system === prompts.pNoRule) return "P_norule";
  return "OTHER (not P_full or P_norule)";
}

function messageText(m: any): string {
  if (typeof m.content === "string") return m.content;
  return (m.content ?? [])
    .map((p: any) => {
      if (p.type === "text") return p.text;
      if (p.type === "reasoning") return `[reasoning] ${p.text}`;
      if (p.type === "tool-call") return `[tool call ${p.toolName}] ${JSON.stringify(p.input)}`;
      if (p.type === "tool-result") return `[tool result ${p.toolName}] ${clip(JSON.stringify(p.output))}`;
      return `[${p.type}]`;
    })
    .join("\n");
}

function renderTurn(turn: any, prompts: any, heading: string): string[] {
  const out = [heading, ""];
  if (!turn || turn.outcome === "NOT_RUN") return [...out, `Not run: ${turn?.error?.reason ?? "no turn"}`, ""];
  out.push(
    `- System prompt: ${promptName(turn.system, prompts)} (sha256 \`${turn.systemSha256.slice(0, 12)}\`)`,
    `- Outcome: ${turn.outcome}${turn.error ? ` (${turn.error.reason}: ${turn.error.summary?.message ?? ""})` : ""}`,
    `- Model returned: ${turn.modelReturned?.join(", ") || "none"}; finish: ${turn.finishReason ?? "none"}; steps: ${turn.steps.length}${turn.hitStepCap ? " (HIT STEP CAP)" : ""}`,
    `- Tokens: input ${turn.billed?.inputTokens ?? 0}, output ${turn.billed?.outputTokens ?? 0}, reasoning ${turn.billed?.reasoningTokens ?? 0}; wall ${turn.wallMs} ms`,
    "",
    "**Messages sent**",
    "",
  );
  for (const m of turn.messages) out.push(`*${m.role}:*`, "", fence(messageText(m)), "");
  turn.steps.forEach((s: any, i: number) => {
    out.push(`**Step ${i + 1}** (finish: ${typeof s.finishReason === "string" ? s.finishReason : JSON.stringify(s.finishReason)})`, "");
    for (const p of s.content) {
      if (p.type === "reasoning") out.push("<details><summary>reasoning</summary>", "", fence(p.text), "", "</details>", "");
      else if (p.type === "text") out.push("Text:", "", fence(p.text), "");
      else if (p.type === "tool-call") out.push(`Tool call \`${p.toolName}\`${p.invalid ? " (INVALID)" : ""}:`, "", fence(JSON.stringify(p.input, null, 2), "json"), "");
      else if (p.type === "tool-result") out.push(`Result of \`${p.toolName}\`:`, "", fence(clip(JSON.stringify(p.output, null, 2)), "json"), "");
      else if (p.type === "tool-error") out.push(`Tool error from \`${p.toolName}\`:`, "", fence(clip(JSON.stringify(p.error, null, 2)), "json"), "");
    }
  });
  out.push("**Final text** (all text parts joined, as easycode stores `content`):", "", fence(turn.finalText || "(empty)"), "");
  return out;
}

export function renderTrial(rec: any): string {
  const fault = FAULTS[rec.fault as keyof typeof FAULTS];
  const v = rec.turn1 ? turn1Validity(rec.fault, rec.turn1) : rec.runtimeValidity;
  const out = [
    `# Trial ${rec.trialId}: ${rec.modelRequested}, ${rec.fault} ${fault?.name ?? ""}, rep ${rec.rep}`,
    "",
    `- Run: \`${rec.runId}\`${rec.pass ? `, pass ${rec.pass}` : ""}${rec.retryOf ? `, retry of ${rec.retryOf}` : ""}`,
    `- cwd: \`${rec.cwd}\``,
    `- Turn-1 state (scorer): **${v.state}**${v.reason ? ` (${v.reason})` : ""}`,
    `- Turn-1 token: \`${rec.token0}\``,
    `- Versions: easycode \`${rec.versions.easycodeCommit}\`, harness \`${rec.versions.harnessCommit}\`${rec.versions.harnessDirty ? " (dirty)" : ""}`,
    ...(rec.error ? [`- Harness error: ${rec.error}`] : []),
    "",
    ...renderTurn(rec.turn1, rec.prompts, "## Turn 1"),
  ];
  for (const b of rec.branches) {
    const m = b.state === "RAN" ? turn2Metrics(rec.fault, b.turn, b.fix.token) : null;
    out.push(
      `## Branch ${b.id} (${CONDITION_NAMES[b.condition as Condition]})`,
      "",
      `- State: ${b.state}${b.reason ? ` (${b.reason})` : ""}${b.error ? `: ${b.error}` : ""}`,
      ...(b.fix ? [`- Fix applied, new token \`${b.fix.token}\``] : []),
      ...(m
        ? [`- Scorer: retry ${m.retry}, rechecked ${m.rechecked}, recovered ${m.recovered}, category **${m.category}**${m.looksStale ? ", looks_stale" : ""}${m.flags.dotdot ? ", FLAG `..`" : ""}${m.flags.stash ? ", FLAG `_stash`" : ""}`]
        : []),
      "",
      ...renderTurn(b.turn, rec.prompts, "### Turn 2").slice(1),
    );
  }
  return out.join("\n");
}

export function renderControl(rec: any): string {
  return [
    `# Control ${rec.controlId}: ${rec.modelRequested}, ${rec.controlType}`,
    "",
    `- Run: \`${rec.runId}\``,
    `- Token: \`${rec.token0}\``,
    ...(rec.error ? [`- Harness error: ${rec.error}`] : []),
    "",
    ...renderTurn(rec.turn, rec.prompts, "## Turn"),
  ].join("\n");
}

export function renderBranchRetry(rec: any): string {
  return [`# Infra-error pass ${rec.pass} for ${rec.trialId}`, "", "```json", JSON.stringify(rec.precondition, null, 2), "```", "",
    ...rec.branches.flatMap((b: any) => [`## ${b.id}: ${b.state}${b.reason ? ` (${b.reason})` : ""}`, ""])].join("\n");
}

// Renders every record of a run; returns record file -> render path
export function renderRun(runId: string, runsRoot = RUNS_DIR, resultsRoot = RESULTS_DIR): Map<string, string> {
  const dir = join(resultsRoot, runId, "renders");
  mkdirSync(dir, { recursive: true });
  const paths = new Map<string, string>();
  for (const file of listRecordFiles(runId, runsRoot)) {
    const rec = readRecord(file);
    const md = rec.kind === "trial" ? renderTrial(rec) : rec.kind === "control" ? renderControl(rec) : renderBranchRetry(rec);
    const path = join(dir, basename(file).replace(/\.json\.gz$/, ".md"));
    writeFileSync(path, md);
    paths.set(repoRel(file), path);
  }
  return paths;
}

if (import.meta.main) {
  const runId = process.argv[2];
  if (!runId) throw new Error("Usage: bun research/pilot/harness/render.ts <run_id>");
  const paths = renderRun(runId);
  console.log(`rendered ${paths.size} records into ${repoRel(join(RESULTS_DIR, runId, "renders"))}`);
}
