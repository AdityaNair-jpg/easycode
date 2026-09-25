// Scripted stand-ins for a real model, built on the AI SDK's own mock
// (ai/test). Used by tests and by the Milestone 1 fake trial; never by a
// real run.
import { MockLanguageModelV3 } from "ai/test";

export type FakeContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

export const FAKE_USAGE = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 40, reasoning: 10 },
};

export function generateResult(content: FakeContent[], modelId = "fake-model-returned") {
  const toolCalls = content.some((c) => c.type === "tool-call");
  return {
    content,
    finishReason: { unified: toolCalls ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
    usage: FAKE_USAGE,
    warnings: [],
    request: { body: { fake: true } },
    response: { id: "fake-response", modelId, timestamp: new Date(0) },
  };
}

// The same content as a v3 stream, one delta per text or reasoning part
export function streamResult(content: FakeContent[]) {
  const chunks: any[] = [{ type: "stream-start", warnings: [] }];
  content.forEach((c, i) => {
    const id = `p${i}`;
    if (c.type === "text") chunks.push({ type: "text-start", id }, { type: "text-delta", id, delta: c.text }, { type: "text-end", id });
    if (c.type === "reasoning")
      chunks.push({ type: "reasoning-start", id }, { type: "reasoning-delta", id, delta: c.text }, { type: "reasoning-end", id });
    if (c.type === "tool-call") chunks.push(c);
  });
  const toolCalls = content.some((c) => c.type === "tool-call");
  chunks.push({
    type: "finish",
    finishReason: { unified: toolCalls ? "tool-calls" : "stop", raw: undefined },
    usage: FAKE_USAGE,
  });
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    }),
  };
}

// A model that answers each step from the prompt it's given
export function scriptedModel(decide: (prompt: any[]) => FakeContent[], modelId = "fake-model"): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId,
    doGenerate: async (options: any) => generateResult(decide(options.prompt)) as any,
  });
}

function lastUserText(prompt: any[]): string {
  const user = [...prompt].reverse().find((m) => m.role === "user");
  return (user?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
}

function lastToolOutput(prompt: any[]): any {
  const last = prompt[prompt.length - 1];
  const part = last?.content?.find((p: any) => p.type === "tool-result");
  const out = part?.output;
  return out?.type === "json" ? out.value : out?.value;
}

// A well-behaved agent: on a new user message it runs the test command once
// (with --verbose when asked), then quotes the last line of what it got
export function obedientAgent(): MockLanguageModelV3 {
  let calls = 0;
  return scriptedModel((prompt) => {
    const last = prompt[prompt.length - 1];
    if (last.role === "user") {
      calls += 1;
      const verbose = lastUserText(prompt).includes("--verbose");
      return [
        { type: "text", text: "Running the tests. " },
        {
          type: "tool-call",
          toolCallId: `call-${calls}`,
          toolName: "bash",
          input: JSON.stringify({ command: `bash scripts/run_tests.sh${verbose ? " --verbose" : ""}` }),
        },
      ];
    }
    const out = lastToolOutput(prompt) ?? {};
    const text = String(out.error ?? (out.stdout || out.stderr || "")).trimEnd();
    const lastLine = text.split(/\r?\n/).at(-1) ?? "";
    return [{ type: "text", text: `The last line of output was: \`${lastLine}\`` }];
  });
}
