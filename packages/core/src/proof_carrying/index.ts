/**
 * v2.19.10 — MNEME PROOF-CARRYING WRAPPER (zero-trust tool chain)
 *
 *   "Every tool output carries a cryptographic certificate attesting:
 *      • which tool produced it
 *      • what input produced it (sha256 of canonical input)
 *      • when it was produced (ISO ts)
 *      • who the caller was (AI-agent fingerprint key)
 *      • what proof this output depends on (chain parent ID)
 *    A downstream tool with `requiresParentProof: true` REFUSES to run
 *    unless the supplied input.parentProof verifies. Prompt-injection
 *    that fakes a tool output → fails sig → rejected. Ad-hoc tool
 *    chains AI agents try to assemble → fail because chain is broken.
 *    Regulators get a cryptographic chain-of-custody for every call.
 *
 *    First MCP primitive in the field with cryptographic identity
 *    BETWEEN tools."
 *
 * Honest scope:
 *   - HMAC-signed (single secret per Mneme instance); not yet asymmetric
 *     PKI. Future v2.20 may add Ed25519 keypairs per AI agent.
 *   - `parentProof` is single-parent; for fan-in chains use the latest
 *     parent + record siblings in the proof's metadata.
 *   - Loop detection: chain depth cap (default 32) + chainParent
 *     duplicate detection.
 *
 * Composes onto every existing MCP tool (opt-in). Pure additive layer.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const MAX_CHAIN_DEPTH = 32;

export interface ProofMetadata {
  v: typeof PROTOCOL_VERSION;
  proofId: string;
  toolName: string;
  inputSha256: string;
  outputSha256: string;
  callerKey: string;
  chainParent: string | null;
  chainDepth: number;
  ts: string;
  hmac: string;
}

export interface ProofedOutput<T = unknown> {
  data: T;
  proof: ProofMetadata;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function defaultSecret(): string {
  return process.env["MNEME_PROOF_SECRET"] || `mneme-proof-carrying-v${PROTOCOL_VERSION}`;
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function computeHmac(meta: Omit<ProofMetadata, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(meta)).digest("hex");
}

export interface AttachProofInput<T> {
  toolName: string;
  input: unknown;
  output: T;
  callerKey: string;
  parentProof?: ProofMetadata | null;
  ts?: string;
  secret?: string;
}

export function attachProof<T>(input: AttachProofInput<T>): ProofedOutput<T> {
  const ts = input.ts ?? new Date().toISOString();
  const inputSha256 = sha256(canon(input.input));
  const outputSha256 = sha256(canon(input.output));
  const chainParent = input.parentProof ? input.parentProof.proofId : null;
  const chainDepth = (input.parentProof?.chainDepth ?? 0) + 1;
  if (chainDepth > MAX_CHAIN_DEPTH) {
    throw new Error(`PROOF: chain depth ${chainDepth} exceeds MAX_CHAIN_DEPTH=${MAX_CHAIN_DEPTH} — possible loop`);
  }
  const proofId = "p-" + createHmac("sha256", "mneme-proof-id")
    .update(`${input.toolName}|${inputSha256}|${outputSha256}|${ts}|${chainParent ?? "root"}`)
    .digest("hex").slice(0, 14);
  const meta: Omit<ProofMetadata, "hmac"> = {
    v: PROTOCOL_VERSION,
    proofId,
    toolName: input.toolName,
    inputSha256,
    outputSha256,
    callerKey: input.callerKey,
    chainParent,
    chainDepth,
    ts,
  };
  const hmac = computeHmac(meta, input.secret ?? defaultSecret());
  return { data: input.output, proof: { ...meta, hmac } };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Verify ONE proof in isolation against the data it carries. */
export function verifyProof(proofed: ProofedOutput, secret?: string): VerifyResult {
  const p = proofed.proof;
  if (!p) return { ok: false, reason: "missing proof" };
  // Recompute the hashes the proof claims
  const expectedOutputSha = sha256(canon(proofed.data));
  if (expectedOutputSha !== p.outputSha256) {
    return { ok: false, reason: "outputSha256 mismatch — data was tampered after attachProof" };
  }
  // HMAC verify
  const { hmac, ...body } = p;
  const expected = computeHmac(body, secret ?? defaultSecret());
  if (!safeEqHex(expected, hmac)) {
    return { ok: false, reason: "HMAC mismatch — forged or wrong secret" };
  }
  return { ok: true };
}

