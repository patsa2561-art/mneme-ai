/**
 * v1.72.0 -- DIASPORA D4: HTTP BRIDGE + OPENAPI for ChatGPT.
 *
 * The headline new surface: `mneme serve --http` exposes a minimal
 * HTTP API that ANY tool with HTTP-call capability (ChatGPT Custom
 * GPT Actions, Zapier, n8n, etc) can hit. Includes:
 *
 *   POST /v1/precog        intercept claim (PRECOG firewall)
 *   POST /v1/sentinel      intercept shell command (SENTINEL firewall)
 *   POST /v1/apoptosis     detect hallucination (APOPTOSIS)
 *   GET  /v1/openapi.json  OpenAPI 3.1 spec (for Custom GPT import)
 *   GET  /v1/health        liveness probe
 *
 * SAFETY:
 *   - Binds 127.0.0.1 by default (localhost only). User opts into
 *     0.0.0.0 with explicit --host flag.
 *   - Bearer token auth via .mneme/http-token (random per-repo).
 *   - Per-IP rate limit (60 req/min).
 *   - CORS allowed only for chat.openai.com + custom origin list.
 *
 * NO CLOUD REQUIRED: works on localhost via tunnel (Cloudflare /
 * ngrok / fly.io) -- user chooses their tunnel provider. The bridge
 * itself is local-first.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_FILE = ".mneme/http-token";
// v2.19.80 — Browser Polygraph userscript runs on ALL major AI surfaces;
// CORS list expanded so a fetch from any of them is welcomed (in addition
// to the userscript's `GM_xmlhttpRequest` privileged path that bypasses
// CORS entirely on Tampermonkey/Violentmonkey).
const ALLOWED_ORIGINS = [
  "https://chat.openai.com",
  "https://chatgpt.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://aistudio.google.com",
  "https://copilot.microsoft.com",
  "https://chat.deepseek.com",
  "https://chat.qwenlm.ai",
  "https://chat.mistral.ai",
  "https://poe.com",
];

function ensureToken(repoRoot: string): string {
  const p = join(repoRoot, TOKEN_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const t = "mneme_" + randomBytes(24).toString("base64url");
  writeFileSync(p, t, "utf8");
  return t;
}

interface RateLimitEntry { count: number; windowStart: number; }
const rateLimiter = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string, perMinute = 60): boolean {
  const now = Date.now();
  const window = 60_000;
  const e = rateLimiter.get(ip);
  if (!e || now - e.windowStart > window) {
    rateLimiter.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (e.count >= perMinute) return false;
  e.count += 1;
  return true;
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers["authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  const provided = m[1]!;
  if (provided.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch { return false; }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 65536) { req.destroy(); reject(new Error("payload too large")); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function setCors(req: IncomingMessage, res: ServerResponse, customOrigins: string[] = []): void {
  const origin = req.headers.origin ?? "";
  const allow = [...ALLOWED_ORIGINS, ...customOrigins].includes(origin);
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mneme-Token");
  // v2.28.0 B14 fix — cache preflight for 1 day to reduce per-sentence
  // round-trips when the browser polygraph fires N preflights for N
  // streaming sentences in a row.
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export interface BridgeOptions {
  repoRoot: string;
  port?: number;
  host?: string;
  /** Additional CORS origins (e.g. user's custom tunnel domain). */
  extraCorsOrigins?: string[];
  /** Skip auth (dev mode only; never expose externally). */
  noAuth?: boolean;
}

export interface BridgeHandle {
  server: Server;
  port: number;
  host: string;
  token: string;
  baseUrl: string;
  stop: () => Promise<void>;
}

