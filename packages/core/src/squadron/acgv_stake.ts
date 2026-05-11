/**
 * v1.51.0 — ACGV LAYER 6: ECONOMIC STAKE + BOT KARMA.
 *
 * Each bot in the squadron stakes karma proportional to its confidence
 * on every verdict. When a verdict turns out to be wrong (caught by
 * Chandrasekhar BLACK_HOLE or Godel UNSAT post-mortem), the staking bot
 * loses karma. Over time bots calibrate themselves: confident-and-wrong
 * loses more karma than confident-and-right.
 *
 * Formula:
 *
 *   karma_delta = +stake if verdict correct
 *               = -stake * confidence^2 * (1 - prior_calibration) if wrong
 *
 * Confidence^2 punishes overconfident lies harder than humble ones.
 * Prior calibration softens the blow for new bots and amplifies it for
 * habitual liars.
 *
 * Storage: .mneme/squadron/bot-karma.json
 *
 * Bots with karma <= 0 are MUTED -- their votes are still recorded but
 * the aggregator weights them by 0 until they recover. This creates a
 * market-driven trust mechanism without any human in the loop.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BotKarma {
  bot: string;
  /** Net karma. Starts at 10. Bots <= 0 are muted. */
  karma: number;
  /** Verdicts where the bot was confirmed correct. */
  verifiedCorrect: number;
  /** Verdicts where the bot was caught wrong (by Chandrasekhar/Godel). */
  caughtWrong: number;
  /** Brier-like calibration: 1.0 perfect, 0.0 maximally miscalibrated. */
  calibration: number;
  /** Last update timestamp. */
  updatedAt: string;
}

export interface KarmaLedger {
  bots: Record<string, BotKarma>;
  /** Total stakes recorded across all time. */
  totalStakes: number;
  /** Cumulative karma transferred (sum of |delta|). */
  totalChurn: number;
}

const KARMA_FILE = join(".mneme", "squadron", "bot-karma.json");

function karmaPath(repoRoot: string): string {
  return join(repoRoot, KARMA_FILE);
}

function emptyLedger(): KarmaLedger {
  return { bots: {}, totalStakes: 0, totalChurn: 0 };
}

export function loadKarma(repoRoot: string): KarmaLedger {
  const path = karmaPath(repoRoot);
  if (!existsSync(path)) return emptyLedger();
  try {
    const body = readFileSync(path, "utf8");
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && parsed.bots) return parsed as KarmaLedger;
    return emptyLedger();
  } catch {
    return emptyLedger();
  }
}

export function saveKarma(repoRoot: string, ledger: KarmaLedger): void {
  try {
    const dir = join(repoRoot, ".mneme", "squadron");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(karmaPath(repoRoot), JSON.stringify(ledger, null, 2), "utf8");
  } catch { /* best-effort */ }
}

function getOrInit(ledger: KarmaLedger, bot: string): BotKarma {
  let k = ledger.bots[bot];
  if (!k) {
    k = {
      bot,
      karma: 10,
      verifiedCorrect: 0,
      caughtWrong: 0,
      calibration: 0.5,
      updatedAt: new Date().toISOString(),
    };
    ledger.bots[bot] = k;
  }
  return k;
}

/** Record an outcome. `correct=true` rewards the bot; `correct=false`
 *  punishes proportional to confidence^2 * (1 - calibration). */
export function noteBotOutcome(
  repoRoot: string,
  bot: string,
  confidence: number,
  correct: boolean,
): BotKarma {
  const ledger = loadKarma(repoRoot);
  const k = getOrInit(ledger, bot);
  const stake = Math.max(0.1, confidence);
  let delta: number;
  if (correct) {
    delta = stake;
    k.verifiedCorrect += 1;
  } else {
    // (1 - calibration) can hit 0 for a bot with a flawless tiny sample,
    // which would shield it from any punishment -- exactly the wrong
    // incentive. Floor at 0.1 so every caught-wrong call carries weight.
    const miscalibrationFactor = Math.max(0.1, 1 - k.calibration);
    const punishment = stake * confidence * confidence * miscalibrationFactor;
    delta = -punishment;
    k.caughtWrong += 1;
  }
  k.karma = Math.max(-50, Math.min(1000, k.karma + delta));
  // Recompute calibration: ratio of correct verdicts.
  const total = k.verifiedCorrect + k.caughtWrong;
  k.calibration = total === 0 ? 0.5 : k.verifiedCorrect / total;
  k.updatedAt = new Date().toISOString();
  ledger.totalStakes += stake;
  ledger.totalChurn += Math.abs(delta);
  saveKarma(repoRoot, ledger);
  return k;
}

/** Weight to apply to a bot's vote based on its karma. Muted bots return 0;
 *  full-karma bots return 1; punished-but-alive bots get partial weight. */
export function voteWeight(repoRoot: string, bot: string): number {
  const ledger = loadKarma(repoRoot);
  const k = ledger.bots[bot];
  if (!k) return 1; // new bots get full weight
  if (k.karma <= 0) return 0;
  if (k.karma >= 10) return 1;
  return Math.max(0.1, k.karma / 10);
}
