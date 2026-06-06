/**
 * THE AGENT HARNESS — drop-in agent governance in ~5 lines.
 *
 * Wrapping every tool-call by hand (gate → audit → escalate → certify) is the work nobody wants
 * to do, so nobody does it. The Harness makes it ONE wrap: hand it your tool executor, get back a
 * transparent, governed executor whose signature is unchanged — every call is gated by the
 * Behavioral Compiler + your policy + the tool's SKILLSCAN provenance, appended to a tamper-evident
 * audit chain, escalated to a human (`onNeedsApproval` — wire it to the phone pager), and at the
 * end it mints the signed Agent Run Certificate. Wrap once, governed forever.
 *
 *   const h = createHarness({ agent: "Grok", task: "refactor", onNeedsApproval: askPhone });
 *   const run = h.guard(myToolExecutor);         // ← the only change to your agent
 *   await run("bash", { command: "rm -rf /" });  // throws GovernanceBlocked; never reaches the tool
 *   const cert = h.certificate();                // a verifiable, insurance-grade run certificate
 *
 * ★The elegant invariant: because every decision flows through `gate`, a run governed by the
 * Harness ALWAYS yields a policy-compliant, offline-verifiable certificate by construction — the
 * API gives you no way to silently execute a blocked call.
 *
 * (This is the SDK-ergonomic wrapper; distinct from the heavier `agentGovernor` Charter kernel.)
 * Pure composition over mcpgate + agentcert; persistence + NOTARY signing are the SDK/CLI's job.
 */
import { gateCall, appendAuditFrame, type GatePolicy, type ToolProvenance, type ToolCall, type CallVerdict, type GateDecision, type AuditFrame } from "../mcpgate/index.js";
import { buildCertificate, verifyCertificate, type AgentRunCertificate, type RunApproval } from "../agentcert/index.js";

export class GovernanceBlocked extends Error {
  constructor(public tool: string, public reasons: string[], public risk: number) { super(`GovernanceBlocked: ${tool} — ${reasons.join("; ") || "blocked by policy"}`); this.name = "GovernanceBlocked"; }
}

export interface HarnessOptions {
  agent: string; task?: string; model?: string; run?: string;
  policy?: GatePolicy;
  /** optional per-tool provenance (e.g. the SKILLSCAN verdict for the tool's skill). */
  provenance?: (tool: string) => ToolProvenance | undefined;
  /** the human-in-the-loop hook for NEEDS-APPROVAL — wire it to the Cosmic Pager (phone). */
  onNeedsApproval?: (call: ToolCall, verdict: CallVerdict) => Promise<"allow" | "deny"> | "allow" | "deny";
  /** injectable monotonic clock (deterministic tests / Date.now()-unavailable runtimes). */
  now?: () => number;
}
export interface GateResult { decision: GateDecision; allowed: boolean; verdict: CallVerdict; approvedBy?: "human" }

export interface AgentHarness {
  /** Gate one tool-call: decide → audit → (escalate to human) → return the effective decision. */
  gate(tool: string, args?: unknown): Promise<GateResult>;
  /** Wrap a tool executor so every call is gated first; throws GovernanceBlocked on a refusal.
   *  The wrapped function keeps the original signature + return type — a transparent drop-in. */
  guard<P extends [tool: string, args?: unknown, ...rest: unknown[]], R>(exec: (...args: P) => R): (...args: P) => Promise<Awaited<R>>;
  frames(): AuditFrame[];
  approvals(): RunApproval[];
  /** Build the (unsigned) Agent Run Certificate for everything governed so far. Sign at the edge. */
  certificate(): AgentRunCertificate;
}

