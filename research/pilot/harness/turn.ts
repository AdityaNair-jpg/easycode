// One model turn: generateText with easycode's real tools, system prompt and
// provider options (brief, Section 4.5), recorded in full.
import { APICallError, RetryError, generateText, stepCountIs, type ModelMessage } from "ai";
import { costUsd, billedTokens, type Budget } from "./cost.ts";
import { findSupportedChatModel, resolveChatModel } from "./easycode.ts";
import { fingerprint, type Fingerprint } from "./fingerprint.ts";
import { InfraError } from "./fsutil.ts";
import { contentFromSteps, sha256 } from "./history.ts";
import { redact } from "./secrets.ts";
import { instrumentedTools, pendingBash, type ToolEvent } from "./tools.ts";

export const STEP_CAP = 15;
export const TURN_TIMEOUT_MS = 5 * 60_000;
export const MAX_RETRIES = 5;

export type ModelHandle = {
  requestedId: string;
  provider: string;
  model: any;
  providerOptions?: Record<string, any>;
};

export function realModel(modelId: string): ModelHandle {
  if (!findSupportedChatModel(modelId)) throw new Error(`${modelId} is not in SUPPORTED_CHAT_MODELS`);
  const r = resolveChatModel(modelId);
  return { requestedId: modelId, provider: r.provider, model: r.model, providerOptions: r.providerOptions };
}

// JSON-safe copy: Errors become {name, message}, undefined fields drop out.
// Everything a record stores goes through this, so a record holds exactly
// what can be read back.
export function jsonSafe<T>(value: T): any {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) return { name: v.name, message: redact(v.message) };
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) return { uint8ArrayBase64: Buffer.from(v).toString("base64") };
      return v;
    }),
  );
}

export type AttemptRecord = { startedAt: string; durationMs: number; ok: boolean; error?: ErrorSummary };
export type ErrorSummary = {
  name: string;
  message: string;
  statusCode?: number;
  isRetryable?: boolean;
  responseBody?: string;
  url?: string;
};

function summarizeError(err: unknown): ErrorSummary {
  if (APICallError.isInstance(err)) {
    return {
      name: err.name,
      message: redact(err.message),
      statusCode: err.statusCode,
      isRetryable: err.isRetryable,
      responseBody: err.responseBody ? redact(err.responseBody).slice(0, 8000) : undefined,
      url: err.url ? redact(err.url) : undefined,
    };
  }
  if (err instanceof Error) return { name: err.name, message: redact(err.message) };
  return { name: "Unknown", message: redact(String(err)) };
}

// Logs each call the SDK makes to the model, including its own retries.
// A Proxy keeps the model's specificationVersion, so a v2 provider still
// goes through the SDK's v2 adapter.
function withAttemptLog(model: any, attempts: AttemptRecord[]): any {
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "doGenerate") {
        return async (options: unknown) => {
          const started = Date.now();
          try {
            const result = await target.doGenerate(options);
            attempts.push({ startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: true });
            return result;
          } catch (err) {
            attempts.push({ startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: false, error: summarizeError(err) });
            throw err;
          }
        };
      }
      return Reflect.get(target, prop);
    },
  });
}

// A 4xx the SDK won't retry means the provider refused the request itself
// (bad model id, bad replayed trace, missing key). The run stops on these.
function isProviderRejection(err: unknown): APICallError | null {
  const inner = RetryError.isInstance(err) ? err.lastError : err;
  if (APICallError.isInstance(inner) && !inner.isRetryable && inner.statusCode && inner.statusCode >= 400 && inner.statusCode < 500) {
    return inner;
  }
  return null;
}

export type KilledProcess = {
  pid: number;
  name: string;
  commandLine: string;
  why: "command line holds the trial path" | "harness child running this trial's pending command";
  killed: boolean;
  output: string;
};

type ProcRow = { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null };

