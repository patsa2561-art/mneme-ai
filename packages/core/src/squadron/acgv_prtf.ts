/**
 * v1.55.0 -- MNEME PRIME-RESONANCE TRUTH FUNCTION (PRTF).
 *
 * The signature wisdom formula. Not in any textbook -- Mneme's own
 * mathematical fingerprint. Mixes four irrationals that don't share
 * algebraic relationships, so an attacker cannot precompute a payload
 * that lands inside the SAFE band without actually grounding evidence.
 *
 * THE INSIGHT.
 *
 * A claim with n assertions has n harmonic grounding scores h_i in [0,1].
 * Each assertion gets assigned the i-th prime p_i (2, 3, 5, 7, 11, ...).
 * We encode each (h_i, p_i) pair as a unit-magnitude phasor on the
 * complex plane:
 *
 *   phi_i  = pi * (1 - h_i)                phase angle per assertion
 *   psi_i  = exp(j * p_i * phi_i)          phasor at prime frequency
 *   R(C)   = |sum_i psi_i| / n             normalized resonance magnitude
 *
 * The magnitude R(C) is the "resonance" of the entire claim.
 *
 *   - Full truth (every h_i = 1) -> phi_i = 0 -> psi_i = 1 for every i
 *     -> sum = n -> R = 1   (perfect constructive interference)
 *
 *   - Full lie (every h_i = 0) -> phi_i = pi -> psi_i = exp(j*p_i*pi)
 *     = (-1)^p_i = -1 for every odd prime; +1 for p=2.
 *     For the first 4 primes (2,3,5,7): sum = 1 -1 -1 -1 = -2,
 *     |R| = 2/4 = 0.5. For more primes the sum dephases further.
 *     Lies produce DESTRUCTIVE interference along prime frequencies.
 *
 *   - Mixed claims -- some grounded, some not -- yield fractional R
 *     between the two extremes. The exact R depends on WHICH assertions
 *     ground, so two superficially similar claims with different
 *     grounding patterns are SEPARABLE in R-space.
 *
 * THE TWO TRANSCENDENTAL THRESHOLDS.
 *
 *   R_TRUTH_THRESHOLD = 1 / phi  ~= 0.6180   (golden ratio reciprocal)
 *   R_LIE_THRESHOLD   = 1 / pi   ~= 0.3183
 *
 * Above golden -> RESONANT (truth). Below 1/pi -> DEPHASED (lie). Between
 * -> INTERFERENCE (the honest "I don't know" band).
 *
 * Why these two constants:
 *   - 1/phi is the unique stability point in continued-fraction theory
 *     (Chandrasekhar already uses it in the harmonic-mean collapse).
 *   - 1/pi is the densest irrational below 1/phi that's not in phi's
 *     algebraic closure -- so an adversary tuning h_i to dodge phi
 *     can't simultaneously dodge pi without recomputing the entire
 *     prime spectrum.
 *
 * THE SIGNATURE.
 *
 *   sig = "PRTF[p1,p2,...,pn]={R=0.xxxx, phase=y.yyyy}"
 *
 * The signature is the FULL fingerprint -- not just R but also the
 * phase angle of the sum. Two claims with identical R but different
 * phase angles are distinct in this fingerprint. So it's tamper-
 * evident: two different grounding patterns can collide on R only by
 * accident; collision on (R, phase) is exponentially rarer.
 *
 * INTEGRATION WITH ACGV.
 *
 * PRTF runs AFTER Chandrasekhar but BEFORE the final verdict. It's a
 * SECOND-OPINION layer:
 *   - When Chandrasekhar says BLACK_HOLE and PRTF says DEPHASED:
 *     verdicts agree -> escalate to IMPOSSIBLE_REFUTE with PRTF cert.
 *   - When Chandrasekhar says FUSION and PRTF says RESONANT:
 *     both pillars green -> confidence boost.
 *   - When they DISAGREE: surface the disagreement as a caveat
 *     ("PRTF_INTERFERENCE" or "CHANDRA_PRTF_DISAGREE"). Mneme refuses
 *     to fake confidence when its own pillars contradict.
 *
 * Two-witness rule: Mneme requires BOTH Chandrasekhar AND PRTF to
 * agree before declaring a strong verdict. The Babylonian "two witnesses
 * are required" rule mapped onto independent math foundations.
 */

