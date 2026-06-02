/**
 * v2.149.0 — CANON: the Accountability-Record Standard (moat #2 — the "NVD/Visa
 * of AI accountability"). A single, VERSIONED, OFFLINE-VERIFIABLE record format
 * for "an AI did/decided X, here's the proof" that ANY third party — a
 * competitor, an auditor, an insurer, a regulator — can emit and verify with the
 * public key alone, WITHOUT trusting (or running) Mneme.
 *
 * Why a standard is the strongest moat: a model is not a moat (everyone has one);
 * but if the canonical FORMAT auditors/insurers accept is Mneme's, everyone must
 * speak it. CANON is the neutral spec on the Ed25519 NOTARY spine (asymmetric —
 * verifiable offline, no shared secret, unlike the HMAC apostille ledger). It
 * binds the underlying payload by HASH (proves what was decided without exposing
 * it) and chains by lineage (prev → record).
 *
 * DIAKRISIS — the honest ceiling: CANON is a buildable, measurable SUBSTRATE — a
 * versioned schema + a deterministic canonicalizer + an offline conformance/
 * version verifier (+ the Ed25519 signature added at the CLI/MCP boundary). It is
 * NOT, by itself, "the world adopted our standard" — adoption is a market
 * outcome, not a code guarantee. What is proven here: a record is conformant,
 * tamper-evident, version-compatible, and verifiable by anyone — the property a
 * standard NEEDS, measured. Pure + deterministic + total.
 */

import { createHash } from "node:crypto";
function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canonStr(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canonStr).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canonStr((v as Record<string, unknown>)[x])).join(",") + "}"; }

export const CANON_VERSION = "1.0";
export const CANON_KINDS = ["command-gate", "diff", "claim-verdict", "agent-action", "value-event", "siege", "memory-capsule", "other"] as const;
export type CanonKind = typeof CANON_KINDS[number];

export interface AccountabilityRecord {
  canon: string;        // "CANON/1.0" — the spec version
  kind: CanonKind;
  subject: string;      // what the record is about
  verdict: string;      // the decision (ALLOW / BLOCK / PASS / REFUTED / MERGE / …)
  payloadHash: string;  // sha256 of the underlying payload (binds it WITHOUT exposing it)
  issuer: string;       // Ed25519 public key (anyone verifies offline) — set at the boundary
  ts: number;
  lineage: string | null; // prev record id (chain) or null
  recordId: string;     // = sha256(canonicalize-without-sig)
  sig: string | null;   // Ed25519 over recordId — set at the CLI/MCP boundary
}

/** The published, machine-readable spec (what a conformant CANON/1 record needs). */
export const SPEC = {
  version: CANON_VERSION,
  required: ["canon", "kind", "subject", "verdict", "payloadHash", "ts", "recordId"] as const,
  kinds: CANON_KINDS,
  verify: "Ed25519 over recordId, offline, with the embedded issuer public key; no shared secret.",
  versionPolicy: "a verifier of major M accepts records of major M (any minor); rejects a different major with a clear reason.",
};

/** Deterministic canonical string for signing/verifying (field-order independent, excludes sig). Total. */
export function canonicalize(rec: Partial<AccountabilityRecord>): string {
  try { const { sig: _sig, recordId: _rid, ...rest } = (rec ?? {}) as AccountabilityRecord; void _sig; void _rid; return canonStr(rest); } catch { return ""; }
}

/** Build an UNSIGNED canonical record (the CLI/MCP boundary adds issuer + Ed25519 sig). Total. */
export function buildRecord(input: { kind: string; subject: string; verdict: string; payload?: unknown; lineage?: string | null; ts?: number }): AccountabilityRecord {
  const kind = (CANON_KINDS as readonly string[]).includes(String(input?.kind)) ? input!.kind as CanonKind : "other";
  const rec: Omit<AccountabilityRecord, "recordId"> = {
    canon: `CANON/${CANON_VERSION}`,
    kind,
    subject: typeof input?.subject === "string" ? input.subject.slice(0, 200) : "",
    verdict: typeof input?.verdict === "string" ? input.verdict.slice(0, 60) : "",
    payloadHash: sha256(canonStr(input?.payload ?? null)),
    issuer: "",
    ts: Number.isFinite(input?.ts) ? (input!.ts as number) : 0,
    lineage: typeof input?.lineage === "string" ? input.lineage : null,
    sig: null,
  };
  const recordId = sha256(canonicalize(rec as AccountabilityRecord));
  return { ...rec, recordId };
}

export interface ConformanceResult { conformant: boolean; missing: string[]; badVersion: boolean; reason: string }
/** Does a record conform to the CANON spec? (schema + version). Pure + total. */
export function conformanceCheck(rec: unknown, opts?: { expectMajor?: number }): ConformanceResult {
  try {
    const r = (rec ?? {}) as Record<string, unknown>;
    const missing = SPEC.required.filter((f) => r[f] === undefined || r[f] === null || r[f] === "");
    const m = String(r["canon"] ?? "").match(/^CANON\/(\d+)\.(\d+)$/);
    const expectMajor = Number.isFinite(opts?.expectMajor) ? (opts!.expectMajor as number) : Number(CANON_VERSION.split(".")[0]);
    const badVersion = !m || Number(m[1]) !== expectMajor;
    const reason = missing.length ? `missing required field(s): ${missing.join(", ")}` : badVersion ? `incompatible CANON major version (need ${expectMajor}.x, got "${r["canon"]}")` : "conformant CANON record";
    return { conformant: missing.length === 0 && !badVersion, missing, badVersion, reason };
  } catch { return { conformant: false, missing: [...SPEC.required], badVersion: true, reason: "conformance error" }; }
}

