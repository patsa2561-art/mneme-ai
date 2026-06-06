import { describe, it, expect } from "vitest";
import { providerWebGauntlet, defaultWeb, weave, harvestInbound } from "./provider_web.js";
describe("PROVIDER WEB — declarative auto-plug mesh", () => {
  it("MEASURED: providerWebGauntlet = 100", () => { const g = providerWebGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a brand-new provider plugs in by declaring silk (no core change)", () => {
    const web = weave(defaultWeb(), { provider: "wechat", capabilities: { buttons: false, edit: false, inbound: "webhook", verify: "signature" }, parse: { answerPath: "Content", idPath: "MsgId", answerMap: { yes: "allow" } } }).web;
    const h = harvestInbound(web, "wechat", { MsgId: "m1", Content: "yes" });
    expect(h.ok).toBe(true); expect(h.answer).toBe("allow"); expect(h.id).toBe("m1");
  });
});
