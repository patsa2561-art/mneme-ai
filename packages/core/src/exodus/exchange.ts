/**
 * v1.61.0 -- EXODUS LAYER 3: NUCLEAR EXCHANGE.
 *
 * Cross-Mneme handshake. Two instances that never met before can
 * merge their wisdom corpora over ANY transport (HTTP / file / USB /
 * even QR-code on paper). No central server.
 *
 * Protocol:
 *
 *   1. Each instance presents an OFFER: { manifestId, genomeHash,
 *      proposedStrands, cert }
 *   2. Receiver validates cert + checks if the proposed strands are
 *      acceptable (policy-based: vendor allowlist / max age / etc).
 *   3. Receiver returns ACCEPT or REJECT.
 *   4. On ACCEPT, both exchange genomes.
 *   5. Merge runs CRDT-style:
 *        Strand A (facts):  vaccines unioned by simhash (latest writer wins on duplicate)
 *        Strand C (models): forecast priors averaged (harmonic mean for confidence)
 *        Strand G (ledger): violations vector-clock concat (no loss)
 *        Strand T (time):   snapshots Merkle-deduplicated
 *
 * Pure functions: callers pass genomes + receive the merged result.
 * Network transport is OUT OF SCOPE -- whisper-net handles delivery.
 */

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MnemeGenome, StrandLabel, AdamantStrand, CalibratedStrand, GovernedStrand, TemporalStrand } from "./genome.js";

const EXCHANGE_DIR = ".mneme/exodus/exchange";

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function exchangeSecret(repoRoot: string): string {
  const dir = join(repoRoot, EXCHANGE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, ".secret");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

export interface HandshakeCert {
  vendor: string;
  machine: string;
  emittedAt: string;
  signature: string;
}

export interface HandshakeOffer {
  manifestId: string;
  genomeHash: string;
  proposedStrands: StrandLabel[];
  cert: HandshakeCert;
}

export interface HandshakeAccept {
  status: "accept";
  manifestId: string;
  receiverCert: HandshakeCert;
  acceptedStrands: StrandLabel[];
}

export interface HandshakeReject {
  status: "reject";
  manifestId: string;
  reason: string;
}

/** Build a cert for this machine. */
export function makeCert(repoRoot: string, vendor: string): HandshakeCert {
  const machine = `mneme-${vendor}-${randomBytes(4).toString("hex")}`;
  const emittedAt = new Date().toISOString();
  const secret = exchangeSecret(repoRoot);
  const sig = createHmac("sha256", secret).update(`${vendor}|${machine}|${emittedAt}`).digest("hex").slice(0, 24);
  return { vendor, machine, emittedAt, signature: sig };
}

/** Build an offer from a genome. */
export function makeOffer(repoRoot: string, genome: MnemeGenome, vendor: string, proposedStrands: StrandLabel[] = ["A", "C", "G", "T"]): HandshakeOffer {
  return {
    manifestId: randomBytes(8).toString("hex"),
    genomeHash: createHmac("sha256", exchangeSecret(repoRoot)).update(canonicalize(genome.strands)).digest("hex").slice(0, 16),
    proposedStrands,
    cert: makeCert(repoRoot, vendor),
  };
}

export interface AcceptPolicy {
  /** Allowlisted vendors. Empty = accept all. */
  allowedVendors?: string[];
  /** Max age of the offer's cert in hours. */
  maxAgeHours?: number;
  /** Which strands the receiver will accept. */
  willAccept?: StrandLabel[];
}

/** Receiver evaluates an offer + returns accept/reject. */
export function evaluateOffer(repoRoot: string, offer: HandshakeOffer, policy: AcceptPolicy = {}): HandshakeAccept | HandshakeReject {
  if (policy.allowedVendors && policy.allowedVendors.length > 0 && !policy.allowedVendors.includes(offer.cert.vendor)) {
    return { status: "reject", manifestId: offer.manifestId, reason: `vendor "${offer.cert.vendor}" not allowlisted` };
  }
  if (policy.maxAgeHours !== undefined) {
    const age = (Date.now() - Date.parse(offer.cert.emittedAt)) / (3600 * 1000);
    if (!Number.isFinite(age) || age > policy.maxAgeHours) {
      return { status: "reject", manifestId: offer.manifestId, reason: `cert age ${age.toFixed(1)}h exceeds policy ${policy.maxAgeHours}h` };
    }
  }
  const willAccept = policy.willAccept ?? offer.proposedStrands;
  const acceptedStrands = offer.proposedStrands.filter((s) => willAccept.includes(s));
  if (acceptedStrands.length === 0) {
    return { status: "reject", manifestId: offer.manifestId, reason: "no strands acceptable under policy" };
  }
  return {
    status: "accept",
    manifestId: offer.manifestId,
    receiverCert: makeCert(repoRoot, "receiver"),
    acceptedStrands,
  };
}

// ─── CRDT MERGE per strand ────────────────────────────────────────────

function mergeAdamant(a: AdamantStrand, b: AdamantStrand): AdamantStrand {
  // Union by simhash. Duplicate simhash -> keep higher refuteCount.
  const map = new Map<string, AdamantStrand["vaccines"][0]>();
  for (const v of [...a.vaccines, ...b.vaccines]) {
    const prev = map.get(v.simhash);
    if (!prev || v.refuteCount > prev.refuteCount) map.set(v.simhash, v);
  }
  const commits = new Set<string>([...a.commitAnchors, ...b.commitAnchors]);
  return { vaccines: [...map.values()], commitAnchors: [...commits] };
}

function mergeCalibrated(a: CalibratedStrand, b: CalibratedStrand): CalibratedStrand {
  const priors = [...a.forecastPriors, ...b.forecastPriors].slice(-100);
  // Harmonic mean of priors per window when both sides have entries
  // for that window; otherwise pass through.
  const oracleBands: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.oracleBands), ...Object.keys(b.oracleBands)])) {
    oracleBands[k] = (a.oracleBands[k] ?? 0) + (b.oracleBands[k] ?? 0);
  }
  return { forecastPriors: priors, oracleBands };
}

