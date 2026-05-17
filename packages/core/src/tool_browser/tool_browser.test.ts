import { describe, it, expect } from "vitest";
import {
  browseCatalog,
  suggestTools,
  computeBrowseStats,
  formatBrowseStatsLine,
  TOOL_BROWSER_TUNABLES,
  type ToolCatalogEntry,
} from "./index.js";

const SAMPLE_CATALOG: ToolCatalogEntry[] = [
  { name: "mneme.status", tier: "starter", description: "show status", triggers: ["status"] },
  { name: "mneme.ask", tier: "starter", description: "semantic Q&A", triggers: ["ask"] },
  { name: "mneme.truth.forensic", tier: "starter", description: "verify claim", triggers: ["verify", "truth"] },
  { name: "mneme.synapse.sync_export", tier: "starter", description: "cross-device sync" },
  { name: "mneme.handoff.snapshot", tier: "starter", description: "fresh context capture" },
  { name: "mneme.arena.judge", tier: "explorer", description: "AI vendor showdown" },
  { name: "mneme.soul.embalm", tier: "explorer", description: "agent state snapshot" },
  { name: "mneme.fork.record", tier: "deep", description: "fork lineage" },
  { name: "mneme.beacon.spawn", tier: "experimental", description: "QR transfer server" },
  { name: "mneme.alien.template", tier: "experimental", description: "alien skill template" },
];

describe("v2.19.33 B3 — browseCatalog (pagination + filtering)", () => {
  it("returns all entries when no filter", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG });
    expect(r.totalMatches).toBe(SAMPLE_CATALOG.length);
    expect(r.entries.length).toBe(SAMPLE_CATALOG.length);
  });

  it("filters by tier=starter (5 of 10)", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG, tier: "starter" });
    expect(r.totalMatches).toBe(5);
    expect(r.entries.every((e) => e.tier === "starter")).toBe(true);
  });

  it("filters by family prefix (synapse → 1)", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG, family: "synapse" });
    expect(r.totalMatches).toBe(1);
    expect(r.entries[0]!.name).toBe("mneme.synapse.sync_export");
  });

  it("substring query across name/description/triggers", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG, query: "verify" });
    // truth.forensic has 'verify' in triggers
    expect(r.totalMatches).toBe(1);
    expect(r.entries[0]!.name).toBe("mneme.truth.forensic");
  });

  it("paginates: limit=3 offset=0 returns 3 of 10", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG, limit: 3, offset: 0 });
    expect(r.entries.length).toBe(3);
    expect(r.totalMatches).toBe(10);
  });

  it("paginates: limit=3 offset=3 returns next 3", () => {
    const a = browseCatalog({ catalog: SAMPLE_CATALOG, limit: 3, offset: 0 });
    const b = browseCatalog({ catalog: SAMPLE_CATALOG, limit: 3, offset: 3 });
    expect(a.entries[0]!.name).not.toBe(b.entries[0]!.name);
  });

  it("DETERMINISTIC sort: starter > explorer > deep > experimental, then alpha", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG });
    // First 5 should all be starter
    expect(r.entries.slice(0, 5).every((e) => e.tier === "starter")).toBe(true);
    // Next 2 should be explorer
    expect(r.entries.slice(5, 7).every((e) => e.tier === "explorer")).toBe(true);
  });

  it("pulseLine shows progress", () => {
    const r = browseCatalog({ catalog: SAMPLE_CATALOG, limit: 5 });
    expect(r.pulseLine).toContain("BROWSE");
    expect(r.pulseLine).toContain("page 1");
  });

  it("DEFENSIVE: empty catalog returns empty page (no throw)", () => {
    const r = browseCatalog({ catalog: [] });
    expect(r.totalMatches).toBe(0);
    expect(r.entries).toEqual([]);
  });

  it("DEFENSIVE: malformed catalog entries dropped silently", () => {
    const dirty: ToolCatalogEntry[] = [...SAMPLE_CATALOG, null as unknown as ToolCatalogEntry, { name: 123 as unknown as string }];
    const r = browseCatalog({ catalog: dirty });
    expect(r.totalMatches).toBe(SAMPLE_CATALOG.length);
  });
});

