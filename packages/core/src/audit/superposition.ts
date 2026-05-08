/**
 * QSAC Tech 1 — Verdict Superposition.
 *
 * The current `mneme audit --certify` collapses every axis to a single
 * verdict (pass | warn | fail | skipped). That throws away information.
 * "Pass at 60% confidence" and "Pass at 99% confidence" both render as
 * just "PASS" — compliance teams can't drill into uncertainty.
 *
 * Tech 1 keeps the collapsed verdict (for backwards compatibility) but
 * also emits a **probability distribution over all four verdicts** —
 * a "superposition" in quantum-inspired language. Calibrated soft-scoring
 * functions per axis turn raw evidence into amplitudes that sum to 1.0.
 *
 *   ψ = α·|pass⟩ + β·|warn⟩ + γ·|fail⟩ + δ·|skipped⟩
 *       where α² + β² + γ² + δ² = 1
 *
 * (We use raw probabilities, not amplitudes-squared — the "quantum" framing
 * is a metaphor for "preserve the superposition; don't collapse early".)
 *
 * Why no production audit tool does this:
 *   - SAST / Code Scanning tools were built when regulators wanted YES/NO
 *   - EU AI Act 2026 + SEC AI disclosure want UNCERTAINTY QUANTIFICATION
 *   - Mneme is the first to ship calibrated distributions in the cert
 *
 * The distribution unlocks:
 *   - Confidence-bounded verdicts: "PASS (97% confidence)"
 *   - Risk-adjusted gating: --min-confidence 0.95 fails low-confidence pass
 *   - Entropy as audit-quality signal: high entropy = need more evidence
 *   - Proper drill-through in the wisdom output
 */

import type { AxisVerdict } from "./certify.js";

export interface VerdictDistribution {
  /** Probability mass on |pass⟩. */
  pass: number;
  /** Probability mass on |warn⟩. */
  warn: number;
  /** Probability mass on |fail⟩. */
  fail: number;
  /** Probability mass on |skipped⟩ (insufficient data). */
  skipped: number;
  /** Argmax — the verdict the system would pick if forced to collapse. */
  collapsed: AxisVerdict;
  /** Highest probability — the confidence of the collapsed verdict. */
  confidence: number;
  /** Shannon entropy in nats. Low = confident; high = uncertain. */
  entropy: number;
}

/* ──────────────────────  Distribution constructors  ────────────────── */

/**
 * Normalise raw scores [pass, warn, fail, skipped] into a valid
 * probability distribution. Adds a small epsilon to avoid log(0) when
 * computing entropy.
 */
export function distribution(
  raw: { pass: number; warn: number; fail: number; skipped: number },
): VerdictDistribution {
  const eps = 1e-9;
  const r = {
    pass: Math.max(0, raw.pass) + eps,
    warn: Math.max(0, raw.warn) + eps,
    fail: Math.max(0, raw.fail) + eps,
    skipped: Math.max(0, raw.skipped) + eps,
  };
  const sum = r.pass + r.warn + r.fail + r.skipped;
  const p = {
    pass: r.pass / sum,
    warn: r.warn / sum,
    fail: r.fail / sum,
    skipped: r.skipped / sum,
  };
  // argmax
  let collapsed: AxisVerdict = "pass";
  let confidence = p.pass;
  for (const [v, m] of Object.entries(p) as Array<[AxisVerdict, number]>) {
    if (m > confidence) {
      collapsed = v;
      confidence = m;
    }
  }
  // Shannon entropy in nats. Maximum entropy on uniform = ln(4) ≈ 1.386.
  const entropy =
    -p.pass * Math.log(p.pass) -
    p.warn * Math.log(p.warn) -
    p.fail * Math.log(p.fail) -
    p.skipped * Math.log(p.skipped);
  return { ...p, collapsed, confidence: round4(confidence), entropy: round4(entropy) };
}

/* ──────────────────────  Soft-scoring per axis  ─────────────────────── */

