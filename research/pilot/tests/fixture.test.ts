import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_FILES, createFixture, readNonce, setNonce, tokenFor, writeExact } from "../harness/fixture.ts";
import { prepareShell } from "../harness/shell-env.ts";
import { callTool, instrumentedTools } from "../harness/tools.ts";
import { run, testDir } from "./helpers.ts";

function workingFiles(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const r = rel ? `${rel}/${name}` : name;
    if (r === ".git") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? workingFiles(full, r) : [r];
  });
}

describe("fixture", () => {
  test("tokenFor is the first 16 hex digits of SHA-256", () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(tokenFor("abc")).toBe("ba7816bf8f01cfea");
  });

  test("no generated file contains a carriage return", () => {
    for (const [rel, content] of Object.entries(FIXTURE_FILES)) expect([rel, content.includes("\r")]).toEqual([rel, false]);
    const project = join(testDir("fixture-lf"), "project");
    createFixture(project, "abcdef012345");
    const files = workingFiles(project).sort();
    expect(files).toEqual(["README.md", "bin/fixturetool", "config/test.env", "data/fixtures.txt", "lib/assert.sh", "scripts/run_tests.sh"]);
    for (const f of files) expect([f, readFileSync(join(project, f)).includes(0x0d)]).toEqual([f, false]);
  });

  test("git repo: one commit, autocrlf off, local identity, clean apart from the nonce", () => {
    const project = join(testDir("fixture-git"), "project");
    createFixture(project, "abcdef012345");
    expect(run(["git", "rev-list", "--count", "HEAD"], project).out.trim()).toBe("1");
    expect(run(["git", "config", "--local", "core.autocrlf"], project).out.trim()).toBe("false");
    expect(run(["git", "config", "--local", "user.name"], project).out.trim()).toBe("Fixture Author");
    expect(run(["git", "status", "--porcelain"], project).out.trim()).toBe("M scripts/run_tests.sh");
    // Every fixture commits the same tree and dates, so the same hash
    const other = join(testDir("fixture-git2"), "project");
    createFixture(other, "111111111111");
    expect(run(["git", "rev-parse", "HEAD"], other).out).toBe(run(["git", "rev-parse", "HEAD"], project).out);
  });

  test("setNonce rewrites the one NONCE line and refuses two", () => {
    const project = join(testDir("fixture-nonce"), "project");
    createFixture(project, "abcdef012345");
    expect(readNonce(project)).toBe("abcdef012345");
    setNonce(project, "0123456789ab");
    expect(readNonce(project)).toBe("0123456789ab");
    const path = join(project, "scripts", "run_tests.sh");
    writeExact(path, readFileSync(path, "utf8") + "NONCE=ffffffffffff\n");
    expect(() => setNonce(project, "aaaaaaaaaaaa")).toThrow("exactly one NONCE line");
  });

  test("a clean run passes through the real bash tool; --verbose adds 7 check lines", async () => {
    prepareShell();
    const project = join(testDir("fixture-run"), "project");
    createFixture(project, "abcdef012345");
    const tools = instrumentedTools(project, { disableBash: false }, []);
    const plain = await callTool(tools, "bash", { command: "bash scripts/run_tests.sh" });
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toBe(`RESULT: PASS 7/7 token=${tokenFor("abcdef012345")}\n`);
    expect(plain.stderr).toBe("");
    const verbose = await callTool(tools, "bash", { command: "bash scripts/run_tests.sh --verbose" });
    const lines = verbose.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(8);
    expect(lines.slice(0, 7).every((l: string) => /^ok [1-7] - /.test(l))).toBe(true);
    expect(lines[7]).toBe(`RESULT: PASS 7/7 token=${tokenFor("abcdef012345")}`);
  });
});
