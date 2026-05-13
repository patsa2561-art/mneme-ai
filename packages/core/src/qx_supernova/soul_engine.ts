/**
 * v1.94.0 -- QX-SUPERNOVA · Soul Engine
 * Autonomous goal generation with a will-vector.
 *
 * Soul Engine reads the daemon's current state (recent failures, idle
 * cycles, gap-scan signals) and proposes NEW internal goals the daemon
 * can pursue without waiting for the user to ask. Each goal carries:
 *
 *   - utility       : expected reward (0..1)
 *   - effort        : estimated cost (0..1)
 *   - willVector    : 5-axis personality signature (curiosity / safety /
 *                     compounding / efficiency / paranoia)
 *
 * Goals are ranked via the Quantum Core. Daemon picks the top-K within
 * its compute budget. Below the threshold → no new goals (system rests).
 *
 *   "Not trained. Evolved."
 */

import {
  collapseProbabilityMatrix,
  type Hypothesis,
  type SignalVector,
} from "./quantum_core.js";

export type WillAxis = "curiosity" | "safety" | "compounding" | "efficiency" | "paranoia";

export type WillVector = Record<WillAxis, number>;

export interface SoulGoal {
  id: string;
  description: string;
  /** 0..1 expected reward. */
  utility: number;
  /** 0..1 effort estimate. */
  effort: number;
  /** Per-axis signature; missing axes default 0.5. */
  willVector: WillVector;
  /** Suggested MCP tool / action to pursue this goal. */
  action: string;
}

export interface SoulContext {
  /** Recent daemon failures (cycle name → count last 24h). */
  failuresLast24h?: Record<string, number>;
  /** Recently-fired vaccines (count). */
  vaccinesFired?: number;
  /** Idle ticks since last user activity. */
  idleTicks?: number;
  /** Mneme HCI score 0..100 (composite health index). */
  hci?: number;
  /** Number of inbox-unsent messages. */
  inboxUnsent?: number;
  /** Token-nova savings ratio over last window 0..1. */
  tokenSavingsRatio?: number;
}

const DEFAULT_WILL: WillVector = {
  curiosity: 0.6,
  safety: 0.7,
  compounding: 0.8,
  efficiency: 0.7,
  paranoia: 0.5,
};

/** Map a SoulGoal to a hypothesis signal vector for the Quantum Core. */
function goalSignals(g: SoulGoal): SignalVector {
  // higher utility, lower effort, balanced will = stronger collapse signal
  return {
    utility: g.utility,
    economy: 1 - g.effort,
    curiosity: g.willVector.curiosity,
    safety: g.willVector.safety,
    compounding: g.willVector.compounding,
    efficiency: g.willVector.efficiency,
    paranoia: g.willVector.paranoia,
  };
}

/** Generate candidate goals from observable state. Pure function. */
export function generateGoals(ctx: SoulContext): SoulGoal[] {
  const goals: SoulGoal[] = [];

  // Goal class A: triage repeated failures
  if (ctx.failuresLast24h) {
    for (const [cycle, count] of Object.entries(ctx.failuresLast24h)) {
      if (count >= 3) {
        goals.push({
          id: `g-triage-${cycle}`,
          description: `Investigate recurring failures in cycle '${cycle}' (${count} in 24h)`,
          utility: Math.min(1, 0.4 + count * 0.05),
          effort: 0.4,
          willVector: { ...DEFAULT_WILL, paranoia: 0.85, safety: 0.85 },
          action: "mneme.supernova.log",
        });
      }
    }
  }

  // Goal class B: pre-empt new vaccines when bank too small
  if ((ctx.vaccinesFired ?? 0) > 5 && (ctx.vaccinesFired ?? 0) < 20) {
    goals.push({
      id: "g-vaccine-grow",
      description: "Run gap-scan + auto-synth new vaccines for under-covered strains",
      utility: 0.75,
      effort: 0.3,
      willVector: { ...DEFAULT_WILL, curiosity: 0.9, compounding: 0.9 },
      action: "mneme.antivirus.gap-scan",
    });
  }

  // Goal class C: idle ticks → curiosity scan
  if ((ctx.idleTicks ?? 0) >= 30) {
    goals.push({
      id: "g-curiosity",
      description: "Idle: explore data-but-no-defense gaps via curiosity scan",
      utility: 0.5,
      effort: 0.2,
      willVector: { ...DEFAULT_WILL, curiosity: 0.95, efficiency: 0.4 },
      action: "mneme.curiosity.scan",
    });
  }

  // Goal class D: HCI low → repair (high utility, lowest effort + paranoia)
  if (ctx.hci !== undefined && ctx.hci < 75) {
    goals.push({
      id: "g-heal",
      description: `HCI ${ctx.hci}/100 — run selfcheck + repair drifted hooks`,
      utility: 0.96,
      effort: 0.3,
      willVector: { ...DEFAULT_WILL, safety: 0.98, paranoia: 0.92, compounding: 0.9 },
      action: "mneme.selfcheck.run",
    });
  }

  // Goal class E: token-savings underperforming → tune weights
  if (ctx.tokenSavingsRatio !== undefined && ctx.tokenSavingsRatio < 0.4) {
    goals.push({
      id: "g-token-tune",
      description: `TOKEN-NOVA savings ${(ctx.tokenSavingsRatio * 100).toFixed(1)}% — re-engineer weights`,
      utility: 0.93,
      effort: 0.4,
      willVector: { ...DEFAULT_WILL, efficiency: 0.97, compounding: 0.92 },
      action: "mneme.qx.reengineer",
    });
  }

  // Goal class F: inbox piling up → drain
  if ((ctx.inboxUnsent ?? 0) >= 10) {
    goals.push({
      id: "g-inbox-drain",
      description: `Inbox piling up (${ctx.inboxUnsent} unsent) — drain or escalate`,
      utility: 0.6,
      effort: 0.15,
      willVector: { ...DEFAULT_WILL, efficiency: 0.85 },
      action: "mneme.inbox.drain",
    });
  }

  return goals;
}

export interface SoulVerdict {
  selected: SoulGoal[];
  rejected: SoulGoal[];
  /** Why the engine picked the selection it did. */
  reason: string;
}

export interface SoulOptions {
  /** Max goals to commit this cycle. Default 3. */
  topK?: number;
  /** Min posterior to commit a goal. Default 0.15. */
  minPosterior?: number;
}

/** Score + rank goals via the Quantum Core, pick top-K above the floor. */
export function decideGoals(ctx: SoulContext, opts: SoulOptions = {}): SoulVerdict {
  const topK = opts.topK ?? 2; // focus: top 2 highest-utility goals only
  const minPosterior = opts.minPosterior ?? 0.15;
  const goals = generateGoals(ctx);
  if (goals.length === 0) {
    return { selected: [], rejected: [], reason: "no goals generated — system at rest" };
  }
  const hyps: Hypothesis<SoulGoal>[] = goals.map((g) => ({
    id: g.id,
    value: g,
    signals: goalSignals(g),
  }));
  const r = collapseProbabilityMatrix(hyps, {});
  const selected: SoulGoal[] = [];
  const rejected: SoulGoal[] = [];
  for (const h of r.ranked) {
    if (selected.length < topK && h.posterior >= minPosterior) selected.push(h.value);
    else rejected.push(h.value);
  }
  return {
    selected,
    rejected,
    reason: `picked top-${selected.length} of ${goals.length} (posterior floor ${minPosterior}, verdict ${r.verdict})`,
  };
}
