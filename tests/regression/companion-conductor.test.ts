// v2.22.0 — TRANSACTIONAL VERB ENGINE CLI integration.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("companion + conductor (v2.22.0)", () => {
  it("`mneme verb earthquake` renders all 5 companion sections", () => {
    const r = runCli(["verb", "earthquake"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CONTRACT");
    expect(r.stdout).toContain("ARG SCHEMA");
    expect(r.stdout).toContain("STORYLINE");
    expect(r.stdout).toContain("OUTCOME STATS");
    expect(r.stdout).toContain("COMMON MISTAKES");
  });

  it("`mneme verb x --coverage` reports % per pillar", () => {
    const r = runCli(["verb", "x", "--coverage"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("COVERAGE");
    expect(r.stdout).toMatch(/contract:\s+\d+\.\d+%/);
    expect(r.stdout).toMatch(/autospec:\s+\d+\.\d+%/);
  });

  it("`mneme conduct verify trust` produces plan + preview (dry-run by default)", () => {
    const r = runCli(["conduct", "verify", "trust"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PLAN");
    expect(r.stdout).toContain("PREVIEW");
    expect(r.stdout).toContain("dry-run only");
  });

  it("`mneme conduct ...` runs cleanly even on weird input (returns plan or exit 1)", () => {
    const r = runCli(["conduct", "zzz_unmatchable_xyz_qwerty_jklm"], { cwd: REPO_ROOT });
    // Either no plan (exit 1) or a degenerate plan that runs dry — both acceptable contract.
    expect([0, 1]).toContain(r.status);
  });
});
