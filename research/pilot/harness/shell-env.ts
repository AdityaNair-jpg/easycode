// Prepares the environment easycode's bash tool hands to every command.
// Two changes, both made to the object resolveShell() caches, without
// touching packages/:
//   1. secret variables removed (secrets.ts, brief rule 14)
//   2. GIT_CEILING_DIRECTORIES set to the workspace root. The workspaces live
//      inside the easycode repo, so without a ceiling a git command in a
//      project with no .git (fault F07) reaches the easycode repo and shows
//      this study's branch to the model. See NOTEBOOK.md, deviation D2.
import { WS_DIR } from "./paths.ts";
import { scrubShellEnv } from "./secrets.ts";
import type { Shell } from "./easycode.ts";

export const GIT_CEILING = WS_DIR;

let prepared: { shell: Shell; removed: string[]; gitCeiling: string } | null = null;

export function prepareShell(): { shell: Shell; removed: string[]; gitCeiling: string } {
  if (prepared) return prepared;
  const { shell, removed } = scrubShellEnv();
  const existing = Object.keys(shell.env).find((k) => k.toUpperCase() === "GIT_CEILING_DIRECTORIES");
  if (existing) delete shell.env[existing];
  shell.env.GIT_CEILING_DIRECTORIES = GIT_CEILING;
  prepared = { shell, removed, gitCeiling: GIT_CEILING };
  return prepared;
}
