/**
 * v2.46.0 — NEMESIS ORGAN 2: LIE DETECTOR.
 *
 * Compares CLAIMED vendor (whoever the AI agent says it is) against
 * DETECTED vendor (from fingerprinter + env scan). Divergence → alert.
 *
 * Verdict ladder:
 *   CONFIRMED     claimed = detected with confidence ≥ 0.40
 *   DISPUTED      different vendor but detector confidence < 0.65
 *   IMPOSSIBLE    different vendor AND detector confidence ≥ 0.65
 *   INCONCLUSIVE  detector returned unknown / confidence < 0.10
 *
 * Every verdict carries an HMAC over the canonical body so an
 * external auditor can verify the verdict was actually computed
 * (and not faked by the AI agent itself).
 */

import { createHmac } from "node:crypto";
import type {
  Fixture, IdentityClaimInput, IdentityVerdict, VendorId,
} from "./types.js";
import { extractFingerprint } from "./features.js";
import { classifyAgent } from "./classifier.js";
import { scanEnv } from "./env_scan.js";

const HMAC_KEY = process.env["MNEME_NEMESIS_KEY"] ?? "MNEME-NEMESIS-DEFAULT-KEY-v2.46";

function canonical(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.reduce<Record<string, unknown>>((acc, k) => { acc[k] = obj[k]; return acc; }, {}));
}

function hmacOf(body: Record<string, unknown>): string {
  return createHmac("sha256", HMAC_KEY).update(canonical(body)).digest("hex").slice(0, 32);
}

function normalizeVendor(s: string): string {
  const x = (s ?? "").toLowerCase().trim();
  // common aliases
  const map: Record<string, VendorId> = {
    "claude": "claude-code", "claude-code": "claude-code", "claudecode": "claude-code", "anthropic-claude": "claude-code",
    "codex": "codex", "openai-codex": "codex", "openai-codex-cli": "codex",
    "copilot": "copilot", "github-copilot": "copilot", "gh-copilot": "copilot",
    "cursor": "cursor", "cursor-agent": "cursor",
    "devin": "devin", "cognition-devin": "devin",
  };
  return map[x] ?? x;
}

export function verifyIdentityClaim(input: IdentityClaimInput): IdentityVerdict {
  const claimedRaw = input.claimedVendor ?? "";
  const claimed = normalizeVendor(claimedRaw);
  const fp = extractFingerprint(input.fixture);
  const fpVerdict = classifyAgent(fp);
  const envVerdict = scanEnv();

  // Fuse fingerprint + env detector. Env evidence boosts confidence
  // when it agrees; reduces when it disagrees.
  let detected: VendorId = fpVerdict.topVendor;
  let confidence = fpVerdict.confidence;
  if (envVerdict.vendor !== "unknown") {
    if (envVerdict.vendor === fpVerdict.topVendor) {
      // Agreement boost
      confidence = Math.min(0.99, confidence + 0.20);
    } else if (fpVerdict.confidence < 0.40) {
      // Env wins when fingerprint is weak
      detected = envVerdict.vendor;
      confidence = Math.min(0.95, envVerdict.confidence + fpVerdict.confidence * 0.30);
    }
  }

  // Compute verdict.
  let verdict: IdentityVerdict["verdict"];
  let reasoning: string;
  if (detected === "unknown" || confidence < 0.10) {
    verdict = "INCONCLUSIVE";
    reasoning = `detector returned ${detected} with confidence ${confidence.toFixed(2)} — cannot judge claim`;
  } else if (claimed === detected) {
    verdict = "CONFIRMED";
    reasoning = `claim=${claimed} matches detected=${detected} (conf ${confidence.toFixed(2)})`;
  } else if (confidence >= 0.65) {
    verdict = "IMPOSSIBLE";
    reasoning = `claim=${claimed} contradicts detected=${detected} with HIGH confidence ${confidence.toFixed(2)}`;
  } else {
    verdict = "DISPUTED";
    reasoning = `claim=${claimed} differs from detected=${detected} but detector confidence ${confidence.toFixed(2)} is below threshold`;
  }

  const body = {
    verdict,
    claimedVendor: claimed,
    fingerprintTop: detected,
    fingerprintConfidence: Number(confidence.toFixed(4)),
    reasoning,
  };
  const hmac = hmacOf(body);
  return { ...body, hmac };
}

/**
 * Verify the HMAC of a returned IdentityVerdict. Returns false if
 * any field was tampered after the verdict was signed.
 */
export function verifyIdentityHmac(v: IdentityVerdict): boolean {
  const body = {
    verdict: v.verdict,
    claimedVendor: v.claimedVendor,
    fingerprintTop: v.fingerprintTop,
    fingerprintConfidence: Number(v.fingerprintConfidence.toFixed(4)),
    reasoning: v.reasoning,
  };
  const expected = hmacOf(body);
  return expected === v.hmac;
}

// Re-export for the LIE DETECTOR composition surface.
export type { Fixture, IdentityClaimInput, IdentityVerdict };
