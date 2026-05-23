/**
 * v2.40.0 — ARGUS-10 ENGINE: fusion formula + HMAC-signed result.
 *
 * Pipeline:
 *   1. Probe every eye → Guardian rebalances open ones via softmax
 *   2. For each candidate: collect raw signals from every live eye
 *   3. Fuse: score = Σ(weight × signal) × hydraBonus × recencyBoost × honestMirrorMultiplier
 *   4. Sort + HMAC-sign the result frame (offline-verifiable)
 *
 * Fusion details:
 *   - Surface + truth eyes contribute via weighted sum (post-softmax weights)
 *   - HYDRA eyes contribute via the bonus multiplier only (not the sum)
 *   - recencyBoost = 1 + log10(1 + 1/recencyDays) ; clamped [1.0, 1.5]
 *   - honestMirrorMultiplier clamps to [0.5, 1.5] (penalty + reward)
 *
 * Why this fusion shape:
 *   - Eye sum keeps all signals comparable in [0, 1]
 *   - Multipliers move score by AT MOST 2.25× total — strong signal but
 *     bounded so a single eye can't overwhelm consensus
 *   - All multipliers are MULTIPLICATIVE (independent), not additive,
 *     so a vendor with TERRIBLE honest-mirror score can't be rescued by
 *     recency alone
 */

import { createHmac } from "node:crypto";
import type {
  ArgusSearchInput, ArgusSearchResult, Candidate, Eye, EyeCtx, ScoredCandidate, EyeId,
} from "./types.js";
import { SURFACE_EYES } from "./eyes_surface.js";
import { TRUTH_EYES, honestMirrorMultiplier } from "./eyes_truth.js";
import { rebalanceEyeWeights } from "./guardian.js";
import { hydraBonus } from "./hydra.js";

const ARGUS_HMAC_KEY = process.env.MNEME_ARGUS_KEY ?? "MNEME-ARGUS-10-DEFAULT-KEY-v2.40";

export async function argusSearch(input: ArgusSearchInput): Promise<ArgusSearchResult> {
  const t0 = Date.now();
  const ctx: EyeCtx = {
    repoRoot: input.repoRoot,
    embedder: input.embedder ?? null,
  };

  // Build the eye bundle (surface + truth + optional hydra).
  const baseEyes: Eye[] = [...SURFACE_EYES, ...TRUTH_EYES];
  const hydraEyes: Eye[] = input.hydraEyes ?? [];
  const allEyes = [...baseEyes, ...hydraEyes];

  // EYE_8 (embedder) needs special probe — if no embedder supplied, force CLOSED.
  const probeOverride = new Map<EyeId, "OPEN" | "CLOSED" | "DEGRADED">();
  if (!input.embedder) probeOverride.set("EYE_8_embedding_cosine", "CLOSED");

  const reb = rebalanceEyeWeights(baseEyes, probeOverride);

  const scored: ScoredCandidate[] = [];
  for (const cand of input.candidates) {
    const breakdown: ScoredCandidate["eyes"] = [];
    let weightedSum = 0;
    // 1) Run live base eyes
    for (const e of reb.liveEyes) {
      const w = reb.newWeights.get(e.id) ?? 0;
      let raw = 0;
      let reason = "";
      try {
        const r = await Promise.resolve(e.signal(input.query, cand, ctx));
        raw = Math.max(0, Math.min(1, r.raw));
        reason = r.reason;
      } catch (err) {
        raw = 0;
        reason = `eye error: ${(err as Error).message?.slice(0, 60) ?? "err"}`;
      }
      breakdown.push({ id: e.id, layer: e.layer, weight: w, raw, reason });
      weightedSum += w * raw;
    }
    // 2) Closed base eyes — surface them with raw=null
    for (const id of reb.closedIds) {
      const e = baseEyes.find((x) => x.id === id)!;
      breakdown.push({ id: e.id, layer: e.layer, weight: 0, raw: null, reason: "CLOSED — no probe / no dep" });
    }
    // 3) Run hydra eyes; count lit ones for bonus
    let litHydra = 0;
    for (const e of hydraEyes) {
      let raw = 0;
      let reason = "";
      try {
        const r = await Promise.resolve(e.signal(input.query, cand, ctx));
        raw = Math.max(0, Math.min(1, r.raw));
        reason = r.reason;
      } catch (err) {
        raw = 0;
        reason = `hydra error: ${(err as Error).message?.slice(0, 60) ?? "err"}`;
      }
      if (raw >= 0.5) litHydra += 1;
      breakdown.push({ id: e.id, layer: "hydra", weight: 0, raw, reason });
    }
    // 4) Multipliers
    const hb = hydraBonus(litHydra);
    const days = Math.max(0.5, cand.meta?.recencyDays ?? 365);
    const recencyBoost = Math.max(1.0, Math.min(1.5, 1 + Math.log10(1 + 1 / days)));
    const hm = honestMirrorMultiplier(input.repoRoot, cand.meta?.vendor);
    const honestM = Math.max(0.5, Math.min(1.5, hm));

    const score = weightedSum * hb * recencyBoost * honestM;
    scored.push({
      candidate: cand,
      score,
      eyes: breakdown,
      multipliers: { hydraBonus: hb, recencyBoost, honestMirrorMultiplier: honestM },
      closedEyes: reb.closedIds,
    });
  }

  // Sort + truncate
  scored.sort((a, b) => b.score - a.score);
  const topK = input.topK ?? scored.length;
  const top = scored.slice(0, topK);

  // HMAC-sign the result frame.
  const canonical = JSON.stringify({
    q: input.query,
    cands: input.candidates.map((c) => c.text),
    scores: top.map((s) => ({ t: s.candidate.text, score: Number(s.score.toFixed(6)) })),
  });
  const hmac = createHmac("sha256", ARGUS_HMAC_KEY).update(canonical).digest("hex").slice(0, 32);

  return {
    query: input.query,
    scored: top,
    health: {
      total: baseEyes.length + hydraEyes.length,
      open: reb.liveEyes.length + hydraEyes.length,
      closed: reb.closedIds.length,
    },
    hmac,
    durationMs: Date.now() - t0,
  };
}

/**
 * Verify an ArgusSearchResult by recomputing its HMAC over the input.
 */
export function verifyArgusResult(input: ArgusSearchInput, result: ArgusSearchResult): boolean {
  const canonical = JSON.stringify({
    q: input.query,
    cands: input.candidates.map((c) => c.text),
    scores: result.scored.map((s) => ({ t: s.candidate.text, score: Number(s.score.toFixed(6)) })),
  });
  const expected = createHmac("sha256", ARGUS_HMAC_KEY).update(canonical).digest("hex").slice(0, 32);
  return expected === result.hmac;
}
