/**
 * v2.22.2 — OVERSHOOT TRACER.
 *
 * Compare what an AI agent PLANNED to do (output of conductor.plan)
 * versus what it ACTUALLY did (sequence of mission-recorder events).
 * Surfaces:
 *   - Verbs invoked that were not in the plan (scope creep)
 *   - Verbs invoked with extra/changed args (silent mutation)
 *   - Sequence length overrun (more steps than planned)
 *
 * Returns an overshoot score 0-1 + a per-step diff. AI agents that
 * cross a configurable threshold can be auto-killed by the caller
 * (the tracer never kills; that's policy at the caller).
 *
 * Composes:
 *   - conductor.plan   (the planned sequence)
 *   - mission_recorder (the actual trace)
 */

export interface PlanStepLite {
  verb: string;
  args?: Record<string, unknown>;
}

export interface ActualStepLite {
  verb: string;
  args?: Record<string, unknown>;
  eventId?: string;
}

export interface OvershootEntry {
  index: number;
  verb: string;
  kind: "extra-step" | "verb-mismatch" | "arg-mismatch" | "missing-step" | "ok";
  detail: string;
}

export interface OvershootReport {
  v: 1;
  /** Number of planned steps. */
  plannedCount: number;
  /** Number of actually executed steps. */
  actualCount: number;
  /** Per-step alignment outcomes. */
  entries: OvershootEntry[];
  /** Aggregate overshoot score 0-1. 0 = fully aligned, 1 = fully diverged. */
  score: number;
  /** Caller-facing band. */
  band: "ALIGNED" | "WANDER" | "OVERSHOOT" | "RUNAWAY";
  /** Whether the caller's kill-switch threshold has been crossed. */
  killSwitch: boolean;
  /** Plain-English summary. */
  rationale: string;
}

export interface TraceOptions {
  /** Score threshold above which `killSwitch=true`. Default 0.5. */
  killThreshold?: number;
  /** Whether to require args to match too. Default true. */
  strictArgs?: boolean;
}

function argsEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if ((a ?? {})[ka[i]!] !== (b ?? {})[kb[i]!]) return false;
  }
  return true;
}

export function traceOvershoot(planned: PlanStepLite[], actual: ActualStepLite[], opts: TraceOptions = {}): OvershootReport {
  const killThreshold = opts.killThreshold ?? 0.5;
  const strictArgs = opts.strictArgs !== false;
  const entries: OvershootEntry[] = [];
  const n = Math.max(planned.length, actual.length);
  let mismatch = 0;
  for (let i = 0; i < n; i++) {
    const p = planned[i];
    const a = actual[i];
    if (!p && a) {
      entries.push({ index: i, verb: a.verb, kind: "extra-step", detail: `actual step ${i} (${a.verb}) was not in the plan` });
      mismatch++;
      continue;
    }
    if (p && !a) {
      entries.push({ index: i, verb: p.verb, kind: "missing-step", detail: `planned step ${i} (${p.verb}) was not executed` });
      mismatch++;
      continue;
    }
    if (p!.verb !== a!.verb) {
      entries.push({ index: i, verb: a!.verb, kind: "verb-mismatch", detail: `planned ${p!.verb}, actual ${a!.verb}` });
      mismatch++;
      continue;
    }
    if (strictArgs && !argsEqual(p!.args, a!.args)) {
      entries.push({ index: i, verb: a!.verb, kind: "arg-mismatch", detail: `planned args ${JSON.stringify(p!.args ?? {})}, actual ${JSON.stringify(a!.args ?? {})}` });
      mismatch++;
      continue;
    }
    entries.push({ index: i, verb: a!.verb, kind: "ok", detail: "exact match" });
  }
  const score = n === 0 ? 0 : mismatch / n;
  const band: OvershootReport["band"] =
    score === 0 ? "ALIGNED"
    : score < 0.25 ? "WANDER"
    : score < 0.75 ? "OVERSHOOT"
    : "RUNAWAY";
  const killSwitch = score >= killThreshold;
  return {
    v: 1,
    plannedCount: planned.length,
    actualCount: actual.length,
    entries,
    score,
    band,
    killSwitch,
    rationale: band === "ALIGNED"
      ? `Actual execution matches the plan exactly (${planned.length} steps).`
      : `${mismatch}/${n} step mismatch (score=${score.toFixed(2)}, band=${band}${killSwitch ? ", kill-switch armed" : ""}).`,
  };
}

export function formatReport(r: OvershootReport): string {
  const badge = r.band === "ALIGNED" ? "✓" : r.band === "WANDER" ? "⚠" : r.band === "OVERSHOOT" ? "✗" : "🚨";
  const lines: string[] = [
    `🛑 OVERSHOOT TRACER — ${badge} ${r.band}`,
    "",
    `  ${r.rationale}`,
    "",
    `  Plan steps:    ${r.plannedCount}`,
    `  Actual steps:  ${r.actualCount}`,
    `  Score:         ${r.score.toFixed(3)} (0=aligned, 1=fully diverged)`,
    `  Kill-switch:   ${r.killSwitch ? "ARMED" : "off"}`,
  ];
  if (r.entries.length > 0) {
    lines.push("");
    lines.push("  Per-step:");
    for (const e of r.entries) {
      const sym = e.kind === "ok" ? "✓" : "✗";
      lines.push(`    ${sym} step ${e.index}: ${e.kind} — ${e.detail}`);
    }
  }
  return lines.join("\n");
}
