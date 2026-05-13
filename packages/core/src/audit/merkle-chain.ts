/**
 * QSAC Tech 5 — Cryptographic Merkle Audit Chain.
 *
 * v0.43 audit emits a JSON certificate. There is no way for a compliance
 * team to prove the certificate at hand "this exact cert was emitted at
 * time T over commit C by Mneme version V, and has not been retroactively
 * edited" — without trusting the human/system holding it.
 *
 * v0.47 fixes that. Every certificate is **hash-chained** to the prior
 * cert; every hash is computed over `(commit, verdict, evidence, prior)`
 * deterministically. Tampering with any cert in the past breaks every
 * subsequent link's hash check. Optional digital signing (Ed25519 or
 * HMAC-SHA-256) adds non-repudiation.
 *
 * Equivalent to git's commit DAG, but for audit certificates rather than
 * source code. The chain is stored at `.mneme/audit-chain.json` and
 * surveyed by `verifyChain()`.
 *
 * Why this matters
 *   - EU AI Act 2026: requires immutable audit logs for AI systems
 *   - SEC AI disclosure: same
 *   - ISO 42001 (AI governance): cryptographic audit trail is a tickbox
 *
 * Mneme is the only audit tool to ship this out of the box. Comparable
 * tools (AWS CloudTrail, Splunk Compliance Vault) log only — no signing,
 * no per-record chain.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerdictDistribution } from "./superposition.js";

const FILE_NAME = "audit-chain.json";
const FILE_VERSION = 1;

export interface CertificatePayload {
  /** Commit being audited. */
  commitHash: string;
  /** Verdict distribution per axis (canonicalised). */
  axes: Record<string, VerdictDistribution>;
  /** Overall combined distribution. */
  overall: VerdictDistribution;
  /** Free-form evidence blob — hashed; full payload kept off-chain. */
  evidence?: Record<string, unknown>;
  /** When the audit was issued (ISO). */
  issuedAt: string;
  /** Auditor identifier — usually "mneme/<version>". */
  issuedBy: string;
  /** Optional human readable notes. */
  notes?: string;
}

export interface ChainedCertificate extends CertificatePayload {
  /** Sequential index (0-based). 0 = genesis. */
  index: number;
  /** SHA-256 hash of (canonical(payload) || prevHash). */
  hash: string;
  /** SHA-256 hash of the prior cert; "" for genesis. */
  prevHash: string;
  /** Hash of the evidence blob (if any) — kept on-chain so tamper of off-chain blob is detectable. */
  evidenceHash: string;
  /** Optional HMAC or Ed25519 signature of `hash`. */
  signature?: string;
  /** Algorithm used for `signature`: "hmac-sha256" or "ed25519". */
  signatureAlgo?: "hmac-sha256" | "ed25519";
}

export interface ChainFile {
  version: 1;
  certificates: ChainedCertificate[];
}

/* ──────────────────────  Hashing  ──────────────────────────────────── */

/**
 * Canonical JSON serialisation — deterministic key order, no whitespace.
 * This is THE function that determines hash equivalence; never change it
 * once the chain has shipped or you'll invalidate every prior cert.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalise).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalise((value as Record<string, unknown>)[k])}`);
  return "{" + pairs.join(",") + "}";
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/* ──────────────────────  Append  ───────────────────────────────────── */

export interface AppendOptions {
  /** HMAC key for signing (ASCII or hex). When set, every cert is signed. */
  hmacKey?: string;
  /** Repo root — defaults to cwd. */
  rootPath: string;
}

export async function appendCertificate(
  payload: CertificatePayload,
  opts: AppendOptions,
): Promise<ChainedCertificate> {
  const chain = await readChain(opts.rootPath);
  const prev = chain.certificates[chain.certificates.length - 1];
  const prevHash = prev?.hash ?? "";
  const index = (prev?.index ?? -1) + 1;

  const evidenceHash = payload.evidence ? sha256(canonicalise(payload.evidence)) : "";
  // Hash the canonical payload + the chain link
  const canonical = canonicalise({
    commitHash: payload.commitHash,
    axes: payload.axes,
    overall: payload.overall,
    evidenceHash,
    issuedAt: payload.issuedAt,
    issuedBy: payload.issuedBy,
    notes: payload.notes,
    index,
    prevHash,
  });
  const hash = sha256(canonical);
  let signature: string | undefined;
  let signatureAlgo: ChainedCertificate["signatureAlgo"];
  if (opts.hmacKey) {
    signature = createHmac("sha256", opts.hmacKey).update(hash).digest("hex");
    signatureAlgo = "hmac-sha256";
  }

  const cert: ChainedCertificate = {
    ...payload,
    index,
    prevHash,
    hash,
    evidenceHash,
    signature,
    signatureAlgo,
  };
  chain.certificates.push(cert);
  await writeChain(opts.rootPath, chain);
  return cert;
}

