/**
 * 🦠 PROTOPLASM — findings_ledger
 *
 * HMAC-chained append-only log of super_quan findings.
 * Same canonical-JSON pattern as PASSPORT/MIRRAGE/TIME-CRYSTAL/REFLOG ledgers.
 */

import { createHmac } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SuperQuanFinding } from "./types.js";

/** Canonical JSON: deterministic key sort + undefined removed. */
export function canonicalJson(obj: unknown): string {
  const seen = new WeakSet<object>();
  const visit = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(visit);
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) sorted[k] = visit(val);
    }
    return sorted;
  };
  return JSON.stringify(visit(obj));
}

export function chainHmac(prevHmac: string, finding: Omit<SuperQuanFinding, "hmac" | "prev">, secret: string): string {
  return createHmac("sha256", secret).update(prevHmac + "::" + canonicalJson(finding)).digest("hex").slice(0, 16);
}

export function appendFinding(
  ledgerPath: string,
  finding: Omit<SuperQuanFinding, "hmac" | "prev">,
  secret: string,
): SuperQuanFinding {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const prev = lastHmac(ledgerPath);
  const hmac = chainHmac(prev, finding, secret);
  const full: SuperQuanFinding = { ...finding, prev, hmac };
  appendFileSync(ledgerPath, JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function lastHmac(ledgerPath: string): string {
  if (!existsSync(ledgerPath)) return "0".repeat(16);
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "0".repeat(16);
  try { return (JSON.parse(lines[lines.length - 1]) as SuperQuanFinding).hmac; } catch { return "0".repeat(16); }
}

export function readLedger(ledgerPath: string): SuperQuanFinding[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l) as SuperQuanFinding; } catch { return null; }
  }).filter((x): x is SuperQuanFinding => x !== null);
}

export function verifyChain(ledgerPath: string, secret: string): { ok: boolean; brokenAt?: number; rows: number } {
  const rows = readLedger(ledgerPath);
  let prev = "0".repeat(16);
  for (let i = 0; i < rows.length; i++) {
    const { hmac, prev: storedPrev, ...rest } = rows[i];
    if (storedPrev !== prev) return { ok: false, brokenAt: i, rows: rows.length };
    const recomputed = chainHmac(prev, rest, secret);
    if (recomputed !== hmac) return { ok: false, brokenAt: i, rows: rows.length };
    prev = hmac;
  }
  return { ok: true, rows: rows.length };
}
