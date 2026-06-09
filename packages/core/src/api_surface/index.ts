/**
 * API BREAKING-CHANGE DETECTOR — the cross-service-aware diff of your public contract.
 *
 * The most expensive mistake in a service architecture is removing or renaming an endpoint that another
 * service (or an external client) still calls. A normal git diff shows the line changed; it cannot tell
 * you that deleting `GET /v1/users` breaks the `web` service that calls it from a different repo. This
 * diffs the PRODUCED API surface (route definitions) between two file-sets — added / removed / changed
 * — and, given the consumers, marks a removed-or-changed endpoint BREAKING when a known service consumes
 * it, POSSIBLY_BREAKING otherwise (an external client might). Deterministic, cross-repo, CI-ready.
 *
 * ★HONEST (DIAKRISIS): matched by method + normalized URL path (params → *), so a gateway prefix or a
 * dynamically-built route can cause a miss; a removed endpoint with no known in-repo consumer is
 * POSSIBLY_BREAKING (external clients are invisible), never falsely cleared. It surfaces the contract
 * change you can verify, not a runtime guarantee.
 */
import { buildCrossLayerGraph, type SourceFile } from "../cross_layer_graph/index.js";
import { normPath, pathsMatch, extractConsumed, type Service } from "../cross_service/index.js";

export interface ApiEndpoint { method: string; path: string; key: string }
export interface ApiDiff { added: ApiEndpoint[]; removed: ApiEndpoint[]; changed: ApiEndpoint[]; unchanged: ApiEndpoint[] }
export type BreakSeverity = "BREAKING" | "POSSIBLY_BREAKING";
export interface BreakingChange { method: string; path: string; severity: BreakSeverity; consumedBy: string[]; reason: string }

/** The PRODUCED API surface of a file-set: every route definition as method + normalized path. */
export function apiSurface(files: ReadonlyArray<SourceFile>): ApiEndpoint[] {
  const g = buildCrossLayerGraph((files ?? []) as SourceFile[]);
  const out = new Map<string, ApiEndpoint>();
  for (const n of g.nodes) if (n.type === "api_endpoint") { const method = n.method || "ANY"; const np = normPath(n.name); const key = `${method} ${np}`; out.set(key, { method, path: n.name, key }); }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Added / removed / unchanged endpoints between two file-sets (keyed by method + normalized path). */
export function apiDiff(beforeFiles: ReadonlyArray<SourceFile>, afterFiles: ReadonlyArray<SourceFile>): ApiDiff {
  const before = apiSurface(beforeFiles); const after = apiSurface(afterFiles);
  const bKeys = new Set(before.map((e) => e.key)); const aKeys = new Set(after.map((e) => e.key));
  const added = after.filter((e) => !bKeys.has(e.key));
  const removed = before.filter((e) => !aKeys.has(e.key));
  const unchanged = after.filter((e) => bKeys.has(e.key));
  // "changed" = same normalized path, different method (e.g. GET→POST) — a removed+added on the same path
  const aPaths = new Map(after.map((e) => [normPath(e.path), e] as const));
  const changed = removed.filter((r) => { const a = aPaths.get(normPath(r.path)); return a && a.method !== r.method; });
  return { added, removed, changed, unchanged };
}

/** Removed/changed endpoints, marked BREAKING when a known consumer service calls them. */
export function breakingChanges(beforeFiles: ReadonlyArray<SourceFile>, afterFiles: ReadonlyArray<SourceFile>, consumers: ReadonlyArray<Service> = []): { breaking: BreakingChange[]; addedCount: number; removedCount: number } {
  const diff = apiDiff(beforeFiles, afterFiles);
  // map each consumer service → its consumed endpoints
  const consumerCalls = (consumers ?? []).map((s) => ({ name: s.name, calls: extractConsumed(s.files) }));
  const breaking: BreakingChange[] = [];
  for (const r of diff.removed) {
    const np = normPath(r.path);
    const consumedBy = consumerCalls.filter((c) => c.calls.some((call) => pathsMatch(call.norm, np) && (call.method === "ANY" || r.method === "ANY" || call.method === r.method))).map((c) => c.name);
    const severity: BreakSeverity = consumedBy.length ? "BREAKING" : "POSSIBLY_BREAKING";
    breaking.push({ method: r.method, path: r.path, severity, consumedBy, reason: consumedBy.length ? `removed/changed ${r.method} ${r.path} is consumed by: ${consumedBy.join(", ")} — BREAKING` : `removed/changed ${r.method} ${r.path} — POSSIBLY breaking (no in-repo consumer found; external clients are invisible)` });
  }
  breaking.sort((a, b) => (b.severity === "BREAKING" ? 1 : 0) - (a.severity === "BREAKING" ? 1 : 0) || a.path.localeCompare(b.path));
  return { breaking, addedCount: diff.added.length, removedCount: diff.removed.length };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ApiSurfaceGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function apiSurfaceGauntlet(): ApiSurfaceGauntlet {
  const before: SourceFile[] = [{ path: "r.ts", content: "router.get(\"/v1/users/:id\", h);\nrouter.post(\"/v1/charge\", h);\nrouter.get(\"/v1/ping\", h);" }];
  const after: SourceFile[] = [{ path: "r.ts", content: "router.post(\"/v1/charge\", h);\nrouter.get(\"/v1/ping\", h);\nrouter.get(\"/v1/health\", h);" }];   // removed /v1/users/:id, added /v1/health
  const diff = apiDiff(before, after);
  const diffOK = diff.removed.some((e) => e.key === "GET /v1/users/*") && diff.added.some((e) => e.key === "GET /v1/health") && diff.unchanged.some((e) => e.key === "POST /v1/charge");
  const consumers: Service[] = [{ name: "web", files: [{ path: "api.ts", content: "fetch(\"/v1/users/42\");" }] }];   // web consumes the removed endpoint
  const bc = breakingChanges(before, after, consumers);
  const breakingOK = bc.breaking.some((b) => normPath(b.path) === "/v1/users/*" && b.severity === "BREAKING" && b.consumedBy.includes("web"));
  // a removal with NO consumer → POSSIBLY_BREAKING (not falsely cleared, not falsely confirmed)
  const bcNoConsumer = breakingChanges(before, after, []);
  const possiblyOK = bcNoConsumer.breaking.every((b) => b.severity === "POSSIBLY_BREAKING") && bcNoConsumer.breaking.length === 1;
  const addedNotBreaking = bc.addedCount === 1;   // adding an endpoint is not a breaking change
  const total = (() => { try { apiSurface(null as never); apiDiff(null as never, null as never); breakingChanges(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "SURFACE-DIFF", pass: diffOK, detail: "added / removed / unchanged endpoints between two refs (keyed by method + normalized path)" },
    { name: "CROSS-SERVICE-BREAKING", pass: breakingOK, detail: "a removed endpoint a sibling service CONSUMES → BREAKING, naming the consumer (the cross-repo break git can't see)" },
    { name: "POSSIBLY-WHEN-NO-CONSUMER", pass: possiblyOK, detail: "a removed endpoint with no in-repo consumer → POSSIBLY_BREAKING (external clients invisible — never falsely cleared)" },
    { name: "ADD-IS-SAFE", pass: addedNotBreaking, detail: "adding an endpoint is counted, not flagged as breaking (no false alarm)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
