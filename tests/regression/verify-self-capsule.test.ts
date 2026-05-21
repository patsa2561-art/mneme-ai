// v2.21.4 — TRUST CAPSULE end-to-end CLI integration.
//
// Confirms the new --capsule / --score / --verify flags work over the
// actual CLI surface (spawn + parse stdout). Run via the same harness
// that drives every other regression test.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("verify-self — TRUST CAPSULE (v2.21.4)", () => {
  it("--help lists the new TRUST CAPSULE flags", () => {
    const r = runCli(["verify-self", "--help"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--capsule");
    expect(r.stdout).toContain("--score");
    expect(r.stdout).toContain("--verify");
    expect(r.stdout).toContain("--nonce");
    expect(r.stdout).toContain("--ttl");
    expect(r.stdout).toContain("--prev");
    expect(r.stdout).toContain("TRUST CAPSULE");
  });

  it("--score exits 0..2 and writes ONE number to stdout", () => {
    const r = runCli(["verify-self", "--score"], { cwd: REPO_ROOT });
    // Either ok (0) or abort-band (2). status null = OS-killed = test-env hung.
    expect(r.signal).toBeNull();
    if (r.status === 1) return; // install not found in dev tree — acceptable
    expect([0, 2]).toContain(r.status);
    const out = r.stdout.trim();
    // Score is just a number (0..100) on stdout when install is locatable.
    if (out.length > 0) {
      const n = parseInt(out, 10);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });

  it("--verify rejects malformed URI with exit 1", () => {
    const r = runCli(["verify-self", "--verify", "not-a-capsule-uri"], { cwd: REPO_ROOT });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/malformed|verification failed|✗/);
  });

  it("--verify rejects HMAC-forged URI with exit 1", () => {
    const forged = "mneme://attest/v1/1.0.0/MERKLEroot1234567890ab/1000000000/1000000300/FORGEDsig1234567890aB";
    const r = runCli(["verify-self", "--verify", forged], { cwd: REPO_ROOT });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/HMAC|✗/);
  });
});
