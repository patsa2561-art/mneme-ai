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

/**
 * v2.13.1: default cosmic server endpoints. Anyone with no own droplet can
 * mint a session immediately. The primary is the brand-friendly
 * cosmic.mneme-ai.space (Cloudflare-edge + Caddy + Let's Encrypt). The
 * legacy nip.io host is kept as a fallback seat for CELESTIAL CHOIR
 * redundancy — if the brand domain ever has a DNS / Cloudflare incident,
 * the IP-based host still resolves directly.
 */
export const DEFAULT_COSMIC_SERVERS = [
  "https://cosmic.mneme-ai.space",
  "https://161.35.122.73.nip.io",
] as const;
export const DEFAULT_COSMIC_SERVER = DEFAULT_COSMIC_SERVERS[0];

export interface MintInput {
  /** Base URL of the COSMIC server. Defaults to DEFAULT_COSMIC_SERVER. */
  serverUrl?: string;
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
 *  session is born when first published. v2.13.1: serverUrl is optional;
 *  defaults to DEFAULT_COSMIC_SERVER (cosmic.mneme-ai.space). */
export function mintSession(input: MintInput = {}): CosmicSession {
  const token = randomBytes(12).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const adminSecretHash = createHash("sha256").update(secret).digest("hex");
  const base = (input.serverUrl ?? DEFAULT_COSMIC_SERVER).replace(/\/+$/, "");
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

/** Sign an HMAC bearer for a request body. v2.13: include the timestamp
 *  in the canonical string so the server can enforce a NONCE-WINDOW (~120s)
 *  and reject replays. The ts is sent as an X-Cosmic-Ts header so the
 *  server reproduces the same canonical. ts=undefined falls back to the
 *  v2.11/v2.12 legacy canonical for backwards compatibility. */
function signBearer(method: string, path: string, body: string, secret: string, ts?: number): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canon = ts === undefined ? `${method} ${path} ${bodyHash}` : `${method} ${path} ${bodyHash} ${ts}`;
  return createHmac("sha256", secret).update(canon).digest("hex");
}

/** Helper that builds standard signed headers including the v2.13 nonce. */
function signedHeaders(method: string, path: string, body: string, secret: string): Record<string, string> {
  const ts = Date.now();
  return {
    "authorization": `Bearer ${signBearer(method, path, body, secret, ts)}`,
    "x-cosmic-ts": String(ts),
  };
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
  const body = JSON.stringify({ state: input.state, adminSecretHash: input.session.adminSecretHash });
  // v2.13: NONCE-WINDOW HMAC. signedHeaders() adds X-Cosmic-Ts so the
  // server can reject replays (>120s old).
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...signedHeaders("POST", path, body, input.session.adminSecretHash),
  };
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
  const headers: Record<string, string> = signedHeaders("POST", path, body, session.adminSecretHash);
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

// ====================================================================
// v2.12 NOBEL-tier helpers — proof-of-liveness, reverse-delivery, presence.
// ====================================================================

/** Send a heartbeat so receivers know the parent is still alive. If the
 *  server has not seen a heartbeat OR a publish within ~3 minutes, the
 *  session is marked ZOMBIE in JSON read + the HTML banner. Receivers
 *  treat zombies as untrustworthy. */
export async function heartbeatCosmic(
  session: CosmicSession,
  fetchOverride?: typeof fetch,
): Promise<{ ok: boolean; ts?: number; zombie?: boolean; error?: string }> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const path = `/api/v1/sessions/${session.token}/heartbeat`;
  const body = "";
  const headers: Record<string, string> = signedHeaders("POST", path, body, session.adminSecretHash);
  try {
    const r = await fetchFn(`${session.serverUrl}${path}`, { method: "POST", headers, body });
    const j = await r.json().catch(() => ({})) as { ts?: number; zombie?: boolean; error?: string };
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    return { ok: true, ts: j.ts, zombie: j.zombie };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

export interface InboxEntry {
  receivedAt: string;
  vendor: string;
  body: string;
}

/** Receivers (any AI) POST a free-form HOMUNCULUS RETURN block back to
 *  the parent's inbox. Open endpoint — no auth — so any vendor can
 *  participate. Server caps to 16KB / entry, 256 entries / session. */
export async function pushHomunculusReturn(
  jsonUrl: string,
  body: string,
  fetchOverride?: typeof fetch,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  // jsonUrl is `${base}/api/v1/sessions/${token}.json` — derive inbox URL.
  const inboxUrl = jsonUrl.replace(/\.json$/, "/inbox");
  try {
    const r = await fetchFn(inboxUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });
    const j = await r.json().catch(() => ({})) as { count?: number; error?: string };
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    return { ok: true, count: j.count };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** Parent reads + optionally drains its inbox. HMAC-auth. */
export async function readInbox(
  session: CosmicSession,
  opts: { drain?: boolean; fetchOverride?: typeof fetch } = {},
): Promise<{ ok: boolean; items?: InboxEntry[]; count?: number; drained?: boolean; error?: string }> {
  const fetchFn = opts.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const path = `/api/v1/sessions/${session.token}/inbox`;
  const headers: Record<string, string> = signedHeaders("GET", path, "", session.adminSecretHash);
  if (opts.drain) headers["x-drain"] = "1";
  try {
    const r = await fetchFn(`${session.serverUrl}${path}`, { headers });
    const j = await r.json().catch(() => ({})) as { items?: InboxEntry[]; count?: number; drained?: boolean; error?: string };
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    return { ok: true, items: j.items, count: j.count, drained: j.drained };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

export interface PresenceWatcher { fp: string; vendor: string; secondsAgo: number }

// ====================================================================
// v2.13.0 NOBEL-tier helpers — incremental publish + ETag + DEAD MAN'S HAND.
// ====================================================================

/** Publish an incremental JSON Patch instead of full state. The caller
 *  supplies prevState (what they last successfully published) and the
 *  basedOnSig the server returned. The server applies the patch on top
 *  of its current state and returns 409 if basedOnSig is stale.
 *
 *  Falls back to a full publish automatically if the patch is no smaller
 *  than the full body (see patchIsWorthIt). */
export async function publishIncrementalToCosmic(input: {
  session: CosmicSession;
  prevState: Record<string, unknown>;
  nextState: Record<string, unknown>;
  basedOnSig: string;
  fetchOverride?: typeof fetch;
}): Promise<PublishResult & { mode?: "patch" | "full" }> {
  const { makePatch, patchIsWorthIt } = await import("./diff.js");
  const fetchFn = input.fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const patch = makePatch(input.prevState, input.nextState);
  const fullBody = JSON.stringify({ state: input.nextState, adminSecretHash: input.session.adminSecretHash });
  const patchBody = JSON.stringify({ patch, basedOnSig: input.basedOnSig, adminSecretHash: input.session.adminSecretHash });
  const useFullForm = patch.length === 0 || !patchIsWorthIt(Buffer.byteLength(fullBody, "utf8"), Buffer.byteLength(patchBody, "utf8"));
  const body = useFullForm ? fullBody : patchBody;
  const path = `/api/v1/sessions/${input.session.token}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...signedHeaders("POST", path, body, input.session.adminSecretHash),
  };
  try {
    const r = await fetchFn(`${input.session.serverUrl}${path}`, { method: "POST", headers, body });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (json as { error?: string }).error ?? `HTTP ${r.status}`, mode: useFullForm ? "full" : "patch" };
    const j = json as { count?: number; prevSig?: string | null; newSig?: string };
    return { ok: true, count: j.count, prevSig: j.prevSig ?? null, newSig: j.newSig, mode: useFullForm ? "full" : "patch" };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200), mode: useFullForm ? "full" : "patch" };
  }
}

/** Conditional read using ETag: server returns 304 (not_modified) when
 *  state hasn't changed. Saves ~99% bandwidth on poll cycles. */
export async function readCosmicWithEtag(
  jsonUrl: string,
  prevEtag: string | null,
  fetchOverride?: typeof fetch,
): Promise<{
  ok: boolean;
  notModified?: boolean;
  state?: Record<string, unknown>;
  etag?: string;
  rescueUrl?: string | null;
  zombie?: boolean;
  error?: string;
}> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const headers: Record<string, string> = {};
  if (prevEtag) headers["if-none-match"] = prevEtag;
  try {
    const r = await fetchFn(jsonUrl, { headers });
    if (r.status === 304) return { ok: true, notModified: true, etag: prevEtag ?? undefined };
    if (!r.ok) {
      if (r.status === 404) return { ok: false, error: "session not found (revoked / evicted)" };
      return { ok: false, error: `HTTP ${r.status}` };
    }
    const j = await r.json() as { state?: Record<string, unknown>; rescueUrl?: string | null; zombie?: boolean };
    return { ok: true, notModified: false, state: j.state, etag: r.headers.get("etag") ?? undefined, rescueUrl: j.rescueUrl ?? null, zombie: j.zombie };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

/** Open Google-Docs-style watcher list. Anyone with the token can see
 *  who else is reading + what vendor they appear to be. Useful for the
 *  parent AI to know if the receiver actually opened the URL. */
export async function getCosmicPresence(
  jsonUrl: string,
  fetchOverride?: typeof fetch,
): Promise<{
  ok: boolean;
  watchers?: PresenceWatcher[];
  zombie?: boolean;
  publishCount?: number;
  lastPublishTs?: number;
  lastHeartbeatTs?: number | null;
  error?: string;
}> {
  const fetchFn = fetchOverride ?? globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, error: "no fetch" };
  const presenceUrl = jsonUrl.replace(/\.json$/, "/presence");
  try {
    const r = await fetchFn(presenceUrl);
    const j = await r.json().catch(() => ({})) as {
      watchers?: PresenceWatcher[]; zombie?: boolean; publishCount?: number;
      lastPublishTs?: number; lastHeartbeatTs?: number | null; error?: string;
    };
    if (!r.ok) return { ok: false, error: j.error ?? `HTTP ${r.status}` };
    return { ok: true, watchers: j.watchers, zombie: j.zombie, publishCount: j.publishCount, lastPublishTs: j.lastPublishTs, lastHeartbeatTs: j.lastHeartbeatTs };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

// ====================================================================
// v2.13.0 module re-exports — composed cosmic surface.
// ====================================================================
export * as diff from "./diff.js";
export * as choir from "./choir.js";
export * as echoCommit from "./echo_commit.js";
export * as audit from "./aurelian_audit.js";
export * as benchmark from "./benchmark.js";
