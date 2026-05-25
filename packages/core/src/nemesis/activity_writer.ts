/**
 * v2.49.0 — NEMESIS activity-writer (B4 ACTUAL WIRING).
 *
 * v2.48 shipped `vendor_reconcile.ts` as a pure module but DIDN'T wire
 * it to the actual write path — so `cli-activity.jsonl` still wrote
 * `vendor:"cursor"` when env_scan said `claude-code`. Wiring lag of the
 * fix for wiring lag.
 *
 * This module is the canonical write path: every AI-agent activity
 * record goes through `recordActivityReconciled()` which:
 *   1. Scans env vars for vendor signature (env_scan)
 *   2. Reconciles env vendor vs caller's claimed vendor
 *   3. Writes the CANONICAL vendor to `.mneme/cli-activity.jsonl`
 *   4. Records divergence + source for audit trail
 *
 * Defensive: never throws; returns structured envelope.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { scanEnv } from "./env_scan.js";
import { reconcileVendor } from "./vendor_reconcile.js";

export interface RecordActivityInput {
  claimedVendor: string;
  action: string;
  /** Optional override for tests; default = scanEnv() */
  envOverride?: { vendor: string; confidence: number };
  /** Optional metadata to include in the record. */
  meta?: Record<string, unknown>;
}

export interface RecordActivityResult {
  ok: boolean;
  reason?: string;
  /** Canonical vendor decided by the reconciler. */
  canonicalVendor: string;
  /** True when env_scan disagreed with claimedVendor. */
  divergent: boolean;
  /** Which source the reconciler chose. */
  source: "env" | "activity" | "neither";
  /** Path written to. */
  path?: string;
}

export function recordActivityReconciled(
  repoRoot: string,
  input: RecordActivityInput,
): RecordActivityResult {
  try {
    if (!repoRoot) return { ok: false, reason: "repoRoot required", canonicalVendor: "unknown", divergent: false, source: "neither" };
    const envScan = input.envOverride ?? (() => {
      const s = scanEnv();
      return { vendor: s.vendor, confidence: s.confidence };
    })();
    const reconciled = reconcileVendor({
      envVendor: envScan.vendor,
      envConfidence: envScan.confidence,
      activityVendor: input.claimedVendor,
    });
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "cli-activity.jsonl");
    const row = {
      at: new Date().toISOString(),
      vendor: reconciled.canonical,
      claimedVendor: input.claimedVendor,
      envVendor: envScan.vendor,
      action: input.action,
      divergent: reconciled.divergent,
      source: reconciled.source,
      reason: reconciled.reason,
      ...(input.meta ? { meta: input.meta } : {}),
    };
    appendFileSync(path, JSON.stringify(row) + "\n");
    return {
      ok: true,
      canonicalVendor: String(reconciled.canonical),
      divergent: reconciled.divergent,
      source: reconciled.source,
      path,
    };
  } catch (e) {
    return {
      ok: false,
      reason: (e as Error).message,
      canonicalVendor: "unknown",
      divergent: false,
      source: "neither",
    };
  }
}
