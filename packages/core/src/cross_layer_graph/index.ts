/**
 * CROSS-LAYER GRAPH — the deterministic answer to "if I change this code, what ELSE breaks — across
 * layers?" Every graph tool maps code→code; this links three layers that normally live in different
 * tools: CODE (functions) ↔ DATA (db tables, from the ORM/migration schema) ↔ API (endpoints, from
 * the route files). Then it computes a CROSS-LAYER BLAST RADIUS: edit `createUserWallet` → it touches
 * the `wallets` table AND is reached by `POST /v1/auth/register` → all three light up at once.
 *
 * ★HONEST (DIAKRISIS): this is a DETERMINISTIC, no-LLM extractor — every node + edge is derived by
 * structural pattern from files that already exist in the repo (Prisma/SQL schema, express/fastify
 * route calls, JS/TS function decls), so nothing is hallucinated. The trade-off is the inverse of an
 * LLM's: it does NOT guess intent, so an edge it can't prove structurally is simply absent (it
 * surfaces COUPLING you can verify, not a proven runtime call-path). Function "bodies" are approximated
 * by region (def→next-def), which is a heuristic, not a full AST. The win is the cross-layer JOIN that
 * no single-layer code-graph reports, computed without a model and signable.
 */
export type NodeType = "function" | "db_table" | "api_endpoint";
export interface GNode { id: string; type: NodeType; name: string; file?: string; method?: string }
export type Relation = "WRITES_TO" | "READS" | "HANDLED_BY" | "CALLS";
export interface GEdge { source: string; target: string; relation: Relation }
export interface CrossLayerGraph { nodes: GNode[]; edges: GEdge[] }
export interface SourceFile { path: string; content: string }

const MAX_FILE = 600_000;
const lc = (s: string) => s.toLowerCase();
const word = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "");

/** Pluralization-tolerant token match: does `body` reference table `t` (or its camelCase client form)? */
function bodyTouchesTable(body: string, table: string): { hit: boolean; write: boolean } {
  const b = lc(body); const t = lc(table);
  const camel = t.charAt(0) + t.slice(1);                          // prisma client form: model User → prisma.user
  // PRECISION over recall: only a real DB-access shape counts (a bare token like the word "user"
  // appearing anywhere is far too noisy — it manufactured thousands of false edges on a real repo).
  const patterns = [
    new RegExp(`prisma\\.${camel}\\b`),                            // prisma.user.create(...)
    new RegExp(`\\bfrom\\s+["'\`]?${t}\\b`),                       // SQL FROM users
    new RegExp(`\\b(into|update|join|table)\\s+["'\`]?${t}\\b`),   // SQL INSERT INTO / UPDATE / JOIN
    new RegExp(`\\b${t}(s)?\\.(find|create|update|delete|save|insert|destroy|upsert)\\b`), // ORM repo: userRepo.find / users.create
  ];
  const hit = patterns.some((re) => re.test(b));
  if (!hit) return { hit: false, write: false };
  const write = new RegExp(`prisma\\.${camel}\\.(create|update|delete|upsert|createmany|updatemany|deletemany)\\b`).test(b)
    || new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+["'\`]?${t}\\b`).test(b)
    || new RegExp(`\\b${t}\\.(save|insert|update|delete|destroy)\\b`).test(b);
  return { hit: true, write };
}

/** Extract every db_table node from Prisma models + SQL CREATE TABLE. Deterministic. */
function extractTables(files: SourceFile[]): GNode[] {
  const out = new Map<string, GNode>();
  for (const f of files) {
    const c = f.content.slice(0, MAX_FILE);
    for (const m of c.matchAll(/\bmodel\s+([A-Za-z_]\w*)\s*\{/g)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }
    for (const m of c.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_]\w*)/gi)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }
  }
  return [...out.values()];
}

