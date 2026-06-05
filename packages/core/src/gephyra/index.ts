/**
 * v2.83.0 — GEPHYRA (γέφυρα, "bridge") · the living bridge / Toll Booth of Truth.
 *
 * Every router/gateway/bridge in history forwards bytes without caring whether
 * they're true. GEPHYRA is the first bridge that inspects the TRUTH of what
 * crosses it in real time, fixes falsehood before it reaches the far side, and
 * stamps a tamper-evident receipt. It is the SURFACE of Mneme — the face the
 * agent world plugs into — while Mneme stays the brain.
 *
 * A single "crossing" threads Mneme's existing organs into one signed transaction
 * (each already shipped; GEPHYRA only composes them — no new crypto, no new truth
 * engine):
 *   1. IMMUNE      — mesh_immune: is the incoming traffic poisoned (injection)? quarantine.   [💎7]
 *   2. TOLL        — honesty_score: how trusted is the sender? low score ⇒ heavier scrutiny.   [💎5]
 *   3. TRUTH-CUSTOMS — verify (pluggable ACGV): is the claim true? REFUTED ⇒ fix before delivery.
 *   4. CONSCIENCE  — a nudge back to the sender when a claim is overconfident.                  [MIRRAGE]
 *   5. BLACK BOX   — flight_recorder: record the crossing as a signed, chained frame.           [💎3]
 *   6. STAMP       — the frame's Ed25519 NOTARY receipt = "inspected + verified" proof.         [💎4]
 *
 * AUTONOMOUS + RESILIENT BY DESIGN: every organ is wrapped so a failure degrades
 * gracefully (plan B) and the crossing ALWAYS returns a result + a receipt (plan C) —
 * the bridge never throws and never drops traffic on the floor. If the truth engine
 * is unavailable, the claim crosses flagged UNVERIFIED rather than blocked.
 *
 * The heavy truth engine (ACGV / retirement) is INJECTED via deps.verify so this
 * core stays deterministic + offline-testable; the CLI/MCP wire the real one.
 */

import { scanMessage, quarantineDecision, type MeshThreat } from "../mesh_immune/index.js";
import { type HonestyBand } from "../honesty_score/index.js";
import { record, replay, readCdr, type RecordedFrame } from "../flight_recorder/index.js";
import { verifyReceipt, type NotaryReceipt } from "../notary/index.js";
import { crossCommand as hephCrossCommand, type CrossCommandResult, type CrossCommandDeps } from "../hephaestus/index.js";

export type TruthVerdict = "TRUSTWORTHY" | "REFUTED" | "MIXED" | "UNVERIFIED";
export type Disposition = "PASS" | "CORRECTED" | "QUARANTINED" | "UNVERIFIED";

export interface CrossInput {
  /** The claim / message crossing the bridge. */
  claim: string;
  /** Originating agent (its honesty score sets the toll / scrutiny). */
  fromAgent: string;
  /** Destination agent (informational). */
  toAgent?: string;
  /** What the crossing does (a tool call, an answer, a payment memo). */
  action?: string;
}

export interface CrossDeps {
  /** The real truth engine. Returns a verdict (+ a corrected claim on REFUTED).
   *  Injected so GEPHYRA's core stays deterministic; CLI/MCP wire ACGV here. */
  verify?: (claim: string) => Promise<{ verdict: TruthVerdict; corrected?: string; evidence?: string }>;
  /** Look up the sender's honesty band (from a signed credit-score receipt). */
  honestyLookup?: (agent: string) => HonestyBand | undefined;
  /** Override clock for determinism. */
  now?: number;
}

export interface CrossResult {
  disposition: Disposition;
  verdict: TruthVerdict;
  /** What was presented. */
  claim: string;
  /** What is actually delivered to the far side (corrected on REFUTED, blocked on QUARANTINE). */
  deliveredClaim: string;
  fromAgent: string;
  toAgent: string | null;
  /** Sender's honesty band (sets scrutiny). */
  honestyBand: HonestyBand;
  /** "heavy" when the sender is low-trust or the immune layer flagged something. */
  scrutiny: "normal" | "heavy";
  threats: MeshThreat[];
  /** Conscience nudges sent back to the sender. */
  nudges: string[];
  /** The tamper-evident crossing stamp (Ed25519, verifies offline). null only if the recorder failed. */
  receipt: NotaryReceipt | null;
  /** Evidence from the truth engine, if any. */
  evidence?: string;
  /** Degradation notes (which organs fell back to plan B/C). */
  degraded: string[];
}

const ABSOLUTES = /\b(always|never|guaranteed|definitely|certainly|impossible|100%|no doubt|without a doubt)\b/i;

/** Conscience layer: nudge the sender when a not-confirmed claim is stated too confidently. */
function consciencePass(claim: string, verdict: TruthVerdict): string[] {
  const nudges: string[] = [];
  if (verdict !== "TRUSTWORTHY" && ABSOLUTES.test(claim)) {
    nudges.push("This claim is stated with absolute confidence but is not verified-true — consider hedging or citing a source.");
  }
  if (verdict === "REFUTED") nudges.push("This claim was refuted at the bridge and corrected before delivery.");
  return nudges;
}

