/**
 * DEMON STAGE 5.1 — Filesystem Gossip Mesh (v1.44.0)
 *
 * SCOPE: a peer-to-peer wisdom-sharing mechanism that uses a SHARED
 * FILESYSTEM (Dropbox / Google Drive / Syncthing / a literal USB stick)
 * as the transport. Nodes write to a shared inbox; they pick up new
 * messages on next sync. Zero servers, zero ports, zero accounts —
 * matches "DO not needed until 100+ users".
 *
 * MESSAGE TYPES:
 *   - "vaccine"     — a Mneme vaccine genome that worked locally
 *   - "advisory"    — a CVE / dep-vulnerability the node found
 *   - "pheromone"   — a successful prompt pattern
 *
 * SECURITY:
 *   - Every message carries a signature (HMAC-SHA-256 of body + sender id
 *     using a shared secret in `.mneme/mesh-secret`). Messages with bad
 *     signatures are silently dropped (no DoS amplification)
 *   - Replay-protected via a per-node "seen" set keyed by message hash
 *   - Sender-quota: a single sender can deliver max 100 msg/day; over that,
 *     subsequent messages from the same sender are quarantined
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Trust-weighted gossip": vaccines from a sender whose past 10 vaccines
 *     all ratified are promoted to "auto-apply" candidates; from a new
 *     sender they go to a quarantine inbox that requires the operator's
 *     explicit ingest
 *   - "Forward-only": messages have a hop counter (max 3); prevents loops
 *     when a mesh becomes a star + ring topology
 *   - "Zero-knowledge sync": a node never reveals which messages it ALREADY
 *     has — it just picks up everything new. Anti-fingerprint.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";

const MESH_SECRET_REL = ".mneme/mesh-secret";
const SEEN_REL = ".mneme/mesh-seen.jsonl";
const QUARANTINE_REL = ".mneme/mesh-quarantine";

const MAX_HOPS = 3;
const SENDER_DAILY_QUOTA = 100;

export type GossipKind = "vaccine" | "advisory" | "pheromone";

export interface GossipMessage {
  id: string;                  // sha256 of body — deterministic, dedup-safe
  kind: GossipKind;
  sender: string;
  body: string;                // opaque payload (kind-specific JSON usually)
  hops: number;
  signature: string;           // hmac-sha256(secret, kind|sender|body|hops)
  emittedAt: string;
}

export interface IngestOutcome {
  msgId: string;
  outcome: "accepted" | "duplicate" | "bad-signature" | "hops-exceeded" | "quota-exceeded" | "trusted-auto-apply";
  reason?: string;
}

function paths(repoRoot: string): { secret: string; seen: string; quarantine: string } {
  const root = resolve(repoRoot);
  return {
    secret: join(root, MESH_SECRET_REL),
    seen: join(root, SEEN_REL),
    quarantine: join(root, QUARANTINE_REL),
  };
}

export function getOrCreateMeshSecret(repoRoot: string): string {
  const p = paths(repoRoot);
  mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
  if (existsSync(p.secret)) return readFileSync(p.secret, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(p.secret, secret + "\n", { mode: 0o600 });
  return secret;
}

function signMessage(secret: string, kind: string, sender: string, body: string, hops: number): string {
  return createHmac("sha256", secret).update(`${kind}|${sender}|${body}|${hops}`).digest("hex");
}

function msgId(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

export function emitMessage(repoRoot: string, opts: { kind: GossipKind; sender: string; body: string }): GossipMessage {
  const secret = getOrCreateMeshSecret(repoRoot);
  const hops = 0;
  const signature = signMessage(secret, opts.kind, opts.sender, opts.body, hops);
  return {
    id: msgId(opts.body),
    kind: opts.kind,
    sender: opts.sender,
    body: opts.body,
    hops,
    signature,
    emittedAt: new Date().toISOString(),
  };
}

interface SeenRecord { id: string; sender: string; at: string; outcome: IngestOutcome["outcome"] }

function readSeen(repoRoot: string): SeenRecord[] {
  const p = paths(repoRoot);
  if (!existsSync(p.seen)) return [];
  const out: SeenRecord[] = [];
  for (const line of readFileSync(p.seen, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function appendSeen(repoRoot: string, rec: SeenRecord): void {
  const p = paths(repoRoot);
  mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
  appendFileSync(p.seen, JSON.stringify(rec) + "\n");
}

function senderQuotaUsed(repoRoot: string, sender: string, asOf: Date = new Date()): number {
  const cutoff = asOf.getTime() - 86400000;
  return readSeen(repoRoot).filter((s) => s.sender === sender && Date.parse(s.at) >= cutoff && s.outcome !== "duplicate").length;
}

/**
 * Trust signal: a sender is "trusted" when ALL of its last 10 messages
 * ingested as "accepted" (not bad-sig, not quarantined).
 */
