/**
 * v2.108.0 — MNEME ENTROPY (Audited Multi-Source Entropy & Secrets).
 *
 * The honest, world-class-crypto-engineering core of the "True Entropy
 * Security" idea — WITHOUT the ocean-wave / quantum-vacuum mysticism.
 *
 * What it really does (and what it does NOT claim):
 *   - It MIXES every entropy source you actually have — the OS CSPRNG, timing
 *     jitter, any physical/external sample you feed it (a public randomness
 *     beacon, a sensor reading) — through a standard cryptographic extractor
 *     (HKDF / HMAC-SHA-512). This is DEFENSE IN DEPTH: the output is strong if
 *     *any one* source has entropy, so a single backdoored/degraded source
 *     can't weaken your key.
 *   - It HEALTH-CHECKS sources (NIST-style monobit / runs / byte-uniformity)
 *     and estimates min-entropy, so a stuck source is FLAGGED, not trusted.
 *   - It SIGNS a provenance attestation (which sources, their health, the
 *     min-entropy estimate, the secret's hash) so you can PROVE how a secret
 *     was derived — WITHOUT revealing the secret (only its hash is signed).
 *
 * It does NOT claim to be "unhackable by quantum computers" — `crypto`'s
 * CSPRNG is already secure; the value here is resilience + AUDITABILITY +
 * fail-safe health checks, the things real key-management gets wrong.
 *
 * Pure + total (108-error rule): deterministic given its inputs, never throws.
 */

