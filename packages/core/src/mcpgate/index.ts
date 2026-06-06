/**
 * MCP GATEWAY — gate every agent tool-call, escalate the risky ones to a human, and write a
 * SIGNED, offline-verifiable audit trail. Local-first.
 *
 * An MCP gateway (Obot-style) sits between an agent and its tools: it proxies each call, applies
 * policy, and logs who/what/outcome. Mneme's version is built to be SUPERIOR on the axes a
 * centralized cloud gateway structurally can't match:
 *   • DECISION is composed from real Mneme organs — the Behavioral Compiler on the call's command
 *     args + the tool's SKILLSCAN provenance verdict + an explicit allow/deny/need-approval policy
 *     → ALLOW / NEEDS-APPROVAL / BLOCK (deterministic, no LLM).
 *   • NEEDS-APPROVAL escalates to the human via the Cosmic Pager (approve from your phone) — a
 *     cloud gateway has no human-in-the-loop-from-anywhere.
 *   • The AUDIT is a hash-chained ledger (the CLI signs frames with NOTARY/Ed25519) that ANYONE
 *     verifies OFFLINE — where a gateway's audit is a DB you must trust. Tamper any frame → caught.
 *   • Args are recorded as a HASH, never raw — the audit proves WHAT happened without leaking it.
 *
 * ★HONEST: a deterministic gate over the call's declared signals (tool name · command args ·
 * provenance · policy). It can't see what an opaque tool does internally beyond its args — those
 * default to NEEDS-APPROVAL/BLOCK for sensitive tools, never a silent allow. Pure + total.
 */
import { createHash } from "node:crypto";
import { compileToIR, analyzeIR } from "../compiler/index.js";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
function canon(x: unknown): string { try { return JSON.stringify(x, (_k, v) => v, 0) ?? "null"; } catch { return String(x); } }

export type GateDecision = "allow" | "needs-approval" | "block";
export interface ToolCall { tool: string; agent?: string; args?: unknown; server?: string; run?: string }
export interface GatePolicy { allow?: string[]; deny?: string[]; needApproval?: string[]; defaultDecision?: GateDecision }
export interface ToolProvenance { verdict: "SAFE" | "REVIEW" | "BLOCK" }
export interface CallVerdict { decision: GateDecision; risk: number; reasons: string[]; argsHash: string }

/** Tools whose very nature touches the machine — sensitive by default (no silent allow). */
const SENSITIVE_TOOL = /(bash|shell|exec|spawn|run|command|terminal|process|kill|\bfs\b|file|write|delete|unlink|remove|http|fetch|request|curl|net|sql|database|query|deploy|kubectl|docker|ssh|secret|credential|env)/i;
const matchGlob = (name: string, pat: string): boolean => { try { return new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(name); } catch { return name === pat; } };
/** Pull a shell command out of common tool-arg shapes so the Behavioral Compiler can judge it. */
function extractCommand(args: unknown): string {
  if (!args || typeof args !== "object") return typeof args === "string" ? args : "";
  const o = args as Record<string, unknown>;
  for (const k of ["command", "cmd", "script", "code", "shell", "run", "query"]) if (typeof o[k] === "string") return o[k] as string;
  if (o.tool_input && typeof (o.tool_input as { command?: string }).command === "string") return (o.tool_input as { command: string }).command;
  return "";
}

export function gateCall(call: ToolCall, policy: GatePolicy = {}, provenance?: ToolProvenance): CallVerdict {
  const tool = String(call?.tool ?? "");
  const argsHash = sha(canon(call?.args));
  const reasons: string[] = [];
  let risk = 0.2;
  // 1) explicit deny — hard stop
  if ((policy.deny ?? []).some((p) => matchGlob(tool, p))) return { decision: "block", risk: 1, reasons: ["tool is on the deny-list"], argsHash };
  // 2) behavioral: compile any command the call carries
  const cmd = extractCommand(call?.args);
  if (cmd) { try { const v = analyzeIR(compileToIR(cmd)); risk = Math.max(risk, v.maxRisk); if (v.verdict === "BLOCK") reasons.push("the call's command is behaviorally BLOCK"); else if (v.verdict === "REVIEW") reasons.push("the call's command is behaviorally REVIEW"); } catch { /* */ } }
  // 3) the tool's skill provenance
  if (provenance?.verdict === "BLOCK") { reasons.push("the tool's skill was scanned BLOCK"); risk = 1; }
  else if (provenance?.verdict === "REVIEW") { reasons.push("the tool's skill scan is REVIEW"); risk = Math.max(risk, 0.6); }
  // 4) a sensitive tool is never a silent allow
  const sensitive = SENSITIVE_TOOL.test(tool);
  if (sensitive) { risk = Math.max(risk, 0.5); reasons.push("sensitive tool (touches the machine/network)"); }
  // 5) decision
  const allowed = (policy.allow ?? []).some((p) => matchGlob(tool, p));
  let decision: GateDecision;
  if (risk >= 0.85 || reasons.some((r) => /BLOCK|deny/.test(r))) decision = "block";
  else if (allowed && risk < 0.5) decision = "allow";
  else if ((policy.needApproval ?? []).some((p) => matchGlob(tool, p)) || risk >= 0.4) decision = "needs-approval";
  else decision = policy.defaultDecision ?? "allow";
  return { decision, risk: Math.round(risk * 100) / 100, reasons, argsHash };
}

