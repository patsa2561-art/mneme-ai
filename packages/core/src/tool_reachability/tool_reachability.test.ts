import { describe, it, expect } from "vitest";
import {
  scanReachability,
  verifyReachabilityReport,
  loadSurface,
  ghostListSummary,
  formatReachabilityLine,
  type SurfaceSource,
  type ReachabilityReport,
} from "./index.js";

const SECRET = "reach-test-secret-998877";

const ROUTER_SRC: SurfaceSource = {
  kind: "cli_router",
  source: "fake/router.ts",
  text: `
    import { buildAllTools } from "@mneme-ai/mcp";
    function groupByFamily(tools) { /* ... */ }
  `,
};

const SYLLABUS_SRC: SurfaceSource = {
  kind: "welcome_syllabus",
  source: "fake/agent_manifest.ts",
  text: `
    { command: "mneme.arena.judge", group: "arena", since: "2.18.0" },
    { command: "mneme.proof.attach", group: "proof", since: "2.19.10" },
  `,
};

const WHATSNEW_SRC: SurfaceSource = {
  kind: "whats_new",
  source: "fake/whats_new.ts",
  text: `
    headline: "ARENA judging + proof carrying",
    body: "mneme.arena.judge and mneme.proof.attach now ship",
  `,
};

const SUGGEST_SRC: SurfaceSource = {
  kind: "suggested_next",
  source: "fake/reverse.ts",
  text: `
    { forTool: "mneme.inverse.audit", suggested: "mneme.chronostasis.tick" }
  `,
};

const CAPS_SRC: SurfaceSource = {
  kind: "capabilities",
  source: "fake/_capabilities.ts",
  text: `family: mneme.arena, family: mneme.proof`,
};

describe("v2.19.17 TOOL REACHABILITY · scanReachability", () => {
  it("scores a well-surfaced tool with all 5 surfaces hitting", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [ROUTER_SRC, SYLLABUS_SRC, WHATSNEW_SRC, SUGGEST_SRC, CAPS_SRC],
      secret: SECRET,
    });
    expect(r.perTool).toHaveLength(1);
    const arena = r.perTool[0]!;
    expect(arena.toolName).toBe("mneme.arena.judge");
    expect(arena.score).toBeGreaterThanOrEqual(3); // router + syllabus + whats_new + caps at least
    expect(arena.ghost).toBe(false);
    expect(arena.hits.map((h) => h.surface)).toContain("cli_router");
  });

  it("flags a tool with ZERO surfaces as ghost (score=0)", () => {
    const r = scanReachability({
      catalog: ["mneme.nobody.knows"],
      surfaces: [SYLLABUS_SRC, WHATSNEW_SRC, CAPS_SRC],
      secret: SECRET,
    });
    const t = r.perTool[0]!;
    expect(t.score).toBe(0);
    expect(t.ghost).toBe(true);
    expect(r.ghostCount).toBe(1);
    expect(r.ghostList).toEqual(["mneme.nobody.knows"]);
  });

  it("router scanner credits ALL families when auto-router source mentions buildAllTools + groupByFamily", () => {
    const r = scanReachability({
      catalog: ["mneme.x.a", "mneme.y.b", "mneme.zzz.c"],
      surfaces: [ROUTER_SRC], // ONLY router
      secret: SECRET,
    });
    // All 3 tools should get the cli_router hit because router auto-routes ALL families
    expect(r.perTool.every((t) => t.score === 1)).toBe(true);
    expect(r.ghostCount).toBe(0);
  });

  it("enforceFamilies filter scopes the report to specified prefixes only", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge", "mneme.legacy.old", "mneme.proof.attach"],
      surfaces: [ROUTER_SRC, SYLLABUS_SRC],
      enforceFamilies: ["arena", "proof"], // skip legacy
      secret: SECRET,
    });
    expect(r.perTool).toHaveLength(2);
    expect(r.perTool.map((t) => t.toolName).sort()).toEqual(["mneme.arena.judge", "mneme.proof.attach"]);
  });

  it("aggregate stats: totalTools / ghostCount / meanScore", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge", "mneme.unknown.ghost"],
      surfaces: [ROUTER_SRC, SYLLABUS_SRC], // router covers both via auto-route; syllabus only covers arena
      secret: SECRET,
    });
    expect(r.totalTools).toBe(2);
    // Both have router hit (auto-route); arena ALSO has syllabus hit
    expect(r.ghostCount).toBe(0);
    expect(r.meanScore).toBeGreaterThan(1);
  });

  it("non-mneme.X.Y catalog entries are skipped", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge", "mneme", "mneme.too.many.dots"],
      surfaces: [ROUTER_SRC],
      secret: SECRET,
    });
    expect(r.perTool).toHaveLength(1);
    expect(r.perTool[0]!.toolName).toBe("mneme.arena.judge");
  });

  it("includes evidence excerpt per hit (≤80 chars)", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [SYLLABUS_SRC],
      secret: SECRET,
    });
    const t = r.perTool[0]!;
    expect(t.hits.length).toBeGreaterThan(0);
    expect(t.hits[0]!.evidence.length).toBeLessThanOrEqual(80);
  });
});

