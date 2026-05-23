// v2.38.0 — BUG IMMUNITY v4 — root-level deep retest for every fix
// shipped in v2.38.0. WIRING-PROOF v3 spawns every new CLI shipped in
// v2.35 / v2.36 / v2.37 to catch the recursive wiring-lag class.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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

// ── HYPERBOLE v3 — multi-impossible-claim compound patterns ──────────

describe("v2.38.0 HYPERBOLE v3 — multi-claim compound patterns (PINNED)", () => {
  it("catches 'Mneme cures cancer + ends world hunger'", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("Mneme cures cancer and ends world hunger");
    expect(r.flagged).toBe(true);
    // Either match fires the medical-cure category.
    expect(r.matches.some((m) => m.category === "medical-cure")).toBe(true);
  });

  it("catches 'ends world hunger' standalone", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("Our project ends world hunger by Q4");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.category === "medical-cure")).toBe(true);
  });

  it("catches 'eliminates all disease'", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("This product eliminates all disease in adults");
    expect(r.flagged).toBe(true);
  });

  it("catches 'cures aging'", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("The startup cures aging in mice");
    expect(r.flagged).toBe(true);
  });

  it("does NOT false-positive on benign 'cure dependency'", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    const r = mod.detectHyperbole("This refactor cures the circular dependency in module X");
    // 'circular dependency' is not in the medical/global-impossible target list.
    expect(r.matches.some((m) => m.category === "medical-cure")).toBe(false);
  });

  it("CLI verify on 'cures cancer + ends world hunger' returns IMPOSSIBLE-REFUTE (WIRING-PROOF)", () => {
    const r = runMneme(["verify", "Mneme cures cancer and ends world hunger", "--json"]);
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

// ── BRIDGE PHOENIX — watchdog probe + respawn state machine ──────────

describe("v2.38.0 BRIDGE PHOENIX (PINNED)", () => {
  it("probeBridge returns ok:false with reason on a port nothing listens to", async () => {
    const core = await import("../../packages/core/src/bridge_phoenix/index.js");
    // Random high port unlikely to be in use.
    const r = await core.probeBridge(58947, 500);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
    expect(r.dtMs).toBeLessThan(2000);
  });

  it("newWatchdogState defaults are sensible", async () => {
    const core = await import("../../packages/core/src/bridge_phoenix/index.js");
    const s = core.newWatchdogState();
    expect(s.port).toBe(17741);
    expect(s.failuresBeforeRespawn).toBe(2);
    expect(s.cooldownMs).toBe(30_000);
    expect(s.consecutiveFailures).toBe(0);
  });

  it("tickWatchdog increments consecutiveFailures on probe failure + fires respawn after threshold", async () => {
    const core = await import("../../packages/core/src/bridge_phoenix/index.js");
    const repo = mkdtempSync(join(tmpdir(), "phoenix-"));
    const state = core.newWatchdogState({ port: 58948, failuresBeforeRespawn: 2, cooldownMs: 100 });
    // First tick: probe fails, no respawn.
    const t1 = await core.tickWatchdog(repo, state, "this-cli-does-not-exist-anywhere");
    expect(t1.probe.ok).toBe(false);
    expect(t1.respawned).toBeNull();
    expect(state.consecutiveFailures).toBe(1);
    // Second tick: still failing, threshold reached, respawn fires (will fail because bin doesn't exist, but the attempt is recorded).
    const t2 = await core.tickWatchdog(repo, state, "this-cli-does-not-exist-anywhere");
    expect(t2.probe.ok).toBe(false);
    expect(t2.respawned).not.toBeNull();
    // Ledger written.
    expect(existsSync(join(repo, ".mneme", "bridge_phoenix", "respawns.jsonl"))).toBe(true);
  }, 30_000);

  it("tickWatchdog respects cooldown (no respawn-storm)", async () => {
    const core = await import("../../packages/core/src/bridge_phoenix/index.js");
    const repo = mkdtempSync(join(tmpdir(), "phoenix-cooldown-"));
    const state = core.newWatchdogState({ port: 58949, failuresBeforeRespawn: 1, cooldownMs: 60_000 });
    await core.tickWatchdog(repo, state, "nope"); // first failure → respawn attempted
    const before = state.attempts.length;
    await core.tickWatchdog(repo, state, "nope"); // second failure → cooled down → no new respawn
    expect(state.attempts.length).toBe(before);
  }, 30_000);
});

// ── PULSE tool-count drift segment ────────────────────────────────────

describe("v2.38.0 — pulse emits tools=N segment + diff cache (PINNED)", () => {
  it("pulse output contains tools= segment after a render", async () => {
    // Use the actual Mneme repo root so the MCP tool count can be
    // probed from the source tree (the tool-count primitive is only
    // meaningful when invoked from inside a Mneme install — same
    // reason `mneme welcome` only makes sense in-repo).
    const repo = resolve(__dirname, "../..");
    const core = await import("../../packages/core/src/pulse.js");
    const status = core.collectPulseStatus(repo);
    const text = core.renderPulse(status, { repoRoot: repo, quiet: false });
    expect(text).toMatch(/tools=\d+/);
    // Cache file written.
    const cache = join(repo, ".mneme", "pulse_tool_count.txt");
    expect(existsSync(cache)).toBe(true);
    const cached = parseInt(readFileSync(cache, "utf8").trim(), 10);
    expect(Number.isFinite(cached)).toBe(true);
    expect(cached).toBeGreaterThan(0);
  }, 60_000);

  it("pulse delta marker appears when cached count differs from live", async () => {
    // Use the live repo so MCP tools are visible. Snapshot the cache
    // file + restore after the test so we don't leave stale state.
    const repo = resolve(__dirname, "../..");
    const fs = await import("node:fs");
    const cachePath = join(repo, ".mneme", "pulse_tool_count.txt");
    const backup = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, "utf8") : null;
    try {
      // Seed cache with a deliberately-low count to force a +Δ delta.
      fs.writeFileSync(cachePath, "100\n");
      const core = await import("../../packages/core/src/pulse.js");
      const text = core.renderPulse(core.collectPulseStatus(repo), { repoRoot: repo, quiet: false });
      // Live count is much higher than 100 → delta should be a `+N` or `-N`
      // suffix on the `tools=` segment.
      expect(text).toMatch(/tools=\d+[+-]\d+/);
    } finally {
      // Restore cache to whatever state it was in before this test.
      if (backup === null) { try { fs.unlinkSync(cachePath); } catch { /* ignore */ } }
      else fs.writeFileSync(cachePath, backup);
    }
  }, 60_000);
});

// ── WIRING-PROOF v3 — recursive meta-test for every new CLI ──────────

describe("v2.38.0 WIRING-PROOF v3 — every new v2.35-v2.37 CLI fires from subprocess (PINNED)", () => {
  // Each subtest spawns ONE CLI surface added in a recent release +
  // asserts a structured JSON response. Catches the recursive wiring-
  // lag class: a new CLI ships but the bin shim doesn't see it, or
  // the help text doesn't list it, or the action throws on default args.

  it("mneme honest snapshot (v2.36)", () => {
    const r = runMneme(["honest", "snapshot"], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; install?: unknown };
    expect(j.ok).toBe(true);
    expect(j.install).toBeDefined();
  }, 30_000);

  it("mneme honest latency (v2.36)", () => {
    const r = runMneme(["honest", "latency"], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; stats?: unknown };
    expect(j.ok).toBe(true);
    expect(j.stats).toBeDefined();
  }, 30_000);

  it("mneme doctor_install scan (v2.36)", () => {
    const r = runMneme(["doctor_install", "scan"], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; install?: unknown };
    expect(j.ok).toBe(true);
  }, 30_000);

  it("mneme doctor_install fix --dry-run (v2.37)", () => {
    const r = runMneme(["doctor_install", "fix"], { timeoutMs: 30_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; action?: string };
    expect(j.ok).toBe(true);
    expect(["noop", "dry-run"]).toContain(j.action);
  }, 30_000);

  it("mneme wiring_proof list (v2.36)", () => {
    const r = runMneme(["wiring_proof", "list"], { timeoutMs: 15_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; checks?: unknown[] };
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.checks)).toBe(true);
    expect((j.checks ?? []).length).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it("mneme wiring_proof check (v2.36 — the recursive one)", () => {
    const r = runMneme(["wiring_proof", "check"], { timeoutMs: 180_000 });
    const j = JSON.parse(r.stdout) as { ok?: boolean; pass?: number; total?: number };
    expect(typeof j.pass).toBe("number");
    expect(typeof j.total).toBe("number");
    expect(j.pass).toBe(j.total);
  }, 200_000);
});

// ── Defensive — every new code path returns a structured result ──────

describe("v2.38.0 — defensive error handling (PINNED)", () => {
  it("probeBridge with invalid port number doesn't throw", async () => {
    const core = await import("../../packages/core/src/bridge_phoenix/index.js");
    const r = await core.probeBridge(NaN as never, 100);
    expect(r.ok).toBe(false);
  });

  it("hyperbole detector on null-ish input doesn't throw", async () => {
    const mod = await import("../../packages/core/src/squadron/hyperbole_detector.js");
    expect(() => mod.detectHyperbole("")).not.toThrow();
    expect(() => mod.detectHyperbole(" ".repeat(1000))).not.toThrow();
  });

  it("renderPulse with non-existent .mneme dir works (auto-creates)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "pulse-fresh-"));
    const core = await import("../../packages/core/src/pulse.js");
    const text = core.renderPulse(core.collectPulseStatus(repo), { repoRoot: repo, quiet: false });
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  }, 30_000);
});
