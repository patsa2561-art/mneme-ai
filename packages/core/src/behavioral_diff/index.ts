/**
 * BEHAVIORAL DIFF LENS — the inversion git can't do, made concrete ON git (not a replacement for it).
 *
 * git diffs TEXT. In the AI age that misjudges change in BOTH directions:
 *   • an AI regenerates a whole file (rename + reorder) → a 69% text diff that changed NOTHING behaviorally
 *     — git makes you review pure noise.
 *   • a human flips one character (0.01 → 0.02) → a 2% text diff that CHANGED behavior — git waves it through.
 * The unit of review in the AI age is not the line, it is the BEHAVIOR. This lens pairs each changed
 * function's TEXT magnitude against its proven BEHAVIORAL verdict and surfaces exactly those two traps:
 *   🔇 NOISE        — big text change, behavior preserved → safe to skim.
 *   🔴 SILENT-RISK  — tiny text change, behavior changed → the one to actually review.
 *
 * This module owns the pure parts: a text-magnitude ratio, and the classification of (textPct × verdict)
 * into the review buckets + a headline. The CLI/MCP extract the changed functions (equiv_diff), run the
 * behavioral verdict per function (the equiv engine), and feed the entries here.
 *
 * ★HONEST (DIAKRISIS): this is a LENS over git, NOT a replacement — git stays the store of record. The
 * behavioral verdict is sound for PURE functions (the equiv engine's scope); a function it can't verify
 * is UNKNOWN and always routed to review, never assumed safe. textChangeRatio is a rough magnitude
 * signal (token-set distance), not a semantic measure — its only job is the CONTRAST with behavior.
 */
export type BehaviorVerdict = "PRESERVED" | "CHANGED" | "UNKNOWN";
export interface BDiffEntry { name: string; file?: string; textPct: number; verdict: BehaviorVerdict; counterexample?: unknown }
export type BDiffClass = "NOISE" | "SILENT-RISK" | "CHANGED" | "PRESERVED" | "UNKNOWN";
export interface BDiffClassified extends BDiffEntry { klass: BDiffClass }
export interface BehavioralDiff {
  entries: BDiffClassified[]; total: number;
  preserved: number; changed: number; unknown: number; noise: number; silentRisk: number;
  reviewSet: BDiffClassified[];   // what a human should actually look at (changed + unknown), silent-risk first
  headline: string;
}

const tok = (s: string): Set<string> => new Set(String(s ?? "").match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? []);
/** Rough text-change magnitude 0..1 (token-set Jaccard distance). Only used for the CONTRAST with behavior. */
export function textChangeRatio(oldSrc: string, newSrc: string): number {
  const a = tok(oldSrc), b = tok(newSrc); if (!a.size && !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : Math.round((1 - inter / union) * 1000) / 1000;
}

/** Classify each (textPct × behavioral verdict) into review buckets; surface the two traps git misjudges. */
export function classifyBehavioralDiff(entries: ReadonlyArray<BDiffEntry>, opts?: { bigText?: number; tinyText?: number }): BehavioralDiff {
  const bigText = opts?.bigText ?? 0.3, tinyText = opts?.tinyText ?? 0.12;
  const classified: BDiffClassified[] = (entries ?? []).map((e) => {
    const pct = Math.max(0, Math.min(1, Number(e?.textPct) || 0));
    let klass: BDiffClass;
    if (e.verdict === "UNKNOWN") klass = "UNKNOWN";
    else if (e.verdict === "CHANGED") klass = pct <= tinyText ? "SILENT-RISK" : "CHANGED";
    else klass = pct >= bigText ? "NOISE" : "PRESERVED";
    return { ...e, textPct: pct, klass };
  });
  const count = (k: BDiffClass) => classified.filter((c) => c.klass === k).length;
  const preserved = count("PRESERVED") + count("NOISE"), changed = count("CHANGED") + count("SILENT-RISK"), unknown = count("UNKNOWN");
  const order: Record<BDiffClass, number> = { "SILENT-RISK": 0, CHANGED: 1, UNKNOWN: 2, NOISE: 3, PRESERVED: 4 };
  const reviewSet = classified.filter((c) => c.klass === "SILENT-RISK" || c.klass === "CHANGED" || c.klass === "UNKNOWN").sort((a, b) => order[a.klass] - order[b.klass] || a.name.localeCompare(b.name));
  const noise = count("NOISE"), silentRisk = count("SILENT-RISK");
  const headline = `${classified.length} changed fn(s): ${changed} behavior-changed (${silentRisk} SILENT-RISK), ${preserved} behavior-preserved (${noise} text-noise), ${unknown} unverified → review ${reviewSet.length}.`;
  return { entries: classified.sort((a, b) => order[a.klass] - order[b.klass] || a.name.localeCompare(b.name)), total: classified.length, preserved, changed, unknown, noise, silentRisk, reviewSet, headline };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface BehavioralDiffGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function behavioralDiffGauntlet(): BehavioralDiffGauntlet {
  const ratioOK = textChangeRatio("a b c", "a b c") === 0 && textChangeRatio("a b c", "x y z") > 0.9 && textChangeRatio("a b c d", "a b c e") > 0 && textChangeRatio("a b c d", "a b c e") < 0.5;
  const bd = classifyBehavioralDiff([
    { name: "reformatted", textPct: 0.69, verdict: "PRESERVED" },     // big text, no behavior → NOISE (git made you review noise)
    { name: "oneChar", textPct: 0.04, verdict: "CHANGED" },           // tiny text, behavior changed → SILENT-RISK (git waved it through)
    { name: "bigRewrite", textPct: 0.8, verdict: "CHANGED" },         // big text + changed → normal CHANGED
    { name: "tinyFix", textPct: 0.05, verdict: "PRESERVED" },         // tiny text, preserved → PRESERVED
    { name: "exotic", textPct: 0.5, verdict: "UNKNOWN" },             // unverifiable → UNKNOWN (review)
  ]);
  const noiseOK = bd.entries.find((e) => e.name === "reformatted")!.klass === "NOISE";
  const silentOK = bd.entries.find((e) => e.name === "oneChar")!.klass === "SILENT-RISK";
  const reviewOrder = bd.reviewSet[0].klass === "SILENT-RISK" && bd.reviewSet.some((e) => e.name === "exotic") && !bd.reviewSet.some((e) => e.name === "reformatted") && !bd.reviewSet.some((e) => e.name === "tinyFix");
  const counts = bd.noise === 1 && bd.silentRisk === 1 && bd.changed === 2 && bd.preserved === 2 && bd.unknown === 1;
  const total = (() => { try { classifyBehavioralDiff(null as never); textChangeRatio(null as never, null as never); classifyBehavioralDiff([]); return true; } catch { return false; } })();
  const checks = [
    { name: "TEXT-RATIO", pass: ratioOK, detail: "token-set distance: identical→0, disjoint→~1, one-token-change→small" },
    { name: "NOISE-TRAP", pass: noiseOK, detail: "big text change + behavior preserved → NOISE (the review git wastes on you)" },
    { name: "SILENT-RISK-TRAP", pass: silentOK, detail: "tiny text change + behavior changed → SILENT-RISK (the danger git waves through)" },
    { name: "REVIEW-SET", pass: reviewOrder, detail: "review set = changed + unknown, SILENT-RISK first; excludes noise + safe-preserved" },
    { name: "COUNTS+TOTAL", pass: counts && total, detail: "bucket counts correct; null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
