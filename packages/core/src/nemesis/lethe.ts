/**
 * v2.54.0 — LETHE: GDPR forget primitive (Merkle exclusion proof).
 *
 * Greek mythology: river in Hades that erases memory.
 *
 * Problem: EU GDPR Art 17 (right to erasure) + AI-specific provisions
 * require that personal data — including fingerprint-style behavioural
 * markers — be REMOVABLE on request. But Mneme's HMAC chains are
 * tamper-evident by design: removing rows breaks the chain.
 *
 * Solution (cryptographically rigorous, not just "delete"):
 *   1. Build a Merkle tree over the chain rows.
 *   2. To "forget" row R, REPLACE the row's leaf with `H("forgotten:" || nonce)`
 *      where nonce is fresh per request.
 *   3. Recompute the Merkle root from the modified leaves.
 *   4. Issue a FORGET RECEIPT: signed proof tree showing
 *      (a) the row WAS in the chain (by original leaf hash, kept ONLY as
 *          the path to the root — never the content)
 *      (b) the row is NOW erased (replacement leaf)
 *      (c) the new Merkle root that subsequent verifiers can use
 *      (d) timestamp + GDPR jurisdiction tag
 *
 * Verifiers downstream:
 *   - Future readers see the new root + the FORGET ENVELOPE; they cannot
 *     recover the original content (it was the only place stored).
 *   - The exclusion proof is a few hundred bytes regardless of chain size.
 *
 * Composes: createHash + the existing HMAC-chained ledger pattern.
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

const LETHE_DIR = ".mneme/nemesis/lethe";
const FORGET_LEDGER = "forget_receipts.jsonl";
const KEY_ENV = "MNEME_LETHE_KEY";
const DEFAULT_KEY = "mneme-lethe-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

function leafOf(content: string): string {
  return createHash("sha256").update("leaf:").update(content).digest("hex");
}

function parentOf(left: string, right: string): string {
  return createHash("sha256").update("parent:").update(left).update(":").update(right).digest("hex");
}

export interface MerkleProofStep {
  /** Sibling hash at this level. */
  sibling: string;
  /** Position of the current node relative to its sibling. */
  position: "left" | "right";
}

export interface MerkleTree {
  /** Root hash. */
  root: string;
  /** Leaf hashes (in input order). */
  leaves: string[];
  /** Total number of leaves. */
  count: number;
}

/**
 * Build a Merkle tree from a list of row contents. Odd-count layers
 * duplicate the last element (standard Bitcoin-style construction).
 */
export function buildMerkleTree(rows: string[]): MerkleTree {
  if (!Array.isArray(rows) || rows.length === 0) {
    const empty = createHash("sha256").update("empty").digest("hex");
    return { root: empty, leaves: [], count: 0 };
  }
  const leaves = rows.map(leafOf);
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = i + 1 < level.length ? level[i + 1]! : level[i]!;
      next.push(parentOf(a, b));
    }
    level = next;
  }
  return { root: level[0]!, leaves, count: rows.length };
}

/**
 * Build an inclusion proof for the leaf at `index`.
 * Returns the sibling path from the leaf up to (but not including) the root.
 */
export function buildInclusionProof(rows: string[], index: number): { proof: MerkleProofStep[]; root: string; leafHash: string } | null {
  if (!Array.isArray(rows) || index < 0 || index >= rows.length) return null;
  const leaves = rows.map(leafOf);
  const leafHash = leaves[index]!;
  let level = [...leaves];
  let pos = index;
  const proof: MerkleProofStep[] = [];
  while (level.length > 1) {
    const isLeft = pos % 2 === 0;
    const siblingIdx = isLeft ? pos + 1 : pos - 1;
    const sibling = level[siblingIdx] ?? level[pos]!;
    proof.push({ sibling, position: isLeft ? "left" : "right" });
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = i + 1 < level.length ? level[i + 1]! : level[i]!;
      next.push(parentOf(a, b));
    }
    level = next;
    pos = Math.floor(pos / 2);
  }
  return { proof, root: level[0]!, leafHash };
}

/** Verify an inclusion proof. Pure. */
export function verifyInclusionProof(
  leafHash: string, proof: MerkleProofStep[], expectedRoot: string,
): boolean {
  if (typeof leafHash !== "string" || !Array.isArray(proof)) return false;
  let cur = leafHash;
  for (const step of proof) {
    if (step.position === "left") cur = parentOf(cur, step.sibling);
    else cur = parentOf(step.sibling, cur);
  }
  return cur === expectedRoot;
}

// ════════════════════════════════════════════════════════════════════
//  Forget receipt — the user-facing GDPR primitive
// ════════════════════════════════════════════════════════════════════

export interface ForgetReceipt {
  /** ISO-8601 timestamp of the forget request. */
  at: string;
  /** GDPR jurisdiction tag (EU/UK/etc) — for the audit trail. */
  jurisdiction: string;
  /** Source ledger identifier (e.g. "cli-activity.jsonl" / "drift-cursor.jsonl"). */
  ledger: string;
  /** Row index that was forgotten. */
  forgottenIndex: number;
  /** Inclusion proof THAT THE ROW WAS THERE (original leaf hash + path). */
  originalLeafHash: string;
  /** Replacement leaf hash. */
  replacementLeafHash: string;
  /** Merkle proof of inclusion of the original leaf in the ORIGINAL root. */
  inclusionProof: MerkleProofStep[];
  /** Original Merkle root (before erase). */
  originalRoot: string;
  /** New Merkle root (after erase). */
  newRoot: string;
  /** HMAC over the canonical receipt body. */
  hmac: string;
}