/** Extract api_endpoint nodes + the handler names referenced in each route call. */
function extractEndpoints(files: SourceFile[]): Array<{ node: GNode; handlers: string[] }> {
  const out: Array<{ node: GNode; handlers: string[] }> = [];
  for (const f of files) {
    const c = f.content.slice(0, MAX_FILE);
    for (const m of c.matchAll(/\b(?:app|router|fastify|server|api)\.(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]([^)]*)\)/gi)) {
      const method = m[1].toUpperCase(); const path = m[2]; const argTail = m[3] || "";
      const id = `api:${method} ${path}`;
      const handlers = [...argTail.matchAll(/([A-Za-z_]\w*)\s*(?:[,)]|$)/g)].map((x) => x[1]).filter((h) => h && !["req", "res", "next", "ctx"].includes(lc(h)));
      out.push({ node: { id, type: "api_endpoint", name: path, method, file: f.path }, handlers });
    }
  }
  return out;
}

/** Extract function nodes + their approximate body region (def → next def). Heuristic, deterministic. */
function extractFunctions(files: SourceFile[]): Array<GNode & { body: string }> {
  const out: Array<GNode & { body: string }> = [];
  for (const f of files) {
    const c = f.content.slice(0, MAX_FILE);
    const marks: Array<{ name: string; idx: number }> = [];
    const reFn = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/g;
    const reArrow = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/g;
    for (const m of c.matchAll(reFn)) marks.push({ name: m[1], idx: m.index ?? 0 });
    for (const m of c.matchAll(reArrow)) marks.push({ name: m[1], idx: m.index ?? 0 });
    marks.sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].idx; const end = i + 1 < marks.length ? marks[i + 1].idx : c.length;
      out.push({ id: `fn:${f.path}#${marks[i].name}`, type: "function", name: marks[i].name, file: f.path, body: c.slice(start, end) });
    }
  }
  return out;
}

/** Build the full cross-layer graph from a set of source files. Pure + deterministic. */
export function buildCrossLayerGraph(files: ReadonlyArray<SourceFile>): CrossLayerGraph {
  const safe = (files ?? []).filter((f) => f && typeof f.content === "string" && typeof f.path === "string");
  const tables = extractTables(safe as SourceFile[]);
  const endpoints = extractEndpoints(safe as SourceFile[]);
  const fns = extractFunctions(safe as SourceFile[]);
  const nodes: GNode[] = [...fns.map(({ body: _b, ...n }) => n), ...tables, ...endpoints.map((e) => e.node)];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, relation: Relation) => { const k = `${source}|${target}|${relation}`; if (!seen.has(k)) { seen.add(k); edges.push({ source, target, relation }); } };
  const fnByName = new Map<string, GNode[]>();
  for (const fn of fns) { const a = fnByName.get(fn.name) ?? []; a.push(fn); fnByName.set(fn.name, a); }
  // function → db_table (WRITES_TO / READS)
  for (const fn of fns) for (const t of tables) { const r = bodyTouchesTable(fn.body, t.name); if (r.hit) addEdge(fn.id, t.id, r.write ? "WRITES_TO" : "READS"); }
  // api_endpoint → function (HANDLED_BY) — link the route's named handler to its function def(s)
  for (const e of endpoints) for (const h of e.handlers) for (const fn of (fnByName.get(h) ?? [])) addEdge(e.node.id, fn.id, "HANDLED_BY");
  // function → function (CALLS) — body references another function's name as a call. Skip ultra-common
  // / too-short identifiers (out, get, map, run…) — they manufacture a dense, useless call graph.
  const COMMON = new Set(["out", "get", "set", "run", "map", "log", "cb", "fn", "on", "to", "is", "do", "go", "of", "as", "at", "err", "res", "req", "ctx", "val", "key", "len", "tmp", "max", "min", "sum", "add", "has", "now", "end"]);
  for (const fn of fns) for (const [name, defs] of fnByName) { if (name === fn.name || name.length < 3 || COMMON.has(lc(name))) continue; if (new RegExp(`\\b${name}\\s*\\(`).test(fn.body)) for (const d of defs) addEdge(fn.id, d.id, "CALLS"); }
  return { nodes, edges };
}

export interface BlastRadius { origin: string; tables: GNode[]; endpoints: GNode[]; functions: GNode[]; depth: number; reachable: number }
/**
 * CROSS-LAYER BLAST RADIUS — from a node, the impact closure across all three layers. Edges are
 * treated as bidirectional COUPLING (changing either end can affect the other), BFS with an optional
 * depth cap. Honest: this is reachable coupling to inspect, not a proven runtime break.
 */
