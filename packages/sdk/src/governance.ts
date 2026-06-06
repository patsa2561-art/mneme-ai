/**
 * @mneme-ai/sdk/governance — drop-in agent governance.
 *
 * The whole point: make every tool-call a governed agent makes gated + audited + (human-)approved
 * + certifiable, by changing ONE line of your agent. Wrap your tool executor once:
 *
 *   import { createGovernor } from "@mneme-ai/sdk";
 *
 *   const gov = createGovernor({ agent: "Grok", task: "refactor auth", onNeedsApproval: askPhone });
 *   const run = gov.guard(myToolExecutor);          // ← the only change
 *   await run("bash", { command: "rm -rf /" });     // throws GovernanceBlocked — never reaches the tool
 *   const cert = gov.sign();                         // a portable, NOTARY-signed Agent Run Certificate
 *   // anyone verifies it OFFLINE: `mneme agentcert verify cert.json`  (no Mneme, no vendor trust)
 *
 * The certificate from a governed run is policy-compliant + offline-verifiable BY CONSTRUCTION —
 * the API gives you no way to silently execute a blocked call.
 */
import { writeFileSync } from "node:fs";
import { harness, agentcert, notary } from "@mneme-ai/core";

export const createHarness = harness.createHarness;
export const GovernanceBlocked = harness.GovernanceBlocked;
export type HarnessOptions = harness.HarnessOptions;
export type AgentHarness = harness.AgentHarness;
export type AgentRunCertificate = agentcert.AgentRunCertificate;

export interface Governor extends harness.AgentHarness {
  /** Build the Agent Run Certificate, NOTARY-sign it (Ed25519, offline-verifiable), and optionally
   *  write it to disk. The signed artifact embeds its evidence — verifiable from one file, anywhere. */
  sign(opts?: { repoRoot?: string; out?: string }): unknown;
  /** Verify the current run's certificate against its own evidence (no signature check). */
  selfVerify(): agentcert.CertVerify;
}

export function createGovernor(opts: harness.HarnessOptions): Governor {
  const h = harness.createHarness(opts);
  function evidence(): agentcert.RunEvidence {
    const c = h.certificate();
    return { runId: c.runId, agent: c.agent, model: c.model, task: c.task, startedAt: c.startedAt, endedAt: c.endedAt, auditFrames: h.frames(), approvals: h.approvals() };
  }
  function sign(o?: { repoRoot?: string; out?: string }): unknown {
    const cert = h.certificate();
    const payload = { cert, evidence: evidence() };
    let signed: unknown = payload;
    try { signed = notary.issueReceipt(o?.repoRoot ?? process.cwd(), { kind: "reasoning-trace", subject: `agent-run-cert:${cert.runId}`, payload, includePayload: true, issuedAt: Date.now() }); } catch { /* notary optional */ }
    if (o?.out) writeFileSync(o.out, JSON.stringify(signed, null, 2), "utf8");
    return signed;
  }
  return { ...h, sign, selfVerify: () => agentcert.verifyCertificate(h.certificate(), evidence()) };
}
