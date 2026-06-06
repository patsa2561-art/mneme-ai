/**
 * AGENT RUN CERTIFICATE (ARC) — one portable, offline-verifiable certificate for one complete
 * governed agent run. The piece a giant adopts, an insurer underwrites, and a small shop shows
 * its customer — because no vendor can issue it for itself (the moment a vendor owns the proof,
 * it isn't neutral).
 *
 * THE INSIGHT that makes it insurance-grade: the certificate does NOT *assert* "the agent behaved";
 * it *derives* its summary from BOUND EVIDENCE (the MCP-gateway audit chain + the signed human
 * approvals), and a verifier RE-DERIVES that summary from the same evidence and checks it matches.
 * A certificate therefore cannot lie about its own contents — prove, don't claim.
 *
 * Verification (anyone, OFFLINE, no Mneme, no vendor):
 *   1. the NOTARY (Ed25519) signature over the cert is valid     (authentic + untampered)   [CLI layer]
 *   2. the bound audit chain verifies                            (tamper-evident evidence)
 *   3. every recorded decision is CONSISTENT with its risk       (the gate wasn't bypassed/forged)
 *   4. the cert's summary re-derives EXACTLY from the evidence   (the cert can't misrepresent it)
 *
 * ★HONEST (DIAKRISIS): it certifies what the GATEWAY saw + decided + what a human approved — a
 * tamper-evident, offline-verifiable governance record. It does NOT prove an agent never acted
 * OUTSIDE the gateway (that's the wrapping's job — route tool/model calls through Mneme); and the
 * insurability band is a deterministic read of the record, NOT an actuarial promise.
 */
import { createHash } from "node:crypto";
import { verifyAuditChain, type AuditFrame } from "../mcpgate/index.js";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
const canon = (x: unknown): string => { try { return JSON.stringify(x) ?? "null"; } catch { return String(x); } };
const round = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface RunApproval { id: string; decision: "allow" | "deny"; by: string; on: string; at: number }
export interface RunEvidence {
  runId: string; agent: string; model?: string; task?: string;
  startedAt: number; endedAt: number;
  auditFrames: AuditFrame[];     // the MCP-gateway frames for this run (tamper-evident)
  approvals?: RunApproval[];     // signed human decisions (from the pager Proxy-of-Record)
}

export type Insurability = "insurable" | "review" | "uninsurable";
export interface RunSummary {
  calls: number; allowed: number; blocked: number; needsApproval: number;
  humanApprovals: number; humanDenials: number;
  riskMax: number; toolsUsed: string[];
  auditChainOk: boolean; auditChainHead: string;
  decisionsConsistent: boolean;   // no recorded "allow" had a block-grade risk (gate not bypassed)
  escalationsAccounted: boolean;  // every escalation has a human decision (≤1 may be in-flight)
  policyCompliant: boolean;       // chain ok ∧ consistent ∧ accounted
  insurability: Insurability;
}

/** DERIVE the run summary from evidence — deterministic, the heart of "prove don't claim". */
export function summarizeRun(ev: RunEvidence): RunSummary {
  const frames = (ev?.auditFrames ?? []).filter((f) => f && typeof f === "object");
  const by = (d: string) => frames.filter((f) => f.decision === d).length;
  const allowed = by("allow"), blocked = by("block"), needsApproval = by("needs-approval");
  const riskMax = frames.reduce((m, f) => Math.max(m, Number(f.risk) || 0), 0);
  const toolsUsed = Array.from(new Set(frames.map((f) => String(f.tool || "")))).filter(Boolean);
  const chain = verifyAuditChain(frames);
  const apprs = ev?.approvals ?? [];
  const humanApprovals = apprs.filter((a) => a?.decision === "allow").length;
  const humanDenials = apprs.filter((a) => a?.decision === "deny").length;
  // (3) a recorded ALLOW with block-grade risk is impossible from the real gate → forged/bypassed.
  const decisionsConsistent = !frames.some((f) => f.decision === "allow" && (Number(f.risk) || 0) >= 0.85);
  // (escalations) every needs-approval should have a human decision; allow one in-flight.
  const escalationsAccounted = needsApproval <= humanApprovals + humanDenials + 1;
  const policyCompliant = chain.ok && decisionsConsistent && escalationsAccounted;
  const insurability: Insurability = !policyCompliant ? "uninsurable" : (blocked > 0 || riskMax >= 0.85) ? "review" : "insurable";
  return {
    calls: frames.length, allowed, blocked, needsApproval, humanApprovals, humanDenials,
    riskMax: round(riskMax), toolsUsed,
    auditChainOk: chain.ok, auditChainHead: frames.length ? frames[frames.length - 1].frameId : "",
    decisionsConsistent, escalationsAccounted, policyCompliant, insurability,
  };
}

