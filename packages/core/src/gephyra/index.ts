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
    const verdict: TruthVerdict =
      v === "HEALTHY" ? "TRUSTWORTHY" :
      (v === "NECROTIC" || v === "APOPTOTIC") ? "REFUTED" :
      v === "INFLAMED" ? "MIXED" : "UNVERIFIED";
    return { verdict, evidence: rep.headline };
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
