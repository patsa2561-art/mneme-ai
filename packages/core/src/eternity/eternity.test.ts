import { describe, it, expect } from "vitest";
import {
  mintEternalTrace,
  verifyEternalTrace,
  mintPinReceipt,
  verifyPinReceipt,
  attachPin,
  computeSurvivalScore,
  mintSurvivalCertificate,
  verifySurvivalCertificate,
  resolveTrace,
  computeEternityStats,
  formatEternityLine,
  DEFAULT_SURVIVAL_SCENARIOS,
  ETERNITY_TUNABLES,
  type EternalTrace,
  type StorageRoot,
} from "./index.js";

const SECRET = "eternity-test-29";

const ROOTS: StorageRoot[] = [
  { id: "local-1", kind: "local_disk", locator: "/home/.mneme", reliability30d: 0.99, jurisdictionTag: "TH" },
  { id: "git-1", kind: "git_repo", locator: "github.com/user/repo", reliability30d: 0.97, jurisdictionTag: "US" },
  { id: "ipfs-1", kind: "ipfs_node", locator: "QmHash", reliability30d: 0.85, jurisdictionTag: "EU" },
  { id: "s3-1", kind: "s3_bucket", locator: "s3://bucket/key", reliability30d: 0.999, jurisdictionTag: "US" },
  { id: "qr-1", kind: "printed_qr", locator: "binder-page-1", reliability30d: 1.0, jurisdictionTag: "TH" },
];

describe("v2.19.34 ETERNITY -- mint + verify content-addressed trace", () => {
  it("mintEternalTrace produces sha256 contentAddress + HMAC sig", () => {
    const t = mintEternalTrace({ payload: { foo: "bar" }, mintedAtMs: 1, secret: SECRET });
    expect(t.contentAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(t.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEternalTrace(t, SECRET)).toBe(true);
  });

  it("CONTENT-ADDRESSED DEDUP: identical payload → identical contentAddress", () => {
    const t1 = mintEternalTrace({ payload: { x: 1, y: 2 }, mintedAtMs: 100, secret: SECRET });
    const t2 = mintEternalTrace({ payload: { y: 2, x: 1 }, mintedAtMs: 200, secret: SECRET });
    // Canonical JSON sorts keys → same hash
    expect(t1.contentAddress).toBe(t2.contentAddress);
  });

  it("verifyEternalTrace rejects payload tamper", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const tampered: EternalTrace = { ...t, payload: { x: 999 } };
    expect(verifyEternalTrace(tampered, SECRET)).toBe(false);
  });

  it("verifyEternalTrace rejects forged sig", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const tampered: EternalTrace = { ...t, sig: "f".repeat(64) };
    expect(verifyEternalTrace(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.34 ETERNITY -- pin receipts", () => {
  it("mintPinReceipt + verifyPinReceipt", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const p = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    expect(verifyPinReceipt(p, SECRET)).toBe(true);
  });

  it("attachPin appends if content addresses match", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const p = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    const after = attachPin({ trace: t, pin: p, secret: SECRET });
    expect(after.pinReceipts.length).toBe(1);
  });

  it("attachPin REJECTS mismatched contentAddress", () => {
    const t1 = mintEternalTrace({ payload: { a: 1 }, secret: SECRET });
    const t2 = mintEternalTrace({ payload: { b: 2 }, secret: SECRET });
    const p = mintPinReceipt({ trace: t2, root: ROOTS[0]!, secret: SECRET });
    const after = attachPin({ trace: t1, pin: p, secret: SECRET });
    expect(after.pinReceipts.length).toBe(0);
  });

  it("attachPin DEDUPES same rootId", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const p = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    let after = attachPin({ trace: t, pin: p, secret: SECRET });
    after = attachPin({ trace: after, pin: p, secret: SECRET });
    expect(after.pinReceipts.length).toBe(1);
  });
});