export interface VerifyResult { ok: boolean; conformant: boolean; recordIdValid: boolean; reason: string }
/**
 * Offline verification of a record's INTEGRITY + conformance: re-derive recordId
 * from the canonical body (tamper-evident) and check the schema/version. The
 * Ed25519 SIGNATURE itself is verified at the CLI/MCP boundary (with notary);
 * here we prove the body binds to its id. Pure + total.
 */
export function verifyRecord(rec: AccountabilityRecord, opts?: { expectMajor?: number }): VerifyResult {
  try {
    const conf = conformanceCheck(rec, opts);
    const expectedId = sha256(canonicalize(rec));
    const recordIdValid = rec?.recordId === expectedId;
    const ok = conf.conformant && recordIdValid;
    const reason = !conf.conformant ? conf.reason : !recordIdValid ? "recordId mismatch — the record body was altered after issuance (tamper-evident)" : "verified: conformant + body binds to recordId (verify the Ed25519 sig offline with the issuer key)";
    return { ok, conformant: conf.conformant, recordIdValid, reason };
  } catch { return { ok: false, conformant: false, recordIdValid: false, reason: "verify error" }; }
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface CanonGauntlet {
  buildsConformant: boolean;
  canonicalizeDeterministic: boolean;     // field-order independent, sig-excluded
  tamperBreaksRecordId: boolean;          // altering any field invalidates the record
  versionCompatibleAccepts: boolean;      // CANON/1.x accepted by a v1 verifier
  versionMismatchRejected: boolean;       // CANON/2.0 rejected with a clear reason
  missingFieldNamed: boolean;             // a non-conformant record names the missing field
  vendorNeutral: boolean;                 // a record from a DIFFERENT issuer still conforms + verifies
  bindsPayloadByHash: boolean;            // the payload is bound by hash, not exposed
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function canonGauntlet(): CanonGauntlet {
  const rec = buildRecord({ kind: "command-gate", subject: "rm -rf /", verdict: "BLOCK", payload: { risk: "destructive", reachable: ["rm -rf /"] }, ts: 1700000000000 });
  const v = verifyRecord(rec);
  const buildsConformant = v.ok && v.conformant && rec.canon === "CANON/1.0";

  // canonicalize is field-order independent + excludes sig/recordId
  const reordered = { ts: rec.ts, verdict: rec.verdict, kind: rec.kind, subject: rec.subject, canon: rec.canon, payloadHash: rec.payloadHash, issuer: rec.issuer, lineage: rec.lineage, sig: "DIFFERENT", recordId: "DIFFERENT" } as AccountabilityRecord;
  const canonicalizeDeterministic = canonicalize(rec) === canonicalize(reordered);

  const tampered = { ...rec, verdict: "ALLOW" };
  const tamperBreaksRecordId = verifyRecord(tampered).recordIdValid === false && verifyRecord(tampered).ok === false;

  const v1x = verifyRecord({ ...rec, canon: "CANON/1.7", recordId: sha256(canonicalize({ ...rec, canon: "CANON/1.7" })) });
  const versionCompatibleAccepts = v1x.conformant === true;
  const v2 = conformanceCheck({ ...rec, canon: "CANON/2.0" });
  const versionMismatchRejected = v2.conformant === false && v2.badVersion && /major version/i.test(v2.reason);

  const incomplete = conformanceCheck({ canon: "CANON/1.0", kind: "diff", subject: "x", payloadHash: "h", ts: 1, recordId: "r" }); // missing verdict
  const missingFieldNamed = incomplete.conformant === false && incomplete.missing.includes("verdict") && /verdict/.test(incomplete.reason);

  // vendor-neutral: a record an external party built (different issuer) still conforms + binds
  const vendorRec = buildRecord({ kind: "claim-verdict", subject: "external vendor claim", verdict: "REFUTED", payload: { by: "competitorAI" }, ts: 1700000001000 });
  const vendorWithIssuer = { ...vendorRec, issuer: "ed25519:SOMEOTHERVENDORPUBKEY" };
  // adding an issuer changes the body → recordId must be recomputed to stay valid (proves issuer is part of the signed body)
  const vendorFinal = { ...vendorWithIssuer, recordId: sha256(canonicalize(vendorWithIssuer)) };
  const vendorNeutral = verifyRecord(vendorFinal).ok === true && verifyRecord(vendorFinal).conformant === true;

  const bindsPayloadByHash = /^[0-9a-f]{64}$/.test(rec.payloadHash) && !JSON.stringify(rec).includes("reachable"); // raw payload not in the record

  const deterministic = JSON.stringify(buildRecord({ kind: "diff", subject: "s", verdict: "PASS", ts: 1 })) === JSON.stringify(buildRecord({ kind: "diff", subject: "s", verdict: "PASS", ts: 1 }));

  let total = true;
  try {
    buildRecord(null as unknown as { kind: string; subject: string; verdict: string });
    verifyRecord(null as unknown as AccountabilityRecord);
    conformanceCheck(undefined);
    canonicalize(null as unknown as AccountabilityRecord);
  } catch { total = false; }

  const all = buildsConformant && canonicalizeDeterministic && tamperBreaksRecordId && versionCompatibleAccepts && versionMismatchRejected && missingFieldNamed && vendorNeutral && bindsPayloadByHash && deterministic && total;
  return { buildsConformant, canonicalizeDeterministic, tamperBreaksRecordId, versionCompatibleAccepts, versionMismatchRejected, missingFieldNamed, vendorNeutral, bindsPayloadByHash, deterministic, total, score: all ? 100 : 0 };
}
