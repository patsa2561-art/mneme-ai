/**
 * v2.18.0 — MNEME ORACLE (the AI you can't sue Mneme for)
 *
 *   "Mneme issues a signed liability certificate for any AI-proposed
 *    change that passes AURELIAN AUDIT + SOUL gate + BUG PROPHET (risk
 *    < 0.20). The certificate caps Mneme's liability at the published
 *    coverage tier; corporates pay annual premium for higher tiers.
 *    Insurance + AI provenance in one primitive."
 *
 * Honest scope (what ORACLE IS):
 *   1. assessRisk — pure-function risk calculation over a proposed change
 *   2. issueCertificate — HMAC-signed liability certificate with cap +
 *      conditions + per-incident max
 *   3. verifyClaim — given an incident, does the certificate apply? what's
 *      the payout?
 *   4. tierPremium — annual premium calculator (defensible reference table)
 *
 * Honest scope (what ORACLE IS NOT):
 *   - Not real insurance — Mneme is not an insurance carrier; the data
 *     contract is what real insurers (Lloyd's syndicates, Munich Re) use
 *     to underwrite policies. ORACLE is the *trust primitive* that makes
 *     AI insurance pricing feasible.
 *   - Not a legal opinion. Real underwriting requires actuarial review.
 *   - Not unlimited — every certificate has a cap. Cheap tiers cap low.
 *
 * Composes onto v2.13 AURELIAN + v2.14 SOUL + v2.15.1 BUG PROPHET.
 * Pure orchestrator + signed receipt.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type CoverageTier = "starter" | "team" | "business" | "enterprise" | "sovereign";

export interface RiskInput {
  /** Free-form change description. */
  description: string;
  /** From v2.13 AURELIAN: composite axis score 0-100; >=80 = SHIP. */
  aurelianComposite?: number;
  /** From v2.14 PROJECT SOUL: verdict on the change. */
  soulVerdict?: "PASS" | "WARN" | "BLOCK";
  /** From v2.15.1 BUG PROPHET: regression risk 0-1. */
  bugProphetRisk?: number;
  /** From v2.14 BOUNTY: per-vendor measured falseRateLB. */
  vendorFalseRateLB?: number;
  /** Optional category — adjusts cap (financial change = stricter). */
  category?: "code" | "config" | "deploy" | "data" | "financial" | "infra" | "other";
}

export interface RiskAssessment {
  /** 0..1 — fused regression / liability risk. */
  riskScore: number;
  /** Human-readable label. */
  band: "very_low" | "low" | "medium" | "high" | "very_high";
  /** Reasons feeding into the score. */
  reasons: string[];
  /** Whether this change is eligible for an ORACLE certificate. */
  insurable: boolean;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = [];
  // Start with prophet risk if available; otherwise default skeptical 0.5
  let risk = input.bugProphetRisk ?? 0.5;
  if (input.bugProphetRisk !== undefined) reasons.push(`BUG PROPHET risk: ${(input.bugProphetRisk * 100).toFixed(0)}%`);

  // SOUL verdict has hard impact
  if (input.soulVerdict === "BLOCK") {
    risk = Math.max(risk, 0.85);
    reasons.push("PROJECT SOUL verdict: BLOCK");
  } else if (input.soulVerdict === "WARN") {
    risk += 0.10;
    reasons.push("PROJECT SOUL verdict: WARN (+0.10)");
  } else if (input.soulVerdict === "PASS") {
    risk -= 0.05;
    reasons.push("PROJECT SOUL verdict: PASS (-0.05)");
  }

  // AURELIAN: high composite reduces risk (well-graded change)
  if (input.aurelianComposite !== undefined) {
    const adj = (50 - input.aurelianComposite) / 200; // 80→-0.15, 50→0, 20→+0.15
    risk += adj;
    reasons.push(`AURELIAN composite ${input.aurelianComposite} → adj ${adj >= 0 ? "+" : ""}${adj.toFixed(2)}`);
  }