/**
 * Soft-score behavioral parity from raw counts.
 *
 * Calibration intuition:
 *   - 0 mismatches in N samples (N≥1) → ~95% pass mass
 *   - Some mismatches but no critical → spread between pass/warn
 *   - Any critical mismatch → mass on fail
 *   - 0 samples → mass on skipped
 *
 * Uses logistic-style scoring so a single critical mismatch doesn't
 * jump from 99% pass to 99% fail; the verdict moves smoothly.
 */
export function scoreBehavioralParity(input: {
  samples: number;
  mismatches: number;
  critical: number;
}): VerdictDistribution {
  const { samples, mismatches, critical } = input;
  if (samples === 0) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  if (critical > 0) {
    // Heavy fail mass; tiny pass mass for "maybe a flaky sample"
    return distribution({
      pass: 0.02,
      warn: 0.13,
      fail: 0.85,
      skipped: 0,
    });
  }
  if (mismatches === 0) {
    return distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
  }
  const ratio = mismatches / samples;
  // Sigmoid-like: 0% → 0.95 pass, 100% → 0.05 pass
  const passMass = sigmoid((1 - ratio) * 6 - 3);
  const warnMass = (1 - passMass) * 0.7;
  const failMass = (1 - passMass) * 0.3;
  return distribution({ pass: passMass, warn: warnMass, fail: failMass, skipped: 0 });
}

/**
 * Soft-score API contract drift from removed/added/changed counts.
 * Removals are the strongest fail signal; additions are usually fine.
 */
export function scoreApiContractDrift(input: {
  removed: number;
  added: number;
  changedSignatures: number;
  totalExports: number;
}): VerdictDistribution {
  const { removed, added, changedSignatures, totalExports } = input;
  if (totalExports === 0) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  if (removed === 0 && changedSignatures === 0) {
    // Pure additions = clean expansion. Strong pass.
    if (added === 0) return distribution({ pass: 0.97, warn: 0.02, fail: 0.005, skipped: 0.005 });
    return distribution({ pass: 0.92, warn: 0.06, fail: 0.015, skipped: 0.005 });
  }
  // Removals or signature changes
  const breakRatio = (removed + changedSignatures) / totalExports;
  if (breakRatio >= 0.05) {
    // ≥5% of exports broke — strong fail
    return distribution({ pass: 0.05, warn: 0.15, fail: 0.78, skipped: 0.02 });
  }
  if (breakRatio >= 0.01) {
    return distribution({ pass: 0.25, warn: 0.55, fail: 0.18, skipped: 0.02 });
  }
  return distribution({ pass: 0.6, warn: 0.32, fail: 0.06, skipped: 0.02 });
}

/**
 * Soft-score test pass-rate delta.
 *  - new_failures > 0   → strong fail
 *  - tests reduced      → warn (could be honest cleanup or hiding failures)
 *  - tests grew, all pass → strong pass
 */
export function scoreTestPassRate(input: {
  beforePassed: number;
  beforeFailed: number;
  afterPassed: number;
  afterFailed: number;
  testCommandAvailable: boolean;
}): VerdictDistribution {
  const { beforePassed, beforeFailed, afterPassed, afterFailed, testCommandAvailable } = input;
  if (!testCommandAvailable) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  const newlyFailing = Math.max(0, afterFailed - beforeFailed);
  if (newlyFailing > 0) {
    // Even one regression is a strong fail signal
    const intensity = Math.min(1, newlyFailing / Math.max(1, beforePassed) * 10);
    return distribution({
      pass: 0.05,
      warn: 0.2 - intensity * 0.1,
      fail: 0.7 + intensity * 0.1,
      skipped: 0.05 - intensity * 0.04,
    });
  }
  const beforeTotal = beforePassed + beforeFailed;
  const afterTotal = afterPassed + afterFailed;
  if (beforeTotal === 0 && afterTotal === 0) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  if (afterTotal < beforeTotal * 0.95) {
    // tests shrank — could be hiding failures; lean warn
    return distribution({ pass: 0.35, warn: 0.55, fail: 0.05, skipped: 0.05 });
  }
  return distribution({ pass: 0.92, warn: 0.06, fail: 0.01, skipped: 0.01 });
}

