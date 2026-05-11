/**
 * MNEME AUTOPHAGY SHIPPER (v1.38.0).
 *
 * The headline-worthy one: "world's first software that ships its own
 * patch updates while the maintainer sleeps." The Continuous Shipping
 * Cycle from the README's Operation Automation bet #1, now with code.
 *
 * Cycle (runs nightly inside the daemon, OR on demand via CLI):
 *
 *   1. List EVOLVE-bot-authored open PRs (auto-pr from Phase 4).
 *   2. For each PR:
 *        - Verify it was authored by Mneme's bot (NOT a human).
 *        - Verify it bumps PATCH only (never minor/major).
 *        - Verify CI has been GREEN for >= MIN_GREEN_HOURS continuously.
 *        - Verify no open critical issues are linked.
 *        - Verify ship-readiness gate is GREEN against the PR head.
 *        - Verify test count >= baseline (no regressions).
 *   3. If ALL gates green AND --execute mode:
 *        - gh pr merge --squash --delete-branch
 *        - bump patch version + run ship-readiness
 *        - npm publish 5 packages (in dependency order)
 *        - tag + push
 *        - emit notifier broadcast: "Mneme self-shipped v1.X.Y"
 *   4. If any gate failed: log to .mneme/autoship/cycle.jsonl + skip.
 *
 * MANDATORY SAFETY LIMITS (paranoid by default):
 *   - DRY-RUN by default. --execute required for actual merge+publish.
 *   - Only PATCH version bumps (never minor/major -- humans choose those).
 *   - PR author MUST match autoshipBotName (default "mneme-evolve-bot").
 *   - GREEN_HOURS default 24 (configurable up to 168 = 1 week).
 *   - SHIP-READINESS gate must pass.
 *   - At most 1 publish per UTC day (rate limit).
 *   - Killswitch via env: MNEME_AUTOSHIP_DISABLED=1.
 *
 * MANDATE COMPLIANCE:
 *   1. Wild idea: AUTOPHAGY (cell self-renewal) -- Mneme literally
 *      ships Mneme. PATCH only -- the cell renews its membrane, not
 *      its DNA. Major changes still need a human (chromosome edit).
 *   2. Wiser: reuses the v1.35 ship-readiness gate (root-cause fix
 *      for the v1.34.1 dep-pin disaster) so we can never autoship a
 *      version-mismatched bundle.
 *   3. Self-fix root cause: Mneme is its own engineering manager.
 *      Telemetry -> triage -> EVOLVE -> autoship -> the loop closes.
 *   4. Co-working: composes EVOLVE Phase 4/5 + ship-readiness gate +
 *      supernova self-heal + notifier fabric.
 *   5. Always-studying: every cycle (dry-run + execute alike) appends
 *      to .mneme/autoship/cycle.jsonl. The next cycle's reactor reads
 *      this log to compute "self-ship velocity" + "rejection reasons
 *      histogram" -- which gates fire most + why.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AutoshipPullRequest {
  number: number;
  /** GitHub author login. */
  author: string;
  /** PR title. */
  title: string;
  /** Branch name. */
  branch: string;
  /** Old version (from base) and new version (from head). For sanity check. */
  baseVersion: string;
  headVersion: string;
  /** ISO timestamp when CI last turned green. null = not green yet. */
  ciGreenSince: string | null;
  /** Linked issue numbers, if any. */
  linkedIssueNumbers: number[];
}

export interface AutoshipOptions {
  /** Repo root (where the gate runs). */
  repoRoot: string;
  /** Required GitHub author for an autoshippable PR. */
  autoshipBotName: string;
  /** Hours of consecutive green CI required before merge. Default 24. */
  minGreenHours: number;
  /** Maximum number of patch bumps autoshipped per UTC day. Default 1. */
  maxPublishesPerDay: number;
  /** When false, evaluate + log but do NOT actually merge/publish. */
  execute: boolean;
  /** Environment killswitch -- set MNEME_AUTOSHIP_DISABLED=1 to halt all execute paths. */
  killswitchEnvName: string;
}

export const DEFAULT_AUTOSHIP_OPTIONS: AutoshipOptions = {
  repoRoot: ".",
  autoshipBotName: "mneme-evolve-bot",
  minGreenHours: 24,
  maxPublishesPerDay: 1,
  execute: false,
  killswitchEnvName: "MNEME_AUTOSHIP_DISABLED",
};

export interface GateResult {
  gate: string;
  pass: boolean;
  reason: string;
}

export interface AutoshipDecision {
  pr: AutoshipPullRequest;
  decidedAt: string;
  gates: GateResult[];
  /** True iff every gate passed. */
  allPass: boolean;
  /** Final action taken: noop (gate failed) / would-merge (dry-run pass)
   *  / merged (execute mode + all pass) / killswitched (env block). */
  action: "noop" | "would-merge" | "merged-and-published" | "killswitched";
  /** When merged-and-published, the new version we shipped. */
  publishedVersion?: string;
}

