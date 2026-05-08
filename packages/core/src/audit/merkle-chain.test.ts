import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCertificate,
  verifyChain,
  readChain,
  canonicalise,
  generateHmacKey,
  type CertificatePayload,
} from "./merkle-chain.js";
import { distribution } from "./superposition.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-merkle-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const samplePayload = (commitHash: string): CertificatePayload => ({
  commitHash,
  axes: {
    behavioralParity: distribution({ pass: 0.9, warn: 0.05, fail: 0.03, skipped: 0.02 }),
  },
  overall: distribution({ pass: 0.9, warn: 0.05, fail: 0.03, skipped: 0.02 }),
  evidence: { tests: { passed: 100, failed: 0 } },
  issuedAt: "2026-05-09T10:00:00Z",
  issuedBy: "mneme/0.47.0",
  notes: "test cert",
});

describe("canonicalise — deterministic JSON", () => {
  it("sorts keys", () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("recurses into nested objects", () => {
    expect(canonicalise({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });
  it("preserves array order", () => {
    expect(canonicalise([3, 1, 2])).toBe("[3,1,2]");
  });
  it("handles primitives", () => {
    expect(canonicalise("hello")).toBe('"hello"');
    expect(canonicalise(42)).toBe("42");
    expect(canonicalise(null)).toBe("null");
    expect(canonicalise(true)).toBe("true");
  });
});

describe("appendCertificate — basic chain", () => {
  it("creates the chain file on first append", async () => {
    const cert = await appendCertificate(samplePayload("a1"), { rootPath: tmp });
    expect(cert.index).toBe(0);
    expect(cert.prevHash).toBe("");
    expect(cert.hash).toMatch(/^[0-9a-f]{64}$/);
    const chain = await readChain(tmp);
    expect(chain.certificates).toHaveLength(1);
  });

  it("each subsequent cert links to the prior hash", async () => {
    const c1 = await appendCertificate(samplePayload("a1"), { rootPath: tmp });
    const c2 = await appendCertificate(samplePayload("a2"), { rootPath: tmp });
    const c3 = await appendCertificate(samplePayload("a3"), { rootPath: tmp });
    expect(c2.prevHash).toBe(c1.hash);
    expect(c3.prevHash).toBe(c2.hash);
    expect(c1.hash).not.toBe(c2.hash);
    expect(c2.hash).not.toBe(c3.hash);
  });

  it("includes evidence hash so off-chain blob tampering is detectable", async () => {
    const cert = await appendCertificate(samplePayload("a1"), { rootPath: tmp });
    expect(cert.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("HMAC signs each cert when key is provided", async () => {
    const key = generateHmacKey();
    const cert = await appendCertificate(samplePayload("a1"), { rootPath: tmp, hmacKey: key });
    expect(cert.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.signatureAlgo).toBe("hmac-sha256");
  });
});

describe("verifyChain — tamper detection", () => {
  it("verifies a clean chain", async () => {
    await appendCertificate(samplePayload("a"), { rootPath: tmp });
    await appendCertificate(samplePayload("b"), { rootPath: tmp });
    await appendCertificate(samplePayload("c"), { rootPath: tmp });
    const r = await verifyChain(tmp);
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(3);
    expect(r.issues).toHaveLength(0);
  });

  it("detects hash tampering on a single cert", async () => {
    await appendCertificate(samplePayload("a"), { rootPath: tmp });
    await appendCertificate(samplePayload("b"), { rootPath: tmp });
    // Tamper: rewrite the chain file with an edited commit hash on cert 0
    const file = join(tmp, ".mneme/audit-chain.json");
    const chain = JSON.parse(readFileSync(file, "utf8"));
    chain.certificates[0].commitHash = "EVIL";
    writeFileSync(file, JSON.stringify(chain));
    const r = await verifyChain(tmp);
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    // Either cert 0 hash mismatches OR cert 1's prev pointer mismatches
    expect(r.issues.some((i) => /hash mismatch|chain break/.test(i.reason))).toBe(true);
  });

  it("detects signature tampering when HMAC keyed", async () => {
    const key = generateHmacKey();
    await appendCertificate(samplePayload("a"), { rootPath: tmp, hmacKey: key });
    const file = join(tmp, ".mneme/audit-chain.json");
    const chain = JSON.parse(readFileSync(file, "utf8"));
    chain.certificates[0].signature = "0".repeat(64);
    writeFileSync(file, JSON.stringify(chain));
    const r = await verifyChain(tmp, { hmacKey: key });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /signature/i.test(i.reason))).toBe(true);
  });

  it("verifies signed chain with correct key", async () => {
    const key = generateHmacKey();
    await appendCertificate(samplePayload("a"), { rootPath: tmp, hmacKey: key });
    await appendCertificate(samplePayload("b"), { rootPath: tmp, hmacKey: key });
    const r = await verifyChain(tmp, { hmacKey: key });
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(2);
  });

  it("flags missing key on signed chain", async () => {
    const key = generateHmacKey();
    await appendCertificate(samplePayload("a"), { rootPath: tmp, hmacKey: key });
    const r = await verifyChain(tmp, {}); // no key
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /no key/.test(i.reason))).toBe(true);
  });

  it("returns ok on empty chain", async () => {
    const r = await verifyChain(tmp);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
    expect(r.verified).toBe(0);
  });
});

describe("generateHmacKey", () => {
  it("returns 64 hex chars (32 bytes)", () => {
    const k = generateHmacKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("returns unique keys", () => {
    const k1 = generateHmacKey();
    const k2 = generateHmacKey();
    expect(k1).not.toBe(k2);
  });
});