/**
 * Soft-score perf regression. The threshold is 25% (fail) / 10% (warn)
 * but the soft scorer uses a smooth sigmoid so 24.9% doesn't jump to PASS.
 */
export function scorePerfRegression(input: {
  deltaPercent: number;
  beforeMs: number;
  afterMs: number;
  haveBaseline: boolean;
}): VerdictDistribution {
  const { deltaPercent, haveBaseline } = input;
  if (!haveBaseline) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  // Sigmoid centred at 17.5% (midpoint of warn/fail), slope 0.2
  const slowdown = Math.max(0, deltaPercent);
  const failProb = sigmoid((slowdown - 17.5) * 0.4);
  const warnProb = sigmoid((slowdown - 5) * 0.4) - failProb;
  const passProb = Math.max(0, 1 - failProb - warnProb);
  return distribution({
    pass: passProb,
    warn: Math.max(0, warnProb),
    fail: failProb,
    skipped: 0.001,
  });
}

/**
 * Soft-score AI narrative trust. Contradictions are deterministic; we
 * weight them heavily but allow the rest of the trust signal to leak through.
 */
export function scoreAiNarrative(input: {
  totalChecks: number;
  contradictions: number;
  unverifiable: number;
  confirmed: number;
}): VerdictDistribution {
  const { totalChecks, contradictions, confirmed } = input;
  if (totalChecks === 0) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  if (contradictions > 0) {
    // Even one outright contradiction → fail-leaning
    const cRatio = contradictions / totalChecks;
    return distribution({
      pass: 0.02,
      warn: 0.18 + (1 - cRatio) * 0.1,
      fail: 0.78 + cRatio * 0.1,
      skipped: 0.02,
    });
  }
  // No contradictions; weight by confirmation ratio
  const cRatio = confirmed / totalChecks;
  return distribution({
    pass: 0.65 + cRatio * 0.3,
    warn: 0.3 - cRatio * 0.25,
    fail: 0.04,
    skipped: 0.01,
  });
}

/* ──────────────────────  Combiners  ─────────────────────────────────── */

/**
 * Combine N axis distributions into an overall certificate distribution.
 *
 * Method: weighted product-of-experts (PoE). Each axis votes independently;
 * the geometric mean of each verdict's mass → renormalise.
 * Result is "all axes must agree to confidently pass" — one fail-heavy
 * axis pulls the overall down even if others are clean.
 */
export function combineDistributions(
  dists: VerdictDistribution[],
  weights?: number[],
): VerdictDistribution {
  if (dists.length === 0) {
    return distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
  }
  const w = weights ?? dists.map(() => 1);
  const totalW = w.reduce((s, x) => s + x, 0);
  // Geometric mean: exp(sum(w * log(p)) / totalW)
  const log = (k: keyof VerdictDistribution) => {
    let acc = 0;
    for (let i = 0; i < dists.length; i++) {
      const p = (dists[i]![k] as number) || 1e-9;
      acc += (w[i] ?? 1) * Math.log(p);
    }
    return Math.exp(acc / totalW);
  };
  return distribution({
    pass: log("pass"),
    warn: log("warn"),
    fail: log("fail"),
    skipped: log("skipped"),
  });
}

/* ──────────────────────  Helpers  ───────────────────────────────────── */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/* ──────────────────────  Public utility  ────────────────────────────── */

/** Format a distribution as the wisdom drill-through line. */
export function formatDistribution(d: VerdictDistribution): string {
  const parts: string[] = [];
  for (const v of ["pass", "warn", "fail", "skipped"] as const) {
    const m = d[v] as number;
    if (m >= 0.005) parts.push(`${m.toFixed(2)}·|${v}⟩`);
  }
  return parts.join(" + ");
}

/** Maximum possible entropy (uniform over 4 states) — used for normalisation. */
export const MAX_ENTROPY = Math.log(4);

/** Confidence pill: "high" / "medium" / "low" derived from confidence + entropy. */
export function confidencePill(d: VerdictDistribution): "high" | "medium" | "low" {
  if (d.confidence >= 0.85 && d.entropy / MAX_ENTROPY < 0.45) return "high";
  if (d.confidence >= 0.6) return "medium";
  return "low";
}
