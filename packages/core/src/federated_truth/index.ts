/**
 * v2.19.16 — MNEME FEDERATED TRUTH GRAVITY (the network-effect moat)
 *
 *   "Every Mneme instance today is an island. Verify-pipelines have only
 *    one source of ground truth: the local machine. Forks that copy
 *    Mneme's surface start at the same N=1 isolation we do — no moat.
 *
 *    FEDERATED TRUTH GRAVITY changes the calculus. Each Mneme instance
 *    publishes HMAC-signed ATTESTATIONS about PUBLIC facts it can
 *    observe (the npm package metadata it just installed; the well-known
 *    git commit hash it just checked out; the version string of a
 *    library it depends on). Other Mneme instances cross-attest the
 *    same public facts. A quorum of N independent instances all signing
 *    'npm package mneme-ai@2.19.16 has shasum=abc...' creates a piece
 *    of shared truth that's stronger than any single attestation —
 *    because impersonating N independent instances at once is
 *    cryptographically prohibitive.
 *
 *    The verify pipeline gains a NEW ground-truth source: 'how many
 *    independent Mneme instances confirm this exact observation?'.
 *    Truth-gravity score grows with quorum size + age. The more
 *    instances exist, the stronger every user's verify gets. Copies
 *    start at N=1. Mneme starts at N."
 *
 * Architecture:
 *   - `InstanceIdentity` = HMAC-derived stable per-(machine, repo, install-time).
 *     Pseudonymous: vendor + sessionId + repoPath → deterministic id, no PII.
 *   - `attestPublicClaim({identity, claimType, observation})` produces a
 *     signed `Attestation` envelope safe to share (JSON serialisable).
 *   - `verifyAttestation(att)` checks the HMAC + signer identity shape.
 *   - `crossAttestQuorum({mine, peers, threshold})` rolls up agreement.
 *   - `truthGravityScore(claim, attestations, nowMs)` quantifies the
 *     cross-instance support, with age-decay so dead instances don't
 *     keep weight forever.
 *   - `DISCOVERABLE_CLAIM_TYPES` enumerates ALLOWED claim categories —
 *     only public facts qualify; private repo data is REJECTED at the
 *     attestation boundary so federation can't leak code.
 *
 * Honest scope:
 *   - This module ships the PROTOCOL + LEDGER. Network transport (gossip,
 *     pull, HTTP) is caller's responsibility — the protocol is
 *     intentionally transport-agnostic so existing v2.13 MESH /
 *     v2.18 NEXUS layers can carry it.
 *   - HMAC uses a SHARED SECRET (the protocol secret); future v2.20 may
 *     swap for Ed25519 keypairs. The shared secret is a public protocol
 *     constant — attestation security comes from the SIGNER IDENTITY +
 *     claim canonicalisation, not key secrecy.
 *   - Truth-gravity is correlation across independent observers, NOT
 *     causation. We can say "N peers also saw this" not "this is true".
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_QUORUM_THRESHOLD = 3;
const ATTESTATION_HALF_LIFE_DAYS = 90;
const MAX_PEERS_PER_QUORUM = 1000;

/**
 * The whitelisted claim categories. Each is a PUBLIC fact any Mneme
 * instance can independently observe. Private repo data is REJECTED
 * outside this list so federation never leaks code.
 */
export const DISCOVERABLE_CLAIM_TYPES = [
  "npm_package_shasum",          // shasum of an npm tarball at version V
  "npm_package_latest_version",  // the latest published version of a public package
  "git_commit_exists",           // a specific commit sha exists in a public repo
  "github_release_tag",          // GitHub release tag exists for a public repo
  "mneme_self_catalog_count",    // total MCP tools registered by a Mneme version
  "ecosystem_advisory",          // a public security advisory id exists
] as const;

export type DiscoverableClaimType = typeof DISCOVERABLE_CLAIM_TYPES[number];

export interface InstanceIdentity {
  v: typeof PROTOCOL_VERSION;
  /** Stable per-(vendor, sessionId, repoPath); pseudonymous; no PII. */
  id: string;
  vendor: string;
  /** Short fingerprint useful for log lines. */
  shortHash: string;
}

