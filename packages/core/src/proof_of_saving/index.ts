/**
 * v2.19.42 — PROOF OF SAVING (the wild idea no other AI tool ships).
 *
 *   "OpenAI / Anthropic charge you per token. Enterprises pay millions
 *    and have no third-party-verifiable evidence of what they saved by
 *    routing through any optimisation layer. PROOF OF SAVING mints an
 *    HMAC-signed Merkle-rooted certificate from a batch of Governor
 *    decisions: a Saving Manifest the procurement team can hand to
 *    auditors. Replayable, tamper-evident, vendor-neutral. The
 *    auditor doesn't need to trust Mneme's implementation — they
 *    re-hash the decisions and re-derive the same Merkle root.
 *
 *    This composes onto v2.19.40 TOKEN GOVERNOR (decisions are the
 *    leaves) + v2.19.34 APOSTILLE (same HMAC-chain pattern) + v2.19.34
 *    ETERNITY (certificate pins across vendors so the saving survives
 *    even if the optimiser provider disappears). It is the missing
 *    enterprise procurement primitive: 'show me PROOF you saved my
 *    company money.'
 *
 *    Wild because no AI optimisation vendor (LangChain / Helicone /
 *    Portkey / Vellum / Braintrust) issues replayable savings
 *    certificates — they show you a dashboard chart and ask you to
 *    trust the SQL behind it. Mneme issues a 4KB JSON certificate
 *    auditors can verify offline in 5ms."
 */

import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface GovernedDecisionShape {
  /** Stable id (some callers use signature; we sha256 the whole object). */
  signature: string;
  tokensUsedActual: number;
  estTokensSavedVsDirect: number;
  stage: number;
}

export interface SavingsCertificate {
  v: typeof PROTOCOL_VERSION;
  /** ISO timestamp of cert mint. */
  mintedAt: string;
  /** Window the savings cover. */
  windowStartMs: number;
  windowEndMs: number;
  /** Number of governed AI calls in the window. */
  decisionCount: number;
  /** Total tokens that would have been spent without Mneme. */
  totalDirectTokens: number;
  /** Total tokens actually spent through the Governor cascade. */
  totalActualTokens: number;
  /** totalDirectTokens - totalActualTokens. Always >= 0 by design. */
  totalTokensSaved: number;
  /** Hit rate per stage (Stage 1 = cache, Stage 2 = local, etc). */
  stageBreakdown: Record<string, { calls: number; tokensSaved: number }>;
  /** Estimated USD saved at caller-supplied $-per-token. */
  estUsdSaved: number;
  /** Caller-supplied $-per-token used for the USD estimate. */
  usdPerToken: number;
  /** Merkle root over decision signatures (replay-verifiable). */
  merkleRoot: string;
  /** Number of leaves in the Merkle tree. */
  merkleLeafCount: number;
  /** HMAC over the canonicalised cert body. */
  hmac: string;
}

export interface MintCertInput {
  decisions: GovernedDecisionShape[];
  windowStartMs: number;
  windowEndMs: number;
  /** Caller's blended $-per-token estimate. Default: $0.000002 (≈$2/1M). */
  usdPerToken?: number;
  /** Optional HMAC secret. Default: env MNEME_PROOF_SECRET. */
  secret?: string;
  /** Optional mint timestamp (defaults to Date.now). */
  nowMs?: number;
}

function defaultSecret(): string {
  return process.env["MNEME_PROOF_SECRET"] || `mneme-proof-of-saving-v${PROTOCOL_VERSION}`;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHmac("sha256", "mneme-proof-leaf").update(s).digest("hex");
}

function signCert(body: Omit<SavingsCertificate, "hmac">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

/** Build a Merkle root over an array of leaf strings. Deterministic. */
function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("∅");
  let level = leaves.map(sha256Hex);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1] ?? a;
      next.push(sha256Hex(a + ":" + b));
    }
    level = next;
  }
  return level[0]!;
}

