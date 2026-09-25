// The copies in harness/copied.ts must match chat.ts at the pinned commit
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { EASYCODE_SOURCES } from "../harness/easycode.ts";
import { buildConversationHistory, easycodeContent } from "../harness/copied.ts";
import { contentFromSteps } from "../harness/history.ts";
import { generateResult, streamResult, type FakeContent } from "../harness/fake-model.ts";
import { PILOT_DIR } from "../harness/paths.ts";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const chat = lf(readFileSync(EASYCODE_SOURCES.chat, "utf8")).split("\n");
const copied = lf(readFileSync(join(PILOT_DIR, "harness", "copied.ts"), "utf8")).split("\n");

function block(beginMarker: string): string[] {
  const start = copied.findIndex((l) => l.startsWith(`// BEGIN COPY packages/server/src/routes/chat.ts:${beginMarker}`));
  const end = copied.findIndex((l, i) => i > start && l.startsWith("// END COPY"));
  expect(start).toBeGreaterThan(-1);
  return copied.slice(start + 1, end);
}

describe("verbatim copies from chat.ts", () => {
  test("buildConversationHistory equals chat.ts lines 35-49 exactly", () => {
    expect(block("35-49")).toEqual(chat.slice(34, 49));
    expect(chat[35]).toBe("function buildConversationHistory(");
  });

  test("every kept line of the content builder appears in chat.ts 143-227, in order", () => {
    const kept = block("143-227").filter((l) => !l.startsWith("//") && !l.includes("// harness") && l.trim() !== "");
    const source = chat.slice(142, 227);
    let at = 0;
    for (const line of kept) {
      const found = source.indexOf(line, at);
      expect([line, found >= 0]).toEqual([line, true]);
      at = found + 1;
    }
    expect(kept.length).toBeGreaterThan(25);
  });

  test("the NOTE template equals chat.ts line 87", () => {
    const template = /`\[Environment check, run just now: the bash tool works \(\$\{check\.name\}\)[^`]*`/;
    const fromChat = chat[86]!.match(template)?.[0];
    const fromCopy = copied.join("\n").match(template)?.[0];
    expect(fromChat).toBeDefined();
    expect(fromCopy).toBe(fromChat!);
  });
});

describe("buildConversationHistory behaviour", () => {
  test("drops ERROR messages and empty assistant messages, keeps text only", () => {
    const s = "COMPLETE" as any;
    expect(
      buildConversationHistory([
        { role: "USER", content: "a", status: s },
        { role: "ASSISTANT", content: "", status: s },
        { role: "ERROR", content: "boom", status: s },
        { role: "ASSISTANT", content: "b", status: s },
        { role: "USER", content: "c", status: s },
      ]),
    ).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
  });
});

describe("A1_text equals easycode's content", () => {
  // Two steps: text split across parts, reasoning between texts, a tool call
  const step1: FakeContent[] = [
    { type: "reasoning", text: "thinking" },
    { type: "text", text: "Let me " },
    { type: "text", text: "run it." },
    { type: "tool-call", toolCallId: "c1", toolName: "echo", input: JSON.stringify({ x: 1 }) },
  ];
  const step2: FakeContent[] = [
    { type: "text", text: "Done: " },
    { type: "reasoning", text: "more thinking" },
    { type: "text", text: "ok." },
  ];
  const tools = {
    echo: tool({ description: "echo", inputSchema: z.object({ x: z.number() }), execute: async ({ x }) => ({ x }) }),
  };

  test("generateText steps joined with \"\" equal the streamed content chat.ts builds", async () => {
    let g = 0;
    const genModel = new MockLanguageModelV3({ doGenerate: async () => generateResult([step1, step2][g++]!) as any });
    let s = 0;
    const streamModel = new MockLanguageModelV3({ doStream: async () => streamResult([step1, step2][s++]!) as any });

    const generated = await generateText({ model: genModel, prompt: "hi", tools, stopWhen: stepCountIs(15) });
    const streamed = streamText({ model: streamModel, prompt: "hi", tools, stopWhen: stepCountIs(15) });

    const fromStream = await easycodeContent(streamed);
    expect(fromStream).toBe("Let me run it.Done: ok.");
    expect(contentFromSteps(generated.steps)).toBe(fromStream);
    // result.text is the last step only, which is why A1_text can't use it
    expect(generated.text).toBe("Done: ok.");
  });
});
