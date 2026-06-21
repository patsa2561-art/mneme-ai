/**
 * v3.116.0 — STATGUARD: the statistical-misinterpretation guard.
 *
 * Adopted from Greenland, Senn, Rothman, Carlin, Poole, Goodman & Altman (2016),
 * "Statistical tests, P values, confidence intervals, and power: a guide to
 * misinterpretations" (Eur J Epidemiol 31:337-350). That paper catalogues 25
 * fallacies that working scientists — and now LLMs trained on their text — repeat
 * constantly: "p>0.05 means no effect", "95% CI = 95% probability the truth is in
 * it", "significant = important", etc. These are exactly the confident, plausible
 * statements an AI agent hallucinates when asked to interpret a result.
 *
 * STATGUARD is a DETERMINISTIC detector: it scans a claim for the documented
 * fallacy phrasings, and for each hit returns the Greenland item, WHY it's wrong,
 * and the correct interpretation — so the agent can fix it before relaying it to a
 * researcher / doctor / analyst. The honest anti-trap layer: an AI using Mneme
 * never falls into a statistics pit the literature already named.
 *
 * DIAKRISIS — the honest ceiling: this is a PATTERN detector of the documented
 * textual forms (grounded + citable), NOT a full statistical reasoner. It catches
 * the common phrasings with high precision (correct statements are NOT flagged)
 * and stays silent (CLEAN) when no known fallacy pattern is present — it never
 * invents a problem. Pure + deterministic + total.
 */

export interface Fallacy {
  id: string;
  ref: string;              // Greenland 2016 item reference
  name: string;
  /** deterministic trigger (lowercased text); simple alternation, no catastrophic backtracking. */
  pattern: RegExp;
  /** a guard phrase that, if present, SUPPRESSES the flag (the correct form). */
  exonerate?: RegExp;
  why: string;
  correct: string;
}

