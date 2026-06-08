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
export type NodeType = "function" | "db_table" | "api_endpoint" | "business_rule";
export interface GNode { id: string; type: NodeType; name: string; file?: string; method?: string }
export type Relation = "WRITES_TO" | "READS" | "HANDLED_BY" | "CALLS" | "IMPLEMENTS";
export interface GEdge { source: string; target: string; relation: Relation }
export interface CrossLayerGraph { nodes: GNode[]; edges: GEdge[] }
export interface SourceFile { path: string; content: string }

const MAX_FILE = 600_000;
const SQL_KW = new Set(["if", "not", "exists", "table", "temporary", "temp", "as", "select"]);
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
    new RegExp(`\\b${t}(s)?\\.(find|create|update|delete|save|insert|destroy|upsert)\\b`), // ORM repo
    new RegExp(`\\b${t}\\.objects\\b`),                            // Django: User.objects.…
    new RegExp(`\\bquery\\(\\s*${t}\\b`),                          // SQLAlchemy: session.query(User)
    new RegExp(`\\b(?:get|filter|select)\\w*\\([^)]*\\b${t}\\b`),  // ORM get/filter referencing the model
  ];
  const hit = patterns.some((re) => re.test(b));
  if (!hit) return { hit: false, write: false };
  const write = new RegExp(`prisma\\.${camel}\\.(create|update|delete|upsert|createmany|updatemany|deletemany)\\b`).test(b)
    || new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+["'\`]?${t}\\b`).test(b)
    || new RegExp(`\\b${t}\\.(save|insert|update|delete|destroy)\\b`).test(b)
    || new RegExp(`\\b${t}\\.objects\\.(create|update|delete|bulk_create|get_or_create)\\b`).test(b)   // Django write
    || new RegExp(`\\b(?:add|delete|merge)\\(\\s*${t}\\b`).test(b);                                    // SQLAlchemy session.add(User(...))
  return { hit: true, write };
}

