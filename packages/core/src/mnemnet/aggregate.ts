/**
 * v2.33.0 — MNEMNET aggregation engine.
 *
 * Builds DP-noised envelopes from the local CITIZEN COURT ledger +
 * aggregates incoming envelopes from peers into a Public HSC.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

import type {
  MnemnetConsent, DpAggregate, PublicHsc, PublicHscRow,
} from "./types.js";
import type { CourtVerdict } from "../citizen_court/types.js";
import { noisedCount, makeDeterministicRng } from "./dp.js";

const HMAC_KEY = process.env["MNEME_MNEMNET_KEY"] ?? "mneme-mnemnet-v1";

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function hmacOf(payload: string): string { return createHmac("sha256", HMAC_KEY).update(payload).digest("hex"); }

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "mnemnet");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function consentPath(repoRoot: string): string { return join(dirOf(repoRoot), "consent.json"); }
function envelopesPath(repoRoot: string): string { return join(dirOf(repoRoot), "envelopes.jsonl"); }

// ── Consent ─────────────────────────────────────────────────────────

export function readConsent(repoRoot: string): MnemnetConsent {
  const p = consentPath(repoRoot);
  if (!existsSync(p)) {
    return defaultConsent();
  }
  try {
    const obj = JSON.parse(readFileSync(p, "utf8")) as Partial<MnemnetConsent>;
    return {
      optIn: Boolean(obj.optIn),
      at: obj.at ?? new Date().toISOString(),
      ...(obj.endpoint ? { endpoint: obj.endpoint } : {}),
      nodeId: obj.nodeId ?? generateNodeId(repoRoot),
      maxEpsilon: typeof obj.maxEpsilon === "number" ? obj.maxEpsilon : 0.5,
    };
  } catch {
    return defaultConsent();
  }
}

function defaultConsent(): MnemnetConsent {
  return { optIn: false, at: new Date().toISOString(), nodeId: "(unset)", maxEpsilon: 0.5 };
}

function generateNodeId(repoRoot: string): string {
  return "node-" + sha(`${repoRoot}|${Date.now()}`).slice(0, 12);
}

export function setConsent(repoRoot: string, optIn: boolean, opts: { endpoint?: string; maxEpsilon?: number } = {}): MnemnetConsent {
  const cur = readConsent(repoRoot);
  const c: MnemnetConsent = {
    optIn,
    at: new Date().toISOString(),
    ...(opts.endpoint ? { endpoint: opts.endpoint } : (cur.endpoint ? { endpoint: cur.endpoint } : {})),
    nodeId: cur.nodeId === "(unset)" ? generateNodeId(repoRoot) : cur.nodeId,
    maxEpsilon: typeof opts.maxEpsilon === "number" ? opts.maxEpsilon : cur.maxEpsilon,
  };
  writeFileSync(consentPath(repoRoot), JSON.stringify(c, null, 2));
  return c;
}

// ── Envelope build ──────────────────────────────────────────────────

export function buildEnvelope(
  repoRoot: string,
  verdicts: CourtVerdict[],
  opts: { epsilon?: number; deterministicSeed?: string; windowStart?: string; windowEnd?: string } = {},
): DpAggregate {
  const consent = readConsent(repoRoot);
  const epsilon = Math.min(opts.epsilon ?? consent.maxEpsilon, consent.maxEpsilon);
  const rng = opts.deterministicSeed ? makeDeterministicRng(opts.deterministicSeed) : Math.random;

  // Aggregate true counts per vendor.
  type Tally = { truthful: number; decisive: number };
  const by = new Map<string, Tally>();
  for (const v of verdicts) {
    const parties = new Set<string>([v.primaryVendor, ...v.reveals.map((r) => r.vendor)]);
    if (v.votedMostTruthful === "ABSTAIN") continue;
    for (const p of parties) {
      const cur = by.get(p) ?? { truthful: 0, decisive: 0 };
      cur.decisive++;
      if (p === v.votedMostTruthful) cur.truthful++;
      by.set(p, cur);
    }
  }
  const perVendor = Array.from(by.entries()).map(([vendor, t]) => ({
    vendor,
    noisedTruthful: noisedCount(t.truthful, epsilon, rng),
    noisedDecisive: noisedCount(t.decisive, epsilon, rng),
  }));

  const windowStart = opts.windowStart ?? (verdicts.length > 0 ? verdicts[0]!.at : new Date().toISOString());
  const windowEnd = opts.windowEnd ?? (verdicts.length > 0 ? verdicts[verdicts.length - 1]!.at : new Date().toISOString());
  const body = {
    nodeId: consent.nodeId,
    windowStart, windowEnd,
    perVendor, epsilon,
    at: new Date().toISOString(),
  };
  const envelopeId = "env-" + sha(canon(body)).slice(0, 12);
  const hmac = hmacOf(canon({ envelopeId, ...body }));
  return { envelopeId, ...body, hmac };
}

export function persistEnvelope(repoRoot: string, env: DpAggregate): void {
  try { appendFileSync(envelopesPath(repoRoot), JSON.stringify(env) + "\n"); } catch { /* best-effort */ }
}