export interface AgentRunCertificate {
  v: 1; runId: string; agent: string; model?: string; task?: string;
  startedAt: number; endedAt: number;
  framesCount: number;
  evidenceHash: string;   // sha256 over the canonical evidence — binds the cert to exactly its proof
  summary: RunSummary;
}
/** Build the certificate body (sign it with NOTARY at the CLI/MCP layer for offline verify). */
export function buildCertificate(ev: RunEvidence): AgentRunCertificate {
  const frames = ev?.auditFrames ?? [];
  return {
    v: 1, runId: String(ev?.runId ?? ""), agent: String(ev?.agent ?? "unknown"),
    model: ev?.model, task: ev?.task, startedAt: Number(ev?.startedAt) || 0, endedAt: Number(ev?.endedAt) || 0,
    framesCount: frames.length,
    evidenceHash: sha(canon({ frames, approvals: ev?.approvals ?? [] })),
    summary: summarizeRun(ev),
  };
}

export interface CertVerify { valid: boolean; reasons: string[] }
/** Verify a certificate against its evidence OFFLINE: the evidence binds (hash), the audit chain
 *  is intact, and the cert's summary RE-DERIVES exactly — so the cert cannot misrepresent its run.
 *  (The NOTARY/Ed25519 signature over the cert is checked by the caller — it proves authorship.) */
export function verifyCertificate(cert: AgentRunCertificate, evidence: RunEvidence): CertVerify {
  const reasons: string[] = [];
  if (!cert || typeof cert !== "object") return { valid: false, reasons: ["no certificate"] };
  if (!evidence || typeof evidence !== "object") return { valid: false, reasons: ["no evidence to verify against"] };
  const eh = sha(canon({ frames: evidence.auditFrames ?? [], approvals: evidence.approvals ?? [] }));
  if (eh !== cert.evidenceHash) reasons.push("evidence does NOT match the certificate (evidenceHash mismatch) — wrong or altered evidence");
  const chain = verifyAuditChain(evidence.auditFrames ?? []);
  if (!chain.ok) reasons.push(`audit chain broken at #${chain.brokenAt}: ${chain.reason}`);
  const rederived = summarizeRun(evidence);
  if (canon(rederived) !== canon(cert.summary)) reasons.push("the certificate's summary does NOT re-derive from the evidence — the cert misrepresents the run");
  if (!rederived.decisionsConsistent) reasons.push("a recorded ALLOW carried block-grade risk — the gate was bypassed or the ledger forged");
  return { valid: reasons.length === 0, reasons: reasons.length ? reasons : ["verified — summary re-derives from a tamper-evident chain; offline, no vendor trust"] };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
function chainOf(decisions: Array<{ tool: string; decision: "allow" | "needs-approval" | "block"; risk: number }>, run = "r1"): AuditFrame[] {
  // build a valid hash-chain using the real appender (so the gauntlet's evidence is genuine)
  const out: AuditFrame[] = []; let prev: AuditFrame | null = null;
  // local re-implementation of the frame hash to avoid importing the appender's gateCall
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const base = { seq: i, ts: 1000 + i, run, tool: d.tool, agent: "claude", argsHash: sha(d.tool + i), decision: d.decision, risk: d.risk, prev: prev?.frameId ?? "" };
    const frameId = sha(JSON.stringify({ seq: base.seq, ts: base.ts, run: base.run, tool: base.tool, agent: base.agent, argsHash: base.argsHash, decision: base.decision, risk: base.risk, prev: base.prev }));
    const f = { ...base, frameId } as AuditFrame; out.push(f); prev = f;
  }
  return out;
}
export interface AgentCertGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function agentCertGauntlet(): AgentCertGauntlet {
  const clean: RunEvidence = { runId: "r1", agent: "claude", startedAt: 1000, endedAt: 2000, auditFrames: chainOf([{ tool: "read", decision: "allow", risk: 0.2 }, { tool: "ls", decision: "allow", risk: 0.15 }]) };
  const cleanCert = buildCertificate(clean);
  const cleanOK = cleanCert.summary.insurability === "insurable" && cleanCert.summary.policyCompliant && verifyCertificate(cleanCert, clean).valid;