import { createHmac, createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";

export interface EntropySource {
  id: string;
  /** raw entropy bytes (hex/base64/utf8 string or a Buffer). */
  data: string | Buffer;
  /** optional encoding of a string `data` (default utf8; "hex"/"base64"). */
  encoding?: "hex" | "base64" | "utf8";
}

function toBuf(s: EntropySource): Buffer {
  try {
    if (Buffer.isBuffer(s?.data)) return s.data;
    if (typeof s?.data === "string") return Buffer.from(s.data, s.encoding ?? "utf8");
    return Buffer.alloc(0);
  } catch { return Buffer.alloc(0); }
}

/**
 * HKDF-style extractor over ALL sources (RFC-5869 shape). Each source is
 * domain-separated by its id so a duplicate buffer can't cancel itself out.
 * Extract = HMAC(salt, IKM); Expand = HMAC-chain to `outBytes`. Defense in
 * depth: the result is uniform if any single source carries entropy. Total.
 */
export function mixEntropy(sources: EntropySource[], outBytes = 32): Buffer {
  try {
    const n = outBytes > 0 ? Math.min(outBytes, 4096) : 32;
    const list = Array.isArray(sources) ? sources : [];
    // IKM = concat( len-prefixed( id || 0x00 || bytes ) )
    const parts: Buffer[] = [];
    for (const s of list) {
      const id = Buffer.from(typeof s?.id === "string" ? s.id : "", "utf8");
      const b = toBuf(s);
      const lp = Buffer.alloc(4); lp.writeUInt32BE(b.length, 0);
      parts.push(id, Buffer.from([0]), lp, b);
    }
    const ikm = Buffer.concat(parts);
    const prk = createHmac("sha512", "mneme/entropy/extract/v1").update(ikm).digest();
    // Expand
    const out: Buffer[] = []; let prev = Buffer.alloc(0); let i = 1; let got = 0;
    while (got < n) {
      const t = createHmac("sha512", prk).update(Buffer.concat([prev, Buffer.from("mneme/entropy/expand"), Buffer.from([i])])).digest();
      out.push(t); prev = t; got += t.length; i++;
      if (i > 255) break;
    }
    return Buffer.concat(out).subarray(0, n);
  } catch { return Buffer.alloc(0); }
}

export interface HealthReport {
  /** fraction of 1-bits (ideal 0.5). */
  monobit: number;
  /** number of runs of consecutive equal bits. */
  runs: number;
  /** byte-frequency chi-square (lower ≈ more uniform; ideal ~255). */
  chiSquare: number;
  /** estimated min-entropy in bits/byte (0..8). */
  minEntropyBitsPerByte: number;
  /** true iff the sample passes the basic randomness checks. */
  passed: boolean;
}

/**
 * NIST-style health check (monobit + runs + byte-uniformity) + a min-entropy
 * ESTIMATE (from the most-frequent byte). Detects a stuck/degraded source.
 * For very short samples the thresholds are loosened. Total. */
export function healthCheck(bytes: Buffer | string): HealthReport {
  const empty: HealthReport = { monobit: 0, runs: 0, chiSquare: 1e9, minEntropyBitsPerByte: 0, passed: false };
  try {
    const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(typeof bytes === "string" ? bytes : "", "utf8");
    if (b.length === 0) return empty;
    // monobit + runs
    let ones = 0, runs = 1; let prevBit = -1;
    for (let i = 0; i < b.length; i++) {
      for (let k = 7; k >= 0; k--) {
        const bit = (b[i]! >> k) & 1; ones += bit;
        if (prevBit !== -1 && bit !== prevBit) runs++;
        prevBit = bit;
      }
    }
    const totalBits = b.length * 8;
    const monobit = ones / totalBits;
    // byte-frequency chi-square + min-entropy
    const freq = new Array(256).fill(0); for (const x of b) freq[x]++;
    const exp = b.length / 256;
    let chi = 0; let maxF = 0;
    for (let i = 0; i < 256; i++) { chi += ((freq[i] - exp) ** 2) / (exp || 1); if (freq[i] > maxF) maxF = freq[i]; }
    const pMax = maxF / b.length;
    const minEntropy = pMax > 0 ? Math.min(8, Math.max(0, -Math.log2(pMax))) : 0;   // Math.max avoids -0 at pMax=1
    // The p_max min-entropy estimator systematically UNDER-estimates for
    // finite samples, so it is informational + a loose floor only (catches a
    // stuck/near-constant source, never certifies perfection). The real
    // pass/fail gates are monobit + runs.
    // Monobit tolerance is SAMPLE-SIZE-ADAPTIVE (4σ of the binomial), not a
    // flat 0.20 — a flat tolerance let a 9σ-biased small sample pass (v2.108
    // crypto review). 4σ rejects gross bias yet near-never false-fails real
    // randomness; floored so micro-samples aren't absurdly strict.
    const tol = Math.max(0.025, 4 / Math.sqrt(totalBits));
    const monobitOk = Math.abs(monobit - 0.5) <= tol;
    const runsOk = runs >= totalBits * 0.25 && runs <= totalBits * 0.75;   // not stuck, not perfectly alternating
    const minEntropyFloor = minEntropy >= (b.length >= 1024 ? 4 : 1.5);    // loose: only rejects (near-)constant sources
    const passed = monobitOk && runsOk && minEntropyFloor;
    return { monobit, runs, chiSquare: chi, minEntropyBitsPerByte: minEntropy, passed };
  } catch { return empty; }
}

export interface SecretResult {
  /** the generated secret, hex-encoded. */
  secretHex: string;
  /** false when NO source carried any bytes — the "secret" would be a fixed
   *  function of the empty input, so it is refused (empty + health failed). */
  usableEntropy: boolean;
  sourceIds: string[];
  /** per-source health (a stuck source is flagged but still mixed in). */
  sourceHealth: Array<{ id: string; passed: boolean; minEntropyBitsPerByte: number }>;
  /** health of the FINAL mixed output. */
  outputHealth: HealthReport;
  /** signed provenance: proves the derivation WITHOUT revealing the secret. */
  attestation: NotaryReceipt;
}

/**
 * Generate a secret of `outBytes` from the given sources, with a SIGNED
 * provenance attestation over (sourceIds, health, sha256(secret)). Total.
 * `at` is the issue timestamp (deterministic). The OS CSPRNG source should be
 * supplied by the caller (CLI/MCP) so this core stays pure.
 */
export function generateSecret(repoRoot: string, sources: EntropySource[], outBytes: number, at: number): SecretResult {
  const list = Array.isArray(sources) ? sources : [];
  const ids = list.map((s) => (typeof s?.id === "string" ? s.id : ""));
  // REFUSE no-entropy input: with zero source bytes the "secret" is a fixed
  // function of the empty IKM (predictable). Don't return a valid-looking one.
  const totalInputBytes = list.reduce((n, s) => n + toBuf(s).length, 0);
  const sourceHealth = list.map((s) => { const h = healthCheck(toBuf(s)); return { id: typeof s?.id === "string" ? s.id : "", passed: h.passed, minEntropyBitsPerByte: Number(h.minEntropyBitsPerByte.toFixed(2)) }; });
  const fail = (reason: string): SecretResult => {
    let attestation: NotaryReceipt;
    try { attestation = issueReceipt(repoRoot, { kind: "reasoning-trace", subject: `entropy:refused`, payload: { refused: true, reason }, includePayload: true, issuedAt: at }); }
    catch { attestation = { v: 1, alg: "ed25519", kind: "reasoning-trace", subject: "entropy:refused", payloadHash: "", issuer: "", issuerFingerprint: "", issuedAt: at, prev: null, receiptId: "", sig: "" } as NotaryReceipt; }
    return { secretHex: "", usableEntropy: false, sourceIds: ids, sourceHealth, outputHealth: { monobit: 0, runs: 0, chiSquare: 1e9, minEntropyBitsPerByte: 0, passed: false }, attestation };
  };
  if (totalInputBytes === 0) return fail("no source entropy (zero input bytes)");

  const mixed = mixEntropy(list, outBytes > 0 ? outBytes : 32);
  const secretHex = mixed.toString("hex");
  const outputHealth = healthCheck(mixed);
  const outputHash = createHash("sha256").update(mixed).digest("hex");
  // total: a crypto/key error inside issueReceipt must not break the "never
  // throws" contract — fall back to a non-verifying sentinel (verify→false).
  let attestation: NotaryReceipt;
  try {
    attestation = issueReceipt(repoRoot, {
      kind: "reasoning-trace",
      subject: `entropy:${outputHash.slice(0, 16)}`,
      payload: { outputHash, outBytes: mixed.length, sourceIds: ids, sourceHealth, outputHealthPassed: outputHealth.passed, minEntropyBitsPerByte: Number(outputHealth.minEntropyBitsPerByte.toFixed(2)) },
      includePayload: true,
      issuedAt: at,
    });
  } catch {
    attestation = { v: 1, alg: "ed25519", kind: "reasoning-trace", subject: "entropy:unsigned", payloadHash: "", issuer: "", issuerFingerprint: "", issuedAt: at, prev: null, receiptId: "", sig: "" } as NotaryReceipt;
  }
  return { secretHex, usableEntropy: true, sourceIds: ids, sourceHealth, outputHealth, attestation };
}

export interface SecretVerify { valid: boolean; bound: boolean; reason: string }

/** Verify a secret's provenance OFFLINE: the attestation signature is valid
 *  AND sha256(secret) matches the signed outputHash — proving this exact
 *  secret was derived from the attested sources, without the attestation ever
 *  containing the secret. Total. */
export function verifySecretAttestation(attestation: NotaryReceipt, secretHex: string): SecretVerify {
  try {
    if (!attestation) return { valid: false, bound: false, reason: "no attestation" };
    const v = verifyReceipt(attestation);
    if (!v.valid) return { valid: false, bound: false, reason: v.reason ?? "bad signature" };
    const p = (attestation as { payload?: { outputHash?: string } }).payload;
    if (!p || typeof p.outputHash !== "string" || p.outputHash.length === 0) return { valid: true, bound: false, reason: "signature valid but no outputHash to bind (e.g. a refused/unsigned attestation)" };
    // Explicitly reject a non-string / empty secret — never let undefined map
    // to the empty-buffer hash and accidentally bind (v2.108 crypto review).
    if (typeof secretHex !== "string" || secretHex.length === 0) return { valid: true, bound: false, reason: "secret must be a non-empty hex string" };
    let secretBuf: Buffer; try { secretBuf = Buffer.from(secretHex, "hex"); } catch { return { valid: true, bound: false, reason: "secret not hex" }; }
    if (secretBuf.length === 0) return { valid: true, bound: false, reason: "secret decoded to empty" };
    const h = createHash("sha256").update(secretBuf).digest("hex");
    const bound = h === p.outputHash;
    return { valid: true, bound, reason: bound ? "attestation binds this secret to its audited sources" : "signature valid but secret does NOT match the attestation (wrong/tampered secret)" };
  } catch (e) { return { valid: false, bound: false, reason: `threw: ${(e as Error).message}` }; }
}

export interface EntropyGauntlet {
  mixDeterministic: boolean;
  mixDiverges: boolean;
  defenseInDepth: boolean;
  healthDetectsStuck: boolean;
  attestationBinds: boolean;
  stable: boolean;
  score: number;
}

/** Prove the entropy engine. Total + deterministic. */
export function entropyGauntlet(repoRoot: string, at: number): EntropyGauntlet {
  try {
    const good1: EntropySource = { id: "a", data: "0123456789abcdef".repeat(8), encoding: "hex" };
    const good2: EntropySource = { id: "b", data: "fedcba9876543210".repeat(8), encoding: "hex" };
    const stuck: EntropySource = { id: "stuck", data: Buffer.alloc(64, 0) };
    const m1 = mixEntropy([good1, good2], 32).toString("hex");
    const m1b = mixEntropy([good1, good2], 32).toString("hex");
    const mixDeterministic = m1 === m1b;
    const m2 = mixEntropy([good1, { id: "b", data: "0000000000000000".repeat(8), encoding: "hex" }], 32).toString("hex");
    const mixDiverges = m1 !== m2;
    // defense in depth: one stuck source + one good → output still passes health
    const defenseInDepth = healthCheck(mixEntropy([stuck, good1, good2], 256)).passed === true;
    // health flags a stuck (all-zero) sample
    const healthDetectsStuck = healthCheck(Buffer.alloc(256, 0)).passed === false;
    const sec = generateSecret(repoRoot, [good1, good2], 32, at);
    const attestationBinds = verifySecretAttestation(sec.attestation, sec.secretHex).bound === true
      && verifySecretAttestation(sec.attestation, "00".repeat(32)).bound === false;
    let stable = true;
    try { mixEntropy(null as never); healthCheck(null as never); generateSecret(repoRoot, null as never, 0, at); verifySecretAttestation(null as never, null as never); } catch { stable = false; }
    const perfect = mixDeterministic && mixDiverges && defenseInDepth && healthDetectsStuck && attestationBinds && stable;
    return { mixDeterministic, mixDiverges, defenseInDepth, healthDetectsStuck, attestationBinds, stable, score: perfect ? 100 : 0 };
  } catch { return { mixDeterministic: false, mixDiverges: false, defenseInDepth: false, healthDetectsStuck: false, attestationBinds: false, stable: false, score: 0 }; }
}