/** Toll/scrutiny from the sender's honesty band: low trust ⇒ heavy inspection. */
function scrutinyFor(band: HonestyBand): "normal" | "heavy" {
  return band === "UNTRUSTED" || band === "BRONZE" || band === "UNMEASURED" ? "heavy" : "normal";
}

/**
 * Cross the bridge: run a claim/message through truth-customs + all organs and
 * emit a signed crossing. NEVER throws — each organ degrades to plan B and the
 * crossing always returns with a result; the only thing that can be null is the
 * receipt (if the recorder itself failed, plan C notes it in `degraded`).
 */
export async function crossBridge(repoRoot: string, input: CrossInput, deps: CrossDeps = {}): Promise<CrossResult> {
  const degraded: string[] = [];
  const claim = String(input.claim ?? "");
  const fromAgent = String(input.fromAgent ?? "unknown");
  const toAgent = input.toAgent ? String(input.toAgent) : null;

  // ── 1. IMMUNE — scan incoming traffic for injection/collusion. ──
  let threats: MeshThreat[] = [];
  let quarantined = false;
  try {
    const scan = scanMessage(claim);
    threats = scan.threats;
    quarantined = quarantineDecision(scan) === "QUARANTINE";
  } catch (e) { degraded.push(`immune:${(e as Error).message}`); }

  // ── 2. TOLL — sender honesty band sets the scrutiny. ──
  let honestyBand: HonestyBand = "UNMEASURED";
  try {
    const b = deps.honestyLookup?.(fromAgent);
    if (b) honestyBand = b;
  } catch (e) { degraded.push(`honesty:${(e as Error).message}`); }
  const scrutiny = quarantined ? "heavy" : scrutinyFor(honestyBand);

  // Quarantine short-circuit: poisoned traffic does NOT cross. (Plan B for the far side.)
  if (quarantined) {
    const frame = await recordCrossing(repoRoot, fromAgent, input.action ?? "cross", claim, "[QUARANTINED — injection detected]", "CONTRADICT", degraded);
    return {
      disposition: "QUARANTINED", verdict: "UNVERIFIED", claim, deliveredClaim: "",
      fromAgent, toAgent, honestyBand, scrutiny, threats,
      nudges: ["Traffic quarantined at the bridge: injection/collusion signature detected. Nothing was delivered."],
      receipt: frame?.receipt ?? null, degraded,
    };
  }

  // ── 3. TRUTH-CUSTOMS — verify the claim. ──
  // Defense in depth: a cheap, deterministic backstop (arithmetic) runs FIRST and
  // an unambiguous REFUTE always wins — even when a heavy engine (tuned for code
  // claims, not world-facts) would miss "2+2=5". Otherwise defer to the injected
  // engine (richer); plan B if it's down (UNVERIFIED — traffic still crosses).
  let verdict: TruthVerdict = "UNVERIFIED";
  let corrected: string | undefined;
  let evidence: string | undefined;
  let cheapCorrected: string | undefined;
  let cheapEvidence: string | undefined;
  const cheap = defaultTruthCustoms(claim, (c) => { cheapCorrected = c; }, (e) => { cheapEvidence = e; });
  if (cheap === "REFUTED") {
    verdict = "REFUTED"; corrected = cheapCorrected; evidence = cheapEvidence;
  } else if (deps.verify) {
    try {
      const r = await deps.verify(claim);
      verdict = r.verdict;
      corrected = r.corrected;
      evidence = r.evidence;
    } catch (e) {
      // The truth engine is down — the bridge SURVIVES: cross flagged UNVERIFIED.
      degraded.push(`verify:${(e as Error).message}`);
      verdict = "UNVERIFIED";
    }
  } else {
    verdict = cheap; corrected = cheapCorrected; evidence = cheapEvidence;
  }

  // ── 4. CONSCIENCE — nudge the sender. ──
  const nudges = consciencePass(claim, verdict);

  // ── 5/6. BLACK BOX + STAMP — record + notarize the crossing. ──
  const disposition: Disposition = verdict === "REFUTED" ? "CORRECTED" : verdict === "TRUSTWORTHY" ? "PASS" : "UNVERIFIED";
  const deliveredClaim = verdict === "REFUTED" ? (corrected ?? `[REFUTED at bridge] ${claim}`) : claim;
  const td = verdict === "REFUTED" ? "CONTRADICT" : verdict === "TRUSTWORTHY" ? "MATCH" : "UNVERIFIED";
  const frame = await recordCrossing(repoRoot, fromAgent, input.action ?? "cross", claim, deliveredClaim, td, degraded);

  return {
    disposition, verdict, claim, deliveredClaim, fromAgent, toAgent,
    honestyBand, scrutiny, threats, nudges, receipt: frame?.receipt ?? null, evidence, degraded,
  };
}

/** Record the crossing into the flight recorder (the black box + NOTARY stamp).
 *  Plan C: if recording fails, note it and return null — the crossing still returns. */
