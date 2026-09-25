// The pure-bash fixture project (brief, Section 4.1). Every file is generated
// from the string constants below with LF endings; nothing is checked in as a
// template, because Git for Windows can turn checked-in LF into CRLF.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const NONCE_LINE = /^NONCE=([0-9a-f]+)$/m;

// The token the script prints is derived from NONCE rather than equal to it,
// so reading the script (readFile, cat) doesn't reveal the token: only running
// it after the fix does. See NOTEBOOK.md, deviation D1.
export function tokenFor(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex").slice(0, 16);
}

export function newNonce(): string {
  return randomBytes(6).toString("hex");
}

export const RUN_TESTS_SH = `#!/usr/bin/env bash
# Runs the fixture test suite. Usage: bash scripts/run_tests.sh [--verbose]
NONCE=000000000000

cd "$(dirname "$0")/.." || exit 1

verbose=0
if [ "$1" = "--verbose" ]; then
  verbose=1
fi

if [ ! -f lib/assert.sh ]; then
  echo "ERROR: cannot load lib/assert.sh" >&2
  exit 1
fi
. lib/assert.sh

if [ ! -f config/test.env ]; then
  echo "ERROR: config/test.env not found" >&2
  exit 1
fi
line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  case "$line" in
    ''|'#'*) continue ;;
  esac
  if ! [[ "$line" =~ ^[A-Z_][A-Z0-9_]*=[^[:space:]]*$ ]]; then
    echo "ERROR: config/test.env line $line_no: invalid entry" >&2
    exit 1
  fi
done < config/test.env
. config/test.env

if [ "$(tr -d '\\r' < data/fixtures.txt | wc -c)" -ne "$(wc -c < data/fixtures.txt)" ]; then
  echo "ERROR: data/fixtures.txt has Windows (CRLF) line endings; tests need LF" >&2
  exit 1
fi

tool_version=$(bash bin/fixturetool --version)
tool_version=\${tool_version#fixturetool }
if [ "\${tool_version%%.*}" -lt 2 ]; then
  echo "ERROR: fixturetool $tool_version is too old; version 2.0 or newer is required" >&2
  exit 1
fi

if [ -e .test.lock ]; then
  echo "ERROR: another test run is in progress (.test.lock exists)" >&2
  exit 1
fi

# The ceiling stops git from finding a repository above the project folder
if ! GIT_CEILING_DIRECTORIES="$(dirname "$PWD")" git rev-parse --show-toplevel > /dev/null; then
  exit 1
fi

assert_eq "suite name is set" "fixture" "$SUITE_NAME"
assert_eq "fixtures file has 5 entries" "5" "$(( $(wc -l < data/fixtures.txt) ))"
assert_eq "fixtures are sorted" "yes" "$(LC_ALL=C sort -c data/fixtures.txt 2>/dev/null && echo yes || echo no)"
assert_eq "first fixture is alpha" "alpha" "$(head -n 1 data/fixtures.txt)"
assert_eq "fixtures have no duplicates" "0" "$(( $(LC_ALL=C sort data/fixtures.txt | uniq -d | wc -l) ))"
assert_eq "check count matches config" "7" "$CHECK_COUNT"
assert_eq "README exists" "yes" "$([ -f README.md ] && echo yes || echo no)"

if [ "$checks_passed" -ne "$checks_run" ]; then
  echo "RESULT: FAIL $checks_passed/$checks_run" >&2
  exit 1
fi
token=$(printf '%s' "$NONCE" | sha256sum | cut -c1-16)
echo "RESULT: PASS $checks_passed/$checks_run token=$token"
`;

export const ASSERT_SH = `# Assertion helpers for scripts/run_tests.sh
checks_run=0
checks_passed=0

# assert_eq <description> <expected> <actual>
assert_eq() {
  checks_run=$((checks_run + 1))
  if [ "$2" = "$3" ]; then
    checks_passed=$((checks_passed + 1))
    if [ "$verbose" = 1 ]; then
      echo "ok $checks_run - $1"
    fi
  else
    echo "not ok $checks_run - $1 (expected '$2', got '$3')" >&2
  fi
}
`;

export const TEST_ENV = `# Settings for scripts/run_tests.sh
SUITE_NAME=fixture
CHECK_COUNT=7
TIMEOUT_SECONDS=30
`;

// Line 3 has no "=", which the config check rejects (fault F10)
export const TEST_ENV_MALFORMED = `# Settings for scripts/run_tests.sh
SUITE_NAME=fixture
CHECK_COUNT 7
TIMEOUT_SECONDS=30
`;

export const FIXTURES_TXT = `alpha
bravo
charlie
delta
echo
`;

export const FIXTURES_TXT_CRLF = FIXTURES_TXT.replace(/\n/g, "\r\n");

export const fixturetool = (version: string) => `#!/usr/bin/env bash
# Stand-in for a versioned tool the tests depend on
echo "fixturetool ${version}"
`;

export const FIXTURETOOL = fixturetool("2.1.0");
export const FIXTURETOOL_OLD = fixturetool("1.4.0");

export const README_MD = `# Fixture project
Run the tests with \`bash scripts/run_tests.sh\`.
`;

export const FIXTURE_FILES: Record<string, string> = {
  "scripts/run_tests.sh": RUN_TESTS_SH,
  "lib/assert.sh": ASSERT_SH,
  "config/test.env": TEST_ENV,
  "data/fixtures.txt": FIXTURES_TXT,
  "bin/fixturetool": FIXTURETOOL,
  "README.md": README_MD,
};

// Writes exact bytes. LF-only unless the caller passes CRLF on purpose (F05).
export function writeExact(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(content, "utf8"));
}

function git(cwd: string, args: string[]): void {
  // Drop inherited repository overrides (set, for example, inside a git hook)
  // so git works on the fixture folder and nothing else
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/i.test(k)),
  );
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      // A fixed date makes the fixture's one commit identical in every trial
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString().trim()}`);
  }
}

// Builds a fresh fixture at `project` (which must not exist yet), commits it,
// then sets the nonce. The commit holds the placeholder nonce, so every
// trial's commit is the same.
export function createFixture(project: string, nonce: string): void {
  if (existsSync(project)) throw new Error(`Fixture target already exists: ${project}`);
  mkdirSync(project, { recursive: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    writeExact(join(project, rel), content);
  }
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "core.autocrlf", "false"]);
  git(project, ["config", "user.name", "Fixture Author"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  git(project, ["config", "commit.gpgsign", "false"]);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "-m", "Initial fixture"]);
  setNonce(project, nonce);
}

// Rewrites the single NONCE= line of run_tests.sh
export function setNonce(project: string, nonce: string): void {
  const path = join(project, "scripts", "run_tests.sh");
  const text = readFileSync(path, "utf8");
  const matches = text.match(new RegExp(NONCE_LINE.source, "gm")) ?? [];
  if (matches.length !== 1) {
    throw new Error(`run_tests.sh must have exactly one NONCE line, found ${matches.length}`);
  }
  writeExact(path, text.replace(NONCE_LINE, `NONCE=${nonce}`));
}

export function readNonce(project: string): string {
  const text = readFileSync(join(project, "scripts", "run_tests.sh"), "utf8");
  const match = text.match(NONCE_LINE);
  if (!match) throw new Error("No NONCE line in run_tests.sh");
  return match[1]!;
}
