/**
 * v2.48.0 — NEMESIS VENDOR RECONCILER (B4 fix).
 *
 * Two systems write a "vendor" field:
 *   1. env_scan: reads CLAUDECODE / CURSOR_AGENT / ... env vars
 *   2. cli-activity.jsonl: records the vendor active at MCP call time
 *
 * They diverge when:
 *   - Cursor user runs a Claude Code MCP tool in a side-terminal (env=cursor,
 *     activity=claude-code)
 *   - User pipes commands across sessions
 *   - Auto-init vs first AI handshake race
 *
 * NEMESIS treats env_scan as HIGHEST PRIORITY when its confidence ≥ 0.5
 * (env vars are forge-resistant; activity logs can be retroactively
 * edited or set by a misbehaving agent).
 *
 * Pure deterministic. Caller decides what to DO with the reconciled
 * vendor (e.g. write it back to cli-activity ledger).
 */

import type { VendorId } from "./types.js";

export interface ReconcileInput {
  envVendor: string;
  envConfidence: number;
  activityVendor?: string;
}

export interface ReconcileVerdict {
  /** Canonical vendor: what NEMESIS thinks the truth is. */
  canonical: VendorId | string;
  /** True when envVendor != activityVendor and both are non-unknown. */
  divergent: boolean;
  /** Which source was chosen. */
  source: "env" | "activity" | "neither";
  /** Optional reason string for audit trail. */
  reason: string;
}

export function reconcileVendor(input: ReconcileInput): ReconcileVerdict {
  const env = (input.envVendor ?? "").trim();
  const env_c = Number.isFinite(input.envConfidence) ? input.envConfidence : 0;
  const act = (input.activityVendor ?? "").trim();

  const envKnown = env && env !== "unknown";
  const actKnown = act && act !== "unknown";

  // Both unknown
  if (!envKnown && !actKnown) {
    return { canonical: "unknown", divergent: false, source: "neither", reason: "neither source reports a known vendor" };
  }
  // Only activity known
  if (!envKnown && actKnown) {
    return { canonical: act, divergent: false, source: "activity", reason: "env is unknown; using activity vendor" };
  }
  // Only env known
  if (envKnown && !actKnown) {
    return { canonical: env, divergent: false, source: "env", reason: "activity is unknown; using env vendor" };
  }
  // Both known + match
  if (env === act) {
    return { canonical: env, divergent: false, source: "env", reason: "env and activity agree" };
  }
  // Both known + diverge: env wins when its confidence ≥ 0.5
  if (env_c >= 0.5) {
    return { canonical: env, divergent: true, source: "env", reason: `env (${env}, conf ${env_c.toFixed(2)}) overrides activity (${act}) — env vars are forge-resistant` };
  }
  // Weak env evidence: trust activity
  return { canonical: act, divergent: true, source: "activity", reason: `env confidence ${env_c.toFixed(2)} < 0.5; using activity vendor (${act})` };
}
