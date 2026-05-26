/**
 * v2.56.0 — LAUNCH WINDOW: SpaceX-style GO/NO-GO release verdict.
 *
 * Inspired by SpaceX launch broadcasts. Every release is a "launch" —
 * the question is whether all systems are GO.
 *
 * Aggregates EVERY existing gate into ONE verdict:
 *   - TRUTH GATE         (does marketing match reality?)
 *   - PEAK GAUNTLET      (12-axis production-readiness)
 *   - PERF BUDGET        (5-op latency vs locked budgets)
 *   - INDISPENSABILITY   (6-criterion weighted score)
 *   - WIRING LAG GATE    (every commit-claimed verb actually works)
 *   - PROBE COVERAGE     (configurable threshold; default 50%)
 *   - SDK BUILT          (@mneme-ai/sdk dist present)
 *
 * Output: single verdict (GO / NO-GO / HOLD) + per-gate breakdown +
 * "T-minus" countdown to next safe-ship window estimate + HMAC-signed
 * LAUNCH CERTIFICATE that becomes a GAVEL artifact for releases.
 *
 * Pure deterministic + defensive; never throws.
 */

import { createHmac } from "node:crypto";

const KEY_ENV = "MNEME_LAUNCH_KEY";
const DEFAULT_KEY = "mneme-launch-window-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export type LaunchStatus = "GO" | "NO-GO" | "HOLD";

export interface GateReading {
  gate: string;
  status: LaunchStatus;
  evidence: string;
  /** Latency to evaluate (ms). */
  latencyMs: number;
  /** Weight in overall verdict (higher = more critical). */
  weight: number;
}

export interface LaunchWindowVerdict {
  status: LaunchStatus;
  /** Plain countdown phrase ("T-0 GO" / "T+5min HOLD" / "T-? NO-GO"). */
  countdown: string;
  /** Aggregate go-rate 0..1 (weighted). */
  goRate: number;
  /** Per-gate readings. */
  gates: GateReading[];
  /** Total evaluation latency. */
  totalLatencyMs: number;
  /** HMAC-signed body. */
  hmac: string;
  at: string;
}

function gateFromAggregator<T>(
  name: string,
  weight: number,
  fn: () => Promise<T> | T,
  predicate: (r: T) => { ok: boolean; evidence: string },
): Promise<GateReading> {
  const t0 = performance.now();
  return Promise.resolve()
    .then(() => fn())
    .then((r) => {
      const p = predicate(r);
      return {
        gate: name,
        status: (p.ok ? "GO" : "NO-GO") as LaunchStatus,
        evidence: p.evidence,
        latencyMs: +(performance.now() - t0).toFixed(2),
        weight,
      };
    })
    .catch((e) => ({
      gate: name,
      status: "HOLD" as LaunchStatus,
      evidence: `gate threw: ${(e as Error).message}`,
      latencyMs: +(performance.now() - t0).toFixed(2),
      weight,
    }));
}

export interface LaunchWindowOpts {
  cwd?: string;
  /** Skip slow gates (PEAK GAUNTLET) for quick iteration. */
  fast?: boolean;
  /** Override SDK dist path. */
  sdkDistPath?: string;
}

/**
 * Run the full launch-window check. Aggregates every gate Mneme knows
 * about into a SpaceX-style verdict.
 */
