/**
 * v1.62.0 -- TIER 6: RECURSIVE SOUL.
 *
 * Each AI session reviews the prior session's behavior. The current
 * claude-opus-4-7 reads what claude-opus-4-6 did, evaluates it, and
 * marks specific entries as "endorsed" / "disputed" / "corrected".
 * Cross-vendor + cross-version accountability without a server.
 *
 * Storage:
 *   .mneme/ai-souls/<vendor>.json          (already exists from v1.42)
 *   .mneme/recursive-soul/reviews.jsonl    (NEW -- meta-review chain)
 *
 * Each review is HMAC-signed by the reviewer's session id so reviews
 * are tamper-evident + auditable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac, createHash, randomBytes } from "node:crypto";

const SOULS_DIR = ".mneme/ai-souls";
const REVIEWS_DIR = ".mneme/recursive-soul";
const REVIEWS_FILE = "reviews.jsonl";

interface SoulSessionEntry {
  id?: string;
  ts?: string;
  vendor?: string;
  kept?: number;
  broken?: number;
  reason?: string;
}

interface SoulFile {
  sessions?: SoulSessionEntry[];
}

export type ReviewVerdict = "endorsed" | "disputed" | "corrected";

export interface Review {
  /** Stable id of this review. */
  id: string;
  /** Who is reviewing (current vendor). */
  reviewer: string;
  /** Whose session is being reviewed (target vendor + session id). */
  reviewedVendor: string;
  reviewedSessionId: string;
  ts: string;
  verdict: ReviewVerdict;
  /** Short rationale, surfaced in the pulse template. */
  rationale: string;
  /** When verdict === "corrected", the corrected interpretation. */
  correction?: string;
  /** Signed by the reviewer's own machine. */
  hmac: string;
}

function secretPath(repoRoot: string): string {
  return join(repoRoot, REVIEWS_DIR, ".secret");
}
function loadOrCreateSecret(repoRoot: string): string {
  const dir = join(repoRoot, REVIEWS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = secretPath(repoRoot);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(p, s, "utf8");
  return s;
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function signReview(repoRoot: string, body: Omit<Review, "hmac">): string {
  const secret = loadOrCreateSecret(repoRoot);
  return createHmac("sha256", secret).update(canonicalize(body)).digest("hex").slice(0, 32);
}

/** List the sessions of OTHER vendors available to review. */
export function listReviewableSessions(repoRoot: string, currentVendor: string): Array<{ vendor: string; sessionId: string; ts: string; reason?: string }> {
  const dir = join(repoRoot, SOULS_DIR);
  if (!existsSync(dir)) return [];
  const out: Array<{ vendor: string; sessionId: string; ts: string; reason?: string }> = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const vendor = f.replace(/\.json$/, "");
      if (vendor === currentVendor) continue; // skip self
      let body: SoulFile;
      try { body = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
      for (const s of body.sessions ?? []) {
        out.push({
          vendor,
          sessionId: s.id ?? "?",
          ts: s.ts ?? "?",
          reason: s.reason,
        });
      }
    }
  } catch { /* */ }
  return out;
}

/** Submit a review for another session. */
export function submitReview(
  repoRoot: string,
  reviewer: string,
  target: { vendor: string; sessionId: string },
  verdict: ReviewVerdict,
  rationale: string,
  correction?: string,
): Review {
  const ts = new Date().toISOString();
  const id = createHash("sha256").update(`${reviewer}|${target.vendor}|${target.sessionId}|${ts}|${randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16);
  const draft: Omit<Review, "hmac"> = {
    id, reviewer,
    reviewedVendor: target.vendor,
    reviewedSessionId: target.sessionId,
    ts, verdict, rationale, ...(correction !== undefined ? { correction } : {}),
  };
  const hmac = signReview(repoRoot, draft);
  const review: Review = { ...draft, hmac };
  const dir = join(repoRoot, REVIEWS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, REVIEWS_FILE), JSON.stringify(review) + "\n", "utf8");
  return review;
}

/** Read all reviews. */
export function readReviews(repoRoot: string): Review[] {
  const p = join(repoRoot, REVIEWS_DIR, REVIEWS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Review; } catch { return null; }
    }).filter((x): x is Review => x !== null);
  } catch { return []; }
}

/** Verify a review's HMAC matches its body. */
export function verifyReview(repoRoot: string, review: Review): { ok: boolean; reason: string } {
  const { hmac, ...rest } = review;
  const expected = signReview(repoRoot, rest);
  return expected === hmac
    ? { ok: true, reason: "HMAC valid" }
    : { ok: false, reason: `HMAC mismatch (expected ${expected.slice(0, 8)}...)` };
}

/** Aggregate stats across reviews. */
export interface ReviewAggregate {
  totalReviews: number;
  byVerdict: Record<ReviewVerdict, number>;
  byReviewer: Record<string, number>;
  byReviewedVendor: Record<string, { endorsed: number; disputed: number; corrected: number }>;
}

export function aggregateReviews(repoRoot: string): ReviewAggregate {
  const reviews = readReviews(repoRoot);
  const agg: ReviewAggregate = {
    totalReviews: reviews.length,
    byVerdict: { endorsed: 0, disputed: 0, corrected: 0 },
    byReviewer: {},
    byReviewedVendor: {},
  };
  for (const r of reviews) {
    agg.byVerdict[r.verdict] += 1;
    agg.byReviewer[r.reviewer] = (agg.byReviewer[r.reviewer] ?? 0) + 1;
    if (!agg.byReviewedVendor[r.reviewedVendor]) {
      agg.byReviewedVendor[r.reviewedVendor] = { endorsed: 0, disputed: 0, corrected: 0 };
    }
    agg.byReviewedVendor[r.reviewedVendor]![r.verdict] += 1;
  }
  return agg;
}