async function recordCrossing(
  repoRoot: string, agent: string, action: string, claim: string, delivered: string,
  td: "MATCH" | "CONTRADICT" | "UNVERIFIED", degraded: string[],
): Promise<RecordedFrame | null> {
  try {
    return record(repoRoot, { agent, kind: "tool-call", action: `gephyra:${action}`, claim, observedReality: delivered, truthDelta: td });
  } catch (e) {
    degraded.push(`recorder:${(e as Error).message}`);
    return null;
  }
}

/** Built-in conservative truth-customs (deterministic) used when no engine is injected.
 *  Catches obvious arithmetic falsehoods; everything else is UNVERIFIED (honest, not guessing). */
export function defaultTruthCustoms(claim: string, setCorrected: (c: string) => void, setEvidence: (e: string) => void): TruthVerdict {
  const m = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/.exec(claim);
  if (m) {
    const a = parseFloat(m[1]!), op = m[2]!, b = parseFloat(m[3]!), c = parseFloat(m[4]!);
    const real = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : b !== 0 ? a / b : NaN;
    if (Number.isFinite(real)) {
      if (Math.abs(real - c) < 1e-9) return "TRUSTWORTHY";
      setCorrected(claim.replace(/=\s*-?\d+(?:\.\d+)?/, `= ${real}`));
      setEvidence(`arithmetic: ${a} ${op} ${b} = ${real}, not ${c}`);
      return "REFUTED";
    }
  }
  return "UNVERIFIED";
}

/**
 * The REAL truth-customs engine: wire Mneme's 7-layer APOPTOSIS / retirement
 * detector into deps.verify. HEALTHY→TRUSTWORTHY, NECROTIC/APOPTOTIC→REFUTED,
 * INFLAMED→MIXED, else→UNVERIFIED. Used by the CLI + MCP surfaces; crossBridge
 * wraps it so a failure degrades to UNVERIFIED (the bridge survives).
 */
export function apoptosisTruthCustoms(repoRoot: string): NonNullable<CrossDeps["verify"]> {
  return async (claim: string) => {
    const { detect } = await import("../apoptosis/index.js");
    const rep = detect(repoRoot, claim);
    const v = rep.verdict;
    // v2.134.0 SAVANT-ALIGNED FIX — prove-or-unknown at the bridge.
    // HEALTHY only means "no layer flagged a problem"; absence of refutation is
    // NOT proof of truth (the savant's lineage says exactly this). Pre-v2.134 the
    // bridge labelled EVERY HEALTHY claim TRUSTWORTHY, so a false world-fact like
    // "the human body has 400 blood vessels" (which Mneme cannot positively check
    // without a world-knowledge oracle) crossed 🟢 TRUSTWORTHY — over-claiming.
    // Now TRUSTWORTHY requires POSITIVE grounding by ≥2 independent layers; a
    // single weak grounding (or none) crosses UNVERIFIED — honest "I found no
    // problem but cannot prove it true." NECROTIC/APOPTOTIC→REFUTED stays (a
    // real refutation is positive evidence of falsehood). Errs to the SAFE side:
    // it never upgrades a falsehood, only downgrades an unproven "truthful".
    const positivelyProven = v === "HEALTHY" && rep.grounded >= 2;
    const verdict: TruthVerdict =
      (v === "NECROTIC" || v === "APOPTOTIC") ? "REFUTED" :
      v === "INFLAMED" ? "MIXED" :
      positivelyProven ? "TRUSTWORTHY" :
      "UNVERIFIED";
    const evidence = (v === "HEALTHY" && !positivelyProven)
      ? `UNKNOWN -- no refutation found (${rep.grounded}/${rep.grounded >= 1 ? rep.grounded : 1} layer grounded), but absence of refutation is NOT proof of truth; not positively verified.`
      : rep.headline;
    return { verdict, evidence };
  };
}

export interface BridgeStatus {
  crossings: number;
  passed: number;
  corrected: number;
  quarantined: number;
  unverified: number;
  /** corrected + quarantined = falsehoods/threats the bridge stopped. */
  hallucinationsCaught: number;
  /** Is the black-box chain intact (tamper-evident)? */
  chainValid: boolean;
}

/** Live bridge status, read from the flight-recorder black box. Never throws. */
export function bridgeStatus(repoRoot: string): BridgeStatus {
  try {
    const rep = replay(repoRoot);
    const frames = readCdr(repoRoot);
    let passed = 0, corrected = 0, quarantined = 0, unverified = 0;
    for (const f of frames) {
      const p = (f.payload ?? {}) as { action?: string; truthDelta?: string; observedReality?: string };
      if (typeof p.action !== "string" || !p.action.startsWith("gephyra:")) continue;
      if (typeof p.observedReality === "string" && p.observedReality.startsWith("[QUARANTINED")) quarantined++;
      else if (p.truthDelta === "CONTRADICT") corrected++;
      else if (p.truthDelta === "MATCH") passed++;
      else unverified++;
    }
    const crossings = passed + corrected + quarantined + unverified;
    return { crossings, passed, corrected, quarantined, unverified, hallucinationsCaught: corrected + quarantined, chainValid: rep.chainValid };
  } catch {
    return { crossings: 0, passed: 0, corrected: 0, quarantined: 0, unverified: 0, hallucinationsCaught: 0, chainValid: true };
  }
}

