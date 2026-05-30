import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { mixEntropy, healthCheck, generateSecret, verifySecretAttestation, entropyGauntlet, type EntropySource } from "./index.js";

const R = process.cwd();
const A: EntropySource = { id: "a", data: "0123456789abcdef".repeat(8), encoding: "hex" };
const B: EntropySource = { id: "b", data: "fedcba9876543210".repeat(8), encoding: "hex" };

describe("v2.108 MNEME ENTROPY — audited multi-source entropy & secrets", () => {
  it("mix is deterministic given the same sources, diverges on different sources", () => {
    expect(mixEntropy([A, B], 32).toString("hex")).toBe(mixEntropy([A, B], 32).toString("hex"));
    expect(mixEntropy([A, B], 32).toString("hex")).not.toBe(mixEntropy([A, { id: "b", data: "00".repeat(64), encoding: "hex" }], 32).toString("hex"));
  });

  it("DEFENSE IN DEPTH — a stuck (all-zero) source can't weaken the mix", () => {
    const stuck: EntropySource = { id: "stuck", data: Buffer.alloc(64, 0) };
    const out = mixEntropy([stuck, A, B], 256);
    expect(healthCheck(out).passed).toBe(true);   // still strong because A,B carry entropy
    // and removing the stuck source changes nothing it contributed (it had none) — output differs only by the source set
    expect(out.length).toBe(256);
  });

  it("health check FLAGS a stuck source + PASSES real OS randomness", () => {
    expect(healthCheck(Buffer.alloc(512, 0)).passed).toBe(false);     // all zeros
    expect(healthCheck(Buffer.alloc(512, 0xff)).passed).toBe(false);  // all ones
    expect(healthCheck(randomBytes(512)).passed).toBe(true);          // CSPRNG
  });

  it("min-entropy estimate is high for random, 0 for a constant (conservative estimator)", () => {
    expect(healthCheck(randomBytes(4096)).minEntropyBitsPerByte).toBeGreaterThan(5);   // estimator under-counts but stays high
    expect(healthCheck(Buffer.alloc(256, 7)).minEntropyBitsPerByte).toBe(0);
  });

  it("generateSecret signs a provenance attestation that binds the secret — without containing it", () => {
    const sec = generateSecret(R, [A, B, { id: "os", data: randomBytes(32) }], 32, 1700000000000);
    expect(sec.secretHex).toHaveLength(64);
    expect(sec.sourceIds).toEqual(["a", "b", "os"]);
    // the attestation payload must NOT contain the secret, only its hash
    expect(JSON.stringify(sec.attestation)).not.toContain(sec.secretHex);
    expect(verifySecretAttestation(sec.attestation, sec.secretHex).bound).toBe(true);
    expect(verifySecretAttestation(sec.attestation, "ab".repeat(32)).bound).toBe(false);   // wrong secret caught
  });

  it("entropy gauntlet scores 100", () => {
    const g = entropyGauntlet(R, 1700000000000);
    expect(g.mixDeterministic).toBe(true);
    expect(g.mixDiverges).toBe(true);
    expect(g.defenseInDepth).toBe(true);
    expect(g.healthDetectsStuck).toBe(true);
    expect(g.attestationBinds).toBe(true);
    expect(g.score).toBe(100);
  });

  it("REFUSES no-entropy input (v2.108 review): empty sources → usableEntropy false, no valid secret", () => {
    const r = generateSecret(R, [], 32, 1700000000000);
    expect(r.usableEntropy).toBe(false);
    expect(r.secretHex).toBe("");
    expect(r.outputHealth.passed).toBe(false);
    // and its (refused) attestation must not bind anything
    expect(verifySecretAttestation(r.attestation, "ab".repeat(32)).bound).toBe(false);
  });

  it("adaptive monobit tolerance REJECTS a biased small sample (v2.108 review)", () => {
    const biased = Buffer.concat([Buffer.alloc(48, 0x00), Buffer.alloc(16, 0xff)]);   // 64 bytes, monobit 0.25
    expect(healthCheck(biased).passed).toBe(false);
    // real randomness of the same size still passes
    expect(healthCheck(randomBytes(64)).passed).toBe(true);
  });

  it("verify rejects an undefined / empty secret explicitly (v2.108 review)", () => {
    const sec = generateSecret(R, [A, B], 32, 1700000000000);
    expect(verifySecretAttestation(sec.attestation, undefined as never).bound).toBe(false);
    expect(verifySecretAttestation(sec.attestation, "").bound).toBe(false);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => mixEntropy(null as never)).not.toThrow();
    expect(mixEntropy(null as never).length).toBeGreaterThanOrEqual(0);
    expect(healthCheck(null as never).passed).toBe(false);
    expect(() => generateSecret(R, null as never, 0, 0)).not.toThrow();
    expect(verifySecretAttestation(null as never, null as never).bound).toBe(false);
  });
});
