// v2.21.8 — DISCOVERY SURGERY CI gate.
//
// The default `mneme --help` MUST stay under 2 KB and MUST mention
// the 5 TASTE verbs. The `--full` escape hatch MUST still print the
// legacy 300+ command wall. Pulse output with token receipt footer
// must include the cost line (and disappear under --naked).

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("DISCOVERY SURGERY (v2.21.8) — top-level --help is small", () => {
  it("`mneme --help` is < 2 KB and surfaces all 5 starter verbs", () => {
    const r = runCli(["--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeLessThan(2 * 1024);
    expect(r.stdout).toContain("verify-self");
    expect(r.stdout).toContain("ask");
    expect(r.stdout).toContain("route");
    expect(r.stdout).toContain("earthquake");
    expect(r.stdout).toContain("stillness");
  });

  it("`mneme --help` includes a token-cost receipt", () => {
    const r = runCli(["--help"], { cwd: REPO_ROOT });
    expect(r.stdout).toMatch(/help cost: ~\d+ tokens/);
  });

  it("`mneme --help --naked` strips the cost receipt + decoration", () => {
    const r = runCli(["--help", "--naked"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/help cost:/);
    // Naked still shows 5 verbs.
    expect(r.stdout).toContain("verify-self");
  });

  it("`mneme --help --full` still prints the legacy command wall (Commander)", () => {
    const r = runCli(["--help", "--full"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    // Commander's full help is large and lists many subcommands.
    expect(r.stdout.length).toBeGreaterThan(2 * 1024);
    expect(r.stdout).toContain("Commands:");
  });

  it("subcommand --help is unchanged (`mneme verify-self --help` still rich)", () => {
    const r = runCli(["verify-self", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("TRUST CAPSULE");
  });
});
