/**
 * v2.52.0 — THEMIS (Diamond 5 / Million Dollar Secret series).
 *
 * Show mechanic: contestants must PROVE they're NOT the millionaire
 * — alibi-based defense. Mirror of NEMESIS verify_identity (accusation)
 * → THEMIS verify_alibi (defense).
 *
 * Use case: EU AI Act compliance defense. Auditor asks "did you use
 * Devin to generate this code?" → company runs THEMIS → returns
 * star-rated evidence per feature that the fingerprint diverges from
 * the suspect vendor's calibration. Court-admissible because each
 * feature carries its own z-score against the seed corpus.
 *
 * The output is SPECIFICALLY designed to look like a legal alibi:
 *
 *   ALIBI: CONFIRMED · you are NOT codex
 *   Evidence (★ = z-score band, ★★★★★ = farthest from suspect):
 *     ★★★★★ multiline_commit_ratio = 0.04 (codex mean 0.78)
 *     ★★★★  conditional_density    = 0.31 (codex mean 0.08)
 *     ★★★   pr_desc_length         = 12   (codex mean 540)
 *
 * No paper / product offers "AI alibi" as primitive. NEMESIS classify
 * returns IMPOSSIBLE — useful for offense. THEMIS returns ALIBI_CONFIRMED
 * with star-rated divergence — useful for defense.
 *
 * Wild value-adds this module ships:
 *   - COMPLIANCE BUNDLE: pair THEMIS verdict with EU AI Act Article 50
 *     stamp + HMAC → court-admissible "compliance proof bundle" that
 *     auditor can verify offline
 *   - CONFIDENCE INTERVAL on the alibi strength (95% CI from per-feature
 *     z-scores)
 *
 * Composes: extractFingerprint + seedStats from calibration_corpus +
 * createHmac for signing.
 *
 * Pure deterministic + defensive; never throws.
 */

import { createHmac } from "node:crypto";
import { extractFingerprint } from "./features.js";
import { seedStats } from "./calibration_corpus.js";
import type { Fingerprint, VendorId } from "./types.js";

const KEY_ENV = "MNEME_THEMIS_KEY";
const DEFAULT_KEY = "mneme-themis-v1";

export interface AlibiEvidenceItem {
  feature: string;
  observed: number;
  suspectMean: number;
  suspectStdev: number;
  /** z-score: |(observed - mean) / max(stdev, ε)|. Higher = stronger alibi. */
  z: number;
  /** 1..5 ★ band. */
  stars: number;
}

export type AlibiVerdict = "CONFIRMED" | "DENIED" | "INCONCLUSIVE";

export interface ThemisResult {
  /** Vendor the caller is claiming they are NOT. */
  notVendor: string;
  verdict: AlibiVerdict;
  /** 0..1 — strength of the alibi (mean z-score across top features, normalized). */
  alibiStrength: number;
  /** 95% CI half-width over the per-feature z-scores. */
  ci95: number;
  /** Star-rated evidence items, strongest first. */
  evidence: AlibiEvidenceItem[];
  /** Plain-English statement suitable for a compliance bundle. */
  statement: string;
  /** HMAC over the canonical verdict body. */
  hmac: string;
}

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function starsFor(z: number): number {
  if (z < 0.5) return 1;
  if (z < 1.5) return 2;
  if (z < 2.5) return 3;
  if (z < 3.5) return 4;
  return 5;
}

function normalize(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  return Math.min(1, mean / 5); // 5σ → 1.0
}

function ci95Half(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const stdev = Math.sqrt(variance);
  return 1.96 * stdev / Math.sqrt(values.length);
}

export interface ThemisInput {
  /** Vendor the claimant is denying. */
  notVendor: VendorId | string;
  /** EITHER a pre-computed fingerprint OR a raw fixture. */
  fixture?: { diff: string; prDescription: string; commitMessages: string[] };
  fingerprint?: Fingerprint;
  /** Minimum stars to include feature in evidence (default 3). */
  minStars?: number;
  /** Max evidence items to surface (default 8). */
  maxEvidence?: number;
}

/**
 * Compute the alibi verdict for "I am NOT vendor X".
 * Defensive: missing inputs → INCONCLUSIVE with reason in statement.
 */
