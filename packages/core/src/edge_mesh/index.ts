/**
 * v2.82.0 — SOVEREIGN EDGE MESH · cloud-free, signed agent mesh (TRUST FABRIC 💎9, on NOTARY).
 *
 * Everything else (MCP remote, A2A, x402) routes through the cloud. The contrarian
 * bet: enterprise + government will NOT send everything to OpenAI. EDGE MESH is a
 * local-first / offline P2P agent mesh on LAN/edge where every peer announcement is
 * an Ed25519-signed card — discover + trust peers without any cloud, and verify each
 * peer card OFFLINE. Mneme's local-first + AURA (LAN pairing) + ANCHOR (identity)
 * ethos, made into a mesh.
 *
 * Composes NOTARY (peer cards are signed receipts). Pure except buildPeerCard (signs).
 * No network calls here — cards carry LAN hints; transport is the caller's job.
 */

import { issueReceipt, verifyReceipt, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export interface PeerCard {
  v: 1;
  peer: string;
  /** LAN endpoint hint (e.g. http://192.168.1.20:7741) — never a cloud URL. */
  lanUrl: string;
  capabilities: string[];
  issuedAt: number;
}

export function buildPeerCard(
  repoRoot: string,
  input: { peer: string; lanUrl: string; capabilities?: string[]; issuedAt?: number },
  keyPair?: IssuerKeyPair,
): { card: PeerCard; receipt: NotaryReceipt } {
  const card: PeerCard = {
    v: 1,
    peer: String(input.peer ?? "unknown"),
    lanUrl: String(input.lanUrl ?? ""),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter((x): x is string => typeof x === "string").sort() : [],
    issuedAt: typeof input.issuedAt === "number" ? input.issuedAt : Date.now(),
  };
  const receipt = issueReceipt(repoRoot, { kind: "generic", subject: `peer:${card.peer}`, payload: card }, keyPair);
  return { card, receipt };
}

export interface VerifiedPeer extends PeerCard {
  issuerFingerprint: string;
}

export function verifyPeerCard(receipt: unknown): { valid: boolean; reason: string; peer?: VerifiedPeer } {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const p = (receipt as NotaryReceipt).payload as PeerCard | undefined;
  if (!p || p.v !== 1 || typeof p.peer !== "string" || typeof p.lanUrl !== "string") {
    return { valid: false, reason: "not a peer card" };
  }
  return { valid: true, reason: "ok", peer: { ...p, issuerFingerprint: v.issuerFingerprint! } };
}

/**
 * Gossip-merge a set of peer-card receipts into a verified peer table. Only valid
 * cards are admitted; per peer, the LATEST issuedAt wins (issuer fingerprint
 * tiebreak for determinism). Commutative + idempotent — merge in any order, same
 * mesh. Forged cards are silently dropped.
 */
export function mergeMesh(receipts: unknown[]): { peers: VerifiedPeer[]; admitted: number; rejected: number } {
  const byPeer = new Map<string, VerifiedPeer>();
  let rejected = 0;
  for (const r of Array.isArray(receipts) ? receipts : []) {
    const v = verifyPeerCard(r);
    if (!v.valid || !v.peer) { rejected++; continue; }
    const cur = byPeer.get(v.peer.peer);
    if (!cur || v.peer.issuedAt > cur.issuedAt || (v.peer.issuedAt === cur.issuedAt && v.peer.issuerFingerprint > cur.issuerFingerprint)) {
      byPeer.set(v.peer.peer, v.peer);
    }
  }
  const peers = Array.from(byPeer.values()).sort((a, b) => a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0);
  return { peers, admitted: peers.length, rejected };
}