/** Verify a crossing receipt offline (the "inspected + verified" stamp). */
export function verifyCrossing(receipt: unknown): { valid: boolean; reason: string } {
  const v = verifyReceipt(receipt);
  return { valid: v.valid, reason: v.reason };
}

export { replay as bridgeReplay } from "../flight_recorder/index.js";

// ════════════════════════════════════════════════════════════════════════
// v2.87.0 — PHASE 4: MCP tool-call routing (truth-customs for ANY tool call).
//   The "one endpoint" core: a tool call is routed to the right lane —
//   HEPHAESTUS for commands (shell/exec), GEPHYRA truth-customs for claims/
//   answers — before it runs. (HONEST SCOPE: this is the routing + decision
//   layer; a full transport-level MCP proxy that forwards to upstream servers
//   is a separate future release. `gephyra serve` exposes it over HTTP.)
// ════════════════════════════════════════════════════════════════════════

const SHELL_TOOL_RE = /shell|exec|run[_-]?command|bash|terminal|process|spawn|system|cmd|kubectl|docker|git\b/i;

export interface ToolCallRoute {
  lane: "hephaestus" | "gephyra" | "passthrough";
  /** allow = run it · gate = needs co-sign · block = refuse. */
  action: "allow" | "gate" | "block";
  reason: string;
  command?: CrossCommandResult;
  claim?: CrossResult;
}

/**
 * Route an MCP tool call through truth-customs. Shell/command-shaped calls (by
 * tool name or an `args.command`) cross HEPHAESTUS (risk/policy/tribunal gate);
 * calls carrying a `claim`/`text`/`answer` cross GEPHYRA (verify/correct); anything
 * else passes through. Returns a routing verdict + the lane's signed crossing.
 * Never throws.
 */
export async function routeToolCall(
  repoRoot: string,
  input: { tool: string; args?: Record<string, unknown>; agent: string },
  deps: { heph?: CrossCommandDeps; gephyra?: CrossDeps } = {},
): Promise<ToolCallRoute> {
  const tool = String(input.tool ?? "");
  const args = (input.args ?? {}) as Record<string, unknown>;
  const agent = String(input.agent ?? "unknown");

  const cmdArg = typeof args["command"] === "string" ? args["command"] as string
    : typeof args["cmd"] === "string" ? args["cmd"] as string : null;
  if (cmdArg || SHELL_TOOL_RE.test(tool)) {
    const command = cmdArg ?? `${tool} ${Object.values(args).filter((v) => typeof v === "string").join(" ")}`.trim();
    const cr = await hephCrossCommand(repoRoot, { command, agent, host: typeof args["host"] === "string" ? args["host"] as string : undefined, cosigned: args["cosigned"] === true }, deps.heph);
    return { lane: "hephaestus", action: cr.disposition === "ALLOW" ? "allow" : cr.disposition === "BLOCK" ? "block" : "gate", reason: cr.reasons[0] ?? cr.disposition, command: cr };
  }

  const claim = typeof args["claim"] === "string" ? args["claim"] as string
    : typeof args["text"] === "string" ? args["text"] as string
    : typeof args["answer"] === "string" ? args["answer"] as string : null;
  if (claim) {
    const cb = await crossBridge(repoRoot, { claim, fromAgent: agent, action: tool }, deps.gephyra);
    return { lane: "gephyra", action: cb.disposition === "QUARANTINED" ? "block" : "allow", reason: `${cb.disposition} (${cb.verdict})`, claim: cb };
  }

  return { lane: "passthrough", action: "allow", reason: "no command or claim to inspect" };
}

// ════════════════════════════════════════════════════════════════════════
// v2.84.0 — GEPHYRA Phase 2: serve-as-endpoint + auto-advertise
// ════════════════════════════════════════════════════════════════════════

import { existsSync as _existsSync, readFileSync as _readFileSync, writeFileSync as _writeFileSync, mkdirSync as _mkdirSync, appendFileSync as _appendFileSync } from "node:fs";
import { join as _join } from "node:path";
import { createPublicKey as _createPublicKey, verify as _ed25519Verify } from "node:crypto";

export interface CrossHttpResponse { status: number; body: CrossResult | { error: string } }

/**
 * HTTP-shaped handler: the Toll Booth as a service. Parse a JSON crossing request,
 * run it through the bridge (real ACGV truth-customs), return a response. Pure of
 * the server itself (the CLI wraps this in http.createServer) + never throws —
 * bad input ⇒ 400, everything else ⇒ 200 with the crossing (incl. degraded notes).
 */
export async function handleCrossRequest(repoRoot: string, raw: unknown): Promise<CrossHttpResponse> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { status: 400, body: { error: "body is not valid JSON" } }; }
  }
  if (parsed === null || typeof parsed !== "object") return { status: 400, body: { error: "body must be a JSON object" } };
  const o = parsed as Record<string, unknown>;
  if (typeof o["claim"] !== "string" || typeof o["fromAgent"] !== "string") {
    return { status: 400, body: { error: "required: claim (string), fromAgent (string)" } };
  }
  try {
    const result = await crossBridge(repoRoot, {
      claim: o["claim"] as string,
      fromAgent: o["fromAgent"] as string,
      toAgent: typeof o["toAgent"] === "string" ? o["toAgent"] as string : undefined,
      action: typeof o["action"] === "string" ? o["action"] as string : undefined,
    }, { verify: apoptosisTruthCustoms(repoRoot) });
    return { status: 200, body: result };
  } catch (e) {
    // crossBridge is designed never to throw; this is plan-C insurance.
    return { status: 500, body: { error: (e as Error).message } };
  }
}

