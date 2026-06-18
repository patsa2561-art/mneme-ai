import { describe, it, expect } from "vitest";
import { morph, morphGauntlet, toMcpTool, COMMAND_TO_MCP } from "./index.js";

describe("v3.103 · MORPH — the polymorphic MCP tool", () => {
  it("gauntlet is 100", () => {
    expect(morphGauntlet().score).toBe(100);
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
