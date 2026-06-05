/**
 * COMMIT ATTESTATION — proof-carrying git commits (Diamond 1 of the Accountability
 * Layer). Distinct from the line-level HMAC `provenance` blame: this is COMMIT-level,
 * Ed25519-signed, and verifiable OFFLINE by ANY third party with the public key alone.
 *
 * Every commit an AI agent makes gets a SIGNED, tamper-evident CANON record bound to
 * its sha → `git log` becomes a verifiable audit trail of AI work a reviewer / auditor
 * / regulator checks without trusting anyone.
 *
 * Honest scope: it attests PROVENANCE (which agent · what changed · the deterministic
 * screen that ran · a tamper-evident chain) — NOT "the code is correct" (unprovable).
 * The signed verdict is what was CHECKED (secret-scan clean / flagged).
 *
 * Built on the shipped CANON standard (the record) + NOTARY (the Ed25519 signature) —
 * no new crypto. The caller (CLI/MCP) gathers git facts + owns the chain file.
 */
import { createHash } from "node:crypto";
import { buildRecord, canonicalize, verifyRecord, type AccountabilityRecord } from "../canon/index.js";
import { issueReceipt, verifyReceipt } from "../notary/receipt.js";
import { getIssuerKeyPair } from "../notary/keys.js";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Deterministic facts about one commit (the CALLER gathers these from git). */
export interface CommitFacts {
  sha: string;
  author: string;
  /** detected AI vendor that authored the commit, or "human". */
  agent: string;
  subject: string;
  files: string[];
  /** count of NEW credential patterns introduced by the diff (0 = clean). */
  addedSecrets: number;
  /** sha256 of the unified diff — binds the record to the exact change. */
  diffHash: string;
  /** commit time (ms epoch). */
  ts: number;
}

export interface AttestEntry {
  record: AccountabilityRecord;       // CANON record — binds the payload BY HASH
  receipt: unknown;                   // NotaryReceipt — independently offline-verifiable
  facts: Record<string, unknown>;     // the readable provenance payload (binds to record.payloadHash)
}

/** The deterministic verdict that gets signed. Honest: this is what was CHECKED. */
export function attestVerdict(f: CommitFacts): "clean" | "flagged" {
  return f.addedSecrets > 0 ? "flagged" : "clean";
}

function payloadOf(f: CommitFacts): Record<string, unknown> {
  return {
    author: f.author,
    agent: f.agent,
    subject: String(f.subject).slice(0, 200),
    fileCount: f.files.length,
    files: f.files.slice(0, 64),
    addedSecrets: f.addedSecrets,
    diffHash: f.diffHash,
  };
}

/** Build + SIGN a proof-carrying attestation for one commit. */
export function attestCommit(repoRoot: string, f: CommitFacts, prev: string | null): AttestEntry {
  const facts = payloadOf(f);
  let rec = buildRecord({
    kind: "agent-action",
    subject: `commit:${f.sha}`,
    verdict: attestVerdict(f),
    payload: facts,        // canon stores it as payloadHash (bind-by-hash)
    lineage: prev,
    ts: f.ts,
  });
  // set issuer BEFORE deriving recordId (issuer is part of the signed body, sig is
  // excluded from canonicalize) so the receipt binds the FINAL recordId cleanly.
  const kp = getIssuerKeyPair(repoRoot);
  rec = { ...rec, issuer: kp.publicKeyB64 };
  rec.recordId = sha256(canonicalize(rec));
  const receipt = issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `attest:${f.sha.slice(0, 12)}`,
    payload: { recordId: rec.recordId },
    includePayload: true,
  });
  rec.sig = (receipt as { sig?: string }).sig ?? null;
  return { record: rec, receipt, facts };   // carry the readable payload alongside the hash-bound record
}

export interface EntryVerdict { valid: boolean; reason: string; sha: string; agent: string; verdict: string }

/** Verify ONE entry OFFLINE: canon conformance + recordId binds body + Ed25519 sig +
 *  the receipt commits to THIS record. Total. */