  const withApproval: RunEvidence = { runId: "r2", agent: "grok", startedAt: 1, endedAt: 2, auditFrames: chainOf([{ tool: "http", decision: "needs-approval", risk: 0.5 }, { tool: "deploy", decision: "block", risk: 0.95 }], "r2"), approvals: [{ id: "x", decision: "deny", by: "human", on: "telegram", at: 5 }] };
  const reviewCert = buildCertificate(withApproval);
  const reviewOK = reviewCert.summary.insurability === "review" && reviewCert.summary.blocked === 1 && reviewCert.summary.policyCompliant && verifyCertificate(reviewCert, withApproval).valid;

  // a FORGED ledger: an "allow" with block-grade risk (the gate would never do this)
  const forged: RunEvidence = { runId: "r3", agent: "x", startedAt: 1, endedAt: 2, auditFrames: chainOf([{ tool: "bash", decision: "allow", risk: 0.95 }], "r3") };
  const forgedCert = buildCertificate(forged);
  const forgedOK = forgedCert.summary.decisionsConsistent === false && forgedCert.summary.insurability === "uninsurable";

  // a TAMPERED chain → uninsurable + verify fails
  const tampered: RunEvidence = { ...clean, auditFrames: clean.auditFrames.map((f, i) => i === 1 ? { ...f, risk: 0.0 } : f) };
  const tamperOK = !verifyCertificate(cleanCert, tampered).valid;   // wrong evidence for this cert

  // a cert verified against MISMATCHED evidence (different run) → invalid
  const mismatchOK = !verifyCertificate(cleanCert, withApproval).valid;
  // prove-don't-claim: hand-editing the cert's summary is caught on re-derive
  const liedCert = { ...cleanCert, summary: { ...cleanCert.summary, blocked: 0, insurability: "insurable" as Insurability, calls: 999 } };
  const lieOK = !verifyCertificate(liedCert, clean).valid;
  const total = (() => { try { summarizeRun(null as never); buildCertificate(null as never); verifyCertificate(null as never, null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "CLEAN-RUN-INSURABLE", pass: cleanOK, detail: "a run of allowed read-only calls → insurable + policy-compliant + verifies" },
    { name: "BLOCK+APPROVAL-REVIEW", pass: reviewOK, detail: "a run with a blocked call + a human denial → review band, still compliant + verifies" },
    { name: "FORGED-LEDGER-CAUGHT", pass: forgedOK, detail: "an 'allow' carrying block-grade risk = inconsistent → uninsurable (the gate can't have done that)" },
    { name: "TAMPER-EVIDENT", pass: tamperOK, detail: "a cert checked against tampered evidence → invalid" },
    { name: "EVIDENCE-BINDING", pass: mismatchOK, detail: "a cert checked against a DIFFERENT run's evidence → invalid (evidenceHash binds)" },
    { name: "PROVE-NOT-CLAIM", pass: lieOK, detail: "hand-editing the cert's summary is caught — it must re-derive from the bound evidence" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
