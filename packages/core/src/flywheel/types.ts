/**
 * v2.32.0 — FLYWHEEL types.
 *
 * FLYWHEEL is the self-reflective release organ. It consumes signals
 * from the 5 existing audit primitives (TRUTH GATE, PEAK GAUNTLET,
 * HONEST MIRROR, REWIND, HGP) + command-history + primitive registry,
 * fuses them via cross-pollination, and prescribes 5 action kinds
 * (Heal / Wire / Delete / Shrink / Publish). Closes the 4 weakness
 * loops Mneme has historically suffered from:
 *
 *   1. Tool sprawl       → Shrink (personal cheatsheet ≤ 3 cmds)
 *   2. Solo-dev asymmetry → Publish (Vendor Bulletin .md) + cross-vendor reciprocity
 *   3. Wiring lag         → Wire   (dormant primitives flagged + auto-PR draft)
 *   4. Marketing drift    → Heal   (unbound claims flagged + auto-PR draft)
 *
 * 5-stage controller:
 *   HARVEST → FUSE → PRESCRIBE → EXECUTE → RECIPROCITY
 *
 * The CREATIVE part: stage 5 RECIPROCITY records vendor responses to
 * past bulletins. Vendors that fix within 7 days get +0.05 trust boost
 * (auto-feeds aletheia weights); vendors that ignore for 30+ days get
 * −0.10 penalty. Living negotiation organ with the AI vendor ecosystem.
 */

/** Severity ladder shared across all findings. */
export type Severity = "info" | "warn" | "block";

/** Source primitives we ingest signal from. */
export type SignalSource =
  | "truth_gate"
  | "peak_gauntlet"
  | "honest_mirror"
  | "rewind"
  | "hgp"
  | "command_history"
  | "primitive_registry"
  | "marketing_diff";

export interface RawFinding {
  /** Source primitive + finding id (stable per source). */
  source: SignalSource;
  id: string;
  /** Human-readable headline. */
  headline: string;
  severity: Severity;
  /** ISO timestamp of when the finding was first observed. */
  firstSeen: string;
  /** ISO timestamp of the freshest observation. */
  lastSeen: string;
  /** Free-form structured detail per source. */
  detail?: Record<string, unknown>;
  /** Per-source freshness in days; lower = fresher. */
  ageDays: number;
}

/** Cross-pollinated finding after FUSE stage. */
export interface FusedFinding extends RawFinding {
  /** Other source findings related by signature / claim / vendor / simhash. */
  composedWith: Array<{ source: SignalSource; id: string }>;
  /** Composite priority 0..1 — higher = more urgent. */
  compositeScore: number;
  /** Sortable cluster id (findings in same cluster share root cause). */
  clusterId: string;
}

export type ActionKind = "heal" | "wire" | "delete" | "shrink" | "publish";

export interface PrescribedAction {
  kind: ActionKind;
  /** Findings this action closes. */
  closesFindings: Array<{ source: SignalSource; id: string }>;
  /** What changes if executed. Plain-English. */
  rationale: string;
  /** Concrete artifact: PR draft markdown / cheatsheet text / bulletin .md. */
  artifact: string;
  /** Should this action BLOCK publish if not executed? */
  blocking: boolean;
  /** Composite priority inherited from the highest-priority finding closed. */
  priority: number;
}

export interface ReciprocityEntry {
  vendor: string;
  /** Bulletin seq this records a response to. */
  bulletinSeq: number;
  /** "fix" | "ignore" | "acknowledge" | "disputed". */
  response: "fix" | "ignore" | "acknowledge" | "disputed";
  /** Days between bulletin emission and observed response (NaN if no response). */
  reactionDays: number;
  /** Trust delta to apply to vendor's aletheia weight (+0.05 fix, -0.10 ignore, ±0 ack/disputed). */
  trustDelta: number;
  /** ISO of when the response was recorded. */
  at: string;
}

export interface FlywheelReport {
  spec: { name: "MNEME-FLYWHEEL"; version: "1.0" };
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  /** Number of raw findings harvested per source. */
  harvestCounts: Record<SignalSource, number>;
  fusedCount: number;
  clusterCount: number;
  actions: PrescribedAction[];
  /** Reciprocity ledger snapshot at run time. */
  reciprocity: ReciprocityEntry[];
  /** Aggregate health 0..100 (1 − fraction of BLOCK actions). */
  health: number;
  trafficLight: "green" | "yellow" | "red";
  headline: string;
  hmac: string;
  seq: number;
  bodyDigest: string;
}

export interface FlywheelOptions {
  /** Limit raw findings per source to bound work. */
  perSourceLimit?: number;
  /** Min cluster size to recommend a deletion (default 0 = any dormant primitive gets a delete option). */
  minDeleteAge?: number;
  /** If true, skip the EXECUTE side-effects (no Aletheia weights write). Useful for dry-runs. */
  dryRun?: boolean;
}
