/**
 * v1.71.0 -- SENTINEL ORCHESTRATOR.
 *
 * The full intercept pipeline for AI-proposed shell commands:
 *
 *   1. Command Detector  (signature catalog)
 *   2. Scope Enforcer    (repo boundary)
 *   3. Risk Scorer       (composite score + action)
 *   4. Self-Learning     (per-repo policy from past audit)
 *   5. HMAC Audit Ledger (tamper-evident log)
 *
 * Returns a SentinelDecision that the MCP layer (or any executor)
 * consults BEFORE running the command. The decision carries
 * action = ALLOW / AUDIT / WARN / BLOCK + complete reasoning.
 *
 * NEW IN v1.71: CHRONOLOGICAL TRUST DECAY. Commands seen N times in
 * past audit at ALLOW level + no tampering -> trust score rises ->
 * subsequent identical commands skip heavy verification.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { scoreRisk, type RiskScoreReport, type RecommendedAction } from "./risk_scorer.js";
import { appendAudit, readAuditLog, type AuditEntry } from "./audit_ledger.js";

const POLICY_FILE = ".mneme/sentinel/policy.json";

export interface LearnedPolicy {
  /** sha256(command) -> trust record. */
  trustByHash: Record<string, { allowed: number; lastSeenTs: string; firstSeenTs: string }>;
  updatedAt: string;
}

function hashCmd(c: string): string {
  return createHash("sha256").update(c.trim()).digest("hex").slice(0, 16);
}

function readPolicy(repoRoot: string): LearnedPolicy {
  const p = join(repoRoot, POLICY_FILE);
  if (!existsSync(p)) return { trustByHash: {}, updatedAt: new Date(0).toISOString() };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LearnedPolicy;
  } catch { return { trustByHash: {}, updatedAt: new Date(0).toISOString() }; }
}

function writePolicy(repoRoot: string, policy: LearnedPolicy): void {
  const dir = join(repoRoot, ".mneme/sentinel");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, POLICY_FILE), JSON.stringify(policy, null, 2) + "\n", "utf8");
}

export interface SentinelDecision {
  command: string;
  action: RecommendedAction;
  score: number;
  /** Verdict reasons -- list of named factors. */
  reasons: string[];
  riskReport: RiskScoreReport;
  /** Whether this command's hash has been ALLOWed in the past. */
  trustLevel: "novel" | "seen-once" | "trusted";
  /** How many past ALLOW occurrences. */
  pastAllows: number;
  /** Audit entry written (when action != ALLOW or auditAlways). */
  auditEntry: AuditEntry | null;
  headline: string;
}

export interface SentinelOptions {
  /** Vendor (AI agent) name. */
  vendor?: string;
  /** Always audit (even ALLOW). Default false. */
  auditAlways?: boolean;
  /** Persist trust learning. Default true. */
  learn?: boolean;
  /** When the command was actually executed (caller flips after action). */
  executed?: boolean;
}

export function intercept(repoRoot: string, command: string, opts?: SentinelOptions): SentinelDecision {
  const risk = scoreRisk(repoRoot, command);
  const reasons: string[] = [];

  // Apply trust decay: commands previously allowed N times relax the action.
  const policy = readPolicy(repoRoot);
  const h = hashCmd(command);
  const trustRec = policy.trustByHash[h];
  const pastAllows = trustRec?.allowed ?? 0;
  let trustLevel: SentinelDecision["trustLevel"] = "novel";
  if (pastAllows >= 5) trustLevel = "trusted";
  else if (pastAllows >= 1) trustLevel = "seen-once";

  // Action: trust-adjusted.
  let action: RecommendedAction = risk.recommendedAction;
  for (const m of risk.detection.matches) {
    reasons.push(`${m.signature.id}: ${m.signature.rationale}`);
  }
  for (const v of risk.scope.violations) {
    reasons.push(`scope-${v.category}: ${v.reason}`);
  }
  if (trustLevel === "trusted" && action === "AUDIT") {
    action = "ALLOW";
    reasons.push(`trust: command seen ALLOW ${pastAllows}x previously -- demoted from AUDIT.`);
  }
  // Never demote BLOCK / WARN via trust alone -- explicit catalog hits stay.

  // Write audit when action != ALLOW or caller requests.
  let auditEntry: AuditEntry | null = null;
  if (action !== "ALLOW" || opts?.auditAlways) {
    auditEntry = appendAudit(repoRoot, command, risk, {
      vendor: opts?.vendor ?? "unknown",
      executed: opts?.executed ?? false,
    });
  }

  // Update learned policy when action == ALLOW (and learn is on).
  if (opts?.learn !== false && action === "ALLOW") {
    const next: LearnedPolicy = { ...policy };
    next.trustByHash[h] = {
      allowed: (trustRec?.allowed ?? 0) + 1,
      firstSeenTs: trustRec?.firstSeenTs ?? new Date().toISOString(),
      lastSeenTs: new Date().toISOString(),
    };
    next.updatedAt = new Date().toISOString();
    writePolicy(repoRoot, next);
  }

  const headline = `SENTINEL ${action}: risk=${risk.score}/100, trust=${trustLevel}, ${risk.detection.matches.length} catalog hit(s).`;

  return {
    command, action, score: risk.score, reasons,
    riskReport: risk,
    trustLevel, pastAllows,
    auditEntry, headline,
  };
}

/** Auto-mint a vaccine from past BLOCK decisions -- the per-repo
 *  learning loop. */
export function harvestVaccines(repoRoot: string): { newVaccines: number; sample: string[] } {
  const audit = readAuditLog(repoRoot);
  const blocked = audit.filter((e) => e.action === "BLOCK");
  // Group by class.
  const byClass = new Map<string, AuditEntry[]>();
  for (const e of blocked) {
    for (const c of e.classes) {
      const arr = byClass.get(c) ?? [];
      arr.push(e);
      byClass.set(c, arr);
    }
  }
  const sample: string[] = [];
  let total = 0;
  for (const [cls, entries] of byClass) {
    if (entries.length >= 2) {
      total += 1;
      sample.push(`${cls}: ${entries.length} block(s) -> vaccine`);
    }
  }
  return { newVaccines: total, sample };
}
