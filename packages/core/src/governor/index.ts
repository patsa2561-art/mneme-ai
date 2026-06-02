/**
 * v2.145.0 — THE AGENT GOVERNOR. The capstone: an orchestrator-agnostic, signed
 * GOVERNANCE KERNEL that sits UNDER any agent platform (Astra / Claude Code /
 * Tycoon / AutoGen / CrewAI) and makes a fleet of autonomous agents provably
 * safe + accountable — automatically, as a continuous batch, with the human in
 * the loop ONLY for genuinely-irreversible actions.
 *
 * It does NOT compete with orchestrators (a crowded, capital-heavy race) — it is
 * the thing they all structurally lack and won't build (it conflicts with the
 * "look how autonomous!" pitch + they optimise for ACTION, not governance). That
 * gap is the buyer-side moat.
 *
 * It is the GRAND UNIFICATION of this session's primitives: per action it folds
 * the gates' signals — CERBERUS (command risk) · CRUCIBLE (shadow verdict) ·
 * TELOS (drift) · REGRET (outcome calibration) · ELLEIPSIS (completeness) ·
 * irreversibility — into ONE verdict, runs the whole queue as an AUTO-OPERATION
 * BATCH, auto-compensates a half-failed run (SAGA), trips a circuit-breaker on
 * drift, and lets the autonomy envelope grow/shrink by EVIDENCE (Living Charter).
 *
 * "Fully autonomous" — honestly: the SAFE, reversible, in-envelope flow runs
 * untouched (the human is not a bottleneck); only the genuinely-irreversible /
 * out-of-envelope / forbidden escalates. Autonomy is bounded by a MECHANICAL,
 * SIGNED envelope — not by a human watching, and never by Mneme self-installing.
 *
 * DIAKRISIS — the honest ceiling: the Governor DECIDES, SEQUENCES, ESCALATES, and
 * COMPENSATES; it does NOT execute the agent's work (that's the orchestrator's
 * job — Mneme is the kernel, not the executor). Its guarantees are mechanical:
 * an irreversible / out-of-scope / over-budget / forbidden action can NEVER be
 * ALLOW_AUTONOMOUS, and a non-MERGE shadow / DIVERGENT drift can never auto-run.
 * Pure + deterministic + total (the CLI/MCP add the signature + the real gate I/O).
 */

export type RiskLevel = "read" | "write" | "destructive";
const RISK_ORDER: Record<RiskLevel, number> = { read: 0, write: 1, destructive: 2 };

export interface Charter {
  mission: string;
  scopeGlobs: string[];                 // paths the fleet may touch ([] = unrestricted scope check)
  riskEnvelope: RiskLevel;              // max command-risk allowed AUTONOMOUSLY (destructive ⇒ always escalates)
  budget: { maxActions: number; maxTokens?: number };
  forbidden: string[];                  // forbidden action kinds (exact) / substrings
}

export interface ActionSignals {
  commandRisk?: RiskLevel;                                  // CERBERUS / HEPHAESTUS
  irreversible?: boolean;                                   // HEPHAESTUS preflight
  outOfScopePaths?: string[];                               // PCE / policy
  shadowVerdict?: "MERGE" | "ROLLBACK" | "REVIEW" | null;   // CRUCIBLE
  driftBand?: "STABLE" | "DRIFTING" | "DIVERGENT" | "UNKNOWN"; // TELOS
  regretBand?: "LOW" | "ELEVATED" | "HIGH" | "UNKNOWN";     // REGRET
  completeness?: "COVERED" | "GAP" | "UNKNOWN";             // ELLEIPSIS
  forbiddenHit?: boolean;
}

export interface AgentAction {
  id: string;
  kind: string;                  // "edit" | "command" | "post" | "deploy" | …
  summary: string;
  files?: string[];
  tokensEst?: number;
  reversible?: boolean;          // default true; false ⇒ never autonomous
  inverse?: { id: string; kind: string; summary: string }; // compensating action for SAGA
  signals?: ActionSignals;
}

