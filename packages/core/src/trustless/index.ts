/**
 * TRUSTLESS MCP — proof-carrying tool results.
 *
 * Today an AI agent must TRUST whatever an MCP tool returns: the data arrives as
 * plain JSON with no way to tell a genuine result from a tampered/forged one. The
 * diamond: every result carries an Ed25519 `_proof` over the SHA-256 of its own
 * data, so the calling model — Claude / GPT / Gemini / anything — VERIFIES it
 * OFFLINE with the embedded public key. No network, no trusting Mneme. Output you
 * can CHECK, not output you must BELIEVE.
 *
 *   proofWrap(repoRoot, subject, data)  → {...data, _proof:{dataHash, receipt}}
 *   verifyToolResult(result)            → recompute hash + verify receipt + bind
 *                                          → { valid, reason, issuerFingerprint }
 *
 * ★ MEASURABLE (the A/B that proves it): `trustlessAB` runs N tool results, half
 *   PLAIN (group A — the status quo) and half PROOF-WRAPPED (group B), tampers a
 *   fraction of each, and measures detection. A: 0% verifiable, 0% tamper caught
 *   (you can only trust). B: 100% verifiable, 100% tamper caught. That delta IS
 *   the value, and it's a number, not a slogan.
 *
 * ★ HONEST (DIAKRISIS): the win is binding the EXACT bytes the tool returned to a
 *   signature the caller checks WITHOUT trusting the source (the asymmetric-crypto
 *   property — every prior MCP result is unsigned plain JSON). It is NOT a claim
 *   the result is semantically CORRECT — a tool can sign a wrong answer; the proof
 *   attests provenance + integrity (who produced it + that it wasn't altered),
 *   which is exactly what "trustless" means and what was missing. Pure + total.
 */
import { issueReceipt, verifyReceipt, canonicalJson, type NotaryReceipt } from "../notary/receipt.js";
import { createHash } from "node:crypto";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }

export interface ToolProof {
  /** sha256 over the canonical JSON of the data (proof binds these exact bytes). */
  dataHash: string;
  /** Ed25519 NOTARY receipt over the dataHash — verifiable offline. */
  receipt: NotaryReceipt;
}

/** A tool result whose `data` carries an offline-verifiable `_proof`. */
export type ProofCarrying<T extends Record<string, unknown> = Record<string, unknown>> = T & { _proof: ToolProof };

/**
 * Attach a proof to a tool result's data: bind the SHA-256 of the data (computed
 * over the data WITHOUT any pre-existing _proof) into an Ed25519 receipt. Total —
 * on any signing error it returns the data unwrapped (degrade to "unverified",
 * never throw, never block a tool call).
 */
export function proofWrap<T extends Record<string, unknown>>(
  repoRoot: string,
  subject: string,
  data: T,
  issuedAt?: number,
): T | ProofCarrying<T> {
  try {
    if (data === null || typeof data !== "object") return data;
    const { _proof, ...bare } = data as Record<string, unknown>;
    void _proof; // never sign over a previous proof
    const dataHash = sha256(canonicalJson(bare));
    const receipt = issueReceipt(repoRoot, {
      kind: "claim-verdict",
      subject: `mcp-result:${String(subject).slice(0, 80)}`,
      payload: { dataHash },
      includePayload: true,
      issuedAt,
    });
    return { ...(bare as T), _proof: { dataHash, receipt } };
  } catch {
    return data;
  }
}

export interface VerifyVerdict {
  valid: boolean;
  reason: string;
  issuerFingerprint?: string;
}

/**
 * Verify a proof-carrying result OFFLINE: (1) the receipt's own signature is valid,
 * (2) the receipt commits to the dataHash, and (3) the data (minus _proof) actually
 * hashes to that dataHash — so a tampered `data`, a forged receipt, or a swapped
 * proof are all caught. A result with NO _proof is `valid:false` (unverifiable —
 * the status quo). Total.
 */
export function verifyToolResult(result: unknown): VerifyVerdict {
  try {
    if (result === null || typeof result !== "object") return { valid: false, reason: "not an object — unverifiable" };
    const r = result as Record<string, unknown>;
    const proof = r["_proof"] as ToolProof | undefined;
    if (!proof || typeof proof !== "object" || !proof.receipt || typeof proof.dataHash !== "string") {
      return { valid: false, reason: "no _proof — unverifiable (you would have to TRUST this result)" };
    }
    // 1) receipt signature valid + 2) receipt binds the dataHash
    const rec = verifyReceipt(proof.receipt);
    if (!rec.valid) return { valid: false, reason: `receipt invalid: ${rec.reason}` };
    const pl = proof.receipt as { payloadHash?: string };
    const innerHash = sha256(canonicalJson({ dataHash: proof.dataHash }));
    if (!pl.payloadHash || pl.payloadHash !== innerHash) {
      return { valid: false, reason: "receipt does not commit to this dataHash (forged/swapped proof)" };
    }
    // 3) the data (minus _proof) hashes to the committed dataHash
    const { _proof, ...bare } = r;
    void _proof;
    const actual = sha256(canonicalJson(bare));
    if (actual !== proof.dataHash) {
      return { valid: false, reason: "data does not match the signed dataHash (tampered)" };
    }
    return { valid: true, reason: "genuine + untampered (verified offline)", issuerFingerprint: rec.issuerFingerprint };
  } catch (e) {
    return { valid: false, reason: `verify error: ${(e as Error).message}` };
  }
}

// ─────────────────────────── the measurable A/B ───────────────────────────

