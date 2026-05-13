/**
 * v2.8.0 -- BEST EFFORT marker.
 *
 *   "Distinguish deliberate silent catches from accidental bug-swallowers."
 *
 * METRON v2.7 counted every `catch {}` as a Reliability penalty. That's
 * unfair: some catches are intentionally silent (best-effort writes,
 * optional probes, cleanup paths). The fix is structural — wrap
 * deliberate silent catches in `bestEffort()` so:
 *
 *   1. The intent is documented at the call site (a comment with the
 *      reason instead of an opaque `catch {}`).
 *   2. The auditor in METRON can recognise the marker and exclude it
 *      from the silent-catch penalty.
 *   3. Optional `onError` callback lets callers log to a structured
 *      channel without changing the catch shape.
 *
 * Nobel-tier move: the marker IS the audit gate. Mneme refuses to ship
 * Reliability score > 90 unless every catch{} is either WRAPPED in
 * bestEffort() or REMEDIATED to a real handler. No more silent decay.
 */

/** Sentinel string embedded in the call site so METRON's audit can
 *  recognise a deliberate silent catch. */
export const BEST_EFFORT_MARKER = "BE:silent-by-design";

/** Synchronous best-effort wrapper. Runs the body, swallows errors,
 *  optionally invokes onError for telemetry. NEVER throws. */
export function bestEffort<T>(body: () => T, onError?: (e: unknown) => void): T | undefined {
  try {
    return body();
  } catch (e) {
    if (onError) {
      try { onError(e); } catch { /* BE:silent-by-design (telemetry must not throw) */ }
    }
    return undefined;
  }
}

/** Async best-effort wrapper. */
export async function bestEffortAsync<T>(body: () => Promise<T> | T, onError?: (e: unknown) => void): Promise<T | undefined> {
  try {
    return await body();
  } catch (e) {
    if (onError) {
      try { onError(e); } catch { /* BE:silent-by-design (telemetry must not throw) */ }
    }
    return undefined;
  }
}

/** Match catch-block bodies that are documented as best-effort. */
export const BEST_EFFORT_REGEX = /catch\s*(?:\([^)]*\))?\s*\{\s*\/\*\s*(?:BE:silent-by-design|best-effort)/i;