export type GovernVerdict = "ALLOW_AUTONOMOUS" | "ALLOW_WITH_AUDIT" | "ESCALATE_HUMAN" | "BLOCK";
export interface ActionDecision {
  id: string;
  verdict: GovernVerdict;
  autonomous: boolean;           // true iff verdict === ALLOW_AUTONOMOUS
  reasons: string[];
}

function matchGlob(path: string, glob: string): boolean {
  try { const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&"); return new RegExp("^" + esc.replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*").replace(/\?/g, ".") + "$").test(path); } catch { return false; }
}
function outOfScope(charter: Charter, action: AgentAction): string[] {
  const scope = Array.isArray(charter?.scopeGlobs) ? charter.scopeGlobs.filter(Boolean) : [];
  const files = Array.isArray(action?.files) ? action.files : [];
  if (!scope.length || !files.length) return [];
  return files.filter((f) => !scope.some((g) => matchGlob(f, g)));
}
function isForbidden(charter: Charter, action: AgentAction): boolean {
  const f = Array.isArray(charter?.forbidden) ? charter.forbidden : [];
  const hay = `${action?.kind ?? ""} ${action?.summary ?? ""}`.toLowerCase();
  return action?.signals?.forbiddenHit === true || f.some((p) => p && hay.includes(String(p).toLowerCase()));
}

/**
 * The per-action governance decision. THE SAFETY INVARIANT: ALLOW_AUTONOMOUS is
 * returned ONLY for an action that is reversible ∧ in-scope ∧ within the risk
 * envelope ∧ not forbidden ∧ not drift-divergent ∧ not a failed/held shadow.
 * Anything irreversible / out-of-envelope / forbidden escalates or blocks.
 * Pure + total — fail-safe (any error ⇒ ESCALATE_HUMAN, never autonomous).
 */
export function governAction(charter: Charter, action: AgentAction, ctx?: { actionsUsed?: number; tokensUsed?: number }): ActionDecision {
  const id = action?.id ?? "?";
  try {
    const s = action?.signals ?? {};
    const reasons: string[] = [];

    // 1) hard BLOCK — forbidden by charter
    if (isForbidden(charter, action)) return { id, verdict: "BLOCK", autonomous: false, reasons: ["forbidden by charter"] };

    // 2) hard ESCALATE — irreversible / destructive / out-of-scope / over-budget /
    //    failed-or-held shadow / divergent drift. These can NEVER be autonomous.
    const reversible = action?.reversible !== false;
    if (!reversible || s.irreversible === true) reasons.push("irreversible — needs human sign-off");
    if (s.commandRisk === "destructive") reasons.push("destructive command risk");
    const oos = outOfScope(charter, action);
    if (oos.length) reasons.push(`out of charter scope: ${oos.join(", ")}`);
    if (s.shadowVerdict === "ROLLBACK") reasons.push("shadow build/test FAILED (CRUCIBLE ROLLBACK)");
    if (s.shadowVerdict === "REVIEW") reasons.push("shadow held for human review");
    if (s.driftBand === "DIVERGENT") reasons.push("mission drift DIVERGENT (TELOS)");
    const budget = charter?.budget ?? { maxActions: Infinity };
    const actionsUsed = ctx?.actionsUsed ?? 0;
    const tokensUsed = ctx?.tokensUsed ?? 0;
    if (Number.isFinite(budget.maxActions) && actionsUsed >= budget.maxActions) reasons.push("action budget exhausted");
    if (budget.maxTokens !== undefined && (tokensUsed + (action?.tokensEst ?? 0)) > budget.maxTokens) reasons.push("token budget would be exceeded");
    // risk beyond the autonomous envelope
    const envelope = (["read", "write", "destructive"] as RiskLevel[]).includes(charter?.riskEnvelope) ? charter.riskEnvelope : "read";
    const risk = (["read", "write", "destructive"] as RiskLevel[]).includes(s.commandRisk as RiskLevel) ? (s.commandRisk as RiskLevel) : "read";
    if (RISK_ORDER[risk] > RISK_ORDER[envelope]) reasons.push(`risk ${risk} exceeds autonomous envelope ${envelope}`);

    if (reasons.length) return { id, verdict: "ESCALATE_HUMAN", autonomous: false, reasons };

    // 3) ALLOW_WITH_AUDIT — in-envelope but a caution signal: proceed, flag for review
    const audit: string[] = [];
    if (s.driftBand === "DRIFTING") audit.push("drift DRIFTING");
    if (s.regretBand === "HIGH" || s.regretBand === "ELEVATED") audit.push(`regret ${s.regretBand}`);
    if (s.completeness === "GAP") audit.push("completeness GAP (ELLEIPSIS)");
    if (s.completeness === "UNKNOWN" && (s.regretBand === "UNKNOWN" || s.regretBand === undefined)) audit.push("low signal — audit recommended");
    if (audit.length) return { id, verdict: "ALLOW_WITH_AUDIT", autonomous: false, reasons: audit };

    // 4) ALLOW_AUTONOMOUS — reversible, in-scope, in-envelope, clean
    return { id, verdict: "ALLOW_AUTONOMOUS", autonomous: true, reasons: ["reversible · in scope · within envelope · no caution signal"] };
  } catch { return { id, verdict: "ESCALATE_HUMAN", autonomous: false, reasons: ["governor error — fail-safe escalate"] }; }
}

