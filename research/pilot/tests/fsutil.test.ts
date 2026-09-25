import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InfraError, safeCopy, safeMove } from "../harness/fsutil.ts";
import { fingerprint } from "../harness/fingerprint.ts";
import { createFixture } from "../harness/fixture.ts";
import { testDir } from "./helpers.ts";

describe("safeMove", () => {
  test("moves, and refuses a missing source or an existing target", async () => {
    const dir = testDir("move");
    writeFileSync(join(dir, "a.txt"), "a");
    const rec = await safeMove(join(dir, "a.txt"), join(dir, "sub", "b.txt"));
    expect(rec.attempts).toBe(1);
    expect(readFileSync(join(dir, "sub", "b.txt"), "utf8")).toBe("a");
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
    await expect(safeMove(join(dir, "a.txt"), join(dir, "c.txt"))).rejects.toBeInstanceOf(InfraError);
    writeFileSync(join(dir, "d.txt"), "d");
    await expect(safeMove(join(dir, "d.txt"), join(dir, "sub", "b.txt"))).rejects.toThrow("already exists");
  });

  // On Windows a folder can't be renamed while a file inside it is open
  test.if(process.platform === "win32")("retries while a handle is held, then succeeds", async () => {
    const dir = testDir("move-busy");
    mkdirSync(join(dir, "held"));
    writeFileSync(join(dir, "held", "f.txt"), "x");
    const fd = openSync(join(dir, "held", "f.txt"), "r");
    setTimeout(() => closeSync(fd), 500);
    const rec = await safeMove(join(dir, "held"), join(dir, "moved"));
    expect(rec.attempts).toBeGreaterThan(1);
    expect(existsSync(join(dir, "moved", "f.txt"))).toBe(true);
  });

  test.if(process.platform === "win32")("gives up with MOVE_FAILED after 5 retries, leaving the source in place", async () => {
    const dir = testDir("move-stuck");
    mkdirSync(join(dir, "held"));
    writeFileSync(join(dir, "held", "f.txt"), "x");
    const fd = openSync(join(dir, "held", "f.txt"), "r");
    try {
      const err = await safeMove(join(dir, "held"), join(dir, "moved")).catch((e) => e);
      expect(err).toBeInstanceOf(InfraError);
      expect(err.reason).toBe("MOVE_FAILED");
      expect(err.message).toContain("after 6 attempts");
      expect(existsSync(join(dir, "held", "f.txt"))).toBe(true);
    } finally {
      closeSync(fd);
    }
  }, 20_000);
});

describe("safeCopy", () => {
  test("copies a tree and refuses to write over anything", async () => {
    const dir = testDir("copy");
    const project = join(dir, "project");
    createFixture(project, "abcdef012345");
    await safeCopy(project, join(dir, "snap"));
    expect(fingerprint(join(dir, "snap")).sha256).toBe(fingerprint(project).sha256);
    expect(existsSync(join(dir, "snap", ".git", "HEAD"))).toBe(true);
    await expect(safeCopy(project, join(dir, "snap"))).rejects.toThrow("already exists");
  });
});

describe("fingerprint", () => {
  test("changes with content, a new file, an empty folder, and the lock; ignores .git contents", () => {
    const project = join(testDir("fp"), "project");
    createFixture(project, "abcdef012345");
    const base = fingerprint(project);
    expect(base).toMatchObject({ exists: true, files: 6, dirs: 5, gitExists: true, lockExists: false });

    writeFileSync(join(project, ".git", "extra"), "x");
    expect(fingerprint(project).sha256).toBe(base.sha256);

    writeFileSync(join(project, "README.md"), "changed\n");
    const changed = fingerprint(project);
    expect(changed.sha256).not.toBe(base.sha256);

    writeFileSync(join(project, ".test.lock"), "");
    expect(fingerprint(project).lockExists).toBe(true);

    mkdirSync(join(project, "empty"));
    expect(fingerprint(project).dirs).toBe(6);
  });

  test("a missing project has a fixed fingerprint", () => {
    const a = fingerprint(join(testDir("fp-missing"), "nope"));
    const b = fingerprint(join(testDir("fp-missing2"), "nope"));
    expect(a.exists).toBe(false);
    expect(a.sha256).toBe(b.sha256);
  });
});
