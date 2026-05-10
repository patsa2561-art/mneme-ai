/**
 * Mneme Audit -- the recurring self-recheck loop.
 *
 * The user explicitly asked for a "recurring flow system that asks
 * itself every time: is this good enough? if not, loop again". This
 * module is that flow.
 *
 * Pattern: a registry of CHECKS. Each check returns a Verdict
 * { name, status: pass|warn|fail, evidence, fixHint }. The audit
 * runner runs them all in parallel, persists results, and surfaces
 * failures into the pulse so the AI agent + user see them.
 *
 * Daemon caretaker pass calls runAudit() every CARETAKER_PASS_EVERY
 * ticks (~15min). Failures become inbox notices + agent-files updates.
 */

export type AuditStatus = "pass" | "warn" | "fail" | "skip";

export interface AuditVerdict {
  /** Stable name (e.g., "pulse-hook-installed"). */
  name: string;
  /** Plain English description for the audit UI. */
  description: string;
  status: AuditStatus;
  /** What we observed (the evidence). */
  evidence: string;
  /** Human-readable suggestion when status != "pass". */
  fixHint?: string;
  /** When the AI agent should auto-execute a tool to fix this, name it. */
  autoAction?: { tool: string; args: Record<string, unknown> };
  /** ms the check took. */
  ms: number;
}

export interface AuditCheck {
  name: string;
  description: string;
  /** Severity at which a fail should trigger inbox + notifier. */
  failSeverity: "info" | "action" | "warning" | "critical";
  run(repoRoot: string): Promise<AuditVerdict> | AuditVerdict;
}

export interface AuditReport {
  ranAt: string;
  totalChecks: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  totalMs: number;
  /** All verdicts (sorted: fail > warn > skip > pass). */
  verdicts: AuditVerdict[];
  /** A short banner the pulse can quote. */
  banner: string;
}
