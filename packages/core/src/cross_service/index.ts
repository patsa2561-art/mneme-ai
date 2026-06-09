/**
 * CROSS-SERVICE CONTRACT GRAPH — the cross-layer blast radius, at ORG scale.
 *
 * The cross-layer graph answers "what breaks across layers in THIS repo?". Real systems — and the AI
 * agents now acting across them — span many services. Service A declares `POST /v1/charge`; service B
 * calls `fetch("/v1/charge")`. Remove or rename that route in A and B breaks — across REPOS, invisible
 * to every per-repo tool and to `git`. This links each service's PRODUCED endpoints (its route
 * definitions) to the CONSUMED endpoints other services call (their HTTP-client calls), by URL path —
 * an inter-service contract map + "who breaks if this endpoint changes" across the whole org.
 *
 * ★HONEST (DIAKRISIS): a DETERMINISTIC, no-LLM matcher on URL paths — a contract map to verify, not a
 * proven runtime call. Matching is path-based (params normalized to `*`); a gateway prefix, a base-URL
 * difference, or a dynamically-built URL can cause a miss → it surfaces what it can prove structurally
 * (including DANGLING consumers — a call to an endpoint no known service produces), never a guess.
 */
import { type SourceFile } from "../cross_layer_graph/index.js";

const MAX = 600_000;
export interface Endpoint { method: string; path: string; norm: string }
export interface Service { name: string; files: ReadonlyArray<SourceFile> }
export interface ServiceEdge { from: string; to: string; method: string; path: string; norm: string }
export interface DanglingConsumer { service: string; method: string; path: string }
export interface CrossServiceGraph { services: string[]; produced: Record<string, Endpoint[]>; consumed: Record<string, Endpoint[]>; edges: ServiceEdge[]; dangling: DanglingConsumer[] }

/** Normalize a URL path for matching: strip protocol+host+query, lowercase, params → '*', no trailing /. */
export function normPath(p: string): string {
  let s = String(p || "").trim();
  s = s.replace(/^https?:\/\/[^/]+/i, "");          // strip scheme+host
  s = s.replace(/[?#].*$/, "");                      // strip query/hash
  s = s.replace(/\$\{[^}]*\}/g, "*");                // template ${id}
  s = s.replace(/:[A-Za-z_]\w*/g, "*");              // :id
  s = s.replace(/\{[^}]*\}/g, "*");                  // {id}
  s = s.toLowerCase().replace(/\/+$/, "");           // trailing slash
  if (!s.startsWith("/")) s = "/" + s;
  return s || "/";
}
const looksLikePath = (p: string) => /^(https?:\/\/|\/)/.test(p) && p.length > 1 && !/\s/.test(p) && !/\.(png|jpg|svg|css|js|json|woff2?|ico)$/i.test(p);
/** Segment-wise path match where a `*` on EITHER side (a route param) matches any one segment. */
export function pathsMatch(a: string, b: string): boolean {
  const sa = a.split("/"), sb = b.split("/");
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) { if (sa[i] === "*" || sb[i] === "*") continue; if (sa[i] !== sb[i]) return false; }
  return true;
}

