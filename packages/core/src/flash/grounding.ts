/**
 * v1.99.0 -- FLASH · Hyper-Contextual Grounding
 *
 * Detect that "Super rare" sitting on a product listing image is NOT a
 * verified rarity claim — it's marketing copy. The grounding step
 * extracts text from the user's input (image OCR result or pasted
 * caption), classifies the SOURCE CONTEXT, and assigns a source weight
 * that reflects the trust the AI agent should put in it.
 *
 * The user's exact case:
 *   image_4a1c54.jpg contains text "[Super rare] CAPCOM Capcom Character
 *   Trump Street Fighter Mega Man" plus "1,086.49 baht" plus
 *   "Buy Now on Buyee".
 *   Every vanilla AI: "yes it's rare" — because it pattern-matched the
 *   surface text. WRONG.
 *
 * FLASH grounding extracts:
 *   - rarity claims ("Super rare", "limited", "extremely rare")
 *   - commerce signals ("Buy Now", "shipping", "BHT", "$", "¥")
 *   - source context ("seller listing", "marketplace", "auction site")
 *   - third-party evidence absence
 * → classifies the whole frame as `seller-listing` source kind
 * → demotes source weight to 0.20 (per veracity.ts DEFAULT_SOURCE_WEIGHT)
 *
 * AI agent then runs computeVeracity with the demoted source weight and
 * the rarity claim gets correctly marked DOUBTFUL or REFUTE — not AFFIRM.
 *
 * Pure function. Deterministic. Offline-only (no external lookups).
 */

import type { EvidenceItem } from "./veracity.js";

const RARITY_CLAIM_PATTERNS = [
  /\b(super )?rare\b/i,
  /\bextremely rare\b/i,
  /\blimited edition\b/i,
  /\bone of a kind\b/i,
  /\bunique\b/i,
  /\bcollectible\b/i,
  /\boriginal\b/i,
  /\bauthentic\b/i,
  /\bmint condition\b/i,
  /\bvintage\b/i,
  /\bgrail\b/i,
];

const COMMERCE_SIGNALS = [
  /\bbuy now\b/i,
  /\bshipping\b/i,
  /\bauction\b/i,
  /\bprice\b/i,
  /\bbht\b/i,
  /\b฿/i,
  /[$€¥£]\s*\d/,
  /\d[\d,]*\.\d{2}\b/,           // 1,086.49
  /\bproduct description\b/i,
  /\bbuyee\b/i,
  /\bebay\b/i,
  /\bmercari\b/i,
  /\baliexpress\b/i,
  /\bamazon\b/i,
  /\b楽天\b/i,                    // Rakuten
  /\bヤフオク\b/i,                 // Yahoo Auctions JP
];

const THIRD_PARTY_PROOF_HINTS = [
  /\bauction record\b/i,
  /\bpopulation report\b/i,
  /\bgrading\b/i,
  /\bpsa\b/i,                    // PSA / Beckett grading
  /\bbgs\b/i,
  /\bcomptia\b/i,
  /\bmuseum\b/i,
  /\bcatalog\b/i,
  /\barchive\b/i,
];

export type SourceContext =
  | "seller-listing"             // commercial sale page, marketing copy
  | "auction-record"             // verified completed-sale data
  | "expert-review"              // third-party expert assessment
  | "primary-document"           // manufacturer / publisher document
  | "encyclopedia"               // wikipedia / reference DB
  | "user-statement"             // user's own claim, no source
  | "neutral-text";              // generic text with no commerce signal

export interface GroundingResult {
  /** Classified context for the input frame. */
  context: SourceContext;
  /** Suggested EvidenceItem.sourceKind to use downstream. */
  sourceKind: EvidenceItem["sourceKind"];
  /** Detected rarity claims (literal phrases). */
  rarityClaims: string[];
  /** Detected commerce signals (literal phrases). */
  commerceSignals: string[];
  /** Detected third-party verification signals. */
  thirdPartyProofs: string[];
  /** Suggested source weight for veracity.computeVeracity. */
  suggestedSourceWeight: number;
  /** Suggested hallucination factor add-on for veracity. */
  suggestedHallucinationAddOn: number;
  /** Why we classified it that way. */
  reason: string;
}

function findMatches(text: string, patterns: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** Classify the source context of free-form text (OCR result, caption,
 *  description) and produce a recommendation for veracity downstream. */
export function groundClaim(rawText: string): GroundingResult {
  const rarityClaims = findMatches(rawText, RARITY_CLAIM_PATTERNS);
  const commerceSignals = findMatches(rawText, COMMERCE_SIGNALS);
  const thirdPartyProofs = findMatches(rawText, THIRD_PARTY_PROOF_HINTS);

  let context: SourceContext;
  let reason: string;
  let suggestedSourceWeight: number;
  let suggestedHallucinationAddOn: number;

  if (thirdPartyProofs.length >= 2) {
    context = "expert-review";
    reason = `${thirdPartyProofs.length} third-party verification signals detected (${thirdPartyProofs.join(", ")})`;
    suggestedSourceWeight = 0.85;
    suggestedHallucinationAddOn = 0;
  } else if (commerceSignals.length >= 2) {
    context = "seller-listing";
    reason = `${commerceSignals.length} commerce signals (${commerceSignals.slice(0, 3).join(", ")}) — this is a sales page; treat rarity claims as marketing copy`;
    suggestedSourceWeight = 0.20;
    // Adding 2 to H = more skepticism for marketing-tier sources
    suggestedHallucinationAddOn = rarityClaims.length > 0 ? 2.0 : 1.0;
  } else if (rarityClaims.length > 0) {
    context = "user-statement";
    reason = `rarity claim "${rarityClaims[0]}" present but no commerce signals + no third-party proofs — caller's own assertion`;
    suggestedSourceWeight = 0.55;
    suggestedHallucinationAddOn = 1.0;
  } else {
    context = "neutral-text";
    reason = "no rarity claim, no commerce signal, no third-party proof";
    suggestedSourceWeight = 0.50;
    suggestedHallucinationAddOn = 0;
  }

  // Map to the canonical EvidenceItem sourceKind enum.
  // (Only the four cases actually produced by the classifier above are
  // handled here — tsc would flag dead cases otherwise. The other
  // SourceContext values are reserved for future classifiers.)
  let sourceKind: EvidenceItem["sourceKind"];
  if (context === "expert-review") sourceKind = "expert-database";
  else if (context === "seller-listing") sourceKind = "seller-listing";
  else if (context === "user-statement") sourceKind = "user-statement";
  else sourceKind = "unknown";

  return {
    context,
    sourceKind,
    rarityClaims,
    commerceSignals,
    thirdPartyProofs,
    suggestedSourceWeight,
    suggestedHallucinationAddOn,
    reason,
  };
}

/** One-line summary for the pulse. */
export function formatGroundingPulseLine(r: GroundingResult): string {
  return `GROUNDING · context=${r.context} · rarity=${r.rarityClaims.length} · commerce=${r.commerceSignals.length} · third-party=${r.thirdPartyProofs.length} · suggested-weight=${r.suggestedSourceWeight}`;
}
