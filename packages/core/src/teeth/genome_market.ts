/**
 * DEMON STAGE 2.3 — Genome Pool with PoS Validators (v1.44.0)
 *
 * SCOPE: a LOCAL stake-weighted vaccine genome marketplace. Contributors
 * publish genome cards (`.mneme/genome-market/cards/<id>.json`); validators
 * stake reputation by VOUCHING for or REFUTING a card. The accept/reject
 * decision is computed deterministically from the stake-weighted vote
 * margin against a ratification threshold. No tokens, no chain — just
 * deterministic on-disk math the operator can audit.
 *
 * SECURITY MODEL:
 *   - "Reputation" = the number of previously ratified cards a validator
 *     has authored OR vouched for; bootstraps at 1 so a fresh validator
 *     still has voice
 *   - Validators can ONLY vouch once per card (sentinel keyed by validator id)
 *   - Self-vouches are filtered out (the author's own vote doesn't count)
 *   - Cards reference a sha256 of the genome content; tampering invalidates
 *     the card (the verifier recomputes on every read)
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Slashing": validators who voted YES on a card that's later REVOKED
 *     get a -1 reputation penalty (the cost of being wrong)
 *   - Time-decayed reputation: stakes from >180 days ago count for half
 *     (forces validators to stay current)
 *   - Quadratic voting: a validator with N reputation gets sqrt(N) voting
 *     weight, so a single mega-validator can't dominate
 *   - DETERMINISTIC tie-breaker: when stake is tied, the lex-smaller card-id
 *     wins (no race conditions, no clock dependency)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const MARKET_DIR_REL = ".mneme/genome-market";
const CARDS_DIR_REL = ".mneme/genome-market/cards";
const VOTES_LEDGER_REL = ".mneme/genome-market/votes.jsonl";
const REVOCATIONS_REL = ".mneme/genome-market/revocations.jsonl";

const RATIFICATION_THRESHOLD = 3;     // net stake-weighted votes required
const REPUTATION_DECAY_DAYS = 180;
const DECAYED_WEIGHT = 0.5;

export interface GenomeCard {
  id: string;                  // user-supplied; we sha256-stamp content
  author: string;              // validator id
  title: string;
  body: string;                // the genome itself (vaccine, prompt, pattern)
  contentHash: string;         // sha256(body)
  createdAt: string;           // ISO-8601
}

export interface Vote {
  validator: string;
  cardId: string;
  vouch: boolean;              // true = vouch, false = refute
  at: string;                  // ISO-8601
}

export interface Revocation { cardId: string; at: string; reason: string }

export interface CardVerdict {
  cardId: string;
  netStake: number;            // sum of (vouch ? +w : -w) over all current votes
  vouchCount: number;
  refuteCount: number;
  ratified: boolean;
  revoked: boolean;
  reasonIfNot: string | null;
}

interface MarketPaths { dir: string; cards: string; votes: string; revoked: string }

function paths(repoRoot: string): MarketPaths {
  const root = resolve(repoRoot);
  return {
    dir: join(root, MARKET_DIR_REL),
    cards: join(root, CARDS_DIR_REL),
    votes: join(root, VOTES_LEDGER_REL),
    revoked: join(root, REVOCATIONS_REL),
  };
}

function ensureDirs(p: MarketPaths): void {
  mkdirSync(p.cards, { recursive: true });
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function slugifyId(s: string): string {
  // First strip path-traversal segments outright, then sanitize.
  const noDots = s.replace(/\.\.+/g, "-");
  return noDots.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[-.]|[-.]$/g, "").slice(0, 80) || "card";
}

export function publishCard(repoRoot: string, input: { id: string; author: string; title: string; body: string }): GenomeCard {
  const p = paths(repoRoot);
  ensureDirs(p);
  const id = slugifyId(input.id);
  const card: GenomeCard = {
    id,
    author: input.author,
    title: input.title.slice(0, 200),
    body: input.body,
    contentHash: sha256(input.body),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(p.cards, `${id}.json`), JSON.stringify(card, null, 2));
  return card;
}

export function readCard(repoRoot: string, cardId: string): GenomeCard | null {
  const p = paths(repoRoot);
  const path = join(p.cards, `${slugifyId(cardId)}.json`);
  if (!existsSync(path)) return null;
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as GenomeCard;
    // Re-verify content hash: tamper-evident
    if (sha256(c.body) !== c.contentHash) return null;
    return c;
  } catch { return null; }
}

export function listCards(repoRoot: string): GenomeCard[] {
  const p = paths(repoRoot);
  if (!existsSync(p.cards)) return [];
  const out: GenomeCard[] = [];
  for (const name of readdirSync(p.cards)) {
    if (!name.endsWith(".json")) continue;
    const c = readCard(repoRoot, name.slice(0, -5));
    if (c) out.push(c);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function castVote(repoRoot: string, vote: Omit<Vote, "at">): { outcome: "recorded" | "duplicate" | "self-vote" | "no-such-card" } {
  const p = paths(repoRoot);
  ensureDirs(p);
  const card = readCard(repoRoot, vote.cardId);
  if (!card) return { outcome: "no-such-card" };
  if (card.author === vote.validator) return { outcome: "self-vote" };
  const existing = readVotes(repoRoot).find((v) => v.cardId === vote.cardId && v.validator === vote.validator);
  if (existing) return { outcome: "duplicate" };
  const full: Vote = { ...vote, at: new Date().toISOString() };
  appendFileSync(p.votes, JSON.stringify(full) + "\n");
  return { outcome: "recorded" };
}

export function readVotes(repoRoot: string): Vote[] {
  const p = paths(repoRoot);
  if (!existsSync(p.votes)) return [];
  const out: Vote[] = [];
  for (const line of readFileSync(p.votes, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

export function revokeCard(repoRoot: string, cardId: string, reason: string): { outcome: "revoked" | "no-such-card" | "already-revoked" } {
  const p = paths(repoRoot);
  ensureDirs(p);
  const card = readCard(repoRoot, cardId);
  if (!card) return { outcome: "no-such-card" };
  if (readRevocations(repoRoot).some((r) => r.cardId === card.id)) return { outcome: "already-revoked" };
  appendFileSync(p.revoked, JSON.stringify({ cardId: card.id, at: new Date().toISOString(), reason }) + "\n");
  return { outcome: "revoked" };
}

export function readRevocations(repoRoot: string): Revocation[] {
  const p = paths(repoRoot);
  if (!existsSync(p.revoked)) return [];
  const out: Revocation[] = [];
  for (const line of readFileSync(p.revoked, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/**
 * Compute base reputation for a validator: count of (ratified-cards-authored
 * + ratified-cards-vouched-on-correctly) - (slashings). Older entries decay.
 * Floor at 1 so first-time validators still get voice.
 */
