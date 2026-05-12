import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensurePole, issueRope, verifyRope, canChildrenSync } from "./pole_id.js";
import { detectClipboard, renderClipboardSetupHint } from "./clipboard_handoff.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-anchor-"));
}

describe("v1.88 ANCHOR · parent-pole identity", () => {
  it("ensurePole is idempotent (returns same id on re-read)", () => {
    const r = tmpRepo();
    const a = ensurePole(r);
    const b = ensurePole(r);
    expect(b.point.poleId).toBe(a.point.poleId);
    expect(b.secret.secret).toBe(a.secret.secret);
  });

  it("ensurePole writes both public + secret files", () => {
    const r = tmpRepo();
    ensurePole(r);
    const fs = require("node:fs");
    expect(fs.existsSync(join(r, ".mneme/anchor/pole.json"))).toBe(true);
    expect(fs.existsSync(join(r, ".mneme/anchor/pole-secret.json"))).toBe(true);
  });

  it("issueRope produces a valid token verifiable by the pole secret", () => {
    const r = tmpRepo();
    const { secret } = ensurePole(r);
    const rope = issueRope(secret, "child-alpha");
    const v = verifyRope(secret, rope);
    expect(v.ok).toBe(true);
  });

  it("tampered rope is rejected", () => {
    const r = tmpRepo();
    const { secret } = ensurePole(r);
    const rope = issueRope(secret, "child-alpha");
    rope.childId = "imposter";
    const v = verifyRope(secret, rope);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad-sig");
  });

  it("expired rope is rejected", () => {
    const r = tmpRepo();
    const { secret } = ensurePole(r);
    const rope = issueRope(secret, "child-alpha", { ttlMs: 1 });
    // Force expiry in the past.
    rope.expiresAt = new Date(0).toISOString();
    // Re-sign with the tampered expiry to make sig valid (otherwise bad-sig wins).
    const fresh = issueRope(secret, "child-alpha", { ttlMs: -1000 });
    fresh.expiresAt = new Date(Date.now() - 1000).toISOString();
    // The freshly issued rope from secret has signature over its own canonical body; re-issue properly.
    // Simpler: issue with negative ttl directly is fine because expiresAt is in the past.
    const v = verifyRope(secret, issueRope(secret, "child-alpha", { ttlMs: -1000 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
    void rope;
    void fresh;
  });

  it("ropes from DIFFERENT poles cannot be cross-verified", () => {
    const r1 = tmpRepo();
    const r2 = tmpRepo();
    const { secret: s1 } = ensurePole(r1);
    const { secret: s2 } = ensurePole(r2);
    const ropeFromPole1 = issueRope(s1, "child-alpha");
    const v = verifyRope(s2, ropeFromPole1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("wrong-pole");
  });

  it("canChildrenSync passes for two children of the same pole", () => {
    const r = tmpRepo();
    const { secret } = ensurePole(r);
    const ropeA = issueRope(secret, "alpha");
    const ropeB = issueRope(secret, "beta");
    const result = canChildrenSync(secret, ropeA, ropeB);
    expect(result.ok).toBe(true);
  });

  it("canChildrenSync REJECTS when ropes are from different poles", () => {
    const rA = tmpRepo();
    const rB = tmpRepo();
    const { secret: sA } = ensurePole(rA);
    const { secret: sB } = ensurePole(rB);
    const ropeA = issueRope(sA, "alpha");
    const ropeB = issueRope(sB, "beta");
    // Verifier is sA, but ropeB came from sB → rejected.
    const result = canChildrenSync(sA, ropeA, ropeB);
    expect(result.ok).toBe(false);
  });

  it("canChildrenSync rejects when scope lacks 'sync'", () => {
    const r = tmpRepo();
    const { secret } = ensurePole(r);
    const ropeA = issueRope(secret, "alpha", { scope: ["resume"] });
    const ropeB = issueRope(secret, "beta", { scope: ["resume"] });
    const result = canChildrenSync(secret, ropeA, ropeB);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("scope");
  });
});

describe("v1.88 ANCHOR · OS clipboard detection", () => {
  it("detectClipboard returns a tool for the current platform", () => {
    const cap = detectClipboard();
    expect(["win-clip", "pbcopy", "wl-copy", "xclip", "xsel", "kde-connect", "none"]).toContain(cap.tool);
    expect(cap.platform).toBe(process.platform);
  });

  it("setupHint is a non-empty string", () => {
    const cap = detectClipboard();
    expect(cap.setupHint.length).toBeGreaterThan(10);
  });

  it("renderClipboardSetupHint suggests setup when no provider detected", () => {
    const txt = renderClipboardSetupHint({
      tool: "win-clip",
      platform: "win32",
      crossDeviceProvider: "none-detected",
      setupHint: "test hint here",
    });
    expect(txt.toLowerCase()).toContain("setup");
    expect(txt).toContain("test hint here");
  });
});
