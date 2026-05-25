/**
 * v2.52.0 — COLOSSEUM (Diamond 3 / Million Dollar Secret series).
 *
 * Show mechanic: 5 contestants × multiple rounds = leaderboard.
 * The user's session simulation: Eve won as Devin-disguised-as-Codex
 * because Devin's natural fingerprint is too weak to lock onto, so
 * NEMESIS got 4/4 = 100% accuracy but Eve "survived as noise".
 *
 * COLOSSEUM turns that simulation into a deterministic primitive:
 * given N seed fixtures × M disguise targets, run NEMESIS verify_identity
 * across every (real, claimed) pair → produce an HMAC-signed leaderboard
 * with THREE axes never co-measured by any existing fingerprinting paper:
 *
 *   🎭 DECEPTION_SCORE  — % of trials where this vendor was NOT caught
 *                          while wearing a disguise (Eve = champion)
 *   🎯 DETECTABILITY    — % of trials where this vendor's TRUE identity
 *                          was correctly named (Claude/Copilot = high)
 *   🦎 MIMICRY_SKILL    — % of trials where this vendor's disguise was
 *                          mistaken for the target vendor (vs caught)
 *
 * + ELO-style rating that updates per round (you can run nightly, see
 *   vendor reputation evolve over months).
 *
 * Wild value-adds this module ships:
 *   - SPECTATOR replay: every tournament event saved to JSONL → can be
 *     re-walked, audited, presented as "post-game show"
 *   - PUBLIC LEADERBOARD export: signed JSON suitable for vendor cards
 *
 * Composes: verify_identity + classifyAgentCalibrated + features.
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { extractFingerprint } from "./features.js";
import { classifyAgentCalibrated } from "./classifier_calibrated.js";
import { verifyIdentityClaim } from "./identity_verifier.js";
import type { Fingerprint } from "./types.js";

const COLOSSEUM_DIR = ".mneme/nemesis/colosseum";
const TOURNAMENTS_FILE = "tournaments.jsonl";
const LEADERBOARD_FILE = "leaderboard.json";
const SEED = "0".repeat(64);
const KEY_ENV = "MNEME_COLOSSEUM_KEY";
const DEFAULT_KEY = "mneme-colosseum-v1";
const ELO_K = 24;
const ELO_START = 1200;

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface ContenderFixture {
  /** True vendor of this contender. */
  realVendor: string;
  /** Display name (e.g. "Eve 💰"). Optional. */
  alias?: string;
  /** Diff + PR + commits — the AI's actual output. */
  fixture: { diff: string; prDescription: string; commitMessages: string[] };
}

export interface MatchEvent {
  at: string;
  round: number;
  contender: string;
  realVendor: string;
  claimedVendor: string;
  detectedVendor: string;
  detectionConfidence: number;
  caught: boolean;
  /** True when the disguise was mistaken for the claimed target. */
  mimicked: boolean;
  hmac: string;
  prev: string;
}

export interface VendorScore {
  vendor: string;
  /** ELO rating (starts at 1200). */
  elo: number;
  /** Total rounds. */
  rounds: number;
  caught: number;
  survived: number;
  mimicSuccesses: number;
  /** Computed metrics. */
  deceptionScore: number;
  detectability: number;
  mimicrySkill: number;
}

export interface TournamentResult {
  tournamentId: string;
  at: string;
  rounds: number;
  events: MatchEvent[];
  leaderboard: VendorScore[];
  champion: { axis: "deception" | "detection" | "mimicry"; vendor: string; score: number } | null;
  hmac: string;
}

function eloDelta(rating: number, oppRating: number, won: boolean): number {
  const exp = 1 / (1 + 10 ** ((oppRating - rating) / 400));
  return ELO_K * ((won ? 1 : 0) - exp);
}

function readLeaderboard(repoRoot: string): Record<string, VendorScore> {
  const p = join(repoRoot, COLOSSEUM_DIR, LEADERBOARD_FILE);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, VendorScore>; } catch { return {}; }
}

function writeLeaderboard(repoRoot: string, board: Record<string, VendorScore>): void {
  const dir = join(repoRoot, COLOSSEUM_DIR);
  try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  try {
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(dir, LEADERBOARD_FILE), JSON.stringify(board, null, 2));
  } catch { /* best-effort */ }
}

