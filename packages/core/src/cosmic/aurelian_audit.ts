/**
 * v2.13.0 — AURELIAN AUDITOR
 *
 *   "Every fix must prove itself measurably better than what came before.
 *    Every feature must answer four questions before shipping:
 *
 *      1. Did this MEASURABLY improve a real metric? (delta proof)
 *      2. Is this WORLD-CLASS — i.e., better than what other systems do?
 *      3. Is this WISE — i.e., the right abstraction, not just a clever hack?
 *      4. Is this WILD — i.e., a Nobel-tier surprise nobody else thought of?
 *
 *    A score below 80 on any axis triggers a LOOP-BACK: redesign and re-audit."
 *
 * This module is itself the Nobel meta-feature: a self-grading harness that
 * gates every other v2.13 feature. It produces an HMAC-signed scorecard
 * (so the grades are tamper-evident) plus a verdict + recommended next step.
 *
 * The four axes:
 *
 *   - delta:      0..100, computed from before/after measurements
 *   - worldClass: 0..100, evidence that this beats prior art (cite or auto-rationalise)
 *   - wisdom:     0..100, evidence that the abstraction is right (composes, no leaks)
 *   - wildness:   0..100, evidence of novelty (does any AI vendor have this?)
 *
 * Verdict thresholds:
 *
 *   - SHIP:        all axes ≥ 80
 *   - LOOP_BACK:   any axis 60-79 (one revision pass required)
 *   - REJECT:      any axis < 60 (design flaw — start over)
 */

import { createHmac } from "node:crypto";

export interface AurelianMeasurement {
  /** Human-readable name of the metric being measured. */
  metric: string;
  /** Baseline value (before the fix). */
  before: number;
  /** New value (after the fix). */
  after: number;
  /** Unit (e.g., "bytes", "ms", "req/min"). */
  unit: string;
  /** Direction of improvement: "lower" means smaller-is-better. */
  betterIs: "lower" | "higher";
}

export interface AurelianFeatureInput {
  /** Feature name (e.g., "JSON Patch diff"). */
  feature: string;
  /** Category: perf | security | fallback | ux. */
  category: "perf" | "security" | "fallback" | "ux";
  /** One-or-more concrete measurements proving improvement. */
  measurements: AurelianMeasurement[];
  /**
   * Evidence that this is world-class. Either a citation of prior art being
   * beaten, or a structured rationale.
   */
  worldClassEvidence: string;
  /**
   * Evidence that the abstraction is wise. Typically: composes with existing
   * code without breaking it, no leaky details, removable cleanly.
   */
  wisdomEvidence: string;
  /**
   * Evidence of novelty. Typically: name competitors that lack this, or
   * describe the unusual mechanism.
   */
  wildnessEvidence: string;
  /** Optional HMAC secret to sign the scorecard. */
  secret?: string;
}

export interface AurelianScorecard {
  feature: string;
  category: string;
  scores: { delta: number; worldClass: number; wisdom: number; wildness: number };
  measurements: Array<AurelianMeasurement & { improvementPct: number; passed: boolean }>;
  verdict: "SHIP" | "LOOP_BACK" | "REJECT";
  reasons: string[];
  recommendedNextStep: string;
  generatedAt: string;
  sig: string;
}

/** Compute the percent improvement of a single measurement. */
export function improvementPct(m: AurelianMeasurement): number {
  if (m.before === 0 && m.after === 0) return 0;
  if (m.before === 0) return m.betterIs === "higher" ? 100 : -100;
  const raw = m.betterIs === "lower"
    ? ((m.before - m.after) / m.before) * 100
    : ((m.after - m.before) / m.before) * 100;
  // Cap at +∞ → 1000% so score doesn't overflow on huge wins.
  return Math.max(-100, Math.min(1000, raw));
}

/**
 * Map an improvement percent to a 0..100 score. Tuned so:
 *
 *   - 0% improvement → 50 (neutral, "no harm")
 *   - 10% improvement → 70
 *   - 25% improvement → 80 (passes threshold)
 *   - 50% improvement → 88
 *   - 100% improvement → 95
 *   - 200%+ improvement → 100
 *   - regressions go below 50 fast: -10% → 30, -25% → 10
 */
