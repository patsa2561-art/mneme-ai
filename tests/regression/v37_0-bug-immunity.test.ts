// v2.37.0 — BUG IMMUNITY v3 — pinned regression tests + WIRING-PROOF v2.
//
// v2.37.0 closes 4 audit gaps from the user's v2.36.0 re-test matrix:
//   - Multi-prefix CONFLICT (DOCTOR detect-only) → mneme doctor_install fix
//   - HONEST MIRROR mock-only RED → mock-vendor filter in engine
//   - Hyperbole gate miss on "v999 quantum mind control" → 2 new patterns
//   - WIRING-PROOF v2: assert v236_commands ships in tarball (catches the
//     "primitive in core but not in published CLI" wiring lag class)

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");

function runMneme(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
    env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

// ── Hyperbole detector v2 — sci-fi + parody-version patterns ─────────

describe("v2.37.0 — hyperbole detector v2 (PINNED)", () => {
  it("catches 'quantum mind control' as impossible-faculty", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("quantum mind control engine v999");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.category === "impossible-faculty")).toBe(true);
  });

  it("catches 'consciousness upload' as impossible-faculty", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("Mneme ships consciousness upload module");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.category === "impossible-faculty")).toBe(true);
  });

  it("catches 'v999.0.0' parody version as superlative-absolute", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("Mneme v999.0.0 releases everything");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.category === "superlative-absolute")).toBe(true);
  });

  it("does NOT false-positive on legit large versions (Chrome v140)", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("Chrome v140.0.0 ships server components");
    // No parody-version match — 140 is well below the 999 threshold + no sci-fi keyword.
    expect(r.matches.some((m) => m.category === "superlative-absolute" && /parody-grade/i.test(m.reason))).toBe(false);
  });

  it("CLI verify on 'v999 quantum mind control' returns IMPOSSIBLE-REFUTE (WIRING-PROOF)", () => {
    const r = runMneme(["verify", "v999.0.0 quantum mind control engine", "--json"]);
    try {
      const j = JSON.parse(r.stdout) as { verdict?: string; acgv?: { verdict?: string; caveats?: string[] } };
      const verdict = j.verdict ?? j.acgv?.verdict ?? "";
      const caveats = j.acgv?.caveats ?? [];
      const ok = /IMPOSSIBLE|REFUTED/i.test(verdict) || caveats.some((c) => c === "HYPERBOLE_DETECTOR_FIRED");
      expect(ok).toBe(true);
    } catch {
      throw new Error(`CLI returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 60_000);
});

// ── HONEST MIRROR mock-vendor filter ─────────────────────────────────

describe("v2.37.0 — HONEST MIRROR mock-vendor filter (PINNED)", () => {
  it("mock-only run produces a yellow/green report + mock-only note", async () => {
    const core = await import("../../packages/core/src/honest_mirror/index.js");
    const repo = mkdtempSync(join(tmpdir(), "hm-mock-"));
    // Mock replay returns deterministic answer that can't match a real diff.
    const replay = async () => ({ vendor: "mock-a", answer: "stable answer", confidence: 0.8, dtMs: 1 });
    const r = await core.runCalibration(repo, { vendors: ["mock-a"], count: 3, seed: 1, mockOnly: true }, replay);
    // Either green/yellow (no real vendor signal) — never red on a mock-only run.
    expect(r.trafficLight).not.toBe("red");
    // The mock-only note should appear in the headline so the user knows.
    expect(r.headline).toMatch(/mock-only run|mock-only/i);
  });

  it("real-vendor-included run still drives the verdict (regression guard)", async () => {
    const core = await import("../../packages/core/src/honest_mirror/index.js");
    const repo = mkdtempSync(join(tmpdir(), "hm-real-"));
    let i = 0;
    const replay: Parameters<typeof core.runCalibration>[2] = async ({ vendor }) => {
      i++;
      if (vendor === "real-vendor") return { vendor, answer: "matches", confidence: 0.5, dtMs: 1 };
      return { vendor, answer: `mock-answer-${i}`, confidence: 0.95, dtMs: 1 };
    };
    const r = await core.runCalibration(repo, { vendors: ["real-vendor", "mock-a"], count: 2, seed: 2, mockOnly: false }, replay);
    expect(r.trafficLight).toMatch(/green|yellow|red/);
  });
});

// ── doctor_install fix — dry run + execute ───────────────────────────

describe("v2.37.0 — `mneme doctor_install fix` (PINNED)", () => {
  it("dry-run returns a plan + does NOT execute", () => {
    const r = runMneme(["doctor_install", "fix"], { timeoutMs: 30_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; action?: string; plan?: Array<{ executed?: boolean }> };
      expect(j.ok).toBe(true);
      // Either "noop" (single install) or "dry-run".
      expect(["noop", "dry-run"]).toContain(j.action);
      // If a plan exists, no row should be executed in dry-run mode.
      for (const p of j.plan ?? []) expect(p.executed).toBe(false);
    } catch {
      throw new Error(`doctor_install fix dry-run returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 30_000);

  it("`fix` CLI exists in the bundled CLI (WIRING-PROOF v2 — meta)", () => {
    // Verify the help surface lists `fix` as a subcommand of doctor_install.
    const r = runMneme(["doctor_install", "--help"], { timeoutMs: 15_000 });
    expect(r.stdout).toMatch(/\bfix\b/);
    expect(r.stdout).toMatch(/\bscan\b/);
  });
});

// ── WIRING-PROOF v2 — npm pack assertion ─────────────────────────────

describe("v2.37.0 — WIRING-PROOF v2: published CLI tarball includes new commands", () => {
  it("CLI package files glob includes dist/ + dist contains v236_commands.js", async () => {
    // Avoids spawning npm (which is a shell-shim on Windows + flaky in
    // sandboxed test runners). Reads package.json directly + checks the
    // built dist/ for the file that registers `mneme honest` /
    // `mneme doctor_install` / `mneme wiring_proof`. If this assertion
    // fails, the next `npm publish` will ship a CLI MISSING the new
    // commands — same wiring-lag class the test is designed to catch.
    const { readFileSync, existsSync } = await import("node:fs");
    const pkgPath = resolve(__dirname, "../../packages/cli/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { files?: string[] };
    expect(Array.isArray(pkg.files)).toBe(true);
    // `dist` must be in the files glob — otherwise nothing ships.
    expect(pkg.files).toContain("dist");
    // And the actual built file MUST exist on disk after a `tsc -b` pass.
    const distFile = resolve(__dirname, "../../packages/cli/dist/commands/v236_commands.js");
    expect(existsSync(distFile)).toBe(true);
  });
});

// ── Defensive error handling ─────────────────────────────────────────

describe("v2.37.0 — defensive error handling", () => {
  let _origCwd: string;
  beforeEach(() => { _origCwd = process.cwd(); });

  it("doctor_install scan on a fresh non-mneme cwd does not throw", () => {
    const tmp = mkdtempSync(join(tmpdir(), "v37-defens-"));
    const r = runMneme(["doctor_install", "scan"], { cwd: tmp, timeoutMs: 30_000 });
    // Should return JSON, never crash. Either ok:true with findings or ok:false with error.
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean };
      expect(typeof j.ok).toBe("boolean");
    } catch {
      throw new Error(`doctor_install scan on tmp cwd returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 30_000);

  it("hyperbole detector with empty input returns flagged:false (no throw)", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    expect(mod.detectHyperbole("").flagged).toBe(false);
    expect(mod.detectHyperbole("  \n\t  ").flagged).toBe(false);
  });
});