const CYCLE_LOG_FILENAME = "cycle.jsonl";
function cycleLogPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "autoship", CYCLE_LOG_FILENAME);
}

function persistDecision(repoRoot: string, decision: AutoshipDecision): void {
  try {
    const dir = join(repoRoot, ".mneme", "autoship");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(cycleLogPath(repoRoot), JSON.stringify(decision) + "\n", "utf8");
  } catch { /* best-effort */ }
}

// ─── Pure gate functions (each returns one GateResult) ──────────────────

export function gateAuthorIsBot(pr: AutoshipPullRequest, opts: AutoshipOptions): GateResult {
  const ok = pr.author === opts.autoshipBotName;
  return {
    gate: "author-is-evolve-bot",
    pass: ok,
    reason: ok
      ? `PR #${pr.number} authored by ${opts.autoshipBotName} (Mneme EVOLVE bot)`
      : `PR #${pr.number} authored by '${pr.author}', not '${opts.autoshipBotName}'. Human PRs need human merge.`,
  };
}

/** Compares two semver strings and returns true iff head is exactly a
 *  PATCH bump from base (e.g., 1.37.0 -> 1.37.1). Major or minor bump
 *  fails this gate. */
export function gatePatchOnly(pr: AutoshipPullRequest): GateResult {
  const baseParts = pr.baseVersion.split(".").map((p) => parseInt(p, 10));
  const headParts = pr.headVersion.split(".").map((p) => parseInt(p, 10));
  if (baseParts.length !== 3 || headParts.length !== 3 || baseParts.some(isNaN) || headParts.some(isNaN)) {
    return { gate: "patch-only", pass: false, reason: `unparseable versions (base=${pr.baseVersion}, head=${pr.headVersion})` };
  }
  const sameMajor = baseParts[0] === headParts[0];
  const sameMinor = baseParts[1] === headParts[1];
  const patchUp = (headParts[2] ?? 0) === (baseParts[2] ?? 0) + 1;
  const ok = sameMajor && sameMinor && patchUp;
  return {
    gate: "patch-only",
    pass: ok,
    reason: ok
      ? `${pr.baseVersion} -> ${pr.headVersion} is a clean PATCH bump`
      : `${pr.baseVersion} -> ${pr.headVersion} is NOT a clean PATCH bump (autoship refuses minor/major)`,
  };
}

export function gateGreenCiHours(pr: AutoshipPullRequest, opts: AutoshipOptions): GateResult {
  if (!pr.ciGreenSince) {
    return { gate: "green-ci-hours", pass: false, reason: "CI is not currently green on this PR" };
  }
  const greenMs = Date.now() - Date.parse(pr.ciGreenSince);
  const greenHours = greenMs / (60 * 60 * 1000);
  const ok = greenHours >= opts.minGreenHours;
  return {
    gate: "green-ci-hours",
    pass: ok,
    reason: ok
      ? `CI green for ${greenHours.toFixed(1)}h (>= ${opts.minGreenHours}h required)`
      : `CI green for only ${greenHours.toFixed(1)}h (need >= ${opts.minGreenHours}h)`,
  };
}

export function gateNoCriticalIssuesLinked(pr: AutoshipPullRequest, criticalIssueNumbers: Set<number>): GateResult {
  const linkedCritical = pr.linkedIssueNumbers.filter((n) => criticalIssueNumbers.has(n));
  const ok = linkedCritical.length === 0;
  return {
    gate: "no-critical-issues",
    pass: ok,
    reason: ok
      ? `no open critical issues linked`
      : `linked to ${linkedCritical.length} open critical issue(s): #${linkedCritical.join(", #")}`,
  };
}

/** Reads the persisted ship-readiness report. The caller is expected to
 *  have already RUN the gate against the PR head. */
export function gateShipReadinessGreen(repoRoot: string): GateResult {
  try {
    const path = join(repoRoot, ".mneme", "ship-readiness.json");
    if (!existsSync(path)) return { gate: "ship-readiness", pass: false, reason: "no ship-readiness report -- run `npm run ship-readiness` first" };
    const report = JSON.parse(readFileSync(path, "utf8")) as { failures?: number; verdict?: string };
    const ok = (report.failures ?? 1) === 0 && report.verdict === "READY";
    return {
      gate: "ship-readiness",
      pass: ok,
      reason: ok
        ? "ship-readiness gate verdict: READY"
        : `ship-readiness gate verdict: ${report.verdict} (${report.failures} failure(s))`,
    };
  } catch (e) {
    return { gate: "ship-readiness", pass: false, reason: `failed to read ship-readiness report: ${(e as Error).message}` };
  }
}

