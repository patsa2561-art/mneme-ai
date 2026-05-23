/**
 * v2.36.0 — HONEST RECEIPT types.
 *
 * The wild idea closing audit-card bugs #4 / #16 / #19 / #22 at once:
 * every Mneme CLI invocation can emit an HMAC-signed receipt of what
 * ACTUALLY ran — install path, resolved version, code path (UDS-fast /
 * full-cli / cached), observed latency. Turns "Mneme says 12ms" into
 * "Mneme PROVED it took 12ms via this receipt".
 *
 * Composes with the BUG IMMUNITY pattern: every marketing claim about
 * speed / install path / version can be re-verified by reading a
 * receipt off disk. Defeats the marketing-drift class structurally.
 */

export type CodePath =
  | "uds-fast"     // muscle-memory UDS round-trip
  | "named-pipe"   // Windows named pipe
  | "full-cli"     // full Node module load
  | "cached"       // verify_cache hit
  | "fallback"     // attempted fast-path, fell through
  | "unknown";

export interface InstallSnapshot {
  /** Resolved path of the bin shim that ran. */
  binPath: string;
  /** Resolved path of mneme-ai/package.json (the install root). */
  packagePath: string | null;
  /** Version read from packagePath. */
  packageVersion: string | null;
  /** Other npm prefixes also containing mneme-ai (multi-install warning). */
  otherInstalls: Array<{ path: string; version: string | null }>;
  /** PATH entries we walked to resolve `mneme`. */
  pathEntries: string[];
  /** True if multiple distinct versions are installed (ambiguity warning). */
  multiVersionDetected: boolean;
}

export interface LatencyReport {
  /** Wall-clock ms from CLI invocation to first byte of output. */
  totalMs: number;
  /** ms spent in fast-path attempt (UDS / named-pipe). */
  fastPathMs: number;
  /** ms spent in full Node module load (when fast-path missed). */
  fullLoadMs: number;
  /** Which path was actually taken. */
  codePath: CodePath;
  /** Why fast-path was taken / skipped. */
  pathReason: string;
}

export interface HonestReceipt {
  spec: { name: "MNEME-HONEST-RECEIPT"; version: "1.0" };
  /** Command that ran. */
  cmd: string;
  /** Args (sanitized — no PII). */
  args: string[];
  install: InstallSnapshot;
  latency: LatencyReport;
  /** ISO timestamp. */
  at: string;
  /** HMAC-signed envelope. */
  hmac: string;
}
