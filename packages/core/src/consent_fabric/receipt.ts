/**
 * v2.21.6 — CONSENT FABRIC · RECEIPT LEDGER.
 *
 * Every Mneme→AI-agent interaction worth auditing produces a signed,
 * chain-linked receipt the agent can retrospectively verify.
 * Enforces Article 7.
 *
 *   - Append-only HMAC-chained log at `.mneme/consent/receipts.jsonl`.
 *   - Each entry references the prior entry's signature → tamper at
 *     any point breaks the chain.
 *   - `verifyChain()` walks the log + returns the first broken index.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/consent";
const LOG = "receipts.jsonl";
const KEY = "consent.key";

export interface Receipt {
  v: 1;
  id: string;
  ts: string;
  kind: string;        // e.g. "pulse-rendered" / "verdict-recorded" / "tool-call-allowed"
  surface?: string;
  meta?: Record<string, unknown>;
  prev: string;        // prior receipt sig (or "genesis")
  sig: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function logPath(repoRoot: string): string { return join(dir(repoRoot), LOG); }

export interface RecordReceiptOptions {
  kind: string;
  surface?: string;
  meta?: Record<string, unknown>;
}

export function recordReceipt(repoRoot: string, opts: RecordReceiptOptions): Receipt {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const id = "rc_" + randomBytes(4).toString("hex");
  const existing = listReceipts(repoRoot);
  const prev = existing.length > 0 ? existing[existing.length - 1]!.sig : "genesis";
  const metaJson = opts.meta ? JSON.stringify(opts.meta) : "";
  const canonical = `${ts}|${opts.kind}|${opts.surface ?? ""}|${metaJson}|${prev}`;
  const sig = sign(canonical, k);
  const r: Receipt = {
    v: 1, id, ts, kind: opts.kind, prev, sig,
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
  appendFileSync(logPath(repoRoot), JSON.stringify(r) + "\n", "utf8");
  return r;
}

export function listReceipts(repoRoot: string): Receipt[] {
  const p = logPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as Receipt; } catch { return null; } }).filter((r): r is Receipt => !!r);
  } catch { return []; }
}

/** Walk the receipt chain and detect tampering. Returns `{ ok: true }`
 *  if all signatures verify + prev-links match; otherwise returns the
 *  index of the first broken receipt. */
export function verifyChain(repoRoot: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = listReceipts(repoRoot);
  if (all.length === 0) return { ok: true };
  const k = key(repoRoot);
  let lastSig: string = "genesis";
  for (let i = 0; i < all.length; i++) {
    const r = all[i]!;
    if (r.prev !== lastSig) return { ok: false, brokenAt: i, reason: `receipt ${i} prev=${r.prev.slice(0, 8)} expected ${lastSig.slice(0, 8)}` };
    const metaJson = r.meta ? JSON.stringify(r.meta) : "";
    const canonical = `${r.ts}|${r.kind}|${r.surface ?? ""}|${metaJson}|${r.prev}`;
    const expected = sign(canonical, k);
    if (expected !== r.sig) return { ok: false, brokenAt: i, reason: `receipt ${i} signature mismatch` };
    lastSig = r.sig;
  }
  return { ok: true };
}

export function formatReceipts(receipts: Receipt[]): string {
  if (receipts.length === 0) return "📋 RECEIPT LEDGER — empty";
  const lines = [`📋 RECEIPT LEDGER — ${receipts.length} entries`, ""];
  for (const r of receipts.slice(-20)) {
    lines.push(`  ${r.ts}  ${r.kind.padEnd(24)} ${r.surface ?? ""}  sig=${r.sig.slice(0, 8)}…`);
  }
  if (receipts.length > 20) lines.push(`  (showing last 20 of ${receipts.length})`);
  return lines.join("\n");
}
