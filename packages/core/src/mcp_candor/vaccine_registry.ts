/**
 * v2.23.1 — MCP-CANDOR · VACCINE REGISTRY.
 *
 * Diamond #2 from the v2.22.3 audit: the vaccine cache (known-lie
 * patterns refuted in 0ms) becomes a public, federation-ready
 * registry. Mneme exposes its registry; other CANDOR-compliant
 * servers expose theirs; anyone can pull / contribute.
 *
 * Think CVE database, but for AI hallucination signatures.
 *
 * Format is intentionally minimal so non-Mneme implementations can
 * adopt it without dragging in Mneme-specific types.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { SPEC_NAME, type VaccineEntry } from "./spec.js";

const DIR = ".mneme/candor";
const FILE = "vaccines.jsonl";
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

export interface ContributeOptions {
  type: VaccineEntry["type"];
  signature: string;
  description: string;
  signedBy: string;
}

export function contributeVaccine(repoRoot: string, opts: ContributeOptions): VaccineEntry {
  const k = key(repoRoot);
  const observedAt = new Date().toISOString();
  // Derive the id from the signature so identical signatures don't
  // create duplicate entries across servers.
  const id = "vc_" + createHmac("sha256", "candor-vaccine-id").update(opts.signature).digest("base64url").slice(0, 16);
  const canonical = `${id}|${opts.type}|${opts.signature}|${opts.signedBy}|${observedAt}`;
  const sig = sign(canonical, k);
  const entry: VaccineEntry = {
    id, type: opts.type, signature: opts.signature, description: opts.description,
    signedBy: opts.signedBy, observedAt, sig,
  };
  // Deduplicate by id — if already present, skip the append.
  const all = listVaccines(repoRoot);
  if (!all.find((e) => e.id === entry.id)) {
    appendFileSync(filePath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
  }
  return entry;
}

export function listVaccines(repoRoot: string): VaccineEntry[] {
  const p = filePath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as VaccineEntry; } catch { return null; } }).filter((e): e is VaccineEntry => !!e);
  } catch { return []; }
}

export function findVaccine(repoRoot: string, id: string): VaccineEntry | null {
  return listVaccines(repoRoot).find((e) => e.id === id) ?? null;
}

/** Pull a foreign registry (JSON array) into the local registry.
 *  Dedups by id. Returns the count of newly-imported entries. The
 *  caller is responsible for trust-gating WHICH foreign registry to
 *  pull from (Mneme suggests gating on a Trust Capsule URI match). */
export function importVaccines(repoRoot: string, foreign: VaccineEntry[]): { imported: number; skipped: number } {
  const existing = new Set(listVaccines(repoRoot).map((e) => e.id));
  let imported = 0, skipped = 0;
  for (const e of foreign) {
    if (!e.id || !e.signature) { skipped++; continue; }
    if (existing.has(e.id)) { skipped++; continue; }
    appendFileSync(filePath(repoRoot), JSON.stringify(e) + "\n", "utf8");
    existing.add(e.id);
    imported++;
  }
  return { imported, skipped };
}

/** Export the local registry as a list. Suitable for the
 *  `candor.vaccines.list` MCP endpoint. */
export function exportVaccines(repoRoot: string): VaccineEntry[] {
  return listVaccines(repoRoot);
}

/** Verify an entry's HMAC. Uses the LOCAL install key — when the
 *  entry was signed by a foreign install, this returns ok:false
 *  (correctly). Cross-install verification requires the foreign
 *  install's public key, which is out of scope for v0.1. */
export function verifyVaccineSig(repoRoot: string, e: VaccineEntry): { ok: boolean; reason?: string } {
  const k = key(repoRoot);
  const canonical = `${e.id}|${e.type}|${e.signature}|${e.signedBy}|${e.observedAt}`;
  const expected = sign(canonical, k);
  if (expected !== e.sig) return { ok: false, reason: "HMAC sig mismatch — entry not signed by this install" };
  return { ok: true };
}

export function formatVaccines(entries: VaccineEntry[]): string {
  if (entries.length === 0) return `🦠 ${SPEC_NAME} VACCINE REGISTRY — empty`;
  const lines = [`🦠 ${SPEC_NAME} VACCINE REGISTRY — ${entries.length} entries`, ""];
  for (const e of entries.slice(0, 20)) {
    lines.push(`  [${e.id}] type=${e.type.padEnd(10)} by=${e.signedBy.padEnd(20)} ${e.observedAt}`);
    lines.push(`    sig: ${e.signature.slice(0, 60)}`);
    lines.push(`    desc: ${e.description.slice(0, 80)}`);
  }
  if (entries.length > 20) lines.push(`  (showing 20 of ${entries.length})`);
  return lines.join("\n");
}
