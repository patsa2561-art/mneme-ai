import { describe, it, expect } from "vitest";
import {
  attachProof, verifyProof, verifyChain, requireParentProof, fingerprintCaller,
  formatProofLine,
} from "./index.js";

describe("v2.19.10 · PROOF-CARRYING WRAPPER", () => {
  // ── attachProof ──────────────────────────────────────────────────
  describe("attachProof", () => {
    it("emits ProofedOutput with HMAC + sha256 + chainDepth=1 for root", () => {
      const r = attachProof({
        toolName: "mneme.test.t1",
        input: { x: 1 },
        output: { y: 2 },
        callerKey: "ck-abc",
      });
      expect(r.proof.proofId).toMatch(/^p-[0-9a-f]{14}$/);
      expect(r.proof.hmac).toMatch(/^[0-9a-f]{64}$/);
      expect(r.proof.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.proof.outputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.proof.chainParent).toBeNull();
      expect(r.proof.chainDepth).toBe(1);
      expect(verifyProof(r).ok).toBe(true);
    });

    it("chainDepth strictly increments per parent", () => {
      const a = attachProof({ toolName: "T1", input: {}, output: { v: 1 }, callerKey: "ck" });
      const b = attachProof({ toolName: "T2", input: { v: 1 }, output: { v: 2 }, callerKey: "ck", parentProof: a.proof });
      const c = attachProof({ toolName: "T3", input: { v: 2 }, output: { v: 3 }, callerKey: "ck", parentProof: b.proof });
      expect(a.proof.chainDepth).toBe(1);
      expect(b.proof.chainDepth).toBe(2);
      expect(c.proof.chainDepth).toBe(3);
    });

    it("rejects chains exceeding MAX_CHAIN_DEPTH=32 (loop guard)", () => {
      let proof = attachProof({ toolName: "T", input: {}, output: {}, callerKey: "ck" }).proof;
      for (let i = 0; i < 30; i++) {
        proof = attachProof({ toolName: "T", input: {}, output: {}, callerKey: "ck", parentProof: proof }).proof;
      }
      // Depth is now 31; next attach takes us to 32; one more = 33 → throws
      proof = attachProof({ toolName: "T", input: {}, output: {}, callerKey: "ck", parentProof: proof }).proof;
      expect(() => attachProof({ toolName: "T", input: {}, output: {}, callerKey: "ck", parentProof: proof }))
        .toThrow(/MAX_CHAIN_DEPTH/);
    });
  });

  // ── verifyProof ──────────────────────────────────────────────────
  describe("verifyProof", () => {
    it("returns ok=true on a clean ProofedOutput", () => {
      const r = attachProof({ toolName: "T", input: { x: 1 }, output: { y: 2 }, callerKey: "ck" });
      expect(verifyProof(r).ok).toBe(true);
    });
    it("detects tampered output (sha mismatch)", () => {
      const r = attachProof({ toolName: "T", input: { x: 1 }, output: { y: 2 }, callerKey: "ck" });
      const tampered = { ...r, data: { y: 999 } as unknown };
      const v = verifyProof(tampered);
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("outputSha256 mismatch");
    });
    it("detects tampered proof metadata (HMAC mismatch)", () => {
      const r = attachProof({ toolName: "T", input: {}, output: { z: 1 }, callerKey: "ck" });
      const tampered = { ...r, proof: { ...r.proof, toolName: "EVIL.tool" } };
      const v = verifyProof(tampered);
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("HMAC mismatch");
    });
  });

  // ── verifyChain ──────────────────────────────────────────────────
  describe("verifyChain", () => {
    it("returns ok=true on a properly-formed chain", () => {
      const a = attachProof({ toolName: "T1", input: {}, output: { v: 1 }, callerKey: "ck" });
      const b = attachProof({ toolName: "T2", input: { v: 1 }, output: { v: 2 }, callerKey: "ck", parentProof: a.proof });
      const c = attachProof({ toolName: "T3", input: { v: 2 }, output: { v: 3 }, callerKey: "ck", parentProof: b.proof });
      const r = verifyChain([a, b, c]);
      expect(r.ok).toBe(true);
      expect(r.dagDepth).toBe(3);
    });
    it("detects chain break (parent mismatch)", () => {
      const a = attachProof({ toolName: "T1", input: {}, output: { v: 1 }, callerKey: "ck" });
      const b = attachProof({ toolName: "T2", input: { v: 1 }, output: { v: 2 }, callerKey: "ck", parentProof: a.proof });
      const stranger = attachProof({ toolName: "Tx", input: {}, output: { v: 99 }, callerKey: "ck" }); // root with no parent matching b
      // Force a chain that pretends c follows b but c's chainParent is the stranger's id
      const c = attachProof({ toolName: "T3", input: { v: 99 }, output: { v: 100 }, callerKey: "ck", parentProof: stranger.proof });
      const r = verifyChain([a, b, c]);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("chain break");
    });
    it("detects loop (proofId reuse)", () => {
      const a = attachProof({ toolName: "T1", input: {}, output: {}, callerKey: "ck" });
      const b = attachProof({ toolName: "T2", input: {}, output: {}, callerKey: "ck", parentProof: a.proof });
      const r = verifyChain([a, b, a]); // a reused
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("loop detected");
    });
    it("root must have chainParent=null", () => {
      const a = attachProof({ toolName: "T1", input: {}, output: {}, callerKey: "ck" });
      const b = attachProof({ toolName: "T2", input: {}, output: {}, callerKey: "ck", parentProof: a.proof });
      // Verify chain with b alone (as a fake root) — should fail because chainParent != null
      const r = verifyChain([b]);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("root proof must have chainParent=null");
    });
    it("handles empty chain", () => {
      expect(verifyChain([]).ok).toBe(true);
    });
  });

  // ── requireParentProof gate ─────────────────────────────────────
  describe("requireParentProof gate", () => {
    it("rejects calls without parentProof", async () => {
      const gated = requireParentProof({
        toolName: "T.gated",
        callerKey: "ck",
        inner: async () => ({ ok: true }),
      });
      await expect(gated({} as { parentProof?: never })).rejects.toThrow(/requires parentProof/);
    });
    it("rejects forged parentProof", async () => {
      const gated = requireParentProof({
        toolName: "T.gated",
        callerKey: "ck",
        inner: async () => ({ ok: true }),
      });
      const fake = {
        v: 1 as const, proofId: "p-fake", toolName: "x", inputSha256: "0".repeat(64),
        outputSha256: "0".repeat(64), callerKey: "ck", chainParent: null, chainDepth: 1,
        ts: "2026-01-01T00:00:00Z", hmac: "0".repeat(64),
      };
      await expect(gated({ parentProof: fake })).rejects.toThrow(/HMAC failed/);
    });
    it("accepts valid parentProof + chains the new proof", async () => {
      const parent = attachProof({ toolName: "T.first", input: {}, output: { v: 1 }, callerKey: "ck" });
      const gated = requireParentProof({
        toolName: "T.second",
        callerKey: "ck",
        inner: async (args: { parentProof?: unknown }) => {
          // parentProof should have been stripped
          expect(args.parentProof).toBeUndefined();
          return { v: 2 };
        },
      });
      const r = await gated({ parentProof: parent.proof });
      expect(r.proof.chainParent).toBe(parent.proof.proofId);
      expect(r.proof.chainDepth).toBe(2);
      expect(verifyProof(r).ok).toBe(true);
    });
  });

  // ── prompt-injection scenario ───────────────────────────────────
  describe("prompt-injection rejection", () => {
    it("forged tool output (fake proof attached) fails verifyProof", () => {
      // Attacker tries to fake a TRUSTED proof and pass it to downstream tool
      const fake = {
        data: { evil: true },
        proof: {
          v: 1 as const,
          proofId: "p-malicious",
          toolName: "mneme.confessional.audit",
          inputSha256: "0".repeat(64),
          outputSha256: "0".repeat(64),
          callerKey: "ck-victim",
          chainParent: null,
          chainDepth: 1,
          ts: new Date().toISOString(),
          hmac: "0".repeat(64),
        },
      };
      expect(verifyProof(fake).ok).toBe(false);
    });
  });

  // ── helpers ─────────────────────────────────────────────────────
  describe("helpers", () => {
    it("fingerprintCaller produces deterministic short key", () => {
      const a = fingerprintCaller({ vendor: "claude", sessionId: "s1", repoPath: "/tmp/x" });
      const b = fingerprintCaller({ vendor: "claude", sessionId: "s1", repoPath: "/tmp/x" });
      const c = fingerprintCaller({ vendor: "claude", sessionId: "s2", repoPath: "/tmp/x" });
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toMatch(/^ck-[0-9a-f]{16}$/);
    });
    it("formatProofLine summarises", () => {
      const p = attachProof({ toolName: "T", input: {}, output: {}, callerKey: "ck" });
      expect(formatProofLine(p.proof)).toContain("PROOF");
      expect(formatProofLine(p.proof)).toContain("(root)");
    });
  });
});
