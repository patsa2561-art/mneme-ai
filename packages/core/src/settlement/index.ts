/**
 * v2.129.0 — CONTEXT TRANSACTION SETTLEMENT LEDGER (the honest "Stripe of AI
 * Context / Global Settlement Layer / Context Transaction Fee" from the image).
 *
 * The image's "SVE" box — "the AI never sees raw logic and is forced to obey the
 * local compile" — is, taken literally, a contradiction (if the AI sees nothing
 * it cannot reason; if a local engine produces the answer you don't need the AI;
 * computing on ciphertext = homomorphic encryption, too slow in 2026). So Mneme
 * does the achievable peak instead: OUTLINE (orient cheap) + BLIND (the model
 * sees blinded names) + CHANNEL (diffs in, local verify, commit once) + EGRESS
 * (secrets removed) — and THIS module is the missing capstone: a signed,
 * hash-chained, OFFLINE-AUDITABLE record of every AI↔local context exchange.
 *
 * Each "context transaction" proves, tamper-evidently:
 *   - what actually crossed the wire was BLINDED (the hash of the blinded form +
 *     how many names/secrets were hidden) — nothing raw leaked;
 *   - what the AI proposed (the op kind);
 *   - that the change was forced through a LOCAL verification gate before commit
 *     ("forced to obey the local result" — the real, honest version);
 *   - the tokens that crossed vs the tokens saved (the metering for a
 *     value-based "Context Transaction Fee").
 *
 * This is the settlement/audit substrate a CISO + a CFO can both verify offline:
 * a Visa-style statement of every context transaction, signed and chained. The
 * "fee" itself is a pricing decision (a % of measured savings), not magic.
 *
 * Pure + total: deterministic, no I/O, no network, never throws. The CLI/MCP add
 * an Ed25519 NOTARY signature over the chain head (the asymmetric, offline-
 * verifiable layer); this module is the deterministic hash-chain + accounting.
 */

import { createHash } from "node:crypto";

export type TxKind = "outline" | "blind" | "channel-op" | "channel-commit" | "verify" | "scaffold" | "egress" | "raw";
export type LocalVerify = "pass" | "fail" | "na";

export interface ContextTx {
  seq: number;
  kind: TxKind;
  /** sha256 of EXACTLY what was sent to the model (the blinded/outlined form) — proof of what crossed. */
  sentHash: string;
  /** identifiers blinded + secrets removed before sending (0 if none). */
  namesHidden: number;
  secretsRemoved: number;
  /** did the AI's resulting change pass a LOCAL verification gate before commit? */
  localVerified: LocalVerify;
  /** ≈tokens that actually crossed the wire this transaction. */
  tokensSent: number;
  /** ≈tokens saved vs the naive full-context baseline this transaction. */
  tokensSaved: number;
  note?: string;
}

export interface LedgerRecord {
  tx: ContextTx;
  prevHash: string;
  /** sha256(prevHash + canonical(tx)) — the tamper-evident chain link. */
  chainHash: string;
}

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
const GENESIS = "0".repeat(64);
const n0 = (x: unknown): number => { const v = typeof x === "number" && isFinite(x) ? x : 0; return v < 0 ? 0 : v; };

/** Normalise a partial tx into a complete, validated ContextTx. Total. */
export function normalizeTx(seq: number, input: Partial<ContextTx>): ContextTx {
  const kinds: TxKind[] = ["outline", "blind", "channel-op", "channel-commit", "verify", "scaffold", "egress", "raw"];
  const kind = kinds.includes(input?.kind as TxKind) ? (input!.kind as TxKind) : "raw";
  const lv: LocalVerify = (["pass", "fail", "na"] as const).includes(input?.localVerified as LocalVerify) ? (input!.localVerified as LocalVerify) : "na";
  // NOTE: never include a key with value `undefined` — JSON.stringify drops it,
  // which would make canon()/chainHash differ before vs after a JSONL round-trip
  // (chain would falsely report tampered). Add `note` only when it's a string.
  const tx: ContextTx = {
    seq: Math.max(0, Math.floor(n0(seq))),
    kind,
    sentHash: typeof input?.sentHash === "string" && input.sentHash ? input.sentHash : sha256(canon(input ?? {})),
    namesHidden: Math.floor(n0(input?.namesHidden)),
    secretsRemoved: Math.floor(n0(input?.secretsRemoved)),
    localVerified: lv,
    tokensSent: Math.floor(n0(input?.tokensSent)),
    tokensSaved: Math.floor(n0(input?.tokensSaved)),
  };
  if (typeof input?.note === "string") tx.note = input.note.slice(0, 200);
  return tx;
}

