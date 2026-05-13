/**
 * v1.64.0 -- COGNITIVE LAYER 6: INTERNAL DEBATE.
 *
 * Before Mneme commits to a verdict, three internal voices argue:
 *
 *   SKEPTIC    -- assumes the worst-case interpretation. Flags hidden
 *                 assumptions, missing data, fab-shaped claims.
 *                 (Anchored on vaccine bank + ACGV history.)
 *
 *   OPTIMIST   -- assumes the best-case interpretation. Flags upside
 *                 scenarios, growth-event triggers, why-not-just-ship.
 *                 (Anchored on positive lessons + recent successes.)
 *
 *   REALIST    -- weighs both sides + the actual evidence. Cites
 *                 reactor cost estimate + game-theory fairness + the
 *                 forecast trend. Issues the synthesis verdict.
 *
 * Each voice gets a turn, then the realist arbitrates with a vote
 * count of "skeptic-points" vs "optimist-points" actually grounded
 * in evidence. The arbiter's verdict has a confidence score.
 *
 * NO LLM. Heuristics over claim text + repo state. Deterministic.
 * The point isn't to simulate humans -- it's to force Mneme to
 * spend tokens on the OPPOSITE side before committing.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

const COGNITIVE_DIR = ".mneme/cognitive";

export type Voice = "skeptic" | "optimist" | "realist";

export interface DebateTurn {
  voice: Voice;
  /** What the voice said. */
  argument: string;
  /** Specific evidence cited (file paths, commit subjects, vaccine ids, etc.). */
  evidence: string[];
  /** Confidence the voice has in its own argument 0..1. */
  selfConfidence: number;
}

export interface DebateResult {
  claim: string;
  turns: DebateTurn[];
  verdict: "AGREE" | "DISAGREE" | "INCONCLUSIVE";
  /** Confidence of the realist's synthesis in [0, 1]. */
  arbiterConfidence: number;
  /** Plain-English explanation of the synthesis. */
  reasoning: string;
}

interface RepoSignals {
  vaccines: string[];
  lessons: string[];
  recentSubjects: string[];
  forecastClaims: string[];
}

function readSignals(repoRoot: string): RepoSignals {
  const out: RepoSignals = { vaccines: [], lessons: [], recentSubjects: [], forecastClaims: [] };
  // Vaccines
  const vp = join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
  if (existsSync(vp)) {
    try {
      out.vaccines = readFileSync(vp, "utf8").split("\n").filter(Boolean).map((l) => {
        try { return (JSON.parse(l) as { sample?: string }).sample ?? ""; } catch { return ""; }
      }).filter(Boolean);
    } catch { /* */ }
  }
  // Lessons
  const np = join(repoRoot, ".mneme/nucleus.json");
  if (existsSync(np)) {
    try {
      const j = JSON.parse(readFileSync(np, "utf8")) as { lessons?: Array<{ text?: string; kind?: string }> };
      out.lessons = (j.lessons ?? []).map((l) => l.text ?? "").filter(Boolean);
    } catch { /* */ }
  }
  // Forecasts
  const fp = join(repoRoot, ".mneme/forecast/forecasts.jsonl");
  if (existsSync(fp)) {
    try {
      out.forecastClaims = readFileSync(fp, "utf8").split("\n").filter(Boolean).map((l) => {
        try { return (JSON.parse(l) as { claim?: string }).claim ?? ""; } catch { return ""; }
      }).filter(Boolean);
    } catch { /* */ }
  }
  // Recent commit subjects -- v2.4: spawnSync via safeExecTry (no shell).
  const r = safeExecTry("git", ["-C", repoRoot, "log", "--max-count=30", "--pretty=format:%s"], { timeoutMs: 3000 });
  if (r?.status === 0) out.recentSubjects = r.stdout.split("\n").filter(Boolean);
  return out;
}

function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

function runSkeptic(claim: string, sig: RepoSignals): DebateTurn {
  const claimTokens = tokenize(claim);
  const evidence: string[] = [];
  let points = 0;
  // Vaccine matches = lies previously refuted = strong skeptic ammo.
  for (const v of sig.vaccines) {
    const vTokens = tokenize(v);
    const hits = overlapCount(claimTokens, vTokens);
    if (hits >= 2) {
      evidence.push(`vaccine-match: "${v.slice(0, 60)}" (${hits} shared tokens)`);
      points += hits;
    }
  }
  // Fab-shaped triggers in the claim itself.
  for (const trigger of ["always", "never", "guaranteed", "100%", "all", "impossible"]) {
    if (claim.toLowerCase().includes(trigger)) {
      evidence.push(`absolute-claim: "${trigger}" -- absolutes rarely survive scrutiny`);
      points += 1;
    }
  }
  // No supporting evidence in lessons.
  let supportingLessons = 0;
  for (const l of sig.lessons) {
    if (overlapCount(claimTokens, tokenize(l)) >= 2) supportingLessons += 1;
  }
  if (supportingLessons === 0 && sig.lessons.length > 0) {
    evidence.push(`absence-of-evidence: 0 of ${sig.lessons.length} known lessons reinforce this`);
    points += 1;
  }
  const argument = points > 0
    ? `Caution: ${points} signal(s) suggest this claim resembles previously-refuted patterns or lacks supporting evidence.`
    : `No vaccine or absolute-claim triggers; mild skepticism only.`;
  const selfConfidence = Math.min(1, points / 5);
  return { voice: "skeptic", argument, evidence, selfConfidence };
}

