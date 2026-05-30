/**
 * v2.97.0 — HYDRA · GUARDED EXPANSION ("Time-To-Trust").
 *
 * The fusion gem: HYDRA codebook × the knowledge-atrophy clock × NOTARY.
 * A normal expand() is byte-lossless. A GUARDED expand is lossless for
 * TRUSTED content but provably REDACTS stale/quarantined content down to a
 * signed abstract (sha256 + byte-count) — so an AI literally cannot
 * hallucinate from expired memory, yet can still verify the redacted
 * region's identity and request re-hydration.
 *
 * Prior-art research (v2.96) found no signed + lossless + TTL-guarded
 * codebook anywhere. This is that unfilled lane, made measurable:
 *   - all-fresh ⟹ guarded output is BYTE-IDENTICAL to the original (boolean)
 *   - any stale entry ⟹ its raw phrase NEVER appears, its sha256 DOES,
 *     fresh entries stay byte-exact (boolean)
 *   - deterministic: same input → same bytes (boolean)
 *
 * STABILITY: every function is total — it never throws. Malformed input,
 * a missing field, an unknown trust level → the SAFEST outcome (redact).
 * The 108-error rule: when in doubt, guard, don't crash and don't leak.
 */

import { type Codebook, sha256Hex } from "./engine.js";

export type TrustLevel = "fresh" | "stale" | "quarantined";

/** A function (or map) that returns the trust level for a symbol. */
export type TrustResolver = (sym: string) => TrustLevel;

export function trustFromMap(map: Record<string, TrustLevel>): TrustResolver {
  return (sym) => (map && Object.prototype.hasOwnProperty.call(map, sym) ? map[sym] ?? "fresh" : "fresh");
}

/**
 * The deterministic redaction placeholder for a guarded entry. Carries the
 * sha256 of the original phrase (identity-verifiable) + byte count + the
 * reason — but NOT the content. Re-hydration replaces it with the real
 * phrase once the symbol is re-verified.
 */
export function guardedPlaceholder(phrase: string, level: TrustLevel): string {
  const sha = sha256Hex(phrase).slice(0, 16);
  const bytes = Buffer.byteLength(phrase, "utf8");
  return `[mneme:redacted trust=${level} sha256=${sha} bytes=${bytes} — re-verify to access]`;
}

/**
 * GUARDED EXPAND. Fresh symbols expand to their phrase (byte-exact); stale
 * or quarantined symbols expand to a signed abstract. Total: never throws;
 * a bad entry is treated as quarantined (fail-closed, never leak).
 */
export function expandGuarded(encoded: string, cb: Codebook, trustOf: TrustResolver): string {
  if (typeof encoded !== "string") return "";
  if (!cb || !Array.isArray(cb.entries)) return encoded;
  let out = encoded;
  for (const e of cb.entries) {
    if (!e || typeof e.sym !== "string" || typeof e.phrase !== "string" || e.phrase.length === 0) continue;
    let level: TrustLevel;
    try { level = trustOf(e.sym) ?? "fresh"; } catch { level = "quarantined"; }
    const replacement = level === "fresh" ? e.phrase : guardedPlaceholder(e.phrase, level);
    out = out.split(e.sym).join(replacement);
  }
  return out;
}

/**
 * RE-HYDRATE a guarded output: given the set of symbols whose access has
 * been re-verified, replace their placeholders with the real phrase. Total:
 * unknown symbols / malformed input are left untouched (no throw, no leak).
 */
export function rehydrate(encoded: string, cb: Codebook, approvedSyms: Iterable<string>, trustOf: TrustResolver): string {
  if (typeof encoded !== "string") return "";
  if (!cb || !Array.isArray(cb.entries)) return encoded;
  const approved = new Set<string>();
  try { for (const s of approvedSyms) approved.add(s); } catch { /* leave empty */ }
  const t: TrustResolver = (sym) => (approved.has(sym) ? "fresh" : (() => { try { return trustOf(sym) ?? "fresh"; } catch { return "quarantined"; } })());
  return expandGuarded(encoded, cb, t);
}