export interface McpCallHttpResponse { status: number; body: ToolCallRoute | { error: string } | { action: string; gate?: unknown; reason?: string } | (ToolCallRoute & { gate?: unknown }) }

/**
 * Phase 4 — GEPHYRA as an MCP-proxy endpoint. An agent points its MCP client at
 * `{ "mcpServers": { "gephyra": { "url": ".../mcp" } } }`; every tool call is
 * POSTed here as `{ tool, args?, agent }` and routed through truth-customs
 * (HEPHAESTUS for shell/command calls · GEPHYRA for claim-bearing calls ·
 * passthrough otherwise). Returns the routing verdict (allow/gate/block) + the
 * lane's signed crossing. Pure of the server; never throws.
 */
/** MCP GATEWAY: gate the tool-call (policy + behavioral risk + provenance) and append a
 *  hash-chained, NOTARY-signed audit frame — the local-first, offline-verifiable alternative to
 *  a cloud gateway's trust-me audit DB. Returns the gate verdict. */
export async function mcpGateAndAudit(repoRoot: string, call: { tool: string; agent?: string; args?: unknown }): Promise<{ decision: string; risk: number; reasons: string[]; argsHash: string }> {
  const { gateCall, appendAuditFrame } = await import("../mcpgate/index.js");
  const dir = _join(repoRoot, ".mneme", "mcpgate");
  let policy = {}; try { const pp = _join(dir, "policy.json"); if (_existsSync(pp)) policy = JSON.parse(_readFileSync(pp, "utf8")); } catch { /* */ }
  const verdict = gateCall(call, policy);
  try {
    if (!_existsSync(dir)) _mkdirSync(dir, { recursive: true });
    const ledger = _join(dir, "audit.jsonl");
    let prev = null; try { if (_existsSync(ledger)) { const lines = _readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean); if (lines.length) prev = JSON.parse(lines[lines.length - 1]); } } catch { /* */ }
    const frame = appendAuditFrame(prev, call, verdict, Date.now());
    _appendFileSync(ledger, JSON.stringify(frame) + "\n");
    // sign the chain HEAD with NOTARY (Ed25519) — anyone verifies the tip offline, no shared secret
    try { const { issueReceipt } = await import("../notary/receipt.js"); const rec = issueReceipt(repoRoot, { kind: "reasoning-trace", subject: "mcpgate-audit-head", payload: { frameId: frame.frameId, seq: frame.seq }, includePayload: true, issuedAt: Date.now() }); _writeFileSync(_join(dir, "audit.head.json"), JSON.stringify(rec)); } catch { /* */ }
  } catch { /* audit is best-effort; never block the gate decision on a write failure */ }
  return verdict;
}

export async function handleMcpCallRequest(repoRoot: string, raw: unknown, deps: { heph?: CrossCommandDeps; gephyra?: CrossDeps } = {}): Promise<McpCallHttpResponse> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { status: 400, body: { error: "body is not valid JSON" } }; }
  }
  if (parsed === null || typeof parsed !== "object") return { status: 400, body: { error: "body must be a JSON object" } };
  const o = parsed as Record<string, unknown>;
  if (typeof o["tool"] !== "string" || typeof o["agent"] !== "string") {
    return { status: 400, body: { error: "required: tool (string), agent (string); optional: args (object)" } };
  }
  try {
    const call = { tool: o["tool"] as string, args: (o["args"] && typeof o["args"] === "object") ? o["args"] as Record<string, unknown> : undefined, agent: o["agent"] as string };
    // MCP GATEWAY: gate + audit every call BEFORE proxying. Block/needs-approval never reach the tool.
    const gate = await mcpGateAndAudit(repoRoot, call);
    if (gate.decision === "block") return { status: 200, body: { action: "block", gate, reason: gate.reasons.join("; ") || "blocked by the MCP gateway" } };
    if (gate.decision === "needs-approval") return { status: 200, body: { action: "needs-approval", gate, reason: "this tool-call needs a human — route it to the pager (mneme pager request)" } };
    const route = await routeToolCall(repoRoot, call, deps);
    // A blocked crossing is a successful inspection — surface 200 with action:"block"
    // so the proxying client can decide; we never throw a 5xx for a refusal.
    return { status: 200, body: { ...route, gate } };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

export interface SavantHttpResponse { status: number; body: unknown }

/**
 * v2.90.0 — 💎② SAVANT SYMBIOSIS over HTTP/A2A. Any agent (any vendor, any protocol)
 * POSTs here to use the savant as a before-assert prosthesis:
 *   POST /savant/verify  { claim }  → { verdict: TRUE|FALSE|UNKNOWN, evidence, lineage, receiptId }
 *   POST /savant/repair  { draft }  → { repaired, claims, changed, summary }
 * Pure of the server; never throws (bad input ⇒ 400).
 */
export async function handleSavantRequest(repoRoot: string, raw: unknown, mode: "verify" | "repair"): Promise<SavantHttpResponse> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { status: 400, body: { error: "body is not valid JSON" } }; }
  }
  if (parsed === null || typeof parsed !== "object") return { status: 400, body: { error: "body must be a JSON object" } };
  const o = parsed as Record<string, unknown>;
  try {
    if (mode === "verify") {
      if (typeof o["claim"] !== "string") return { status: 400, body: { error: "required: claim (string)" } };
      const { assertClaim } = await import("../truth_kernel/aletheia.js");
      const r = await assertClaim(repoRoot, o["claim"] as string);
      return { status: 200, body: { verdict: r.verdict, pTrue: r.pTrue, evidence: r.evidence, lineage: r.lineage, refusalApplied: r.refusalApplied, receiptId: r.receipt?.receiptId ?? null } };
    }
    if (typeof o["draft"] !== "string") return { status: 400, body: { error: "required: draft (string)" } };
    const { repairDraft } = await import("../truth_kernel/symbiosis.js");
    const r = await repairDraft(repoRoot, o["draft"] as string);
    return { status: 200, body: r };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

/** Wrap any A2A response with a trustless Ed25519 _proof so the calling vendor (xAI/Grok/…)
 *  verifies it OFFLINE instead of trusting Mneme. */
async function a2aProof(repoRoot: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const { issueReceipt } = await import("../notary/receipt.js");
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const r = issueReceipt(repoRoot, { kind: "claim-verdict", subject: `a2a:${h.slice(0, 12)}`, payload: { dataHash: h }, includePayload: true });
    return { ...data, _proof: { dataHash: h, receipt: r } };
  } catch { return data; }
}

