/**
 * SENSITIVE-DATA EXFILTRATION PATH — the read-side mirror of the AUTHZ GAP.
 *
 * The authz gap catches an unguarded WRITE to a sensitive table. This catches the opposite, equally
 * dangerous leak: a sensitive table is READ on an endpoint's path and flows OUT to the response with NO
 * redaction/serializer/projection step in between — so the endpoint can over-return secrets (password
 * hashes, tokens, PII) it should never expose. It's a deterministic taint-flow on the cross-layer graph:
 * endpoint —HANDLED_BY→ handler —CALLS→ … —READS→ sensitive table, with no redaction-named function on
 * the path.
 *
 * Composes the same graph as the authz gap but in the data-OUT direction, and gates on a REDACTION
 * vocabulary (sanitize / pick / select / serialize / dto / view / mask …) rather than an auth vocabulary.
 *
 * ★HONEST (DIAKRISIS): a lexical taint signal — it proves a sensitive table is READ on a path that
 * reaches an endpoint with no redaction-named function found, which is a high-signal CANDIDATE for an
 * over-exposure leak, NOT a proof the secret reaches the wire (an ORM might project columns, or redaction
 * may happen by a name the vocabulary misses). It flags the path to review; it does not read the response
 * body. Pairs with the authz gap (write-side) for both directions of sensitive-data risk.
 */
import { type CrossLayerGraph } from "../cross_layer_graph/index.js";

// substring match (NOT \b…\b) so plurals/suffixes like "Credentials", "userAccounts" are caught.
const SENSITIVE_RE = /(password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|ssn|social|card|cvv|payment|billing|bank|account|salary|medical|health|pii|session|auth|user|customer|profile|email|phone|address|dob|birth)/i;
// substring match (NOT \b…\b) so a redactor named mid-word (e.g. toSafeUser, serializeUser) is caught.
const REDACT_RE = /(redact|sanitiz|scrub|mask|omit|pick|select|project|serializ|to[_-]?json|present|presenter|\bdto\b|viewmodel|view[_-]model|transform|whitelist|allowlist|safe(fields|user|view|[_-])|public(fields|view|[_-])|expose|filter[_-]?fields|strip)/i;
const isSensitive = (name: string) => SENSITIVE_RE.test(String(name || ""));
const isRedactor = (name: string) => REDACT_RE.test(String(name || ""));

export interface ExfilPath { endpoint: string; method: string; handler: string; handlerFile?: string; sensitiveTables: string[]; reason: string }

/** Endpoints whose handler reaches a sensitive-table READ with no redaction function on the path. */
export function exfilPaths(graph: CrossLayerGraph, opts?: { maxDepth?: number }): ExfilPath[] {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const maxDepth = opts?.maxDepth ?? 12;
  const callees = new Map<string, string[]>(); const readsSensitive = new Map<string, string[]>(); const handled = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation === "CALLS") (callees.get(e.source) ?? callees.set(e.source, []).get(e.source))!.push(e.target);
    else if (e.relation === "READS") { const t = byId.get(e.target); if (t && isSensitive(t.name)) (readsSensitive.get(e.source) ?? readsSensitive.set(e.source, []).get(e.source))!.push(t.name); }
    else if (e.relation === "HANDLED_BY") (handled.get(e.source) ?? handled.set(e.source, []).get(e.source))!.push(e.target);
  }
  const out: ExfilPath[] = [];
  for (const ep of nodes) {
    if (ep.type !== "api_endpoint") continue;
    for (const handlerId of (handled.get(ep.id) ?? [])) {
      // BFS forward CALLS from the handler; collect reached fns + sensitive reads
      const reached = new Set<string>([handlerId]); const stack = [handlerId]; let steps = 0;
      const sens = new Set<string>();
      while (stack.length && steps++ < maxDepth * 50) { const id = stack.pop()!; for (const r of (readsSensitive.get(id) ?? [])) sens.add(r); for (const c of (callees.get(id) ?? [])) if (!reached.has(c)) { reached.add(c); stack.push(c); } }
      if (!sens.size) continue;
      const redacted = [...reached].some((id) => { const n = byId.get(id); return n && isRedactor(n.name); });
      if (redacted) continue;
      const h = byId.get(handlerId);
      out.push({ endpoint: ep.name, method: ep.method ?? "", handler: h?.name ?? "?", handlerFile: h?.file, sensitiveTables: [...sens].sort(), reason: `${ep.method ?? ""} ${ep.name} → ${h?.name ?? "?"} reads ${[...sens].map((t) => "'" + t + "'").join(", ")} with no redaction/projection on the path → may over-expose it in the response` });
    }
  }
  return out.sort((a, b) => b.sensitiveTables.length - a.sensitiveTables.length || a.endpoint.localeCompare(b.endpoint));
}

export function exfilVerdict(paths: ReadonlyArray<ExfilPath>): { clear: boolean; count: number; worstTables: string[] } {
  if (!paths?.length) return { clear: true, count: 0, worstTables: [] };
  return { clear: false, count: paths.length, worstTables: [...new Set(paths.flatMap((p) => p.sensitiveTables))].sort() };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface ExfilPathGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function exfilPathGauntlet(): ExfilPathGauntlet {
  // GET /me → getMe reads the credentials table directly, no redaction → EXFIL.
  // GET /safe → getSafe reads credentials but calls toSafeUser (redactor) → clear.
  // GET /public → reads a non-sensitive table → not flagged.
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Credentials { id Int @id }\nmodel Article { id Int @id }" },
    { path: "api.ts", content:
      "router.get(\"/me\", getMe);\n" +
      "export function getMe(){ return prisma.credentials.findMany(); }\n" +                       // reads sensitive, no redaction → EXFIL
      "router.get(\"/safe\", getSafe);\n" +
      "export function getSafe(){ const r = prisma.credentials.findMany(); return toSafeUser(r); }\n" + // redacted → clear
      "export function toSafeUser(x){ return x; }\n" +
      "router.get(\"/public\", getPublic);\n" +
      "export function getPublic(){ return prisma.article.findMany(); }\n" },                       // non-sensitive → not flagged
  ]);
  const paths = exfilPaths(g);
  const flagsMe = paths.some((p) => p.endpoint === "/me" && p.sensitiveTables.some((t) => /credentials/i.test(t)));
  const safeClear = !paths.some((p) => p.endpoint === "/safe");          // redactor on path → not flagged
  const publicClear = !paths.some((p) => p.endpoint === "/public");      // non-sensitive table → not flagged
  const verdict = exfilVerdict(paths).clear === false && exfilVerdict([]).clear === true;
  const total = (() => { try { exfilPaths(null as never); exfilVerdict(null as never); exfilPaths(buildCrossLayerGraph([])); return true; } catch { return false; } })();
  const checks = [
    { name: "FLAGS-EXFIL", pass: flagsMe, detail: "an endpoint that reads a sensitive table with no redaction on the path is flagged (GET /me → credentials)" },
    { name: "REDACTOR-CLEARS", pass: safeClear, detail: "a redaction/projection function on the path clears it (toSafeUser → /safe not flagged)" },
    { name: "NON-SENSITIVE-CLEAR", pass: publicClear, detail: "reading a non-sensitive table is not flagged (/public → article)" },
    { name: "VERDICT", pass: verdict, detail: "exfilVerdict: clear=false with paths, clear=true when none" },
    { name: "TOTAL", pass: total, detail: "null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