describe("v2.19.17 TOOL REACHABILITY · verifyReachabilityReport", () => {
  it("verifies untampered report", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [ROUTER_SRC],
      secret: SECRET,
    });
    expect(verifyReachabilityReport(r, SECRET).ok).toBe(true);
  });

  it("rejects forged report (tampered ghostCount)", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [ROUTER_SRC],
      secret: SECRET,
    });
    const forged: ReachabilityReport = { ...r, ghostCount: 99 };
    expect(verifyReachabilityReport(forged, SECRET).ok).toBe(false);
  });

  it("fails with wrong secret", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [ROUTER_SRC],
      secret: SECRET,
    });
    expect(verifyReachabilityReport(r, "wrong").ok).toBe(false);
  });
});

describe("v2.19.17 TOOL REACHABILITY · loadSurface + summary helpers", () => {
  it("loadSurface returns null for non-existent file", () => {
    const s = loadSurface("welcome_syllabus", "/nope/does/not/exist.ts");
    expect(s).toBeNull();
  });

  it("ghostListSummary celebrates zero ghosts", () => {
    const r = scanReachability({
      catalog: ["mneme.arena.judge"],
      surfaces: [ROUTER_SRC],
      secret: SECRET,
    });
    const line = ghostListSummary(r);
    expect(line).toContain("NO GHOSTS");
  });

  it("ghostListSummary lists ghost tools with sample size cap", () => {
    const catalog = Array.from({ length: 15 }, (_, i) => `mneme.ghost${i}.tool`);
    const r = scanReachability({
      catalog,
      surfaces: [SYLLABUS_SRC], // none of the ghost tools mentioned
      secret: SECRET,
    });
    const line = ghostListSummary(r, 5);
    expect(line).toContain("👻");
    expect(line).toContain("15 ghost tool(s)");
    expect(line.endsWith("…")).toBe(true);
  });

  it("formatReachabilityLine uses appropriate glyph per score", () => {
    const t1 = { toolName: "mneme.a.b", family: "a", action: "b", score: 0, hits: [], ghost: true };
    const t2 = { toolName: "mneme.c.d", family: "c", action: "d", score: 1, hits: [{ surface: "cli_router" as const, evidence: "x" }], ghost: false };
    const t3 = { toolName: "mneme.e.f", family: "e", action: "f", score: 3, hits: [], ghost: false };
    expect(formatReachabilityLine(t1)).toContain("👻");
    expect(formatReachabilityLine(t2)).toContain("·");
    expect(formatReachabilityLine(t3)).toContain("🎯");
  });
});

describe("v2.19.17 TOOL REACHABILITY · the W2-style ghost-tool kill scenario", () => {
  it("simulates the user's exact complaint: tool ships but no user-facing surface mentions it = REPORT FLAGS IT", () => {
    // Imagine v2.19.X added 4 tools but forgot to update welcome syllabus / whats_new
    const catalog = [
      "mneme.arena.judge",         // well-surfaced
      "mneme.proof.attach",        // well-surfaced
      "mneme.shadow.forgotten",    // ghost
      "mneme.silent.hidden",       // ghost
    ];
    const r = scanReachability({
      catalog,
      surfaces: [SYLLABUS_SRC, WHATSNEW_SRC, SUGGEST_SRC, CAPS_SRC], // NO router; only syllabus + whatsnew + caps
      enforceFamilies: ["arena", "proof", "shadow", "silent"],
      secret: SECRET,
    });
    expect(r.ghostCount).toBe(2);
    expect(r.ghostList).toEqual(["mneme.shadow.forgotten", "mneme.silent.hidden"]);
    // The well-surfaced ones have hits from syllabus/whats_new/caps (no router in this scenario)
    expect(r.perTool.filter((t) => t.toolName === "mneme.arena.judge")[0]!.score).toBeGreaterThan(0);
  });
});
