/**
 * MNEME OVERNIGHT RUNNER (v1.34.0).
 *
 * Direct response to ARIS's killer UX: "go to sleep -> wake up to
 * better work." We generalize beyond AI research papers: any
 * goal-driven multi-round transformation of a repo runs through this
 * runner. After the configured number of rounds (or budget exhausted),
 * the user wakes up to a morning report at .mneme/overnight/<id>/REPORT.md.
 *
 * Stages per round:
 *
 *   1. PLAN    -- the round's plan based on the goal + prior round's findings
 *   2. ACT     -- caller-supplied actor function executes the plan
 *                 (returns a "delta" describing what changed)
 *   3. REVIEW  -- the QUARK JURY scores the delta (NUCLEAR FUSION)
 *   4. DECIDE  -- merge / merge-with-watch / review / reject
 *                 + RECORD round metrics + write per-round markdown
 *
 * Hard guardrails (matching ARIS, plus our own):
 *   - max-rounds (default 4 -- same as ARIS)
 *   - max-wall-seconds (default 4 hours -- equivalent of "4 GPU-hours")
 *   - max-cost-usd (optional -- when caller estimates cost per round)
 *   - reject-streak-stop (2 consecutive rejects -> stop, don't keep
 *     burning cycles)
 *   - critical-error-stop (any thrown error in actor -> stop)
 *
 * KILLER IDEA -- WISDOM-Q AUTO-STOP (uses wisdom_reactor):
 *   Each round records a Q-score (LOC delta x confidence). If Q is
 *   negative for 2 consecutive rounds, auto-stop -- we're regressing,
 *   no point in continuing. ARIS doesn't have this; their loop just
 *   runs until 4-round cap.
 *
 * Free path: actor + reviewers can both be local Ollama. No API key
 * required for the headline workflow.
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Reviewer } from "./conscience.js";
import { holdCourt } from "./conscience.js";
import { fuseQuarkVerdicts, spawnQuarkJury, type FusionVerdict } from "./quark_jury.js";

export interface OvernightGoal {
  /** Human-readable goal, e.g., "raise test coverage to 90%". */
  description: string;
  /** Optional kind hint -- routes to domain-specific QUARK weighting. */
  workItemKind?: "evolve-patch" | "vaccine-proposal" | "refactor" | "docs" | "other";
}

export interface OvernightBudget {
  /** Maximum rounds to attempt. ARIS default = 4. */
  maxRounds: number;
  /** Maximum total wall-time in seconds. */
  maxWallSec: number;
  /** Maximum estimated cost in USD (when actor returns costEstimate). */
  maxCostUsd?: number;
  /** Stop if N consecutive rounds reject. */
  rejectStreakStop?: number;
  /** Stop if N consecutive rounds yield negative Q. */
  negativeQStreakStop?: number;
}

export const DEFAULT_BUDGET: OvernightBudget = {
  maxRounds: 4,
  maxWallSec: 4 * 60 * 60,
  maxCostUsd: undefined,
  rejectStreakStop: 2,
  negativeQStreakStop: 2,
};

export interface ActorRoundInput {
  goal: OvernightGoal;
  roundNumber: number;
  /** Findings from prior rounds (null on round 1). */
  priorFindings: RoundResult[];
}

export interface ActorRoundOutput {
  /** One-paragraph description of what the actor did this round. */
  description: string;
  /** Optional before/after snippets for the court. */
  before?: string;
  after?: string;
  /** Caller-computed Q-score: (LOC removed - LOC added) * confidence.
   *  Positive = compression / improvement; negative = added complexity. */
  qScore?: number;
  /** Caller-estimated cost in USD for this round (optional). */
  costEstimateUsd?: number;
  /** Free-form context the reviewer should see. */
  context?: string;
}

export interface RoundResult {
  roundNumber: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  actorOutput: ActorRoundOutput;
  fusion: FusionVerdict;
  costUsd: number;
  /** Stable id for the round artifact directory. */
  roundId: string;
}

export interface OvernightSession {
  sessionId: string;
  goal: OvernightGoal;
  budget: OvernightBudget;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totalCostUsd: number;
  rounds: RoundResult[];
  /** Why the session ended (one of: budget-rounds, budget-time,
   *  budget-cost, reject-streak, negative-q-streak, actor-error,
   *  manual-stop, complete). */
  stopReason: string;
  /** Final wisdom yield = sum of accepted rounds' Q-scores. */
  totalYield: number;
  /** Path to the morning report. */
  reportPath: string;
}

