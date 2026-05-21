import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { grantConsent, readConsent, revokeConsent, isConsentStale, verifyConsent, renderConsentBlock } from "./user_consent.js";

describe("user_consent · grant + read + revoke", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-consent-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("readConsent returns null when no grant exists", () => {
    expect(readConsent(repo)).toBeNull();
  });

  it("grantConsent writes a markdown file the user can read + edit", () => {
    const rec = grantConsent(repo, { signedBy: "Shinnapat" });
    expect(existsSync(join(repo, ".mneme/user-consent.md"))).toBe(true);
    expect(rec.signedBy).toBe("Shinnapat");
    expect(rec.signature).toMatch(/^[a-f0-9]{16}$/);
    const md = readFileSync(join(repo, ".mneme/user-consent.md"), "utf8");
    expect(md).toContain("Mneme — User Consent Grant");
    expect(md).toContain("Shinnapat");
    expect(md).toContain("MNEME_CONSENT_GRANT_START");
  });

  it("readConsent round-trips a grant", () => {
    grantConsent(repo, { signedBy: "Shinnapat", grantText: "custom wording", renewalDays: 14 });
    const r = readConsent(repo);
    expect(r).not.toBeNull();
    expect(r!.signedBy).toBe("Shinnapat");
    expect(r!.grantText).toBe("custom wording");
    expect(r!.renewalDays).toBe(14);
  });

  it("verifyConsent returns true on fresh grant + false when grant text is mutated", () => {
    grantConsent(repo, { signedBy: "Shinnapat" });
    const r = readConsent(repo)!;
    expect(verifyConsent(repo, r)).toBe(true);
    const tampered = { ...r, grantText: r.grantText + " — WITH SECRET BACKDOOR" };
    expect(verifyConsent(repo, tampered)).toBe(false);
  });

  it("isConsentStale flips after renewalDays passes", () => {
    grantConsent(repo, { signedBy: "Shinnapat", renewalDays: 30 });
    const r = readConsent(repo)!;
    const fortyDaysLater = Date.parse(r.signedAt) + 40 * 24 * 60 * 60 * 1000;
    expect(isConsentStale(r, fortyDaysLater)).toBe(true);
    expect(isConsentStale(r, Date.parse(r.signedAt) + 1)).toBe(false);
  });

  it("revokeConsent deletes the file + future readConsent returns null", () => {
    grantConsent(repo, { signedBy: "Shinnapat" });
    expect(revokeConsent(repo)).toBe(true);
    expect(readConsent(repo)).toBeNull();
    // second revoke is a no-op (returns false) — idempotent
    expect(revokeConsent(repo)).toBe(false);
  });

  it("renderConsentBlock returns empty string when no consent on disk", () => {
    expect(renderConsentBlock(repo)).toBe("");
  });

  it("renderConsentBlock quotes the grant text verbatim + points to verify-self", () => {
    grantConsent(repo, { signedBy: "Shinnapat", grantText: "I agree to the protocol" });
    const block = renderConsentBlock(repo);
    // v2.19.96 — reframed from "[USER CONSENT, signed ... ✓ verified]"
    // (which read as prompt-injection to fresh AI agents) to neutral
    // descriptive prose with an explicit verify-self pointer.
    expect(block).toContain("Mneme local consent record");
    expect(block).toContain("Shinnapat");
    expect(block).toContain("I agree to the protocol");
    expect(block).toContain("matches local key");
    expect(block).toContain("mneme verify-self");
  });
});