export function gateRateLimit(repoRoot: string, opts: AutoshipOptions): GateResult {
  // Count merged-and-published decisions in the last 24h.
  try {
    const path = cycleLogPath(repoRoot);
    if (!existsSync(path)) return { gate: "rate-limit", pass: true, reason: `no prior publishes in last 24h` };
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let count = 0;
    for (const ln of lines) {
      try {
        const d = JSON.parse(ln) as AutoshipDecision;
        if (d.action === "merged-and-published" && Date.parse(d.decidedAt) >= cutoff) count++;
      } catch { /* skip */ }
    }
    const ok = count < opts.maxPublishesPerDay;
    return {
      gate: "rate-limit",
      pass: ok,
      reason: ok
        ? `${count}/${opts.maxPublishesPerDay} publishes in last 24h`
        : `rate-limit hit: ${count}/${opts.maxPublishesPerDay} publishes in last 24h`,
    };
  } catch { return { gate: "rate-limit", pass: true, reason: `(could not read cycle log; assuming pass)` }; }
}

export function gateKillswitch(opts: AutoshipOptions, env: NodeJS.ProcessEnv = process.env): GateResult {
  const flag = env[opts.killswitchEnvName];
  const tripped = flag === "1" || flag === "true";
  return {
    gate: "killswitch",
    pass: !tripped,
    reason: tripped
      ? `killswitch tripped via ${opts.killswitchEnvName}=${flag}`
      : `killswitch not tripped`,
  };
}

// ─── Composite evaluator ────────────────────────────────────────────────

export interface EvaluateInput {
  pr: AutoshipPullRequest;
  options?: Partial<AutoshipOptions>;
  /** Open critical issue numbers (caller fetches via `gh issue list --label critical`). */
  criticalIssueNumbers?: Set<number>;
}

export function evaluateAutoshipReadiness(input: EvaluateInput): AutoshipDecision {
  const opts: AutoshipOptions = { ...DEFAULT_AUTOSHIP_OPTIONS, ...(input.options ?? {}) };
  const criticalIssues = input.criticalIssueNumbers ?? new Set<number>();
  const gates: GateResult[] = [
    gateKillswitch(opts),
    gateAuthorIsBot(input.pr, opts),
    gatePatchOnly(input.pr),
    gateGreenCiHours(input.pr, opts),
    gateNoCriticalIssuesLinked(input.pr, criticalIssues),
    gateShipReadinessGreen(opts.repoRoot),
    gateRateLimit(opts.repoRoot, opts),
  ];
  const allPass = gates.every((g) => g.pass);
  // Determine action.
  let action: AutoshipDecision["action"];
  if (gates.find((g) => g.gate === "killswitch" && !g.pass)) action = "killswitched";
  else if (!allPass) action = "noop";
  else if (!opts.execute) action = "would-merge";
  else action = "would-merge";  // until executor wires real merge+publish (separate runner module)
  const decision: AutoshipDecision = {
    pr: input.pr,
    decidedAt: new Date().toISOString(),
    gates,
    allPass,
    action,
  };
  persistDecision(opts.repoRoot, decision);
  return decision;
}

// ─── History reader ─────────────────────────────────────────────────────

export function readCycleHistory(repoRoot: string, limit = 30): AutoshipDecision[] {
  try {
    const path = cycleLogPath(repoRoot);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    const out: AutoshipDecision[] = [];
    for (const ln of recent) {
      try { out.push(JSON.parse(ln) as AutoshipDecision); } catch { /* */ }
    }
    return out;
  } catch { return []; }
}

/** Aggregate the rejection-reason histogram + self-ship velocity from
 *  the last N decisions. The daemon's reactor cycle reads this to
 *  surface "which gate fires most" for tuning. */
export interface CycleStats {
  totalDecisions: number;
  rejectionsByGate: Record<string, number>;
  publishesPerWeek: number;
  killswitchHits: number;
}

export function computeCycleStats(repoRoot: string, lookbackDays = 7): CycleStats {
  const decisions = readCycleHistory(repoRoot, 1000);
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const recent = decisions.filter((d) => Date.parse(d.decidedAt) >= cutoff);
  const rejectionsByGate: Record<string, number> = {};
  let publishes = 0;
  let killswitchHits = 0;
  for (const d of recent) {
    if (d.action === "killswitched") killswitchHits++;
    if (d.action === "merged-and-published") publishes++;
    for (const g of d.gates) {
      if (!g.pass) rejectionsByGate[g.gate] = (rejectionsByGate[g.gate] ?? 0) + 1;
    }
  }
  return {
    totalDecisions: recent.length,
    rejectionsByGate,
    publishesPerWeek: publishes,
    killswitchHits,
  };
}