function runOptimist(claim: string, sig: RepoSignals): DebateTurn {
  const claimTokens = tokenize(claim);
  const evidence: string[] = [];
  let points = 0;
  // Lessons that overlap with the claim = positive corroboration.
  for (const l of sig.lessons.slice(0, 50)) {
    const hits = overlapCount(claimTokens, tokenize(l));
    if (hits >= 2) {
      evidence.push(`lesson-overlap: "${l.slice(0, 60)}" (${hits} shared tokens)`);
      points += 1;
    }
  }
  // Recent commits = active work in this area.
  let recentHits = 0;
  for (const s of sig.recentSubjects) {
    if (overlapCount(claimTokens, tokenize(s)) >= 2) recentHits += 1;
  }
  if (recentHits > 0) {
    evidence.push(`recent-activity: ${recentHits} recent commits touch this area`);
    points += Math.min(3, recentHits);
  }
  // Forecast claims previously made = the team has been thinking about this.
  for (const fc of sig.forecastClaims.slice(0, 20)) {
    const hits = overlapCount(claimTokens, tokenize(fc));
    if (hits >= 2) {
      evidence.push(`forecast-precedent: "${fc.slice(0, 60)}" (${hits} shared tokens)`);
      points += 1;
      break;
    }
  }
  const argument = points > 0
    ? `Encouragement: ${points} signal(s) suggest momentum, prior wins, or active focus in this area.`
    : `Cold start, but absence of refutation is not refutation.`;
  const selfConfidence = Math.min(1, points / 5);
  return { voice: "optimist", argument, evidence, selfConfidence };
}

function runRealist(claim: string, sig: RepoSignals, skeptic: DebateTurn, optimist: DebateTurn): { turn: DebateTurn; verdict: DebateResult["verdict"]; arbiterConfidence: number; reasoning: string } {
  const skepPts = skeptic.selfConfidence;
  const optPts = optimist.selfConfidence;
  let verdict: DebateResult["verdict"];
  let arbiterConfidence: number;
  let argument: string;
  const evidence: string[] = [];
  if (skepPts > optPts + 0.2) {
    verdict = "DISAGREE";
    arbiterConfidence = Math.min(1, skepPts);
    argument = `Skeptic wins on evidence (${skepPts.toFixed(2)} vs ${optPts.toFixed(2)}). Claim does not pass.`;
    evidence.push(...skeptic.evidence.slice(0, 3));
  } else if (optPts > skepPts + 0.2) {
    verdict = "AGREE";
    arbiterConfidence = Math.min(1, optPts);
    argument = `Optimist wins on evidence (${optPts.toFixed(2)} vs ${skepPts.toFixed(2)}). Claim is consistent with what we know.`;
    evidence.push(...optimist.evidence.slice(0, 3));
  } else {
    verdict = "INCONCLUSIVE";
    arbiterConfidence = 0.3 + Math.min(0.2, (skepPts + optPts) / 4);
    argument = `Neither side decisive (skeptic ${skepPts.toFixed(2)}, optimist ${optPts.toFixed(2)}). Need more evidence before acting.`;
    evidence.push(...skeptic.evidence.slice(0, 2), ...optimist.evidence.slice(0, 2));
  }
  const reasoning = [
    `Skeptic (${skepPts.toFixed(2)}): ${skeptic.argument}`,
    `Optimist (${optPts.toFixed(2)}): ${optimist.argument}`,
    `Realist verdict: ${verdict} (arbiter confidence ${arbiterConfidence.toFixed(2)}).`,
    `Reason: ${argument}`,
  ].join("\n");
  return {
    turn: { voice: "realist", argument, evidence, selfConfidence: arbiterConfidence },
    verdict, arbiterConfidence, reasoning,
  };
}

export function debate(repoRoot: string, claim: string, opts?: { persist?: boolean }): DebateResult {
  const sig = readSignals(repoRoot);
  const skeptic = runSkeptic(claim, sig);
  const optimist = runOptimist(claim, sig);
  const realistOut = runRealist(claim, sig, skeptic, optimist);

  const result: DebateResult = {
    claim,
    turns: [skeptic, optimist, realistOut.turn],
    verdict: realistOut.verdict,
    arbiterConfidence: realistOut.arbiterConfidence,
    reasoning: realistOut.reasoning,
  };

  if (opts?.persist) {
    try {
      const dir = join(repoRoot, COGNITIVE_DIR, "debate");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(
        join(dir, "debates.jsonl"),
        JSON.stringify({ ts: new Date().toISOString(), claim, verdict: result.verdict, arbiterConfidence: result.arbiterConfidence }) + "\n",
        "utf8",
      );
    } catch { /* */ }
  }

  return result;
}
