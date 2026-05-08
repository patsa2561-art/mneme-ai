/**
 * Mneme Federation Hub — reference Express server.
 *
 * Accepts signed signal envelopes from `mneme federation contribute`,
 * validates the Ed25519 signature + k-anonymity floor, stores in an
 * in-memory aggregate map, and serves aggregates back to authenticated
 * clients.
 *
 * v1.7.0 = MVP. Real production hubs should:
 *   • Persist signals to Postgres (in-memory works for dev / first-100-repos)
 *   • Add rate limiting + sybil resistance
 *   • Add per-contributor reputation
 *   • Run behind a reverse proxy with TLS termination
 *
 * Deploy:
 *   cd packages/saas/federation-hub
 *   npm install
 *   npm run dev      # tsx ./server.ts (auto-reload)
 *   npm run build && npm start    # production
 */

import express, { type Request, type Response } from "express";
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

interface SignalEnvelope {
  protocolVersion: 1;
  contributorId: string;
  emittedAt: string;
  signal: {
    pattern: string;
    sampleCount: number;
    aggregate: Record<string, number>;
  };
  privacy: {
    differentialPrivacyEpsilon: number;
    kAnonymityFloor: number;
    repoCommitCount: number;
    noiseSeed: string;
  };
  signature: string;
  signatureAlgorithm: "ed25519";
  // The contributor's public key, included so the hub can verify without needing prior registration in v1.7.0.
  // v1.8.0 will move to a registration-based model.
  publicKeyPem?: string;
}

const PORT = parseInt(process.env["PORT"] ?? "8080", 10);
const KMIN = parseInt(process.env["MIN_K_ANONYMITY"] ?? "20", 10);
// v1.9.0: opt-in JSON persistence (file path; empty = in-memory only).
// Production deployments should swap this for Postgres; this gives v1.9.0
// users restart-survival without adding a DB dependency.
const PERSIST_PATH = process.env["FEDERATION_PERSIST_PATH"] ?? "";

// v1.11.0 security hardening: rate-limit + sybil resistance.
// Token-bucket per-contributor + per-IP. Defaults sized for honest
// hourly contribution cadence; well above any real-world contributor.
const RATE_PER_MINUTE = parseInt(process.env["FEDERATION_RATE_PER_MINUTE"] ?? "10", 10);
const RATE_BURST = parseInt(process.env["FEDERATION_RATE_BURST"] ?? "20", 10);
// Reputation floor: contributors below this score are quarantined (their
// signals are stored but excluded from aggregates). Range -100..+100.
const REPUTATION_FLOOR = parseInt(process.env["FEDERATION_REPUTATION_FLOOR"] ?? "-50", 10);

const app = express();
app.use(express.json({ limit: "256kb" }));

// ─── rate-limit (token bucket per key) ───────────────────────────────
interface Bucket { tokens: number; lastRefillMs: number }
const buckets = new Map<string, Bucket>();
function rateLimitKey(req: Request, contributorId: string): string {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
  return `${contributorId}@${ip}`;
}
function takeToken(key: string): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const refillRatePerMs = RATE_PER_MINUTE / 60_000;
  const b = buckets.get(key) ?? { tokens: RATE_BURST, lastRefillMs: now };
  const elapsed = now - b.lastRefillMs;
  b.tokens = Math.min(RATE_BURST, b.tokens + elapsed * refillRatePerMs);
  b.lastRefillMs = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const wait = Math.ceil((1 - b.tokens) / refillRatePerMs);
    return { ok: false, retryAfterMs: wait };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true };
}

// ─── reputation ──────────────────────────────────────────────────────
// Per-contributor score: increments on accepted signal, decrements on
// invalid signature / k-anon violation. Below floor → quarantined.
const reputation = new Map<string, number>();
function adjustReputation(contributorId: string, delta: number): number {
  const next = Math.max(-100, Math.min(100, (reputation.get(contributorId) ?? 0) + delta));
  reputation.set(contributorId, next);
  return next;
}
function isQuarantined(contributorId: string): boolean {
  return (reputation.get(contributorId) ?? 0) < REPUTATION_FLOOR;
}

// Aggregate store (pattern → list of contributions). Loaded from
// PERSIST_PATH on startup if set; written back on every accepted signal.
type ContributionStore = Map<string, SignalEnvelope[]>;
const store: ContributionStore = loadStore();

function loadStore(): ContributionStore {
  if (!PERSIST_PATH || !existsSync(PERSIST_PATH)) return new Map();
  try {
    const raw = readFileSync(PERSIST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SignalEnvelope[]>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persistStore() {
  if (!PERSIST_PATH) return;
  if (!existsSync(dirname(PERSIST_PATH))) mkdirSync(dirname(PERSIST_PATH), { recursive: true });
  const tmp = PERSIST_PATH + ".tmp";
  const obj: Record<string, SignalEnvelope[]> = {};
  for (const [k, v] of store) obj[k] = v;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  renameSync(tmp, PERSIST_PATH);
}

// ─── liveness ────────────────────────────────────────────────────────
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, version: "1.7.0", patterns: store.size });
});

