// Category 1 — every command exits 0 on `--help`.
//
// What this catches: a command was renamed, the action handler was deleted,
// commander's parser rejected new option flags, or `process.exit(1)` snuck
// into a help path. If any of those break, this wall fails before the user
// hits it.
//
// We run the *actual built bin*. If `dist/` is stale, the test fails loudly
// rather than silently testing source.

import { describe, it, expect, beforeAll } from "vitest";
import { ALL_COMMANDS, argvFor, distExists, runCli } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) {
    throw new Error(
      "packages/cli/dist/index.js missing — run `npm run build` before regression tests.",
    );
  }
});

describe("CLI regression — every command exits 0 on --help", () => {
  // Sanity check: discovery actually found commands
  it("discovered the command list from src/index.ts", () => {
    expect(ALL_COMMANDS.length).toBeGreaterThan(40);
    // Spot-check a few canonical entries we know must exist
    expect(ALL_COMMANDS).toContain("init");
    expect(ALL_COMMANDS).toContain("ask");
    expect(ALL_COMMANDS).toContain("status");
    expect(ALL_COMMANDS).toContain("forensics anomaly");
  });

  for (const cmd of ALL_COMMANDS) {
    it(`${cmd} --help`, () => {
      const argv = [...argvFor(cmd), "--help"];
      const r = runCli(argv, { timeoutMs: 10_000 });
      // commander emits help text, then our exitOverride translates
      // commander.helpDisplayed → exit 0
      expect(r.signal, `signal: ${r.signal} stderr: ${r.stderr.slice(0, 200)}`).toBeNull();
      expect(r.status, `non-zero help for "${cmd}":\n${r.combined.slice(0, 400)}`).toBe(0);
      // commander's marker for help output
      expect(r.stdout, `no Usage marker in --help output for "${cmd}"`).toMatch(/Usage:/);
    });
  }
});

describe("CLI regression — top-level surface", () => {
  it("`mneme --help` lists at least 10 visible commands", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    // commander indents commands; cheap heuristic: at least 10 lines starting
    // with two+ spaces and a word char
    const cmdLines = r.stdout.split(/\r?\n/).filter((l) => /^\s{2,}\w[\w-]*\s/.test(l));
    expect(cmdLines.length).toBeGreaterThan(10);
  });

  it("`mneme --version` prints a semver", () => {
    const r = runCli(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("`mneme advanced` exits 0 and lists hidden phases", () => {
    const r = runCli(["advanced"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Phase 2|WILD|Wisdom/);
  });

  it("unknown command exits non-zero with a helpful hint", () => {
    const r = runCli(["definitely-not-a-real-command"]);
    expect(r.status).not.toBe(0);
    // commander says "unknown command" — accept any case
    expect(r.combined.toLowerCase()).toMatch(/unknown|error/);
  });
});
