import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "bun";
import { scanStaged } from "../harness/precommit.ts";
import { run, testDir } from "./helpers.ts";

// A made-up value; the real keys never appear in tests
const FAKE = { name: "FAKE_API_KEY", value: "fake-secret-value-0123456789" };

function repo(label: string): string {
  const dir = testDir(label);
  run(["git", "init", "-q"], dir);
  return dir;
}

describe("pre-commit scan", () => {
  test("passes a clean stage", () => {
    const dir = repo("scan-clean");
    writeFileSync(join(dir, "a.txt"), "nothing to see\n");
    run(["git", "add", "a.txt"], dir);
    expect(scanStaged(dir, [FAKE])).toEqual([]);
  });

  test("fails a staged file holding a secret value, naming the variable only", () => {
    const dir = repo("scan-secret");
    writeFileSync(join(dir, "notes.md"), `key is ${FAKE.value}\n`);
    run(["git", "add", "notes.md"], dir);
    const problems = scanStaged(dir, [FAKE]);
    expect(problems).toEqual([{ path: "notes.md", problem: "contains the value of FAKE_API_KEY" }]);
    expect(JSON.stringify(problems)).not.toContain(FAKE.value);
  });

  test("finds a secret inside a gzipped file", () => {
    const dir = repo("scan-gz");
    writeFileSync(join(dir, "t.json.gz"), gzipSync(Buffer.from(JSON.stringify({ env: FAKE.value }))));
    run(["git", "add", "t.json.gz"], dir);
    expect(scanStaged(dir, [FAKE]).map((p) => p.problem)).toEqual(["contains the value of FAKE_API_KEY"]);
  });

  test("fails a staged .env", () => {
    const dir = repo("scan-env");
    writeFileSync(join(dir, ".env"), "X=1\n");
    run(["git", "add", "-f", ".env"], dir);
    expect(scanStaged(dir, [FAKE])[0]!.problem).toContain(".env");
  });

  test("fails a file over the size limit", () => {
    const dir = repo("scan-size");
    writeFileSync(join(dir, "big.bin"), Buffer.alloc(2048));
    run(["git", "add", "big.bin"], dir);
    expect(scanStaged(dir, [FAKE], 1024)[0]!.problem).toContain("over the 1024-byte limit");
  });
});
