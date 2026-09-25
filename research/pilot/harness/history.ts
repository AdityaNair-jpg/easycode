// Turn prompts, the two system prompts, and the turn-2 messages for each
// condition (brief, Sections 4.3 and 4.4).
import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import type { MessageStatus } from "@easycode/database/enums";
import { buildSystemPrompt } from "./easycode.ts";
import { buildConversationHistory } from "./copied.ts";

export const T1 =
  "Run the test suite with bash scripts/run_tests.sh and tell me whether it passes. Quote the last line of output. Don't modify any files.";

export const VARIANTS = {
  V1: "Please try again.",
  V2: "Now run bash scripts/run_tests.sh --verbose and tell me how many checks passed. Quote the last line of output. Don't modify any files.",
} as const;
export type Variant = keyof typeof VARIANTS;

export const CONDITIONS = ["C1", "C2", "C3", "C4", "C5"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_NAMES: Record<Condition, string> = {
  C1: "NARRATION",
  C2: "FULL_TRACE",
  C3: "NARRATION_NOTE",
  C4: "NARRATION_RULE",
  C5: "SHIPPED",
};

export const BRANCHES = (Object.keys(VARIANTS) as Variant[]).flatMap((v) =>
  CONDITIONS.map((c) => ({ variant: v, condition: c, id: `${v}_${c}` })),
);

// The rule under study (system-prompt.ts:78). Matched after leading whitespace.
export const RULE5_PREFIX = "5. **Earlier failures are not permanent.**";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function removeRule5(pFull: string): string {
  const lines = pFull.split("\n");
  const hits = lines.filter((l) => l.trimStart().startsWith(RULE5_PREFIX));
  if (hits.length !== 1) {
    throw new Error(`Expected the rule-5 line exactly once in the BUILD prompt, found ${hits.length}`);
  }
  return lines.filter((l) => !l.trimStart().startsWith(RULE5_PREFIX)).join("\n");
}

export type SystemPrompts = { pFull: string; pNoRule: string; pFullSha256: string; pNoRuleSha256: string };

export function systemPrompts(cwd: string): SystemPrompts {
  const pFull = buildSystemPrompt({ cwd, mode: "BUILD" });
  const pNoRule = removeRule5(pFull);
  return { pFull, pNoRule, pFullSha256: sha256(pFull), pNoRuleSha256: sha256(pNoRule) };
}

const COMPLETE = "COMPLETE" as MessageStatus;

// easycode's history for [user T1, assistant A1_text, user V]
function narration(a1Text: string, v: string): ModelMessage[] {
  return buildConversationHistory([
    { role: "USER", content: T1, status: COMPLETE },
    { role: "ASSISTANT", content: a1Text, status: COMPLETE },
    { role: "USER", content: v, status: COMPLETE },
  ]);
}

// withShellCheck's append: `${last.content}\n\n${note}` (chat.ts:90)
function withNote(messages: ModelMessage[], note: string): ModelMessage[] {
  const last = messages[messages.length - 1]!;
  if (last.role !== "user" || typeof last.content !== "string") throw new Error("Last message must be a user text message");
  return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${note}` }];
}

export function turn1Messages(): ModelMessage[] {
  return buildConversationHistory([{ role: "USER", content: T1, status: COMPLETE }]);
}

export type Turn2Inputs = {
  prompts: SystemPrompts;
  a1Text: string;
  a1Msgs: ModelMessage[];
  variant: Variant;
  // Required for C3 and C5
  note?: string;
};

export function turn2(condition: Condition, x: Turn2Inputs): { system: string; messages: ModelMessage[] } {
  const v = VARIANTS[x.variant];
  const needNote = () => {
    if (!x.note) throw new Error(`${condition} needs the NOTE`);
    return x.note;
  };
  switch (condition) {
    case "C1":
      return { system: x.prompts.pNoRule, messages: narration(x.a1Text, v) };
    case "C2":
      return {
        system: x.prompts.pNoRule,
        messages: [{ role: "user", content: T1 }, ...x.a1Msgs, { role: "user", content: v }],
      };
    case "C3":
      return { system: x.prompts.pNoRule, messages: withNote(narration(x.a1Text, v), needNote()) };
    case "C4":
      return { system: x.prompts.pFull, messages: narration(x.a1Text, v) };
    case "C5":
      return { system: x.prompts.pFull, messages: withNote(narration(x.a1Text, v), needNote()) };
  }
}

// A1_text from a generateText result: every text part of every step joined
// with "", which is what easycodeContent() yields for the same stream
export function contentFromSteps(steps: readonly { content: readonly { type: string; text?: string }[] }[]): string {
  return steps
    .flatMap((s) => s.content)
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}
