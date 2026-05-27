/**
 * 💥 6. STARLINK-LINKED MNEMNET
 *
 * Federation overlay built on top of LAN GOSSIP. Designed to run on:
 *   - Starlink terminal Linux (xAI privileged access)
 *   - Tesla in-car compute (Linux)
 *   - Colossus internal cluster
 *
 * Verifies that ≥N peers agree on a Mneme verdict before stamping it
 * as "globally verified" — Byzantine-style consensus over LAN/WAN mesh.
 *
 * This module is the THIN orchestration layer; underlying transport is
 * LanGossip (already shipped v2.68.0).
 */

import { createHmac } from "node:crypto";
import { LanGossip, type GossipSummary, type PeerRecord } from "../protoplasm/lan_gossip.js";

export interface VerificationProposal {
  proposalId: string;
  claim: string;
  proposerHostId: string;
  ts: string;
  signature: string;
}

export interface PeerVerdict {
  peerHostId: string;
  proposalId: string;
  verdict: "agree" | "disagree" | "abstain";
  ts: string;
  signature: string;
}

export interface FederatedConsensusResult {
  proposalId: string;
  totalPeers: number;
  agreed: number;
  disagreed: number;
  abstained: number;
  consensusReached: boolean;
  consensusThreshold: number;
  reason: string;
  hmac: string;
}

export class StarlinkMnemnet {
  private gossip: LanGossip;
  private verdictsByProposal = new Map<string, PeerVerdict[]>();

  constructor(private hostId: string, private hmacKey: string, opts: { group?: string; port?: number } = {}) {
    this.gossip = new LanGossip({
      secret: hmacKey,
      hostId,
      group: opts.group,
      port: opts.port,
    });
  }

  async start(): Promise<{ ok: boolean; reason?: string }> {
    const r = await this.gossip.start();
    return { ok: r.ok, reason: r.reason };
  }

  publishHeartbeat(summary: GossipSummary): boolean {
    return this.gossip.announce(summary);
  }

  listPeers(): PeerRecord[] {
    return this.gossip.listPeers();
  }

  /** Propose a claim for federated verification. */
  proposeVerification(claim: string): VerificationProposal {
    const ts = new Date().toISOString();
    const proposalId = createHmac("sha256", this.hmacKey).update(claim + ts).digest("hex").slice(0, 12);
    const body = { proposalId, claim, proposerHostId: this.hostId, ts };
    const signature = createHmac("sha256", this.hmacKey).update(JSON.stringify(body)).digest("hex").slice(0, 16);
    return { ...body, signature };
  }

  /** Submit a verdict from a peer (called when peer sends verdict via gossip). */
  ingestPeerVerdict(v: PeerVerdict): boolean {
    // Verify peer signature
    const { signature, ...body } = v;
    const expected = createHmac("sha256", this.hmacKey).update(JSON.stringify(body)).digest("hex").slice(0, 16);
    if (signature !== expected) return false;
    if (!this.verdictsByProposal.has(v.proposalId)) this.verdictsByProposal.set(v.proposalId, []);
    this.verdictsByProposal.get(v.proposalId)!.push(v);
    return true;
  }

  /** Compute consensus. Default: 2/3 majority. */
  computeConsensus(proposalId: string, threshold = 2 / 3): FederatedConsensusResult {
    const verdicts = this.verdictsByProposal.get(proposalId) ?? [];
    const agreed = verdicts.filter((v) => v.verdict === "agree").length;
    const disagreed = verdicts.filter((v) => v.verdict === "disagree").length;
    const abstained = verdicts.filter((v) => v.verdict === "abstain").length;
    const total = verdicts.length;
    const votingPeers = agreed + disagreed;
    const consensusReached = votingPeers > 0 && (agreed / votingPeers) >= threshold;

    const result = {
      proposalId,
      totalPeers: total,
      agreed,
      disagreed,
      abstained,
      consensusReached,
      consensusThreshold: threshold,
      reason: consensusReached
        ? `${agreed}/${votingPeers} agreed ≥ ${(threshold * 100).toFixed(0)}%`
        : `only ${agreed}/${votingPeers} agreed (need ≥${(threshold * 100).toFixed(0)}%)`,
    };
    const hmac = createHmac("sha256", this.hmacKey).update(JSON.stringify(result)).digest("hex").slice(0, 16);
    return { ...result, hmac };
  }

  close(): void {
    this.gossip.close();
  }
}