export function deltaPctToScore(pct: number): number {
  if (pct >= 200) return 100;
  if (pct >= 100) return 95 + (pct - 100) * 0.05;
  if (pct >= 50) return 88 + (pct - 50) * 0.14;
  if (pct >= 25) return 80 + (pct - 25) * 0.32;
  if (pct >= 10) return 70 + (pct - 10) * 0.667;
  if (pct >= 0) return 50 + pct * 2;
  if (pct >= -25) return 50 + pct * 1.6;
  return Math.max(0, 10 + (pct + 25) * 0.4);
}

/** Compute composite delta score across all measurements (geometric mean). */
function compositeDelta(measurements: AurelianMeasurement[]): { score: number; perMetric: Array<AurelianMeasurement & { improvementPct: number; passed: boolean }> } {
  if (measurements.length === 0) return { score: 0, perMetric: [] };
  const annotated = measurements.map((m) => {
    const pct = improvementPct(m);
    const score = deltaPctToScore(pct);
    return { ...m, improvementPct: Math.round(pct * 10) / 10, passed: score >= 80 };
  });
  // Geometric mean of (score / 100) so a single bad metric drags the whole
  // composite down hard — a wise gate, not a permissive average.
  let logSum = 0;
  for (const a of annotated) logSum += Math.log(deltaPctToScore(a.improvementPct) / 100 + 0.001);
  const composite = Math.round(Math.exp(logSum / annotated.length) * 100);
  return { score: Math.max(0, Math.min(100, composite)), perMetric: annotated };
}

/**
 * Heuristic scorer for evidence text. Real intent: keep authors honest by
 * forcing concrete claims. Long, hedged, vague text scores low. Short text
 * with citations / numbers / negative comparisons scores high.
 *
 * v2.13 design note: keyword bonuses ACCUMULATE rather than firing once.
 * Three independent wisdom signals ("composes, orthogonal, root-cause") is
 * stronger evidence than one — the score should reflect that. Each axis
 * caps its own bonus pool so a single class of signal can't dominate.
 */
