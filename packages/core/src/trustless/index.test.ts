import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofWrap, verifyToolResult, trustlessAB, trustlessGauntlet, type ProofCarrying } from "./index.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "trustless-")); }

describe("TRUSTLESS MCP — proof-carrying tool results", () => {
  it("scores 100 on its own gauntlet", () => {
    const dir = tmp();
    try {
      const g = trustlessGauntlet(dir);
      expect(g.score).toBe(100);
      expect(g.checks.every((c) => c.pass)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a genuine proof-wrapped result verifies offline", () => {
    const dir = tmp();
    try {
      const wrapped = proofWrap(dir, "demo", { tool: "x", value: 7, items: [1, 2] }, 1) as ProofCarrying;
      expect(wrapped._proof).toBeTruthy();
      const v = verifyToolResult(wrapped);
      expect(v.valid).toBe(true);
      expect(v.issuerFingerprint).toBeTruthy();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("tampering the data after signing is caught", () => {
    const dir = tmp();
    try {
      const wrapped = proofWrap(dir, "demo", { value: 7 }, 1) as Record<string, unknown>;
      wrapped["value"] = 999; // mutate after signing
      const v = verifyToolResult(wrapped);
      expect(v.valid).toBe(false);
      expect(v.reason).toMatch(/tampered/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a result with no _proof is honestly unverifiable (the status quo)", () => {
    const v = verifyToolResult({ value: 7 });
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/no _proof|unverifiable/);
  });

  it("a proof stolen from another result is rejected", () => {
    const dir = tmp();
    try {
      const a = proofWrap(dir, "demo", { a: 1 }, 1) as ProofCarrying;
      const forged = { b: 2, _proof: a._proof };
      expect(verifyToolResult(forged).valid).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("A/B is measurable: plain 0/0, proof 100%/100%", () => {
    const dir = tmp();
    try {
      const ab = trustlessAB(dir, 20);
      // A — plain results: never verifiable, never tamper-detected (must trust)
      expect(ab.plain.verifiable).toBe(0);
      expect(ab.plain.tamperDetected).toBe(0);
      // B — proof-carrying: every untampered verifies, every tampered caught
      expect(ab.proofed.verifiable).toBe(ab.trials - ab.tamperedPerGroup);
      expect(ab.proofed.tamperDetected).toBe(ab.tamperedPerGroup);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("total — never throws on garbage", () => {
    expect(() => proofWrap(tmp(), "t", null as unknown as Record<string, unknown>)).not.toThrow();
    expect(() => verifyToolResult(undefined)).not.toThrow();
    expect(verifyToolResult(undefined).valid).toBe(false);
  });
});