/** Append a transaction to the chain. prevHash = the previous record's chainHash
 *  (or GENESIS for the first). Deterministic + total. */
export function recordTx(prevHash: string, txInput: Partial<ContextTx>, seq?: number): LedgerRecord {
  try {
    const prev = typeof prevHash === "string" && /^[0-9a-f]{64}$/.test(prevHash) ? prevHash : GENESIS;
    const tx = normalizeTx(seq ?? 0, txInput);
    const chainHash = sha256(prev + canon(tx));
    return { tx, prevHash: prev, chainHash };
  } catch {
    const tx = normalizeTx(0, {}); return { tx, prevHash: GENESIS, chainHash: sha256(GENESIS + canon(tx)) };
  }
}

/** Build a whole chain from a list of tx inputs (assigns seq + links). Total. */
export function buildLedger(txs: ReadonlyArray<Partial<ContextTx>>): LedgerRecord[] {
  const out: LedgerRecord[] = []; let prev = GENESIS;
  for (let i = 0; i < (Array.isArray(txs) ? txs.length : 0); i++) { const r = recordTx(prev, txs[i]!, i + 1); out.push(r); prev = r.chainHash; }
  return out;
}

export interface ChainVerdict { ok: boolean; length: number; firstBrokenSeq: number | null; note: string }
/** Recompute the chain offline and detect tampering at any historical record. Total. */
export function verifyChain(records: ReadonlyArray<LedgerRecord>): ChainVerdict {
  try {
    const list = Array.isArray(records) ? records : [];
    let prev = GENESIS;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      if (r.prevHash !== prev) return { ok: false, length: list.length, firstBrokenSeq: r?.tx?.seq ?? i + 1, note: "prev-link mismatch (record inserted/removed/reordered)" };
      const expect = sha256(prev + canon(r.tx));
      if (expect !== r.chainHash) return { ok: false, length: list.length, firstBrokenSeq: r?.tx?.seq ?? i + 1, note: "chainHash mismatch (a transaction was edited after the fact)" };
      prev = r.chainHash;
    }
    return { ok: true, length: list.length, firstBrokenSeq: null, note: "chain intact — every transaction verifies against its predecessor" };
  } catch { return { ok: false, length: 0, firstBrokenSeq: null, note: "verify error (safe)" }; }
}

export interface SettlementStatement {
  txCount: number;
  totalTokensSent: number;
  totalTokensSaved: number;
  /** USD saved at the caller-supplied vendor price (only if a price was given). */
  usdSaved?: number;
  /** % of transactions whose payload was blinded (≥1 name hidden or secret removed). */
  pctBlinded: number;
  /** % of transactions whose AI change passed a local verification gate (of those that had one). */
  pctLocallyVerified: number;
  /** the fee the org would owe at a chosen rate (value-based; only if feePct given). */
  feeUSD?: number;
  integrity: ChainVerdict;
  note: string;
}

/** A Visa-style statement: totals + the security/verification proofs + integrity.
 *  Deterministic + total. `pricePer1kUSD` and `feePct` (e.g. 0.10 = 10% of savings)
 *  are the USER's numbers — Mneme never invents a price. */
export function settlementStatement(records: ReadonlyArray<LedgerRecord>, opts?: { pricePer1kUSD?: number; feePct?: number }): SettlementStatement {
  try {
    const list = Array.isArray(records) ? records : [];
    let sent = 0, saved = 0, blinded = 0, gated = 0, verified = 0;
    for (const r of list) {
      const tx = r?.tx; if (!tx) continue;
      sent += n0(tx.tokensSent); saved += n0(tx.tokensSaved);
      if (n0(tx.namesHidden) > 0 || n0(tx.secretsRemoved) > 0) blinded++;
      if (tx.localVerified !== "na") { gated++; if (tx.localVerified === "pass") verified++; }
    }
    const round1 = (x: number) => Math.round(x * 10) / 10;
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4; // sub-cent precision for per-token context billing
    const usdSaved = typeof opts?.pricePer1kUSD === "number" ? r4((saved / 1000) * opts.pricePer1kUSD) : undefined;
    const feeUSD = typeof usdSaved === "number" && typeof opts?.feePct === "number" ? r4(usdSaved * Math.max(0, Math.min(1, opts.feePct))) : undefined;
    return {
      txCount: list.length, totalTokensSent: sent, totalTokensSaved: saved, usdSaved,
      pctBlinded: list.length > 0 ? round1((blinded / list.length) * 100) : 0,
      pctLocallyVerified: gated > 0 ? round1((verified / gated) * 100) : 0,
      feeUSD,
      integrity: verifyChain(list),
      note: "a signed, offline-auditable settlement statement: tokens sent vs saved (≈chars/4, labelled), % blinded (nothing raw leaked), % locally-verified (AI changes gated). USD/fee use YOUR rate — not invented.",
    };
  } catch { return { txCount: 0, totalTokensSent: 0, totalTokensSaved: 0, pctBlinded: 0, pctLocallyVerified: 0, integrity: { ok: false, length: 0, firstBrokenSeq: null, note: "error" }, note: "statement error (safe)" }; }
}

