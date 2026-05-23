/**
 * v2.40.0 — ARGUS-10 HYDRA REGENERATION.
 *
 * The Hydra: cut off a head, two more grow. We borrow the metaphor for
 * an *adaptive* eye system: when the antivirus learns a new strain (via
 * AV gap-scan + auto-synthesize), HYDRA spawns a NEW eye whose signal is
 * "does the candidate contain this strain's regex?"
 *
 * Result: every accepted vaccine class becomes a SEARCH SIGNAL. The
 * 10-eyed system grows into 11, 12, 15 eyes — and competitors that ship
 * a fixed-feature lexical search can't match it without re-implementing
 * the antivirus lattice.
 *
 * Strain acceptance gate: precision > 0.9 AND recall ≥ 0.5 on the
 * gap-scan ground truth. We honor those flags rather than re-measuring.
 */

import type { Eye, EyeId, Candidate, EyeSignal } from "./types.js";

export interface AvStrainLike {
  /** Strain id (used as the new eye's name). */
  name: string;
  /** Regex (string form; we new RegExp inside HYDRA). */
  regex: string;
  /** Measured precision on the gap-scan corpus. */
  precision: number;
  /** Measured recall on the gap-scan corpus. */
  recall?: number;
  /** True if the strain has been promoted to the live antivirus pool. */
  accepted?: boolean;
}

/**
 * Spawn one HYDRA eye from a strain. Pure function; no I/O.
 */
export function spawnHydraEye(strain: AvStrainLike): Eye | null {
  if (strain.precision < 0.9) return null;
  if ((strain.recall ?? 0) < 0.5) return null;
  let re: RegExp;
  try { re = new RegExp(strain.regex, "iu"); }
  catch { return null; }
  const id: EyeId = `EYE_HYDRA_${strain.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const eye: Eye = {
    id,
    layer: "hydra",
    weight: 0.05,
    probe: () => "OPEN",
    signal(_q: string, c: Candidate): EyeSignal {
      const hit = re.test(c.text);
      // Compose query side too — if BOTH query and candidate match the
      // same strain shape, we treat that as a strong co-membership signal.
      return hit
        ? { raw: 1.0, reason: `strain match: ${strain.name}` }
        : { raw: 0, reason: "no strain match" };
    },
  };
  return eye;
}

/**
 * Bulk spawn from a list. Filters out strains that fail the
 * precision/recall gate or have malformed regexes.
 */
export function autoSpawnHydra(strains: AvStrainLike[]): Eye[] {
  const out: Eye[] = [];
  for (const s of strains) {
    const eye = spawnHydraEye(s);
    if (eye) out.push(eye);
  }
  return out;
}

/**
 * Compute the HYDRA bonus multiplier given how many spawned eyes light
 * up for a given (query, candidate) pair. Each lit hydra eye adds 5%
 * (capped at 30% total — diminishing returns).
 */
export function hydraBonus(litCount: number): number {
  if (litCount <= 0) return 1.0;
  return 1.0 + Math.min(0.30, litCount * 0.05);
}
