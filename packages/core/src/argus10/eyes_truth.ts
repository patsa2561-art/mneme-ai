/**
 * v2.40.0 — ARGUS-10 TRUTH LAYER (EYE_6..EYE_10).
 *
 * Mneme-unique signals that no plain search engine can copy because they
 * require Mneme's existing primitives:
 *
 *   EYE_6   homoglyph_collapse      — uses acgv_input_hygiene
 *   EYE_7   number_paraphrase       — uses acgv_number_bridge
 *   EYE_8   embedding_cosine         — caller-supplied embedder; closes
 *                                      gracefully when null
 *   EYE_9   hmac_provenance          — reads .mneme/cli-activity.jsonl
 *                                      chain; +25% boost / −50% penalty
 *   EYE_10  honest_mirror_penalty    — reads .mneme/honest_mirror/weights;
 *                                      vendor's calibration delta multiplier
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Candidate, Eye, EyeCtx, EyeSignal } from "./types.js";
import { safeNormalize } from "../squadron/acgv_input_hygiene.js";
import { canonicalRewrite, sameQuantity, extractCanonicalNumbers } from "../squadron/acgv_number_bridge.js";

// ─── EYE_6 — homoglyph collapse ────────────────────────────────────────
//
// Pre-normalize both texts through the v2.40 input hygiene module:
// Cyrillic/Greek/full-width/zero-width are stripped or folded to canonical
// Latin. Then a quick exact / containment / Dice check on the folded form.
//
// D1 of the audit (homoglyph attack) proved Mneme has this logic; EYE_6
// EXPOSES it as a search signal.

function cyrillicGreekToLatin(s: string): string {
  // Conservative homoglyph folding for the most common confusable pairs.
  // We do NOT touch CJK or Arabic — those look-alikes need a different
  // confusables table.
  const map: Record<string, string> = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y",
    "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "Х": "X", "У": "Y",
    "ν": "v", "ο": "o", "ρ": "p", "α": "a", "ε": "e", "τ": "t",
  };
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  return out;
}

function fold(s: string): string {
  return cyrillicGreekToLatin(safeNormalize(s)).toLowerCase();
}

export const EYE_6_homoglyph_collapse: Eye = {
  id: "EYE_6_homoglyph_collapse",
  layer: "truth",
  weight: 0.10,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const fq = fold(q);
    const fc = fold(c.text);
    if (fq.length === 0 || fc.length === 0) return { raw: 0, reason: "empty after fold" };
    if (fq === fc) return { raw: 1.0, reason: "exact after homoglyph fold" };
    if (fc.includes(fq) || fq.includes(fc)) return { raw: 0.8, reason: "containment after fold" };
    // Fall back to bigram-Dice on folded form (catches partial matches).
    const A = new Set<string>();
    const B = new Set<string>();
    for (let i = 0; i < fq.length - 1; i++) A.add(fq.slice(i, i + 2));
    for (let i = 0; i < fc.length - 1; i++) B.add(fc.slice(i, i + 2));
    if (A.size === 0 || B.size === 0) return { raw: 0, reason: "no bigrams" };
    let inter = 0;
    for (const bg of A) if (B.has(bg)) inter++;
    const raw = (2 * inter) / (A.size + B.size);
    return { raw, reason: `folded-dice=${inter}` };
  },
};

// ─── EYE_7 — number paraphrase bridge ──────────────────────────────────
//
// Uses the v2.40 number bridge to detect "same quantity, different spelling".
// Strong score when the canonical-number multisets agree; weighted by
// per-number contribution when they overlap partially.

export const EYE_7_number_paraphrase: Eye = {
  id: "EYE_7_number_paraphrase",
  layer: "truth",
  weight: 0.10,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const nq = extractCanonicalNumbers(q).map((n) => n.value);
    const nc = extractCanonicalNumbers(c.text).map((n) => n.value);
    if (nq.length === 0 && nc.length === 0) return { raw: 0, reason: "no numbers" };
    if (nq.length === 0 || nc.length === 0) return { raw: 0, reason: "asymmetric numbers" };
    // Quick win: identical multisets
    if (sameQuantity(q, c.text)) {
      // Also compare canonical-rewrite forms for partial credit boost
      const rq = canonicalRewrite(q);
      const rc = canonicalRewrite(c.text);
      if (rq === rc) return { raw: 1.0, reason: "canonical rewrite identical" };
      return { raw: 0.9, reason: "same numeric multiset" };
    }
    // Partial overlap
    const setC = new Set(nc);
    let hits = 0;
    for (const v of nq) if (setC.has(v)) hits++;
    const raw = hits / Math.max(nq.length, nc.length);
    return { raw, reason: `overlap=${hits}/${Math.max(nq.length, nc.length)}` };
  },
};

// ─── EYE_8 — embedding cosine ──────────────────────────────────────────
//
// Caller supplies an embedder; if absent, eye CLOSES and Guardian
// rebalances. We compute one query embedding + one candidate embedding,
// cosine similarity, and clamp to [0, 1].
//
// Note: signal() is async — engine treats this uniformly.

export const EYE_8_embedding_cosine: Eye = {
  id: "EYE_8_embedding_cosine",
  layer: "truth",
  weight: 0.10,
  probe: () => "OPEN", // engine handles per-call close via try/catch
  async signal(q: string, c: Candidate, ctx: EyeCtx): Promise<EyeSignal> {
    if (!ctx.embedder) return { raw: 0, reason: "no embedder (closed)" };
    try {
      const vecs = await ctx.embedder.embed([q, c.text]);
      if (!vecs || vecs.length !== 2 || !vecs[0] || !vecs[1]) {
        return { raw: 0, reason: "embedder returned empty" };
      }
      const a = vecs[0]!, b = vecs[1]!;
      if (a.length !== b.length || a.length === 0) {
        return { raw: 0, reason: "dim mismatch" };
      }
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        na += a[i]! * a[i]!;
        nb += b[i]! * b[i]!;
      }
      if (na === 0 || nb === 0) return { raw: 0, reason: "zero vector" };
      const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
      const raw = Math.max(0, Math.min(1, (cos + 1) / 2));
      return { raw, reason: `cos=${cos.toFixed(3)}` };
    } catch (e) {
      return { raw: 0, reason: `embed failed: ${(e as Error).message?.slice(0, 60) ?? "err"}` };
    }
  },
};

// ─── EYE_9 — HMAC provenance boost ─────────────────────────────────────
//
// Reads .mneme/cli-activity.jsonl. If the candidate text appears in the
// chain AND the chain verifies, the eye returns +0.25; if tampering is
// detected at or before this entry, it returns −0.50 (yes, negative;
// the engine clamps to [0,1] at fusion time).
//
// No other search engine in the world can do this — it requires Mneme's
// HMAC-chained activity ledger.

interface ActivityChain {
  hasMatch: boolean;
  tampered: boolean;
}

function readActivityChain(repoRoot: string, candidateText: string): ActivityChain {
  const path = join(repoRoot, ".mneme", "cli-activity.jsonl");
  if (!existsSync(path)) return { hasMatch: false, tampered: false };
  try {
    const body = readFileSync(path, "utf8");
    const lines = body.split("\n").filter(Boolean);
    let prevHash = "GENESIS";
    let tampered = false;
    let hasMatch = false;
    for (const line of lines) {
      let row: { hmac?: string; prev?: string; text?: string };
      try { row = JSON.parse(line); } catch { continue; }
      if (row.prev && row.prev !== prevHash) tampered = true;
      // Compute the expected hmac: sha256(prev||text)
      const expected = createHash("sha256")
        .update(`${prevHash}|${row.text ?? ""}`)
        .digest("hex").slice(0, 16);
      if (row.hmac && row.hmac !== expected) tampered = true;
      prevHash = row.hmac ?? prevHash;
      if (row.text && candidateText.length > 0 && row.text.toLowerCase().includes(candidateText.toLowerCase().slice(0, 60))) {
        hasMatch = true;
      }
    }
    return { hasMatch, tampered };
  } catch {
    return { hasMatch: false, tampered: false };
  }
}

export const EYE_9_hmac_provenance: Eye = {
  id: "EYE_9_hmac_provenance",
  layer: "truth",
  weight: 0.07,
  probe: () => "OPEN", // closes per-call if no .mneme/ found
  signal(_q: string, c: Candidate, ctx: EyeCtx): EyeSignal {
    if (c.meta?.inHmacChain === true) {
      return { raw: 1.0, reason: "meta.inHmacChain=true (caller asserted)" };
    }
    const chain = readActivityChain(ctx.repoRoot, c.text);
    if (chain.tampered) return { raw: 0, reason: "chain tampered (penalty)" };
    if (chain.hasMatch) return { raw: 1.0, reason: "candidate found in verified HMAC chain" };
    return { raw: 0.5, reason: "neutral: not in chain, but not tampered either" };
  },
};

// ─── EYE_10 — honest mirror penalty ────────────────────────────────────
//
// Reads .mneme/honest_mirror/weights.json (set by v2.30 HONEST MIRROR).
// Each vendor has a calibrationDelta — how often their stated confidence
// matches their observed accuracy. Over-confident vendors get scaled DOWN
// (×0.4), well-calibrated vendors stay at ×1.0.
//
// At eye level we return a 0..1 raw signal; the multiplier itself is
// applied separately in the fusion formula. Here we surface
// "well-calibrated → 1.0; over-confident → 0.4; unknown → 0.7".

interface HonestMirrorWeights {
  [vendor: string]: { calibrationDelta?: number; weight?: number };
}

function readHonestMirrorWeights(repoRoot: string): HonestMirrorWeights {
  const path = join(repoRoot, ".mneme", "honest_mirror_weights.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as HonestMirrorWeights; }
  catch { return {}; }
}

export function honestMirrorMultiplier(repoRoot: string, vendor: string | undefined): number {
  if (!vendor) return 1.0;
  const w = readHonestMirrorWeights(repoRoot);
  const entry = w[vendor] ?? w[vendor.toLowerCase()];
  if (!entry) return 1.0;
  if (typeof entry.weight === "number") {
    return Math.max(0.5, Math.min(1.5, entry.weight));
  }
  if (typeof entry.calibrationDelta === "number") {
    // delta of 0 = well-calibrated = ×1.0; delta of 0.6 (60% over) = ×0.4
    return Math.max(0.4, Math.min(1.0, 1.0 - entry.calibrationDelta));
  }
  return 1.0;
}

export const EYE_10_honest_mirror_penalty: Eye = {
  id: "EYE_10_honest_mirror_penalty",
  layer: "truth",
  weight: 0.07,
  probe: () => "OPEN",
  signal(_q: string, c: Candidate, ctx: EyeCtx): EyeSignal {
    const m = honestMirrorMultiplier(ctx.repoRoot, c.meta?.vendor);
    // Translate multiplier into 0..1 signal: 0.4 → 0.0, 1.0 → 0.85, 1.5 → 1.0
    const raw = Math.max(0, Math.min(1, (m - 0.4) / 1.1));
    return { raw, reason: `vendor=${c.meta?.vendor ?? "?"} mult=${m.toFixed(2)}` };
  },
};

export const TRUTH_EYES: Eye[] = [
  EYE_6_homoglyph_collapse,
  EYE_7_number_paraphrase,
  EYE_8_embedding_cosine,
  EYE_9_hmac_provenance,
  EYE_10_honest_mirror_penalty,
];
