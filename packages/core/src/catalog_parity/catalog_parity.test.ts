import { describe, it, expect } from "vitest";
import { computeParity, extractMcpFamilies, verifyParityReport, formatParityLine } from "./index.js";

const SECRET = "catalog-parity-test-secret-997744";

describe("v2.19.22 CATALOG PARITY · G2 quick-win", () => {
  it("extractMcpFamilies parses mneme.<family>.<action> -> family set", () => {
    const fams = extractMcpFamilies([
      "mneme.arena.judge", "mneme.arena.leaderboard",
      "mneme.badge.issue",
      "not_mneme.foo.bar",
      "mneme.too.many.parts",
    ]);
    expect(fams.has("arena")).toBe(true);
    expect(fams.has("badge")).toBe(true);
    expect(fams.has("foo")).toBe(false);
    expect(fams.has("too")).toBe(false);
    expect(fams.size).toBe(2);
  });

  it("classifies into shared / mcp-only / legacy-only correctly", () => {
    const r = computeParity({
      cliTopLevelCommands: ["ghost", "status", "ask", "premortem"],
      mcpToolNames: [
        "mneme.ghost.distill",      // shared (ghost both)
        "mneme.arena.judge",        // mcp-only
        "mneme.badge.issue",        // mcp-only
        "mneme.status.report",      // shared
      ],
      secret: SECRET,
    });
    expect(r.sharedFamilies).toEqual(["ghost", "status"]);
    expect(r.mcpOnlyFamilies).toEqual(["arena", "badge"]);
    expect(r.legacyOnlyCommands).toEqual(["ask", "premortem"]);
    expect(r.totalMcpFamilies).toBe(4);
  });

  it("parityRatio = shared / (shared + mcp-only)", () => {
    const r = computeParity({
      cliTopLevelCommands: ["a", "b", "c"],
      mcpToolNames: ["mneme.a.x", "mneme.b.x", "mneme.d.x", "mneme.e.x"],
      secret: SECRET,
    });
    expect(r.sharedFamilies).toEqual(["a", "b"]);
    expect(r.mcpOnlyFamilies).toEqual(["d", "e"]);
    expect(r.parityRatio).toBe(2 / 4);
  });

  it("100% parity when every MCP family has a CLI counterpart", () => {
    const r = computeParity({
      cliTopLevelCommands: ["arena", "badge"],
      mcpToolNames: ["mneme.arena.x", "mneme.badge.y"],
      secret: SECRET,
    });
    expect(r.parityRatio).toBe(1.0);
    expect(r.mcpOnlyFamilies).toEqual([]);
  });

  it("HMAC signature verifies on untampered report; fails on tamper", () => {
    const r = computeParity({
      cliTopLevelCommands: ["x"],
      mcpToolNames: ["mneme.x.y"],
      secret: SECRET,
    });
    expect(verifyParityReport(r, SECRET)).toBe(true);
    const tampered = { ...r, totalMcpTools: 9999 };
    expect(verifyParityReport(tampered, SECRET)).toBe(false);
  });

  it("formatParityLine renders single-line digest", () => {
    const r = computeParity({
      cliTopLevelCommands: ["a", "b"],
      mcpToolNames: ["mneme.a.x", "mneme.c.x"],
      secret: SECRET,
    });
    const line = formatParityLine(r);
    expect(line).toContain("PARITY");
    expect(line).toContain("50.0%");
  });

  it("MEASURED 100% determinism: same input -> same sig (50 trials)", () => {
    const input = {
      cliTopLevelCommands: ["arena", "ghost", "status"],
      mcpToolNames: ["mneme.arena.judge", "mneme.ghost.distill", "mneme.badge.issue"],
      secret: SECRET,
    };
    const first = computeParity(input).sig;
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (computeParity(input).sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });

  it("ordering of input lists does NOT change report (canonicalised internally)", () => {
    const a = computeParity({
      cliTopLevelCommands: ["c", "a", "b"],
      mcpToolNames: ["mneme.b.x", "mneme.a.y"],
      secret: SECRET,
    });
    const b = computeParity({
      cliTopLevelCommands: ["a", "b", "c"],
      mcpToolNames: ["mneme.a.y", "mneme.b.x"],
      secret: SECRET,
    });
    expect(a.sig).toBe(b.sig);
    expect(a.parityRatio).toBe(b.parityRatio);
  });
});