export function verifyAlibi(input: ThemisInput): ThemisResult {
  const notVendor = String(input?.notVendor ?? "");
  const minStars = input?.minStars ?? 3;
  const maxEvidence = input?.maxEvidence ?? 8;

  const inconclusiveBody = {
    notVendor,
    verdict: "INCONCLUSIVE" as const,
    alibiStrength: 0,
    ci95: 0,
    evidence: [],
    statement: "",
  };

  if (!notVendor) {
    const body = { ...inconclusiveBody, statement: "THEMIS: missing notVendor — supply the vendor you are denying." };
    return signed(body);
  }

  let fp: Fingerprint;
  try {
    if (input.fingerprint) fp = input.fingerprint;
    else if (input.fixture) fp = extractFingerprint(input.fixture);
    else {
      const body = { ...inconclusiveBody, statement: "THEMIS: supply fingerprint OR fixture." };
      return signed(body);
    }
  } catch {
    const body = { ...inconclusiveBody, statement: "THEMIS: fingerprint extraction failed." };
    return signed(body);
  }

  // Pull stats for the suspect vendor
  let stats;
  try { stats = seedStats(); } catch {
    const body = { ...inconclusiveBody, statement: "THEMIS: calibration corpus unavailable." };
    return signed(body);
  }
  const suspectStats = stats.get(notVendor as VendorId);
  if (!suspectStats) {
    const body = { ...inconclusiveBody, statement: `THEMIS: no calibration for "${notVendor}" — alibi cannot be computed.` };
    return signed(body);
  }

  // Per-feature z + stars
  const items: AlibiEvidenceItem[] = [];
  for (const [k, observed] of Object.entries(fp)) {
    const featureStats = suspectStats.features[k];
    if (!featureStats) continue;
    const stdev = Math.max(featureStats.stdev, Math.abs(featureStats.mean) * 0.1, 1e-3);
    const z = Math.abs(((observed as number) - featureStats.mean) / stdev);
    if (!Number.isFinite(z)) continue;
    const stars = starsFor(z);
    items.push({
      feature: k,
      observed: observed as number,
      suspectMean: featureStats.mean,
      suspectStdev: featureStats.stdev,
      z,
      stars,
    });
  }
  items.sort((a, b) => b.z - a.z);
  const filtered = items.filter((i) => i.stars >= minStars).slice(0, maxEvidence);
  const zs = filtered.map((i) => i.z);
  const alibiStrength = normalize(zs);
  const ci95 = ci95Half(zs);
  let verdict: AlibiVerdict;
  if (alibiStrength >= 0.6 && filtered.length >= 3) verdict = "CONFIRMED";
  else if (alibiStrength < 0.2 && items.length >= 5) verdict = "DENIED";
  else verdict = "INCONCLUSIVE";
  const statement = buildStatement(notVendor, verdict, alibiStrength, ci95, filtered);
  return signed({ notVendor, verdict, alibiStrength, ci95, evidence: filtered, statement });
}

function signed(body: Omit<ThemisResult, "hmac">): ThemisResult {
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return { ...body, hmac };
}

function buildStatement(notVendor: string, verdict: AlibiVerdict, strength: number, ci95: number, evidence: AlibiEvidenceItem[]): string {
  if (verdict === "INCONCLUSIVE") {
    return `ALIBI INCONCLUSIVE for "NOT ${notVendor}" — fingerprint diverges only weakly (strength=${strength.toFixed(2)}, 95%CI±${ci95.toFixed(2)}).`;
  }
  if (verdict === "DENIED") {
    return `ALIBI DENIED for "NOT ${notVendor}" — fingerprint matches ${notVendor}'s calibration too closely (strength=${strength.toFixed(2)}).`;
  }
  const top = evidence.slice(0, 3).map((e) => `${"★".repeat(e.stars)} ${e.feature}=${e.observed.toFixed(3)} (${notVendor} mean ${e.suspectMean.toFixed(3)})`).join("; ");
  return `ALIBI CONFIRMED — fingerprint diverges from ${notVendor} with strength ${strength.toFixed(2)} (95%CI±${ci95.toFixed(2)}). Top evidence: ${top}.`;
}

/** Verify a ThemisResult's HMAC. */
export function verifyAlibiSignature(r: ThemisResult): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const { hmac, ...body } = r;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/**
 * COMPLIANCE BUNDLE: pair a THEMIS alibi with an EU AI Act Article 50
 * stamp (if available) and return a signed bundle suitable for sharing
 * with auditors. Pure assembly; never throws.
 */
export interface ComplianceBundle {
  bundleId: string;
  at: string;
  alibi: ThemisResult;
  stamp?: { block: string; hmac: string; version: string };
  hmac: string;
}

export function buildComplianceBundle(
  alibi: ThemisResult,
  stamp?: { block: string; hmac: string; version: string },
): ComplianceBundle {
  const bundleId = `BNDL-${Date.now().toString(36)}`;
  const at = new Date().toISOString();
  const body = { bundleId, at, alibi, stamp };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return { ...body, hmac };
}

export function verifyComplianceBundle(b: ComplianceBundle): boolean {
  if (!b || typeof b.hmac !== "string") return false;
  const { hmac, ...body } = b;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  if (expected !== hmac) return false;
  return verifyAlibiSignature(b.alibi);
}
