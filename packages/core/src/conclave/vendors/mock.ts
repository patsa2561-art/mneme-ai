/**
 * v2.29.0 — Mock vendor adapter.
 *
 * Returns a DETERMINISTIC verdict derived from the claim text + a
 * stable seed. Used in tests and as the default when no real API key
 * is configured. Two mock vendors with different seeds simulate the
 * majority/minority shape so the BFT aggregator can be tested without
 * a network.
 */

import { createHash } from "node:crypto";
import type { VendorAdapter } from "./interface.js";
import type { VendorStance, VendorVerdict } from "../types.js";

function hashedDigit(s: string): number {
  const h = createHash("sha256").update(s).digest();
  return h[0]! / 256;
}

function deterministicStance(claim: string, vendorSeed: string): { stance: VendorStance; confidence: number } {
  // Claim-aware deterministic mock:
  //   - claims containing "REFUTE_ME" → refutes (used in unit tests)
  //   - claims containing "REFUSE_ME" → refuses
  //   - claims containing "UNCERTAIN_ME" → uncertain
  //   - otherwise: derived from sha256(claim+vendorSeed) — same input
  //     gives same output per (claim, vendor) pair
  if (/REFUTE_ME/.test(claim)) return { stance: "refutes", confidence: 0.95 };
  if (/REFUSE_ME/.test(claim)) return { stance: "refuses", confidence: 0.99 };
  if (/UNCERTAIN_ME/.test(claim)) return { stance: "uncertain", confidence: 0.4 };
  if (/SUPPORT_ME/.test(claim)) return { stance: "supports", confidence: 0.92 };
  const d = hashedDigit(claim + "|" + vendorSeed);
  if (d < 0.5) return { stance: "supports", confidence: 0.6 + d * 0.4 };
  if (d < 0.85) return { stance: "refutes", confidence: 0.6 + (d - 0.5) * 0.4 };
  return { stance: "uncertain", confidence: 0.4 + (d - 0.85) * 0.4 };
}

export function makeMockAdapter(vendorId: string): VendorAdapter {
  return {
    id: vendorId,
    available() { return true; },
    async run({ claim, variantId }): Promise<VendorVerdict> {
      const t0 = Date.now();
      const { stance, confidence } = deterministicStance(claim, vendorId);
      // Small simulated latency (proportional to deterministic hash so
      // tests stay reproducible).
      await new Promise((r) => setTimeout(r, Math.floor(hashedDigit(vendorId) * 20)));
      return {
        vendor: vendorId,
        variant: variantId,
        stance,
        confidence,
        reasoning: `[mock:${vendorId}] deterministic verdict for "${claim.slice(0, 60)}..." (variant=${variantId})`,
        dtMs: Date.now() - t0,
        rawSample: `STANCE: ${stance}\nCONFIDENCE: ${confidence.toFixed(2)}\nREASONING: mock deterministic`,
      };
    },
  };
}
