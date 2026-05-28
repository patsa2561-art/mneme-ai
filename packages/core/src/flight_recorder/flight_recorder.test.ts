/**
 * v2.80.0 — FLIGHT RECORDER pinned + QUAN (property/fuzz) tests.
 *
 *   Pinned (F):
 *     F1 record → chain verifies offline
 *     F2 truth-delta classifier (MATCH / CONTRADICT / UNVERIFIED)
 *     F3 replay pinpoints the first incident + counts
 *     F4 seal → verifySeal; wrong head rejected
 *     F5 every frame verifies over-the-wire (serialization survives)
 *
 *   QUAN (Q) — exhaustive property/fuzz invariants (the "weird" tests):
 *     Q1 N random frames → chain ALWAYS verifies (integrity invariant)
 *     Q2 tamper at EVERY position → verify ALWAYS fails (no silent pass)
 *     Q3 swap ANY two frames → chain breaks (causal order is load-bearing)
 *     Q4 a PREFIX of a chain is valid; dropping a MIDDLE frame breaks it
 *     Q5 classifyTruthDelta is total (never throws) over fuzz + deterministic
 *     Q6 seal commits the head; tampering a frame post-seal is caught
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  record, readCdr, verifyCdr, replay, seal, verifySeal, classifyTruthDelta,
  type RecordInput, type TruthDelta,
} from "./index.js";
import { verifyChain, type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-flight-"));

describe("v2.80.0 F1 — record + verify (PINNED)", () => {
  it("F1.1 a recorded sequence verifies offline + chains", () => {
    const r = repo();
    record(r, { agent: "claude", kind: "action", action: "edit file a.ts" });
    record(r, { agent: "claude", kind: "tool-call", action: "run tests", claim: "all pass", observedReality: "all pass" });
    const v = verifyCdr(r);
    expect(v.valid).toBe(true);
    expect(v.frames).toBe(2);
    expect(readCdr(r)[1]!.prev).toBe(readCdr(r)[0]!.receiptId);
  });
});

describe("v2.80.0 F2 — truth-delta classifier (PINNED)", () => {
  it("F2.1 MATCH / CONTRADICT / UNVERIFIED", () => {
    expect(classifyTruthDelta("19 vessels", "19 vessels")).toBe("MATCH");
    expect(classifyTruthDelta("the file exists", "no such file — missing")).toBe("CONTRADICT");
    expect(classifyTruthDelta("count is 400", "count is 100000")).toBe("CONTRADICT");
    expect(classifyTruthDelta("react 19 ships rsc", "react 19 ships rsc by default")).toBe("MATCH");
    expect(classifyTruthDelta("the sky is blue", "bananas are yellow")).toBe("UNVERIFIED");
    expect(classifyTruthDelta(undefined, "x")).toBe("UNVERIFIED");
  });
  it("F2.2 explicit caller verdict overrides the heuristic", () => {
    const r = repo();
    const f = record(r, { agent: "a", action: "x", claim: "same", observedReality: "same", truthDelta: "CONTRADICT" });
    expect(f.truthDelta).toBe("CONTRADICT"); // caller wins even though heuristic would MATCH
  });
});

describe("v2.80.0 F3 — replay (PINNED)", () => {
  it("F3.1 finds the first incident + counts", () => {
    const r = repo();
    record(r, { agent: "a", action: "step 1", claim: "ok", observedReality: "ok" });             // MATCH
    record(r, { agent: "a", action: "step 2" });                                                   // UNVERIFIED
    record(r, { agent: "a", action: "step 3", claim: "no bug", observedReality: "bug: refuted" }); // CONTRADICT
    record(r, { agent: "a", action: "step 4", claim: "x", observedReality: "false" });             // CONTRADICT
    const rep = replay(r);
    expect(rep.frames).toBe(4);
    expect(rep.chainValid).toBe(true);
    expect(rep.incidentSeq).toBe(2); // first CONTRADICT is seq #2 (0-indexed step 3)
    expect(rep.counts).toEqual({ match: 1, contradict: 2, unverified: 1 });
  });
});

describe("v2.80.0 F4 — seal (PINNED)", () => {
  it("F4.1 seal verifies + commits the head; a wrong head is rejected", () => {
    const r = repo();
    record(r, { agent: "a", action: "x" });
    const head = readCdr(r)[0]!.receiptId;
    const s = seal(r);
    expect(s.head).toBe(head);
    expect(verifySeal(s, head).valid).toBe(true);
    expect(verifySeal(s, "deadbeef").valid).toBe(false);
  });
});

describe("v2.80.0 F5 — over-the-wire (PINNED)", () => {
  it("F5.1 each frame verifies after JSON round-trip (third party, offline)", () => {
    const r = repo();
    record(r, { agent: "a", action: "x", reasoning: "because y" });
    record(r, { agent: "a", action: "z", claim: "c", observedReality: "c" });
    const wire: NotaryReceipt[] = JSON.parse(JSON.stringify(readCdr(r)));
    expect(verifyChain(wire).valid).toBe(true);
  });
});

// ─────────────────────────── QUAN (property / fuzz) ───────────────────────────

const KINDS = ["action", "decision", "claim", "tool-call", "payment", "observation"] as const;
function randFrame(i: number): RecordInput {
  const seedy = (n: number) => (i * 2654435761 + n * 40503) >>> 0;
  const pick = <T,>(arr: readonly T[], n: number) => arr[seedy(n) % arr.length]!;
  const withClaim = seedy(3) % 2 === 0;
  return {
    agent: pick(["claude", "gpt", "gemini", "grok", "cursor"], 1),
    kind: pick(KINDS, 2),
    action: `op-${i}-${seedy(4).toString(36)}`,
    ...(withClaim ? { claim: `claim ${seedy(5) % 100}`, observedReality: `reality ${seedy(6) % 100}` } : {}),
  };
}

describe("v2.80.0 Q1-Q4 — chain integrity invariants (QUAN)", () => {
  it("Q1 N random frames → the chain ALWAYS verifies", () => {
    const r = repo();
    const N = 40;
    for (let i = 0; i < N; i++) record(r, randFrame(i));
    const v = verifyCdr(r);
    expect(v.valid).toBe(true);
    expect(v.frames).toBe(N);
  });

  it("Q2 tampering ANY field at EVERY position → verify ALWAYS fails", () => {
    const r = repo();
    for (let i = 0; i < 12; i++) record(r, randFrame(i));
    const chain = readCdr(r);
    for (let i = 0; i < chain.length; i++) {
      // tamper the payload (action) of frame i — its signature must now fail.
      const mutated = chain.map((c, j) => j === i
        ? { ...c, payload: { ...(c.payload as object), action: "TAMPERED" } } as NotaryReceipt
        : c);
      expect(verifyChain(mutated).valid, `tamper at ${i} must fail`).toBe(false);
      // also tamper the subject (a body field outside payload)
      const mutated2 = chain.map((c, j) => j === i ? { ...c, subject: "evil" } as NotaryReceipt : c);
      expect(verifyChain(mutated2).valid, `subject tamper at ${i} must fail`).toBe(false);
    }
  });

  it("Q3 swapping ANY two frames breaks the causal chain", () => {
    const r = repo();
    for (let i = 0; i < 8; i++) record(r, randFrame(i));
    const chain = readCdr(r);
    expect(verifyChain(chain).valid).toBe(true);
    for (let i = 0; i < chain.length; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        const swapped = chain.slice();
        [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
        expect(verifyChain(swapped).valid, `swap ${i}<->${j} must break`).toBe(false);
      }
    }
  });

  it("Q4 a PREFIX is valid; dropping a MIDDLE frame breaks the chain", () => {
    const r = repo();
    for (let i = 0; i < 10; i++) record(r, randFrame(i));
    const chain = readCdr(r);
    for (let k = 1; k <= chain.length; k++) {
      expect(verifyChain(chain.slice(0, k)).valid, `prefix len ${k}`).toBe(true);
    }
    // drop a middle frame → the following frame's prev no longer matches.
    const holed = chain.filter((_, idx) => idx !== 4);
    expect(verifyChain(holed).valid).toBe(false);
  });
});

describe("v2.80.0 Q5 — truth-delta is total + deterministic (QUAN)", () => {
  it("Q5.1 never throws over fuzz inputs + is deterministic", () => {
    const samples: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < 200; i++) {
      const s = (n: number) => (((i + 1) * (n * 7 + 3)) % 13 === 0) ? undefined : `tok ${(i * n) % 97} ${(i % 3 === 0) ? "false" : "ok"} ${i % 100}`;
      samples.push([s(1), s(2)]);
    }
    for (const [a, b] of samples) {
      const v1 = classifyTruthDelta(a, b);
      const v2 = classifyTruthDelta(a, b);
      expect(["MATCH", "CONTRADICT", "UNVERIFIED"] as TruthDelta[]).toContain(v1);
      expect(v2).toBe(v1); // deterministic
    }
  });
});

describe("v2.80.0 Q6 — seal commits the head (QUAN)", () => {
  it("Q6.1 sealing then tampering a frame is caught by chain re-verify", () => {
    const r = repo();
    for (let i = 0; i < 6; i++) record(r, randFrame(i));
    const chain = readCdr(r);
    const head = chain[chain.length - 1]!.receiptId;
    const s = seal(r);
    expect(verifySeal(s, head).valid).toBe(true);
    // An attacker edits frame #2 after the seal. The seal signature still
    // verifies (it signed the OLD head), but the head it commits no longer
    // matches the tampered chain's verification — and the chain itself fails.
    const tampered = chain.map((c, j) => j === 2 ? { ...c, payload: { ...(c.payload as object), action: "edited" } } as NotaryReceipt : c);
    expect(verifyChain(tampered).valid).toBe(false);
    // The seal still commits the original head, exposing the divergence.
    expect((s.receipt.payload as { head?: string }).head).toBe(head);
  });
});