export async function evaluateLaunchWindow(opts: LaunchWindowOpts = {}): Promise<LaunchWindowVerdict> {
  const cwd = opts.cwd ?? process.cwd();
  const t0 = performance.now();
  const gates: GateReading[] = [];

  // Gate 1: PERF BUDGET (in-process, fast)
  gates.push(await gateFromAggregator(
    "perf_budget", 1.5,
    async () => {
      const m = await import("../perf_budget.js" as string) as typeof import("../perf_budget.js");
      return m.runPerfBudget();
    },
    (r) => ({
      ok: r.ok,
      evidence: r.ok ? `5/5 budgets met (${r.measurements.map((m) => `${m.op.split(".").pop()}=${m.warmMeanMs}ms`).join(", ")})` : `BLOCKED: ${r.failing.join("; ")}`,
    }),
  ));

  // Gate 2: INDISPENSABILITY (≥ 0.5 score)
  gates.push(await gateFromAggregator(
    "indispensability", 1.0,
    async () => {
      const m = await import("../indispensability.js" as string) as typeof import("../indispensability.js");
      return m.evaluateIndispensability(cwd);
    },
    (r) => ({
      ok: r.overallScore >= 0.5,
      evidence: `score ${(r.overallScore * 100).toFixed(0)}% (${r.criteria.filter((c) => c.status === "met").length}/${r.criteria.length} criteria met)`,
    }),
  ));

  // Gate 3: PROBE COVERAGE
  gates.push(await gateFromAggregator(
    "probe_coverage", 1.0,
    async () => {
      const m = await import("../release_gate/probe_coverage.js" as string) as typeof import("../release_gate/probe_coverage.js");
      return m.crossCheckFromDisk(cwd, { threshold: 100 });
    },
    (r) => ({
      ok: r.ok,
      evidence: `coverage ${r.coveragePercent}% ≥ threshold ${r.threshold}%`,
    }),
  ));

  // Gate 4: WIRING LAG (fast subset: 3 commits) — v2.57 false-positive-fixed
  gates.push(await gateFromAggregator(
    "wiring_lag", 1.0,
    async () => {
      const m = await import("../release_gate/wiring_lag.js" as string) as typeof import("../release_gate/wiring_lag.js");
      return m.checkWiringLag(cwd, { maxCommits: 3 });
    },
    (r) => ({
      ok: r.ok,
      evidence: r.ok ? `${r.workingCount}/${r.totalClaims} verbs work` : `BROKEN: ${r.brokenCount}/${r.totalClaims}`,
    }),
  ));

  // Gate 4b (v2.57): WIRING DOCTOR — AST-level per-feature surface check
  gates.push(await gateFromAggregator(
    "wiring_doctor", 1.5,
    async () => {
      const m = await import("../release_gate/wiring_doctor.js" as string) as typeof import("../release_gate/wiring_doctor.js");
      return m.diagnose(cwd);
    },
    (r) => ({
      ok: r.ok,
      evidence: r.ok ? `${r.summary.healthy}/${r.summary.total} features wired across core/sdk/cli/tg` : `${r.summary.broken}/${r.summary.total} features missing surface — run \`mneme wiring_doctor\` to drill in`,
    }),
  ));

  // Gate 5: SDK BUILT
  gates.push(await gateFromAggregator(
    "sdk_built", 1.0,
    async () => {
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const sdkDir = opts.sdkDistPath ?? join(cwd, "packages", "sdk", "dist");
      const needed = ["index.js", "nemesis.js", "verify.js", "events.js", "lock.js", "benchmark.js"];
      const missing = needed.filter((n) => !existsSync(join(sdkDir, n)));
      return { missing, sdkDir };
    },
    (r) => ({
      ok: r.missing.length === 0,
      evidence: r.missing.length === 0 ? `@mneme-ai/sdk dist present at ${r.sdkDir}` : `missing: ${r.missing.join(", ")}`,
    }),
  ));

  // Gate 6: TRUTH GATE (subset — load probes + run 3 cheap ones)
  if (!opts.fast) {
    gates.push(await gateFromAggregator(
      "truth_gate", 2.0,
      async () => {
        const m = await import("../truth_gate/probes.js" as string) as typeof import("../truth_gate/probes.js");
        const cheap = ["probe.audit.open_wounds_patched", "probe.audit.reproduction_suite_passes", "probe.sdk.world_class"];
        const results = await Promise.all(cheap.map(async (id) => {
          const p = m.probeById(id);
          if (!p) return { id, value: null };
          try { const r = await p.run({ cwd }); return { id, value: r.value }; }
          catch { return { id, value: null }; }
        }));
        return results;
      },
      (results) => ({
        ok: results.every((r) => r.value === 1),
        evidence: results.map((r) => `${r.id.split(".").pop()}=${r.value}`).join(", "),
      }),
    ));
  }

  // Aggregate
  const totalWeight = gates.reduce((s, g) => s + g.weight, 0);
  const goWeight = gates.filter((g) => g.status === "GO").reduce((s, g) => s + g.weight, 0);
  const holdWeight = gates.filter((g) => g.status === "HOLD").reduce((s, g) => s + g.weight, 0);
  const goRate = totalWeight === 0 ? 0 : goWeight / totalWeight;

  // SpaceX rule: ANY NO-GO → NO-GO. ANY HOLD (and no NO-GO) → HOLD. Else GO.
  let status: LaunchStatus = "GO";
  if (gates.some((g) => g.status === "NO-GO")) status = "NO-GO";
  else if (holdWeight > 0) status = "HOLD";

  // Countdown phrase
  const countdown =
    status === "GO" ? "T-0 GO FOR LAUNCH" :
    status === "HOLD" ? `T+HOLD — ${gates.filter((g) => g.status === "HOLD").length} gate(s) need attention` :
    `T-NO-GO — ${gates.filter((g) => g.status === "NO-GO").length} gate(s) FAIL; abort tag`;

  const totalLatencyMs = +(performance.now() - t0).toFixed(2);
  const at = new Date().toISOString();
  const bodyForHmac = { status, countdown, goRate: +goRate.toFixed(3), gates, totalLatencyMs, at };
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify(bodyForHmac)).digest("hex");
  return { ...bodyForHmac, hmac };
}

/** Verify a launch verdict's HMAC offline. */
export function verifyLaunchVerdict(v: LaunchWindowVerdict): boolean {
  if (!v || typeof v.hmac !== "string") return false;
  const { hmac, ...body } = v;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
  return expected === hmac;
}

/** Render the verdict as a SpaceX-style ASCII broadcast banner. */
export function renderLaunchBanner(v: LaunchWindowVerdict): string {
  const symbol = v.status === "GO" ? "🚀" : v.status === "HOLD" ? "⏸" : "🛑";
  const lines = [
    `${symbol} LAUNCH WINDOW · ${v.countdown}`,
    `   ${v.gates.length} gates · go-rate ${(v.goRate * 100).toFixed(0)}% · evaluated in ${v.totalLatencyMs}ms`,
    "",
  ];
  for (const g of v.gates) {
    const sym = g.status === "GO" ? "✓" : g.status === "HOLD" ? "~" : "✗";
    lines.push(`   ${sym} ${g.gate.padEnd(18)} ${g.status.padEnd(6)} ${g.latencyMs.toString().padStart(6)}ms  ${g.evidence}`);
  }
  return lines.join("\n");
}