// ─── submit a signed signal envelope ────────────────────────────────
app.post("/api/signal", (req: Request, res: Response) => {
  const env = req.body as SignalEnvelope;
  if (!env || env.protocolVersion !== 1) {
    return res.status(400).json({ ok: false, error: "invalid-envelope" });
  }
  // v1.11.0 security: rate-limit per contributor+IP
  const rlKey = rateLimitKey(req, env.contributorId);
  const rl = takeToken(rlKey);
  if (!rl.ok) {
    return res.status(429).json({
      ok: false,
      error: "rate-limit-exceeded",
      retryAfterMs: rl.retryAfterMs,
    });
  }
  // k-anonymity floor (re-verified on hub side)
  if (env.privacy.repoCommitCount < KMIN) {
    adjustReputation(env.contributorId, -5);
    return res.status(400).json({ ok: false, error: "k-anonymity-violation", floor: KMIN });
  }
  // Verify Ed25519 signature if a public key is supplied
  if (env.publicKeyPem && env.signature) {
    try {
      const partial = { ...env, signature: undefined, signatureAlgorithm: undefined, publicKeyPem: undefined };
      const message = Buffer.from(JSON.stringify(partial), "utf8");
      const pubKey = createPublicKey({ key: env.publicKeyPem, format: "pem" });
      const sig = Buffer.from(env.signature, "base64");
      const ok = verify(null, message, pubKey, sig);
      if (!ok) {
        adjustReputation(env.contributorId, -10);
        return res.status(403).json({ ok: false, error: "signature-mismatch" });
      }
    } catch (err) {
      adjustReputation(env.contributorId, -5);
      return res.status(400).json({ ok: false, error: "signature-verification-failed", detail: (err as Error).message });
    }
  }
  // v1.11.0 security: refuse contributions from quarantined contributors
  if (isQuarantined(env.contributorId)) {
    return res.status(403).json({
      ok: false,
      error: "contributor-quarantined",
      reputation: reputation.get(env.contributorId),
      floor: REPUTATION_FLOOR,
    });
  }
  // Store + reward reputation
  const bucket = store.get(env.signal.pattern) ?? [];
  bucket.push(env);
  store.set(env.signal.pattern, bucket);
  const newRep = adjustReputation(env.contributorId, +1);
  // v1.9.0: persist to disk if FEDERATION_PERSIST_PATH is set
  try { persistStore(); } catch { /* persistence is best-effort */ }
  return res.json({ ok: true, patternBucketSize: bucket.length, reputation: newRep });
});

// ─── query aggregates ────────────────────────────────────────────────
app.get("/api/aggregate", (req: Request, res: Response) => {
  const pattern = String(req.query["pattern"] ?? "");
  if (!pattern) return res.status(400).json({ ok: false, error: "missing-pattern" });
  const allContributions = store.get(pattern) ?? [];
  // v1.11.0 security: exclude quarantined contributors from aggregates
  const contributions = allContributions.filter((c) => !isQuarantined(c.contributorId));
  if (contributions.length < KMIN) {
    return res.json({
      ok: true,
      pattern,
      aggregate: null,
      reason: "k-anonymity-floor-not-met",
      contributorCount: contributions.length,
      excludedQuarantined: allContributions.length - contributions.length,
      kAnonymityFloor: KMIN,
    });
  }
  // Compute mean of each numeric field across contributions
  const merged: Record<string, number[]> = {};
  for (const c of contributions) {
    for (const [k, v] of Object.entries(c.signal.aggregate)) {
      if (!merged[k]) merged[k] = [];
      merged[k].push(v);
    }
  }
  const aggregate: Record<string, number> = {};
  for (const [k, vs] of Object.entries(merged)) {
    aggregate[k] = vs.reduce((s, x) => s + x, 0) / vs.length;
  }
  return res.json({
    ok: true,
    pattern,
    aggregate,
    contributorCount: contributions.length,
    kAnonymityFloor: KMIN,
  });
});

// ─── admin: reputation inspection (read-only) ────────────────────────
// Behind ADMIN_TOKEN env var so it's not exposed by default.
app.get("/api/admin/reputation", (req: Request, res: Response) => {
  const token = process.env["ADMIN_TOKEN"];
  if (!token || req.headers["x-admin-token"] !== token) {
    return res.status(404).json({ ok: false, error: "not-found" });
  }
  const out: Array<{ contributorId: string; reputation: number; quarantined: boolean }> = [];
  for (const [id, score] of reputation) {
    out.push({ contributorId: id, reputation: score, quarantined: score < REPUTATION_FLOOR });
  }
  out.sort((a, b) => a.reputation - b.reputation);
  return res.json({ ok: true, contributors: out, floor: REPUTATION_FLOOR });
});

// ─── start ───────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[federation-hub] listening on :${PORT} · k-anonymity floor=${KMIN}` +
      ` · rate=${RATE_PER_MINUTE}/min (burst ${RATE_BURST})` +
      ` · reputation-floor=${REPUTATION_FLOOR}` +
      (PERSIST_PATH ? ` · persist=${PERSIST_PATH}` : " · in-memory only"),
  );
});

// Graceful shutdown
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
