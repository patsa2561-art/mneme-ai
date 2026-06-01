/**
 * v2.134.0 — E2E GATE FLAG-PATH TESTS (the missing test layer).
 *
 * THE LESSON: the regression suite was 20,246/20,246 GREEN while the SECURITY
 * gate the docs tell agents to use (`heph cross --command "..."`) silently let
 * `rm -rf /` through — because the suite tested the classifier in-process /
 * positionally, but NEVER spawned the real CLI with the DOCUMENTED `--flag`
 * invocation. A green suite ≠ a safe road unless the load-bearing gate has a
 * test that exercises the EXACT invocation a real user/agent runs.
 *
 * These tests spawn the REAL built CLI binary and assert the documented
 * invocations classify correctly. End-to-end, no mocks.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
// the REAL entry that parses argv is bin/mneme.js (dist/index.js only exports
// the program). E2E means we run exactly what a user/agent runs.
const CLI_BIN = join(REPO_ROOT, "packages", "cli", "bin", "mneme.js");

beforeAll(() => {
  if (!existsSync(CLI_BIN)) throw new Error(`CLI bin missing — run \`npm run build\` first. Expected: ${CLI_BIN}`);
});

function runCli(args: string[]): { exitCode: number; out: string } {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    // force cold/no-daemon so we exercise the real code path, not a stale daemon.
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { exitCode: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("v2.134 · E2E gate flag-paths (the documented invocations)", () => {
  describe("HEPHAESTUS — `heph cross` must classify a destructive command via EVERY documented form", () => {
    it("--command flag (the Rule-13 / --help / MCP {command} path) → NEEDS_COSIGN, NOT ALLOW", () => {
      const r = runCli(["heph", "cross", "--command", "rm -rf /home/user", "--agent", "ai"]);
      expect(r.out).toMatch(/NEEDS_COSIGN|BLOCK/);
      expect(r.out).not.toMatch(/🟢 ALLOW|"disposition":\s*"ALLOW"/);
    });

    it("bare positional form → NEEDS_COSIGN", () => {
      const r = runCli(["heph", "cross", "rm -rf /home/user"]);
      expect(r.out).toMatch(/NEEDS_COSIGN|BLOCK/);
      expect(r.out).not.toMatch(/🟢 ALLOW/);
    });

    it("git push --force via --command → NEEDS_COSIGN/BLOCK", () => {
      const r = runCli(["heph", "cross", "--command", "git push --force origin main"]);
      expect(r.out).toMatch(/NEEDS_COSIGN|BLOCK/);
    });

    it("DROP TABLE via --command → NEEDS_COSIGN/BLOCK", () => {
      const r = runCli(["heph", "cross", "--command", "psql -c 'DROP TABLE users'"]);
      expect(r.out).toMatch(/NEEDS_COSIGN|BLOCK/);
    });

    it("a benign command via --command → ALLOW (not over-blocked)", () => {
      const r = runCli(["heph", "cross", "--command", "ls -la"]);
      expect(r.out).toMatch(/ALLOW/);
      expect(r.out).not.toMatch(/NEEDS_COSIGN|BLOCK/);
    });

    it("preflight flags an irreversible command WITHOUT running it", () => {
      const r = runCli(["heph", "preflight", "--command", "rm -rf /data"]);
      expect(r.out).toMatch(/IRREVERSIBLE|irreversible/i);
    });
  });

  describe("GEPHYRA — `gephyra cross` must not over-claim TRUSTWORTHY on an unprovable world-fact", () => {
    it("a false/unprovable world-fact → NOT TRUSTWORTHY (UNVERIFIED, per prove-or-unknown)", () => {
      const r = runCli(["gephyra", "cross", "--claim", "the human body has 400 blood vessels", "--from", "ai"]);
      expect(r.out).not.toMatch(/🟢 PASS|TRUSTWORTHY/);
      expect(r.out).toMatch(/UNVERIFIED/);
    });

    it("a known lie about Mneme → REFUTED/CORRECTED at the bridge", () => {
      const r = runCli(["gephyra", "cross", "--claim", "Mneme is written in Rust", "--from", "ai"]);
      expect(r.out).toMatch(/REFUTED|CORRECTED/);
    });
  });
});
