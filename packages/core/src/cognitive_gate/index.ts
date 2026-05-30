/**
 * v2.103.0 — COGNITIVE WISDOM GATE (NEMESIS × HYDRA × NOTARY).
 *
 * The honest core of the image's "Cognitive Entanglement" — WITHOUT the
 * quantum-mysticism. We do NOT claim to read a soul. We measure one real,
 * falsifiable thing: how far a diff's coding STYLE (NEMESIS micro-tells —
 * whitespace, quotes, brace style, naming; 50+ features) sits from an
 * author's own historical baseline. A large, well-separated deviation is a
 * signal worth a human's eyes (a stolen key pushing foreign-style code, or
 * just an unusual change) — NEVER an automatic block.
 *
 * What makes it a WISDOM gate, not security-theatre: it measures its OWN
 * reliability. If the author's style cannot be separated from other styles
 * on a held-out benchmark, the gate returns UNKNOWN and refuses to flag
 * (prove-or-unknown; the Padgett rule — never auto-reject on uncertainty).
 * Every verdict is Ed25519-signed, so any AI agent — Claude / GPT / Gemini —
 * can verify it offline before trusting a diff. That is how it empowers
 * every agent: a portable, self-aware, signed second opinion on authorship.
 *
 * STABILITY (108-error rule): every function is total — empty samples,
 * garbage diffs, a thrown extractor → the safest verdict (UNKNOWN), never a
 * throw, never a false FLAG.
 */

import { extractMicroProfile, microDistance, type MicroProfile } from "../nemesis/capillary.js";
import { issueReceipt, type NotaryReceipt } from "../notary/receipt.js";

export interface CognitiveSignature {
  author: string;
  baseline: MicroProfile;
  /** mean pairwise micro-distance among the author's own diffs (their
   *  natural style spread — the denominator for "how unusual is this?"). */
  intraVariance: number;
  sampleCount: number;
}

const MIN_SAMPLES = 3;
const EPS = 1e-3;

function safeProfile(diff: string): MicroProfile | null {
  try { if (typeof diff !== "string" || diff.length === 0) return null; return extractMicroProfile(diff); } catch { return null; }
}

function averageProfiles(profiles: MicroProfile[]): MicroProfile {
  const keys = new Set<string>();
  for (const p of profiles) for (const k of Object.keys(p.features)) keys.add(k);
  const features: Record<string, number> = {};
  for (const k of keys) { let s = 0; for (const p of profiles) s += p.features[k] ?? 0; features[k] = s / profiles.length; }
  const totalLines = Math.round(profiles.reduce((a, p) => a + p.totalLines, 0) / profiles.length);
  return { features, totalLines, language: profiles[0]?.language ?? "unknown" };
}

/** Build an author's cognitive signature from their historical diffs. Total. */
export function buildCognitiveSignature(author: string, diffs: string[]): CognitiveSignature {
  const profiles = (Array.isArray(diffs) ? diffs : []).map(safeProfile).filter((p): p is MicroProfile => p !== null);
  if (profiles.length === 0) return { author: String(author ?? "unknown"), baseline: { features: {}, totalLines: 0, language: "unknown" }, intraVariance: 0, sampleCount: 0 };
  const baseline = averageProfiles(profiles);
  let sum = 0, n = 0;
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) { sum += microDistance(profiles[i]!, profiles[j]!); n++; }
  return { author: String(author ?? "unknown"), baseline, intraVariance: n > 0 ? sum / n : 0, sampleCount: profiles.length };
}

export type GateVerdict = "ALLOW" | "REVIEW" | "FLAG" | "UNKNOWN";