describe("v2.19.33 B3 — suggestTools (repo-aware ranking)", () => {
  it("intent matching dominates: 'verify claim' → truth.forensic top", () => {
    const r = suggestTools({ catalog: SAMPLE_CATALOG, intent: "verify claim" });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions[0]!.tool.name).toBe("mneme.truth.forensic");
  });

  it("starter tier bias when no other signals", () => {
    const r = suggestTools({ catalog: SAMPLE_CATALOG });
    // top suggestion should be a starter tool
    expect(r.suggestions[0]!.tool.tier).toBe("starter");
  });

  it("recency cooldown: recently-used tools demoted", () => {
    // Use two tools that both match the intent so cooldown actually swaps rank
    const cat: ToolCatalogEntry[] = [
      { name: "mneme.truth.forensic", tier: "starter", description: "verify claim", triggers: ["verify"] },
      { name: "mneme.fork.verify_ledger", tier: "deep", description: "verify ledger" },
    ];
    const noRecent = suggestTools({ catalog: cat, intent: "verify" });
    const withRecent = suggestTools({ catalog: cat, intent: "verify", recentActions: [{ action: "mneme.truth.forensic", ts: Date.now() }] });
    const noRecentTruthIdx = noRecent.suggestions.findIndex((s) => s.tool.name === "mneme.truth.forensic");
    const withRecentTruthIdx = withRecent.suggestions.findIndex((s) => s.tool.name === "mneme.truth.forensic");
    // truth.forensic should rank LOWER (higher index) when in cooldown
    expect(withRecentTruthIdx).toBeGreaterThan(noRecentTruthIdx);
  });

  it("repo signal: uncommittedChanges boosts premortem/guard/truth", () => {
    const truthOnly = SAMPLE_CATALOG.find((t) => t.name === "mneme.truth.forensic")!;
    const r = suggestTools({ catalog: [truthOnly], repoSignals: { hasUncommittedChanges: true } });
    expect(r.suggestions[0]!.reasons.some((x) => /uncommitted/.test(x))).toBe(true);
  });

  it("DETERMINISTIC: same input → same ranking", () => {
    const a = suggestTools({ catalog: SAMPLE_CATALOG, intent: "verify" });
    const b = suggestTools({ catalog: SAMPLE_CATALOG, intent: "verify" });
    expect(a.suggestions.map((x) => x.tool.name)).toEqual(b.suggestions.map((x) => x.tool.name));
    expect(a.suggestions.map((x) => x.score)).toEqual(b.suggestions.map((x) => x.score));
  });

  it("DEFAULT limit = 5", () => {
    const r = suggestTools({ catalog: SAMPLE_CATALOG, intent: "tier mneme" });
    expect(r.suggestions.length).toBeLessThanOrEqual(5);
  });

  it("custom limit honored", () => {
    const r = suggestTools({ catalog: SAMPLE_CATALOG, intent: "mneme", limit: 3 });
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("DEFENSIVE: empty catalog returns empty suggestions", () => {
    const r = suggestTools({ catalog: [], intent: "anything" });
    expect(r.suggestions.length).toBe(0);
    expect(r.pulseLine).toContain("no signals");
  });
});

describe("v2.19.33 B3 — A/B before-vs-after STARTER expansion", () => {
  // The user-audit complained 13/594 = 2.2% starter coverage.
  // v2.19.33 expands the whitelist; this test pins the new floor.
  it("expanded STARTER_WHITELIST is ≥30 entries (was 13 in audit)", async () => {
    const tt = await import("../tool_tier/index.js");
    expect(tt.STARTER_WHITELIST.size).toBeGreaterThanOrEqual(30);
  });

  it("expanded STARTER_WHITELIST includes new v2.19.31/32 headline tools", async () => {
    const tt = await import("../tool_tier/index.js");
    expect(tt.STARTER_WHITELIST.has("mneme.truth.forensic")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.truth.contradictions")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.handoff.snapshot")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.synapse.sync_export")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.browse")).toBe(true);
    expect(tt.STARTER_WHITELIST.has("mneme.suggest")).toBe(true);
  });

  it("A/B DELTA: post-fix STARTER count ≥ 2× pre-fix audit baseline (13)", async () => {
    const tt = await import("../tool_tier/index.js");
    expect(tt.STARTER_WHITELIST.size).toBeGreaterThanOrEqual(26);
  });
});

describe("v2.19.33 B3 — stats + resilience", () => {
  it("computeBrowseStats reports counts + percentage", () => {
    const s = computeBrowseStats(SAMPLE_CATALOG);
    expect(s.starterCount).toBe(5);
    expect(s.explorerCount).toBe(2);
    expect(s.deepCount).toBe(1);
    expect(s.experimentalCount).toBe(2);
    expect(s.totalTools).toBe(10);
    expect(s.starterPct).toBe(50);
    expect(formatBrowseStatsLine(s)).toContain("CATALOG");
  });

  it("PROTOCOL_VERSION exposed", () => {
    expect(TOOL_BROWSER_TUNABLES.PROTOCOL_VERSION).toBe(1);
  });

  it("1000 random browse/suggest calls never crash", () => {
    const tiers: Array<"starter" | "explorer" | "deep" | "experimental"> = ["starter", "explorer", "deep", "experimental"];
    for (let i = 0; i < 1000; i++) {
      const tier = tiers[Math.floor(Math.random() * tiers.length)];
      expect(() => browseCatalog({ catalog: SAMPLE_CATALOG, tier, limit: Math.floor(Math.random() * 50) })).not.toThrow();
      expect(() => suggestTools({
        catalog: SAMPLE_CATALOG,
        intent: `random ${Math.random()}`,
        recentActions: [{ action: `mneme.x${i}`, ts: i }],
      })).not.toThrow();
    }
  });
});
