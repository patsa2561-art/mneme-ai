import { describe, it, expect } from "vitest";
import {
  DECISION_TABLE, CAPABILITY_LINES, buildBootPacket, renderBootInstructions,
  bootHookSnippet, bootGauntlet,
} from "./index.js";

describe("v2.133 · ACTIVATION CORTEX (boot)", () => {
  it("gauntlet is 100", () => {
    expect(bootGauntlet().score).toBe(100);
  });

  it("decision table is non-trivial and every row is well-formed", () => {
    expect(DECISION_TABLE.length).toBeGreaterThanOrEqual(8);
    for (const r of DECISION_TABLE) {
      expect(r.when).toBeTruthy();
      expect(r.tool).toBeTruthy();
      expect(r.why).toBeTruthy();
    }
  });

  it("covers the headline capabilities (firewall / rail / outline / cortex / verify)", () => {
    const blob = DECISION_TABLE.map((r) => r.tool + " " + r.when).join(" ").toLowerCase();
    for (const t of ["firewall", "rail", "outline", "cortex", "verify", "treasury", "loopguard"]) {
      expect(blob, t).toContain(t);
    }
  });

  it("instructions field fits the MCP 2KB budget and is non-imperative", () => {
    const instr = renderBootInstructions("2.133.0");
    expect(instr.length).toBeLessThanOrEqual(2000);
    expect(instr).not.toMatch(/\byou MUST\b|\bALWAYS call\b|\bNEVER use\b/i);
    expect(instr).toMatch(/Mneme v2\.133\.0 is connected/);
    expect(instr).toMatch(/signals, not commands/);
  });

  it("instructions truncates at a row boundary if the table grows (never mid-line)", () => {
    // sanity: current content is whole; head + tail always present
    const instr = renderBootInstructions("9.9.9");
    expect(instr.startsWith("Mneme v9.9.9 is connected")).toBe(true);
    expect(instr.trimEnd().endsWith("use judgment.")).toBe(true);
    // every bullet line is complete (ends with a close paren from the `why`)
    for (const line of instr.split("\n").filter((l) => l.startsWith("• "))) {
      expect(line.trimEnd().endsWith(")")).toBe(true);
    }
  });

  it("buildBootPacket is deterministic and embeds capabilities", () => {
    const a = JSON.stringify(buildBootPacket({ version: "2.133.0" }));
    const b = JSON.stringify(buildBootPacket({ version: "2.133.0" }));
    expect(a).toBe(b);
    const p = buildBootPacket({ version: "2.133.0" });
    expect(p.capabilities).toEqual(CAPABILITY_LINES);
    expect(p.healthy).toBe(true);
    expect(p.decisionTable.length).toBe(DECISION_TABLE.length);
  });

  it("ranks the table by a task hint without dropping any row", () => {
    const ranked = buildBootPacket({ version: "2.133.0", task: "send code to the model safely" }).decisionTable;
    expect(ranked.length).toBe(DECISION_TABLE.length);
    // a rail row should bubble up for this task
    expect((ranked[0]!.tool + ranked[0]!.when).toLowerCase()).toMatch(/rail/);
  });

  it("caps embedded cortex facts at 12", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
    expect(buildBootPacket({ version: "2.133.0", cortexFacts: many }).cortexFacts.length).toBe(12);
  });

  it("emits a valid SessionStart hook config", () => {
    const h = JSON.parse(bootHookSnippet("mneme"));
    expect(h.hooks.SessionStart).toBeTruthy();
    expect(JSON.stringify(h)).toContain("boot --hook");
  });

  it("is total — hostile input never throws, always returns a usable packet", () => {
    expect(() => buildBootPacket(undefined as never)).not.toThrow();
    expect(() => buildBootPacket({ version: null as never, cortexFacts: null as never })).not.toThrow();
    expect(() => renderBootInstructions(undefined as never)).not.toThrow();
    const p = buildBootPacket({ version: null as never });
    expect(p.decisionTable.length).toBeGreaterThan(0);
  });
});