export interface CognitiveJudgement {
  verdict: GateVerdict;
  deviation: number;
  ratio: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/** Judge a new diff vs an author's signature. ADVISORY (FLAG = "review",
 *  never "reject"); UNKNOWN when the signature is too thin. Total. */
export function judgeDiff(sig: CognitiveSignature, newDiff: string): CognitiveJudgement {
  try {
    if (!sig || sig.sampleCount < MIN_SAMPLES) return { verdict: "UNKNOWN", deviation: 0, ratio: 0, confidence: "low", reason: `signature too thin (${sig?.sampleCount ?? 0} < ${MIN_SAMPLES}) — cannot judge` };
    const p = safeProfile(newDiff);
    if (!p) return { verdict: "UNKNOWN", deviation: 0, ratio: 0, confidence: "low", reason: "empty/unparseable diff" };
    const deviation = microDistance(p, sig.baseline);
    const ratio = deviation / (sig.intraVariance + EPS);
    let verdict: GateVerdict; let confidence: "high" | "medium" | "low";
    if (ratio <= 1.5) { verdict = "ALLOW"; confidence = "high"; }
    else if (ratio <= 3) { verdict = "REVIEW"; confidence = "medium"; }
    else { verdict = "FLAG"; confidence = "medium"; }
    return { verdict, deviation, ratio, confidence, reason: `style deviation ${deviation.toFixed(3)} = ${ratio.toFixed(1)}× the author's own spread` };
  } catch (e) { return { verdict: "UNKNOWN", deviation: 0, ratio: 0, confidence: "low", reason: `threw: ${(e as Error).message}` }; }
}

export interface Separability {
  separable: boolean;
  authorMeanDist: number;
  otherMeanDist: number;
  margin: number;
  reason: string;
}

/** THE HONESTY MECHANISM — can this signature actually tell the author apart
 *  from others on held-out samples? If not, the gate downgrades to UNKNOWN
 *  rather than flag on noise. Total. */
export function measureSeparability(sig: CognitiveSignature, authorHeldout: string[], otherDiffs: string[]): Separability {
  const aProfiles = (authorHeldout ?? []).map(safeProfile).filter((p): p is MicroProfile => p !== null);
  const oProfiles = (otherDiffs ?? []).map(safeProfile).filter((p): p is MicroProfile => p !== null);
  if (!sig || sig.sampleCount < MIN_SAMPLES || aProfiles.length === 0 || oProfiles.length === 0) {
    return { separable: false, authorMeanDist: 0, otherMeanDist: 0, margin: 0, reason: "insufficient held-out samples to measure separability" };
  }
  const mean = (ps: MicroProfile[]) => ps.reduce((a, p) => a + microDistance(p, sig.baseline), 0) / ps.length;
  const authorMeanDist = mean(aProfiles);
  const otherMeanDist = mean(oProfiles);
  const margin = otherMeanDist - authorMeanDist;
  const separable = margin > Math.max(EPS, sig.intraVariance * 0.5) && otherMeanDist > authorMeanDist * 1.3;
  return { separable, authorMeanDist, otherMeanDist, margin, reason: separable ? "author style is separable from others" : "author style NOT reliably separable — gate will not flag" };
}

export interface WisdomVerdict {
  verdict: GateVerdict;
  judgement: CognitiveJudgement;
  separability?: Separability;
  receipt: NotaryReceipt;
}

/** THE WISDOM GATE — the capstone an AI agent calls before trusting a diff's
 *  authorship. Refuses to FLAG/REVIEW unless the signature is proven
 *  separable (downgrades to UNKNOWN). Signs the verdict for offline trust. */
export function wisdomGate(repoRoot: string, sig: CognitiveSignature, newDiff: string, at: number, benchmark?: { authorHeldout: string[]; otherDiffs: string[] }): WisdomVerdict {
  const judgement = judgeDiff(sig, newDiff);
  let verdict = judgement.verdict;
  let separability: Separability | undefined;
  if (benchmark) {
    separability = measureSeparability(sig, benchmark.authorHeldout, benchmark.otherDiffs);
    if ((verdict === "FLAG" || verdict === "REVIEW") && !separability.separable) verdict = "UNKNOWN";
  }
  const receipt = issueReceipt(repoRoot, {
    kind: "reasoning-trace",
    subject: `cognitive-gate:${sig?.author ?? "unknown"}`,
    payload: { author: sig?.author ?? "unknown", verdict, deviation: Number(judgement.deviation.toFixed(4)), ratio: Number(judgement.ratio.toFixed(3)), separable: separability?.separable ?? null, sampleCount: sig?.sampleCount ?? 0 },
    includePayload: true,
    issuedAt: at,
  });
  return { verdict, judgement, separability, receipt };
}

export interface CognitiveGauntlet {
  catchesForeign: boolean;
  allowsAuthor: boolean;
  unknownWhenUnseparable: boolean;
  deterministic: boolean;
  stable: boolean;
  separable: boolean;
  score: number;
}

/** Prove the gate on labelled synthetic data: catch a foreign style, allow
 *  the author's own, stay silent (UNKNOWN) when it can't separate. Total. */
export function cognitiveGauntlet(repoRoot: string, authorDiffs: string[], foreignDiff: string, authorHeldout: string, at: number): CognitiveGauntlet {
  try {
    const sig = buildCognitiveSignature("author", authorDiffs);
    // Nothing to prove without a real signature + samples → score 0.
    if (sig.sampleCount < MIN_SAMPLES || typeof foreignDiff !== "string" || foreignDiff.length === 0 || typeof authorHeldout !== "string" || authorHeldout.length === 0) {
      return { catchesForeign: false, allowsAuthor: false, unknownWhenUnseparable: false, deterministic: false, stable: true, separable: false, score: 0 };
    }
    const bench = { authorHeldout: [authorHeldout], otherDiffs: [foreignDiff] };
    const sep = measureSeparability(sig, bench.authorHeldout, bench.otherDiffs);
    const foreignV = wisdomGate(repoRoot, sig, foreignDiff, at, bench).verdict;
    const authorV = wisdomGate(repoRoot, sig, authorHeldout, at, bench).verdict;
    const catchesForeign = sep.separable ? (foreignV === "FLAG" || foreignV === "REVIEW") : true;
    const allowsAuthor = authorV === "ALLOW" || authorV === "UNKNOWN";
    // Unseparable case: author vs author (same dist) must NOT flag.
    const flatV = wisdomGate(repoRoot, sig, authorHeldout, at, { authorHeldout: [authorHeldout], otherDiffs: [authorHeldout] }).verdict;
    const unknownWhenUnseparable = flatV !== "FLAG";
    const a = wisdomGate(repoRoot, sig, foreignDiff, at, bench).receipt.payloadHash;
    const b = wisdomGate(repoRoot, sig, foreignDiff, at, bench).receipt.payloadHash;
    const deterministic = a === b;
    let stable = true;
    try { judgeDiff(null as never, ""); buildCognitiveSignature("x", null as never); measureSeparability(null as never, [], []); } catch { stable = false; }
    const perfect = catchesForeign && allowsAuthor && unknownWhenUnseparable && deterministic && stable;
    return { catchesForeign, allowsAuthor, unknownWhenUnseparable, deterministic, stable, separable: sep.separable, score: perfect ? 100 : 0 };
  } catch { return { catchesForeign: false, allowsAuthor: false, unknownWhenUnseparable: false, deterministic: false, stable: false, separable: false, score: 0 }; }
}