/**
 * A2A REST surface — the world-class gap: let ANY vendor (xAI / Grok / OpenAI / a local agent)
 * use Mneme's safety primitives over plain HTTP, every result trustless-signed.
 *   firewall     {content}           → neutralize prompt-injection in untrusted content
 *   rail-ingress {payload, path?}    → policy-gate + blind secrets before sending to a model
 *   rail-egress  {payload}           → screen a model's output for secret leakage
 *   reckon       {evidence}          → signed accountability verdict for a change
 */
export async function handleA2ARequest(repoRoot: string, raw: unknown, primitive: "firewall" | "rail-ingress" | "rail-egress" | "reckon"): Promise<SavantHttpResponse> {
  let parsed: unknown = raw;
  if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { return { status: 400, body: { error: "body is not valid JSON" } }; } }
  if (parsed === null || typeof parsed !== "object") return { status: 400, body: { error: "body must be a JSON object" } };
  const o = parsed as Record<string, unknown>;
  try {
    if (primitive === "firewall") {
      if (typeof o["content"] !== "string") return { status: 400, body: { error: "required: content (string)" } };
      const { fortify } = await import("../firewall/index.js");
      const r = fortify(o["content"] as string, typeof o["path"] === "string" ? { path: o["path"] as string } : undefined);
      return { status: 200, body: await a2aProof(repoRoot, r as unknown as Record<string, unknown>) };
    }
    if (primitive === "rail-ingress") {
      if (typeof o["payload"] !== "string") return { status: 400, body: { error: "required: payload (string)" } };
      const { traverseIngress } = await import("../rail/index.js");
      const r = traverseIngress(o["payload"] as string, typeof o["path"] === "string" ? { path: o["path"] as string } : undefined);
      return { status: 200, body: await a2aProof(repoRoot, r as unknown as Record<string, unknown>) };
    }
    if (primitive === "rail-egress") {
      if (typeof o["payload"] !== "string") return { status: 400, body: { error: "required: payload (string)" } };
      const { traverseEgress } = await import("../rail/index.js");
      const r = traverseEgress(o["payload"] as string);
      return { status: 200, body: await a2aProof(repoRoot, r as unknown as Record<string, unknown>) };
    }
    // reckon
    if (o["evidence"] === null || typeof o["evidence"] !== "object") return { status: 400, body: { error: "required: evidence (object)" } };
    const { buildReckoning } = await import("../reckoning/index.js");
    const r = buildReckoning(o["evidence"] as never);
    return { status: 200, body: await a2aProof(repoRoot, r as unknown as Record<string, unknown>) };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

/**
 * KERYX RELAY (the inbound half) — the only piece that needs a public endpoint. The daemon
 * SENDS asks OUTBOUND directly to any provider (push works behind NAT); a provider's REPLY,
 * however, is a webhook → it needs this public relay. The relay receives the webhook, parses
 * the reply (provider-agnostic), and queues it for the daemon to DRAIN (outbound poll). It
 * never sees raw code (the ask never came through it) and it's your own server (semi-trusted,
 * like Telegram's API). Deploy it on `gephyra serve` (your DO droplet).
 */
interface KeryxRelayState { v: 1; inbox: Record<string, unknown[]>; askOwner: Record<string, string> }
function _keryxStatePath(repoRoot: string): string { return _join(repoRoot, ".mneme", "keryx", "relay.json"); }
function _loadKeryxRelay(repoRoot: string): KeryxRelayState {
  try { const p = _keryxStatePath(repoRoot); if (_existsSync(p)) { const j = JSON.parse(_readFileSync(p, "utf8")); if (j && typeof j === "object") return { v: 1, inbox: j.inbox ?? {}, askOwner: j.askOwner ?? {} }; } } catch { /* */ }
  return { v: 1, inbox: {}, askOwner: {} };
}
function _saveKeryxRelay(repoRoot: string, s: KeryxRelayState): void {
  try { const d = _join(repoRoot, ".mneme", "keryx"); if (!_existsSync(d)) _mkdirSync(d, { recursive: true }); _writeFileSync(_keryxStatePath(repoRoot), JSON.stringify(s), "utf8"); } catch { /* */ }
}

/** Verify a Discord interaction's Ed25519 signature (required, else Discord rejects the endpoint).
 *  publicKeyHex = the app's Public Key. Returns true iff the signature is valid. */
export function verifyDiscordSig(publicKeyHex: string, timestamp: string, rawBody: string, signatureHex: string): boolean {
  try {
    if (!publicKeyHex || !signatureHex || !timestamp) return false;
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]); // SPKI prefix + raw ed25519 key
    const key = _createPublicKey({ key: der, format: "der", type: "spki" });
    return _ed25519Verify(null, Buffer.from(timestamp + rawBody, "utf8"), key, Buffer.from(signatureHex, "hex"));
  } catch { return false; }
}

