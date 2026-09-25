// The one place the harness imports easycode product code. Everything here is
// used unmodified. Routes, the server entry, auth and the database client are
// never imported (brief, rule 17).
export { createTools } from "../../../packages/server/src/tools/index.ts";
export { buildSystemPrompt } from "../../../packages/server/src/system-prompt.ts";
export { resolveShell, checkShell } from "../../../packages/server/src/lib/shell.ts";
export type { Shell, ShellCheck } from "../../../packages/server/src/lib/shell.ts";
export { resolveChatModel } from "../../../packages/server/src/lib/models.ts";
export { SUPPORTED_CHAT_MODELS, findSupportedChatModel } from "@easycode/shared";

import { join } from "node:path";
import { REPO_ROOT } from "./paths.ts";

// Source files the harness copies from, for the verbatim-copy tests
export const EASYCODE_SOURCES = {
  chat: join(REPO_ROOT, "packages", "server", "src", "routes", "chat.ts"),
  bash: join(REPO_ROOT, "packages", "server", "src", "tools", "bash.ts"),
  systemPrompt: join(REPO_ROOT, "packages", "server", "src", "system-prompt.ts"),
};
