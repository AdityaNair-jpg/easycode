s/^import { WS_DIR, assertRunFromRepoRoot, repoRel } from ".\/paths.ts";/import { DEFAULT_ROOTS, assertRunFromRepoRoot, repoRel } from ".\/paths.ts";\nimport { readdirSync as listDir } from "node:fs";/
s/^function trialFootprint(trialId: string): string\[\] {/function trialFootprint(trialId: string): string[] {\n  const roots = DEFAULT_ROOTS;/
s/^    \.\.\.allPaths(join(WS_DIR, trialId)),/    ...allPaths(join(roots.work, trialId)),/
s/^    \.\.\.allPaths(join(WS_DIR, "_stash", trialId)),/    ...allPaths(join(roots.arc, trialId)),/
/^    \.\.\.allPaths(join(WS_DIR, "_snap", trialId)),/d
/^    join(WS_DIR, "_logs", `${trialId}.jsonl`),/d
s/^  const ids = nextIds(WS_DIR, "x", faults.length);/  const set = process.argv[2] ?? "m1";\n  const ids = nextIds(DEFAULT_ROOTS, "x", faults.length);/
s/^    wsRoot: WS_DIR,/    roots: DEFAULT_ROOTS,/
s/writeEvidence("m1", /writeEvidence(set, /g
s/^      archives,$/      archives,\n      \/\/ Nothing may sit next to project\ (deviation D11)\n      workDirEntries: listDir(join(DEFAULT_ROOTS.work, r.trialId)),/