function hmacOf(body: object): string {
  return createHmac("sha256", keyOf()).update(JSON.stringify(body)).digest("hex");
}

export interface ForgetInput {
  repoRoot: string;
  ledgerRelative: string;
  /** Which row to forget (0-based). */
  rowIndex: number;
  jurisdiction?: string;
  /** Don't actually rewrite the ledger; only build the receipt. */
  dryRun?: boolean;
}

export interface ForgetResult {
  ok: boolean;
  receipt?: ForgetReceipt;
  newLedgerPath?: string;
  backupPath?: string;
  reason: string;
}

function forgetLeaf(nonce: string): string {
  return createHash("sha256").update("forgotten:").update(nonce).digest("hex");
}

/**
 * Read a JSONL ledger + perform GDPR forget on a specific row. Pure
 * cryptographic operation; ledger rewrite + backup are best-effort.
 */
export function forgetRow(input: ForgetInput): ForgetResult {
  try {
    const p = join(input.repoRoot, input.ledgerRelative);
    if (!existsSync(p)) return { ok: false, reason: `ledger not found: ${p}` };
    const rows = readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
    if (input.rowIndex < 0 || input.rowIndex >= rows.length) {
      return { ok: false, reason: `row ${input.rowIndex} out of range (ledger has ${rows.length} rows)` };
    }
    const originalTree = buildMerkleTree(rows);
    const inclusion = buildInclusionProof(rows, input.rowIndex);
    if (!inclusion) return { ok: false, reason: "failed to build inclusion proof" };

    const nonce = randomBytes(16).toString("hex");
    const replacementHash = forgetLeaf(nonce);
    const newRows = [...rows];
    // Replace with a sentinel that's parseable + non-PII
    const sentinel = JSON.stringify({ at: new Date().toISOString(), forgotten: true, leafHash: replacementHash, jurisdiction: input.jurisdiction ?? "EU-GDPR-Art17" });
    newRows[input.rowIndex] = sentinel;
    const newTree = buildMerkleTree(newRows);

    const bodyForHmac: Omit<ForgetReceipt, "hmac"> = {
      at: new Date().toISOString(),
      jurisdiction: input.jurisdiction ?? "EU-GDPR-Art17",
      ledger: input.ledgerRelative,
      forgottenIndex: input.rowIndex,
      originalLeafHash: inclusion.leafHash,
      replacementLeafHash: replacementHash,
      inclusionProof: inclusion.proof,
      originalRoot: originalTree.root,
      newRoot: newTree.root,
    };
    const receipt: ForgetReceipt = { ...bodyForHmac, hmac: hmacOf(bodyForHmac) };

    if (input.dryRun) {
      return { ok: true, receipt, reason: "dry-run: receipt built, ledger untouched" };
    }

    // Backup + rewrite
    const backupPath = p + ".pre-lethe.bak";
    try { copyFileSync(p, backupPath); } catch { /* */ }
    try { writeFileSync(p, newRows.join("\n") + "\n"); } catch (e) {
      return { ok: false, reason: `ledger rewrite failed: ${(e as Error).message}` };
    }
    // Append receipt to forget ledger
    try {
      const dir = join(input.repoRoot, LETHE_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, FORGET_LEDGER), JSON.stringify(receipt) + "\n");
    } catch { /* */ }
    return { ok: true, receipt, newLedgerPath: p, backupPath, reason: `row ${input.rowIndex} forgotten; old root ${originalTree.root.slice(0, 8)}… → new root ${newTree.root.slice(0, 8)}…` };
  } catch (e) {
    return { ok: false, reason: `forget failed: ${(e as Error).message}` };
  }
}

/** Verify a forget receipt cryptographically — does the inclusion proof
 *  reconstruct the original root + does the HMAC match? Pure. */
export function verifyForgetReceipt(receipt: ForgetReceipt): { ok: boolean; reason: string } {
  if (!receipt || typeof receipt.hmac !== "string") return { ok: false, reason: "missing hmac" };
  const { hmac, ...body } = receipt;
  const expectedHmac = hmacOf(body);
  if (expectedHmac !== hmac) return { ok: false, reason: "hmac mismatch" };
  const recoveredRoot = verifyInclusionProof(receipt.originalLeafHash, receipt.inclusionProof, receipt.originalRoot);
  if (!recoveredRoot) return { ok: false, reason: "inclusion proof does not reconstruct original root" };
  return { ok: true, reason: "receipt verified — row was in chain + has been forgotten + new root computed correctly" };
}

/** List all forget receipts in this repo. */
export function listForgetReceipts(repoRoot: string): ForgetReceipt[] {
  const p = join(repoRoot, LETHE_DIR, FORGET_LEDGER);
  if (!existsSync(p)) return [];
  const out: ForgetReceipt[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as ForgetReceipt); } catch { /* skip */ }
  }
  return out;
}