/** Caller supplies an actor that does the actual work each round. */
export type Actor = (input: ActorRoundInput) => Promise<ActorRoundOutput>;

function sessionDir(repoRoot: string, sessionId: string): string {
  return join(repoRoot, ".mneme", "overnight", sessionId);
}

function makeSessionId(goal: string): string {
  return createHash("sha256").update(goal).update(new Date().toISOString()).digest("hex").slice(0, 10);
}

/** Write a per-round markdown artifact to .mneme/overnight/<id>/round-N.md. */
function writeRoundArtifact(repoRoot: string, sessionId: string, r: RoundResult): void {
  try {
    const dir = sessionDir(repoRoot, sessionId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    lines.push(`# Overnight session ${sessionId} -- round ${r.roundNumber}`);
    lines.push(``);
    lines.push(`**Started**: ${r.startedAt}`);
    lines.push(`**Finished**: ${r.finishedAt}  (${r.durationMs}ms)`);
    lines.push(`**Cost**: $${r.costUsd.toFixed(4)}`);
    lines.push(``);
    lines.push(`## Actor output`);
    lines.push(``);
    lines.push(r.actorOutput.description);
    lines.push(``);
    if (r.actorOutput.qScore != null) lines.push(`**Q-score**: ${r.actorOutput.qScore.toFixed(2)}`);
    lines.push(``);
    lines.push(`## QUARK JURY verdict (NUCLEAR FUSION)`);
    lines.push(``);
    lines.push(`${r.fusion.banner}`);
    lines.push(``);
    for (const f of r.fusion.flavors) {
      const flag = f.accept ? "✓" : "✗";
      lines.push(`- ${flag} **${f.flavor.toUpperCase()}** -- score ${f.score.toFixed(1)}: ${f.reason}`);
    }
    lines.push(``);
    lines.push(`**Energy yield (domain-weighted)**: ${r.fusion.energyYield.toFixed(2)}`);
    writeFileSync(join(dir, `round-${r.roundNumber}.md`), lines.join("\n"), "utf8");
  } catch { /* best-effort */ }
}

/** Write the final morning report aggregating every round. */
function writeMorningReport(repoRoot: string, session: OvernightSession): string {
  const dir = sessionDir(repoRoot, session.sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "REPORT.md");
  const lines: string[] = [];
  lines.push(`# 🌅 Mneme Overnight Report -- ${session.sessionId}`);
  lines.push(``);
  lines.push(`**Goal**: ${session.goal.description}`);
  lines.push(`**Started**: ${session.startedAt}`);
  lines.push(`**Finished**: ${session.finishedAt}  (${(session.totalDurationMs / 1000).toFixed(1)}s)`);
  lines.push(`**Total cost**: $${session.totalCostUsd.toFixed(4)}`);
  lines.push(`**Stop reason**: ${session.stopReason}`);
  lines.push(`**Total wisdom yield**: ${session.totalYield.toFixed(2)} (sum of accepted rounds' Q-scores)`);
  lines.push(``);
  lines.push(`## Per-round summary`);
  lines.push(``);
  lines.push(`| # | Band | Mean | Variance | Q-score | Cost |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of session.rounds) {
    const flag = r.fusion.band === "merge-stable" ? "✓ stable"
      : r.fusion.band === "merge-with-watch" ? "⚠ watch"
      : r.fusion.band === "review" ? "· review"
      : "✗ reject";
    const q = r.actorOutput.qScore != null ? r.actorOutput.qScore.toFixed(2) : "n/a";
    lines.push(`| ${r.roundNumber} | ${flag} | ${r.fusion.meanScore.toFixed(1)} | ${r.fusion.variance.toFixed(2)} | ${q} | $${r.costUsd.toFixed(4)} |`);
  }
  lines.push(``);
  lines.push(`## Recommended next step`);
  lines.push(``);
  const lastAccepted = [...session.rounds].reverse().find((r) => r.fusion.band === "merge-stable" || r.fusion.band === "merge-with-watch");
  if (lastAccepted) {
    lines.push(`Round ${lastAccepted.roundNumber} produced an accepted change. Review:`);
    lines.push(`  \`.mneme/overnight/${session.sessionId}/round-${lastAccepted.roundNumber}.md\``);
  } else {
    lines.push(`No round produced a clean accept. Review the per-round artifacts to triage what went wrong; consider relaxing the goal or providing more context.`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by Mneme Overnight Runner v1.34.0. The actor + jury were configured per session; see round artifacts for individual verdicts.*`);
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

/** The main loop. Caller supplies the actor + the jury composition. */
export async function runOvernight(opts: {
  repoRoot: string;
  goal: OvernightGoal;
  actor: Actor;
  jury?: Reviewer[];
  /** When the jury is omitted, we spawn a 6-quark jury from this base reviewer. */
  baseReviewer?: Reviewer;
  budget?: OvernightBudget;
  /** Optional progress callback fired after every round. */
  onRound?: (r: RoundResult) => void | Promise<void>;
}): Promise<OvernightSession> {
  const sessionId = makeSessionId(opts.goal.description);
  const budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
  const startedAtIso = new Date().toISOString();
  const t0 = Date.now();
  const rounds: RoundResult[] = [];
  let totalCostUsd = 0;
  let stopReason = "complete";
  let rejectStreak = 0;
  let negativeQStreak = 0;

  // Jury: explicit or auto-spawned 6-quark from a base reviewer.
  const jury: Reviewer[] = opts.jury
    ? opts.jury
    : opts.baseReviewer
      ? spawnQuarkJury(opts.baseReviewer)
      : [];

  for (let n = 1; n <= budget.maxRounds; n++) {
    // Budget checks (before the round runs).
    const elapsedSec = (Date.now() - t0) / 1000;
    if (elapsedSec >= budget.maxWallSec) { stopReason = "budget-time"; break; }
    if (budget.maxCostUsd != null && totalCostUsd >= budget.maxCostUsd) { stopReason = "budget-cost"; break; }

    const roundStart = Date.now();
    const roundStartedIso = new Date().toISOString();
    let actorOutput: ActorRoundOutput;
    try {
      actorOutput = await opts.actor({ goal: opts.goal, roundNumber: n, priorFindings: rounds });
    } catch (e) {
      stopReason = `actor-error: ${(e as Error).message}`;
      break;
    }

    const review = await holdCourt(jury, {
      workItemKind: opts.goal.workItemKind ?? "other",
      description: actorOutput.description,
      before: actorOutput.before,
      after: actorOutput.after,
      context: actorOutput.context,
    });
    const fusion = fuseQuarkVerdicts(review.individualVerdicts, opts.goal.workItemKind ?? "other");

    const costUsd = actorOutput.costEstimateUsd ?? 0;
    totalCostUsd += costUsd;
    const r: RoundResult = {
      roundNumber: n,
      startedAt: roundStartedIso,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - roundStart,
      actorOutput,
      fusion,
      costUsd,
      roundId: createHash("sha256").update(sessionId).update(String(n)).digest("hex").slice(0, 8),
    };
    rounds.push(r);
    writeRoundArtifact(opts.repoRoot, sessionId, r);
    try { await opts.onRound?.(r); } catch { /* */ }

    // Streak guards.
    if (r.fusion.band === "reject") rejectStreak++; else rejectStreak = 0;
    if ((actorOutput.qScore ?? 0) < 0) negativeQStreak++; else negativeQStreak = 0;
    if (budget.rejectStreakStop != null && rejectStreak >= budget.rejectStreakStop) {
      stopReason = `reject-streak (${rejectStreak} consecutive)`;
      break;
    }
    if (budget.negativeQStreakStop != null && negativeQStreak >= budget.negativeQStreakStop) {
      stopReason = `negative-q-streak (${negativeQStreak} consecutive negative Q)`;
      break;
    }
  }

  const finishedAtIso = new Date().toISOString();
  const session: OvernightSession = {
    sessionId,
    goal: opts.goal,
    budget,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    totalDurationMs: Date.now() - t0,
    totalCostUsd,
    rounds,
    stopReason,
    totalYield: rounds
      .filter((r) => r.fusion.band === "merge-stable" || r.fusion.band === "merge-with-watch")
      .reduce((acc, r) => acc + (r.actorOutput.qScore ?? 0), 0),
    reportPath: "",
  };
  session.reportPath = writeMorningReport(opts.repoRoot, session);
  // Append a session-summary line to a global overnight log.
  try {
    const logPath = join(opts.repoRoot, ".mneme", "overnight", "sessions.jsonl");
    if (!existsSync(join(opts.repoRoot, ".mneme", "overnight"))) {
      mkdirSync(join(opts.repoRoot, ".mneme", "overnight"), { recursive: true });
    }
    appendFileSync(logPath, JSON.stringify({
      sessionId, startedAt: startedAtIso, finishedAt: finishedAtIso,
      goal: opts.goal.description, rounds: rounds.length,
      totalCostUsd, totalYield: session.totalYield, stopReason,
    }) + "\n", "utf8");
  } catch { /* best-effort */ }
  return session;
}