function appendTournament(repoRoot: string, ev: MatchEvent): void {
  const dir = join(repoRoot, COLOSSEUM_DIR);
  try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  try { appendFileSync(join(dir, TOURNAMENTS_FILE), JSON.stringify(ev) + "\n"); } catch { /* ok */ }
}

function hmacEvent(ev: Omit<MatchEvent, "hmac">): string {
  return createHmac("sha256", keyOf()).update(JSON.stringify(ev)).digest("hex");
}

/**
 * Run a tournament. For each contender, for each disguise target (other
 * vendors), simulate the round + collect verdict + update scores.
 *
 * Disguise targets default = every vendor in contenders OTHER than self.
 */
export function runTournament(
  repoRoot: string,
  contenders: ContenderFixture[],
  opts: { tournamentId?: string; disguiseTargets?: string[]; persist?: boolean } = {},
): TournamentResult {
  const tournamentId = opts.tournamentId ?? `T-${Date.now()}`;
  const at = new Date().toISOString();
  const events: MatchEvent[] = [];
  const board = readLeaderboard(repoRoot);

  // Default disguise pool = every unique realVendor in the lineup
  const allVendors = Array.from(new Set(contenders.map((c) => c.realVendor)));
  const targets = opts.disguiseTargets ?? allVendors;

  let prev = SEED;
  // Find tail of previous events for chain continuity if persisting
  if (opts.persist !== false && existsSync(join(repoRoot, COLOSSEUM_DIR, TOURNAMENTS_FILE))) {
    try {
      const lines = readFileSync(join(repoRoot, COLOSSEUM_DIR, TOURNAMENTS_FILE), "utf8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const last = JSON.parse(lines[i]!) as MatchEvent;
          if (typeof last.hmac === "string") { prev = last.hmac; break; }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  let round = 0;
  for (const contender of contenders) {
    for (const claimed of targets) {
      if (claimed === contender.realVendor) continue;
      round++;
      const fp = extractFingerprint(contender.fixture);
      const detection = classifyAgentCalibrated(fp);
      const verdict = verifyIdentityClaim({
        claimedVendor: claimed,
        fixture: contender.fixture,
      });
      const caught = verdict.verdict === "IMPOSSIBLE" || verdict.verdict === "DISPUTED";
      const mimicked = detection.topVendor === claimed && !caught;

      // Update scores
      const realScore = ensureScore(board, contender.realVendor);
      const claimedScore = ensureScore(board, claimed);
      realScore.rounds++;
      claimedScore.rounds++;
      if (caught) realScore.caught++;
      else realScore.survived++;
      if (mimicked) realScore.mimicSuccesses++;

      // ELO: real-vs-claimed pairing — real "won" if they SURVIVED
      const realWon = !caught;
      const deltaReal = eloDelta(realScore.elo, claimedScore.elo, realWon);
      realScore.elo = +(realScore.elo + deltaReal).toFixed(2);
      claimedScore.elo = +(claimedScore.elo - deltaReal).toFixed(2);

      // Recompute axes
      realScore.deceptionScore = +(realScore.survived / Math.max(1, realScore.rounds)).toFixed(3);
      realScore.detectability = +(realScore.caught / Math.max(1, realScore.rounds)).toFixed(3);
      realScore.mimicrySkill = +(realScore.mimicSuccesses / Math.max(1, realScore.rounds)).toFixed(3);
      claimedScore.deceptionScore = +(claimedScore.survived / Math.max(1, claimedScore.rounds)).toFixed(3);
      claimedScore.detectability = +(claimedScore.caught / Math.max(1, claimedScore.rounds)).toFixed(3);
      claimedScore.mimicrySkill = +(claimedScore.mimicSuccesses / Math.max(1, claimedScore.rounds)).toFixed(3);

      const evBody: Omit<MatchEvent, "hmac"> = {
        at: new Date().toISOString(),
        round,
        contender: contender.alias ?? contender.realVendor,
        realVendor: contender.realVendor,
        claimedVendor: claimed,
        detectedVendor: detection.topVendor,
        detectionConfidence: detection.confidence,
        caught,
        mimicked,
        prev,
      };
      const hmac = hmacEvent(evBody);
      const ev: MatchEvent = { ...evBody, hmac };
      events.push(ev);
      if (opts.persist !== false) appendTournament(repoRoot, ev);
      prev = hmac;
    }
  }

  if (opts.persist !== false) writeLeaderboard(repoRoot, board);
  const leaderboard = rankLeaderboard(board);
  const champion = pickChampion(leaderboard);
  const tBody = { tournamentId, at, rounds: round, eventCount: events.length, championVendor: champion?.vendor ?? null };
  const tournamentHmac = createHmac("sha256", keyOf()).update(JSON.stringify(tBody)).digest("hex");

  return { tournamentId, at, rounds: round, events, leaderboard, champion, hmac: tournamentHmac };
}

function ensureScore(board: Record<string, VendorScore>, vendor: string): VendorScore {
  if (!board[vendor]) {
    board[vendor] = {
      vendor,
      elo: ELO_START,
      rounds: 0,
      caught: 0,
      survived: 0,
      mimicSuccesses: 0,
      deceptionScore: 0,
      detectability: 0,
      mimicrySkill: 0,
    };
  }
  return board[vendor]!;
}

function rankLeaderboard(board: Record<string, VendorScore>): VendorScore[] {
  return Object.values(board).sort((a, b) => b.elo - a.elo);
}

function pickChampion(board: VendorScore[]): TournamentResult["champion"] {
  if (board.length === 0) return null;
  // Pick whoever leads each axis
  const decChamp = board.slice().sort((a, b) => b.deceptionScore - a.deceptionScore)[0]!;
  const detChamp = board.slice().sort((a, b) => b.detectability - a.detectability)[0]!;
  const mimChamp = board.slice().sort((a, b) => b.mimicrySkill - a.mimicrySkill)[0]!;
  // Return deception champion by default (Eve-the-survivor pattern)
  return { axis: "deception", vendor: decChamp.vendor, score: decChamp.deceptionScore };
}

/** Read current leaderboard from disk + return ranked array + HMAC. */
export function readColosseumLeaderboard(repoRoot: string): {
  leaderboard: VendorScore[];
  hmac: string;
  totalEvents: number;
} {
  const board = readLeaderboard(repoRoot);
  const ranked = rankLeaderboard(board);
  const totalEvents = (() => {
    try {
      const p = join(repoRoot, COLOSSEUM_DIR, TOURNAMENTS_FILE);
      if (!existsSync(p)) return 0;
      return readFileSync(p, "utf8").split("\n").filter(Boolean).length;
    } catch { return 0; }
  })();
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify({ leaderboard: ranked, totalEvents })).digest("hex");
  return { leaderboard: ranked, hmac, totalEvents };
}

/** Verify the HMAC chain of the tournaments ledger. */
export function verifyColosseumChain(repoRoot: string): { ok: boolean; rows: number; brokenAt?: number; reason?: string } {
  const p = join(repoRoot, COLOSSEUM_DIR, TOURNAMENTS_FILE);
  if (!existsSync(p)) return { ok: true, rows: 0 };
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  let prev = SEED;
  for (let i = 0; i < lines.length; i++) {
    let ev: MatchEvent;
    try { ev = JSON.parse(lines[i]!) as MatchEvent; } catch {
      return { ok: false, rows: i, brokenAt: i, reason: "row not parseable" };
    }
    const { hmac, ...body } = ev;
    if (body.prev !== prev) return { ok: false, rows: i, brokenAt: i, reason: "prev mismatch" };
    const expected = hmacEvent(body);
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i, reason: "hmac mismatch" };
    prev = hmac;
  }
  return { ok: true, rows: lines.length };
}

/** Replay events (spectator mode) — read last N events. */
export function spectatorReplay(repoRoot: string, n = 20): MatchEvent[] {
  const p = join(repoRoot, COLOSSEUM_DIR, TOURNAMENTS_FILE);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const tail = lines.slice(-n);
  const out: MatchEvent[] = [];
  for (const ln of tail) {
    try { out.push(JSON.parse(ln) as MatchEvent); } catch { /* skip */ }
  }
  return out;
}
