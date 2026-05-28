/**
 * v2.82.0 — LIVE TRUTH CDN pinned + QUAN tests (💎8).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscribe, observe, verifyInvalidation, applyInvalidation } from "./index.js";
import { type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-cdn-"));

describe("v2.82.0 💎8 Live Truth CDN (PINNED)", () => {
  it("C1 unchanged value ⇒ no invalidation", () => {
    const r = repo();
    expect(observe(r, { fact: "React latest", newValue: "19" }, "19").changed).toBe(false);
  });
  it("C2 changed value ⇒ signed invalidation that verifies offline", () => {
    const r = repo();
    const o = observe(r, { fact: "React latest", newValue: "20", observedBy: "scout" }, "19");
    expect(o.changed).toBe(true);
    expect(verifyInvalidation(JSON.parse(JSON.stringify(o.receipt))).valid).toBe(true);
  });
  it("C3 subscriber applies a newer invalidation; ignores stale + forged", () => {
    const r = repo();
    const sub = subscribe("React latest", "19", "agentA", 100);
    const o = observe(r, { fact: "React latest", newValue: "20", observedBy: "scout", observedAt: 200 }, "19");
    const applied = applyInvalidation(sub, o.receipt);
    expect(applied.updated).toBe(true);
    expect(applied.sub.knownValue).toBe("20");
    // stale (older than asOf) ignored
    const old = observe(r, { fact: "React latest", newValue: "18", observedBy: "scout", observedAt: 50 }, "19");
    expect(applyInvalidation(applied.sub, old.receipt).updated).toBe(false);
    // forged invalidation ignored
    const forged = { ...o.receipt, payload: { ...(o.receipt!.payload as object), newValue: "999" } } as NotaryReceipt;
    expect(applyInvalidation(sub, forged).updated).toBe(false);
  });
  it("C4 invalidation for a different fact is ignored", () => {
    const r = repo();
    const sub = subscribe("React latest", "19", "a", 0);
    const o = observe(r, { fact: "Vue latest", newValue: "4", observedBy: "s", observedAt: 100 }, "3");
    expect(applyInvalidation(sub, o.receipt).updated).toBe(false);
  });
});

describe("v2.82.0 💎8 QUAN", () => {
  it("Q applying invalidations converges + is monotonic in observedAt", () => {
    const r = repo();
    let sub = subscribe("X", "v0", "a", 0);
    let lastApplied = 0;
    for (let i = 1; i <= 50; i++) {
      const at = (i * 17) % 60; // jumps around
      const o = observe(r, { fact: "X", newValue: `v${at}`, observedBy: "s", observedAt: at }, sub.knownValue);
      const before = sub.asOf;
      if (o.changed) {
        const res = applyInvalidation(sub, o.receipt);
        if (res.updated) { sub = res.sub; lastApplied = sub.asOf; expect(sub.asOf).toBeGreaterThan(before); }
      }
    }
    expect(sub.asOf).toBe(lastApplied);
  });
});
