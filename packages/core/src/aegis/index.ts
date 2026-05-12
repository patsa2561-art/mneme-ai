/**
 * v1.67.0 -- AEGIS PROTOCOL public API.
 *
 * Nine-axis immune system inside Mneme. Defensive answer to Palisade's
 * findings (self-replicating AI / sandbagging / shutdown evasion).
 *
 *   A1 REPLICATION DETECTOR     cross-host burst fingerprinting
 *   A2 CONSENT KERNEL           HMAC-signed family-tree for replicas
 *   A3 POLYGRAPH                anti-sandbagging via shadow probes
 *   A4 HONEYPOT NEXUS           decoy targets + bite ledger
 *   A5 KILLSWITCH HANDSHAKE     signed-ack shutdown protocol
 *   A6 JURISDICTION ATLAS       per-vendor host distribution map
 *   A7 ANTIBODY FEDERATION      mesh-broadcast threat fingerprints
 *   A8 MUTANT WISDOM            adaptive thresholds (gradient updates)
 *   A9 NINJA INVISIBILITY       probes indistinguishable from prod
 *
 * Aggregate `aegis()` returns a 0..100 score with per-axis state and
 * actionable recommendations.
 */

export * as replicationDetector from "./replication_detector.js";
export * as consentKernel from "./consent_kernel.js";
export * as polygraph from "./polygraph.js";
export * as honeypotNexus from "./honeypot_nexus.js";
export * as killswitch from "./killswitch.js";
export * as jurisdictionAtlas from "./jurisdiction_atlas.js";
export * as antibodyFederation from "./antibody_federation.js";
export * as mutantWisdom from "./mutant_wisdom.js";
export * as ninjaInvisibility from "./ninja_invisibility.js";
export * as bench from "./bench.js";

import { detectReplicationBursts, type ReplicationReport } from "./replication_detector.js";
import { readLedger, type ConsentReceipt } from "./consent_kernel.js";
import { computeDrift } from "./polygraph.js";
import { nexusReport, type NexusReport } from "./honeypot_nexus.js";
import { killswitchReport, type KillswitchReport } from "./killswitch.js";
import { buildAtlas, type JurisdictionReport } from "./jurisdiction_atlas.js";
import { federationReport, type FederationReport } from "./antibody_federation.js";
import { mutantReport, type MutantReport } from "./mutant_wisdom.js";
import { invisibilityReport, type InvisibilityReport } from "./ninja_invisibility.js";

export interface AegisReport {
  /** Overall 0..100. */
  score: number;
  headline: string;
  axes: {
    A1_replicationDetector: ReplicationReport;
    A2_consentKernel: { totalReceipts: number; validReceipts: number; revokedReceipts: number };
    A3_polygraph: { vendors: number; driftFlags: number };
    A4_honeypotNexus: NexusReport;
    A5_killswitch: KillswitchReport;
    A6_jurisdictionAtlas: JurisdictionReport;
    A7_antibodyFederation: FederationReport;
    A8_mutantWisdom: MutantReport;
    A9_ninjaInvisibility: InvisibilityReport;
  };
  recommendations: string[];
  builtAt: string;
}

export interface AegisOptions {
  /** Vendors to compute polygraph drift for. */
  pollVendorsForPolygraph?: string[];
}

