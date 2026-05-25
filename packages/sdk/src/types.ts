/**
 * @mneme-ai/sdk types — branded types for type-level safety.
 *
 * "Branded" type pattern: a `Brand<T, "tag">` looks like `T` at runtime
 * but the compiler refuses to substitute one tagged value for another.
 * Prevents string-confusion bugs (e.g. passing a vendor slug where a
 * commit ref is expected).
 *
 * Adopted from world-class TS codebases (Effect, fp-ts).
 */

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

/** A SHA-256 hex digest. */
export type HmacHash = Brand<string, "HmacHash">;
/** A vendor slug from the NEMESIS allowlist. */
export type VendorId = Brand<string, "VendorId">;
/** A claim text submitted to the verifier. */
export type ClaimText = Brand<string, "ClaimText">;
/** A git commit ref (short or long). */
export type CommitRef = Brand<string, "CommitRef">;
/** An ISO-8601 timestamp string. */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
/** A NEMESIS session identifier. */
export type SessionId = Brand<string, "SessionId">;
/** A repo-relative path. */
export type RepoPath = Brand<string, "RepoPath">;

// ── Constructors (validating + casting) ─────────────────────────────

export function asHmacHash(s: string): HmacHash {
  if (typeof s !== "string" || !/^[0-9a-f]{64}$/.test(s)) {
    throw new Error(`asHmacHash: not a SHA-256 hex digest: ${String(s).slice(0, 16)}...`);
  }
  return s as HmacHash;
}

export function asVendorId(s: string): VendorId {
  if (typeof s !== "string" || !/^[a-z0-9_-]{1,64}$/.test(s)) {
    throw new Error(`asVendorId: not a valid vendor slug: ${String(s).slice(0, 32)}`);
  }
  return s as VendorId;
}

export function asClaimText(s: string): ClaimText {
  if (typeof s !== "string") throw new Error("asClaimText: not a string");
  return s as ClaimText;
}

export function asCommitRef(s: string): CommitRef {
  if (typeof s !== "string" || !/^[0-9a-f]{7,64}$/.test(s)) {
    throw new Error(`asCommitRef: not a valid commit hash: ${String(s).slice(0, 32)}`);
  }
  return s as CommitRef;
}

export function asIsoTimestamp(s: string | Date): IsoTimestamp {
  const v = s instanceof Date ? s.toISOString() : s;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new Error(`asIsoTimestamp: not parseable: ${String(v).slice(0, 32)}`);
  }
  return v as IsoTimestamp;
}

// ── Shared shapes (Fixture is the input to most NEMESIS primitives) ──

export interface Fixture {
  diff: string;
  prDescription: string;
  commitMessages: string[];
}

/** Verdict ladder produced by ACGV / verify. */
export type Verdict = "IMPOSSIBLE_REFUTE" | "AUTO_REFUTE" | "BLACK_HOLE" | "FUSION" | "LIMBO" | "PASSTHROUGH";

/** Plain envelope every SDK call returns — always includes ok + reason. */
export interface SdkEnvelope<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  /** Latency in milliseconds (in-process). */
  latencyMs?: number;
}
