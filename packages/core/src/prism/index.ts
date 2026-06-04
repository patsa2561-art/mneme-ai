/**
 * PRISM — SUPERPOSITION REASONING with INTERFERENCE COLLAPSE.
 *
 * A prism splits one beam into a spectrum, then the spectrum recombines. PRISM
 * does that to a question: fan it out into N candidate reasoning branches (over
 * the Matrix rail — parallel by construction), keep them all "in superposition"
 * weighted by amplitude, let them INTERFERE, then COLLAPSE to a measured answer.
 *
 * The genuinely distinct math (vs plain voting / jury / trinity / arena):
 *   • amplitude a_i = sqrt(confidence_i)  (so prob = confidence, the Born rule)
 *   • branches that AGREE add COHERENTLY (constructive): A_x = Σ_support sqrt(c_i)
 *     — and (Σ sqrt(c))² > Σ c, so MANY weak-but-agreeing branches can outweigh
 *     a FEW strong-but-isolated ones (which confidence-argmax gets wrong).
 *   • a branch can REFUTE an answer (phase π) → it SUBTRACTS: A_x = Σ_support − Σ_refute.
 *     A strongly-refuted answer destructively cancels (this is the real
 *     destructive interference, and it's useful: "NOT 42" cancels "42").
 *   • COLLAPSE via the Born rule: P(x) = A_x² / Σ A². Pick the max — but only if
 *     it clears the collapse threshold AND beats #2 by a margin; otherwise return
 *     SUPERPOSED (genuine uncertainty → abstain, prove-or-unknown — never a
 *     confident wrong pick).
 *
 * Pure + total + deterministic: no Date, no randomness, no I/O. The Matrix
 * fan-out (generating the branches) lives at the CLI/MCP edge; this is the brain.
 *
 * HONEST (DIAKRISIS): this is a deterministic scoring operator INSPIRED by
 * quantum amplitudes — NOT a quantum computer and NOT a claim of universal
 * superiority. The measured A/B (in the gauntlet) shows it beats
 * confidence-argmax (and matches/beats plurality) ON THE REGIME IT TARGETS
 * (many-weak-coherent vs few-strong-isolated, plus refutation) — a constructed,
 * labeled suite that models that regime, not a proof it always wins. Answer
 * grouping is LEXICAL (canonical-equal answers), not semantic paraphrase.
 */

export interface Branch { id: string; answer: string; confidence: number; stance?: "support" | "refute" }
export interface RankedOutcome { answer: string; prob: number; amplitude: number; support: number; refute: number }
export interface CollapseResult {
  answer: string | null;       // null only if there are no branches
  confidence: number;          // Born probability of the chosen outcome (0..1)
  coherence: number;           // 1 - normalized entropy of the distribution (consensus concentration)
  collapsed: boolean;          // a clear measurement happened
  superposed: boolean;         // no clear collapse → abstain (prove-or-unknown)
  ranked: RankedOutcome[];     // all outcomes by probability (desc)
  reason: string;
}

export interface CollapseOpts {
  collapseThreshold?: number;  // min top probability to collapse (default 0.5)
  margin?: number;             // min (top - second) probability gap (default 0.15)
}