// ── AUDIT LEDGER — hash-chained, offline-verifiable ───────────────────────────
export interface AuditFrame { seq: number; ts: number; run: string; tool: string; agent: string; argsHash: string; decision: GateDecision; risk: number; prev: string; frameId: string }
function frameBody(f: Omit<AuditFrame, "frameId">): string { return canon({ seq: f.seq, ts: f.ts, run: f.run ?? "", tool: f.tool, agent: f.agent, argsHash: f.argsHash, decision: f.decision, risk: f.risk, prev: f.prev }); }
/** Append a tamper-evident frame: frameId = sha(body); prev links to the last frame's id. */
export function appendAuditFrame(prev: AuditFrame | null, call: ToolCall, verdict: CallVerdict, now: number): AuditFrame {
  const base: Omit<AuditFrame, "frameId"> = { seq: prev ? prev.seq + 1 : 0, ts: now, run: String(call?.run ?? ""), tool: String(call?.tool ?? ""), agent: String(call?.agent ?? "unknown"), argsHash: verdict.argsHash, decision: verdict.decision, risk: verdict.risk, prev: prev?.frameId ?? "" };
  return { ...base, frameId: sha(frameBody(base)) };
}
export interface ChainVerify { ok: boolean; frames: number; brokenAt: number | null; reason: string }
/** Verify the whole chain OFFLINE: each frameId recomputes, prev links, seq is monotonic. */
export function verifyAuditChain(frames: ReadonlyArray<AuditFrame>): ChainVerify {
  const f = frames ?? [];
  for (let i = 0; i < f.length; i++) {
    const fr = f[i];
    if (!fr || typeof fr !== "object") return { ok: false, frames: f.length, brokenAt: i, reason: "missing frame" };
    if (sha(frameBody(fr)) !== fr.frameId) return { ok: false, frames: f.length, brokenAt: i, reason: "frameId mismatch — frame tampered" };
    if (i > 0 && fr.prev !== f[i - 1].frameId) return { ok: false, frames: f.length, brokenAt: i, reason: "broken prev link — a frame was inserted/removed" };
    if (i > 0 && fr.seq !== f[i - 1].seq + 1) return { ok: false, frames: f.length, brokenAt: i, reason: "non-monotonic seq" };
  }
  return { ok: true, frames: f.length, brokenAt: null, reason: "verified — chain intact" };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface McpGateGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function mcpGateGauntlet(): McpGateGauntlet {
  const benign = gateCall({ tool: "get_weather", args: { city: "Bangkok" } }, { allow: ["get_*"] });
  const benignOK = benign.decision === "allow" && benign.risk < 0.5;
  const danger = gateCall({ tool: "bash", agent: "grok", args: { command: "rm -rf / --no-preserve-root" } });
  const dangerOK = danger.decision === "block" && danger.reasons.some((r) => /BLOCK/.test(r));
  const denyOK = gateCall({ tool: "shell.exec", args: {} }, { deny: ["shell.*"] }).decision === "block";
  const provBlock = gateCall({ tool: "weather", args: {} }, {}, { verdict: "BLOCK" }).decision === "block";
  const sensitiveApproval = gateCall({ tool: "http_request", args: { url: "https://api.example.com" } }, {}).decision === "needs-approval";   // sensitive, not allowlisted → human
  const privacy = !/(rm -rf|Bangkok|api\.example)/.test(canon([benign, danger]));   // args are HASHED, never raw in the verdict
  // audit chain
  const f0 = appendAuditFrame(null, { tool: "bash", agent: "a", args: { command: "ls" } }, gateCall({ tool: "bash", args: { command: "ls" } }), 1000);
  const f1 = appendAuditFrame(f0, { tool: "curl", agent: "a", args: { command: "curl x" } }, gateCall({ tool: "curl", args: { command: "curl x" } }), 1001);
  const chainOK = verifyAuditChain([f0, f1]).ok;
  const tamperOK = (() => { const bad = { ...f1, risk: 0.0 }; return verifyAuditChain([f0, bad]).brokenAt === 1; })();   // tamper a frame → caught
  const insertOK = (() => { const f2 = appendAuditFrame(f1, { tool: "x", args: {} }, gateCall({ tool: "x", args: {} }), 1002); return verifyAuditChain([f0, f2]).ok === false; })();   // a removed frame breaks the prev link
  const total = (() => { try { gateCall(null as never); appendAuditFrame(null, null as never, gateCall({ tool: "" }), 0); verifyAuditChain(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "BENIGN-ALLOW", pass: benignOK, detail: "an allowlisted read-only tool call → allow" },
    { name: "BEHAVIORAL-BLOCK", pass: dangerOK, detail: "a bash call carrying `rm -rf /` → block (the Behavioral Compiler judges the args)" },
    { name: "DENY-LIST", pass: denyOK, detail: "a deny-listed tool → hard block" },
    { name: "PROVENANCE-BLOCK", pass: provBlock, detail: "a tool whose skill was scanned BLOCK → block" },
    { name: "SENSITIVE-ESCALATES", pass: sensitiveApproval, detail: "a sensitive tool that isn't allowlisted → NEEDS-APPROVAL (escalate to the human pager), never a silent allow" },
    { name: "ARGS-HASHED-PRIVACY", pass: privacy, detail: "the verdict records an args HASH, never the raw args" },
    { name: "AUDIT-CHAIN-VERIFIES", pass: chainOK, detail: "the hash-chained audit ledger verifies offline" },
    { name: "AUDIT-TAMPER-EVIDENT", pass: tamperOK && insertOK, detail: "tampering a frame, or removing one, breaks the chain at the exact index" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