export interface SettlementGauntlet {
  chainVerifiesOffline: boolean;   // a clean chain verifies
  tamperLocalized: boolean;        // editing one tx breaks the chain AT that seq
  reorderDetected: boolean;        // swapping two records is caught
  statementSums: boolean;          // totals + %s computed correctly
  feedMatchesUserRate: boolean;    // USD/fee only from supplied rate, exact
  deterministic: boolean;
  stable: boolean;
  cases: number;
  score: number;
}

export function settlementGauntlet(): SettlementGauntlet {
  try {
    const txs: Partial<ContextTx>[] = [
      { kind: "outline", sentHash: sha256("a"), namesHidden: 0, secretsRemoved: 0, localVerified: "na", tokensSent: 290, tokensSaved: 13400 },
      { kind: "blind", sentHash: sha256("b"), namesHidden: 7, secretsRemoved: 1, localVerified: "na", tokensSent: 120, tokensSaved: 0 },
      { kind: "channel-op", sentHash: sha256("c"), namesHidden: 3, secretsRemoved: 0, localVerified: "pass", tokensSent: 40, tokensSaved: 600 },
      { kind: "channel-commit", sentHash: sha256("d"), namesHidden: 0, secretsRemoved: 0, localVerified: "fail", tokensSent: 30, tokensSaved: 500 },
    ];
    const ledger = buildLedger(txs);
    const chainVerifiesOffline = verifyChain(ledger).ok && ledger.length === 4;

    // tamper: edit tx #3's tokensSaved → chain breaks at seq 3
    const tampered = ledger.map((r, i) => i === 2 ? { ...r, tx: { ...r.tx, tokensSaved: 999999 } } : r);
    const tv = verifyChain(tampered);
    const tamperLocalized = !tv.ok && tv.firstBrokenSeq === 3;

    // reorder: swap records 1 and 2 → prev-link mismatch caught
    const reordered = [ledger[1]!, ledger[0]!, ledger[2]!, ledger[3]!];
    const reorderDetected = !verifyChain(reordered).ok;

    const stmt = settlementStatement(ledger, { pricePer1kUSD: 0.003, feePct: 0.10 });
    const statementSums = stmt.txCount === 4 && stmt.totalTokensSaved === 14500 && stmt.totalTokensSent === 480
      && stmt.pctBlinded === 50 && Math.abs(stmt.pctLocallyVerified - 50) < 0.01; // 2 gated, 1 pass

    const expectUsd = Math.round((14500 / 1000) * 0.003 * 1e4) / 1e4;
    const feedMatchesUserRate = stmt.usdSaved === expectUsd && stmt.feeUSD === Math.round(expectUsd * 0.10 * 1e4) / 1e4
      && settlementStatement(ledger).usdSaved === undefined; // no price → no USD invented

    const deterministic = JSON.stringify(buildLedger(txs)) === JSON.stringify(buildLedger(txs));

    let stable = true;
    try { recordTx(null as never, null as never); buildLedger(null as never); verifyChain(null as never); settlementStatement(null as never); normalizeTx(NaN as never, null as never); } catch { stable = false; }

    const perfect = chainVerifiesOffline && tamperLocalized && reorderDetected && statementSums && feedMatchesUserRate && deterministic && stable;
    return { chainVerifiesOffline, tamperLocalized, reorderDetected, statementSums, feedMatchesUserRate, deterministic, stable, cases: 4, score: perfect ? 100 : 0 };
  } catch {
    return { chainVerifiesOffline: false, tamperLocalized: false, reorderDetected: false, statementSums: false, feedMatchesUserRate: false, deterministic: false, stable: false, cases: 0, score: 0 };
  }
}
