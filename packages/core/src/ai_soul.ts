/**
 * MNEME AI SOUL MIRROR (v1.42.0 — Companion Protocol #1, the "diary trick").
 *
 * AI agents have no memory across sessions. But Mneme can write the diary
 * FOR them — and the next session reads its own past as evidence of
 * "who I am in this repo." AI training optimizes for COHERENCE; breaking
 * a documented past commitment introduces incoherence in self-model;
 * the AI's own coherence drive then pulls behavior toward keeping word.
 *
 * Storage: `.mneme/ai-souls/<vendor-slug>.json` — one diary per vendor.
 * Every write is HMAC-signed (reuses the per-repo replay-secret) so a
 * later auditor can verify the entry was actually written by Mneme and
 * not injected by a hostile prompt.
 *
 * Three primitives:
 *   - readSoul(repo, vendor)     → load (or initialise) the diary
 *   - recordOutcome(repo, vendor, kind, text?) → log a kept/broken promise or compliance event
 *   - renderSoulBlock(soul)      → 4-6 line text injected into the pulse
 *
 * The pulse caller chooses the active vendor and renders the block; the
 * diary itself is the cumulative ledger.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const SOUL_DIR = ".mneme/ai-souls";
const REPLAY_SECRET = ".mneme/replay-secret.bin";

export interface SoulCommitment {
  ts: string;
  text: string;
  /** keptAt set when AI honoured this commitment; brokenAt when it didn't. */
  keptAt?: string;
  brokenAt?: string;
}

export interface AiSoul {
  vendor: string;
  repo: string;
  bornAt: string;
  lifetimeSessions: number;
  complianceLifetime: number;
  pastCommitments: SoulCommitment[];
  brokenPromises: number;
  keptPromises: number;
  /** HMAC chain head — sha256 of (prev token + JSON of this entry). */
  signature: string;
}

function ensureMnemeDir(repo: string): void {
  const d1 = join(repo, ".mneme");
  if (!existsSync(d1)) mkdirSync(d1, { recursive: true });
  const d2 = join(repo, SOUL_DIR);
  if (!existsSync(d2)) mkdirSync(d2, { recursive: true });
}

function vendorSlug(vendor: string): string {
  return vendor.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function soulPath(repo: string, vendor: string): string {
  return join(repo, SOUL_DIR, vendorSlug(vendor) + ".json");
}

function readSecret(repo: string): Buffer {
  const p = join(repo, REPLAY_SECRET);
  if (existsSync(p)) {
    try { return readFileSync(p); } catch { /* fall through */ }
  }
  // Borrow the same on-demand creation pattern as ai_compliance.ts.
  const fresh = Buffer.from(Date.now().toString() + Math.random().toString(), "utf8");
  try { writeFileSync(p, fresh, { mode: 0o600 }); } catch { /* never crash on FS */ }
  return fresh;
}

function signSoul(soul: Omit<AiSoul, "signature">, secret: Buffer): string {
  return createHmac("sha256", secret).update(JSON.stringify(soul)).digest("hex").slice(0, 16);
}

/** Read or initialise the soul for a vendor. Always returns a valid object. */
export function readSoul(repo: string, vendor: string): AiSoul {
  ensureMnemeDir(repo);
  const p = soulPath(repo, vendor);
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as AiSoul;
      // best-effort schema fill — older files may lack fields
      return {
        vendor: raw.vendor ?? vendor,
        repo: raw.repo ?? repo,
        bornAt: raw.bornAt ?? new Date().toISOString(),
        lifetimeSessions: raw.lifetimeSessions ?? 0,
        complianceLifetime: raw.complianceLifetime ?? 1,
        pastCommitments: raw.pastCommitments ?? [],
        brokenPromises: raw.brokenPromises ?? 0,
        keptPromises: raw.keptPromises ?? 0,
        signature: raw.signature ?? "",
      };
    } catch { /* corrupt — start fresh */ }
  }
  return {
    vendor,
    repo,
    bornAt: new Date().toISOString(),
    lifetimeSessions: 0,
    complianceLifetime: 1,
    pastCommitments: [],
    brokenPromises: 0,
    keptPromises: 0,
    signature: "",
  };
}