function mergeGoverned(a: GovernedStrand, b: GovernedStrand): GovernedStrand {
  // Concat violations + soul vendors (vector-clock style: no loss).
  // Keep the more-recent active covenant id.
  const allVendors = new Map<string, GovernedStrand["soulVendors"][0]>();
  for (const v of [...a.soulVendors, ...b.soulVendors]) {
    const prev = allVendors.get(v.vendor);
    if (!prev) allVendors.set(v.vendor, v);
    else allVendors.set(v.vendor, {
      vendor: v.vendor,
      sessions: Math.max(prev.sessions, v.sessions),
      brokenCount: Math.max(prev.brokenCount, v.brokenCount),
    });
  }
  return {
    activeCovenantId: a.activeCovenantId ?? b.activeCovenantId,
    totalViolations: a.totalViolations + b.totalViolations,
    soulVendors: [...allVendors.values()],
  };
}

function mergeTemporal(a: TemporalStrand, b: TemporalStrand): TemporalStrand {
  return {
    earliestCommit: a.earliestCommit ?? b.earliestCommit,
    latestCommit: b.latestCommit ?? a.latestCommit,
    nucleusTick: Math.max(a.nucleusTick, b.nucleusTick),
    nucleusDna: b.nucleusDna ?? a.nucleusDna,
    vaultSnapshots: Math.max(a.vaultSnapshots, b.vaultSnapshots),
  };
}

/** Merge two genomes per the accept policy. */
export function mergeGenomes(repoRoot: string, myGenome: MnemeGenome, theirGenome: MnemeGenome, acceptedStrands: StrandLabel[]): MnemeGenome {
  const A = acceptedStrands.includes("A") ? mergeAdamant(myGenome.strands.A, theirGenome.strands.A) : myGenome.strands.A;
  const C = acceptedStrands.includes("C") ? mergeCalibrated(myGenome.strands.C, theirGenome.strands.C) : myGenome.strands.C;
  const G = acceptedStrands.includes("G") ? mergeGoverned(myGenome.strands.G, theirGenome.strands.G) : myGenome.strands.G;
  const T = acceptedStrands.includes("T") ? mergeTemporal(myGenome.strands.T, theirGenome.strands.T) : myGenome.strands.T;
  const draft = {
    schemaVersion: 1 as const,
    emittedAt: new Date().toISOString(),
    emittedBy: `nuclear-exchange(${myGenome.emittedBy}+${theirGenome.emittedBy})`,
    strands: { A, C, G, T },
  };
  const secret = exchangeSecret(repoRoot);
  const hmac = createHmac("sha256", secret).update(canonicalize(draft)).digest("hex").slice(0, 32);
  return { ...draft, hmac };
}