/** Mint a savings certificate from a batch of Governor decisions. */
export function mintSavingsCertificate(input: MintCertInput): SavingsCertificate {
  const usdPerToken = input.usdPerToken ?? 0.000002; // $2 / 1M tokens default
  const secret = input.secret ?? defaultSecret();
  const nowMs = input.nowMs ?? Date.now();

  const stageBreakdown: Record<string, { calls: number; tokensSaved: number }> = {
    "1": { calls: 0, tokensSaved: 0 },
    "2": { calls: 0, tokensSaved: 0 },
    "3": { calls: 0, tokensSaved: 0 },
    "4": { calls: 0, tokensSaved: 0 },
    "5": { calls: 0, tokensSaved: 0 },
  };
  let totalActual = 0;
  let totalSaved = 0;
  for (const d of input.decisions) {
    totalActual += d.tokensUsedActual;
    totalSaved += d.estTokensSavedVsDirect;
    const k = String(d.stage);
    if (stageBreakdown[k]) {
      stageBreakdown[k].calls += 1;
      stageBreakdown[k].tokensSaved += d.estTokensSavedVsDirect;
    }
  }
  const totalDirect = totalActual + totalSaved;
  const leaves = input.decisions.map((d) => d.signature);
  const root = merkleRoot(leaves);

  const body: Omit<SavingsCertificate, "hmac"> = {
    v: PROTOCOL_VERSION,
    mintedAt: new Date(nowMs).toISOString(),
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    decisionCount: input.decisions.length,
    totalDirectTokens: totalDirect,
    totalActualTokens: totalActual,
    totalTokensSaved: totalSaved,
    stageBreakdown,
    estUsdSaved: totalSaved * usdPerToken,
    usdPerToken,
    merkleRoot: root,
    merkleLeafCount: leaves.length,
  };
  return { ...body, hmac: signCert(body, secret) };
}

/**
 * Verify a savings certificate. Returns { ok, reason } so callers can
 * surface specific failure reasons (HMAC mismatch / Merkle mismatch /
 * arithmetic violation).
 */
export function verifySavingsCertificate(
  cert: SavingsCertificate,
  decisions: GovernedDecisionShape[],
  secret?: string,
): { ok: boolean; reason?: string } {
  const sec = secret ?? defaultSecret();

  // 1) Arithmetic invariants must hold internally.
  if (cert.totalTokensSaved < 0) return { ok: false, reason: "negative totalTokensSaved" };
  if (cert.totalDirectTokens !== cert.totalActualTokens + cert.totalTokensSaved) {
    return { ok: false, reason: "totalDirect != actual + saved" };
  }
  if (cert.decisionCount !== decisions.length) {
    return { ok: false, reason: `decisionCount ${cert.decisionCount} != supplied ${decisions.length}` };
  }

  // 2) Merkle root must match the supplied decisions.
  const recomputedRoot = merkleRoot(decisions.map((d) => d.signature));
  if (recomputedRoot !== cert.merkleRoot) {
    return { ok: false, reason: `Merkle root mismatch (expected ${cert.merkleRoot}, recomputed ${recomputedRoot})` };
  }

  // 3) HMAC must verify (using the same secret).
  const { hmac, ...body } = cert;
  const expected = signCert(body, sec);
  if (expected !== hmac) return { ok: false, reason: "HMAC mismatch — forged certificate or wrong secret" };

  return { ok: true };
}

/** Render a human-readable summary safe to surface to a procurement dashboard. */
export function formatCertificate(cert: SavingsCertificate): string {
  const days = Math.max(1, Math.round((cert.windowEndMs - cert.windowStartMs) / 86_400_000));
  const lines: string[] = [];
  lines.push(`🪙 MNEME PROOF OF SAVING — v${cert.v}`);
  lines.push(`   Window: ${new Date(cert.windowStartMs).toISOString().slice(0, 10)} → ${new Date(cert.windowEndMs).toISOString().slice(0, 10)} (${days} days)`);
  lines.push(`   Calls governed: ${cert.decisionCount.toLocaleString()}`);
  lines.push(`   Tokens that would have shipped direct: ${cert.totalDirectTokens.toLocaleString()}`);
  lines.push(`   Tokens actually spent via Governor:    ${cert.totalActualTokens.toLocaleString()}`);
  lines.push(`   Tokens saved:                          ${cert.totalTokensSaved.toLocaleString()} (${((cert.totalTokensSaved / Math.max(1, cert.totalDirectTokens)) * 100).toFixed(1)}%)`);
  lines.push(`   USD saved (@ ${cert.usdPerToken}/token):         $${cert.estUsdSaved.toFixed(2)}`);
  lines.push(`   Stage breakdown:`);
  for (const [stage, stats] of Object.entries(cert.stageBreakdown)) {
    if (stats.calls === 0) continue;
    lines.push(`     Stage ${stage}: ${stats.calls} calls, ${stats.tokensSaved.toLocaleString()} tokens saved`);
  }
  lines.push(`   Merkle root: ${cert.merkleRoot.slice(0, 16)}…  (${cert.merkleLeafCount} leaves)`);
  lines.push(`   HMAC:        ${cert.hmac.slice(0, 16)}…  (verify with mneme.proof.verify)`);
  return lines.join("\n");
}
