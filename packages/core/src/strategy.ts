/**
 * v2.54.0 — STRATEGY primitive: turn the v2.53 audit's Tier-3 protocols +
 * pricing + RFC roadmap into a callable Mneme tool.
 *
 * Why ship strategy AS a primitive (not just a docs file): so AI agents
 * can introspect Mneme's roadmap + cite official text + verify pricing
 * tiers all in one place. Pure deterministic + defensive; never throws.
 */

export interface PricingTier {
  name: string;
  audience: string;
  price: string;
  benefits: string[];
  isFree: boolean;
}

export const PRICING_TIERS: ReadonlyArray<PricingTier> = [
  {
    name: "Free local",
    audience: "Solo dev / OSS",
    price: "$0",
    benefits: [
      "Full CLI surface (200+ tools)",
      "All NEMESIS / TRUTH GATE / PEAK GAUNTLET",
      "Local HMAC chains + verifyCliActivity",
      "MILLION DOLLAR SECRET DIAMONDS (6) — STEALTH / CAPILLARY / COLOSSEUM / MOLT / THEMIS / SIBYL",
    ],
    isFree: true,
  },
  {
    name: "Pro Federation",
    audience: "Small teams (≤25 dev)",
    price: "$20/mo/dev",
    benefits: [
      "Cross-machine handoff via NIMBUS federated mesh",
      "Private HGP federation",
      "Private COLOSSEUM with org-only leaderboard",
      "Priority bug-fix support window",
      "Cross-vendor session handoff (mneme.diaspora) over consented bridge",
    ],
    isFree: false,
  },
  {
    name: "Enterprise Compliance",
    audience: "Companies with EU AI Act exposure",
    price: "$50K/yr/org",
    benefits: [
      "GAVEL court-admissible bundle service",
      "AUDIT REPRODUCTION SUITE (v2.51) with custom claims",
      "SLA on TRUTH GATE probe library + dedicated probe authoring",
      "Quarterly compliance posture review",
      "LETHE GDPR forget primitive + retention policy automation",
    ],
    isFree: false,
  },
  {
    name: "Sovereign",
    audience: "Government / regulators",
    price: "$500K/yr",
    benefits: [
      "On-prem NIMBUS federation (no cloud dependency)",
      "Custom probe binding for sector-specific regulation",
      "Audit log forensics + chain-of-custody export",
      "Dedicated cryptographic key management (HSM integration)",
      "Direct line for Article 50 DPA inquiries",
    ],
    isFree: false,
  },
];

export interface RfcDraft {
  id: string;
  title: string;
  status: "draft" | "in-review" | "submitted" | "accepted" | "deferred";
  /** Standards body target. */
  targetBody: "W3C" | "ECMA" | "NIST" | "IETF" | "ISO" | "EU-DPA";
  abstract: string;
  /** One-line cite to the existing Mneme primitive this RFC distills. */
  builtOn: string;
  /** Plain-English motivation. */
  motivation: string;
  /** Earliest plausible target date for first review. */
  targetReviewYear: number;
  docPath?: string;
}

export const RFC_DRAFTS: ReadonlyArray<RfcDraft> = [
  {
    id: "RFC-001",
    title: "AI-Generated-Content Disclosure Block Format",
    status: "draft",
    targetBody: "W3C",
    abstract: "Defines a machine-parseable + HMAC-signed disclosure block to be embedded in commit messages, code comments, generated documents, and emitted artifacts. Enables EU AI Act Article 50 (Aug 2026) automated compliance.",
    builtOn: "Mneme NEMESIS ORGAN 3 — eu_ai_act_stamp.ts schema (regime / article / vendor / confidence / contentType / at / hmac fields with sentinel-bracketed body).",
    motivation: "EU AI Act Article 50 mandates disclosure but does not specify format. Without a standard, every vendor invents their own; auditors cannot cross-verify; users see noise. Mneme has shipped a working schema in production since v2.46 — propose it as the W3C standard.",
    targetReviewYear: 2026,
    docPath: "docs/rfc/RFC-001-disclosure-format.md",
  },
  {
    id: "RFC-002",
    title: "Cross-Vendor AI Session Handoff Protocol",
    status: "draft",
    targetBody: "ECMA",
    abstract: "Defines a portable, HMAC-signed session envelope ('soul prompt') that lets an in-progress AI session move between vendors (Claude → Cursor → Codex → Gemini) without context loss or vendor lock-in.",
    builtOn: "Mneme DIASPORA / GENESPLICE primitives (mneme.diaspora.session.capture + mneme.genesplice.soul-prompt) + SIBYL identity commitment for cross-vendor identity continuity.",
    motivation: "AI vendors today are silos. Users cannot continue a Claude conversation in Cursor without re-pasting context. A standard handoff protocol is a network-effects unlocker — and the user holds the data, not the vendor.",
    targetReviewYear: 2026,
    docPath: "docs/rfc/RFC-002-cross-vendor-handoff.md",
  },
  {
    id: "RFC-003",
    title: "Behavioural Fingerprint-Based Agent Identity Standard",
    status: "draft",
    targetBody: "NIST",
    abstract: "Defines a 41+ canonical behavioural feature set (extensible via CAPILLARY micro-tells) for deriving + verifying AI agent identity from output alone, without trusting the agent's self-declaration.",
    builtOn: "Mneme NEMESIS classifier (arxiv 2601.17406 features) + CAPILLARY 50+ micro-tells + JANUS cross-cluster boundary detection.",
    motivation: "AI vendors self-declare identity; downstream consumers have no way to verify. NEMESIS demonstrated 97.2% F1 identity verification from output alone (composed on academic feature set + Mneme's HMAC chain). NIST is the right body to canonise the feature set as a verification standard.",
    targetReviewYear: 2027,
    docPath: "docs/rfc/RFC-003-fingerprint-identity-standard.md",
  },
];

export interface StrategyReport {
  pricing: ReadonlyArray<PricingTier>;
  rfcDrafts: ReadonlyArray<RfcDraft>;
  rfcStatusCounts: Record<string, number>;
  pricingNote: string;
  at: string;
}

export function getStrategyReport(): StrategyReport {
  const rfcStatusCounts: Record<string, number> = {};
  for (const r of RFC_DRAFTS) rfcStatusCounts[r.status] = (rfcStatusCounts[r.status] ?? 0) + 1;
  return {
    pricing: PRICING_TIERS,
    rfcDrafts: RFC_DRAFTS,
    rfcStatusCounts,
    pricingNote: "Free local tier is the primary growth engine. Paid tiers fund full-time dev — bus-factor risk reduction from 1 → team.",
    at: new Date().toISOString(),
  };
}

export function renderPricingTable(): string {
  const rows = PRICING_TIERS.map((t) => `  - ${t.name.padEnd(22)} ${t.price.padEnd(14)} — ${t.audience}`);
  return ["PRICING TIERS:", ...rows].join("\n");
}

export function renderRfcIndex(): string {
  const rows = RFC_DRAFTS.map((r) => `  ${r.id} [${r.status}] → ${r.targetBody}: ${r.title}`);
  return ["RFC ROADMAP:", ...rows].join("\n");
}
