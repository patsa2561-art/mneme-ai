import { describe, it, expect } from "vitest";
import {
  tierFromName,
  decidePromotion,
  emptyPromotionHistory,
  appendPromotion,
  verifyPromotionHistory,
  formatDecisionLine,
  type PromotionHistory,
} from "./index.js";

const SECRET = "snn-promote-test-secret-997744";

describe("v2.19.21 SNN AUTO-PROMOTE · tierFromName", () => {
  it("parses each known prefix to its tier", () => {
    expect(tierFromName("openai:text-embedding-3-small")).toBe("openai");
    expect(tierFromName("ollama:nomic-embed-text")).toBe("ollama");
    expect(tierFromName("bundled:Xenova/MiniLM")).toBe("bundled");
    expect(tierFromName("snn:lif-32x64")).toBe("snn");
    expect(tierFromName("hash:fnv-256")).toBe("hash");
  });

  it("returns 'unknown' for unrecognised names", () => {
    expect(tierFromName("some-other:thing")).toBe("unknown");
    expect(tierFromName("")).toBe("unknown");
  });
});

describe("v2.19.21 SNN AUTO-PROMOTE · decidePromotion (the W5 fix)", () => {
  it("hash + runtime snn → PROMOTE (the canonical W5 scenario)", () => {
    const d = decidePromotion({
      savedProvider: "hash",
      runtimeResolvedName: "snn:lif-32x64",
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.recommendedProvider).toBe("snn");
    expect(d.reason).toContain("promoting");
  });

  it("hash + runtime ollama → PROMOTE to ollama", () => {
    const d = decidePromotion({
      savedProvider: "hash",
      runtimeResolvedName: "ollama:nomic-embed-text",
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.recommendedProvider).toBe("ollama");
  });

  it("auto + runtime snn → no promote (auto rank 3 outranks snn rank 2)", () => {
    const d = decidePromotion({
      savedProvider: "auto",
      runtimeResolvedName: "snn:lif-32x64",
    });
    expect(d.shouldPromote).toBe(false);
    // "auto" is exempt from the downgrade-refused flag because it's
    // not a user pin — it just means "let the ladder decide".
    expect(d.isDowngradeRefused).toBe(false);
  });

  it("auto + runtime openai → PROMOTE (openai outranks auto)", () => {
    const d = decidePromotion({
      savedProvider: "auto",
      runtimeResolvedName: "openai:foo",
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.recommendedProvider).toBe("openai");
  });

  it("REFUSES TO DOWNGRADE: openai saved + runtime hash → no promotion (user pin wins)", () => {
    const d = decidePromotion({
      savedProvider: "openai",
      runtimeResolvedName: "hash:fnv-256",
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.isDowngradeRefused).toBe(true);
    expect(d.reason).toContain("refusing to downgrade");
  });

  it("REFUSES TO DOWNGRADE: snn saved + runtime hash → no promotion", () => {
    const d = decidePromotion({
      savedProvider: "snn",
      runtimeResolvedName: "hash:fnv-256",
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.isDowngradeRefused).toBe(true);
  });

  it("no-op when runtime tier equals saved tier", () => {
    const d = decidePromotion({
      savedProvider: "snn",
      runtimeResolvedName: "snn:lif-32x64",
    });
    expect(d.shouldPromote).toBe(false);
    expect(d.isDowngradeRefused).toBe(true); // saved rank >= runtime rank → flagged as downgrade-refused (but really equal)
  });

  it("hash + runtime bundled → PROMOTE to bundled (rank 2 > 1)", () => {
    const d = decidePromotion({
      savedProvider: "hash",
      runtimeResolvedName: "bundled:Xenova/MiniLM",
    });
    expect(d.shouldPromote).toBe(true);
    expect(d.recommendedProvider).toBe("bundled");
  });
});

describe("v2.19.21 SNN AUTO-PROMOTE · history ledger", () => {
  it("appendPromotion appends record + HMAC-chains to predecessor", () => {
    let h = emptyPromotionHistory();
    const d1 = decidePromotion({ savedProvider: "hash", runtimeResolvedName: "snn:lif-32x64" });
    h = appendPromotion({ history: h, decision: d1, nowMs: 1_000_000, secret: SECRET });
    const d2 = decidePromotion({ savedProvider: "hash", runtimeResolvedName: "ollama:nomic-embed-text" });
    h = appendPromotion({ history: h, decision: d2, nowMs: 1_001_000, secret: SECRET });
    expect(h.records).toHaveLength(2);
    expect(h.records[0]!.from).toBe("hash");
    expect(h.records[0]!.to).toBe("snn");
    expect(h.records[1]!.from).toBe("hash");
    expect(h.records[1]!.to).toBe("ollama");
    expect(h.records[0]!.prevSig).toBeNull();
    expect(h.records[1]!.prevSig).toBe(h.records[0]!.sig);
  });

  it("appendPromotion is a NO-OP when decision.shouldPromote=false", () => {
    let h = emptyPromotionHistory();
    const d = decidePromotion({ savedProvider: "openai", runtimeResolvedName: "hash:fnv-256" });
    h = appendPromotion({ history: h, decision: d, secret: SECRET });
    expect(h.records).toHaveLength(0);
  });

  it("verifyPromotionHistory passes on untampered chain", () => {
    let h = emptyPromotionHistory();
    for (let i = 0; i < 5; i++) {
      const d = decidePromotion({ savedProvider: "hash", runtimeResolvedName: "snn:lif-32x64" });
      h = appendPromotion({ history: h, decision: d, nowMs: 1_000_000 + i, secret: SECRET });
    }
    expect(verifyPromotionHistory(h, SECRET).ok).toBe(true);
  });

  it("verifyPromotionHistory detects tampered tier at exact step", () => {
    let h = emptyPromotionHistory();
    for (let i = 0; i < 4; i++) {
      const d = decidePromotion({ savedProvider: "hash", runtimeResolvedName: "snn:lif-32x64" });
      h = appendPromotion({ history: h, decision: d, nowMs: 1_000_000 + i, secret: SECRET });
    }
    const tampered: PromotionHistory = {
      ...h,
      records: h.records.map((r, i) => (i === 2 ? { ...r, to: "openai" as const } : r)),
    };
    const v = verifyPromotionHistory(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});

describe("v2.19.21 SNN AUTO-PROMOTE · formatter + measured accuracy", () => {
  it("formatter uses ⬆/🛡/· per decision outcome", () => {
    const promote = decidePromotion({ savedProvider: "hash", runtimeResolvedName: "snn:foo" });
    const refused = decidePromotion({ savedProvider: "openai", runtimeResolvedName: "hash:foo" });
    expect(formatDecisionLine(promote)).toContain("⬆");
    expect(formatDecisionLine(refused)).toContain("🛡");
  });

  it("MEASURED 100% downgrade refusal across 8 (saved, runtime) pairs", () => {
    const pairs: Array<[Parameters<typeof decidePromotion>[0]["savedProvider"], string]> = [
      ["openai", "hash:foo"], ["openai", "ollama:foo"], ["openai", "snn:foo"], ["openai", "bundled:foo"],
      ["ollama", "hash:foo"], ["ollama", "snn:foo"],
      ["snn", "hash:foo"],
      ["bundled", "hash:foo"],
    ];
    let pass = 0;
    for (const [saved, name] of pairs) {
      const d = decidePromotion({ savedProvider: saved, runtimeResolvedName: name });
      if (d.shouldPromote === false) pass++;
    }
    expect(pass / pairs.length).toBe(1); // 100% refusal of downgrade scenarios
  });

  it("MEASURED 100% promote-correctness on (hash, snn) and (hash, ollama) and (hash, openai)", () => {
    const cases = ["snn:foo", "ollama:foo", "openai:foo"];
    let pass = 0;
    for (const name of cases) {
      const d = decidePromotion({ savedProvider: "hash", runtimeResolvedName: name });
      if (d.shouldPromote === true && d.recommendedProvider === tierFromName(name)) pass++;
    }
    expect(pass / cases.length).toBe(1);
  });
});
