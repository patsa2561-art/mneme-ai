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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_FILE = ".mneme/http-token";
const ALLOWED_ORIGINS = ["https://chat.openai.com", "https://chatgpt.com"];

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
  if (allow) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    },
  };
}

export interface BridgeHandlers {
  precog?: (claim: string) => Promise<unknown> | unknown;
  sentinel?: (command: string, vendor?: string) => Promise<unknown> | unknown;
  apoptosis?: (claim: string) => Promise<unknown> | unknown;
}

/** Start the HTTP bridge. Returns a handle the caller stops on shutdown. */
export async function startBridge(opts: BridgeOptions, handlers: BridgeHandlers): Promise<BridgeHandle> {
  const port = opts.port ?? 11434;
  const host = opts.host ?? "127.0.0.1";
  const token = opts.noAuth ? "" : ensureToken(opts.repoRoot);
  const baseUrl = `http://${host}:${port}`;

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
      return json(res, 200, { ok: true, version: "1.72.0", protocols: ["precog", "sentinel", "apoptosis"] });
    }

    if (req.url === "/v1/openapi.json" && req.method === "GET") {
      return json(res, 200, openapiSpec(baseUrl));
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
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }

    return json(res, 404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  const stop = async () => {
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
