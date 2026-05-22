/**
 * v2.23.1 — MCP-CANDOR · AUDIT LEDGER.
 *
 * Diamond #3 from the v2.22.3 audit: the HMAC-chained receipt ledger
 * gets a public protocol form. Anyone can append a record + receive
 * a tamper-evident receipt; chain integrity is verifiable by any
 * downstream consumer.
 *
 * Mneme's mission_recorder is the BASIS; this module is the spec
 * wrapper that strips Mneme-internal fields (causedBy DAG, Lamport
 * counter) and exposes a minimal, portable format any
 * CANDOR-compliant server can implement.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { SPEC_NAME, type AuditRecord, type AuditReceipt } from "./spec.js";

const DIR = ".mneme/candor";
const FILE = "audit.jsonl";
const KEY_FILE = "candor.key";

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function filePath(repoRoot: string): string { return join(dir(repoRoot), FILE); }

export interface AppendOptions {
  kind: string;
  surface?: string;
  meta?: Record<string, unknown>;
}

export function appendAudit(repoRoot: string, opts: AppendOptions): AuditReceipt {
  const k = key(repoRoot);
  const ts = new Date().toISOString();
  const all = listAudits(repoRoot);
  const prev = all.length > 0 ? all[all.length - 1]!.sig : "genesis";
  const record: AuditRecord = { kind: opts.kind, ts, prev, ...(opts.surface ? { surface: opts.surface } : {}), ...(opts.meta ? { meta: opts.meta } : {}) };
  const metaJson = record.meta ? JSON.stringify(record.meta) : "";
  const canonical = `${record.ts}|${record.kind}|${record.surface ?? ""}|${metaJson}|${record.prev}`;
  const sig = sign(canonical, k);
  const id = "ar_" + randomBytes(4).toString("hex");
  const receipt: AuditReceipt = { id, record, sig, spec: SPEC_NAME };
  appendFileSync(filePath(repoRoot), JSON.stringify(receipt) + "\n", "utf8");
  return receipt;
}

export function listAudits(repoRoot: string): AuditReceipt[] {
  const p = filePath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as AuditReceipt; } catch { return null; } }).filter((r): r is AuditReceipt => !!r);
  } catch { return []; }
}

export function verifyAuditChain(repoRoot: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = listAudits(repoRoot);
  if (all.length === 0) return { ok: true };
  const k = key(repoRoot);
  let lastSig = "genesis";
  for (let i = 0; i < all.length; i++) {
    const r = all[i]!;
    if (r.record.prev !== lastSig) return { ok: false, brokenAt: i, reason: `record ${i} prev=${r.record.prev.slice(0, 8)} expected ${lastSig.slice(0, 8)}` };
    const metaJson = r.record.meta ? JSON.stringify(r.record.meta) : "";
    const canonical = `${r.record.ts}|${r.record.kind}|${r.record.surface ?? ""}|${metaJson}|${r.record.prev}`;
    if (sign(canonical, k) !== r.sig) return { ok: false, brokenAt: i, reason: `record ${i} signature mismatch` };
    lastSig = r.sig;
  }
  return { ok: true };
}

export function formatAudits(receipts: AuditReceipt[]): string {
  if (receipts.length === 0) return `📜 ${SPEC_NAME} AUDIT LEDGER — empty`;
  const lines = [`📜 ${SPEC_NAME} AUDIT LEDGER — ${receipts.length} entries`, ""];
  for (const r of receipts.slice(-20)) {
    lines.push(`  ${r.record.ts}  ${r.record.kind.padEnd(24)} ${r.record.surface ?? ""}  sig=${r.sig.slice(0, 12)}…`);
  }
  if (receipts.length > 20) lines.push(`  (showing last 20 of ${receipts.length})`);
  return lines.join("\n");
}
