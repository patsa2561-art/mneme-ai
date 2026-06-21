/**
 * v3.110 — LEAN MODE: the honest, measured token fix. An MCP server's advertised
 * tools/list is re-sent to the model on EVERY request; Mneme's full catalog is
 * ~130k tokens of recurring overhead. Lean mode advertises only the essentials
 * (morph is the front door) — this test PROVES the cut is real (≥90%) and that
 * the front door + activation are in the lean set so full power is still reachable.
 */
import { describe, it, expect } from "vitest";
import { LEAN_TOOL_NAMES, measureLeanReduction, buildToolMap } from "./index.js";

describe("v3.110 · LEAN MODE — measured tool-list token cut", () => {
  it("cuts the advertised tool-list ≥90% (measured, not claimed)", async () => {
    const r = await measureLeanReduction();
    expect(r.fullTools).toBeGreaterThan(500);
    expect(r.leanTools).toBe(LEAN_TOOL_NAMES.length);
    expect(r.reductionPct).toBeGreaterThanOrEqual(90);
    expect(r.leanBytes).toBeLessThan(r.fullBytes);
  });

  it("the front door + activation are in the lean set (full catalog stays reachable via morph)", () => {
    expect(LEAN_TOOL_NAMES).toContain("mneme.morph");
    expect(LEAN_TOOL_NAMES).toContain("mneme.boot");
  });

  it("every lean tool is a real, registered tool (no dangling advertisement)", () => {
    const tm = buildToolMap();
    for (const name of LEAN_TOOL_NAMES) expect(tm.has(name), name).toBe(true);
  });

  it("CallTool can still reach a NON-advertised tool by name (lean never removes capability)", () => {
    const tm = buildToolMap();
    // a tool deliberately NOT in the lean set must still resolve from the registry
    expect(LEAN_TOOL_NAMES).not.toContain("mneme.canon.emit");
    expect(tm.has("mneme.canon.emit")).toBe(true);
  });
});