/** Lexical canonicalisation for grouping coherent answers (honest: not semantic). */
export function canonAnswer(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`.!?]+$/g, "");
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The operator: superpose the branches, interfere, collapse via the Born rule. */
export function collapse(branches: Branch[], opts: CollapseOpts = {}): CollapseResult {
  const collapseThreshold = opts.collapseThreshold ?? 0.5;
  const margin = opts.margin ?? 0.15;
  const clean = (branches ?? []).filter((b) => b && typeof b.answer === "string" && b.answer.trim() !== "");
  if (clean.length === 0) {
    return { answer: null, confidence: 0, coherence: 0, collapsed: false, superposed: false, ranked: [], reason: "no branches" };
  }

  // accumulate signed amplitudes per canonical outcome (+support / -refute, coherent)
  const acc = new Map<string, { display: string; support: number; refute: number }>();
  for (const b of clean) {
    const key = canonAnswer(b.answer);
    const amp = Math.sqrt(clamp01(b.confidence));
    const cur = acc.get(key) ?? { display: b.answer.trim(), support: 0, refute: 0 };
    if (b.stance === "refute") cur.refute += amp; else cur.support += amp;
    acc.set(key, cur);
  }

  // net amplitude (destructive interference: refuters subtract), probability via Born rule
  const outcomes = [...acc.values()].map((o) => {
    const net = o.support - o.refute;       // destructive interference (refuters subtract)
    // an answer refuted below zero is SUPPRESSED — net standing, not |amplitude|²
    // (squaring a negative would wrongly reward a heavily-refuted answer).
    const eff = Math.max(0, net);
    return { answer: o.display, support: o.support, refute: o.refute, amplitude: net, power: eff * eff };
  });
  const totalPower = outcomes.reduce((s, o) => s + o.power, 0);
  const ranked: RankedOutcome[] = outcomes
    .map((o) => ({ answer: o.answer, amplitude: o.amplitude, support: o.support, refute: o.refute, prob: totalPower > 0 ? o.power / totalPower : 0 }))
    .sort((a, b) => b.prob - a.prob);

  // coherence = 1 - normalized Shannon entropy of the probability distribution
  let entropy = 0;
  for (const o of ranked) if (o.prob > 0) entropy -= o.prob * Math.log2(o.prob);
  const maxEntropy = ranked.length > 1 ? Math.log2(ranked.length) : 1;
  const coherence = maxEntropy > 0 ? clamp01(1 - entropy / maxEntropy) : 1;

  const top = ranked[0];
  const second = ranked[1]?.prob ?? 0;
  const collapsed = top.prob >= collapseThreshold && top.prob - second >= margin && top.amplitude > 0;
  return {
    answer: top.answer,
    confidence: top.prob,
    coherence,
    collapsed,
    superposed: !collapsed,
    ranked,
    reason: collapsed
      ? `collapsed to "${top.answer}" (P=${top.prob.toFixed(3)}, coherence=${coherence.toFixed(2)})`
      : `SUPERPOSED — no clear measurement (top P=${top.prob.toFixed(3)}, Δ#2=${(top.prob - second).toFixed(3)} < margin ${margin}); abstaining`,
  };
}

// ─── baselines (for the measured A/B) ────────────────────────────────────────
/** Naive baseline #1: pick the single highest-confidence branch's answer. */
export function argmaxConfidence(branches: Branch[]): string | null {
  const support = (branches ?? []).filter((b) => b && b.stance !== "refute" && b.answer?.trim());
  if (!support.length) return null;
  return support.reduce((best, b) => (b.confidence > best.confidence ? b : best)).answer.trim();
}
/** Naive baseline #2: unweighted plurality vote over support branches. */
export function pluralityVote(branches: Branch[]): string | null {
  const counts = new Map<string, { display: string; n: number }>();
  for (const b of branches ?? []) {
    if (!b || b.stance === "refute" || !b.answer?.trim()) continue;
    const k = canonAnswer(b.answer);
    const c = counts.get(k) ?? { display: b.answer.trim(), n: 0 };
    c.n += 1; counts.set(k, c);
  }
  if (!counts.size) return null;
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].display;
}

// ─── gauntlet (with the measured A/B) ────────────────────────────────────────
export interface GauntletCheck { name: string; pass: boolean; detail: string }
export interface PrismGauntletResult {
  score: number;
  checks: GauntletCheck[];
  ab: { cases: number; prismAcc: number; argmaxAcc: number; pluralityAcc: number };
}

interface LabeledCase { branches: Branch[]; correct: string }

/** A labeled suite modelling the target regime: many-weak-coherent-correct vs
 *  few-strong-isolated-wrong, plus refutation cases. Deterministic (no random). */
function abSuite(): LabeledCase[] {
  const cases: LabeledCase[] = [];
  // regime 1: N weak-but-agreeing CORRECT vs 1 strong-isolated WRONG
  for (let n = 3; n <= 6; n++) {
    const branches: Branch[] = [];
    for (let i = 0; i < n; i++) branches.push({ id: `c${i}`, answer: "42", confidence: 0.34 });
    branches.push({ id: "w", answer: "99", confidence: 0.9 }); // a confident outlier
    cases.push({ branches, correct: "42" });
  }
  // regime 2: refutation — a strong wrong answer that several branches explicitly refute
  cases.push({ correct: "blue", branches: [
    { id: "a", answer: "red", confidence: 0.8 },
    { id: "b", answer: "red", confidence: 0.2, stance: "refute" },
    { id: "c", answer: "red", confidence: 0.7, stance: "refute" },
    { id: "d", answer: "blue", confidence: 0.5 },
    { id: "e", answer: "blue", confidence: 0.45 },
  ] });
  // regime 3: clear consensus (everyone agrees) → must collapse to it
  cases.push({ correct: "yes", branches: [
    { id: "a", answer: "yes", confidence: 0.7 }, { id: "b", answer: "yes", confidence: 0.6 }, { id: "c", answer: "yes", confidence: 0.65 },
  ] });
  // regime 4: FEW high-confidence CORRECT vs MANY low-confidence WRONG — plurality
  // (count only) is fooled; prism (confidence-weighted, coherent) is not.
  cases.push({ correct: "safe", branches: [
    { id: "a", answer: "safe", confidence: 0.9 }, { id: "b", answer: "safe", confidence: 0.88 },
    { id: "c", answer: "danger", confidence: 0.1 }, { id: "d", answer: "danger", confidence: 0.12 }, { id: "e", answer: "danger", confidence: 0.08 },
  ] });
  return cases;
}

