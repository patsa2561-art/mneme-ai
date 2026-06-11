/**
 * INJECTION TAINT PATH — the input-side of the AppSec triad on the cross-layer graph.
 *
 *   • AUTHZ GAP  (write-side)  — user can WRITE a sensitive table with no auth.
 *   • EXFIL PATH (read-side)   — sensitive data is READ out to the response with no redaction.
 *   • INJECTION  (input-side)  — user INPUT reaches a dangerous SINK with no sanitizer  ← this.
 *
 * The classic injection class (SQLi / command-injection / SSRF / path-traversal): a function REACHABLE
 * FROM AN ENDPOINT takes request input (req.body/params/query) and feeds it into a dangerous sink — a
 * raw SQL query, exec/eval, child_process, fs, new Function — with no sanitizer / parameterization /
 * validation in between. The graph supplies the crucial filter that a linter alone can't: the sink is
 * REACHABLE FROM AN HTTP ENDPOINT, so it is actually exposed to user input — not a dead utility.
 *
 * Endpoint-reachability comes from the graph (HANDLED_BY + CALLS); the input/sink/sanitizer signals are
 * read from the function bodies (extracted from the files).
 *
 * ★HONEST (DIAKRISIS): a lexical taint heuristic — it flags a function that is endpoint-reachable AND
 * references request input AND contains a dangerous-sink token AND shows no sanitizer-named token. That
 * is a high-signal CANDIDATE for an injection, NOT a proof of exploitability (the input may not actually
 * flow into the sink, or sanitization may use a name the vocabulary misses). Higher recall than the
 * authz/exfil gaps by design; review each before acting.
 */
import { type CrossLayerGraph } from "../cross_layer_graph/index.js";
import { extractFunctions } from "../equiv_diff/index.js";

