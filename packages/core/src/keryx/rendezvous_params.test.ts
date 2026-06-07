import { describe, it, expect } from "vitest";
import { mintPairingCode, matchPairingCode, link, routeInbound, routeOutbound, consume, emptyLinkTable } from "./rendezvous.js";

describe("rendezvous · mintPairingCode — every parameter", () => {
  it("code format is MNEME-<6 Crockford chars>", () => {
    const { code } = mintPairingCode("d", "line", { now: 1000, secret: "s" });
    expect(code).toMatch(/^MNEME-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
  it("record carries every field, used=false, signed", () => {
    const { record } = mintPairingCode("dX", "slack", { now: 5000, ttlMs: 1234, secret: "s" });
    expect(record.daemonId).toBe("dX"); expect(record.provider).toBe("slack");
    expect(record.createdAt).toBe(5000); expect(record.exp).toBe(5000 + 1234);
    expect(record.used).toBe(false); expect(record.sig).toMatch(/^[0-9a-f]{64}$/);
  });
  it("default ttl is 10 minutes", () => {
    const { record } = mintPairingCode("d", "line", { now: 0, secret: "s" });
    expect(record.exp).toBe(10 * 60 * 1000);
  });
  it("counter changes the code (distinct codes per mint)", () => {
    const a = mintPairingCode("d", "line", { now: 1000, secret: "s", counter: 0 }).code;
    const b = mintPairingCode("d", "line", { now: 1000, secret: "s", counter: 1 }).code;
    expect(a).not.toBe(b);
  });
  it("secret changes the code + the sig", () => {
    const a = mintPairingCode("d", "line", { now: 1000, secret: "s1" });
    const b = mintPairingCode("d", "line", { now: 1000, secret: "s2" });
    expect(a.code).not.toBe(b.code); expect(a.record.sig).not.toBe(b.record.sig);
  });
  it("daemonId + provider change the code", () => {
    expect(mintPairingCode("a", "line", { now: 1, secret: "s" }).code).not.toBe(mintPairingCode("b", "line", { now: 1, secret: "s" }).code);
    expect(mintPairingCode("a", "line", { now: 1, secret: "s" }).code).not.toBe(mintPairingCode("a", "slack", { now: 1, secret: "s" }).code);
  });
  it("total — empty/garbage args never throw", () => {
    expect(() => mintPairingCode("", "", { now: 0 })).not.toThrow();
    expect(() => mintPairingCode(null as never, null as never, null as never)).not.toThrow();
  });
});

describe("rendezvous · matchPairingCode — every branch", () => {
  const S = "secret";
  const fresh = () => mintPairingCode("d1", "line", { now: 1000, secret: S, counter: 7 });
  it("matches the code anywhere in the text, case-insensitive", () => {
    const { code, record } = fresh();
    expect(matchPairingCode(`hello ${code.toLowerCase()} bye`, [record], { now: 2000, secret: S }).ok).toBe(true);
  });
  it("no code in text → not ok, reason mentions no known code", () => {
    const r = matchPairingCode("just chatting", [fresh().record], { now: 2000, secret: S });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/no known pairing code/);
  });
  it("expired → rejected", () => {
    const { code, record } = mintPairingCode("d", "line", { now: 0, ttlMs: 100, secret: S });
    const r = matchPairingCode(code, [record], { now: 5000, secret: S });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/expired/);
  });
  it("used (replay) → rejected", () => {
    const { code, record } = fresh();
    const r = matchPairingCode(code, consume([record], code), { now: 1100, secret: S });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/used/);
  });
  it("forged (HMAC mismatch) → rejected when skipSig is off", () => {
    const { code, record } = fresh();
    const r = matchPairingCode(code, [{ ...record, daemonId: "attacker" }], { now: 1100, secret: S });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/forged/);
  });
  it("skipSig=true bypasses the HMAC check (the relay's trusted-store path)", () => {
    const { code, record } = fresh();
    const r = matchPairingCode(code, [{ ...record, daemonId: "relayTrusted", sig: "tampered" }], { now: 1100, skipSig: true });
    expect(r.ok).toBe(true); expect(r.daemonId).toBe("relayTrusted");
  });
  it("provider filter → rejects a code minted for another provider", () => {
    const { code, record } = fresh(); // line
    const r = matchPairingCode(code, [record], { now: 1100, secret: S, provider: "slack" });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/line/);
  });
  it("picks the matching record among many", () => {
    const a = mintPairingCode("dA", "line", { now: 1000, secret: S, counter: 1 });
    const b = mintPairingCode("dB", "line", { now: 1000, secret: S, counter: 2 });
    const r = matchPairingCode(b.code, [a.record, b.record], { now: 1100, secret: S });
    expect(r.daemonId).toBe("dB");
  });
  it("total — null/empty inputs never throw", () => {
    expect(() => matchPairingCode(null as never, null as never, { now: 0 })).not.toThrow();
    expect(matchPairingCode("", [], { now: 0 }).ok).toBe(false);
  });
});

describe("rendezvous · link / route / consume", () => {
  it("link adds; same provider+conversation → latest daemon wins (dedup)", () => {
    let t = emptyLinkTable();
    t = link(t, { daemonId: "d1", provider: "line" }, "U1", 1);
    t = link(t, { daemonId: "d2", provider: "line" }, "U1", 2);   // re-pair same conversation
    expect(t.links).toHaveLength(1); expect(routeInbound(t, "line", "U1")).toBe("d2");
  });
  it("link with empty daemonId/provider/conversation → no-op", () => {
    const t = link(emptyLinkTable(), { daemonId: "", provider: "line" }, "U1", 1);
    expect(t.links).toHaveLength(0);
  });
  it("routeInbound: not found → null; null table → null", () => {
    expect(routeInbound(emptyLinkTable(), "line", "X")).toBeNull();
    expect(routeInbound(null as never, "line", "X")).toBeNull();
  });
  it("routeOutbound: filters by daemon+provider, returns all conversations", () => {
    let t = emptyLinkTable();
    t = link(t, { daemonId: "d", provider: "line" }, "U1", 1);
    t = link(t, { daemonId: "d", provider: "line" }, "U2", 2);
    t = link(t, { daemonId: "d", provider: "slack" }, "C1", 3);
    t = link(t, { daemonId: "other", provider: "line" }, "U9", 4);
    expect(routeOutbound(t, "d", "line").sort()).toEqual(["U1", "U2"]);
    expect(routeOutbound(t, "d", "slack")).toEqual(["C1"]);
    expect(routeOutbound(t, "nope", "line")).toEqual([]);
  });
  it("consume marks only the matching code used", () => {
    const a = mintPairingCode("d", "line", { now: 1, secret: "s", counter: 1 });
    const b = mintPairingCode("d", "line", { now: 1, secret: "s", counter: 2 });
    const after = consume([a.record, b.record], a.code);
    expect(after.find((r) => r.code === a.code)?.used).toBe(true);
    expect(after.find((r) => r.code === b.code)?.used).toBe(false);
  });
});
