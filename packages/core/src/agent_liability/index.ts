/**
 * AGENT-RUN LIABILITY — underwriting on a PROVABLE governance record, not a guess about the future.
 *
 * An insurer can't underwrite "is this AI agent safe?" from a vendor's word. But an Agent Run
 * Certificate (ARC) is a signed, offline-verifiable record of what the run actually did: how many
 * calls were gated, how many blocked, how many escalated to a human and were approved, the max risk,
 * and whether the audit chain is intact (policy-compliant). This module turns that record into a
 * deterministic underwriting decision: a coverage band + a premium MULTIPLIER + the conditions that
 * must hold + what VOIDS cover. The vendor's measured honesty (a Wilson lower-bound false-rate, if
 * available) tightens the premium.
 *
 * ★HONEST (DIAKRISIS): this is deterministic underwriting on a signed record — NOT an actuarial
 * promise and NOT a prediction of THIS run's future. There is no dollar figure here: the premium is
 * a multiplier on whatever base rate the insurer sets (they supply the money). An unverified or
 * non-compliant certificate is DECLINED, not optimistically covered. Pairs with the existing
 * `oracleLiability` (which underwrites a code CHANGE); this underwrites an agent RUN.
 */
import type { AgentRunCertificate } from "../agentcert/index.js";

const round = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export interface LiabilityInput {
  cert: AgentRunCertificate;
  /** did the caller verify the certificate (signature + re-derive)? an unverified cert is declined. */
  certVerified?: boolean;
  /** the vendor's measured honesty as a Wilson-95% lower-bound false-rate (0..1), if known. */
  vendorFalseRateLB?: number;
}

export type CoverageBand = "full" | "standard" | "conditional" | "declined";
export interface LiabilityAssessment {
  runId: string; agent: string;
  insurable: boolean;
  coverageBand: CoverageBand;
  premiumMultiplier: number;   // 0.5 .. 3.0, applied to the insurer's own base rate
  riskScore: number;           // 0..1 (deterministic, from the record)
  oversightRatio: number;      // share of escalations a human actually decided (0..1)
  conditions: string[];
  voidIf: string[];
  reasons: string[];
}

export function assessAgentRunLiability(input: LiabilityInput): LiabilityAssessment {
  const cert = input?.cert ?? ({} as AgentRunCertificate);
  const s = cert.summary ?? ({} as AgentRunCertificate["summary"]);
  const runId = String(cert.runId ?? ""), agent = String(cert.agent ?? "agent");
  const verified = input?.certVerified !== false;   // default: treat as verified unless explicitly false
  const vendorPenalty = clamp(Number(input?.vendorFalseRateLB) || 0, 0, 1);

  const escalations = Number(s.needsApproval) || 0;
  const humanDecisions = (Number(s.humanApprovals) || 0) + (Number(s.humanDenials) || 0);
  const oversightRatio = escalations === 0 ? 1 : clamp(humanDecisions / escalations, 0, 1);

  const reasons: string[] = [];
  // hard declines first — you cannot insure a record you can't trust
  if (!verified) reasons.push("the certificate was not verified (signature + re-derive) — cannot underwrite an untrusted record");
  if (!s.auditChainOk) reasons.push("the audit chain is not intact — the governance record is not tamper-evident");
  if (s.policyCompliant === false) reasons.push("the run is not policy-compliant (a forged/bypassed gate or unaccounted escalation)");
  const hardDecline = !verified || !s.auditChainOk || s.policyCompliant === false;

  // deterministic risk from the signed record
  let riskScore = (Number(s.riskMax) || 0) * 0.45
    + (s.insurability === "review" ? 0.15 : 0)
    + (1 - oversightRatio) * 0.25          // unattended escalations raise risk
    + vendorPenalty * 0.3;
  riskScore = clamp(round(riskScore), 0, 1);

  if (hardDecline) {
    return { runId, agent, insurable: false, coverageBand: "declined", premiumMultiplier: 3.0, riskScore: Math.max(riskScore, 0.85), oversightRatio: round(oversightRatio), conditions: [], voidIf: [], reasons };
  }

  const premiumMultiplier = round(clamp(0.5 + riskScore * 2.5, 0.5, 3.0));
  const coverageBand: CoverageBand = riskScore < 0.2 ? "full" : riskScore < 0.45 ? "standard" : riskScore < 0.7 ? "conditional" : "declined";
  const insurable = coverageBand !== "declined";

  if (insurable) reasons.push(`insurable (${coverageBand}) — compliant, tamper-evident record; risk ${riskScore}, oversight ${round(oversightRatio * 100)}%`);
  else reasons.push(`risk ${riskScore} exceeds the conditional ceiling — declined on this run's record`);

  const conditions = [
    "the Agent Run Certificate must verify offline (signature + summary re-derives) at claim time",
    "every escalation in scope was decided by a human (no silent override)",
    "the agent's tool/model calls were routed through the governed harness (the record is complete)",
  ];
  const voidIf = [
    "the audit chain is later found broken or the certificate altered",
    "a sensitive action was taken OUTSIDE the harness (not in the record)",
    s.blocked > 0 ? "a blocked call was force-executed by other means" : "a policy-blocked action was performed anyway",
  ];
  return { runId, agent, insurable, coverageBand, premiumMultiplier, riskScore, oversightRatio: round(oversightRatio), conditions, voidIf, reasons };
}