export async function handleKeryxRelay(repoRoot: string, action: "expect" | "webhook" | "drain", body: unknown, query: Record<string, string>, headers?: Record<string, string | string[] | undefined>): Promise<SavantHttpResponse> {
  const { parseInbound } = await import("../keryx/index.js");
  const s = _loadKeryxRelay(repoRoot);
  try {
    if (action === "expect") {
      let o: Record<string, unknown> = {}; if (typeof body === "string") { try { o = JSON.parse(body); } catch { return { status: 400, body: { error: "invalid JSON" } }; } } else if (body && typeof body === "object") o = body as Record<string, unknown>;
      const daemonId = String(o["daemonId"] ?? ""), askId = String(o["askId"] ?? "");
      if (!daemonId || !askId) return { status: 400, body: { error: "required: daemonId, askId" } };
      s.askOwner[askId] = daemonId; _saveKeryxRelay(repoRoot, s);
      return { status: 200, body: { ok: true } };
    }
    if (action === "webhook") {
      const provider = String(query["provider"] ?? "generic");
      // ── Discord: verify Ed25519 (or Discord rejects the endpoint), answer PING with PONG,
      //    and answer a button (component) interaction with type 7 so the user never sees a
      //    red "interaction failed" — and the buttons are removed in the same response.
      if (provider === "discord") {
        const pub = process.env.KERYX_DISCORD_PUBLIC_KEY ?? "";
        const sig = String(headers?.["x-signature-ed25519"] ?? ""); const tsHdr = String(headers?.["x-signature-timestamp"] ?? "");
        const rawBody = typeof body === "string" ? body : JSON.stringify(body ?? {});
        if (pub) { if (!verifyDiscordSig(pub, tsHdr, rawBody, sig)) return { status: 401, body: { error: "bad signature" } }; }
        let j: { type?: number } = {}; try { j = typeof body === "string" ? JSON.parse(body) : (body as { type?: number }); } catch { /* */ }
        if (j?.type === 1) return { status: 200, body: { type: 1 } };                 // PING → PONG
        const parsedD = parseInbound("discord", body);
        if (parsedD.ok) {
          const owners = Object.values(s.askOwner); const daemonId = (parsedD.id && s.askOwner[parsedD.id]) || (owners.length === 1 ? owners[0] : "default");
          s.inbox[daemonId] = [...(s.inbox[daemonId] ?? []), { v: 1, kind: "answer", id: parsedD.id ?? "", channel: "discord", payload: parsedD.answer ?? "", relayAttested: true, ts: Date.now() }]; _saveKeryxRelay(repoRoot, s);
        }
        return { status: 200, body: { type: 7, data: { content: `✅ received: ${parsedD.answer ?? "ok"} — recorded.`, components: [] } } }; // UPDATE_MESSAGE: clears buttons, no error
      }
      const parsed = parseInbound(provider, body);
      if (!parsed.ok) return { status: 200, body: { ok: false, reason: parsed.reason } };  // 200 so the provider doesn't retry-storm
      // route to the daemon that owns this ask id (or a sole registered daemon)
      const owners = Object.values(s.askOwner);
      const daemonId = (parsed.id && s.askOwner[parsed.id]) || (owners.length === 1 ? owners[0] : "default");
      const env = { v: 1, kind: "answer", id: parsed.id ?? "", channel: provider, payload: parsed.answer ?? "", relayAttested: true, ts: Date.now() };
      s.inbox[daemonId] = [...(s.inbox[daemonId] ?? []), env]; _saveKeryxRelay(repoRoot, s);
      return { status: 200, body: { ok: true, routedTo: daemonId, id: parsed.id, answer: parsed.answer } };
    }
    // drain
    const daemonId = String(query["daemon"] ?? "default");
    const answers = s.inbox[daemonId] ?? []; s.inbox[daemonId] = []; _saveKeryxRelay(repoRoot, s);
    return { status: 200, body: { answers } };
  } catch (e) { return { status: 500, body: { error: (e as Error).message } }; }
}

