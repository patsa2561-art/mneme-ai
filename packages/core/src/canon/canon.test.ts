import { describe, it, expect } from "vitest";
import { buildRecord, verifyRecord, conformanceCheck, canonicalize, canonGauntlet, CANON_VERSION, type AccountabilityRecord } from "./index.js";
import { createHash } from "node:crypto";
const rid = (r: Partial<AccountabilityRecord>) => createHash("sha256").update(canonicalize(r)).digest("hex");

describe("v2.149 · CANON — the Accountability-Record Standard", () => {
  it("gauntlet is 100", () => {
    expect(canonGauntlet().score).toBe(100);
  });

  it("builds a conformant, self-verifying record", () => {
    const r = buildRecord({ kind: "command-gate", subject: "rm -rf /", verdict: "BLOCK", payload: { risk: "destructive" }, ts: 1 });
    expect(r.canon).toBe(`CANON/${CANON_VERSION}`);
    expect(verifyRecord(r).ok).toBe(true);
  });

  it("is tamper-evident: altering any field breaks the recordId", () => {
    const r = buildRecord({ kind: "diff", subject: "x", verdict: "PASS", ts: 1 });
    expect(verifyRecord({ ...r, verdict: "ALLOW" }).ok).toBe(false);
  });

  it("version policy: accepts CANON/1.x, rejects 2.0 with a reason", () => {
    const r = buildRecord({ kind: "diff", subject: "x", verdict: "PASS", ts: 1 });
    const v1x = { ...r, canon: "CANON/1.9" }; v1x.recordId = rid(v1x);
    expect(verifyRecord(v1x).conformant).toBe(true);
    const v2 = conformanceCheck({ ...r, canon: "CANON/2.0" });
    expect(v2.conformant).toBe(false);
    expect(v2.reason).toMatch(/major version/i);
  });

  it("names a missing required field", () => {
    const c = conformanceCheck({ canon: "CANON/1.0", kind: "diff", subject: "x", payloadHash: "h", ts: 1, recordId: "r" });
    expect(c.conformant).toBe(false);
    expect(c.missing).toContain("verdict");
  });

  it("is vendor-neutral (a record from a different issuer still verifies) + binds payload by hash", () => {
    const r = buildRecord({ kind: "claim-verdict", subject: "external", verdict: "REFUTED", payload: { by: "competitor", secretField: "hidden" }, ts: 1 });
    const withIssuer = { ...r, issuer: "ed25519:OTHERVENDOR" }; withIssuer.recordId = rid(withIssuer);
    expect(verifyRecord(withIssuer).ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("hidden");  // payload bound by hash, not exposed
  });

  it("is total on hostile input", () => {
    expect(() => buildRecord(null as never)).not.toThrow();
    expect(() => verifyRecord(null as never)).not.toThrow();
    expect(() => conformanceCheck(undefined)).not.toThrow();
  });
});
