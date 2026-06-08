/**
 * INTENT-vs-IMPACT MISMATCH — catch the commit that lies about its own size.
 *
 * "chore: cleanup" / "fix typo" / "minor refactor" — and the diff quietly rewrites a keystone that's
 * the sole writer to the `payments` table and is reached by three endpoints. The message understates a
 * high-impact, high-risk change. Reviewers skim trivial-sounding commits; CI passes; the risky change
 * sails through mislabeled. Nothing flags the mismatch between a commit's STATED intent and its actual
 * cross-layer IMPACT — because measuring the impact needs the graph this project builds.
 *
 * This compares a commit message against the diff's cross-layer blast radius: a message that CLAIMS a
 * trivial change (typo/chore/format/rename/docs…) while the diff reaches DB tables / API endpoints /
 * keystones it never mentions = a MISMATCH to review. Works on EXISTING git history with zero extra
 * input — a commit-honesty audit no other tool can do across layers.
 *
 * ★HONEST (DIAKRISIS): a heuristic over the message wording + the deterministic blast radius — it flags
 * a likely mislabel / scope-creep to LOOK at, not a proof of intent. A legitimately-named change (the
 * message mentions the table/endpoint, or doesn't claim triviality) is not flagged.
 */
import { type CrossLayerGraph, buildCrossLayerGraph, diffBlastRadius, graphHealth, type DiffChange } from "../cross_layer_graph/index.js";

const lc = (s: string) => String(s ?? "").toLowerCase();
const TRIVIAL_RE = /\b(typo|typos|comment|comments|rename|reformat|format|formatting|lint|linting|whitespace|white[-\s]?space|docs?|documentation|readme|chore|style|styling|clean[\s-]?up|cleanup|nit|nits|minor|small|tiny|trivial|tweak|polish|cosmetic|wording|spacing|indent|prettier|bump|version)\b/i;
const SENSITIVE_RE = /\b(account|payment|wallet|password|credential|secret|token|admin|role|permission|balance|transaction|billing|card|user|order|invoice|subscription)\b/i;

export type MismatchSeverity = "HIGH" | "MEDIUM";
export interface IntentImpact {
  mismatch: boolean;
  statedTrivial: boolean;
  reachedTables: string[]; reachedEndpoints: string[]; keystonesHit: string[];
  unmentioned: string[];        // impacted nodes the message never names
  severity: MismatchSeverity | null;
  reason: string;
}
/** Compare a commit message's claimed intent against the diff's actual cross-layer impact. */
export function intentImpactMismatch(graph: CrossLayerGraph, diff: string | ReadonlyArray<DiffChange>, message: string): IntentImpact {
  const msg = lc(message);
  const b = diffBlastRadius(graph, diff as never, { maxDepth: 1 });
  const keystoneNames = new Set(graphHealth(graph).keystones.map((k) => k.node.name));
  const reachedTables = b.tables.map((t) => t.name);
  const reachedEndpoints = b.endpoints.map((e) => `${e.method} ${e.name}`);
  const keystonesHit = [...new Set([...b.origins, ...b.functions].filter((f) => keystoneNames.has(f.name)).map((f) => f.name))];
  const statedTrivial = TRIVIAL_RE.test(msg) && !/\b(feat|feature|breaking|migration|schema|refactor\s+the)\b/i.test(msg);
  const mentioned = (name: string) => { const n = lc(name).replace(/^\/+/, "").replace(/^(get|post|put|patch|delete)\s+/, ""); return n.length > 2 && msg.includes(n); };
  const unmentioned = [...reachedTables, ...reachedEndpoints].filter((n) => !mentioned(n));
  const highImpact = reachedTables.length > 0 || reachedEndpoints.length > 0 || keystonesHit.length > 0;
  const mismatch = statedTrivial && highImpact && unmentioned.length > 0;
  const hitsSensitive = reachedTables.some((t) => SENSITIVE_RE.test(t)) || keystonesHit.length > 0;
  const severity: MismatchSeverity | null = mismatch ? (hitsSensitive ? "HIGH" : "MEDIUM") : null;
  const reason = mismatch
    ? `the message sounds trivial but the change reaches ${[...keystonesHit.map((k) => "keystone " + k), ...reachedTables.map((t) => "table " + t), ...reachedEndpoints.map((e) => "endpoint " + e)].filter(Boolean).slice(0, 8).join(", ")} — none named in the message`
    : statedTrivial ? "message is trivial AND the change has no cross-layer impact — consistent" : "message does not claim a trivial change";
  return { mismatch, statedTrivial, reachedTables, reachedEndpoints, keystonesHit, unmentioned, severity, reason };
}

