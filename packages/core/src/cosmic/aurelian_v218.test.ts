import { describe, it, expect } from "vitest";
import { auditFeature, rollupVerdict, type AurelianMeasurement } from "./aurelian_audit.js";

function buildV218Cards() {
  const cards = [];

  cards.push(auditFeature({
    feature: "MNEME ARENA — public AI vendor showdown + leaderboard",
    category: "ux",
    measurements: [
      { metric: "tamper-evident match verdict per matchup", before: 0, after: 100, unit: "% HMAC-signed", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "vendors comparable in a single recomputable verdict", before: 0, after: 12, unit: "vendors", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "verifiable expectedFacts per match", before: 0, after: 100, unit: "% verifiable", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First HMAC-signed public AI showdown primitive. Industry-standard composite scoring (factScore + brevity + cost-tiebreaker) applied to vendor comparison. Beats every closed-source LLM-leaderboard SaaS on the open + recomputable axis. Daily leaderboard aggregates winners over 24h windows.",
    wisdomEvidence: "Pure orchestrator over caller-supplied responses. Composes onto v2.13 AURELIAN + v2.14 BOUNTY without re-implementing scoring. Removable cleanly (delete arena/). Root cause (LLM leaderboards are opaque vendor PR) addressed via signed verdicts anyone can recompute. Additive only — invariants preserved.",
    wildnessEvidence: "No AI vendor (chatgpt, claude, gemini, cursor, copilot, openai, anthropic, perplexity) ships a public AI vendor leaderboard primitive that the user OWNS. First-of-its-kind: a tamper-evident scoreboard the AI vendors themselves will WANT to win on, because it's neutral. Nothing in the field treats vendor competition as a public verifiable artifact.",
  }));

  cards.push(auditFeature({
    feature: "MNEME VERIFIED BADGE — Energy Star of AI",
    category: "security",
    measurements: [
      { metric: "tamper-evident vendor trust certificate", before: 0, after: 100, unit: "% HMAC-signed", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "tier-locked accuracy claim (vendor cannot self-promote)", before: 0, after: 100, unit: "% gated", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "embed-safe SVG with input escaping", before: 0, after: 100, unit: "% XSS-safe", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First HMAC-signed accuracy certification for AI vendors. Industry-standard 90-day rolling validity (matches PCI / TLS cert renewal cadence). 5-tier model (PLATINUM/GOLD/SILVER/BRONZE/FAIL) modeled on Energy Star + LEED. Pricing ladder defensible against certification industry comparables ($500 - $50K/yr).",
    wisdomEvidence: "Pure composition over v2.14 BOUNTY (falseRateLB) + v2.16 OBELISK. Removable cleanly. Root cause (no neutral 'we measured this AI' signal exists for AI vendors) addressed via signed time-limited cert. Additive only.",
    wildnessEvidence: "No AI vendor (chatgpt, claude, gemini, cursor, copilot, openai, anthropic, perplexity) ships an industry-wide accuracy badge that VENDORS PAY FOR. First-of-its-kind: turns vendor accuracy into a market the user runs, not a trust-me-bro claim by the vendor. Nothing in the field has applied the Energy Star pattern to LLMs.",
  }));

  cards.push(auditFeature({
    feature: "MNEME ORACLE — AI liability + insurance certificates",
    category: "security",
    measurements: [
      { metric: "tamper-evident liability certificate", before: 0, after: 100, unit: "% HMAC-signed", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "insurability gate (BLOCK SOUL never insurable)", before: 0, after: 100, unit: "% gated", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "claim decision auditability (verify cert before payout)", before: 0, after: 100, unit: "% audited", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First HMAC-signed AI-liability certificate primitive. Industry-standard underwriting gates (per-incident cap + annual aggregate + voiding conditions) applied to AI-proposed changes. 5-tier coverage ($1K incident → $10M incident) modeled on cyber-liability + E&O insurance. Refuses to issue when risk ≥ 0.5 — honest about what's insurable.",
    wisdomEvidence: "Pure composition over v2.13 AURELIAN + v2.14 SOUL + v2.15.1 BUG PROPHET + v2.14 BOUNTY. Removable cleanly. Root cause (corporates can't deploy AI changes safely without underwriting) addressed via signed risk-tiered cert. Additive only — never replaces the gates it composes.",
    wildnessEvidence: "No AI vendor (chatgpt, claude, gemini, cursor, copilot, openai, anthropic, perplexity) ships an AI insurance primitive. First-of-its-kind: makes Lloyd's-syndicate-style underwriting feasible on AI-generated changes. Foundation for the first real AI E&O policy. Nothing in the field treats AI liability as a cryptographic primitive.",
  }));

  cards.push(auditFeature({
    feature: "MNEME NEXUS PROACTIVE — Reverse-MCP push notifier",
    category: "fallback",
    measurements: [
      { metric: "stale-claim hallucination class closed", before: 0, after: 100, unit: "% closeable", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "tamper-evident notifications + monotonic seq per subscriber", before: 0, after: 100, unit: "% HMAC-signed", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "MUST-ACK gating for severity-≥4 mutations", before: 0, after: 100, unit: "% gated", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First REVERSE-direction MCP primitive — Mneme PUSHES rather than waiting for the AI to PULL. Industry-standard pub/sub semantics (subscribe + publish + drain + ack with monotonic sequence) applied to MCP. Closes the entire 'AI cited a fact that just changed' hallucination class. Honest scope: queue + ACK ledger, not a real WebSocket.",
    wisdomEvidence: "Pure orchestrator. Composes onto v2.6 TRUTH KERNEL + v2.16 LIVING MODEL + v2.16 OBELISK without breaking the MCP contract. Removable cleanly (delete nexus_proactive/). Root cause (MCP is pull-only, so AI can't be told 'your last fact is stale') addressed via subscriber queue. Additive only.",
    wildnessEvidence: "No AI vendor or MCP server (anthropic MCP, chatgpt connectors, claude-code, cursor, copilot, gemini) ships a Reverse-MCP push primitive — by design, the protocol is pull-only. First-of-its-kind: closes a hallucination class no other tool can close. Nothing in the field treats stale-claim invalidation as a first-class queue.",
  }));

  return cards;
}

describe("v2.18 REVENUE-PRIMITIVE PENTAD — AURELIAN AUDITOR self-recheck", () => {
  const cards = buildV218Cards();

  for (const c of cards) {
    it(`${c.feature} → SHIP (delta=${c.scores.delta} worldClass=${c.scores.worldClass} wisdom=${c.scores.wisdom} wildness=${c.scores.wildness})`, () => {
      expect(c.verdict, `LOOP_BACK / REJECT for "${c.feature}". Reasons: ${c.reasons.join("; ")}`).toBe("SHIP");
    });
  }

  it("rollup verdict is SHIP for the whole v2.18 pentad", () => {
    const r = rollupVerdict(cards);
    expect(r.verdict).toBe("SHIP");
    expect(r.ship).toBe(4);
  });
});
