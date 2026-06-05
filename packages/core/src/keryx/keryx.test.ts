import { describe, it, expect } from "vitest";
import { buildAsk, buildAnswer, verifyEnvelope, envelopeLeaksRaw, keryxGauntlet } from "./index.js";

const SECRET = "daemon-key", now = 1_700_000_000_000;

describe("KERYX — the signed gate-as-a-service relay protocol", () => {
  it("an ask carries only summary + hash (never raw), and verifies offline", () => {
    const ask = buildAsk(SECRET, { id: "q1", channel: "line", summary: "Delete prod?", rawCommand: "rm -rf /prod", nonce: "N", now });
    expect(verifyEnvelope(SECRET, ask, now + 1000).ok).toBe(true);
    expect(envelopeLeaksRaw(ask, ["rm -rf /prod"])).toBe(false);
  });
  it("the dumb relay cannot forge or tamper", () => {
    const ask = buildAsk(SECRET, { id: "q1", channel: "slack", summary: "ok?", rawCommand: "ls", nonce: "N", now });
    expect(verifyEnvelope("wrong", ask, now + 1).ok).toBe(false);            // forged key
    expect(verifyEnvelope(SECRET, { ...ask, payload: "approve raise" }, now + 1).ok).toBe(false); // tampered
  });
  it("replay + expiry are rejected", () => {
    const ask = buildAsk(SECRET, { id: "q1", channel: "discord", summary: "ok?", rawCommand: "ls", nonce: "N", now, ttlMs: 1000 });
    expect(verifyEnvelope(SECRET, ask, now + 5000).ok).toBe(false);          // expired
    expect(verifyEnvelope(SECRET, ask, now + 100, new Set(["q1:N:ask"])).ok).toBe(false); // replay
  });
  it("the answer is bound to the exact ask, any channel", () => {
    const ask = buildAsk(SECRET, { id: "q1", channel: "whatsapp", summary: "ok?", rawCommand: "git push", nonce: "N", now });
    const ans = buildAnswer(SECRET, ask, "deny", now + 100);
    expect(verifyEnvelope(SECRET, ans, now + 100).ok).toBe(true);
    expect(ans.id).toBe(ask.id); expect(ans.commandHash).toBe(ask.commandHash);
  });
  it("total on garbage", () => {
    expect(() => verifyEnvelope(SECRET, null as never, 0)).not.toThrow();
    expect(() => envelopeLeaksRaw(null as never, [])).not.toThrow();
  });
  it("MEASURED: keryxGauntlet = 100", () => {
    const g = keryxGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
