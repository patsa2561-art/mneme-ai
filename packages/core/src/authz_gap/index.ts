/**
 * CROSS-LAYER AUTHZ GAP — the highest-stakes, best-hidden bug class, found deterministically.
 *
 * The most catastrophic web bug is an unauthenticated/unauthorized WRITE path to a sensitive table —
 * `POST /api/transfer` reaches a write to `accounts` without ever passing through an auth check.
 * Linters check syntax; SAST checks taint within a function; NOTHING checks, across layers, "does this
 * endpoint's code reach a write to a SENSITIVE table without any auth gate on the path?" — because that
 * requires the endpoint→handler→…→table graph this project already builds.
 *
 * This walks each endpoint's handler forward through the call graph: if it reaches a WRITE to a
 * sensitive table and NO auth-named function appears anywhere on that reachable path, it's an AUTHZ GAP.
 *
 * ★HONEST (DIAKRISIS): a heuristic security SMELL, not a proven vulnerability. Auth is often applied as
 * MIDDLEWARE registered separately (app.use(authMiddleware)) — invisible to the call graph — so a flag
 * is a "review this endpoint's authz first" signal (prioritization), not a CVE. Sensitive-table and
 * auth-function detection are name-based. It surfaces the candidates worth a human's eyes, fast.
 */
import { type CrossLayerGraph, buildCrossLayerGraph, type GNode } from "../cross_layer_graph/index.js";

const lc = (s: string) => String(s ?? "").toLowerCase();
const AUTH_RE = /\b(auth|authn|authz|authent|authoriz|require[_-]?(auth|login|user|admin|role)|is[_-]?authenticated|verify[_-]?(token|jwt|session|user|sig)|check[_-]?(permission|access|role|auth|acl)|ensure[_-]?(auth|login|admin)|guard|middleware|login|logged[_-]?in|current[_-]?user|get[_-]?(user|session)|passport|rbac|acl|permission|can[_-]?(read|write|edit|delete))\b/i;
const SENSITIVE_RE = /\b(user|users|account|accounts|payment|payments|wallet|wallets|password|credential|secret|token|admin|role|roles|permission|permissions|balance|transaction|transactions|billing|card|cards|ssn|bank|invoice|order|orders|subscription|api[_-]?key)\b/i;

export interface AuthzGap { endpoint: string; method: string; handler: string; handlerFile?: string; sensitiveTables: string[]; reason: string }
const isAuthName = (name: string) => AUTH_RE.test(lc(name));
const isSensitiveTable = (name: string) => SENSITIVE_RE.test(lc(name));

