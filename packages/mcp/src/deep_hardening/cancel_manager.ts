/**
 * v2.26.0 — Cancellation manager (closes N6 deep-finding).
 *
 * Audit (v2.24.0): client sent notifications/cancelled while a slow
 * tool was in flight; the server ignored it + the tool still timed
 * out on its own clock. The MCP spec defines notifications/cancelled
 * to mean "abandon work for this id".
 *
 * Fix: a tiny in-process map id → AbortController. The CallTool
 * handler registers the id at start, listens for notifications/
 * cancelled, fires controller.abort() with reason, and tool handlers
 * that are abort-aware can short-circuit.
 *
 * Non-abort-aware tools won't actually stop, but the manager still
 * records the cancel intent + emits a structured log line so the
 * eventual stale reply can be discarded by the client.
 */

interface ActiveCall {
  controller: AbortController;
  startedAt: number;
  toolName: string;
}

class CancelManager {
  private active = new Map<number | string, ActiveCall>();

  register(id: number | string, toolName: string): AbortSignal {
    const controller = new AbortController();
    this.active.set(id, { controller, startedAt: Date.now(), toolName });
    return controller.signal;
  }

  /** Called when the call completes naturally; removes the entry. */
  unregister(id: number | string): void {
    this.active.delete(id);
  }

  /**
   * Called when notifications/cancelled arrives. Returns true if the
   * id was active (so caller can log the cancellation took effect).
   */
  cancel(id: number | string, reason: string): boolean {
    const a = this.active.get(id);
    if (!a) return false;
    try { a.controller.abort(new Error(`MCP cancellation: ${reason}`)); } catch { /* best-effort */ }
    return true;
  }

  /** Diagnostic: number of in-flight calls. */
  size(): number {
    return this.active.size;
  }

  /** Diagnostic: ids currently in flight. */
  inFlight(): Array<{ id: number | string; toolName: string; ageMs: number }> {
    const now = Date.now();
    const out: Array<{ id: number | string; toolName: string; ageMs: number }> = [];
    for (const [id, a] of this.active) out.push({ id, toolName: a.toolName, ageMs: now - a.startedAt });
    return out;
  }
}

/** Process-wide singleton. */
export const cancelManager = new CancelManager();