export interface TrustlessAB {
  trials: number;
  tamperedPerGroup: number;
  /** group A — PLAIN results (today's MCP): the caller can only TRUST. */
  plain: { verifiable: number; tamperDetected: number };
  /** group B — PROOF-CARRYING results: the caller VERIFIES offline. */
  proofed: { verifiable: number; tamperDetected: number };
  note: string;
}

/**
 * The honest A/B: N identical synthetic tool results per group. A = plain (no
 * proof), B = proof-wrapped. We tamper `tamperedPerGroup` of each, then run the
 * SAME verifier over both and count what it catches. A can never be verified or
 * detected (no proof to check); B verifies all untampered + detects all tampered.
 * Deterministic + total.
 */
export function trustlessAB(repoRoot: string, n = 20, issuedAt = 1_700_000_000_000): TrustlessAB {
  const tamperedPerGroup = Math.floor(n / 2);
  const mkData = (i: number): Record<string, unknown> => ({ tool: "mneme.demo", value: i, items: [i, i * 2, i * 3], note: `result ${i}` });

  const plain = { verifiable: 0, tamperDetected: 0 };
  const proofed = { verifiable: 0, tamperDetected: 0 };

  for (let i = 0; i < n; i++) {
    const tamper = i < tamperedPerGroup;

    // group A — plain result (no proof). Tamper = mutate a field.
    const a = mkData(i);
    if (tamper) a["value"] = (a["value"] as number) + 999;
    const av = verifyToolResult(a);
    if (av.valid) plain.verifiable++;
    if (tamper && !av.valid && av.reason.includes("tampered")) plain.tamperDetected++; // can never happen — no proof

    // group B — proof-carrying. Wrap the GENUINE data, then (if tampering) mutate
    // a field AFTER signing — exactly the attack the proof must catch.
    const wrapped = proofWrap(repoRoot, "demo", mkData(i), issuedAt) as Record<string, unknown>;
    if (tamper) wrapped["value"] = (wrapped["value"] as number) + 999;
    const bv = verifyToolResult(wrapped);
    if (!tamper && bv.valid) proofed.verifiable++;
    if (tamper && !bv.valid && /tampered/.test(bv.reason)) proofed.tamperDetected++;
  }

  return {
    trials: n,
    tamperedPerGroup,
    plain,
    proofed,
    note: "A (plain MCP result) is never verifiable and tampering is never detected — you can only TRUST. B (proof-carrying) verifies every untampered result and catches every tampered one — you VERIFY. The delta is the trustless property.",
  };
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface TrustlessGauntlet {
  score: number; // 0 or 100
  ab: TrustlessAB;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

/** Prove the trustless property holds + the A/B numbers are what we claim. Pure
 *  (uses the repo issuer key via process.cwd()). */
export function trustlessGauntlet(repoRoot = process.cwd()): TrustlessGauntlet {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const ab = trustlessAB(repoRoot, 20);
  const n = ab.trials, half = ab.tamperedPerGroup, untampered = n - half;

  // 1) genuine proof-wrapped result verifies
  const genuine = proofWrap(repoRoot, "t", { a: 1, b: [2, 3] }, 1) as Record<string, unknown>;
  checks.push({ name: "genuine result verifies offline", pass: verifyToolResult(genuine).valid === true, detail: "proof binds the exact data" });

  // 2) tampered data fails
  const tampered = { ...genuine, a: 999 };
  const tv = verifyToolResult(tampered);
  checks.push({ name: "tampered data caught", pass: tv.valid === false && /tampered/.test(tv.reason), detail: tv.reason });

  // 3) forged/swapped proof fails (steal a proof, attach to different data)
  const other = proofWrap(repoRoot, "t", { x: 42 }, 1) as Record<string, unknown>;
  const swapped = { a: 1, b: [2, 3], _proof: (other as { _proof: unknown })._proof };
  checks.push({ name: "swapped proof caught", pass: verifyToolResult(swapped).valid === false, detail: "proof from another result rejected" });

  // 4) plain result (no proof) is honestly UNVERIFIABLE (the status quo)
  const plainV = verifyToolResult({ a: 1 });
  checks.push({ name: "no-proof = unverifiable (honest)", pass: plainV.valid === false && /no _proof|unverifiable/.test(plainV.reason), detail: plainV.reason });

  // 5) A/B: plain group can NEVER verify or detect tampering
  checks.push({ name: "A (plain): 0 verifiable, 0 tamper-detected", pass: ab.plain.verifiable === 0 && ab.plain.tamperDetected === 0, detail: `verifiable=${ab.plain.verifiable} detected=${ab.plain.tamperDetected}` });

  // 6) A/B: proof group verifies ALL untampered + detects ALL tampered
  checks.push({ name: "B (proof): 100% verifiable + 100% tamper-detected", pass: ab.proofed.verifiable === untampered && ab.proofed.tamperDetected === half, detail: `verifiable=${ab.proofed.verifiable}/${untampered} detected=${ab.proofed.tamperDetected}/${half}` });

  // 7) proofWrap never signs over a previous proof (idempotent identity)
  const once = proofWrap(repoRoot, "t", { a: 1 }, 1) as Record<string, unknown>;
  const twice = proofWrap(repoRoot, "t", once, 1) as Record<string, unknown>;
  checks.push({ name: "re-wrap signs the data, not the old proof", pass: verifyToolResult(twice).valid === true, detail: "double-wrap still verifies (proof excluded from hash)" });

  // 8) total — garbage never throws
  let total = true;
  try { proofWrap(repoRoot, "t", null as unknown as Record<string, unknown>); verifyToolResult(undefined); } catch { total = false; }
  checks.push({ name: "total (never throws)", pass: total, detail: "garbage degraded gracefully" });

  const pass = checks.every((c) => c.pass);
  return { score: pass ? 100 : 0, ab, checks };
}
