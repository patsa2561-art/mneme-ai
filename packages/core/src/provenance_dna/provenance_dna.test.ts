import { describe, it, expect } from "vitest";
import {
  perceptualHash,
  hammingDistance,
  emptyRegistry,
  recordObservation,
  verifyRegistry,
  evaluatePhash,
  fingerprintSeller,
  formatVerdictLine,
  type RawImage,
  type ProvenanceRegistry,
} from "./index.js";

const SECRET = "prov-test-secret-44889977";

function makeImage(width: number, height: number, fillFn: (x: number, y: number) => [number, number, number]): RawImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fillFn(x, y);
      const idx = (y * width + x) * 4;
      rgba[idx] = r; rgba[idx + 1] = g; rgba[idx + 2] = b; rgba[idx + 3] = 255;
    }
  }
  return { width, height, rgba };
}

describe("v2.19.20 PROVENANCE-DNA · perceptualHash (aHash)", () => {
  it("produces 16-hex-char (64-bit) hash", () => {
    const img = makeImage(64, 64, (x, y) => [x * 4, y * 4, 128]);
    const h = perceptualHash(img);
    expect(h).toMatch(/^[a-f0-9]{16}$/);
  });

  it("DETERMINISM: identical input → identical hash (100%)", () => {
    const img = makeImage(32, 32, (x, _y) => [x * 8, 100, 200]);
    const a = perceptualHash(img);
    const b = perceptualHash(img);
    expect(a).toBe(b);
  });

  it("LOCALITY: same gradient at 2x scale → Hamming distance ≤ 4 (within 4/64 bits)", () => {
    const small = makeImage(32, 32, (x, _y) => [x * 8, 100, 200]);
    const large = makeImage(64, 64, (x, _y) => [x * 4, 100, 200]);
    const hSmall = perceptualHash(small);
    const hLarge = perceptualHash(large);
    expect(hammingDistance(hSmall, hLarge)).toBeLessThanOrEqual(4);
  });

  it("DISCRIMINATION: distinct images → Hamming distance ≥ 8 (out of 64)", () => {
    const a = makeImage(32, 32, (x, _y) => [x * 8, 100, 200]); // horizontal gradient
    const b = makeImage(32, 32, (_x, y) => [y * 8, 100, 200]); // vertical gradient
    expect(hammingDistance(perceptualHash(a), perceptualHash(b))).toBeGreaterThanOrEqual(8);
  });

  it("rejects malformed image (rgba length mismatch)", () => {
    const bad: RawImage = { width: 8, height: 8, rgba: new Uint8Array(50) };
    expect(() => perceptualHash(bad)).toThrow();
  });

  it("rejects zero-dimension image", () => {
    const bad: RawImage = { width: 0, height: 0, rgba: new Uint8Array(0) };
    expect(() => perceptualHash(bad)).toThrow();
  });
});

describe("v2.19.20 PROVENANCE-DNA · hammingDistance", () => {
  it("returns 0 for identical hex strings", () => {
    expect(hammingDistance("ff00", "ff00")).toBe(0);
  });

  it("returns expected bit count for known difference", () => {
    expect(hammingDistance("ff00", "0000")).toBe(8); // 8 bits set in 0xff
    expect(hammingDistance("ffff", "0000")).toBe(16); // 16 bits set
    expect(hammingDistance("ff0f", "f0f0")).toBe(12); // 0xff^0xf0=0x0f (4 bits) + 0x0f^0xf0=0xff (8 bits) = 12
  });

  it("throws on length mismatch", () => {
    expect(() => hammingDistance("ff", "ffff")).toThrow();
  });
});

