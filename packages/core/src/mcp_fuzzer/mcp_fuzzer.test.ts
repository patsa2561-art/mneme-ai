// v2.24.0 — MCP fuzzer unit tests.

import { describe, it, expect } from "vitest";
import { VECTORS_108, VECTOR_COUNT } from "./vectors.js";
import { verifyReport, __resetFuzzChainForTest, renderShort } from "./engine.js";
import type { ReportCard } from "./types.js";

describe("MCP fuzzer — vector catalog", () => {
  it("has exactly 108 vectors", () => {
    expect(VECTOR_COUNT).toBe(108);
    expect(VECTORS_108.length).toBe(108);
  });

  it("vector ids are unique", () => {
    const ids = new Set(VECTORS_108.map((v) => v.id));
    expect(ids.size).toBe(108);
  });

  it("each category has exactly 12 vectors", () => {
    const cats: Record<string, number> = {};
    for (const v of VECTORS_108) cats[v.category] = (cats[v.category] ?? 0) + 1;
    for (const c of ["handshake", "schema", "method", "tool", "resource", "prompt", "policy", "concurrency", "transport"]) {
      expect(cats[c]).toBe(12);
    }
  });

  it("each vector has a non-empty title + spec + detector", () => {
    for (const v of VECTORS_108) {
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.spec.length).toBeGreaterThan(0);
      expect(typeof v.detector).toBe("function");
      expect(Array.isArray(v.payload)).toBe(true);
      expect(v.payload.length).toBeGreaterThan(0);
    }
  });

  it("severity ladder is bounded", () => {
    const allowed = new Set(["info", "low", "medium", "high", "critical"]);
    for (const v of VECTORS_108) expect(allowed.has(v.severity)).toBe(true);
  });

  it("CVE references are well-formed when present", () => {
    for (const v of VECTORS_108) {
      if (!v.cve) continue;
      for (const c of v.cve) {
        expect(c).toMatch(/^CVE-\d{4}-\d+$/);
      }
    }
  });

  it("at least one vector cites each audit-finding class", () => {
    // M1 initialize handshake
    expect(VECTORS_108.find((v) => v.id === "vec-h01")).toBeDefined();
    // M2 unknown-tool isError
    expect(VECTORS_108.find((v) => v.id === "vec-t01")).toBeDefined();
    // M3 honeypot gate
    expect(VECTORS_108.find((v) => v.id === "vec-y01")).toBeDefined();
    // M16 stderr — covered by engine; not a vector
    // transport robustness
    expect(VECTORS_108.find((v) => v.id === "vec-x01")).toBeDefined();
  });
});

describe("MCP fuzzer — HMAC chain", () => {
  function fakeCard(seq: number, hmac: string, bodyDigest: string): ReportCard {
    return {
      spec: { name: "MCP-FUZZER", version: "1.0" },
      target: "tmp",
      startedAt: "2026-05-22T00:00:00.000Z",
      finishedAt: "2026-05-22T00:00:01.000Z",
      totalMs: 1000,
      results: [],
      summary: {
        total: 0, pass: 0, warn: 0, fail: 0, inconclusive: 0,
        bySeverity: {
          info: { pass: 0, fail: 0 }, low: { pass: 0, fail: 0 },
          medium: { pass: 0, fail: 0 }, high: { pass: 0, fail: 0 }, critical: { pass: 0, fail: 0 },
        },
        byCategory: {
          handshake: { pass: 0, fail: 0 }, schema: { pass: 0, fail: 0 }, method: { pass: 0, fail: 0 },
          tool: { pass: 0, fail: 0 }, resource: { pass: 0, fail: 0 }, prompt: { pass: 0, fail: 0 },
          policy: { pass: 0, fail: 0 }, concurrency: { pass: 0, fail: 0 }, transport: { pass: 0, fail: 0 },
        },
      },
      wisdom: { headline: "test", trafficLight: "green", remediations: [], cvePosture: [], mutationsForNextRun: [] },
      hmac,
      seq,
      bodyDigest,
    };
  }

  it("verifyReport detects tampered bodyDigest", () => {
    __resetFuzzChainForTest();
    const card = fakeCard(1, "abcd", "deadbeef");
    // Force a wrong digest
    const v = verifyReport(card, "0".repeat(64));
    expect(v.ok).toBe(false);
  });
});

describe("MCP fuzzer — renderShort", () => {
  function blankCard(): ReportCard {
    return {
      spec: { name: "MCP-FUZZER", version: "1.0" },
      target: "tmp",
      startedAt: "2026-05-22T00:00:00.000Z",
      finishedAt: "2026-05-22T00:00:01.000Z",
      totalMs: 1234,
      results: [],
      summary: {
        total: 108, pass: 105, warn: 3, fail: 0, inconclusive: 0,
        bySeverity: {
          info: { pass: 0, fail: 0 }, low: { pass: 0, fail: 0 },
          medium: { pass: 0, fail: 0 }, high: { pass: 0, fail: 0 }, critical: { pass: 0, fail: 0 },
        },
        byCategory: {
          handshake: { pass: 12, fail: 0 }, schema: { pass: 12, fail: 0 }, method: { pass: 12, fail: 0 },
          tool: { pass: 12, fail: 0 }, resource: { pass: 12, fail: 0 }, prompt: { pass: 12, fail: 0 },
          policy: { pass: 12, fail: 0 }, concurrency: { pass: 12, fail: 0 }, transport: { pass: 12, fail: 0 },
        },
      },
      wisdom: { headline: "✅ CLEAN", trafficLight: "green", remediations: [], cvePosture: [], mutationsForNextRun: [] },
      hmac: "feedface".repeat(8),
      seq: 1,
      bodyDigest: "deadbeef".repeat(8),
    };
  }

  it("renders a single-line headline + summary block", () => {
    const lines = renderShort(blankCard());
    expect(lines[0]).toContain("CLEAN");
    const text = lines.join("\n");
    expect(text).toContain("pass=105");
    expect(text).toContain("fail=0");
    expect(text).toContain("MCP-FUZZER");
  });
});