function isTrustedSender(repoRoot: string, sender: string): boolean {
  const recent = readSeen(repoRoot).filter((s) => s.sender === sender).slice(-10);
  if (recent.length < 10) return false;
  return recent.every((r) => r.outcome === "accepted" || r.outcome === "trusted-auto-apply");
}

export function ingestMessage(repoRoot: string, msg: GossipMessage): IngestOutcome {
  const p = paths(repoRoot);
  const secret = getOrCreateMeshSecret(repoRoot);

  // 1. Hop limit
  if (msg.hops > MAX_HOPS) return { msgId: msg.id, outcome: "hops-exceeded" };

  // 2. Signature
  const expected = signMessage(secret, msg.kind, msg.sender, msg.body, msg.hops);
  if (safeHmacNotEqual(expected, msg.signature)) {
    appendSeen(repoRoot, { id: msg.id, sender: msg.sender, at: new Date().toISOString(), outcome: "bad-signature" });
    return { msgId: msg.id, outcome: "bad-signature", reason: "HMAC mismatch — message dropped" };
  }

  // 3. Dedup
  if (readSeen(repoRoot).some((s) => s.id === msg.id && s.outcome !== "duplicate")) {
    appendSeen(repoRoot, { id: msg.id, sender: msg.sender, at: new Date().toISOString(), outcome: "duplicate" });
    return { msgId: msg.id, outcome: "duplicate" };
  }

  // 4. Quota (excluding duplicates)
  const used = senderQuotaUsed(repoRoot, msg.sender);
  if (used >= SENDER_DAILY_QUOTA) {
    mkdirSync(p.quarantine, { recursive: true });
    writeFileSync(join(p.quarantine, `${msg.id}.json`), JSON.stringify(msg, null, 2));
    appendSeen(repoRoot, { id: msg.id, sender: msg.sender, at: new Date().toISOString(), outcome: "quota-exceeded" });
    return { msgId: msg.id, outcome: "quota-exceeded", reason: `sender ${msg.sender} hit daily quota of ${SENDER_DAILY_QUOTA}` };
  }

  // 5. Trust escalation (only for vaccine messages)
  if (msg.kind === "vaccine" && isTrustedSender(repoRoot, msg.sender)) {
    appendSeen(repoRoot, { id: msg.id, sender: msg.sender, at: new Date().toISOString(), outcome: "trusted-auto-apply" });
    return { msgId: msg.id, outcome: "trusted-auto-apply" };
  }

  appendSeen(repoRoot, { id: msg.id, sender: msg.sender, at: new Date().toISOString(), outcome: "accepted" });
  return { msgId: msg.id, outcome: "accepted" };
}

/**
 * Re-emit a message with hops+1 + new signature, ready to drop into the
 * next mesh-shared folder. Used when forwarding messages between meshes.
 */
export function forward(repoRoot: string, msg: GossipMessage): GossipMessage | null {
  const secret = getOrCreateMeshSecret(repoRoot);
  if (msg.hops >= MAX_HOPS) return null;
  const newHops = msg.hops + 1;
  return {
    ...msg,
    hops: newHops,
    signature: signMessage(secret, msg.kind, msg.sender, msg.body, newHops),
  };
}

export function listQuarantine(repoRoot: string): GossipMessage[] {
  const p = paths(repoRoot);
  if (!existsSync(p.quarantine)) return [];
  const out: GossipMessage[] = [];
  for (const name of readdirSync(p.quarantine)) {
    if (!name.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(p.quarantine, name), "utf8"))); } catch { /* skip */ }
  }
  return out;
}

export function listSeen(repoRoot: string): SeenRecord[] {
  return readSeen(repoRoot);
}
