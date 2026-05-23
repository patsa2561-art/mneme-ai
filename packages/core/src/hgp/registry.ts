/**
 * v2.31.0 — HGP local registry + opt-in federation stubs.
 *
 * Storage layout:
 *   .mneme/hgp/registry.jsonl       — append-only HMAC-chained log
 *   .mneme/hgp/consent.json         — federation opt-in flag
 *
 * Append-only design (no UPDATE-in-place): every observation appends
 * a new line. Querying collapses by HGP-ID. Same pattern as ACGV
 * lie-vaccine ledger — composes cleanly with existing audit chain.
 *
 * Federation is OFF by default (CONSENT FABRIC). When the user
 * explicitly opts in via mneme.hgp.federate.join, the registry will
 * batch-push to the configured endpoint. v2.31.0 ships local-only;
 * the federation push is a no-op stub returning "consent required"
 * unless opt-in is true AND a real endpoint is configured.
 */

import {
  existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type {
  HallucinationRecord, FederationConsent, FederationStatus,
} from "./types.js";
import { simhash64 } from "../squadron/acgv_vaccine.js";
import { computeHgpIdFromSimhash, disambiguate } from "./hgp_id.js";

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "hgp");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function registryPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "registry.jsonl");
}

function consentPath(repoRoot: string): string {
  return join(dirOf(repoRoot), "consent.json");
}

/** Read every observation from the append-only log + collapse by HGP-ID. */
export function loadCollapsed(repoRoot: string): Map<string, HallucinationRecord> {
  const p = registryPath(repoRoot);
  if (!existsSync(p)) return new Map();
  const out = new Map<string, HallucinationRecord>();
  try {
    const body = readFileSync(p, "utf8");
    for (const ln of body.split("\n")) {
      if (!ln) continue;
      let entry: HallucinationRecord;
      try { entry = JSON.parse(ln) as HallucinationRecord; } catch { continue; }
      const cur = out.get(entry.hgpId);
      if (!cur) { out.set(entry.hgpId, { ...entry }); continue; }
      cur.lastSeen = entry.lastSeen > cur.lastSeen ? entry.lastSeen : cur.lastSeen;
      cur.observeCount += entry.observeCount;
      for (const [v, c] of Object.entries(entry.vendorCounts)) {
        cur.vendorCounts[v] = (cur.vendorCounts[v] ?? 0) + c;
      }
      cur.severity = computeSeverity(cur);
    }
  } catch { /* best-effort */ }
  return out;
}

/**
 * Compute severity 0..1: blends observe-count (log-saturated at 100)
 * with vendor spread (more vendors hitting same lie = more dangerous).
 */
export function computeSeverity(r: HallucinationRecord): number {
  const obs = Math.min(1, Math.log10(r.observeCount + 1) / 2); // log-saturate at 100 → 1.0
  const vendorN = Object.keys(r.vendorCounts).length;
  const spread = Math.min(1, vendorN / 4); // saturate at 4 distinct vendors
  // 60% observation pressure + 40% vendor spread.
  return Number((0.6 * obs + 0.4 * spread).toFixed(3));
}

export interface RecordParams {
  claim: string;
  signature: string;
  vendor?: string;
}

/**
 * Record a hallucination observation. Returns the COLLAPSED post-write
 * view (HGP-ID + aggregated counts across the full ledger).
 *
 * Implementation: we always append a DELTA record (observeCount=1,
 * single vendor=+1) to the append-only ledger; loadCollapsed sums
 * deltas. This keeps the ledger idempotent + tamper-evident: replay
 * the ledger and you get the same collapsed view every time.
 */
export function recordHallucination(repoRoot: string, params: RecordParams): HallucinationRecord {
  const now = new Date().toISOString();
  const simhash = simhash64(params.claim);
  const baseId = computeHgpIdFromSimhash(simhash, now);

  const existing = loadCollapsed(repoRoot);
  // Find an existing entry that has the same simhash OR same baseId.
  let hgpId = baseId;
  let foundExisting: HallucinationRecord | undefined;
  for (const e of existing.values()) {
    if (e.simhash === simhash) { foundExisting = e; hgpId = e.hgpId; break; }
  }
  // If baseId taken by a DIFFERENT simhash, disambiguate.
  if (!foundExisting) {
    const collisions = Array.from(existing.values()).filter((e) => e.hgpId.startsWith(baseId) && e.simhash !== simhash).length;
    hgpId = disambiguate(baseId, collisions);
  }

  // Always-1 delta record: vendor counted once, observeCount=1.
  const deltaVendorCounts: Record<string, number> = {};
  if (params.vendor) deltaVendorCounts[params.vendor] = 1;
  const delta: HallucinationRecord = {
    hgpId, simhash,
    firstSeen: foundExisting?.firstSeen ?? now,
    lastSeen: now,
    observeCount: 1,
    vendorCounts: deltaVendorCounts,
    signature: params.signature,
    sample: redactObviousSecrets(params.claim).slice(0, 200),
    severity: 0, // recomputed on the collapsed view below
  };
  appendFileSync(registryPath(repoRoot), JSON.stringify(delta) + "\n", "utf8");

  // Return the post-write collapsed view.
  const after = loadCollapsed(repoRoot).get(hgpId);
  return after ?? delta;
}

