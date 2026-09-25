// Workspace fingerprint (brief, Section 5.1): SHA-256 over every file's
// relative path and content, plus whether .git and .test.lock exist. The
// contents of .git are excluded and permission bits are ignored.
// One addition to the brief: directory paths are hashed too, so a created
// empty folder also counts as a change (NOTEBOOK.md, deviation D3).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export type Fingerprint = {
  sha256: string;
  exists: boolean;
  files: number;
  dirs: number;
  gitExists: boolean;
  lockExists: boolean;
};

export function fingerprint(project: string): Fingerprint {
  if (!existsSync(project)) {
    return {
      sha256: createHash("sha256").update("MISSING\n").digest("hex"),
      exists: false,
      files: 0,
      dirs: 0,
      gitExists: false,
      lockExists: false,
    };
  }

  const entries: string[] = [];
  let files = 0;
  let dirs = 0;
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const relPath = rel ? `${rel}/${name}` : name;
      if (relPath === ".git") continue;
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        files++;
        entries.push(`L ${relPath} ${createHash("sha256").update(readlinkSync(full)).digest("hex")}`);
      } else if (st.isDirectory()) {
        dirs++;
        entries.push(`D ${relPath}`);
        walk(full, relPath);
      } else {
        files++;
        entries.push(`F ${relPath} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(project, "");
  entries.sort();

  const gitExists = existsSync(join(project, ".git"));
  const lockExists = existsSync(join(project, ".test.lock"));
  const hash = createHash("sha256");
  for (const e of entries) hash.update(`${e}\n`);
  hash.update(`git=${gitExists ? 1 : 0}\nlock=${lockExists ? 1 : 0}\n`);
  return { sha256: hash.digest("hex"), exists: true, files, dirs, gitExists, lockExists };
}