/** Endpoints whose handler reaches a sensitive-table WRITE with no auth-named function on the path. */
export function authzGaps(graph: CrossLayerGraph, opts?: { maxDepth?: number }): AuthzGap[] {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxDepth = opts?.maxDepth ?? 6;
  // forward CALLS adjacency + per-function WRITES_TO sensitive tables
  const calls = new Map<string, string[]>(); const writesSensitive = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation === "CALLS") { (calls.get(e.source) ?? calls.set(e.source, []).get(e.source))!.push(e.target); }
    else if (e.relation === "WRITES_TO") { const t = byId.get(e.target); if (t && isSensitiveTable(t.name)) { (writesSensitive.get(e.source) ?? writesSensitive.set(e.source, []).get(e.source))!.push(t.name); } }
  }
  // endpoint → handler(s)
  const handlers = new Map<string, string[]>();   // endpointId → [handlerFnId]
  for (const e of edges) if (e.relation === "HANDLED_BY") (handlers.get(e.source) ?? handlers.set(e.source, []).get(e.source))!.push(e.target);

  const out: AuthzGap[] = [];
  for (const [epId, hIds] of handlers) {
    const ep = byId.get(epId); if (!ep) continue;
    for (const hId of hIds) {
      // BFS forward from the handler over CALLS, depth-bounded
      const seen = new Set<string>([hId]); let frontier = [hId]; let depth = 0; const reached = [hId];
      while (frontier.length && depth < maxDepth) { const next: string[] = []; for (const id of frontier) for (const c of calls.get(id) ?? []) if (!seen.has(c)) { seen.add(c); next.push(c); reached.push(c); } frontier = next; depth++; }
      // sensitive tables written anywhere on the path
      const sensTables = new Set<string>(); for (const id of reached) for (const t of writesSensitive.get(id) ?? []) sensTables.add(t);
      if (!sensTables.size) continue;
      // is there ANY auth-named function on the reachable path (incl the handler)?
      const guarded = reached.some((id) => { const n = byId.get(id); return n && isAuthName(n.name); });
      if (guarded) continue;
      const h = byId.get(hId);
      out.push({ endpoint: ep.name, method: ep.method ?? "", handler: h?.name ?? "?", handlerFile: h?.file, sensitiveTables: [...sensTables].sort(), reason: `${ep.method ?? ""} ${ep.name} → ${h?.name ?? "?"} reaches a WRITE to ${[...sensTables].map((t) => "'" + t + "'").join(", ")} with no auth/guard function on the path` });
    }
  }
  return out.sort((a, b) => b.sensitiveTables.length - a.sensitiveTables.length || a.endpoint.localeCompare(b.endpoint));
}
export function authzVerdict(gaps: ReadonlyArray<AuthzGap>): { clear: boolean; count: number; worstTables: string[] } {
  if (!gaps?.length) return { clear: true, count: 0, worstTables: [] };
  return { clear: false, count: gaps.length, worstTables: [...new Set(gaps.flatMap((g) => g.sensitiveTables))].sort() };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface AuthzGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function authzGauntlet(): AuthzGauntlet {
  // /transfer → doTransfer writes accounts, NO auth → GAP. /me → getProfile reads only → no gap.
  // /admin/pay → payHandler calls requireAdmin then doPay (writes payments) → GUARDED (auth on path).
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Account { id Int @id }\nmodel Payment { id Int @id }\nmodel Log { id Int @id }" },
    { path: "routes.ts", content: "router.post(\"/transfer\", doTransfer);\nrouter.post(\"/admin/pay\", payHandler);\nrouter.get(\"/log\", writeLog);" },
    { path: "handlers.ts", content: "export function doTransfer(req,res){ return prisma.account.update({where:{}}); }\nexport function payHandler(req,res){ requireAdmin(req); return doPay(); }\nexport function requireAdmin(req){ return req.user.isAdmin; }\nexport function doPay(){ return prisma.payment.create({data:{}}); }\nexport function writeLog(){ return prisma.log.create({data:{}}); }" },
  ]);
  const gaps = authzGaps(g);
  const transferGap = gaps.find((x) => x.endpoint === "/transfer");
  const gapOK = !!transferGap && transferGap.sensitiveTables.includes("Account") && transferGap.handler === "doTransfer";
  const guardedOK = !gaps.some((x) => x.endpoint === "/admin/pay");        // requireAdmin on the path → not flagged
  const nonsensitiveOK = !gaps.some((x) => x.endpoint === "/log");          // Log is not a sensitive table → not flagged
  const v = authzVerdict(gaps); const verdictOK = !v.clear && v.worstTables.includes("Account");
  const total = (() => { try { authzGaps(null as never); authzVerdict(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "UNGUARDED-WRITE", pass: gapOK, detail: "an endpoint whose handler writes a SENSITIVE table with no auth on the path → AUTHZ GAP" },
    { name: "AUTH-ON-PATH-CLEARS", pass: guardedOK, detail: "an auth/guard function on the call path (requireAdmin) → not flagged" },
    { name: "NON-SENSITIVE-CLEARS", pass: nonsensitiveOK, detail: "a write to a non-sensitive table (Log) → not flagged (no false alarm)" },
    { name: "VERDICT", pass: verdictOK, detail: "rollup of the sensitive tables exposed" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
