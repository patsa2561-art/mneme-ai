import { describe, it, expect } from "vitest";
import {
  parseFeatureNameClaims,
  verifyFeatureCoverage,
  autoAmendWhatsNew,
  stripHonestyAmendments,
  auditFeatureCoverage,
  DEFAULT_FEATURE_FAMILY_MAP,
} from "./index.js";

describe("v2.19.42 HONESTY GATE 2.0 · parseFeatureNameClaims", () => {
  it("extracts HOLY GRAIL QUADRUPLE feature names", () => {
    const body = "v2.19.34 shipped HOLY GRAIL QUADRUPLE — APOSTILLE + OUTCOME MARKET + ZK-FAIRNESS + ETERNITY";
    const claims = parseFeatureNameClaims(body, DEFAULT_FEATURE_FAMILY_MAP as Record<string, string[]>);
    const phrases = claims.map((c) => c.phrase.toUpperCase());
    expect(phrases).toContain("APOSTILLE");
    expect(phrases).toContain("OUTCOME MARKET");
    expect(phrases).toContain("ZK-FAIRNESS");
    expect(phrases).toContain("ETERNITY");
  });

  it("does not double-emit when phrase appears twice", () => {
    const body = "APOSTILLE is good. APOSTILLE is great.";
    const claims = parseFeatureNameClaims(body, DEFAULT_FEATURE_FAMILY_MAP as Record<string, string[]>);
    const apostille = claims.filter((c) => c.phrase === "APOSTILLE");
    expect(apostille.length).toBe(1);
  });

  it("returns empty on body without any known feature names", () => {
    const claims = parseFeatureNameClaims("nothing recognisable here", DEFAULT_FEATURE_FAMILY_MAP as Record<string, string[]>);
    expect(claims.length).toBe(0);
  });
});

describe("v2.19.42 HONESTY GATE 2.0 · verifyFeatureCoverage (alias-aware)", () => {
  it("status=covered when canonical family has tools", () => {
    const reports = verifyFeatureCoverage(
      [{ phrase: "APOSTILLE", expectedFamilies: ["apostille"] }],
      { mcpToolNames: new Set(["mneme.apostille.mint", "mneme.apostille.append"]) },
    );
    expect(reports[0]!.status).toBe("covered");
    expect(reports[0]!.toolCount).toBe(2);
  });

  it("status=alias_covered when only alias family has tools (the v2.19.40 N1 case)", () => {
    const reports = verifyFeatureCoverage(
      [{ phrase: "OUTCOME MARKET", expectedFamilies: ["outcome", "market"] }],
      { mcpToolNames: new Set(["mneme.market.post_task", "mneme.market.submit_bid"]) },
    );
    expect(reports[0]!.status).toBe("alias_covered");
    expect(reports[0]!.matchedFamily).toBe("market");
    expect(reports[0]!.toolCount).toBe(2);
  });

  it("status=uncovered when no family has tools", () => {
    const reports = verifyFeatureCoverage(
      [{ phrase: "PHANTOM FEATURE", expectedFamilies: ["phantom"] }],
      { mcpToolNames: new Set([]) },
    );
    expect(reports[0]!.status).toBe("uncovered");
    expect(reports[0]!.matchedFamily).toBeNull();
  });
});

describe("v2.19.42 HONESTY GATE 2.0 · autoAmendWhatsNew", () => {
  it("inserts disclaimer marker for uncovered phrase", () => {
    const body = "shipped PHANTOM FEATURE — best ever";
    const result = autoAmendWhatsNew(body, [
      { phrase: "PHANTOM FEATURE", expectedFamilies: ["phantom"], matchedFamily: null, toolCount: 0, status: "uncovered" },
    ]);
    expect(result.added).toBe(1);
    expect(result.amended).toContain("HONESTY-GATE: PHANTOM FEATURE has 0 MCP tools");
  });

  it("inserts informational marker for alias_covered (v2.19.40 OUTCOME MARKET case)", () => {
    const body = "shipped OUTCOME MARKET";
    const result = autoAmendWhatsNew(body, [
      { phrase: "OUTCOME MARKET", expectedFamilies: ["outcome", "market"], matchedFamily: "market", toolCount: 5, status: "alias_covered" },
    ]);
    expect(result.added).toBe(1);
    expect(result.amended).toContain("HONESTY-GATE: OUTCOME MARKET covered by 5 tools under alias mneme.market.*");
  });

  it("does not amend when status=covered", () => {
    const body = "shipped APOSTILLE";
    const result = autoAmendWhatsNew(body, [
      { phrase: "APOSTILLE", expectedFamilies: ["apostille"], matchedFamily: "apostille", toolCount: 5, status: "covered" },
    ]);
    expect(result.added).toBe(0);
    expect(result.amended).toBe(body);
  });

  it("idempotent — re-running yields identical output", () => {
    const body = "shipped PHANTOM FEATURE";
    const reports = [
      { phrase: "PHANTOM FEATURE" as const, expectedFamilies: ["phantom"], matchedFamily: null, toolCount: 0, status: "uncovered" as const },
    ];
    const r1 = autoAmendWhatsNew(body, reports);
    const r2 = autoAmendWhatsNew(r1.amended, reports);
    expect(r2.amended).toBe(r1.amended);
    expect(r2.added).toBe(0);
  });

  it("stripHonestyAmendments round-trips back to original body", () => {
    const body = "shipped PHANTOM FEATURE\nsomething else";
    const reports = [
      { phrase: "PHANTOM FEATURE" as const, expectedFamilies: ["phantom"], matchedFamily: null, toolCount: 0, status: "uncovered" as const },
    ];
    const amended = autoAmendWhatsNew(body, reports);
    const stripped = stripHonestyAmendments(amended.amended);
    expect(stripped).toBe(body);
  });
});

describe("v2.19.42 HONESTY GATE 2.0 · auditFeatureCoverage one-call", () => {
  it("composes parse + verify + amend for the canonical v2.19.40 N1 case", () => {
    const body = "v2.19.34 shipped HOLY GRAIL QUADRUPLE — APOSTILLE + OUTCOME MARKET + ZK-FAIRNESS + ETERNITY";
    const mcpToolNames = new Set([
      "mneme.apostille.mint", "mneme.apostille.append",
      "mneme.market.post_task", "mneme.market.submit_bid",
      "mneme.fairness.commit", "mneme.fairness.verify",
      "mneme.eternity.mint", "mneme.eternity.pin",
    ]);
    const r = auditFeatureCoverage({ body, runtime: { mcpToolNames } });
    expect(r.claims.length).toBeGreaterThanOrEqual(4);
    // OUTCOME MARKET + ZK-FAIRNESS should be alias_covered (not uncovered) thanks to fallback families
    const omr = r.reports.find((x) => x.phrase === "OUTCOME MARKET");
    const zk = r.reports.find((x) => x.phrase === "ZK-FAIRNESS");
    expect(omr?.status).toBe("alias_covered");
    expect(zk?.status).toBe("alias_covered");
    expect(r.amend.added).toBeGreaterThanOrEqual(2);
  });

  it("flags uncovered when feature has 0 tools anywhere", () => {
    const body = "shipped PHANTOM FEATURE";
    const r = auditFeatureCoverage({
      body,
      runtime: { mcpToolNames: new Set([]) },
      knownFeatures: { "PHANTOM FEATURE": ["phantom"] },
    });
    expect(r.reports[0]!.status).toBe("uncovered");
    expect(r.amend.amended).toContain("HONESTY-GATE: PHANTOM FEATURE has 0 MCP tools");
  });
});