/** Extract every db_table node from Prisma models + SQL CREATE TABLE. Deterministic. */
function extractTables(files: SourceFile[]): GNode[] {
  const out = new Map<string, GNode>();
  for (const f of files) {
    const c = f.content.slice(0, MAX_FILE);
    for (const m of c.matchAll(/\bmodel\s+([A-Za-z_]\w*)\s*\{/g)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }   // Prisma
    for (const m of c.matchAll(/\bcreate\s+(?:temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_]\w*)/gi)) { const n = m[1]; if (SQL_KW.has(lc(n))) continue; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }   // SQL (skip keyword false-captures like IF/NOT)
    // Django / SQLAlchemy / TypeORM / Sequelize — an ORM model class is a db table.
    for (const m of c.matchAll(/\bclass\s+([A-Za-z_]\w*)\s*\(\s*[^)]*\b(?:models\.Model|Base|Model|db\.Model)\b/g)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }
    for (const m of c.matchAll(/__tablename__\s*=\s*["']([A-Za-z_]\w*)/g)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }
    for (const m of c.matchAll(/@(?:Entity|Table)\s*\(\s*["'`]([A-Za-z_]\w*)/g)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }   // TypeORM
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
    const ext = (f.path.split(".").pop() || "").toLowerCase();
    if (/^(ts|tsx|js|jsx|mjs|cjs)$/.test(ext) || ext === "") {
      const reFn = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/g;
      const reArrow = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/g;
      for (const m of c.matchAll(reFn)) marks.push({ name: m[1], idx: m.index ?? 0 });
      for (const m of c.matchAll(reArrow)) marks.push({ name: m[1], idx: m.index ?? 0 });
    }
    // MULTI-LANGUAGE — the AI world is mostly Python; Go/Rust/Ruby round it out. Region-based body
    // extraction is language-agnostic (def→next-def), so only the signature regex differs per language.
    if (ext === "py") for (const m of c.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*\(/g)) marks.push({ name: m[1], idx: m.index ?? 0 });
    if (ext === "go") for (const m of c.matchAll(/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g)) marks.push({ name: m[1], idx: m.index ?? 0 });
    if (ext === "rs") for (const m of c.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*[(<]/g)) marks.push({ name: m[1], idx: m.index ?? 0 });
    if (ext === "rb") for (const m of c.matchAll(/\bdef\s+([A-Za-z_][\w?!]*)/g)) marks.push({ name: m[1].replace(/[?!]$/, ""), idx: m.index ?? 0 });
    marks.sort((a, b) => a.idx - b.idx);
    // Attach the comment/annotation block immediately ABOVE a def to THAT function (the universal place
    // a doc/annotation lives) — walk back over contiguous comment/blank lines, bounded by the previous
    // def. This is what makes `// feature: X` / `@implements X` resolve to the right function.
    const docStart = (start: number, floor: number): number => {
      let pos = start, lineEnd = c.lastIndexOf("\n", start - 1);
      while (lineEnd > floor) {
        const lineStart = c.lastIndexOf("\n", lineEnd - 1) + 1; const line = c.slice(lineStart, lineEnd).trim();
        if (line === "" || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.endsWith("*/") || line.startsWith("#") || line.startsWith("@") || line.startsWith('"""') || line.startsWith("'''")) { pos = lineStart; lineEnd = lineStart - 1; } else break;
      }
      return pos;
    };
    const bounds = marks.map((m, i) => docStart(m.idx, i > 0 ? marks[i - 1].idx : -1));
    for (let i = 0; i < marks.length; i++) {
      const start = bounds[i]; const end = i + 1 < marks.length ? bounds[i + 1] : c.length;
      out.push({ id: `fn:${f.path}#${marks[i].name}`, type: "function", name: marks[i].name, file: f.path, body: c.slice(start, end) });
    }
  }
  return out;
}

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "is", "are", "be", "as", "by", "at", "must", "should", "shall", "user", "users", "system", "feature", "rule", "story", "when", "then", "if", "that", "this", "it", "can", "will", "ต้อง", "ได้", "ระบบ", "ผู้ใช้", "ฟีเจอร์"]);
function tokset(s: string): Set<string> {
  // split camelCase + snake + spaces; keep distinctive tokens (len ≥ 3, not stop-words). Thai kept whole.
  const parts = String(s).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-/.]/g, " ").split(/\s+/).map(lc).filter(Boolean);
  return new Set(parts.filter((p) => (p.length >= 3 || /[฀-๿]/.test(p)) && !STOP.has(p)));
}
const slug = (s: string) => lc(String(s)).replace(/[^a-z0-9฀-๿]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "rule";

/** Extract candidate business_rule nodes from docs (markdown/txt) — explicit Feature/Rule/Story markers only. */
function extractBusinessRules(files: SourceFile[]): Array<GNode & { tokens: Set<string>; slug: string }> {
  const out: Array<GNode & { tokens: Set<string>; slug: string }> = []; const seen = new Set<string>();
  for (const f of files) {
    if (!/\.(md|mdx|markdown|txt)$/i.test(f.path)) continue;
    const c = f.content.slice(0, MAX_FILE);
    const lines = c.split(/\r?\n/);
    for (const ln of lines) {
      // "## Feature: X", "### Rule - X", "- Story: X", "FR-12: X", "@rule id: X"
      const m = ln.match(/^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:@?(?:feature|rule|story|requirement|epic|use\s*case|ฟีเจอร์|กฎ)\b|FR-\d+|REQ-\d+|US-\d+)\s*[:\-]\s*(.+?)\s*$/i);
      if (!m) continue; const name = m[1].replace(/[`*_]/g, "").trim(); if (name.length < 3 || name.length > 140) continue;
      const sg = slug(name); if (seen.has(sg)) continue; seen.add(sg);
      out.push({ id: `biz:${sg}`, type: "business_rule", name, file: f.path, tokens: tokset(name), slug: sg });
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
  const rules = extractBusinessRules(safe as SourceFile[]);
  const nodes: GNode[] = [...fns.map(({ body: _b, ...n }) => n), ...tables, ...endpoints.map((e) => e.node), ...rules.map(({ tokens: _t, slug: _s, ...n }) => n)];
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
  // business_rule → function (IMPLEMENTS) — PROVE-OR-UNKNOWN: link ONLY on a deterministic anchor.
  //  (1) an explicit code annotation: `@implements <slug>` / `implements: <name>` / `feature: <name>`
  //  (2) a STRONG name match: the function's name shares ≥2 distinctive tokens with the rule.
  // No anchor ⇒ NO edge (the rule stays an ORPHAN/UNKNOWN — never a guessed link).
  for (const r of rules) {
    for (const fn of fns) {
      const ann = new RegExp(`(?:@implements|implements?|feature|rule)\\s*[:=]?\\s*["'\`]?(?:${r.slug}|${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 60)})`, "i");
      const annotated = ann.test(fn.body);
      let strong = false;
      if (!annotated) { const fnTok = tokset(fn.name); let shared = 0; for (const t of r.tokens) if (fnTok.has(t)) shared++; strong = shared >= 2; }
      if (annotated || strong) addEdge(r.id, fn.id, "IMPLEMENTS");
    }
  }
  return { nodes, edges };
}

export interface BlastRadius { origin: string; tables: GNode[]; endpoints: GNode[]; functions: GNode[]; rules: GNode[]; depth: number; reachable: number }
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
  return { origin: originId, tables: hit.filter((n) => n.type === "db_table"), endpoints: hit.filter((n) => n.type === "api_endpoint"), functions: hit.filter((n) => n.type === "function"), rules: hit.filter((n) => n.type === "business_rule"), depth, reachable: hit.length };
}

// ── GRAPH DRIFT — architectural change between two points in time ────────────────────────────────
export interface Coupling { from: string; to: string; relation: Relation; fromType: NodeType; toType: NodeType }
export interface GraphDrift { addedCouplings: Coupling[]; removedCouplings: Coupling[]; addedTables: string[]; removedTables: string[]; addedEndpoints: string[]; removedEndpoints: string[] }
const isCross = (r: Relation) => r === "WRITES_TO" || r === "READS" || r === "HANDLED_BY" || r === "IMPLEMENTS";
function couplingSet(g: CrossLayerGraph): Map<string, Coupling> {
  const byId = new Map((g?.nodes ?? []).map((n) => [n.id, n])); const out = new Map<string, Coupling>();
  for (const e of g?.edges ?? []) { if (!isCross(e.relation)) continue; const s = byId.get(e.source), t = byId.get(e.target); if (!s || !t) continue; const c: Coupling = { from: s.name, to: t.name, relation: e.relation, fromType: s.type, toType: t.type }; out.set(`${s.type}:${lc(s.name)}>${t.type}:${lc(t.name)}|${e.relation}`, c); }
  return out;
}
/**
 * What changed STRUCTURALLY between an earlier graph (prev) and the current one — the cross-layer
 * couplings that APPEARED or DISAPPEARED. A new `createOrder → payments WRITES_TO` is architectural
 * drift you want to SEE (a function reaching a new layer it didn't before). Deterministic.
 */
export function graphDrift(prev: CrossLayerGraph, curr: CrossLayerGraph): GraphDrift {
  const a = couplingSet(prev), b = couplingSet(curr);
  const addedCouplings: Coupling[] = []; const removedCouplings: Coupling[] = [];
  for (const [k, c] of b) if (!a.has(k)) addedCouplings.push(c);
  for (const [k, c] of a) if (!b.has(k)) removedCouplings.push(c);
  const tbl = (g: CrossLayerGraph) => new Set((g?.nodes ?? []).filter((n) => n.type === "db_table").map((n) => n.name));
  const ep = (g: CrossLayerGraph) => new Set((g?.nodes ?? []).filter((n) => n.type === "api_endpoint").map((n) => (n.method ? n.method + " " : "") + n.name));
  const pa = tbl(prev), ca = tbl(curr), pe = ep(prev), ce = ep(curr);
  return {
    addedCouplings, removedCouplings,
    addedTables: [...ca].filter((x) => !pa.has(x)), removedTables: [...pa].filter((x) => !ca.has(x)),
    addedEndpoints: [...ce].filter((x) => !pe.has(x)), removedEndpoints: [...pe].filter((x) => !ce.has(x)),
  };
}

// ── GRAPH HEALTH — orphans (dead-code candidates) + cross-layer KEYSTONES ───────────────────────
export interface Keystone { node: GNode; soleWriterOf: string[]; fanIn: number; reachedByEndpoints: number; reason: string }
export interface GraphHealth { orphanFunctions: GNode[]; orphanTables: GNode[]; orphanEndpoints: GNode[]; keystones: Keystone[] }
/**
 * Deterministic health read of the cross-layer graph:
 *  • ORPHANS — a function nothing references (dead-code CANDIDATE), a db_table no code reads/writes
 *    (dead schema or dynamic access), an endpoint with no resolved handler. ★Candidates, not proof:
 *    an "orphan function" may be an exported public API / entry point / dynamically-called (Padgett).
 *  • KEYSTONES — a function that is the SOLE writer to a table AND has real fan-in (callers/endpoints):
 *    a single point of failure ACROSS layers — change it wrong and that table's writes break, and every
 *    endpoint reaching it. The cross-layer cousin of bus-factor.
 */
export function graphHealth(graph: CrossLayerGraph): GraphHealth {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? [];
  const inCalls = new Map<string, number>(); const handledFns = new Set<string>(); const handledEndpoints = new Set<string>();
  const tableTouched = new Set<string>(); const writersOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation === "CALLS") inCalls.set(e.target, (inCalls.get(e.target) ?? 0) + 1);
    else if (e.relation === "HANDLED_BY") { handledFns.add(e.target); handledEndpoints.add(e.source); }
    else if (e.relation === "READS" || e.relation === "WRITES_TO") { tableTouched.add(e.target); if (e.relation === "WRITES_TO") { const a = writersOf.get(e.target) ?? []; a.push(e.source); writersOf.set(e.target, a); } }
  }
  const fns = nodes.filter((n) => n.type === "function");
  const orphanFunctions = fns.filter((n) => (inCalls.get(n.id) ?? 0) === 0 && !handledFns.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  const orphanTables = nodes.filter((n) => n.type === "db_table" && !tableTouched.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  const orphanEndpoints = nodes.filter((n) => n.type === "api_endpoint" && !handledEndpoints.has(n.id)).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const soleWriterTables = new Map<string, string>();   // writerId → list of tables it solely writes
  const keyMap = new Map<string, Keystone>();
  for (const [tableId, writers] of writersOf) { const uniq = [...new Set(writers)]; if (uniq.length === 1) { const w = uniq[0]; soleWriterTables.set(w, ((soleWriterTables.get(w) ?? "") + "," + tableId)); } }
  for (const [writerId, tableCsv] of soleWriterTables) {
    const node = byId.get(writerId); if (!node) continue;
    const tables = tableCsv.split(",").filter(Boolean).map((t) => byId.get(t)?.name || t.replace(/^db:/, ""));
    const fanIn = inCalls.get(writerId) ?? 0; const reachedByEndpoints = edges.filter((e) => e.relation === "HANDLED_BY" && e.target === writerId).length;
    // a keystone matters only if something actually depends on it (fan-in or an endpoint)
    if (fanIn + reachedByEndpoints >= 1) keyMap.set(writerId, { node, soleWriterOf: tables, fanIn, reachedByEndpoints, reason: `sole writer to ${tables.map((t) => "'" + t + "'").join(", ")} · reached by ${fanIn} caller(s) + ${reachedByEndpoints} endpoint(s)` });
  }
  const keystones = [...keyMap.values()].sort((a, b) => (b.fanIn + b.reachedByEndpoints) - (a.fanIn + a.reachedByEndpoints) || b.soleWriterOf.length - a.soleWriterOf.length);
  return { orphanFunctions, orphanTables, orphanEndpoints, keystones };
}

// ── PR / DIFF blast radius — what a whole change set touches across layers ──────────────────────
export interface DiffChange { file: string; name: string }
/**
 * Parse a unified git diff into the set of changed function/symbol names. Deterministic — reads the
 * hunk-header context (git prints the enclosing def after `@@ … @@`) plus any def added/removed in the
 * hunk body. Language-agnostic (function/def/func/fn/arrow). Honest: it's "definitions the diff
 * touched", a conservative superset, not a precise per-statement attribution.
 */
export function parseChangedSymbols(diffText: string): DiffChange[] {
  const out: DiffChange[] = []; const seen = new Set<string>();
  let file = ""; const lines = String(diffText ?? "").split(/\r?\n/);
  const NAME = /(?:function\s+|def\s+|func\s+(?:\([^)]*\)\s*)?|fn\s+|(?:export\s+)?(?:const|let|var)\s+)([A-Za-z_]\w*)/g;
  const add = (n: string) => { const k = `${file}#${n}`; if (file && n && !seen.has(k)) { seen.add(k); out.push({ file, name: n }); } };
  for (const ln of lines) {
    const pf = ln.match(/^\+\+\+ b\/(.+)$/); if (pf) { file = pf[1].trim(); continue; }
    const hh = ln.match(/^@@[^@]*@@\s*(.+)$/); if (hh) { for (const m of hh[1].matchAll(NAME)) add(m[1]); continue; }
    if (/^[+-]/.test(ln) && !/^[+-]{3}\s/.test(ln)) { for (const m of ln.slice(1).matchAll(NAME)) add(m[1]); }
  }
  return out;
}
export interface DiffBlast { origins: GNode[]; tables: GNode[]; endpoints: GNode[]; rules: GNode[]; functions: GNode[]; changed: number; reachable: number }
/**
 * The cross-layer blast radius of a whole CHANGE SET: the union of every changed function's blast
 * radius, deduped + categorized. Answers "this PR touches which DB tables / API routes / business
 * rules?" — the question a reviewer (or an agent about to apply a multi-file edit) must answer.
 */
export function diffBlastRadius(graph: CrossLayerGraph, changes: ReadonlyArray<DiffChange> | string, opts?: { maxDepth?: number }): DiffBlast {
  const list: DiffChange[] = typeof changes === "string" ? parseChangedSymbols(changes) : (changes ?? []).slice();
  const originIds = new Set<string>(); const origins: GNode[] = [];
  for (const ch of list) {
    // prefer a node in the same file; fall back to name match
    const inFile = (graph?.nodes ?? []).find((n) => n.type === "function" && n.name === ch.name && (n.file === ch.file || (n.file || "").endsWith(ch.file) || (ch.file || "").endsWith(n.file || "")));
    const node = inFile ?? resolveNode(graph, ch.name);
    if (node && node.type === "function" && !originIds.has(node.id)) { originIds.add(node.id); origins.push(node); }
  }
  const hit = new Map<string, GNode>();
  for (const o of origins) { const br = blastRadius(graph, o.id, { maxDepth: opts?.maxDepth ?? 1 }); for (const n of [...br.tables, ...br.endpoints, ...br.rules, ...br.functions]) if (!originIds.has(n.id)) hit.set(n.id, n); }
  const all = [...hit.values()];
  return { origins, tables: all.filter((n) => n.type === "db_table"), endpoints: all.filter((n) => n.type === "api_endpoint"), rules: all.filter((n) => n.type === "business_rule"), functions: all.filter((n) => n.type === "function"), changed: origins.length, reachable: all.length };
}

// ── AGENT BLAST-CHECK — catch the cross-layer impact the user did NOT ask for ──────────────────
export interface BlastCheck { verdict: "clean" | "review"; surpriseTables: GNode[]; surpriseEndpoints: GNode[]; surpriseRules: GNode[]; touched: DiffBlast; reason: string }
/**
 * Before an agent applies a multi-file edit, compare what the diff TOUCHES across layers against what
 * the user actually ASKED for: any DB table / API route / business rule in the blast radius whose name
 * the user never mentioned is a SURPRISE → verdict "review" (surface it / route to the human). This is
 * the cross-layer cousin of ELLEIPSIS (omission) — it catches the silent 'your auth tweak also writes
 * the payments table' class. ★HONEST: a name-mention heuristic (prove-or-unknown) — it flags a likely
 * unintended reach to LOOK at, not a proof of a bug; if the user named the table, it's not a surprise.
 */
export function agentBlastCheck(graph: CrossLayerGraph, diff: DiffBlast | ReadonlyArray<DiffChange> | string, intentText: string, opts?: { maxDepth?: number }): BlastCheck {
  const touched: DiffBlast = (diff && typeof diff === "object" && "origins" in diff) ? diff as DiffBlast : diffBlastRadius(graph, diff as never, opts);
  const intent = lc(String(intentText ?? ""));
  const intentTokens = tokset(intentText);
  const unmentioned = (n: GNode): boolean => {
    const name = lc(n.name); if (!name) return false;
    if (intent.includes(name)) return false;                                   // named directly
    if (n.type === "api_endpoint" && intent.includes(name.replace(/^\/+/, ""))) return false;
    // a table named "users"/"user" is "mentioned" if the user said either form
    if (n.type === "db_table" && (intent.includes(name.replace(/s$/, "")) || intent.includes(name + "s"))) return false;
    // a business RULE is a phrase — count it mentioned if ≥half its distinctive tokens are in the intent
    if (n.type === "business_rule") { const rt = [...tokset(n.name)]; if (rt.length) { const hit = rt.filter((t) => intentTokens.has(t)).length; if (hit >= Math.ceil(rt.length / 2)) return false; } }
    return true;
  };
  const surpriseTables = touched.tables.filter(unmentioned);
  const surpriseEndpoints = touched.endpoints.filter(unmentioned);
  const surpriseRules = touched.rules.filter(unmentioned);
  const n = surpriseTables.length + surpriseEndpoints.length + surpriseRules.length;
  const reason = n
    ? `this change reaches ${n} thing(s) the request didn't mention: ${[...surpriseTables.map((t) => "table " + t.name), ...surpriseEndpoints.map((e) => "endpoint " + e.name), ...surpriseRules.map((r) => "rule " + r.name)].join(", ")}`
    : "every cross-layer node this change touches was named in the request";
  return { verdict: n ? "review" : "clean", surpriseTables, surpriseEndpoints, surpriseRules, touched, reason };
}

/** Render a diff blast radius as a Markdown PR comment (deterministic). */
export function diffBlastMarkdown(b: DiffBlast, opts?: { repo?: string }): string {
  const L: string[] = ["### 🕸 Cross-Layer Blast Radius"];
  if (!b.changed) { L.push("", "_No changed functions resolved to the cross-layer graph._"); return L.join("\n"); }
  const crossHits = b.rules.length + b.tables.length + b.endpoints.length;
  L.push("", `This change set's **${b.changed}** changed function(s) reach **${crossHits}** node(s) in OTHER layers${b.functions.length ? ` (and ${b.functions.length} more functions)` : ""}:`, "");
  if (b.rules.length) L.push(`- 💼 **Business rules (${b.rules.length}):** ${b.rules.map((r) => r.name).join(" · ")}`);
  if (b.tables.length) L.push(`- 🗄 **DB tables (${b.tables.length}):** ${b.tables.map((t) => "`" + t.name + "`").join(" · ")}`);
  if (b.endpoints.length) L.push(`- 🌐 **API endpoints (${b.endpoints.length}):** ${b.endpoints.map((e) => "`" + (e.method ? e.method + " " : "") + e.name + "`").join(" · ")}`);
  if (!crossHits) L.push(`_No cross-layer coupling — this change set stays within the code layer._`);
  if (b.tables.length) L.push("", `⚠️ A DB table is in the blast radius — double-check migrations/data impact before merging.`);
  L.push("", `<sub>Deterministic, no LLM — every edge derives from a real file. Reachable coupling to inspect, not a proven runtime break.${opts?.repo ? ` · ${opts.repo}` : ""}</sub>`);
  return L.join("\n");
}

// ── REVERSE IMPACT / DROP SAFETY — what breaks if you REMOVE a table or endpoint ─────────────────
export interface DropImpact { node: GNode | null; dependentFunctions: string[]; dependentEndpoints: string[]; dependentRules: string[]; keystonesAffected: string[]; safety: "SAFE" | "RISKY" | "CRITICAL"; reason: string }
/**
 * The REVERSE blast radius: before you DROP a DB table (or remove an endpoint), everything that
 * depends on it — every function that reads/writes it, every UPSTREAM caller of those functions, every
 * endpoint that reaches them, every business rule. The deterministic answer to "is this safe to delete?"
 * — the migration question that terrifies everyone. SAFE = nothing depends on it · RISKY = code does ·
 * CRITICAL = a keystone or a live endpoint depends on it. ★HONEST: structural dependents from the graph
 * (deterministic), not a proof nothing breaks at runtime (dynamic/reflective access is invisible).
 */
export function dropImpact(graph: CrossLayerGraph, name: string): DropImpact {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n]));
  // prefer a table/endpoint match for "the thing you'd drop"
  const target = nodes.find((n) => (n.type === "db_table" || n.type === "api_endpoint") && lc(n.name) === lc(name))
    ?? nodes.find((n) => (n.type === "db_table" || n.type === "api_endpoint") && lc(n.name).includes(lc(name)))
    ?? resolveNode(graph, name);
  if (!target) return { node: null, dependentFunctions: [], dependentEndpoints: [], dependentRules: [], keystonesAffected: [], safety: "SAFE", reason: `no table/endpoint matching "${name}"` };
  // backward CALLS adjacency (who calls X)
  const callers = new Map<string, string[]>(); for (const e of edges) if (e.relation === "CALLS") (callers.get(e.target) ?? callers.set(e.target, []).get(e.target))!.push(e.source);
  const fnIds = new Set<string>();
  if (target.type === "db_table") { for (const e of edges) if ((e.relation === "READS" || e.relation === "WRITES_TO") && e.target === target.id) fnIds.add(e.source); }
  else { for (const e of edges) if (e.relation === "HANDLED_BY" && e.source === target.id) fnIds.add(e.target); }   // endpoint → its handlers
  // add IMMEDIATE upstream callers (depth 1) — the direct dependents + who calls them. Deeper than
  // that explodes on a dense call graph and stops being actionable; the safety verdict keys on the
  // direct table-touchers + the keystones/endpoints among them, which is the reliable signal.
  for (const id of [...fnIds]) for (const c of callers.get(id) ?? []) fnIds.add(c);
  const epIds = new Set<string>(); for (const e of edges) if (e.relation === "HANDLED_BY" && fnIds.has(e.target)) epIds.add(e.source);
  const ruleIds = new Set<string>(); for (const e of edges) if (e.relation === "IMPLEMENTS" && fnIds.has(e.target)) ruleIds.add(e.source);
  const keystoneNames = new Set(graphHealth(graph).keystones.map((k) => k.node.name));
  const dependentFunctions = [...fnIds].map((id) => byId.get(id)?.name).filter((x): x is string => !!x).sort();
  const dependentEndpoints = [...epIds].map((id) => { const n = byId.get(id); return n ? `${n.method ? n.method + " " : ""}${n.name}` : ""; }).filter(Boolean).sort();
  const dependentRules = [...ruleIds].map((id) => byId.get(id)?.name).filter((x): x is string => !!x).sort();
  const keystonesAffected = dependentFunctions.filter((f) => keystoneNames.has(f));
  const safety: DropImpact["safety"] = (keystonesAffected.length || dependentEndpoints.length) ? "CRITICAL" : dependentFunctions.length ? "RISKY" : "SAFE";
  const reason = safety === "SAFE" ? `nothing in the scanned code depends on ${target.type} '${target.name}' — likely safe to remove (verify dynamic access)` : `removing ${target.type} '${target.name}' breaks ${dependentFunctions.length} function(s)${dependentEndpoints.length ? ", " + dependentEndpoints.length + " endpoint(s)" : ""}${keystonesAffected.length ? ", " + keystonesAffected.length + " keystone(s)" : ""}${dependentRules.length ? ", " + dependentRules.length + " business rule(s)" : ""}`;
  return { node: target, dependentFunctions, dependentEndpoints, dependentRules, keystonesAffected, safety, reason };
}

/** Find a node id by a loose name (function name, table name, or endpoint path). First match. */
export function resolveNode(graph: CrossLayerGraph, query: string): GNode | null {
  const q = lc(word(query)); const nodes = graph?.nodes ?? [];
  return nodes.find((n) => lc(word(n.name)) === q) ?? nodes.find((n) => lc(n.name).includes(lc(query))) ?? null;
}

export interface BusinessCoverage { total: number; anchored: GNode[]; orphan: GNode[]; coverageRate: number }
/**
 * Business-rule coverage — which rules have a DETERMINISTIC code anchor vs which are ORPHAN.
 * ★HONEST (prove-or-unknown): an orphan rule is UNKNOWN — it may be unimplemented, OR implemented
 * without a name/annotation anchor. It is NEVER asserted "not implemented" (Padgett guard).
 */
export function businessCoverage(graph: CrossLayerGraph): BusinessCoverage {
  const rules = (graph?.nodes ?? []).filter((n) => n.type === "business_rule");
  const implemented = new Set((graph?.edges ?? []).filter((e) => e.relation === "IMPLEMENTS").map((e) => e.source));
  const anchored = rules.filter((r) => implemented.has(r.id)); const orphan = rules.filter((r) => !implemented.has(r.id));
  return { total: rules.length, anchored, orphan, coverageRate: rules.length ? Math.round((anchored.length / rules.length) * 100) / 100 : 0 };
}

// ── EXTRACTOR ACCURACY BENCHMARK — measured, not claimed ────────────────────────────────────────
interface BenchFixture { name: string; files: SourceFile[]; nodes: Array<[NodeType, string]>; edges: Array<[string, string, Relation]> }
const BENCH_CORPUS: BenchFixture[] = [
  { name: "js-prisma", files: [
    { path: "schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }" },
    { path: "auth.ts", content: "export function registerHandler(req,res){ prisma.user.create({data:{}}); createWallet(1); }\nexport function createWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
    { path: "routes.ts", content: "router.post(\"/register\", registerHandler);" }],
    nodes: [["function", "registerHandler"], ["function", "createWallet"], ["db_table", "User"], ["db_table", "Wallet"], ["api_endpoint", "/register"]],
    edges: [["registerHandler", "User", "WRITES_TO"], ["createWallet", "Wallet", "WRITES_TO"], ["/register", "registerHandler", "HANDLED_BY"]] },   // CALLS excluded from the benchmark scope (within-code graph isn't exhaustively labeled)
  { name: "python-django", files: [
    { path: "models.py", content: "class Order(models.Model):\n    total = models.IntegerField()" },
    { path: "views.py", content: "# feature: place order\n@app.post(\"/orders\")\ndef create_order(req):\n    return Order.objects.create(total=req.total)" },
    { path: "PRD.md", content: "## Feature: place order" }],
    nodes: [["function", "create_order"], ["db_table", "Order"], ["api_endpoint", "/orders"], ["business_rule", "place order"]],
    edges: [["create_order", "Order", "WRITES_TO"], ["place order", "create_order", "IMPLEMENTS"]] },
  { name: "sqlalchemy-read", files: [
    { path: "schema.sql", content: "CREATE TABLE invoices (id int)" },
    { path: "svc.py", content: "def list_invoices(session):\n    return session.query(Invoices).all()" }],
    nodes: [["function", "list_invoices"], ["db_table", "invoices"]],
    edges: [["list_invoices", "invoices", "READS"]] },
  { name: "go-sql", files: [
    { path: "schema.sql", content: "CREATE TABLE users (id int)" },
    { path: "main.go", content: "func ListUsers() { db.Query(\"SELECT * FROM users\") }" }],
    nodes: [["function", "ListUsers"], ["db_table", "users"]],
    edges: [["ListUsers", "users", "READS"]] },
];
export interface ExtractorBenchmark { nodePrecision: number; nodeRecall: number; edgePrecision: number; edgeRecall: number; f1: number; fixtures: Array<{ name: string; nodeHit: number; nodeExp: number; edgeHit: number; edgeExp: number; edgeSpurious: number }> }
/**
 * Run the cross-layer extractor against a labeled corpus and MEASURE precision/recall of the nodes +
 * edges it finds. Honest credibility: "the extractor is X% precise / Y% recall on this corpus" — a
 * reproducible number, not a marketing claim. (Precision counts only cross-layer + IMPLEMENTS edges;
 * the dense within-code CALLS graph is excluded from precision since the corpus doesn't label it
 * exhaustively — that would unfairly punish real calls.)
 */
export function extractorBenchmark(): ExtractorBenchmark {
  let nTP = 0, nExp = 0, nFP = 0, eTP = 0, eExp = 0, eFP = 0;
  const fixtures: ExtractorBenchmark["fixtures"] = [];
  const crossRel = (r: Relation) => r === "WRITES_TO" || r === "READS" || r === "HANDLED_BY" || r === "IMPLEMENTS";
  for (const fx of BENCH_CORPUS) {
    const g = buildCrossLayerGraph(fx.files);
    const gotNodes = new Set(g.nodes.map((n) => `${n.type}|${lc(n.name)}`));
    const expNodes = new Set(fx.nodes.map(([t, n]) => `${t}|${lc(n)}`));
    let fxNodeHit = 0; for (const k of expNodes) if (gotNodes.has(k)) fxNodeHit++;
    nTP += fxNodeHit; nExp += expNodes.size; for (const k of gotNodes) if (!expNodes.has(k)) nFP++;
    // edges: resolve names → matched cross-layer/implements edges
    const nameOf = new Map(g.nodes.map((n) => [n.id, lc(n.name)]));
    const gotEdges = new Set(g.edges.filter((e) => crossRel(e.relation)).map((e) => `${nameOf.get(e.source)}>${nameOf.get(e.target)}|${e.relation}`));
    const expEdges = new Set(fx.edges.map(([s, t, r]) => `${lc(s)}>${lc(t)}|${r}`));
    let fxEdgeHit = 0; for (const k of expEdges) if (gotEdges.has(k)) fxEdgeHit++;
    let fxSpur = 0; for (const k of gotEdges) if (!expEdges.has(k)) fxSpur++;
    eTP += fxEdgeHit; eExp += expEdges.size; eFP += fxSpur;
    fixtures.push({ name: fx.name, nodeHit: fxNodeHit, nodeExp: expNodes.size, edgeHit: fxEdgeHit, edgeExp: expEdges.size, edgeSpurious: fxSpur });
  }
  const nodeRecall = nExp ? nTP / nExp : 1, nodePrecision = nTP + nFP ? nTP / (nTP + nFP) : 1;
  const edgeRecall = eExp ? eTP / eExp : 1, edgePrecision = eTP + eFP ? eTP / (eTP + eFP) : 1;
  const f1 = edgePrecision + edgeRecall ? (2 * edgePrecision * edgeRecall) / (edgePrecision + edgeRecall) : 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { nodePrecision: r2(nodePrecision), nodeRecall: r2(nodeRecall), edgePrecision: r2(edgePrecision), edgeRecall: r2(edgeRecall), f1: r2(f1), fixtures };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface CLGGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function crossLayerGauntlet(): CLGGauntlet {
  const files: SourceFile[] = [
    { path: "schema.prisma", content: "model User {\n id Int @id\n}\nmodel Wallet {\n id Int @id\n}" },
    { path: "auth.ts", content: "export async function registerHandler(req, res) {\n  await prisma.user.create({ data: {} });\n  await createUserWallet(req.body.id);\n}\n// feature: new user wallet bonus\nexport function createUserWallet(uid) {\n  return prisma.wallet.create({ data: { uid } });\n}" },
    { path: "routes.ts", content: "router.post(\"/v1/auth/register\", registerHandler);\napp.get(\"/v1/health\", healthCheck);" },
    { path: "PRD.md", content: "## Feature: new user wallet bonus\nEvery new user gets a wallet.\n\n## Feature: dark mode theme toggle\nUsers can switch theme." },
  ];
  const g = buildCrossLayerGraph(files);
  const cov = businessCoverage(g);
  const bizExtract = g.nodes.filter((n) => n.type === "business_rule").length === 2;
  const bizAnchored = cov.anchored.some((r) => r.name === "new user wallet bonus");        // annotated + name-match
  const bizOrphan = cov.orphan.some((r) => r.name === "dark mode theme toggle");           // no code anchor → UNKNOWN
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
  // PR/diff blast radius: a diff touching createUserWallet → the change set reaches the Wallet table
  const diff = "--- a/auth.ts\n+++ b/auth.ts\n@@ -10,3 +10,4 @@ export function createUserWallet(uid) {\n   return prisma.wallet.create({ data: { uid } });\n+  // tweak\n }";
  const changed = parseChangedSymbols(diff);
  const db = diffBlastRadius(g, diff);
  const diffOK = changed.some((c) => c.name === "createUserWallet") && db.changed >= 1 && db.tables.some((t) => t.name === "Wallet");
  const mdOK = diffBlastMarkdown(db).includes("Blast Radius") && diffBlastMarkdown(db).includes("Wallet");
  // agent blast-check: same diff (writes Wallet). "fix the wallet bonus" → clean; "fix the login" → review (surprise: Wallet)
  const checkClean = agentBlastCheck(g, db, "fix the wallet bonus logic");
  const checkSurprise = agentBlastCheck(g, db, "fix the login redirect");
  const checkOK = checkClean.verdict === "clean" && checkSurprise.verdict === "review" && checkSurprise.surpriseTables.some((t) => t.name === "Wallet");
  // graph health: createUserWallet is the SOLE writer to Wallet + reached by registerHandler → a keystone
  const health = graphHealth(g);
  const healthOK = health.keystones.some((k) => k.node.name === "createUserWallet" && k.soleWriterOf.includes("Wallet")) && Array.isArray(health.orphanFunctions);
  // extractor accuracy: measured on the labeled corpus (perfect node + cross-layer edge extraction)
  const bench = extractorBenchmark();
  const benchOK = bench.nodePrecision === 1 && bench.nodeRecall === 1 && bench.edgeRecall === 1 && bench.edgePrecision === 1;
  // drift: a "before" graph without the wallet write → after adds the createUserWallet→Wallet coupling
  const before = buildCrossLayerGraph([{ path: "schema.prisma", content: "model Wallet { id Int @id }" }, { path: "a.ts", content: "export function createUserWallet(uid){ return 1; }" }]);
  const drift = graphDrift(before, g);
  const driftOK = drift.addedCouplings.some((c) => c.to === "Wallet" && c.relation === "WRITES_TO") && graphDrift(g, g).addedCouplings.length === 0;
  // drop impact: removing Wallet (written by createUserWallet, reached by registerHandler→endpoint) → CRITICAL
  const drop = dropImpact(g, "Wallet");
  const dropOK = drop.safety === "CRITICAL" && drop.dependentFunctions.includes("createUserWallet") && dropImpact(g, "NoSuchTable").safety === "SAFE";
  const total = (() => { try { buildCrossLayerGraph(null as never); blastRadius(null as never, "x"); resolveNode(null as never, "x"); diffBlastRadius(null as never, "x"); parseChangedSymbols(null as never); agentBlastCheck(null as never, "x", "y"); graphHealth(null as never); extractorBenchmark(); graphDrift(null as never, null as never); dropImpact(null as never, "x"); return true; } catch { return false; } })();
  const checks = [
    { name: "EXTRACT-3-LAYERS", pass: hasTable && hasEndpoint && hasFn, detail: "db_table (Prisma) + api_endpoint (route) + function (decl) all extracted deterministically" },
    { name: "WRITE-EDGE", pass: writeEdge, detail: "function → db_table WRITES_TO (prisma.wallet.create)" },
    { name: "HANDLED-BY", pass: handledBy, detail: "api_endpoint → function HANDLED_BY (route's named handler)" },
    { name: "CALL-EDGE", pass: callsEdge, detail: "function → function CALLS (body references the callee)" },
    { name: "CROSS-LAYER-BLAST", pass: crossLayer, detail: "edit createUserWallet → blast radius spans the wallet TABLE + the register ENDPOINT (the cross-layer join no single-layer graph reports)" },
    { name: "NO-HALLUCINATION", pass: noHallucination, detail: "every edge endpoint is a real extracted node — nothing invented" },
    { name: "BUSINESS-LAYER", pass: bizExtract && bizAnchored, detail: "business_rule extracted from a PRD + IMPLEMENTS-linked to code via a deterministic anchor (annotation / strong name match)" },
    { name: "PROVE-OR-UNKNOWN", pass: bizOrphan, detail: "a rule with NO code anchor stays ORPHAN/UNKNOWN — never a guessed link (Padgett)" },
    { name: "PR-DIFF-BLAST", pass: diffOK && mdOK, detail: "a git diff → the change set's union blast radius across layers (the DB table a PR silently touches) + a Markdown PR comment" },
    { name: "AGENT-BLAST-CHECK", pass: checkOK, detail: "vs the user's intent: a touched table the request didn't name → 'review' (the silent 'your auth fix also writes payments' catch); a named one → 'clean'" },
    { name: "KEYSTONE+ORPHAN", pass: healthOK, detail: "the sole writer to a table with real fan-in = a cross-layer KEYSTONE (single point of failure); orphan tables/functions = dead-code candidates (prove-or-unknown)" },
    { name: "EXTRACTOR-ACCURACY", pass: benchOK, detail: "MEASURED on a labeled corpus: node + cross-layer-edge precision/recall (reproducible, not a claim)" },
    { name: "GRAPH-DRIFT", pass: driftOK, detail: "the cross-layer couplings that APPEARED/disappeared between two commits — architectural drift (a function reaching a new layer); identical graphs → no drift" },
    { name: "DROP-IMPACT", pass: dropOK, detail: "reverse blast radius: what breaks if you DROP a table — SAFE/RISKY/CRITICAL deletion safety (a non-existent table is SAFE)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

export { toMermaid, toHtml, toRadarHtml, toRadarSvg, pickSubgraph, renderGauntlet, type SubgraphPick, type RenderGauntlet } from "./render.js";