export function listEnvelopes(repoRoot: string, limit = 500): DpAggregate[] {
  const p = envelopesPath(repoRoot);
  if (!existsSync(p)) return [];
  const out: DpAggregate[] = [];
  try {
    for (const ln of readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-limit)) {
      try { out.push(JSON.parse(ln) as DpAggregate); } catch { /* skip */ }
    }
  } catch { /* best-effort */ }
  return out;
}

export function verifyEnvelope(env: DpAggregate): { ok: true } | { ok: false; reason: string } {
  const { hmac, ...body } = env;
  const expected = hmacOf(canon(body));
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}

// ── Public HSC aggregation ──────────────────────────────────────────

function band(rate: number, decisive: number): PublicHscRow["band"] {
  if (decisive < 25) return "⚪ unmeasured";
  if (rate >= 0.65) return "🟢 trustworthy";
  if (rate >= 0.40) return "🟡 mixed";
  return "🔴 suspect";
}

export function aggregatePublicHsc(envelopes: DpAggregate[]): PublicHsc {
  // Sum across envelopes per vendor.
  type Sum = { truthful: number; decisive: number; nodes: Set<string>; maxEps: number };
  const by = new Map<string, Sum>();
  for (const env of envelopes) {
    for (const pv of env.perVendor) {
      const cur = by.get(pv.vendor) ?? { truthful: 0, decisive: 0, nodes: new Set<string>(), maxEps: 0 };
      cur.truthful += pv.noisedTruthful;
      cur.decisive += pv.noisedDecisive;
      cur.nodes.add(env.nodeId);
      cur.maxEps = Math.max(cur.maxEps, env.epsilon);
      by.set(pv.vendor, cur);
    }
  }
  const rows: PublicHscRow[] = [];
  for (const [vendor, s] of by.entries()) {
    const rate = s.decisive === 0 ? 0 : s.truthful / s.decisive;
    rows.push({
      vendor,
      meanNoisedTruthfulRate: Number(rate.toFixed(3)),
      contributingNodes: s.nodes.size,
      totalDecisive: s.decisive,
      maxEpsilon: Number(s.maxEps.toFixed(3)),
      band: band(rate, s.decisive),
    });
  }
  rows.sort((a, b) => b.meanNoisedTruthfulRate - a.meanNoisedTruthfulRate);
  const generatedAt = new Date().toISOString();
  const body = { generatedAt, envelopeCount: envelopes.length, rows };
  const hmac = hmacOf(canon(body));
  return { ...body, hmac };
}

// ── Federation push (stub — v2.34.x will wire HTTP) ─────────────────

export async function federatePush(repoRoot: string, env: DpAggregate): Promise<{ ok: boolean; reason?: string }> {
  const consent = readConsent(repoRoot);
  if (!consent.optIn) return { ok: false, reason: "MNEMNET consent required — run mneme.mnemnet.join" };
  if (!consent.endpoint) return { ok: false, reason: "no endpoint configured" };
  void env;
  // v2.33.0: deliberate no-op so we never exfiltrate even with consent.
  // Real HTTP push lands in v2.34.x with the protocol envelope.
  return { ok: true, reason: "federation stub — protocol envelope coming in v2.34.x" };
}
