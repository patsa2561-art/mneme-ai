/**
 * v2.26.0 — PEAK PERFORMANCE GAUNTLET / AUTO-OPTIMIZER types.
 *
 * The Gauntlet runs the 12 deep-findings probes (N1-N12) against the
 * live MCP server + scores each 0-10 stars + produces an HMAC-signed
 * scorecard. AI agents can:
 *   mneme.tune.run            run the probe + emit signed scorecard
 *   mneme.tune.report         read latest signed card
 *   mneme.tune.suggest_fix    given a finding id, return remediation
 *
 * Scorecard is HMAC-chained per-run; ledger lives at
 *   .mneme/tune/scorecard.jsonl
 * + each full card at .mneme/tune/<seq>-<utc>.json.
 *
 * Each finding has:
 *   id           — N1 .. N12
 *   title        — short summary
 *   probe        — async function that returns { stars, evidence }
 *   remediation  — list of human-actionable fixes the operator can run
 *   sinceVersion — which version first hardened this finding
 */

export type FindingId = `N${number}`;

export interface FindingResult {
  /** 0..10 — 10 = best, 0 = critical fail. */
  stars: number;
  /** One-line summary of what we measured. */
  evidence: string;
  /** Optional structured detail (counts, ids, etc). */
  detail?: Record<string, unknown>;
  /** Per-finding duration. */
  dtMs?: number;
}

export interface Finding {
  id: FindingId;
  title: string;
  /** Brief spec citation. */
  spec: string;
  /** Which MCP primitive / module fixes this. */
  sinceVersion: string;
  /** Probe function — see engine.ts for the live implementation. */
  probe: (target: ProbeTarget) => Promise<FindingResult>;
  /** Static remediation hints. */
  remediation: string[];
}

export interface ProbeTarget {
  /** Working dir for spawn. */
  cwd: string;
  /** Optional spawn command override. */
  cmd?: { exe: string; args: string[] };
}

export interface ScoreCard {
  spec: { name: "MNEME-PEAK-GAUNTLET"; version: string };
  target: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  findings: Array<{
    id: FindingId;
    title: string;
    stars: number;
    evidence: string;
    detail?: Record<string, unknown>;
    dtMs?: number;
    sinceVersion: string;
  }>;
  /** Aggregate score 0..100 = avg stars × 10. */
  overall: number;
  /** Headline. */
  headline: string;
  trafficLight: "green" | "yellow" | "red" | "black";
  /** HMAC chain link. */
  hmac: string;
  /** Sequence number. */
  seq: number;
  /** SHA-256 of canonical body (without hmac/seq). */
  bodyDigest: string;
}

export interface SuggestedFix {
  findingId: FindingId;
  steps: string[];
  /** Concrete CLI / MCP commands the operator can copy-paste. */
  commands: string[];
  /** Pointer to the source file that ships the fix. */
  sourcePath?: string;
}