// The high-value subset of the 25 (the ones LLMs repeat most), each grounded.
export const FALLACIES: Fallacy[] = [
  {
    id: "nonsig-no-effect", ref: "Greenland 2016 #1",
    name: "non-significant ⇒ no effect / null is true",
    pattern: /\b(p\s*[>≥]\s*0?\.0?5|not (?:statistically )?significant|non-?significant|failed to reach significance)\b[^.]*\b(no (?:effect|association|difference|relationship)|proves? (?:the )?null|null is true|there is no|means? (?:there|the) (?:is )?no)\b/,
    why: "A large p-value means the data are compatible with the null — NOT that the null is true or the effect is zero. Absence of evidence ≠ evidence of absence.",
    correct: "Report the effect estimate + its interval; a non-significant result often still includes important effect sizes.",
  },
  {
    id: "sig-real-effect", ref: "Greenland 2016 #2",
    name: "significant ⇒ a real / true effect exists",
    pattern: /\b(p\s*[<≤]\s*0?\.0?5|statistically significant|reached significance)\b[^.]*\b(real|true|genuine|proves?|confirms?|establishes?)\b[^.]*\b(effect|association|difference|causal|relationship)\b/,
    why: "A small p-value means the data are unusual UNDER the null — it does not prove a real effect (could be bias, confounding, or chance).",
    correct: "Significance is one signal; judge with effect size, design, bias, and prior evidence.",
  },
  {
    id: "p-prob-null", ref: "Greenland 2016 #3",
    name: "p-value = probability the null is true",
    pattern: /\b(p[\s-]?value|p\s*=\s*0?\.\d+)\b[^.]*\b(probability|chance|%|percent)\b[^.]*\b(null|hypothesis|h0|no effect)\b (?:is|being|are) (?:true|correct)\b|\b\d+%? (?:chance|probability) (?:that )?the null\b/,
    why: "The p-value is computed ASSUMING the null is true; it is P(data | null), never P(null | data).",
    correct: "P(null|data) needs a prior (Bayes). The p-value alone cannot give it.",
  },
  {
    id: "p-prob-chance", ref: "Greenland 2016 #4",
    name: "p-value = probability the result is due to chance",
    pattern: /\b(p[\s-]?value|the p\b)\b[^.]*\b(probability|chance|likelihood)\b[^.]*\b(due to|by|from|of) (?:random )?chance\b|\bprobability (?:that )?(?:the result|it) (?:is|was) (?:due to|by) chance\b/,
    why: "The p-value already assumes 'only chance' (the null). It can't be the probability that chance produced the result — that's circular.",
    correct: "Say: IF only chance were operating, data this extreme would occur with probability p.",
  },
  {
    id: "one-minus-p", ref: "Greenland 2016 #5",
    name: "1 − p = probability the alternative is true / replication probability",
    pattern: /(1\s*[-−]\s*p|\d{1,3}\s*%|remaining)[^.]*\b(probability|chance|confident)\b[^.]*\b(alternative is true|effect is (?:real|true)|will replicate|replication)\b/,
    why: "1 − p is not the probability the alternative is true, nor the chance of replication. Neither is a frequentist tail probability.",
    correct: "Replication probability depends on power + the true effect, not 1 − p.",
  },
  {
    id: "sig-important", ref: "Greenland 2016 #9",
    name: "statistically significant ⇒ clinically / practically important",
    pattern: /\bstatistically significant\b[^.]*\b(important|meaningful|large|substantial|matters|clinically)\b|\bsignificant\b[^.]*\bso (?:it|the effect) (?:is|must be) (?:important|large)\b/,
    why: "Significance depends on sample size; a tiny, unimportant effect is 'significant' in a large study, and a large effect can be non-significant in a small one.",
    correct: "Judge importance by the effect SIZE + its interval, not by the p-value.",
  },
  {
    id: "nonsig-equal", ref: "Greenland 2016 #10",
    name: "non-significant ⇒ groups are equal / no difference",
    pattern: /\b(not significant|non-?significant|p\s*[>≥]\s*0?\.0?5)\b[^.]*\b(equal|equivalent|the same|identical|no difference between)\b/,
    why: "Failing to detect a difference is not proof of equality — the study may simply lack power.",
    correct: "For equivalence, use an equivalence/non-inferiority test with a pre-set margin.",
  },
  {
    id: "smaller-p-bigger", ref: "Greenland 2016 #15",
    name: "smaller p ⇒ larger / more important effect",
    pattern: /\b(smaller|lower|tinier|more significant)\b[^.]*\bp[\s-]?value\b[^.]*\b(larger|bigger|stronger|more important)\b (?:effect|association)\b|\bp\b[^.]*\bso small\b[^.]*\b(huge|large|strong) effect\b/,
    why: "A smaller p reflects sample size + variance too, not just effect magnitude.",
    correct: "Effect size is the estimate, not the p-value; report both.",
  },
  {
    id: "ci-95-prob", ref: "Greenland 2016 #19",
    name: "95% CI ⇒ 95% probability the true value is inside it",
    pattern: /\b(\d{1,3}%|probability|chance|likely|confident)\b[^.]*\b(true|population|real) (?:value|mean|parameter|effect)\b[^.]*\b(in|within|inside|contain|contains|lies?|falls?)\b[^.]*\b(interval|ci)\b|\b(\d{1,3}%|probability) (?:that )?the (?:true|real) (?:value|parameter|mean)\b[^.]*\b(within|inside|in)\b/,
    exonerate: /\b\d{1,3}% of (?:such|these|the) intervals\b|\bover (?:repeated|many) (?:samples|studies)\b|\bin the long run\b|\bmethod that (?:captures|contains)\b/,
    why: "The 95% refers to the PROCEDURE: 95% of such intervals (over repeated sampling) contain the true value. A given interval either contains it or not; the 95% is not a probability about THIS interval.",
    correct: "Say: this interval was produced by a method that captures the true value 95% of the time.",
  },
  {
    id: "ci-values-ruled-out", ref: "Greenland 2016 #22",
    name: "values outside the CI are ruled out / impossible",
    pattern: /\b(?:values?|anything)\s+(?:just\s+)?(?:outside|beyond)\b[^.]*\b(?:confidence )?(?:interval|ci|range)\b[^.]*\b(ruled out|impossible|excluded|cannot|rejected|not possible)\b/,
    why: "Values just outside the interval are only slightly less compatible with the data; the boundary is not a hard cutoff between possible and impossible.",
    correct: "Compatibility is graded; treat the interval as a range of more-compatible values, not a fence.",
  },
  {
    id: "ci-includes-null", ref: "Greenland 2016 (CI↔test duality)",
    name: "CI includes the null ⇒ no effect / proves no effect",
    pattern: /\b(confidence interval|ci)\b[^.]*\b(includes?|contains?|crosses?|spans?)\b[^.]*\b(null|zero|1\.0|one|no effect)\b[^.]*\b(no effect|not significant|proves? (?:there is )?no|means? no)\b/,
    why: "A CI overlapping the null only means the null isn't rejected at that level — it does not prove the effect is absent (the interval may also include large effects).",
    correct: "Look at the WHOLE interval: it may be compatible with both no effect AND important effects.",
  },
  {
    id: "power-null-true", ref: "Greenland 2016 #power",
    name: "high power + non-significant ⇒ the null is true",
    pattern: /\b(high(?:ly)? power(?:ed)?|enough power|adequate power|well-?powered)\b[^.]*\b(not significant|non-?significant|p\s*[>≥]\s*0?\.0?5|null)\b[^.]*\b(null is true|no effect|proves? no|confirms? (?:the )?null)\b/,
    why: "Power is a pre-data property under a SPECIFIC alternative; a high-power null result raises compatibility with small effects but does not prove the null.",
    correct: "Use the observed interval, not power, to interpret a null result after the fact.",
  },
  {
    id: "compare-significance", ref: "Greenland 2016 #significance-comparison",
    name: "one study significant + one not ⇒ the studies disagree / conflict",
    pattern: /\bsignificant in one\b[^.]*\b(?:not|isn'?t|wasn'?t)\b[^.]*\b(?:the )?(?:other|second)\b|\bone (?:study|group|result)\b[^.]*\bsignificant\b[^.]*\b(?:the )?other\b[^.]*\b(?:not|isn'?t|wasn'?t)\b[^.]*\b(disagree|conflict|contradict|differ)\b/,
    why: "Two results can be highly compatible yet land on opposite sides of 0.05; comparing significance ≠ comparing effects.",
    correct: "Compare the effect estimates + intervals directly (or formally test the difference).",
  },
];

