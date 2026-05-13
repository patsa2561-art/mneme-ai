import { describe, it, expect } from "vitest";

import {
  issuePassport,
  verifyPassport,
  revokePassport,
  generatePassportSecret,
  type PassportEntry,
} from "./passport.js";

const entries = (): PassportEntry[] => [
  { id: "d1", ts: Date.now(), kind: "decision", text: "test decision" },
];

describe("v1.99 PASSPORT · eternal default + revocation", () => {
  it("default (no ttlDays) → expiresAt = MAX_SAFE_INTEGER (eternal)", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret });
    expect(env.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("verifyPassport returns VALID for eternal passport (no expiry possible)", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret });
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("VALID");
    expect(r.reason).toContain("eternal");
  });

  it("envelope has stable id derived from holder + issuedAt", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret });
    expect(env.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("revokePassport adds id to revocation list", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret });
    expect(env.revoked).toEqual([]);
    const env2 = revokePassport(env, env.id, secret);
    expect(env2.revoked).toContain(env.id);
  });

  it("verifyPassport returns REVOKED when own id in revocation list", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret });
    const env2 = revokePassport(env, env.id, secret);
    const r = verifyPassport(env2, secret);
    expect(r.verdict).toBe("REVOKED");
    expect(r.ok).toBe(false);
  });

  it("verifyPassport on non-revoked passport returns VALID even when revocation list has OTHER ids", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret, revoked: ["other-id-123"] });
    const r = verifyPassport(env, secret);
    expect(r.verdict).toBe("VALID");
  });

  it("explicit ttlDays still works for one-time delegation", () => {
    const secret = generatePassportSecret();
    const env = issuePassport({ holder: "alice", entries: entries(), secret, ttlDays: 7 });
    expect(env.expiresAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(env.expiresAt).toBeGreaterThan(Date.now());
    expect(env.expiresAt - Date.now()).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);
  });
});
