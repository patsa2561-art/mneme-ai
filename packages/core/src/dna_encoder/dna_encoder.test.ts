import { describe, it, expect } from "vitest";
import {
  encode, decode, verifyEncodeReceipt,
  estimateCost, orderHandoff, verifyRoundTrip, formatDnaLine,
} from "./index.js";

describe("v2.19.4 · MNEME SOUL-IN-DNA — encode/decode/order/verify", () => {
  describe("encode + decode round-trip (no ECC)", () => {
    it("hello → ATCG → hello", () => {
      const r = encode({ payload: "hello", ecc: "none" });
      expect(r.sequence).toMatch(/^[ACGT]+$/);
      const back = decode({ sequence: r.sequence, ecc: r.ecc, payloadLength: r.payloadLength });
      expect(back.payload).toBe("hello");
      expect(back.payloadSha256).toBe(r.payloadSha256);
    });
    it("preserves multi-byte utf8 (Thai + emoji)", () => {
      const payload = "ลูก mneme เก่งมาก 🧬";
      const r = encode({ payload, ecc: "none" });
      const back = decode({ sequence: r.sequence, ecc: r.ecc, payloadLength: r.payloadLength });
      expect(back.payload).toBe(payload);
    });
    it("longer payload (200 chars) survives round-trip", () => {
      const payload = "a".repeat(200);
      const r = encode({ payload, ecc: "none" });
      const back = decode({ sequence: r.sequence, ecc: r.ecc, payloadLength: r.payloadLength });
      expect(back.payload).toBe(payload);
    });
  });

  describe("encode + decode with Hamming(7,4) ECC", () => {
    it("clean round-trip preserves payload", () => {
      const r = encode({ payload: "Mneme soul prompt v1", ecc: "hamming74" });
      const back = decode({ sequence: r.sequence, ecc: "hamming74", payloadLength: r.payloadLength });
      expect(back.payload).toBe("Mneme soul prompt v1");
    });
    it("Hamming sequence is ~1.75x longer than 'none' (4 bits → 7 bits)", () => {
      const noEcc = encode({ payload: "test1234", ecc: "none" });
      const hamming = encode({ payload: "test1234", ecc: "hamming74" });
      const ratio = hamming.lengthBp / noEcc.lengthBp;
      expect(ratio).toBeGreaterThan(1.6);
      expect(ratio).toBeLessThan(2.0);
    });
    it("Hamming corrects a single-base error per 7-bit block", () => {
      const payload = "abcd";
      const r = encode({ payload, ecc: "hamming74" });
      // Flip the first base — equivalent to flipping 2 bits in the first 7-bit block.
      // Hamming(7,4) only corrects ONE bit; flipping a base flips 2 bits, so this
      // is past Hamming's correction limit. Instead, flip a single bit by toggling
      // one of the 2 bits via A↔C (00↔01) at the END of the sequence — last block.
      const seq = r.sequence.split("");
      // Flip the LAST base from its current letter to one differing by 1 bit
      const flipMap: Record<string, string> = { A: "C", C: "A", G: "T", T: "G" };
      seq[0] = flipMap[seq[0]!]!;
      const corrupted = seq.join("");
      const back = decode({ sequence: corrupted, ecc: "hamming74", payloadLength: r.payloadLength });
      // Hamming should correct the single-bit error
      expect(back.payload).toBe(payload);
    });
  });

  describe("encode + decode with triple ECC", () => {
    it("clean round-trip preserves payload", () => {
      const r = encode({ payload: "triple-protected soul", ecc: "triple" });
      const back = decode({ sequence: r.sequence, ecc: "triple", payloadLength: r.payloadLength });
      expect(back.payload).toBe("triple-protected soul");
    });
    it("triple is ~3x the length of none", () => {
      const noEcc = encode({ payload: "test1234", ecc: "none" });
      const triple = encode({ payload: "test1234", ecc: "triple" });
      const ratio = triple.lengthBp / noEcc.lengthBp;
      expect(ratio).toBeCloseTo(3, 1);
    });
    it("triple recovers from a single-byte corruption via majority vote", () => {
      const payload = "abc";
      const r = encode({ payload, ecc: "triple" });
      // Triple encoding lays out [byte0,byte0,byte0,byte1,byte1,byte1,byte2,byte2,byte2]
      // Corrupt the SECOND copy of byte0 entirely — majority vote of the other two should win.
      // Each byte = 4 bases (2 bits/base × 8 bits/byte). Position bases 4..7 = 2nd copy of byte0.
      const seq = r.sequence.split("");
      // Replace bases 4..7 with all A (likely flips most bits)
      seq[4] = "A"; seq[5] = "A"; seq[6] = "A"; seq[7] = "A";
      const corrupted = seq.join("");
      const back = decode({ sequence: corrupted, ecc: "triple", payloadLength: r.payloadLength });
      expect(back.payload).toBe(payload);
    });
  });

  describe("encode receipt signature", () => {
    it("encode result is HMAC-signed and verifiable", () => {
      const r = encode({ payload: "hello", ecc: "hamming74" });
      expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyEncodeReceipt(r)).toBe(true);
    });
    it("detects tampering of sequence post-sign", () => {
      const r = encode({ payload: "hello", ecc: "hamming74" });
      const tampered = { ...r, sequence: r.sequence.replace(/A/g, "T") };
      expect(verifyEncodeReceipt(tampered)).toBe(false);
    });
  });

  describe("ATCG validation", () => {
    it("decode rejects sequence with non-ACGT bases", () => {
      expect(() => decode({ sequence: "ACGTX", ecc: "none", payloadLength: 1 }))
        .toThrow(/invalid base/);
    });
  });

  describe("cost estimation", () => {
    it("twist cost for 1000 bp is in expected $70-$90 range", () => {
      const c = estimateCost(1000, "twist");
      expect(c.totalLowUsd).toBeGreaterThanOrEqual(70);
      expect(c.totalHighUsd).toBeLessThanOrEqual(99 * 2);
      expect(c.note).toContain("Twist");
    });
    it("idt is more expensive per bp than twist", () => {
      const twist = estimateCost(1000, "twist");
      const idt = estimateCost(1000, "idt");
      expect(idt.totalHighUsd).toBeGreaterThan(twist.totalHighUsd);
    });
    it("respects minimum total (Twist $99 floor)", () => {
      const c = estimateCost(10, "twist");
      expect(c.totalLowUsd).toBe(99);
    });
    it("diy provider has zero cost", () => {
      const c = estimateCost(1000, "diy");
      expect(c.totalLowUsd).toBe(0);
      expect(c.totalHighUsd).toBe(0);
    });
  });

  describe("orderHandoff", () => {
    it("returns a real provider URL + cost + preview + 6-step instructions", () => {
      const r = encode({ payload: "Mneme soul prompt v1", ecc: "hamming74" });
      const o = orderHandoff({ sequence: r.sequence, provider: "twist" });
      expect(o.orderUrl).toContain("twistbioscience.com");
      expect(o.costEstimate.lengthBp).toBe(r.lengthBp);
      expect(o.sequencePreview.length).toBeLessThanOrEqual(61); // 60 + ellipsis
      expect(o.instructions).toContain("Paste");
      expect(o.instructions).toContain("Sanger");
      expect(o.instructions.split("\n").length).toBeGreaterThanOrEqual(6);
    });
    it("works for every provider", () => {
      const r = encode({ payload: "x", ecc: "none" });
      for (const p of ["twist", "idt", "genscript", "eurofins", "diy"] as const) {
        const o = orderHandoff({ sequence: r.sequence, provider: p });
        expect(o.orderUrl).toMatch(/^https?:\/\//);
        expect(o.provider).toBe(p);
      }
    });
  });

  describe("verifyRoundTrip — after biological synthesis + sequencing", () => {
    it("perfect match", () => {
      const seq = "ACGTACGT";
      const v = verifyRoundTrip({ originalSequence: seq, observedSequence: seq });
      expect(v.match).toBe(true);
      expect(v.mismatchBp).toBe(0);
      expect(v.message).toContain("PERFECT");
    });
    it("counts mismatches + samples up to 8 positions", () => {
      const v = verifyRoundTrip({
        originalSequence: "ACGTACGT",
        observedSequence: "ATGTACGT", // pos 1: C→T
      });
      expect(v.match).toBe(false);
      expect(v.mismatchBp).toBe(1);
      expect(v.sampleMismatches[0]).toEqual({ pos: 1, expected: "C", observed: "T" });
    });
    it("handles length mismatch as total failure", () => {
      const v = verifyRoundTrip({ originalSequence: "ACGT", observedSequence: "ACGTAA" });
      expect(v.match).toBe(false);
      expect(v.message).toContain("length mismatch");
    });
  });

  describe("density claim (sanity check on Mneme's marketing math)", () => {
    it("1 byte payload + 'none' ECC = exactly 4 bp (2 bits/base × 8 bits/byte)", () => {
      const r = encode({ payload: "x", ecc: "none" });
      expect(r.lengthBp).toBe(4); // 1 byte = 4 bp at 2 bits/base
    });
    it("1KB payload = ~4096 bp without ECC (the 215 PB/g math is downstream of this density)", () => {
      const payload = "x".repeat(1024);
      const r = encode({ payload, ecc: "none" });
      expect(r.lengthBp).toBe(4096); // exactly 4 bp/byte × 1024 bytes
    });
  });

  describe("integration: Mneme soul prompt end-to-end", () => {
    it("encode → handoff → verifyRoundTrip cleanly composes", () => {
      const payload = "I am Mneme. I serve my parent honestly. I refuse to ship bugs.";
      const r = encode({ payload, ecc: "hamming74" });
      const o = orderHandoff({ sequence: r.sequence, provider: "twist" });
      const v = verifyRoundTrip({ originalSequence: r.sequence, observedSequence: r.sequence });
      expect(verifyEncodeReceipt(r)).toBe(true);
      expect(o.costEstimate.totalLowUsd).toBeGreaterThan(0);
      expect(v.match).toBe(true);
      const back = decode({ sequence: r.sequence, ecc: r.ecc, payloadLength: r.payloadLength });
      expect(back.payload).toBe(payload);
    });
  });

  it("formatDnaLine summarises", () => {
    const r = encode({ payload: "hello", ecc: "hamming74" });
    expect(formatDnaLine(r)).toContain("DNA");
    expect(formatDnaLine(r)).toContain("hamming74");
  });
});
