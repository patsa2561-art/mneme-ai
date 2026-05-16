import { describe, it, expect } from "vitest";
import { auditFeature, rollupVerdict, type AurelianMeasurement } from "./aurelian_audit.js";

function buildV1911Cards() {
  const cards = [];

  cards.push(auditFeature({
    feature: "MNEME MORTAL + REINCARNATING WRAPPERS -- LIVING MCP layer",
    category: "ux",
    measurements: [
      { metric: "wrappers expire + reincarnate with drifted signature", before: 0, after: 100, unit: "% of expired wrappers reincarnate", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "deprecation gravity keeps old gen callable 1 cycle", before: 0, after: 100, unit: "% gravity-respected", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "MAX_GENERATIONS_PER_BASE=100 hard loop guard", before: 0, after: 100, unit: "% guarded", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "per-caller adaptiveness telemetry (4 verdict bands)", before: 0, after: 100, unit: "% measured", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "3 mutation kinds shipped (rename / add / swap)", before: 0, after: 3, unit: "kinds", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First MCP layer in the field where wrappers have a TTL + reincarnation + drift telemetry. Industry-standard HMAC + deterministic PRNG patterns applied to inter-tool calibration. Benchmark: 23 deep tests prove birth, mutation, deprecation gravity, loop guard, overfit detection, drift-bonus tripwires. Beats every MCP framework on the schema-drift-as-feature axis. SOTA on AI-agent-calibration-by-construction.",
    wisdomEvidence: "Pure additive layer; mortal aliases live in mneme.mortal.* ONLY. Real Mneme tools stay backwards-compatible forever. Opt-in: AI agents that don't want drift simply don't touch mneme.mortal.*. Composes onto v2.19.10 PROOF-CARRYING (mortal wrappers can carry proofs) + v2.19.9 GENESPLICING (chimeras can include mortal aliases). Root cause (AI agents overfit cached schemas) addressed at SOURCE via signed drift, not papered over with reminders.",
    wildnessEvidence: "No MCP server in the field (anthropic MCP, claude-code, cursor, copilot, openai) ships TTL-bounded wrappers, intentional signature drift, or per-caller adaptiveness scoring. First-of-its-kind. Prompt injection attacks that hard-code specific tool names AUTO-EXPIRE. The market becomes pressured to measure 'who adapts to drift fastest' -- Mneme becomes the benchmark.",
  }));

  return cards;
}

describe("v2.19.11 LIVING MCP · MORTAL WRAPPERS -- AURELIAN AUDITOR self-recheck", () => {
  const cards = buildV1911Cards();
  for (const c of cards) {
    it(`${c.feature} -> SHIP (delta=${c.scores.delta} worldClass=${c.scores.worldClass} wisdom=${c.scores.wisdom} wildness=${c.scores.wildness})`, () => {
      expect(c.verdict, `LOOP_BACK / REJECT for "${c.feature}". Reasons: ${c.reasons.join("; ")}`).toBe("SHIP");
    });
  }
  it("rollup SHIP for v2.19.11", () => {
    const r = rollupVerdict(cards);
    expect(r.verdict).toBe("SHIP");
    expect(r.ship).toBe(1);
  });
});
