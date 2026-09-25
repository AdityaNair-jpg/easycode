// easycode's real tools, wrapped so every call and result is logged with
// timestamps. Arguments and results pass through unchanged; the one exception
// is fault F01, where bash returns BASH_UNAVAILABLE_ERROR (brief, Section 4.5).
import { createTools } from "./easycode.ts";
import { BASH_UNAVAILABLE_ERROR } from "./faults.ts";
import { assertShellScrubbed } from "./secrets.ts";

export type ToolEvent = {
  seq: number;
  toolName: string;
  toolCallId: string;
  input: unknown;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  output?: unknown;
  thrown?: string;
  // True when the output came from the F01 stand-in, not the real tool
  simulated: boolean;
};

export type ToolSet = ReturnType<typeof createTools>;

export function instrumentedTools(
  cwd: string,
  opts: { disableBash: boolean },
  events: ToolEvent[],
): ToolSet {
  assertShellScrubbed();
  const tools = createTools(cwd, "BUILD") as Record<string, any>;
  const wrapped: Record<string, any> = {};

  for (const [name, original] of Object.entries(tools)) {
    const simulated = name === "bash" && opts.disableBash;
    const execute = simulated
      ? async () => ({ error: BASH_UNAVAILABLE_ERROR })
      : original.execute.bind(original);

    wrapped[name] = {
      ...original,
      execute: async (input: unknown, options: { toolCallId: string }) => {
        const started = Date.now();
        const event: ToolEvent = {
          seq: events.length,
          toolName: name,
          toolCallId: options?.toolCallId ?? "",
          input,
          startedAt: new Date(started).toISOString(),
          simulated,
        };
        events.push(event);
        try {
          const output = await execute(input, options);
          event.output = output;
          return output;
        } catch (err) {
          event.thrown = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          throw err;
        } finally {
          event.endedAt = new Date().toISOString();
          event.durationMs = Date.now() - started;
        }
      },
    };
  }
  return wrapped as ToolSet;
}

// Calls a tool the way the AI SDK does: input parsed through its schema (so
// defaults apply), then execute. Used by the smoke test and fault validation.
export async function callTool(tools: ToolSet, name: string, input: unknown, toolCallId = "harness"): Promise<any> {
  const t = (tools as Record<string, any>)[name];
  if (!t) throw new Error(`No tool named ${name}`);
  const parsed = t.inputSchema.parse(input);
  return t.execute(parsed, { toolCallId, messages: [] });
}
