/**
 * v2.16.0 — MNEME PERSONA
 *
 *   "Package your REPLICA as a callable service. Your colleague subscribes
 *    to YOUR judgment for the kinds of decisions you've made before. The
 *    federation: N Mneme users = N personas = a team-wide consensus oracle."
 *
 * Composes orthogonally with v2.14 REPLICA (decision corpus) + v2.14
 * PROJECT SOUL (rules) + v2.14 BOUNTY (vendor trust). PERSONA bundles a
 * curated subset of these into a portable, HMAC-signed `.mneme-persona`
 * manifest a teammate can import + query.
 *
 * Privacy: only *structured* decisions + outcomes + rules. No source code.
 * Per-decision opt-in via `shareable: true` flag on REPLICA decisions.
 *
 * Wisdom: PERSONA isn't another oracle — it's a *protocol* on top of REPLICA.
 * v2.17 will federate personas via cosmic; v2.16 ships the local primitives.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface PersonaDecision {
  id: string;
  ts: string;
  question: string;
  features: Record<string, string>;
  action: string;
  outcomePolarity?: "good" | "bad" | "neutral";
}

export interface PersonaSoulRule {
  id: string;
  text: string;
  category: string;
  severity: "warn" | "block";
}

export interface PersonaBundle {
  v: typeof PROTOCOL_VERSION;
  /** Human-readable owner identity (e.g., "shinnapat@example.com"). */
  owner: string;
  /** Optional display name for UI ("Shinnapat - Mneme maintainer"). */
  displayName?: string;
  /** When this bundle was exported. */
  exportedAt: string;
  /** Subset of REPLICA decisions the owner opted to share. */
  decisions: PersonaDecision[];
  /** Optional subset of PROJECT SOUL rules. */
  soulRules?: PersonaSoulRule[];
  /** HMAC over the canonical body — proves provenance + tamper evidence. */
  sig: string;
}

export interface PersonaQueryResult {
  /** Top recommendation from this persona's history, or null if no match. */
  recommendation: string | null;
  /** Confidence 0..1. */
  confidence: number;
  /** Top-k matching decisions for transparency. */
  matches: Array<{
    id: string;
    similarity: number;
    action: string;
    outcomePolarity?: "good" | "bad" | "neutral";
  }>;
  /** Owner identity for attribution ("Shinnapat would do X with 87% confidence"). */
  attributedTo: string;
  /** HMAC-signed result for tamper-evident citation. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_PERSONA_SECRET"] || `mneme-persona-v${PROTOCOL_VERSION}`;
}

const STOP = new Set(["the", "a", "an", "is", "are", "in", "on", "of", "to", "for", "and", "or", "but", "we", "i"]);

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

function featureSim(a: Record<string, string>, b: Record<string, string>): number {
  const u = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (u.size === 0) return 0;
  let m = 0;
  for (const k of u) if (a[k] !== undefined && b[k] !== undefined && a[k] === b[k]) m++;
  return m / u.size;
}

export interface ExportPersonaInput {
  owner: string;
  displayName?: string;
  decisions: PersonaDecision[];
  soulRules?: PersonaSoulRule[];
  secret?: string;
}

export function exportPersona(input: ExportPersonaInput): PersonaBundle {
  const exportedAt = new Date().toISOString();
  const body: Omit<PersonaBundle, "sig"> = {
    v: PROTOCOL_VERSION,
    owner: input.owner,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    exportedAt,
    decisions: input.decisions,
    ...(input.soulRules ? { soulRules: input.soulRules } : {}),
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyPersona(bundle: PersonaBundle, secret?: string): { ok: boolean; reason?: string } {
  const { sig: claimed, ...body } = bundle;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try {
    const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "persona sig mismatch -- forged or tampered" };
  } catch { return { ok: false, reason: "persona sig length invalid" }; }
}

export interface QueryPersonaInput {
  bundle: PersonaBundle;
  question: string;
  features?: Record<string, string>;
  k?: number;
  secret?: string;
}

export function queryPersona(input: QueryPersonaInput): PersonaQueryResult {
  const k = input.k ?? 5;
  const qTokens = tokenize(input.question);
  const qFeatures = input.features ?? {};
  const scored = input.bundle.decisions.map((d) => {
    const fs = featureSim(qFeatures, d.features);
    const ts = jaccard(qTokens, tokenize(d.question));
    const sim = fs * 0.6 + ts * 0.4;
    const boost = d.outcomePolarity === "good" ? 1.2 : d.outcomePolarity === "bad" ? 0.6 : 1.0;
    return { d, sim, weighted: sim * boost };
  }).sort((a, b) => b.weighted - a.weighted).slice(0, k);

  const tally = new Map<string, number>();
  for (const s of scored) tally.set(s.d.action, (tally.get(s.d.action) ?? 0) + s.weighted);
  const ranked = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const total = ranked.reduce((acc, [, w]) => acc + w, 0);
  const confidence = top && total > 0 ? top[1] / total : 0;

  const result: Omit<PersonaQueryResult, "sig"> = {
    recommendation: top?.[0] ?? null,
    confidence: Math.round(confidence * 1000) / 1000,
    matches: scored.map((s) => ({
      id: s.d.id,
      similarity: Math.round(s.sim * 1000) / 1000,
      action: s.d.action,
      ...(s.d.outcomePolarity ? { outcomePolarity: s.d.outcomePolarity } : {}),
    })),
    attributedTo: input.bundle.displayName ?? input.bundle.owner,
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(result)).digest("hex");
  return { ...result, sig };
}

/** Combine N personas into a consensus query. Returns per-persona results
 *  + a vote tally on the top action. */
export function consensusQuery(input: {
  bundles: PersonaBundle[];
  question: string;
  features?: Record<string, string>;
  secret?: string;
}): {
  perPersona: Array<{ owner: string; result: PersonaQueryResult }>;
  consensus: { action: string | null; agreeCount: number; total: number; confidence: number };
} {
  const perPersona = input.bundles.map((b) => ({
    owner: b.owner,
    result: queryPersona({
      bundle: b,
      question: input.question,
      ...(input.features ? { features: input.features } : {}),
      ...(input.secret ? { secret: input.secret } : {}),
    }),
  }));
  const tally = new Map<string, number>();
  for (const p of perPersona) {
    if (p.result.recommendation) tally.set(p.result.recommendation, (tally.get(p.result.recommendation) ?? 0) + 1);
  }
  const ranked = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  return {
    perPersona,
    consensus: {
      action: top?.[0] ?? null,
      agreeCount: top?.[1] ?? 0,
      total: input.bundles.length,
      confidence: top ? top[1] / input.bundles.length : 0,
    },
  };
}

export function formatPersonaLine(bundle: PersonaBundle): string {
  return `PERSONA · ${bundle.displayName ?? bundle.owner} · ${bundle.decisions.length} decisions · sig=${bundle.sig.slice(0, 8)}`;
}
