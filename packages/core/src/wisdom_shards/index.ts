/**
 * v2.1.0 -- WISDOM SHARDS · proof-of-truth currency primitive
 *
 * Mint a shard when the AI gives a verified-grounded answer (passes
 * V_eff from FLASH + audit-chain check). Burn a shard when the AI is
 * caught hallucinating. The cumulative balance is HMAC-chained,
 * tamper-evident, and observable across federation nodes (when wired).
 *
 * This is the LEDGER primitive. Federation hub adoption is v1.27 work;
 * for v2.1 we ship the local ledger that any federation can adopt.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";

export interface ShardEntry {
  /** Stable id. */
  id: string;
  ts: number;
  /** Mint (+) or burn (-). */
  kind: "mint" | "burn";
  /** Value (positive integer, in shards). */
  value: number;
  /** Why — for audit. */
  reason: string;
  /** Optional citation (commit / audit-log entry / FLASH verdict id). */
  citation?: string;
  /** Hash chain: SHA-256(prev || JSON(this entry minus chainHash)). */
  chainHash: string;
}

export interface Ledger {
  /** Newest first. */
  entries: ShardEntry[];
  /** Public key fingerprint for verifying signatures. */
  keyFingerprint: string;
}

function fpSecret(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

function chainOf(prevHash: string, entryWithoutHash: Omit<ShardEntry, "chainHash">, secret: Buffer): string {
  const sig = createHmac("sha256", secret).update(prevHash + JSON.stringify(entryWithoutHash)).digest("hex");
  return sig.slice(0, 32);
}

export function createLedger(secret: Buffer): Ledger {
  return { entries: [], keyFingerprint: fpSecret(secret) };
}

export interface AppendInput {
  ledger: Ledger;
  kind: "mint" | "burn";
  value: number;
  reason: string;
  citation?: string;
  secret: Buffer;
}

export function appendShard(input: AppendInput): { ledger: Ledger; entry: ShardEntry } {
  if (input.value <= 0 || !Number.isInteger(input.value)) {
    throw new Error("value must be a positive integer");
  }
  const ts = Date.now();
  const id = randomBytes(6).toString("hex");
  const prevHash = input.ledger.entries[0]?.chainHash ?? "0".repeat(32);
  const withoutHash: Omit<ShardEntry, "chainHash"> = { id, ts, kind: input.kind, value: input.value, reason: input.reason, citation: input.citation };
  const chainHash = chainOf(prevHash, withoutHash, input.secret);
  const entry: ShardEntry = { ...withoutHash, chainHash };
  const ledger: Ledger = { ...input.ledger, entries: [entry, ...input.ledger.entries] };
  return { ledger, entry };
}

export interface BalanceResult {
  totalMinted: number;
  totalBurned: number;
  balance: number;
  entryCount: number;
}

export function balanceOf(ledger: Ledger): BalanceResult {
  let totalMinted = 0;
  let totalBurned = 0;
  for (const e of ledger.entries) {
    if (e.kind === "mint") totalMinted += e.value;
    else totalBurned += e.value;
  }
  return { totalMinted, totalBurned, balance: totalMinted - totalBurned, entryCount: ledger.entries.length };
}

export type ChainVerdict = "VALID" | "BROKEN" | "WRONG_KEY";

export interface ChainVerifyResult {
  verdict: ChainVerdict;
  reason: string;
  /** Index of the first broken entry (entries[0] is newest, so highest broken index = oldest broken). */
  firstBrokenIndex?: number;
}

export function verifyChain(ledger: Ledger, secret: Buffer): ChainVerifyResult {
  if (fpSecret(secret) !== ledger.keyFingerprint) {
    return { verdict: "WRONG_KEY", reason: "secret fingerprint does not match ledger keyFingerprint" };
  }
  // Walk OLDEST → NEWEST. ledger.entries[0] is newest, so reverse.
  let prevHash = "0".repeat(32);
  for (let i = ledger.entries.length - 1; i >= 0; i--) {
    const e = ledger.entries[i]!;
    const { chainHash: _h, ...rest } = e;
    void _h;
    const expected = chainOf(prevHash, rest, secret);
    if (safeHmacNotEqual(expected, e.chainHash)) {
      return { verdict: "BROKEN", reason: `chain hash mismatch at entry ${e.id} (index ${i})`, firstBrokenIndex: i };
    }
    prevHash = e.chainHash;
  }
  return { verdict: "VALID", reason: `verified ${ledger.entries.length} entries` };
}

export function formatLedgerPulseLine(ledger: Ledger): string {
  const b = balanceOf(ledger);
  return `WISDOM-SHARDS · balance=${b.balance} (minted=${b.totalMinted}, burned=${b.totalBurned}) · ${b.entryCount} entries`;
}