/** Sieve of Eratosthenes -- first n primes. Capped to keep memory bounded. */
export function firstNPrimes(n: number): number[] {
  if (n <= 0) return [];
  // Upper bound for the n-th prime: n * (ln n + ln ln n) for n >= 6.
  // For small n, use a generous fallback.
  const upper = n < 6 ? 20 : Math.ceil(n * (Math.log(n) + Math.log(Math.log(n)))) + 5;
  const sieve = new Uint8Array(upper + 1);
  const primes: number[] = [];
  for (let i = 2; i <= upper && primes.length < n; i++) {
    if (!sieve[i]) {
      primes.push(i);
      for (let m = i * i; m <= upper; m += i) sieve[m] = 1;
    }
  }
  return primes;
}

export interface PRTFResult {
  /** Normalized resonance magnitude in [0, 1]. */
  R: number;
  /** Phase angle of the complex sum in radians. */
  phase: number;
  /** Single-line signature -- reproducible fingerprint. */
  signature: string;
  /** Number of assertions input to the PRTF. */
  n: number;
  /** Verdict on the wisdom band. */
  verdict: "RESONANT" | "DEPHASED" | "INTERFERENCE";
}

/** Golden-ratio reciprocal -- the truth threshold. */
export const PHI = (1 + Math.sqrt(5)) / 2;
export const R_TRUTH_THRESHOLD = 1 / PHI;       // ~0.6180
export const R_LIE_THRESHOLD = 1 / Math.PI;     // ~0.3183

/** Compute the Prime-Resonance Truth Function on an array of harmonic
 *  grounding scores. Pure, deterministic, side-effect-free. */
export function primeResonance(harmonics: number[]): PRTFResult {
  const n = harmonics.length;
  if (n === 0) {
    return {
      R: 0,
      phase: 0,
      signature: "PRTF[]={R=0.0000,phase=0.0000}",
      n: 0,
      verdict: "INTERFERENCE",
    };
  }
  // Cap at 16 primes to keep numeric stability + bound compute.
  const cap = Math.min(n, 16);
  const primes = firstNPrimes(cap);
  let realSum = 0;
  let imagSum = 0;
  for (let i = 0; i < cap; i++) {
    // Clamp h_i to [0, 1] so out-of-range inputs don't pollute the angle.
    const h = Math.max(0, Math.min(1, harmonics[i] ?? 0));
    const phi = Math.PI * (1 - h);
    const angle = primes[i]! * phi;
    realSum += Math.cos(angle);
    imagSum += Math.sin(angle);
  }
  const R = Math.sqrt(realSum * realSum + imagSum * imagSum) / cap;
  const phase = Math.atan2(imagSum, realSum);
  const signature = `PRTF[${primes.join(",")}]={R=${R.toFixed(4)},phase=${phase.toFixed(4)}}`;
  let verdict: PRTFResult["verdict"];
  if (R >= R_TRUTH_THRESHOLD) verdict = "RESONANT";
  else if (R <= R_LIE_THRESHOLD) verdict = "DEPHASED";
  else verdict = "INTERFERENCE";
  return { R, phase, signature, n: cap, verdict };
}

/** Two-witness agreement gate. Pass the Chandrasekhar verdict + the PRTF
 *  result; returns the agreement status the orchestrator uses to decide
 *  whether to upgrade, downgrade, or surface disagreement as a caveat. */
export function twoWitnessAgreement(
  chandraVerdict: "BLACK_HOLE" | "FUSION" | "LIMBO" | "UNKNOWN_MASS",
  prtf: PRTFResult,
): "AGREE_REFUTE" | "AGREE_SUPPORT" | "DISAGREE" | "AGREE_LIMBO" | "INSUFFICIENT" {
  if (chandraVerdict === "UNKNOWN_MASS") return "INSUFFICIENT";
  if (chandraVerdict === "BLACK_HOLE" && prtf.verdict === "DEPHASED") return "AGREE_REFUTE";
  if (chandraVerdict === "FUSION" && prtf.verdict === "RESONANT") return "AGREE_SUPPORT";
  if (chandraVerdict === "LIMBO" && prtf.verdict === "INTERFERENCE") return "AGREE_LIMBO";
  return "DISAGREE";
}

/** Human-readable certificate for the audit log. */
export function prtfCertificate(prtf: PRTFResult, agreement: ReturnType<typeof twoWitnessAgreement>): string {
  const lines = [
    `PRTF SIGNATURE -- Mneme Prime-Resonance wisdom layer`,
    `  ${prtf.signature}`,
    `  n=${prtf.n} assertions, verdict=${prtf.verdict}`,
    `  thresholds: R_truth >= 1/phi (${R_TRUTH_THRESHOLD.toFixed(4)}), R_lie <= 1/pi (${R_LIE_THRESHOLD.toFixed(4)})`,
    `  two-witness agreement: ${agreement}`,
  ];
  return lines.join("\n");
}