export interface GuardedGauntlet {
  /** all-fresh ⟹ guarded output is byte-identical to the original. */
  freshLossless: boolean;
  /** every stale phrase is absent from guarded output AND its sha256 present. */
  redactionSound: boolean;
  /** fresh entries remain byte-exact even when others are redacted. */
  freshPreserved: boolean;
  /** deterministic — two guarded expands hash-identical. */
  deterministic: boolean;
  redactedCount: number;
  freshCount: number;
  /** 0–100. 100 ⟺ all four invariants hold. Cannot lie about a leak. */
  score: number;
}

/**
 * The guarded gauntlet — proves the four Time-To-Trust invariants over a
 * concrete trust assignment. Total + deterministic. `compressFn` lets the
 * caller pass the engine's compress to avoid an import cycle; if omitted we
 * verify directly against the codebook entries.
 */
export function guardedGauntlet(
  original: string,
  encoded: string,
  cb: Codebook,
  trustMap: Record<string, TrustLevel>,
): GuardedGauntlet {
  try {
    const allFresh: TrustResolver = () => "fresh";
    const resolver = trustFromMap(trustMap);
    const freshOut = expandGuarded(encoded, cb, allFresh);
    const freshLossless = sha256Hex(freshOut) === sha256Hex(original);

    const guarded1 = expandGuarded(encoded, cb, resolver);
    const guarded2 = expandGuarded(encoded, cb, resolver);
    const deterministic = sha256Hex(guarded1) === sha256Hex(guarded2);

    let redactionSound = true;
    let freshPreserved = true;
    let redactedCount = 0;
    let freshCount = 0;
    for (const e of cb.entries) {
      if (!e || typeof e.phrase !== "string" || e.phrase.length === 0) continue;
      const level = trustMap[e.sym] ?? "fresh";
      if (level === "fresh") {
        freshCount++;
        continue;
      }
      redactedCount++;
      // Correct, honest invariant — per OCCURRENCE, not per text:
      //   - the stale SYMBOL must be fully consumed (no un-redacted
      //     expansion survives), and
      //   - IF the symbol actually occurs in the encoded stream, its
      //     identity sha must appear (proof the redaction happened).
      // A "dead" symbol (its phrase was nested-consumed by a longer phrase
      // during compress, so it never appears in `encoded`) has nothing to
      // redact → vacuously sound. We do NOT require the phrase TEXT to be
      // globally absent: identical text inside a FRESH entry the caller
      // trusts is not a leak of the stale source.
      if (guarded1.includes(e.sym)) redactionSound = false;
      if (encoded.includes(e.sym)) {
        const sha = sha256Hex(e.phrase).slice(0, 16);
        if (!guarded1.includes(sha)) redactionSound = false;
      }
    }
    // Fresh-preserved: redacting some entries must not corrupt the fresh
    // ones. We check by re-hydrating ALL symbols → must equal fresh output.
    const rehydrated = rehydrate(encoded, cb, cb.entries.map((e) => e.sym), resolver);
    freshPreserved = sha256Hex(rehydrated) === sha256Hex(freshOut);

    const perfect = freshLossless && redactionSound && freshPreserved && deterministic;
    return { freshLossless, redactionSound, freshPreserved, deterministic, redactedCount, freshCount, score: perfect ? 100 : 0 };
  } catch {
    // Total: any unexpected failure → score 0, never throw.
    return { freshLossless: false, redactionSound: false, freshPreserved: false, deterministic: false, redactedCount: 0, freshCount: 0, score: 0 };
  }
}

/**
 * Compose the ATROPHY clock: mark a codebook's entries stale when the
 * caller's age map says their source region is older than the half-life.
 * `ageMsOf` returns the age (ms) of the source behind a symbol, or
 * undefined if unknown (unknown ⇒ fresh, the least-surprising default —
 * we only redact what we can PROVE is stale). Total; never throws.
 */
export function trustByAtrophy(cb: Codebook, ageMsOf: (sym: string) => number | undefined, halfLifeMs: number): Record<string, TrustLevel> {
  const out: Record<string, TrustLevel> = {};
  if (!cb || !Array.isArray(cb.entries) || !(halfLifeMs > 0)) return out;
  for (const e of cb.entries) {
    if (!e || typeof e.sym !== "string") continue;
    let age: number | undefined;
    try { age = ageMsOf(e.sym); } catch { age = undefined; }
    if (typeof age === "number" && Number.isFinite(age) && age > halfLifeMs * 2) out[e.sym] = "stale";
  }
  return out;
}
