import { describe, it, expect } from "vitest";
import { grantGauntlet, mintGrant, coveringGrant, consumeGrant } from "./op_grant.js";
describe("OPERATION GRANT — scoped batch consent", () => {
  it("MEASURED: grantGauntlet = 100", () => { const g = grantGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("covers in-scope, pages off-scope, dies on expiry/exhaustion", () => {
    const g = mintGrant("deploy", ["systemctl", "caddy"], { now: 0, ttlMs: 1000, maxUses: 2, secret: "s" });
    expect(coveringGrant([g], "systemctl restart x", 100, "s")).toBeTruthy();
    expect(coveringGrant([g], "delete everything", 100, "s")).toBeNull();      // off-plan still pages
    expect(coveringGrant([g], "systemctl x", 99999, "s")).toBeNull();          // expired
    const used = consumeGrant(consumeGrant([g], g.id), g.id);
    expect(coveringGrant(used, "systemctl x", 100, "s")).toBeNull();           // exhausted
  });
});