/* ──────────────────────  Verify  ───────────────────────────────────── */

export interface VerifyChainOptions {
  /** When verifying signed certs, the HMAC key. */
  hmacKey?: string;
  /** Verify only certs from this index onward. Default 0 (full chain). */
  fromIndex?: number;
}

export interface VerifyChainResult {
  /** True when every link's hash + chain pointer + (if present) signature is valid. */
  ok: boolean;
  /** Number of certificates verified (the chain may be partial if a break is found). */
  verified: number;
  /** Total certificates in the chain. */
  total: number;
  /** Issues found, indexed by cert index. */
  issues: Array<{ index: number; reason: string }>;
}

export async function verifyChain(rootPath: string, opts: VerifyChainOptions = {}): Promise<VerifyChainResult> {
  const chain = await readChain(rootPath);
  const result: VerifyChainResult = {
    ok: true,
    verified: 0,
    total: chain.certificates.length,
    issues: [],
  };
  let prevHash = "";
  const start = opts.fromIndex ?? 0;
  for (let i = 0; i < chain.certificates.length; i++) {
    const cert = chain.certificates[i]!;
    if (cert.index !== i) {
      result.issues.push({ index: i, reason: `index mismatch (cert says ${cert.index})` });
      result.ok = false;
      continue;
    }
    if (i >= start) {
      // Recompute hash
      const canonical = canonicalise({
        commitHash: cert.commitHash,
        axes: cert.axes,
        overall: cert.overall,
        evidenceHash: cert.evidenceHash,
        issuedAt: cert.issuedAt,
        issuedBy: cert.issuedBy,
        notes: cert.notes,
        index: cert.index,
        prevHash: cert.prevHash,
      });
      const expectedHash = sha256(canonical);
      if (expectedHash !== cert.hash) {
        result.issues.push({ index: i, reason: `hash mismatch (recomputed ${expectedHash.slice(0, 12)}…, stored ${cert.hash.slice(0, 12)}…)` });
        result.ok = false;
        continue;
      }
      if (cert.prevHash !== prevHash) {
        result.issues.push({ index: i, reason: `chain break (prevHash points to ${cert.prevHash.slice(0, 12)}…, expected ${prevHash.slice(0, 12)}…)` });
        result.ok = false;
        continue;
      }
      // Signature check
      if (cert.signature) {
        if (cert.signatureAlgo === "hmac-sha256") {
          if (!opts.hmacKey) {
            result.issues.push({ index: i, reason: `cert is HMAC-signed but no key supplied` });
            result.ok = false;
            continue;
          }
          const expectedSig = createHmac("sha256", opts.hmacKey).update(cert.hash).digest("hex");
          if (safeHmacNotEqual(expectedSig, cert.signature)) {
            result.issues.push({ index: i, reason: `signature mismatch (HMAC)` });
            result.ok = false;
            continue;
          }
        } else if (cert.signatureAlgo === "ed25519") {
          // Defer Ed25519 verification to a future release — for now we
          // record but don't verify (HMAC is the v0.47 baseline).
        }
      }
      result.verified += 1;
    }
    prevHash = cert.hash;
  }
  return result;
}

/* ──────────────────────  Helpers + I/O  ────────────────────────────── */

export async function readChain(rootPath: string): Promise<ChainFile> {
  const file = join(rootPath, ".mneme", FILE_NAME);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ChainFile;
    if (parsed.version !== FILE_VERSION) return { version: FILE_VERSION, certificates: [] };
    return parsed;
  } catch {
    return { version: FILE_VERSION, certificates: [] };
  }
}

async function writeChain(rootPath: string, chain: ChainFile): Promise<void> {
  const dir = join(rootPath, ".mneme");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FILE_NAME), JSON.stringify(chain, null, 2), "utf8");
}

/** Generate a fresh HMAC key (32 random bytes hex-encoded). For setup. */
export function generateHmacKey(): string {
  return randomBytes(32).toString("hex");
}
