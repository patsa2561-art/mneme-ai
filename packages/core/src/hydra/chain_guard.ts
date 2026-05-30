/**
 * v2.100.0 — HYDRA · GUARD × CHAIN fusion ("temporal guarded replay").
 *
 * The two gems become one. The PROVENANCE CHAIN (v2.98) already records
 * every codebook delta with a seq. The GUARD (v2.97) redacts stale content.
 * Here the chain computes its OWN atrophy clock — no external age source —
 * and drives the guard: a phrase that was added long ago and never touched
 * since is STALE; replaying with `--guard` redacts exactly those.
 *
 * So you can replay the codebook at any past step, and the entries that had
 * already gone cold by then expand only to their signed abstract — the AI
 * gets the *shape* of old knowledge but cannot quote rotten detail. The
 * staleness is derived deterministically from the chain's own history, and
 * (the Padgett rule) only PROVEN-old entries go stale — anything we can't
 * prove is old stays fresh.
 *
 * STABILITY: every function is total. Garbage chain / bad index / empty →
 * the safest, smallest result, never a throw.
 */

import { type Codebook } from "./engine.js";
import { replayChain, type CodebookDelta } from "./chain.js";
import { type TrustLevel } from "./guard.js";

/**
 * For the codebook that exists at `uptoIndex`, the seq at which each
 * surviving phrase was most recently ADDED (i.e. last touched). Pure;
 * never throws. A phrase removed and re-added gets the later seq (it's
 * "fresh" again); a phrase added once and left alone keeps its old seq.
 */
export function phraseAddedSeq(chain: CodebookDelta[], uptoIndex: number): Map<string, number> {
  const seqOf = new Map<string, number>();
  if (!Array.isArray(chain)) return seqOf;
  const end = Math.min(uptoIndex, chain.length - 1);
  for (let i = 0; i <= end; i++) {
    const d = chain[i];
    if (!d) continue;
    if (Array.isArray(d.removed)) for (const p of d.removed) seqOf.delete(p);
    if (Array.isArray(d.added)) for (const a of d.added) if (a && typeof a.phrase === "string") seqOf.set(a.phrase, d.seq);
  }
  return seqOf;
}

export interface TemporalTrust {
  trustMap: Record<string, TrustLevel>;
  freshCount: number;
  staleCount: number;
  /** the index the trust was computed at. */
  atIndex: number;
}

/**
 * Derive a trust map for the codebook at `uptoIndex` FROM THE CHAIN'S OWN
 * HISTORY. An entry is stale when its age (deltas since last touched)
 * exceeds `halfLifeDeltas * 2` — the same "proven-old, else fresh"
 * discipline as the atrophy clock. Total; never throws.
 */
export function trustMapFromChain(chain: CodebookDelta[], uptoIndex: number, halfLifeDeltas: number): TemporalTrust {
  const empty: TemporalTrust = { trustMap: {}, freshCount: 0, staleCount: 0, atIndex: uptoIndex };
  try {
    if (!Array.isArray(chain) || chain.length === 0 || !(halfLifeDeltas > 0)) return empty;
    const at = Math.min(Math.max(0, uptoIndex), chain.length - 1);
    const r = replayChain(chain, at);
    if (!r.ok || !r.codebook) return { ...empty, atIndex: at };
    const addedSeq = phraseAddedSeq(chain, at);
    const trustMap: Record<string, TrustLevel> = {};
    let fresh = 0, stale = 0;
    for (const e of r.codebook.entries) {
      if (!e || typeof e.phrase !== "string") continue;
      const added = addedSeq.get(e.phrase);
      const age = typeof added === "number" ? at - added : 0;   // unknown ⇒ treat as just-added (fresh)
      if (age > halfLifeDeltas * 2) { trustMap[e.sym] = "stale"; stale++; }
      else fresh++;
    }
    return { trustMap, freshCount: fresh, staleCount: stale, atIndex: at };
  } catch { return empty; }
}

export interface GuardedReplay {
  ok: boolean;
  codebook: Codebook | null;
  trust: TemporalTrust;
  reason: string;
}

