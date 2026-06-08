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
    for (const m of c.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([A-Za-z_]\w*)/gi)) { const n = m[1]; out.set(lc(n), { id: `db:${lc(n)}`, type: "db_table", name: n, file: f.path }); }   // SQL
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
  const total = (() => { try { buildCrossLayerGraph(null as never); blastRadius(null as never, "x"); resolveNode(null as never, "x"); diffBlastRadius(null as never, "x"); parseChangedSymbols(null as never); return true; } catch { return false; } })();
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
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}

export { toMermaid, toHtml, toRadarHtml, toRadarSvg, pickSubgraph, renderGauntlet, type SubgraphPick, type RenderGauntlet } from "./render.js";
