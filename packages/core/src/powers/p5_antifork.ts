/**
 * POWER 5 — ANTI-FORK IMMUNITY (v1.48.0)
 *
 * Mneme code is MIT (forkable). Mneme's DATA + NETWORK is non-forkable
 * by gravity, not by license. This module measures that gravity:
 * vaccines, chain depth, ratified cards, federation size, soul history.
 * Forks can copy code; they can't copy 5 years of accumulated wisdom.
 *
 * IDEA-CHEST:
 *   - Borrow Wikipedia's logic: a fork without ongoing edits dies. The
 *     gravity score is essentially "the cost any fork would have to
 *     replicate before reaching parity".
 *   - Decompose into 5 axes so the report tells you WHICH gravity is
 *     missing if the verdict says "fork-vulnerable".
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GravityReport {
  generatedAt: string;
  axes: {
    vaccines: { count: number; weight: number };
    replayChain: { entries: number; bytes: number; weight: number };
    ratifiedCards: { count: number; weight: number };
    handshakes: { count: number; weight: number };
    cliActivity7d: { ticks: number; weight: number };
    pheromones: { entries: number; weight: number };
  };
  totalGravity: number;            // sum of weights, 0..100+
  verdict: "fork-vulnerable" | "fork-costly" | "fork-prohibitive" | "fork-impossible";
  reasoning: string;
}

function safeFileSize(p: string): number {
  try { return statSync(p).size; } catch { return 0; }
}

function jsonlLineCount(p: string): number {
  if (!existsSync(p)) return 0;
  try { return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length; } catch { return 0; }
}

function dirCount(p: string, suffix?: string): number {
  if (!existsSync(p)) return 0;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.readdirSync(p).filter((f) => suffix ? f.endsWith(suffix) : true).length;
  } catch { return 0; }
}

export function computeGravity(repoRoot: string): GravityReport {
  const root = resolve(repoRoot);
  const dot = join(root, ".mneme");

  // Vaccines
  const vaccinesCount = jsonlLineCount(join(dot, "vaccines.jsonl"));
  // Replay chain
  const replayPath = join(dot, "replay.jsonl");
  const replayEntries = jsonlLineCount(replayPath);
  const replayBytes = safeFileSize(replayPath);
  // Ratified genome cards
  const cardsCount = dirCount(join(dot, "genome-market", "cards"), ".json");
  // Handshakes
  const handshakesCount = dirCount(join(dot, "ai-handshakes"), ".json");
  // CLI activity (last 7d)
  const activityPath = join(dot, "cli-activity.jsonl");
  let cli7d = 0;
  if (existsSync(activityPath)) {
    const cutoff = Date.now() - 7 * 86400 * 1000;
    for (const line of readFileSync(activityPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as { at: string };
        if (Date.parse(e.at) >= cutoff) cli7d++;
      } catch { /* skip */ }
    }
  }
  // Pheromones
  const pheromoneCount = jsonlLineCount(join(dot, "ai-pheromones.jsonl"));

  // Weights tuned so a healthy mature repo crosses 100 by accumulation.
  const w = {
    vaccines: Math.min(30, vaccinesCount * 2),                              // up to 30
    replayChain: Math.min(25, Math.log10(Math.max(1, replayEntries)) * 8),  // log scale
    ratifiedCards: Math.min(20, cardsCount * 1.5),                          // up to 20
    handshakes: Math.min(10, handshakesCount * 1),                          // up to 10
    cliActivity7d: Math.min(10, cli7d * 0.5),                               // up to 10
    pheromones: Math.min(10, pheromoneCount * 0.2),                         // up to 10
  };
  const totalGravity = +(w.vaccines + w.replayChain + w.ratifiedCards + w.handshakes + w.cliActivity7d + w.pheromones).toFixed(2);

  let verdict: GravityReport["verdict"] = "fork-vulnerable";
  if (totalGravity >= 25) verdict = "fork-costly";
  if (totalGravity >= 60) verdict = "fork-prohibitive";
  if (totalGravity >= 90) verdict = "fork-impossible";

  const reasoning = `gravity=${totalGravity}/100+. A fork would have to replicate: ${vaccinesCount} vaccines, ${replayEntries} chain entries, ${cardsCount} ratified cards, ${handshakesCount} handshakes, ${cli7d} CLI ticks/7d, ${pheromoneCount} pheromone deposits.`;

  return {
    generatedAt: new Date().toISOString(),
    axes: {
      vaccines: { count: vaccinesCount, weight: +w.vaccines.toFixed(2) },
      replayChain: { entries: replayEntries, bytes: replayBytes, weight: +w.replayChain.toFixed(2) },
      ratifiedCards: { count: cardsCount, weight: +w.ratifiedCards.toFixed(2) },
      handshakes: { count: handshakesCount, weight: +w.handshakes.toFixed(2) },
      cliActivity7d: { ticks: cli7d, weight: +w.cliActivity7d.toFixed(2) },
      pheromones: { entries: pheromoneCount, weight: +w.pheromones.toFixed(2) },
    },
    totalGravity,
    verdict,
    reasoning,
  };
}