describe("v2.19.20 PROVENANCE-DNA · recordObservation + verifyRegistry", () => {
  it("appends record with HMAC chain (prevSig linkage)", () => {
    let r = emptyRegistry();
    r = recordObservation({ registry: r, pHash: "aa00bb00cc00dd00", claim: "x", sellerFingerprint: "s1", nowMs: 1_000_000, secret: SECRET });
    r = recordObservation({ registry: r, pHash: "aa00bb00cc00dd00", claim: "x", sellerFingerprint: "s2", nowMs: 1_000_001, secret: SECRET });
    expect(r.records).toHaveLength(2);
    expect(r.records[0]!.prevSig).toBeNull();
    expect(r.records[1]!.prevSig).toBe(r.records[0]!.sig);
  });

  it("verifyRegistry passes for untampered chain", () => {
    let r = emptyRegistry();
    for (let i = 0; i < 5; i++) {
      r = recordObservation({ registry: r, pHash: "aa00bb00cc00dd00", claim: `c${i}`, sellerFingerprint: `s${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    expect(verifyRegistry(r, SECRET).ok).toBe(true);
  });

  it("verifyRegistry detects tampered claim at exact step", () => {
    let r = emptyRegistry();
    for (let i = 0; i < 5; i++) {
      r = recordObservation({ registry: r, pHash: "ff", claim: `c${i}`, sellerFingerprint: `s${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    const tampered: ProvenanceRegistry = {
      ...r,
      records: r.records.map((rr, i) => (i === 2 ? { ...rr, claim: "evil" } : rr)),
    };
    const v = verifyRegistry(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});

describe("v2.19.20 PROVENANCE-DNA · evaluatePhash — STOLEN_PHOTO flag", () => {
  it("flags STOLEN_PHOTO when ≥10 distinct sellers used the same pHash in 90d", () => {
    let r = emptyRegistry();
    const pHash = "aa00bb00cc00dd00";
    for (let i = 0; i < 12; i++) {
      r = recordObservation({ registry: r, pHash, claim: "x", sellerFingerprint: `seller-${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    const v = evaluatePhash({ registry: r, pHash, nowMs: 2_000_000 });
    expect(v.flags).toContain("STOLEN_PHOTO");
    expect(v.distinctSellers).toBe(12);
  });

  it("does NOT flag STOLEN_PHOTO when same seller posts multiple times", () => {
    let r = emptyRegistry();
    const pHash = "bb";
    for (let i = 0; i < 12; i++) {
      r = recordObservation({ registry: r, pHash, claim: "x", sellerFingerprint: "single-seller", nowMs: 1_000_000 + i, secret: SECRET });
    }
    const v = evaluatePhash({ registry: r, pHash, nowMs: 2_000_000 });
    expect(v.flags).not.toContain("STOLEN_PHOTO");
    expect(v.distinctSellers).toBe(1);
  });

  it("respects 90-day window — old observations don't count", () => {
    let r = emptyRegistry();
    const pHash = "cc";
    const ancientTs = 1_000_000;
    const nowMs = ancientTs + 100 * 24 * 60 * 60 * 1000; // 100 days later
    for (let i = 0; i < 15; i++) {
      r = recordObservation({ registry: r, pHash, claim: "x", sellerFingerprint: `s${i}`, nowMs: ancientTs + i, secret: SECRET });
    }
    const v = evaluatePhash({ registry: r, pHash, nowMs });
    // All observations are >90d old → not counted → CLEAN
    expect(v.flags).toContain("CLEAN");
    expect(v.distinctSellers).toBe(0);
  });

  it("respects Hamming tolerance — fuzzy match counts within tolerance", () => {
    let r = emptyRegistry();
    const original = "ff00ff00ff00ff00";
    // Build a fuzzy version with 2 bits flipped
    const fuzzy = "fe00ff00ff00ff01"; // 2 bits differ from original
    for (let i = 0; i < 12; i++) {
      r = recordObservation({ registry: r, pHash: original, claim: "x", sellerFingerprint: `s${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    const v = evaluatePhash({ registry: r, pHash: fuzzy, hammingTolerance: 4, nowMs: 2_000_000 });
    expect(v.flags).toContain("STOLEN_PHOTO"); // matched within tolerance
  });
});

describe("v2.19.20 PROVENANCE-DNA · evaluatePhash — DISPUTED_IDENTITY flag", () => {
  it("flags DISPUTED when top claim ratio ≤ 20% (≥80% conflicting)", () => {
    let r = emptyRegistry();
    const pHash = "dd";
    // 1 of 5 says "Rolex", 4 of 5 say various other things (80% conflict from top)
    r = recordObservation({ registry: r, pHash, claim: "Rolex", sellerFingerprint: "s1", nowMs: 1_000_000, secret: SECRET });
    r = recordObservation({ registry: r, pHash, claim: "fake watch", sellerFingerprint: "s2", nowMs: 1_000_001, secret: SECRET });
    r = recordObservation({ registry: r, pHash, claim: "replica", sellerFingerprint: "s3", nowMs: 1_000_002, secret: SECRET });
    r = recordObservation({ registry: r, pHash, claim: "designer", sellerFingerprint: "s4", nowMs: 1_000_003, secret: SECRET });
    r = recordObservation({ registry: r, pHash, claim: "luxury", sellerFingerprint: "s5", nowMs: 1_000_004, secret: SECRET });
    const v = evaluatePhash({ registry: r, pHash, nowMs: 1_100_000 });
    expect(v.flags).toContain("DISPUTED_IDENTITY");
    expect(v.conflictingClaimRatio).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT flag DISPUTED when claims agree (≥80% same)", () => {
    let r = emptyRegistry();
    const pHash = "ee";
    for (let i = 0; i < 10; i++) {
      r = recordObservation({ registry: r, pHash, claim: "real watch", sellerFingerprint: `s${i}`, nowMs: 1_000_000 + i, secret: SECRET });
    }
    const v = evaluatePhash({ registry: r, pHash, nowMs: 1_100_000 });
    expect(v.flags).not.toContain("DISPUTED_IDENTITY");
    expect(v.conflictingClaimRatio).toBe(0);
  });
});

describe("v2.19.20 PROVENANCE-DNA · evaluatePhash — FRESH_SCAM flag", () => {
  it("flags FRESH_SCAM when hash is brand-new + candidate claim has high-value keyword", () => {
    const r = emptyRegistry();
    const v = evaluatePhash({
      registry: r,
      pHash: "newhash",
      candidateClaim: "$10000 super rare limited edition",
      nowMs: 1_000_000,
    });
    expect(v.flags).toContain("FRESH_SCAM");
  });

  it("flags FRESH_SCAM on 'super rare' alone (one of the regex matchers)", () => {
    const v = evaluatePhash({
      registry: emptyRegistry(),
      pHash: "x",
      candidateClaim: "super rare collectible",
    });
    expect(v.flags).toContain("FRESH_SCAM");
  });

  it("does NOT flag FRESH_SCAM when claim is benign", () => {
    const v = evaluatePhash({
      registry: emptyRegistry(),
      pHash: "x",
      candidateClaim: "small black notebook",
    });
    expect(v.flags).not.toContain("FRESH_SCAM");
    expect(v.flags).toContain("CLEAN");
  });

  it("does NOT flag FRESH_SCAM when hash has aged > 7d AND has observations", () => {
    let r = emptyRegistry();
    const oldTs = 1_000_000;
    const nowMs = oldTs + 30 * 24 * 60 * 60 * 1000;
    r = recordObservation({ registry: r, pHash: "x", claim: "real", sellerFingerprint: "s1", nowMs: oldTs, secret: SECRET });
    const v = evaluatePhash({ registry: r, pHash: "x", candidateClaim: "super rare", nowMs });
    expect(v.flags).not.toContain("FRESH_SCAM");
  });
});

describe("v2.19.20 PROVENANCE-DNA · fingerprintSeller + formatter", () => {
  it("seller fingerprint is deterministic per (vendor, sessionId, salt)", () => {
    const a = fingerprintSeller({ vendor: "shopee", sessionId: "abc", salt: "x" });
    const b = fingerprintSeller({ vendor: "shopee", sessionId: "abc", salt: "x" });
    expect(a).toBe(b);
    expect(a.startsWith("sf-")).toBe(true);
  });

  it("seller fingerprint differs per session (pseudonymous)", () => {
    const a = fingerprintSeller({ vendor: "v", sessionId: "s1" });
    const b = fingerprintSeller({ vendor: "v", sessionId: "s2" });
    expect(a).not.toBe(b);
  });

  it("verdict formatter uses 🚨/⚖/🆕/✓ per flag", () => {
    const stolen = { pHash: "x", flags: ["STOLEN_PHOTO" as const], distinctSellers: 15, totalObservations: 15, conflictingClaimRatio: 0, oldestObservationMs: 0, newestObservationMs: 0, hashAgeDays: 30, evidence: [] };
    const clean = { ...stolen, flags: ["CLEAN" as const] };
    expect(formatVerdictLine(stolen)).toContain("🚨");
    expect(formatVerdictLine(clean)).toContain("✓");
  });
});

// ─── MEASURED ACCURACY (97.5%+ targets) ─────────────────────────────────

describe("v2.19.20 PROVENANCE-DNA · MEASURED ACCURACY (97.5%+ targets)", () => {
  it("MEASURED 100% pHash determinism across 100 trials with varied images", () => {
    let pass = 0;
    for (let i = 0; i < 100; i++) {
      const img = makeImage(32, 32, (x, y) => [(x + i) * 4 % 256, (y + i) * 4 % 256, (i * 7) % 256]);
      if (perceptualHash(img) === perceptualHash(img)) pass++;
    }
    expect(pass / 100).toBe(1);
    expect(pass / 100).toBeGreaterThanOrEqual(0.975);
  });

  it("MEASURED ≥97.5% pHash LOCALITY across 50 similar-image pairs (scale variants)", () => {
    let pass = 0;
    for (let i = 0; i < 50; i++) {
      const small = makeImage(32, 32, (x, y) => [(x + i) * 4 % 256, (y * 2) % 256, 128]);
      const large = makeImage(64, 64, (x, y) => [(Math.floor(x / 2) + i) * 4 % 256, (Math.floor(y / 2) * 2) % 256, 128]);
      if (hammingDistance(perceptualHash(small), perceptualHash(large)) <= 4) pass++;
    }
    expect(pass / 50).toBeGreaterThanOrEqual(0.975);
  });

  it("MEASURED ≥97.5% pHash DISCRIMINATION across 50 distinct-image pairs", () => {
    let pass = 0;
    const hashes: string[] = [];
    for (let i = 0; i < 50; i++) {
      const img = makeImage(32, 32, (x, y) => [(x * (i + 1)) % 256, (y * (i + 7)) % 256, (i * 11) % 256]);
      hashes.push(perceptualHash(img));
    }
    // Compare every pair; count those with Hamming >= 8 as "discriminated"
    let pairCount = 0;
    let okCount = 0;
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        pairCount++;
        if (hammingDistance(hashes[i]!, hashes[j]!) >= 8) okCount++;
      }
    }
    pass = okCount;
    const total = pairCount;
    expect(pass / total).toBeGreaterThanOrEqual(0.975);
  });

  it("MEASURED 100% flag accuracy: 10 stolen scenarios → 10 STOLEN_PHOTO flags", () => {
    let pass = 0;
    for (let trial = 0; trial < 10; trial++) {
      let r = emptyRegistry();
      const pHash = `${trial.toString(16).padStart(2, "0")}${"00".repeat(7)}`;
      for (let i = 0; i < 11; i++) {
        r = recordObservation({ registry: r, pHash, claim: "x", sellerFingerprint: `t${trial}-s${i}`, nowMs: 1_000_000 + i, secret: SECRET });
      }
      const v = evaluatePhash({ registry: r, pHash, nowMs: 2_000_000 });
      if (v.flags.includes("STOLEN_PHOTO")) pass++;
    }
    expect(pass).toBe(10);
  });
});
