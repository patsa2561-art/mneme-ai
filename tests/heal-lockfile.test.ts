// Minimal smoke test for scripts/heal-lockfile.mjs.
// Verifies: --dry-run on the real lockfile reports zero drift after
// v1.23.5's manual patch + every release. If a future release lets
// drift slip back in, this test fails LOUDLY before publish.
//
// Why a vitest spec rather than a node:test: keeps it inside the
// existing `npm test` gate, no extra runner config, and leverages
// vitest's snapshot diff if drift IS reported.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("scripts/heal-lockfile.mjs", () => {
  const script = resolve(process.cwd(), "scripts/heal-lockfile.mjs");

  it("script file exists", () => {
    expect(existsSync(script)).toBe(true);
  });

  it("--dry-run on the current lockfile reports no drift", () => {
    const r = spawnSync(process.execPath, [script, "--dry-run"], {
      encoding: "utf8",
      timeout: 90_000,
      cwd: process.cwd(),
    });
    expect(r.status).toBe(0);
    // Either zero drift, or `found N drifted` -- we WANT zero.
    expect(r.stdout).toContain("no integrity drift detected");
  }, 90_000);
});