  // Vendor trust adjustment
  if (input.vendorFalseRateLB !== undefined && input.vendorFalseRateLB > 0.1) {
    risk += input.vendorFalseRateLB * 0.5;
    reasons.push(`Vendor falseRateLB ${input.vendorFalseRateLB} adds ${(input.vendorFalseRateLB * 0.5).toFixed(3)}`);
  }

  // Category multipliers
  const catMult: Record<NonNullable<RiskInput["category"]>, number> = {
    code: 1.0, config: 1.1, deploy: 1.2,
    data: 1.4, financial: 1.6, infra: 1.3, other: 1.0,
  };
  if (input.category) {
    const m = catMult[input.category];
    risk *= m;
    if (m !== 1) reasons.push(`Category ${input.category} multiplier ${m.toFixed(1)}×`);
  }

  risk = Math.max(0.01, Math.min(0.99, risk));

  let band: RiskAssessment["band"];
  if (risk < 0.10) band = "very_low";
  else if (risk < 0.25) band = "low";
  else if (risk < 0.50) band = "medium";
  else if (risk < 0.75) band = "high";
  else band = "very_high";

  // Insurable rule: risk must be < 0.50 AND SOUL must not be BLOCK
  const insurable = risk < 0.50 && input.soulVerdict !== "BLOCK";

  return {
    riskScore: Math.round(risk * 1000) / 1000,
    band, reasons, insurable,
  };
}

export interface CertificateInput {
  /** Subscriber identity (e.g., "acme-corp"). */
  subscriber: string;
  /** Coverage tier; determines premium + cap. */
  tier: CoverageTier;
  /** The change being insured. */
  change: RiskInput;
  /** Optional issuance time. */
  issuedAt?: string;
  /** Validity in days; defaults to 30 (per-change certs are short-lived). */
  validityDays?: number;
  secret?: string;
}

export interface LiabilityCertificate {
  v: typeof PROTOCOL_VERSION;
  certId: string;
  subscriber: string;
  tier: CoverageTier;
  /** Maximum payout for any single incident under this cert (USD). */
  perIncidentCapUsd: number;
  /** Aggregate cap across all certs in the policy year (USD). */
  annualAggregateCapUsd: number;
  /** Risk assessment that authorised the cert. */
  risk: RiskAssessment;
  /** Issuance / expiry. */
  issuedAt: string;
  validUntil: string;
  /** Conditions that void the cert if breached. */
  conditions: string[];
  /** HMAC over the canonical body. */
  sig: string;
}

const TIER_LIMITS: Record<CoverageTier, { perIncident: number; annualAggregate: number; annualPremium: number }> = {
  starter:    { perIncident:    1_000, annualAggregate:    10_000, annualPremium:   1_200 },
  team:       { perIncident:   10_000, annualAggregate:   100_000, annualPremium:   8_400 },
  business:   { perIncident:  100_000, annualAggregate: 1_000_000, annualPremium:  60_000 },
  enterprise: { perIncident: 1_000_000, annualAggregate:10_000_000, annualPremium: 480_000 },
  sovereign:  { perIncident:10_000_000, annualAggregate:100_000_000,annualPremium:3_600_000 },
};

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_ORACLE_SECRET"] || `mneme-oracle-liability-v${PROTOCOL_VERSION}`;
}