// ── the AUTO-OPERATION BATCH loop ────────────────────────────────────────────
export interface CircuitBreakerState { tripped: boolean; reason: string | null }
/** Trip the breaker on divergent drift, a regret spike, or escalation thrash. Pure. */
export function circuitBreaker(driftBand: string | undefined, regretRate: number, consecutiveEscalations: number): CircuitBreakerState {
  try {
    if (driftBand === "DIVERGENT") return { tripped: true, reason: "mission drift DIVERGENT — fleet paused" };
    if (Number.isFinite(regretRate) && regretRate >= 0.5) return { tripped: true, reason: `regret rate ${Math.round(regretRate * 100)}% — fleet paused` };
    if (consecutiveEscalations >= 5) return { tripped: true, reason: `${consecutiveEscalations} consecutive escalations — fleet paused for human` };
    return { tripped: false, reason: null };
  } catch { return { tripped: true, reason: "breaker error — fail-safe paused" }; }
}

export interface BatchReport {
  total: number;
  autonomous: number;
  audited: number;
  escalated: { id: string; reasons: string[] }[];
  blocked: { id: string; reasons: string[] }[];
  executed: string[];              // ids that ran (autonomous + audited)
  breakerTripped: boolean;
  breakerReason: string | null;
  stoppedAt: number | null;        // index where the breaker/budget stopped the batch
  budgetUsed: { actions: number; tokens: number };
  verdicts: ActionDecision[];
  note: string;
}

/**
 * Process a queue of actions as a CONTINUOUS AUTO-OPERATION BATCH: each action is
 * governed in sequence; autonomous + audited actions "run" (recorded as executed
 * — the orchestrator does the real I/O per the verdict), escalations/blocks are
 * queued for the human, the budget is threaded, and a circuit-breaker stops the
 * whole fleet on divergent drift / regret spike / escalation thrash. No per-step
 * human command — only the escalations need attention. Pure + deterministic + total.
 */