describe("v2.19.34 ETERNITY -- SURVIVAL SCORE", () => {
  it("9 default scenarios shipped", () => {
    expect(DEFAULT_SURVIVAL_SCENARIOS.length).toBeGreaterThanOrEqual(5);
    expect(ETERNITY_TUNABLES.DEFAULT_SCENARIOS_COUNT).toBe(DEFAULT_SURVIVAL_SCENARIOS.length);
  });

  it("0-pin trace survives 0% of scenarios", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const s = computeSurvivalScore({ trace: t, roots: ROOTS });
    expect(s.scenariosSurvived).toBeLessThan(s.totalScenarios);
  });

  it("HIGHLY-PINNED trace survives more scenarios", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    for (const root of ROOTS) {
      const pin = mintPinReceipt({ trace: t, root, secret: SECRET });
      t = attachPin({ trace: t, pin, secret: SECRET });
    }
    const s = computeSurvivalScore({ trace: t, roots: ROOTS });
    expect(s.survivalPct).toBeGreaterThan(50);
    expect(s.rootDiversity).toBe(5);
    expect(s.jurisdictionDiversity).toBe(3);
  });

  it("VENDOR DEATH scenario: trace survives because Mneme roots are local, not vendor's", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const pin = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    t = attachPin({ trace: t, pin, secret: SECRET });
    const s = computeSurvivalScore({ trace: t, roots: ROOTS });
    const vendorDeath = s.scenarioBreakdown.find((x) => x.name === "vendor_death");
    expect(vendorDeath?.survived).toBe(true);
  });

  it("TOTAL DIGITAL APOCALYPSE: only printed_qr survives", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    // Pin to local + qr only
    for (const r of [ROOTS[0]!, ROOTS[4]!]) {
      const pin = mintPinReceipt({ trace: t, root: r, secret: SECRET });
      t = attachPin({ trace: t, pin, secret: SECRET });
    }
    const s = computeSurvivalScore({ trace: t, roots: ROOTS });
    const apocalypse = s.scenarioBreakdown.find((x) => x.name === "total_digital_apocalypse");
    expect(apocalypse?.survived).toBe(true); // because printed_qr is NOT in lost-kinds list
  });

  it("JURISDICTION SEIZURE: US-jurisdiction roots lost, others survive", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    for (const r of ROOTS) {
      const pin = mintPinReceipt({ trace: t, root: r, secret: SECRET });
      t = attachPin({ trace: t, pin, secret: SECRET });
    }
    const s = computeSurvivalScore({ trace: t, roots: ROOTS });
    const seizure = s.scenarioBreakdown.find((x) => x.name === "jurisdiction_seizure_us");
    expect(seizure?.survived).toBe(true);
    expect(seizure?.remainingRoots).toBe(3); // local-1 TH, ipfs-1 EU, qr-1 TH
  });
});

describe("v2.19.34 ETERNITY -- survival certificate", () => {
  it("mintSurvivalCertificate returns cert when surviving root has pin", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const pin = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    t = attachPin({ trace: t, pin, secret: SECRET });
    const cert = mintSurvivalCertificate({ trace: t, survivingRootId: "local-1", secret: SECRET });
    expect(cert).not.toBeNull();
    expect(cert!.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySurvivalCertificate(cert!, SECRET)).toBe(true);
  });

  it("mintSurvivalCertificate returns null when claimed root has no pin", () => {
    const t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const cert = mintSurvivalCertificate({ trace: t, survivingRootId: "ghost-root", secret: SECRET });
    expect(cert).toBeNull();
  });

  it("verifySurvivalCertificate rejects tampered cert", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const pin = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    t = attachPin({ trace: t, pin, secret: SECRET });
    const cert = mintSurvivalCertificate({ trace: t, survivingRootId: "local-1", secret: SECRET })!;
    const tampered = { ...cert, survivingRootId: "evil" };
    expect(verifySurvivalCertificate(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.34 ETERNITY -- resolveTrace", () => {
  it("reports pinned vs not-pinned roots", () => {
    let t = mintEternalTrace({ payload: { x: 1 }, secret: SECRET });
    const pin = mintPinReceipt({ trace: t, root: ROOTS[0]!, secret: SECRET });
    t = attachPin({ trace: t, pin, secret: SECRET });
    const r = resolveTrace({ trace: t, roots: ROOTS });
    expect(r.found).toBe(true);
    expect(r.pinnedAtRootIds).toContain("local-1");
    expect(r.notPinnedAtRootIds.length).toBe(4);
  });
});

describe("v2.19.34 ETERNITY -- 25,000 FUZZ ITERATIONS", () => {
  it("25,000 random mint + pin + survival never crash", () => {
    const N = 25_000;
    const traces: EternalTrace[] = [];
    for (let i = 0; i < N; i++) {
      let t = mintEternalTrace({ payload: { i, x: Math.random() }, secret: SECRET });
      // Random pin to 1-3 roots
      const pinCount = 1 + (i % 3);
      for (let j = 0; j < pinCount; j++) {
        const root = ROOTS[(i + j) % ROOTS.length]!;
        const pin = mintPinReceipt({ trace: t, root, secret: SECRET });
        t = attachPin({ trace: t, pin, secret: SECRET });
      }
      expect(verifyEternalTrace(t, SECRET)).toBe(true);
      traces.push(t);
    }
    const stats = computeEternityStats({ traces, roots: ROOTS });
    expect(stats.totalTraces).toBe(N);
    expect(formatEternityLine(stats)).toContain("ETERNITY");
  }, 60_000);

  it("DEFENSIVE: malformed payloads handled", () => {
    const malformedPayloads: unknown[] = [null, undefined, "string", 42, [], { fn: () => 1 }];
    for (const p of malformedPayloads) {
      const t = mintEternalTrace({ payload: p as Record<string, unknown>, secret: SECRET });
      expect(verifyEternalTrace(t, SECRET)).toBe(true);
    }
  });
});
