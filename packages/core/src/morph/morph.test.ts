import { describe, it, expect } from "vitest";
import { morph, morphGauntlet, morphPrecision, toMcpTool, COMMAND_TO_MCP, MORPH_CORPUS } from "./index.js";

describe("v3.104 · MORPH — the polymorphic MCP tool + precision engine", () => {
  it("gauntlet is 100", () => {
    expect(morphGauntlet().score).toBe(100);
  });

  it("precision engine: ≥97.5% precision-when-routed on the labeled corpus (measured)", () => {
    const p = morphPrecision();
    expect(p.precision).toBeGreaterThanOrEqual(0.975);
    expect(p.misroutes).toEqual([]);
    // honest trade-off: coverage is reported, not hidden, and is a meaningful majority
    expect(p.coverage).toBeGreaterThanOrEqual(0.6);
  });

  it("abstains (never confidently wrong) on genuinely ambiguous intents", () => {
    for (const c of MORPH_CORPUS.filter((x) => x.expect === null)) {
      expect(morph(c.q).verdict).not.toBe("MORPHED");
    }
  });

  it("exposes a transparent confidence basis (via + self-consistency)", () => {
    const m = morph("who wrote this function last and why");
    expect(["concept", "catalog"]).toContain(m.basis.via);
    expect(typeof m.basis.selfConsistent).toBe("boolean");
  });

  it("morphs a free-text intent into the right capability + MCP tool", () => {
    const m = morph("is this claim actually true");
    expect(m.verdict).toBe("MORPHED");
    expect(m.capability?.command).toBe("mneme verify");
    expect(m.capability?.mcpTool).toBe("mneme.truth.check");
    expect(m.shape?.mcpTool).toBe("mneme.truth.check");
  });

  it("hands back an actionable, typed next call (the contact surface)", () => {
    const m = morph("who wrote this function last and why");
    expect(m.verdict).toBe("MORPHED");
    expect(m.shape).toBeTruthy();
    expect(m.shape!.mcpTool || m.shape!.cli).toBeTruthy();
    expect(typeof m.shape!.args["intent"]).toBe("string");
  });

  it("projects detected entities into the shaped args (EN+Thai)", () => {
    const m = morph("ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร");
    expect(m.capability?.command).toBe("mneme govern");
    expect(m.shape?.args["budget"]).toBe(50000);
    expect((m.shape?.args["forbidden"] as string[]).length).toBeGreaterThan(0);
  });

  it("is faithful: never invents a capability the Gateway did not route to", () => {
    // gibberish must not MORPH to anything
    expect(morph("asdfghjkl qwerty zzz").verdict).not.toBe("MORPHED");
  });

  it("is bilingual: same intent EN/Thai → same capability", () => {
    expect(morph("who wrote this function last and why").capability?.command)
      .toBe(morph("ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม").capability?.command);
  });

  it("toMcpTool resolves the 2-token prefix + the map is well-formed", () => {
    expect(toMcpTool("mneme telos")).toBe("mneme.drift.analyze");
    expect(toMcpTool("mneme.unknown.verb")).toBe(null);
    expect(toMcpTool(null)).toBe(null);
    for (const t of Object.values(COMMAND_TO_MCP)) expect(t).toMatch(/^mneme\.[a-z_]+(\.[a-z_]+)?$/);
  });

  it("is total — garbage never throws", () => {
    expect(() => morph(null as unknown as string)).not.toThrow();
    expect(() => morph("")).not.toThrow();
    expect(morph("").verdict).not.toBe("MORPHED");
  });
});
