import { describe, it, expect } from "vitest";
import { rendezvousGauntlet, mintPairingCode, matchPairingCode, link, routeInbound, emptyLinkTable, consume } from "./rendezvous.js";
describe("KERYX RENDEZVOUS — universal zero-config pairing", () => {
  it("MEASURED: rendezvousGauntlet = 100", () => { const g = rendezvousGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("send a code from ANY app links that conversation to the daemon", () => {
    const { code, record } = mintPairingCode("d1", "whatsapp", { now: 1000, secret: "s" });
    const m = matchPairingCode(`link me ${code}`, [record], { now: 2000, secret: "s", provider: "whatsapp" });
    expect(m.ok).toBe(true); expect(m.daemonId).toBe("d1");
    const t = link(emptyLinkTable(), m, "+66999", 2000);
    expect(routeInbound(t, "whatsapp", "+66999")).toBe("d1");
  });
  it("a used code cannot be replayed", () => {
    const { code, record } = mintPairingCode("d", "line", { now: 0, secret: "s" });
    const after = consume([record], code);
    expect(matchPairingCode(code, after, { now: 1, secret: "s" }).ok).toBe(false);
  });
});
