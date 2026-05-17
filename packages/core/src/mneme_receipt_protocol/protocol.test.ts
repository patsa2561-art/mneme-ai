import { describe, it, expect } from "vitest";
import {
  mintProtocolReceipt,
  validateReceipt,
  specText,
  computeProtocolStats,
  formatProtocolLine,
  COMPAT_MATRIX,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  MNEME_RECEIPT_PROTOCOL_TUNABLES,
  type ProtocolReceipt,
} from "./index.js";

describe("v2.19.37 MNEME RECEIPT PROTOCOL — mint", () => {
  it("mintProtocolReceipt produces a VALID receipt from minimal input", () => {
    const r = mintProtocolReceipt({ vendor: "claude", modelVersion: "opus-4.7", tsMs: 1_700_000_000_000 });
    expect(r.protocol).toBe(PROTOCOL_NAME);
    expect(r.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(validateReceipt(r).verdict).toBe("VALID");
  });

  it("DETERMINISTIC: same input → same contentHash", () => {
    const input = { vendor: "gpt", modelVersion: "4o", tsMs: 1_000_000, promptText: "hi", responseText: "hello" };
    const a = mintProtocolReceipt(input);
    const b = mintProtocolReceipt(input);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("vendor coerced to lowercase + alphanumeric/_.-", () => {
    const r = mintProtocolReceipt({ vendor: "CLAUDE-Code!@#", modelVersion: "x", tsMs: 1 });
    // CLAUDE-Code!@# → lowercased → invalid chars stripped → "unknown" fallback
    expect(r.vendor).toBe("unknown");
  });

  it("outcomeClass clamped to canonical set; non-canonical → 'pending'", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: 1, outcomeClass: "INVENTED" });
    expect(r.outcomeClass).toBe("pending");
  });

  it("promptText auto-hashed if promptSha256 missing", () => {
    const r = mintProtocolReceipt({ vendor: "x", modelVersion: "y", tsMs: 1, promptText: "deterministic" });
    expect(r.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.promptSha256).not.toBe("0".repeat(64));
  });

  it("ext namespace preserved as opaque object", () => {
    const r = mintProtocolReceipt({
      vendor: "x", modelVersion: "y", tsMs: 1,
      ext: { "@my-impl/x": { meta: 1 } },
    });
    expect(r.ext).toEqual({ "@my-impl/x": { meta: 1 } });
  });

  it("DEFENSIVE: garbage input never throws + always validates", () => {
    const garbage: unknown[] = [
      {}, { vendor: 123 }, { modelVersion: null }, { tokensIn: -1 }, { costUsdMicros: NaN },
      { outcomeClass: 42 }, { controls: "not-obj" }, { ext: "string" },
    ];
    for (const g of garbage) {
      const r = mintProtocolReceipt(g as Parameters<typeof mintProtocolReceipt>[0]);
      expect(validateReceipt(r).verdict).toBe("VALID");
    }
  });
});

describe("v2.19.37 MNEME RECEIPT PROTOCOL — validate", () => {
  function freshReceipt(): ProtocolReceipt {
    return mintProtocolReceipt({ vendor: "claude", modelVersion: "opus-4.7", tsMs: 1 });
  }

  it("VALID for reference-impl receipt", () => {
    expect(validateReceipt(freshReceipt()).verdict).toBe("VALID");
  });

  it("INVALID when protocol field tampered", () => {
    const r = { ...freshReceipt(), protocol: "fake-protocol" };
    const v = validateReceipt(r);
    expect(v.verdict).toBe("INVALID");
    expect(v.issues.some((i) => i.field === "protocol")).toBe(true);
  });

  it("INVALID when protocolVersion shape wrong", () => {
    const r = { ...freshReceipt(), protocolVersion: "not-a-version" };
    const v = validateReceipt(r);
    expect(v.verdict).toBe("INVALID");
  });

  it("INVALID when vendor has spaces / special chars", () => {
    const r = { ...freshReceipt(), vendor: "Claude Inc!" };
    expect(validateReceipt(r).verdict).toBe("INVALID");
  });

  it("INVALID when promptSha256 is not 64-char hex", () => {
    const r = { ...freshReceipt(), promptSha256: "abc" };
    expect(validateReceipt(r).verdict).toBe("INVALID");
  });

  it("INVALID when tokens / cost is negative or non-integer", () => {
    const cases = [
      { ...freshReceipt(), tokensIn: -1 },
      { ...freshReceipt(), tokensOut: 1.5 },
      { ...freshReceipt(), costUsdMicros: NaN },
    ];
    for (const c of cases) expect(validateReceipt(c).verdict).toBe("INVALID");
  });

  it("INVALID when outcomeClass not in canonical set", () => {
    const r = { ...freshReceipt(), outcomeClass: "AMAZING_OUTCOME" };
    expect(validateReceipt(r).verdict).toBe("INVALID");
  });

  it("INVALID when contentHash doesn't match canonical body", () => {
    const r = { ...freshReceipt(), vendor: "evil-vendor" };
    expect(validateReceipt(r).verdict).toBe("INVALID");
    expect(validateReceipt(r).issues.some((i) => i.field === "contentHash" || i.field === "vendor")).toBe(true);
  });

  it("WARNING when unknown top-level field present (forward compat)", () => {
    const r = { ...freshReceipt(), futureField: "from v2.0" };
    // Recompute the hash to make body consistent
    const minted = mintProtocolReceipt({
      vendor: r.vendor, modelVersion: r.modelVersion, tsMs: r.tsMs,
    });
    const withFuture = { ...minted, futureField: "future" };
    // contentHash now doesn't include the futureField → mismatch + warning
    const v = validateReceipt(withFuture);
    expect(v.issues.some((i) => i.field === "futureField" && i.severity === "warning")).toBe(true);
  });

  it("INVALID for null / non-object / array", () => {
    expect(validateReceipt(null).verdict).toBe("INVALID");
    expect(validateReceipt("string").verdict).toBe("INVALID");
    expect(validateReceipt([1, 2, 3]).verdict).toBe("INVALID");
  });

  it("versionSupported true for v1.x, false otherwise", () => {
    const r = freshReceipt();
    expect(validateReceipt(r).versionSupported).toBe(true);
    const wrong = { ...r, protocolVersion: "9.0" };
    expect(validateReceipt(wrong).versionSupported).toBe(false);
  });
});

