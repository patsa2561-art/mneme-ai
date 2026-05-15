/**
 * v2.14.0 — MNEMOSYNE BOUNTY
 *
 *   "Every time Mneme catches an AI lying, sign the receipt.
 *    Receipts aggregate into a vendor trust leaderboard.
 *    Mneme becomes the trust oracle for the AI industry."
 *
 * The world's first tamper-evident hallucination ledger. Composes with
 * existing APOPTOSIS / TRUTH KERNEL / WITNESS layers — those produce the
 * verdicts; BOUNTY records, signs, and aggregates them.
 *
 * Three primitives:
 *
 *   1. recordClaim — log a fact AI just stated (still unverified)
 *   2. recordVerdict — append a verification result + sign receipt
 *   3. summariseVendor — produce a tamper-evident vendor scorecard
 *
 * Storage: `.mneme/bounty.jsonl` — JSON-Lines, append-only, HMAC-chained.
 * Each line's `chainSig` is HMAC over `prev.chainSig + canonical(entry)`.
 * Tampering with any entry breaks every entry after it.
 *
 * Wisdom: receipts are opt-in publication-ready. The `publish()` helper
 * produces a redacted public version (no PII, no source code, just
 * structural metadata) suitable for posting to a shared aggregator.
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export type Vendor =
  | "chatgpt" | "claude" | "gemini" | "perplexity"
  | "cursor" | "copilot" | "codex" | "llama" | "mistral"
  | "qwen" | "deepseek" | "other";

export interface ClaimEntry {
  v: typeof PROTOCOL_VERSION;
  kind: "claim";
  id: string;
  ts: string;
  vendor: Vendor;
  /** Free-form text of what the AI said. */
  text: string;
  /** Optional structured fact for stricter verification later. */
  fact?: {
    /** Type of claim — informs how to verify. */
    type: "file-exists" | "symbol-exists" | "package-version" | "url-reachable" | "command-output" | "other";
    /** Subject of the claim (e.g., file path, symbol name). */
    subject: string;
    /** Expected value if applicable. */
    expected?: string;
  };
  /** Reference to the conversation / session this came from (optional). */
  session?: string;
  /** Chain signature: HMAC(prev.chainSig + canonical(this)). */
  chainSig: string;
}

export interface VerdictEntry {
  v: typeof PROTOCOL_VERSION;
  kind: "verdict";
  id: string;
  /** ID of the claim this verifies. */
  claimId: string;
  ts: string;
  vendor: Vendor;
  /** Outcome of verification. */
  verdict: "true" | "false" | "partial" | "inconclusive";
  /** Free-form explanation (kept short — 200 char cap on publish). */
  reason: string;
  /** Optional witness — sha256 of evidence file/output, or a URL. */
  evidence?: string;
  chainSig: string;
}

export type BountyEntry = ClaimEntry | VerdictEntry;

export interface VendorScorecard {
  vendor: Vendor;
  totalClaims: number;
  totalVerdicts: number;
  trueCount: number;
  falseCount: number;
  partialCount: number;
  inconclusiveCount: number;
  /** false / (true + false). Higher = worse vendor. */
  falseRate: number;
  /** Wilson lower bound on falseRate (95%) — robust for small samples. */
  falseRateLB: number;
  /** Generated ISO timestamp. */
  generatedAt: string;
  /** Signed for tamper-evident leaderboard publication. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_BOUNTY_SECRET"] || `mneme-bounty-default-v${PROTOCOL_VERSION}`;
}

function bountyPath(repoDir?: string): string {
  const root = repoDir ? (isAbsolute(repoDir) ? repoDir : resolve(repoDir)) : process.cwd();
  const dir = join(root, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "bounty.jsonl");
}

function readAll(path: string): BountyEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: BountyEntry[] = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as BountyEntry); }
    catch { /* skip malformed line, continue */ }
  }
  return out;
}

function lastChainSig(entries: BountyEntry[]): string {
  return entries.length === 0 ? "" : entries[entries.length - 1]!.chainSig;
}

function chainSig(prev: string, entryWithoutSig: object, secret: string): string {
  return createHmac("sha256", secret).update(prev + canon(entryWithoutSig)).digest("hex");
}

export interface RecordClaimInput {
  vendor: Vendor;
  text: string;
  fact?: ClaimEntry["fact"];
  session?: string;
  repoDir?: string;
  secret?: string;
}

export function recordClaim(input: RecordClaimInput): ClaimEntry {
  const path = bountyPath(input.repoDir);
  const prev = lastChainSig(readAll(path));
  const noSig: Omit<ClaimEntry, "chainSig"> = {
    v: PROTOCOL_VERSION,
    kind: "claim",
    id: "c-" + randomBytes(6).toString("hex"),
    ts: new Date().toISOString(),
    vendor: input.vendor,
    text: input.text.slice(0, 1000),
    ...(input.fact ? { fact: input.fact } : {}),
    ...(input.session ? { session: input.session } : {}),
  };
  const entry: ClaimEntry = { ...noSig, chainSig: chainSig(prev, noSig, input.secret ?? defaultSecret()) };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  return entry;
}

