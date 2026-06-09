/**
 * GRAPHQL SURFACE + BREAKING-CHANGE — the api-diff for a GraphQL schema.
 *
 * REST has paths; GraphQL has a typed operation surface (Query / Mutation / Subscription fields). Remove
 * or retype a field and every client selecting it breaks — and a normal git diff can't tell you which
 * change is breaking. This extracts the operation surface from SDL (including `extend type` and inline
 * gql`…` template literals), diffs two versions, and flags a REMOVED operation or a CHANGED return type
 * as BREAKING (a client may select it) — the GraphQL counterpart of the REST breaking-change detector.
 *
 * ★HONEST (DIAKRISIS): SDL-based — it reads the schema definition language (the contract clients code
 * against), so a pure code-first schema with no emitted SDL (e.g. bare decorators) is out of scope; an
 * added field is non-breaking; a removed/retyped field is breaking because external clients are
 * invisible. It surfaces the contract change you can verify, deterministically.
 */
import { type SourceFile } from "../cross_layer_graph/index.js";

const MAX = 600_000;
export type GqlKind = "Query" | "Mutation" | "Subscription";
export interface GqlOp { kind: GqlKind; name: string; type: string; key: string }
export interface GqlDiff { added: GqlOp[]; removed: GqlOp[]; retyped: Array<{ key: string; from: string; to: string }>; unchanged: GqlOp[] }
export type GqlBreakSeverity = "BREAKING" | "SAFE";
export interface GqlBreakingChange { key: string; severity: GqlBreakSeverity; reason: string }

