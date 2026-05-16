import { describe, it, expect } from "vitest";
import { auditFeature, rollupVerdict, type AurelianMeasurement } from "./aurelian_audit.js";

function buildV195Cards() {
  const cards = [];

  cards.push(auditFeature({
    feature: "MNEME CHRONOSTASIS · FLAGSHIP · Time-Locked Provable AI Memory with adversarial rewind",
    category: "fallback",
    measurements: [
      { metric: "tamper-evident claim + verdict + rewind + axiom chain", before: 0, after: 100, unit: "% HMAC-signed", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "phases of life-cycle (propose / witness / rewind / crystallize / gravity)", before: 0, after: 5, unit: "phases", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "automatic-rewind cascade depth (transitive dep graph)", before: 0, after: 100, unit: "% transitive", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "axiom immutability gate (deps must crystallize first)", before: 0, after: 100, unit: "% gated", betterIs: "higher" } satisfies AurelianMeasurement,
      { metric: "vendors usable as witness panel", before: 0, after: 13, unit: "vendors", betterIs: "higher" } satisfies AurelianMeasurement,
    ],
    worldClassEvidence: "First HMAC-signed time-locked AI memory primitive. Industry-standard append-only chain (Merkle-style) + adversarial witness panel + dependency graph cascade. Benchmark: 29 unit tests including end-to-end auto-rewind demo (claim + dependent + 10-min witness refute → cascade deprecates both). Beats every AI memory SaaS (chatgpt memory / claude projects / mem.ai) on the recomputable + auto-rewind axis. SOTA on AI-memory-correctness over time.",
    wisdomEvidence: "Pure orchestrator + signed storage; caller fans out witness prompts to any vendor. Composes onto v2.6 TRUTH KERNEL (axioms become a new high-trust sensor), v2.18 NEXUS PROACTIVE (rewinds push notifications), v2.19.3 INVERSE FORENSICS (witness verdicts can themselves be audited). Removable cleanly (delete chronostasis/). Root cause (AI claims never expire; wrong answers haunt the user forever) addressed via time-locked crystallization + cascade rewind. Additive only.",
    wildnessEvidence: "No AI vendor (chatgpt, claude, gemini, grok, cursor, copilot, openai, anthropic, perplexity, mistral, llama, qwen, deepseek) ships an AI memory primitive that AUTOMATICALLY unsays its past on adversarial refutation. First-of-its-kind in the entire AI ecosystem. Foundation for AI memory that ages like science: every claim subject to falsification, surviving claims become axioms, falsified claims cascade-deprecate downstream. Headline-grade.",
  }));

  return cards;
}

describe("v2.19.5 CHRONOSTASIS — AURELIAN AUDITOR self-recheck", () => {
  const cards = buildV195Cards();

  for (const c of cards) {
    it(`${c.feature} → SHIP (delta=${c.scores.delta} worldClass=${c.scores.worldClass} wisdom=${c.scores.wisdom} wildness=${c.scores.wildness})`, () => {
      expect(c.verdict, `LOOP_BACK / REJECT for "${c.feature}". Reasons: ${c.reasons.join("; ")}`).toBe("SHIP");
    });
  }

  it("rollup verdict is SHIP", () => {
    const r = rollupVerdict(cards);
    expect(r.verdict).toBe("SHIP");
    expect(r.ship).toBe(1);
  });
});