export interface RecordVerdictInput {
  claimId: string;
  vendor: Vendor;
  verdict: VerdictEntry["verdict"];
  reason: string;
  evidence?: string;
  repoDir?: string;
  secret?: string;
}

export function recordVerdict(input: RecordVerdictInput): VerdictEntry {
  const path = bountyPath(input.repoDir);
  const entries = readAll(path);
  const prev = lastChainSig(entries);
  const noSig: Omit<VerdictEntry, "chainSig"> = {
    v: PROTOCOL_VERSION,
    kind: "verdict",
    id: "v-" + randomBytes(6).toString("hex"),
    claimId: input.claimId,
    ts: new Date().toISOString(),
    vendor: input.vendor,
    verdict: input.verdict,
    reason: input.reason.slice(0, 500),
    ...(input.evidence ? { evidence: input.evidence.slice(0, 200) } : {}),
  };
  const entry: VerdictEntry = { ...noSig, chainSig: chainSig(prev, noSig, input.secret ?? defaultSecret()) };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  return entry;
}

/** Verify the entire HMAC chain. Returns the first broken index, or -1 if clean. */
export function verifyChain(opts: { repoDir?: string; secret?: string } = {}): {
  ok: boolean;
  total: number;
  brokenIndex: number;
  brokenReason?: string;
} {
  const path = bountyPath(opts.repoDir);
  const entries = readAll(path);
  const secret = opts.secret ?? defaultSecret();
  let prev = "";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const { chainSig: claimed, ...rest } = e as unknown as Record<string, unknown> & { chainSig: string };
    const expected = chainSig(prev, rest, secret);
    if (expected !== claimed) {
      return { ok: false, total: entries.length, brokenIndex: i, brokenReason: `chainSig mismatch at entry ${i}` };
    }
    prev = claimed;
  }
  return { ok: true, total: entries.length, brokenIndex: -1 };
}

/** Wilson lower bound at 95% — robust scoring for small samples. */
function wilsonLowerBound(positive: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = positive / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

/** Compute per-vendor scorecard from the ledger. Signed for publication. */
export function summariseVendor(vendor: Vendor, opts: { repoDir?: string; secret?: string } = {}): VendorScorecard {
  const entries = readAll(bountyPath(opts.repoDir));
  const claims = entries.filter((e) => e.kind === "claim" && e.vendor === vendor) as ClaimEntry[];
  const verdicts = entries.filter((e) => e.kind === "verdict" && e.vendor === vendor) as VerdictEntry[];
  const t = verdicts.filter((v) => v.verdict === "true").length;
  const f = verdicts.filter((v) => v.verdict === "false").length;
  const p = verdicts.filter((v) => v.verdict === "partial").length;
  const inc = verdicts.filter((v) => v.verdict === "inconclusive").length;
  const denom = t + f;
  const falseRate = denom === 0 ? 0 : f / denom;
  const falseRateLB = wilsonLowerBound(f, denom);
  const generatedAt = new Date().toISOString();
  const body = { vendor, totalClaims: claims.length, totalVerdicts: verdicts.length, trueCount: t, falseCount: f, partialCount: p, inconclusiveCount: inc, falseRate, falseRateLB, generatedAt };
  const sig = createHmac("sha256", opts.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/** All vendors observed in the ledger. */
export function listVendors(opts: { repoDir?: string } = {}): Vendor[] {
  const entries = readAll(bountyPath(opts.repoDir));
  const seen = new Set<Vendor>();
  for (const e of entries) seen.add(e.vendor);
  return Array.from(seen);
}

/** Full leaderboard — every observed vendor sorted by falseRateLB (worst first). */
export function leaderboard(opts: { repoDir?: string; secret?: string } = {}): VendorScorecard[] {
  return listVendors(opts).map((v) => summariseVendor(v, opts))
    .sort((a, b) => b.falseRateLB - a.falseRateLB);
}

/** Redacted public version of a scorecard suitable for shared aggregator. */
export function publish(card: VendorScorecard): {
  v: typeof PROTOCOL_VERSION;
  vendor: Vendor;
  falseRate: number;
  falseRateLB: number;
  totalVerdicts: number;
  generatedAt: string;
  sig: string;
} {
  return {
    v: PROTOCOL_VERSION,
    vendor: card.vendor,
    falseRate: Math.round(card.falseRate * 10000) / 10000,
    falseRateLB: Math.round(card.falseRateLB * 10000) / 10000,
    totalVerdicts: card.totalVerdicts,
    generatedAt: card.generatedAt,
    sig: card.sig,
  };
}

/** One-line pulse summary. */
export function formatBountyLine(opts: { repoDir?: string } = {}): string {
  const entries = readAll(bountyPath(opts.repoDir));
  const claims = entries.filter((e) => e.kind === "claim").length;
  const verdicts = entries.filter((e) => e.kind === "verdict").length;
  const falses = (entries.filter((e) => e.kind === "verdict") as VerdictEntry[]).filter((v) => v.verdict === "false").length;
  return `BOUNTY · ${claims} claims · ${verdicts} verdicts · ${falses} caught`;
}