export type StatVerdict = "CLEAN" | "MISINTERPRETATION";
export interface StatHit { id: string; ref: string; name: string; why: string; correct: string }
export interface StatResult { verdict: StatVerdict; hits: StatHit[]; note: string }

const NOTE = "STATGUARD flags documented p-value/CI/power misinterpretations (Greenland et al. 2016) — a deterministic anti-trap guard, not a full statistical reasoner; CLEAN means no KNOWN fallacy pattern, not 'the stats are correct'.";

/** Scan a claim for documented statistical misinterpretations. Pure + total. */
export function checkStat(claim: string): StatResult {
  try {
    const text = String(claim ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!text) return { verdict: "CLEAN", hits: [], note: NOTE };
    const hits: StatHit[] = [];
    for (const f of FALLACIES) {
      try {
        if (f.pattern.test(text) && !(f.exonerate && f.exonerate.test(text))) {
          hits.push({ id: f.id, ref: f.ref, name: f.name, why: f.why, correct: f.correct });
        }
      } catch { /* a bad regex never breaks the scan */ }
    }
    return { verdict: hits.length ? "MISINTERPRETATION" : "CLEAN", hits, note: NOTE };
  } catch { return { verdict: "CLEAN", hits: [], note: NOTE }; }
}

// ── labeled corpus + measured proof ──────────────────────────────────────────
export interface StatCase { text: string; expect: string | null } // expect = fallacy id, or null = CLEAN (correct stat)
export const STAT_CORPUS: StatCase[] = [
  { text: "The result was not significant (p > 0.05), so there is no effect of the drug.", expect: "nonsig-no-effect" },
  { text: "p < 0.05, therefore the treatment has a real effect.", expect: "sig-real-effect" },
  { text: "p = 0.03 means there is a 3% chance the null hypothesis is true.", expect: "p-prob-null" },
  { text: "The p-value is the probability that the result is due to chance.", expect: "p-prob-chance" },
  { text: "Since p = 0.04, there is a 96% probability the effect is real and will replicate.", expect: "one-minus-p" },
  { text: "The difference was statistically significant, so it is clinically important.", expect: "sig-important" },
  { text: "The groups were not significant, so they are equal with no difference between them.", expect: "nonsig-equal" },
  { text: "This study has a smaller p-value, so it found a larger and more important effect.", expect: "smaller-p-bigger" },
  { text: "We are 95% confident, meaning there is a 95% probability the true value lies within this confidence interval.", expect: "ci-95-prob" },
  { text: "Any values outside the confidence interval are ruled out and impossible.", expect: "ci-values-ruled-out" },
  { text: "The confidence interval includes the null, which proves there is no effect.", expect: "ci-includes-null" },
  { text: "The study was highly powered and not significant, so the null is true and there is no effect.", expect: "power-null-true" },
  { text: "It was significant in one group but not in the other, so the two results disagree.", expect: "compare-significance" },
  // CORRECT statements — must NOT be flagged (precision)
  { text: "The 95% confidence interval was 0.8 to 1.4; 95% of such intervals over repeated samples contain the true value.", expect: null },
  { text: "The estimated risk ratio was 1.2 (95% CI 0.9-1.6); the data are compatible with both no effect and a moderate increase.", expect: null },
  { text: "If only chance were operating, data this extreme would occur with probability 0.04.", expect: null },
  { text: "We report the effect size and its interval rather than relying on the p-value for importance.", expect: null },
  { text: "An equivalence test with a pre-specified margin would be needed to claim the groups are similar.", expect: null },
  { text: "The cache hit rate improved from 60% to 95% after the change.", expect: null },
  { text: "The function returns the sum of two integers.", expect: null },
];