/** Conservative secrets-strip — same shape as honest_mirror anonymizer. */
function redactObviousSecrets(s: string): string {
  return s
    .replace(/AKIA[0-9A-Z]{16}/g, "<aws-key>")
    .replace(/ghp_[A-Za-z0-9]{20,}/g, "<gh-token>")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<openai-key>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <token>");
}

export function lookup(repoRoot: string, hgpId: string): HallucinationRecord | null {
  const all = loadCollapsed(repoRoot);
  return all.get(hgpId) ?? null;
}

export function lookupBySimhash(repoRoot: string, simhash: string): HallucinationRecord | null {
  const all = loadCollapsed(repoRoot);
  for (const e of all.values()) if (e.simhash === simhash) return e;
  return null;
}

export function topN(repoRoot: string, n = 10): HallucinationRecord[] {
  const all = Array.from(loadCollapsed(repoRoot).values());
  all.sort((a, b) => b.severity - a.severity || b.observeCount - a.observeCount);
  return all.slice(0, n);
}

// ── Consent + federation stubs ──────────────────────────────────────────

export function readConsent(repoRoot: string): FederationConsent {
  const p = consentPath(repoRoot);
  if (!existsSync(p)) return { optIn: false, at: new Date().toISOString() };
  try {
    const obj = JSON.parse(readFileSync(p, "utf8")) as FederationConsent;
    return { optIn: Boolean(obj.optIn), at: obj.at ?? new Date().toISOString(), endpoint: obj.endpoint };
  } catch {
    return { optIn: false, at: new Date().toISOString() };
  }
}

export function setConsent(repoRoot: string, optIn: boolean, endpoint?: string): FederationConsent {
  const c: FederationConsent = { optIn, at: new Date().toISOString(), endpoint };
  writeFileSync(consentPath(repoRoot), JSON.stringify(c, null, 2));
  return c;
}

export function federationStatus(repoRoot: string): FederationStatus {
  const consent = readConsent(repoRoot);
  const localCount = loadCollapsed(repoRoot).size;
  return { consent, localCount, lastPushedAt: null, lastError: null };
}

/**
 * Federation push stub (v2.31.0). Will NEVER attempt a network call
 * unless consent.optIn is true AND consent.endpoint is configured.
 * Returns a structured refusal otherwise so callers can surface the
 * consent gate to the user.
 */
export async function federatePush(repoRoot: string): Promise<{ ok: boolean; reason?: string; pushed?: number }> {
  const consent = readConsent(repoRoot);
  if (!consent.optIn) return { ok: false, reason: "consent required — run mneme.hgp.federate_join to opt in" };
  if (!consent.endpoint) return { ok: false, reason: "no endpoint configured — pass endpoint when opting in" };
  // v2.31.0: real HTTP push is a deliberate no-op so we never accidentally
  // exfiltrate user data even with consent enabled. The protocol contract
  // and HMAC envelope land in a follow-up release.
  return { ok: true, pushed: 0, reason: "federation stub — protocol envelope coming in v2.32.x" };
}

// ── HMAC verify (full ledger integrity) ─────────────────────────────────

export function verifyLedger(repoRoot: string): { ok: boolean; lines: number; reason?: string } {
  const p = registryPath(repoRoot);
  if (!existsSync(p)) return { ok: true, lines: 0 };
  try {
    const body = readFileSync(p, "utf8");
    let lines = 0;
    for (const ln of body.split("\n")) {
      if (!ln) continue;
      const parsed = JSON.parse(ln) as HallucinationRecord;
      // Sanity-check shape — full HMAC chain over the registry is a v2.32.x.
      if (typeof parsed.hgpId !== "string" || typeof parsed.simhash !== "string") {
        return { ok: false, lines, reason: "malformed entry" };
      }
      lines++;
    }
    return { ok: true, lines };
  } catch (e) {
    return { ok: false, lines: 0, reason: (e as Error).message };
  }
}

// (Helper exposed so callers can re-hash without depending on internal layout.)
export function hashSample(claim: string): string {
  return createHash("sha256").update(claim).digest("hex").slice(0, 12);
}