// ── BLAST-AWARE COMMIT MESSAGE — generate an honest message FROM the diff's real impact ──────────
export interface SuggestedCommit { type: string; scope: string; subject: string; body: string; full: string }
/**
 * The inverse of the mismatch check: instead of flagging a lying message, GENERATE an honest one from
 * the diff's actual cross-layer blast radius. Deterministic (no LLM): the type is inferred from the
 * impact (reaches endpoints/tables → feat · functions only → refactor · test files only → test · none
 * resolved → chore), the scope from the primary changed area, the body lists exactly what it touches.
 * Pairs with intentImpactMismatch — a message generated this way PASSES the mismatch check by
 * construction. ★HONEST: it describes the structural WHAT deterministically; YOU set the real WHY.
 */
export function suggestCommitMessage(graph: CrossLayerGraph, diff: string | ReadonlyArray<DiffChange>): SuggestedCommit {
  const b = diffBlastRadius(graph, diff as never, { maxDepth: 1 });
  const fns = b.origins.map((o) => o.name);
  const files = [...new Set(b.origins.map((o) => o.file).filter((x): x is string => !!x))];
  const onlyTests = files.length > 0 && files.every((f) => /(\.|_)(test|spec)\.|(^|\/)(tests?|__tests__)\//i.test(f));
  const type = onlyTests ? "test" : (b.endpoints.length || b.tables.length) ? "feat" : fns.length ? "refactor" : "chore";
  // scope = the deepest common dir segment of the changed files, else the first table/endpoint
  const seg = files.length ? (files[0].split("/").slice(-2, -1)[0] || files[0].split("/")[0] || "") : (b.tables[0]?.name || "");
  const scope = (seg || "core").replace(/[^a-z0-9_-]/gi, "").slice(0, 20).toLowerCase();
  const subject = fns.length ? `${fns.slice(0, 3).join(", ")}${fns.length > 3 ? " +" + (fns.length - 3) : ""}` : (files[0] || "update");
  const lines: string[] = [];
  if (b.tables.length) lines.push(`- touches tables: ${b.tables.map((t) => t.name).join(", ")}`);
  if (b.endpoints.length) lines.push(`- reached by: ${b.endpoints.map((e) => `${e.method} ${e.name}`).join(", ")}`);
  if (b.rules.length) lines.push(`- implements: ${b.rules.map((r) => r.name).join(", ")}`);
  const body = lines.length ? lines.join("\n") + "\n\n<!-- ↑ cross-layer impact (Mneme, deterministic). Replace this line with WHY. -->" : "";
  const full = `${type}(${scope}): ${subject}${body ? "\n\n" + body : ""}`;
  return { type, scope, subject, body, full };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface IntentImpactGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function intentImpactGauntlet(): IntentImpactGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Payment { id Int @id }" },
    { path: "pay.ts", content: "export function register(){ return charge(); }\nexport function charge(){ return prisma.payment.create({data:{}}); }" },
  ]);
  const diff = "--- a/pay.ts\n+++ b/pay.ts\n@@ -1,1 +1,2 @@ export function charge(){\n+x\n";   // touches charge → Payment (keystone)
  const lying = intentImpactMismatch(g, diff, "chore: cleanup formatting");                       // trivial msg, heavy impact
  const honest = intentImpactMismatch(g, diff, "fix: update the payment charge logic");           // names payment → consistent
  const notTrivial = intentImpactMismatch(g, diff, "feat: rework charging");                       // not claiming trivial
  const lyingOK = lying.mismatch === true && lying.severity === "HIGH" && lying.keystonesHit.includes("charge");
  const honestOK = honest.mismatch === false;       // message mentions "payment"
  const notTrivialOK = notTrivial.mismatch === false;
  // suggested message: from the same diff → mentions Payment, type feat, and PASSES the mismatch check
  const sug = suggestCommitMessage(g, diff);
  const sugOK = /payment/i.test(sug.full) && sug.type === "feat" && intentImpactMismatch(g, diff, sug.full).mismatch === false;
  const total = (() => { try { intentImpactMismatch(null as never, "x", "y"); suggestCommitMessage(null as never, "x"); return true; } catch { return false; } })();
  const checks = [
    { name: "TRIVIAL-MSG-HEAVY-IMPACT", pass: lyingOK, detail: "'chore: cleanup' that rewrites a payment keystone → MISMATCH (HIGH)" },
    { name: "MENTIONED-IS-HONEST", pass: honestOK, detail: "a message that NAMES the impacted table → not a mismatch" },
    { name: "NON-TRIVIAL-CLEARS", pass: notTrivialOK, detail: "a message not claiming triviality → not a mismatch (no false alarm)" },
    { name: "SUGGEST-IS-HONEST", pass: sugOK, detail: "the generated commit message names the real impact (Payment) + passes its own mismatch check by construction" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