/**
 * Replay the codebook at `index` AND attach the chain-derived trust map.
 * Combine with expandGuarded(encoded, codebook, trustFromMap(trust.trustMap))
 * to get a stale-aware, byte-lossless-for-fresh, redacted-for-cold view of
 * any past step. Total; never throws.
 */
export function guardedReplay(chain: CodebookDelta[], index: number, halfLifeDeltas: number): GuardedReplay {
  try {
    if (!Array.isArray(chain) || chain.length === 0) return { ok: false, codebook: null, trust: { trustMap: {}, freshCount: 0, staleCount: 0, atIndex: index }, reason: "empty chain" };
    const at = Math.min(Math.max(0, index), chain.length - 1);
    const r = replayChain(chain, at);
    if (!r.ok || !r.codebook) return { ok: false, codebook: null, trust: { trustMap: {}, freshCount: 0, staleCount: 0, atIndex: at }, reason: r.reason };
    const trust = trustMapFromChain(chain, at, halfLifeDeltas);
    return { ok: true, codebook: r.codebook, trust, reason: "replayed + trust derived from chain history" };
  } catch (e) { return { ok: false, codebook: null, trust: { trustMap: {}, freshCount: 0, staleCount: 0, atIndex: index }, reason: `threw: ${(e as Error).message}` }; }
}

export interface GuardedChainGauntlet {
  /** trust derivation is deterministic (same chain → same map). */
  deterministic: boolean;
  /** an entry added at the tip is NEVER stale. */
  freshAtTip: boolean;
  /** only PROVEN-old entries are marked stale (no over-redaction). */
  provenOnly: boolean;
  /** guarded replay is total on garbage (never throws). */
  stable: boolean;
  /** 0–100. 100 ⟺ all hold. */
  score: number;
}

/** Prove the fusion's invariants over a real chain. Total. */
export function guardedChainGauntlet(chain: CodebookDelta[], halfLifeDeltas: number): GuardedChainGauntlet {
  try {
    // Nothing to prove on an empty/invalid chain → score 0 (not a vacuous pass).
    if (!Array.isArray(chain) || chain.length === 0) return { deterministic: false, freshAtTip: false, provenOnly: false, stable: true, score: 0 };
    const a = trustMapFromChain(chain, chain.length - 1, halfLifeDeltas);
    const b = trustMapFromChain(chain, chain.length - 1, halfLifeDeltas);
    const deterministic = JSON.stringify(a.trustMap) === JSON.stringify(b.trustMap);
    // Entries added in the LAST delta must not be stale at the tip.
    const tip = chain[chain.length - 1];
    let freshAtTip = true;
    if (tip && Array.isArray(tip.added)) {
      const r = replayChain(chain, chain.length - 1);
      const cb = r.codebook;
      if (cb) {
        const tipPhrases = new Set(tip.added.map((x) => x.phrase));
        for (const e of cb.entries) if (tipPhrases.has(e.phrase) && a.trustMap[e.sym] === "stale") freshAtTip = false;
      }
    }
    // proven-only: every stale entry genuinely has age > halfLife*2.
    let provenOnly = true;
    const addedSeq = phraseAddedSeq(chain, chain.length - 1);
    const r2 = replayChain(chain, chain.length - 1);
    if (r2.codebook) {
      for (const e of r2.codebook.entries) {
        if (a.trustMap[e.sym] === "stale") {
          const added = addedSeq.get(e.phrase);
          const age = typeof added === "number" ? (chain.length - 1) - added : 0;
          if (!(age > halfLifeDeltas * 2)) provenOnly = false;
        }
      }
    }
    let stable = true;
    try { guardedReplay(null as never, 5, 0); trustMapFromChain(undefined as never, 0, -1); } catch { stable = false; }
    const perfect = deterministic && freshAtTip && provenOnly && stable;
    return { deterministic, freshAtTip, provenOnly, stable, score: perfect ? 100 : 0 };
  } catch { return { deterministic: false, freshAtTip: false, provenOnly: false, stable: false, score: 0 }; }
}
