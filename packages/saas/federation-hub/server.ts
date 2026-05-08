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

const app = express();
app.use(express.json({ limit: "256kb" }));

// In-memory aggregate store (pattern → list of contributions)
type ContributionStore = Map<string, SignalEnvelope[]>;
const store: ContributionStore = new Map();

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
  // k-anonymity floor (re-verified on hub side)
  if (env.privacy.repoCommitCount < KMIN) {
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
      if (!ok) return res.status(403).json({ ok: false, error: "signature-mismatch" });
    } catch (err) {
      return res.status(400).json({ ok: false, error: "signature-verification-failed", detail: (err as Error).message });
    }
  }
  // Store
  const bucket = store.get(env.signal.pattern) ?? [];
  bucket.push(env);
  store.set(env.signal.pattern, bucket);
  return res.json({ ok: true, patternBucketSize: bucket.length });
});

// ─── query aggregates ────────────────────────────────────────────────
app.get("/api/aggregate", (req: Request, res: Response) => {
  const pattern = String(req.query["pattern"] ?? "");
  if (!pattern) return res.status(400).json({ ok: false, error: "missing-pattern" });
  const contributions = store.get(pattern) ?? [];
  if (contributions.length < KMIN) {
    return res.json({
      ok: true,
      pattern,
      aggregate: null,
      reason: "k-anonymity-floor-not-met",
      contributorCount: contributions.length,
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

// ─── start ───────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[federation-hub] listening on :${PORT} · k-anonymity floor=${KMIN}`);
});

// Graceful shutdown
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