/** Extract the GraphQL operation surface (Query/Mutation/Subscription fields) from SDL across files. */
export function graphqlSurface(files: ReadonlyArray<SourceFile>): GqlOp[] {
  const out = new Map<string, GqlOp>();
  for (const f of files ?? []) {
    const c = String(f?.content ?? "").slice(0, MAX);
    // SDL: `type Query { … }` / `extend type Mutation { … }` blocks (also inside gql`…` template literals)
    for (const m of c.matchAll(/\b(?:extend\s+)?type\s+(Query|Mutation|Subscription)\s*\{([^}]*)\}/g)) {
      const kind = m[1] as GqlKind; const body = m[2];
      // each field: name (optionalArgs) : ReturnType   — comments/directives tolerated
      for (const fm of body.matchAll(/(^|\n)\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*([\[A-Za-z_][\w!\[\]]*)/g)) {
        const name = fm[2]; const type = fm[3]; if (!name) continue;
        const key = `${kind}.${name}`; out.set(key, { kind, name, type, key });
      }
    }
    // CODE-FIRST: TypeGraphQL @Query(() => User) someName() / @Mutation(...) — the method name is the operation.
    for (const m of c.matchAll(/@(Query|Mutation|Subscription)\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?:async\s+)?(\w+)\s*\(/g)) {
      const kind = m[1] as GqlKind; const name = m[3]; if (!name) continue;
      const tm = m[2].match(/=>\s*\[?\s*([A-Za-z_]\w*)/); const type = tm ? tm[1] : "Unknown";   // @Query(() => User) / @Query(() => [User])
      const key = `${kind}.${name}`; if (!out.has(key)) out.set(key, { kind, name, type, key });
    }
    // CODE-FIRST: strawberry (Python) @strawberry.mutation / @strawberry.field def name(...)
    for (const m of c.matchAll(/@strawberry\.(mutation|subscription|field)\s*(?:\([^)]*\))?\s*(?:\r?\n\s*)?def\s+(\w+)\s*\(\s*self[^)]*\)\s*->\s*([A-Za-z_"\[\]]+)?/g)) {
      const kind: GqlKind = m[1] === "mutation" ? "Mutation" : m[1] === "subscription" ? "Subscription" : "Query";
      const name = m[2]; if (!name) continue; const type = (m[3] || "Unknown").replace(/["\[\]]/g, "");
      const key = `${kind}.${name}`; if (!out.has(key)) out.set(key, { kind, name, type, key });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Added / removed / retyped / unchanged operations between two schema versions. */
export function graphqlDiff(before: ReadonlyArray<SourceFile>, after: ReadonlyArray<SourceFile>): GqlDiff {
  const b = graphqlSurface(before), a = graphqlSurface(after);
  const bMap = new Map(b.map((o) => [o.key, o] as const)); const aMap = new Map(a.map((o) => [o.key, o] as const));
  const added = a.filter((o) => !bMap.has(o.key));
  const removed = b.filter((o) => !aMap.has(o.key));
  const unchanged: GqlOp[] = []; const retyped: Array<{ key: string; from: string; to: string }> = [];
  for (const o of a) { const prev = bMap.get(o.key); if (!prev) continue; if (prev.type !== o.type) retyped.push({ key: o.key, from: prev.type, to: o.type }); else unchanged.push(o); }
  return { added, removed, retyped, unchanged };
}

/** Removed or retyped operations are BREAKING (a client may select them); additions are SAFE. */
export function graphqlBreaking(before: ReadonlyArray<SourceFile>, after: ReadonlyArray<SourceFile>): { breaking: GqlBreakingChange[]; addedCount: number; removedCount: number; retypedCount: number } {
  const d = graphqlDiff(before, after);
  const breaking: GqlBreakingChange[] = [
    ...d.removed.map((o) => ({ key: o.key, severity: "BREAKING" as const, reason: `removed ${o.key} — every client selecting it breaks` })),
    ...d.retyped.map((r) => ({ key: r.key, severity: "BREAKING" as const, reason: `${r.key} return type changed ${r.from} → ${r.to} — clients expecting ${r.from} break` })),
  ];
  return { breaking, addedCount: d.added.length, removedCount: d.removed.length, retypedCount: d.retyped.length };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface GraphqlGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function graphqlGauntlet(): GraphqlGauntlet {
  const before: SourceFile[] = [{ path: "schema.graphql", content: "type Query {\n  users: [User!]!\n  me: User\n  legacy: String\n}\ntype Mutation {\n  createUser(name: String): User\n}" }];
  const after: SourceFile[] = [{ path: "schema.graphql", content: "type Query {\n  users: [User!]!\n  me: Account\n  health: Boolean\n}\ntype Mutation {\n  createUser(name: String): User\n}" }];  // removed legacy, retyped me User→Account, added health
  const surface = graphqlSurface(before);
  const surfaceOK = surface.some((o) => o.key === "Query.users") && surface.some((o) => o.key === "Mutation.createUser") && surface.length === 4;
  const diff = graphqlDiff(before, after);
  const diffOK = diff.removed.some((o) => o.key === "Query.legacy") && diff.added.some((o) => o.key === "Query.health") && diff.retyped.some((r) => r.key === "Query.me" && r.from === "User" && r.to === "Account");
  const bc = graphqlBreaking(before, after);
  const removedBreaking = bc.breaking.some((b) => b.key === "Query.legacy" && b.severity === "BREAKING");
  const retypedBreaking = bc.breaking.some((b) => b.key === "Query.me" && b.severity === "BREAKING");
  const addSafe = bc.addedCount === 1 && !bc.breaking.some((b) => b.key === "Query.health");   // adding is not breaking
  const total = (() => { try { graphqlSurface(null as never); graphqlDiff(null as never, null as never); graphqlBreaking(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "SDL-SURFACE", pass: surfaceOK, detail: "Query/Mutation/Subscription fields extracted from SDL as the typed operation surface" },
    { name: "DIFF", pass: diffOK, detail: "added / removed / RETYPED operations between two schema versions" },
    { name: "REMOVED-BREAKING", pass: removedBreaking, detail: "a removed operation → BREAKING (clients selecting it break)" },
    { name: "RETYPE-BREAKING", pass: retypedBreaking, detail: "a changed return type → BREAKING (clients expecting the old type break)" },
    { name: "ADD-IS-SAFE", pass: addSafe, detail: "adding an operation is SAFE (no false alarm)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