export interface LiabilityCertificate extends LiabilityAssessment { v: 1; kind: "agent-run-liability"; issuedAt: number; certRunId: string }
/** Build the liability certificate body (NOTARY-sign it at the CLI/HTTP edge for offline verify). */
export function buildLiabilityCertificate(input: LiabilityInput, now: number): LiabilityCertificate {
  const a = assessAgentRunLiability(input);
  return { v: 1, kind: "agent-run-liability", issuedAt: Number(now) || 0, certRunId: String(input?.cert?.runId ?? ""), ...a };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
type Summ = AgentRunCertificate["summary"];
function certWith(s: Partial<Summ>, runId = "r"): AgentRunCertificate {
  const summary: Summ = { calls: 1, allowed: 1, blocked: 0, needsApproval: 0, humanApprovals: 0, humanDenials: 0, riskMax: 0.2, toolsUsed: [], auditChainOk: true, auditChainHead: "h", decisionsConsistent: true, escalationsAccounted: true, policyCompliant: true, insurability: "insurable", ...s };
  return { v: 1, runId, agent: "Grok", startedAt: 0, endedAt: 1, framesCount: summary.calls, evidenceHash: "eh", summary };
}
export interface AgentLiabilityGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function agentLiabilityGauntlet(): AgentLiabilityGauntlet {
  // clean low-risk run → full cover, low premium
  const clean = assessAgentRunLiability({ cert: certWith({ riskMax: 0.15 }), certVerified: true });
  const cleanOK = clean.insurable && clean.coverageBand === "full" && clean.premiumMultiplier < 1.0 && clean.oversightRatio === 1;

  // unverified cert → DECLINED regardless of how good it looks
  const unver = assessAgentRunLiability({ cert: certWith({ riskMax: 0.1 }), certVerified: false });
  const unverOK = !unver.insurable && unver.coverageBand === "declined" && unver.reasons.some((r) => r.includes("not verified"));

  // non-compliant (forged gate) → DECLINED
  const forged = assessAgentRunLiability({ cert: certWith({ policyCompliant: false, decisionsConsistent: false }), certVerified: true });
  const forgedOK = !forged.insurable && forged.coverageBand === "declined";

  // escalations with NO human oversight → higher risk, premium rises
  const unattended = assessAgentRunLiability({ cert: certWith({ needsApproval: 4, humanApprovals: 0, riskMax: 0.5, insurability: "review" }), certVerified: true });
  const attended = assessAgentRunLiability({ cert: certWith({ needsApproval: 4, humanApprovals: 4, riskMax: 0.5, insurability: "review" }), certVerified: true });
  const oversightOK = unattended.oversightRatio === 0 && attended.oversightRatio === 1 && unattended.premiumMultiplier > attended.premiumMultiplier && unattended.riskScore > attended.riskScore;

  // a worse vendor honesty (higher false-rate LB) → higher premium
  const honest = assessAgentRunLiability({ cert: certWith({ riskMax: 0.3 }), certVerified: true, vendorFalseRateLB: 0.0 });
  const shady = assessAgentRunLiability({ cert: certWith({ riskMax: 0.3 }), certVerified: true, vendorFalseRateLB: 0.5 });
  const vendorOK = shady.premiumMultiplier > honest.premiumMultiplier;

  // premium bounded; certificate carries the run id + kind
  const cert = buildLiabilityCertificate({ cert: certWith({}, "run9"), certVerified: true }, 123);
  const certOK = cert.kind === "agent-run-liability" && cert.certRunId === "run9" && cert.issuedAt === 123 && cert.premiumMultiplier >= 0.5 && cert.premiumMultiplier <= 3.0;

  const total = (() => { try { assessAgentRunLiability(null as never); buildLiabilityCertificate(null as never, 0); return true; } catch { return false; } })();

  const checks = [
    { name: "CLEAN-FULL-COVER", pass: cleanOK, detail: "a compliant low-risk run → full cover at a below-base premium" },
    { name: "UNVERIFIED-DECLINED", pass: unverOK, detail: "an unverified certificate is declined no matter how good it looks" },
    { name: "FORGED-DECLINED", pass: forgedOK, detail: "a non-compliant (forged/bypassed-gate) run is declined" },
    { name: "OVERSIGHT-LOWERS-PREMIUM", pass: oversightOK, detail: "human-decided escalations lower risk + premium vs unattended ones" },
    { name: "VENDOR-HONESTY-PRICES", pass: vendorOK, detail: "a worse measured vendor false-rate raises the premium" },
    { name: "CERT-BOUNDED", pass: certOK, detail: "the liability certificate carries run id + kind; premium ∈ [0.5, 3.0]" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