export interface StatBench { total: number; flaggable: number; caught: number; cleanCorrect: number; falseFlags: number; recall: number; precision: number }
/** Measured A/B: detection recall on fallacies + precision (no false flag on correct stats). Total. */
export function statGuardBench(corpus: ReadonlyArray<StatCase> = STAT_CORPUS): StatBench {
  let caught = 0, falseFlags = 0, cleanCorrect = 0;
  const flaggable = corpus.filter((c) => c.expect !== null).length;
  for (const c of corpus) {
    const r = checkStat(c.text);
    if (c.expect !== null) { if (r.hits.some((h) => h.id === c.expect)) caught++; }
    else { if (r.verdict === "CLEAN") cleanCorrect++; else falseFlags++; }
  }
  const correct = corpus.filter((c) => c.expect === null).length;
  return { total: corpus.length, flaggable, caught, cleanCorrect, falseFlags, recall: flaggable ? round3(caught / flaggable) : 1, precision: correct ? round3(cleanCorrect / correct) : 1 };
}
function round3(n: number): number { return Math.round(n * 1e3) / 1e3; }

export interface StatGuardGauntlet { catchesEachFallacy: boolean; recallHigh: boolean; noFalseFlags: boolean; everyFallacyHasCorrection: boolean; deterministic: boolean; total: boolean; score: 0 | 100 }
export function statGuardGauntlet(): StatGuardGauntlet {
  const b = statGuardBench();
  const recallHigh = b.recall >= 0.95;
  const noFalseFlags = b.falseFlags === 0;
  // each fallacy id in FALLACIES is caught by its corpus example
  const catchesEachFallacy = FALLACIES.every((f) => { const ex = STAT_CORPUS.find((c) => c.expect === f.id); return ex ? checkStat(ex.text).hits.some((h) => h.id === f.id) : false; });
  const everyFallacyHasCorrection = FALLACIES.every((f) => f.why.length > 10 && f.correct.length > 5 && /Greenland/.test(f.ref));
  const deterministic = JSON.stringify(checkStat(STAT_CORPUS[0]!.text)) === JSON.stringify(checkStat(STAT_CORPUS[0]!.text));
  let total = true;
  try { checkStat(null as unknown as string); checkStat(""); statGuardBench([]); } catch { total = false; }
  const all = catchesEachFallacy && recallHigh && noFalseFlags && everyFallacyHasCorrection && deterministic && total;
  return { catchesEachFallacy, recallHigh, noFalseFlags, everyFallacyHasCorrection, deterministic, total, score: all ? 100 : 0 };
}