/** PRODUCED endpoints — route definitions (express/fastify/koa/router style). */
export function extractProduced(files: ReadonlyArray<SourceFile>): Endpoint[] {
  const out = new Map<string, Endpoint>();
  for (const f of files ?? []) {
    const c = f.content.slice(0, MAX);
    for (const m of c.matchAll(/\b(?:app|router|fastify|server|api|route|r)\.(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
      const method = m[1].toUpperCase(), path = m[2]; const norm = normPath(path);
      if (norm !== "/" || path === "/") out.set(method + " " + norm, { method, path, norm });
    }
  }
  return [...out.values()];
}
/** CONSUMED endpoints — HTTP-client calls (fetch / axios / got / ky / a named *client*) with a literal path. */
export function extractConsumed(files: ReadonlyArray<SourceFile>): Endpoint[] {
  const out = new Map<string, Endpoint>();
  const add = (method: string, path: string) => { if (!looksLikePath(path)) return; const norm = normPath(path); out.set(method + " " + norm, { method, path, norm }); };
  for (const f of files ?? []) {
    const c = f.content.slice(0, MAX);
    for (const m of c.matchAll(/\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g)) add("ANY", m[1]);
    // fetch(url,{method:'POST'})
    for (const m of c.matchAll(/\bfetch\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{[^}]*method\s*:\s*["'`](get|post|put|patch|delete)["'`]/gi)) add(m[2].toUpperCase(), m[1]);
    for (const m of c.matchAll(/\b(?:axios|http|https|client|api|apiClient|httpClient|ky|got|request|superagent|\$http)\.(get|post|put|patch|delete|request)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) add(m[1].toUpperCase() === "REQUEST" ? "ANY" : m[1].toUpperCase(), m[2]);
    for (const m of c.matchAll(/\baxios\s*\(\s*\{[^}]*url\s*:\s*["'`]([^"'`]+)["'`]/gi)) add("ANY", m[1]);
  }
  return [...out.values()];
}
const methodsMatch = (a: string, b: string) => a === "ANY" || b === "ANY" || a === b;

/** Build the inter-service contract graph: who consumes whose endpoints, + dangling (no producer) calls. */
export function crossServiceGraph(services: ReadonlyArray<Service>): CrossServiceGraph {
  const list = (services ?? []).filter((s) => s && s.name);
  const produced: Record<string, Endpoint[]> = {}; const consumed: Record<string, Endpoint[]> = {};
  for (const s of list) { produced[s.name] = extractProduced(s.files); consumed[s.name] = extractConsumed(s.files); }
  const edges: ServiceEdge[] = []; const dangling: DanglingConsumer[] = [];
  for (const s of list) {
    for (const cep of consumed[s.name]) {
      let matched = false;
      for (const t of list) {
        if (t.name === s.name) continue;
        const hit = produced[t.name].find((pep) => pathsMatch(cep.norm, pep.norm) && methodsMatch(cep.method, pep.method));
        if (hit) { edges.push({ from: s.name, to: t.name, method: hit.method, path: hit.path, norm: hit.norm }); matched = true; }
      }
      if (!matched) dangling.push({ service: s.name, method: cep.method, path: cep.path });
    }
  }
  return { services: list.map((s) => s.name), produced, consumed, edges, dangling };
}
/** Who breaks if `service` removes/changes `endpointPath` — the cross-service consumers of it. */
export function serviceImpact(graph: CrossServiceGraph, service: string, endpointPath: string): { consumers: ServiceEdge[]; safe: boolean; reason: string } {
  const norm = normPath(endpointPath);
  const consumers = (graph?.edges ?? []).filter((e) => e.to === service && pathsMatch(normPath(e.path), norm));
  const safe = consumers.length === 0;
  return { consumers, safe, reason: safe ? `no other service consumes ${service}'s ${endpointPath} (safe to change — verify external/dynamic callers)` : `changing ${service}'s ${endpointPath} breaks ${consumers.length} consumer service(s): ${[...new Set(consumers.map((c) => c.from))].join(", ")}` };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface CrossServiceGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function crossServiceGauntlet(): CrossServiceGauntlet {
  const services: Service[] = [
    { name: "users", files: [{ path: "routes.ts", content: "router.get(\"/v1/users/:id\", getUser);" }] },
    { name: "orders", files: [{ path: "routes.ts", content: "app.post(\"/v1/charge\", doCharge);" }, { path: "client.ts", content: "fetch(\"/v1/users/123\");" }] },
    { name: "web", files: [{ path: "api.ts", content: "axios.post(\"/v1/charge\", body);\nfetch(\"/v1/unknown-thing\");" }] },
  ];
  const g = crossServiceGraph(services);
  const webChargesOrders = g.edges.some((e) => e.from === "web" && e.to === "orders" && e.path === "/v1/charge");
  const ordersReadsUsers = g.edges.some((e) => e.from === "orders" && e.to === "users" && e.norm === "/v1/users/*");   // param normalized
  const dangling = g.dangling.some((d) => d.service === "web" && /unknown-thing/.test(d.path));
  const impact = serviceImpact(g, "orders", "/v1/charge");
  const impactOK = !impact.safe && impact.consumers.some((c) => c.from === "web");
  const safeOK = serviceImpact(g, "users", "/v1/nonexistent").safe;
  const total = (() => { try { crossServiceGraph(null as never); serviceImpact(null as never, "a", "b"); extractConsumed(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "CONSUMER→PRODUCER", pass: webChargesOrders, detail: "web's axios.post('/v1/charge') links to orders' route → a cross-service edge git can't see" },
    { name: "PARAM-NORMALIZED-MATCH", pass: ordersReadsUsers, detail: "fetch('/v1/users/123') matches route '/v1/users/:id' (params normalized to *)" },
    { name: "DANGLING-CONSUMER", pass: dangling, detail: "a call to an endpoint NO service produces → flagged (broken contract or external API)" },
    { name: "SERVICE-IMPACT", pass: impactOK, detail: "changing orders' /v1/charge → breaks consumer service 'web'" },
    { name: "SAFE-WHEN-UNUSED", pass: safeOK, detail: "an endpoint no one consumes → safe to change (no false alarm)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