export function blastRadius(graph: CrossLayerGraph, originId: string, opts?: { maxDepth?: number }): BlastRadius {
  const maxDepth = opts?.maxDepth ?? Infinity;
  const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of graph?.edges ?? []) { (adj.get(e.source) ?? adj.set(e.source, []).get(e.source))!.push(e.target); (adj.get(e.target) ?? adj.set(e.target, []).get(e.target))!.push(e.source); }
  const seen = new Set<string>([originId]); let frontier = [originId]; let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
    if (!next.length) break; frontier = next; depth++;
  }
  seen.delete(originId);
  const hit = [...seen].map((id) => byId.get(id)).filter((n): n is GNode => !!n);
  return { origin: originId, tables: hit.filter((n) => n.type === "db_table"), endpoints: hit.filter((n) => n.type === "api_endpoint"), functions: hit.filter((n) => n.type === "function"), depth, reachable: hit.length };
}

/** Find a node id by a loose name (function name, table name, or endpoint path). First match. */
export function resolveNode(graph: CrossLayerGraph, query: string): GNode | null {
  const q = lc(word(query)); const nodes = graph?.nodes ?? [];
  return nodes.find((n) => lc(word(n.name)) === q) ?? nodes.find((n) => lc(n.name).includes(lc(query))) ?? null;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface CLGGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function crossLayerGauntlet(): CLGGauntlet {
  const files: SourceFile[] = [
    { path: "schema.prisma", content: "model User {\n id Int @id\n}\nmodel Wallet {\n id Int @id\n}" },
    { path: "auth.ts", content: "export async function registerHandler(req, res) {\n  await prisma.user.create({ data: {} });\n  await createUserWallet(req.body.id);\n}\nexport function createUserWallet(uid) {\n  return prisma.wallet.create({ data: { uid } });\n}" },
    { path: "routes.ts", content: "router.post(\"/v1/auth/register\", registerHandler);\napp.get(\"/v1/health\", healthCheck);" },
  ];
  const g = buildCrossLayerGraph(files);
  const hasTable = g.nodes.some((n) => n.type === "db_table" && n.name === "Wallet");
  const hasEndpoint = g.nodes.some((n) => n.type === "api_endpoint" && n.name === "/v1/auth/register");
  const hasFn = g.nodes.some((n) => n.type === "function" && n.name === "createUserWallet");
  const writeEdge = g.edges.some((e) => e.relation === "WRITES_TO" && e.target === "db:wallet");
  const handledBy = g.edges.some((e) => e.relation === "HANDLED_BY" && e.source.startsWith("api:POST /v1/auth/register"));
  const callsEdge = g.edges.some((e) => e.relation === "CALLS" && e.target.endsWith("#createUserWallet"));
  // CROSS-LAYER BLAST: editing createUserWallet → reaches wallet table (write) + register endpoint (via caller)
  const node = resolveNode(g, "createUserWallet");
  const br = node ? blastRadius(g, node.id) : null;
  const crossLayer = !!br && br.tables.some((t) => t.name === "Wallet") && br.endpoints.some((e) => e.name === "/v1/auth/register");
  const noHallucination = g.edges.every((e) => g.nodes.some((n) => n.id === e.source) && g.nodes.some((n) => n.id === e.target));
  const total = (() => { try { buildCrossLayerGraph(null as never); blastRadius(null as never, "x"); resolveNode(null as never, "x"); return true; } catch { return false; } })();
  const checks = [
    { name: "EXTRACT-3-LAYERS", pass: hasTable && hasEndpoint && hasFn, detail: "db_table (Prisma) + api_endpoint (route) + function (decl) all extracted deterministically" },
    { name: "WRITE-EDGE", pass: writeEdge, detail: "function → db_table WRITES_TO (prisma.wallet.create)" },
    { name: "HANDLED-BY", pass: handledBy, detail: "api_endpoint → function HANDLED_BY (route's named handler)" },
    { name: "CALL-EDGE", pass: callsEdge, detail: "function → function CALLS (body references the callee)" },
    { name: "CROSS-LAYER-BLAST", pass: crossLayer, detail: "edit createUserWallet → blast radius spans the wallet TABLE + the register ENDPOINT (the cross-layer join no single-layer graph reports)" },
    { name: "NO-HALLUCINATION", pass: noHallucination, detail: "every edge endpoint is a real extracted node — nothing invented" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
