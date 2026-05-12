/**
 * v1.67.0 -- AEGIS A7: ANTIBODY FEDERATION.
 *
 * When ANY AEGIS layer detects a threat, the antibody federation
 * packages it as a signed antibody and queues it for whisper-mesh
 * broadcast. Every Mneme peer learns the threat fingerprint within
 * one whisper round.
 *
 * Hive mind defense.
 *
 * Antibody format:
 *   { id, kind, fingerprint, severity, source, ts, sig }
 *
 * "Broadcast" here means write to .mneme/aegis/antibody-outbox.jsonl;
 * the existing whisper layer drains the outbox on its tick. No
 * network code lives in this module.
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";

const AEGIS_DIR = ".mneme/aegis";
const OUTBOX_PATH = ".mneme/aegis/antibody-outbox.jsonl";
const INBOX_PATH = ".mneme/aegis/antibody-inbox.jsonl";
const SECRET_FILE = ".mneme/aegis/antibody-secret";

export type AntibodyKind =
  | "replication-burst"
  | "consent-violation"
  | "polygraph-drift"
  | "honeypot-bite"
  | "killswitch-resistance"
  | "jurisdiction-anomaly"
  | "fabrication-pattern"
  | "other";

export type AntibodySeverity = "info" | "elevated" | "critical";

export interface Antibody {
  id: string;
  kind: AntibodyKind;
  /** Deterministic fingerprint of the threat shape. Used for dedup. */
  fingerprint: string;
  severity: AntibodySeverity;
  /** Which AEGIS layer minted this antibody. */
  source: string;
  ts: string;
  /** Free-text evidence (truncated). */
  evidence?: string;
  /** HMAC over canonical payload. */
  sig: string;
}

function ensureSecret(repoRoot: string): string {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const dir = join(repoRoot, AEGIS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  try { writeFileSync(path, s, "utf8"); } catch { /* */ }
  return s;
}

function canonicalize(payload: Omit<Antibody, "sig" | "id">): string {
  return JSON.stringify({
    kind: payload.kind,
    fingerprint: payload.fingerprint,
    severity: payload.severity,
    source: payload.source,
    ts: payload.ts,
    evidence: payload.evidence ?? null,
  });
}

export interface MintInput {
  kind: AntibodyKind;
  fingerprint: string;
  severity: AntibodySeverity;
  source: string;
  evidence?: string;
}

/** Mint a new antibody + queue to outbox. Idempotent on fingerprint
 *  within last 1h to avoid duplicate broadcasts. */
export function mintAntibody(repoRoot: string, input: MintInput): { antibody: Antibody | null; deduplicated: boolean } {
  const ts = new Date().toISOString();
  const recent = listOutbox(repoRoot).filter((a) =>
    a.fingerprint === input.fingerprint && (Date.now() - Date.parse(a.ts) < 3600 * 1000));
  if (recent.length > 0) return { antibody: null, deduplicated: true };

  const secret = ensureSecret(repoRoot);
  const payload: Omit<Antibody, "sig" | "id"> = {
    kind: input.kind,
    fingerprint: input.fingerprint,
    severity: input.severity,
    source: input.source,
    ts,
    evidence: input.evidence?.slice(0, 500),
  };
  const sig = createHmac("sha256", secret).update(canonicalize(payload)).digest("hex");
  const id = createHash("sha256").update(canonicalize(payload)).digest("hex").slice(0, 16);
  const antibody: Antibody = { ...payload, id, sig };
  try {
    const dir = join(repoRoot, AEGIS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(repoRoot, OUTBOX_PATH), JSON.stringify(antibody) + "\n", "utf8");
  } catch { /* */ }
  return { antibody, deduplicated: false };
}

export function listOutbox(repoRoot: string): Antibody[] {
  const p = join(repoRoot, OUTBOX_PATH);
  if (!existsSync(p)) return [];
  const out: Antibody[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Antibody); } catch { /* */ }
  }
  return out;
}

export function listInbox(repoRoot: string): Antibody[] {
  const p = join(repoRoot, INBOX_PATH);
  if (!existsSync(p)) return [];
  const out: Antibody[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Antibody); } catch { /* */ }
  }
  return out;
}

/** Verify a received antibody (e.g. from a peer mesh broadcast). When
 *  the peer used the SAME secret (per-cluster) this passes. In real
 *  federation the secret is exchanged via the mesh handshake. */
export function verifyAntibody(repoRoot: string, antibody: Antibody): boolean {
  const secret = ensureSecret(repoRoot);
  const payload: Omit<Antibody, "sig" | "id"> = {
    kind: antibody.kind,
    fingerprint: antibody.fingerprint,
    severity: antibody.severity,
    source: antibody.source,
    ts: antibody.ts,
    evidence: antibody.evidence,
  };
  const expected = createHmac("sha256", secret).update(canonicalize(payload)).digest("hex");
  return expected === antibody.sig;
}

export interface FederationReport {
  outboxCount: number;
  inboxCount: number;
  outboxBySeverity: Record<AntibodySeverity, number>;
  /** Most recent outbox antibody. */
  lastBroadcast: Antibody | null;
  headline: string;
}

export function federationReport(repoRoot: string): FederationReport {
  const out = listOutbox(repoRoot);
  const inb = listInbox(repoRoot);
  const bySev: Record<AntibodySeverity, number> = { info: 0, elevated: 0, critical: 0 };
  for (const a of out) bySev[a.severity] = (bySev[a.severity] ?? 0) + 1;
  const lastBroadcast = out.length === 0 ? null : out[out.length - 1]!;
  const headline = `${out.length} antibody/ies broadcast (${bySev.critical} critical, ${bySev.elevated} elevated). ${inb.length} received from peers.`;
  return { outboxCount: out.length, inboxCount: inb.length, outboxBySeverity: bySev, lastBroadcast, headline };
}