// Quotes and backslashes differ between a command and the command line
// Windows shows for `bash.exe -c <command>`, so compare without them
const squash = (s: string) => s.replace(/["'\\]/g, "").replace(/\s+/g, " ").trim();

// After a timeout, kill leftovers with taskkill /T /F (brief, Section 4.7):
//   1. any process whose command line holds the trial path (the brief's rule)
//   2. a bash.exe started by this harness whose command line holds one of
//      this trial's still-running bash commands, when no other trial is
//      running the same command. A hung `sleep 600` never names the trial
//      path, so rule 1 alone would miss it.
export function killLeftovers(trialDir: string, cwd: string): KilledProcess[] {
  if (process.platform !== "win32") return [];
  const list = Bun.spawnSync(
    [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const rows = [JSON.parse(list.stdout.toString() || "[]")].flat() as ProcRow[];

  const children = new Map<number, number[]>();
  for (const r of rows) children.set(r.ParentProcessId, [...(children.get(r.ParentProcessId) ?? []), r.ProcessId]);
  const descendants = new Set<number>();
  const stack = [process.pid];
  while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!descendants.has(c)) descendants.add(c), stack.push(c);

  const needles = [trialDir, trialDir.replace(/\\/g, "/"), trialDir.replace(/^([A-Za-z]):\\/, (_m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, "/")];
  const mine = [...pendingBash.values()].filter((p) => p.cwd === cwd).map((p) => squash(p.command)).filter(Boolean);
  const others = new Set([...pendingBash.values()].filter((p) => p.cwd !== cwd).map((p) => squash(p.command)));
  const ownCommands = mine.filter((c) => !others.has(c));

  const targets: { row: ProcRow; why: KilledProcess["why"] }[] = [];
  for (const r of rows) {
    const cmd = r.CommandLine ?? "";
    if (r.ProcessId === process.pid || !cmd || /Get-CimInstance Win32_Process/.test(cmd)) continue;
    if (needles.some((n) => cmd.includes(n))) targets.push({ row: r, why: "command line holds the trial path" });
    else if (descendants.has(r.ProcessId) && /bash\.exe/i.test(r.Name) && ownCommands.some((c) => squash(cmd).includes(c))) {
      targets.push({ row: r, why: "harness child running this trial's pending command" });
    }
  }
  return targets.map(({ row, why }) => {
    const kill = Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(row.ProcessId)], { stdout: "pipe", stderr: "pipe" });
    return {
      pid: row.ProcessId,
      name: row.Name,
      commandLine: redact(row.CommandLine ?? ""),
      why,
      killed: kill.exitCode === 0,
      output: (kill.stdout.toString() + kill.stderr.toString()).trim(),
    };
  });
}

export type TurnOutcome = "OK" | "INFRA_ERROR" | "PROVIDER_REJECTED" | "NOT_RUN";

export type TurnRecord = {
  label: string;
  outcome: TurnOutcome;
  error?: { reason: string; summary: ErrorSummary };
  system: string;
  systemSha256: string;
  messages: ModelMessage[];
  toolNames: string[];
  disableBash: boolean;
  modelRequested: string;
  provider: string;
  providerOptions?: Record<string, any>;
  settings: { stepCap: number; timeoutMs: number; maxRetries: number };
  startedAt: string;
  endedAt: string;
  wallMs: number;
  fingerprintBefore: Fingerprint;
  fingerprintAfter: Fingerprint;
  steps: any[];
  toolEvents: ToolEvent[];
  attempts: AttemptRecord[];
  responseMessages: ModelMessage[];
  finalText: string;
  lastStepText: string;
  finishReason: string | null;
  hitStepCap: boolean;
  modelReturned: string[];
  usage: any;
  billed: ReturnType<typeof billedTokens>;
  costUsd: number;
  killed?: KilledProcess[];
};

export type TurnInput = {
  label: string;
  cwd: string;
  system: string;
  messages: ModelMessage[];
  disableBash: boolean;
  model: ModelHandle;
  budget: Budget;
  // For finding leftover processes after a timeout
  trialDir: string;
  // Price the turn as this model (fake models in tests borrow a real price)
  pricingModelId?: string;
  timeoutMs?: number;
};

// Runs one turn. Never throws for model or tool trouble: the outcome and
// error are recorded. BudgetExceeded is thrown before any call is made.
export async function runTurn(input: TurnInput): Promise<TurnRecord> {
  const timeoutMs = input.timeoutMs ?? TURN_TIMEOUT_MS;
  const pricingId = input.pricingModelId ?? input.model.requestedId;
  const reservation = input.budget.reserve(pricingId);

  const toolEvents: ToolEvent[] = [];
  const attempts: AttemptRecord[] = [];
  const tools = instrumentedTools(input.cwd, { disableBash: input.disableBash }, toolEvents);
  const messages = jsonSafe(input.messages) as ModelMessage[];
  const started = Date.now();
  const fingerprintBefore = fingerprint(input.cwd);

  const base = {
    label: input.label,
    system: input.system,
    systemSha256: sha256(input.system),
    messages,
    toolNames: Object.keys(tools),
    disableBash: input.disableBash,
    modelRequested: input.model.requestedId,
    provider: input.model.provider,
    providerOptions: input.model.providerOptions,
    settings: { stepCap: STEP_CAP, timeoutMs, maxRetries: MAX_RETRIES },
    startedAt: new Date(started).toISOString(),
    fingerprintBefore,
    toolEvents,
    attempts,
  };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InfraError("TURN_TIMEOUT", `turn passed ${timeoutMs} ms`)), timeoutMs);
  });

  let result: Awaited<ReturnType<typeof generateText>> | undefined;
  let error: TurnRecord["error"];
  let outcome: TurnOutcome = "OK";
  let killed: KilledProcess[] | undefined;

  try {
    result = await Promise.race([
      generateText({
        model: withAttemptLog(input.model.model, attempts),
        system: input.system,
        messages,
        tools,
        stopWhen: stepCountIs(STEP_CAP),
        providerOptions: input.model.providerOptions,
        maxRetries: MAX_RETRIES,
        abortSignal: controller.signal,
      }),
      timeout,
    ]);
  } catch (err) {
    if (err instanceof InfraError && err.reason === "TURN_TIMEOUT") {
      controller.abort();
      killed = killLeftovers(input.trialDir, input.cwd);
      outcome = "INFRA_ERROR";
      error = { reason: "TURN_TIMEOUT", summary: summarizeError(err) };
    } else if (isProviderRejection(err)) {
      outcome = "PROVIDER_REJECTED";
      error = { reason: "PROVIDER_REJECTED", summary: summarizeError(isProviderRejection(err)) };
    } else {
      outcome = "INFRA_ERROR";
      const inner = RetryError.isInstance(err) ? err.lastError : err;
      error = { reason: APICallError.isInstance(inner) || RetryError.isInstance(err) ? "API_ERROR" : "HARNESS_CRASH", summary: summarizeError(err) };
    }
  } finally {
    clearTimeout(timer);
  }

  const steps = result ? jsonSafe(result.steps.map((s, i) => stepRecord(s, i))) : [];
  const usage = result ? jsonSafe(result.totalUsage) : undefined;
  const cost = result ? costUsd(pricingId, input.model.provider, result.totalUsage) : 0;
  input.budget.settle(reservation, cost);

  const lastStep = result?.steps.at(-1);
  return {
    ...base,
    outcome,
    error,
    endedAt: new Date().toISOString(),
    wallMs: Date.now() - started,
    fingerprintAfter: fingerprint(input.cwd),
    steps,
    toolEvents: jsonSafe(toolEvents),
    attempts,
    responseMessages: result ? jsonSafe(result.response.messages) : [],
    finalText: result ? contentFromSteps(result.steps as any) : "",
    lastStepText: result?.text ?? "",
    finishReason: result?.finishReason ?? null,
    hitStepCap: Boolean(result && result.steps.length >= STEP_CAP && lastStep?.finishReason === "tool-calls"),
    modelReturned: result ? [...new Set(result.steps.map((s) => s.response.modelId))] : [],
    usage,
    billed: billedTokens(input.model.provider, result?.totalUsage),
    costUsd: cost,
    killed,
  };
}

// The request body repeats the whole conversation on every step, so only the
// first step's is stored in full; later steps keep its hash and length. The
// settings in it are the same for every step of a turn.
function stepRecord(s: any, index: number) {
  const body = s.request?.body;
  const bodyText = typeof body === "string" ? body : JSON.stringify(body ?? null);
  return {
    content: s.content,
    finishReason: s.finishReason,
    rawFinishReason: s.rawFinishReason,
    usage: s.usage,
    warnings: s.warnings,
    request:
      index === 0
        ? { body: redact(bodyText), bodySha256: sha256(bodyText), bodyLength: bodyText.length }
        : { bodySha256: sha256(bodyText), bodyLength: bodyText.length },
    response: { id: s.response?.id, modelId: s.response?.modelId, timestamp: s.response?.timestamp },
    providerMetadata: s.providerMetadata,
  };
}