const SINK_RE = /\.(query|raw|execute|exec)\s*\(|\bexec(Sync)?\s*\(|\beval\s*\(|child_process|\bspawn(Sync)?\s*\(|new\s+Function\s*\(|\$(queryRaw|executeRaw)(Unsafe)?\b|\bfs\.(readFile|writeFile|unlink|appendFile|rm|readFileSync|writeFileSync)\s*\(|\brequire\s*\(/i;
const INPUT_RE = /\breq(uest)?\.(body|params|query|headers|cookies|url)|\.params\b|\.query\b|\.body\b|ctx\.(request|params|query)|event\.(body|queryStringParameters|pathParameters)|process\.argv|user[_-]?input/i;
const SANITIZER_RE = /escape|sanitiz|parameteriz|prepared|placeholder|\.bind\s*\(|\bzod\b|\bjoi\b|\byup\b|valibot|\.safeParse|\.parse\s*\(|validate|encodeURI|allowlist|whitelist|parseInt|parseFloat|Number\s*\(|isUUID|\bUUID\b|escapeHtml|dompurify|sqlstring|\.test\s*\(/i;
const sinkKind = (body: string): string => {
  if (/\.(query|raw|execute)\s*\(|\$(queryRaw|executeRaw)/i.test(body)) return "SQL injection (raw query + request input)";
  if (/\beval\s*\(|new\s+Function/i.test(body)) return "code injection (eval / new Function)";
  if (/child_process|\bexec(Sync)?\s*\(|\bspawn/i.test(body)) return "command injection (shell exec)";
  if (/\bfs\.(read|write|unlink|append|rm)/i.test(body)) return "path traversal (fs op on request input)";
  if (/\brequire\s*\(/i.test(body)) return "dynamic require on request input";
  return "untrusted input into a dangerous sink";
};

export interface InjectionPath { endpoint: string; method: string; func: string; file?: string; kind: string; reason: string }

/** Functions reachable from an endpoint that feed request input into a dangerous sink with no sanitizer. */
export function injectionPaths(graph: CrossLayerGraph, files: ReadonlyArray<{ path?: string; content?: string }>): InjectionPath[] {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const bodies = new Map<string, string>();
  for (const f of files ?? []) for (const [name, fn] of extractFunctions(String(f?.content ?? ""))) if (!bodies.has(name)) bodies.set(name, fn.source);
  const callees = new Map<string, string[]>(); const handled = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation === "CALLS") (callees.get(e.source) ?? callees.set(e.source, []).get(e.source))!.push(e.target);
    else if (e.relation === "HANDLED_BY") (handled.get(e.source) ?? handled.set(e.source, []).get(e.source))!.push(e.target);
  }
  const out: InjectionPath[] = []; const seen = new Set<string>();
  for (const ep of nodes) {
    if (ep.type !== "api_endpoint") continue;
    for (const handlerId of (handled.get(ep.id) ?? [])) {
      const reached = new Set<string>([handlerId]); const stack = [handlerId]; let steps = 0;
      while (stack.length && steps++ < 600) { const id = stack.pop()!; for (const c of (callees.get(id) ?? [])) if (!reached.has(c)) { reached.add(c); stack.push(c); } }
      for (const id of reached) {
        const n = byId.get(id); if (!n) continue; const body = bodies.get(n.name); if (!body) continue;
        if (SINK_RE.test(body) && INPUT_RE.test(body) && !SANITIZER_RE.test(body)) {
          const key = ep.name + "|" + n.name; if (seen.has(key)) continue; seen.add(key);
          const kind = sinkKind(body);
          out.push({ endpoint: ep.name, method: ep.method ?? "", func: n.name, file: n.file, kind, reason: `${ep.method ?? ""} ${ep.name} → ${n.name}() feeds request input into a dangerous sink with no sanitizer → ${kind}` });
        }
      }
    }
  }
  return out.sort((a, b) => a.endpoint.localeCompare(b.endpoint) || a.func.localeCompare(b.func));
}

export function injectionVerdict(paths: ReadonlyArray<InjectionPath>): { clear: boolean; count: number; kinds: string[] } {
  if (!paths?.length) return { clear: true, count: 0, kinds: [] };
  return { clear: false, count: paths.length, kinds: [...new Set(paths.map((p) => p.kind))].sort() };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface InjectionTaintGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function injectionTaintGauntlet(): InjectionTaintGauntlet {
  const files = [{ path: "api.ts", content:
    "router.get(\"/search\", search);\n" +
    "export function search(req){ return db.query(\"SELECT * FROM t WHERE x=\" + req.query.q); }\n" +              // SQLi: input → raw query, no sanitizer → FLAG
    "router.post(\"/run\", runCmd);\n" +
    "export function runCmd(req){ const { execSync } = require('child_process'); return execSync(req.body.cmd); }\n" + // cmd injection → FLAG
    "router.get(\"/safe\", safe);\n" +
    "export function safe(req){ const id = parseInt(req.query.id); return db.query(\"SELECT * FROM t WHERE id=\" + id); }\n" + // sanitized (parseInt) → clear
    "export function deadUtil(req){ return db.query(\"SELECT \" + req.query.x); }\n" }];                            // raw query + input but NOT endpoint-reachable → not flagged
  const g = buildCrossLayerGraph(files);
  const paths = injectionPaths(g, files);
  const flagsSQL = paths.some((p) => p.endpoint === "/search" && /SQL/.test(p.kind));
  const flagsCmd = paths.some((p) => p.endpoint === "/run" && /command/.test(p.kind));
  const sanitizedClear = !paths.some((p) => p.endpoint === "/safe");
  const deadClear = !paths.some((p) => p.func === "deadUtil");          // not reachable from any endpoint
  const verdict = injectionVerdict(paths).clear === false && injectionVerdict([]).clear === true;
  const total = (() => { try { injectionPaths(null as never, null as never); injectionVerdict(null as never); injectionPaths(buildCrossLayerGraph([]), []); return true; } catch { return false; } })();
  const checks = [
    { name: "FLAGS-SQLI", pass: flagsSQL, detail: "endpoint input → raw query with no sanitizer → SQL injection flagged" },
    { name: "FLAGS-CMD-INJ", pass: flagsCmd, detail: "endpoint input → child_process exec → command injection flagged" },
    { name: "SANITIZER-CLEARS", pass: sanitizedClear, detail: "a sanitizer on the path (parseInt) clears it (/safe not flagged)" },
    { name: "ENDPOINT-REACHABLE-ONLY", pass: deadClear, detail: "a dangerous sink NOT reachable from an endpoint (deadUtil) is not flagged — the graph filter cuts the noise a linter can't" },
    { name: "VERDICT+TOTAL", pass: verdict && total, detail: "verdict reflects presence; null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