export function issueCertificate(input: CertificateInput): { issued: LiabilityCertificate | null; reason?: string } {
  const risk = assessRisk(input.change);
  if (!risk.insurable) {
    return { issued: null, reason: `not insurable: risk ${risk.riskScore} band=${risk.band}; reasons: ${risk.reasons.join("; ")}` };
  }
  const limits = TIER_LIMITS[input.tier];
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const validityDays = input.validityDays ?? 30;
  const validUntil = new Date(Date.parse(issuedAt) + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const certId = "lc-" + createHmac("sha256", "mneme-oracle-certid").update(`${input.subscriber}|${issuedAt}|${input.change.description}`).digest("hex").slice(0, 14);
  const conditions = [
    "Cert is void if PROJECT SOUL is mutated after issuance to remove a rule that would have BLOCKed this change.",
    "Cert is void if AI vendor used differs from the one whose falseRateLB underpinned the risk score.",
    "Cert is void if the change is shipped after validUntil.",
    "Per-incident payout requires Mneme-signed AURELIAN audit of the incident.",
    "Aggregate cap is shared across ALL certificates issued to the subscriber in the policy year.",
  ];
  const body: Omit<LiabilityCertificate, "sig"> = {
    v: PROTOCOL_VERSION,
    certId,
    subscriber: input.subscriber,
    tier: input.tier,
    perIncidentCapUsd: limits.perIncident,
    annualAggregateCapUsd: limits.annualAggregate,
    risk,
    issuedAt,
    validUntil,
    conditions,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { issued: { ...body, sig } };
}

export function verifyCertificate(cert: LiabilityCertificate, secret?: string): { ok: boolean; expired: boolean; reason?: string } {
  const { sig: claimed, ...body } = cert;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  let okSig = false;
  try { okSig = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { okSig = false; }
  if (!okSig) return { ok: false, expired: false, reason: "cert sig mismatch — forged or wrong key" };
  const expired = Date.now() > Date.parse(cert.validUntil);
  if (expired) return { ok: false, expired: true, reason: "cert expired" };
  return { ok: true, expired: false };
}

export interface ClaimInput {
  cert: LiabilityCertificate;
  /** Estimated incident loss in USD. */
  estimatedLossUsd: number;
  /** Brief description of what went wrong. */
  incidentDescription: string;
  /** Did any of the cert's conditions get violated? */
  conditionsBreached?: string[];
  /** Aggregate already paid out under the subscriber's policy year. */
  aggregatePaidYtdUsd?: number;
  secret?: string;
}

export interface ClaimDecision {
  v: typeof PROTOCOL_VERSION;
  certId: string;
  decision: "approved" | "partial" | "denied";
  payoutUsd: number;
  reasons: string[];
  decidedAt: string;
  sig: string;
}

export function decideClaim(input: ClaimInput): ClaimDecision {
  const reasons: string[] = [];
  let payoutUsd = 0;
  let decision: ClaimDecision["decision"] = "denied";

  // Verify cert first
  const v = verifyCertificate(input.cert, input.secret);
  if (!v.ok) {
    reasons.push(`certificate failed verification: ${v.reason}`);
  } else if (input.conditionsBreached && input.conditionsBreached.length > 0) {
    reasons.push(`conditions breached: ${input.conditionsBreached.join("; ")}`);
  } else {
    // Eligible — compute payout
    const perIncidentMax = input.cert.perIncidentCapUsd;
    const aggregateRemaining = input.cert.annualAggregateCapUsd - (input.aggregatePaidYtdUsd ?? 0);
    const eligible = Math.min(input.estimatedLossUsd, perIncidentMax, Math.max(0, aggregateRemaining));
    payoutUsd = eligible;
    if (eligible >= input.estimatedLossUsd) {
      decision = "approved";
      reasons.push(`approved at full estimated loss; per-incident cap not hit; aggregate remaining ${aggregateRemaining}.`);
    } else if (eligible > 0) {
      decision = "partial";
      reasons.push(`partial: estimated loss ${input.estimatedLossUsd} exceeds per-incident cap ${perIncidentMax} or aggregate remaining ${aggregateRemaining}.`);
    } else {
      decision = "denied";
      reasons.push(`aggregate cap exhausted for the policy year.`);
    }
  }

  const decidedAt = new Date().toISOString();
  const body = {
    v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
    certId: input.cert.certId, decision, payoutUsd, reasons, decidedAt,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function tierPremiumUsd(tier: CoverageTier): number {
  return TIER_LIMITS[tier].annualPremium;
}

export function formatOracleLine(c: LiabilityCertificate): string {
  return `ORACLE 🔬 · ${c.subscriber} · ${c.tier} · cap=$${c.perIncidentCapUsd.toLocaleString()}/incident · expires ${c.validUntil.slice(0, 10)}`;
}
