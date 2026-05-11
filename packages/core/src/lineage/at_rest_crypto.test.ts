import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encryptString, decryptBlob, isEncryptedBlob,
  loadOrCreateSalt, readEncryptionStatus,
  atomicWriteEncryptedJSON, readEncryptedJSON,
} from "./at_rest_crypto.js";

describe("lineage at-rest encryption", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-crypto-"));
    mkdirSync(join(repo, ".mneme/lineage/identity"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("salt management", () => {
    it("creates a 32-byte salt on first call", () => {
      const salt = loadOrCreateSalt(repo);
      expect(salt.length).toBe(32);
      expect(existsSync(join(repo, ".mneme/lineage/identity/at-rest-salt.bin"))).toBe(true);
    });
    it("returns the same salt on subsequent calls", () => {
      const a = loadOrCreateSalt(repo);
      const b = loadOrCreateSalt(repo);
      expect(a.equals(b)).toBe(true);
    });
  });

  describe("encrypt + decrypt roundtrip", () => {
    it("preserves plaintext through encrypt -> decrypt", () => {
      const blob = encryptString(repo, "hello world");
      expect(isEncryptedBlob(blob)).toBe(true);
      expect(decryptBlob(repo, blob)).toBe("hello world");
    });
    it("ciphertext starts with MNEMECv1 magic header", () => {
      const blob = encryptString(repo, "x");
      expect(blob.slice(0, 8).toString("utf8")).toBe("MNEMECv1");
    });
    it("two encrypts of the same plaintext produce DIFFERENT ciphertexts (random nonce)", () => {
      const a = encryptString(repo, "same input");
      const b = encryptString(repo, "same input");
      expect(a.equals(b)).toBe(false);
    });
    it("decrypt fails on tampered ciphertext (GCM MAC catches it)", () => {
      const blob = encryptString(repo, "plaintext");
      blob[20] = blob[20]! ^ 0xff;       // flip a byte in the ciphertext region
      expect(() => decryptBlob(repo, blob)).toThrow();
    });
    it("isEncryptedBlob returns false for plain JSON", () => {
      expect(isEncryptedBlob(Buffer.from(`{"x":1}`))).toBe(false);
    });
    it("decryptBlob refuses non-magic input with a clear error", () => {
      expect(() => decryptBlob(repo, Buffer.from("not encrypted"))).toThrow(/no MNEMECv1 magic/);
    });
  });

  describe("readEncryptionStatus", () => {
    it("reports disabled when salt missing", () => {
      const s = readEncryptionStatus(repo);
      expect(s.enabled).toBe(false);
      expect(s.saltExists).toBe(false);
    });
    it("reports enabled with byte count after first encrypt", () => {
      encryptString(repo, "trigger salt creation");
      const s = readEncryptionStatus(repo);
      expect(s.enabled).toBe(true);
      expect(s.saltBytes).toBe(32);
    });
  });

  describe("atomicWriteEncryptedJSON / readEncryptedJSON (chromosome wrappers)", () => {
    it("encrypts when salt exists; reads back the same JSON", () => {
      // Trigger salt creation by encrypting a sentinel.
      encryptString(repo, "sentinel");
      const path = join(repo, ".mneme/lineage/chromosomes/test.json");
      mkdirSync(join(repo, ".mneme/lineage/chromosomes"), { recursive: true });
      atomicWriteEncryptedJSON(repo, path, { hello: "world", n: 42 });
      const onDisk = readFileSync(path);
      expect(isEncryptedBlob(onDisk)).toBe(true);
      const recovered = readEncryptedJSON<{ hello: string; n: number }>(repo, path);
      expect(recovered).toEqual({ hello: "world", n: 42 });
    });

    it("falls back to plaintext when salt absent (backward-compat)", () => {
      // No salt -> plaintext write.
      const path = join(repo, ".mneme/lineage/chromosomes/legacy.json");
      mkdirSync(join(repo, ".mneme/lineage/chromosomes"), { recursive: true });
      atomicWriteEncryptedJSON(repo, path, { legacy: true });
      const onDisk = readFileSync(path);
      expect(isEncryptedBlob(onDisk)).toBe(false);
      expect(onDisk.toString("utf8")).toContain("legacy");
    });

    it("readEncryptedJSON auto-detects + reads BOTH encrypted and plaintext files", () => {
      const dir = join(repo, ".mneme/lineage/chromosomes");
      mkdirSync(dir, { recursive: true });
      // 1. plaintext file
      const plain = join(dir, "plain.json");
      writeFileSync(plain, JSON.stringify({ kind: "plain" }), "utf8");
      // 2. encrypted file (after salt now exists)
      const enc = join(dir, "enc.json");
      atomicWriteEncryptedJSON(repo, enc, { kind: "enc" });
      // Both should round-trip.
      expect(readEncryptedJSON<{ kind: string }>(repo, plain).kind).toBe("plain");
      expect(readEncryptedJSON<{ kind: string }>(repo, enc).kind).toBe("enc");
    });
  });

  describe("co-working with existing chromosome shape", () => {
    it("an encrypted chromosome blob is binary, not human-readable", () => {
      // Trigger salt creation so atomicWriteEncryptedJSON encrypts.
      encryptString(repo, "trigger salt");
      const path = join(repo, ".mneme/lineage/chromosomes/secret.json");
      mkdirSync(join(repo, ".mneme/lineage/chromosomes"), { recursive: true });
      atomicWriteEncryptedJSON(repo, path, {
        sessionLog: "user said: my npm token is npm_secretXYZ",
        diagnostics: "auth.ts:42",
      });
      const onDisk = readFileSync(path).toString("binary");
      // Should NOT contain the secret in plaintext.
      expect(onDisk).not.toContain("npm_secretXYZ");
      expect(onDisk).not.toContain("auth.ts:42");
    });
  });
});
