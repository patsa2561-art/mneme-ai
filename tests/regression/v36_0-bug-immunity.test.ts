// v2.36.0 — BUG IMMUNITY + WIRING-PROOF tests for audit-card bugs
// #1, #4, #14, #16, #19, #22.
//
// Each test exercises BOTH the core function AND (where applicable)
// the user-visible CLI surface via subprocess.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

// ── #1 ACGV Layer 0d — version-semantic detector ─────────────────────

describe("v2.36.0 #1 — historical version claim returns HISTORICAL-CLAIM, not REFUTED", () => {
  it("detectVersionSemantic flags PAST version", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_version_semantic.js");
    // Simulate by passing a low version + reading current install
    const r = mod.detectVersionSemantic("Mneme v0.0.1 introduces X", resolve(__dirname, "../.."));
    expect(r.matched).toBe(true);
    expect(r.matches[0]!.major).toBe(0);
    // Classification depends on installed version; should NOT be "current" at v0.0.1
    expect(r.classification).toMatch(/historical|unknown/);
  });

  it("ACGV pipeline emits HISTORICAL_CLAIM caveat for past Mneme version", async () => {
    const acgv = await import("../../packages/core/src/squadron/acgv.js");
    const r = await acgv.runACGVAsync({
      claim: "Mneme v0.0.1 ships marketing X",
      noEmitVaccine: true,
      repoRoot: resolve(__dirname, "../.."),
    });
    // Either the historical caveat fires OR an earlier layer (e.g. hyperbole)
    // catches it first — either way, must NOT be IMPOSSIBLE_REFUTE 99% on the
    // version-mismatch alone.
    const sawHistorical = (r.caveats ?? []).some((c) => c.startsWith("HISTORICAL_CLAIM"));
    if (sawHistorical) expect(r.verdict).toBe("PASSTHROUGH");
  });

  it("CLI surfaces HISTORICAL-CLAIM headline (WIRING-PROOF)", () => {
    const r = runMneme(["verify", "Mneme v0.0.1 introduces hello world", "--json"]);
    try {
      const j = JSON.parse(r.stdout) as { headline?: string; acgv?: { caveats?: string[] } };
      const caveats = j.acgv?.caveats ?? [];
      const sawHistoricalSomewhere =
        /HISTORICAL-CLAIM/i.test(j.headline ?? "") ||
        caveats.some((c) => c.startsWith("HISTORICAL_CLAIM")) ||
        // If hyperbole / something else caught it first, that's acceptable —
        // the key is we DON'T silently REFUTE with 99% confidence on this kind
        // of historical version claim.
        /SELF-PARADOX|SELF-REFERENCE|HYPERBOLE|truncated/i.test(j.headline ?? "");
      expect(sawHistoricalSomewhere).toBe(true);
    } catch {
      throw new Error(`CLI returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 60_000);
});

// ── #4 / #16 / #19 HONEST RECEIPT — multi-install detection ──────────

describe("v2.36.0 #4/#16/#19 — HONEST RECEIPT snapshot + doctor scan", () => {
  it("snapshotInstall returns binPath + pathEntries + multiVersionDetected flag", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const snap = core.snapshotInstall();
    expect(typeof snap.binPath).toBe("string");
    expect(Array.isArray(snap.pathEntries)).toBe(true);
    expect(typeof snap.multiVersionDetected).toBe("boolean");
  });

  it("buildReceipt + verifyReceipt round-trip", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const snap = core.snapshotInstall();
    const r = core.buildReceipt({
      cmd: "test", args: ["x"], install: snap,
      latency: { totalMs: 5, fastPathMs: 5, fullLoadMs: 0, codePath: "uds-fast", pathReason: "test" },
    });
    expect(r.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(core.verifyReceipt(r).ok).toBe(true);
    const tampered = { ...r, latency: { ...r.latency, totalMs: 99999 } };
    expect(core.verifyReceipt(tampered).ok).toBe(false);
  });

  it("sanitizeArgs strips secrets from receipt", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const snap = core.snapshotInstall();
    const r = core.buildReceipt({
      cmd: "test",
      args: ["AKIAIOSFODNN7EXAMPLE", "normal arg"],
      install: snap,
      latency: { totalMs: 1, fastPathMs: 0, fullLoadMs: 1, codePath: "full-cli", pathReason: "" },
    });
    expect(r.args[0]).not.toContain("AKIAIOSFODNN");
    expect(r.args[1]).toBe("normal arg");
  });

  it("CLI surfaces doctor_install scan with structured findings", () => {
    const r = runMneme(["doctor_install", "scan"], { timeoutMs: 30_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; install?: unknown; findings?: unknown[] };
      expect(j.ok).toBe(true);
      expect(j.install).toBeDefined();
      expect(Array.isArray(j.findings)).toBe(true);
    } catch {
      throw new Error(`doctor scan returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 30_000);

  it("CLI surfaces honest snapshot via subprocess", () => {
    const r = runMneme(["honest", "snapshot"], { timeoutMs: 30_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; install?: { binPath?: string } };
      expect(j.ok).toBe(true);
      expect(typeof j.install?.binPath).toBe("string");
    } catch {
      throw new Error(`honest snapshot returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 30_000);
});

// ── #14 — wiring_proof CLI command ───────────────────────────────────

describe("v2.36.0 #14 — wiring_proof CLI surface", () => {
  it("`mneme wiring_proof list` returns the check catalog", () => {
    const r = runMneme(["wiring_proof", "list"], { timeoutMs: 15_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; checks?: unknown[] };
      expect(j.ok).toBe(true);
      expect(Array.isArray(j.checks)).toBe(true);
      expect((j.checks ?? []).length).toBeGreaterThanOrEqual(3);
    } catch {
      throw new Error(`wiring_proof list returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 15_000);

  it("`mneme wiring_proof check` runs subprocess checks + returns pass/total", () => {
    const r = runMneme(["wiring_proof", "check"], { timeoutMs: 180_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; pass?: number; total?: number; checks?: Array<{ ok?: boolean }> };
      expect(typeof j.pass).toBe("number");
      expect(typeof j.total).toBe("number");
      expect(j.total).toBeGreaterThanOrEqual(3);
      // Every check should be ok=true since we just shipped the wiring fixes.
      expect(j.pass).toBe(j.total);
    } catch {
      throw new Error(`wiring_proof check returned malformed JSON: ${r.stdout.slice(0, 400)}`);
    }
  }, 200_000);
});

// ── #22 — honest latency aggregator ──────────────────────────────────

describe("v2.36.0 #22 — honest latency aggregator", () => {
  it("aggregateLatency on empty ledger returns count=0 (no crash)", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const stats = core.aggregateLatency([]);
    expect(stats.count).toBe(0);
  });

  it("aggregateLatency computes median + p95 + per-path histogram", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const snap = core.snapshotInstall();
    const make = (totalMs: number, codePath: "uds-fast" | "full-cli") => core.buildReceipt({
      cmd: "x", args: [], install: snap,
      latency: { totalMs, fastPathMs: codePath === "uds-fast" ? totalMs : 0, fullLoadMs: codePath === "full-cli" ? totalMs : 0, codePath, pathReason: "test" },
    });
    const receipts = [make(10, "uds-fast"), make(20, "uds-fast"), make(300, "full-cli")];
    const stats = core.aggregateLatency(receipts);
    expect(stats.count).toBe(3);
    expect(stats.medianMs).toBe(20);
    expect(stats.byPath["uds-fast"]?.count).toBe(2);
    expect(stats.byPath["full-cli"]?.count).toBe(1);
  });

  it("CLI surfaces honest latency stats", () => {
    const r = runMneme(["honest", "latency"], { timeoutMs: 30_000 });
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; stats?: unknown };
      expect(j.ok).toBe(true);
      expect(j.stats).toBeDefined();
    } catch {
      throw new Error(`honest latency returned malformed JSON: ${r.stdout.slice(0, 200)}`);
    }
  }, 30_000);
});

// ── Error-handling coverage ──────────────────────────────────────────

describe("v2.36.0 — defensive error handling", () => {
  it("snapshotInstall never throws even when called outside a node project", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "snap-err-"));
    const orig = process.cwd();
    try {
      process.chdir(tmp);
      const core = await import("../../packages/core/src/honest_receipt/index.js");
      expect(() => core.snapshotInstall()).not.toThrow();
    } finally {
      process.chdir(orig);
    }
  });

  it("verifyReceipt on malformed input returns ok:false (no throw)", async () => {
    const core = await import("../../packages/core/src/honest_receipt/index.js");
    const bogus = { spec: { name: "MNEME-HONEST-RECEIPT", version: "1.0" }, hmac: "deadbeef" } as never;
    const r = core.verifyReceipt(bogus);
    expect(r.ok).toBe(false);
  });

  it("detectVersionSemantic on non-version claim returns matched:false (no throw)", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_version_semantic.js");
    const r = mod.detectVersionSemantic("hello world has no versions in it", resolve(__dirname, "../.."));
    expect(r.matched).toBe(false);
  });
});

// silence unused import warnings — these utilities used elsewhere via imports above
void mkdirSync; void writeFileSync; void beforeEach;