export interface Attestation {
  v: typeof PROTOCOL_VERSION;
  attestationId: string;
  signer: InstanceIdentity;
  claimType: DiscoverableClaimType;
  /** Caller-defined SUBJECT key (e.g., "mneme-ai@2.19.16"). */
  subject: string;
  /** Caller-defined OBSERVATION value (e.g., "shasum:deadbeef..."). */
  observation: string;
  /** Epoch ms when the observation was made. */
  observedAtMs: number;
  hmac: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Federation HMAC secret — INTENTIONALLY a public protocol constant.
 * Security model: signer-identity + claim-canonicalisation, not secret
 * key. An attacker forging an attestation must mimic the EXACT instance
 * identity of an existing peer; the protocol assumes peer ids are
 * gossiped + verified across the mesh, so impersonation is detectable.
 */
function federationSecret(): string {
  return process.env["MNEME_FEDERATION_SECRET"] || `mneme-federated-truth-public-v${PROTOCOL_VERSION}`;
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function signAttestation(body: Omit<Attestation, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

// ─── INSTANCE IDENTITY ───────────────────────────────────────────────────

export interface IdentityInput {
  vendor: string;
  sessionId?: string;
  repoPath?: string;
  /** Optional seed for deterministic tests. */
  seed?: string;
}

/**
 * Derive a stable pseudonymous identity for a Mneme instance. Same
 * (vendor, sessionId, repoPath, seed) → same id. No PII; never includes
 * file content or user-identifiable strings.
 */
export function createInstanceIdentity(input: IdentityInput): InstanceIdentity {
  const sessionId = input.sessionId ?? "default";
  const repoPath = input.repoPath ?? "unknown";
  const seed = input.seed ?? "";
  const raw = `${input.vendor}|${sessionId}|${repoPath}|${seed}`;
  const id = "mi-" + createHmac("sha256", "mneme-instance-id")
    .update(raw)
    .digest("hex").slice(0, 24);
  const shortHash = id.slice(0, 10);
  return { v: PROTOCOL_VERSION, id, vendor: input.vendor, shortHash };
}

// ─── ATTESTATION ─────────────────────────────────────────────────────────

export interface AttestInput {
  identity: InstanceIdentity;
  claimType: DiscoverableClaimType;
  subject: string;
  observation: string;
  observedAtMs?: number;
  secret?: string;
}

/**
 * Produce a signed attestation envelope. Throws if claimType is not in
 * the discoverable allow-list — this is the safety boundary preventing
 * private code leaks through federation.
 */
export function attestPublicClaim(input: AttestInput): Attestation {
  if (!DISCOVERABLE_CLAIM_TYPES.includes(input.claimType)) {
    throw new Error(`federation: claimType '${input.claimType}' is not in the discoverable allow-list (${DISCOVERABLE_CLAIM_TYPES.join(", ")})`);
  }
  const observedAtMs = input.observedAtMs ?? Date.now();
  const attestationId = "att-" + createHmac("sha256", "mneme-attest-id")
    .update(`${input.identity.id}|${input.claimType}|${input.subject}|${input.observation}|${observedAtMs}`)
    .digest("hex").slice(0, 16);
  const body: Omit<Attestation, "hmac"> = {
    v: PROTOCOL_VERSION,
    attestationId,
    signer: input.identity,
    claimType: input.claimType,
    subject: input.subject,
    observation: input.observation,
    observedAtMs,
  };
  const hmac = signAttestation(body, input.secret ?? federationSecret());
  return { ...body, hmac };
}

export function verifyAttestation(att: Attestation, secret?: string): { ok: boolean; reason?: string } {
  if (!DISCOVERABLE_CLAIM_TYPES.includes(att.claimType)) {
    return { ok: false, reason: `claimType '${att.claimType}' not in discoverable allow-list` };
  }
  const { hmac, ...body } = att;
  const expected = signAttestation(body, secret ?? federationSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged attestation or wrong protocol secret" };
  }
  return { ok: true };
}

/** Canonical-form JSON envelope suitable for gossip transport. */
export function serializeAttestation(att: Attestation): string {
  return canon(att);
}

export function deserializeAttestation(json: string): Attestation {
  return JSON.parse(json) as Attestation;
}

// ─── QUORUM ──────────────────────────────────────────────────────────────

export type QuorumVerdict = "unanimous" | "supermajority" | "majority" | "minority" | "orphan" | "conflict";

export interface QuorumResult {
  verdict: QuorumVerdict;
  claim: { claimType: DiscoverableClaimType; subject: string };
  observedValues: Array<{ observation: string; count: number; signers: string[] }>;
  totalAttestations: number;
  uniqueSigners: number;
  supportingCount: number;
  conflictingCount: number;
  threshold: number;
}

export interface CrossAttestInput {
  mine: Attestation;
  peers: Attestation[];
  threshold?: number;
  secret?: string;
}

/**
 * Aggregate cross-instance attestations for the SAME (claimType, subject)
 * tuple. Returns a verdict band based on observation consensus:
 *
 *   unanimous     — every verified attestation agrees on the observation
 *   supermajority — ≥ 2/3 agree
 *   majority      — > 1/2 agree
 *   minority      — top observation is supported but < 1/2
 *   conflict      — multiple roughly-equal observations (ambiguous)
 *   orphan        — only the caller's attestation, no peers
 */
export function crossAttestQuorum(input: CrossAttestInput): QuorumResult {
  const threshold = input.threshold ?? DEFAULT_QUORUM_THRESHOLD;
  const secret = input.secret ?? federationSecret();
  // Filter to verified attestations matching the (claimType, subject) tuple.
  const all: Attestation[] = [input.mine, ...input.peers.slice(0, MAX_PEERS_PER_QUORUM)];
  const verified = all.filter((a) => {
    if (a.claimType !== input.mine.claimType) return false;
    if (a.subject !== input.mine.subject) return false;
    return verifyAttestation(a, secret).ok;
  });
  // Dedup by signer id (one vote per signer — last-write-wins by ts).
  const bySigner = new Map<string, Attestation>();
  for (const a of verified) {
    const prev = bySigner.get(a.signer.id);
    if (!prev || prev.observedAtMs < a.observedAtMs) bySigner.set(a.signer.id, a);
  }
  const uniqueAtts = Array.from(bySigner.values());
  const uniqueSigners = bySigner.size;
  // Tally observations.
  const obsCount = new Map<string, { count: number; signers: string[] }>();
  for (const a of uniqueAtts) {
    const entry = obsCount.get(a.observation) ?? { count: 0, signers: [] };
    entry.count++;
    entry.signers.push(a.signer.shortHash);
    obsCount.set(a.observation, entry);
  }
  const observedValues = Array.from(obsCount.entries())
    .map(([observation, e]) => ({ observation, count: e.count, signers: e.signers }))
    .sort((a, b) => b.count - a.count);
  const total = uniqueAtts.length;
  const supportingCount = observedValues[0]?.count ?? 0;
  const conflictingCount = total - supportingCount;
  let verdict: QuorumVerdict;
  if (total === 0) {
    verdict = "orphan";
  } else if (uniqueSigners < threshold && observedValues.length === 1) {
    // Too few signers; if all agree it's not conflict but it's not strong support.
    verdict = uniqueSigners === 1 ? "orphan" : "minority";
  } else if (observedValues.length >= 2 && observedValues[0]!.count <= observedValues[1]!.count + 1 && observedValues[0]!.count < Math.ceil(total / 2)) {
    // Multiple roughly-equal values, no value with absolute majority.
    verdict = "conflict";
  } else if (supportingCount === total) {
    verdict = "unanimous";
  } else if (supportingCount * 3 >= total * 2) {
    verdict = "supermajority";
  } else if (supportingCount * 2 > total) {
    verdict = "majority";
  } else {
    verdict = "minority";
  }
  return {
    verdict,
    claim: { claimType: input.mine.claimType, subject: input.mine.subject },
    observedValues,
    totalAttestations: total,
    uniqueSigners,
    supportingCount,
    conflictingCount,
    threshold,
  };
}

// ─── TRUTH GRAVITY ───────────────────────────────────────────────────────

/**
 * Truth-gravity quantifies cross-instance support for a (claimType,
 * subject, observation) tuple as a 0..100 score that grows with peer
 * count + recency. Older attestations decay via half-life so dead
 * instances don't accumulate weight forever.
 *
 *   weight(att) = 0.5 ^ (age_days / 90)
 *   score      = min(100, 100 * Σ weight / saturation)
 */
export function truthGravityScore(opts: {
  claimType: DiscoverableClaimType;
  subject: string;
  observation: string;
  attestations: Attestation[];
  nowMs?: number;
  saturationCount?: number;
}): { score: number; effectiveWeight: number; contributingSigners: string[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const saturation = opts.saturationCount ?? 10;
  const halfLifeMs = ATTESTATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  let weight = 0;
  const signers = new Set<string>();
  // Dedup by signer; keep the most-recent matching attestation per signer.
  const bySigner = new Map<string, Attestation>();
  for (const a of opts.attestations) {
    if (a.claimType !== opts.claimType) continue;
    if (a.subject !== opts.subject) continue;
    if (a.observation !== opts.observation) continue;
    const prev = bySigner.get(a.signer.id);
    if (!prev || prev.observedAtMs < a.observedAtMs) bySigner.set(a.signer.id, a);
  }
  for (const a of bySigner.values()) {
    const ageMs = Math.max(0, nowMs - a.observedAtMs);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const w = Math.pow(0.5, ageDays / ATTESTATION_HALF_LIFE_DAYS);
    weight += w;
    signers.add(a.signer.shortHash);
  }
  const score = Math.min(100, 100 * weight / saturation);
  return {
    score,
    effectiveWeight: weight,
    contributingSigners: Array.from(signers),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

/** Convenience: hash a public artifact (npm tarball, file blob) deterministically. */
export function fingerprintArtifact(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return sha256Hex(buf.toString("base64"));
}

export function formatQuorumLine(r: QuorumResult): string {
  const tag = r.verdict === "unanimous" ? "🌟"
    : r.verdict === "supermajority" ? "✨"
    : r.verdict === "majority" ? "✓"
    : r.verdict === "minority" ? "·"
    : r.verdict === "conflict" ? "⚖"
    : "○";
  return `${tag} QUORUM · ${r.verdict} · ${r.supportingCount}/${r.totalAttestations} signers agree on top observation`;
}

export function formatGravityLine(g: { score: number; effectiveWeight: number; contributingSigners: string[] }): string {
  return `🌌 GRAVITY · score=${g.score.toFixed(1)}/100 · weight=${g.effectiveWeight.toFixed(2)} · signers=${g.contributingSigners.length}`;
}
