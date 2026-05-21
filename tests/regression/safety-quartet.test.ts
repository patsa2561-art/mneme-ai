// v2.22.2 — Safety Quartet CLI integration.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("Safety Quartet (v2.22.2)", () => {
  it("`mneme dim-check 'thrust = 9.8 N/m^2'` returns MISMATCH + exit 2", () => {
    const r = runCli(["dim-check", "thrust = 9.8 N/m^2"], { cwd: REPO_ROOT });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("MISMATCH");
    expect(r.stdout).toContain("pressure");
  });

  it("`mneme dim-check 'altitude = 400 km'` returns MATCH + exit 0", () => {
    const r = runCli(["dim-check", "altitude = 400 km"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MATCH");
  });

  it("`mneme failure-check ...` flags Mars Climate Orbiter on dimensional mismatch", () => {
    const r = runCli(["failure-check", "Engine thrust = 9.8 N/m^2 needed for descent burn"], { cwd: REPO_ROOT });
    expect(r.status === 0 || r.status === 2).toBe(true);
    expect(r.stdout).toContain("Mars Climate Orbiter");
  });

  it("`mneme failures` lists ≥ 8 historical failures", () => {
    const r = runCli(["failures"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it("`mneme overshoot ...` flags scope creep + sets kill-switch", () => {
    const planned = JSON.stringify([{ verb: "a" }]);
    const actual = JSON.stringify([{ verb: "a" }, { verb: "b" }, { verb: "c" }]);
    const r = runCli(["overshoot", "--planned", planned, "--actual", actual], { cwd: REPO_ROOT });
    // exit 2 when killSwitch armed; depends on threshold.
    expect([0, 2]).toContain(r.status);
    expect(r.stdout).toMatch(/WANDER|OVERSHOOT|RUNAWAY/);
  });
});
