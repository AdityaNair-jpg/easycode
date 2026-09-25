// Code copied from easycode because it isn't exported. chat.ts can't be
// imported: it pulls in the database client and Clerk (brief, rule 17).
// tests/copied.test.ts checks every copy against the source file.
import { toolCallArgsSchema, type MessagePart } from "@easycode/shared";
import type { MessageStatus } from "@easycode/database/enums";
import { checkShell, type ShellCheck } from "./easycode.ts";
import { InfraError } from "./fsutil.ts";

// BEGIN COPY packages/server/src/routes/chat.ts:35-49 at commit 4f126f9 (verbatim)
// Strip error messages and empty assistant messages from the conversation
function buildConversationHistory(
  messages: { role: "USER" | "ASSISTANT" | "ERROR"; content: string; status: MessageStatus }[],
) {
  return messages.flatMap((m) => {
    if (m.role === "ERROR") return [];
    if (m.role === "ASSISTANT" && m.content.length === 0) return [];
    return [
      { 
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const), 
        content: m.content
      },
    ];
  });
};
// END COPY

export { buildConversationHistory };

// How easycode builds an assistant message's `content` from the stream.
// BEGIN COPY packages/server/src/routes/chat.ts:143-227 at commit 4f126f9 (streamAIResponse)
// Only the statements that build `parts` and `fullText` are kept, in their
// original order and text. Dropped: the abort check, the SSE `event` consts and
// `stream.writeSSE` calls, the tool-result branch (it only fills in a tool
// part's result, which `content` ignores), and the error branch. Lines marked
// `// harness` are scaffolding that isn't in chat.ts.
export async function easycodeContent(result: { fullStream: AsyncIterable<any> }): Promise<string> { // harness
  const parts: MessagePart[] = []; // harness
    for await (const part of result.fullStream) {
      if (part.type === "reasoning-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "reasoning") {
          last.text += part.text;
        } else {
          parts.push({ type: "reasoning", text: part.text });
        }
      }

      if (part.type === "text-delta") {
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          last.text += part.text;
        } else {
          parts.push({ type: "text", text: part.text });
        }
      }

      if (part.type === "tool-call") {
        const args = toolCallArgsSchema.parse(part.input);

        parts.push({
          type: "tool-call",
          id: part.toolCallId,
          name: part.toolName,
          args,
        });
      }
    }
    const fullText = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  return fullText; // harness
} // harness
// END COPY

// The Build-mode note withShellCheck() appends to the latest user message
// (chat.ts:81-91). The template on the `const note` line is copied verbatim
// from chat.ts:87 at commit 4f126f9. Unlike chat.ts, a failed check is an
// infra error here: C3 and C5 need the check to pass (brief, Section 2).
export async function buildNote(): Promise<{ note: string; check: ShellCheck }> {
  const check = await checkShell();
  if (!check.ok) throw new InfraError("SHELL_CHECK_FAILED", check.reason);
  const note = `[Environment check, run just now: the bash tool works (${check.name}). Any bash errors earlier in this conversation are out of date.]`;
  return { note, check };
}
