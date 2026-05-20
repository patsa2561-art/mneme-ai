/**
 * v2.19.76 — `mneme talk` command tests.
 *
 *   The chat command has two modes (host-agent detection vs. standalone
 *   readline REPL).  Testing the REPL is high-cost (requires a fake
 *   stdin stream); we instead pin the contract surfaces that ANY
 *   integration would expect:
 *
 *     1. With an AI-agent env var set, `mneme talk --json` emits
 *        the protocol-handoff payload (NOT the REPL banner).
 *     2. With NO AI-agent env vars set + a TTY-less stdin (CI is
 *        non-interactive) + --json, the same handoff payload is
 *        emitted with `host: null` and an "intent table" present.
 *        (We test --json so vitest doesn't hang on the readline
 *        prompt of the standalone REPL.)
 *     3. The intent table includes the canonical 10 rows from the
 *        AI_AGENT_CONTRACT Step 2.5 dispatch table.
 *     4. The 5 dispatch rules are present (verbatim sanity check
 *        on the most load-bearing one: "ALWAYS run the command
 *        yourself; do NOT tell the user to type it.").
 *     5. --force-standalone short-circuits the AI-agent detection
 *        + drops into the readline REPL.  We test this with a
 *        pre-closed stdin so the REPL exits immediately on EOF.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "..", "bin", "mneme.js");

interface ChildResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runTalk(args: string[], env: Record<string, string | undefined> = {}): ChildResult {
  // Spawn the bin directly (not through warmcall) so the test exercises
  // the chat command we just shipped, not a stale daemon's copy.
  // Pipe stdin from /dev/null equivalent — empty so REPL exits on EOF.
  const r = spawnSync(process.execPath, [binPath, "talk", ...args], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    input: "", // empty stdin — REPL gets immediate EOF, returns
    env: {
      // Start clean, then layer the test's env overrides.
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE_") && !k.startsWith("CURSOR_") && !k.startsWith("CODEX_") && !k.startsWith("CONTINUE_") && !k.startsWith("AIDER_") && !k.startsWith("AI_AGENT") && !k.startsWith("MCP_") && !k.startsWith("CLINE_") && !k.startsWith("GEMINI_") && !k.startsWith("CODEIUM_") && !k.startsWith("WINDSURF_") && !k.startsWith("ZED_"))),
      MNEME_WARMCALL: "0", // disable warmcall — we want the bin's own chat code, not a daemon's stale copy
      ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>,
    },
  });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("mneme talk — protocol handoff (AI agent detected)", () => {
  it("emits the JSON handoff payload when CLAUDE_CODE is set", () => {
    const r = runTalk(["--json"], { CLAUDE_CODE: "test-session-123" });
    expect(r.exitCode, `stderr: ${r.stderr.slice(0, 400)}`).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.mode).toBe("MNEME_CHAT_DISPATCHER");
    expect(j.host).toBe("Claude Code");
    expect(j.envEvidence.join(",")).toMatch(/CLAUDE_CODE/);
  });

  it("recognises Cursor via CURSOR_AGENT", () => {
    const r = runTalk(["--json"], { CURSOR_AGENT: "cursor-test" });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.host).toBe("Cursor");
  });

  it("recognises Codex / OpenAI via CODEX_AGENT", () => {
    const r = runTalk(["--json"], { CODEX_AGENT: "1" });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.host).toBe("Codex / GPT CLI");
  });

  it("recognises Gemini Code Assist", () => {
    const r = runTalk(["--json"], { GEMINI_CODE_ASSIST: "1" });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.host).toBe("Gemini Code Assist");
  });

  it("recognises generic AI_AGENT marker (last-resort sniff)", () => {
    const r = runTalk(["--json"], { AI_AGENT: "unknown-vendor" });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.host).toBe("generic AI agent");
  });

  it("intent table contains the 10 canonical rows from the AI_AGENT_CONTRACT dispatch table", () => {
    const r = runTalk(["--json"], { CLAUDE_CODE: "1" });
    const j = JSON.parse(r.stdout);
    expect(Array.isArray(j.intentTable)).toBe(true);
    expect(j.intentTable.length).toBeGreaterThanOrEqual(10);
    const userPhrases = j.intentTable.map((row: { user: string }) => row.user.toLowerCase());
    // Canonical core rows we promise to ship:
    for (const expected of ["why does x", "what changed", "verify this", "is this safe to change", "shipping a release", "i don't know what to ask", "upgrade mneme"]) {
      expect(
        userPhrases.some((p: string) => p.includes(expected)),
        `intent table missing canonical row: "${expected}"`,
      ).toBe(true);
    }
  });

  it("includes the 5 rules of dispatch (the 'never tell user to type it' rule must be present)", () => {
    const r = runTalk(["--json"], { CLAUDE_CODE: "1" });
    const j = JSON.parse(r.stdout);
    expect(Array.isArray(j.rules)).toBe(true);
    expect(j.rules.length).toBeGreaterThanOrEqual(5);
    const joined = j.rules.join(" | ");
    expect(joined).toMatch(/run the command yourself/i);
    expect(joined).toMatch(/mneme\.ask/);
    expect(joined).toMatch(/welcome/i);
  });
});

describe("mneme talk — standalone REPL fallback", () => {
  it("with --force-standalone + empty stdin, exits cleanly (REPL hits EOF + closes)", () => {
    // The standalone REPL reads from stdin via readline.  With "" input
    // (EOF immediately), the rl 'close' event fires + the process
    // exits 0.  This pins the "REPL doesn't hang in non-interactive
    // mode" invariant — important for CI runners + AI-agent shells.
    const r = runTalk(["--force-standalone"], { CLAUDE_CODE: undefined });
    expect(r.exitCode, `stderr: ${r.stderr.slice(0, 400)}`).toBe(0);
    expect(r.stdout).toMatch(/mneme talk — standalone REPL/);
  });

  it("with NO AI-agent env + non-interactive stdin, falls through to standalone REPL (not handoff)", () => {
    const r = runTalk([], {});
    expect(r.exitCode).toBe(0);
    // No JSON handoff payload; standalone banner instead.
    expect(r.stdout).toMatch(/standalone REPL/);
    expect(r.stdout).not.toMatch(/PROTOCOL HANDOFF/);
  });
});
