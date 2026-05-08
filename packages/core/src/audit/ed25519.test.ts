import { describe, expect, it } from "vitest";
import {
  generateEd25519KeyPair,
  signEd25519,
  verifyEd25519,
  signObjectEd25519,
  verifyObjectEd25519,
  compactPem,
  restorePem,
} from "./ed25519.js";

describe("ed25519 — keypair generation", () => {
  it("returns PEM-encoded keys", () => {
    const kp = generateEd25519KeyPair();
    expect(kp.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(kp.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });
  it("returns unique keys per call", () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem);
    expect(a.publicKeyPem).not.toBe(b.publicKeyPem);
  });
});

describe("ed25519 — sign + verify", () => {
  it("verify returns true for the signing keypair", () => {
    const kp = generateEd25519KeyPair();
    const sig = signEd25519("hello world", kp.privateKeyPem);
    expect(sig).toMatch(/^[0-9a-f]{128}$/); // 64 bytes = 128 hex chars
    expect(verifyEd25519("hello world", sig, kp.publicKeyPem)).toBe(true);
  });

  it("verify returns false on tampered payload", () => {
    const kp = generateEd25519KeyPair();
    const sig = signEd25519("hello world", kp.privateKeyPem);
    expect(verifyEd25519("hello WORLD", sig, kp.publicKeyPem)).toBe(false);
  });

  it("verify returns false on tampered signature", () => {
    const kp = generateEd25519KeyPair();
    const sig = signEd25519("hello world", kp.privateKeyPem);
    const tampered = sig.replace(/^./, sig[0] === "0" ? "1" : "0");
    expect(verifyEd25519("hello world", tampered, kp.publicKeyPem)).toBe(false);
  });

  it("verify returns false with wrong public key", () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    const sig = signEd25519("hello", a.privateKeyPem);
    expect(verifyEd25519("hello", sig, b.publicKeyPem)).toBe(false);
  });

  it("verify returns false on malformed signature hex", () => {
    const kp = generateEd25519KeyPair();
    expect(verifyEd25519("hello", "zzz", kp.publicKeyPem)).toBe(false);
    expect(verifyEd25519("hello", "00", kp.publicKeyPem)).toBe(false);
  });

  it("Buffer input round-trips identically to string", () => {
    const kp = generateEd25519KeyPair();
    const sig = signEd25519(Buffer.from("hello", "utf8"), kp.privateKeyPem);
    expect(verifyEd25519("hello", sig, kp.publicKeyPem)).toBe(true);
  });
});

describe("ed25519 — sign object (canonicalised)", () => {
  it("signs + verifies an object", async () => {
    const kp = generateEd25519KeyPair();
    const obj = { hash: "abc", data: { value: 42, list: [1, 2, 3] } };
    const sig = await signObjectEd25519(obj, kp.privateKeyPem);
    expect(await verifyObjectEd25519(obj, sig, kp.publicKeyPem)).toBe(true);
  });

  it("signature is invariant to key ordering (canonicalisation)", async () => {
    const kp = generateEd25519KeyPair();
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    const sigA = await signObjectEd25519(a, kp.privateKeyPem);
    const sigB = await signObjectEd25519(b, kp.privateKeyPem);
    expect(sigA).toBe(sigB); // canonical form is identical
  });

  it("verify fails on tampered field", async () => {
    const kp = generateEd25519KeyPair();
    const obj = { hash: "abc", data: 42 };
    const sig = await signObjectEd25519(obj, kp.privateKeyPem);
    expect(await verifyObjectEd25519({ hash: "abc", data: 43 }, sig, kp.publicKeyPem)).toBe(false);
  });
});

describe("ed25519 — PEM compaction round-trip", () => {
  it("compactPem strips whitespace; restorePem rebuilds", () => {
    const kp = generateEd25519KeyPair();
    const compact = compactPem(kp.publicKeyPem);
    expect(compact).not.toMatch(/\s/);
    const restored = restorePem(compact, "PUBLIC KEY");
    expect(restored).toContain("BEGIN PUBLIC KEY");
    // Round-trip works for sign + verify
    const sig = signEd25519("hello", kp.privateKeyPem);
    expect(verifyEd25519("hello", sig, restored)).toBe(true);
  });
});
