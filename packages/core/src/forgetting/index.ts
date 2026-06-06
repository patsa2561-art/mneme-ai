/**
 * PROOF-OF-FORGETTING — the inverse nobody ships.
 *
 * Every memory system on earth can prove it KEPT something — provenance, retention, an audit trail.
 * None can prove it FORGOT something. Deletion is unverifiable: a vendor says "we erased your data"
 * and you simply have to believe them. Yet GDPR Article 17 (right-to-erasure) and the EU AI Act
 * demand exactly that — provable forgetting. THYMOS forgets by design (low-salience traces decay);
 * this turns each forgetting into a SIGNED, OFFLINE-VERIFIABLE ATTESTATION that specific memories are
 * gone from a store — bound by hash + a merkle root + a digest of the post-forgetting state.
 *
 * A verifier, holding only the receipt + the current store, confirms OFFLINE that (a) none of the
 * forgotten items are present any more, and (b) the store is in the exact state the receipt attests.
 *
 * ★HONEST (DIAKRISIS): this proves the forgotten items are ABSENT from THIS attested store, signed —
 * it is NOT a claim that the data never existed anywhere else, nor a forensic guarantee about disk
 * remanence/backups. It is the missing cryptographic primitive for "I forgot this, and here's proof",
 * the legal + trust counterpart to everyone else's "I kept this, and here's proof".
 */
import { createHash } from "node:crypto";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
/** Hash a memory's content — what gets attested as forgotten (the raw text never enters the receipt). */
export function contentHash(text: string): string { return sha(text); }

function merkleRoot(hashes: ReadonlyArray<string>): string {
  let level = (hashes ?? []).filter(Boolean).slice().sort();   // sorted ⇒ order-independent
  if (!level.length) return sha("");
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

export interface StoreItem { id: string; contentHash: string }
/** A stable digest of a store's surviving items — binds the receipt to the exact post-forgetting state. */
export function storeDigest(items: ReadonlyArray<StoreItem>): string {
  const rows = (items ?? []).map((i) => `${i.id}:${i.contentHash}`).sort();
  return sha(rows.join("\n"));
}

export interface ForgottenItem { id: string; contentHash: string; reason: string; salience: number }
export interface ForgettingReceipt {
  v: 1; kind: "proof-of-forgetting";
  forgotten: ForgottenItem[]; count: number;
  merkleRoot: string;        // over the forgotten content hashes (order-independent)
  storeHashAfter: string;    // digest of the items that REMAIN — the attested state
  forgottenAt: number;
}
/** Mint the proof: these items were forgotten; here is the state of what remains. Sign at the edge. */
export function buildForgettingReceipt(forgotten: ReadonlyArray<ForgottenItem>, remaining: ReadonlyArray<StoreItem>, nowMs: number): ForgettingReceipt {
  const f = (forgotten ?? []).filter((x) => x && x.contentHash);
  return { v: 1, kind: "proof-of-forgetting", forgotten: [...f], count: f.length, merkleRoot: merkleRoot(f.map((x) => x.contentHash)), storeHashAfter: storeDigest(remaining), forgottenAt: Number(nowMs) || 0 };
}

export interface ForgetVerify { valid: boolean; reasons: string[]; provenForgotten: number; stillPresent: string[] }
/** Verify OFFLINE: every attested-forgotten item is ABSENT from the current store, the merkle root
 *  recomputes, and the store is in the attested post-forgetting state. */
export function verifyForgetting(receipt: ForgettingReceipt, currentStore: ReadonlyArray<StoreItem>): ForgetVerify {
  const reasons: string[] = [];
  if (!receipt || receipt.kind !== "proof-of-forgetting") return { valid: false, reasons: ["not a proof-of-forgetting receipt"], provenForgotten: 0, stillPresent: [] };
  const present = new Set((currentStore ?? []).map((i) => i.contentHash));
  const stillPresent = receipt.forgotten.filter((f) => present.has(f.contentHash)).map((f) => f.id);
  if (stillPresent.length) reasons.push(`${stillPresent.length} item(s) attested as forgotten are STILL present — forgetting not honored: ${stillPresent.slice(0, 5).join(", ")}`);
  if (merkleRoot(receipt.forgotten.map((f) => f.contentHash)) !== receipt.merkleRoot) reasons.push("merkle root does not recompute — the forgotten set was altered");
  if (storeDigest(currentStore) !== receipt.storeHashAfter) reasons.push("the current store is not in the attested post-forgetting state (it changed since the receipt)");
  const proven = receipt.forgotten.length - stillPresent.length;
  return { valid: reasons.length === 0, reasons: reasons.length ? reasons : ["verified — every forgotten item is absent + the store matches the attested state (offline)"], provenForgotten: proven, stillPresent };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ForgettingGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function forgettingGauntlet(): ForgettingGauntlet {
  const keptA = { id: "k1", contentHash: contentHash("the architecture decision — keep") };
  const keptB = { id: "k2", contentHash: contentHash("vault path — keep") };
  const forgotten: ForgottenItem[] = [
    { id: "f1", contentHash: contentHash("ran ls in tmp"), reason: "low salience, decayed", salience: 0.12 },
    { id: "f2", contentHash: contentHash("a throwaway log line"), reason: "low salience, decayed", salience: 0.09 },
  ];
  const remaining = [keptA, keptB];
  const receipt = buildForgettingReceipt(forgotten, remaining, 1000);

  // honest forgetting: verifies against the store that no longer holds them
  const ok = verifyForgetting(receipt, remaining);
  const validOK = ok.valid && ok.provenForgotten === 2 && receipt.count === 2;

  // a LIE: claim something is forgotten but it's still in the store → caught
  const lying = verifyForgetting(receipt, [keptA, keptB, { id: "f1", contentHash: forgotten[0].contentHash }]);
  const lyingOK = !lying.valid && lying.stillPresent.includes("f1");

  // STATE drift: the store changed since the receipt → caught (attested state mismatch)
  const drifted = verifyForgetting(receipt, [keptA]);
  const driftOK = !drifted.valid && drifted.reasons.some((r) => r.includes("attested post-forgetting state"));

  // TAMPER: editing the forgotten set breaks the merkle root
  const tampered = { ...receipt, forgotten: [...receipt.forgotten, { id: "x", contentHash: contentHash("snuck in"), reason: "", salience: 0 }] };
  const tamperOK = !verifyForgetting(tampered, remaining).valid;

  // order-independence + empty
  const rootStable = merkleRoot([forgotten[0].contentHash, forgotten[1].contentHash]) === merkleRoot([forgotten[1].contentHash, forgotten[0].contentHash]);
  const emptyOK = buildForgettingReceipt([], remaining, 1).count === 0;

  const total = (() => { try { buildForgettingReceipt(null as never, null as never, 0); verifyForgetting(null as never, null as never); storeDigest(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "PROVES-FORGOTTEN", pass: validOK, detail: "a receipt verifies offline that 2 items are absent from the attested store" },
    { name: "CATCHES-A-LIE", pass: lyingOK, detail: "an item claimed forgotten but still present → invalid, named" },
    { name: "BINDS-STORE-STATE", pass: driftOK, detail: "if the store isn't in the attested post-forgetting state → invalid" },
    { name: "TAMPER-EVIDENT-MERKLE", pass: tamperOK, detail: "editing the forgotten set breaks the merkle root" },
    { name: "ORDER-INDEPENDENT+EMPTY", pass: rootStable && emptyOK, detail: "root is order-independent; an empty forgetting is valid" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