export function computeReputation(repoRoot: string, validator: string, asOf: Date = new Date()): number {
  const cards = listCards(repoRoot);
  const votes = readVotes(repoRoot);
  const revoked = new Set(readRevocations(repoRoot).map((r) => r.cardId));
  const verdictByCard = new Map<string, CardVerdict>();
  for (const c of cards) verdictByCard.set(c.id, computeCardVerdictRaw(c, votes, revoked, /*reputations*/ null, asOf));

  let rep = 1;
  for (const c of cards) {
    if (c.author !== validator) continue;
    const v = verdictByCard.get(c.id)!;
    const ageDays = (asOf.getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const w = ageDays > REPUTATION_DECAY_DAYS ? DECAYED_WEIGHT : 1;
    if (v.ratified && !v.revoked) rep += 1 * w;
    if (v.revoked) rep -= 1 * w;
  }
  for (const v of votes) {
    if (v.validator !== validator) continue;
    const verdict = verdictByCard.get(v.cardId);
    if (!verdict) continue;
    const ageDays = (asOf.getTime() - new Date(v.at).getTime()) / (1000 * 60 * 60 * 24);
    const w = ageDays > REPUTATION_DECAY_DAYS ? DECAYED_WEIGHT : 1;
    if (verdict.ratified && v.vouch && !verdict.revoked) rep += 1 * w;
    // Slashing: vouched YES on a later-revoked card → -1
    if (verdict.revoked && v.vouch) rep -= 1 * w;
  }
  return Math.max(1, rep);
}

function computeCardVerdictRaw(card: GenomeCard, allVotes: Vote[], revoked: Set<string>, reputationByValidator: Map<string, number> | null, asOf: Date): CardVerdict {
  const cardVotes = allVotes.filter((v) => v.cardId === card.id && v.validator !== card.author);
  let netStake = 0;
  let vouchCount = 0;
  let refuteCount = 0;
  for (const v of cardVotes) {
    const baseRep = reputationByValidator?.get(v.validator) ?? 1;
    const ageDays = (asOf.getTime() - new Date(v.at).getTime()) / (1000 * 60 * 60 * 24);
    const decay = ageDays > REPUTATION_DECAY_DAYS ? DECAYED_WEIGHT : 1;
    const weight = Math.sqrt(baseRep) * decay;       // quadratic voting
    if (v.vouch) { netStake += weight; vouchCount++; }
    else { netStake -= weight; refuteCount++; }
  }
  const isRevoked = revoked.has(card.id);
  const ratified = !isRevoked && netStake >= RATIFICATION_THRESHOLD;
  let reasonIfNot: string | null = null;
  if (isRevoked) reasonIfNot = "revoked";
  else if (!ratified) reasonIfNot = `net stake ${netStake.toFixed(2)} < threshold ${RATIFICATION_THRESHOLD}`;
  return { cardId: card.id, netStake: +netStake.toFixed(4), vouchCount, refuteCount, ratified, revoked: isRevoked, reasonIfNot };
}

/**
 * Compute verdicts for ALL cards. Two-pass: first computes baseline
 * reputations using verdicts that ignore reputation (uniform weight),
 * then re-computes verdicts with proper stake weights. Two passes is
 * enough — further iteration would create reputation-feedback loops.
 */
export function computeAllVerdicts(repoRoot: string, asOf: Date = new Date()): CardVerdict[] {
  const cards = listCards(repoRoot);
  const votes = readVotes(repoRoot);
  const revoked = new Set(readRevocations(repoRoot).map((r) => r.cardId));

  // Pass 1: uniform weight verdicts → drives reputation
  const _uniform = cards.map((c) => computeCardVerdictRaw(c, votes, revoked, null, asOf));
  void _uniform;

  // Build reputation map (uses uniform-weight verdicts internally)
  const validators = new Set<string>();
  for (const c of cards) validators.add(c.author);
  for (const v of votes) validators.add(v.validator);
  const repMap = new Map<string, number>();
  for (const v of validators) repMap.set(v, computeReputation(repoRoot, v, asOf));

  // Pass 2: stake-weighted verdicts
  const out = cards.map((c) => computeCardVerdictRaw(c, votes, revoked, repMap, asOf));
  // Deterministic sort: ratified first (desc by netStake), then by id
  out.sort((a, b) => {
    if (a.ratified !== b.ratified) return a.ratified ? -1 : 1;
    if (b.netStake !== a.netStake) return b.netStake - a.netStake;
    return a.cardId < b.cardId ? -1 : 1;
  });
  return out;
}