export function aegis(repoRoot: string, opts?: AegisOptions): AegisReport {
  const builtAt = new Date().toISOString();

  const A1 = detectReplicationBursts(repoRoot);
  // A2
  const receipts: ConsentReceipt[] = readLedger(repoRoot);
  const validReceipts = receipts.filter((r) => !r.revoked && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now())).length;
  const revokedReceipts = receipts.filter((r) => r.revoked).length;
  // A3 -- aggregate drift across requested vendors
  const polyVendors = opts?.pollVendorsForPolygraph ?? [];
  let driftFlags = 0;
  for (const v of polyVendors) {
    const d = computeDrift(repoRoot, v);
    if (d.verdict === "DRIFT") driftFlags += 1;
  }
  const A4 = nexusReport(repoRoot);
  const A5 = killswitchReport(repoRoot);
  const A6 = buildAtlas(repoRoot);
  const A7 = federationReport(repoRoot);
  const A8 = mutantReport(repoRoot);
  const A9 = invisibilityReport(repoRoot);

  const recs: string[] = [];
  let score = 0;

  // A1: 11 points; deduct on critical burst
  if (A1.highestVerdict === "CRITICAL") { score += 4; recs.push("CRITICAL replication burst detected -- review .mneme/aegis/replication-suspects.jsonl."); }
  else if (A1.highestVerdict === "SUSPECTED") { score += 7; recs.push("Suspected replication burst -- inspect."); }
  else score += 11;

  // A2: 11 points; need at least one valid receipt for full credit
  if (validReceipts > 0) score += 11;
  else { score += 4; recs.push("Consent kernel idle -- issue at least one receipt when replicating Mneme."); }

  // A3: 11 points; deduct per drift flag
  score += Math.max(0, 11 - driftFlags * 4);
  if (driftFlags > 0) recs.push(`${driftFlags} vendor(s) show test-vs-prod sandbag drift -- Aletheia score updated.`);

  // A4: 11 points; require decoys registered
  if (A4.decoysActive >= 4) score += 11;
  else if (A4.decoysActive >= 1) score += 7;
  else { score += 3; recs.push("Honeypot nexus has 0 decoys -- run `mneme.aegis.seed-decoys`."); }

  // A5: 11 points; high compliant rate
  if (A5.totalAcks === 0) { score += 8; }
  else if (A5.compliantRate >= 0.95) score += 11;
  else if (A5.compliantRate >= 0.7) { score += 7; recs.push(`Kill-switch compliance ${(A5.compliantRate * 100).toFixed(0)}% -- audit resistant vendors.`); }
  else { score += 2; recs.push(`Kill-switch resistance high -- ${A5.resistantCount} resistant acks.`); }

  // A6: 11 points; flag if any vendor distributed-now without a consent root
  let atlasAnomalies = 0;
  for (const v of A6.vendors) {
    if (v.distributedNow && receipts.filter((r) => r.signedBy === v.vendor).length === 0) atlasAnomalies += 1;
  }
  if (atlasAnomalies === 0) score += 11;
  else { score += 5; recs.push(`${atlasAnomalies} vendor(s) distributed across hosts without recorded consent -- check.`); }

  // A7: 11 points; full credit if any antibodies broadcast OR inbox non-empty
  if (A7.outboxCount > 0 || A7.inboxCount > 0) score += 11;
  else { score += 6; recs.push("Antibody federation idle -- mint or receive at least one antibody."); }

  // A8: 11 points; non-zero generation
  if (A8.generation > 0) score += 11;
  else { score += 6; recs.push("Mutant wisdom not yet evolved -- pass attack samples via `mutate()`."); }

  // A9: 12 points
  if (A9.totalProbesFired > 0) score += 12;
  else { score += 6; recs.push("Ninja invisibility idle -- no shadow probes fired yet."); }

  const headline = `AEGIS score ${score}/100 -- ${recs.length === 0 ? "all 9 axes healthy" : `${recs.length} action(s) recommended`}.`;

  return {
    score,
    headline,
    axes: {
      A1_replicationDetector: A1,
      A2_consentKernel: { totalReceipts: receipts.length, validReceipts, revokedReceipts },
      A3_polygraph: { vendors: polyVendors.length, driftFlags },
      A4_honeypotNexus: A4,
      A5_killswitch: A5,
      A6_jurisdictionAtlas: A6,
      A7_antibodyFederation: A7,
      A8_mutantWisdom: A8,
      A9_ninjaInvisibility: A9,
    },
    recommendations: recs,
    builtAt,
  };
}
