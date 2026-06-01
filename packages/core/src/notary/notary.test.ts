/**
 * v2.79.0 — NOTARY pinned tests.
 *   N1 — issuer keypair: generate, persist, reload deterministically
 *   N2 — issue → verify round trip (valid, offline, public-key only)
 *   N3 — tamper payload → verify fails
 *   N4 — tamper body (subject / receiptId / fingerprint) → verify fails
 *   N5 — wrong issuer key + expectedIssuer trust assertion
 *   N6 — chain: linked receipts verify; broken link / issuer-swap fails
 *   N7 — canonical JSON key-order independence + hash-only (privacy) receipt
 *   N8 — verify needs ONLY the receipt (no private key, no repoRoot, no network)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getIssuerKeyPair, _resetIssuerKeyCache, issueReceipt, verifyReceipt, verifyChain,
  notarizeProtocolReceipt, canonicalJson, type NotaryReceipt,
} from "./index.js";

const tmpRepo = () => mkdtempSync(join(tmpdir(), "mneme-notary-"));

describe("v2.79.0 N1 — issuer keypair (PINNED)", () => {
  it("N1.1 generates + persists + reloads the same key", () => {
    const repo = tmpRepo();
    const a = getIssuerKeyPair(repo);
    const b = getIssuerKeyPair(repo); // reload from disk
    expect(a.publicKeyB64).toBe(b.publicKeyB64);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
  it("N1.3 read-only fs: a consistent issuer key + receipts that cross-verify (v2.132 fix)", () => {
    // Simulate an unwritable .mneme/notary by rooting it under an existing FILE
    // (mkdir under a file path fails on every OS) → persistence silently fails.
    const dir = tmpRepo();
    const asFile = join(dir, "ro.flag");
    writeFileSync(asFile, "x");
    const roRoot = join(asFile, "nested"); // notaryDir(roRoot) can never be created
    _resetIssuerKeyCache();
    const a = getIssuerKeyPair(roRoot);
    const b = getIssuerKeyPair(roRoot);
    // pre-fix: a≠b (fresh ephemeral key each call). post-fix: memoized → identical.
    expect(a.fingerprint).toBe(b.fingerprint);
    // key was NOT persisted (the fs was unwritable) — proving we're on the RO path.
    expect(existsSync(join(roRoot, ".mneme", "notary", "issuer.key"))).toBe(false);
    // and two receipts signed in this process cross-verify against the same issuer.
    const r1 = issueReceipt(roRoot, { kind: "claim-verdict", subject: "s1", payload: { a: 1 } });
    const r2 = issueReceipt(roRoot, { kind: "claim-verdict", subject: "s2", payload: { b: 2 }, prev: r1.receiptId });
    expect(verifyReceipt(r1).valid).toBe(true);
    expect(verifyReceipt(r2).valid).toBe(true);
    expect(r1.issuerFingerprint).toBe(r2.issuerFingerprint);
  });
  it("N1.2 different repos get different keys", () => {
    expect(getIssuerKeyPair(tmpRepo()).fingerprint).not.toBe(getIssuerKeyPair(tmpRepo()).fingerprint);
  });
});

describe("v2.79.0 N2 — issue → verify round trip (PINNED)", () => {
  it("N2.1 a freshly issued receipt verifies", () => {
    const repo = tmpRepo();
    const r = issueReceipt(repo, { kind: "claim-verdict", subject: "claim:42", payload: { verdict: "TRUSTWORTHY", n: 19 } });
    const v = verifyReceipt(r);
    expect(v.valid).toBe(true);
    expect(v.kind).toBe("claim-verdict");
    expect(v.subject).toBe("claim:42");
    expect(r.alg).toBe("ed25519");
    expect(r.sig.length).toBeGreaterThan(0);
  });
});

describe("v2.79.0 N3+N4 — tamper detection (PINNED)", () => {
  const repo = tmpRepo();
  const fresh = () => issueReceipt(repo, { kind: "generic", subject: "s", payload: { a: 1 }, issuedAt: 1000 });
  it("N3.1 tampering the inline payload fails verification", () => {
    const r = { ...fresh(), payload: { a: 2 } };
    expect(verifyReceipt(r).valid).toBe(false);
  });
  it("N4.1 tampering the subject fails (receiptId mismatch)", () => {
    expect(verifyReceipt({ ...fresh(), subject: "evil" }).valid).toBe(false);
  });
  it("N4.2 tampering issuerFingerprint fails", () => {
    expect(verifyReceipt({ ...fresh(), issuerFingerprint: "0000000000000000" }).valid).toBe(false);
  });
  it("N4.3 swapping the signature fails", () => {
    const a = fresh();
    const b = issueReceipt(repo, { kind: "generic", subject: "other", payload: { a: 1 }, issuedAt: 1000 });
    expect(verifyReceipt({ ...a, sig: b.sig }).valid).toBe(false);
  });
});

describe("v2.79.0 N5 — wrong issuer + trust assertion (PINNED)", () => {
  it("N5.1 a receipt re-signed concept: verify against the wrong expected issuer fails", () => {
    const repoA = tmpRepo();
    const repoB = tmpRepo();
    const kpB = getIssuerKeyPair(repoB);
    const r = issueReceipt(repoA, { kind: "generic", subject: "s", payload: { x: 1 } });
    // Authenticity holds (self-signed by A's key)…
    expect(verifyReceipt(r).valid).toBe(true);
    // …but trust assertion against B's fingerprint fails.
    expect(verifyReceipt(r, { expectedIssuerFingerprint: kpB.fingerprint }).valid).toBe(false);
    // …and matching its own fingerprint passes.
    expect(verifyReceipt(r, { expectedIssuerFingerprint: getIssuerKeyPair(repoA).fingerprint }).valid).toBe(true);
  });
  it("N5.2 forging the issuer field to claim a different identity fails the signature", () => {
    const repoA = tmpRepo();
    const kpB = getIssuerKeyPair(tmpRepo());
    const r = issueReceipt(repoA, { kind: "generic", subject: "s", payload: { x: 1 } });
    // Attacker swaps in B's public key + fingerprint but cannot re-sign without B's private key.
    const forged = { ...r, issuer: kpB.publicKeyB64, issuerFingerprint: kpB.fingerprint };
    expect(verifyReceipt(forged).valid).toBe(false);
  });
});

describe("v2.79.0 N6 — chains (PINNED)", () => {
  it("N6.1 a linked chain verifies; a broken link fails", () => {
    const repo = tmpRepo();
    const r0 = issueReceipt(repo, { subject: "0", payload: { i: 0 }, issuedAt: 1 });
    const r1 = issueReceipt(repo, { subject: "1", payload: { i: 1 }, prev: r0.receiptId, issuedAt: 2 });
    const r2 = issueReceipt(repo, { subject: "2", payload: { i: 2 }, prev: r1.receiptId, issuedAt: 3 });
    expect(verifyChain([r0, r1, r2]).valid).toBe(true);
    expect(verifyChain([r0, r2]).valid).toBe(false); // r2.prev !== r0.receiptId
  });
  it("N6.2 sameIssuer enforcement catches an issuer swap mid-chain", () => {
    const repoA = tmpRepo();
    const repoB = tmpRepo();
    const r0 = issueReceipt(repoA, { subject: "0", payload: { i: 0 }, issuedAt: 1 });
    const r1 = issueReceipt(repoB, { subject: "1", payload: { i: 1 }, prev: r0.receiptId, issuedAt: 2 });
    expect(verifyChain([r0, r1]).valid).toBe(true);                 // both individually valid + linked
    expect(verifyChain([r0, r1], { sameIssuer: true }).valid).toBe(false);
  });
});

describe("v2.79.0 N7 — canonical JSON + privacy (PINNED)", () => {
  it("N7.1 canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });
  it("N7.2 a hash-only (no inline payload) receipt still verifies", () => {
    const repo = tmpRepo();
    const r = issueReceipt(repo, { kind: "memory-capsule", subject: "cap:1", payload: { secret: "xyz" }, includePayload: false });
    expect("payload" in r).toBe(false);
    expect(r.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReceipt(r).valid).toBe(true);
  });
  it("N7.3 notarizeProtocolReceipt wraps a hash-only receipt + signs it", () => {
    const repo = tmpRepo();
    const r = notarizeProtocolReceipt(repo, { contentHash: "ab".repeat(32), vendor: "claude" });
    expect(verifyReceipt(r).valid).toBe(true);
    expect(r.subject).toBe("ab".repeat(32));
  });
});

describe("v2.79.0 N8 — offline verification (PINNED)", () => {
  it("N8.1 verify uses ONLY the receipt JSON (round-trips through serialization)", () => {
    const repo = tmpRepo();
    const r = issueReceipt(repo, { kind: "protocol-hop", subject: "hop:mcp->a2a", payload: { from: "mcp", to: "a2a" } });
    // Simulate a third party who only has the JSON bytes — no repo, no keys.
    const overTheWire: NotaryReceipt = JSON.parse(JSON.stringify(r));
    expect(verifyReceipt(overTheWire).valid).toBe(true);
  });
});