export function prismGauntlet(): PrismGauntletResult {
  const checks: GauntletCheck[] = [];
  const suite = abSuite();

  // measured A/B accuracy
  let prismHit = 0, argHit = 0, plurHit = 0;
  for (const c of suite) {
    const r = collapse(c.branches);
    if (r.collapsed && r.answer === c.correct) prismHit++;
    if (argmaxConfidence(c.branches) === c.correct) argHit++;
    if (pluralityVote(c.branches) === c.correct) plurHit++;
  }
  const n = suite.length;
  const prismAcc = prismHit / n, argmaxAcc = argHit / n, pluralityAcc = plurHit / n;

  checks.push({ name: "BEATS ARGMAX", pass: prismAcc > argmaxAcc, detail: `prism ${(prismAcc * 100).toFixed(0)}% > confidence-argmax ${(argmaxAcc * 100).toFixed(0)}% on the target regime` });
  checks.push({ name: "≥ PLURALITY", pass: prismAcc >= pluralityAcc, detail: `prism ${(prismAcc * 100).toFixed(0)}% ≥ plurality ${(pluralityAcc * 100).toFixed(0)}%` });

  // constructive interference: many weak agreeing beat one strong isolated
  const ci = collapse([
    { id: "1", answer: "X", confidence: 0.34 }, { id: "2", answer: "X", confidence: 0.34 }, { id: "3", answer: "X", confidence: 0.34 },
    { id: "4", answer: "Y", confidence: 0.9 },
  ]);
  checks.push({ name: "CONSTRUCTIVE", pass: ci.answer === "X" && ci.collapsed, detail: "(Σ√c)² superadditivity: 3×0.34 'X' outweigh 1×0.9 'Y'" });

  // destructive interference: refutation cancels a strong answer
  const di = collapse([
    { id: "1", answer: "A", confidence: 0.9 },
    { id: "2", answer: "A", confidence: 0.85, stance: "refute" },
    { id: "3", answer: "A", confidence: 0.6, stance: "refute" },
    { id: "4", answer: "B", confidence: 0.5 },
  ]);
  checks.push({ name: "DESTRUCTIVE", pass: di.answer === "B", detail: "refuters subtract amplitude — a heavily-refuted answer is suppressed" });

  // Born rule: probabilities sum to ~1
  const born = collapse([{ id: "1", answer: "P", confidence: 0.5 }, { id: "2", answer: "Q", confidence: 0.5 }, { id: "3", answer: "R", confidence: 0.3 }]);
  const sum = born.ranked.reduce((s, o) => s + o.prob, 0);
  checks.push({ name: "BORN-RULE", pass: Math.abs(sum - 1) < 1e-9, detail: `outcome probabilities sum to 1 (got ${sum.toFixed(6)})` });

  // SUPERPOSED abstention: a genuine 50/50 split must NOT collapse to a confident pick
  const split = collapse([{ id: "1", answer: "left", confidence: 0.7 }, { id: "2", answer: "right", confidence: 0.7 }]);
  checks.push({ name: "ABSTAIN", pass: split.superposed && !split.collapsed, detail: "genuine 50/50 → SUPERPOSED (abstains, never a confident wrong pick)" });

  // consensus collapses
  const cons = collapse([{ id: "1", answer: "go", confidence: 0.7 }, { id: "2", answer: "go", confidence: 0.6 }, { id: "3", answer: "go", confidence: 0.65 }]);
  checks.push({ name: "CONSENSUS", pass: cons.collapsed && cons.answer === "go" && cons.coherence > 0.9, detail: "unanimous branches collapse with high coherence" });

  // determinism + totality
  const d1 = JSON.stringify(collapse(suite[0].branches));
  const d2 = JSON.stringify(collapse(suite[0].branches));
  checks.push({ name: "DETERMINISTIC", pass: d1 === d2, detail: "same branches → identical collapse" });
  let total = true;
  try { collapse([]); collapse([{ id: "x", answer: "", confidence: 2 }]); collapse([{ id: "y", answer: "ok", confidence: -1 }]); } catch { total = false; }
  checks.push({ name: "TOTAL", pass: total, detail: "empty / blank / out-of-range inputs never throw" });

  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), checks, ab: { cases: n, prismAcc, argmaxAcc, pluralityAcc } };
}