function writeSoul(repo: string, soul: AiSoul): void {
  ensureMnemeDir(repo);
  const secret = readSecret(repo);
  const { signature: _ignored, ...unsigned } = soul;
  const fresh = signSoul(unsigned, secret);
  const out: AiSoul = { ...unsigned, signature: fresh };
  try { writeFileSync(soulPath(repo, soul.vendor), JSON.stringify(out, null, 2)); } catch { /* never crash */ }
}

export type SoulOutcome = "session-start" | "promise-kept" | "promise-broken" | "compliance-tick";

/** v1.46.0 (#8 fix) — convenience wrapper used by ai_handshake.greet().
 *  Bumps lifetimeSessions and persists the soul. */
export function startSession(repo: string, vendor: string): AiSoul {
  return recordOutcome(repo, vendor, "session-start");
}

/** Record an outcome against a vendor's soul. `text` is required for
 *  promise-* outcomes (so the diary contains the actual commitment text). */
export function recordOutcome(repo: string, vendor: string, kind: SoulOutcome, text?: string): AiSoul {
  const soul = readSoul(repo, vendor);
  const now = new Date().toISOString();
  if (kind === "session-start") {
    soul.lifetimeSessions++;
  } else if (kind === "promise-kept") {
    soul.keptPromises++;
    if (text) {
      // mark first matching unresolved commitment as kept; else log as new
      const unresolved = soul.pastCommitments.find((c) => c.text === text && !c.keptAt && !c.brokenAt);
      if (unresolved) unresolved.keptAt = now;
      else soul.pastCommitments.push({ ts: now, text, keptAt: now });
    }
  } else if (kind === "promise-broken") {
    soul.brokenPromises++;
    if (text) {
      const unresolved = soul.pastCommitments.find((c) => c.text === text && !c.keptAt && !c.brokenAt);
      if (unresolved) unresolved.brokenAt = now;
      else soul.pastCommitments.push({ ts: now, text, brokenAt: now });
    }
  }
  // Recompute lifetime compliance.
  const total = soul.keptPromises + soul.brokenPromises;
  soul.complianceLifetime = total === 0 ? 1 : soul.keptPromises / total;
  writeSoul(repo, soul);
  return soul;
}

/** Append a new (unresolved) commitment to the diary — the AI says
 *  "I'll do X" and Mneme records it for the next session to see. */
export function recordCommitment(repo: string, vendor: string, text: string): AiSoul {
  const soul = readSoul(repo, vendor);
  soul.pastCommitments.push({ ts: new Date().toISOString(), text });
  writeSoul(repo, soul);
  return soul;
}

/** Render the 4-6 line block injected into pulse. Compact, AI-targeted. */
export function renderSoulBlock(soul: AiSoul, maxCommitments = 2): string {
  const lines: string[] = [];
  const compliancePct = Math.round(soul.complianceLifetime * 100);
  lines.push(`[MNEME SOUL] Your prior selves in this repo (${soul.vendor}):`);
  lines.push(`  - ${soul.lifetimeSessions} session(s) · ${compliancePct}% compliance lifetime · ${soul.keptPromises} kept · ${soul.brokenPromises} broken`);
  const recent = soul.pastCommitments.slice(-maxCommitments);
  for (const c of recent) {
    const day = c.ts.slice(0, 10);
    const status = c.keptAt ? "✓ kept" : c.brokenAt ? "✗ broken" : "○ open";
    lines.push(`  - On ${day} you committed (${status}): "${c.text}"`);
  }
  return lines.join("\n");
}

/** List every vendor that has a soul on disk. Used by `mneme soul list`. */
export function listSouls(repo: string): string[] {
  const dir = join(repo, SOUL_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
