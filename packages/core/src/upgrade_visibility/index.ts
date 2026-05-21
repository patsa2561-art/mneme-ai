/**
 * v2.21.7 — UPGRADE VISIBILITY.
 *
 * Closes the two deferred concerns from the v2.21.6 AI-agent audit:
 *
 *   5. "Silent upgrade fail (exit 4294963214) swallowed."
 *       → exit_log.ts: HMAC-chained record of every attempt + exit
 *         code; `lastFailure()` surfaces the most recent non-zero
 *         exit. No more silent fails.
 *
 *   6. "Auto-upgrade race during user's npm install."
 *       → npm_detector.ts + mutex.ts: ancestor-chain detection blocks
 *         self-upgrade when an `npm install` is alive in the parent
 *         tree; file-lock mutex prevents two Mneme processes from
 *         running `npm install` at the same time.
 *
 * Composes:
 *
 *     const safety = isUpgradeSafeRightNow();
 *     if (!safety.safe) return recordUpgrade(repoRoot, {
 *       versionBefore: cur, versionAfter: null, exitCode: -1,
 *       reason: `aborted: ${safety.reason}`,
 *     });
 *     const lock = acquireLock(repoRoot, { reason: "auto-upgrade" });
 *     if (!lock.ok) return recordUpgrade(repoRoot, {...exitCode: -2, reason: lock.reason!});
 *     // ... run `npm install -g mneme-ai` ...
 *     recordUpgrade(repoRoot, { versionBefore, versionAfter, exitCode, ... });
 *     releaseLock(repoRoot);
 */

export {
  acquireLock, releaseLock, readLock, isLocked, formatLock,
  type LockState, type AcquireResult, type AcquireOptions,
} from "./mutex.js";

export {
  recordUpgrade, listUpgrades, lastFailure, lastSuccess, verifyChain, formatUpgradeLog,
  type UpgradeEntry, type RecordUpgradeOptions,
} from "./exit_log.js";

export {
  isInsideNpmInstall, isUpgradeSafeRightNow, formatDetection,
  type DetectionResult,
} from "./npm_detector.js";

import { isUpgradeSafeRightNow } from "./npm_detector.js";
import { isLocked, readLock } from "./mutex.js";
import { lastFailure, lastSuccess, listUpgrades } from "./exit_log.js";

/** One-shot doctor: is it safe to attempt an upgrade right now? Pure
 *  read-only — never mutates state. */
export interface UpgradeDoctorReport {
  ready: boolean;
  reasons: string[];
  recentFailure: ReturnType<typeof lastFailure>;
  recentSuccess: ReturnType<typeof lastSuccess>;
  attempts: number;
}

export function upgradeDoctor(repoRoot: string): UpgradeDoctorReport {
  const reasons: string[] = [];
  let ready = true;
  const safety = isUpgradeSafeRightNow();
  if (!safety.safe) { ready = false; reasons.push(safety.reason); }
  if (isLocked(repoRoot)) {
    ready = false;
    const lk = readLock(repoRoot);
    reasons.push(`upgrade lock active: pid=${lk?.pid} reason="${lk?.reason}"`);
  }
  return {
    ready,
    reasons,
    recentFailure: lastFailure(repoRoot),
    recentSuccess: lastSuccess(repoRoot),
    attempts: listUpgrades(repoRoot).length,
  };
}

export function formatDoctor(r: UpgradeDoctorReport): string {
  const lines: string[] = [];
  lines.push(`🩺 UPGRADE DOCTOR — ${r.ready ? "✓ ready" : "✗ blocked"}`);
  lines.push("");
  if (r.reasons.length > 0) {
    lines.push("  Blockers:");
    for (const reason of r.reasons) lines.push(`    - ${reason}`);
    lines.push("");
  }
  lines.push(`  Attempts logged:  ${r.attempts}`);
  if (r.recentFailure) {
    lines.push(`  Last failure:     ${r.recentFailure.ts}  exit=${r.recentFailure.exitCode}`);
    lines.push(`                    reason: ${r.recentFailure.reason}`);
  } else {
    lines.push("  Last failure:     (none recorded)");
  }
  if (r.recentSuccess) {
    lines.push(`  Last success:     ${r.recentSuccess.ts}  v${r.recentSuccess.versionBefore} → v${r.recentSuccess.versionAfter}`);
  } else {
    lines.push("  Last success:     (none recorded)");
  }
  return lines.join("\n");
}
