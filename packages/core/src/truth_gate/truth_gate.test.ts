// v2.27.0 — TRUTH GATE unit tests (discrete root tests covering every logic branch).

import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { CLAIM_CATALOG, ALL_PROBES, probeById } from "./index.js";
import { verifyMatrix, reconcileAll, __resetTruthChainForTest } from "./engine.js";
import type { TruthMatrix } from "./types.js";

describe("truth_gate — claim catalog", () => {
  it("every claim has a probeId that exists", () => {
    for (const claim of CLAIM_CATALOG) {
      const probe = probeById(claim.probeId);
      expect(probe, `no probe for claim ${claim.id} → ${claim.probeId}`).toBeDefined();
    }
  });

  it("every claim has source + text + kind + severity", () => {
    for (const c of CLAIM_CATALOG) {
      expect(c.source.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
      expect(["numeric", "boolean", "string", "shape"]).toContain(c.kind);
      expect(["info", "warn", "block"]).toContain(c.severity);
    }
  });

  it("numeric claims declare asserted value + op", () => {
    for (const c of CLAIM_CATALOG) {
      if (c.kind === "numeric") {
        expect(c.asserted).toBeDefined();
        expect(typeof c.asserted!.value).toBe("number");
        expect(["<", "<=", ">", ">=", "=", "~="]).toContain(c.asserted!.op);
      }
    }
  });

  it("boolean claims declare asserted value", () => {
    for (const c of CLAIM_CATALOG) {
      if (c.kind === "boolean") {
        expect(c.asserted).toBeDefined();
        expect([0, 1]).toContain(c.asserted!.value);
      }
    }
  });

  it("at least 10 claims in the catalog", () => {
    expect(CLAIM_CATALOG.length).toBeGreaterThanOrEqual(10);
  });
});

describe("truth_gate — probes", () => {
  it("each probe id is unique", () => {
    const ids = new Set(ALL_PROBES.map((p) => p.id));
    expect(ids.size).toBe(ALL_PROBES.length);
  });

  it("each probe has description + kind + run function", () => {
    for (const p of ALL_PROBES) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(typeof p.run).toBe("function");
      expect(["numeric", "boolean", "string", "shape"]).toContain(p.kind);
    }
  });
});

describe("truth_gate — verifyMatrix", () => {
  function badMatrix(): TruthMatrix {
    return {
      spec: { name: "MNEME-TRUTH-GATE", version: "1.0" },
      scannedAt: "2026-05-22T00:00:00.000Z",
      cwd: "tmp",
      totalClaims: 0,
      entries: [],
      summary: { pass: 0, drift: 0, refuted: 0, unmeasured: 0, truthScore: 0 },
      headline: "test",
      trafficLight: "yellow",
      hmac: "deadbeef".repeat(8),
      seq: 1,
      bodyDigest: "feedface".repeat(8),
    };
  }
  beforeEach(() => __resetTruthChainForTest());

  it("rejects a tampered matrix (bad bodyDigest)", () => {
    expect(verifyMatrix(badMatrix()).ok).toBe(false);
  });
});

// ── v3.141 THE HONESTY CONTRACT ──────────────────────────────────────
// The gap that let v3.140 ship a "drift 0" headline that was actually 1:
// NOTHING ran reconcileAll against the real repo with the SAME {cwd} ctx the
// CLI/MCP use. This block is that guard — and the seed of the CI honesty-gate.
// The contract is drift===0 && refuted===0 (no FALSE public claim). "unmeasured"
// is honest (a runtime artifact may be absent in a fresh checkout) and is NOT
// enforced here — only that the gate never STAMPS something the evidence denies.
describe("truth_gate — THE HONESTY CONTRACT (real-repo reconcile)", () => {
  beforeEach(() => __resetTruthChainForTest());
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const runnable = existsSync(join(repoRoot, "packages", "cli", "package.json"));

  it("★ the real repo has ZERO drift and ZERO refuted claims (else a public claim is lying)", async () => {
    if (!runnable) return; // detached/partial checkout — gate runs in the monorepo
    const m = await reconcileAll({ cwd: repoRoot });
    const id = (e: { claim: { id: string } }) => e.claim.id;
    expect(m.entries.filter((e) => e.verdict === "drift").map(id), "DRIFTED claims — fix or retire").toEqual([]);
    expect(m.entries.filter((e) => e.verdict === "refuted").map(id), "REFUTED claims — the evidence denies these").toEqual([]);
    expect(m.trafficLight).toBe("green");
  }, 120_000);
});
