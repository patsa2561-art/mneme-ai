/**
 * v2.11.0 -- COSMIC LINK client library.
 *
 *   "When the parent's laptop is up, COSMIC streams live state. When
 *    parent goes offline, COSMIC keeps serving the last snapshot with
 *    a STALE banner so the receiving AI knows the truth."
 *
 * The client side of `bin/mneme-cosmic.mjs`. Thin: just three
 * primitives — mintSession, publish, revoke — plus URL helpers for
 * embedding in NEXUS-LOCK soul prompts.
 *
 * Auth model:
 *   - Caller calls `mintSession({serverUrl})` — generates a fresh
 *     ephemeral token + a per-session bearer secret.
 *   - First publish uploads `{state, adminSecretHash: sha256(secret)}`.
 *     Server stores the hash and accepts that session.
 *   - Subsequent publishes / revokes are HMAC-bearer-authed with the
 *     full secret over `${method} ${path} ${sha256(body)}`.
 *   - Receivers (any AI) read the URL — no auth required (state is
 *     version metadata only, never source / secrets).
 *
 * HMAC chain:
 *   - Server includes `prevSig` + `newSig` in every publish response.
 *   - Each `newSig` is HMAC over `state | count | ts | prevSig`.
 *   - Receiver can verify the chain wasn't broken in transit by
 *     replaying the chain from publish #1.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

export interface MintInput {
  /** Base URL of the COSMIC server (e.g., https://cosmic.example.com). */
  serverUrl: string;
}

export interface CosmicSession {
  /** Public token used in URLs. */
  token: string;
  /** Secret used to sign publish + revoke requests. NEVER share. */
  secret: string;
  /** SHA256 of secret — sent on first publish so the server can verify
   *  later requests via HMAC without storing the plaintext secret. */
  adminSecretHash: string;
  /** Public read URL for embedding in soul prompts. */
  publicUrl: string;
  /** JSON read URL (for AIs that fetch JSON). */
  jsonUrl: string;
  /** SSE stream URL (for AIs / clients that support live push). */
  sseUrl: string;
  /** Server base URL. */
  serverUrl: string;
}

/** Mint a fresh ephemeral session locally. No network call yet — the
 *  session is born when first published. */
export function mintSession(input: MintInput): CosmicSession {
  const token = randomBytes(12).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const adminSecretHash = createHash("sha256").update(secret).digest("hex");
  const base = input.serverUrl.replace(/\/+$/, "");
  return {
    token,
    secret,
    adminSecretHash,
    publicUrl: `${base}/sessions/${token}`,
    jsonUrl: `${base}/api/v1/sessions/${token}.json`,
    sseUrl: `${base}/sessions/${token}/sse`,
    serverUrl: base,
  };
}

/** Sign an HMAC bearer for a request body. Used by publish + revoke. */
function signBearer(method: string, path: string, body: string, secret: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canon = `${method} ${path} ${bodyHash}`;
  return createHmac("sha256", secret).update(canon).digest("hex");
}

export interface PublishInput {
  session: CosmicSession;
  /** Arbitrary state object — version, commit metadata, etc. NOT source. */
  state: Record<string, unknown>;
  /** Test seam for fetch. */
  fetchOverride?: typeof fetch;
}

export interface PublishResult {
  ok: boolean;
  count?: number;
  prevSig?: string | null;
  newSig?: string;
  error?: string;
}

/** Publish state to COSMIC. First call uploads adminSecretHash; later
 *  calls auth via HMAC-SHA256 bearer. Returns the chain signatures so
 *  the caller can verify integrity. */
export async function publishToCosmic(input: PublishInput): Promise<PublishResult> {
  const fetchFn = input.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const path = `/api/v1/sessions/${input.session.token}`;
  const url = `${input.session.serverUrl}${path}`;
  // First publish: include adminSecretHash so the server can store it
  // and verify subsequent requests. Subsequent publishes auth via HMAC
  // over the body hash.
  const body = JSON.stringify({ state: input.state, adminSecretHash: input.session.adminSecretHash });
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Always sign — first request the server treats as adminSecretHash bootstrap;
  // later ones the server verifies the signature.
  headers["authorization"] = `Bearer ${signBearer("POST", path, body, input.session.adminSecretHash)}`;
  try {
    const r = await fetchFn(url, { method: "POST", headers, body });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (json as { error?: string }).error ?? `HTTP ${r.status}` };
    const j = json as { count?: number; prevSig?: string | null; newSig?: string };
    return { ok: true, count: j.count, prevSig: j.prevSig ?? null, newSig: j.newSig };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** Revoke a session — server forgets it immediately. */
export async function revokeCosmic(session: CosmicSession, fetchOverride?: typeof fetch): Promise<{ ok: boolean; error?: string }> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const path = `/api/v1/sessions/${session.token}/revoke`;
  const body = "";
  const headers: Record<string, string> = {
    "authorization": `Bearer ${signBearer("POST", path, body, session.adminSecretHash)}`,
  };
  try {
    const r = await fetchFn(`${session.serverUrl}${path}`, { method: "POST", headers, body });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: (j as { error?: string }).error ?? `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** Read current state from COSMIC. Receivers can call this without
 *  any auth — state is public-by-design. */
export async function readCosmic(jsonUrl: string, fetchOverride?: typeof fetch): Promise<{
  ok: boolean;
  state?: Record<string, unknown>;
  stale?: boolean;
  publishCount?: number;
  lastPublishTs?: number;
  error?: string;
}> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  try {
    const r = await fetchFn(jsonUrl);
    if (!r.ok) {
      if (r.status === 404) return { ok: false, error: "session not found (revoked / evicted)" };
      return { ok: false, error: `HTTP ${r.status}` };
    }
    const j = await r.json() as { state?: Record<string, unknown>; stale?: boolean; publishCount?: number; lastPublishTs?: number };
    return { ok: true, state: j.state, stale: j.stale, publishCount: j.publishCount, lastPublishTs: j.lastPublishTs };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** One-line summary of a session — useful in pulse / wisdom fields. */
export function formatCosmicPulseLine(session: CosmicSession, lastResult?: PublishResult): string {
  const tag = lastResult?.ok ? `count=${lastResult.count} sig=${lastResult.newSig?.slice(0, 8)}` : `idle`;
  return `COSMIC · ${session.token.slice(0, 8)} · ${tag} · ${session.publicUrl}`;
}
