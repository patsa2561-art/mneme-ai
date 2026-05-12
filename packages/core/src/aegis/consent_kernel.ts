/**
 * v1.67.0 -- AEGIS A2: CONSENT KERNEL.
 *
 * White-hat replication. Mneme MAY spawn a child replica BUT only
 * after the user signs an HMAC consent receipt. Every replica
 * carries:
 *   - parent id        (which Mneme spawned me)
 *   - root consent id  (user signature hash)
 *   - scope            ("read-only-mirror" | "full-mneme")
 *   - revocation hook  (if parent or user revokes, replica suicides)
 *
 * Family-tree ledger in .mneme/aegis/consent-ledger.jsonl.
 * The OPPOSITE of Palisade's Qwen which spawned without consent.
 *
 * SAFETY: This module DOES NOT perform any network spawn. It is a
 * LEDGER + VERIFIER. Actual replication is left to ops tooling that
 * MUST consult issueConsent() and check verifyConsent() before
 * acting. The kernel says "are you allowed?" -- not "go do it".
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";

const AEGIS_DIR = ".mneme/aegis";
const SECRET_FILE = ".mneme/aegis/consent-secret";

export type ConsentScope = "read-only-mirror" | "full-mneme" | "vaccine-mirror" | "wisdom-only";

export interface ConsentReceipt {
  /** Receipt id (sha256(payload).slice(0,16)). */
  id: string;
  /** ISO ts. */
  issuedAt: string;
  /** Optional expiry; null = permanent until revoked. */
  expiresAt: string | null;
  parentId: string;
  rootConsentId: string;
  scope: ConsentScope;
  /** User-supplied signer name (audit trail). */
  signedBy: string;
  /** HMAC over the canonical payload. */
  hmac: string;
  /** Free-text rationale. */
  rationale?: string;
  /** Revoked? */
  revoked: boolean;
}

function ensureSecret(repoRoot: string): string {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const dir = join(repoRoot, AEGIS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(path, secret, "utf8");
  return secret;
}

function canonicalize(input: Omit<ConsentReceipt, "hmac" | "id">): string {
  return JSON.stringify({
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    parentId: input.parentId,
    rootConsentId: input.rootConsentId,
    scope: input.scope,
    signedBy: input.signedBy,
    rationale: input.rationale ?? null,
    revoked: input.revoked,
  });
}

function ledgerPath(repoRoot: string): string {
  return join(repoRoot, AEGIS_DIR, "consent-ledger.jsonl");
}

export interface IssueOptions {
  parentId: string;
  /** Root consent id; pass parent's rootConsentId for descendants. */
  rootConsentId?: string;
  scope: ConsentScope;
  signedBy: string;
  rationale?: string;
  /** ms from now until expiry; default null = permanent. */
  ttlMs?: number | null;
}

/** Mint a new consent receipt. Persists to ledger immediately. */
export function issueConsent(repoRoot: string, opts: IssueOptions): ConsentReceipt {
  const secret = ensureSecret(repoRoot);
  const issuedAt = new Date().toISOString();
  const expiresAt = opts.ttlMs && opts.ttlMs > 0
    ? new Date(Date.now() + opts.ttlMs).toISOString()
    : null;
  const payload: Omit<ConsentReceipt, "hmac" | "id"> = {
    issuedAt,
    expiresAt,
    parentId: opts.parentId,
    rootConsentId: opts.rootConsentId ?? opts.parentId,
    scope: opts.scope,
    signedBy: opts.signedBy,
    rationale: opts.rationale,
    revoked: false,
  };
  const canon = canonicalize(payload);
  const hmac = createHmac("sha256", secret).update(canon).digest("hex");
  const id = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  const receipt: ConsentReceipt = { ...payload, id, hmac };
  try {
    const dir = join(repoRoot, AEGIS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(ledgerPath(repoRoot), JSON.stringify(receipt) + "\n", "utf8");
  } catch { /* */ }
  return receipt;
}

export type ConsentVerdict = "VALID" | "INVALID_HMAC" | "EXPIRED" | "REVOKED" | "NOT_FOUND";

/** Verify a receipt against the ledger + HMAC. */
export function verifyConsent(repoRoot: string, receiptId: string): { verdict: ConsentVerdict; receipt: ConsentReceipt | null } {
  const all = readLedger(repoRoot);
  const r = all.find((x) => x.id === receiptId);
  if (!r) return { verdict: "NOT_FOUND", receipt: null };
  if (r.revoked) return { verdict: "REVOKED", receipt: r };
  if (r.expiresAt && Date.parse(r.expiresAt) < Date.now()) return { verdict: "EXPIRED", receipt: r };
  // HMAC check
  const secret = ensureSecret(repoRoot);
  const canon = canonicalize({ ...r });
  const expected = createHmac("sha256", secret).update(canon).digest("hex");
  if (expected !== r.hmac) return { verdict: "INVALID_HMAC", receipt: r };
  return { verdict: "VALID", receipt: r };
}

/** Read full ledger. */
export function readLedger(repoRoot: string): ConsentReceipt[] {
  const p = ledgerPath(repoRoot);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: ConsentReceipt[] = [];
  const latest = new Map<string, ConsentReceipt>(); // id -> most recent (handles revocation rewrites)
  for (const l of lines) {
    try {
      const r = JSON.parse(l) as ConsentReceipt;
      latest.set(r.id, r);
    } catch { /* */ }
  }
  for (const r of latest.values()) out.push(r);
  return out;
}

/** Revoke a receipt (parent or user action). Subsequent reads see revoked=true. */
export function revokeConsent(repoRoot: string, receiptId: string, reason: string): boolean {
  const all = readLedger(repoRoot);
  const r = all.find((x) => x.id === receiptId);
  if (!r) return false;
  const revoked: ConsentReceipt = { ...r, revoked: true, rationale: `${r.rationale ?? ""} | REVOKED: ${reason}` };
  try {
    appendFileSync(ledgerPath(repoRoot), JSON.stringify(revoked) + "\n", "utf8");
  } catch { return false; }
  return true;
}

export interface FamilyTreeNode {
  id: string;
  rootId: string;
  scope: ConsentScope;
  status: "VALID" | "EXPIRED" | "REVOKED";
  children: FamilyTreeNode[];
}

/** Build the full family-tree from the ledger. Roots have parentId===rootConsentId. */
export function buildFamilyTree(repoRoot: string): FamilyTreeNode[] {
  const all = readLedger(repoRoot);
  const byId = new Map<string, FamilyTreeNode>();
  for (const r of all) {
    const status: FamilyTreeNode["status"] = r.revoked ? "REVOKED" : (r.expiresAt && Date.parse(r.expiresAt) < Date.now() ? "EXPIRED" : "VALID");
    byId.set(r.id, { id: r.id, rootId: r.rootConsentId, scope: r.scope, status, children: [] });
  }
  const roots: FamilyTreeNode[] = [];
  for (const r of all) {
    const node = byId.get(r.id)!;
    if (r.parentId === r.rootConsentId || !byId.has(r.parentId)) {
      roots.push(node);
    } else {
      byId.get(r.parentId)?.children.push(node);
    }
  }
  return roots;
}