describe("v2.19.37 MNEME RECEIPT PROTOCOL — spec text + compat matrix", () => {
  it("specText emits RFC-style document with version + license + conformance sections", () => {
    const txt = specText();
    expect(txt).toContain(`Mneme Receipt Protocol v${PROTOCOL_VERSION}`);
    expect(txt).toContain("MIT");
    expect(txt).toContain("Conformance");
    expect(txt).toContain("canonicalJson");
    expect(txt).toContain("contentHash");
  });

  it("COMPAT_MATRIX has at least the reference impl", () => {
    expect(COMPAT_MATRIX.length).toBeGreaterThanOrEqual(1);
    expect(COMPAT_MATRIX[0]!.implementation).toContain("mneme-ai");
  });

  it("COMPAT_MATRIX entries list ≥16 required fields", () => {
    for (const e of COMPAT_MATRIX) expect(e.fields.length).toBeGreaterThanOrEqual(16);
  });

  it("computeProtocolStats + format line", () => {
    const s = computeProtocolStats();
    expect(s.protocolName).toBe(PROTOCOL_NAME);
    expect(formatProtocolLine(s)).toContain("PROTOCOL");
  });

  it("TUNABLES expose canonical outcomes (7 total)", () => {
    expect(MNEME_RECEIPT_PROTOCOL_TUNABLES.CANONICAL_OUTCOMES.length).toBe(7);
  });
});

describe("v2.19.37 MNEME RECEIPT PROTOCOL — A/B before vs after", () => {
  it("A: pre-v2.19.37 receipt FORMAT was tool-specific (Apostille AICallReceipt); B: now interop spec", () => {
    // The A/B IS that v2.19.37 publishes an open spec where v2.19.36 had only
    // a proprietary apostille shape. Measure: same receipt body validated by 2 different impl signatures.
    const r1 = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: 1 });
    const r2 = mintProtocolReceipt({ vendor: "claude", modelVersion: "x", tsMs: 1, implementation: "@third-party/impl@1" });
    // Both validate as VALID — interop achieved
    expect(validateReceipt(r1).verdict).toBe("VALID");
    expect(validateReceipt(r2).verdict).toBe("VALID");
    // But contentHashes differ because implementation field is part of canonical body
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });
});

describe("v2.19.37 MNEME RECEIPT PROTOCOL — 1000+ fuzz iterations", () => {
  it("1000 random mints all validate VALID", () => {
    const vendors = ["claude", "gpt", "gemini", "grok", "perplexity"];
    const outcomes = ["merged", "reverted", "blocked_by_guard", "pending"];
    for (let i = 0; i < 1000; i++) {
      const r = mintProtocolReceipt({
        vendor: vendors[i % vendors.length]!,
        modelVersion: `v${i % 7}`,
        promptText: `prompt ${i}`,
        responseText: `response ${i}`,
        tokensIn: i % 1000,
        tokensOut: i % 700,
        costUsdMicros: i * 100,
        vaccinesTriggered: i % 100 === 0 ? [`vax${i}`] : [],
        outcomeClass: outcomes[i % outcomes.length]!,
        tsMs: 1_000_000 + i,
      });
      expect(validateReceipt(r).verdict).toBe("VALID");
    }
  });
});