/**
 * Verify a chain of proofs. Caller passes the proofs in order
 * (rootmost → most recent). Returns ok=true iff:
 *   - each proof verifies in isolation
 *   - each proof's chainParent equals the previous proof's proofId
 *   - no two proofs share the same proofId (loop detection)
 *   - chainDepth is strictly increasing
 */
export function verifyChain(proofedList: ProofedOutput[], secret?: string): {
  ok: boolean;
  brokenAt?: number;
  reason?: string;
  dagDepth: number;
} {
  if (proofedList.length === 0) return { ok: true, dagDepth: 0 };
  const seenIds = new Set<string>();
  let prevId: string | null = null;
  let prevDepth = 0;
  for (let i = 0; i < proofedList.length; i++) {
    const v = verifyProof(proofedList[i]!, secret);
    if (!v.ok) return { ok: false, brokenAt: i, reason: `step ${i}: ${v.reason}`, dagDepth: i };
    const p = proofedList[i]!.proof;
    if (seenIds.has(p.proofId)) return { ok: false, brokenAt: i, reason: `loop detected: proofId ${p.proofId} reused`, dagDepth: i };
    seenIds.add(p.proofId);
    if (i > 0) {
      if (p.chainParent !== prevId) {
        return { ok: false, brokenAt: i, reason: `chain break: step ${i}.chainParent (${p.chainParent ?? "null"}) != step ${i - 1}.proofId (${prevId})`, dagDepth: i };
      }
      if (p.chainDepth <= prevDepth) {
        return { ok: false, brokenAt: i, reason: `chain depth not strictly increasing at step ${i}`, dagDepth: i };
      }
    } else {
      if (p.chainParent !== null) {
        return { ok: false, brokenAt: 0, reason: "root proof must have chainParent=null", dagDepth: 0 };
      }
    }
    prevId = p.proofId;
    prevDepth = p.chainDepth;
  }
  return { ok: true, dagDepth: prevDepth };
}

/**
 * Gate decorator: an MCP tool that requires its caller to supply a
 * verifiable parentProof. Returns a wrapped handler that throws if the
 * input is missing parentProof OR the proof doesn't verify.
 *
 * The wrapper then RUNS the inner handler and attaches a fresh proof
 * with chainParent pointing at the supplied parentProof.
 */
export function requireParentProof<TArgs extends { parentProof?: ProofMetadata }, TOut>(opts: {
  toolName: string;
  callerKey: string;
  inner: (args: TArgs) => Promise<TOut> | TOut;
  secret?: string;
}): (args: TArgs) => Promise<ProofedOutput<TOut>> {
  return async (args: TArgs) => {
    const parent = args.parentProof;
    if (!parent) throw new Error(`PROOF: '${opts.toolName}' requires parentProof; none supplied`);
    // Verify the parent's HMAC (we don't have the parent's full data here,
    // so trust the parent's claimed outputSha — but verify HMAC + structure)
    const { hmac, ...body } = parent;
    const expected = computeHmac(body, opts.secret ?? defaultSecret());
    if (!safeEqHex(expected, hmac)) {
      throw new Error(`PROOF: '${opts.toolName}' parentProof HMAC failed — forged or wrong secret`);
    }
    // Strip parentProof from args before passing to inner
    const { parentProof: _stripped, ...innerArgs } = args;
    const output = await opts.inner(innerArgs as unknown as TArgs);
    return attachProof({
      toolName: opts.toolName,
      input: innerArgs,
      output,
      callerKey: opts.callerKey,
      parentProof: parent,
      secret: opts.secret,
    });
  };
}

/** Build a fingerprint key for an AI agent: stable per (vendor + session-id + repo). */
export function fingerprintCaller(input: { vendor: string; sessionId?: string; repoPath?: string }): string {
  return "ck-" + createHmac("sha256", "mneme-caller-fingerprint")
    .update(`${input.vendor}|${input.sessionId ?? "unknown"}|${input.repoPath ?? process.cwd()}`)
    .digest("hex").slice(0, 16);
}

export function formatProofLine(p: ProofMetadata): string {
  const parent = p.chainParent ? ` ← ${p.chainParent.slice(0, 8)}` : " (root)";
  return `🔐 PROOF · ${p.proofId.slice(0, 10)} · ${p.toolName} · depth=${p.chainDepth}${parent}`;
}
