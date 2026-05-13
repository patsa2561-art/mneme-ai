import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createLivingWill, recordActivity, checkRelease, formatLivingWillPulseLine } from "./index.js";

describe("v2.1 LIVING WILL · cryptographic dead-man primitive", () => {
  const secret = randomBytes(32);

  it("create + check immediately = ACTIVE", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "publish CHANGELOG on death",
      encryptedPayload: Buffer.from("encrypted-payload-bytes"),
      secret,
    });
    const r = checkRelease(w, secret);
    expect(r.verdict).toBe("ACTIVE");
    expect(r.reason).toContain("remaining");
  });

  it("becomes RELEASABLE after inactivity threshold passes", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "x",
      encryptedPayload: Buffer.from("x"),
      secret,
    });
    const futureNow = w.lastActivityAt + 31 * 24 * 60 * 60 * 1000;
    const r = checkRelease(w, secret, futureNow);
    expect(r.verdict).toBe("RELEASABLE");
    expect(r.payloadHex).toBeTruthy();
  });

  it("recordActivity resets the timer", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "x",
      encryptedPayload: Buffer.from("x"),
      secret,
    });
    // Far future
    const futureNow = w.lastActivityAt + 31 * 24 * 60 * 60 * 1000;
    expect(checkRelease(w, secret, futureNow).verdict).toBe("RELEASABLE");
    // Record activity at the very end of the inactivity window
    const w2 = recordActivity(w, secret, futureNow);
    // Now check release immediately — should be ACTIVE again
    expect(checkRelease(w2, secret, futureNow).verdict).toBe("ACTIVE");
  });

  it("TAMPERED verdict when signature is forged", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "x",
      encryptedPayload: Buffer.from("x"),
      secret,
    });
    const tampered = { ...w, signature: "0".repeat(64) };
    expect(checkRelease(tampered, secret).verdict).toBe("TAMPERED");
  });

  it("WRONG_KEY on wrong secret", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "x",
      encryptedPayload: Buffer.from("x"),
      secret,
    });
    const wrong = randomBytes(32);
    expect(checkRelease(w, wrong).verdict).toBe("WRONG_KEY");
  });

  it("formatLivingWillPulseLine produces compact summary", () => {
    const w = createLivingWill({
      inactivityDays: 30,
      description: "publish on death",
      encryptedPayload: Buffer.from("x"),
      secret,
    });
    expect(formatLivingWillPulseLine(w)).toContain("LIVING-WILL");
  });
});
