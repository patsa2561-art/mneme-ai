/**
 * vault — AES-256-GCM encryption tests.
 *
 * Covers: round-trip · tampered ciphertext rejection · wrong passphrase
 * rejection · short passphrase rejection · version mismatch rejection ·
 * envelope detection · unique nonce/salt per call · constant-time compare.
 */

import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  isVaultEnvelope,
  constantTimeEqual,
  VAULT_INFO,
  type VaultEnvelope,
} from "./vault.js";

const PASSPHRASE = "world-class-passphrase-2026";
const SHORT = "shortpass";

describe("vault — encrypt/decrypt round-trip", () => {
  it("encrypts and decrypts a simple string", () => {
    const env = encrypt("hello, mneme", PASSPHRASE);
    expect(decrypt(env, PASSPHRASE)).toBe("hello, mneme");
  });

  it("handles empty string", () => {
    const env = encrypt("", PASSPHRASE);
    expect(decrypt(env, PASSPHRASE)).toBe("");
  });

  it("handles unicode (Thai + emoji)", () => {
    const plaintext = "สวัสดี Mneme 🔒 🇹🇭";
    const env = encrypt(plaintext, PASSPHRASE);
    expect(decrypt(env, PASSPHRASE)).toBe(plaintext);
  });

  it("handles large payload (1MB)", () => {
    const big = "x".repeat(1024 * 1024);
    const env = encrypt(big, PASSPHRASE);
    expect(decrypt(env, PASSPHRASE)).toBe(big);
  });
});

describe("vault — security guarantees", () => {
  it("nonce is unique per encrypt call (no GCM reuse)", () => {
    const a = encrypt("same plaintext", PASSPHRASE);
    const b = encrypt("same plaintext", PASSPHRASE);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
  });

  it("ciphertext differs even with identical input + passphrase", () => {
    const a = encrypt("same", PASSPHRASE);
    const b = encrypt("same", PASSPHRASE);
    expect(a.ct).not.toBe(b.ct);
  });

  it("rejects tampered ciphertext", () => {
    const env = encrypt("secret", PASSPHRASE);
    const ctBuf = Buffer.from(env.ct, "base64");
    ctBuf[0] ^= 0xff; // flip first byte
    const tampered: VaultEnvelope = { ...env, ct: ctBuf.toString("base64") };
    expect(() => decrypt(tampered, PASSPHRASE)).toThrow(/wrong passphrase or tampered data/);
  });

  it("rejects tampered auth tag", () => {
    const env = encrypt("secret", PASSPHRASE);
    const tagBuf = Buffer.from(env.tag, "base64");
    tagBuf[0] ^= 0xff;
    const tampered: VaultEnvelope = { ...env, tag: tagBuf.toString("base64") };
    expect(() => decrypt(tampered, PASSPHRASE)).toThrow(/wrong passphrase or tampered data/);
  });

  it("rejects wrong passphrase", () => {
    const env = encrypt("secret", PASSPHRASE);
    expect(() => decrypt(env, "completely-wrong-passphrase!")).toThrow(/wrong passphrase or tampered data/);
  });

  it("refuses passphrase shorter than 12 chars on encrypt", () => {
    expect(() => encrypt("data", SHORT)).toThrow(/at least 12/);
  });

  it("rejects unknown envelope version", () => {
    const env = encrypt("data", PASSPHRASE);
    const bad = { ...env, v: 999 as 1 };
    expect(() => decrypt(bad, PASSPHRASE)).toThrow(/version 999 not supported/);
  });

  it("rejects unknown algorithm", () => {
    const env = encrypt("data", PASSPHRASE);
    const bad = { ...env, alg: "rot13" as "aes-256-gcm" };
    expect(() => decrypt(bad, PASSPHRASE)).toThrow(/algorithm rot13 not supported/);
  });

  it("rejects malformed nonce length", () => {
    const env = encrypt("data", PASSPHRASE);
    const bad: VaultEnvelope = { ...env, nonce: Buffer.alloc(8).toString("base64") };
    expect(() => decrypt(bad, PASSPHRASE)).toThrow(/Invalid nonce length/);
  });

  it("rejects malformed auth tag length", () => {
    const env = encrypt("data", PASSPHRASE);
    const bad: VaultEnvelope = { ...env, tag: Buffer.alloc(8).toString("base64") };
    expect(() => decrypt(bad, PASSPHRASE)).toThrow(/Invalid auth tag length/);
  });

  it("rejects malformed salt length", () => {
    const env = encrypt("data", PASSPHRASE);
    const bad: VaultEnvelope = { ...env, salt: Buffer.alloc(4).toString("base64") };
    expect(() => decrypt(bad, PASSPHRASE)).toThrow(/Invalid salt length/);
  });
});

describe("vault — isVaultEnvelope", () => {
  it("recognises valid envelope", () => {
    const env = encrypt("data", PASSPHRASE);
    expect(isVaultEnvelope(env)).toBe(true);
  });

  it("rejects null/undefined/non-objects", () => {
    expect(isVaultEnvelope(null)).toBe(false);
    expect(isVaultEnvelope(undefined)).toBe(false);
    expect(isVaultEnvelope("not an envelope")).toBe(false);
    expect(isVaultEnvelope(42)).toBe(false);
  });

  it("rejects objects missing fields", () => {
    expect(isVaultEnvelope({ v: 1, alg: "aes-256-gcm" })).toBe(false);
    expect(isVaultEnvelope({ v: 1, alg: "aes-256-gcm", salt: "x", nonce: "y", ct: "z" })).toBe(false);
  });

  it("rejects wrong version", () => {
    const env = encrypt("data", PASSPHRASE);
    expect(isVaultEnvelope({ ...env, v: 99 })).toBe(false);
  });
});

describe("vault — constantTimeEqual", () => {
  it("returns true for identical buffers", () => {
    const a = Buffer.from("identical");
    const b = Buffer.from("identical");
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it("returns false for different buffers of same length", () => {
    expect(constantTimeEqual(Buffer.from("aaaa"), Buffer.from("bbbb"))).toBe(false);
  });

  it("returns false for buffers of different length", () => {
    expect(constantTimeEqual(Buffer.from("short"), Buffer.from("longer string"))).toBe(false);
  });
});

describe("vault — VAULT_INFO", () => {
  it("reports world-class params", () => {
    expect(VAULT_INFO.algorithm).toBe("aes-256-gcm");
    expect(VAULT_INFO.keySize).toBe(256);
    expect(VAULT_INFO.nonceSize).toBe(96);
    expect(VAULT_INFO.authTagSize).toBe(128);
    expect(VAULT_INFO.kdf).toBe("scrypt");
    expect(VAULT_INFO.fipsApproved).toBe(true);
  });
});
