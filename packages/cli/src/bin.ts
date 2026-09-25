#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const HELP = `easyCode — a terminal coding agent

Usage:
  easycode [directory]
  easycode --cwd <directory>

Options:
  -c, --cwd <dir>   Project directory the agent works in (default: current directory)
  -h, --help        Show this help

The directory is captured when a session is created and stored alongside it, so
each session stays bound to the project it was started in. To work on a
different project, quit and relaunch from there.`;

type ParsedArgs = { dir: string | null };

function fail(message: string): never {
  console.error(`easycode: ${message}\n\nRun 'easycode --help' for usage.`);
  process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
  let dir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    }

    if (arg === "--cwd" || arg === "-c") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        fail("--cwd requires a directory path");
      }
      dir = value;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      const value = arg.slice("--cwd=".length);
      if (!value) fail("--cwd requires a directory path");
      dir = value;
      continue;
    }

    if (arg.startsWith("-")) {
      fail(`unknown option '${arg}'`);
    }

    // Bare positional path, so `easycode ../other-project` works too
    if (dir !== null) {
      fail(`unexpected argument '${arg}'`);
    }
    dir = arg;
  }

  return { dir };
}

function resolveProjectDir(dir: string): string {
  const resolved = resolve(dir);

  if (!existsSync(resolved)) {
    fail(`directory not found: ${resolved}`);
  }

  if (!statSync(resolved).isDirectory()) {
    fail(`not a directory: ${resolved}`);
  }

  return resolved;
}

const { dir } = parseArgs(process.argv.slice(2));

if (dir !== null) {
  process.chdir(resolveProjectDir(dir));
}

// Imported dynamically so the chdir above lands before any module captures
// process.cwd() at load time (see CURRENT_DIRECTORY in components/input-bar).
await import("./index.tsx");