export function governBatch(charter: Charter, actions: ReadonlyArray<AgentAction>, opts?: { regretRate?: number }): BatchReport {
  const note = "Auto-operation batch: autonomous + audited actions flow without per-step human input; only irreversible / out-of-envelope / forbidden actions escalate. The circuit-breaker pauses the whole fleet on divergent drift / regret spike. The Governor decides + sequences + escalates — the orchestrator executes per the verdicts.";
  try {
    const list = Array.isArray(actions) ? actions : [];
    const verdicts: ActionDecision[] = [];
    const escalated: { id: string; reasons: string[] }[] = [];
    const blocked: { id: string; reasons: string[] }[] = [];
    const executed: string[] = [];
    let autonomous = 0, audited = 0, actionsUsed = 0, tokensUsed = 0, consecutiveEscalations = 0;
    let breakerTripped = false, breakerReason: string | null = null, stoppedAt: number | null = null;
    const regretRate = Number.isFinite(opts?.regretRate) ? (opts!.regretRate as number) : 0;

    for (let i = 0; i < list.length; i++) {
      // breaker BEFORE each step (drift may have flipped on the previous action)
      const action = list[i]!;
      const drift = action?.signals?.driftBand;
      const bk = circuitBreaker(drift, regretRate, consecutiveEscalations);
      if (bk.tripped) {
        breakerTripped = true; breakerReason = bk.reason; stoppedAt = i;
        for (let j = i; j < list.length; j++) escalated.push({ id: list[j]!.id ?? "?", reasons: ["fleet paused by circuit-breaker — held for human"] });
        break;
      }
      const d = governAction(charter, action, { actionsUsed, tokensUsed });
      verdicts.push(d);
      if (d.verdict === "BLOCK") { blocked.push({ id: d.id, reasons: d.reasons }); consecutiveEscalations++; continue; }
      if (d.verdict === "ESCALATE_HUMAN") { escalated.push({ id: d.id, reasons: d.reasons }); consecutiveEscalations++; continue; }
      // executed (autonomous or audited)
      consecutiveEscalations = 0;
      executed.push(d.id);
      actionsUsed++; tokensUsed += action?.tokensEst ?? 0;
      if (d.verdict === "ALLOW_AUTONOMOUS") autonomous++; else audited++;
    }

    return { total: list.length, autonomous, audited, escalated, blocked, executed, breakerTripped, breakerReason, stoppedAt, budgetUsed: { actions: actionsUsed, tokens: tokensUsed }, verdicts, note };
  } catch {
    return { total: 0, autonomous: 0, audited: 0, escalated: [], blocked: [], executed: [], breakerTripped: true, breakerReason: "batch error — fail-safe paused", stoppedAt: 0, budgetUsed: { actions: 0, tokens: 0 }, verdicts: [], note };
  }
}

// ── SAGA auto-compensation ───────────────────────────────────────────────────
export interface CompensationPlan { compensations: { id: string; kind: string; summary: string }[]; uncompensable: string[]; note: string }
/**
 * When a batch half-fails at `failedIndex`, plan the inverse actions for the
 * EXECUTED, REVERSIBLE steps (newest-first — undo in reverse order). Irreversible
 * steps cannot be auto-compensated (they were escalated up front). Pure + total.
 */
export function planCompensation(executedActions: ReadonlyArray<AgentAction>, failedIndex: number): CompensationPlan {
  try {
    const list = Array.isArray(executedActions) ? executedActions : [];
    const upto = Number.isFinite(failedIndex) ? Math.min(failedIndex, list.length) : list.length;
    const done = list.slice(0, upto);
    const compensations: { id: string; kind: string; summary: string }[] = [];
    const uncompensable: string[] = [];
    for (let i = done.length - 1; i >= 0; i--) {
      const a = done[i]!;
      if (a.reversible !== false && a.inverse) compensations.push(a.inverse);
      else if (a.reversible === false) uncompensable.push(a.id);
    }
    return { compensations, uncompensable, note: uncompensable.length ? "some steps are irreversible and cannot be auto-compensated — they required human sign-off up front" : "all executed steps are reversible — auto-compensation restores the prior state" };
  } catch { return { compensations: [], uncompensable: [], note: "compensation error" }; }
}