export function createHarness(opts: HarnessOptions): AgentHarness {
  const now = opts?.now ?? (() => { try { return Date.now(); } catch { return 0; } });
  const runId = String(opts?.run ?? "run");
  const agent = String(opts?.agent ?? "agent");
  const frames: AuditFrame[] = [];
  const approvals: RunApproval[] = [];
  let startedAt = 0;

  async function gate(tool: string, args?: unknown): Promise<GateResult> {
    const call: ToolCall = { tool, agent, args, run: runId };
    const verdict = gateCall(call, opts?.policy ?? {}, opts?.provenance?.(tool));
    const ts = now(); if (!startedAt) startedAt = ts;
    let decision = verdict.decision;
    let approvedBy: "human" | undefined;
    if (decision === "needs-approval" && opts?.onNeedsApproval) {
      let human: "allow" | "deny" = "deny";
      try { human = await opts.onNeedsApproval(call, verdict); } catch { human = "deny"; }
      approvals.push({ id: verdict.argsHash.slice(0, 16), decision: human === "allow" ? "allow" : "deny", by: "human", on: "pager", at: now() });
      decision = human === "allow" ? "allow" : "block";
      if (human === "allow") approvedBy = "human";
    }
    const prev = frames.length ? frames[frames.length - 1] : null;
    frames.push(appendAuditFrame(prev, call, { ...verdict, decision }, ts));   // record the FINAL decision
    return { decision, allowed: decision === "allow", verdict, approvedBy };
  }

  function guard<P extends [tool: string, args?: unknown, ...rest: unknown[]], R>(exec: (...args: P) => R): (...args: P) => Promise<Awaited<R>> {
    return async (...args: P): Promise<Awaited<R>> => {
      const r = await gate(args[0], args[1]);
      if (!r.allowed) throw new GovernanceBlocked(args[0], r.verdict.reasons, r.verdict.risk);
      return await exec(...args);
    };
  }

  function certificate(): AgentRunCertificate {
    return buildCertificate({ runId, agent, model: opts?.model, task: opts?.task, startedAt: startedAt || (frames[0]?.ts ?? 0), endedAt: frames.length ? frames[frames.length - 1].ts : startedAt, auditFrames: frames, approvals });
  }

  return { gate, guard, frames: () => [...frames], approvals: () => [...approvals], certificate };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface HarnessGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export async function harnessGauntlet(): Promise<HarnessGauntlet> {
  let t = 1000; const clock = () => t++;
  const h = createHarness({ agent: "Grok", task: "demo", run: "g1", policy: { allow: ["read_*"] }, now: clock, onNeedsApproval: async () => "allow" as const });
  const r1 = await h.gate("read_file", { path: "x" });
  const r2 = await h.gate("bash", { command: "rm -rf / --no-preserve-root" });
  const r3 = await h.gate("http_request", { url: "https://api.example.com" });
  const decisionsOK = r1.decision === "allow" && r2.decision === "block" && r3.decision === "allow" && r3.approvedBy === "human";

  let ran = false; const safe = h.guard(async (_t: string, _a: unknown) => { ran = true; return "did it"; });
  let threw = false; try { await safe("bash", { command: "rm -rf /etc" }); } catch (e) { threw = e instanceof GovernanceBlocked; }
  const guardOK = threw && ran === false;
  let okRan = false; const out = await h.guard(async () => { okRan = true; return 42; })("read_file", { path: "y" });
  const guardAllowOK = okRan && out === 42;

  const cert = h.certificate();
  const ev = { runId: "g1", agent: "Grok", task: "demo", startedAt: cert.startedAt, endedAt: cert.endedAt, auditFrames: h.frames(), approvals: h.approvals() };
  const certOK = cert.summary.policyCompliant && verifyCertificate(cert, ev).valid && cert.summary.blocked >= 2;

  const denyH = createHarness({ agent: "x", run: "g2", now: () => 5, onNeedsApproval: async () => "deny" as const });
  const denied = await denyH.gate("http_request", { url: "x" });
  const denyOK = denied.decision === "block" && denied.allowed === false;

  const total = await (async () => { try { const z = createHarness({ agent: "z" }); await z.gate("", null); z.certificate(); return true; } catch { return false; } })();

  const checks = [
    { name: "GATE-DECISIONS", pass: decisionsOK, detail: "allow / block / (escalate→human-allow) flow correctly" },
    { name: "GUARD-BLOCKS-BEFORE-EXEC", pass: guardOK, detail: "guard() throws GovernanceBlocked and the wrapped tool NEVER runs for a blocked call" },
    { name: "GUARD-TRANSPARENT-ALLOW", pass: guardAllowOK, detail: "an allowed call passes through the wrapper with its real return value" },
    { name: "CERT-COMPLIANT-BY-CONSTRUCTION", pass: certOK, detail: "the certificate from a governed run is policy-compliant + verifies by construction" },
    { name: "HUMAN-DENY-BLOCKS", pass: denyOK, detail: "onNeedsApproval returning 'deny' → the call is blocked" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage / missing options" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