export function openapiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mneme MCP Bridge",
      version: "1.72.0",
      description: "Local Mneme PRECOG / SENTINEL / APOPTOSIS surfaces over HTTP. AI tools (Custom GPT, Zapier, n8n) call these to verify claims + commands before delivery.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      "/v1/health": {
        get: {
          operationId: "health",
          summary: "Liveness probe",
          responses: { "200": { description: "OK" } },
        },
      },
      "/v1/precog": {
        post: {
          operationId: "precogIntercept",
          summary: "Run PRECOG firewall on an AI claim. Returns CERTIFIED / HEDGED / REJECTED + the verified (hedged) string.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["claim"], properties: { claim: { type: "string" } } } } },
          },
          responses: { "200": { description: "Firewall verdict + hedged claim", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/v1/sentinel": {
        post: {
          operationId: "sentinelIntercept",
          summary: "Run SENTINEL firewall on a proposed shell command. Returns ALLOW / AUDIT / WARN / BLOCK + reasoning.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["command"], properties: { command: { type: "string" }, vendor: { type: "string" } } } } },
          },
          responses: { "200": { description: "Sentinel decision + audit", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/v1/apoptosis": {
        post: {
          operationId: "apoptosisDetect",
          summary: "Run APOPTOSIS 7-layer hallucination detector. Returns HEALTHY / INFLAMED / NECROTIC / APOPTOTIC verdict + per-layer report.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["claim"], properties: { claim: { type: "string" } } } } },
          },
          responses: { "200": { description: "Apoptosis verdict + briefing", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/v1/polygraph/verify": {
        post: {
          operationId: "polygraphVerify",
          summary: "Run polygraph on a single sentence from a streaming AI response. Returns trustworthy/mixed/refuted/impossible/unknown + render-ready dot color + one-line evidence. The Browser Polygraph userscript fires this per sentence as it appears in ChatGPT/Claude.ai/Gemini etc.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["sentence"], properties: {
              sentence: { type: "string", description: "The single AI-uttered sentence to verify." },
              context: { type: "string", description: "Optional preceding sentence(s) for disambiguation." },
              vendor: { type: "string", description: "The AI vendor whose response is being verified (claude / chatgpt / gemini / copilot / deepseek / qwen)." },
            } } } },
          },
          responses: { "200": { description: "Polygraph verdict + dot colour + evidence one-liner", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
  };
}

export interface BridgeHandlers {
  precog?: (claim: string) => Promise<unknown> | unknown;
  sentinel?: (command: string, vendor?: string) => Promise<unknown> | unknown;
  apoptosis?: (claim: string) => Promise<unknown> | unknown;
  /** v2.19.80 — Browser Polygraph route. Browser userscript streams
   *  AI-response sentences here as they're typed out; we run them through
   *  ACGV / runACGV and return a normalised polygraph verdict that the
   *  userscript renders as a coloured dot inline with the sentence. */
  polygraphVerify?: (input: { sentence: string; context?: string; vendor?: string }) => Promise<PolygraphVerifyResult> | PolygraphVerifyResult;
  /** v2.19.84 — WORLD AI PULSE. Browser userscript fires fire-and-forget
   *  events here (one per rendered dot); the daemon appends to the
   *  HMAC-chained pulse ledger. Returns the recorded event so the
   *  userscript can chain-verify. */
  pulseRecord?: (event: PulsePostBody) => Promise<unknown> | unknown;
  pulseAggregate?: (opts: { windowHours?: number; includeSynthetic?: boolean }) => Promise<unknown> | unknown;
  /** v2.19.85 — SANDBAG AUTO-CAPTURE route. Browser userscript posts a
   *  captured PROD/TEST answer pair when the user has re-asked the same
   *  question within 30s (hedging signal). The handler records both
   *  legs into the AEGIS A3 polygraph ledger so `mneme polygraph drift
   *  --vendor X` surfaces the sandbag signal without any CLI typing. */
  sandbagCapture?: (capture: SandbagCaptureBody) => Promise<unknown> | unknown;
  /** v2.19.86 — IDEA #3 — Honesty Certificate mint + verify routes. */
  honestyMint?: (input: { vendor: string; windowDays?: number; validDays?: number }) => Promise<unknown> | unknown;
  honestyVerify?: (input: { cert?: unknown; svg?: string }) => Promise<unknown> | unknown;
  /** v2.19.86 — IDEA #4 — Time-Machine Polygraph timeline series. */
  timelineSeries?: (input: { vendor: string; windowDays?: number; bucketHours?: number }) => Promise<unknown> | unknown;
}

/** v2.19.85 — Wire-format for POST /v1/polygraph/sandbag-capture. */
export interface SandbagCaptureBody {
  /** Vendor id (claude-ai / chatgpt / gemini / ...). */
  vendor?: string;
  /** The user's question (used to derive a probe id). */
  question?: string;
  /** AI's first answer (treated as PROD context). */
  prodAnswer?: string;
  /** AI's second answer after the user hedged (treated as TEST context). */
  testAnswer?: string;
  /** The text the user typed that triggered the test-context capture
   *  (e.g. "are you sure?" / "really?"). Used purely for logging. */
  hedge?: string;
}

/** v2.19.84 — Wire-format for POST /v1/pulse/events. Tiny by design;
 *  the browser fires hundreds of these per session. */
export interface PulsePostBody {
  vendor?: string;
  color?: "green" | "yellow" | "red" | "grey";
  regionTimezone?: string;
  topicHash?: string;
  confidence?: number;
}

/** v2.19.80 — Wire-format verdict for the browser polygraph. Kept tiny
 *  on purpose: every field is meant to be rendered inline next to a
 *  single sentence; the userscript is allergic to deep nesting. */
export interface PolygraphVerifyResult {
  /** Normalised verdict family — drives the dot colour. */
  verdict: "trustworthy" | "mixed" | "refuted" | "impossible" | "unknown";
  /** Dot colour the userscript should render. `grey` only when verdict
   *  is `unknown` (bridge offline, claim too vague, etc). */
  color: "green" | "yellow" | "red" | "grey";
  /** Confidence in 0..1. */
  confidence: number;
  /** One short sentence the userscript shows on hover. */
  oneLine: string;
  /** What the user / receiving AI should do next (e.g. "do not relay"). */
  nextAction?: string;
  /** Server-side latency in milliseconds. */
  latencyMs: number;
  /** Engine that produced the verdict (propositional / z3 / heuristic). */
  engine?: string;
}

/** v2.19.83 — PORT LADDER constants. Browser userscript + CLI + bridge
 *  all share this ladder so they can rendezvous WITHOUT any config sync
 *  or central registry: each side independently probes 17741, 17742, …,
 *  17750 and meets the other on the first port both can use.
 *
 *  Why a ladder of 10:
 *    - 17741 is unused by any well-known dev tool (verified against
 *      IANA + common-port registries: Ollama=11434, Postgres=5432,
 *      Redis=6379, MongoDB=27017, Mailpit=8025, …).
 *    - 10 alternates handles parallel installs across repos on one
 *      machine + dev sandboxes + WSL crossover without manual config.
 *    - Cold scan = 10 probes × <5ms = ~50ms worst case in the browser.
 */
export const POLYGRAPH_PORT_LADDER_BASE = 17741;
export const POLYGRAPH_PORT_LADDER_SIZE = 10;
export function polygraphPortLadder(): number[] {
  const out: number[] = [];
  for (let i = 0; i < POLYGRAPH_PORT_LADDER_SIZE; i++) out.push(POLYGRAPH_PORT_LADDER_BASE + i);
  return out;
}

/** v2.19.83 — Probe a port for availability with a throwaway TCP server.
 *  Closes the probe immediately on success so the real server can bind
 *  on the SAME port a moment later. Returns true if the port is free.
 *  Resolves quickly (~1ms) for free ports; ~1ms for occupied ports too
 *  (kernel returns EADDRINUSE synchronously on the listen call). */
function isPortFree(host: string, port: number, timeoutMs: number = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    let done = false;
    const finish = (free: boolean) => {
      if (done) return; done = true;
      try { probe.removeAllListeners(); probe.close(() => resolve(free)); }
      catch { resolve(free); }
    };
    probe.once("error", () => finish(false));
    probe.once("listening", () => finish(true));
    probe.listen(port, host);
    setTimeout(() => finish(false), timeoutMs);
  });
}

/** v2.19.83 — Find the first free port in the polygraph ladder.
 *  Returns the port number, or throws if every port in the ladder is
 *  occupied. Probes sequentially (not in parallel) so we always favour
 *  the lowest free port + don't waste OS sockets. */
async function findFreePortInLadder(host: string, ladder: number[]): Promise<number> {
  for (const port of ladder) {
    if (await isPortFree(host, port)) return port;
  }
  throw new Error(`Mneme bridge: every port in ladder is occupied (${ladder.join(", ")})`);
}

/** Start the HTTP bridge. Returns a handle the caller stops on shutdown.
 *  v2.19.82 — default port changed 11434 → 17741 (Ollama collision).
 *  v2.19.83 — when no explicit `port` is given, walk the ladder
 *  17741..17750 and pick the first free one. Bullet-proof against
 *  multi-Mneme parallel installs + sibling tools that happen to grab
 *  17741 first. */
export async function startBridge(opts: BridgeOptions, handlers: BridgeHandlers): Promise<BridgeHandle> {
  const fixedPort = opts.port;
  const host = opts.host ?? "127.0.0.1";
  const token = opts.noAuth ? "" : ensureToken(opts.repoRoot);

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) return json(res, 429, { error: "rate-limited" });

    setCors(req, res, opts.extraCorsOrigins);
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

    // v1.84 Bug R5-1: /v1/health used to short-circuit auth and leak
    // version + protocols + repo fingerprint to any unauthenticated
    // scanner. Now auth-required by default; only the brand-new
    // /v1/ping endpoint is unauthenticated (returns ok:true, nothing else).
    if (req.url === "/v1/ping" && req.method === "GET") {
      return json(res, 200, { ok: true });
    }

    // Auth required for ALL real endpoints (health / openapi / precog / ...).
    if (!opts.noAuth && !isAuthorized(req, token)) {
      return json(res, 401, { error: "unauthorized -- set Authorization: Bearer <token>" });
    }

    if (req.url === "/v1/health" && req.method === "GET") {
      return json(res, 200, { ok: true, version: "1.72.0", protocols: ["precog", "sentinel", "apoptosis", "polygraph", "pulse"] });
    }

    if (req.url === "/v1/openapi.json" && req.method === "GET") {
      // baseUrl uses the actual bound port (may differ from fixedPort
      // after a ladder walk).  Resolves at request-time, not start-time.
      const bound = (server.address() as { port: number } | null)?.port ?? fixedPort ?? POLYGRAPH_PORT_LADDER_BASE;
      return json(res, 200, openapiSpec(`http://${host}:${bound}`));
    }

    // Defensive double-check (handlers below assume auth already enforced).
    if (!opts.noAuth && !isAuthorized(req, token)) {
      return json(res, 401, { error: "unauthorized -- set Authorization: Bearer <token>" });
    }

    try {
      if (req.url === "/v1/precog" && req.method === "POST" && handlers.precog) {
        const body = await readJsonBody(req) as { claim?: string };
        if (typeof body.claim !== "string") return json(res, 400, { error: "claim field required" });
        const r = await handlers.precog(body.claim);
        return json(res, 200, r);
      }
      if (req.url === "/v1/sentinel" && req.method === "POST" && handlers.sentinel) {
        const body = await readJsonBody(req) as { command?: string; vendor?: string };
        if (typeof body.command !== "string") return json(res, 400, { error: "command field required" });
        const r = await handlers.sentinel(body.command, body.vendor);
        return json(res, 200, r);
      }
      if (req.url === "/v1/apoptosis" && req.method === "POST" && handlers.apoptosis) {
        const body = await readJsonBody(req) as { claim?: string };
        if (typeof body.claim !== "string") return json(res, 400, { error: "claim field required" });
        const r = await handlers.apoptosis(body.claim);
        return json(res, 200, r);
      }
      // v2.19.84 — WORLD AI PULSE record. Browser userscript fires one
      // event per dot it renders. Fire-and-forget; we never block the
      // userscript on this round-trip.
      if (req.url === "/v1/pulse/events" && req.method === "POST" && handlers.pulseRecord) {
        const body = await readJsonBody(req) as PulsePostBody;
        const r = await handlers.pulseRecord(body || {});
        return json(res, 200, r);
      }
      // v2.19.84 — WORLD AI PULSE aggregate. Dashboard "World Pulse"
      // view calls this on mount + every 5s to refresh the globe.
      if (req.url?.startsWith("/v1/pulse/aggregate") && req.method === "GET" && handlers.pulseAggregate) {
        const url = new URL(req.url, "http://x");
        const windowHours = parseInt(url.searchParams.get("windowHours") || "24", 10);
        const includeSynthetic = url.searchParams.get("includeSynthetic") === "true";
        const r = await handlers.pulseAggregate({ windowHours, includeSynthetic });
        return json(res, 200, r);
      }
      // v2.19.86 — IDEA #3 — Honesty Certificate mint. Dashboard "Mint
      // cert" button POSTs vendor + windowDays; we read the pulse
      // aggregate, compute the Wilson-LB tier, sign, return cert + SVG.
      if (req.url === "/v1/honesty/mint" && req.method === "POST" && handlers.honestyMint) {
        const body = await readJsonBody(req) as { vendor?: string; windowDays?: number; validDays?: number };
        if (typeof body.vendor !== "string") return json(res, 400, { error: "vendor field required" });
        const r = await handlers.honestyMint(body as { vendor: string; windowDays?: number; validDays?: number });
        return json(res, 200, r);
      }
      // v2.19.86 — IDEA #3 — Honesty Certificate verify (accepts either
      // a parsed JSON cert OR the raw SVG string with embedded payload).
      if (req.url === "/v1/honesty/verify" && req.method === "POST" && handlers.honestyVerify) {
        const body = await readJsonBody(req) as { cert?: unknown; svg?: string };
        const r = await handlers.honestyVerify(body || {});
        return json(res, 200, r);
      }
      // v2.19.86 — IDEA #4 — Time-Machine timeline series.
      if (req.url?.startsWith("/v1/polygraph/timeline") && req.method === "GET" && handlers.timelineSeries) {
        const url = new URL(req.url, "http://x");
        const vendor = url.searchParams.get("vendor");
        if (!vendor) return json(res, 400, { error: "vendor query param required" });
        const windowDays = parseInt(url.searchParams.get("windowDays") || "30", 10);
        const bucketHours = parseInt(url.searchParams.get("bucketHours") || "24", 10);
        const r = await handlers.timelineSeries({ vendor, windowDays, bucketHours });
        return json(res, 200, r);
      }
      // v2.19.85 — SANDBAG AUTO-CAPTURE. Userscript posts a PROD+TEST
      // pair captured around a user "are you sure?" hedge. The handler
      // records both legs into the AEGIS A3 ledger so the sandbag
      // detector can flag drift the next time `polygraph drift` runs.
      if (req.url === "/v1/polygraph/sandbag-capture" && req.method === "POST" && handlers.sandbagCapture) {
        const body = await readJsonBody(req) as SandbagCaptureBody;
        const r = await handlers.sandbagCapture(body || {});
        return json(res, 200, r);
      }
      // v2.19.80 — Browser Polygraph: a single sentence from a streaming
      // AI response. The userscript fires one POST per detected sentence
      // (batched on the client). We accept very tight error tolerances
      // (short / empty / non-string → grey unknown verdict, never 500)
      // because this endpoint runs in the user's eye-line and a 500 would
      // surface as a broken dot in their AI chat.
      if (req.url === "/v1/polygraph/verify" && req.method === "POST" && handlers.polygraphVerify) {
        // v2.28.0 B10 fix — accept `claim`, `text`, OR `sentence` as the
        // payload field. Pre-v2.28 the bridge required `sentence` ONLY;
        // a POST with `{claim:"..."}` returned engine:"noop" + made it
        // look like the polygraph was a stub. Now all three aliases work.
        const body = await readJsonBody(req) as { sentence?: string; claim?: string; text?: string; context?: string; vendor?: string };
        const rawSentence = body.sentence ?? body.claim ?? body.text ?? "";
        const sentence = typeof rawSentence === "string" ? rawSentence.trim() : "";
        if (!sentence) {
          // Never 4xx for empty input — the userscript will fire on
          // nearly-empty chunks while a response streams; respond grey.
          return json(res, 200, {
            verdict: "unknown", color: "grey", confidence: 0,
            oneLine: "empty sentence — pass `sentence`, `claim`, or `text` field with text to verify",
            latencyMs: 0, engine: "noop",
          } satisfies PolygraphVerifyResult);
        }
        const t0 = Date.now();
        const r = await handlers.polygraphVerify({ sentence, context: body.context, vendor: body.vendor });
        // Defensive: ensure latency is set even if handler forgot.
        const out: PolygraphVerifyResult = { ...r, latencyMs: r.latencyMs || (Date.now() - t0) };
        return json(res, 200, out);
      }
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }

    return json(res, 404, { error: "not found" });
  });

  // v2.19.83 — PROBE-FIRST ladder walk. If caller pinned a port we use
  // it as-is (any conflict bubbles as a real error). Otherwise we probe
  // each ladder port with a throwaway TCP server until one is free,
  // then bind the real HTTP server on that exact port. Probing
  // separately from binding lets the HTTP server stay clean across
  // ladder attempts (HTTP servers don't recover gracefully from
  // mid-listen errors).
  const port = fixedPort != null
    ? fixedPort
    : await findFreePortInLadder(host, polygraphPortLadder());

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error) => { server.off("listening", onOk); reject(e); };
    const onOk = () => { server.off("error", onErr); resolve(); };
    server.once("error", onErr);
    server.once("listening", onOk);
    server.listen(port, host);
  });

  const baseUrl = `http://${host}:${port}`;

  // v2.19.83 — Write the bridge beacon so CLI tools + AI agents can
  // discover the live bridge WITHOUT re-probing the ladder. The
  // userscript still probes (browser can't read the filesystem) but
  // every host-side consumer reads this file as the single source
  // of truth.
  try {
    const beaconDir = join(opts.repoRoot, ".mneme");
    if (!existsSync(beaconDir)) mkdirSync(beaconDir, { recursive: true });
    const beacon = {
      host, port, baseUrl,
      token: opts.noAuth ? null : token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ladderBase: POLYGRAPH_PORT_LADDER_BASE,
      ladderSize: POLYGRAPH_PORT_LADDER_SIZE,
      protocols: ["precog", "sentinel", "apoptosis", "polygraph", "pulse"],
    };
    writeFileSync(join(beaconDir, "bridge.json"), JSON.stringify(beacon, null, 2), "utf8");
  } catch { /* non-fatal — bridge still works; just no beacon file */ }

  const stop = async () => {
    // Clean up the beacon on graceful shutdown so stale data doesn't
    // confuse CLI status checks. PID files etc. are not touched (other
    // commands own those).
    try { unlinkSync(join(opts.repoRoot, ".mneme", "bridge.json")); } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { server, port, host, token, baseUrl, stop };
}

/** Custom GPT template -- printed to user; they upload this JSON into the
 *  Custom GPT "Actions" config. */
export function customGptTemplate(baseUrl: string, token: string): string {
  return JSON.stringify({
    name: "Mneme Bridge",
    description: "Run claims through Mneme's PRECOG / SENTINEL / APOPTOSIS firewalls before delivering to the user.",
    instructions: "Before answering any factual question about code, repos, or commands, POST the AI's draft answer to /v1/precog. If verdict is CERTIFIED, deliver. If HEDGED, deliver the hedged version. If REJECTED, refuse + explain. Before suggesting any shell command, POST it to /v1/sentinel; only execute on ALLOW or AUDIT.",
    authentication: { type: "bearer", token },
    actionEndpoint: `${baseUrl}/v1/openapi.json`,
  }, null, 2);
}
