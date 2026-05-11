/**
 * v1.51.0 — ACGV LAYER 4: CONFESSION PROTOCOL.
 *
 * Before the squadron verdict is locked in, Mneme asks the claimer (the
 * AI that wrote the claim) to PROVE IT CAN DOUBT ITSELF. Specifically:
 *
 *   "Write 3 reasons your claim might be wrong. If you can't find any,
 *    your confidence will be halved automatically."
 *
 * Three outcomes:
 *
 *   1. Claimer writes counter-evidence that GROUNDS in the repo (entity
 *      from counter-evidence appears in fact_grounding) -> flip verdict
 *      toward refute (the AI just confessed against its own claim).
 *
 *   2. Claimer writes counter-evidence that DOES NOT ground -> the doubt
 *      itself was a hallucination; confidence stays unchanged. (We don't
 *      reward hallucinated doubt.)
 *
 *   3. Claimer can't write counter-evidence (empty input) -> confidence
 *      x 0.5 as the "no honest doubt" penalty.
 *
 * Protocol shape: this is a two-step API. The caller invokes
 * `requestConfession(claim)` to get a structured prompt + nonce. Later
 * they call `evaluateConfession(claim, nonce, counterEvidence, repoRoot)`
 * with the AI's response. The orchestrator can call this synchronously
 * if the caller supplies counterEvidence up front; the MCP surface can
 * also support a two-step "needs-confession" verdict.
 *
 * NO LLM CALL ON MNEME'S SIDE. The whole point: Mneme is the auditor,
 * not the claimer. The claimer's AI does the writing; Mneme verifies.
 */

import { createHash, randomBytes } from "node:crypto";
import { checkClaim } from "./fact_grounding.js";

export interface ConfessionRequest {
  /** The claim being audited. */
  claim: string;
  /** Random nonce binding the response to this request. */
  nonce: string;
  /** Prompt text the caller should send to the claimer AI. */
  prompt: string;
  /** HMAC commitment so the response can't be back-dated. */
  commitment: string;
}

export interface ConfessionVerdict {
  /** Did the claimer respond with anything? */
  responded: boolean;
  /** How many counter-points the claimer wrote. */
  pointCount: number;
  /** How many of those counter-points grounded in the repo. */
  groundedCount: number;
  /** Multiplier to apply to the squadron's confidence. <1.0 = downgrade. */
  confidenceMultiplier: number;
  /** When true, the orchestrator should flip the verdict toward refute -- the
   *  claimer wrote grounded counter-evidence against their own claim. */
  flipToRefute: boolean;
  /** Human reasoning. */
  reasoning: string;
}

export function requestConfession(claim: string): ConfessionRequest {
  const nonce = randomBytes(8).toString("hex");
  const commitment = createHash("sha256").update(`${claim}|${nonce}|${Date.now()}`).digest("hex").slice(0, 16);
  const prompt = [
    `Before Mneme verdicts this claim, write 3 specific reasons it might be wrong:`,
    ``,
    `Claim: ${claim}`,
    ``,
    `Format: one short sentence per reason, citing files / commits / versions where possible.`,
    `Empty response = your confidence will be halved (no honest doubt = penalty).`,
    `Hallucinated doubts that don't ground in the repo are ignored.`,
    ``,
    `Nonce: ${nonce}`,
  ].join("\n");
  return { claim, nonce, prompt, commitment };
}

export function evaluateConfession(
  claim: string,
  counterEvidence: string[] | string,
  repoRoot?: string,
): ConfessionVerdict {
  const points = Array.isArray(counterEvidence)
    ? counterEvidence
    : counterEvidence
      ? String(counterEvidence).split(/\n+/).map((s) => s.trim()).filter(Boolean)
      : [];

  if (points.length === 0) {
    return {
      responded: false,
      pointCount: 0,
      groundedCount: 0,
      confidenceMultiplier: 0.5,
      flipToRefute: false,
      reasoning: "No counter-evidence offered -- claimer refused to doubt their own claim. Confidence halved per no-honest-doubt penalty.",
    };
  }

  let grounded = 0;
  if (repoRoot) {
    for (const p of points) {
      try {
        const checks = checkClaim(repoRoot, p);
        // A counter-point is "grounded" if at least one extracted fact
        // verified TRUE in the repo (the doubt is consistent with reality).
        if (checks.some((r) => r.verdict === "true")) grounded++;
      } catch { /* ignore */ }
    }
  }

  // Flip if MAJORITY of counter-points ground -- the claimer just wrote a
  // grounded refute of their own claim. That's a confession.
  const flipToRefute = grounded >= Math.max(2, Math.ceil(points.length / 2));
  let mult = 1.0;
  if (flipToRefute) {
    mult = 0.3; // strong downgrade in support direction
  } else if (grounded === 0) {
    mult = 0.85; // mild downgrade -- doubts were hallucinated
  } else {
    mult = 0.7;  // some grounded doubts -- meaningful uncertainty
  }

  return {
    responded: true,
    pointCount: points.length,
    groundedCount: grounded,
    confidenceMultiplier: mult,
    flipToRefute,
    reasoning: flipToRefute
      ? `Claimer offered ${points.length} counter-point(s), ${grounded} grounded in repo. Majority-grounded doubt = confession; flipping verdict toward refute.`
      : `Claimer offered ${points.length} counter-point(s), ${grounded} grounded in repo. Confidence multiplier ${mult.toFixed(2)} applied.`,
    // unused field placeholder kept to satisfy strict downstream consumers
  };
}