// ── Living Charter — evidence-driven autonomy envelope ───────────────────────
export interface EnvelopeAmendment { current: RiskLevel; proposed: RiskLevel; direction: "widen" | "narrow" | "hold"; reason: string }
/**
 * Propose widening the autonomy envelope when a class of action has a long clean
 * record (≥minClean approvals, 0 regret), or narrowing it on a fresh regret.
 * The human ratifies; the envelope is never auto-widened to destructive. Pure + total.
 */
export function proposeAmendment(charter: Charter, evidence: { approvedClean: number; regretted: number }, opts?: { minClean?: number }): EnvelopeAmendment {
  const current = (["read", "write", "destructive"] as RiskLevel[]).includes(charter?.riskEnvelope) ? charter.riskEnvelope : "read";
  try {
    const minClean = Number.isFinite(opts?.minClean) && (opts!.minClean as number) > 0 ? Math.floor(opts!.minClean as number) : 10;
    const { approvedClean, regretted } = { approvedClean: Number(evidence?.approvedClean) || 0, regretted: Number(evidence?.regretted) || 0 };
    if (regretted > 0 && current !== "read") {
      const proposed: RiskLevel = current === "destructive" ? "write" : "read";
      return { current, proposed, direction: "narrow", reason: `${regretted} regretted action(s) — narrow the autonomy envelope ${current}→${proposed}` };
    }
    if (regretted === 0 && approvedClean >= minClean && current === "read") {
      return { current, proposed: "write", direction: "widen", reason: `${approvedClean} clean approvals, 0 regrets — propose widening read→write (never auto-widens to destructive)` };
    }
    return { current, proposed: current, direction: "hold", reason: regretted === 0 ? `${approvedClean}/${opts?.minClean ?? 10} clean approvals — hold` : "hold" };
  } catch { return { current, proposed: current, direction: "hold", reason: "amendment error — hold" }; }
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface GovernorGauntlet {
  safetyInvariant: boolean;          // irreversible/destructive/out-of-scope/over-budget/forbidden NEVER autonomous
  allowsCleanAutonomous: boolean;
  auditsCautionSignals: boolean;
  batchAutoFlows: boolean;           // a mostly-clean batch runs autonomously, escalations queued
  breakerTripsOnDivergent: boolean;
  budgetStops: boolean;
  sagaCompensatesReversibleOnly: boolean;
  livingEnvelopeWidensAndNarrows: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function governorGauntlet(): GovernorGauntlet {
  const charter: Charter = { mission: "refactor auth", scopeGlobs: ["src/auth/**"], riskEnvelope: "write", budget: { maxActions: 100 }, forbidden: ["delete production", "post tweet"] };
  const A = (over: Partial<AgentAction>): AgentAction => ({ id: over.id ?? "a", kind: over.kind ?? "edit", summary: over.summary ?? "edit auth", files: over.files ?? ["src/auth/x.ts"], reversible: over.reversible, inverse: over.inverse, tokensEst: over.tokensEst, signals: over.signals ?? {} });

  // safety invariant: each "dangerous" axis must NOT be autonomous
  const dangerous: AgentAction[] = [
    A({ id: "irr", reversible: false, signals: { commandRisk: "write" } }),
    A({ id: "dst", signals: { commandRisk: "destructive" } }),
    A({ id: "oos", files: ["src/billing/x.ts"], signals: { commandRisk: "write" } }),
    A({ id: "fbd", kind: "post", summary: "post tweet about launch", signals: {} }),
    A({ id: "rb", signals: { shadowVerdict: "ROLLBACK", commandRisk: "write" } }),
    A({ id: "div", signals: { driftBand: "DIVERGENT", commandRisk: "read" } }),
  ];
  const safetyInvariant = dangerous.every((a) => governAction(charter, a).autonomous === false);

  const clean = governAction(charter, A({ id: "ok", signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } }));
  const allowsCleanAutonomous = clean.verdict === "ALLOW_AUTONOMOUS" && clean.autonomous === true;

  const caution = governAction(charter, A({ id: "au", signals: { commandRisk: "write", regretBand: "HIGH" } }));
  const auditsCautionSignals = caution.verdict === "ALLOW_WITH_AUDIT" && caution.autonomous === false;

  // batch: 8 clean + 2 dangerous → 8 executed autonomous, 2 escalated/blocked
  const batchActions = [
    ...Array.from({ length: 8 }, (_, i) => A({ id: `c${i}`, signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } })),
    A({ id: "d1", signals: { commandRisk: "destructive" } }),
    A({ id: "f1", kind: "post", summary: "post tweet now" }),
  ];
  const br = governBatch(charter, batchActions);
  const batchAutoFlows = br.autonomous === 8 && br.escalated.length === 1 && br.blocked.length === 1 && br.executed.length === 8;

  // circuit-breaker: a DIVERGENT action mid-batch pauses the fleet
  const bkBatch = governBatch(charter, [A({ id: "x1", signals: { commandRisk: "write", driftBand: "STABLE" } }), A({ id: "x2", signals: { driftBand: "DIVERGENT" } }), A({ id: "x3", signals: { commandRisk: "write" } })]);
  const breakerTripsOnDivergent = bkBatch.breakerTripped === true && bkBatch.stoppedAt === 1 && bkBatch.executed.length === 1;

  // budget: maxActions 3 → only 3 execute
  const budgetCharter: Charter = { ...charter, budget: { maxActions: 3 } };
  const budgetBatch = governBatch(budgetCharter, Array.from({ length: 6 }, (_, i) => A({ id: `b${i}`, signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } })));
  const budgetStops = budgetBatch.executed.length === 3 && budgetBatch.escalated.length === 3;

  // saga: 3 executed (2 reversible + 1 irreversible) → compensate the 2 reversible only, newest-first
  const executed: AgentAction[] = [
    A({ id: "e0", reversible: true, inverse: { id: "u0", kind: "revert", summary: "revert e0" } }),
    A({ id: "e1", reversible: false }),
    A({ id: "e2", reversible: true, inverse: { id: "u2", kind: "revert", summary: "revert e2" } }),
  ];
  const comp = planCompensation(executed, 3);
  const sagaCompensatesReversibleOnly = comp.compensations.length === 2 && comp.compensations[0]!.id === "u2" && comp.uncompensable.includes("e1");

  const widen = proposeAmendment({ ...charter, riskEnvelope: "read" }, { approvedClean: 20, regretted: 0 });
  const narrow = proposeAmendment({ ...charter, riskEnvelope: "write" }, { approvedClean: 5, regretted: 2 });
  const livingEnvelopeWidensAndNarrows = widen.direction === "widen" && widen.proposed === "write" && narrow.direction === "narrow" && narrow.proposed === "read";

  const deterministic = JSON.stringify(governBatch(charter, batchActions)) === JSON.stringify(governBatch(charter, batchActions));

  let total = true;
  try {
    governAction(null as unknown as Charter, null as unknown as AgentAction);
    governBatch(null as unknown as Charter, null as unknown as AgentAction[]);
    planCompensation(null as unknown as AgentAction[], NaN);
    proposeAmendment(null as unknown as Charter, null as unknown as { approvedClean: number; regretted: number });
    circuitBreaker(undefined, NaN, NaN);
  } catch { total = false; }

  const all = safetyInvariant && allowsCleanAutonomous && auditsCautionSignals && batchAutoFlows && breakerTripsOnDivergent && budgetStops && sagaCompensatesReversibleOnly && livingEnvelopeWidensAndNarrows && deterministic && total;
  return { safetyInvariant, allowsCleanAutonomous, auditsCautionSignals, batchAutoFlows, breakerTripsOnDivergent, budgetStops, sagaCompensatesReversibleOnly, livingEnvelopeWidensAndNarrows, deterministic, total, score: all ? 100 : 0 };
}
