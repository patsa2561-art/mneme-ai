// v2.22.3 — Finding #1 regression: verify command failed on
// "Mneme has 9 verification agents". Root cause: TOOL_COUNT_RE didn't
// match "verification agents" / "audit organs". This file pins the
// extended extraction + per-kind verification.

import { describe, expect, it } from "vitest";
import { extractFactClaims, countTruthSwarmOrgans } from "./fact_grounding.js";

describe("fact_grounding v2.22.3 — verification-agent extraction", () => {
  describe("swarm_organ_count extraction", () => {
    it("matches 'Mneme has 9 verification agents'", () => {
      const claims = extractFactClaims("Mneme has 9 verification agents running in parallel");
      const hit = claims.find((c) => c.kind === "swarm_organ_count");
      expect(hit).toBeDefined();
      expect(hit?.asserted).toBe("9");
    });

    it("matches 'fires 8 audit organs'", () => {
      const claims = extractFactClaims("The swarm fires 8 audit organs in parallel");
      expect(claims.find((c) => c.kind === "swarm_organ_count")?.asserted).toBe("8");
    });

    it("matches 'spawns 7 truth swarm organs'", () => {
      const claims = extractFactClaims("Spawns 7 truth swarm organs concurrently");
      expect(claims.find((c) => c.kind === "swarm_organ_count")?.asserted).toBe("7");
    });

    it("does NOT match unrelated counts ('5 stars')", () => {
      const claims = extractFactClaims("Rated 5 stars on npm");
      expect(claims.find((c) => c.kind === "swarm_organ_count")).toBeUndefined();
    });

    it("does NOT double-extract as both swarm_organ_count + tool_count", () => {
      const claims = extractFactClaims("Mneme has 9 verification agents");
      const swarm = claims.filter((c) => c.kind === "swarm_organ_count").length;
      const tools = claims.filter((c) => c.kind === "tool_count").length;
      expect(swarm).toBe(1);
      expect(tools).toBe(0);
    });
  });

  describe("tool_count synonyms broadened in v2.22.3", () => {
    it("matches 'exposes 800 primitives'", () => {
      const claims = extractFactClaims("Mneme exposes 800 primitives");
      expect(claims.find((c) => c.kind === "tool_count")?.asserted).toBe("800");
    });

    it("matches 'ships 50 modules'", () => {
      const claims = extractFactClaims("Ships 50 modules with this release");
      expect(claims.find((c) => c.kind === "tool_count")?.asserted).toBe("50");
    });
  });

  describe("countTruthSwarmOrgans", () => {
    it("returns 8 (current canonical organ count)", () => {
      expect(countTruthSwarmOrgans()).toBe(8);
    });
  });
});