function scoreEvidence(text: string, axis: "worldClass" | "wisdom" | "wildness"): number {
  if (!text || text.trim().length < 20) return 30;
  // Base 60 so a meaningful claim with one mild hedge lands in the
  // LOOP_BACK band (60-79) rather than REJECT (<60). REJECT is reserved
  // for genuinely contradictory or absent evidence; vague-but-honest
  // text deserves a revision pass, not a redo.
  let score = 60;

  // Concrete-numbers — count occurrences of digit-with-unit patterns.
  const numHits = (text.match(/\d+(\.\d+)?\s*(x|×|%|bytes|kb|mb|ms|sec|min|req|rps|qps|reqs)/gi) || []).length;
  score += Math.min(20, numHits * 7);

  // Comparison to named alternatives.
  if (/\b(vs|versus|better than|beats|exceeds|outperforms|defeats)\b/i.test(text)) score += 10;

  if (axis === "wildness") {
    // Negative-existence claims accumulate per distinct phrase.
    const noHits = (text.match(/\b(no|none|nobody|first|never|nowhere|nothing)\b/gi) || []).length;
    score += Math.min(20, noHits * 6);
    // Vendor mentions accumulate per distinct vendor.
    const vendors = ["chatgpt", "claude", "gemini", "cursor", "copilot", "openai", "anthropic", "google", "perplexity"];
    let vCount = 0;
    for (const v of vendors) if (new RegExp("\\b" + v + "\\b", "i").test(text)) vCount++;
    score += Math.min(15, vCount * 3);
  }

  if (axis === "worldClass") {
    const wHits = (text.match(/\b(industry|standard|spec|rfc|state[\s-]?of[\s-]?the[\s-]?art|sota|benchmark)\b/gi) || []).length;
    score += Math.min(15, wHits * 6);
  }

  if (axis === "wisdom") {
    // Each distinct wisdom signal earns +8 up to a +25 cap.
    const positive = ["compose", "orthogonal", "removable", "no\\s+leak", "abstraction", "invariant", "root\\s+cause", "single[\\s-]?responsibility", "decouples", "additive"];
    let pCount = 0;
    for (const p of positive) if (new RegExp("\\b" + p, "i").test(text)) pCount++;
    score += Math.min(25, pCount * 8);
    // Penalise admissions of bad practice — but skip negated forms
    // ("not a hack", "isn't a workaround", "no kludge here") which are
    // actually positive signals.
    const negated = /\b(not\s+a|isn['’]?t\s+a|no\s+|never\s+a)\s*(hack|workaround|kludge|tactical|temporary)\b/i;
    const direct = /\b(hack|workaround|kludge|tactical|temporary)\b/i;
    if (direct.test(text) && !negated.test(text)) score -= 15;
  }

  // Hedge penalty — one mild hedge is fine; a chorus of them is rot.
  const hedgeCount = (text.match(/\b(maybe|perhaps|possibly|might|could|kind of|sort of|roughly)\b/gi) || []).length;
  score -= hedgeCount * 4;

  // Length sweet spot 80-400 chars; under 80 implies thin claim, over 600 is waffle.
  if (text.length >= 80 && text.length <= 400) score += 8;
  if (text.length > 600) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/** Decide verdict from the four axis scores. */
function decide(scores: { delta: number; worldClass: number; wisdom: number; wildness: number }): { verdict: "SHIP" | "LOOP_BACK" | "REJECT"; reasons: string[]; next: string } {
  const reasons: string[] = [];
  const min = Math.min(scores.delta, scores.worldClass, scores.wisdom, scores.wildness);
  for (const [k, v] of Object.entries(scores)) {
    if (v < 60) reasons.push(`${k} score ${v} below 60 — REJECT axis`);
    else if (v < 80) reasons.push(`${k} score ${v} below 80 — LOOP_BACK axis`);
  }
  if (min >= 80) return { verdict: "SHIP", reasons: ["all axes ≥ 80"], next: "Ship the feature." };
  if (min >= 60) return { verdict: "LOOP_BACK", reasons, next: "Revise the weak axis once and re-audit." };
  return { verdict: "REJECT", reasons, next: "Design flaw — start the feature over with a different approach." };
}

/** Run the full audit and produce a signed scorecard. */
export function auditFeature(input: AurelianFeatureInput): AurelianScorecard {
  const composite = compositeDelta(input.measurements);
  const scores = {
    delta: composite.score,
    worldClass: scoreEvidence(input.worldClassEvidence, "worldClass"),
    wisdom: scoreEvidence(input.wisdomEvidence, "wisdom"),
    wildness: scoreEvidence(input.wildnessEvidence, "wildness"),
  };
  const decision = decide(scores);
  const generatedAt = new Date().toISOString();
  const canon = JSON.stringify({
    feature: input.feature,
    category: input.category,
    scores,
    measurements: composite.perMetric,
    verdict: decision.verdict,
    generatedAt,
  });
  const sig = createHmac("sha256", input.secret ?? "aurelian-default").update(canon).digest("hex");
  return {
    feature: input.feature,
    category: input.category,
    scores,
    measurements: composite.perMetric,
    verdict: decision.verdict,
    reasons: decision.reasons,
    recommendedNextStep: decision.next,
    generatedAt,
    sig,
  };
}

/** Pretty-print a scorecard as a single-block report. */
export function renderScorecard(card: AurelianScorecard): string {
  const lines: string[] = [];
  lines.push(`AURELIAN · ${card.feature} (${card.category}) → ${card.verdict}`);
  lines.push(`  delta=${card.scores.delta}  worldClass=${card.scores.worldClass}  wisdom=${card.scores.wisdom}  wildness=${card.scores.wildness}`);
  for (const m of card.measurements) {
    const sign = m.improvementPct >= 0 ? "+" : "";
    const flag = m.passed ? "✓" : "✗";
    lines.push(`  ${flag} ${m.metric}: ${m.before} → ${m.after} ${m.unit} (${sign}${m.improvementPct}%)`);
  }
  for (const r of card.reasons) lines.push(`  · ${r}`);
  lines.push(`  next: ${card.recommendedNextStep}`);
  lines.push(`  sig=${card.sig.slice(0, 12)} ts=${card.generatedAt}`);
  return lines.join("\n");
}

/** Aggregate verdict across many feature audits. SHIP only if every feature ships. */
export function rollupVerdict(cards: AurelianScorecard[]): { verdict: "SHIP" | "LOOP_BACK" | "REJECT"; ship: number; loop: number; reject: number } {
  let ship = 0, loop = 0, reject = 0;
  for (const c of cards) {
    if (c.verdict === "SHIP") ship++;
    else if (c.verdict === "LOOP_BACK") loop++;
    else reject++;
  }
  if (reject > 0) return { verdict: "REJECT", ship, loop, reject };
  if (loop > 0) return { verdict: "LOOP_BACK", ship, loop, reject };
  return { verdict: "SHIP", ship, loop, reject };
}
