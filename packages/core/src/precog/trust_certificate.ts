/**
 * v1.70.0 -- PRECOG P5: TRUST CERTIFICATE.
 *
 * After a claim passes verification, mint an HMAC-signed certificate.
 * Downstream consumers (apps, the user's UI, mesh peers) can verify
 * the certificate without re-running every checker.
 *
 *   issueCertificate(claim, verifierResults) -> { cert, signers, ts }
 *   verifyCertificate(cert) -> boolean
 *
 * The "SSL for AI claims" the user described.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";

const PRECOG_DIR = ".mneme/precog";
const CERT_LEDGER = ".mneme/precog/certificates.jsonl";
const SECRET_FILE = ".mneme/precog/cert-secret";

export interface VerifierResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface TrustCertificate {
  /** Stable id = sha256(claim || payload). */
  id: string;
  /** Original claim (truncated to 500 chars). */
  claim: string;
  /** Verifier names that passed. */
  signers: string[];
  /** Verifier names that flagged. */
  flaggedBy: string[];
  /** Verdict band. */
  verdict: "CERTIFIED" | "CONDITIONAL" | "REVOKED";
  /** ISO ts. */
  issuedAt: string;
  /** Expiry (ISO). */
  expiresAt: string;
  /** HMAC over canonical payload. */
  hmac: string;
}

function ensureSecret(repoRoot: string): string {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const dir = join(repoRoot, PRECOG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  try { writeFileSync(path, s, "utf8"); } catch { /* */ }
  return s;
}

function canonical(payload: Omit<TrustCertificate, "hmac" | "id">): string {
  return JSON.stringify({
    claim: payload.claim,
    signers: [...payload.signers].sort(),
    flaggedBy: [...payload.flaggedBy].sort(),
    verdict: payload.verdict,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

export interface IssueOptions {
  /** Window during which the cert is valid (ms). Default 24h. */
  ttlMs?: number;
}

export function issueCertificate(
  repoRoot: string,
  claim: string,
  verifierResults: VerifierResult[],
  opts?: IssueOptions,
): TrustCertificate {
  const secret = ensureSecret(repoRoot);
  const issuedAt = new Date().toISOString();
  const ttlMs = opts?.ttlMs ?? 24 * 3600 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const signers = verifierResults.filter((v) => v.passed).map((v) => v.name);
  const flaggedBy = verifierResults.filter((v) => !v.passed).map((v) => v.name);
  const verdict: TrustCertificate["verdict"] = flaggedBy.length === 0
    ? "CERTIFIED"
    : signers.length > flaggedBy.length
      ? "CONDITIONAL"
      : "REVOKED";
  const payload: Omit<TrustCertificate, "hmac" | "id"> = {
    claim: claim.slice(0, 500),
    signers, flaggedBy, verdict, issuedAt, expiresAt,
  };
  const canon = canonical(payload);
  const hmac = createHmac("sha256", secret).update(canon).digest("hex");
  const id = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  const cert: TrustCertificate = { ...payload, id, hmac };
  // Persist to ledger.
  try {
    const dir = join(repoRoot, PRECOG_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(repoRoot, CERT_LEDGER), JSON.stringify(cert) + "\n", "utf8");
  } catch { /* */ }
  return cert;
}

export type VerifyVerdict = "VALID" | "INVALID_HMAC" | "EXPIRED" | "NOT_CERTIFIED";

export function verifyCertificate(repoRoot: string, cert: TrustCertificate): VerifyVerdict {
  if (Date.parse(cert.expiresAt) < Date.now()) return "EXPIRED";
  const secret = ensureSecret(repoRoot);
  const canon = canonical(cert);
  const expected = createHmac("sha256", secret).update(canon).digest("hex");
  if (expected !== cert.hmac) return "INVALID_HMAC";
  if (cert.verdict === "REVOKED") return "NOT_CERTIFIED";
  return "VALID";
}

export function readCertLedger(repoRoot: string): TrustCertificate[] {
  const p = join(repoRoot, CERT_LEDGER);
  if (!existsSync(p)) return [];
  const out: TrustCertificate[] = [];
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as TrustCertificate); } catch { /* */ }
    }
  } catch { /* */ }
  return out;
}