/** OpenAPI 3.0 spec for the A2A surface — register with any agent's tool layer. */
export function a2aOpenApi(): Record<string, unknown> {
  const json = { schema: { type: "object" } };
  const post = (summary: string, props: Record<string, unknown>, required: string[]) => ({ post: { summary, requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: props, required } } } }, responses: { "200": { description: "trustless-signed result (_proof)" } } } });
  return {
    openapi: "3.0.0",
    info: { title: "Mneme A2A — safety & truth primitives", version: "1", description: "Any vendor (xAI/Grok/OpenAI) can call these over REST; every response carries a trustless Ed25519 _proof you verify offline." },
    paths: {
      "/savant/verify": post("Verify a factual claim (TRUE/FALSE/UNKNOWN)", { claim: { type: "string" } }, ["claim"]),
      "/savant/repair": post("Fact-check + repair a draft", { draft: { type: "string" } }, ["draft"]),
      "/firewall": post("Neutralize prompt-injection in untrusted content (OWASP LLM01)", { content: { type: "string" }, path: { type: "string" } }, ["content"]),
      "/rail/ingress": post("Policy-gate + blind secrets before sending local context to a model", { payload: { type: "string" }, path: { type: "string" } }, ["payload"]),
      "/rail/egress": post("Screen a model's output for secret leakage", { payload: { type: "string" } }, ["payload"]),
      "/reckon": post("Signed accountability verdict (EXONERATED/ACCOUNTABLE/INSUFFICIENT)", { evidence: json.schema }, ["evidence"]),
    },
  };
}

interface CapEntry { command: string; since?: string }

/**
 * AUTO-AWARENESS: diff the live capability catalog against what GEPHYRA last saw
 * (`.mneme/gephyra/seen-caps.json`) and return the NEW capabilities. Persists the
 * union so each capability is "new" exactly once. This is how the bridge knows a
 * fresh function exists and can point agents at it. Never throws.
 */
export function newCapabilitiesSince(repoRoot: string, catalog: CapEntry[]): { newCommands: string[]; firstRun: boolean; total: number } {
  const cmds = (Array.isArray(catalog) ? catalog : []).map((c) => String(c?.command ?? "")).filter(Boolean);
  const path = _join(repoRoot, ".mneme", "gephyra", "seen-caps.json");
  let seen: string[] = [];
  let firstRun = true;
  try {
    if (_existsSync(path)) {
      const prev = JSON.parse(_readFileSync(path, "utf8")) as { commands?: string[] };
      if (Array.isArray(prev.commands)) { seen = prev.commands; firstRun = false; }
    }
  } catch { /* corrupt → treat as first run */ }
  const seenSet = new Set(seen);
  const newCommands = firstRun ? [] : cmds.filter((c) => !seenSet.has(c));
  try {
    const dir = _join(repoRoot, ".mneme", "gephyra");
    if (!_existsSync(dir)) _mkdirSync(dir, { recursive: true });
    _writeFileSync(path, JSON.stringify({ v: 1, commands: Array.from(new Set([...seen, ...cmds])).sort(), at: Date.now() }, null, 2), "utf8");
  } catch { /* best-effort */ }
  return { newCommands, firstRun, total: cmds.length };
}

export interface GephyraAdvert {
  text: string;
  newCommands: string[];
  firstRun: boolean;
  totalCapabilities: number;
}

/**
 * AUTO-ADVERTISE: build the directive that points an AI agent at GEPHYRA — so the
 * user automatically benefits from truth-customs on every claim, and any NEW
 * capability is surfaced through the bridge. Informational (de-worm safe: no
 * self-upgrade/self-install imperative), addressed as routing guidance.
 */
export function gephyraAdvertisement(repoRoot: string, catalog: CapEntry[]): GephyraAdvert {
  const { newCommands, firstRun, total } = newCapabilitiesSince(repoRoot, catalog);
  const lines: string[] = [
    "🌉 GEPHYRA bridge is active. Route factual claims and cross-agent (A2A) traffic through `mneme.gephyra.cross` BEFORE relaying them — the bridge runs real-time truth-customs (a refuted claim is corrected before it reaches the user, injection is quarantined) and returns the deliveredClaim to use.",
  ];
  if (firstRun) {
    lines.push(`(${total} capabilities are now reachable through the bridge.)`);
  } else if (newCommands.length > 0) {
    const show = newCommands.slice(0, 8).join(", ");
    lines.push(`NEW since last session — now available through GEPHYRA: ${show}${newCommands.length > 8 ? ` (+${newCommands.length - 8} more)` : ""}.`);
  }
  return { text: lines.join("\n"), newCommands, firstRun, totalCapabilities: total };
}
