// Secret handling. Failures print variable names only, never values.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkShell } from "../harness/easycode.ts";
import { createFixture, newNonce } from "../harness/fixture.ts";
import { isSecretName, parseDotenv, readDotenv, scrubEnv } from "../harness/secrets.ts";
import { prepareShell } from "../harness/shell-env.ts";
import { callTool, instrumentedTools } from "../harness/tools.ts";
import { testDir } from "./helpers.ts";

describe("parseDotenv", () => {
  test("reads names and values, skips comments, strips matching quotes", () => {
    const text = '# c\nA=1\n\nexport B="two words"\nC=\'x\'\nD=\r\nnot a line\n';
    expect(parseDotenv(text)).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "two words" },
      { name: "C", value: "x" },
      { name: "D", value: "" },
    ]);
  });
});

describe("scrubEnv", () => {
  test("matches .env names and secret-looking names case-insensitively", () => {
    const env: Record<string, string | undefined> = {
      Openai_Api_Key: "a",
      my_token: "b",
      DB_PASSWORD: "c",
      clerk_frontend_api: "d",
      Database_Url: "e",
      API_URL: "f",
      Path: "p",
      HOME: "h",
    };
    const removed = scrubEnv(env, ["OPENAI_API_KEY", "API_URL"]);
    expect(removed).toEqual(["API_URL", "DB_PASSWORD", "Database_Url", "Openai_Api_Key", "clerk_frontend_api", "my_token"]);
    expect(Object.keys(env).sort()).toEqual(["HOME", "Path"]);
  });

  test("isSecretName", () => {
    expect(isSecretName("GITHUB_TOKEN", [])).toBe(true);
    expect(isSecretName("api_url", ["API_URL"])).toBe(true);
    expect(isSecretName("PATH", [])).toBe(false);
  });
});

describe("env through easycode's real bash tool", () => {
  test("no secret name or value appears", async () => {
    const dotenv = readDotenv();
    const withValues = dotenv.filter((e) => e.value.length >= 4);
    // The test only means something if Bun loaded .env into this process
    expect(withValues.length).toBeGreaterThan(0);
    const loaded = withValues.filter((e) => process.env[e.name] === e.value).map((e) => e.name);
    expect(loaded.length).toBe(withValues.length);

    prepareShell();
    const project = join(testDir("env-scrub"), "project");
    createFixture(project, newNonce());
    const tools = instrumentedTools(project, { disableBash: false }, []);
    const result = await callTool(tools, "bash", { command: "env" });
    expect(result.exitCode).toBe(0);
    const out = `${result.stdout}\n${result.stderr}`;

    const names = out.split(/\r?\n/).map((l) => l.split("=")[0]!).filter(Boolean);
    expect(names.length).toBeGreaterThan(10);
    const dotenvNames = dotenv.map((e) => e.name);
    expect(names.filter((n) => isSecretName(n, dotenvNames))).toEqual([]);
    expect(withValues.filter((e) => out.includes(e.value)).map((e) => e.name)).toEqual([]);
  });

  test("checkShell still passes after the scrub", async () => {
    prepareShell();
    const check = await checkShell();
    expect(check.ok).toBe(true);
  });
});