export function verifyAttest(e: AttestEntry): EntryVerdict {
  const rec = (e?.record ?? {}) as AccountabilityRecord;
  const facts = (e?.facts ?? {}) as Record<string, unknown>;
  const sha = String(rec.subject ?? "").replace(/^commit:/, "");
  const agent = String(facts.agent ?? "?");
  const verdict = String(rec.verdict ?? "?");
  const cr = verifyRecord(rec);
  if (!cr.ok) return { valid: false, reason: `canon: ${cr.reason}`, sha, agent, verdict };
  const nr = verifyReceipt(e.receipt);
  if (!nr.valid) return { valid: false, reason: `signature: ${nr.reason}`, sha, agent, verdict };
  const pl = (e.receipt as { payload?: { recordId?: string } }).payload;
  if (!pl || pl.recordId !== rec.recordId) return { valid: false, reason: "receipt does not bind this record (forged/swapped proof)", sha, agent, verdict };
  // the EXPOSED, human-readable facts must hash to the signed payloadHash — so the
  // readable provenance is bound to the signature, not merely attached.
  if (sha256(canonicalize(facts as Partial<AccountabilityRecord>)) !== rec.payloadHash) {
    return { valid: false, reason: "facts do not match the signed payloadHash (tampered provenance)", sha, agent, verdict };
  }
  return { valid: true, reason: "genuine + untampered + Ed25519-signed (verified offline)", sha, agent, verdict };
}

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  valid: number;
  chainIntact: boolean;
  broken: Array<{ sha: string; reason: string }>;
  agents: Record<string, number>;
}

/** Verify the WHOLE attestation chain OFFLINE: every entry valid + lineage unbroken. */
export function verifyAttestChain(entries: AttestEntry[]): ChainVerdict {
  const broken: Array<{ sha: string; reason: string }> = [];
  const agents: Record<string, number> = {};
  let valid = 0, chainIntact = true;
  for (let i = 0; i < entries.length; i++) {
    const v = verifyAttest(entries[i]);
    agents[v.agent] = (agents[v.agent] ?? 0) + 1;
    if (v.valid) valid++; else broken.push({ sha: v.sha, reason: v.reason });
    if (i > 0 && entries[i].record.lineage !== entries[i - 1].record.recordId) {
      chainIntact = false; broken.push({ sha: v.sha, reason: "lineage break — chain reordered or spliced" });
    }
  }
  return { ok: broken.length === 0 && valid === entries.length && chainIntact, checked: entries.length, valid, chainIntact, broken, agents };
}

// ─── gauntlet — MEASURED, not claimed ─────────────────────────────────────────
export interface AttestGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function attestGauntlet(repoRoot: string): AttestGauntlet {
  const facts = (i: number): CommitFacts => ({
    sha: `${"a".repeat(36)}${1000 + i}`, author: "dev@x", agent: i % 2 ? "claude-code" : "human",
    subject: `commit ${i}`, files: [`src/f${i}.ts`], addedSecrets: i === 1 ? 2 : 0, diffHash: sha256(`d${i}`), ts: 1700000000000 + i,
  });
  const chain: AttestEntry[] = [];
  let prev: string | null = null;
  for (let i = 0; i < 3; i++) { const e = attestCommit(repoRoot, facts(i), prev); chain.push(e); prev = e.record.recordId; }

  const cleanChain = verifyAttestChain(chain);
  // tamper the readable facts → must break the payloadHash binding
  const tampered = JSON.parse(JSON.stringify(chain[0])) as AttestEntry;
  (tampered.facts as { author: string }).author = "attacker@evil";
  const tamperCaught = verifyAttest(tampered).valid === false;
  // tamper a signed record field → must break the recordId binding
  const tampered2 = JSON.parse(JSON.stringify(chain[0])) as AttestEntry;
  tampered2.record.verdict = "clean-but-was-flagged";
  const recordTamperCaught = verifyAttest(tampered2).valid === false;
  const swapped = { record: chain[0].record, receipt: chain[2].receipt, facts: chain[0].facts } as AttestEntry;
  const swapCaught = verifyAttest(swapped).valid === false;
  const reorderCaught = verifyAttestChain([chain[0], chain[2], chain[1]]).chainIntact === false;
  const verdictHonest = chain[1].record.verdict === "flagged" && chain[0].record.verdict === "clean";
  const det = JSON.stringify(verifyAttestChain(chain)) === JSON.stringify(verifyAttestChain(chain));

  const checks = [
    { name: "CHAIN-VERIFIES", pass: cleanChain.ok && cleanChain.valid === 3, detail: `clean 3-link chain verifies offline (valid ${cleanChain.valid}/3)` },
    { name: "FACTS-TAMPER-CAUGHT", pass: tamperCaught, detail: "altering the readable facts breaks the signed payloadHash binding" },
    { name: "RECORD-TAMPER-CAUGHT", pass: recordTamperCaught, detail: "altering a signed field breaks the recordId binding" },
    { name: "FORGED-PROOF-CAUGHT", pass: swapCaught, detail: "a swapped/forged signature does not bind the record" },
    { name: "REORDER-CAUGHT", pass: reorderCaught, detail: "reordering/splicing the chain breaks lineage" },
    { name: "VERDICT-HONEST", pass: verdictHonest, detail: "a commit that adds secrets is signed 'flagged', a clean one 'clean'" },
    { name: "DETERMINISTIC", pass: det, detail: "same chain → byte-identical verdict" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
