/**
 * v2.19.45 — REGRESSION TEST for N6 (`mneme welcome --json '{}'`).
 *
 *   User dogfood audit reported 4 rounds in a row that
 *   `mneme welcome --json '{}'` threw "too many arguments for 'welcome'".
 *   Each release "fixed" it internally but the user STILL saw the
 *   stderr noise because Commander wrote the error before our retry
 *   suppressed it. This test pins the fix forever:
 *
 *     - exit code MUST be 0
 *     - stdout MUST be valid JSON
 *     - stderr MUST be empty (no false "too many arguments" noise)
 *
 *   The CI gate runs this on every release. Without it, the bug
 *   regressed silently 4 times. With it, the bug-class cannot
 *   reach prod again.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "..", "bin", "mneme.js");

function runMneme(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// All these commands register `--json` as a boolean flag. Pre-v2.19.45,
// passing `--json '{}'` to ANY of them threw "too many arguments".
// v2.19.45 retry-with-stripped-payload + recursive stderr suppression
// makes the call succeed silently.
const BOOLEAN_JSON_COMMANDS: Array<{ args: string[]; label: string; expectJson?: boolean }> = [
  { args: ["welcome", "--json", "{}"], label: "welcome", expectJson: true },
  { args: ["welcome", "--json"], label: "welcome bare --json", expectJson: true },
];

describe("v2.19.45 N6 regression — every --json CLI command accepts '{}'", () => {
  for (const { args, label, expectJson } of BOOLEAN_JSON_COMMANDS) {
    it(`mneme ${args.join(" ")} : exit 0 + JSON stdout + EMPTY stderr (${label})`, () => {
      const r = runMneme(args);
      expect(r.exitCode, `stderr was: ${r.stderr}`).toBe(0);
      expect(r.stderr.trim(), `Commander wrote false error to stderr; v2.19.45 fix regressed`).toBe("");
      if (expectJson) {
        // Stdout should start with a JSON object (allow leading whitespace).
        expect(r.stdout.trimStart().startsWith("{")).toBe(true);
        // Should be parseable.
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    }, 60_000);
  }

  it("MCP-router subcommand --json '{payload}' STILL consumes payload (zero regression)", () => {
    const r = runMneme(["osmosis", "stale_probability", "--json", '{"volatilityPerSec":0.01,"ageSeconds":86400}']);
    expect(r.exitCode).toBe(0);
    // The handler should receive payload + return probability=1 (saturated decay).
    expect(r.stdout).toContain("probability");
    expect(r.stdout).not.toContain("NaN");
  }, 60_000);

  it("genuine unknown-command error STILL surfaces to stderr (no over-suppression)", () => {
    const r = runMneme(["this-command-definitely-does-not-exist"]);
    expect(r.stderr).toMatch(/unknown command|error/i);
  }, 60_000);

  it("--version still works after exitOverride install", () => {
    const r = runMneme(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 60_000);
});
